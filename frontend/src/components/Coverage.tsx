import { useState } from "react";
import { Building2, ChevronDown, Loader2, Unplug } from "lucide-react";
import type { TripResult } from "@/lib/contract";
import { copy, fill, labelFor } from "@/lib/copy";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const ANSWERED = new Set(["complete", "partial", "no_cars"]);

/** Companies still being checked (demo/streaming only; not part of the finished contract). */
export type Pending = string[];

/** "5 of 6 rental companies answered", expandable to who and where. */
export function CoverageLine({ result, pending = [] }: { result: TripResult; pending?: Pending }) {
  const [open, setOpen] = useState(false);
  const c = copy.coverage;
  const d = copy.coverage_detail;
  const providers = result.coverage.providers;
  const total = providers.length;
  const answered = providers.filter((p) => ANSWERED.has(p.result) && !pending.includes(p.provider)).length;
  if (total === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="px-1 text-[15px]">
      <div className="flex flex-wrap items-center gap-x-2">
        <Building2 aria-hidden className="size-4 text-muted-foreground" />
        <span>{answered === total ? fill(c.all_answered, { total }) : fill(c.summary, { responded: answered, total })}</span>
        <CollapsibleTrigger className="inline-flex min-h-11 items-center gap-1 font-medium text-primary">
          {open ? d.hide : d.show}
          <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
      </div>
      {pending.length > 0 && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {fill(d.still_checking_line, { provider: pending.join(", ") })}
        </p>
      )}
      <CollapsibleContent>
        <Card className="mt-2">
          <CardBody className="space-y-4">
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{d.providers_heading}</h3>
              <ul className="mt-1 divide-y">
                {providers.map((p) => {
                  const isPending = pending.includes(p.provider);
                  const label = isPending ? d.pending_label : labelFor(c.provider_result_labels, p.result);
                  return (
                    <li key={p.provider} className="flex items-baseline justify-between gap-4 py-2.5">
                      <span>{p.provider}</span>
                      <span className="text-right text-muted-foreground">
                        {label}
                        {!isPending && p.reason && <span className="block text-[13px]">{labelFor(c.reason_labels, p.reason)}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{d.sources_heading}</h3>
              <ul className="mt-1 divide-y">
                {result.coverage.source_attempts.map((a) => (
                  <li key={a.source} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span className="first-letter:uppercase">{labelFor(copy.source_labels, a.source)}</span>
                    <span className="text-right text-muted-foreground">
                      {labelFor(d.source_outcome_labels, a.outcome)}
                      {a.reason && <span className="block text-[13px]">{labelFor(c.reason_labels, a.reason)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[13px] text-muted-foreground">{c.unavailable_note}</p>
          </CardBody>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** "Couldn't fully check": companies that were partial, unavailable, or still pending. */
export function CouldntCheckGroup({ result, pending = [] }: { result: TripResult; pending?: Pending }) {
  const g = copy.couldnt_check_group;
  const c = copy.coverage;
  const rows = result.coverage.providers.filter((p) => p.result === "partial" || p.result === "unavailable" || pending.includes(p.provider));
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="couldnt-check-heading">
      <Card>
        <CardBody className="space-y-1">
          <h2 id="couldnt-check-heading" className="flex items-center gap-2 text-[17px] font-semibold">
            <Unplug aria-hidden className="size-5 text-muted-foreground" />
            {g.heading}
          </h2>
          <p className="text-[15px] text-muted-foreground">{g.intro}</p>
          <ul className="divide-y pt-1">
            {rows.map((p) => {
              const isPending = pending.includes(p.provider);
              return (
                <li key={p.provider} className="flex items-center justify-between gap-4 py-3 text-[15px]">
                  <span className="font-medium">{p.provider}</span>
                  {isPending ? (
                    <Badge variant="soft">
                      <Loader2 aria-hidden className="animate-spin" /> {g.still_checking}
                    </Badge>
                  ) : (
                    <span className="text-right text-muted-foreground">
                      {labelFor(c.provider_result_labels, p.result)}
                      {p.reason && <span className="block text-[13px]">{labelFor(c.reason_labels, p.reason)}</span>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}
