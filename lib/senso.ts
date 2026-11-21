import { z } from "zod";
import type { AgentTrace } from "./amplitude.ts";

const rentalQuery = "Travel guidance for planning a rental car trip: pickup and return, driver requirements, fees, and road trip preparation.";
const roadTripQuery = "Rental car guidance for a road trip, including mileage limits, cross-border rules, and roadside assistance.";
const maxResults = 3;
const responseSchema = z.object({ results: z.array(z.unknown()) });
const passageSchema = z.object({
  content_id: z.string(),
  title: z.string().trim().min(1),
  chunk_text: z.string().trim().min(1),
});

export async function rentalGuidance(roadTrip: boolean, trace?: AgentTrace) {
  const apiKey = process.env.SENSO_API_KEY?.trim();
  const approved = new Set((process.env.SENSO_CONTENT_IDS ?? "").split(",")
    .map((id) => id.trim().toLowerCase()).filter(Boolean));
  if (!apiKey || approved.size === 0) return;

  const search = async () => {
    const query = roadTrip ? roadTripQuery : rentalQuery;
    const response = await fetch("https://apiv2.senso.ai/api/v1/org/search/context", {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_results: maxResults, content_ids: [...approved], require_scoped_ids: true }),
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Senso search failed (HTTP ${response.status}).`);
    const { results } = responseSchema.parse(await response.json());
    const passages = [];
    for (const result of results) {
      const passage = passageSchema.safeParse(result);
      if (!passage.success) continue;
      const { content_id, title, chunk_text } = passage.data;
      if (!approved.has(content_id.toLowerCase())) continue;
      passages.push({ content_id, title: title.slice(0, 200), text: chunk_text.slice(0, 1_500) });
      if (passages.length === maxResults) break;
    }
    return passages.length ? passages : undefined;
  };

  try {
    return trace ? await trace.span("senso.rental_guidance", async (report) => {
      const passages = await search();
      report(passages ? "found" : "empty");
      return passages;
    }) : await search();
  } catch {
    // Drafting can proceed without supplemental guidance.
  }
}
