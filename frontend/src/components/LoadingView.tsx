import { useEffect, useState } from "react";
import type { TripResult } from "@/lib/contract";
import { copy } from "@/lib/copy";
import { Card, CardBody } from "@/components/ui/card";
import { Timeline, type TimelineStep } from "./Timeline";

const STEP_MS = 900;

/**
 * Loading as progress, not a spinner: the agent's steps appear one at a time
 * (done ✓ / working / not yet), then the results take over.
 * With real data this would follow steps as the backend sends them.
 */
export function LoadingView({ result, onDone }: { result: TripResult; onDone: () => void }) {
  // Steps up to and including the pick; booking steps come later.
  const work = result.audit_trail.filter((s) => !["confirmation", "approval", "handoff"].includes(s.step_type ?? ""));
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    if (doneCount >= work.length) {
      const t = setTimeout(onDone, 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDoneCount((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [doneCount, work.length, onDone]);

  const steps: TimelineStep[] = work.map((s, i) => ({
    key: `l${s.step_number}`,
    name: s.step_name,
    finding: i < doneCount ? s.plain_language_finding : undefined,
    timestamp: s.timestamp,
    state: i < doneCount ? "done" : i === doneCount ? "working" : "pending",
  }));

  return (
    <section aria-labelledby="loading-heading" aria-busy="true">
      <Card>
        <CardBody className="space-y-5">
          <div className="space-y-1">
            <h2 id="loading-heading" className="text-[20px] font-semibold">
              {copy.loading.heading}
            </h2>
            <p className="text-[15px] text-muted-foreground">{copy.loading.subheading}</p>
          </div>
          <div aria-live="polite">
            <Timeline steps={steps} animate />
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
