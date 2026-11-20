import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const route = new URL("../api/browserbase.ts", import.meta.url);
const gateway = "https://example.invalid/api/browserbase";
const runId = "430f9571-fbad-4744-b3ff-8d4e4bd914c6";
const request = {
  task: "Compare Hertz, Avis, and Enterprise for a 24-hour SFO rental.",
  browserSettings: { allowedDomains: ["hertz.com", "avis.com", "enterprise.com"] },
  resultSchema: { type: "object", properties: { vendors: { type: "array" } } },
};

async function setup(t, gate) {
  assert.ok(existsSync(route), "Browserbase calls need a Statsig-gated route");
  const config = {
    GUIDO_BROWSERBASE_GATEWAY_TOKEN: "guild-gateway-secret",
    STATSIG_SDK_KEY: "statsig-sdk-key",
    BROWSERBASE_API_KEY: "browserbase-secret",
  };
  for (const [key, value] of Object.entries(config)) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const req = new Request(input, options);
    calls.push(req.url);
    if (req.url === "https://api.statsig.com/v1/check_gate") {
      assert.equal(req.headers.get("statsig-api-key"), "statsig-sdk-key");
      assert.deepEqual(await req.json(), {
        gateName: "guido_browserbase",
        user: { userID: "guido-guild" },
        statsigEnvironment: { tier: "production" },
      });
      return gate();
    }
    assert.equal(req.headers.get("x-bb-api-key"), "browserbase-secret");
    assert.equal(req.headers.has("x-guido-tool-key"), false);
    if (req.method === "POST") {
      assert.equal(req.url, "https://api.browserbase.com/v1/agents/runs");
      assert.deepEqual(await req.json(), request);
      return Response.json({ runId, status: "PENDING" }, { status: 201 });
    }
    assert.equal(req.url, "https://api.browserbase.com/v1/agents/runs/" + runId);
    return Response.json({ runId, status: "COMPLETED", result: { output: { vendors: [] } } });
  });
  return { ...await import(route.href), calls };
}

function start(payload = request, token = "guild-gateway-secret") {
  return new Request(gateway, {
    method: "POST",
    headers: { "x-guido-tool-key": token, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function status() {
  return new Request(gateway + "?runId=" + runId, {
    headers: { "x-guido-tool-key": "guild-gateway-secret" },
  });
}

const gateValue = (value) => () => Response.json({ name: "guido_browserbase", value });

test("the flag is checked before starting a run and again before fetching its result", async (t) => {
  let enabled = true;
  const { GET, POST, calls } = await setup(t, () => gateValue(enabled)());
  const created = await POST(start());
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { runId, status: "PENDING" });
  enabled = false;
  assert.deepEqual(await (await GET(status())).json(), { status: "DISABLED", reason: "feature_gate_off" });
  enabled = true;
  assert.equal((await (await GET(status())).json()).status, "COMPLETED");
  assert.deepEqual(calls, [
    "https://api.statsig.com/v1/check_gate", "https://api.browserbase.com/v1/agents/runs",
    "https://api.statsig.com/v1/check_gate",
    "https://api.statsig.com/v1/check_gate", "https://api.browserbase.com/v1/agents/runs/" + runId,
  ]);
});

test("a disabled gate prevents a Browserbase start", async (t) => {
  const { POST, calls } = await setup(t, gateValue(false));
  assert.deepEqual(await (await POST(start())).json(), { status: "DISABLED", reason: "feature_gate_off" });
  assert.equal(calls.length, 1);
});

test("an unavailable or invalid Statsig response fails closed", async (t) => {
  let failure = 0;
  const { POST, calls } = await setup(t, () => {
    if (++failure === 1) return new Response(null, { status: 503 });
    if (failure === 2) throw new Error("timeout");
    return Response.json({ name: "another_gate", value: true });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await (await POST(start())).json(), { status: "DISABLED", reason: "feature_gate_unavailable" });
  }
  assert.equal(calls.length, 3);
});

test("untrusted callers and out-of-scope rental requests never reach either service", async (t) => {
  const { POST, calls } = await setup(t, gateValue(true));
  assert.equal((await POST(start(request, "other-token"))).status, 401);
  assert.equal((await POST(start({ ...request, browserSettings: { allowedDomains: ["hertz.com", "avis.com", "example.com"] } }))).status, 400);
  assert.equal((await POST(start({ ...request, resultSchema: { vendors: { type: "array" } } }))).status, 400);
  assert.deepEqual(calls, []);
});

test("Guild's import contract routes start and status through the authenticated gateway", async () => {
  const source = new URL("../guild/browserbase/gated-contract.mjs", import.meta.url);
  assert.ok(existsSync(source), "Guild needs an importable gateway contract");
  const { gatedBrowserbaseContract } = await import(source.href);
  const spec = gatedBrowserbaseContract("https://guido.example.invalid");
  assert.deepEqual(spec.servers, [{ url: "https://guido.example.invalid" }]);
  assert.deepEqual(Object.keys(spec.paths), ["/api/browserbase"]);
  const { post, get } = spec.paths["/api/browserbase"];
  assert.equal(post.operationId, "start_rental_search");
  assert.equal(get.operationId, "get_rental_search");
  assert.equal(get.parameters[0].in, "query");
  const schema = post.requestBody.content["application/json"].schema;
  assert.deepEqual(schema.properties.resultSchema.required, ["type", "properties"]);
  assert.deepEqual(spec.security, [{ guidoGatewayKey: [] }]);
  assert.equal(spec.components.securitySchemes.guidoGatewayKey.name, "X-Guido-Tool-Key");
  assert.throws(() => gatedBrowserbaseContract("http://guido.example.invalid"));
  assert.throws(() => gatedBrowserbaseContract("https://guido.example.invalid?secret=value"));
});
