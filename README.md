# Guido

Guido runs on Guild as `guido-smoke` in the
`nirmalhk7~tokensandhackathon` workspace. It drafts replies from a synthetic
inbox, uses Browserbase to check Hertz, Avis, and Enterprise directly,
and uses Cognee Cloud for durable notes. The Guild agent recipe lives in
[guild/smoke](guild/smoke).

## Rental-car search

Guido uses its existing OpenAI model on Guild to collect trip details and
compare quotes. Browserbase browses the three vendors' public rental forms and
returns the prices or an outcome for each site. Searches stop before booking.

Connect a Browserbase API key to `nirmalhk7~guido-browserbase` in Guild and
grant it to Guido. Guild injects the key as `X-BB-API-Key`. The integration
exposes only the start and status operations defined in
[`guild/browserbase/openapi.json`](guild/browserbase/openapi.json).

In a fresh Guild chat, ask Guido for automatic rentals at SFO on future dates
with a total budget in USD. Check the trace for a Browserbase start and status
call using the same run ID. Check that the reply cites vendor prices and
reports the outcome for Hertz, Avis, and Enterprise individually.

## Connect Cognee memory

Create a key in your Cognee Cloud workspace and connect it under
**Credentials** on the installed Guild agent. Choose **Dedicated to this
agent** for `guido-cognee`. In a new Guild chat, ask Guido to remember a
unique test phrase. After it confirms the save, open a second chat and ask
for the phrase. Check the session for a successful Cognee recall call.

## Simulate Guido with Firedrill

The inbox drill asks Guido to draft a reply to synthetic mail. The chat drill
reads one synthetic Slack channel and one synthetic Discord channel, then asks
Guido to summarize both in Guild. See the [Firedrill setup guide](firedrill/README.md).

## Verify locally

```sh
npm ci
npm test
npm run typecheck
```

The tests check the Guild Cognee integration and simulate the Guild and
Firedrill API responses. They need no live credentials.
