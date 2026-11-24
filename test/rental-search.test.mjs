import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { POST } from "../lib/rental/http.ts";
import { loadSuppliers } from "../lib/rental/config.ts";
import { compareRentals } from "../lib/rental/search.ts";

const sampleTrip = JSON.parse(await readFile(new URL("../examples/rental-trip.json", import.meta.url), "utf8"));
const trip = { ...sampleTrip, origin: { area: "Maple Junction" }, destination: { area: "Harbor Point" } };
const completeCharges = {
  base: 20_000, taxes: "included", airport: 0, oneWay: 1800, youngDriver: 0,
  additionalDriver: 0, otherMandatory: 0,
};
const localBranch = {
  id: "local", name: "Test Downtown", kind: "non_airport",
  coordinates: { latitude: 40, longitude: -80 },
  centerToPickup: { minutes: 13, costCents: 400 },
  returnToCenter: { minutes: 9, costCents: 800 },
};
const airport = {
  id: "apt", name: "Test Airport", kind: "airport",
  coordinates: { latitude: 40.1, longitude: -80 },
  centerToPickup: { minutes: 6, costCents: 1200 },
  returnToCenter: { minutes: 20, costCents: 2500 },
};

const tool = (id, implementation = {}, environment = "live") => ({
  id, environment, create: () => ({
    async listBranches() { return { branches: [localBranch, airport] }; },
    async quote() { return quote(); },
    ...implementation,
  }),
});
const supplier = (tools, id = "test") => ({ id, name: "Test Rentals", tools });
const quote = (charges = completeCharges, properties = {}) => ({
  status: "available",
  offers: [{ id: "car", vehicle: "Economy", carClass: "economy", currency: "USD", charges, ...properties }],
});
const sameCity = { ...trip, destination: undefined };
const onePair = {
  ...trip,
  origin: { area: "Maple Junction", candidateBranches: [{ supplier: "test", branchId: "local" }] },
  destination: { area: "Harbor Point", candidateBranches: [{ supplier: "test", branchId: "apt" }] },
};

test("fixture CLI recommends a complete one-way trip and discloses unpriced drop fees", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["bin/rental-search.ts", "--fixture", "examples/rental-trip.json"], { encoding: "utf8" }));
  assert.equal(result.environment, "fixture");
  assert.equal(result.recommendation, "sample/belmont/sfo/economy");
  assert.equal(result.options[0].estimatedTotalCents, 15740);
  assert.equal(result.options[0].source.environment, "fixture");
  assert.equal(result.request.pickupAt, sampleTrip.pickupAt);
  assert.equal(result.request.returnAt, sampleTrip.returnAt);
  assert.equal(result.coverage[0].pairsChecked, 9);
  assert.equal(result.coverage[0].pairs.length, 9);
  assert.equal(result.coverage[0].pairs.filter((pair) => pair.pickup.id === pair.return.id).length, 3);
  const reverse = result.options.find((item) => item.pickup.id === "sfo" && item.return.id === "belmont");
  assert.ok(reverse.estimatedTotalCents > result.options[0].estimatedTotalCents);
  const belmontReturns = new Map(result.options.filter(({ pickup }) => pickup.id === "belmont")
    .map((option) => [option.return.id, option.estimatedTotalCents]));
  assert.ok(belmontReturns.get("sfo") < belmontReturns.get("san-mateo"));
  assert.ok(belmontReturns.get("san-mateo") < belmontReturns.get("belmont"));
  assert.ok(result.options.filter((item) => item.pickup.id === item.return.id)
    .every((item) => item.estimatedTotalCents > result.options[0].estimatedTotalCents));
  assert.deepEqual(new Set(result.options.map(({ pickup }) => pickup.kind)), new Set(["airport", "non_airport"]));
  assert.deepEqual(new Set(result.options.map(({ return: dropoff }) => dropoff.kind)), new Set(["airport", "non_airport"]));
  const incomplete = result.options.find((item) => item.pickup.id === "san-mateo" && item.return.id === "sfo");
  assert.equal(incomplete.status, "provisional");
  assert.equal(incomplete.rank, null);
  assert.deepEqual(incomplete.missingCharges, ["oneWay"]);
  assert.equal(incomplete.estimatedTotalCents, null);
});

test("quotes only same-branch returns in round-trip mode and keeps pickup and return access independent", async () => {
  const pairs = [];
  const sources = [supplier([tool("primary", { async quote(input) {
    pairs.push([input.pickupId, input.returnId]);
    return quote();
  } })])];
  const result = await compareRentals({ ...sameCity, preferences: { oneWay: false } }, sources, "live");
  assert.deepEqual(pairs, [["apt", "apt"], ["local", "local"]]);
  const localOffer = result.options.find(({ pickup }) => pickup.id === "local");
  assert.equal(localOffer.pickup.access.minutes, 13);
  assert.equal(localOffer.return.access.minutes, 9);
  assert.equal(localOffer.estimatedTotalCents, 23000);
  assert.equal(result.attempts.filter(({ operation }) => operation === "pickup").length, 1);
});

test("form preferences constrain branch filters, seats, travel and cost; missing values stay provisional", async () => {
  const all = [supplier([tool("primary", { async quote() { return quote(completeCharges, { seats: 4 }); } })])];
  const result = await compareRentals({
    ...trip,
    preferences: { pickupKind: "airport", returnKind: "non_airport", minSeats: 5, maxPickupMinutes: 5, maxTotalCents: 10000 },
  }, all, "live");
  assert.equal(result.options.length, 1);
  const [option] = result.options;
  assert.equal(option.pickup.id, "apt");
  assert.equal(option.return.id, "local");
  assert.equal(option.status, "filtered");
  assert.match(option.reasons.join(" "), /too few seats.*Pickup travel time.*Estimated trip cost/);
  const unknown = await compareRentals({ ...onePair, preferences: { minSeats: 5 } }, [supplier([tool("primary")])], "live");
  assert.equal(unknown.recommendation, null);
  assert.equal(unknown.options[0].status, "provisional");
});

test("ranking priorities use the selected leg and never recommend an apparently cheaper incomplete quote", async () => {
  const sources = [supplier([tool("primary", { async quote({ pickupId, returnId }) {
    const base = pickupId === "local" && returnId === "local" ? 100 : 20000;
    return quote({ ...completeCharges, base, ...(base === 100 && { oneWay: null }) });
  } })])];
  for (const [priority, best] of [
    ["total_cost", "apt/local"], ["pickup_access", "apt/local"], ["return_access", "apt/local"],
  ]) {
    const result = await compareRentals({ ...sameCity, preferences: { priority } }, sources, "live");
    assert.equal(result.recommendation, `test/${best}/car`);
    assert.equal(result.options.at(-1).rank, null);
    assert.equal(result.options.at(-1).knownRentalCents, 100);
  }
  const cost = await compareRentals(sameCity, [supplier([tool("regular")])], "live");
  const access = await compareRentals({ ...sameCity, preferences: { priority: "pickup_access" } }, [supplier([tool("regular")])], "live");
  assert.equal(cost.recommendation, "test/local/local/car");
  assert.equal(access.recommendation, "test/apt/local/car");
});

test("precise location and access data stay local, and straight-line distance is not a trip-time estimate", async () => {
  const calls = [];
  const sources = [supplier([tool("primary", {
    async listBranches(input) { calls.push(input); return { branches: [localBranch, airport] }; },
    async quote(input) { calls.push(input); return quote(); },
  })])];
  const result = await compareRentals({
    ...onePair,
    origin: { ...onePair.origin, label: "Synthetic private address", coordinates: { latitude: 40, longitude: -80 } },
    destination: { ...onePair.destination, accessByBranch: [{ supplier: "test", branchId: "apt", minutes: 3, costCents: 0 }] },
  }, sources, "live");
  assert.deepEqual(calls.filter(({ area }) => area).map(({ area }) => area), ["Maple Junction", "Harbor Point"]);
  assert.deepEqual(Object.keys(calls.at(-1)).sort(), ["carClass", "currency", "driverAge", "drivers", "minSeats", "pickupAt", "pickupId", "returnAt", "returnId"]);
  assert.doesNotMatch(JSON.stringify(calls), /Synthetic|latitude|coordinates|accessByBranch/);
  const [option] = result.options;
  assert.equal(option.pickup.access.straightLineKm, 0);
  assert.equal(option.pickup.access.minutes, null);
  assert.equal(option.pickup.access.costCents, null);
  assert.equal(option.return.access.basis, "user_estimate");
  assert.equal(result.recommendation, null);
});

test("fails over per supplier and branch pair without combining fee evidence or mixing fixture sources", async () => {
  const sources = [supplier([
    tool("primary", {
      async listBranches() { throw new Error("private implementation detail"); },
      async quote() { return quote({ ...completeCharges, oneWay: null }); },
    }),
    tool("alternate", { async quote() { return quote({ ...completeCharges, base: 26000 }); } }),
    tool("sample", { async quote() { assert.fail("Live search must never use fixture"); } }, "fixture"),
  ])];
  const result = await compareRentals(onePair, sources, "live");
  assert.equal(result.coverage[0].status, "complete");
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].source.id, "alternate");
  assert.equal(result.options[0].charges.base, 26000);
  assert.deepEqual(result.attempts.filter(({ operation }) => operation === "quote").map(({ outcome }) => outcome), ["partial", "complete"]);
  assert.doesNotMatch(JSON.stringify(result), /private implementation detail|sample/);
});

test("unavailable, invalid data, cancellation, and confirmed empty inventory have distinct outcomes", async () => {
  for (const [expected, implementation] of [
    ["unavailable", { async quote() { return { status: "unavailable", reason: "Supplier blocked the request." }; } }],
    ["unavailable", { async quote() { return { status: "available", offers: [] }; } }],
    ["no_cars", { async quote() { return { status: "no_cars" }; } }],
    ["no_matching_branches", { async listBranches() { return { branches: [] }; } }],
  ]) {
    const result = await compareRentals(onePair, [supplier([tool("primary", implementation)])], "live");
    assert.equal(result.coverage[0].status, expected);
    if (expected !== "no_matching_branches") assert.equal(result.coverage[0].pairs[0].status, expected);
    assert.equal(result.recommendation, null);
  }
  const cancel = new AbortController();
  let closed = false;
  const source = tool("slow", { async listBranches() { cancel.abort(); await new Promise(() => {}); }, async close() { closed = true; } });
  const result = await compareRentals(onePair, [supplier([source])], "live", cancel.signal);
  assert.equal(result.coverage[0].status, "unavailable");
  assert.equal(closed, true);
});

test("loads a configured module and continues after an earlier module is absent", async () => {
  const temp = await mkdtemp(join(tmpdir(), "guido-config-"));
  try {
    await writeFile(join(temp, "adapter.mjs"), `export const createTool = (settings) => ({
      async listBranches() { return { branches: [${JSON.stringify(localBranch)}, ${JSON.stringify(airport)}] }; },
      async quote() { return settings.quote; }
    });`);
    const path = join(temp, "providers.json");
    await writeFile(path, JSON.stringify([
      { id: "test", name: "Test", sources: [
        { id: "missing", kind: "module", file: "./missing.mjs" },
        { id: "module", kind: "module", file: "./adapter.mjs", settings: { quote: quote() } },
      ] },
    ]));
    const result = await compareRentals(onePair, await loadSuppliers("live", path), "live");
    assert.equal(result.options[0].source.id, "module");
    assert.match(result.attempts[0].reason, /module could not be loaded/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("API rejects invalid dates, rejects a checkout action and avoids caching responses", async () => {
  const request = (body, type = "application/json") => new Request("http://local/api/rental-search", {
    method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request({ trip }, "text/plain"))).status, 415);
  assert.equal((await POST(request({ trip, action: "book" }))).status, 400);
  assert.equal((await POST(request({ trip: { ...trip, returnAt: trip.pickupAt } }))).status, 400);
  assert.equal((await POST(request({ trip, data: "x".repeat(35_000) }))).status, 413);
  const response = await POST(request({ trip: sampleTrip, environment: "fixture" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).environment, "fixture");
});

test("reports omitted combinations and individual pairs untried when the remaining search is canceled", async () => {
  const branches = Array.from({ length: 7 }, (_, i) => ({ ...localBranch, id: `local-${i}`, name: `Sample ${i}` }));
  branches.push(airport);
  const abort = new AbortController();
  const result = await compareRentals(sameCity, [supplier([tool("limited", {
    async listBranches() { return { branches }; },
    async quote() { abort.abort(); return quote(); },
  })])], "live", abort.signal);
  const [coverage] = result.coverage;
  assert.equal(coverage.pairsPlanned, 36);
  assert.equal(coverage.omitted.pairs, 28);
  assert.equal(coverage.omitted.pickups.length, 2);
  assert.ok(coverage.pairs.some(({ pickup }) => pickup.id === "apt"));
  assert.ok(coverage.pairs.some(({ status }) => status === "untried"));
  assert.equal(coverage.pairs.filter(({ status }) => status !== "untried").length, coverage.pairsChecked);
});

test("the default live selection reports unavailable and keeps synthetic offers out", async () => {
  const result = await compareRentals(sampleTrip, await loadSuppliers("live", ""), "live");
  assert.equal(result.environment, "live");
  assert.equal(result.coverage[0].status, "unavailable");
  assert.equal(result.attempts[0].source, "playwright");
  assert.match(result.attempts[0].reason, /GUIDO_RENTAL_CONFIG/);
  assert.deepEqual(result.options, []);
});
