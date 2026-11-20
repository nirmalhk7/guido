import { createHash, timingSafeEqual } from "node:crypto";
import { getAgentMail, type Message } from "../lib/agentmail.ts";
import { observeGuildRun } from "../lib/amplitude.ts";
import { draftGuidoEmail } from "../lib/guido-email.ts";

const guildSessions = "https://api.guild.ai/v1/workspaces/nirmalhk7/tokensandhackathon/sessions";
const digest = (value: string) => createHash("sha256").update(value).digest();
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

type AgentMailEvent = {
  event_type?: unknown;
  event_id?: unknown;
  message?: { inbox_id?: unknown; message_id?: unknown };
};

export async function POST(request: Request): Promise<Response> {
  const token = process.env.AGENTMAIL_WEBHOOK_TOKEN?.trim();
  const inbox = process.env.AGENTMAIL_INBOX_ID?.trim();
  const guildKey = process.env.GUILD_TRIGGER_KEY?.trim() ?? "";
  const useMemory = process.env.GUILD_API_KEY?.trim() && process.env.GUIDO_MEMORY_SECRET?.trim();
  if (!token || !inbox || (!useMemory && !guildKey)) return new Response(null, { status: 503 });

  const authorization = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(authorization), digest(`Bearer ${token}`))) {
    return new Response(null, { status: 401 });
  }

  let event: AgentMailEvent | null;
  try {
    event = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!nonempty(event?.event_type)) return new Response(null, { status: 400 });
  if (event.event_type !== "message.received" && event.event_type !== "message.received.unauthenticated") {
    return new Response(null, { status: 204 });
  }

  const { inbox_id: inboxId, message_id: messageId } = event.message ?? {};
  if (!nonempty(inboxId) || !nonempty(messageId) || !nonempty(event.event_id)) {
    return new Response(null, { status: 400 });
  }
  if (inboxId !== inbox) return new Response(null, { status: 204 });

  try {
    if (useMemory) {
      await draftGuidoEmail(messageId, {
        eventId: event.event_id,
        unauthenticated: event.event_type === "message.received.unauthenticated",
      });
      return new Response(null, { status: 204 });
    }

    const signal = AbortSignal.timeout(12_000);
    const mail = await getAgentMail<Message & { extracted_html?: string; html?: string }>({ messageId, signal });
    if (mail.message_id !== messageId) return new Response(null, { status: 502 });

    const email = {
      subject: mail.subject ?? "",
      message: mail.extracted_text?.trim() || mail.text?.trim()
        || mail.extracted_html?.trim() || mail.html?.trim() || "",
      sent_at: mail.timestamp,
      agentmail_event_id: event.event_id,
    };
    await observeGuildRun("trigger", async (identify) => {
      const response = await fetch(guildSessions, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(guildKey).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_type: "api_trigger", agent_input: { text: JSON.stringify(email) } }),
        redirect: "error",
        signal,
      });
      if (response.status !== 201) throw new Error("Guild declined the API trigger.");
      const session = await response.json();
      if (!nonempty(session?.id)) throw new Error("Guild did not return a session ID.");
      identify(session.id);
    });
    return new Response(null, { status: 204 });
  } catch {
    // A non-2xx response tells AgentMail to retry the delivery.
  }
  return new Response(null, { status: 502 });
}
