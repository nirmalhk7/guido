import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import singlestore from "singlestore-nodejs/promise";

const route = new URL("../api/gmail.ts", import.meta.url);

async function setup(t, probability, loseSendAcknowledgement = false) {
  const original = process.env;
  process.env = { ...original,
    CRON_SECRET: "cron-secret", GMAIL_CLIENT_ID: "google-client",
    GMAIL_CLIENT_SECRET: "google-secret", GMAIL_REFRESH_TOKEN: "refresh-token",
    GMAIL_ADDRESS: "owner@gmail.com", SUPERLINKED_API_KEY: "sie-test", STATSIG_SDK_KEY: "statsig-test",
    GUILD_API_KEY: "guild-test", AMPLITUDE_API_KEY: "amplitude-test",
    AGENTMAIL_INBOX_ID: "guido@agentmail.to", AGENTMAIL_API_KEY: "agentmail-test",
    SINGLESTORE_HOST: "test.invalid", SINGLESTORE_USER: "test",
    SINGLESTORE_PASSWORD: "test", SINGLESTORE_DATABASE: "test", SINGLESTORE_CA_FILE: "",
  };
  t.after(() => { process.env = original; });
  let checkpoint;
  let lock;
  const calls = [];
  t.mock.method(singlestore, "createConnection", async () => ({
    async end() {},
    async query() { return [[]]; },
    async execute({ sql }, values) {
      if (sql.startsWith("INSERT")) {
        checkpoint ??= values[1];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("SELECT")) return [[{ history_id: checkpoint }]];
      if (sql.includes("SET lease_token = ?")) {
        if (lock) return [{ affectedRows: 0 }];
        lock = values[0];
      } else if (sql.includes("SET history_id = ?")) {
        assert.equal(values.at(-1), lock);
        checkpoint = values[0];
      } else {
        assert.equal(values.at(-1), lock);
        lock = undefined;
      }
      return [{ affectedRows: 1 }];
    },
  }));
  let sent = false;
  let profiles = 0;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(request);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "read-token" });
    if (url.pathname.endsWith("/profile")) return Response.json({ emailAddress: "owner@gmail.com", historyId: profiles++ === 0 ? "100" : "102" });
    if (url.pathname.endsWith("/history")) {
      const starting = url.searchParams.get("startHistoryId");
      assert.match(starting, /^(100|102)$/);
      return Response.json(starting === "100" ? {
        historyId: "102",
        history: [{ id: "101", messagesAdded: [{ message: { id: "m2", threadId: "t1" } }] }],
      } : { historyId: "102" });
    }
    if (url.pathname.endsWith("/threads/t1")) return Response.json({ id: "t1", messages: [
      gmail("m1", "We are flying to SFO December 8.", ["INBOX"]),
      gmail("m2", "Then we need to drive to Yosemite and return December 11.", ["SENT"]),
    ] });
    if (url.hostname === "api.superlinked.com") {
      const { input } = await request.json();
      assert.match(input, /flying to SFO/);
      assert.match(input, /drive to Yosemite/);
      return Response.json({ answers: [{ type: "predicate", name: "rental_needed", probability }] });
    }
    if (url.hostname === "api.statsig.com") return Response.json({ name: "BROWSERBASE_ENABLED", value: true });
    if (url.hostname === "api.guild.ai" && request.method === "POST") {
      const { initial_prompt } = await request.json();
      assert.equal(JSON.parse(initial_prompt).rental_provider, "browserbase");
      assert.equal(JSON.parse(initial_prompt).source, "gmail");
      return Response.json({ id: "guild-1" });
    }
    if (url.hostname === "api.guild.ai") return Response.json({
      items: [{ type: "runtime_done", content: { text: '{"draft":"Hertz has the lowest verified total."}' } }],
    });
    if (url.hostname === "api.agentmail.to" && request.method === "GET") {
      return Response.json({ messages: sent ? [{ message_id: "sent-1" }] : [] });
    }
    if (url.pathname.endsWith("/messages/send")) {
      const body = await request.json();
      assert.deepEqual(body.to, ["owner@gmail.com"]);
      assert.match(body.text, /lowest verified total/);
      assert.ok(body.labels.some((label) => label.startsWith("guido-gmail-")));
      sent = true;
      if (loseSendAcknowledgement) throw new Error("Response connection closed.");
      return Response.json({ message_id: "sent-1", thread_id: "sent-thread" });
    }
    if (url.hostname === "api2.amplitude.com") return Response.json({});
    assert.fail(`Unexpected request: ${url}`);
  });
  assert.ok(existsSync(route), "Guido needs a Gmail monitoring route");
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(config.crons.some(({ path }) => path === "/api/gmail"), "Gmail scanner needs a production schedule");
  const { GET } = await import(route.href);
  return { calls, scan: (secret = "cron-secret") => GET(new Request("https://guido.example/api/gmail", {
    headers: { Authorization: `Bearer ${secret}` },
  })) };
}

function gmail(id, text, labelIds) {
  return {
    id, internalDate: "1795204800000", labelIds,
    payload: { mimeType: "text/plain", body: { data: Buffer.from(text).toString("base64url") },
      headers: [{ name: "Subject", value: "Yosemite trip" }, { name: "From", value: "friend@example.com" }] },
  };
}

test("Gmail classifies new conversations, runs qualifying searches in Guild and emails the watched address once", async (t) => {
  const { scan, calls } = await setup(t, 0.92);
  assert.equal((await scan("wrong")).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await scan()).status, 204);
  assert.equal(calls.length, 2, "initial scan sets a cursor without processing historical mail");
  assert.equal((await scan()).status, 204);
  assert.equal((await scan()).status, 204);
  const send = calls.filter(({ url }) => url.endsWith("/messages/send"));
  assert.equal(send.length, 1);
  const telemetry = calls.find(({ url }) => url === "https://api2.amplitude.com/2/httpapi");
  const { events } = await telemetry.json();
  const spans = events.map(({ event_properties }) => event_properties["[Agent] Span Name"]);
  for (const span of ["gmail.thread_read", "superlinked.rental_decision", "statsig.rental_gate", "guild.draft", "agentmail.send"]) {
    assert.ok(spans.includes(span), `missing span: ${span}`);
  }
  assert.doesNotMatch(JSON.stringify(events), /owner@gmail.com|Yosemite|lowest verified total/);
});

test("Gmail scores at 50% never reach Statsig, Guild, or AgentMail", async (t) => {
  const { scan, calls } = await setup(t, 0.5);
  assert.equal((await scan()).status, 204);
  assert.equal((await scan()).status, 204);
  const hosts = calls.map(({ url }) => new URL(url).hostname);
  assert.ok(hosts.includes("api.superlinked.com"));
  assert.ok(!hosts.some((host) => /statsig|guild\.ai|agentmail\.to/.test(host)));
});

test("a lost AgentMail acknowledgement leaves Gmail retryable and reuses the sent result", async (t) => {
  const { scan, calls } = await setup(t, 0.92, true);
  assert.equal((await scan()).status, 204);
  assert.equal((await scan()).status, 502);
  assert.equal((await scan()).status, 204);
  assert.equal(calls.filter(({ url }) => url.endsWith("/messages/send")).length, 1);
  assert.equal(calls.filter(({ url, method }) => url.includes("api.guild.ai") && method === "POST").length, 1);
});
