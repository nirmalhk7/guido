import type { Option } from "@/lib/contract";
import { copy } from "@/lib/copy";
import { formatField, getPath, type FieldSpec } from "@/lib/fields";
import { cn } from "@/lib/utils";

/**
 * Every option side by side, columns and order from display_fields.json.
 * Options that fit come first; "Doesn't fit your trip" is a greyed-out group.
 * Scrolls sideways inside its own box so the page never does.
 */
export function CompareTable({ ranked }: { ranked: Option[] }) {
  const table = copy.layer_3_how_i_decided.comparison_table;
  const cols = (table.fields as FieldSpec[]).filter((f) => f.show && f.field !== "status");

  return (
    <div className="mt-2 space-y-4">
      <h4 className="sr-only">{table.heading}</h4>
      {table.groups.map((g) => {
        const rows = ranked.filter((o) => (g.statuses as string[]).includes(o.status));
        if (rows.length === 0) return null;
        const muted = g.style === "greyed_out";
        return (
          <div key={g.heading}>
            <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
            <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={g.heading}>
              <table className={cn("min-w-max text-left text-[13px]", muted && "text-muted-foreground")}>
                <thead className="bg-muted">
                  <tr>
                    {cols.map((c) => (
                      <th key={c.field} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((o) => (
                    <tr key={o.option_id} className={cn(o.status === "recommended" && "bg-primary-soft")}>
                      {cols.map((c, i) => {
                        const text = formatField(c.format, getPath(o, c.field));
                        const Cell = i === 0 ? "th" : "td";
                        return (
                          <Cell
                            key={c.field}
                            scope={i === 0 ? "row" : undefined}
                            className={cn(
                              "px-3 py-2 align-top",
                              c.format === "currency" && "tabular text-right whitespace-nowrap",
                              (c.field === "reason" || c.field === "luggage_fit_note") && "min-w-[200px]",
                              i === 0 && "font-medium",
                            )}
                          >
                            {i === 0 && o.status === "recommended" && (
                              <span className="mb-0.5 block text-[11px] font-semibold text-primary">{copy.status_labels.recommended}</span>
                            )}
                            {text}
                          </Cell>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
