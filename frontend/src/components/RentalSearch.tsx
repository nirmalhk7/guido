import { useState, type FormEvent, type ReactNode } from "react";
import type { Comparison } from "../../../lib/rental/search";
import sampleTrip from "../../../examples/rental-trip.json";
import { Banner } from "@/components/Banner";
import { Logo } from "@/components/Logo";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { dateTime, money } from "@/lib/format";

const field = "min-h-11 w-full rounded-md border bg-card px-3 py-2 text-[16px] text-foreground";
const disclosure = "cursor-pointer font-medium text-primary";
const chargeLabels = {
  base: "Base rental", taxes: "Taxes", airport: "Airport fees", oneWay: "One-way fee",
  youngDriver: "Young driver fee", additionalDriver: "Additional driver fee", otherMandatory: "Other mandatory charges",
};
const coverageLabels = {
  complete: "Quotes returned", partial: "Partial coverage", unavailable: "Unavailable",
  no_cars: "No cars for checked combinations", no_matching_branches: "No matching branches",
};
const attemptLabels = {
  complete: "Complete", partial: "Partial", unavailable: "Unavailable", no_cars: "No cars", untried: "Untried",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-[14px] font-medium"><span>{label}</span>{children}</label>;
}

function dateWithOffset(date: string, offset: string) {
  return date.length === 16 ? `${date}:00${offset}` : `${date}${offset}`;
}

export function RentalSearch() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: Comparison; route: string } | null>(null);

  async function search(trip: typeof sampleTrip | Record<string, unknown>, environment: "live" | "fixture", route: string) {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/rental-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip, environment }),
      });
      const body = await response.json();
      if (!response.ok) {
        const issue = body.issues?.[0];
        setError(issue ? `${body.error} ${issue.message}` : body.error ?? "The search is unavailable.");
      } else {
        setResult({ data: body, route });
      }
    } catch {
      setError("The rental search could not reach Guido’s server.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const inputs = new FormData(event.currentTarget);
    const get = (name: string) => String(inputs.get(name) ?? "").trim();
    const origin = get("origin");
    const destination = get("destination");
    const latitude = get("latitude");
    const longitude = get("longitude");
    const maxTotal = get("budget");
    const minSeats = get("minSeats");
    if (Boolean(latitude) !== Boolean(longitude)) {
      setError("Enter both latitude and longitude to compare distance from your pickup origin.");
      return;
    }
    const trip = {
      origin: {
        area: origin,
        coordinates: latitude && longitude ? { latitude: Number(latitude), longitude: Number(longitude) } : undefined,
      },
      destination: destination ? { area: destination } : undefined,
      pickupAt: dateWithOffset(get("pickup"), get("pickupOffset")),
      returnAt: dateWithOffset(get("return"), get("returnOffset")),
      preferences: {
        priority: get("priority"),
        oneWay: inputs.has("oneWay"),
        carClass: get("carClass") || undefined,
        minSeats: minSeats ? Number(minSeats) : undefined,
        driverAge: Number(get("age")),
        drivers: Number(get("drivers")),
        pickupKind: get("pickupKind") || undefined,
        returnKind: get("returnKind") || undefined,
        maxTotalCents: maxTotal ? Math.round(Number(maxTotal) * 100) : undefined,
      },
    };
    void search(trip, "live", `${origin} → ${destination || origin}`);
  }

  return (
    <main className="mx-auto max-w-[900px] space-y-6 px-4 pb-16 pt-6 sm:px-8 sm:pt-10">
      <header className="flex items-center justify-between gap-4">
        <Logo />
        <a className="text-[14px] text-primary hover:underline" href="/?demo">Audit-trail demo</a>
      </header>
      <section aria-labelledby="search-title" className="space-y-3">
        <h1 id="search-title" className="text-[32px] font-bold leading-tight tracking-tight sm:text-[42px]">Compare rental car branches</h1>
        <p className="max-w-[60ch] text-muted-foreground">Compare airport and neighborhood pickup and return options by rental cost and travel to each branch.</p>
      </section>
      <Card>
        <CardBody>
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pickup city or area"><input className={field} name="origin" required maxLength={160} placeholder="City or area" /></Field>
              <Field label="Return city or area"><input className={field} name="destination" maxLength={160} placeholder="Same as pickup if blank" /></Field>
              {(["pickup", "return"] as const).map((leg) => (
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2" key={leg}>
                  <Field label={leg === "pickup" ? "Pickup date and time" : "Return date and time"}>
                    <input className={field} name={leg} type="datetime-local" required />
                  </Field>
                  <Field label="UTC offset">
                    <input className={field} name={`${leg}Offset`} required defaultValue="Z" pattern="Z|[+\-][0-9]{2}:[0-9]{2}"
                      title="Enter Z for UTC or an offset such as -06:00 for this branch’s local time." />
                  </Field>
                </div>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rank by">
                <select className={field} name="priority">
                  <option value="total_cost">Lowest estimated trip cost</option>
                  <option value="pickup_access">Shortest pickup access</option>
                  <option value="return_access">Shortest return access</option>
                </select>
              </Field>
              <label className="flex min-h-11 items-center gap-2 self-end text-[15px]"><input type="checkbox" name="oneWay" defaultChecked /> Allow return to a different branch</label>
            </div>
            <details className="border-t pt-3 text-[15px]">
              <summary className={disclosure}>Vehicle and branch preferences</summary>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Car class"><input name="carClass" className={field} placeholder="Any" pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}" /></Field>
                <Field label="Driver age"><input name="age" className={field} type="number" min={16} max={110} defaultValue={30} required /></Field>
                <Field label="Drivers"><input name="drivers" className={field} type="number" min={1} max={10} defaultValue={1} required /></Field>
                <Field label="Minimum seats"><input name="minSeats" className={field} type="number" min={1} max={20} placeholder="Any" /></Field>
                {(["pickup", "return"] as const).map((leg) => (
                  <Field key={leg} label={leg === "pickup" ? "Pickup branch type" : "Return branch type"}>
                    <select className={field} name={`${leg}Kind`}>
                      <option value="">Any</option><option value="airport">Airport</option><option value="non_airport">Neighborhood</option>
                    </select>
                  </Field>
                ))}
                <Field label="Budget (USD)"><input name="budget" className={field} type="number" min={0} max={1000000} step="0.01" placeholder="Any" /></Field>
                <Field label="Pickup origin latitude"><input name="latitude" className={field} type="number" min={-90} max={90} step="any" placeholder="Optional" /></Field>
                <Field label="Pickup origin longitude"><input name="longitude" className={field} type="number" min={-180} max={180} step="any" placeholder="Optional" /></Field>
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">Guido uses coordinates to measure straight-line distance. Suppliers receive the city or area and rental details.</p>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>Search rental branches</Button>
              <Button type="button" variant="secondary" disabled={pending}
                onClick={() => void search(sampleTrip, "fixture", "San Mateo, Belmont and SFO")}>Try sample trip</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {pending ? <Banner>Checking branch combinations…</Banner> : null}
      {error ? <Banner tone="warning">{error}</Banner> : null}
      {result ? <SearchResults result={result.data} route={result.route} /> : null}
    </main>
  );
}

function SearchResults({ result, route }: { result: Comparison; route: string }) {
  const [limit, setLimit] = useState(12);
  const partial = result.coverage.some(({ status }) => status === "partial" || status === "unavailable");
  const available = result.options.length > 0;
  return (
    <section className="space-y-4" aria-labelledby="results-title">
      <div>
        <h2 id="results-title" className="text-[24px] font-bold tracking-tight">{route}</h2>
        <p className="text-[14px] text-muted-foreground">
          <time dateTime={result.request.pickupAt}>{dateTime(result.request.pickupAt)}</time>
          {" → "}<time dateTime={result.request.returnAt}>{dateTime(result.request.returnAt)}</time>
        </p>
      </div>
      {result.environment === "fixture" ? <Banner tone="sample">Synthetic quotes and branch details for an offline comparison.</Banner> : null}
      {partial ? <Banner tone="warning">Some combinations or suppliers could not be fully checked. Review coverage below.</Banner> : null}
      {!result.recommendation && available ? <Banner tone="warning">No offer had enough information to meet the selected preferences and rank.</Banner> : null}
      {result.coverage.length > 0 && !available && result.coverage.every(({ status }) => status === "no_cars")
        ? <Banner>Suppliers reported no cars for the checked combinations.</Banner> : null}
      {available ? <p className="text-[14px] text-muted-foreground">{result.rankingRule}</p> : null}
      {result.options.slice(0, limit).map((option) => <OfferCard key={option.id} option={option} currency={result.currency} />)}
      {limit < result.options.length ? (
        <Button variant="secondary" onClick={() => setLimit(limit + 12)}>Show more offers ({result.options.length - limit} remaining)</Button>
      ) : null}
      <Card>
        <CardBody className="space-y-3">
          <h3 className="font-semibold">Supplier coverage</h3>
          {result.coverage.map((entry) => (
            <details key={entry.supplierId} className="text-[15px]">
              <summary className={disclosure}>{entry.supplier} · {coverageLabels[entry.status]}
                {" · "}{entry.pairsChecked}/{entry.pairsPlanned + entry.omitted.pairs} combinations checked</summary>
              {entry.omitted.pairs > 0 ? (
                <p className="mt-2 text-[14px]">{entry.omitted.pairs} pairs were untried because of the branch limit.
                  {entry.omitted.pickups.length ? ` Omitted pickups: ${entry.omitted.pickups.map(({ name }) => name).join(", ")}.` : ""}
                  {entry.omitted.returns.length ? ` Omitted returns: ${entry.omitted.returns.map(({ name }) => name).join(", ")}.` : ""}
                </p>
              ) : null}
              <ul className="mt-2 space-y-1 text-[14px]">
                {entry.pairs.map((pair) => (
                  <li key={`${pair.pickup.id}/${pair.return.id}`}>{pair.pickup.name} → {pair.return.name} · {attemptLabels[pair.status]}</li>
                ))}
              </ul>
            </details>
          ))}
          <details className="text-[14px]">
            <summary className={disclosure}>Search audit</summary>
            <p className="mt-2 text-muted-foreground">{result.branchSelection}</p>
            <ul className="mt-2 space-y-1">
              {result.attempts.map((entry, index) => (
                <li key={index}>
                  {entry.source} · {entry.operation === "quote" ? `${entry.pickupId} → ${entry.returnId}` : `${entry.operation} branches`}
                  {" · "}{attemptLabels[entry.outcome]}{entry.reason ? ` · ${entry.reason}` : ""}
                  {" · "}<time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time>
                </li>
              ))}
            </ul>
          </details>
        </CardBody>
      </Card>
    </section>
  );
}

type Option = Comparison["options"][number];

function AccessLeg({ branch, leg, currency }: { branch: Option["pickup"]; leg: "pickup" | "return"; currency: string }) {
  const { access } = branch;
  const basis = { user_estimate: "User estimate", area_center: "Area-center estimate", unknown: "Travel estimate unavailable" }[access.basis];
  return (
    <div>
      <h4 className="text-[13px] font-medium text-muted-foreground">{leg === "pickup" ? "Pickup" : "Return"} · {branch.kind === "airport" ? "Airport" : "Neighborhood"}</h4>
      <p className="font-medium">{branch.name}</p>
      {branch.address ? <p className="text-[14px] text-muted-foreground">{branch.address}</p> : null}
      <p className="mt-1 text-[14px]">{access.minutes === null ? "Travel time unknown" : `${access.minutes} min`}
        {" · "}{access.costCents === null ? "Access cost unknown" : money(access.costCents, currency)}</p>
      <p className="text-[13px] text-muted-foreground">{basis}{access.straightLineKm === null ? "" : ` · ${access.straightLineKm} km straight line`}</p>
      {access.note ? <p className="text-[13px] text-muted-foreground">{access.note}</p> : null}
      {leg === "pickup" && branch.pickupNote ? <p className="text-[13px] text-muted-foreground">{branch.pickupNote}</p> : null}
      {leg === "return" && branch.returnNote ? <p className="text-[13px] text-muted-foreground">{branch.returnNote}</p> : null}
    </div>
  );
}

function OfferCard({ option, currency }: { option: Option; currency: string }) {
  const { offer, source } = option;
  const heading = option.rank === 1 ? "Recommended among checked offers" : option.rank ? `Rank ${option.rank}`
    : option.status === "provisional" ? "Incomplete estimate" : "Outside preferences";
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium text-primary-strong">{heading}</p>
            <h3 className="font-semibold">{option.supplier} · {offer.vehicle}</h3>
          </div>
          <div className="tabular">
            <p className="text-[19px] font-semibold">{option.estimatedTotalCents === null ? "Total unknown" : money(option.estimatedTotalCents, offer.currency)}</p>
            <p className="text-[13px] text-muted-foreground">Rental and branch access</p>
          </div>
        </div>
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
          <AccessLeg branch={option.pickup} leg="pickup" currency={currency} />
          <AccessLeg branch={option.return} leg="return" currency={currency} />
        </div>
        {option.reasons.length ? <p className="text-[14px] text-muted-foreground">{option.reasons.join(" ")}</p> : null}
        <details className="text-[14px]">
          <summary className={disclosure}>Price and quote details</summary>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {Object.entries(chargeLabels).map(([key, label]) => {
              const charge = option.charges[key as keyof typeof chargeLabels];
              return <div key={key} className="contents"><dt>{label}</dt>
                <dd className="tabular text-right">{typeof charge === "number" ? money(charge, offer.currency) : charge === "included" ? "Included" : "Unknown"}</dd></div>;
            })}
            <dt className="font-medium">{option.rentalTotalCents === null ? "Known rental subtotal" : "Rental total"}</dt>
            <dd className="tabular text-right">{option.knownRentalCents === null ? "Unknown" : money(option.knownRentalCents, offer.currency)}</dd>
          </dl>
          <p className="mt-2">{offer.cancellation ?? "Cancellation terms unknown."}</p>
          <p className="mt-1 text-muted-foreground">{source.url
            ? <a className="text-primary underline" href={source.url} target="_blank" rel="noreferrer">{source.id}</a> : source.id}
            {offer.quotedAt ? <>{" · "}<time dateTime={offer.quotedAt}>Quoted {new Date(offer.quotedAt).toLocaleString()}</time></> : null}
            {" · "}<time dateTime={source.observedAt}>Observed {new Date(source.observedAt).toLocaleString()}</time></p>
        </details>
      </CardBody>
    </Card>
  );
}
