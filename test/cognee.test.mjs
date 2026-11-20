import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test, { beforeEach } from "node:test";

const baseUrl = "https://tenant.example.test";
const note = "Guido should use short subject lines.";
const query = "What is my email subject preference?";
const signal = new AbortController().signal;

beforeEach(() => {
  process.env.COGNEE_BASE_URL = baseUrl;
  process.env.COGNEE_API_KEY = "test-key";
  process.env.COGNEE_TENANT_ID = "test-tenant";
  delete process.env.COGNEE_API_TOKEN;
});

async function provider() {
  const file = new URL("../agent/memory/cognee.ts", import.meta.url);
  assert.ok(existsSync(file), "Guido needs a Cognee memory slot");
  return (await import(file.href)).default.provider;
}

function turn(scopeKey, sessionId = "new-conversation") {
  return {
    abortSignal: signal,
    session: { id: sessionId },
    memory: { scope: { key: scopeKey }, slot: "cognee" },
    messages: [{ role: "tool", content: "private mailbox content" }],
    turn: { input: [{ role: "user", content: [{ type: "text", text: query }] }] },
  };
}

test("saves an explicit note and recalls it in a new session in the same scope", async (context) => {
  const memory = await provider();
  const savedNotes = new Map();
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("x-api-key"), "test-key");
    assert.equal(request.headers.get("x-tenant-id"), "test-tenant");
    if (request.url === baseUrl + "/api/v1/remember") {
      const form = await request.formData();
      assert.equal(form.get("raw_data"), note);
      assert.match(form.get("datasetName"), /^guido_memory_[0-9a-f]{64}$/);
      assert.equal(form.get("run_in_background"), "false");
      assert.equal(form.has("session_id"), false);
      savedNotes.set(form.get("datasetName"), form.get("raw_data"));
      return Response.json({ status: "completed", items_processed: 1 });
    }

    assert.equal(request.url, baseUrl + "/api/v1/recall");
    const body = await request.json();
    assert.equal(body.query, query);
    assert.equal(body.search_type, "CHUNKS");
    assert.equal(body.top_k, 5);
    assert.equal(body.datasets.length, 1);
    const saved = savedNotes.get(body.datasets[0]);
    return Response.json(saved ? [{ source: "graph", kind: "chunk", text: saved }] : []);
  });

  const tools = await memory.tools(turn("caller-a", "earlier-conversation"));
  assert.deepEqual(await tools.remember.execute({ note }, { abortSignal: signal }), { saved: true });

  const recalled = await memory.recall["turn.started"](turn("caller-a"));
  assert.match(recalled.messages[0].content, /short subject lines/);

  const otherCaller = await memory.recall["turn.started"](turn("caller-b"));
  assert.doesNotMatch(otherCaller.messages[0].content, /short subject lines/);
});

test("a new Cognee dataset leaves the agent usable", async (context) => {
  const memory = await provider();
  context.mock.method(globalThis, "fetch", async () => Response.json(
    { detail: "Dataset(s) not found: 'guido_memory_...'. [DatasetNotFoundError]" },
    { status: 404 },
  ));

  const result = await memory.recall["turn.started"](turn("caller-a"));
  assert.match(result.messages[0].content, /No relevant Cognee memories/);
});

test("a recall outage leaves the agent usable and visible to the model", async (context) => {
  const memory = await provider();
  context.mock.method(globalThis, "fetch", async () => new Response("internal data", { status: 503 }));

  const result = await memory.recall["turn.started"](turn("caller-a"));
  assert.equal(result.messages[0].content, "Cognee memory recall is unavailable for this turn.");
});

test("an incomplete write cannot be reported as saved", async (context) => {
  const memory = await provider();
  context.mock.method(globalThis, "fetch", async () => Response.json({ status: "started", items_processed: 0 }));
  const tools = await memory.tools(turn("caller-a"));

  await assert.rejects(tools.remember.execute({ note }, { abortSignal: signal }), /did not confirm/);
});

test("no configuration means no memory traffic and no save tool", async (context) => {
  delete process.env.COGNEE_BASE_URL;
  const memory = await provider();
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json([]));

  assert.equal(await memory.tools(turn("caller-a")), null);
  assert.equal(await memory.recall["turn.started"](turn("caller-a")), null);
  assert.equal(fetch.mock.callCount(), 0);
});
