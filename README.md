# Guido

Guido reads incoming AgentMail messages and recent Gmail conversations, then
uses [Superlinked Decisions](https://superlinked.com/docs/migrate/openai-decisions)
to score whether the trip needs a rental car. Scores of 50% or less stop
before Guild starts and produce no reply. Higher scores check the
`BROWSERBASE_ENABLED` Statsig gate and start Guido in Guild using the selected
rental provider.

## Deploy Guido

Guild runs the drafting agent. You can host the AgentMail webhook, Gmail
scanner, and rental gateway on Vercel or on your own Node.js host. Both options
use the same [environment settings](.env.example) and need a public HTTPS
origin for AgentMail and Guild to call.

If you install Guido in your own Guild workspace, update the workspace in
[`api/agentmail.ts`](api/agentmail.ts) for trigger mode and the workspace
and agent IDs in [`lib/guido-email.ts`](lib/guido-email.ts) for runs that
wait for a draft. Use Guild credentials for that installation.

### Vercel

Import the repository, select Node.js 24, and set the environment variables for
the features you enable. Vercel serves the [Node.js API handlers](https://vercel.com/docs/functions/runtimes/node-js)
from `api/`. [`vercel.json`](vercel.json) schedules Gmail scans every five
minutes and sets a 450-second function limit for the scan. Use a plan that
supports both settings. Set `CRON_SECRET` when enabling Gmail monitoring.

### Self-host on Node.js

Use Node.js 24 or later on a VM, container, or app host. From the repository
root, save this example as `server.mjs`. It passes incoming requests to the
existing handlers and forwards their status, headers, and body.

```js
import { createServer } from "node:http";
import { POST as receiveMail } from "./api/agentmail.ts";
import { GET as pollRental, POST as startRental } from "./api/browserbase.ts";
import { GET as scanGmail } from "./api/gmail.ts";

const routes = new Map([
  ["POST /api/agentmail", receiveMail],
  ["GET /api/browserbase", pollRental],
  ["POST /api/browserbase", startRental],
  ["GET /api/gmail", scanGmail],
]);

const port = Number(process.env.PORT ?? 3000);

createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://localhost:${port}`);
    const handler = routes.get(`${incoming.method} ${url.pathname}`);
    if (!handler) {
      outgoing.writeHead(404).end();
      return;
    }

    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === "POST" && { body: incoming, duplex: "half" }),
    });
    const response = await handler(request);
    const body = Buffer.from(await response.arrayBuffer());
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(body);
  } catch {
    outgoing.writeHead(500).end();
  }
}).listen(port, "0.0.0.0");
```

Install dependencies and run the server with the settings for your enabled
features. Copy `.env.example` to `.env.local` and fill in those settings, or
inject them through your host's environment and run `node server.mjs`.

```sh
npm ci --omit=dev
node --env-file=.env.local server.mjs
```

Point your host's HTTPS ingress or reverse proxy at `PORT` (default `3000`).
Preserve request headers and query strings. Set request timeouts for the
webhook and scanner to allow several minutes when waiting for Guild, whose
draft call alone can take up to five minutes.

Register AgentMail's webhook at `https://YOUR_HOST/api/agentmail` and generate
the Guild rental integration with the same HTTPS origin using the instructions
below. If you enable Gmail monitoring, use your host's scheduler to run this
request every five minutes with `CRON_SECRET` in the scheduler's environment.
Allow only one scan at a time per mailbox.

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://YOUR_HOST/api/gmail
```

## Incoming mail

Register `POST /api/agentmail` for AgentMail's `message.received` and
`message.received.unauthenticated` events. Set `AGENTMAIL_INBOX_ID`,
`AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_TOKEN`, and `SUPERLINKED_API_KEY`.
The AgentMail key needs access to read messages in Guido's inbox, including
unauthenticated mail. AgentMail sends the webhook token as a bearer token.

Set `GUILD_API_KEY` and `GUIDO_MEMORY_SECRET` with the Cognee and SingleStore
settings to wait for the draft and record memory for verified senders.
With just `GUILD_TRIGGER_KEY`, the relay acknowledges after Guild accepts
the run. Drafts appear in Guild session history. A retry in trigger mode
can create another Guild session for the same AgentMail event.

## Gmail monitoring

The scheduler calls `GET /api/gmail` with `Authorization: Bearer <CRON_SECRET>`.
Set `CRON_SECRET`, `GMAIL_ADDRESS`, and the `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` for that mailbox. Enable
the Gmail API and grant offline access with the
[`gmail.readonly` scope](https://developers.google.com/workspace/gmail/api/auth/scopes).
Set `SUPERLINKED_API_KEY`, `GUILD_API_KEY`, the SingleStore settings, and an
AgentMail key with message read and send access to Guido's inbox.

The first scan records the mailbox's current Gmail history ID. Later scans
classify newly added conversations, using up to five recent messages per
thread as context. The SingleStore user needs CREATE, SELECT, INSERT, and
UPDATE access for `guido_gmail_cursor`. If Gmail expires the checkpoint,
the scanner reports a failure. Review missed mail before resetting it.

For a qualified Gmail trip, Guido waits for Guild to finish, then sends the
result through its AgentMail inbox to the authenticated Gmail address. The
scanner skips mail from Guido's inbox and uses a stable AgentMail label to
look up a previous send if it retries the same Gmail message.

## Rental providers

The relay and rental gateway check Statsig as user ID `guido-guild`.
When `BROWSERBASE_ENABLED` is on, Guido uses Browserbase to compare Hertz,
Avis, and Enterprise and stops before booking. When the gate is explicitly
off, the gateway reads synthetic prices from Firedrill and labels the
options as simulated. An unavailable gate blocks both providers. The
gateway checks the flag again and stops if the selected provider changed.

Set `STATSIG_SDK_KEY`, `BROWSERBASE_API_KEY`,
`GUIDO_BROWSERBASE_GATEWAY_TOKEN`, and `FIREDRILL_RENTAL_CONNECTION` on the
deployment. Use a current [Firedrill tool session](https://docs.firedrill.run/tools/sessions)
with the synthetic Web rate cards in [firedrill/rental-pricing](firedrill/rental-pricing).
The gateway reads Hertz, Enterprise, and Avis rate cards, then applies the
requested vehicle classes, USD budget, and duration rounded up to rental
days. The Denver location catalog is a separate seeded page. Rates are
fixtures and do not represent real branch availability.

For the location-specific catalog, set `FIREDRILL_RENTAL_CATALOG_CONNECTION`
to a hosted Firedrill connection JSON scoped to `web.fetch`. This connection
takes precedence and the gateway reads `/rental-locations/bay-area` and
`/rental-locations/denver` for each vendor on every search. It matches pickup
branch names and supports SFO and DEN as aliases. Locations and classes absent
from the catalog produce no simulated matches.

For local verification, use the loopback `invoke` URL from `firedrill tools
access` as `FIREDRILL_RENTAL_INVOKE_URL`. Vercel requires a hosted scoped
connection and cannot use that local endpoint. Renew or replace the hosted
connection before the originating session or credential expires.

Generate the Guild integration with
`node guild/browserbase/gated-contract.mjs <https-origin>`. Import it into
Guild, set its `X-Guido-Tool-Key` credential to match the gateway token,
and publish the updated [Guido prompt](guild/email/PROMPT.md).

## Amplitude Agent Analytics

Set `AMPLITUDE_API_KEY` for the US Amplitude project. Agent Analytics spans
record message reads, Superlinked scores, Statsig decisions, Guild runs,
rental-provider requests, memory operations, and Gmail result delivery.
Filter the span name by `email.received` for incoming AgentMail and Gmail
messages or `road_trip.detected` for an itinerary Superlinked identifies
as a road trip. Both can appear in the same session. Road trips in a
traveler's own car can be detected without starting a rental search.

Each email workflow and its rental gateway calls share an Amplitude session
ID. When the workflow starts Guido in Guild, its spans also include the
Guild session ID. Trigger-only AgentMail runs report acceptance. Workflows
that wait for Guild report the outcome and close the Amplitude session.
Email text, addresses, drafts, and tool payloads stay out of Amplitude.

## Draft an email with Cognee memory

Set the AgentMail, Guild, and Cognee credentials listed in `.env.example` in
`.env.local`. Use the tenant ID from Cognee Cloud's API Keys page. Generate
`GUIDO_MEMORY_SECRET` with `openssl rand -hex 32` once and keep it stable
across runs. It determines how each inbox and sender map to a Cognee session.

```sh
node --env-file=.env.local lib/guido-email.ts '<agentmail-message-id>'
```

The command fetches the inbound email from AgentMail, passes up to five recent
exchanges for that sender to Guido on Guild, and records the email and generated
draft in Cognee Cloud. Cognee is the conversation memory store. A sender must
pass AgentMail's From-domain DMARC check to use memory. Messages that cannot
be authenticated still get a draft with memory skipped. The command prints
the draft for review. The webhook can use the same handler.

For trip recall, deploy the updated [Guild prompt](guild/email/PROMPT.md) and
set the SingleStore settings in `.env.local`. The handler creates
`guido_rental_trips` on the first trip save. The database user needs CREATE,
SELECT, INSERT, and UPDATE access. Cognee stores each trip reference in the
sender's conversation history. For follow-ups, Guido loads the referenced
itineraries and compares pickup and return locations and dates.

## Travel guidance from Senso

Guido can draw on approved travel and rental guides when drafting for a
qualified Gmail or AgentMail trip. Add or select ready-to-search guides in
Senso that are safe to quote to recipients. Set `SENSO_API_KEY` on the relay
with a key restricted to those guides, and set `SENSO_CONTENT_IDS` to the
comma-separated Senso `content_id` values. Publish the updated
[Guild prompt](guild/email/PROMPT.md) so Guido uses the guidance in drafts.

The relay retrieves up to three passages from those documents. It uses a
road-trip query about mileage limits, cross-border rules, and roadside
assistance when Superlinked detects a road trip, and general rental guidance
otherwise. Email text, itinerary details, and sender history stay out of both
queries. Drafting continues if Senso returns no
usable context or the lookup fails. Live quotes and simulated estimates still
come from the selected rental provider. See the
[Senso context API quickstart](https://docs.senso.ai/docs/quickstart#5-use-your-own-model).

## Verify locally

```sh
npm ci
npm test
npm run typecheck
```

The tests cover Guild integration definitions, sender isolation, Cognee
history, SingleStore trip persistence and recall, and scoped Senso guidance
with provider failure fallback. They need no live credentials.
