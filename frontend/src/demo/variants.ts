// Demo-only: builds preview versions of the sample result so every state can be
// shown. Real data never goes through this file.
import sample from "@contracts/trip_result.sample.json";
import type { TripResult } from "@/lib/contract";

export const sampleResult = sample as unknown as TripResult;

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Shift an ISO time by `ms`, keeping its original "-08:00"-style offset. */
export function shiftKeepingOffset(iso: string, ms: number): string {
  const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
  const suffix = m ? m[0] : "Z";
  const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const local = new Date(Date.parse(iso) + ms + offsetMin * 60_000);
  return local.toISOString().replace(/\.\d{3}Z$/, suffix);
}

/**
 * Moves the sample's "when it was checked" times so the newest one is
 * `minutesAgo` before now. Trip dates are left alone. Keeps the demo from
 * looking stale just because the sample file was written earlier in the day.
 */
export function rebaseTimes(result: TripResult, minutesAgo = 2, now = Date.now()): TripResult {
  const r = clone(result);
  const stamps = [
    ...r.options.map((o) => o.source.captured_at),
    ...r.audit_trail.filter((s) => s.step_type !== "approval" && s.step_type !== "handoff").map((s) => s.timestamp),
  ];
  const newest = Math.max(...stamps.map((s) => Date.parse(s)));
  const shift = now - minutesAgo * 60_000 - newest;
  const move = (iso: string | null) => (iso ? shiftKeepingOffset(iso, shift) : iso);
  r.options.forEach((o) => (o.source.captured_at = move(o.source.captured_at)!));
  r.audit_trail.forEach((s) => (s.timestamp = move(s.timestamp)!));
  r.coverage.source_attempts.forEach((a) => (a.attempted_at = move(a.attempted_at)));
  r.data_source.captured_at = move(r.data_source.captured_at);
  if (r.confirmation) r.confirmation.approved_at = move(r.confirmation.approved_at);
  return r;
}

export type DemoStateKey =
  | "results"
  | "loading"
  | "slow"
  | "stale"
  | "outdated"
  | "nothing_fits"
  | "no_cars"
  | "unreachable"
  | "approved";

export const DEMO_STATES: DemoStateKey[] = [
  "results",
  "loading",
  "slow",
  "stale",
  "outdated",
  "nothing_fits",
  "no_cars",
  "unreachable",
  "approved",
];

/** What the page is given: a result plus "still running" signals a live search would send. */
export interface PageInput {
  result: TripResult;
  /** Agent is still working: reveal steps one by one, then show results. */
  loading?: boolean;
  /** Rental companies still being checked. */
  pending?: string[];
  /** After this long, pending companies are treated as timed out (the result already says so). */
  pendingForMs?: number;
  /** The trip was changed after these results were found. */
  outdated?: boolean;
}

const AFTER_RESULTS = new Set(["ranking", "confirmation", "approval", "handoff"]);
const SLOW_PROVIDER = "Avis";

function withoutWinner(r: TripResult, keepSteps: (t: string | undefined) => boolean): TripResult {
  r.winner_summary = null;
  r.confirmation = null;
  r.audit_trail = r.audit_trail.filter((s) => keepSteps(s.step_type));
  return r;
}

/** Build the preview for one demo state. Every variant stays clearly PLACEHOLDER / fixture. */
export function demoInput(key: DemoStateKey, now = Date.now()): PageInput {
  const base = rebaseTimes(sampleResult, 2, now);
  switch (key) {
    case "approved":
      return { result: base };
    case "loading":
      return { result: awaitingApproval(base), loading: true };
    case "slow":
      return { result: awaitingApproval(base), pending: [SLOW_PROVIDER], pendingForMs: 8000 };
    case "stale":
      return { result: awaitingApproval(rebaseTimes(sampleResult, 180, now)) };
    case "outdated":
      return { result: awaitingApproval(base), outdated: true };
    case "nothing_fits": {
      const r = clone(base);
      r.trip_request.max_travel_minutes_to_branch = 5;
      r.options = r.options.map((o) =>
        o.status === "not_a_fit"
          ? o
          : {
              ...o,
              status: "not_a_fit",
              rank: null,
              tags: [],
              reason: `PLACEHOLDER About ${o.travel_to_branch.minutes} minutes from the airport, more than your 5-minute limit.`,
            },
      );
      const step = r.audit_trail.find((s) => s.step_type === "filter");
      if (step) step.plain_language_finding = "PLACEHOLDER Set aside all 7 options. None met every need on your trip.";
      return { result: withoutWinner(r, (t) => !AFTER_RESULTS.has(t ?? "")) };
    }
    case "no_cars": {
      const r = clone(base);
      r.options = [];
      r.coverage.providers = r.coverage.providers.map((p) =>
        p.provider === SLOW_PROVIDER
          ? { ...p, result: "unavailable", reason: "timed_out", source: null, options_returned: 0 }
          : { ...p, result: "no_cars", reason: null, options_returned: 0 },
      );
      r.data_source.captured_at = null;
      const step = r.audit_trail.find((s) => s.step_type === "coverage");
      if (step) step.plain_language_finding = `PLACEHOLDER 2 of 3 rental companies answered, but none have cars for your dates. ${SLOW_PROVIDER} didn't respond in time.`;
      return { result: withoutWinner(r, (t) => t === "request" || t === "search" || t === "coverage") };
    }
    case "unreachable": {
      const r = clone(base);
      r.options = [];
      r.coverage.providers = r.coverage.providers.map((p, i) => ({
        ...p,
        result: "unavailable",
        reason: i % 3 === 2 ? "no_access" : "timed_out",
        source: null,
        options_returned: 0,
      }));
      r.coverage.source_attempts = r.coverage.source_attempts.map((a) =>
        a.source === "octotrip_mcp" ? { ...a, outcome: "unavailable", reason: "timed_out", environment: "unavailable" } : a,
      );
      r.data_source = { data_source: "octotrip_mcp", captured_at: null, environment: "unavailable" };
      const step = r.audit_trail.find((s) => s.step_type === "coverage");
      if (step) step.plain_language_finding = "PLACEHOLDER None of the 3 rental companies answered in time. OctoTrip timed out, and I had no saved prices for this trip.";
      return { result: withoutWinner(r, (t) => t === "request" || t === "search" || t === "coverage") };
    }
    default:
      return { result: awaitingApproval(base) };
  }
}

/** The sample as it looks before the person has approved anything. */
export function awaitingApproval(result: TripResult): TripResult {
  const r = clone(result);
  r.audit_trail = r.audit_trail.filter((s) => s.step_type !== "approval" && s.step_type !== "handoff");
  if (r.confirmation) {
    r.confirmation.human_approved = false;
    r.confirmation.approved_at = null;
  }
  return r;
}
