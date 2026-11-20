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
drop-off branches and times, finds the cheapest option that fits, then explains why.

### Demo scenario

Mock scenario, filled with **real data once we have it**.

- Dallas area, near-airport pickup and drop-off (DFW, Love Field, nearby branches).
- 4 travelers, Thanksgiving week 2026. Proposed dates: pickup **Wed Nov 25**,
  return **Sun Nov 29**. *Not confirmed yet, check with Rashmi.*
- 2 authorized drivers, one under 25, so a young renter fee applies.
- Car class must fit 4 people plus luggage (midsize / full-size / SUV).
  *Not decided yet, decide with Rashmi.*
- Prices must be real quotes captured at a known time, with a timestamp. Until real
  data is ready, use clearly labelled **PLACEHOLDER** data, never shown as real.

## 3. Who owns what

| Area | Owner |
|---|---|
| Backend: agent logic, APIs, sponsor integrations, data pulling | Backend teammate |
| Product/UX, the audit-trail page (the only frontend piece), demo, submission writing | Rashmi |

- **Email (via AgentMail) is the first delivery channel.**
- Telegram (via Airbyte) comes **later**, and only if the core works.

## 4. Booking behavior

- The agent must **not** book or pay on its own, and must **never** handle card numbers.
- It prepares the booking and shows a **confirmation summary**: what, where, dates,
  total, cancellation policy, drivers.
- **The human approves.** Then the agent either:
  - hands off to the rental company's own checkout (`rental_company_checkout`), or
  - for the demo, completes a clearly labelled **simulated** booking (`simulated_booking`).
- The audit trail ends with a record that the human approved, and when.

## 5. Design principles

- The audit trail is a **"why this one" moment, not a log.** People rarely read
  audit logs. They check one before paying, when the pick is surprising, when they
  need to defend it to the group, or when they want to change an assumption.
- **Show it in layers:**
  1. **Answer first:** best match, total, savings.
  2. **A short reason:** 2–3 lines in plain words.
  3. **Expandable "How I decided":** a step timeline plus a comparison table, with
     options that don't fit greyed out and the reason shown.
- **Assumptions are visible** (max travel time, driver ages, car class) and may
  become editable later. Simple filters and re-sorts can happen in the frontend
  because the backend sends **all** candidate options, including ones that don't
  fit, each with its reason.
- **Plain, friendly language** for non-technical users. No developer words on screen.

## 6. Architecture rules

- **One config file for display.** The fields the UI shows, their order, and **all**
  user-facing wording live in [`contracts/display_fields.json`](../contracts/display_fields.json).
  Removing a data point or renaming a label means editing that one file.
- **The agent is one function:** trip request in → result + audit trail out, so
  email and Telegram can both call it later.
- **Separate folders** so the frontend and backend work don't clash:
  - `contracts/`: the shared data contract (schema, sample, display config)
  - `frontend/`: the audit-trail page (not built yet)
  - backend: the existing `agent/`, `lib/` and related folders
- **Never commit secrets.** Keys go in `.env` / `.env.local`. The `.gitignore`
  already ignores `.env*` and keeps only `.env.example`.

## 7. Data contract

The full machine-readable version is
[`contracts/trip_result.schema.json`](../contracts/trip_result.schema.json), with a
Dallas example in [`contracts/trip_result.sample.json`](../contracts/trip_result.sample.json).

**Trip request (input):** start area / airport(s), end area, pickup datetime,
return datetime, days, travelers count, drivers (list of `{age}`), car class,
`one_way_ok`, `max_travel_minutes_to_branch`.

**Per option (every candidate, including ones that don't fit):** `option_id`,
brand, pickup and drop-off branch, pickup and drop-off time, base daily rate, days,
base total, airport/concession fee, taxes, other fees, additional driver fee, young
renter fee, one-way fee, mileage policy, travel minutes and cost to the branch, car
class and seats, luggage fit note, total trip cost, `rank` (only for recommended
and alternative options; 1 = best), `status`, optional `tags`, and `reason` (required
for `not_a_fit`).

**Winner summary:** recommended `option_id`, total, savings vs. the obvious option,
one-line explanation.

**Audit trail steps (ordered):** step number, step name, plain-language finding,
timestamp.

**Confirmation and hand-off:** confirmation summary, `human_approved`,
`approved_at`, `handoff_type`.

**Data source:** label, `captured_at`, `is_real_data`.

**Status labels** (stored in the config, not hard-coded):

| Status | On screen |
|---|---|
| `recommended` | Best match |
| `alternative` | Also a good option |
| `not_a_fit` | Doesn't fit your trip |

## 8. Out of scope for now

- No UI yet. We're only setting up context, structure and the data contract.
- No Telegram or other messaging channels.
- No sponsor integrations from this branch.
