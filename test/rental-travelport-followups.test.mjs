import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { travelportTool } from "../lib/rental/providers/travelport.ts";
import { compareRentals } from "../lib/rental/search.ts";

const soap = "http://schemas.xmlsoap.org/soap/envelope/";
const vehicle = "http://www.travelport.com/schema/vehicle_v54_0";
const common = "http://www.travelport.com/schema/common_v54_0";
const settings = { region: "americas", markets: {} };
const account = { username: "synthetic-user", password: "synthetic-password", targetBranch: "FIXTURE" };
const date = { pickupAt: "2030-06-15T10:00:00-07:00", returnAt: "2030-06-18T11:00:00-07:00" };
const pickupId = "1G-ET-SFO-CityCenterDowntown-1";
const returnId = "1G-ET-OAK-Airport-9";
const location = (area, id) => ({
  area, candidateBranches: [{ supplier: "enterprise", branchId: id }],
  accessByBranch: [{ supplier: "enterprise", branchId: id, minutes: 5, costCents: 0 }],
});
const trip = {
  ...date, origin: location("SFO", pickupId), destination: location("OAK", returnId),
  preferences: { drivers: 2, driverAge: 22, carClass: "economy" },
};

function xml(body) {
  return `<s:Envelope xmlns:s="${soap}" xmlns:v="${vehicle}" xmlns:c="${common}"><s:Body>${body}</s:Body></s:Envelope>`;
}

// Optionally prove generated requests and synthetic responses against the pinned
// third-party archive. The normal offline test suite uses no downloaded XSDs.
function verifyXsd(document) {
  const folder = process.env.GUIDO_TRAVELPORT_V54_SCHEMA_DIR;
  if (!folder) return;
  execFileSync("python3", ["-c", `
import sys
from pathlib import Path
from lxml import etree

directory = Path(sys.argv[1])
parser = etree.XMLParser(resolve_entities=False, no_network=True)
payload = etree.fromstring(sys.stdin.buffer.read(), parser)
body = payload.find('{http://schemas.xmlsoap.org/soap/envelope/}Body')
assert len(body) == 1
schema = etree.XMLSchema(etree.parse(str(directory / 'vehicle_v54_0' / 'VehicleReqRsp.xsd'), parser))
schema.assertValid(body[0])
`, folder], { input: document, stdio: ["pipe", "pipe", "pipe"] });
}

function catalog(scope) {
  const airport = scope === "OAK";
  return `<v:VehicleLocationRsp><v:VehicleLocation>
    <c:VendorLocation ProviderCode="1G" VendorCode="ET" VendorLocationID="${airport ? "09" : "01"}"/>
    <v:LocationInformation LocationType="${airport ? "Airport" : "CityCenterDowntown"}" Location="${scope}">
      <v:Address><c:Street>Synthetic branch in ${scope}</c:Street><c:City>${scope}</c:City></v:Address>
    </v:LocationInformation>
  </v:VehicleLocation></v:VehicleLocationRsp>`;
}

function matrix({ same = false, missingModifiers = false, prepaid = false } = {}) {
  return `<v:VehicleSearchAvailabilityRsp TransactionId="MATRIX101">
    <v:VehicleDateLocation PickupDateTime="${date.pickupAt}" ReturnDateTime="${date.returnAt}">
      <v:VendorLocation ProviderCode="1G" VendorCode="ET" VendorLocationID="01" Key="fixture-pickup-key"
        LocationType="CityCenterDowntown" LocationCode="SFO" Type="Pickup"><v:BusinessHours>Pickup day 09:00 to 18:00</v:BusinessHours></v:VendorLocation>
      ${same ? "" : `<v:VendorLocation ProviderCode="1G" VendorCode="ET" VendorLocationID="09" Key="fixture-return-key"
        LocationType="Terminal" LocationCode="OAK" Type="Return"><v:BusinessHours>Return day 00:00 to 23:59</v:BusinessHours></v:VendorLocation>`}
    </v:VehicleDateLocation>
    <v:Vehicle VendorCode="ET" VendorLocationKey="fixture-pickup-key" AcrissVehicleCode="ECAR"
      VehicleClass="Economy" Category="Car" ${missingModifiers ? "" : 'TransmissionType="Automatic" AirConditioning="true"'}
      MakeModel="Synthetic Economy" PassengerCount="4">
      <v:VehicleRate RateAvailability="Available" RateCategory="Standard" RatePeriod="Daily" RateCode="FIX1"
        ${prepaid ? 'CorporateRate="true"' : ""}>
        <v:ApproximateRate BaseRate="USD180.00" EstimatedTotalAmount="USD240.00"/>
        <v:RateHostIndicator InventoryToken="synthetic-inventory" RateToken="synthetic-rate&amp;identifier"/>
      </v:VehicleRate>
    </v:Vehicle>
  </v:VehicleSearchAvailabilityRsp>`;
}

function rules({ echo = false, same = false, station = "009", rateCode = "FIX1", estimate = "USD240.00",
  amount = "USD12.00", warning = false, conflicting = false } = {}) {
  return `<v:VehicleRulesRsp TransactionId="RULES101">
    ${warning ? '<c:ResponseMessage Code="4" Type="Warning" ProviderCode="1G">Synthetic incomplete rules warning</c:ResponseMessage>' : ""}
    <v:Vehicle VendorCode="ET" AcrissVehicleCode="ECAR" VehicleClass="Economy" Category="Car" AirConditioning="true" TransmissionType="Automatic"
      ${conflicting ? 'ReturnAtPickup="true"' : ""}>
      <v:VehicleRate RatePeriod="Daily" RateCode="${rateCode}" RateCategory="Standard">
        <v:SupplierRate BaseRate="USD180.00" EstimatedTotalAmount="${estimate}" MandatoryChargeTotal="USD60.00" DropOffCharge="USD20.00"/>
        <v:VehicleRateDescription Name="General">
          <v:Text>Synthetic policy requires the renter to present the specified ID.</v:Text>
          <v:Text>Synthetic young-driver terms are subject to confirmation.</v:Text>
        </v:VehicleRateDescription>
      </v:VehicleRate>
    </v:Vehicle>
    <v:OperationTime>Test policy describes local counter hours.</v:OperationTime>
    <v:VehicleCharge Category="Tax" Name="Synthetic sales tax" Type="Percent" IncludedInRate="IncludedInTotal">
      <v:Percentage>9.37</v:Percentage>
    </v:VehicleCharge>
    <v:VehicleCharge Category="Surcharge" Name="Synthetic rental facility fee" Type="Rental" IncludedInRate="NotIncluded">
      <v:Amount>${amount}</v:Amount>
    </v:VehicleCharge>
    ${echo ? '<v:PickupLocationInformation VendorCode="ET" LocationCode="SFO" LocationType="CityCenterDowntown" LocationNumber="001"/>' : ""}
    ${echo && !same ? `<v:ReturnLocationInformation VendorCode="ET" LocationCode="OAK" LocationType="Airport" LocationNumber="${station}"/>` : ""}
  </v:VehicleRulesRsp>`;
}

function details(market, { vendor = "ET", ambiguous = false,
  warning = "The requested modifier - ReturnDateTime is ignored for this provider." } = {}) {
  const row = `<v:LocationInfo Name="Synthetic ${market} counter" CounterLocation="Synthetic counter description">
    <c:LocationAddress><c:Street>Synthetic branch in ${market}</c:Street><c:City>${market}</c:City><c:Country>US</c:Country></c:LocationAddress>
    <v:OperationTime>Synthetic counter hours 08:00 to 17:00</v:OperationTime>
    <v:ShuttleInfo>Synthetic shuttle information</v:ShuttleInfo>
  </v:LocationInfo>`;
  return `<v:VehicleLocationDetailRsp TransactionId="DETAILS${market}">
    <c:ResponseMessage Code="0" Type="Warning" ProviderCode="1G">${warning}</c:ResponseMessage>
    <v:VendorInfo Code="${vendor}"/>${row}${ambiguous ? row : ""}
    <v:VehiclePolicy><v:VehicleDisclaimer Type="AgeRequirements" Description="Synthetic minimum age information"/></v:VehiclePolicy>
  </v:VehicleLocationDetailRsp>`;
}

function testAdapter(options = {}) {
  const calls = [];
  const invalidXml = [];
  function validate(document) {
    if (!options.verify) return;
    try {
      verifyXsd(document);
    } catch (error) {
      invalidXml.push(error.stderr?.toString() ?? error.message);
      throw error;
    }
  }
  const adapter = travelportTool("enterprise", settings, account, async (url, request) => {
    const operation = request.body.match(/<v:(Vehicle\w+Req)\b/)?.[1];
    calls.push({ operation, body: request.body });
    assert.equal(url, "https://americas.universal-api.travelport.com/B2BGateway/connect/uAPI/VehicleService");
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    validate(request.body);
    const check = (body) => {
      const document = xml(body);
      validate(document);
      return new Response(document);
    };
    switch (operation) {
      case "VehicleLocationReq":
        return check(catalog(request.body.includes('Location="OAK"') ? "OAK" : "SFO"));
      case "VehicleSearchAvailabilityReq":
        return check(matrix(options.matrix));
      case "VehicleRulesReq":
        return options.rulesError ? options.rulesError() : check(rules(options.rules));
      case "VehicleLocationDetailReq":
        return options.detailsError ? options.detailsError() : check(details(request.body.includes('PickupLocation="OAK"') ? "OAK" : "SFO", options.details));
      default:
        assert.fail(`Unexpected operation ${operation}`);
    }
  });
  const run = async (input = trip, limit = 6, abort) => {
    const result = await compareRentals(input, [{
      id: "enterprise", name: "Enterprise", limits: { followupRequests: limit },
      tools: [{ id: "travelport", environment: "live", catalogByDate: true, create: () => adapter }],
    }], "live", abort);
    assert.deepEqual(invalidXml, []);
    return result;
  };
  return { calls, run };
}

const supplementalOps = ["VehicleRulesReq", "VehicleLocationDetailReq", "VehicleLocationDetailReq"];

test("Travelport exact-pair rule and counter requests conform to the pinned v54 schema", async () => {
  const { calls, run } = testAdapter({ verify: true });
  const result = await run();
  assert.deepEqual(calls.map(({ operation }) => operation), [
    "VehicleLocationReq", "VehicleLocationReq", "VehicleSearchAvailabilityReq", ...supplementalOps,
  ]);
  const [, , , rule, pickup, dropoff] = calls;
  assert.match(rule.body, /PickupDateTime="2030-06-15T10:00:00" ReturnDateTime="2030-06-18T11:00:00"/);
  assert.match(rule.body, /PickupLocation="SFO" PickupLocationType="CityCenterDowntown" PickupLocationNumber="01"/);
  assert.match(rule.body, /ReturnLocation="OAK" ReturnLocationType="Airport" ReturnLocationNumber="09"/);
  assert.match(rule.body, /RatePeriod="Daily".*VendorCode="ET" RateCode="FIX1"/);
  assert.match(rule.body, /InventoryToken="synthetic-inventory" RateToken="synthetic-rate&amp;identifier"/);
  assert.doesNotMatch(rule.body, /VehicleReservationLocatorCode|DriverInfo/);
  assert.match(pickup.body, /PickupDateTime="2030-06-15T10:00:00" ReturnDateTime="2030-06-16T10:00:00".*PickupLocationNumber="01"/);
  assert.match(dropoff.body, /PickupDateTime="2030-06-18T11:00:00" ReturnDateTime="2030-06-19T11:00:00".*PickupLocationNumber="09"/);

  const option = result.options[0];
  const [rate, start, end] = option.offer.supplementalEvidence;
  assert.equal(rate.status, "informational");
  assert.match(rate.summary, /omitted exact station identifiers/);
  assert.equal(rate.providerReference, "RULES101");
  assert.deepEqual(rate.amounts, { baseCents: 18000, estimateCents: 24000, mandatoryCents: 6000, dropOffCents: 2000 });
  assert.equal(rate.lineItems[0].percentage, 9.37);
  assert.equal(rate.lineItems[0].inclusion, "total");
  assert.equal(rate.lineItems[1].amountCents, 1200);
  assert.equal(rate.lineItems[1].inclusion, "not_included");
  assert.equal(start.status, "informational");
  assert.equal(end.status, "informational");
  assert.ok(start.details.includes("Synthetic SFO counter"));
  assert.ok(end.details.includes("Synthetic OAK counter"));
  assert.ok(end.details.includes("Synthetic minimum age information"));
  assert.equal(option.offer.returnHours, "Return day 00:00 to 23:59");
  assert.equal(option.estimatedTotalCents, null);
  assert.equal(option.rentalTotalCents, null);
  assert.equal(option.knownRentalCents, 18000);
  assert.equal(result.recommendation, null);
  assert.equal(result.coverage[0].pairsChecked, 1);
  assert.equal(result.coverage[0].quotesAttempted, 1);
  assert.equal(result.coverage[0].followupsAttempted, 3);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-inventory|synthetic-rate&identifier|synthetic-password/);
});

test("matched station echoes do not promote same-station rates or assign undirected hours", async () => {
  const { calls, run } = testAdapter({ matrix: { same: true }, rules: { echo: true, same: true }, verify: true });
  const result = await run({ ...trip, destination: location("SFO", pickupId) });
  assert.equal(result.options[0].offer.supplementalEvidence[0].status, "matched");
  assert.equal(result.options[0].estimatedTotalCents, null);
  assert.equal(result.options[0].offer.returnHours, undefined);
  assert.equal(result.recommendation, null);
  assert.doesNotMatch(calls[3].body, /ReturnLocation(?:Type|Number)?=/);
  assert.match(calls[4].body, /2030-06-15T10:00:00.*LocationNumber="01"/);
  assert.match(calls[5].body, /2030-06-18T11:00:00.*LocationNumber="01"/);
});

test("malformed and inconsistent rules preserve the original Matrix quote", async () => {
  const cases = [
    { rules: { echo: true, station: "08" }, message: /conflicting or ambiguous station/ },
    { rules: { rateCode: "FIX2" }, message: /did not match/ },
    { rules: { conflicting: true }, message: /did not match/ },
    { rules: { estimate: "EUR240.00" }, message: /different currency/ },
    { rules: { estimate: "USD250.00" }, message: /differed from the Matrix/ },
    { rulesError: () => new Response("<broken>"), message: /invalid data/ },
    { rulesError: () => new Response(xml('<s:Fault><faultcode>s:Server</faultcode><faultstring>Synthetic fault</faultstring></s:Fault>')), message: /SOAP fault/ },
    { rules: { estimate: "USDNaN" }, message: /invalid/ },
  ];
  for (const { message, ...options } of cases) {
    const { run } = testAdapter(options);
    const result = await run();
    const [option] = result.options;
    const [evidence] = option.offer.supplementalEvidence;
    assert.equal(evidence.status, "unavailable");
    assert.match(evidence.summary, message);
    assert.equal(evidence.amounts, undefined);
    assert.equal(option.offer.supplierEstimateCents, 24000);
    assert.equal(result.recommendation, null);
  }
});

test("warnings, invalid line amounts, and ambiguous location details are reported", async () => {
  const { run } = testAdapter({ rules: { warning: true }, details: { ambiguous: true } });
  const [rulesEvidence, pickup, dropoff] = (await run()).options[0].offer.supplementalEvidence;
  assert.equal(rulesEvidence.status, "informational");
  assert.match(rulesEvidence.summary, /warning/);
  assert.equal(rulesEvidence.amounts, undefined);
  assert.equal(pickup.status, "unavailable");
  assert.equal(dropoff.status, "unavailable");

  const invalid = await testAdapter({ rules: { amount: "GBP12.00" }, details: { vendor: "ZI" } }).run();
  const [chargeEvidence, wrongVendor] = invalid.options[0].offer.supplementalEvidence;
  assert.equal(chargeEvidence.lineItems.length, 1);
  assert.match(chargeEvidence.details[0], /invalid/);
  assert.equal(wrongVendor.status, "unavailable");

  const warning = await testAdapter({ details: { warning: "The station number was ignored." } }).run();
  const [, warnedCounter] = warning.options[0].offer.supplementalEvidence;
  assert.equal(warnedCounter.status, "informational");
  assert.equal(warnedCounter.details, undefined);
  assert.match(warnedCounter.summary, /withheld/);
});

test("unsupported or non-public Matrix selectors skip rules before making a request", async () => {
  for (const matrixOptions of [{ missingModifiers: true }, { prepaid: true }]) {
    const { calls, run } = testAdapter({ matrix: matrixOptions });
    const result = await run();
    assert.equal(calls.length, 5);
    assert.equal(calls.some(({ operation }) => operation === "VehicleRulesReq"), false);
    assert.equal(result.options[0].offer.supplementalEvidence[0].status, "untried");
  }
});

test("rate limits and entitlement errors stop supplemental traffic and keep the original pair attempted", async () => {
  for (const status of [401, 403, 429]) {
    const { calls, run } = testAdapter({ rulesError: () => new Response(null, { status }) });
    const result = await run();
    assert.deepEqual(calls.map(({ operation }) => operation), [
      "VehicleLocationReq", "VehicleLocationReq", "VehicleSearchAvailabilityReq", "VehicleRulesReq",
    ]);
    assert.deepEqual(result.options[0].offer.supplementalEvidence.map(({ status }) => status), [
      "unavailable", "untried", "untried",
    ]);
    assert.equal(result.coverage[0].quotesAttempted, 1);
    assert.equal(result.coverage[0].pairsChecked, 1);
    assert.equal(result.coverage[0].followupsAttempted, 1);
    assert.equal(result.recommendation, null);
  }
});

test("the follow-up budget marks the remaining operations untried", async () => {
  const { calls, run } = testAdapter({ detailsError: () => new Response(null, { status: 503 }) });
  const result = await run(trip, 2);
  assert.equal(calls.length, 5);
  assert.equal(result.coverage[0].followupsAttempted, 2);
  const [rate, start, end] = result.options[0].offer.supplementalEvidence;
  assert.equal(rate.status, "informational");
  assert.equal(start.status, "unavailable");
  assert.match(start.summary, /HTTP 503/);
  assert.equal(end.status, "untried");
  assert.match(end.summary, /budget/);
});

test("canceling a supplemental request preserves the quote and records only started follow-ups", async () => {
  const abort = new AbortController();
  const { calls, run } = testAdapter({ rulesError: () => {
    abort.abort();
    return new Promise(() => {});
  } });
  const result = await run(trip, 6, abort.signal);
  const [rate, start, end] = result.options[0].offer.supplementalEvidence;
  assert.equal(calls.length, 4);
  assert.equal(result.coverage[0].followupsAttempted, 1);
  assert.equal(result.coverage[0].pairsChecked, 1);
  assert.equal(rate.status, "unavailable");
  assert.equal(start.status, "untried");
  assert.equal(end.status, "untried");
  assert.equal(result.options[0].offer.supplierEstimateCents, 24000);
});
