import { useId, useState } from "react";
import { Mail, Search } from "lucide-react";
import type { TripRequest } from "@/lib/contract";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/button";

/** "2026-11-25T18:00:00-06:00" → "2026-11-25T18:00" for a date-time field (trip's own clock). */
function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

/** Keep the trip's original UTC offset when turning the field back into ISO. */
function fromLocalInput(value: string, originalIso: string): string {
  const offset = originalIso.match(/([+-]\d{2}:\d{2}|Z)$/)?.[0] ?? "Z";
  return `${value}:00${offset}`;
}

const inputClass =
  "mt-1 block min-h-11 w-full rounded-md border bg-card px-3 text-[17px] focus-visible:outline-3 focus-visible:outline-ring";

/**
 * Two ways to search again: change details here, or reply to the email.
 * Submitting doesn't call the backend yet; the page shows the results as outdated.
 */
export function RetryForm({ trip, onSubmit }: { trip: TripRequest; onSubmit: (t: TripRequest) => void }) {
  const f = copy.retry_form;
  const id = useId();
  const [pickup, setPickup] = useState(toLocalInput(trip.pickup_datetime));
  const [ret, setRet] = useState(toLocalInput(trip.return_datetime));
  const [maxTravel, setMaxTravel] = useState(trip.max_travel_minutes_to_branch);
  const [oneWay, setOneWay] = useState(trip.one_way_ok);
  const [carClass, setCarClass] = useState(trip.car_class);

  return (
    <div className="space-y-6">
      <form
        aria-labelledby={`${id}-h`}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            ...trip,
            pickup_datetime: fromLocalInput(pickup, trip.pickup_datetime),
            return_datetime: fromLocalInput(ret, trip.return_datetime),
            max_travel_minutes_to_branch: maxTravel,
            one_way_ok: oneWay,
            car_class: carClass,
          });
        }}
      >
        <h3 id={`${id}-h`} className="text-[17px] font-semibold">
          {f.heading}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[15px] font-medium">
            {f.pickup}
            <input type="datetime-local" required className={inputClass} value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </label>
          <label className="block text-[15px] font-medium">
            {f.return}
            <input type="datetime-local" required className={inputClass} value={ret} min={pickup} onChange={(e) => setRet(e.target.value)} />
          </label>
          <label className="block text-[15px] font-medium">
            {f.max_travel}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={5}
              className={inputClass}
              value={maxTravel}
              onChange={(e) => setMaxTravel(Number(e.target.value))}
            />
          </label>
          <label className="block text-[15px] font-medium">
            {f.car_size}
            <select className={inputClass} value={carClass} onChange={(e) => setCarClass(e.target.value)}>
              {Object.entries(copy.car_class_labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-[16px]">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} />
          {f.one_way}
        </label>
        <Button type="submit" size="block">
          <Search aria-hidden /> {f.submit}
        </Button>
      </form>

      <div className="rounded-md bg-muted p-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Mail aria-hidden className="size-4" /> {f.email_heading}
        </h3>
        <p className="mt-1 text-[15px]">{f.email_instruction}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{f.email_placeholder}</p>
      </div>
    </div>
  );
}
