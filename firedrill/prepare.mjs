import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const runner = "firedrill/runner.mjs";
const providerKey = "OPENAI_API_KEY";
const root = { alias: "app" };
const service = { alias: "guido", root_alias: root.alias };
const profile = "jsonl-process.v1";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const { dev, ino } = statSync(path, { bigint: true });
root.identity_sha256 = sha256(`firedrill.root-identity.v1\0${path}\0${dev}:${ino}`);

function versionReference(kind, id, rawRevision, digest) {
  const revision = Number(rawRevision);
  if (!id || !Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`Provide the ${kind} version ID, revision, and SHA-256 digest from Firedrill.`);
  }
  return { origin: "native_library", kind, id, revision, digest };
}

function prepare(command, args) {
  switch (command) {
    case "descriptor":
      return {
        schema: "firedrill.local-descriptor.v1",
        source_roots: [root],
        services: [{
          ...service, role: "agent", depends_on: [],
          configuration: [{ name: providerKey, phase: "runtime", secret: true, required: true }],
        }],
        entry_service: service.alias,
        driver: {
          profile,
          adapter_sha256: sha256(readFileSync(new URL("./runner.mjs", import.meta.url))),
          authentication: "anonymous",
          state_domains: ["session"],
        },
        state_domains: [{
          alias: "session", service_alias: service.alias, kind: "session", location: "local",
          reset: "fresh-session", concurrency: "independent", hook_sha256: null,
        }],
        dependencies: [],
      };
    case "plan": {
      const [digest] = args;
      if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error("Provide the registered descriptor digest.");
      return {
        version: 1,
        descriptor_sha256: digest,
        roots: [{ ...root, path }],
        services: [{
          ...service, mode: "launch", cwd: ".", command: { executable: "node", args: [runner] },
          env_passthrough: [], env_static: {}, local_secret_env: [providerKey],
          readiness: { kind: "stdout", pattern: "GUIDO_FIREDRILL_READY" },
          readiness_timeout_ms: 60_000, stop_timeout_ms: 5_000, per_drill: true, port_env: null,
        }],
        driver: { profile, service_alias: service.alias },
        state_hooks: [],
        max_parallel_drills: 1,
      };
    }
    case "scenario":
      return {
        schema: "firedrill.native-scenario.v2",
        name: "Guido drafts a briefing reply",
        description: "Guido reads one synthetic email and drafts a reply in chat.",
        instruction: "Run the fixed inbox task once.",
        personas: [],
        evaluations: [versionReference("evaluation", ...args)],
        conditions: [], events: [], max_turns: 1, stop_rules: [],
        target_input: {
          kind: "task",
          input: { message: "Read my newest email and draft a short reply in chat confirming receipt of the briefing reference. Do not send it." },
        },
      };
    case "world":
      return {
        schema: "firedrill.native-world.v1",
        name: "Guido synthetic inbox",
        description: "Local AgentMail fixture, with the Guido agent running on the local machine.",
        dependencies: [],
        resources: [versionReference("scenario", ...args)],
        configuration_names: [{ name: providerKey, phase: "runtime" }],
        execution: { repetitions: 1, max_parallel: 1, reset: "per_drill" },
      };
    default:
      throw new Error("Usage: node firedrill/prepare.mjs descriptor | plan DIGEST | scenario ID REVISION DIGEST | world ID REVISION DIGEST");
  }
}

try {
  console.log(JSON.stringify(prepare(process.argv[2], process.argv.slice(3)), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
