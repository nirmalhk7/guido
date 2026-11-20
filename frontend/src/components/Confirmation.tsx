import { CheckCircle2, ExternalLink, Lock, PartyPopper } from "lucide-react";
import type { Confirmation as ConfirmationData, Option, TripResult } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { dateTime, money } from "@/lib/format";
import { cancellationText, visibleFields, type FieldSpec } from "@/lib/fields";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

type Summary = ConfirmationData["confirmation_summary"];

/**
 * The agent's own summary when the person is booking the agent's pick;
 * otherwise built from the option they're looking at now.
 */
export function summaryFor(result: TripResult, option: Option): Summary {
  const c = result.confirmation;
  if (c && result.winner_summary?.recommended_option_id === option.option_id) return c.confirmation_summary;
  const f = copy.confirmation_flow;
  const trip = result.trip_request;
  return {
    what: fill(f.what_line, { car_class: option.car_class, seats: option.seats, brand: option.brand }),
    where:
      option.pickup_branch === option.dropoff_branch
        ? fill(f.where_same, { branch: option.pickup_branch })
        : fill(f.where_different, { pickup: option.pickup_branch, dropoff: option.dropoff_branch }),
    dates: fill(f.dates_line, { pickup: dateTime(option.pickup_time), return: dateTime(option.dropoff_time), days: option.days }),
    total: option.total_trip_cost,
    cancellation_policy: cancellationText(option.cancellation),
    drivers: trip.drivers.map(
      (d, i) => `${fill(f.driver_line, { number: i + 1, age: d.age })}${d.age < 25 ? ` ${f.young_driver_suffix}` : ""}`,
    ),
  };
}

interface Props {
  result: TripResult;
  option: Option;
  approvedAt: string | null;
  disabled?: boolean;
  onApprove: () => void;
  onChange: () => void;
}

/**
 * Review → approve → hand-off. The agent never books or pays and never asks
 * for card details: approval hands off to the rental company's checkout, or to
 * a clearly labelled simulated booking for the demo.
 */
export function Confirmation({ result, option, approvedAt, disabled, onApprove, onChange }: Props) {
  const conf = result.confirmation;
  if (!conf) return null;
  const c = copy.confirmation;
  const f = copy.confirmation_flow;
  const summary = summaryFor(result, option);
  const rows = visibleFields(c.fields as FieldSpec[], { confirmation_summary: summary });
  // The checkout link belongs to the agent's own pick.
  const url = result.winner_summary?.recommended_option_id === option.option_id ? conf.handoff_url : null;
  const simulated = conf.handoff_type === "simulated_booking";

  return (
    <section aria-labelledby="confirm-heading">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 id="confirm-heading" className="text-[20px] font-semibold">
              {c.heading}
            </h2>
            <p className="text-[15px] text-muted-foreground">{f.intro}</p>
          </div>

          <dl className="divide-y text-[15px]">
            {rows.map((r) => (
              <div key={r.field} className={`flex justify-between gap-4 py-2.5 ${r.format === "currency" ? "font-semibold" : ""}`}>
                <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
                <dd className={`text-right ${r.format === "currency" ? "tabular text-[17px]" : ""}`}>
                  {r.format === "list"
                    ? summary.drivers.map((d) => (
                        <span key={d} className="block">
                          {d}
                        </span>
                      ))
                    : r.text}
                </dd>
              </div>
            ))}
          </dl>

          {approvedAt ? (
            <div className="space-y-3" role="status">
              <p className="flex items-start gap-2 rounded-md bg-success-soft p-3 text-[15px] font-medium text-success">
                <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
                {fill(c.approved_label, { approved_at: dateTime(approvedAt) })}
              </p>
              {simulated ? (
                <p className="flex items-start gap-2 text-[15px]">
                  <PartyPopper aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{copy.handoff_labels.simulated_booking}.</span> {f.simulated_done}
                  </span>
                </p>
              ) : url ? (
                <Button asChild size="block">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {fill(c.checkout_link_label, { brand: option.brand })} <ExternalLink aria-hidden />
                  </a>
                </Button>
              ) : (
                <p className="text-[15px] text-muted-foreground">{fill(f.checkout_missing, { brand: option.brand })}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[15px] text-muted-foreground">{c.not_approved_label}</p>
              <Button size="block" onClick={onApprove} disabled={disabled}>
                {c.approve_button}
              </Button>
              <Button size="block" variant="secondary" onClick={onChange}>
                {c.change_button}
              </Button>
              <p className="text-center text-[13px] text-muted-foreground">
                {f.approve_note} {simulated && `· ${copy.handoff_labels.simulated_booking}`}
              </p>
            </div>
          )}

          <p className="flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
            <Lock aria-hidden className="size-3.5" /> {c.no_card_note}
          </p>
        </CardBody>
      </Card>
    </section>
  );
}

/** The steps the page adds to the timeline when the person approves here. */
export function approvalSteps(result: TripResult, option: Option, at: string) {
  const f = copy.confirmation_flow;
  const summary = summaryFor(result, option);
  const simulated = result.confirmation?.handoff_type === "simulated_booking";
  return [
    {
      key: "approved-here",
      name: f.approved_step_name,
      finding: fill(f.approved_step_finding, { what: summary.what, total: money(summary.total) }),
      timestamp: at,
      state: "done" as const,
      emphasis: true,
    },
    {
      key: "handoff-here",
      name: f.handoff_step_name,
      finding: simulated ? f.handoff_simulated_finding : fill(f.handoff_checkout_finding, { brand: option.brand }),
      timestamp: at,
      state: "done" as const,
      emphasis: true,
    },
  ];
}
