import { useCallback, useEffect, useMemo, useState } from "react";
import type { RankingPriority, TripRequest, TripResult } from "@/lib/contract";
import { copy } from "@/lib/copy";
import { isStale, pageKind, rankOptions } from "@/lib/rank";
import { cn } from "@/lib/utils";
import { Banner } from "@/components/Banner";
import { Logo } from "@/components/Logo";
import { TripSummary } from "@/components/TripSummary";
import { PrioritySelector } from "@/components/PrioritySelector";
import { Results } from "@/components/Results";
import { HowIDecided, buildSteps, type PriorityChange } from "@/components/HowIDecided";
import { LoadingView } from "@/components/LoadingView";
import { EmptyState } from "@/components/EmptyState";
import { Confirmation, approvalSteps } from "@/components/Confirmation";
import { DemoSwitcher } from "@/demo/DemoSwitcher";
import { DEMO_STATES, demoInput, shiftKeepingOffset, type DemoStateKey, type PageInput } from "@/demo/variants";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const isDemo = params.has("demo");
  const initial = (params.get("state") as DemoStateKey) ?? "results";
  const [stateKey, setStateKey] = useState<DemoStateKey>(DEMO_STATES.includes(initial) ? initial : "results");

  // For now the page reads the sample. Real results will arrive in the same shape.
  const input = useMemo(() => demoInput(stateKey), [stateKey]);

  const changeState = (k: DemoStateKey) => {
    setStateKey(k);
    const url = new URL(window.location.href);
    url.searchParams.set("state", k);
    window.history.replaceState(null, "", url);
  };

  return (
    <>
      <Page key={stateKey} input={input} />
      {isDemo && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <DemoSwitcher value={stateKey} onChange={changeState} />
        </div>
      )}
    </>
  );
}

function Page({ input }: { input: PageInput }) {
  const { result } = input;
  const [loading, setLoading] = useState(!!input.loading);
  const [pending, setPending] = useState<string[]>(input.pending ?? []);
  const [outdated, setOutdated] = useState(!!input.outdated);
  const [searchingAgain, setSearchingAgain] = useState(false);
  const [priority, setPriority] = useState<RankingPriority>(result.trip_request.ranking_priority);
  const [changes, setChanges] = useState<PriorityChange[]>([]);
  // Approval recorded in the data (already approved) or made on this page.
  const [approval, setApproval] = useState<{ optionId: string; at: string; here: boolean } | null>(() =>
    result.confirmation?.human_approved && result.confirmation.approved_at && result.winner_summary
      ? { optionId: result.winner_summary.recommended_option_id, at: result.confirmation.approved_at, here: false }
      : null,
  );
  const now = Date.now();

  // A slow company: show what we have, then mark it as not answering in time.
  useEffect(() => {
    if (!input.pendingForMs || pending.length === 0) return;
    const t = setTimeout(() => setPending([]), input.pendingForMs);
    return () => clearTimeout(t);
  }, [input.pendingForMs, pending.length]);

  const ranked = useMemo(() => rankOptions(result.options, priority), [result, priority]);
  const recommended = ranked.find((o) => o.status === "recommended");
  // Once approved, the confirmation stays on the approved car even if the priority changes.
  const bookingOption = (approval && ranked.find((o) => o.option_id === approval.optionId)) || recommended;
  const steps = useMemo(() => {
    const extra = approval?.here && bookingOption ? approvalSteps(result, bookingOption, approval.at) : [];
    return buildSteps(result, priority, changes, extra);
  }, [result, priority, changes, approval, bookingOption]);
  const kind = pageKind(result);
  const finishLoading = useCallback(() => setLoading(false), []);

  const changePriority = (p: RankingPriority) => {
    setPriority(p);
    setChanges((c) => [...c, { priority: p, at: localNow(result) }]);
  };

  const retry = (_trip: TripRequest) => {
    // The backend will run the new search; for now we only mark these results as outdated.
    setOutdated(true);
    setSearchingAgain(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const env = result.data_source.environment;
  const envBanner = (env === "sandbox" || env === "unavailable") && kind !== "unreachable" ? copy.environment_banners[env] : undefined;
  const anyStale = ranked.some((o) => o.status !== "not_a_fit" && isStale(o.source.captured_at, now));

  return (
    <div className="mx-auto max-w-[640px] space-y-6 px-4 pb-28 pt-6 sm:pt-10">
      <header className="space-y-5 px-1">
        <Logo size="md" />
        <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">{copy.page.title}</h1>
      </header>

      <div className="space-y-2 empty:hidden">
        {outdated && (
          <Banner tone="warning">
            <p className="font-medium">{copy.outdated.banner}</p>
            {searchingAgain && (
              <p className="mt-1">
                {copy.outdated.searching_again} <span className="text-[13px] opacity-80">{copy.outdated.demo_note}</span>
              </p>
            )}
          </Banner>
        )}
        {envBanner && !loading && <Banner tone="warning">{envBanner}</Banner>}
        {anyStale && !loading && <Banner tone="warning">{copy.freshness.stale_banner}</Banner>}
      </div>

      <div className={cn("space-y-6 transition-opacity", outdated && "opacity-60")} aria-disabled={outdated || undefined}>
        <TripSummary trip={result.trip_request} />

        {loading ? (
          <LoadingView result={result} onDone={finishLoading} />
        ) : kind === "results" ? (
          <div className="animate-fade-up space-y-6">
            <PrioritySelector value={priority} onChange={changePriority} />
            <Results result={result} ranked={ranked} priority={priority} now={now} pending={pending} />
            {bookingOption && (
              <Confirmation
                result={result}
                option={bookingOption}
                approvedAt={approval?.at ?? null}
                disabled={outdated}
                onApprove={() => setApproval({ optionId: bookingOption.option_id, at: localNow(result), here: true })}
                onChange={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              />
            )}
            <HowIDecided steps={steps} ranked={ranked} />
          </div>
        ) : (
          <div className="animate-fade-up space-y-6">
            <EmptyState kind={kind} result={result} onRetry={retry} />
            {steps.length > 0 && <HowIDecided steps={steps} ranked={ranked} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Now" written with the same clock offset the result's own timestamps use. */
function localNow(result: TripResult): string {
  const ref = result.audit_trail[0]?.timestamp ?? new Date().toISOString();
  return shiftKeepingOffset(ref, Date.now() - Date.parse(ref));
}
