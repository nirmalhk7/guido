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

export async function getAgentMail<T>(
  options: { messageId?: string; query?: URLSearchParams; signal?: AbortSignal },
): Promise<T> {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  const inboxId = process.env.AGENTMAIL_INBOX_ID?.trim();
  if (!apiKey || !inboxId) {
    throw new Error("Set AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID in .env.local.");
  }

  const { messageId, query, signal } = options;
  if (messageId !== undefined && (!messageId.trim() || messageId === "." || messageId === "..")) {
    throw new Error("Invalid message ID.");
  }

  const url = new URL(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages`,
  );
  if (messageId !== undefined) url.pathname += `/${encodeURIComponent(messageId)}`;
  if (query) url.search = query.toString();

  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`AgentMail request failed (HTTP ${response.status}).`);
  }
  return response.json();
}
