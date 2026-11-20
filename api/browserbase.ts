import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const gate = "guido_browserbase";
const runs = "https://api.browserbase.com/v1/agents/runs";
const domains = ["hertz.com", "avis.com", "enterprise.com"] as const;
const browserbaseRequest = z.strictObject({
  task: z.string().trim().min(1).max(12_000),
  browserSettings: z.strictObject({
    allowedDomains: z.array(z.enum(domains)).length(domains.length)
      .refine((allowed) => new Set(allowed).size === domains.length),
  }),
  resultSchema: z.looseObject({
    type: z.literal("object"),
    properties: z.record(z.string(), z.record(z.string(), z.unknown()))
      .refine((properties) => Object.keys(properties).length > 0),
  }),
});
const runIdSchema = z.uuid();
const digest = (value: string) => createHash("sha256").update(value).digest();

function authorize(request: Request) {
  const token = process.env.GUIDO_BROWSERBASE_GATEWAY_TOKEN?.trim();
  if (!token) return new Response(null, { status: 503 });
  const supplied = request.headers.get("X-Guido-Tool-Key") ?? "";
  if (!timingSafeEqual(digest(supplied), digest(token))) {
    return new Response(null, { status: 401 });
  }
}

async function evaluateGate(): Promise<"on" | "off" | "unavailable"> {
  const key = process.env.STATSIG_SDK_KEY?.trim();
  if (!key) return "unavailable";
  try {
    const response = await fetch("https://api.statsig.com/v1/check_gate", {
      method: "POST",
      headers: { "statsig-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        gateName: gate,
        user: { userID: "guido-guild" },
        statsigEnvironment: { tier: "production" },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      const result = await response.json();
      if (result?.name === gate && typeof result.value === "boolean") return result.value ? "on" : "off";
    }
  } catch {
    // Failed or malformed evaluations leave Browserbase disabled.
  }
  return "unavailable";
}

function result(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function browserbase(url: string, body?: z.infer<typeof browserbaseRequest>) {
  const decision = await evaluateGate();
  if (decision !== "on") {
    return result({
      status: "DISABLED",
      reason: decision === "off" ? "feature_gate_off" : "feature_gate_unavailable",
    });
  }

  const key = process.env.BROWSERBASE_API_KEY?.trim();
  if (!key) return result({ error: "Browserbase credential unavailable." }, 503);
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "X-BB-API-Key": key, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) return result(await response.json(), response.status);
  } catch {
    // Keep upstream request and credential details out of Guild results.
  }
  return result({ error: "Browserbase request failed." }, 502);
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const input = browserbaseRequest.safeParse(await request.json().catch(() => null));
  if (!input.success) return result({ error: "Invalid rental search request." }, 400);
  return browserbase(runs, input.data);
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const runId = runIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
  if (!runId.success) return result({ error: "Invalid Browserbase run ID." }, 400);
  return browserbase(`${runs}/${runId.data}`);
}
