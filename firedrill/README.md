# Firedrill for Guido

Firedrill drives Guido through the Guild API. Each drill starts a new
`guido-smoke` chat in `nirmalhk7~tokensandhackathon`. Follow-up steps within
that drill use the same Guild session.

Set `GUILD_API_KEY` in the runner shell to a Guild account API key with
`sessions:write`, `workspaces:read`, and `agents:read` for that workspace.
Guild receives the drill prompt and any synthetic messages used as context.
Firedrill receives Guido's reply, simulator activity, and read outcomes.

## Local smoke test

Run `npm ci`, then `node --test test/firedrill.test.mjs`. Tests intercept the
Guild and simulator HTTP calls. They verify the reads, the handoff to Guild,
and a follow-up in the same chat.

## Run a Slack and Discord drill

Firedrill injects a loopback invoke URL for each simulator into the local
runner. The runner reads up to five messages per channel and sends their
text to Guido as context for its Guild reply.

1. Sign in with the CLI and export `GUILD_API_KEY`. Use
   `firedrill tools catalog` to find Slack and Discord in your workspace. Use
   `firedrill tools catalog-operations <release-id> --service slack` to confirm
   `conversations.history` and the equivalent Discord command to confirm
   `messages.list`.
2. Use `firedrill tools save <release-id>` for each tool. Get the version IDs
   from `firedrill tools runnable` and the contract digests from
   `firedrill tools definitions show <version-id>`. Choose one readable channel
   with messages in each version's default synthetic data. Use the channel
   IDs from the Firedrill tool previews or data views.
3. Generate the chat descriptor and register it. Save the chat evaluation,
   then use its version ID, revision, and digest when generating the scenario.

   ```sh
   mkdir -p .firedrill-local
   node firedrill/prepare.mjs chat descriptor > .firedrill-local/chat-descriptor.json
   firedrill register --descriptor .firedrill-local/chat-descriptor.json --name "Guido Chat"
   firedrill library save --kind evaluation --file firedrill/chat-evaluation.json

   node firedrill/prepare.mjs chat scenario "$EVALUATION_VERSION_ID" "$EVALUATION_REVISION" "$EVALUATION_DIGEST" "$SLACK_CHANNEL_ID" "$DISCORD_CHANNEL_ID" > .firedrill-local/chat-scenario.json
   firedrill library save --kind scenario --file .firedrill-local/chat-scenario.json
   ```

4. Use the chat scenario reference, both tool versions and their contract
   digests, and the newly registered chat descriptor digest.

   ```sh
   node firedrill/prepare.mjs chat world "$SCENARIO_VERSION_ID" "$SCENARIO_REVISION" "$SCENARIO_DIGEST" "$SLACK_TOOL_VERSION_ID" "$SLACK_CONTRACT_DIGEST" "$DISCORD_TOOL_VERSION_ID" "$DISCORD_CONTRACT_DIGEST" > .firedrill-local/chat-world.json
   firedrill world save --agent "$GUIDO_CHAT_AGENT_ID" --file .firedrill-local/chat-world.json

   node firedrill/prepare.mjs chat plan "$DESCRIPTOR_DIGEST" > .firedrill-local/chat-plan.json
   firedrill status --plan .firedrill-local/chat-plan.json
   firedrill plan --world "$WORLD_ID"
   ```

5. Review the plan for one drill with both synthetic dependencies. Follow the
   apply, enroll, run and report steps below using the chat plan and descriptor.
   Check the report for both simulator reads and a summary grounded in each
   channel's messages.

See the [Firedrill synthetic tool connection guide](https://docs.firedrill.run/connect/tools)
for the dependency routing contract.

## Run the inbox drill in your Firedrill workspace

Use Firedrill 3.0.11 with a supported Node.js release such as Node 24.11.1
or later in the 24.x series. [Firedrill CLI guide](https://docs.firedrill.run/cli/overview)

1. From the repo root, run `npm ci`, then `npx --yes firedrill-run@3.0.11 init`. Sign in and
   choose your workspace. In the commands below, `firedrill` means the installed
   CLI or `npx --yes firedrill-run@3.0.11`.
2. Export `GUILD_API_KEY` in the runner's shell. Generate the descriptor
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

For revision commands, approval, and recovery details, see the [Firedrill runner guide](https://docs.firedrill.run/run/run-drills).
