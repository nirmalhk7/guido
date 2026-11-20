import { CalendarSearch, CloudOff, SearchX } from "lucide-react";
import type { TripRequest, TripResult } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { dateTime } from "@/lib/format";
import type { PageKind } from "@/lib/rank";
import { Card, CardBody } from "@/components/ui/card";
import { RetryForm } from "./RetryForm";
import { CoverageLine } from "./Coverage";

type EmptyKind = Exclude<PageKind, "results">;

/**
 * Never a dead end: what was searched, why nothing came up, what could
 * change, and two ways to try again.
 */
export function EmptyState({ kind, result, onRetry }: { kind: EmptyKind; result: TripResult; onRetry: (t: TripRequest) => void }) {
  const e = copy.empty_state_details;
  const trip = result.trip_request;
  const heading = { nothing_fits: copy.empty_states.nothing_fits, no_cars: copy.empty_states.no_cars_found, unreachable: copy.empty_states.nothing_reachable }[kind];
  const Icon = { nothing_fits: SearchX, no_cars: CalendarSearch, unreachable: CloudOff }[kind];
  const why = { nothing_fits: e.nothing_fits_why, no_cars: e.no_cars_why, unreachable: e.nothing_reachable_why }[kind];

  const suggestions =
    kind === "unreachable"
      ? [e.suggestion_try_later, e.suggestion_new_dates]
      : [
          fill(e.suggestion_wider_distance, { minutes: trip.max_travel_minutes_to_branch }),
          ...(trip.one_way_ok ? [] : [e.suggestion_allow_one_way]),
          e.suggestion_different_car,
          e.suggestion_new_dates,
        ];

  return (
    <section aria-labelledby="empty-heading" className="space-y-4">
      <Card>
        <CardBody className="space-y-5">
          <div className="flex gap-3">
            <Icon aria-hidden className="mt-0.5 size-7 shrink-0 text-muted-foreground" />
            <h2 id="empty-heading" className="text-[20px] font-semibold leading-snug">
              {heading}
            </h2>
          </div>

          <Block title={e.searched_heading}>
            <p>{searchedLine(trip)}</p>
          </Block>

          <Block title={e.why_heading}>
            <p>{why}</p>
            {kind === "nothing_fits" && (
              <ul className="mt-2 divide-y rounded-md bg-muted px-4">
                {result.options.map((o) => (
                  <li key={o.option_id} className="py-2.5 text-[15px]">
                    <span className="font-medium">{o.brand}</span>
                    <span className="block text-muted-foreground">{o.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title={e.change_heading}>
            <ul className="list-disc space-y-1 pl-5">
              {suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Block>
        </CardBody>
      </Card>

      {kind !== "nothing_fits" && <CoverageLine result={result} />}

      <Card>
        <CardBody>
          <RetryForm trip={trip} onSubmit={onRetry} />
        </CardBody>
      </Card>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="text-[16px]">
      <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function searchedLine(trip: TripRequest): string {
  return fill(copy.empty_state_details.searched_line, {
    travelers: trip.travelers,
    pickup: dateTime(trip.pickup_datetime),
    return: dateTime(trip.return_datetime),
    minutes: trip.max_travel_minutes_to_branch,
    airports: trip.airports.length ? trip.airports.join(", ") : trip.start_area,
  });
}
