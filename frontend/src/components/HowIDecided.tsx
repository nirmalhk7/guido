import { useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import type { AuditStep, Option, RankingPriority, TripResult } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { Card, CardBody } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MiniSteps, Timeline, type TimelineStep } from "./Timeline";
import { CompareTable } from "./CompareTable";

export interface PriorityChange {
  priority: RankingPriority;
  at: string;
}

/**
 * Turns the contract's audit trail into timeline steps. The ranking step's
 * sentence follows the current priority; priority changes the person made on
 * this page are added as their own steps, in time order.
 */
export function buildSteps(result: TripResult, priority: RankingPriority, changes: PriorityChange[], extra: TimelineStep[] = []): TimelineStep[] {
  const used = result.winner_summary?.ranking_priority_used;
  const steps: TimelineStep[] = [];
  const toStep = (s: AuditStep): TimelineStep => {
    let finding = s.plain_language_finding;
    if (s.step_type === "ranking" && used && priority !== used) {
      finding = copy.ranking_priorities.options.find((p) => p.key === priority)?.recommended_because ?? finding;
    }
    return { key: `s${s.step_number}`, name: s.step_name, finding, timestamp: s.timestamp, state: "done" };
  };
  const changeSteps: TimelineStep[] = changes.map((c, i) => ({
    key: `change${i}`,
    name: copy.how_i_decided.priority_changed_step_name,
    finding: fill(copy.ranking_priorities.changed_note, {
      priority_label: copy.ranking_priorities.options.find((p) => p.key === c.priority)?.label ?? c.priority,
    }),
    timestamp: c.at,
    state: "done",
    emphasis: true,
  }));

  steps.push(...result.audit_trail.map(toStep), ...changeSteps, ...extra);
  // Keep everything in the order it happened (sort is stable for equal times).
  return steps.sort((a, b) => (a.timestamp && b.timestamp ? Date.parse(a.timestamp) - Date.parse(b.timestamp) : 0));
}

/** "How I decided": closed unless opened, so it never overwhelms. */
export function HowIDecided({ steps, ranked }: { steps: TimelineStep[]; ranked: Option[] }) {
  const [open, setOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const h = copy.how_i_decided;

  return (
    <section aria-labelledby="how-heading">
      <Card>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="w-full rounded-lg text-left">
            <CardBody className="flex items-center gap-3">
              <ListChecks aria-hidden className="size-6 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <h2 id="how-heading" className="text-[17px] font-semibold">
                  {copy.layer_3_how_i_decided.toggle_label}
                </h2>
                <p className="text-[14px] text-muted-foreground">{fill(h.summary, { count: steps.length })}</p>
                <MiniSteps steps={steps} />
              </div>
              <span className="sr-only">{open ? h.close : h.open}</span>
              <ChevronDown aria-hidden className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </CardBody>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardBody className="space-y-5 border-t pt-5">
              <div>
                <h3 className="sr-only">{copy.layer_3_how_i_decided.timeline.heading}</h3>
                <Timeline steps={steps} />
              </div>
              <Collapsible open={compare} onOpenChange={setCompare}>
                <CollapsibleTrigger className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-primary">
                  {compare ? h.compare_hide : h.compare_show}
                  <ChevronDown aria-hidden className={`size-4 transition-transform ${compare ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CompareTable ranked={ranked} />
                </CollapsibleContent>
              </Collapsible>
            </CardBody>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </section>
  );
}
