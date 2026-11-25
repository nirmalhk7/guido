import { setTimeout as delay } from "node:timers/promises";
import {
  catalogSchema, chargeKeys, offerSchema, quoteSchema, tripSchema, ToolReadError, supplierLimitsSchema,
  type Branch, type CatalogRequest, type Environment, type FollowupOperation, type QuoteFollowup, type RunFollowup,
  type QuoteRequest, type Supplier, type Tool, type Trip,
} from "./contracts.ts";
import { rankOptions, type EvaluatedBranch, type OptionFacts } from "./rank.ts";

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
  operation: Leg | "quote" | FollowupOperation;
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
      || (a.access.straightLineKm ?? a.catalogDistanceKm ?? Infinity)
         - (b.access.straightLineKm ?? b.catalogDistanceKm ?? Infinity)
      || a.id.localeCompare(b.id, "en"));
}

function limitBranches<T extends { kind: Branch["kind"] }>(branches: T[], maxBranches: number) {
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

function supplierBudget(supplier: Supplier, signal: AbortSignal) {
  const limits = supplierLimitsSchema.parse(supplier.limits ?? {});
  const stopped = new Set<string>();
  let nextStart = 0;
  let quotesStarted = 0;
  let followupsStarted = 0;
  const withinBudget = (kind: "catalog" | "quote" | "followup") => kind === "catalog"
    || (kind === "quote" ? quotesStarted < limits.quoteRequests : followupsStarted < limits.followupRequests);
  return {
    limits,
    stopped,
    get quotesStarted() { return quotesStarted; },
    get followupsStarted() { return followupsStarted; },
    async run<T>(id: string, kind: "catalog" | "quote" | "followup", work: (signal: AbortSignal) => Promise<T>) {
      signal.throwIfAborted();
      if (stopped.has(id) || !withinBudget(kind)) return undefined;
      const now = performance.now();
      const wait = Math.max(0, nextStart - now);
      nextStart = now + wait + limits.intervalMs;
      if (wait > 0) await delay(wait, undefined, { signal });
      if (stopped.has(id) || !withinBudget(kind)) return undefined;
      try {
        return await invoke((signal) => {
          if (kind === "quote") quotesStarted++;
          if (kind === "followup") followupsStarted++;
          return work(signal);
        }, signal);
      } catch (error) {
        if (error instanceof ToolReadError && error.stopSource) stopped.add(id);
        throw error;
      }
    },
  };
}

type Budget = ReturnType<typeof supplierBudget>;
type FollowupPlan = { source: ProviderTool; option: OptionFacts; followup: QuoteFollowup };

async function discover(supplier: string, tools: ProviderTool[], input: CatalogRequest, legs: Leg[], budget: Budget, signal: AbortSignal) {
  const attempts: Attempt[] = [];
  const branches = new Map<string, Branch>();
  let pages = 0;
  let complete = false;
  for (const tool of tools) {
    const adapter = tool.tool;
    if (!adapter || signal.aborted) continue;
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let partial = false;
    do {
      let started = false;
      const row = attempt(supplier, tool, legs[0]);
      try {
        const catalog = await budget.run(tool.id, "catalog", async (signal) => {
          started = true;
          pages++;
          row.at = new Date().toISOString();
          return catalogSchema.parse(await adapter.listBranches({
            area: input.area, currency: input.currency,
            ...(tool.catalogByDate && { at: input.at }),
            ...(cursor !== undefined && { cursor }),
          }, signal));
        });
        if (!catalog) break;
        for (const branch of catalog.branches) {
          if (!branches.has(branch.id)) branches.set(branch.id, branch);
        }
        cursor = catalog.nextCursor;
        row.reason = catalog.partialReason;
        if (cursor && cursors.has(cursor)) row.reason ??= "The source repeated a catalog cursor.";
        if (cursor && pages >= budget.limits.catalogPagesPerLeg) row.reason ??= "Catalog page budget reached before the source finished.";
        partial ||= row.reason !== undefined;
        row.outcome = row.reason || cursor ? "partial" : "complete";
        if (cursor && (cursors.has(cursor) || pages >= budget.limits.catalogPagesPerLeg)) break;
        if (cursor) cursors.add(cursor);
        else complete = !partial;
      } catch (error) {
        row.reason = failure(error);
        break;
      } finally {
        if (started) {
          attempts.push(row);
          if (legs.length === 2) attempts.push({ ...row, operation: legs[1] });
        }
      }
    } while (cursor && !signal.aborted);
    if (complete || pages >= budget.limits.catalogPagesPerLeg) break;
  }
  return {
    branches: [...branches.values()], attempts, complete, pages,
    state: complete ? "complete" as const : branches.size ? "partial" as const
      : attempts.length ? "unavailable" as const : "unverified" as const,
  };
}

function quoteCoverage(option: OptionFacts, request: QuoteRequest) {
  if (option.offer.currency !== request.currency
    || (request.carClass && option.offer.carClass !== request.carClass)
    || (request.minSeats !== undefined && (option.offer.seats ?? 0) < request.minSeats)) return 0;
  return chargeKeys.filter((key) => option.offer.charges[key] != null).length;
}

async function quotePair(
  supplier: Supplier, tools: ProviderTool[], trip: Trip,
  pickup: EvaluatedBranch, dropoff: EvaluatedBranch, budget: Budget, signal: AbortSignal,
) {
  const input: QuoteRequest = {
    pickupId: pickup.id, returnId: dropoff.id, pickupAt: trip.pickupAt, returnAt: trip.returnAt,
    currency: trip.preferences.currency, carClass: trip.preferences.carClass, minSeats: trip.preferences.minSeats,
    driverAge: trip.preferences.driverAge, drivers: trip.preferences.drivers,
  };
  const attempts: Attempt[] = [];
  const options = new Map<string, OptionFacts>();
  const plans = new Map<string, FollowupPlan>();
  let outcome: Attempt["outcome"] = "unavailable";
  for (const tool of tools) {
    const row = { ...attempt(supplier.id, tool, "quote"), pickupId: pickup.id, returnId: dropoff.id };
    const adapter = tool.tool;
    if (!adapter) continue;
    try {
      const read = await budget.run(tool.id, "quote", async (signal) => {
        row.at = new Date().toISOString();
        attempts.push(row);
        const { followup, ...response } = await adapter.quote(input, signal);
        return { quote: quoteSchema.parse(response), followup };
      });
      if (!read) continue;
      const { quote, followup } = read;
      if (quote.status === "unavailable") {
        row.reason = quote.reason;
      } else if (quote.status === "no_cars") {
        row.outcome = "no_cars";
        if (!options.size) outcome = "no_cars";
        // A fallback reporting no cars does not resolve an earlier incomplete offer.
        if (!options.size) break;
      } else {
        const observedAt = new Date().toISOString();
        let complete = !quote.partialReason;
        for (const offer of quote.offers) {
          const option: OptionFacts = {
            id: [supplier.id, pickup.id, dropoff.id, offer.id].join("/"),
            supplier: supplier.name, pickup, return: dropoff, offer,
            source: { id: tool.id, environment: tool.environment, observedAt, url: offer.sourceUrl },
          };
          const previous = options.get(offer.id);
          if (!previous || quoteCoverage(option, input) > quoteCoverage(previous, input)) {
            options.set(offer.id, option);
            if (followup) plans.set(offer.id, { source: tool, option, followup });
            else plans.delete(offer.id);
          }
          complete &&= quoteCoverage(option, input) === chargeKeys.length;
        }
        row.outcome = complete ? "complete" : "partial";
        if (!complete) row.reason = quote.partialReason ?? "Some required charges or quotes meeting the requested vehicle and currency criteria were unavailable.";
        if (!quote.partialReason && [...options.values()].every((option) => quoteCoverage(option, input) === chargeKeys.length)) {
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
  return {
    attempts, options: [...options.values()], plans: [...plans.values()], outcome: attempts.length ? outcome : "untried" as const,
    reason: attempts.length ? undefined : untriedReason(budget, signal),
  };
}

async function readSupplementals(
  supplier: string, plans: FollowupPlan[], budget: Budget, trip: Trip, signal: AbortSignal,
) {
  const attempts: Attempt[] = [];
  const { carClass, minSeats, currency } = trip.preferences;
  const price = ({ option: { offer } }: FollowupPlan) => offer.supplierEstimateCents
    ?? (typeof offer.charges.base === "number" ? offer.charges.base : Number.MAX_SAFE_INTEGER);
  const selected = plans.filter(({ option: { offer } }) => offer.currency === currency && (!carClass || offer.carClass === carClass)
    && (minSeats === undefined || offer.seats === undefined || offer.seats >= minSeats))
    .sort((a, b) => price(a) - price(b) || a.option.id.localeCompare(b.option.id))
    .slice(0, 2);
  for (const { source, option, followup } of selected) {
    if (signal.aborted || budget.followupsStarted >= budget.limits.followupRequests) break;
    const read: RunFollowup = async (operation, work) => {
      const row = {
        ...attempt(supplier, source, operation), pickupId: option.pickup.id, returnId: option.return.id,
      };
      let started = false;
      try {
        const value = await budget.run(source.id, "followup", (signal) => {
          row.at = new Date().toISOString();
          attempts.push(row);
          started = true;
          return work(signal);
        });
        if (value === undefined) return {
          status: "untried",
          reason: budget.stopped.has(source.id) ? "Source stopped after an access or rate-limit response."
            : "Supplier follow-up request budget reached.",
        };
        row.outcome = "complete";
        return { status: "returned", value, observedAt: new Date().toISOString() };
      } catch (error) {
        row.reason = failure(error);
        return { status: started ? "unavailable" : "untried", reason: row.reason };
      }
    };
    try {
      const supplementalEvidence = await followup(option.offer.id, read);
      option.offer = offerSchema.parse({ ...option.offer, supplementalEvidence });
    } catch {
      // An invalid supplement never replaces the original ordered-pair evidence.
    }
  }
  return attempts;
}

function untriedReason(budget: Budget, signal: AbortSignal) {
  if (signal.aborted) return failure(signal.reason);
  if (budget.quotesStarted >= budget.limits.quoteRequests) return "Supplier quote request budget reached.";
  return "No eligible quote source remained.";
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
  const destination = trip.destination ?? {
    area: trip.origin.area, label: trip.origin.label, coordinates: trip.origin.coordinates, accessByBranch: [],
  };
  const sharedCatalog = destination.area.toLowerCase() === trip.origin.area.toLowerCase()
    && !tools.some(({ catalogByDate }) => catalogByDate);
  const budget = supplierBudget(supplier, signal);
  const { currency, oneWay } = trip.preferences;
  const pickupCatalog = discover(supplier.id, tools, { area: trip.origin.area, currency, at: trip.pickupAt },
    sharedCatalog ? ["pickup", "return"] : ["pickup"], budget, signal);
  const [pickups, returns] = await Promise.all([
    pickupCatalog,
    sharedCatalog ? pickupCatalog : discover(supplier.id, tools, { area: destination.area, currency, at: trip.returnAt },
      ["return"], budget, signal),
  ]);
  const pickupBranches = selectBranches(pickups.branches, trip.origin, supplier.id, "pickup", trip);
  const returnBranches = selectBranches(returns.branches, destination, supplier.id, "return", trip);
  // For round trips only shared locations form valid candidate pairs.
  const shared = pickupBranches.filter((pickup) => returnBranches.some((dropoff) => pickup.id === dropoff.id));
  const pickupCandidates = oneWay ? pickupBranches : shared;
  const returnCandidates = oneWay ? returnBranches : returnBranches.filter((dropoff) => shared.some((pickup) => pickup.id === dropoff.id));
  const limitedPickups = limitBranches(pickupCandidates, budget.limits.branchesPerLeg);
  const limitedReturns = oneWay ? limitBranches(returnCandidates, budget.limits.branchesPerLeg)
    : returnCandidates.filter((dropoff) => limitedPickups.some((pickup) => pickup.id === dropoff.id));
  const pairs = limitedPickups.flatMap((pickup, i) => limitedReturns
    .map((dropoff, j) => ({ pickup, dropoff, order: i + j }))
    .filter(({ dropoff }) => oneWay || pickup.id === dropoff.id))
    .sort((a, b) => a.order - b.order);
  const attempts = sharedCatalog ? pickups.attempts : [...pickups.attempts, ...returns.attempts];
  const candidateSummary = ({ id, name }: Branch) => ({ id, name });
  const omitted = {
    pickups: pickupCandidates.filter((branch) => !limitedPickups.includes(branch)).map(candidateSummary),
    returns: returnCandidates.filter((branch) => !limitedReturns.includes(branch)).map(candidateSummary),
    pairs: (oneWay ? pickupCandidates.length * returnCandidates.length : shared.length) - pairs.length,
  };
  const truncated = omitted.pairs > 0;
  const results: Awaited<ReturnType<typeof quotePair>>[] = [];
  for (let index = 0; index < pairs.length && !signal.aborted && budget.quotesStarted < budget.limits.quoteRequests; index += maxConcurrentQuotes) {
    const batch = await Promise.all(pairs.slice(index, index + maxConcurrentQuotes).map(({ pickup, dropoff }) =>
      quotePair(supplier, tools, trip, pickup, dropoff, budget, signal)));
    results.push(...batch);
  }
  const options = results.flatMap((result) => result.options);
  const supplementAttempts = await readSupplementals(supplier.id, results.flatMap((result) => result.plans), budget, trip, signal);
  const pairsChecked = results.filter((result) => result.attempts.length > 0).length;
  const incomplete = !pickups.complete || !returns.complete || truncated || pairsChecked < pairs.length
    || results.some((result) => result.outcome === "partial" || result.outcome === "unavailable");
  let status: "complete" | "partial" | "unavailable" | "unverified" | "no_cars" | "no_matching_branches";
  if (!tools.length) status = "unverified";
  else if ((!pickups.complete && !pickups.branches.length) || (!returns.complete && !returns.branches.length)) status = "unavailable";
  else if (!pairs.length) status = incomplete ? "partial" : "no_matching_branches";
  else if (incomplete) status = options.length || results.some((result) => result.outcome === "no_cars") ? "partial" : "unavailable";
  else status = options.length ? "complete" : "no_cars";
  return {
    options,
    attempts: [...attempts, ...results.flatMap((result) => result.attempts), ...supplementAttempts],
    coverage: {
      supplierId: supplier.id, supplier: supplier.name, status,
      pickupCandidates: pickupBranches.length, returnCandidates: returnBranches.length,
      pairsPlanned: pairs.length, pairsChecked, quotesAttempted: budget.quotesStarted, followupsAttempted: budget.followupsStarted, truncated, omitted,
      limits: budget.limits,
      discovery: {
        pickup: { state: pickups.state, pagesAttempted: pickups.pages },
        return: { state: returns.state, pagesAttempted: returns.pages },
      },
      pairs: pairs.map(({ pickup, dropoff }, index) => ({
        pickup: candidateSummary(pickup), return: candidateSummary(dropoff),
        status: results[index]?.outcome ?? "untried" as const,
        reason: results[index] ? results[index].reason : untriedReason(budget, signal),
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
    branchSelection: "Suppliers report catalog pages, branch and quote limits, and untried pairs. Candidates are sorted by travel time, then distance when known, then station ID. Airports and neighborhood stations are represented when available.",
    recommendation,
    options: ranked.options,
    coverage: results.map((result) => result.coverage),
    attempts: results.flatMap((result) => result.attempts),
  };
}

export type Comparison = Awaited<ReturnType<typeof compareRentals>>;
