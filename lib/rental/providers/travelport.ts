import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { ToolReadError, type Branch, type QuoteRequest, type Tool } from "../contracts.ts";

export const travelportVendors = { hertz: "ZE", avis: "ZI", enterprise: "ET" } as const;
type Brand = keyof typeof travelportVendors;
type Station = { market: string; type: string; number: string };
type Element = { name: string; namespace: string; fields: Record<string, string>; children: Element[]; text: string };

const soap = "http://schemas.xmlsoap.org/soap/envelope/";
const vehicle = "http://www.travelport.com/schema/vehicle_v54_0";
const common = "http://www.travelport.com/schema/common_v54_0";
const matrixDocs = "https://support.travelport.com/WebHelp/uAPI/Content/Vehicle/Vehicle_Matrix/Vehicle_Matrix.htm";
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

function matchesStation(location: Element | undefined, station: Station, vendor: string) {
  const actual = location?.fields;
  const airportTerminalAlias = [actual?.LocationType, station.type].sort().join("/") === "Airport/Terminal";
  return actual?.ProviderCode === "1G" && actual.VendorCode === vendor && actual.LocationCode === station.market
    && actual.VendorLocationID?.replace(/^0+(?=\d)/, "") === station.number
    && (actual.LocationType === station.type || airportTerminalAlias);
}

function money(value: string | undefined) {
  const parsed = /^([A-Z]{3})(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value ?? "");
  if (!parsed) return;
  const cents = Number(parsed[2]) * 100 + Number((parsed[3] ?? "").padEnd(2, "0"));
  if (cents <= 100_000_000) return { currency: parsed[1], cents };
}

function matrixOffers(reply: Element, input: QuoteRequest, pickup: Element, dropoff: Element | undefined, vendor: string) {
  const offered = new Map<string, ReturnType<typeof normalizeRate>>();
  for (const vehicle of children(reply, "Vehicle")) {
    if (vehicle.fields.VendorCode !== vendor || !pickup.fields.Key || vehicle.fields.VendorLocationKey !== pickup.fields.Key) continue;
    for (const rate of children(vehicle, "VehicleRate")) {
      const offer = normalizeRate(vehicle, rate, input.currency, pickup, dropoff);
      if (offer) offered.set(offer.id, offer);
    }
  }
  return [...offered.values()].filter((offer) => offer !== undefined).slice(0, 30);
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
    rentalTerms, pickupHours: cleanLabel(pickup.fields.BusinessHours),
    returnHours: cleanLabel(dropoff?.fields.BusinessHours),
    sourceUrl: matrixDocs,
  };
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

  async function request(operation: "VehicleLocationReq" | "VehicleSearchAvailabilityReq", parameters: Record<string, string>, content: string, signal: AbortSignal) {
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
      const dates = child(reply, "VehicleDateLocation");
      const stations = children(dates, "VendorLocation");
      const returnedPickup = stations.find(({ fields }) => fields.Type === "Pickup");
      const returnedDropoff = stations.find(({ fields }) => fields.Type === "Return");
      if (!matchesStation(returnedPickup, pickup, vendor)
        || (!same || returnedDropoff) && !matchesStation(returnedDropoff, dropoff, vendor)
        || !same && reply.fields.ReturnAtPickup === "true"
        || !sameTime(dates?.fields.PickupDateTime, input.pickupAt)
        || !sameTime(dates?.fields.ReturnDateTime, input.returnAt)) {
        return { status: "unavailable", reason: "Travelport did not confirm the exact ordered stations and rental times." };
      }
      const offers = matrixOffers(reply, input, returnedPickup!, returnedDropoff, vendor);
      if (!offers.length) {
        return { status: "unavailable", reason: "Travelport did not return a matching, priced matrix offer. Inventory remains unverified." };
      }
      return {
        status: "available", offers: offers.map((offer) => ({
          ...offer, providerReference: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(reply.fields.TransactionId ?? "")
            ? reply.fields.TransactionId : undefined,
        })),
        partialReason: "Travelport matrix estimates are limited to Inside Availability. Mandatory fees and renter terms require separate verification.",
      };
    },
  };
}
