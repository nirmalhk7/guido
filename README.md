# Guido

[Guido's email drafting agent](guild/email) drafts plain-text replies from a
supplied subject and message. Guild integration definitions are available
for Browserbase rental searches and Cognee memory.

## Incoming email on Guild

`POST /api/agentmail` starts the installed `guido` agent in Guild's
`tokensandhackathon` workspace. The relay and Browserbase gateway share the
`guido` Vercel project. Configure the relay with:

- `AGENTMAIL_INBOX_ID` for Guido's inbox.
- `AGENTMAIL_API_KEY` scoped to that inbox, with message read access and
  permission to read unauthenticated mail.
- `AGENTMAIL_WEBHOOK_TOKEN`, a random secret AgentMail sends as the webhook's
  `Authorization: Bearer <token>` header.
- `GUILD_TRIGGER_KEY`, the combined key from a Guild API trigger assigned to
  the installed `guido` agent.

Register the relay's HTTPS URL as an inbox webhook for `message.received`
and `message.received.unauthenticated`. Set `GUILD_API_KEY` and
`GUIDO_MEMORY_SECRET` along with the Cognee and SingleStore settings below
to enable trip recall on the relay. In this mode the relay acknowledges
delivery after drafting and saving memory for verified senders. Allow the
relay runtime to wait for Guild and for any rental search. A retry can reuse
the draft once Cognee has recorded it.

With the Guild API trigger setup, the relay acknowledges delivery after Guild
creates the session. A delivery retry can create another session for the same
AgentMail event ID. Drafts appear in Guild's session history.

## Amplitude Agent Analytics

Set `AMPLITUDE_API_KEY` to the US Amplitude project's API key in Vercel
Production and in `.env.local` for local runs. The email relay reports Guild
session acceptance or start failure. When the relay waits for a draft, it
reports completion or failure and closes the Amplitude session. The events
include the Guild session ID, elapsed time, and outcome. Email and draft
content, sender addresses, memory, and tool payloads stay out of telemetry.

Sessions opened directly in Guild do not pass through the relay.

## Rental-car search

Guido's email agent uses Browserbase to compare rental prices on the official
Hertz, Avis, and Enterprise sites. It checks all three with the same itinerary
and reports the cheapest verified total and each vendor's outcome. Searches
stop before booking.

Guild routes rental tools through the Guido Vercel gateway at
`/api/browserbase`. The gateway checks the Statsig gate
`guido_browserbase` as the fixed service identity `guido-guild` before
starting a run or fetching results. An off, missing, or unavailable gate
blocks Browserbase. Statsig receives the service ID and no email data.

Deployment needs `STATSIG_SDK_KEY`, `BROWSERBASE_API_KEY`, and
`GUIDO_BROWSERBASE_GATEWAY_TOKEN` in the Vercel project's Production
environment. Guild uses a dedicated gateway token as `X-Guido-Tool-Key`.
The Browserbase API key stays in Vercel. To regenerate the Guild integration
contract for a different gateway deployment, run
`node guild/browserbase/gated-contract.mjs <https-origin>`.

To turn off the tools, disable the gate in Statsig. To restore them, enable
the gate with a passing rule for user ID `guido-guild`. An already running
Browserbase job may finish while the gate is off.

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

## Verify locally

```sh
npm ci
npm test
npm run typecheck
```

The tests cover Guild integration definitions, sender isolation, Cognee
history, and SingleStore trip persistence and recall. They need no live
credentials.
