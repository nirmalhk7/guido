// Small, dependency-free helpers for the email. Every helper returns a string
// and never "null", "undefined" or "NaN".

/** Escape text for HTML. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fill {placeholders} in a wording template. */
export function fill(template, vars = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** Non-empty string, or undefined. */
export function str(value) {
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  return t && t !== "null" && t !== "undefined" ? t : undefined;
}

/** Finite number, or undefined. */
export function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Shorten to `max` characters on a word boundary, adding an ellipsis. */
export function trim(text, max) {
  const t = str(text);
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Integer cents → "$413.20". */
export function money(cents, currency = "USD") {
  const n = num(cents);
  if (n === undefined) return undefined;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n / 100);
  } catch {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
  }
}

function offsetMinutes(iso) {
  const m = String(iso).match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function validIso(iso) {
  return typeof iso === "string" && !Number.isNaN(Date.parse(iso));
}

/** Format a time on the clock where it happened (pickup in Dallas shows Dallas time). */
function atOwnClock(iso, options) {
  if (!validIso(iso)) return undefined;
  const shifted = new Date(Date.parse(iso) + offsetMinutes(iso) * 60_000);
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(shifted);
}

export const dateTime = (iso) => atOwnClock(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const shortDate = (iso) => atOwnClock(iso, { month: "short", day: "numeric" });
export const monthOf = (iso) => atOwnClock(iso, { month: "short" });
export const dayOf = (iso) => atOwnClock(iso, { day: "numeric" });

/** "Nov 25–29" or "Nov 28 – Dec 2"; undefined if either date is missing. */
export function dateRange(startIso, endIso) {
  if (!validIso(startIso) || !validIso(endIso)) return undefined;
  if (monthOf(startIso) === monthOf(endIso)) return `${shortDate(startIso)}–${dayOf(endIso)}`;
  return `${shortDate(startIso)} – ${shortDate(endIso)}`;
}

export function minutesBetween(fromIso, toMs) {
  if (!validIso(fromIso)) return undefined;
  return Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 60_000));
}

export { validIso };
