import { randomUUID } from "node:crypto";
import { z } from "zod";

const classes = ["sedan", "premium sedan", "SUV", "premium SUV", "pickup truck"] as const;
const vendors = {
  Hertz: "hertz.invalid", Enterprise: "enterprise.invalid", Avis: "avis.invalid",
};
const rateCard = z.record(z.enum(classes), z.number().int().nonnegative());
const locationRateCard = z.strictObject({
  sedan: z.number().int().nonnegative(),
  "premium sedan": z.number().int().nonnegative(),
  SUV: z.number().int().nonnegative(),
  "premium SUV": z.number().int().nonnegative(),
});
type Rates = Partial<Record<keyof typeof vendors, Partial<z.infer<typeof rateCard>>>>;

export const rentalRequirements = z.strictObject({
  pickupLocation: z.string().trim().min(1).max(120),
  returnLocation: z.string().trim().min(1).max(120),
  pickupAt: z.iso.datetime({ offset: true }),
  returnAt: z.iso.datetime({ offset: true }),
  vehicleClasses: z.array(z.enum(classes)).min(1).max(5).optional(),
  maxTotalUsd: z.number().nonnegative().optional(),
}).refine(({ pickupAt, returnAt }) => Date.parse(returnAt) > Date.parse(pickupAt));

type Requirements = z.infer<typeof rentalRequirements>;

const connection = z.object({
  expires_at: z.iso.datetime({ offset: true }),
  http: z.object({
    operations_url: z.url({ protocol: /^https$/ }),
    headers: z.object({ Authorization: z.string().startsWith("Bearer ").min(8) }),
  }),
});

export function syntheticQuotes(input: Requirements, rates: Rates) {
  const requirements = rentalRequirements.safeParse(input);
  if (!requirements.success) return null;
  const { pickupAt, returnAt, vehicleClasses, maxTotalUsd } = requirements.data;
  const days = Math.ceil((Date.parse(returnAt) - Date.parse(pickupAt)) / 86_400_000);
  const ceiling = maxTotalUsd === undefined ? Infinity : Math.round(maxTotalUsd * 100);
  const quotes = Object.entries(rates).flatMap(([vendor, daily]) =>
    [...new Set(vehicleClasses ?? classes)].flatMap((vehicleClass) => {
      const rate = daily[vehicleClass];
      if (rate === undefined || rate * days > ceiling) return [];
      return [{ vendor, vehicleClass, currency: "USD", totalCents: rate * days }];
    }));
  return { simulated: true, quotes };
}

const syntheticPage = z.object({ status: z.literal(200), content: z.string(), truncated: z.literal(false).optional() });
const syntheticRates = z.object({
  simulated: z.literal(true), currency: z.literal("USD"), dailyCents: rateCard,
});

const catalogRegions = ["bay-area", "denver"] as const;
const catalogPage = z.object({
  simulated: z.literal(true), currency: z.literal("USD"),
  vendor: z.enum(["Hertz", "Enterprise", "Avis"]), region: z.enum(catalogRegions),
  locations: z.array(z.object({ name: z.string().min(1), dailyCents: locationRateCard })),
});

function normalizeLocation(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const pickupAliases = new Map([
  ["sfo", "san francisco international airport"], ["den", "denver international airport"],
]);

function firedrillRoute(catalogConnection?: string) {
  const local = process.env.FIREDRILL_RENTAL_INVOKE_URL?.trim();
  if (!catalogConnection && local && !process.env.VERCEL) {
    const url = new URL(local);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
        url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/v1/invoke")) {
      throw new Error("Invalid Firedrill loopback endpoint.");
    }
    return { url, local: true as const };
  }
  const raw = catalogConnection ?? process.env.FIREDRILL_RENTAL_CONNECTION;
  const { expires_at, http } = connection.parse(raw ? JSON.parse(raw) : null);
  const url = new URL(http.operations_url);
  if (Date.parse(expires_at) <= Date.now() || url.username || url.password || url.search ||
      url.hash || !url.pathname.endsWith("/operations")) throw new Error("Invalid or expired tool connection.");
  url.pathname += "/web/fetch";
  return { url, local: false as const, authorization: http.headers.Authorization };
}

async function fetchFiredrillPage(route: ReturnType<typeof firedrillRoute>, url: string, catalog = false) {
  const request = { arguments: { url, follow_redirects: false, ...(catalog && { max_length: 100_000 }) } };
  const headers = new Headers({ "Content-Type": "application/json" });
  if (!route.local) {
    headers.set("Authorization", route.authorization);
    headers.set("Idempotency-Key", randomUUID());
  }
  const response = await fetch(route.url, {
    method: "POST", headers,
    body: JSON.stringify(route.local ? { operation: "fetch", ...request } : request),
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Firedrill rejected a vendor rate lookup.");
  return JSON.parse(syntheticPage.parse(await response.json()).content);
}

export async function readFiredrillRates(pickupLocation?: string): Promise<Rates> {
  const catalogConnection = process.env.FIREDRILL_RENTAL_CATALOG_CONNECTION;
  const route = firedrillRoute(catalogConnection);
  const name = normalizeLocation(pickupLocation ?? "");
  const pickup = pickupAliases.get(name) ?? name;
  const entries = await Promise.all(Object.entries(vendors).map(async ([vendor, host]) => {
    if (!catalogConnection) {
      const page = await fetchFiredrillPage(route, `https://${host}/rental-rates`);
      return [[vendor, syntheticRates.parse(page).dailyCents] as const];
    }
    const pages = await Promise.all(catalogRegions.map(async (region) => {
      const page = catalogPage.parse(await fetchFiredrillPage(route, `https://${host}/rental-locations/${region}`, true));
      if (page.vendor !== vendor || page.region !== region) throw new Error("Firedrill catalog page does not match its vendor or region.");
      return page.locations;
    }));
    const matches = pages.flat().filter(({ name }) => normalizeLocation(name) === pickup);
    return matches.length === 1 ? [[vendor, matches[0].dailyCents] as const] : [];
  }));
  return Object.fromEntries(entries.flat()) as Rates;
}
