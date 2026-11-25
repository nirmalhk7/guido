import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { ToolReadError, type Branch, type FollowupOperation, type OfferEvidence, type QuoteRequest, type RunFollowup, type Tool } from "../contracts.ts";

export const travelportVendors = { hertz: "ZE", avis: "ZI", enterprise: "ET" } as const;
type Brand = keyof typeof travelportVendors;
type Station = { market: string; type: string; number: string };
type Element = { name: string; namespace: string; fields: Record<string, string>; children: Element[]; text: string };

const soap = "http://schemas.xmlsoap.org/soap/envelope/";
const vehicle = "http://www.travelport.com/schema/vehicle_v54_0";
const common = "http://www.travelport.com/schema/common_v54_0";
const matrixDocs = "https://support.travelport.com/WebHelp/uAPI/Content/Vehicle/Vehicle_Matrix/Vehicle_Matrix.htm";
const rulesDocs = "https://support.travelport.com/webhelp/uapi/Content/Vehicle/Vehicle_Rules/Vehicle_Rules.htm";
const detailsDocs = "https://support.travelport.com/webhelp/uapi/Content/Vehicle/Vehicle_Location_Details/Vehicle_Location_Details.htm";
const maxResponseBytes = 2 * 1024 * 1024;
const stationType = /^[A-Za-z]{2,32}$/;
const marketCode = /^[A-Z]{3}$/;
const stationNumber = /^\d{1,8}$/;
const airportTypes = new Set(["Airport", "Terminal", "OffTerminal", "AirportMain", "AirportSecondary"]);

export type TravelportSettings = {
  region: "americas" | "emea" | "apac";
  markets: Record<string, string[]>;
};
type Account = { username?: string; password?: string; targetBranch?: string };

function parseXml(xml: string) {
  const root: Element = { name: "", namespace: "", fields: {}, children: [], text: "" };
  const stack = [root];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new ToolReadError("Travelport response contained an unsupported XML document type."); });
  parser.on("opentag", (tag) => {
    if (stack.length >= 40) throw new ToolReadError("Travelport response was too deeply nested.");
    const fields = Object.fromEntries(Object.values(tag.attributes).filter((attribute) => !attribute.uri)
      .map(({ local, value }) => [local, value]));
    const node = { name: tag.local, namespace: tag.uri, fields, children: [], text: "" };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => { stack.at(-1)!.text += text; });
  parser.on("closetag", () => stack.pop());
  parser.write(xml).close();
  return root;
}

const children = (node: Element | undefined, name: string, namespace = vehicle) =>
  node?.children.filter((child) => child.name === name && child.namespace === namespace) ?? [];
const child = (node: Element | undefined, name: string, namespace = vehicle) => children(node, name, namespace)[0];
const cleanLabel = (value: string | undefined) => value?.trim().replace(/\s+/g, " ").slice(0, 160) || undefined;
const ref = (node: Element) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(node.fields.TransactionId ?? "")
  ? node.fields.TransactionId : undefined;
function localTime(value: string) {
  const time = value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/)?.[1];
  return time?.padEnd(19, ":00");
}

function sameTime(actual: string | undefined, requested: string) {
  if (!actual || localTime(actual) !== localTime(requested)) return false;
  return !/(?:Z|[+-]\d\d:\d\d)$/.test(actual) || Date.parse(actual) === Date.parse(requested);
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[char]!);
}

function attrs(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
}

function stationId(vendor: string, station: Station) {
  return `1G-${vendor}-${station.market}-${station.type}-${station.number.replace(/^0+(?=\d)/, "")}`;
}

function stationFromId(id: string, vendor: string) {
  const [provider, company, market, type, number, ...extra] = id.split("-");
  if (provider !== "1G" || company !== vendor || !marketCode.test(market ?? "") || !stationType.test(type ?? "")
    || !stationNumber.test(number ?? "") || extra.length) throw new ToolReadError("The station ID is outside this Travelport supplier.");
  return { market, type, number };
}

function parseStation(item: Element, vendor: string): Branch | null {
  const vendorLocation = child(item, "VendorLocation", common);
  const info = child(item, "LocationInformation");
  if (vendorLocation?.fields.ProviderCode !== "1G" || vendorLocation.fields.VendorCode !== vendor || !info) return null;
  const { Location: market, LocationType: type } = info.fields;
  const number = vendorLocation.fields.VendorLocationID;
  if (!marketCode.test(market ?? "") || !stationType.test(type ?? "") || !stationNumber.test(number ?? "")) return null;
  const address = child(info, "Address");
  const street = child(address, "Street", common)?.text;
  const locality = child(address, "City", common)?.text;
  const branchAddress = cleanLabel([street, locality].filter(Boolean).join(", "));
  const distance = child(item, "Distance", common)?.fields;
  const numberDistance = /^\d+(?:\.\d+)?$/.test(distance?.Value ?? "") ? Number(distance!.Value) : NaN;
  const kilometers = distance?.Units === "MI" ? numberDistance * 1.609344
    : distance?.Units === "KM" ? numberDistance : NaN;
  const airport = airportTypes.has(type);
  return {
    id: stationId(vendor, { market, type, number }),
    name: cleanLabel(street) ?? `${market} ${airport ? "airport" : "rental station"} ${number}`,
    kind: airport ? "airport" : "non_airport", address: branchAddress,
    catalogDistanceKm: Number.isFinite(kilometers) && kilometers >= 0 && kilometers <= 20_000 ? kilometers : undefined,
  };
}

function stationMatches(fields: Record<string, string>, number: string | undefined, station: Station, vendor: string) {
  const airportTerminalAlias = [fields.LocationType, station.type].sort().join("/") === "Airport/Terminal";
  return fields.VendorCode === vendor && fields.LocationCode === station.market
    && number?.replace(/^0+(?=\d)/, "") === station.number
    && (fields.LocationType === station.type || airportTerminalAlias);
}

function matchesStation(location: Element | undefined, station: Station, vendor: string) {
  return location?.fields.ProviderCode === "1G"
    && stationMatches(location.fields, location.fields.VendorLocationID, station, vendor);
}

function money(value: string | undefined) {
  const parsed = /^([A-Z]{3})(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value ?? "");
  if (!parsed) return;
  const cents = Number(parsed[2]) * 100 + Number((parsed[3] ?? "").padEnd(2, "0"));
  if (cents <= 100_000_000) return { currency: parsed[1], cents };
}

function matrixOffers(reply: Element, input: QuoteRequest, pickup: Element, dropoff: Element | undefined, vendor: string) {
  const offered = new Map<string, { offer: NonNullable<ReturnType<typeof normalizeRate>>; vehicle: Element; rate: Element }>();
  for (const vehicle of children(reply, "Vehicle")) {
    if (vehicle.fields.VendorCode !== vendor || !pickup.fields.Key || vehicle.fields.VendorLocationKey !== pickup.fields.Key) continue;
    for (const rate of children(vehicle, "VehicleRate")) {
      const offer = normalizeRate(vehicle, rate, input.currency, pickup, dropoff);
      if (offer) offered.set(offer.id, { offer, vehicle, rate });
    }
  }
  return [...offered.values()].slice(0, 30);
}

function normalizeRate(vehicle: Element, rate: Element, requestedCurrency: string, pickup: Element, dropoff?: Element) {
  if (rate.fields.RateAvailability !== "Available") return;
  const vendorRate = child(rate, "SupplierRate") ?? child(rate, "ApproximateRate");
  const estimate = money(vendorRate?.fields.EstimatedTotalAmount);
  const base = money(vendorRate?.fields.BaseRate);
  const currency = estimate?.currency ?? base?.currency;
  if (!currency || currency !== requestedCurrency) return;
  const vehicleClass = vehicle.fields.VehicleClass?.toLowerCase();
  if (!vehicleClass || !/^[a-z0-9_-]{1,32}$/.test(vehicleClass)) return;
  const seats = Number(vehicle.fields.PassengerCount);
  const rentalTerms = [
    vehicle.fields.TransmissionType && `Transmission: ${vehicle.fields.TransmissionType}`,
    rate.fields.UnlimitedMileage === "true" ? "Unlimited mileage" : undefined,
    rate.fields.RequiredPayment && `Payment terms: ${rate.fields.RequiredPayment}`,
    rate.fields.DropOffChargesIncluded === "true" ? "Supplier reports drop-off charges included in its rate." : undefined,
    "Renter eligibility and additional-driver charges require supplier rules.",
  ].map(cleanLabel).filter((value) => value !== undefined);
  const id = createHash("sha256").update(JSON.stringify([
    vehicleClass, vehicle.fields.AcrissVehicleCode, rate.fields.RateCode, rate.fields.RatePeriod, rate.fields.RateCategory,
    rate.fields.RequiredPayment, base?.cents, estimate?.cents,
  ])).digest("hex").slice(0, 24);
  return {
    id, vehicle: cleanLabel(vehicle.fields.MakeModel) ?? `${vehicle.fields.VehicleClass} vehicle`,
    carClass: vehicleClass, seats: Number.isInteger(seats) && seats > 0 && seats <= 20 ? seats : undefined,
    currency, charges: { base: base?.currency === currency ? base.cents : null },
    supplierEstimateCents: estimate?.cents,
    rentalTerms, pickupHours: cleanLabel(child(pickup, "BusinessHours")?.text),
    returnHours: cleanLabel(child(dropoff, "BusinessHours")?.text),
    sourceUrl: matrixDocs,
  };
}

const summary = (values: (string | undefined)[]) => [...new Set(values.map(cleanLabel).filter((value) => value !== undefined))].slice(0, 12);

function rulesModifiers(vehicle: Element, rate: Element, vendor: string) {
  const { AcrissVehicleCode, VehicleClass, Category, TransmissionType, AirConditioning, DoorCount } = vehicle.fields;
  const { RateCode, RateCategory, RatePeriod } = rate.fields;
  if (!/^[A-Z0-9]{4}$/.test(AcrissVehicleCode ?? "") || !RateCode || RateCode.length > 10
    || !VehicleClass || !Category || !TransmissionType || !/^(?:true|false|0|1)$/.test(AirConditioning ?? "")) return;
  if (["CorporateRate", "DiscountNumber", "PromotionalCode", "TourCode"].some((key) =>
    rate.fields[key] && rate.fields[key] !== "false")) return; // Avoid repricing a contracted or qualified offer as a public rate.
  const qualifiers = child(rate, "RateHostIndicator")?.fields;
  const tokens = Object.fromEntries(["InventoryToken", "RateToken"]
    .flatMap((key) => qualifiers?.[key] ? [[key, qualifiers[key]]] : []));
  if (Object.values(tokens).some((value) => value.length > 512)) return;
  return `<v:VehicleSearchModifiers${attrs({
    ...(RateCategory && { RateCategory }), ...(RatePeriod && { RatePeriod }),
  })}><v:VehicleModifier${attrs({
    VehicleClass, Category, TransmissionType, AirConditioning, ...(DoorCount && { DoorCount }),
  })}/><v:RateModifiers${attrs({ VendorCode: vendor, RateCode })}/>`
    + (Object.keys(tokens).length ? `<v:RateHostIndicator${attrs(tokens)}/>` : "")
    + "</v:VehicleSearchModifiers>";
}

function ruleCharges(reply: Element, rate: Element, currency: string) {
  const items = [...children(reply, "VehicleCharge"), ...children(rate, "VehicleCharge")];
  const unique = new Map<string, NonNullable<OfferEvidence["lineItems"]>[number]>();
  const inclusions = { IncludedInBase: "base", IncludedInTotal: "total", NotIncluded: "not_included" } as const;
  let omitted = false;
  for (const item of items) {
    const category = cleanLabel(item.fields.Category);
    const amounts = children(item, "Amount");
    const percents = children(item, "Percentage");
    const value = money(amounts[0]?.text.trim());
    const percent = percents[0]?.text.trim();
    const percentage = /^\d{1,4}(?:\.\d{1,6})?$/.test(percent ?? "") ? Number(percent) : undefined;
    if (!category || amounts.length > 1 || percents.length > 1
      || amounts.length && value?.currency !== currency
      || percents.length && (percentage === undefined || percentage > 1000)) {
      omitted = true;
      continue;
    }
    const entry = {
      category, name: cleanLabel(item.fields.Name), basis: cleanLabel(item.fields.Type),
      amountCents: value?.cents, percentage,
      inclusion: Object.hasOwn(inclusions, item.fields.IncludedInRate)
        ? inclusions[item.fields.IncludedInRate as keyof typeof inclusions] : "unknown" as const,
    };
    unique.set(JSON.stringify(entry), entry);
  }
  return { lineItems: [...unique.values()].slice(0, 20), omitted: omitted || unique.size > 20 };
}

function readRules(reply: Element, selected: ReturnType<typeof matrixOffers>[number], vendor: string, pickup: Station, dropoff: Station, same: boolean) {
  const cars = children(reply, "Vehicle");
  const rates = children(cars[0], "VehicleRate");
  const car = cars[0];
  const rate = rates[0];
  const chosen = selected.rate.fields;
  if (cars.length !== 1 || rates.length !== 1 || car.fields.VendorCode !== vendor
    || car.fields.AcrissVehicleCode !== selected.vehicle.fields.AcrissVehicleCode
    || car.fields.VehicleClass !== selected.vehicle.fields.VehicleClass
    || rate.fields.RateCode !== chosen.RateCode
    || (["RateCategory", "RatePeriod"] as const).some((key) => chosen[key] && rate.fields[key] !== chosen[key])
    || !same && (car.fields.ReturnAtPickup === "true" || car.fields.ReturnAtPickup === "1")) {
    throw new ToolReadError("Travelport rules did not match the selected supplier, vehicle and rate.");
  }
  const starts = children(reply, "PickupLocationInformation");
  const ends = children(reply, "ReturnLocationInformation");
  if (starts.length > 1 || ends.length > 1
    || starts.some((location) => !stationMatches(location.fields, location.fields.LocationNumber, pickup, vendor))
    || ends.some((location) => !stationMatches(location.fields, location.fields.LocationNumber, dropoff, vendor))) {
    throw new ToolReadError("Travelport rules returned conflicting or ambiguous station identifiers.");
  }
  // An estimate or matching rates cannot prove itemized fees or renter eligibility.
  // Location echoes in VehicleRulesRsp are often absent for 1G, and dates are not echoed.
  const supplierRates = children(rate, "SupplierRate");
  if (supplierRates.length > 1) throw new ToolReadError("Travelport rules returned ambiguous supplier amounts.");
  const raw = supplierRates[0]?.fields ?? {};
  const entries = {
    baseCents: raw.BaseRate,
    estimateCents: raw.EstimatedTotalAmount,
    mandatoryCents: raw.MandatoryChargeTotal,
    dropOffCents: raw.DropOffCharge,
  };
  const amounts: NonNullable<OfferEvidence["amounts"]> = {};
  for (const key of Object.keys(entries) as (keyof typeof entries)[]) {
    if (entries[key] === undefined) continue;
    const amount = money(entries[key]);
    if (!amount || amount.currency !== selected.offer.currency) {
      throw new ToolReadError("Travelport rules amounts were invalid or in a different currency.");
    }
    amounts[key] = amount.cents;
  }
  if ((amounts.baseCents !== undefined && selected.offer.charges.base != null && amounts.baseCents !== selected.offer.charges.base)
    || (amounts.estimateCents !== undefined && selected.offer.supplierEstimateCents !== undefined && amounts.estimateCents !== selected.offer.supplierEstimateCents)) {
    throw new ToolReadError("Travelport rules amounts differed from the Matrix quote.");
  }
  if (amounts.estimateCents !== undefined && Object.values(amounts).some((amount) => amount > amounts.estimateCents!)) {
    throw new ToolReadError("Travelport rules amounts exceeded the reported rental estimate.");
  }
  const details = summary([
    ...children(rate, "VehicleRateDescription").flatMap((item) => children(item, "Text").map((line) => line.text)),
    ...children(reply, "OperationTime").map((line) => line.text),
  ]);
  const warnings = children(reply, "ResponseMessage", common).some(({ fields }) => fields.Type === "Warning");
  if (warnings) return {
    status: "informational" as const, providerReference: ref(reply),
    summary: "Travelport returned a warning with the rate rules. Rule text and amounts were withheld.",
  };
  const matched = starts.length === 1 && (same || ends.length === 1);
  const { lineItems, omitted } = ruleCharges(reply, rate, selected.offer.currency);
  if (omitted) details.unshift("Some charge lines were invalid or exceeded the display limit.");
  return {
    status: matched ? "matched" as const : "informational" as const,
    providerReference: ref(reply), details: details.slice(0, 12), amounts: Object.keys(amounts).length ? amounts : undefined,
    lineItems: lineItems.length ? lineItems : undefined,
    summary: matched ? "Rules matched the station identifiers and selected rate. Trip times and complete renter charges remain unverified."
      : "Rules matched the selected vehicle and rate. The response omitted exact station identifiers or rental times.",
  };
}

function readLocationDetails(reply: Element, vendor: string) {
  const vendors = children(reply, "VendorInfo");
  const locations = children(reply, "LocationInfo");
  if (vendors.length !== 1 || vendors[0].fields.Code !== vendor || locations.length !== 1
    || !cleanLabel(locations[0].fields.Name)) {
    throw new ToolReadError("Travelport did not return one usable counter record for this supplier.");
  }
  const warnings = children(reply, "ResponseMessage", common).filter(({ fields }) => fields.Type === "Warning");
  if (warnings.some(({ text }) => !/^the requested modifier - ReturnDateTime is ignored for this provider\.?$/i.test(text.trim()))) {
    return {
      status: "informational" as const, providerReference: ref(reply),
      summary: "Travelport returned a warning for this counter request. Counter details were withheld.",
    };
  }
  const counter = locations[0];
  const details = summary([
    counter.fields.Name,
    counter.fields.CounterLocation,
    ...children(counter, "LocationAddress", common).slice(0, 1).map((address) =>
      ["Street", "City", "PostalCode", "Country"].map((part) => child(address, part, common)?.text).filter(Boolean).join(", ")),
    ...children(counter, "OperationTime").map((line) => line.text),
    child(counter, "ShuttleInfo")?.text,
    ...children(child(reply, "VehiclePolicy"), "VehicleDisclaimer").flatMap((line) =>
      line.fields.Type === "Vehicles" ? [] : [line.fields.Description, line.text]),
  ]);
  return {
    status: "informational" as const, providerReference: ref(reply), details,
    summary: "Counter details returned. The response does not echo the requested station ID or date.",
  };
}

type EvidenceData = Omit<OfferEvidence, "operation" | "sourceUrl" | "observedAt">;
async function supplemental(
  read: RunFollowup, operation: FollowupOperation, sourceUrl: string, work: (signal: AbortSignal) => Promise<EvidenceData>,
): Promise<OfferEvidence> {
  const result = await read(operation, work);
  return result.status === "returned" ? { operation, sourceUrl, observedAt: result.observedAt, ...result.value }
    : { operation, sourceUrl, status: result.status, summary: result.reason };
}

function nextWallDate(time: string) {
  return new Date(Date.parse(`${time}Z`) + 86_400_000).toISOString().slice(0, 19);
}

async function responseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ToolReadError("Travelport returned an empty response.");
  const decoder = new TextDecoder();
  let size = 0;
  let xml = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return xml + decoder.decode();
    size += value.length;
    if (size > maxResponseBytes) {
      void reader.cancel().catch(() => {});
      throw new ToolReadError("Travelport response exceeded the supported size.");
    }
    xml += decoder.decode(value, { stream: true });
  }
}

export function travelportTool(brand: Brand, settings: TravelportSettings, account: Account, transport: typeof fetch = fetch): Tool {
  const vendor = travelportVendors[brand];
  const endpoint = `https://${settings.region}.universal-api.travelport.com/B2BGateway/connect/uAPI/VehicleService`;
  const markets = new Map(Object.entries(settings.markets).map(([area, codes]) => [area.toLowerCase(), codes]));

  async function request(operation: "VehicleLocationReq" | "VehicleSearchAvailabilityReq" | "VehicleRulesReq" | "VehicleLocationDetailReq", parameters: Record<string, string>, content: string, signal: AbortSignal) {
    const { username, password, targetBranch } = account;
    if (!username || !password || !targetBranch) {
      throw new ToolReadError("Travelport requires a provisioned 1G Vehicle account and target branch.", true);
    }
    const body = `<s:Envelope xmlns:s="${soap}" xmlns:v="${vehicle}" xmlns:c="${common}"><s:Body>`
      + `<v:${operation}${attrs({ TargetBranch: targetBranch, ...parameters })}>`
      + `<c:BillingPointOfSaleInfo OriginApplication="UAPI"/>${content}</v:${operation}></s:Body></s:Envelope>`;
    const response = await transport(endpoint, {
      method: "POST", redirect: "error", signal, body,
      headers: {
        authorization: `Basic ${Buffer.from(`Universal API/${username}:${password}`).toString("base64")}`,
        "content-type": "text/xml; charset=utf-8", soapaction: '""',
      },
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const reason = [401, 403].includes(response.status) ? "Travelport rejected authentication or vehicle access."
        : response.status === 429 ? "Travelport rate limit reached." : `Travelport returned HTTP ${response.status}.`;
      throw new ToolReadError(reason, [401, 403, 429].includes(response.status));
    }
    const envelope = child(parseXml(await responseText(response)), "Envelope", soap);
    const payload = child(envelope, "Body", soap);
    const reply = child(payload, operation.replace(/Req$/, "Rsp"));
    if (!reply || children(reply, "ResponseMessage", common).some(({ fields }) => fields.Type === "Error")) {
      throw new ToolReadError("Travelport returned a SOAP fault or no usable shopping response.");
    }
    return reply;
  }

  return {
    async listBranches({ area, at, cursor }, signal) {
      const codes = markets.get(area.toLowerCase()) ?? (marketCode.test(area.toUpperCase()) ? [area.toUpperCase()] : []);
      const index = Number(cursor ?? 0);
      const code = codes[index];
      if (!code || !at) return { branches: [], partialReason: "Configure a Travelport city or airport code for this area." };
      const reply = await request("VehicleLocationReq", {},
        `<v:Vendor Code="${vendor}"/><v:PickupDateLocation${attrs({ Date: at.slice(0, 10), Location: code })}/>`, signal);
      const items = children(reply, "VehicleLocation");
      const branches = items.map((item) => parseStation(item, vendor)).filter((item) => item !== null);
      const unique = [...new Map(branches.map((branch) => [branch.id, branch])).values()];
      const warnings = children(reply, "ResponseMessage", common).some(({ fields }) => fields.Type === "Warning");
      const partial = warnings || !unique.length || items.length !== branches.length || unique.length > 250;
      return {
        branches: unique.slice(0, 250), nextCursor: index + 1 < codes.length ? String(index + 1) : undefined,
        partialReason: partial ? "Travelport returned a warning or incomplete exact station data for this market." : undefined,
      };
    },
    async quote(input, signal) {
      const pickup = stationFromId(input.pickupId, vendor);
      const dropoff = stationFromId(input.returnId, vendor);
      const same = input.pickupId === input.returnId;
      const pickupTime = localTime(input.pickupAt);
      const returnTime = localTime(input.returnAt);
      if (!pickupTime || !returnTime) throw new ToolReadError("Travelport requires local station date and time.");
      const location = (type: string, station: Station) => `<v:VendorLocation${attrs({
        ProviderCode: "1G", VendorCode: vendor, Type: type,
        LocationCode: station.market, LocationType: station.type, VendorLocationID: station.number,
      })}/>`;
      const reply = await request("VehicleSearchAvailabilityReq", {
        ReturnAllRates: "true", ReturnApproximateTotal: "true", ReturnExtraRateInfo: "true",
      }, `<v:VehicleDateLocation${attrs({ PickupDateTime: pickupTime, ReturnDateTime: returnTime })}>`
        + location("Pickup", pickup) + (same ? "" : location("Return", dropoff))
        + `</v:VehicleDateLocation><v:VehicleSearchModifiers${attrs({ PreferredCurrency: input.currency })}/>`, signal);
      const dates = children(reply, "VehicleDateLocation");
      const stations = children(dates[0], "VendorLocation");
      const pickups = stations.filter(({ fields }) => fields.Type === "Pickup");
      const dropoffs = stations.filter(({ fields }) => fields.Type === "Return");
      const [returnedPickup] = pickups;
      const [returnedDropoff] = dropoffs;
      if (dates.length !== 1 || pickups.length !== 1 || dropoffs.length > 1
        || !matchesStation(returnedPickup, pickup, vendor)
        || (!same || returnedDropoff) && !matchesStation(returnedDropoff, dropoff, vendor)
        || !same && reply.fields.ReturnAtPickup === "true"
        || !sameTime(dates[0]?.fields.PickupDateTime, input.pickupAt)
        || !sameTime(dates[0]?.fields.ReturnDateTime, input.returnAt)) {
        return { status: "unavailable", reason: "Travelport did not confirm the exact ordered stations and rental times." };
      }
      const rates = matrixOffers(reply, input, returnedPickup!, returnedDropoff, vendor);
      if (!rates.length) {
        return { status: "unavailable", reason: "Travelport did not return a matching, priced matrix offer. Inventory remains unverified." };
      }
      return {
        status: "available", offers: rates.map(({ offer }) => ({ ...offer, providerReference: ref(reply) })),
        partialReason: "Travelport matrix estimates are limited to Inside Availability. Mandatory fees and renter terms require separate verification.",
        async followup(offerId, read) {
          const selected = rates.find(({ offer }) => offer.id === offerId);
          if (!selected) return [];
          const pickupNumber = returnedPickup!.fields.VendorLocationID;
          const returnNumber = returnedDropoff?.fields.VendorLocationID ?? pickupNumber;
          const stationFields = (station: Station, number: string, role: "Pickup" | "Return") => ({
            [`${role}Location`]: station.market, [`${role}LocationType`]: station.type, [`${role}LocationNumber`]: number,
          });
          const modifiers = rulesModifiers(selected.vehicle, selected.rate, vendor);
          const rules = modifiers ? await supplemental(read, "rate_rules", rulesDocs, async (signal) => {
            const lookup = `<v:VehicleRulesLookup><v:VehicleDateLocation${attrs({
              PickupDateTime: pickupTime, ReturnDateTime: returnTime,
              ...stationFields(pickup, pickupNumber, "Pickup"),
              ...(!same && stationFields(dropoff, returnNumber, "Return")),
            })}><v:VendorLocation${attrs({
              ProviderCode: "1G", VendorCode: vendor, VendorLocationID: pickupNumber, Key: returnedPickup!.fields.Key,
            })}/></v:VehicleDateLocation>${modifiers}</v:VehicleRulesLookup>`;
            return readRules(await request("VehicleRulesReq", {}, lookup, signal), selected, vendor, pickup, dropoff, same);
          }) : {
            operation: "rate_rules" as const, sourceUrl: rulesDocs, status: "untried" as const,
            summary: "Matrix rate identifiers or vehicle modifiers were insufficient for an exact public-rate rules lookup.",
          };
          const details = (operation: "pickup_details" | "return_details", station: Station, number: string, time: string) =>
            supplemental(read, operation, detailsDocs, async (signal) => {
              const xml = `<v:Vendor Code="${vendor}"/><v:VehicleDateLocation${attrs({
                PickupDateTime: time, ReturnDateTime: nextWallDate(time), ...stationFields(station, number, "Pickup"),
              })}/>`;
              return readLocationDetails(await request("VehicleLocationDetailReq", {}, xml, signal), vendor);
            });
          const pickupDetails = await details("pickup_details", pickup, pickupNumber, pickupTime);
          const returnDetails = await details("return_details", dropoff, returnNumber, returnTime);
          return [rules, pickupDetails, returnDetails];
        },
      };
    },
  };
}
