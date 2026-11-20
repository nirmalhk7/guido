import type { Option, RankingPriority, TripResult } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { money } from "@/lib/format";
import { OptionCard, differenceText } from "./OptionCard";
import { NotAFitGroup } from "./NotAFitGroup";
import { CouldntCheckGroup, CoverageLine, type Pending } from "./Coverage";

interface Props {
  result: TripResult;
  ranked: Option[];
  priority: RankingPriority;
  now: number;
  pending?: Pending;
}

/** The answer-first layers: Recommended, then alternatives, then what didn't fit. */
export function Results({ result, ranked, priority, now, pending = [] }: Props) {
  const recommended = ranked.find((o) => o.status === "recommended");
  const alternatives = ranked.filter((o) => o.status === "alternative");
  const notAFit = ranked.filter((o) => o.status === "not_a_fit");
  if (!recommended) return null;

  return (
    <div className="space-y-6">
      <CoverageLine result={result} pending={pending} />

      <section aria-label={copy.status_labels.recommended}>
        <OptionCard
          option={recommended}
          variant="recommended"
          why={whyLine(result, recommended, priority)}
          comparison={savings(result, recommended)}
          now={now}
        />
      </section>

      {alternatives.length > 0 && (
        <section aria-labelledby="alternatives-heading" className="space-y-3">
          <h2 id="alternatives-heading" className="px-1 text-[20px] font-semibold">
            {copy.alternatives.heading}
          </h2>
          {alternatives.map((o) => (
            <OptionCard
              key={o.option_id}
              option={o}
              variant="alternative"
              comparison={{ text: differenceText(o, recommended), tone: "neutral" }}
              now={now}
            />
          ))}
        </section>
      )}

      <NotAFitGroup options={notAFit} />
      <CouldntCheckGroup result={result} pending={pending} />
    </div>
  );
}

/**
 * The agent's own one-liner while its pick and priority still hold; once the
 * user re-ranks, the config's "Recommended because…" sentence for that priority.
 */
export function whyLine(result: TripResult, recommended: Option, priority: RankingPriority): string {
  const w = result.winner_summary;
  if (w && w.recommended_option_id === recommended.option_id && w.ranking_priority_used === priority) {
    return w.one_line_explanation;
  }
  return copy.ranking_priorities.options.find((p) => p.key === priority)?.recommended_because ?? "";
}

/** Savings (or extra cost) vs. the "usual pick" the agent named, if any. */
function savings(result: TripResult, recommended: Option) {
  const obviousId = result.winner_summary?.obvious_option_id;
  const obvious = result.options.find((o) => o.option_id === obviousId);
  if (!obvious || obvious.option_id === recommended.option_id) return undefined;
  const diff = obvious.total_trip_cost - recommended.total_trip_cost;
  if (diff === 0) return undefined;
  const c = copy.option_card;
  return diff > 0
    ? { text: fill(c.savings_line, { amount: money(diff), brand: obvious.brand }), tone: "good" as const }
    : { text: fill(c.costs_more_line, { amount: money(-diff), brand: obvious.brand }), tone: "neutral" as const };
}
