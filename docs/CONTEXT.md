# Project context

Read this first. It captures the goals, roles, rules and data contract for this
hackathon project so any teammate (or AI assistant) can pick up the work.

> The repo started from **Guido**, an example AgentMail inbox agent (`agent/`,
> `lib/`, `firedrill/`, `test/`). That code is the backend starting point and is
> owned by the backend teammate. Don't change it from the frontend/UX side.

## 1. The hackathon

- **Event:** Personal Agents Hackathon (Tokens&), San Francisco, **Nov 20, 2026**.
- **Deadline:** 4:30 PM PT.
- **Challenge:** build a shopping agent **with an audit trail**. The agent helps
  someone make a purchase, uses reliable context to decide, takes a meaningful
  action, and shows the information and steps behind what it did.
- **Rule:** use at least **3 sponsor tools**.
- **Tools so far** (not final; integration is owned by the backend teammate):
  - Guild.ai: deploying the agent
  - SingleStore: database
  - Airbyte: Gmail / Telegram integration
  - AgentMail: sending/receiving email (not a sponsor)
- **Submission needs:** an accessible GitHub repo, a short demo video, a
  description of what we built and the tools used, and teammates' names and emails.

## 2. The product

A **rental-car shopping agent**. It tries many combinations of nearby pickup and
drop-off branches and times, ranks the options that fit by what the user cares
about most, recommends the top one, and explains why.

### Any trip, real data

- The scenario is **not fixed**. The contract and the UI must work for **any trip**,
  with real data. Nothing may be hard-coded to Dallas.
- **Demo default:** Dallas area, Thanksgiving week, 4 travelers, 2 drivers (one
  under 25, so a young renter fee applies), pickup and return near the airports
  (DFW, Love Field).
- Prices must carry where they came from, when they were captured, and an
  **environment label** (see section 7). Made-up data is always `fixture` and
  marked **PLACEHOLDER**, never shown as real.

## 3. Who owns what

| Area | Owner |
|---|---|
| Backend: agent logic, APIs, sponsor integrations, data sources, data pulling | Backend teammate |
| Product/UX, the audit-trail page (the only frontend piece), demo, submission writing | Rashmi |

- **The data points in `contracts/trip_result.schema.json` are the source of truth.**
  Rashmi defined them and the backend teammate has them. Don't create a competing
  set. Any change, including one the teammate asks for, is made there, in one place.
- **Email (via AgentMail) is the first delivery channel.**
- Telegram (via Airbyte) comes **later**, and only if the core works.

## 4. Booking behavior

- The agent must **not** book or pay on its own, and must **never** handle card numbers.
- It prepares the booking and shows a **confirmation summary**: what, where, dates,
  total, cancellation policy, drivers.
- **The human approves.** Then the agent either:
  - hands off to the rental company's own checkout (`rental_company_checkout`,
    optionally with a `handoff_url`), or
  - for the demo, completes a clearly labelled **simulated** booking (`simulated_booking`).
- The audit trail ends with a record of the approval and/or the hand-off, and when.

## 5. Ranking and the "Recommended" label

- The user picks a **`ranking_priority`**:
  - `lowest_total_cost` (default)
  - `closest_pickup`
  - `most_flexible_cancellation`
- Every option has a status:
  - `recommended`: the **#1 eligible option under the current priority**. It
    **moves** when the user changes the priority.
  - `alternative`: every other eligible option. Each one carries short **strength
    tags**, such as "Closest pickup" or "Free cancellation".
  - `not_a_fit`: doesn't meet the trip's needs, whatever the priority. Always
    has a plain-words reason, and is shown in its own group, "Doesn't fit your trip".
- **The page can re-rank on its own.** Every option carries what ranking needs:
  total cost, travel time and cost to the branch, and cancellation terms. The
  ranking rules, including tie-breakers, are written in the schema under
  `$defs/ranking_priority`.
- **The audit trail states the priority used**, e.g. *"Recommended because it
  has the lowest total cost, your current priority."* When the user changes the
  priority on the page, the page swaps in the matching sentence from
  `display_fields.json`.

## 6. Data sources (swappable)

Details: [`contracts/data_source_interface.md`](../contracts/data_source_interface.md)
and [`contracts/data_sources.json`](../contracts/data_sources.json).

- Every source returns **the same format** (`source_output`), so sources can be
  swapped or added without touching the agent or the page.
- **Fallback chain, in order:** `octotrip_mcp` → `browser_agent` → `scraping_tool`
  → `cached_snapshot` → `placeholder_sample`. `manual_file` is an optional extra.
- **OctoTrip** (`https://mcp.octotrip.app/rental-cars/mcp`, reportedly no
  login/key) is preferred but **not confirmed to work yet**. No real source code
  has been written for any source.
- Each option records its **source name, captured_at, and environment**.
- Each fallback adds a plain-words audit step, e.g. *"OctoTrip didn't return
  fees, so I used prices saved at 1:15 PM."*
- One option always comes from one source; prices are never stitched together.
- **To add a source:** make it return `source_output` and add one entry to
  `data_sources.json`, plus a friendly name in `display_fields.json`.

## 7. Real data is messy

- **Environment labels:** `live` | `sandbox` | `fixture` | `unavailable`.
  - A timeout, error, or missing access is **`unavailable`, never "no cars"**.
  - The banner shows the **least real** environment across options, and prices
    are dated by the **oldest** capture time, so we never overstate.
- **Partial results are normal.** `coverage` records each source tried and each
  rental company: `complete`, `partial`, `no_cars`, or `unavailable`, with a
  reason. The page shows coverage honestly, e.g. "5 of 6 rental companies answered".
- Results can be empty. Then `winner_summary` and `confirmation` are `null`, and
  the page shows one of three messages from the config: nothing fits, no cars
  found, or couldn't reach anyone. How to tell them apart:
  - eligible options exist → show the recommendation
  - options exist but none fit → "nothing fits"
  - no options, and at least one company answered `no_cars` → "no cars found"
  - no options, and nobody answered → "couldn't reach anyone"

## 8. Design principles

- The audit trail is a **"why this one" moment, not a log.** People rarely read
  audit logs. They check one before paying, when the pick is surprising, when they
  need to defend it to the group, or when they want to change an assumption.
- **Show it in layers:**
  1. **Answer first:** the recommended car, total, savings, and what it was picked for.
  2. **A short reason:** 2–3 lines in plain words.
  3. **Expandable "How I decided":** a step timeline plus a comparison table, with
     options that fit in one group and "Doesn't fit your trip" in a greyed-out
     group with reasons.
- **Assumptions are visible**, including what matters most, and may become
  editable later. Re-sorting and re-ranking can happen in the page because the
  backend sends **all** options, including ones that don't fit.
- **Be honest about coverage** and where prices came from.
- **Plain, friendly language** for non-technical users. No developer words on screen.

## 9. Architecture rules

- **One config file for all wording and display.** The fields the UI shows, their
  order, and **all** user-facing wording live in
  [`contracts/display_fields.json`](../contracts/display_fields.json): status labels,
  priority names, tag names, environment and coverage wording, empty states, and
  buttons. Removing a data point or renaming a label means editing that one file.
- **Data sends keys, the config holds words.** Statuses, priorities, tags,
  environments, and coverage reasons are keys in the data. Only free-text
  explanations (reasons, findings, notes) come from the agent.
- **The agent is one function:** trip request in → trip result (with audit trail)
  out, so email and Telegram can both call it later.
- **Separate folders** so frontend and backend work don't clash:
  - `contracts/`: the shared contract (schema, sample, display config, data sources)
  - `frontend/`: the audit-trail page (not built yet)
  - backend: the existing `agent/`, `lib/` and related folders
- **Never commit secrets.** Keys go in `.env` / `.env.local`. The `.gitignore`
  already ignores `.env*` and keeps only `.env.example`.

## 10. Data contract

The full machine-readable version is
[`contracts/trip_result.schema.json`](../contracts/trip_result.schema.json) (v0.2.0),
with an example in [`contracts/trip_result.sample.json`](../contracts/trip_result.sample.json).

**All money is integer cents** (`money_unit: "cents"`): $413.20 → `41320`.

**Trip request (input):** start area, airports, end area, pickup datetime, return
datetime, days, travelers count, drivers (list of `{age}`), car class,
`one_way_ok`, `max_travel_minutes_to_branch`, `ranking_priority`.

**Per option (every candidate, including ones that don't fit):** `option_id`,
brand, pickup and drop-off branch, pickup and drop-off time, base daily rate, days,
base total, airport/concession fee, taxes, other fees, additional driver fee, young
renter fee, one-way fee, mileage policy, travel minutes and cost to the branch, car
class and seats, luggage fit note, total trip cost, **cancellation** (type, free
until, fee, summary), **source** (name, captured_at, environment), `rank` (eligible
options only; 1 = best under the current priority), `status`, `tags` (keys), and
`reason` (required for `not_a_fit`).

**Winner summary** (or `null`): recommended `option_id`, `ranking_priority_used`,
total, savings vs. the obvious option (and optionally which option that is),
one-line explanation.

**Coverage:** `source_attempts` (each source tried: used / partial / unavailable /
skipped, with a reason) and `providers` (each rental company: complete / partial
/ no_cars / unavailable, with a reason).

**Audit trail steps (ordered):** step number, step name, plain-language finding,
timestamp, optional `step_type` (request, search, coverage, source_fallback,
pricing, filter, ranking, confirmation, approval, handoff).

**Confirmation and hand-off** (or `null`): confirmation summary,
`human_approved`, `approved_at`, `handoff_type`, optional `handoff_url`.

**Data source summary:** main source, oldest `captured_at`, least-real `environment`.

**Labels on screen** (stored in the config, not hard-coded):

| Key | On screen |
|---|---|
| `recommended` | Recommended |
| `alternative` | Also a good option |
| `not_a_fit` | Doesn't fit your trip |
| `lowest_total_cost` | Lowest total cost |
| `closest_pickup` | Closest pickup |
| `most_flexible_cancellation` | Most flexible cancellation |

## 11. Out of scope for now

- No UI yet. We're only setting up context, structure and the data contract.
- No Telegram or other messaging channels.
- No real data-source code or sponsor integrations from this branch.
