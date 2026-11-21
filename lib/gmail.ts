import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "singlestore-nodejs/promise";
import { z } from "zod";
import { getAgentMail, sendAgentMail, sendAgentMailHtml, type MessagePage } from "./agentmail.ts";
import { buildHtmlEmail, htmlEmailEnabled } from "./html-email.ts";
import { observeAgentRun } from "./amplitude.ts";
import { guildDraft } from "./guido-email.ts";
import { decideTravel } from "./rental-decision.ts";
import { queryTimeout, withSingleStore } from "./singlestore.ts";

const historyId = z.string().regex(/^\d+$/);
const gmailId = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const profileSchema = z.object({ emailAddress: z.email(), historyId });
const historySchema = z.object({
  historyId,
  nextPageToken: z.string().optional(),
  history: z.array(z.object({
    id: historyId,
    messagesAdded: z.array(z.object({ message: z.object({ id: gmailId, threadId: gmailId }) })).default([]),
  })).default([]),
});

type Part = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: Part[] };
type GmailMessage = {
  id: string;
  internalDate: string;
  labelIds?: string[];
  snippet?: string;
  payload?: Part & { headers?: { name: string; value: string }[] };
};

function textParts(part?: Part): string[] {
  if (!part || part.filename) return [];
  if (part.mimeType === "text/plain" && part.body?.data) {
    return [Buffer.from(part.body.data, "base64url").toString("utf8").trim()];
  }
  return (part.parts ?? []).flatMap(textParts);
}

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
}

function isRelevant(message: GmailMessage, agentInbox: string) {
  const from = header(message, "from").trim().toLowerCase();
  const mailbox = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  const labels = message.labelIds ?? [];
  return mailbox !== agentInbox && !labels.some((label) => ["TRASH", "SPAM", "DRAFT"].includes(label));
}

function setting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing Gmail workflow setting: ${name}.`);
  return value;
}

async function gmailClient() {
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: setting("GMAIL_CLIENT_ID"), client_secret: setting("GMAIL_CLIENT_SECRET"),
      refresh_token: setting("GMAIL_REFRESH_TOKEN"), grant_type: "refresh_token",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!token.ok) throw new Error(`Gmail OAuth refresh failed (HTTP ${token.status}).`);
  const { access_token: accessToken } = z.object({ access_token: z.string().min(1) }).parse(await token.json());
  return async <T>(path: string): Promise<T | undefined> => {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Gmail request failed (HTTP ${response.status}).`);
    return response.json();
  };
}

export async function scanGmailTrips() {
  const started = Date.now();
  const address = z.email().parse(setting("GMAIL_ADDRESS")).toLowerCase();
  const inbox = setting("AGENTMAIL_INBOX_ID").toLowerCase();
  const gmail = await gmailClient();
  const profile = profileSchema.parse(await gmail("profile"));
  if (profile.emailAddress.toLowerCase() !== address) throw new Error("OAuth mailbox does not match GMAIL_ADDRESS.");

  const mailbox = createHash("sha256").update(address).digest("hex");
  const lease = randomUUID();
  await withSingleStore(async (connection) => {
    const execute = <T extends ResultSetHeader | RowDataPacket[]>(sql: string, values: string[]) =>
      connection.execute<T>({ sql, timeout: queryTimeout }, values);
    await connection.query({ sql: `CREATE TABLE IF NOT EXISTS guido_gmail_cursor (
      mailbox CHAR(64) PRIMARY KEY,
      history_id VARCHAR(32) NOT NULL,
      lease_token CHAR(36),
      lease_until DATETIME(6),
      SORT KEY (mailbox)
    )`, timeout: queryTimeout });
    await execute(`INSERT INTO guido_gmail_cursor (mailbox, history_id) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE mailbox = mailbox`, [mailbox, profile.historyId]);
    const [claimed] = await execute<ResultSetHeader>(`UPDATE guido_gmail_cursor
      SET lease_token = ?, lease_until = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 10 MINUTE)
      WHERE mailbox = ? AND (lease_until IS NULL OR lease_until < UTC_TIMESTAMP(6))`, [lease, mailbox]);
    if (!claimed.affectedRows) return;

    const advance = async (history: string) => {
      const [saved] = await execute<ResultSetHeader>(`UPDATE guido_gmail_cursor SET history_id = ?
        WHERE mailbox = ? AND lease_token = ?`, [history, mailbox, lease]);
      if (!saved.affectedRows) throw new Error("Gmail history lease no longer held.");
    };
    try {
      const [[row]] = await execute<(RowDataPacket & { history_id: string })[]>(
        "SELECT history_id FROM guido_gmail_cursor WHERE mailbox = ?", [mailbox]);
      let cursor = historyId.parse(row?.history_id);
      while (BigInt(cursor) < BigInt(profile.historyId) && Date.now() - started < 110_000) {
        const query = new URLSearchParams({ startHistoryId: cursor, historyTypes: "messageAdded", maxResults: "1" });
        const raw = await gmail(`history?${query}`);
        if (!raw) throw new Error("Gmail history expired. Review missed mail before resetting the checkpoint.");
        const page = historySchema.parse(raw);
        for (const change of page.history) {
          const threads = new Map<string, Set<string>>();
          for (const { message: { threadId, id } } of change.messagesAdded) {
            const messages = threads.get(threadId) ?? new Set<string>();
            messages.add(id);
            threads.set(threadId, messages);
          }
          const results = await Promise.allSettled([...threads].map(([thread, ids]) => processThread(thread, ids)));
          const failed = results.find((result) => result.status === "rejected");
          if (failed) throw failed.reason;
          await advance(change.id);
          cursor = change.id;
        }
        if (!page.nextPageToken) {
          if (BigInt(page.historyId) > BigInt(cursor)) await advance(page.historyId);
          break;
        }
        if (!page.history.length) throw new Error("Gmail returned a history page without a checkpoint.");
      }
    } finally {
      await execute("UPDATE guido_gmail_cursor SET lease_token = NULL, lease_until = NULL WHERE mailbox = ? AND lease_token = ?", [mailbox, lease]);
    }
  });

  function processThread(thread: string, messageIds: Set<string>) {
    return observeAgentRun("gmail", async (trace) => {
      const result = await trace.span("gmail.thread_read", () => gmail<{ messages?: GmailMessage[] }>(`threads/${thread}?format=full`));
      const messages = result?.messages ?? [];
      for (const message of messages) {
        if (messageIds.has(message.id) && isRelevant(message, inbox) && !message.labelIds?.includes("SENT")) {
          trace.mark("email.received");
        }
      }
      const messageId = [...messageIds].at(-1);
      const index = messages.findIndex(({ id }) => id === messageId);
      if (index < 0 || !isRelevant(messages[index], inbox)) {
        trace.finish("skipped");
        return;
      }
      const recent = messages.slice(0, index + 1).filter((message) => isRelevant(message, inbox)).slice(-5);
      const email = {
        subject: header(messages[index], "subject"),
        message: recent.map((message) => (textParts(message.payload).join("\n") || message.snippet || "").slice(-1_200)).join("\n\n"),
        sent_at: new Date(Number(messages[index].internalDate)).toISOString(),
        source: "gmail" as const,
      };
      const travel = await decideTravel(email, trace);
      const { route } = travel;
      if (route === "skip") {
        trace.finish("skipped");
        return;
      }

      const label = "guido-gmail-" + createHash("sha256").update(JSON.stringify([mailbox, thread, messageId])).digest("hex");
      const sent = await trace.span("agentmail.delivery_lookup", () =>
        getAgentMail<MessagePage>({ query: new URLSearchParams({ labels: label, limit: "1" }) }));
      if (sent.messages.length) return;
      const { draft, email: blanks } = await guildDraft({ ...email, rental_provider: route }, [], [], trace, travel);
      // Optional designed HTML version (off by default). Any problem → the plain-text send below.
      if (htmlEmailEnabled()) {
        const html = buildHtmlEmail(blanks, inbox);
        if (html) {
          const sentHtml = await trace.span("agentmail.send_html", async () =>
            (await sendAgentMailHtml(address, "Guido rental-car options", draft, html, label)).message_id)
            .catch(() => undefined);
          if (sentHtml) return;
        }
      }
      await trace.span("agentmail.send", async () => {
        const delivery = await sendAgentMail(address, "Guido rental-car options", draft, label);
        if (!delivery.message_id) throw new Error("AgentMail did not confirm delivery.");
      });
    });
  }
}
