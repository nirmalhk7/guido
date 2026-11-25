# Standalone rental comparison

Guido compares pickup and return branches without an email account, LLM, or
vendor credentials. The browser app, HTTP API, and CLI share the same search.

## Run it

Use Node.js 24 or later. Dependency installation requires network access. Sample
searches run offline after installation.

```sh
npm ci
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
docker run --rm guido-rental node bin/rental-search.ts --fixture examples/rental-trip.json
```

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
the branch to the destination. With a precise endpoint, Guido uses your
branch estimates and reports any missing cost or time as unknown. When both
coordinates are available it also calculates straight-line distance.

Preferences include `priority` (`total_cost`, `pickup_access`, or
`return_access`), `oneWay` (defaults to true), `pickupKind` and `returnKind`
(`airport` or `non_airport`), `driverAge`, `drivers`, `carClass`,
`minSeats`, `currency`, `maxPickupMinutes`, `maxReturnMinutes`, and
`maxTotalCents`. Charge and cost fields hold integer hundredths of the
requested currency. The browser form exposes common preferences and uses USD.
The API and CLI also accept individual branch and access overrides.

## Configure quote sources

Playwright is the built-in live adapter. Install Chromium with
`npx playwright install --with-deps chromium`, or use an installed Chromium
by setting `GUIDO_CHROMIUM_EXECUTABLE`. Select the providers and tools by
setting `GUIDO_RENTAL_CONFIG=/path/to/providers.json` or passing the CLI
`--config` option.

```json
[
  {
    "id": "rental-company",
    "name": "Rental Company",
    "sources": [
      {
        "id": "public-quote-feed",
        "kind": "playwright",
        "catalogUrl": "https://supplier.example/catalog",
        "quoteUrl": "https://supplier.example/quotes"
      },
      {
        "id": "partner-shopping-api",
        "kind": "module",
        "file": "./partner-shopping.mjs",
        "settings": { "region": "US" }
      }
    ]
  }
]
```

The domains and module above are examples. Supply authorized shopping
endpoints or a tool module for the supplier you want. With no provider
configuration, a live search reports Playwright as unavailable. Only an
explicit sample request uses the offline fixture.

### Playwright source

The adapter opens an operator-configured public HTTPS endpoint for each
catalog or quote request. Loopback HTTP is supported for local tests. Each
response is an `application/json` document or HTML containing the JSON
in `<script id="guido-data" type="application/json">`. Playwright uses a
fresh browser context, disables page scripts and subresources, and makes
only GET requests to the configured read-only URLs. Redirects, sign-in
walls, and access challenges yield unavailable results. Browser integrations
must have permission for automated reading of the configured URLs.

- The catalog gets `area` and `currency`. It returns `{ branches }` and may
  include `partialReason`. A branch has `id`, `name`, and `kind`, with
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

A trusted local module exports `createTool(settings)`, returning async
`listBranches(input, signal)` and `quote(input, signal)`, with optional
`close()`. Both return the structures above and should honor the abort
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

Guido orders up to six candidate branches per supplier and leg by travel
minutes, straight-line distance, then branch ID, preserving both branch
types when available. Each ordered pickup × return combination gets its
own quote, including same-branch and reverse pairs. With one-way disabled,
only same-branch combinations are eligible for search. The quote criteria
stay constant across pairs. The audit shows planned pairs, outcomes,
combinations untried because of the search deadline, and branches omitted
at the limit. Catalog and quote attempts have separate timestamps.

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
