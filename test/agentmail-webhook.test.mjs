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

async function setup(t, guildStatus = 201, message = storedMessage, amplitudeStatus) {
  assert.ok(existsSync(route), "AgentMail needs an inbound webhook route");
  const { POST } = await import(route);
  for (const [key, value] of Object.entries({
    AGENTMAIL_WEBHOOK_TOKEN: token,
    AGENTMAIL_INBOX_ID: inbox,
    AGENTMAIL_API_KEY: "inbox-read-key",
    GUILD_TRIGGER_KEY: "trigger-id:trigger-secret",
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
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.agentmail.to/v0/inboxes/guido%40agentmail.to/messages/%3Cinbound%2F1%40example.com%3E");
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].headers.get("Authorization"), "Bearer inbox-read-key");
  assert.equal(requests[1].url, "https://api.guild.ai/v1/workspaces/nirmalhk7/tokensandhackathon/sessions");
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].headers.get("Authorization"), "Basic dHJpZ2dlci1pZDp0cmlnZ2VyLXNlY3JldA==");
  const input = await requests[1].json();
  assert.equal(input.session_type, "api_trigger");
  assert.deepEqual(JSON.parse(input.agent_input.text), {
    subject: "Rental request",
    message: "New text from the full message.",
    sent_at: "2026-11-20T20:00:00Z",
    agentmail_event_id: "event-1",
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
  assert.equal(events.length, 1);
  const [span] = events;
  assert.equal(span.event_type, "[Agent] Span");
  assert.equal(span.event_properties["[Agent] Agent ID"], "guido");
  assert.equal(span.event_properties["[Agent] Session ID"], "guild-session");
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
  const input = await requests[1].json();
  assert.equal(JSON.parse(input.agent_input.text).message, "<p>HTML only.</p>");
});
