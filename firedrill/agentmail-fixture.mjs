const fetchOutsideFixture = globalThis.fetch;
const inbox = "guido@fixture.invalid";
const message = {
  inbox_id: inbox,
  message_id: "<briefing@fixture.invalid>",
  thread_id: "thread-briefing",
  from: "Harper <harper@fixture.invalid>",
  to: [inbox],
  labels: ["received"],
  subject: "Thursday briefing",
  preview: "Can you confirm receipt of the briefing details?",
  timestamp: "2026-11-20T17:00:00Z",
  created_at: "2026-11-20T17:00:00Z",
  updated_at: "2026-11-20T17:00:00Z",
  size: 140,
};
const messagesPath = `/v0/inboxes/${encodeURIComponent(inbox)}/messages`;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "api.agentmail.to") return fetchOutsideFixture(input, init);

  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method !== "GET") return Promise.resolve(new Response(null, { status: 405 }));
  if (url.pathname === messagesPath) {
    return Promise.resolve(Response.json({ count: 1, messages: [message] }));
  }
  if (url.pathname === `${messagesPath}/${encodeURIComponent(message.message_id)}`) {
    return Promise.resolve(Response.json({
      ...message,
      text: "Please confirm you received briefing reference CEDAR-482 for Thursday at 3 pm.",
    }));
  }
  return Promise.resolve(new Response(null, { status: 404 }));
};
