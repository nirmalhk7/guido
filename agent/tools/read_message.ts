import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentMail, type Message } from "../../lib/agentmail.ts";

const MAX_TEXT_LENGTH = 20_000;

export default defineTool({
  description: "Read a message's plain text from Guido's AgentMail inbox using its messageId from list_messages.",
  inputSchema: z.object({ messageId: z.string().trim().min(1) }),
  async execute({ messageId }, { abortSignal }) {
    const message = await getAgentMail<Message>({ messageId, signal: abortSignal });
    const text = message.extracted_text || message.text || null;

    return {
      messageId: message.message_id,
      from: message.from,
      to: message.to,
      replyTo: message.reply_to ?? [],
      subject: message.subject ?? null,
      timestamp: message.timestamp,
      text: text?.slice(0, MAX_TEXT_LENGTH) ?? null,
      truncated: text !== null && text.length > MAX_TEXT_LENGTH,
    };
  },
});
