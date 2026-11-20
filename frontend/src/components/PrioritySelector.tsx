import type { RankingPriority } from "@/lib/contract";
import { copy } from "@/lib/copy";
import { Segment, SegmentedControl } from "@/components/ui/toggle-group";

export function PrioritySelector({ value, onChange }: { value: RankingPriority; onChange: (p: RankingPriority) => void }) {
  const p = copy.ranking_priorities;
  return (
    <section aria-labelledby="priority-label" className="space-y-2">
      <h2 id="priority-label" className="px-1 text-[15px] font-semibold">
        {p.picker_label}
      </h2>
      <SegmentedControl
        value={value}
        onValueChange={(v: string) => onChange(v as RankingPriority)}
        aria-label={copy.priority_selector.group_label}
      >
        {p.options.map((o) => (
          <Segment key={o.key} value={o.key}>
            {o.label}
          </Segment>
        ))}
      </SegmentedControl>
    </section>
  );
}
