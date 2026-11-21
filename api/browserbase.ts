import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { observeAgentRun, type AgentTrace } from "../lib/amplitude.ts";
import { readFiredrillRates, rentalRequirements, syntheticQuotes } from "../lib/firedrill-rental.ts";
import { evaluateRentalGate } from "../lib/statsig.ts";
const runs = "https://api.browserbase.com/v1/agents/runs";
const domains = ["hertz.com", "avis.com", "enterprise.com"] as const;
const vendorResult = {
  type: "object",
  properties: {
    status: { type: "string" },
    source_url: { type: "string" },
    failure_reason: { type: "string" },
    vehicle_category: { type: "string" },
    currency: { type: "string" },
    displayed_total: { type: "string" },
    rate_terms: { type: "string" },
  },
  required: ["status", "source_url"],
};
const quoteResultSchema = {
  type: "object",
  properties: { hertz: vendorResult, avis: vendorResult, enterprise: vendorResult },
  required: ["hertz", "avis", "enterprise"],
};

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
  }).optional(),
  rentalRequirements: rentalRequirements.optional(),
  provider: z.enum(["browserbase", "firedrill"]).optional(),
  traceId: z.uuid().optional(),
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

function result(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type RentalSearch = z.infer<typeof browserbaseRequest>;

async function routeSearch(url: string, trace: AgentTrace, body?: RentalSearch) {
  const decision = await trace.span("statsig.gateway_gate", async (report) => {
    const gate = await evaluateRentalGate();
    report(gate === "unavailable" ? "failed" : gate);
    return gate;
  });
  const provider = decision === "on" ? "browserbase" : "firedrill";
  if (decision !== "unavailable" && body?.provider && body.provider !== provider) {
    return result({ status: "DISABLED", reason: "provider_changed" });
  }
  const requirements = body?.rentalRequirements;
  if (decision === "off" && requirements) {
    return trace.span("firedrill.quotes", async (report) => {
      const response = await firedrillQuote(requirements);
      const data = await response.clone().json();
      report(data.status === "SIMULATED" ? "simulated" : "failed");
      return response;
    });
  }
  if (decision !== "on") {
    return result({
      status: "DISABLED",
      reason: decision === "off" ? "feature_gate_off" : "feature_gate_unavailable",
    });
  }
  return trace.span(body ? "browserbase.start" : "browserbase.status", async (report) => {
    const response = await browserbase(url, body);
    const disabled = response.status === 200 && (await response.clone().json()).status === "DISABLED";
    report(response.ok && !disabled ? "completed" : "failed");
    return response;
  });
}

async function browserbase(url: string, body?: RentalSearch) {
  const key = process.env.BROWSERBASE_API_KEY?.trim();
  if (!key) return result({ error: "Browserbase credential unavailable." }, 503);
  const upstreamBody = body && {
    task: body.task, browserSettings: body.browserSettings, resultSchema: body.resultSchema ?? quoteResultSchema,
  };
  try {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "X-BB-API-Key": key, "Content-Type": "application/json" },
      body: upstreamBody && JSON.stringify(upstreamBody),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 402) {
      return result({ status: "DISABLED", reason: "browserbase_quota_exhausted" });
    }
    if (response.ok) return result(await response.json(), response.status);
  } catch {
    // Keep upstream request and credential details out of Guild results.
  }
  return result({ error: "Browserbase request failed." }, 502);
}

async function firedrillQuote(requirements: z.infer<typeof rentalRequirements>) {
  try {
    const quote = syntheticQuotes(requirements, await readFiredrillRates(requirements.pickupLocation));
    if (quote) return result({ status: "SIMULATED", source: "Firedrill", ...quote });
  } catch {
    // Missing, expired, and malformed simulator responses must never reach live browsing.
  }
  return result({ status: "DISABLED", reason: "simulation_unavailable" });
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const input = browserbaseRequest.safeParse(await request.json().catch(() => null));
  if (!input.success) return result({ error: "Invalid rental search request." }, 400);
  return observeAgentRun("rental_gateway", (trace) => routeSearch(runs, trace, input.data), input.data.traceId);
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const runId = runIdSchema.safeParse(query.get("runId"));
  if (!runId.success) return result({ error: "Invalid Browserbase run ID." }, 400);
  const traceId = z.uuid().optional().safeParse(query.get("traceId") ?? undefined);
  if (!traceId.success) return result({ error: "Invalid trace ID." }, 400);
  return observeAgentRun("rental_gateway", (trace) => routeSearch(`${runs}/${runId.data}`, trace), traceId.data);
}
