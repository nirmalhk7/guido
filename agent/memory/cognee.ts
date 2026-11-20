import { createHash } from "node:crypto";
import { defineMemory, defineMemoryProvider } from "eve/memory";
import { byPrincipal } from "eve/memory/scope";
import { defineTool } from "eve/tools";
import { z } from "zod";

const recallResponse = z.array(z.object({
  source: z.string(),
  text: z.string().nullish(),
  status: z.string().optional(),
}));
const rememberResponse = z.object({
  status: z.literal("completed"),
  items_processed: z.number().int().positive(),
});
const noMemory = "No relevant Cognee memories for this turn.";
const unavailable = "Cognee memory recall is unavailable for this turn.";

function recalled(content: string) {
  return { messages: [{ id: "cognee-recall", content }] };
}

function datasetName(scopeKey: string) {
  return `guido_memory_${createHash("sha256").update(scopeKey).digest("hex")}`;
}

function postCognee(
  baseUrl: string,
  operation: "remember" | "recall",
  body: FormData | string,
  signal: AbortSignal,
) {
  const headers = new Headers({ Accept: "application/json" });
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  const apiKey = process.env.COGNEE_API_KEY?.trim();
  const tenantId = process.env.COGNEE_TENANT_ID?.trim();
  const token = process.env.COGNEE_API_TOKEN?.trim();
  if (apiKey) headers.set("X-Api-Key", apiKey);
  if (tenantId) headers.set("X-Tenant-Id", tenantId);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const timeout = AbortSignal.timeout(operation === "recall" ? 5_000 : 90_000);
  return fetch(new URL(`/api/v1/${operation}`, baseUrl), {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.any([signal, timeout]),
  });
}

export default defineMemory({
  description: "Long-term user preferences and notes stored in Cognee.",
  namespace: "guido",
  scope: byPrincipal,
  provider: defineMemoryProvider({
    recall: {
      async "turn.started"({ turn, memory, abortSignal }) {
        const baseUrl = process.env.COGNEE_BASE_URL?.trim();
        if (!baseUrl) return null;

        const query = turn.input
          .filter((message) => message.role === "user")
          .flatMap(({ content }) => typeof content === "string"
            ? [content]
            : content.flatMap((part) => part.type === "text" ? [part.text] : []))
          .join("\n")
          .trim()
          .slice(0, 2_000);
        if (!query) return recalled(noMemory);

        try {
          const response = await postCognee(baseUrl, "recall", JSON.stringify({
            query,
            datasets: [datasetName(memory.scope.key)],
            search_type: "CHUNKS",
            top_k: 5,
          }), abortSignal);

          if (!response.ok) {
            const error = z.object({ detail: z.string() }).safeParse(await response.json());
            const detail = error.data?.detail ?? "";
            const emptyDataset =
              (response.status === 404 && detail.endsWith("[DatasetNotFoundError]")) ||
              (response.status === 422 && detail.endsWith("[RecallPreconditionError]"));
            return recalled(emptyDataset ? noMemory : unavailable);
          }

          const results = recallResponse.parse(await response.json());
          const notes = results
            .filter(({ source }) => source === "graph")
            .flatMap(({ text }) => text?.trim() ? [text.trim().slice(0, 2_000)] : [])
            .slice(0, 5);
          if (notes.length) return recalled(`Cognee memory notes: ${JSON.stringify(notes)}`);
          if (results.some(({ status }) => status === "build_failed")) return recalled(unavailable);
          return recalled(noMemory);
        } catch (error) {
          if (abortSignal.aborted) throw error;
          return recalled(unavailable);
        }
      },
    },
    async tools({ memory }) {
      const baseUrl = process.env.COGNEE_BASE_URL?.trim();
      if (!baseUrl) return null;

      return {
        remember: defineTool({
          description: "Save a concise note across chats when the user explicitly asks you to remember it.",
          inputSchema: z.object({ note: z.string().trim().min(1).max(2_000) }),
          async execute({ note }, { abortSignal }) {
            const form = new FormData();
            form.set("datasetName", datasetName(memory.scope.key));
            form.set("raw_data", note);
            form.set("run_in_background", "false");

            const response = await postCognee(baseUrl, "remember", form, abortSignal);
            if (!response.ok) throw new Error(`Cognee save failed (HTTP ${response.status}).`);
            if (!rememberResponse.safeParse(await response.json()).success) {
              throw new Error("Cognee did not confirm a completed memory save.");
            }

            return { saved: true };
          },
        }),
      };
    },
  }),
});
