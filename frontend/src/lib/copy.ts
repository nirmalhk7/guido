// All on-screen wording comes from contracts/display_fields.json.
// Never hard-code user-facing text in components; add a key there instead.
import displayFields from "@contracts/display_fields.json";

export const copy = displayFields;

/** Fill {placeholders} in a wording template. Unknown placeholders are left as-is. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

/** Look up a label by key in a label map, falling back to a readable version of the key. */
export function labelFor(map: Record<string, unknown>, key: string): string {
  const value = map[key];
  if (typeof value === "string") return value;
  return key.replace(/_/g, " ");
}
