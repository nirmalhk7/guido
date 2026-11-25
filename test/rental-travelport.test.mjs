import assert from "node:assert/strict";
import test from "node:test";
import { travelportTool, travelportVendors } from "../lib/rental/providers/travelport.ts";
import { compareRentals } from "../lib/rental/search.ts";

const soap = "http://schemas.xmlsoap.org/soap/envelope/";
const vehicle = "http://www.travelport.com/schema/vehicle_v54_0";
const common = "http://www.travelport.com/schema/common_v54_0";
const endpoint = "https://americas.universal-api.travelport.com/B2BGateway/connect/uAPI/VehicleService";
const settings = { region: "americas", markets: { "Synthetic Bay": ["SFO", "OAK"] } };
const account = { username: "fixture-user", password: "fixture-password", targetBranch: "FIXTURE" };
const dates = { pickupAt: "2030-06-15T10:00:00-07:00", returnAt: "2030-06-18T11:00:00-07:00" };
const signal = new AbortController().signal;
const quoteInput = { ...dates, pickupId: "1G-ET-SFO-CityCenterDowntown-1", returnId: "1G-ET-SFO-Airport-1",
  currency: "USD", driverAge: 24, drivers: 2 };

function envelope(body) {
  return new Response(`<soap:Envelope xmlns:soap="${soap}" xmlns:v="${vehicle}" xmlns:c="${common}"><soap:Body>${body}</soap:Body></soap:Envelope>`);
}

function station(vendor, type, market = "SFO") {
  return `<v:VehicleLocation><c:VendorLocation ProviderCode="1G" VendorCode="${vendor}" VendorLocationID="01"/>
    <c:Distance Units="MI" Value="5"/><v:LocationInformation LocationType="${type}" Location="${market}">
      <v:Address><c:Street>Synthetic ${type} counter</c:Street><c:City>${market}</c:City></v:Address>
    </v:LocationInformation></v:VehicleLocation>`;
}

function matrix({ returnType = "Terminal", pickupTime = dates.pickupAt, same = false, key = "pickup-key",
  matchedVendor = "ET", vehicles = true } = {}) {
  return envelope(`<v:VehicleSearchAvailabilityRsp TransactionId="FIXTURE220">
    <v:VehicleDateLocation PickupDateTime="${pickupTime}" ReturnDateTime="${dates.returnAt}">
      <v:VendorLocation ProviderCode="1G" VendorCode="ET" Type="Pickup" LocationCode="SFO" LocationType="CityCenterDowntown" VendorLocationID="01"
        Key="pickup-key" BusinessHours="10:00–18:00"/>
      ${same ? "" : `<v:VendorLocation ProviderCode="1G" VendorCode="ET" Type="Return" LocationCode="SFO" LocationType="${returnType}"
        VendorLocationID="1" BusinessHours="00:00–23:59"/>`}
    </v:VehicleDateLocation>
    ${vehicles ? `<v:Vehicle VendorCode="${matchedVendor}" VendorLocationKey="${key}" VehicleClass="Economy" MakeModel="Synthetic economy"
      PassengerCount="4" AcrissVehicleCode="ECAR" TransmissionType="Automatic">
      <v:VehicleRate RateAvailability="Available" RateCode="FIX1" RequiredPayment="Guarantee" UnlimitedMileage="true" DropOffChargesIncluded="true">
        <v:ApproximateRate BaseRate="USD186.50" EstimatedTotalAmount="USD251.09"/>
      </v:VehicleRate>
    </v:Vehicle>` : ""}
  </v:VehicleSearchAvailabilityRsp>`);
}

test("Travelport emits the documented, scoped vehicle location request for each brand and pages market codes", async () => {
  for (const [brand, vendor] of Object.entries(travelportVendors)) {
    const calls = [];
    const adapter = travelportTool(brand, settings, account, async (url, request) => {
      calls.push(request.body);
      assert.equal(url, endpoint);
      assert.equal(request.method, "POST");
      assert.equal(request.redirect, "error");
      assert.equal(request.headers.authorization, `Basic ${Buffer.from("Universal API/fixture-user:fixture-password").toString("base64")}`);
      assert.match(request.body, /VehicleLocationReq TargetBranch="FIXTURE"/);
      assert.match(request.body, new RegExp(`Vendor Code="${vendor}"`));
      assert.match(request.body, /Date="2030-06-15"/);
      return envelope(`<v:VehicleLocationRsp>${station(vendor, "CityCenterDowntown")}
        ${station(vendor, "Airport")}</v:VehicleLocationRsp>`);
    });
    const first = await adapter.listBranches({ area: "synthetic bay", at: dates.pickupAt, currency: "USD" }, signal);
    assert.equal(first.nextCursor, "1");
    assert.deepEqual(first.branches.map(({ id }) => id), [`1G-${vendor}-SFO-CityCenterDowntown-1`, `1G-${vendor}-SFO-Airport-1`]);
    assert.equal(first.branches[0].catalogDistanceKm, 8.04672);
    assert.ok(first.branches.every(({ centerToPickup, returnToCenter }) => !centerToPickup && !returnToCenter));
    const final = await adapter.listBranches({ area: "Synthetic Bay", at: dates.pickupAt, currency: "USD", cursor: first.nextCursor }, signal);
    assert.equal(final.nextCursor, undefined);
    assert.match(calls[0], /Location="SFO"/);
    assert.match(calls[1], /Location="OAK"/);
    const unconfigured = await adapter.listBranches({ area: "Unconfigured City", at: dates.pickupAt, currency: "USD" }, signal);
    assert.match(unconfigured.partialReason, /airport code/);
    assert.equal(calls.length, 2);
  }
});

test("Travelport sends both exact IDs for one-way Matrix and retains an estimate separately from verified rental charges", async () => {
  const calls = [];
  const adapter = travelportTool("enterprise", settings, account, async (_, request) => {
    calls.push(request.body);
    return matrix({ same: !request.body.includes('Type="Return"') });
  });
  const offer = (await adapter.quote(quoteInput, signal)).offers[0];
  assert.match(calls[0], /ReturnAllRates="true" ReturnApproximateTotal="true" ReturnExtraRateInfo="true"/);
  assert.match(calls[0], /PickupDateTime="2030-06-15T10:00:00" ReturnDateTime="2030-06-18T11:00:00"/);
  assert.match(calls[0], /VendorCode="ET" Type="Pickup" LocationCode="SFO" LocationType="CityCenterDowntown" VendorLocationID="1"/);
  assert.match(calls[0], /VendorCode="ET" Type="Return" LocationCode="SFO" LocationType="Airport" VendorLocationID="1"/);
  assert.match(calls[0], /PreferredCurrency="USD"/);
  assert.deepEqual(offer.charges, { base: 18650 });
  assert.equal(offer.supplierEstimateCents, 25109);
  assert.equal(offer.providerReference, "FIXTURE220");
  assert.equal(offer.seats, 4);
  assert.equal(offer.pickupHours, "10:00–18:00");
  assert.equal(offer.returnHours, "00:00–23:59");
  assert.match(offer.rentalTerms.join(" "), /Renter eligibility and additional-driver charges/);
  assert.equal(offer.quotedAt, undefined);
  assert.match(offer.sourceUrl, /support\.travelport\.com/);
  assert.equal((await adapter.quote({ ...quoteInput, returnId: quoteInput.pickupId }, signal)).status, "available");
  assert.doesNotMatch(calls[1], /Type="Return"/);
  assert.equal((await adapter.quote({ ...quoteInput, pickupId: quoteInput.returnId, returnId: quoteInput.pickupId }, signal)).status, "unavailable");
  assert.match(calls[2], /Type="Pickup"[^>]*LocationType="Airport".*Type="Return"[^>]*LocationType="CityCenterDowntown"/);
});

test("Travelport keeps mismatched and silently incomplete inventory unverified", async () => {
  for (const response of [
    matrix({ returnType: "SouthOfCityCenter" }), matrix({ returnType: "OffTerminal" }), matrix({ pickupTime: "2030-06-15T10:00:00Z" }),
    matrix({ same: true }), matrix({ key: "wrong-rate-station" }), matrix({ matchedVendor: "ZI" }), matrix({ vehicles: false }),
  ]) {
    const adapter = travelportTool("enterprise", settings, account, async () => response);
    assert.equal((await adapter.quote(quoteInput, signal)).status, "unavailable");
  }
  const noAccount = travelportTool("enterprise", settings, {}, async () => assert.fail("No call without entitlement credentials"));
  await assert.rejects(noAccount.quote(quoteInput, signal), /provisioned/);
  const throttled = travelportTool("enterprise", settings, account, async () => new Response(null, { status: 429 }));
  await assert.rejects(throttled.quote(quoteInput, signal), (error) => error.stopSource && /rate limit/.test(error.message));
});

test("a Travelport comparison discovers each trip date and leaves the Matrix estimate unranked", async () => {
  const catalogs = [];
  const adapter = travelportTool("enterprise", { ...settings, markets: {} }, account, async (_, request) => {
    if (request.body.includes("VehicleLocationReq")) {
      catalogs.push(request.body);
      return envelope(`<v:VehicleLocationRsp>${station("ET", "CityCenterDowntown")}${station("ET", "Airport")}</v:VehicleLocationRsp>`);
    }
    return matrix();
  });
  const result = await compareRentals({
    ...dates,
    origin: { area: "SFO", candidateBranches: [{ supplier: "enterprise", branchId: quoteInput.pickupId }] },
    destination: { area: "SFO", candidateBranches: [{ supplier: "enterprise", branchId: quoteInput.returnId }] },
    preferences: { drivers: 2, driverAge: 24 },
  }, [{ id: "enterprise", name: "Enterprise", tools: [
    { id: "travelport", environment: "live", catalogByDate: true, create: () => adapter },
  ] }], "live");
  assert.equal(catalogs.length, 2);
  assert.match(catalogs[0], /Date="2030-06-15"/);
  assert.match(catalogs[1], /Date="2030-06-18"/);
  assert.equal(result.options[0].estimatedTotalCents, null);
  assert.equal(result.options[0].rentalTotalCents, null);
  assert.equal(result.options[0].offer.supplierEstimateCents, 25109);
  assert.equal(result.options[0].source.id, "travelport");
  assert.ok(Number.isFinite(Date.parse(result.options[0].source.observedAt)));
  assert.equal(result.recommendation, null);
  assert.equal(result.coverage[0].pairsChecked, 1);
  assert.equal(result.coverage[0].pairs[0].status, "partial");
});
