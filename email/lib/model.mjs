// Turns a trip result (contracts/trip_result.schema.json) into a tidy "view
// model" for the email: every limit and every fallback is applied here, so the
// HTML and plain-text versions show exactly the same, always-complete content.
import { readFileSync } from "node:fs";
import { dateRange, dateTime, dayDate, fill, minutesBetween, money, num, str, trim, validIso } from "./format.mjs";

const copy = JSON.parse(readFileSync(new URL("../../contracts/display_fields.json", import.meta.url), "utf8"));
export { copy };

const E = copy.email;
const label = (map, key, fallback) => (key && typeof map?.[key] === "string" ? map[key] : fallback);
const ANSWERED = new Set(["complete", "partial", "no_cars"]);

/** Which headline state applies (same rules as docs/CONTEXT.md §7). */
export function emailKind(result) {
  const options = Array.isArray(result?.options) ? result.options : [];
  if (options.some((o) => o && o.status !== "not_a_fit")) return "results";
  if (options.length > 0) return "nothing_fits";
  const providers = result?.coverage?.providers ?? [];
  if (providers.some((p) => p?.result === "no_cars")) return "no_cars";
  return "unreachable";
}

function agoText(minutes) {
  if (minutes < 60) return fill(E.ago_minutes, { count: minutes });
  const h = Math.round(minutes / 60);
  if (h < 48) return h === 1 ? E.ago_hours_one : fill(E.ago_hours, { count: h });
  return fill(E.ago_days, { count: Math.round(h / 24) });
}

function cancellationText(c) {
  const l = copy.cancellation_labels;
  if (!c || typeof c !== "object") return E.fallback_cancellation;
  // Day only (no clock time) to keep cards short; the full terms are on the web page.
  if (c.type === "free") return validIso(c.free_until) ? fill(l.free_until, { free_until: dayDate(c.free_until) }) : l.free_until_pickup;
  if (c.type === "partial") return money(c.fee) ? fill(l.partial, { fee: money(c.fee) }) : str(c.summary) ?? E.fallback_cancellation;
  if (c.type === "non_refundable") return l.non_refundable;
  return str(c.summary) ?? E.fallback_cancellation;
}

function sourceLabel(name) {
  return label(copy.source_labels, name, undefined);
}

function card(o, { isRecommended, why, currency, sentAt, cfg }) {
  const pickup = trim(o.pickup_branch, cfg.max_branch_chars);
  const dropoff = trim(o.dropoff_branch, cfg.max_branch_chars);
  let branchLine;
  if (pickup && (!dropoff || pickup === dropoff)) branchLine = fill(E.pickup_return_same, { branch: pickup });
  else if (pickup && dropoff) branchLine = fill(E.pickup_return_different, { pickup, dropoff });
  else branchLine = E.fallback_branch;

  const seats = num(o.seats);
  const carClass = str(o.car_class);
  const car = carClass ? (seats ? fill(copy.option_card.car_line, { car_class: carClass, seats }) : carClass) : E.fallback_car;

  // One short line: getting there · cancellation. Where prices came from lives once, at the bottom.
  const minutes = num(o.travel_to_branch?.minutes);
  const facts = [
    ...(minutes !== undefined ? [fill(copy.option_card.travel_line, { minutes })] : []),
    cancellationText(o.cancellation),
  ].join(" · ");

  // Only flag the card's price source when it's out of date.
  const age = minutesBetween(o.source?.captured_at, sentAt);
  const stale = age !== undefined && age > cfg.stale_after_minutes;
  const checked = stale ? fill(E.stale_card_note, { ago: agoText(age) }) : undefined;

  return {
    id: str(o.option_id) ?? "",
    pill: isRecommended ? copy.status_labels.recommended : copy.status_labels.alternative,
    recommended: isRecommended,
    company: trim(o.brand, cfg.max_company_chars) ?? E.fallback_company,
    car,
    branchLine,
    // The "why" sentence only on the top pick; alternatives show strengths as tags.
    why: isRecommended ? trim(why, cfg.max_reason_chars) : undefined,
    tags: (Array.isArray(o.tags) ? o.tags : [])
      .map((t) => label(copy.tag_labels, t, undefined))
      .filter(Boolean)
      .slice(0, isRecommended ? cfg.max_tags_recommended : cfg.max_tags_alternative),
    total: money(o.total_trip_cost, currency) ?? E.fallback_price,
    hasPrice: num(o.total_trip_cost) !== undefined,
    totalCaption: copy.option_card.total_caption,
    facts,
    checked,
    stale,
    staleLabel: copy.freshness.old_price_label,
  };
}

/** Sort eligible options: priced ones first, then by rank when given, otherwise by total. */
function sortEligible(options) {
  return [...options].sort((a, b) => {
    const pa = num(a.total_trip_cost) === undefined ? 1 : 0;
    const pb = num(b.total_trip_cost) === undefined ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const ra = num(a.rank) ?? Infinity;
    const rb = num(b.rank) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return (num(a.total_trip_cost) ?? Infinity) - (num(b.total_trip_cost) ?? Infinity);
  });
}

export function buildModel(result, options = {}) {
  const cfg = options.config;
  const sentAt = options.sentAt ?? Date.now();
  const r = result && typeof result === "object" ? result : {};
  const trip = r.trip_request && typeof r.trip_request === "object" ? r.trip_request : {};
  const currency = str(r.currency) ?? "USD";
  const all = (Array.isArray(r.options) ? r.options : []).filter((o) => o && typeof o === "object");
  const kind = emailKind({ ...r, options: all });

  // ---- Trip naming and headline
  const area = str(trip.start_area)?.split(",")[0]?.trim();
  const tripName = area ? fill(E.trip_name, { area: trim(area, 28) }) : E.trip_name_no_area;
  const range = dateRange(trip.pickup_datetime, trip.return_datetime);
  const when = range ? `, ${range}` : "";

  // ---- Options
  const eligible = sortEligible(all.filter((o) => o.status !== "not_a_fit"));
  const notAFit = all.filter((o) => o.status === "not_a_fit");
  // The agent's pick, unless it has no price (never ask someone to review a car with no total).
  const priced = (o) => num(o.total_trip_cost) !== undefined;
  const agentPick = eligible.find((o) => o.status === "recommended");
  const recOption = (agentPick && priced(agentPick) ? agentPick : eligible.find(priced)) ?? eligible[0];
  const others = eligible.filter((o) => o !== recOption);
  const shownAlts = others.slice(0, cfg.max_alternatives);
  const priority = r.winner_summary?.ranking_priority_used ?? trip.ranking_priority ?? copy.ranking_priorities.default;
  const priorityLabel = copy.ranking_priorities.options.find((p) => p.key === priority)?.label ?? copy.ranking_priorities.options[0].label;

  const winnerWhy =
    recOption && r.winner_summary?.recommended_option_id === recOption.option_id ? r.winner_summary?.one_line_explanation : undefined;
  const recommended = recOption
    ? card(recOption, { isRecommended: true, why: winnerWhy ?? recOption.reason, currency, sentAt, cfg })
    : null;
  const alternatives = shownAlts.map((o) => card(o, { isRecommended: false, why: o.reason, currency, sentAt, cfg }));

  const headline =
    kind === "results"
      ? fill(eligible.length === 1 ? E.headline_one : E.headline_many, { count: eligible.length, trip_name: tripName, when })
      : fill(E.headline_empty, { trip_name: tripName, when });

  // ---- Trip recap rows (rows with no data are left out, never shown empty)
  const rows = [];
  const dates =
    validIso(trip.pickup_datetime) && validIso(trip.return_datetime)
      ? `${dateTime(trip.pickup_datetime)} → ${dateTime(trip.return_datetime)}`
      : E.fallback_dates;
  rows.push({ label: E.trip_row_dates, value: dates });
  if (num(trip.travelers)) rows.push({ label: E.trip_row_people, value: fill(copy.trip_summary.travelers, { count: trip.travelers }) });
  const ages = (Array.isArray(trip.drivers) ? trip.drivers : []).map((d) => num(d?.age)).filter((a) => a !== undefined);
  if (ages.length) {
    const young = ages.some((a) => a < 25);
    rows.push({
      label: E.trip_row_drivers,
      value: fill(copy.trip_summary.drivers, { count: ages.length, ages: ages.join(", ") }) + (young ? ` · ${copy.trip_summary.young_driver_note}` : ""),
    });
  }
  const carKey = str(trip.car_class);
  if (carKey) rows.push({ label: E.trip_row_car, value: label(copy.car_class_labels, carKey, carKey) });
  if (num(trip.max_travel_minutes_to_branch) !== undefined)
    rows.push({ label: E.trip_row_branch_distance, value: fill(copy.trip_summary.max_travel, { minutes: trip.max_travel_minutes_to_branch }) });
  if (typeof trip.one_way_ok === "boolean")
    rows.push({ label: E.trip_row_return, value: trip.one_way_ok ? copy.trip_summary.one_way_yes : copy.trip_summary.one_way_no });

  // ---- Coverage (honest when partial)
  const providers = (r.coverage?.providers ?? []).filter((p) => p && str(p.provider));
  let coverage = null;
  if (providers.length) {
    const answered = providers.filter((p) => ANSWERED.has(p.result)).length;
    const line =
      answered === providers.length
        ? fill(copy.coverage.all_answered, { total: providers.length })
        : fill(copy.coverage.summary, { responded: answered, total: providers.length });
    // One line per reason, listing the companies: "Didn't respond in time: Rental Co A and Rental Co F".
    const groups = new Map();
    for (const p of providers.filter((x) => x.result === "unavailable" || x.result === "partial")) {
      const reason = E.coverage_reason_groups[p.reason] ? p.reason : "error";
      groups.set(reason, [...(groups.get(reason) ?? []), trim(p.provider, cfg.max_company_chars)]);
    }
    const missing = [...groups].map(([reason, names]) => fill(E.coverage_reason_groups[reason], { providers: joinAnd(names) }));
    coverage = { line, missing, note: missing.length ? copy.coverage.unavailable_note : undefined };
  }

  // ---- Where prices came from (never shows sample/test prices as live)
  const env = ["live", "sandbox", "fixture", "unavailable"].includes(r.data_source?.environment) ? r.data_source.environment : "fixture";
  const capturedTimes = all.map((o) => o.source?.captured_at).filter(validIso);
  const oldest = capturedTimes.length ? capturedTimes.reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b)) : undefined;
  const sourceNames = [...new Set(all.map((o) => sourceLabel(o.source?.name)).filter(Boolean))];
  const sourcesText = sourceNames.length ? joinAnd(sourceNames) : E.fallback_sources;
  let source = null;
  if (all.length) {
    const plain = [];
    if (env === "fixture") plain.push(E.env_plain_fixture);
    else if (env === "sandbox") plain.push(E.env_plain_sandbox);
    else if (env === "live") plain.push(E.env_plain_live);
    if (all.some((o) => o.source?.name === "cached_snapshot")) plain.push(E.env_plain_saved_earlier);
    const oldestAge = minutesBetween(oldest, sentAt);
    source = {
      line: oldest ? fill(E.source_line, { sources: sourcesText, when: dateTime(oldest) }) : fill(E.source_line_no_time, { sources: sourcesText }),
      plain,
      stale: oldestAge !== undefined && oldestAge > cfg.stale_after_minutes ? fill(E.stale_note, { ago: agoText(oldestAge) }) : undefined,
    };
  }
  const envNotice = env === "fixture" || env === "sandbox" ? copy.environment_banners[env] : undefined;

  // ---- Empty states: what was searched, why, what could help, how to retry
  let empty = null;
  if (kind !== "results") {
    const d = copy.empty_state_details;
    const heading = { nothing_fits: copy.empty_states.nothing_fits, no_cars: copy.empty_states.no_cars_found, unreachable: copy.empty_states.nothing_reachable }[kind];
    const why = { nothing_fits: d.nothing_fits_why, no_cars: d.no_cars_why, unreachable: d.nothing_reachable_why }[kind];
    const searched = fill(d.searched_line, {
      travelers: num(trip.travelers) ?? "?",
      pickup: dateTime(trip.pickup_datetime) ?? E.fallback_value,
      return: dateTime(trip.return_datetime) ?? E.fallback_value,
      minutes: num(trip.max_travel_minutes_to_branch) ?? "?",
      airports: (Array.isArray(trip.airports) && trip.airports.filter(str).join(", ")) || area || E.fallback_value,
    }).replace(/^\? travelers, /, "");
    const listed = notAFit.slice(0, cfg.max_not_a_fit_listed).map((o) => ({
      company: trim(o.brand, cfg.max_company_chars) ?? E.fallback_company,
      reason: trim(o.reason, cfg.max_reason_chars) ?? E.fallback_reason,
    }));
    const more = notAFit.length - listed.length;
    const suggestions =
      kind === "unreachable"
        ? [d.suggestion_try_later, d.suggestion_new_dates]
        : [
            num(trip.max_travel_minutes_to_branch) !== undefined
              ? fill(d.suggestion_wider_distance, { minutes: trip.max_travel_minutes_to_branch })
              : undefined,
            trip.one_way_ok === true ? undefined : d.suggestion_allow_one_way,
            d.suggestion_different_car,
            d.suggestion_new_dates,
          ].filter(Boolean);
    empty = {
      heading,
      searchedHeading: d.searched_heading,
      searched,
      whyHeading: d.why_heading,
      why,
      list: kind === "nothing_fits" ? listed : [],
      more: kind === "nothing_fits" && more > 0 ? fill(E.empty_more_options, { count: more }) : undefined,
      changeHeading: d.change_heading,
      suggestions,
      reply: E.empty_reply,
      link: E.empty_link,
    };
  }

  const subject =
    kind === "results" && recommended?.hasPrice
      ? fill(E.subject_results, { trip_name: tripName, brand: recommended.company, total: recommended.total })
      : fill(E.subject_empty, { trip_name: tripName });
  const preheader =
    kind === "results" && recommended?.hasPrice ? fill(E.preheader_results, { brand: recommended.company, total: recommended.total }) : empty?.heading ?? headline;

  const hiddenEligible = Math.max(0, others.length - shownAlts.length);
  return {
    kind,
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    preheader,
    headline,
    intro: kind === "results" ? E.intro : undefined,
    envNotice,
    trip: {
      heading: E.trip_heading,
      rows,
      rankedBy: kind === "results" ? fill(E.ranked_by, { priority: priorityLabel.charAt(0).toLowerCase() + priorityLabel.slice(1) }) : undefined,
    },
    recommended,
    alternatives,
    alternativesHeading: copy.alternatives.heading,
    seeAll: kind === "results" ? (hiddenEligible > 0 || notAFit.length > 0 ? fill(E.see_all_count, { count: all.length }) : E.see_all) : undefined,
    notAFitLine: kind === "results" && notAFit.length ? fill(notAFit.length === 1 ? E.not_a_fit_line_one : E.not_a_fit_line_many, { count: notAFit.length }) : undefined,
    coverage,
    reply: { line: E.reply_line, address: fill(E.reply_address_line, { reply_to_address: cfg.placeholders.reply_to_address }) },
    source: source ? { heading: E.source_heading, ...source } : null,
    empty,
    button: { label: E.review_button, note: E.review_note },
    footer: [E.footer_never_books, copy.confirmation.no_card_note, E.footer_why],
    links: cfg.placeholders,
    brand: { name: copy.page.brand_name, alt: E.logo_alt },
  };
}

function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${E.list_and} ${items[items.length - 1]}`;
}
