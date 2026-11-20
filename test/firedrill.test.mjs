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

test("the Firedrill driver runs Guido against synthetic AgentMail and returns tool evidence", () => {
  const steps = [
    { id: "bad", kind: "event", session: "drill-1", input: {} },
    { id: "draft", kind: "task", session: "drill-1", input: { message: "Draft a reply." } },
    { id: "follow-up", kind: "message", session: "drill-1", input: "What was the code?" },
  ];
  const output = execFileSync(process.execPath, [script("runner"), "--smoke"], {
    input: steps.map(JSON.stringify).join("\n") + "\n",
    encoding: "utf8",
    timeout: 135_000,
  });
  const [ready, ...lines] = output.trim().split("\n");
  assert.equal(ready, "GUIDO_FIREDRILL_READY");
  const [bad, draft, followUp] = lines.map(JSON.parse);
  assert.equal(bad.id, "bad");
  assert.match(bad.error, /Unsupported/);
  assert.equal(draft.id, "draft");
  assert.match(draft.output.reply, /CEDAR-482/);
  assert.deepEqual(draft.output.tools, [
    { name: "list_messages", outcome: "completed" },
    { name: "read_message", outcome: "completed" },
  ]);
  assert.equal(followUp.id, "follow-up");
  assert.match(followUp.output.reply, /CEDAR-482/);
  assert.deepEqual(followUp.output.tools, []);
});

test("descriptor and local plan agree on the isolated runner and model credential", () => {
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
  assert.deepEqual(plan.services[0].local_secret_env, ["OPENAI_API_KEY"]);
  assert.deepEqual(descriptor.services[0].configuration, [
    { name: "OPENAI_API_KEY", phase: "runtime", secret: true, required: true },
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
  assert.deepEqual(world.configuration_names, [{ name: "OPENAI_API_KEY", phase: "runtime" }]);
});

test("the live Firedrill runner requires an OpenAI API key", () => {
  assert.throws(() => execFileSync(process.execPath, [script("runner")], {
    encoding: "utf8",
    env: { ...process.env, OPENAI_API_KEY: "", AI_GATEWAY_API_KEY: "" },
    timeout: 5_000,
    stdio: "pipe",
  }), (error) => error.status === 1 && /Set OPENAI_API_KEY/.test(error.stderr));
});
