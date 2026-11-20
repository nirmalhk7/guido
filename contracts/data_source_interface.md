# Data source interface

How rental-car prices get into the agent, and how to add or swap a source.
The list of sources lives in [`data_sources.json`](data_sources.json).

## The one rule

**Every source returns the same format**, `source_output`, defined in
[`trip_result.schema.json`](trip_result.schema.json) under `$defs/source_output`.
Whatever happens inside a source (calling an MCP server, driving a browser,
reading a saved file) is hidden. The agent only ever sees `source_output`.

```
trip request ──► source ──► source_output ──► agent (judges + ranks) ──► trip result
```

## What a source receives

The `trip_request` part of the contract: areas, airports, dates, travelers,
drivers, car class, one-way OK, and max travel minutes. Sources don't need
`ranking_priority`; ranking is the agent's job.

## What a source returns (`source_output`)

| Field | Meaning |
|---|---|
| `source` | This source's id from `data_sources.json`, e.g. `octotrip_mcp` |
| `environment` | `live`, `sandbox`, `fixture`, or `unavailable` |
| `captured_at` | When the prices were captured (`null` if unavailable) |
| `reason` | If unavailable, why: `timed_out`, `no_access`, `error`, `not_set_up`… |
| `providers` | One row per rental company: `complete`, `partial`, `no_cars`, or `unavailable` |
| `options` | Rental options with their **facts** only (`$defs/option_facts`) |

Rules for sources:

- **Money is integer cents.** $413.20 → `41320`.
- **Every option records its `source`**: `name`, `captured_at`, `environment`.
- **Only complete options.** If an option is missing a required fact (for
  example fees), leave it out and mark that rental company `partial` with
  reason `missing_fees`. The agent then tries the next source for it.
- **Unavailable is not "no cars".** A timeout, error, or missing access is
  `unavailable`. Only use `no_cars` when the company actually answered with nothing.
- **Sources don't judge.** No `status`, `rank`, `tags`, or fit `reason`. The
  agent adds those.

## Environment labels

| Label | Meaning | Shown to users as |
|---|---|---|
| `live` | Real prices from a real provider | Live prices |
| `sandbox` | A provider's test system, not bookable | Test prices (not bookable) |
| `fixture` | Made-up or sample data | Sample prices, not real quotes |
| `unavailable` | Couldn't get data | Couldn't get prices |

The wording users see lives in `display_fields.json` (`environment_labels`).

## Fallback chain

The agent tries sources in `fallback_order`:

1. **`octotrip_mcp`**: preferred. Endpoint `https://mcp.octotrip.app/rental-cars/mcp`,
   reportedly no login or key. **Not confirmed to work yet.**
2. **`browser_agent`**: reads quotes from rental websites. Not built.
3. **`scraping_tool`**: scrapes rental pages. Not chosen or built.
4. **`cached_snapshot`**: prices saved earlier, with their original time and environment.
5. **`placeholder_sample`**: made-up sample data, always `fixture`.

Optional, outside the chain: **`manual_file`**, prices typed into a file by a
person. The file declares its own environment.

How fallback works:

- The agent moves to the next source when a source is `unavailable`, or when it
  leaves some rental companies `partial` (for example, missing fees). It only
  asks the next source to fill the gaps.
- **One option comes from one source.** The agent never stitches one source's
  base price to another source's fees.
- **Every fallback adds an audit step in plain words**, with
  `step_type: "source_fallback"`. For example: *"OctoTrip didn't return fees,
  so I used prices saved at 1:15 PM."*
- **Every source tried is recorded** in `coverage.source_attempts` as `used`,
  `partial`, `unavailable`, or `skipped`.
- If all sources fail, the result has no options, `winner_summary` and
  `confirmation` are `null`, and `data_source.environment` is `unavailable`. The
  page says it couldn't reach anyone, not that there are no cars.

## Adding a new source

1. Make it accept a `trip_request` and return `source_output`.
2. Add one entry to `sources` in `data_sources.json`.
3. Put its id in `fallback_order` where it belongs.
4. Add a friendly name in `display_fields.json` → `source_labels`.

Nothing else changes: the agent, the contract, and the page all stay the same.
