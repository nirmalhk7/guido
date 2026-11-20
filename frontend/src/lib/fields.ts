// Turns a field named in display_fields.json into display text, so the page
// follows the config: drop a field there and it disappears here.
import type { Cancellation, MileagePolicy } from "./contract";
import { copy, fill, labelFor } from "./copy";
import { dateTime, money, shortDate, clockTime } from "./format";

export interface FieldSpec {
  field: string;
  label: string;
  format: string;
  show: boolean;
}

/** Read "a.b.c" from an object. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

export function cancellationText(c: Cancellation): string {
  const l = copy.cancellation_labels;
  if (c.type === "free") return c.free_until ? fill(l.free_until, { free_until: dateTime(c.free_until) }) : l.free_until_pickup;
  if (c.type === "partial") return fill(l.partial, { fee: money(c.fee ?? 0) });
  return c.type === "non_refundable" ? l.non_refundable : l.unknown;
}

export function mileageText(m: MileagePolicy): string {
  if (m.type === "unlimited") return copy.mileage_labels.unlimited;
  return fill(copy.mileage_labels.capped, { cap_miles: m.cap_miles ?? 0, per_mile_cost: money(m.per_mile_cost ?? 0) });
}

export function carClassText(key: string): string {
  return labelFor(copy.car_class_labels, key);
}

export function formatField(format: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "currency":
      return money(value as number);
    case "minutes":
      return `${value} min`;
    case "datetime":
      return dateTime(value as string);
    case "date":
      return shortDate(value as string);
    case "time":
      return clockTime(value as string);
    case "number":
      return String(value);
    case "yes_no":
      return value ? copy.common.yes : copy.common.no;
    case "list":
      return (value as unknown[])
        .map((v) => (v && typeof v === "object" && "age" in v ? String((v as { age: number }).age) : String(v)))
        .join(", ");
    case "mileage":
      return mileageText(value as MileagePolicy);
    case "cancellation":
      return cancellationText(value as Cancellation);
    case "status":
      return labelFor(copy.status_labels, value as string);
    case "priority":
      return copy.ranking_priorities.options.find((p) => p.key === value)?.label ?? String(value);
    case "source":
      return labelFor(copy.source_labels, value as string);
    case "environment":
      return labelFor(copy.environment_labels, value as string);
    case "tags":
      return (value as string[]).map((t) => labelFor(copy.tag_labels, t)).join(", ");
    default:
      // A car_class value is a key like "midsize_suv"; show its friendly name if we have one.
      return typeof value === "string" && value in copy.car_class_labels ? carClassText(value) : String(value);
  }
}

/** The visible fields of a config list, with their formatted values. */
export function visibleFields(specs: FieldSpec[], source: unknown) {
  return specs
    .filter((s) => s.show)
    .map((s) => ({ ...s, text: formatField(s.format, getPath(source, s.field)) }));
}
