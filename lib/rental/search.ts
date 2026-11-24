import {
  catalogSchema, chargeKeys, quoteSchema, tripSchema, ToolReadError,
  type Branch, type CatalogRequest, type Environment, type QuoteRequest, type Supplier, type Tool, type Trip,
} from "./contracts.ts";
import { rankOptions, type EvaluatedBranch, type OptionFacts } from "./rank.ts";

const maxBranches = 6;
const maxConcurrentQuotes = 3;
const operationTimeout = 8_000;
const searchTimeout = 35_000;
type Leg = "pickup" | "return";
type Endpoint = Trip["origin"];
type ProviderTool = Supplier["tools"][number] & { tool: Tool | null };
type Attempt = {
  supplierId: string;
  source: string;
  environment: Environment;
  operation: Leg | "quote";
  pickupId?: string;
  returnId?: string;
  at: string;
  outcome: "complete" | "partial" | "unavailable" | "no_cars";
  reason?: string;
};

async function invoke<T>(operation: (signal: AbortSignal) => Promise<T>, searchSignal: AbortSignal) {
  const signal = AbortSignal.any([searchSignal, AbortSignal.timeout(operationTimeout)]);
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const timeout = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([timeout, operation(signal)]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function failure(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") return "The source timed out.";
  if (error instanceof Error && error.name === "AbortError") return "The search ended before the source answered.";
  return error instanceof ToolReadError ? error.message : "The source could not be read or returned invalid data.";
}

function evaluateBranch(branch: Branch, endpoint: Endpoint, supplier: string, leg: Leg): EvaluatedBranch {
  const estimate = endpoint.accessByBranch.find((entry) => entry.supplier === supplier && entry.branchId === branch.id);
  const center = endpoint.label || endpoint.coordinates ? undefined
    : leg === "pickup" ? branch.centerToPickup : branch.returnToCenter;
  const access = estimate ? { minutes: estimate.minutes, costCents: estimate.costCents, note: estimate.note }
    : center ?? { minutes: null, costCents: null };
  let straightLineKm = null;
  if (endpoint.coordinates && branch.coordinates) {
    const radians = Math.PI / 180;
    const a = endpoint.coordinates;
    const b = branch.coordinates;
    const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2
      + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians)
      * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
    straightLineKm = Math.round(2 * 6371 * Math.asin(Math.sqrt(Math.min(1, h))) * 10) / 10;
  }
  return { ...branch, access: { ...access, basis: estimate ? "user_estimate" : center ? "area_center" : "unknown", straightLineKm } };
}

function selectBranches(branches: Branch[], endpoint: Endpoint, supplier: string, leg: Leg, trip: Trip) {
  const kind = leg === "pickup" ? trip.preferences.pickupKind : trip.preferences.returnKind;
  return branches
    .filter((branch) => (!kind || branch.kind === kind) && (!endpoint.candidateBranches
      || endpoint.candidateBranches.some((entry) => entry.supplier === supplier && entry.branchId === branch.id)))
    .map((branch) => evaluateBranch(branch, endpoint, supplier, leg))
    .sort((a, b) => (a.access.minutes ?? Infinity) - (b.access.minutes ?? Infinity)
      || (a.access.straightLineKm ?? Infinity) - (b.access.straightLineKm ?? Infinity)
      || a.id.localeCompare(b.id, "en"));
}

function limitBranches<T extends { kind: Branch["kind"] }>(branches: T[]) {
  const top = branches.slice(0, maxBranches);
  const otherKind = branches.find((branch) => !top.some(({ kind }) => kind === branch.kind));
  if (otherKind) top[maxBranches - 1] = otherKind;
  return top;
}

function attempt(supplierId: string, tool: ProviderTool, operation: Attempt["operation"]): Attempt {
  return {
    supplierId, source: tool.id, environment: tool.environment, operation,
    at: new Date().toISOString(), outcome: "unavailable",
  };
}

async function discover(supplier: string, tools: ProviderTool[], input: CatalogRequest, legs: Leg[], signal: AbortSignal) {
  const attempts: Attempt[] = [];
  const branches = new Map<string, Branch>();
  let complete = false;
  for (const tool of tools) {
    const row = attempt(supplier, tool, legs[0]);
    try {
      if (!tool.tool) throw new Error();
      const catalog = catalogSchema.parse(await invoke((signal) => tool.tool!.listBranches(input, signal), signal));
      for (const branch of catalog.branches) {
        if (!branches.has(branch.id)) branches.set(branch.id, branch);
      }
      row.outcome = catalog.partialReason ? "partial" : "complete";
      row.reason = catalog.partialReason;
      complete = !catalog.partialReason;
    } catch (error) {
      row.reason = failure(error);
    }
    attempts.push(row);
    if (legs.length === 2) attempts.push({ ...row, operation: legs[1] });
    if (complete || signal.aborted) break;
  }
  return { branches: [...branches.values()], attempts, complete };
}

function quoteCoverage(option: OptionFacts, request: QuoteRequest) {
  if (option.offer.currency !== request.currency
    || (request.carClass && option.offer.carClass !== request.carClass)
    || (request.minSeats !== undefined && (option.offer.seats ?? 0) < request.minSeats)) return 0;
  return chargeKeys.filter((key) => option.offer.charges[key] != null).length;
}

async function quotePair(
  supplier: Supplier, tools: ProviderTool[], trip: Trip,
  pickup: EvaluatedBranch, dropoff: EvaluatedBranch, signal: AbortSignal,
) {
  const input: QuoteRequest = {
    pickupId: pickup.id, returnId: dropoff.id, pickupAt: trip.pickupAt, returnAt: trip.returnAt,
    currency: trip.preferences.currency, carClass: trip.preferences.carClass, minSeats: trip.preferences.minSeats,
    driverAge: trip.preferences.driverAge, drivers: trip.preferences.drivers,
  };
  const attempts: Attempt[] = [];
  const options = new Map<string, OptionFacts>();
  let outcome: Attempt["outcome"] = "unavailable";
  for (const tool of tools) {
    const row = { ...attempt(supplier.id, tool, "quote"), pickupId: pickup.id, returnId: dropoff.id };
    attempts.push(row);
    try {
      if (!tool.tool) throw new Error();
      const quote = quoteSchema.parse(await invoke((signal) => tool.tool!.quote(input, signal), signal));
      if (quote.status === "unavailable") {
        row.reason = quote.reason;
      } else if (quote.status === "no_cars") {
        row.outcome = "no_cars";
        if (!options.size) outcome = "no_cars";
        // A fallback reporting no cars does not resolve an earlier incomplete offer.
        if (!options.size) break;
      } else {
        const observedAt = new Date().toISOString();
        let complete = true;
        for (const offer of quote.offers) {
          const option: OptionFacts = {
            id: [supplier.id, pickup.id, dropoff.id, offer.id].join("/"),
            supplier: supplier.name, pickup, return: dropoff, offer,
            source: { id: tool.id, environment: tool.environment, observedAt, url: offer.sourceUrl },
          };
          const previous = options.get(offer.id);
          if (!previous || quoteCoverage(option, input) > quoteCoverage(previous, input)) options.set(offer.id, option);
          complete &&= quoteCoverage(option, input) === chargeKeys.length;
        }
        row.outcome = complete ? "complete" : "partial";
        if (!complete) row.reason = "Some required charges or quotes meeting the requested vehicle and currency criteria were unavailable.";
        if ([...options.values()].every((option) => quoteCoverage(option, input) === chargeKeys.length)) {
          outcome = "complete";
          break;
        }
        outcome = "partial";
      }
    } catch (error) {
      row.reason = failure(error);
    }
    if (signal.aborted) break;
  }
  return { attempts, options: [...options.values()], outcome };
}

async function searchSupplier(supplier: Supplier, trip: Trip, signal: AbortSignal) {
  const tools = supplier.tools.map((tool) => {
    try {
      return { ...tool, tool: tool.create() };
    } catch {
      return { ...tool, tool: null };
    }
  });
  try {
    return await compareSupplier(supplier, tools, trip, signal);
  } finally {
    // Adapters are also responsible for reacting to cancellation during I/O.
    await Promise.allSettled(tools.flatMap(({ tool }) => tool?.close ? [
      invoke(() => tool.close!(), AbortSignal.timeout(2000)),
    ] : []));
  }
}

async function compareSupplier(supplier: Supplier, tools: ProviderTool[], trip: Trip, signal: AbortSignal) {
  const destination = trip.destination ?? trip.origin;
  const areasMatch = destination.area.toLowerCase() === trip.origin.area.toLowerCase();
  const { currency, oneWay } = trip.preferences;
  const pickupCatalog = discover(supplier.id, tools, { area: trip.origin.area, currency }, areasMatch ? ["pickup", "return"] : ["pickup"], signal);
  const [pickups, returns] = await Promise.all([
    pickupCatalog,
    areasMatch ? pickupCatalog : discover(supplier.id, tools, { area: destination.area, currency }, ["return"], signal),
  ]);
  const pickupBranches = selectBranches(pickups.branches, trip.origin, supplier.id, "pickup", trip);
  const returnBranches = selectBranches(returns.branches, destination, supplier.id, "return", trip);
  // For round trips only shared locations form valid candidate pairs.
  const shared = pickupBranches.filter((pickup) => returnBranches.some((dropoff) => pickup.id === dropoff.id));
  const pickupCandidates = oneWay ? pickupBranches : shared;
  const returnCandidates = oneWay ? returnBranches : returnBranches.filter((dropoff) => shared.some((pickup) => pickup.id === dropoff.id));
  const limitedPickups = limitBranches(pickupCandidates);
  const limitedReturns = oneWay ? limitBranches(returnCandidates)
    : returnCandidates.filter((dropoff) => limitedPickups.some((pickup) => pickup.id === dropoff.id));
  const pairs = limitedPickups.flatMap((pickup) => limitedReturns
    .filter((dropoff) => oneWay || pickup.id === dropoff.id)
    .map((dropoff) => ({ pickup, dropoff })));
  const attempts = areasMatch ? pickups.attempts : [...pickups.attempts, ...returns.attempts];
  const candidateSummary = ({ id, name }: Branch) => ({ id, name });
  const omitted = {
    pickups: pickupCandidates.filter((branch) => !limitedPickups.includes(branch)).map(candidateSummary),
    returns: returnCandidates.filter((branch) => !limitedReturns.includes(branch)).map(candidateSummary),
    pairs: (oneWay ? pickupCandidates.length * returnCandidates.length : shared.length) - pairs.length,
  };
  const truncated = omitted.pairs > 0;
  const results: Awaited<ReturnType<typeof quotePair>>[] = [];
  for (let index = 0; index < pairs.length && !signal.aborted; index += maxConcurrentQuotes) {
    const batch = await Promise.all(pairs.slice(index, index + maxConcurrentQuotes).map(({ pickup, dropoff }) =>
      quotePair(supplier, tools, trip, pickup, dropoff, signal)));
    results.push(...batch);
  }
  const options = results.flatMap((result) => result.options);
  const incomplete = !pickups.complete || !returns.complete || truncated || results.length < pairs.length
    || results.some((result) => result.outcome === "partial" || result.outcome === "unavailable");
  let status: "complete" | "partial" | "unavailable" | "no_cars" | "no_matching_branches";
  if ((!pickups.complete && !pickups.branches.length) || (!returns.complete && !returns.branches.length)) status = "unavailable";
  else if (!pairs.length) status = incomplete ? "partial" : "no_matching_branches";
  else if (incomplete) status = options.length || results.some((result) => result.outcome === "no_cars") ? "partial" : "unavailable";
  else status = options.length ? "complete" : "no_cars";
  return {
    options,
    attempts: [...attempts, ...results.flatMap((result) => result.attempts)],
    coverage: {
      supplierId: supplier.id, supplier: supplier.name, status,
      pickupCandidates: pickupBranches.length, returnCandidates: returnBranches.length,
      pairsPlanned: pairs.length, pairsChecked: results.length, truncated, omitted,
      pairs: pairs.map(({ pickup, dropoff }, index) => ({
        pickup: candidateSummary(pickup), return: candidateSummary(dropoff),
        status: results[index]?.outcome ?? "untried" as const,
      })),
    },
  };
}

export async function compareRentals(rawTrip: unknown, suppliers: Supplier[], environment: Environment, abort?: AbortSignal) {
  const trip = tripSchema.parse(rawTrip);
  const timeout = AbortSignal.timeout(searchTimeout);
  const signal = abort ? AbortSignal.any([abort, timeout]) : timeout;
  const results = await Promise.all(suppliers.map((supplier) => searchSupplier({
    ...supplier, tools: supplier.tools.filter((tool) => tool.environment === environment),
  }, trip, signal)));
  const ranked = rankOptions(results.flatMap((result) => result.options), trip.preferences);
  const recommendation = ranked.options.find(({ rank }) => rank === 1)?.id ?? null;
  return {
    version: 1,
    environment,
    currency: trip.preferences.currency,
    request: {
      pickupArea: trip.origin.area, returnArea: trip.destination?.area ?? trip.origin.area,
      pickupAt: trip.pickupAt, returnAt: trip.returnAt, preferences: trip.preferences,
    },
    rankingRule: ranked.rule,
    branchSelection: "Up to six branches per leg and supplier, ordered by available travel time, then straight-line distance, then branch ID. When available, both airport and non-airport branches are represented.",
    recommendation,
    options: ranked.options,
    coverage: results.map((result) => result.coverage),
    attempts: results.flatMap((result) => result.attempts),
  };
}

export type Comparison = Awaited<ReturnType<typeof compareRentals>>;
