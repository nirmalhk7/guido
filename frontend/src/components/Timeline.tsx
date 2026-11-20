import { Check, Loader2 } from "lucide-react";
import { copy } from "@/lib/copy";
import { clockTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type StepState = "done" | "working" | "pending";

export interface TimelineStep {
  key: string;
  name: string;
  finding?: string;
  timestamp?: string;
  state: StepState;
  /** Highlight a step the person caused (e.g. changing priority, approving). */
  emphasis?: boolean;
}

/**
 * A calm vertical timeline (Decision trail reference): check marks for done
 * steps, a spinner for the one in progress, hollow dots for what's next.
 * State is always given in text too, never by the icon alone.
 */
export function Timeline({ steps, animate = false }: { steps: TimelineStep[]; animate?: boolean }) {
  const h = copy.how_i_decided;
  const stateText: Record<StepState, string> = { done: h.step_done, working: h.step_working, pending: h.step_pending };

  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.key} className={cn("relative flex gap-3 pb-5", last && "pb-0", animate && "animate-fade-up")}>
            {!last && (
              <span
                aria-hidden
                className={cn("absolute left-[13px] top-7 bottom-0 w-0.5", s.state === "done" ? "bg-success/40" : "bg-border")}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                s.state === "done" && (s.emphasis ? "bg-primary text-primary-foreground" : "bg-success text-white"),
                s.state === "working" && "bg-primary-soft text-primary",
                s.state === "pending" && "border-2 border-border bg-card",
              )}
            >
              {s.state === "done" && <Check className="size-4" strokeWidth={3} />}
              {s.state === "working" && <Loader2 className="size-4 animate-spin" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("text-[16px] font-semibold leading-snug", s.state === "pending" && "font-medium text-muted-foreground")}>
                  {s.name}
                  <span className="sr-only"> ({stateText[s.state]})</span>
                </p>
                {s.timestamp && s.state === "done" && (
                  <time dateTime={s.timestamp} className="tabular shrink-0 text-[13px] text-muted-foreground">
                    {clockTime(s.timestamp)}
                  </time>
                )}
              </div>
              {s.finding && s.state !== "pending" && <p className="mt-0.5 text-[15px] leading-snug text-muted-foreground">{s.finding}</p>}
              {s.state === "working" && !s.finding && <p className="mt-0.5 text-[15px] text-primary">{h.step_working}…</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact collapsed progress dots (the RV stepper's closed state). */
export function MiniSteps({ steps }: { steps: TimelineStep[] }) {
  return (
    <span aria-hidden className="flex items-center gap-1">
      {steps.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1">
          {i > 0 && <span className="h-0.5 w-2.5 rounded bg-border" />}
          <span
            className={cn(
              "size-2.5 rounded-full",
              s.state === "done" ? (s.emphasis ? "bg-primary" : "bg-success") : s.state === "working" ? "bg-primary/50" : "border border-border bg-card",
            )}
          />
        </span>
      ))}
    </span>
  );
}
