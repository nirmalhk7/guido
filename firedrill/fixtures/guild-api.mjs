import assert from "node:assert/strict";

const session = "01890000-0000-7000-8000-000000000001";
const userEvent = "01890000-0000-7000-8000-000000000003";
const sessionPath = `/v1/sessions/${session}/events`;
let reads = 0;
let chatCreated = false;
let followUpSent = false;
let firstPoll = true;

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  switch (url.href) {
    case "http://127.0.0.1:8001/test-key/slack/v1/invoke":
      assert.equal(request.method, "POST");
      assert.deepEqual(await request.json(), {
        operation: "conversations.history", arguments: { channel: "C01GENERAL1", limit: 5 },
      });
      reads++;
      return Response.json({ ok: true, messages: [{ text: "SLACK-482" }] });
    case "http://127.0.0.1:8001/test-key/discord/v1/invoke":
      assert.equal(request.method, "POST");
      assert.deepEqual(await request.json(), {
        operation: "messages.list", arguments: { channel_id: "147000000000000001", limit: 5 },
      });
      reads++;
      return Response.json({ messages: [{ content: "DISCORD-953" }] });
  }

  assert.equal(url.origin, "https://api.guild.ai");
  assert.equal(request.headers.get("authorization"), "Bearer test-id:test-secret");
  if (url.pathname === "/v1/workspaces/nirmalhk7%7Etokensandhackathon/sessions" ||
      url.pathname === "/v1/workspaces/nirmalhk7~tokensandhackathon/sessions") {
    assert.equal(request.method, "POST");
    assert.equal(reads, 2);
    assert.equal(chatCreated, false);
    chatCreated = true;
    const body = await request.json();
    assert.equal(body.session_type, "chat");
    assert.equal(body.agent_id, "guido-smoke");
    assert.match(body.initial_prompt, /Summarize the simulated channels/);
    assert.match(body.initial_prompt, /SLACK-482/);
    assert.match(body.initial_prompt, /DISCORD-953/);
    assert.doesNotMatch(body.initial_prompt, /test-key|test-secret/);
    return Response.json({ id: session }, { status: 201 });
  }

  assert.equal(url.pathname, sessionPath);
  assert.equal(chatCreated, true);
  if (request.method === "POST") {
    assert.equal(followUpSent, false);
    assert.deepEqual(await request.json(), { mode: "text", content: "Which channel had the deadline?" });
    followUpSent = true;
    return Response.json({ id: userEvent, type: "user_message" }, { status: 201 });
  }

  assert.equal(request.method, "GET");
  assert.equal(url.searchParams.get("from_id"), followUpSent ? userEvent : null);
  if (firstPoll) {
    firstPoll = false;
    return Response.json({ items: [] });
  }
  return Response.json({ items: [{
    type: "runtime_done",
    content: { text: followUpSent ? "Discord." : "Slack: SLACK-482. Discord: DISCORD-953." },
  }] });
};
