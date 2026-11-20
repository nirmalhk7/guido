import { createHash, timingSafeEqual } from "node:crypto";
import { scanGmailTrips } from "../lib/gmail.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return new Response(null, { status: 503 });
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return new Response(null, { status: 401 });
  }
  try {
    await scanGmailTrips();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.warn(error instanceof Error && error.message === "Gmail history expired. Review missed mail before resetting the checkpoint."
      ? error.message : "Guido Gmail scan failed.");
    return new Response(null, { status: 502 });
  }
}
