import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentMail, type MessagePage } from "../../lib/agentmail.ts";

export default defineTool({
  description: "List recent messages in Guido's AgentMail inbox, newest first. Use nextPageToken to continue.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(25).optional(),
    pageToken: z.string().min(1).optional(),
  }),
  async execute({ limit = 10, pageToken }, { abortSignal }) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (pageToken) query.set("page_token", pageToken);
    const page = await getAgentMail<MessagePage>({ query, signal: abortSignal });

    return {
      messages: page.messages.map((message) => ({
        messageId: message.message_id,
        from: message.from,
        subject: message.subject ?? null,
        timestamp: message.timestamp,
        labels: message.labels,
        preview: message.preview ?? null,
      })),
      nextPageToken: page.next_page_token ?? null,
    };
  },
});
