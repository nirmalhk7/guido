import { BadgeCheck, MapPin, Route, ShieldCheck } from "lucide-react";
import type { Option } from "@/lib/contract";
import { copy, fill, labelFor } from "@/lib/copy";
import { money } from "@/lib/format";
import { cancellationText } from "@/lib/fields";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { PriceBreakdown } from "./PriceBreakdown";
import { SourceLine } from "./SourceLine";
import { cn } from "@/lib/utils";

interface Props {
  option: Option;
  variant: "recommended" | "alternative";
  /** The "why" line under the price (recommended card). */
  why?: string;
  /** e.g. "Saves $67.35 compared with…" or "$1.96 more than the recommended car". */
  comparison?: { text: string; tone: "good" | "neutral" };
  now: number;
}

/**
 * One option, following the Ranking reference: the total is the big number,
 * a plain-word label marks the pick, the "why" sits right under it.
 */
export function OptionCard({ option, variant, why, comparison, now }: Props) {
  const isRec = variant === "recommended";
  const tags = (option.tags ?? []).filter((t) => t in copy.tag_labels);

  return (
    <Card className={cn(isRec && "ring-2 ring-primary")}>
      <CardBody className="space-y-4">
        {isRec && (
          <Badge variant="primary" className="text-[14px]">
            <BadgeCheck aria-hidden /> {copy.status_labels.recommended}
          </Badge>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className={cn("font-semibold leading-snug", isRec ? "text-[20px]" : "text-[17px]")}>{option.brand}</h3>
            <p className="text-[15px] text-muted-foreground">
              {fill(copy.option_card.car_line, { car_class: option.car_class, seats: option.seats })}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn("tabular font-semibold tracking-tight", isRec ? "text-[34px] leading-none" : "text-[22px] leading-tight")}>
              {money(option.total_trip_cost)}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{copy.option_card.total_caption}</p>
          </div>
        </div>

        {why && (
          <div>
            <h4 className="sr-only">{copy.option_card.recommended_because_heading}</h4>
            <p className="text-[17px] leading-snug">{why}</p>
          </div>
        )}

        {comparison && (
          <p className={cn("text-[15px] font-medium", comparison.tone === "good" ? "text-success" : "text-muted-foreground")}>
            {comparison.text}
          </p>
        )}

        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={copy.option_card.strengths_label}>
            {tags.map((t) => (
              <li key={t}>
                <Badge variant="soft">{labelFor(copy.tag_labels, t)}</Badge>
              </li>
            ))}
          </ul>
        )}

        <ul className="space-y-1.5 text-[15px]">
          <KeyFact icon={<MapPin aria-hidden />}>{option.pickup_branch}</KeyFact>
          <KeyFact icon={<Route aria-hidden />}>
            {fill(copy.option_card.travel_line, { minutes: option.travel_to_branch.minutes })}
            {option.travel_to_branch.note && <span className="text-muted-foreground"> · {option.travel_to_branch.note}</span>}
          </KeyFact>
          <KeyFact icon={<ShieldCheck aria-hidden />}>{cancellationText(option.cancellation)}</KeyFact>
        </ul>

        <PriceBreakdown option={option} />

        <SourceLine option={option} now={now} />
      </CardBody>
    </Card>
  );
}

function KeyFact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 [&>svg]:mt-[3px] [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <span>{children}</span>
    </li>
  );
}

export function differenceText(option: Option, recommended: Option): string {
  const diff = option.total_trip_cost - recommended.total_trip_cost;
  const a = copy.alternatives;
  if (diff === 0) return a.diff_same;
  return fill(diff > 0 ? a.diff_more : a.diff_less, { amount: money(Math.abs(diff)) });
}

export function statusLabel(status: Option["status"]) {
  return labelFor(copy.status_labels, status);
}
