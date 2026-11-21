import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { getAgentMail, type Message } from "./agentmail.ts";
import { observeGuildRun, type AgentTrace } from "./amplitude.ts";
import { decideTravel, type RentalRoute } from "./rental-decision.ts";
import { loadRentalTrips, rentalTrip, saveRentalTrip } from "./rental-trips.ts";
import { rentalGuidance } from "./senso.ts";

const guildHost = "https://api.guild.ai/v1";
const workspace = "nirmalhk7~tokensandhackathon";
const agentId = "nirmalhk7~guido";

function setting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env.local.`);
  return value;
}

type EmailInput = {
  subject: string;
  message: string;
  sent_at: string;
  agentmail_event_id?: string;
  rental_provider?: Exclude<RentalRoute, "skip">;
  source?: "gmail";
};
type WebhookDelivery = { eventId: string; unauthenticated: boolean; trace: AgentTrace };
type Exchange = { question: string; answer: string; context: string };
type DraftResult = { draft: string; memory: "saved" | "skipped" };
const tripContext = /^[a-f0-9]{64}:trip:([a-f0-9]{64})$/;

function verifiedSender(message: Message): string | undefined {
  if (message.labels.includes("unauthenticated") || message.authentication_results?.dmarc !== "pass") {
    return;
  }
  const from = message.from.trim();
  const address = (from.match(/^[^<>]*<([^<>]+)>$/)?.[1] ?? from).trim();
  const mailbox = address.match(/^([\w!#$%&'*+\-/=?^`{|}~]+(?:\.[\w!#$%&'*+\-/=?^`{|}~]+)*)@([a-z0-9]+(?:[.-][a-z0-9]+)+)$/i);
  if (!mailbox) return;
  const domain = mailbox[2].toLowerCase();
  if (message.authentication_results.dmarc_domain?.toLowerCase() === domain) {
    return `${mailbox[1]}@${domain}`;
  }
}

function cogneeClient() {
  const tenant = setting("COGNEE_TENANT_ID");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenant)) {
    throw new Error("COGNEE_TENANT_ID must be a UUID.");
  }
  const headers = { "X-Api-Key": setting("COGNEE_API_KEY"), "X-Tenant-Id": tenant };
  return (path: string, body?: object) => fetch(`https://tenant-${tenant}.aws.cognee.ai/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
}

export async function guildDraft(
  email: EmailInput,
  priorExchanges: { message: string; draft: string }[],
  priorRentalTrips: Awaited<ReturnType<typeof loadRentalTrips>> = [],
  trace?: AgentTrace,
  travel?: { roadTrip: boolean },
) {
  const headers = { Authorization: `Bearer ${setting("GUILD_API_KEY")}`, "Content-Type": "application/json" };
  const sensoContext = email.rental_provider ? await rentalGuidance(travel?.roadTrip ?? false, trace) : undefined;
  const signal = AbortSignal.timeout(300_000);
  async function guild<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(guildHost + path, {
      method: body ? "POST" : "GET",
      headers,
      body: body && JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error(`Guild request failed (HTTP ${response.status}).`);
    return response.json();
  }

  const run = async (identify: (id: string) => void) => {
    const { id } = await guild<{ id: string }>(`/workspaces/${workspace}/sessions`, {
      agent_id: agentId,
      session_type: "chat",
      initial_prompt: JSON.stringify({
        ...email,
        rental_trace_id: trace?.id,
        prior_exchanges: priorExchanges,
        prior_rental_trips: priorRentalTrips,
        senso_context: sensoContext,
      }),
    });
    if (typeof id !== "string" || !id) throw new Error("Guild did not return a session ID.");
    identify(id);
    const events = `/sessions/${encodeURIComponent(id)}/events?types=runtime_done,runtime_error,interrupted`;
    while (true) {
      const { items } = await guild<{ items: { type: string; content?: { text?: string } }[] }>(events);
      const terminal = items[0];
      if (terminal) {
        const text = terminal.content?.text?.trim();
        if (terminal.type !== "runtime_done" || !text) throw new Error("Guild did not produce an email draft.");
        let draft: string;
        let trip: unknown;
        let emailBlanks: unknown;
        try {
          const output = JSON.parse(text);
          draft = output.draft?.trim() ?? "";
          trip = output.rental_trip;
          emailBlanks = output.email;
        } catch (error) {
          if (!(error instanceof SyntaxError) || /^[{`]/.test(text)) throw error;
          draft = text;
        }
        if (!draft) throw new Error("Guild returned an empty email draft.");
        return { draft, trip: rentalTrip.safeParse(trip).data, email: emailBlanks };
      }
      await delay(1_000, undefined, { signal });
    }
  };
  return trace ? trace.span("guild.draft", () => run(trace.identifyGuild)) : observeGuildRun("draft", run);
}

function historyInput(exchanges: Exchange[]) {
  return exchanges.slice(-5).map(({ question, answer }) => ({ message: question, draft: answer }));
}

const inFlight = new Map<string, Promise<DraftResult>>();

export async function draftGuidoEmail(messageId: string, delivery?: WebhookDelivery): Promise<DraftResult> {
  const inbox = setting("AGENTMAIL_INBOX_ID");
  const pendingKey = JSON.stringify([inbox, messageId, delivery?.unauthenticated]);
  const pending = inFlight.get(pendingKey);
  if (pending) return pending;

  const work = draftFromInbox(inbox, messageId, delivery);
  inFlight.set(pendingKey, work);
  try {
    return await work;
  } finally {
    inFlight.delete(pendingKey);
  }
}

async function draftFromInbox(inbox: string, messageId: string, delivery?: WebhookDelivery): Promise<DraftResult> {
  const fetchMessage = () => getAgentMail<Message & { extracted_html?: string; html?: string }>({ messageId });
  const trace = delivery?.trace;
  const message = trace ? await trace.span("agentmail.message_read", fetchMessage) : await fetchMessage();
  if (message.message_id !== messageId || !message.labels.includes("received")) {
    throw new Error("AgentMail did not return the requested inbound message.");
  }
  const email: EmailInput = {
    subject: message.subject ?? "",
    message: message.extracted_text?.trim() || message.text?.trim()
      || (delivery && (message.extracted_html?.trim() || message.html?.trim())) || "",
    sent_at: message.timestamp,
    agentmail_event_id: delivery?.eventId,
  };
  if (!email.message) throw new Error("The incoming email has no plain-text body.");

  const travel = trace ? await decideTravel(email, trace) : undefined;
  if (travel) {
    if (travel.route === "skip") {
      trace?.finish("skipped");
      return { draft: "", memory: "skipped" };
    }
    email.rental_provider = travel.route;
  }

  const sender = delivery?.unauthenticated ? undefined : verifiedSender(message);
  if (!sender) {
    const { draft } = await guildDraft(email, [], [], trace, travel);
    return { draft, memory: "skipped" };
  }

  const secret = setting("GUIDO_MEMORY_SECRET");
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error("GUIDO_MEMORY_SECRET must be 32 bytes in hex.");
  const digest = (parts: string[]) => createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");
  const senderScope = digest([inbox, sender]);
  const sessionId = "guido-email-" + senderScope;
  const messageKey = digest([sessionId, messageId]);
  const cognee = cogneeClient();

  const readHistory = () => cognee(`/sessions/${sessionId}`);
  const history = trace ? await trace.span("cognee.history", readHistory) : await readHistory();
  let qas: Exchange[] = [];
  if (history.ok) {
    const data = await history.json();
    if (data.session_id !== sessionId || !Array.isArray(data.qas)) {
      throw new Error("Cognee returned unexpected session data.");
    }
    qas = data.qas;
  } else if (history.status !== 404) {
    throw new Error(`Cognee session lookup failed (HTTP ${history.status}).`);
  }

  const existing = qas.find(({ context }) => context === messageKey ||
    (tripContext.test(context) && context.startsWith(messageKey + ":trip:")));
  if (existing) return { draft: existing.answer, memory: "saved" };

  const tripIds = new Set<string>();
  for (const { context } of qas) {
    const match = tripContext.exec(context);
    if (match) tripIds.add(match[1]);
  }
  const recallTrips = () => loadRentalTrips(senderScope, [...tripIds]);
  const priorTrips = trace && tripIds.size ? await trace.span("singlestore.trip_recall", recallTrips) : await recallTrips();
  const { draft, trip } = await guildDraft(email, historyInput(qas), priorTrips, trace, travel);
  let context = messageKey;
  if (trip) {
    const saveTrip = () => saveRentalTrip(senderScope, trip);
    const tripId = trace ? await trace.span("singlestore.trip_save", saveTrip) : await saveTrip();
    context += `:trip:${tripId}`;
  }
  const saveMemory = async () => {
    const saved = await cognee("/remember/entry", {
      dataset_name: "guido_email",
      session_id: sessionId,
      entry: { type: "qa", question: JSON.stringify(email), answer: draft, context },
    });
    if (!saved.ok) throw new Error(`Cognee session write failed (HTTP ${saved.status}).`);
    const result = await saved.json();
    if (result.status !== "session_stored" || !result.entry_id ||
        !Array.isArray(result.session_ids) || !result.session_ids.includes(sessionId)) {
      throw new Error("Cognee did not confirm the write.");
    }
  };
  if (trace) await trace.span("cognee.remember", saveMemory);
  else await saveMemory();
  return { draft, memory: "saved" };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const messageId = process.argv[2];
  if (!messageId?.trim()) throw new Error("Provide an AgentMail message ID.");
  console.log(JSON.stringify(await draftGuidoEmail(messageId)));
}
