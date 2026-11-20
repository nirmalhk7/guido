// Demo-only: email previews built from contracts/trip_result.sample.json.
// Every variant stays PLACEHOLDER / fixture. Real results never go through here.
import { readFileSync } from "node:fs";

const sample = JSON.parse(readFileSync(new URL("../../contracts/trip_result.sample.json", import.meta.url), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** "Sent" two minutes after the newest step, so ages are measured like a real send. */
export function sentAtFor(result) {
  const times = [...(result.audit_trail ?? []).map((s) => s.timestamp), ...(result.options ?? []).map((o) => o.source?.captured_at)]
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t));
  return (times.length ? Math.max(...times) : Date.parse("2026-11-20T13:45:00-08:00")) + 2 * 60_000;
}

/** Remove booking-time steps: the email goes out before anyone approves. */
function beforeApproval(r) {
  r.audit_trail = r.audit_trail.filter((s) => !["approval", "handoff"].includes(s.step_type));
  if (r.confirmation) Object.assign(r.confirmation, { human_approved: false, approved_at: null });
  return r;
}

function shiftIso(iso, ms) {
  const m = iso.match(/([+-]\d{2}:\d{2}|Z)$/);
  const off = m && m[0] !== "Z" ? (m[0][0] === "-" ? -1 : 1) * (Number(m[0].slice(1, 3)) * 60 + Number(m[0].slice(4))) : 0;
  return new Date(Date.parse(iso) + ms + off * 60_000).toISOString().replace(/\.\d{3}Z$/, m ? m[0] : "Z");
}

export const variants = {
  normal() {
    // Everyone answered: Rental Co F replied with no cars instead of timing out.
    const r = beforeApproval(clone(sample));
    r.coverage.providers = r.coverage.providers.map((p) => (p.result === "unavailable" ? { ...p, result: "no_cars", reason: null } : p));
    const step = r.audit_trail.find((s) => s.step_type === "coverage");
    if (step) step.plain_language_finding = "PLACEHOLDER All 6 rental companies answered. Rental Co F had no cars for your dates.";
    return { title: "Normal results", result: r };
  },
  partial() {
    // As in the sample: Rental Co F didn't answer in time; plus Rental Co E sent incomplete prices.
    const r = beforeApproval(clone(sample));
    r.coverage.providers = r.coverage.providers.map((p) =>
      p.provider.endsWith("Rental Co E") ? { ...p, result: "partial", reason: "missing_fees" } : p,
    );
    return { title: "Partial results", result: r };
  },
  nothing_fits() {
    const r = beforeApproval(clone(sample));
    r.trip_request.max_travel_minutes_to_branch = 5;
    r.options = r.options.map((o) =>
      o.status === "not_a_fit"
        ? o
        : { ...o, status: "not_a_fit", rank: null, tags: [], reason: `PLACEHOLDER About ${o.travel_to_branch.minutes} minutes from the airport, more than your 5-minute limit.` },
    );
    r.winner_summary = null;
    r.confirmation = null;
    return { title: "Empty: nothing fits", result: r };
  },
  no_cars() {
    const r = beforeApproval(clone(sample));
    r.options = [];
    r.coverage.providers = r.coverage.providers.map((p) => (p.result === "unavailable" ? p : { ...p, result: "no_cars", reason: null, options_returned: 0 }));
    r.winner_summary = null;
    r.confirmation = null;
    r.data_source.captured_at = null;
    return { title: "Empty: no cars found", result: r };
  },
  unreachable() {
    const r = beforeApproval(clone(sample));
    r.options = [];
    r.coverage.providers = r.coverage.providers.map((p, i) => ({ ...p, result: "unavailable", reason: i % 3 === 2 ? "no_access" : "timed_out", source: null, options_returned: 0 }));
    r.winner_summary = null;
    r.confirmation = null;
    r.data_source = { data_source: "octotrip_mcp", captured_at: null, environment: "unavailable" };
    return { title: "Empty: couldn't reach anyone", result: r };
  },
  stale() {
    // Same results, but every price was captured about 3 hours before the email is sent.
    const r = variants.normal().result;
    const sentAt = sentAtFor(r);
    r.options.forEach((o) => (o.source.captured_at = shiftIso(o.source.captured_at, -3 * 60 * 60_000)));
    return { title: "Older prices", result: r, sentAt };
  },
};
