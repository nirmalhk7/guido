import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const route = new URL("../api/agentmail.ts", import.meta.url);
const inbox = "guido@agentmail.to";
const token = "a".repeat(64);
const messageId = "<inbound/1@example.com>";
const event = {
  event_type: "message.received",
  event_id: "event-1",
  message: { inbox_id: inbox, message_id: messageId },
};
const storedMessage = {
  message_id: messageId,
  subject: "Rental request",
  timestamp: "2026-11-20T20:00:00Z",
  extracted_text: "New text from the full message.",
  text: "New text from the full message. Older quoted text.",
  from: "sender@example.com",
  to: [inbox],
  labels: ["received"],
};

async function setup(t, guildStatus = 201, message = storedMessage, amplitudeStatus, probability = 0.8, gate = true, roadTrip = 0.9) {
  assert.ok(existsSync(route), "AgentMail needs an inbound webhook route");
  const { POST } = await import(route);
  for (const [key, value] of Object.entries({
    AGENTMAIL_WEBHOOK_TOKEN: token,
    AGENTMAIL_INBOX_ID: inbox,
    AGENTMAIL_API_KEY: "inbox-read-key",
    GUILD_TRIGGER_KEY: "trigger-id:trigger-secret",
    SUPERLINKED_API_KEY: "sie-test",
    STATSIG_SDK_KEY: "statsig-test",
    AMPLITUDE_API_KEY: amplitudeStatus === undefined ? "" : "amplitude-test",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.url.startsWith("https://api.agentmail.to/")) return Response.json(message);
    if (request.url === "https://api2.amplitude.com/2/httpapi") {
      return Response.json({}, { status: amplitudeStatus });
    }
    if (request.url === "https://api.superlinked.com/v1/decisions") {
      const { questions } = await request.json();
      return Response.json({ answers: questions.map(({ name, type }) =>
        ({ type, name, probability: name === "road_trip_detected" ? roadTrip : probability })) });
    }
    if (request.url === "https://api.statsig.com/v1/check_gate") {
      return Response.json({ name: "BROWSERBASE_ENABLED", value: gate });
    }
    return Response.json({ id: "guild-session" }, { status: guildStatus });
  });
  const deliver = (body = event, credential = token) => POST(new Request("https://relay.example/api/agentmail", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { deliver, requests };
}

test("an inbound webhook fetches the full email and starts Guido on Guild", async (t) => {
  const { deliver, requests } = await setup(t);
  const response = await deliver();
  assert.equal(response.status, 204);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url, "https://api.agentmail.to/v0/inboxes/guido%40agentmail.to/messages/%3Cinbound%2F1%40example.com%3E");
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.get("Authorization"), "Bearer inbox-read-key");
  assert.equal(requests[3].url, "https://api.guild.ai/v1/workspaces/nirmalhk7/tokensandhackathon/sessions");
  assert.equal(requests[3].method, "POST");
  assert.equal(requests[3].headers.get("Authorization"), "Basic dHJpZ2dlci1pZDp0cmlnZ2VyLXNlY3JldA==");
  const input = await requests[3].json();
  assert.equal(input.session_type, "api_trigger");
  assert.deepEqual(JSON.parse(input.agent_input.text), {
    subject: "Rental request",
    message: "New text from the full message.",
    sent_at: "2026-11-20T20:00:00Z",
    agentmail_event_id: "event-1",
    rental_provider: "browserbase",
  });
});

test("untrusted requests cannot cause any provider calls", async (t) => {
  const { deliver, requests } = await setup(t);
  assert.equal((await deliver(event, "wrong")).status, 401);
  assert.equal((await deliver({ ...event, event_type: "message.sent" })).status, 204);
  assert.equal((await deliver({ ...event, message: { ...event.message, inbox_id: "other@agentmail.to" } })).status, 204);
  assert.equal((await deliver({ ...event, message: {} })).status, 400);
  assert.equal(requests.length, 0);
});

test("Guild failure leaves the delivery retryable", async (t) => {
  const { deliver } = await setup(t, 503);
  assert.equal((await deliver()).status, 502);
});

test("a Guild API trigger reports session acceptance without email data", async (t) => {
  const { deliver, requests } = await setup(t, 201, storedMessage, 200);
  assert.equal((await deliver()).status, 204);
  const upload = requests.find(({ url }) => url === "https://api2.amplitude.com/2/httpapi");
  assert.ok(upload, "the relay must report the Guild session to Amplitude");
  const { api_key, events } = await upload.json();
  assert.equal(api_key, "amplitude-test");
  const names = events.map(({ event_properties }) => event_properties["[Agent] Span Name"]);
  assert.ok(names.includes("email.received"));
  assert.ok(names.includes("road_trip.detected"));
  const guildRequest = requests.find(({ url }) => url.includes("api.guild.ai"));
  const { agent_input } = await guildRequest.json();
  const { rental_trace_id } = JSON.parse(agent_input.text);
  assert.match(rental_trace_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual([...new Set(events.map(({ event_properties }) => event_properties["[Agent] Session ID"]))], [rental_trace_id]);
  const span = events.find(({ event_properties }) => event_properties["[Agent] Span Name"] === "guild.session.start");
  assert.equal(span.event_type, "[Agent] Span");
  assert.equal(span.event_properties["[Agent] Agent ID"], "guido");
  assert.equal(span.event_properties["[Agent] Guild Session ID"], "guild-session");
  assert.equal(span.event_properties["[Agent] Output State"], "accepted");
  assert.equal(span.event_properties["[Agent] Is Error"], false);
  assert.ok(span.event_properties["[Agent] Latency Ms"] >= 0);
  assert.doesNotMatch(JSON.stringify(events), /example\.com|Rental request|New text|event-1/);
});

test("Amplitude failure leaves a successful Guild trigger acknowledged", async (t) => {
  const { deliver, requests } = await setup(t, 201, storedMessage, 503);
  assert.equal((await deliver()).status, 204);
  assert.equal(requests.filter(({ url }) => new URL(url).hostname === "api2.amplitude.com").length, 1);
});

test("an unauthenticated sender and HTML-only message still reach Guido", async (t) => {
  const { deliver, requests } = await setup(t, 201, {
    ...storedMessage,
    extracted_text: undefined,
    text: undefined,
    html: "<p>HTML only.</p>",
    labels: ["received", "unauthenticated"],
  });
  assert.equal((await deliver({ ...event, event_type: "message.received.unauthenticated" })).status, 204);
  const input = await requests[3].json();
  assert.equal(JSON.parse(input.agent_input.text).message, "<p>HTML only.</p>");
});

test("a below-threshold incoming message is acknowledged without starting Guido", async (t) => {
  const { deliver, requests } = await setup(t, 201, storedMessage, 200, 0.49);
  assert.equal((await deliver()).status, 204);
  assert.deepEqual(requests.map((request) => new URL(request.url).hostname), [
    "api.agentmail.to", "api.superlinked.com", "api2.amplitude.com",
  ]);
  const { events } = await requests.at(-1).json();
  const names = events.map(({ event_properties }) => event_properties["[Agent] Span Name"]);
  assert.ok(names.includes("email.received"));
  assert.ok(names.includes("road_trip.detected"), "a road trip may use the traveler's own vehicle");
});

test("an ordinary incoming email records arrival without reporting a road trip", async (t) => {
  const { deliver, requests } = await setup(t, 201, storedMessage, 200, 0.2, true, 0.2);
  assert.equal((await deliver()).status, 204);
  const { events } = await requests.at(-1).json();
  const names = events.map(({ event_properties }) => event_properties["[Agent] Span Name"]);
  assert.equal(names.filter((name) => name === "email.received").length, 1);
  assert.ok(!names.includes("road_trip.detected"));
});

test("AgentMail gives Guild the provider selected after Superlinked's decision", async (t) => {
  const { deliver, requests } = await setup(t, 201, storedMessage, undefined, 0.8, false);
  assert.equal((await deliver()).status, 204);
  assert.deepEqual(requests.map((request) => new URL(request.url).hostname), [
    "api.agentmail.to", "api.superlinked.com", "api.statsig.com", "api.guild.ai",
  ]);
  const { agent_input } = await requests.at(-1).json();
  assert.equal(JSON.parse(agent_input.text).rental_provider, "firedrill");
});
