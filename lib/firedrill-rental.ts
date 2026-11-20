import { randomUUID } from "node:crypto";
import { z } from "zod";

const classes = ["sedan", "premium sedan", "SUV", "premium SUV", "pickup truck"] as const;
const vendors = {
  Hertz: "hertz.invalid", Enterprise: "enterprise.invalid", Avis: "avis.invalid",
};
const rateCard = z.record(z.enum(classes), z.number().int().nonnegative());
type Rates = Record<keyof typeof vendors, z.infer<typeof rateCard>>;

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
    [...new Set(vehicleClasses ?? classes)].map((vehicleClass) => ({
      vendor, vehicleClass, currency: "USD",
      totalCents: daily[vehicleClass] * days,
    })).filter(({ totalCents }) => totalCents <= ceiling));
  return { simulated: true, quotes };
}

const syntheticPage = z.object({ status: z.literal(200), content: z.string() });
const syntheticRates = z.object({
  simulated: z.literal(true), currency: z.literal("USD"), dailyCents: rateCard,
});

function firedrillRoute() {
  const local = process.env.FIREDRILL_RENTAL_INVOKE_URL?.trim();
  if (local && !process.env.VERCEL) {
    const url = new URL(local);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
        url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/v1/invoke")) {
      throw new Error("Invalid Firedrill loopback endpoint.");
    }
    return { url, local: true as const };
  }
  const raw = process.env.FIREDRILL_RENTAL_CONNECTION;
  const { expires_at, http } = connection.parse(raw ? JSON.parse(raw) : null);
  const url = new URL(http.operations_url);
  if (Date.parse(expires_at) <= Date.now() || url.username || url.password || url.search ||
      url.hash || !url.pathname.endsWith("/operations")) throw new Error("Invalid or expired tool connection.");
  url.pathname += "/web/fetch";
  return { url, local: false as const, authorization: http.headers.Authorization };
}

export async function readFiredrillRates(): Promise<Rates> {
  const route = firedrillRoute();
  const entries = await Promise.all(Object.entries(vendors).map(async ([vendor, host]) => {
    const request = { arguments: { url: `https://${host}/rental-rates`, follow_redirects: false } };
    const headers = new Headers({ "Content-Type": "application/json" });
    if (!route.local) {
      headers.set("Authorization", route.authorization);
      headers.set("Idempotency-Key", randomUUID());
    }
    const response = await fetch(route.url, {
      method: "POST",
      headers,
      body: JSON.stringify(route.local ? { operation: "fetch", ...request } : request),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Firedrill rejected a vendor rate lookup.");
    const page = syntheticPage.parse(await response.json());
    return [vendor, syntheticRates.parse(JSON.parse(page.content)).dailyCents] as const;
  }));
  return Object.fromEntries(entries) as Rates;
}
