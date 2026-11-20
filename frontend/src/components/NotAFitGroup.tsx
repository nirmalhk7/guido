import { useState } from "react";
import { ChevronDown, CircleSlash } from "lucide-react";
import type { Option } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { money } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** "Doesn't fit your trip": collapsed by default, each with its plain-words reason. */
export function NotAFitGroup({ options, defaultOpen = false }: { options: Option[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (options.length === 0) return null;
  const g = copy.not_a_fit_group;

  return (
    <section aria-labelledby="not-a-fit-heading">
      <Card>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardBody className="space-y-1">
            <h2 id="not-a-fit-heading" className="flex items-center gap-2 text-[17px] font-semibold">
              <CircleSlash aria-hidden className="size-5 text-muted-foreground" />
              {copy.status_labels.not_a_fit}
            </h2>
            <p className="text-[15px] text-muted-foreground">{g.intro}</p>
            <CollapsibleTrigger className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-primary">
              {open ? g.hide : fill(g.show, { count: options.length })}
              <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 divide-y">
                {options.map((o) => (
                  <li key={o.option_id} className="py-3 text-[15px]">
                    <div className="flex items-baseline justify-between gap-4 text-muted-foreground">
                      <span className="font-medium">{o.brand}</span>
                      <span className="tabular line-through decoration-1">{money(o.total_trip_cost)}</span>
                    </div>
                    <p className="text-[13px] text-muted-foreground">{o.pickup_branch}</p>
                    <p className="mt-1 text-foreground">{o.reason}</p>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </CardBody>
        </Collapsible>
      </Card>
    </section>
  );
}
