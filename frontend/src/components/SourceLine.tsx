import { Clock } from "lucide-react";
import type { Option } from "@/lib/contract";
import { copy, fill, labelFor } from "@/lib/copy";
import { clockTime, timeAgo } from "@/lib/format";
import { isStale } from "@/lib/rank";
import { Badge } from "@/components/ui/badge";

/** Where this option's price came from, when, and whether it's real. */
export function SourceLine({ option, now }: { option: Option; now: number }) {
  const s = option.source;
  const stale = isStale(s.captured_at, now);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Clock aria-hidden className="size-3.5" />
        {fill(copy.option_card.checked_line, {
          source: labelFor(copy.source_labels, s.name),
          when: timeAgo(s.captured_at, now),
        })}
        <span className="sr-only"> ({clockTime(s.captured_at)})</span>
      </span>
      {stale && <Badge variant="warning">{copy.freshness.old_price_label}</Badge>}
      {s.environment !== "live" && <Badge variant="muted">{labelFor(copy.environment_labels, s.environment)}</Badge>}
    </div>
  );
}
