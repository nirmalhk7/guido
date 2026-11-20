export interface MessageSummary {
  message_id: string;
  from: string;
  subject?: string;
  timestamp: string;
  labels: string[];
  preview?: string;
}

export interface MessagePage {
  messages: MessageSummary[];
  next_page_token?: string;
}

export interface Message extends MessageSummary {
  to: string[];
  reply_to?: string[];
  text?: string;
  extracted_text?: string;
}

type MailRequest = { signal?: AbortSignal } & (
  | { messageId?: string; query?: URLSearchParams; reply?: never }
  | { messageId: string; query?: never; reply: { to: string; text: string; idempotencyKey: string } }
);

async function requestAgentMail<T>(options: MailRequest): Promise<T> {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  const inboxId = process.env.AGENTMAIL_INBOX_ID?.trim();
  if (!apiKey || !inboxId) {
    throw new Error("Set AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID in .env.local.");
  }

  const { messageId, query, signal, reply } = options;
  if (messageId !== undefined && (!messageId.trim() || messageId === "." || messageId === "..")) {
    throw new Error("Invalid message ID.");
  }

  const url = new URL(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages`,
  );
  if (messageId !== undefined) url.pathname += `/${encodeURIComponent(messageId)}`;
  if (query) url.search = query.toString();

  const headers = new Headers({ Authorization: `Bearer ${apiKey}`, Accept: "application/json" });
  if (reply) {
    url.pathname += "/reply";
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", reply.idempotencyKey);
  }

  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(url, {
    method: reply ? "POST" : "GET",
    headers,
    body: reply ? JSON.stringify({ to: reply.to, text: reply.text }) : undefined,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`AgentMail request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

export function getAgentMail<T>(options: { messageId?: string; query?: URLSearchParams; signal?: AbortSignal }) {
  return requestAgentMail<T>(options);
}

export function replyAgentMail(options: {
  messageId: string;
  to: string;
  text: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const { messageId, signal, ...reply } = options;
  return requestAgentMail<{ message_id: string; thread_id: string }>({ messageId, signal, reply });
}
