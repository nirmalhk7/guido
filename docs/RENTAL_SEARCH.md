# Standalone rental comparison

Guido compares pickup and return branches without an email account, LLM, or
vendor credentials. The browser app, HTTP API, and CLI share the same search.

## Run it

Use Node.js 24 or later. Dependency installation requires network access. Sample
searches run offline after installation.

```sh
npm ci --omit=optional
npm --prefix frontend ci
npm --prefix frontend run build
npm run rental:serve
```

Open `http://127.0.0.1:3000/search` and select **Try sample trip**. The sample
covers San Mateo, Belmont, and SFO, with synthetic branch details and June
2030 rates. It quotes nine ordered pairs. From Belmont, returning to SFO is
cheapest, returning to San Mateo costs more, and returning to Belmont costs
the most. SFO to Belmont has a separate price. San Mateo to SFO has an
unknown one-way charge. The audit-trail demo is at
`http://127.0.0.1:3000/?demo`.

Run the same sample from the command line, or pass a trip on standard input
with `-`. Omit `--fixture` to use configured live sources.

```sh
npm run --silent rental:search -- --fixture examples/rental-trip.json
curl --fail-with-body http://127.0.0.1:3000/api/rental-search \
  --json "$(jq -c '{environment:"fixture",trip:.}' examples/rental-trip.json)"
```

The standalone process binds to loopback by default. Set `HOST` and `PORT`
for your host. Put authentication and HTTPS at the ingress before exposing the
service beyond your machine. The standalone server serves the search and demo
and accepts two concurrent searches. During frontend development, Vite proxies
search requests to the standalone process on port 3000.

### Local container

```sh
docker build -t guido-rental .
docker run --rm -p 127.0.0.1:3000:3000 guido-rental
docker run --rm --network none guido-rental node bin/rental-search.ts --fixture examples/rental-trip.json
```

The default image runs the CLI, HTTP API, and Travelport adapter without
Chromium. Build `docker build --target browser -t guido-rental-browser .` if
you configure a Playwright source.

If your build network uses a custom certificate authority, pass its PEM with
`docker build --secret id=guido_build_ca,src=/path/to/ca.pem -t guido-rental .`.

For live searches, mount your provider config and optional modules read-only
and set `GUIDO_RENTAL_CONFIG` to the mounted JSON path. Supply any module
credentials through the host environment.

## Trip input

See [the sample request](../examples/rental-trip.json). `pickupAt` and
`returnAt` are timestamps with the UTC offset for each location and date.
`origin.area` and `destination.area` are city or area labels understood by
your location source. When the destination is omitted Guido uses the origin.
Put any more precise address or label in the optional `label` field,
and coordinates in `coordinates: { latitude, longitude }`. The city or area
and rental criteria are shared with the selected source. The optional label,
coordinates, candidate selections, and private access estimates stay in Guido.

Either endpoint can include `candidateBranches` to select known locations
by `{ supplier, branchId }`, or `accessByBranch` to supply your own travel
estimates. Each estimate has `supplier`, `branchId`, optional `minutes`,
optional `costCents`, and optional `note`. Use the requested currency.
Pickup estimates go from the origin to the branch. Return estimates go from
the branch to the destination. If you return to the same address, include an
explicit `destination` with its own estimates. Omitting the destination
reuses the origin's location only. When a cost or time is unavailable, Guido
marks that value unknown. With coordinates for both points it also calculates
straight-line distance.

Preferences include `priority` (`total_cost`, `pickup_access`, or
`return_access`), `oneWay` (defaults to true), `pickupKind` and `returnKind`
(`airport` or `non_airport`), `driverAge`, `drivers`, `carClass`,
`minSeats`, `currency`, `maxPickupMinutes`, `maxReturnMinutes`, and
`maxTotalCents`. Charge and cost fields hold integer hundredths of the
requested currency. The browser form exposes common preferences and uses USD.
The API and CLI also accept individual branch and access overrides.

## Configure quote sources

Live searches report Hertz, Avis, and Enterprise separately. Set
`GUIDO_RENTAL_CONFIG=/path/to/providers.json` or use the CLI's `--config`
option. IDs are `hertz`, `avis`, and `enterprise`. Each supplier may
have an ordered list of sources and a `limits` object. Guido shows suppliers
without configured sources as unverified. The offline sample is selected
explicitly.

### Travelport Universal API

The [sample configuration](../examples/rental-providers.travelport.json)
sets up the Travelport adapter for all three brands. Use a Travelport market
code as the travel area or configure a coarse name with one or more airport
or city codes. For example, the Bay Area configuration starts at SFO, OAK,
and SJC. The adapter queries each configured market on each leg's local date
and deduplicates the returned station IDs. A station ID includes the provider,
vendor, market, station type, and vendor location number. A location number
alone can identify several different stations.

Travelport Universal API uses SOAP even for read-only shopping. Guido sends
`VehicleLocationReq` and exact-station `VehicleSearchAvailabilityReq`
to the official regional `VehicleService` endpoint. Standard search is
limited to the configured markets. Vehicle Matrix estimates cover suppliers
that have Inside Availability on the provisioned connection. Guido requires
the quote response to confirm the station selections and dates. It shows
Travelport's estimated rental total, station hours, and vehicle terms when
provided. Its fee breakdown stays provisional pending verified mandatory
charges and renter eligibility.

Live verification requires all of the following.

- A provisioned Travelport Universal API SOAP/XML production account and
  Target Branch/Work Area Branch enabled for Galileo `1G`, Vehicle v54, and
  your region. Configure `GUIDO_TRAVELPORT_USERNAME`,
  `GUIDO_TRAVELPORT_PASSWORD`, and `GUIDO_TRAVELPORT_TARGET_BRANCH` from
  the deployment's secret store.
- Read access to Vehicle Location List and exact-pair Vehicle Matrix.
  Confirm the account's inventory and Inside Availability support for Hertz
  `ZE`, Avis `ZI`, and Enterprise `ET` in each target market.
- Approved Vehicle Rules and Location Details access for completing the
  integration's charge and policy fields. Confirm exact stations, local
  hours, cancellation, mileage, driver eligibility, additional drivers,
  and mandatory charges on sample authorized quotes.
- The operator's account limits for request spacing, volume and concurrency.
  Configure the search budget to match those limits.

The XML conformance tests exercise the documented request and response
shapes with synthetic data. Supplier-specific live inventory, fees, and
one-way results still need the provisioned account.

[Travelport credentials](https://support.travelport.com/webhelp/uapi/Content/Getting_Started/Easy_Overview/Getting_Credentials.htm) ·
[Vehicle location list](https://support.travelport.com/webhelp/uapi/Content/Vehicle/Vehicle_Location/Vehicle_Location_List.htm) ·
[Vehicle Matrix](https://support.travelport.com/WebHelp/uAPI/Content/Vehicle/Vehicle_Matrix/Vehicle_Matrix.htm) ·
[Vehicle Rules](https://support.travelport.com/webhelp/uapi/Content/Vehicle/Vehicle_Rules/Vehicle_Rules.htm) ·
[Location details](https://support.travelport.com/webhelp/uapi/Content/Vehicle/Vehicle_Location_Details/Vehicle_Location_Details.htm)

Other documented options include the Avis Budget Group developer program,
which requires its Cars API application subscription, OAuth credentials, and
separate production access. Hertz and Enterprise identify agency GDS
channels. Use an authorized agency or distribution shopping entitlement to
verify station IDs, available brands, quotes, and rate rules for those
channels. The separate Hertz ChatGPT connector can verify public location
lookup. Its vehicle tool starts checkout, which is outside the search flow.

[Avis Budget Group access](https://developer.avis.com/getting-started) ·
[Hertz travel advisors](https://www.hertz.com/us/en/partners/travel) ·
[Enterprise GDS guides](https://ta.enterprise.com/)

### Playwright source

For an authorized browser feed, use a source with `kind: "playwright"`,
`id`, `catalogUrl`, and `quoteUrl`. Install the optional browser package
with `npm ci` and its Chromium binary with `npx playwright install chromium`.
Set `GUIDO_CHROMIUM_EXECUTABLE` to use system Chromium.

The adapter opens an operator-configured public HTTPS endpoint for each
catalog or quote request. Loopback HTTP is supported for local tests. Each
response is an `application/json` document or HTML containing the JSON
in `<script id="guido-data" type="application/json">`. Playwright uses a
fresh browser context, disables page scripts and subresources, and makes
only GET requests to the configured read-only URLs. Redirects, sign-in
walls, and access challenges yield unavailable results. Browser integrations
must have permission for automated reading of the configured URLs.

- The catalog gets `area`, `currency`, and the opaque `cursor` on follow-up
  requests. It returns `{ branches }` and may include `nextCursor` or
  `partialReason`. A branch has `id`, `name`, and `kind`, with
  optional `address`, `coordinates`, `centerToPickup`, `returnToCenter`,
  `pickupNote`, and `returnNote`. The two center estimates have
  `minutes`, `costCents`, and an optional `note`. IDs must identify the
  same physical branch regardless of which area or source returned them.
- The quote gets `pickupId`, `returnId`, `pickupAt`, `returnAt`,
  `currency`, `driverAge`, `drivers`, and optional `carClass` and `minSeats`. Return
  `{ status: "available", offers: [...] }`, `{ status: "no_cars" }`, or
  `{ status: "unavailable", reason: "..." }`. A confirmed empty result
  applies to this exact pair and trip only.
- An offer has `id`, `vehicle`, `carClass`, `currency`, and `charges`.
  Include `seats`, `cancellation`, and supplier `quotedAt` if available.
  Use `supplierEstimateCents` for an estimate with unresolved mandatory
  charges. This field is displayed separately from the verified total.
  Use `sourceUrl` for public evidence without secrets or traveler details.
  Playwright uses same-origin evidence URLs and strips query and fragment.
- Charge keys are `base`, `taxes`, `airport`, `oneWay`, `youngDriver`,
  `additionalDriver`, and `otherMandatory`. Use a number for a separately
  known amount, including zero for a confirmed absence, `"included"` when
  already accounted for in another known charge, and `null` or omission for
  unknown amounts. The base itself must be numeric for a complete rental
  total. Supply a verified bundled amount as base with the covered charges
  marked included. Put mandatory charges that are outside that total in
  their applicable fields.

### Tool modules

For a source with `kind: "module"`, set its `id`, `file`, and optional
`settings`. A trusted local module exports `createTool(settings)`, returning
async `listBranches(input, signal)` and `quote(input, signal)`, with optional
`close()`. Set `catalogByDate: true` to receive `at` and query each leg's date
separately. Both return the structures above and should honor the abort
signal. `settings` is the JSON object from the chosen source. Use module
configuration for optional credentialed shopping tools and read-only public
pages with a different shape. Keep credentials in the module's environment.
The caller cannot choose module files or URLs. See
[request and response types](../lib/rental/contracts.ts).

Sources for one supplier are tried in order. An unavailable or partial catalog
can be supplemented by the next source. An incomplete or failed pair can be
quoted by the next source using the same branch IDs. An offer ID identifies
the same offering across that supplier's sources. Each displayed offer uses
one source's price breakdown. Keep both offers under distinct IDs when they
represent different rate plans or vehicles.

## Read the result

By default, Guido selects up to six branches per supplier and leg using
travel time, distance and station ID. It represents airport and neighborhood
stations when available. Each ordered pickup × return combination gets its
own request, including same-branch and reverse pairs. With one-way disabled,
only same-branch combinations are eligible. Trip criteria stay constant.

Default limits per supplier and search are six catalog pages per leg,
36 quote requests including fallbacks, three concurrent pair operations,
an eight-second operation timeout, and a 35-second search deadline. Tune
`branchesPerLeg`, `catalogPagesPerLeg`, `quoteRequests`, and `intervalMs`
in the supplier's `limits` object. Travelport starts operations at least
750 ms apart within each supplier search by default. The operator is
responsible for account-wide limits across suppliers, searches, and process
replicas.

The audit includes completed, partial, unavailable and untried results,
catalog continuation limits, and omitted stations. Its attempt count
includes only adapter calls that started. A deadline or cancellation leaves
queued pairs untried. Coverage applies to the selected markets, returned
pages, and request budget.

A recommended offer has a complete mandatory rental price, both branch
access cost estimates, and enough information to meet the selected criteria.
The total is an estimate using those access costs. A provisional offer with
unknown charges or access costs exposes its known subtotal and remains
unranked. Only quote currency matching the request can be ranked. The
result records supplier quote time when provided and Guido's observation time.
Search stops at comparison. The standalone service has only the rental search
API and the two views.

## Verify

```sh
npm test
npm run typecheck
npm --prefix frontend run build
npm run test:browser
```

The browser test uses Playwright Chromium and a local synthetic HTTP source.
It checks the UI and fixture entry point, each ordered pair with constant
criteria, source evidence, blocked responses, and the read-only behavior.
Set `GUIDO_CHROMIUM_EXECUTABLE` if using system Chromium.
