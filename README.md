# Guido

Guido is a local terminal agent for one AgentMail inbox. It can list recent
messages, read their plain text, summarize them, and draft replies in chat.
Guido's mailbox tools are read-only.

## Connect an inbox

1. Use an existing AgentMail inbox or [create one](https://docs.agentmail.to/knowledge-base/creating-first-inbox)
   with the display name **Guido**. Copy its `inbox_id` and get an AgentMail API key.
2. Install dependencies with Node.js 24 or later and copy the environment template.

   ```sh
   npm ci
   cp .env.example .env.local
   ```

3. In `.env.local`, set `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, and
   `OPENAI_API_KEY`. Guido calls GPT-5 mini directly through the OpenAI API.
4. Run `npm run dev` and ask, “Summarize my five newest emails and draft a reply
   to the most urgent one.”

Message previews and plain-text body excerpts retrieved by Guido are sent to
the selected model provider and may be saved in local Eve session history.

## Connect Cognee memory

Set `COGNEE_BASE_URL` in `.env.local` to the root URL of your Cognee instance.
It must support the `/api/v1/remember` and `/api/v1/recall` endpoints.

- **[Cognee Cloud](https://docs.cognee.ai/cognee-cloud/http-api)**. Use your
  workspace URL and set `COGNEE_API_KEY` and `COGNEE_TENANT_ID` from its API Keys page.
- **[Self-hosted Cognee](https://docs.cognee.ai/api-reference/introduction)**.
  Use the server URL, such as `http://localhost:8000` for a local instance.
  Set `COGNEE_API_TOKEN` if your server requires Bearer authentication.

Guido looks up relevant memories before each text turn, sending the current
user text as the search query. Cognee may retain search queries in its history.
Guido saves long-term notes when you ask it to remember something. Mailbox tool
output and transcripts are excluded from automatic ingestion. Notes live in a
`guido_memory_*` dataset scoped to the Eve caller, shared across that caller's
chats. Setting no Cognee URL disables long-term memory. Eve keeps the active
conversation history separately.

## Simulate Guido with Firedrill

The inbox drill asks Guido to read synthetic mail and draft a reply in chat.
It returns the draft and the recorded Eve tool outcomes for scoring. See the
[Firedrill setup guide](firedrill/README.md) to run it in your workspace.

## Verify locally

```sh
npm test
npm run typecheck
npm run build
```

Tests intercept AgentMail and Cognee HTTP requests. For a live mail check, ask
Guido to list the latest message and open it by ID. For a live memory check, tell
Guido “Remember that I prefer short subject lines.” Start a new chat and ask
“What is my email subject preference?”
