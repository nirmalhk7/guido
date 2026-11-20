import { createHash, randomUUID } from "node:crypto";

type GuildStage = "trigger" | "draft";

export async function observeGuildRun<T>(
  stage: GuildStage,
  run: (identify: (sessionId: string) => void) => Promise<T>,
): Promise<T> {
  const apiKey = process.env.AMPLITUDE_API_KEY?.trim();
  if (!apiKey) return run(() => {});

  const startedAt = performance.now();
  let sessionId: string | undefined;
  let outcome: "accepted" | "completed" | "failed" = "failed";
  try {
    const result = await run((id) => { sessionId = id; });
    outcome = stage === "trigger" ? "accepted" : "completed";
    return result;
  } finally {
    const id = sessionId ?? randomUUID();
    const time = Date.now();
    const identity = {
      device_id: createHash("sha256").update(`guido:${id}`).digest("hex"),
      time,
    };
    const properties = {
      "[Agent] Agent ID": "guido",
      "[Agent] Session ID": id,
      "[Agent] Turn ID": 1,
      "[Agent] Trace ID": id,
      "[Agent] Env": process.env.VERCEL_ENV ?? "local",
      "[Agent] Runtime": "guild",
      "[Agent] Output State": outcome,
    };
    const events = [{
      ...identity,
      insert_id: `guido:${stage}:${id}:span`,
      event_type: "[Agent] Span",
      event_properties: {
        ...properties,
        "[Agent] Span Name": stage === "trigger" ? "guild.session.start" : "guild.draft",
        "[Agent] Latency Ms": Math.round(performance.now() - startedAt),
        "[Agent] Is Error": outcome === "failed",
      },
    }];
    const payload = stage === "draft" || outcome === "failed"
      ? [...events, {
        ...identity,
        insert_id: `guido:${stage}:${id}:end`,
        event_type: "[Agent] Session End",
        event_properties: properties,
      }]
      : events;

    await uploadEvents(apiKey, payload);
  }
}

async function uploadEvents(apiKey: string, events: object[]) {
  try {
    const response = await fetch("https://api2.amplitude.com/2/httpapi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, events }),
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) console.warn(`Amplitude telemetry rejected (HTTP ${response.status}).`);
  } catch {
    console.warn("Amplitude telemetry upload failed.");
  }
}

type ReportSpan = (state: string, rentalProbability?: number) => void;

export type AgentTrace = {
  id?: string;
  identifyGuild(sessionId: string): void;
  finish(state: "accepted" | "skipped"): void;
  span<T>(name: string, work: (report: ReportSpan) => Promise<T>): Promise<T>;
};

export async function observeAgentRun<T>(
  source: "agentmail" | "gmail" | "rental_gateway",
  run: (trace: AgentTrace) => Promise<T>,
  continuationId?: string,
): Promise<T> {
  const apiKey = process.env.AMPLITUDE_API_KEY?.trim();
  if (!apiKey) return run({ identifyGuild: () => {}, finish: () => {}, span: (_name, work) => work(() => {}) });

  const batchId = randomUUID();
  const id = continuationId ?? batchId;
  const device_id = createHash("sha256").update(`guido:${id}`).digest("hex");
  const properties = {
    "[Agent] Agent ID": "guido",
    "[Agent] Session ID": id,
    "[Agent] Trace ID": id,
    "[Agent] Turn ID": 1,
    "[Agent] Env": process.env.VERCEL_ENV ?? "local",
    "[Agent] Runtime": "guido",
    "[Agent] Source": source,
  };
  const events: { device_id: string; time: number; insert_id: string; event_type: string; event_properties: object }[] = [];
  const track = (event_type: string, details: object) => {
    events.push({ device_id, time: Date.now(), insert_id: `guido:${batchId}:${events.length}`,
      event_type, event_properties: { ...properties, ...details } });
  };

  let guildSessionId: string | undefined;
  let outcome: "accepted" | "skipped" | "completed" = "completed";
  const trace: AgentTrace = {
    id,
    identifyGuild: (sessionId) => { guildSessionId = sessionId; },
    finish: (state) => { outcome = state; },
    async span(name, work) {
      const started = performance.now();
      let state = "completed";
      let probability: number | undefined;
      let failed = false;
      try {
        return await work((output, score) => {
          state = output;
          probability = score;
        });
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        track("[Agent] Span", {
          "[Agent] Span Name": name,
          "[Agent] Output State": failed ? "failed" : state,
          "[Agent] Latency Ms": Math.round(performance.now() - started),
          "[Agent] Is Error": failed || state === "failed",
          "[Agent] Rental Probability": probability,
        });
      }
    },
  };

  let state = "failed";
  try {
    const result = await run(trace);
    state = outcome;
    return result;
  } finally {
    if (!continuationId && state !== "accepted") track("[Agent] Session End", { "[Agent] Output State": state });
    await uploadEvents(apiKey, events.map((event) => {
      const { event_properties, ...fields } = event;
      return {
        ...fields,
        event_properties: { ...event_properties, "[Agent] Guild Session ID": guildSessionId },
      };
    }));
  }
}
