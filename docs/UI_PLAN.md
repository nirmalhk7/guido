# Audit-trail page: UI plan

Status: **Phase 1, plan only.** Nothing is built yet. Building starts after Rashmi says "go".

The page shows one trip result (see `contracts/`): answer first, then a short
reason, then an expandable "How I decided". People open it from an email link,
so it's designed **phone-first**. All wording comes from
`contracts/display_fields.json`; all data comes from the contract (the sample
JSON for now).

---

## 1. Figma references (page "Audt trail UI")

The page has one section, "Audit trail UI inspiration", with three labeled
groups. **The images have no "what to take" notes, and the file has no comments.**
The takeaways below are my reading of each group's caption. ⚠️ Please confirm or correct them.

| Figma group | Reference images | Caption | What I propose to take (the idea, not the look) | Goes into |
|---|---|---|---|---|
| **Price breakdown** | Airbnb host view: "Guest paid" / "Host payout" itemized lists. Airbnb booking card: total on top, line items, Book button | "Price breakdown" | **Total first, big**, with a "total" qualifier. Then **plain line items** with amounts right-aligned and the **total row in bold**. A reassurance line under the action ("You won't be charged yet"). A note that the **price includes all fees and taxes**. Small "?" hints for confusing fees. | Recommended card, price breakdown, confirmation |
| **Decision trail** | Amazon order tracking: vertical checklist with "See all updates". Amazon detail: timestamped event list. RV booking stepper: done / current / upcoming steps, with a collapsed mini-stepper | "Seeing decision trail: what did an agent do to get here" | A **vertical step timeline** with check marks for done steps. A **short summary first**, with a "See all steps" link that expands to **timestamped detail**. Clear **done / in progress / not yet** states, which also drive the loading state. A **compact collapsed version** of the steps. | "How I decided", loading state, confirmation progress |
| **Ranking** | Credit Karma: two big scores, source name, "Updated on Dec 3", plain label badge ("Good" / "Excellent"), color scale with markers | "Clean ranking: why pick this option" | **One big number** (the total) as the hero. **Source and "updated" time right under it**. A **plain-word label** ("Recommended") instead of numbers. A **simple scale or bar showing where each option sits** (e.g. price range from cheapest to priciest), with labels so color isn't the only cue. | Recommended card, source badge, options list |

Not used: the "Guido logo" page (you said to use only the audit-trail page).

---

## 2. Screen and component map

One page, top to bottom on a phone. Wider screens get a centered column (max
~640px), not a different layout.

| # | Part | What it shows | Figma ref | Contract data | Config wording |
|---|---|---|---|---|---|
| 1 | **Status banners** | Sample/test-price banner. Outdated-results banner. Still-searching banner. | — | `data_source.environment` | `environment_banners` (+ new keys, see §5) |
| 2 | **Trip summary + assumptions** | Dates, travelers, drivers' ages, car size, max travel time, one-way OK, as compact chips with "What I assumed" expandable | Price breakdown (dates/guests block) | `trip_request` | `assumptions` |
| 3 | **Priority selector** | Segmented control: Lowest total cost / Closest pickup / Most flexible cancellation. Re-ranks in the browser and moves "Recommended". | Ranking | `trip_request.ranking_priority` | `ranking_priorities` |
| 4 | **Recommended card** | Big total, "Recommended" label, company and car, one-line reason, savings, **source badge** (where from, checked when, live/sandbox/sample), tags. Expandable **price breakdown**. | Ranking + Price breakdown | recommended option, `winner_summary` | `layer_1_answer`, `layer_2_reason`, `tag_labels`, `source_labels`, `environment_labels` |
| 5 | **"Also a good option" list** | Compact cards: total, difference vs. recommended, strength tags, expand for breakdown | Ranking | `status: alternative` | `status_labels`, `tag_labels` |
| 6 | **"Doesn't fit your trip" group** | Collapsed by default. Each option greyed, with its plain-words reason | — | `status: not_a_fit` | `status_labels`, `comparison_table.groups` |
| 7 | **"Couldn't fully check" group** | Rental companies that were partial or unavailable, with the reason ("didn't respond in time") | — | `coverage.providers` | `coverage` |
| 8 | **Coverage line** | "5 of 6 rental companies answered", expandable to per-company and per-source detail | Decision trail (summary → detail) | `coverage` | `coverage`, `source_labels` |
| 9 | **"How I decided"** | Collapsed mini-timeline, expanding to the full step timeline with times. The ranking step's sentence swaps with the priority. Optional full comparison table. | Decision trail | `audit_trail` (`step_type`) | `layer_3_how_i_decided`, `ranking_priorities.*.recommended_because` |
| 10 | **Confirmation + hand-off** | Review summary (what, where, when, total, cancellation, drivers) → "Looks good, book it" → hand-off to checkout link **or** "Demo booking (simulated)" → approved record with time. "I never see or store your card details." | Price breakdown (total + action + reassurance) | `confirmation` | `confirmation`, `handoff_labels` |
| 11 | **Empty states + retry** | Nothing fits / no cars found / couldn't reach anyone. Each says what was searched, why, and what could change, with a "Try different details" form and a "Reply to the email" instruction. | — | derived (see CONTEXT §7) | `empty_states` (+ new keys) |

---

## 3. In-between states

All states are driven by data, so they work with real results later. For the
demo, I'll add a small **"Preview state" switcher**, only shown with `?demo=1`
in the address, that loads variations of the sample so each state can be shown.

| State | What the user sees | How it's detected |
|---|---|---|
| **Loading** | Audit steps appear one by one with a gentle fade (done ✓ / working… / not yet), not a spinner. Results fill in when ready. | Fewer steps than final, or no result yet. In the demo, steps are revealed on a timer. |
| **Partial results** | Normal results, plus a coverage line like "5 of 6 rental companies answered" and the "Couldn't fully check" group | `coverage.providers` has partial/unavailable |
| **Slow / timed out** | "Still checking Rental Co F…" with the results so far shown underneath. Later: "Rental Co F didn't respond in time." | A provider still pending (demo), or `timed_out` |
| **Stale prices** | "Checked 2 hours ago", and an "Older price" label on options past a threshold | `source.captured_at` older than a set number of minutes |
| **Unavailable** | "I couldn't reach any rental companies just now. That doesn't mean there are no cars." Shows the why, then retry options. **Never "no cars".** | no options + nobody answered |
| **Changed trip while searching** | Banner: "You changed your trip. These results are for your old details." Old results are dimmed. | The trip in the form differs from `trip_request` |
| **Nothing fits** | What I searched, why each was set aside (short), what could change (wider distance, allow one-way, different car size, new dates), retry | options exist, none eligible |
| **No cars found** | What I searched, "the companies I checked have no cars for these dates", suggestions, retry | no options, ≥1 `no_cars` |

**Retry, two ways, on every empty state:**
1. **"Try different details"**: an inline form (dates, max travel time, one-way OK,
   car size), prefilled from `trip_request`. For now, submitting just shows "Searching
   again…" (placeholder, no backend call).
2. **"Reply to the email with new dates and we'll search again"**: instruction text
   with a placeholder address. The email handling is the backend teammate's.

---

## 4. Proposed stack

**What the teammate's repo has:** no web UI at all. `main` (latest: "run Guido on
Guild") is a Node/TypeScript agent with no React, no HTML pages and no CSS framework.
Per your default, since nothing exists:

- **React + Vite + TypeScript + Tailwind CSS + shadcn/ui**, in its own `frontend/` folder
  with its own `package.json`, so it never touches the backend's dependencies.
- shadcn parts to use: Toggle Group (the segmented control), Card, Badge,
  Collapsible/Accordion, Button, Input, Label, Separator.
- **Look:** system font stack (`-apple-system, system-ui, …`), 8px spacing grid,
  large readable type (17px body), neutral greys with **one accent color**, soft
  shadows, 12–16px rounded corners, **44px minimum tap targets**, subtle fade/slide
  motion that respects "reduce motion". Light mode first; dark mode only if it's
  nearly free with shadcn's color tokens.
- **Accessibility:** contrast AA or better, full keyboard use, visible focus rings,
  real buttons and headings, screen-reader labels. Statuses always carry **text and
  icon**, never color alone.
- **Data:** the page imports `contracts/trip_result.sample.json` and
  `contracts/display_fields.json` directly (read-only). Ranking, formatting (cents → $),
  and empty-state detection live in small plain functions, separate from the visuals,
  so they're easy to test and reuse.

---

## 5. Gaps and questions to settle before building

1. **New wording vs. "only add files in frontend/ and docs/".** These states need
   new on-screen text (loading, "still checking", stale, outdated, empty-state
   suggestions, the retry form, the email instruction). The rule is that **all**
   wording lives in `contracts/display_fields.json`. ⚠️ May I **add wording-only
   keys** to that file? (Nothing removed or renamed.) The alternative is a second
   wording file in `frontend/`, which breaks the one-place rule.
2. **"Couldn't fully check" group.** The contract leaves out options with missing
   data and marks their company `partial` / `unavailable` instead. So this group
   lists **companies with a reason**, not individual cars. OK?
3. **Loading with real data.** The contract describes a finished result. To show
   steps appearing live, the backend would need to send partial results as it goes
   (or the page polls). For now I'll **simulate it in the demo**. This is a
   question for your teammate later, and needs no contract change today.
4. **Stale threshold.** When is a price "old"? I propose **60 minutes**, stored in
   the config file (with question 1).
5. **Figma takeaways.** Confirm the table in §1, since there were no notes on the images.
6. **Hosting.** People open it from an email link, so it must eventually be online
   (Vercel, Guild, etc.). Out of scope now; it runs on your computer for building.
7. **Branch is behind `main`.** Your teammate added commits to `main`. The
   `frontend/` folder won't conflict with them, so no action is needed now.

---

## 6. Build order (Phase 2, after "go")

Each step ends with: how to view it, commit to `rashmi/audit-ui`, push. Never merge.

| Step | What | Done when |
|---|---|---|
| **1** | Set up `frontend/` + **results screen**: banners, trip summary, priority selector, Recommended card with source badge and price breakdown, "Also a good option", "Doesn't fit your trip", coverage line | Switching priority moves "Recommended" (Co A → Co B) with the sample data |
| **2** | **"How I decided"**: collapsed mini-timeline → full timeline, ranking sentence follows the priority, optional comparison table | Steps expand; the ranking step text changes with the priority |
| **3** | **States + empty states**: loading reveal, partial, slow, stale, unavailable, outdated, nothing fits, no cars, retry form, email instruction, `?demo=1` switcher | Each state can be shown from the switcher |
| **4** | **Confirmation + hand-off**: review summary → approve → checkout link or simulated booking → approved record in the timeline | Approving adds the "You approved" step; no card fields anywhere |

**If time runs short** (deadline 4:30 PM), the smaller version is: steps 1, 2 and
4 fully done, and step 3 limited to **unavailable, nothing fits, partial and
loading**, skipping stale, outdated and slow.
