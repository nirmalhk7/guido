// Writes stress-test results to samples/stress/*.json, built from the contract
// sample. They're deliberately awkward so the template is tested against messy
// real data. Run: npm run stress:make   (then npm run render:email)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const sample = JSON.parse(readFileSync(new URL("../../contracts/trip_result.sample.json", import.meta.url), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const OUT = new URL("./stress/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const base = () => {
  const r = clone(sample);
  r.audit_trail = r.audit_trail.filter((s) => !["approval", "handoff"].includes(s.step_type));
  return r;
};

const files = {
  "long-names-and-reasons": () => {
    const r = base();
    r.trip_request.start_area = "PLACEHOLDER Dallas–Fort Worth Metropolitan Area and Surrounding Counties, Texas";
    r.options.forEach((o, i) => {
      o.brand = `PLACEHOLDER Extraordinarily Long Rental Car Company Name Incorporated Number ${i + 1}`;
      o.pickup_branch = "PLACEHOLDER Dallas Fort Worth International Airport Consolidated Rental Car Center, Terminal Shuttle Stop 4B, South Entrance";
      o.dropoff_branch = o.pickup_branch;
      o.reason =
        "PLACEHOLDER This option is a very good choice because it has a remarkably low base rate, waives the airport concession recovery fee entirely, includes a free second driver, offers unlimited mileage, and the branch is open twenty-four hours a day so a late arrival is not a problem at all.";
      o.travel_to_branch.note = "PLACEHOLDER Take the free terminal shuttle from lower level, door 4, then walk about five minutes";
      o.tags = ["lowest_total_cost", "closest_pickup", "most_flexible_cancellation", "free_shuttle", "no_airport_fees", "unlimited_miles", "some_unknown_tag"];
    });
    r.winner_summary.one_line_explanation = r.options[0].reason;
    r.coverage.providers.forEach((p) => (p.provider = `PLACEHOLDER ${p.provider.replace("PLACEHOLDER ", "")} International Holdings Group`));
    return { _title: "Long names and long reasons", result: r };
  },

  "zero-options": () => {
    const r = base();
    r.options = [];
    r.winner_summary = null;
    r.confirmation = null;
    r.coverage = { source_attempts: [], providers: [] };
    r.data_source = { data_source: "octotrip_mcp", captured_at: null, environment: "unavailable" };
    return { _title: "0 options, no coverage info", result: r };
  },

  "one-option": () => {
    const r = base();
    r.options = [r.options[0]];
    r.coverage.providers = [r.coverage.providers[0]];
    return { _title: "1 option", result: r };
  },

  "twelve-options": () => {
    const r = base();
    const fits = r.options.filter((o) => o.status !== "not_a_fit");
    const extra = Array.from({ length: 9 }, (_, i) => {
      const o = clone(fits[i % fits.length]);
      o.option_id = `opt_x${i}`;
      o.brand = `PLACEHOLDER Rental Co ${String.fromCharCode(72 + i)}`;
      o.total_trip_cost += (i + 1) * 1250;
      o.status = "alternative";
      return o;
    });
    const eligible = [...fits, ...extra].sort((a, b) => a.total_trip_cost - b.total_trip_cost);
    eligible.forEach((o, i) => Object.assign(o, { rank: i + 1, status: i === 0 ? "recommended" : "alternative" }));
    r.options = [...eligible, ...r.options.filter((o) => o.status === "not_a_fit")];
    r.winner_summary.recommended_option_id = eligible[0].option_id;
    return { _title: "12 options that fit (+4 that don't)", result: r };
  },

  "missing-fields": () => {
    const r = base();
    delete r.currency;
    r.trip_request = { start_area: "", airports: [], ranking_priority: "closest_pickup" };
    r.winner_summary = null;
    delete r.coverage;
    r.options = r.options.slice(0, 3).map((o, i) => {
      const keep = { option_id: o.option_id, status: i === 0 ? "recommended" : "alternative", rank: i + 1 };
      if (i === 0) Object.assign(keep, { brand: null, total_trip_cost: null, reason: "   ", tags: null, cancellation: { type: "unknown" } });
      if (i === 1) Object.assign(keep, { brand: "PLACEHOLDER Rental Co B", total_trip_cost: 41516, pickup_branch: "undefined", seats: "five", source: { name: "mystery_source" } });
      if (i === 2) Object.assign(keep, { brand: "PLACEHOLDER Rental Co C", total_trip_cost: Number.NaN, car_class: "null", travel_to_branch: {} });
      return keep;
    });
    return { _title: "Missing and junk fields", result: r };
  },

  "partial-coverage": () => {
    const r = base();
    const reasons = ["timed_out", "timed_out", "no_access", "error", "not_set_up", "incomplete_data"];
    r.coverage.providers = [
      ...r.coverage.providers.slice(0, 4),
      ...reasons.map((reason, i) => ({
        provider: `PLACEHOLDER Rental Co ${String.fromCharCode(71 + i)}`,
        result: reason === "incomplete_data" ? "partial" : "unavailable",
        reason,
        source: null,
        options_returned: 0,
      })),
    ];
    return { _title: "Partial coverage: 10 companies, 6 with problems", result: r };
  },
};

for (const [name, make] of Object.entries(files)) {
  writeFileSync(new URL(`${name}.json`, OUT), JSON.stringify(make(), null, 2) + "\n");
}
console.log(`Wrote ${Object.keys(files).length} stress samples to email/samples/stress/`);
