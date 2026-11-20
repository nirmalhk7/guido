// Re-ranking in the browser, following the rules written in
// contracts/trip_result.schema.json → $defs/ranking_priority.
import type { Option, RankingPriority, TripResult } from "./contract";
import { STALE_AFTER_MINUTES } from "./settings";

type Key = (number | string)[];

function cancellationKey(o: Option): Key {
  const c = o.cancellation;
  const order = { free: 0, partial: 1, non_refundable: 2, unknown: 3 }[c.type];
  let within = 0;
  if (c.type === "free") within = c.free_until ? -Date.parse(c.free_until) : -Infinity; // later deadline = better
  if (c.type === "partial") within = c.fee ?? Infinity; // lower fee = better
  return [order, within];
}

const primaryKey: Record<RankingPriority, (o: Option) => Key> = {
  lowest_total_cost: (o) => [o.total_trip_cost],
  closest_pickup: (o) => [o.travel_to_branch.minutes],
  most_flexible_cancellation: cancellationKey,
};

function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Returns every option with status and rank set for the given priority.
 * Eligible options are re-sorted; "not_a_fit" options keep their status and reason.
 */
export function rankOptions(options: Option[], priority: RankingPriority): Option[] {
  const eligible = options.filter((o) => o.status !== "not_a_fit");
  const notAFit = options.filter((o) => o.status === "not_a_fit");
  const sorted = [...eligible].sort((a, b) =>
    compareKeys(
      [...primaryKey[priority](a), a.total_trip_cost, a.travel_to_branch.minutes, a.option_id],
      [...primaryKey[priority](b), b.total_trip_cost, b.travel_to_branch.minutes, b.option_id],
    ),
  );
  const ranked = sorted.map((o, i) => ({
    ...o,
    rank: i + 1,
    status: (i === 0 ? "recommended" : "alternative") as Option["status"],
  }));
  const notAFitSorted = [...notAFit].sort((a, b) => a.total_trip_cost - b.total_trip_cost);
  return [...ranked, ...notAFitSorted.map((o) => ({ ...o, rank: null }))];
}

export type PageKind = "results" | "nothing_fits" | "no_cars" | "unreachable";

/** Which headline state to show (see docs/CONTEXT.md §7). */
export function pageKind(result: TripResult): PageKind {
  if (result.options.some((o) => o.status !== "not_a_fit")) return "results";
  if (result.options.length > 0) return "nothing_fits";
  if (result.coverage.providers.some((p) => p.result === "no_cars")) return "no_cars";
  return "unreachable";
}

export function isStale(iso: string, now: number = Date.now()): boolean {
  return now - Date.parse(iso) > STALE_AFTER_MINUTES * 60_000;
}

/** Sum of every fee and tax line (everything except the base rental and travel). */
export function feesAndTaxes(o: Option): number {
  return (
    o.airport_concession_fee +
    o.taxes +
    o.other_fees +
    o.additional_driver_fee +
    o.young_renter_fee +
    o.one_way_fee
  );
}
