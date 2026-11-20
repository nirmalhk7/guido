import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Client } from "eve/client";

const ready = "GUIDO_FIREDRILL_READY";
const root = fileURLToPath(new URL("../", import.meta.url));
const smoke = process.argv[2] === "--smoke";
const openaiKey = process.env.OPENAI_API_KEY?.trim();
if (!smoke && !openaiKey) {
  console.error("Set OPENAI_API_KEY in the Firedrill runner environment.");
  process.exit(1);
}

const scratch = await mkdtemp(join(tmpdir(), "guido-firedrill-"));
let server;
let input;
function stop() {
  input?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function waitForEve(child) {
  const signal = AbortSignal.timeout(45_000);
  const lines = createInterface({ input: child.stdout });
  let lastLine = "";
  try {
    const endpoint = await Promise.race([
      (async () => {
        for await (const line of lines) {
          const match = line.match(/^\[DEV\] ready at (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) return match[1];
          if (line.trim()) lastLine = line;
        }
        throw new Error(`Eve exited before it was ready. ${lastLine}`);
      })(),
      once(signal, "abort").then(() => { throw new Error("Eve startup timed out."); }),
      once(child, "error").then(([error]) => { throw error; }),
    ]);
    return endpoint;
  } finally {
    lines.close();
    child.stdout.resume();
  }
}

async function runStep(client, sessions, step) {
  const message = step.kind === "message" ? step.input : step.kind === "task" ? step.input?.message : null;
  if (typeof step.session !== "string" || !step.session || typeof message !== "string" || !message.trim()) {
    throw new Error("Unsupported Firedrill step. Provide a session and a text message or task.");
  }
  const signal = AbortSignal.timeout(90_000);
  let session = sessions.get(step.session);
  let delivery;
  if (session) {
    delivery = await session.send(message, { signal });
  } else {
    ({ session, delivery } = await client.sessions.create({ message, signal }));
    sessions.set(step.session, session);
  }

  const tools = new Map();
  const [, result] = await Promise.all([
    (async () => {
      for await (const event of delivery.stream({ signal })) {
        const data = event.data;
        if (event.type === "call.requested" && data.capability.kind === "tool") {
          tools.set(data.callId, { name: data.capability.name, outcome: "unresolved" });
        }
        if (event.type === "call.settled" && tools.has(data.callId)) {
          tools.get(data.callId).outcome = data.outcome;
        }
      }
    })(),
    delivery.result({ signal }),
  ]);
  if (result.status !== "completed" || !result.reply?.trim()) {
    throw new Error(`Guido turn ${result.status} without a usable reply.`);
  }
  return { reply: result.reply, tools: [...tools.values()] };
}

try {
  await Promise.all([
    cp(join(root, "agent"), join(scratch, "agent"), { recursive: true }),
    cp(join(root, "lib"), join(scratch, "lib"), { recursive: true }),
    cp(join(root, "package.json"), join(scratch, "package.json")),
    symlink(join(root, "node_modules"), join(scratch, "node_modules"), "dir"),
  ]);
  if (smoke) await cp(join(root, "firedrill/fixtures/smoke-model.ts"), join(scratch, "agent/agent.ts"));

  const preload = new URL("./agentmail-fixture.mjs", import.meta.url).href;
  server = spawn(process.execPath, [
    join(root, "node_modules/.bin/eve"), "dev", "--no-ui", "--no-default-extensions",
    "--host", "127.0.0.1", "--port", "0",
  ], {
    cwd: scratch,
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      PATH: process.env.PATH,
      NODE_OPTIONS: `--import=${preload}`,
      AGENTMAIL_API_KEY: "synthetic-only",
      AGENTMAIL_INBOX_ID: "guido@fixture.invalid",
      ...(smoke ? {} : { OPENAI_API_KEY: openaiKey }),
    },
  });

  const client = new Client({ baseUrl: await waitForEve(server) });
  const sessions = new Map();
  input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  console.log(ready);
  for await (const line of input) {
    let step;
    try {
      step = JSON.parse(line);
      if (typeof step?.id !== "string") throw new Error("A string step ID is required.");
      const output = await runStep(client, sessions, step);
      console.log(JSON.stringify({ id: step.id, output }));
    } catch (error) {
      console.log(JSON.stringify({ id: step?.id ?? null, error: error.message }));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    const finished = once(server, "exit");
    stop();
    await finished;
  }
  await rm(scratch, { recursive: true, force: true });
}
