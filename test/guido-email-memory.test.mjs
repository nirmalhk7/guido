import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../lib/guido-email.ts", import.meta.url);
const tenant = "00000000-0000-4000-8000-000000000001";
const inbox = "guido@agentmail.to";
const secret = "a".repeat(64);
const mail = (id, from, text, dmarc = "pass") => ({
  message_id: id,
  from,
  labels: ["received"],
  to: [inbox],
  subject: "Rental request",
  timestamp: "2026-11-20T20:00:00Z",
  extracted_text: text,
  authentication_results: { dmarc, dmarc_domain: "example.com" },
});

test("Guido drafts using only verified sender history and records the exchange in Cognee", async (t) => {
  assert.ok(existsSync(moduleUrl), "Guido needs a Cognee-backed email drafting entry point");
  const { draftGuidoEmail } = await import(moduleUrl);
  const messages = {
    first: mail("first", "Alice <alice@example.com>", "I always rent electric cars."),
    followup: mail("followup", "Alice <alice@example.com>", "What was my preference?"),
    other: mail("other", "bob@example.com", "What was my preference?"),
    forged: mail("forged", "alice@example.com", "What was my preference?", "fail"),
    failed: mail("failed", "bob@example.com", "Private failed draft", "fail"),
  };

  for (const [key, value] of Object.entries({
    AGENTMAIL_API_KEY: "agentmail-test",
    AGENTMAIL_INBOX_ID: inbox,
    COGNEE_API_KEY: "cognee-test",
    COGNEE_TENANT_ID: tenant,
    GUIDO_MEMORY_SECRET: secret,
    GUILD_API_KEY: "guild-test",
    AMPLITUDE_API_KEY: "amplitude-test",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }

  const histories = new Map();
  const prompts = [];
  const replies = new Map();
  const telemetry = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === "https://api2.amplitude.com/2/httpapi") {
      telemetry.push(await request.json());
      return Response.json({ events_ingested: 2 });
    }
    if (url.hostname === "api.agentmail.to") {
      assert.equal(request.method, "GET");
      assert.equal(request.headers.get("Authorization"), "Bearer agentmail-test");
      return Response.json(messages[url.pathname.split("/").at(-1)]);
    }
    if (url.hostname === `tenant-${tenant}.aws.cognee.ai`) {
      assert.equal(request.headers.get("X-Api-Key"), "cognee-test");
      assert.equal(request.headers.get("X-Tenant-Id"), tenant);
      if (request.method === "GET") {
        const session = histories.get(url.pathname.split("/").at(-1));
        return session
          ? Response.json({ session_id: session.id, qas: session.qas })
          : Response.json({ detail: "Session not found" }, { status: 404 });
      }
      assert.equal(url.pathname, "/api/v1/remember/entry");
      const { dataset_name, session_id, entry } = await request.json();
      assert.equal(dataset_name, "guido_email");
      assert.equal(entry.type, "qa");
      const session = histories.get(session_id) ?? { id: session_id, qas: [] };
      session.qas.push(entry);
      histories.set(session_id, session);
      return Response.json({ status: "session_stored", session_ids: [session_id], entry_type: "qa", entry_id: "entry" });
    }
    assert.equal(url.hostname, "api.guild.ai");
    assert.equal(request.headers.get("Authorization"), "Bearer guild-test");
    if (request.method === "POST") {
      assert.equal(url.pathname, "/v1/workspaces/nirmalhk7~tokensandhackathon/sessions");
      const { agent_id, session_type, initial_prompt } = await request.json();
      assert.equal(agent_id, "nirmalhk7~guido");
      assert.equal(session_type, "chat");
      const input = JSON.parse(initial_prompt);
      prompts.push(input);
      const draft = input.prior_exchanges.some(({ message }) => message.includes("electric cars"))
        ? "You prefer electric cars."
        : "Thanks for your message.";
      const id = String(prompts.length);
      replies.set(id, draft);
      return Response.json({ id }, { status: 201 });
    }
    const id = url.pathname.split("/").at(-2);
    if (id === "5") return Response.json({ items: [{ type: "runtime_error" }] });
    return Response.json({
      items: [{ type: "runtime_done", content: { text: JSON.stringify({ draft: replies.get(id) }) } }],
    });
  });

  assert.equal((await draftGuidoEmail("first")).memory, "saved");
  assert.equal((await draftGuidoEmail("followup")).draft, "You prefer electric cars.");
  assert.equal((await draftGuidoEmail("other")).draft, "Thanks for your message.");
  assert.deepEqual(await draftGuidoEmail("forged"), {
    draft: "Thanks for your message.",
    memory: "skipped",
  });
  assert.equal((await draftGuidoEmail("followup")).draft, "You prefer electric cars.");
  assert.equal(prompts.length, 4, "retry uses saved draft without starting a new Guild session");
  assert.equal(histories.size, 2);
  const aliceSession = "guido-email-" + createHmac("sha256", secret)
    .update(JSON.stringify([inbox, "alice@example.com"])).digest("hex");
  assert.equal(histories.get(aliceSession).qas.length, 2);
  assert.match(histories.get(aliceSession).qas[0].question, /I always rent electric cars/);
  assert.deepEqual(prompts[2].prior_exchanges, []);
  assert.deepEqual(prompts[3].prior_exchanges, []);

  await assert.rejects(draftGuidoEmail("failed"), /Guild did not produce an email draft/);
  assert.equal(telemetry.length, 5, "each new Guild run reports once, including a failed run");
  for (const [i, upload] of telemetry.entries()) {
    assert.equal(upload.api_key, "amplitude-test");
    assert.deepEqual(upload.events.map(({ event_type }) => event_type), ["[Agent] Span", "[Agent] Session End"]);
    for (const item of upload.events) {
      assert.equal(item.event_properties["[Agent] Session ID"], String(i + 1));
      assert.equal(item.event_properties["[Agent] Agent ID"], "guido");
      assert.equal(item.event_properties["[Agent] Output State"], i === 4 ? "failed" : "completed");
    }
    assert.equal(upload.events[0].event_properties["[Agent] Is Error"], i === 4);
  }
  assert.doesNotMatch(JSON.stringify(telemetry), /example\.com|electric cars|Private failed draft|Thanks for your message/);
});
