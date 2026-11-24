import { chargeKeys, type Access, type Branch, type Environment, type Offer, type Trip } from "./contracts.ts";

export type EvaluatedBranch = Branch & {
  access: Access & { basis: "user_estimate" | "area_center" | "unknown"; straightLineKm: number | null };
};
export type OptionFacts = {
  id: string;
  supplier: string;
  pickup: EvaluatedBranch;
  return: EvaluatedBranch;
  offer: Offer;
  source: { id: string; environment: Environment; observedAt: string; url?: string };
};

type Preferences = Trip["preferences"];
const priorities = {
  total_cost: "complete estimated trip cost, then pickup and return travel time",
  pickup_access: "pickup travel time, then estimated trip cost and return travel time",
  return_access: "return travel time, then estimated trip cost and pickup travel time",
} satisfies Record<Preferences["priority"], string>;

export function evaluateOption(option: OptionFacts, preferences: Preferences) {
  const charges = Object.fromEntries(chargeKeys.map((key) => [key, option.offer.charges[key] ?? null])) as
    Record<typeof chargeKeys[number], number | "included" | null>;
  const missingCharges = chargeKeys.filter((key) => charges[key] === null);
  const knownRentalCents = Object.values(charges).reduce<number | null>((sum, value) =>
    typeof value === "number" ? (sum ?? 0) + value : sum, null);
  const rentalTotalCents = missingCharges.length ? null : knownRentalCents;
  const pickup = option.pickup.access;
  const dropoff = option.return.access;
  const estimatedTotalCents = rentalTotalCents === null || pickup.costCents === null || dropoff.costCents === null
    ? null
    : rentalTotalCents + pickup.costCents + dropoff.costCents;
  // A subtotal in another currency cannot be combined with local access estimates.
  const currencyMatches = option.offer.currency === preferences.currency;
  const estimatedTotal = currencyMatches ? estimatedTotalCents : null;
  const reasons: string[] = [];
  const unknowns: string[] = [];

  if (!currencyMatches) reasons.push(`Quote currency is ${option.offer.currency}; requested ${preferences.currency}.`);
  if (preferences.carClass && option.offer.carClass !== preferences.carClass) reasons.push("Vehicle class differs from the request.");
  if (preferences.minSeats !== undefined) {
    if (option.offer.seats === undefined) unknowns.push("Seat count is unknown.");
    else if (option.offer.seats < preferences.minSeats) reasons.push("Vehicle has too few seats.");
  }
  const limits = [
    [preferences.maxPickupMinutes, pickup.minutes, "Pickup travel time"],
    [preferences.maxReturnMinutes, dropoff.minutes, "Return travel time"],
    [preferences.maxTotalCents, estimatedTotal, "Estimated trip cost"],
  ] as const;
  for (const [limit, value, metric] of limits) {
    if (limit === undefined) continue;
    if (value === null) unknowns.push(`${metric} is unknown.`);
    else if (value > limit) reasons.push(`${metric} exceeds the requested limit.`);
  }
  if (missingCharges.length) unknowns.push("One or more required rental charges are unknown.");
  if (pickup.costCents === null) unknowns.push("Pickup access cost is unknown.");
  if (dropoff.costCents === null) unknowns.push("Return access cost is unknown.");
  if (preferences.priority === "pickup_access" && pickup.minutes === null) unknowns.push("Pickup travel time is unknown.");
  if (preferences.priority === "return_access" && dropoff.minutes === null) unknowns.push("Return travel time is unknown.");

  return {
    ...option,
    charges,
    missingCharges,
    knownRentalCents,
    rentalTotalCents,
    estimatedTotalCents: estimatedTotal,
    status: reasons.length ? "filtered" as const : unknowns.length ? "provisional" as const : "eligible" as const,
    reasons: [...new Set([...reasons, ...unknowns])],
    rank: null as number | null,
  };
}

export type EvaluatedOption = ReturnType<typeof evaluateOption>;
const statusOrder = { eligible: 0, provisional: 1, filtered: 2 };
const sortValue = (value: number | null) => value ?? Number.MAX_SAFE_INTEGER;

export function rankOptions(options: OptionFacts[], preferences: Preferences) {
  const { priority } = preferences;
  const metric = (option: EvaluatedOption) => ({
    total_cost: option.estimatedTotalCents,
    pickup_access: option.pickup.access.minutes,
    return_access: option.return.access.minutes,
  })[priority];
  const sorted = options.map((option) => evaluateOption(option, preferences)).sort((a, b) =>
    statusOrder[a.status] - statusOrder[b.status]
    || sortValue(metric(a)) - sortValue(metric(b))
    || sortValue(a.estimatedTotalCents) - sortValue(b.estimatedTotalCents)
    || sortValue(a.pickup.access.minutes) - sortValue(b.pickup.access.minutes)
    || sortValue(a.return.access.minutes) - sortValue(b.return.access.minutes)
    || a.id.localeCompare(b.id, "en"));
  let rank = 0;
  for (const option of sorted) {
    if (option.status === "eligible") option.rank = ++rank;
  }
  return { options: sorted, rule: `Eligible offers are ranked by ${priorities[priority]}. Ties use the option ID.` };
}
