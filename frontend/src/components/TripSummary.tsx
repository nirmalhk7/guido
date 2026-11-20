import { useState } from "react";
import { CalendarDays, Car, ChevronDown, MapPin, Users } from "lucide-react";
import type { TripRequest } from "@/lib/contract";
import { copy, fill } from "@/lib/copy";
import { dateTime } from "@/lib/format";
import { carClassText, visibleFields, type FieldSpec } from "@/lib/fields";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardBody } from "@/components/ui/card";

export function TripSummary({ trip }: { trip: TripRequest }) {
  const [open, setOpen] = useState(false);
  const t = copy.trip_summary;
  const ages = trip.drivers.map((d) => d.age);
  const hasYoungDriver = ages.some((a) => a < 25);
  const assumptions = visibleFields(copy.assumptions.fields as FieldSpec[], { trip_request: trip });

  return (
    <Card>
      <CardBody className="space-y-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{t.heading}</h2>
        <ul className="space-y-3 text-[16px]">
          <Fact icon={<CalendarDays aria-hidden />}>
            {dateTime(trip.pickup_datetime)} <span aria-hidden>→</span>
            <span className="sr-only"> to </span> {dateTime(trip.return_datetime)}
          </Fact>
          <Fact icon={<MapPin aria-hidden />}>
            {trip.start_area}
            {trip.airports.length > 0 && <span className="text-muted-foreground"> · {trip.airports.join(", ")}</span>}
          </Fact>
          <Fact icon={<Users aria-hidden />}>
            {fill(t.travelers, { count: trip.travelers })} · {fill(t.drivers, { count: trip.drivers.length, ages: ages.join(", ") })}
            {hasYoungDriver && <span className="block text-[14px] text-muted-foreground">{t.young_driver_note}</span>}
          </Fact>
          <Fact icon={<Car aria-hidden />}>
            {carClassText(trip.car_class)} · {fill(t.max_travel, { minutes: trip.max_travel_minutes_to_branch })}
            <span className="block text-[14px] text-muted-foreground">{trip.one_way_ok ? t.one_way_yes : t.one_way_no}</span>
          </Fact>
        </ul>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-primary">
            {open ? t.assumptions_hide : t.assumptions_toggle}
            <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <h3 className="sr-only">{copy.assumptions.heading}</h3>
            <dl className="mt-2 divide-y rounded-md bg-muted px-4 text-[15px]">
              {assumptions.map((a) => (
                <div key={a.field} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-muted-foreground">{a.label}</dt>
                  <dd className="text-right font-medium">{a.text}</dd>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      </CardBody>
    </Card>
  );
}

function Fact({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <div>{children}</div>
    </li>
  );
}
