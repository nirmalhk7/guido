import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test, { beforeEach } from "node:test";

const inbox = "guido@example.com";
const id = "<notice/123@example.net>";
const baseUrl = "https://api.agentmail.to/v0/inboxes/guido%40example.com/messages";
const message = {
  inbox_id: inbox,
  message_id: id,
  thread_id: "thread_123",
  labels: ["received"],
  timestamp: "2026-11-20T17:00:00Z",
  from: "Harper <harper@example.net>",
  to: [inbox],
  size: 250,
  updated_at: "2026-11-20T17:00:00Z",
  created_at: "2026-11-20T17:00:00Z",
  subject: "Updated agenda",
  preview: "The meeting moved.",
};

beforeEach(() => {
  process.env.AGENTMAIL_API_KEY = "test-key";
  process.env.AGENTMAIL_INBOX_ID = inbox;
});

async function loadTool(name) {
  const file = new URL(`../agent/tools/${name}.ts`, import.meta.url);
  assert.ok(existsSync(file), `Guido needs the ${name} tool`);
  return (await import(file.href)).default;
}

test("lists and paginates messages in the configured inbox", async (context) => {
  const tool = await loadTool("list_messages");
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), "Bearer test-key");
    assert.equal(url.origin + url.pathname, baseUrl);
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("page_token"), "page+2");
    return Response.json({ count: 1, messages: [message], next_page_token: "page+3" });
  });

  assert.deepEqual(await tool.execute({ limit: 10, pageToken: "page+2" }, {}), {
    messages: [{
      messageId: id,
      from: "Harper <harper@example.net>",
      subject: "Updated agenda",
      timestamp: "2026-11-20T17:00:00Z",
      labels: ["received"],
      preview: "The meeting moved.",
    }],
    nextPageToken: "page+3",
  });
});

test("opens a message by its encoded ID and exposes only plain text", async (context) => {
  const tool = await loadTool("read_message");
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), "Bearer test-key");
    assert.equal(request.url, baseUrl + "/%3Cnotice%2F123%40example.net%3E");
    return Response.json({
      ...message,
      text: "The new time is 3 pm.\n> Previous email",
      extracted_text: "The new time is 3 pm.",
      html: '<img src="https://example.net/pixel">',
      reply_to: ["events@example.net"],
    });
  });

  assert.deepEqual(await tool.execute({ messageId: id }, {}), {
    messageId: id,
    from: "Harper <harper@example.net>",
    to: [inbox],
    replyTo: ["events@example.net"],
    subject: "Updated agenda",
    timestamp: "2026-11-20T17:00:00Z",
    text: "The new time is 3 pm.",
    truncated: false,
  });
});

test("rejects path traversal IDs before making a request", async (context) => {
  const tool = await loadTool("read_message");
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(tool.execute({ messageId: ".." }, {}), /Invalid message ID/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("reports missing inbox configuration before making a request", async (context) => {
  delete process.env.AGENTMAIL_INBOX_ID;
  const tool = await loadTool("list_messages");
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(tool.execute({}, {}), /AGENTMAIL_INBOX_ID/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("reports AgentMail HTTP failures without exposing upstream response bodies", async (context) => {
  const tool = await loadTool("list_messages");
  context.mock.method(globalThis, "fetch", async () => new Response("private data", { status: 401 }));
  await assert.rejects(tool.execute({}, {}), { message: "AgentMail request failed (HTTP 401)." });
});
