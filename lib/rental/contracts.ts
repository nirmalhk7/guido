import { z } from "zod";

const label = z.string().trim().min(1).max(160);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const money = z.int().min(0).max(100_000_000);
const minutes = z.number().min(0).max(1440);
const dateTime = z.iso.datetime({ offset: true });
const currency = z.string().regex(/^[A-Z]{3}$/);
const coordinates = z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export const branchKind = z.enum(["airport", "non_airport"]);
const access = z.strictObject({
  minutes: minutes.nullable().default(null),
  costCents: money.nullable().default(null),
  note: label.optional(),
});
const area = z.strictObject({
  area: label,
  // Precise endpoints and user estimates stay in the comparison process.
  label: label.optional(),
  coordinates: coordinates.optional(),
  candidateBranches: z.array(z.strictObject({ supplier: id, branchId: id })).min(1).max(100).optional(),
  accessByBranch: z.array(z.strictObject({ supplier: id, branchId: id, ...access.shape })).max(100).default([]),
}).refine(({ accessByBranch }) => new Set(accessByBranch.map(({ supplier, branchId }) =>
  `${supplier}/${branchId}`)).size === accessByBranch.length, "Duplicate branch access estimate");

export const tripSchema = z.strictObject({
  origin: area,
  destination: area.optional(),
  pickupAt: dateTime,
  returnAt: dateTime,
  preferences: z.strictObject({
    oneWay: z.boolean().default(true),
    pickupKind: branchKind.optional(),
    returnKind: branchKind.optional(),
    carClass: id.optional(),
    minSeats: z.int().min(1).max(20).optional(),
    driverAge: z.int().min(16).max(110).default(30),
    drivers: z.int().min(1).max(10).default(1),
    currency: currency.default("USD"),
    priority: z.enum(["total_cost", "pickup_access", "return_access"]).default("total_cost"),
    maxPickupMinutes: minutes.optional(),
    maxReturnMinutes: minutes.optional(),
    maxTotalCents: money.optional(),
  }).prefault({}),
}).refine(({ pickupAt, returnAt }) => Date.parse(returnAt) > Date.parse(pickupAt), {
  path: ["returnAt"], message: "Return must be after pickup",
});

export const branchSchema = z.strictObject({
  id,
  name: label,
  kind: branchKind,
  address: label.optional(),
  coordinates: coordinates.optional(),
  // Area-center estimates, in the requested currency.
  centerToPickup: access.optional(),
  returnToCenter: access.optional(),
  pickupNote: label.optional(),
  returnNote: label.optional(),
  catalogDistanceKm: z.number().nonnegative().max(20_000).optional(),
  hours: label.optional(),
});
export const catalogSchema = z.strictObject({
  branches: z.array(branchSchema).max(250),
  partialReason: label.optional(),
  nextCursor: z.string().min(1).max(512).optional(),
}).refine(({ branches }) => new Set(branches.map(({ id }) => id)).size === branches.length, "Duplicate branch ID");

export const chargeKeys = ["base", "taxes", "airport", "oneWay", "youngDriver", "additionalDriver", "otherMandatory"] as const;
const charge = z.union([money, z.literal("included"), z.null()]);

const evidenceUrl = z.url({ protocol: /^https?$/ }).refine((url) => {
  const parsed = new URL(url);
  return !parsed.username && !parsed.password;
});

export const offerSchema = z.strictObject({
  id,
  vehicle: label,
  carClass: id,
  seats: z.int().min(1).max(20).optional(),
  currency,
  charges: z.partialRecord(z.enum(chargeKeys), charge).refine(({ base }) => base !== "included").default({}),
  cancellation: label.optional(),
  supplierEstimateCents: money.optional(),
  providerReference: id.optional(),
  rentalTerms: z.array(label).max(12).optional(),
  pickupHours: label.optional(),
  returnHours: label.optional(),
  quotedAt: dateTime.optional(),
  sourceUrl: evidenceUrl.optional(),
});
export const quoteSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), offers: z.array(offerSchema).min(1).max(30), partialReason: label.optional() })
    .refine(({ offers }) => new Set(offers.map(({ id }) => id)).size === offers.length, "Duplicate offer ID"),
  z.strictObject({ status: z.literal("no_cars") }),
  z.strictObject({ status: z.literal("unavailable"), reason: label }),
]);

export type Trip = z.infer<typeof tripSchema>;
export type Branch = z.infer<typeof branchSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type Access = z.infer<typeof access>;
export type Environment = "live" | "fixture";
export type CatalogRequest = { area: string; currency: string; at?: string; cursor?: string };
export type QuoteRequest = {
  pickupId: string;
  returnId: string;
  pickupAt: string;
  returnAt: string;
  currency: string;
  carClass?: string;
  minSeats?: number;
  driverAge: number;
  drivers: number;
};
export class ToolReadError extends Error {
  stopSource: boolean;
  constructor(message: string, stopSource = false) {
    super(message);
    this.stopSource = stopSource;
  }
}

export const supplierLimitsSchema = z.strictObject({
  branchesPerLeg: z.int().min(2).max(16).default(6),
  catalogPagesPerLeg: z.int().min(1).max(20).default(6),
  quoteRequests: z.int().min(1).max(100).default(36),
  intervalMs: z.int().min(0).max(5000).default(0),
});

export type Tool = {
  listBranches(input: CatalogRequest, signal: AbortSignal): Promise<z.input<typeof catalogSchema>>;
  quote(input: QuoteRequest, signal: AbortSignal): Promise<z.input<typeof quoteSchema>>;
  close?(): Promise<void>;
};
export type Supplier = {
  id: string;
  name: string;
  tools: { id: string; environment: Environment; catalogByDate?: boolean; create: () => Tool }[];
  limits?: Partial<z.infer<typeof supplierLimitsSchema>>;
};
