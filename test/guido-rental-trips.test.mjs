import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import singlestore from "singlestore-nodejs/promise";
import { POST } from "../api/agentmail.ts";
import { draftGuidoEmail } from "../lib/guido-email.ts";

test("Guido recalls a SingleStore trip linked from older Cognee history for the verified sender", async (t) => {
  const inbox = "guido@agentmail.to";
  const tenant = "00000000-0000-4000-8000-000000000001";
  const secret = "a".repeat(64);
  const guideId = "6c1f2a9e-3b4d-4e8f-9a7b-1c2d3e4f5a6b";
  const aliceSession = "guido-email-" + createHmac("sha256", secret)
    .update(JSON.stringify([inbox, "alice@example.com"])).digest("hex");
  const trip = {
    pickup_location: "SFO",
    return_location: "SFO",
    pickup_date: "2026-12-08",
    return_date: "2026-12-11",
  };
  const originalEnv = process.env;
  t.after(() => { process.env = originalEnv; });
  process.env = {
    ...originalEnv,
    AGENTMAIL_API_KEY: "agentmail-test",
    AGENTMAIL_INBOX_ID: inbox,
    AGENTMAIL_WEBHOOK_TOKEN: "webhook-test",
    COGNEE_API_KEY: "cognee-test",
    COGNEE_TENANT_ID: tenant,
    GUIDO_MEMORY_SECRET: secret,
    SUPERLINKED_API_KEY: "sie-test",
    STATSIG_SDK_KEY: "statsig-test",
    GUILD_API_KEY: "guild-test",
    SENSO_API_KEY: "senso-test",
    SENSO_CONTENT_IDS: guideId,
    SINGLESTORE_HOST: "test.invalid",
    SINGLESTORE_USER: "test",
    SINGLESTORE_PASSWORD: "test",
    SINGLESTORE_DATABASE: "test",
    SINGLESTORE_CA_FILE: "",
  };

  const trips = new Map();
  t.mock.method(singlestore, "createConnection", async () => ({
    async end() {},
    async query({ sql }) {
      assert.match(sql, /^CREATE TABLE IF NOT EXISTS guido_rental_trips\b/,
        "SingleStore Shared Edition requires a columnstore table");
      assert.match(sql, /PRIMARY KEY \(sender_scope, trip_id\)/);
      return [[]];
    },
    async execute({ sql }, [scope, id, ...values]) {
      if (sql.startsWith("INSERT")) {
        assert.match(sql, /ON DUPLICATE KEY UPDATE/);
        const key = JSON.stringify([scope, id]);
        if (trips.has(key)) return [[]];
        trips.set(key, {
          pickup_location: values[0],
          return_location: values[1],
          pickup_date: values[2],
          return_date: values[3],
        });
        return [[]];
      }
      assert.match(sql, /FROM guido_rental_trips\s+WHERE sender_scope = \? AND trip_id IN \(/);
      return [[id, ...values].flatMap((key) => trips.get(JSON.stringify([scope, key])) ?? [])];
    },
  }));

  const histories = new Map();
  const responses = new Map();
  const prompts = [];
  const guidanceQueries = [];
  let failCogneeWrite = false;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "api.agentmail.to") {
      const id = url.pathname.split("/").at(-1);
      return Response.json({
        message_id: id,
        from: id === "other" ? "bob@example.com" : "alice@example.com",
        labels: ["received"],
        subject: "Rental",
        timestamp: "2026-11-20T20:00:00Z",
        extracted_text: {
          plan: "Plan a rental at SFO December 8–11.",
          followup: "Is that airport rental one we already discussed?",
          other: "Is that airport rental one we already discussed?",
          forged: "Is that airport rental one we already discussed?",
          invalid: "Could we rent a car sometime?",
        }[id],
        authentication_results: { dmarc: "pass", dmarc_domain: "example.com" },
      });
    }
    if (url.hostname === "api.superlinked.com") {
      return Response.json({ answers: {
        rental_needed: { type: "choice", probabilities: { "rental car wanted": 0.9, "no rental request": 0.1 } },
        road_trip_detected: { type: "noul", noul: 0.9 },
      } });
    }
    if (url.hostname === "api.statsig.com") {
      return Response.json({ name: "BROWSERBASE_ENABLED", value: true });
    }
    if (url.hostname === "apiv2.senso.ai") {
      guidanceQueries.push((await request.json()).query);
      return Response.json({ results: [
        { content_id: guideId, title: "Pickup guide", chunk_text: "Check counter hours before pickup." },
      ] });
    }
    if (url.hostname === `tenant-${tenant}.aws.cognee.ai`) {
      if (request.method === "GET") {
        const id = url.pathname.split("/").at(-1);
        return Response.json({ session_id: id, qas: histories.get(id) ?? [] });
      }
      if (failCogneeWrite) return Response.json({}, { status: 503 });
      const { session_id, entry } = await request.json();
      histories.set(session_id, [...(histories.get(session_id) ?? []), entry]);
      return Response.json({ status: "session_stored", entry_id: "entry", session_ids: [session_id] });
    }

    assert.equal(url.hostname, "api.guild.ai");
    if (request.method === "POST") {
      const { initial_prompt } = await request.json();
      const prompt = JSON.parse(initial_prompt);
      prompts.push(prompt);
      let response = { draft: "Which dates and location should I use?" };
      if (prompt.message.startsWith("Plan")) {
        response = { draft: "I can check that SFO rental.", rental_trip: trip };
      } else if (prompt.message.includes("sometime")) {
        response.rental_trip = { ...trip, pickup_date: "2026-02-30" };
      } else if (prompt.prior_rental_trips?.length) {
        response = {
          draft: "Yes, we discussed your December 8–11 SFO rental.",
          rental_trip: { ...trip, pickup_location: " sfo " },
        };
      }
      const id = String(prompts.length);
      responses.set(id, response);
      return Response.json({ id });
    }
    return Response.json({
      items: [{ type: "runtime_done", content: { text: JSON.stringify(responses.get(url.pathname.split("/").at(-2))) } }],
    });
  });

  const deliver = (id, eventType = "message.received") => POST(new Request("https://relay.example/api/agentmail", {
    method: "POST",
    headers: { Authorization: "Bearer webhook-test" },
    body: JSON.stringify({ event_type: eventType, event_id: id, message: { inbox_id: inbox, message_id: id } }),
  }));

  assert.equal((await deliver("plan")).status, 204);
  assert.deepEqual(guidanceQueries, ["Rental car guidance for a road trip, including mileage limits, cross-border rules, and roadside assistance."]);
  assert.deepEqual(prompts[0].senso_context, [{
    content_id: guideId, title: "Pickup guide", text: "Check counter hours before pickup.",
  }]);
  assert.equal(trips.size, 1, "planned rental should be persisted in SingleStore");
  const original = histories.get(aliceSession)[0];
  assert.ok(!Object.hasOwn(JSON.parse(original.question), "senso_context"));
  const otherExchanges = Array.from({ length: 5 }, (_, index) => ({
    question: "Unrelated question",
    answer: "Unrelated answer",
    context: String(index),
  }));
  histories.set(aliceSession, [original, ...otherExchanges]);
  histories.set("guido-email-" + createHmac("sha256", secret)
    .update(JSON.stringify([inbox, "bob@example.com"])).digest("hex"), [original]);

  failCogneeWrite = true;
  assert.equal((await deliver("followup")).status, 502, "failed memory write leaves webhook retryable");
  failCogneeWrite = false;
  assert.equal((await deliver("followup")).status, 204);
  assert.equal((await draftGuidoEmail("followup")).draft, "Yes, we discussed your December 8–11 SFO rental.");
  assert.equal(trips.size, 1, "same itinerary and retry should reuse the row");
  assert.equal(prompts.length, 3, "acknowledged message retry should reuse the draft");
  assert.deepEqual(prompts[1].prior_exchanges, otherExchanges.map(({ question, answer }) => ({
    message: question,
    draft: answer,
  })));
  assert.deepEqual(prompts[1].prior_rental_trips, [trip]);

  assert.equal((await draftGuidoEmail("other")).draft, "Which dates and location should I use?");
  assert.equal((await deliver("forged", "message.received.unauthenticated")).status, 204);
  assert.deepEqual(prompts.at(-1).prior_rental_trips, []);
  await draftGuidoEmail("invalid");
  assert.equal(trips.size, 1, "invalid and unauthenticated plans must not be persisted");
});
