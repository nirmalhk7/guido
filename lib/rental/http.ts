import { z } from "zod";
import { loadSuppliers } from "./config.ts";
import { tripSchema } from "./contracts.ts";
import { compareRentals } from "./search.ts";

const inputSchema = z.strictObject({ environment: z.enum(["live", "fixture"]).default("live"), trip: z.unknown() });
const maxBytes = 32 * 1024;
const respond = (data: object, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function readInput(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return JSON.parse(text + decoder.decode());
    bytes += value.length;
    if (bytes > maxBytes) {
      // Do not await cancellation before handing the 413 back to the HTTP adapter.
      void reader.cancel().catch(() => {});
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function POST(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") return respond({ error: "Send application/json." }, 415);
  if (Number(request.headers.get("content-length")) > maxBytes) return respond({ error: "Request is too large." }, 413);
  const data = await readInput(request).catch(() => null);
  if (data === undefined) return respond({ error: "Request is too large." }, 413);
  const input = inputSchema.safeParse(data);
  if (!input.success) return respond({ error: "Supply a trip and a live or fixture environment." }, 400);
  const trip = tripSchema.safeParse(input.data.trip);
  if (!trip.success) return respond({ error: "Check the trip details.", issues: trip.error.issues.map(({ path, message }) => ({
    path: path.join("."), message,
  })) }, 400);

  const { environment } = input.data;
  try {
    const suppliers = await loadSuppliers(environment);
    return respond(await compareRentals(trip.data, suppliers, environment, request.signal));
  } catch {
    return respond({ error: "Rental search is unavailable. Check the server's provider configuration." }, 503);
  }
}
