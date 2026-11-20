import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Option } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { money } from "@/lib/format";
import { getPath, type FieldSpec } from "@/lib/fields";
import { feesAndTaxes } from "@/lib/rank";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// Lines that are summaries, not charges, so they're not listed as line items.
const NOT_LINE_ITEMS = new Set(["base_daily_rate", "total_trip_cost"]);

/**
 * Core charges under the total; every charge line only when the user asks.
 * The total row stays visible either way.
 */
export function PriceBreakdown({ option }: { option: Option }) {
  const [open, setOpen] = useState(false);
  const c = copy.option_card;

  const core = [
    { label: c.core_rental, amount: option.base_total },
    { label: c.core_fees_taxes, amount: feesAndTaxes(option) },
    { label: c.core_travel, amount: option.travel_to_branch.cost },
  ].filter((l, i) => i === 0 || l.amount > 0);

  const detail = (copy.layer_3_how_i_decided.comparison_table.fields as FieldSpec[])
    .filter((f) => f.show && f.format === "currency" && !NOT_LINE_ITEMS.has(f.field))
    .map((f) => ({ label: f.label, amount: getPath(option, f.field) as number, field: f.field }))
    .filter((l) => l.field === "base_total" || l.amount > 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="text-[15px]">
      <dl className="divide-y">
        {(open ? detail : core).map((l) => (
          <Row key={l.label} label={l.label} amount={money(l.amount)}>
            {open && "field" in l && l.field === "base_total" && (
              <span className="block text-[13px] text-muted-foreground">
                {fill(c.daily_rate_line, { rate: money(option.base_daily_rate), days: option.days })}
              </span>
            )}
          </Row>
        ))}
        <Row label={c.breakdown_total} amount={money(option.total_trip_cost)} strong />
      </dl>
      <CollapsibleContent>
        <p className="pt-2 text-[13px] text-muted-foreground">
          {c.includes_note}
        </p>
      </CollapsibleContent>
      <CollapsibleTrigger className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-primary">
        {open ? c.breakdown_hide : c.breakdown_show}
        <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
    </Collapsible>
  );
}

function Row({ label, amount, strong, children }: { label: string; amount: string; strong?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? "font-semibold" : ""}`}>
      <dt>
        {label}
        {children}
      </dt>
      <dd className="tabular shrink-0">{amount}</dd>
    </div>
  );
}
