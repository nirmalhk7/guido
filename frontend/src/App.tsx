import { useMemo, useState } from "react";
import type { RankingPriority, TripResult } from "@/lib/contract";
import { copy } from "@/lib/copy";
import { isStale, rankOptions } from "@/lib/rank";
import { Banner } from "@/components/Banner";
import { TripSummary } from "@/components/TripSummary";
import { PrioritySelector } from "@/components/PrioritySelector";
import { Results } from "@/components/Results";
import { awaitingApproval, rebaseTimes, sampleResult } from "@/demo/variants";

export default function App() {
  // For now the page reads the sample. Real results will arrive in the same shape.
  const [result] = useState<TripResult>(() => awaitingApproval(rebaseTimes(sampleResult)));
  const [priority, setPriority] = useState<RankingPriority>(result.trip_request.ranking_priority);
  const now = Date.now();

  const ranked = useMemo(() => rankOptions(result.options, priority), [result, priority]);
  const env = result.data_source.environment;
  const envBanner = env !== "live" ? (copy.environment_banners as Record<string, string>)[env] : undefined;
  const anyStale = ranked.some((o) => o.status !== "not_a_fit" && isStale(o.source.captured_at, now));

  return (
    <div className="mx-auto max-w-[640px] space-y-6 px-4 pb-16 pt-6 sm:pt-10">
      <header className="space-y-1 px-1">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{copy.page.agent_name}</p>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">{copy.page.title}</h1>
      </header>

      {(envBanner || anyStale) && (
        <div className="space-y-2">
          {envBanner && <Banner tone={env === "fixture" ? "sample" : "warning"}>{envBanner}</Banner>}
          {anyStale && <Banner tone="warning">{copy.freshness.stale_banner}</Banner>}
        </div>
      )}

      <TripSummary trip={result.trip_request} />
      <PrioritySelector value={priority} onChange={setPriority} />
      <Results result={result} ranked={ranked} priority={priority} now={now} />
    </div>
  );
}
