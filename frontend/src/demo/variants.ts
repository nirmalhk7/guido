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
