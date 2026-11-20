import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const workflow = new URL("../lib/rental-decision.ts", import.meta.url);
const mail = { subject: "Yosemite trip", message: "Landing at SFO before driving to Yosemite." };

async function setup(t, probability, gate) {
  const calls = [];
  for (const [key, value] of Object.entries({
    SUPERLINKED_API_KEY: "sie-test",
    STATSIG_SDK_KEY: "statsig-test",
    AMPLITUDE_API_KEY: "amplitude-test",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = new Request(url, init);
    calls.push(request);
    switch (request.url) {
      case "https://api.superlinked.com/v1/decisions":
        return Response.json({ answers: [
          { type: "predicate", name: "rental_needed", probability },
          { type: "predicate", name: "road_trip_detected", probability: 0.8 },
        ] });
      case "https://api.statsig.com/v1/check_gate":
        return gate === undefined
          ? new Response(null, { status: 503 })
          : Response.json({ name: "BROWSERBASE_ENABLED", value: gate });
      case "https://api2.amplitude.com/2/httpapi":
        return Response.json({});
      default:
        assert.fail(`Unexpected request to ${request.url}`);
    }
  });
  assert.ok(existsSync(workflow), "Guido needs a shared rental decision workflow");
  const { decideRental } = await import(workflow.href);
  const { observeAgentRun } = await import("../lib/amplitude.ts");
  return { calls, run: () => observeAgentRun("agentmail", (trace) => decideRental(mail, trace)) };
}

test("the rental predicate tells Superlinked to qualify explicit quote requests", async (t) => {
  const { run, calls } = await setup(t, 0.8, false);
  await run();
  const { questions } = await calls[0].json();
  const rental = questions.find(({ name }) => name === "rental_needed");
  assert.match(rental.instructions, /explicit (?:request|ask)[^.]*\b(?:rent|quote)[^.]*\balways qualifies\b/i);
});

for (const probability of [0.49, 0.5]) {
  test(`a ${probability * 100}% rental need skips Statsig`, async (t) => {
    const { run, calls } = await setup(t, probability);
    assert.equal(await run(), "skip");
    assert.deepEqual(calls.map((call) => new URL(call.url).hostname), [
      "api.superlinked.com", "api2.amplitude.com",
    ]);
  });
}

for (const [gate, route] of [[true, "browserbase"], [false, "firedrill"]]) {
  test(`an above-threshold score with Statsig ${gate} chooses ${route}`, async (t) => {
    const { run, calls } = await setup(t, 0.51, gate);
    assert.equal(await run(), route);
    assert.deepEqual(calls.map((call) => new URL(call.url).hostname), [
      "api.superlinked.com", "api.statsig.com", "api2.amplitude.com",
    ]);
    const [decision, flag, telemetry] = calls;
    assert.equal(decision.headers.get("authorization"), "Bearer sie-test");
    const input = await decision.json();
    assert.deepEqual(input.questions.map(({ name, type }) => ({ name, type })), [
      { name: "rental_needed", type: "predicate" },
      { name: "road_trip_detected", type: "predicate" },
    ]);
    assert.match(input.input, /Yosemite trip/);
    assert.match(input.input, /Landing at SFO/);
    assert.deepEqual((await flag.json()).user, { userID: "guido-guild" });
    const { events } = await telemetry.json();
    const spans = events.filter(({ event_type }) => event_type === "[Agent] Span").map(({ event_properties }) => event_properties);
    assert.equal(spans.find((span) => span["[Agent] Span Name"] === "superlinked.rental_decision")["[Agent] Rental Probability"], 0.51);
    assert.equal(spans.find((span) => span["[Agent] Span Name"] === "statsig.rental_gate")["[Agent] Output State"], route);
    assert.equal(events.at(-1).event_type, "[Agent] Session End");
    assert.equal(new Set(events.map(({ event_properties }) => event_properties["[Agent] Trace ID"])).size, 1);
    assert.doesNotMatch(JSON.stringify(events), /Yosemite|SFO|sie-test|statsig-test/);
  });
}

test("a malformed probability fails before evaluating the gate", async (t) => {
  const { run, calls } = await setup(t, 51, true);
  await assert.rejects(run(), /Superlinked returned an invalid rental probability/);
  assert.ok(calls.every(({ url }) => !url.includes("statsig")));
  const { events } = await calls.at(-1).json();
  assert.equal(events.at(-1).event_properties["[Agent] Output State"], "failed");
});

test("an unavailable Statsig gate fails before selecting a provider", async (t) => {
  const { run } = await setup(t, 0.9);
  await assert.rejects(run(), /Statsig rental gate unavailable/);
});
