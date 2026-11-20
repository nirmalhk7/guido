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

    try {
      const response = await fetch("https://api2.amplitude.com/2/httpapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, events: payload }),
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) console.warn(`Amplitude telemetry rejected (HTTP ${response.status}).`);
    } catch {
      console.warn("Amplitude telemetry upload failed.");
    }
  }
}
