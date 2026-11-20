import { copy, fill } from "./copy";

/** Cents → "$413.20". */
export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Minutes of UTC offset written in an ISO timestamp (e.g. "-06:00" → -360). */
function offsetMinutes(iso: string): number {
  const m = iso.match(/([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Show a time as the clock read where it happened (e.g. pickup in Dallas shows
 * Dallas time), not the viewer's own time zone.
 */
function atOwnClock(iso: string, options: Intl.DateTimeFormatOptions): string {
  const shifted = new Date(Date.parse(iso) + offsetMinutes(iso) * 60_000);
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(shifted);
}

/** "Wed, Nov 25, 6:00 PM" */
export function dateTime(iso: string): string {
  return atOwnClock(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Wed, Nov 25" */
export function shortDate(iso: string): string {
  return atOwnClock(iso, { weekday: "short", month: "short", day: "numeric" });
}

/** "1:40 PM" */
export function clockTime(iso: string): string {
  return atOwnClock(iso, { hour: "numeric", minute: "2-digit" });
}

/** "just now", "12 min ago", "3 hr ago" */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  const f = copy.freshness;
  if (mins < 1) return f.just_now;
  if (mins < 60) return fill(f.minutes_ago, { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return fill(f.hours_ago, { count: hours });
  return fill(f.days_ago, { count: Math.round(hours / 24) });
}

export function minutesLabel(n: number): string {
  return `${n} min`;
}
