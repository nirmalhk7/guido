import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function script(name) {
  const path = fileURLToPath(new URL(`../firedrill/${name}.mjs`, import.meta.url));
  assert.ok(existsSync(path), `Guido needs the Firedrill ${name} script`);
  return path;
}

test("descriptor and local plan agree on the isolated runner and Guild credential", () => {
  const prepare = (...args) => JSON.parse(execFileSync(process.execPath, [script("prepare"), ...args], {
    encoding: "utf8",
  }));
  const descriptor = prepare("descriptor");
  const plan = prepare("plan", "a".repeat(64));
  assert.equal(descriptor.schema, "firedrill.local-descriptor.v1");
  assert.match(descriptor.driver.adapter_sha256, /^[0-9a-f]{64}$/);
  assert.equal(descriptor.source_roots[0].identity_sha256, plan.roots[0].identity_sha256);
  assert.equal(plan.descriptor_sha256, "a".repeat(64));
  assert.equal(plan.driver.profile, descriptor.driver.profile);
  assert.deepEqual(plan.services[0].command.args, ["firedrill/runner.mjs"]);
  assert.equal(plan.services[0].per_drill, true);
  assert.deepEqual(plan.services[0].local_secret_env, ["GUILD_API_KEY"]);
  assert.deepEqual(descriptor.services[0].configuration, [
    { name: "GUILD_API_KEY", phase: "runtime", secret: true, required: true },
  ]);
});

test("scenario and world pin their Firedrill library references", () => {
  const prepare = (...args) => JSON.parse(execFileSync(process.execPath, [script("prepare"), ...args], {
    encoding: "utf8",
  }));
  const digest = "b".repeat(64);
  const scenario = prepare("scenario", "evaluation-version", "2", digest);
  const world = prepare("world", "scenario-version", "3", digest);
  assert.deepEqual(scenario.evaluations, [{
    origin: "native_library", kind: "evaluation", id: "evaluation-version", revision: 2, digest,
  }]);
  assert.equal(scenario.target_input.kind, "task");
  assert.match(scenario.target_input.input.message, /draft.*do not send/i);
  assert.deepEqual(world.resources, [{
    origin: "native_library", kind: "scenario", id: "scenario-version", revision: 3, digest,
  }]);
  assert.equal(world.execution.repetitions, 1);
  assert.deepEqual(world.configuration_names, [{ name: "GUILD_API_KEY", phase: "runtime" }]);
});

test("the live Firedrill runner requires a Guild API key", () => {
  assert.throws(() => execFileSync(process.execPath, [script("runner")], {
    encoding: "utf8",
    env: { ...process.env, GUILD_API_KEY: "" },
    timeout: 5_000,
    stdio: "pipe",
  }), (error) => error.status === 1 && /Set GUILD_API_KEY/.test(error.stderr));
});

test("chat descriptor, world and plan bind both simulator operations", () => {
  const prepare = (...args) => JSON.parse(execFileSync(process.execPath, [script("prepare"), "chat", ...args], {
    encoding: "utf8",
  }));
  const digest = "c".repeat(64);
  const descriptor = prepare("descriptor");
  const plan = prepare("plan", digest);
  const scenario = prepare("scenario", "evaluation-version", "1", digest, "C01GENERAL1", "147000000000000001");
  const world = prepare("world", "scenario-version", "1", digest, "slack-version", digest, "discord-version", digest);

  assert.deepEqual(descriptor.dependencies, [
    { alias: "slack", service_alias: "guido", protocol: "http", mode: "synthetic", operations: ["conversations.history"] },
    { alias: "discord", service_alias: "guido", protocol: "http", mode: "synthetic", operations: ["messages.list"] },
  ]);
  assert.deepEqual(plan.services[0].dependency_env, [
    { alias: "slack", name: "GUIDO_SLACK_INVOKE_URL", url: "invoke" },
    { alias: "discord", name: "GUIDO_DISCORD_INVOKE_URL", url: "invoke" },
  ]);
  assert.deepEqual(world.dependencies, [
    { alias: "slack", mode: "simulated", tool_version_id: "slack-version", service_key: "slack", contract_digest: digest, operations: ["conversations.history"], seed_id: null },
    { alias: "discord", mode: "simulated", tool_version_id: "discord-version", service_key: "discord", contract_digest: digest, operations: ["messages.list"], seed_id: null },
  ]);
  assert.deepEqual(world.configuration_names, [
    { name: "GUILD_API_KEY", phase: "runtime" },
    { name: "GUIDO_SLACK_INVOKE_URL", phase: "runtime" },
    { name: "GUIDO_DISCORD_INVOKE_URL", phase: "runtime" },
  ]);
  assert.deepEqual(descriptor.services[0].configuration.map(({ name }) => name),
    world.configuration_names.map(({ name }) => name));
  assert.equal(plan.services[0].per_drill, true);
  assert.equal(scenario.target_input.input.slackChannelId, "C01GENERAL1");
  assert.equal(scenario.target_input.input.discordChannelId, "147000000000000001");
});

test("the Firedrill driver sends simulator reads to Guido on Guild and continues the same session", () => {
  const fixture = new URL("../firedrill/fixtures/guild-api.mjs", import.meta.url);
  const message = "Summarize the simulated channels.";
  const steps = [
    { id: "bad", kind: "event", session: "drill-1", input: {} },
    { id: "summary", kind: "task", session: "drill-1", input: {
      message, slackChannelId: "C01GENERAL1", discordChannelId: "147000000000000001",
    } },
    { id: "follow-up", kind: "message", session: "drill-1", input: "Which channel had the deadline?" },
  ];
  const stdout = execFileSync(process.execPath, ["--import", fixture.href, script("runner")], {
    input: steps.map((step) => JSON.stringify(step)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      GUILD_API_KEY: "test-id:test-secret",
      GUIDO_SLACK_INVOKE_URL: "http://127.0.0.1:8001/test-key/slack/v1/invoke",
      GUIDO_DISCORD_INVOKE_URL: "http://127.0.0.1:8001/test-key/discord/v1/invoke",
    },
  });
  const [ready, ...lines] = stdout.trim().split("\n");
  assert.equal(ready, "GUIDO_FIREDRILL_READY");
  const [bad, summary, followUp] = lines.map(JSON.parse);
  assert.match(bad.error, /Unsupported/);
  assert.deepEqual(summary, { id: "summary", output: {
    reply: "Slack: SLACK-482. Discord: DISCORD-953.",
    reads: [
      { platform: "slack", outcome: "completed" },
      { platform: "discord", outcome: "completed" },
    ],
  } });
  assert.deepEqual(followUp, { id: "follow-up", output: { reply: "Discord.", reads: [] } });
});
