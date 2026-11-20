import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const runner = "firedrill/runner.mjs";
const providerKey = "GUILD_API_KEY";
const root = { alias: "app" };
const service = { alias: "guido", root_alias: root.alias };
const profile = "jsonl-process.v1";
const chatDependencies = [
  { alias: "slack", name: "GUIDO_SLACK_INVOKE_URL", operations: ["conversations.history"] },
  { alias: "discord", name: "GUIDO_DISCORD_INVOKE_URL", operations: ["messages.list"] },
];

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

function prepare(command, args, chat) {
  const dependencies = chat ? chatDependencies : [];
  const configuration = [
    { name: providerKey, phase: "runtime", secret: true, required: true },
    ...dependencies.map(({ name }) => ({ name, phase: "runtime", secret: false, required: true })),
  ];
  switch (command) {
    case "descriptor":
      return {
        schema: "firedrill.local-descriptor.v1",
        source_roots: [root],
        services: [{
          ...service, role: "agent", depends_on: [],
          configuration,
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
        dependencies: dependencies.map(({ alias, operations }) => ({
          alias, service_alias: service.alias, protocol: "http", mode: "synthetic", operations,
        })),
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
          ...(chat ? { dependency_env: dependencies.map(({ alias, name }) => ({ alias, name, url: "invoke" })) } : {}),
          readiness: { kind: "stdout", pattern: "GUIDO_FIREDRILL_READY" },
          readiness_timeout_ms: 60_000, stop_timeout_ms: 5_000, per_drill: true, port_env: null,
        }],
        driver: { profile, service_alias: service.alias },
        state_hooks: [],
        max_parallel_drills: 1,
      };
    }
    case "scenario": {
      const [id, revision, digest, slackChannel, discordChannel] = args;
      if (chat && (!/^[A-Z0-9]+$/.test(slackChannel ?? "") || !/^\d+$/.test(discordChannel ?? ""))) {
        throw new Error("Provide the Slack and Discord channel IDs from the selected simulator data.");
      }
      return {
        schema: "firedrill.native-scenario.v2",
        name: chat ? "Guido briefs from Slack and Discord" : "Guido drafts a briefing reply",
        description: chat ? "Guido summarizes two synthetic chat channels." : "Guido reads one synthetic email and drafts a reply in chat.",
        instruction: chat ? "Run the fixed chat task once." : "Run the fixed inbox task once.",
        personas: [],
        evaluations: [versionReference("evaluation", id, revision, digest)],
        conditions: [], events: [], max_turns: 1, stop_rules: [],
        target_input: {
          kind: "task",
          input: chat
            ? {
                message: "Summarize the recent messages from the synthetic Slack and Discord channels. Identify each channel and report any failed or empty reads.",
                slackChannelId: slackChannel,
                discordChannelId: discordChannel,
              }
            : { message: "Read my newest email and draft a short reply in chat confirming receipt of the briefing reference. Do not send it." },
        },
      };
    }
    case "world": {
      const [id, revision, digest, ...toolVersions] = args;
      if (chat && toolVersions.length !== 4) {
        throw new Error("Provide the Slack and Discord tool version IDs and contract digests.");
      }
      return {
        schema: "firedrill.native-world.v1",
        name: chat ? "Guido synthetic Slack and Discord" : "Guido synthetic inbox",
        description: chat ? "Firedrill Slack and Discord simulators with Guido running on Guild."
          : "Guido's synthetic inbox on Guild.",
        dependencies: dependencies.map(({ alias, operations }, index) => {
          const [toolVersion, contractDigest] = toolVersions.slice(index * 2, index * 2 + 2);
          if (!toolVersion || !/^[a-f0-9]{64}$/i.test(contractDigest)) {
            throw new Error(`Provide the ${alias} tool version ID and SHA-256 contract digest from Firedrill.`);
          }
          return {
            alias, mode: "simulated", tool_version_id: toolVersion, service_key: alias,
            contract_digest: contractDigest, operations, seed_id: null,
          };
        }),
        resources: [versionReference("scenario", id, revision, digest)],
        configuration_names: configuration.map(({ name, phase }) => ({ name, phase })),
        execution: { repetitions: 1, max_parallel: 1, reset: "per_drill" },
      };
    }
    default:
      throw new Error("Usage: node firedrill/prepare.mjs [chat] descriptor | plan DIGEST | scenario ID REVISION DIGEST [SLACK_CHANNEL DISCORD_CHANNEL] | world ID REVISION DIGEST [SLACK_VERSION SLACK_CONTRACT DISCORD_VERSION DISCORD_CONTRACT]");
  }
}

try {
  const chat = process.argv[2] === "chat";
  const [command, ...args] = process.argv.slice(chat ? 3 : 2);
  console.log(JSON.stringify(prepare(command, args, chat), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
