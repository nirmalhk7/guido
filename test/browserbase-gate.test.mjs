import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const route = new URL("../api/browserbase.ts", import.meta.url);
const gateway = "https://example.invalid/api/browserbase";
const runId = "430f9571-fbad-4744-b3ff-8d4e4bd914c6";
const requirements = {
  pickupLocation: "SFO", returnLocation: "SFO",
  pickupAt: "2026-11-25T12:00:00-08:00", returnAt: "2026-11-26T12:00:00-08:00",
  vehicleClasses: ["premium SUV"], maxTotalUsd: 150,
};
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
        gateName: "BROWSERBASE_ENABLED",
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

const gateValue = (value) => () => Response.json({ name: "BROWSERBASE_ENABLED", value });

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

test("gate off returns three labeled Firedrill prices for the requested itinerary and class", async (t) => {
  const { POST } = await setup(t, gateValue(false));
  const operations = "https://simulator.example.invalid/leased-session/operations";
  const original = process.env.FIREDRILL_RENTAL_CONNECTION;
  process.env.FIREDRILL_RENTAL_CONNECTION = JSON.stringify({
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    http: { operations_url: operations, headers: { Authorization: "Bearer scoped-firedrill-token" } },
  });
  t.after(() => {
    if (original === undefined) delete process.env.FIREDRILL_RENTAL_CONNECTION;
    else process.env.FIREDRILL_RENTAL_CONNECTION = original;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const req = new Request(input, options);
    calls.push(req.url);
    if (req.url === "https://api.statsig.com/v1/check_gate") return gateValue(false)();
    assert.equal(req.url, operations + "/web/fetch");
    assert.equal(req.headers.get("authorization"), "Bearer scoped-firedrill-token");
    assert.match(req.headers.get("idempotency-key"), /^[0-9a-f-]{36}$/);
    const payload = await req.json();
    const host = new URL(payload.arguments.url).hostname;
    const rate = { "hertz.invalid": 12400, "enterprise.invalid": 12700, "avis.invalid": 12900 }[host];
    assert.ok(rate);
    assert.equal(new URL(payload.arguments.url).pathname, "/rental-rates");
    return Response.json({ status: 200, content: JSON.stringify({
      simulated: true, currency: "USD",
      dailyCents: { sedan: 7000, "premium sedan": 8500, SUV: 9000, "premium SUV": rate, "pickup truck": 10500 },
    }) });
  });
  const response = await POST(start({ ...request, rentalRequirements: requirements }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "SIMULATED");
  assert.equal(body.source, "Firedrill");
  assert.deepEqual(body.quotes.map(({ vendor, totalCents }) => [vendor, totalCents]), [
    ["Hertz", 12400], ["Enterprise", 12700], ["Avis", 12900],
  ]);
  assert.deepEqual(calls, ["https://api.statsig.com/v1/check_gate", ...Array(3).fill(operations + "/web/fetch")]);
});

test("a local Firedrill session uses its loopback invoke contract without cloud credentials", async (t) => {
  const { readFiredrillRates } = await import("../lib/firedrill-rental.ts");
  const previous = process.env.FIREDRILL_RENTAL_INVOKE_URL;
  process.env.FIREDRILL_RENTAL_INVOKE_URL = "http://127.0.0.1:9234/capability/instance/v1/invoke";
  t.after(() => {
    if (previous === undefined) delete process.env.FIREDRILL_RENTAL_INVOKE_URL;
    else process.env.FIREDRILL_RENTAL_INVOKE_URL = previous;
  });
  const { rateCards } = await import("../firedrill/rental-pricing/rate-cards.mjs");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const req = new Request(input, options);
    assert.equal(req.url, process.env.FIREDRILL_RENTAL_INVOKE_URL);
    assert.equal(req.headers.has("authorization"), false);
    const { operation, arguments: args } = await req.json();
    assert.equal(operation, "fetch");
    const vendor = Object.keys(rateCards).find((name) => args.url === "https://" + name.toLowerCase() + ".invalid/rental-rates");
    assert.ok(vendor);
    calls.push(vendor);
    return Response.json({ status: 200, content: JSON.stringify({ simulated: true, currency: "USD", dailyCents: rateCards[vendor] }) });
  });
  assert.deepEqual(await readFiredrillRates(), rateCards);
  assert.deepEqual(calls.sort(), ["Avis", "Enterprise", "Hertz"]);
});

test("the simulator covers exactly the three vendors and five rental classes", async () => {
  const { rateCards } = await import("../firedrill/rental-pricing/rate-cards.mjs");
  const { syntheticQuotes } = await import("../lib/firedrill-rental.ts");
  const { vehicleClasses, maxTotalUsd, ...itinerary } = requirements;
  const body = syntheticQuotes(itinerary, rateCards);
  assert.equal(body.simulated, true);
  assert.deepEqual([...new Set(body.quotes.map((quote) => quote.vendor))].sort(), ["Avis", "Enterprise", "Hertz"]);
  assert.deepEqual([...new Set(body.quotes.map((quote) => quote.vehicleClass))].sort(), [
    "SUV", "pickup truck", "premium SUV", "premium sedan", "sedan",
  ]);
  assert.equal(body.quotes.length, 15);
  assert.equal(syntheticQuotes({ ...itinerary, returnAt: itinerary.pickupAt }, rateCards), null);
  assert.equal(syntheticQuotes({ ...itinerary, maxTotalUsd: 1 }, rateCards).quotes.length, 0);
});

test("the Denver fixture includes DEN and 19 other distinct synthetic pickup locations", async () => {
  const { denverLocations } = await import("../firedrill/rental-pricing/denver-locations.mjs");
  assert.equal(denverLocations.length, 20);
  assert.equal(new Set(denverLocations.map(({ id }) => id)).size, 20);
  assert.equal(new Set(denverLocations.map(({ name }) => name)).size, 20);
  assert.equal(denverLocations.find(({ id }) => id === "DEN")?.name, "Denver International Airport");
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
  assert.equal(schema.properties.resultSchema, undefined);
  assert.deepEqual(schema.properties.provider.enum, ["browserbase", "firedrill"]);
  assert.deepEqual(schema.properties.rentalRequirements.required, ["pickupLocation", "returnLocation", "pickupAt", "returnAt"]);
  assert.ok(post.responses["200"].content["application/json"].schema.oneOf.some(
    ({ $ref }) => $ref === "#/components/schemas/SimulatedQuotes",
  ));
  assert.ok(get.parameters.some(({ name, in: location }) => name === "traceId" && location === "query"));
  assert.deepEqual(spec.security, [{ guidoGatewayKey: [] }]);
  assert.equal(spec.components.securitySchemes.guidoGatewayKey.name, "X-Guido-Tool-Key");
  assert.throws(() => gatedBrowserbaseContract("http://guido.example.invalid"));
  assert.throws(() => gatedBrowserbaseContract("https://guido.example.invalid?secret=value"));
});

test("a selected simulator run cannot turn into live browsing when Statsig changes", async (t) => {
  const { POST, calls } = await setup(t, gateValue(true));
  const response = await POST(start({ ...request, provider: "firedrill" }));
  assert.deepEqual(await response.json(), { status: "DISABLED", reason: "provider_changed" });
  assert.deepEqual(calls, ["https://api.statsig.com/v1/check_gate"]);
});

test("rental gateway records provider work on the source run's Amplitude trace", async (t) => {
  const { POST } = await setup(t, gateValue(true));
  const previous = process.env.AMPLITUDE_API_KEY;
  process.env.AMPLITUDE_API_KEY = "amplitude-test";
  t.after(() => {
    if (previous === undefined) delete process.env.AMPLITUDE_API_KEY;
    else process.env.AMPLITUDE_API_KEY = previous;
  });
  const traceId = "37bccd69-89ce-4d1a-bf3d-2279c74a8ee6";
  let events;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const req = new Request(input, init);
    if (req.url.includes("statsig.com")) return gateValue(true)();
    if (req.url.includes("browserbase.com")) {
      const body = await req.json();
      assert.equal(body.traceId, undefined);
      assert.equal(body.provider, undefined);
      return Response.json({ runId, status: "PENDING" }, { status: 201 });
    }
    assert.equal(req.url, "https://api2.amplitude.com/2/httpapi");
    ({ events } = await req.json());
    return Response.json({});
  });
  assert.equal((await POST(start({ ...request, provider: "browserbase", traceId }))).status, 201);
  assert.deepEqual(events.map(({ event_type, event_properties }) => [
    event_type, event_properties["[Agent] Span Name"], event_properties["[Agent] Trace ID"],
  ]), [
    ["[Agent] Span", "statsig.gateway_gate", traceId],
    ["[Agent] Span", "browserbase.start", traceId],
  ]);
  assert.doesNotMatch(JSON.stringify(events), /SFO|Compare Hertz/);
});

test("the Guild rental tool lets the gateway supply the Browserbase quote schema", async (t) => {
  const { POST } = await setup(t, gateValue(true));
  const { gatedBrowserbaseContract } = await import("../guild/browserbase/gated-contract.mjs");
  const operation = gatedBrowserbaseContract("https://guido.example.invalid").paths["/api/browserbase"].post;
  const schema = operation.requestBody.content["application/json"].schema;
  const { resultSchema: ignored, ...guildInput } = request;
  let upstream;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const req = new Request(input, init);
    if (req.url.includes("statsig.com")) return gateValue(true)();
    assert.equal(req.url, "https://api.browserbase.com/v1/agents/runs");
    upstream = await req.json();
    return Response.json({ runId, status: "PENDING" }, { status: 201 });
  });
  assert.equal((await POST(start({ ...guildInput, provider: "browserbase" }))).status, 201);
  assert.equal(schema.properties.resultSchema, undefined);
  assert.ok(!schema.required.includes("resultSchema"));
  assert.equal(upstream.resultSchema.type, "object");
  assert.deepEqual(Object.keys(upstream.resultSchema.properties).sort(), ["avis", "enterprise", "hertz"]);
  assert.equal(upstream.resultSchema.properties.hertz.properties.displayed_total.type, "string");
});

test("a Browserbase quota rejection is reported explicitly without trying another provider", async (t) => {
  const { POST } = await setup(t, gateValue(true));
  const called = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const req = new Request(input, init);
    called.push(new URL(req.url).hostname);
    if (req.url.includes("statsig.com")) return gateValue(true)();
    return Response.json({ statusCode: 402, error: "Payment Required" }, { status: 402 });
  });
  const response = await POST(start({ ...request, provider: "browserbase" }));
  assert.deepEqual(await response.json(), { status: "DISABLED", reason: "browserbase_quota_exhausted" });
  assert.deepEqual(called, ["api.statsig.com", "api.browserbase.com"]);
});
