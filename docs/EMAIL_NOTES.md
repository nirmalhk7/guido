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
| Option cards | `brand`, `car_class`, `seats`, `pickup_branch`, `dropoff_branch`, `total_trip_cost`, `tags` (max 3 on the top pick, 2 on others), `status`, `rank`, `travel_to_branch.minutes`, `cancellation`; the "why" sentence (`winner_summary.one_line_explanation`, else `reason`) only on the top pick; `source.captured_at` only to flag an "Older price" |
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
npm run preview:email    # renders everything, then opens out/index.html (Mac)
npm run render:email     # just renders: email/out/*.html, *.txt and out/index.html
npm run stress:make      # regenerate stress-test samples (samples/stress/*.json)
```

The render script fails (exit code 1) if any email contains "undefined", "null",
"NaN" or an unfilled `{placeholder}`.

Previews are built from `contracts/trip_result.sample.json` (all PLACEHOLDER /
sample data) via `email/samples/variants.mjs`. Real results never go through that file.

## Live HTML reply (branch `rashmi/html-email`, switch `HTML_EMAIL_ENABLED`, default off)

Guild does the price search, so the backend doesn't rebuild numbers. Instead the
Guild agent fills a short set of named blanks, and the backend drops them into
the designed layout.

- **Guild prompt** ([`guild/email/PROMPT.md`](../guild/email/PROMPT.md)): asks for
  an extra `email` object next to `draft` (headline, trip_recap, options with
  company / branch / tags / total / recommended / why, coverage, data_source),
  only from what the search returned. **Republish this prompt in Guild.**
- **`lib/html-email.ts`**: checks the blanks (required fields, length limits,
  exactly one recommended, no `{{…}}` / `undefined` / `null`) and renders them
  with `email/lib/html.mjs`, which escapes all text. Returns `null` on any problem.
- **`lib/gmail.ts`**: when the switch is on and the HTML builds, sends HTML + the
  agent's plain-text `draft` via `sendAgentMailHtml`. If the switch is off, the
  HTML can't be built, or that send fails, it sends the **existing plain-text
  reply unchanged**.
- **Where it appears:** only the Gmail-scanner path sends email today. Incoming
  AgentMail messages (`api/agentmail.ts`) still only create a Guild draft, so no
  HTML there.
- No "Review and book" button or "See all options" link yet: there's no hosted
  web page URL. Optional `EMAIL_LOGO_URL` adds the logo image.

**To test:** republish the prompt, set `HTML_EMAIL_ENABLED=true` on the
deployment, send a trip email to the watched Gmail address, wait for the scan
(5 min), and check the reply. Turn the switch off to go back instantly.
