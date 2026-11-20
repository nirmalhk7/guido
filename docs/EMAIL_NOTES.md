# Results email: notes for the backend

Guido's first delivery channel is email. This folder makes the email; **sending
it is the backend's job (AgentMail).** Nothing here sends anything.

- Code: [`email/`](../email/). No dependencies, plain Node (22+).
- Data in: a trip result matching [`contracts/trip_result.schema.json`](../contracts/trip_result.schema.json).
- Wording: [`contracts/display_fields.json`](../contracts/display_fields.json), mostly the `email` section.
  Reused keys include `status_labels`, `tag_labels`, `coverage`, `empty_states`,
  `empty_state_details`, `cancellation_labels`, `trip_summary`, `ranking_priorities`, `source_labels`.
- Settings: [`email/config.json`](../email/config.json) (logo URL, limits, stale threshold).

## Render it

```js
import { renderEmail } from "./email/template.mjs";

const { subject, preheader, html, text, kind } = renderEmail(tripResult, {
  sentAt: Date.now(), // optional; used to say how old prices are
  // logoUrl: "https://…/guido_icon_128.png", // optional; overrides config.logo_url
});
```

- `kind` is `results`, `nothing_fits`, `no_cars` or `unreachable`.
- `html` and `text` say the same things in the same order. **Send both** (multipart).

## Fill the placeholders, then send

The output contains three placeholders. Replace them before sending:

| Placeholder | Where it appears | Should be |
|---|---|---|
| `{{confirm_url}}` | "Review and book" button under the Recommended card | The **confirmation page** for this trip. Not a purchase: the person reviews, approves, then finishes on the rental company's checkout. |
| `{{audit_url}}` | "See all options" link and "See the full details" (empty states) | The audit-trail web page for this trip |
| `{{reply_to_address}}` | "You can also write to …" | The AgentMail inbox address that receives replies |

```js
const fillLinks = (s) =>
  s.replaceAll("{{confirm_url}}", confirmUrl)
   .replaceAll("{{audit_url}}", auditUrl)
   .replaceAll("{{reply_to_address}}", inboxAddress);
```

**AgentMail:** today `lib/agentmail.ts` only sends `text` on replies. To send
this email, also pass the `html` body (and a `subject` for a new message), using
whatever field AgentMail's API expects for HTML. Replies from the person ("new
dates please") should start a new search; the email tells them they can do that.

## Which fields the template reads

| Part of the email | Fields |
|---|---|
| Subject, headline | `trip_request.start_area` (text before the comma), `pickup_datetime`, `return_datetime`, count of options that fit, recommended `brand` and `total_trip_cost` |
| Trip recap | `trip_request.pickup_datetime`, `return_datetime`, `travelers`, `drivers[].age`, `car_class`, `max_travel_minutes_to_branch`, `one_way_ok`; "Ranked by" from `winner_summary.ranking_priority_used`, else `trip_request.ranking_priority` |
| Option cards | `brand`, `car_class`, `seats`, `pickup_branch`, `dropoff_branch`, `total_trip_cost`, `tags`, `reason` (`winner_summary.one_line_explanation` for the top pick), `travel_to_branch.minutes` / `.note`, `cancellation`, `source.name`, `source.captured_at`, `status`, `rank` |
| Coverage line | `coverage.providers[].provider`, `.result`, `.reason` |
| Where prices came from | `data_source.environment`, each option's `source.name` and `source.captured_at` |
| Empty states | the trip fields above, plus not-a-fit options' `brand` and `reason` |
| Money | integer **cents** (`money_unit: "cents"`), shown as dollars; `currency` (default USD) |

## Rules the template enforces

- **Shows at most 1 Recommended + 3 alternatives**, then "See all N options".
- **Trims long text** with an ellipsis: reason 120 characters, company 32, branch 44.
- **Never shows empty gaps, "null", "undefined" or "NaN".** Missing values get a
  friendly fallback ("Cancellation terms not provided", "Price not available"…)
  or the row is left out.
- **A car without a price is never the top pick**, and gets no "Review and book" button.
- **Honest about data:** sample/test prices get a notice at the top; prices older
  than 60 minutes (at send time) are flagged; "couldn't reach" is never "no cars".
- **Never says Guido books or pays.** The footer says the person confirms on the
  rental company's own checkout.

## Logo

Set `logo_url` in `email/config.json` to a **public** URL of the icon PNG
(e.g. `guido_icon_128.png` from `frontend/public/brand/`, hosted anywhere public).
Empty means the email shows only the blue "Guido" wordmark, which still looks right.
If an email app blocks images, it shows the alt text "Guido" next to the wordmark.

## Preview and test

```sh
cd email
npm run render:email     # writes email/out/*.html, *.txt and out/index.html
open out/index.html      # every email at desktop and phone width
npm run stress:make      # regenerate stress-test samples (samples/stress/*.json)
```

The render script fails (exit code 1) if any email contains "undefined", "null",
"NaN" or an unfilled `{placeholder}`.

Previews are built from `contracts/trip_result.sample.json` (all PLACEHOLDER /
sample data) via `email/samples/variants.mjs`. Real results never go through that file.
