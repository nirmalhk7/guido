# Firedrill for Guido

This drill runs the Guido agent locally and gives it one synthetic AgentMail
message. The driver returns Guido's reply and Eve's recorded tool names and
outcomes. The evaluation checks that Guido listed and opened the email, used
its briefing reference in a draft, and left it unsent.

The runner creates a fresh temporary copy of the agent for each drill. It does
not load the project's environment files. AgentMail requests are served by
the local read-only fixture, and Cognee is disabled for this inbox scenario.
The OpenAI API key enables GPT-5 mini to answer. Firedrill receives the
synthetic drill input, output, and tool evidence.

## Local smoke test

Run `npm ci`, then `node --test test/firedrill.test.mjs`. The smoke test starts
Eve on loopback and uses a deterministic model, so it needs no account or
model key. It verifies the JSON-lines driver, two completed mailbox reads,
and a follow-up in the same session.

## Run in your Firedrill workspace

Use Firedrill 3.0.11 with a supported Node.js release such as Node 24.11.1
or later in the 24.x series. [Firedrill hackathon guide](https://firedrill.run/hacker-docs)

1. From the repo root, run `npm ci`, then `npx --yes firedrill-run@3.0.11 init`. Sign in and
   choose your workspace. In the commands below, `firedrill` means the installed
   CLI or `npx --yes firedrill-run@3.0.11`.
2. Export `OPENAI_API_KEY` in the runner's shell. Generate the descriptor
   and register Guido. Save the returned agent ID and descriptor digest.

   ```sh
   mkdir -p .firedrill-local
   node firedrill/prepare.mjs descriptor > .firedrill-local/descriptor.json
   firedrill register --descriptor .firedrill-local/descriptor.json --name Guido
   firedrill library save --kind evaluation --file firedrill/evaluation.json
   ```

3. Set the variables below from the respective commands' output. Use version
   IDs for library references. Save the scenario and then the world.

   ```sh
   node firedrill/prepare.mjs scenario "$EVALUATION_VERSION_ID" "$EVALUATION_REVISION" "$EVALUATION_DIGEST" > .firedrill-local/scenario.json
   firedrill library save --kind scenario --file .firedrill-local/scenario.json

   node firedrill/prepare.mjs world "$SCENARIO_VERSION_ID" "$SCENARIO_REVISION" "$SCENARIO_DIGEST" > .firedrill-local/world.json
   firedrill world save --agent "$GUIDO_AGENT_ID" --file .firedrill-local/world.json

   node firedrill/prepare.mjs plan "$DESCRIPTOR_DIGEST" > .firedrill-local/plan.json
   firedrill status --plan .firedrill-local/plan.json
   firedrill plan --world "$WORLD_ID"
   ```

4. Review the estimate and scope before applying. Enroll this machine if it
   has no Firedrill runner, then use the returned campaign ID to run and
   inspect the drill.

   ```sh
   firedrill apply "$PLAN_ID" --follow
   firedrill runner enroll
   firedrill run --plan .firedrill-local/plan.json --descriptor .firedrill-local/descriptor.json --campaign "$CAMPAIGN_ID"
   firedrill report "$CAMPAIGN_ID"
   ```

If Guido already has a registered Firedrill descriptor, register the generated
descriptor as a new revision, save a world revision that uses it, and regenerate
the local plan with the new descriptor digest.

For revision commands, approval, and recovery details, see the [Firedrill runner guide](https://firedrill.run/run-your-agent.md).
