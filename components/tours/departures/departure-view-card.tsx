"use client";

/**
 * The departure card of a read-only viewer (a sales agent, role tours_agent):
 * the same side sheet as the staff card, with the four tabs an agent sells
 * from - general, prices, promotions, flights - and nothing to edit.
 *
 * It is a component of its own on purpose. The staff card is built from
 * editors; this one only prints DepartureViewData, a shape that has no field
 * for cost, PNR, docket, notes or block status (types.ts), so there is nothing
 * here to hide. The agents portal of the next phase can mount it as is.
 */
import { useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { Chip, Ltr, Notice, Section } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { afterUrlWrite } from "@/hooks/use-view-state";
import { cn } from "@/lib/utils";
import { currencySymbol, fmtDate, fmtDateRange, fmtDateTime, fmtInstant, fmtMoney, nightsBetween } from "@/lib/tours/format";
import { cardPrice, pricedRooms, toPriceMatrix } from "@/lib/tours/pricing";
import { ROUTE_TYPE_LABELS, departureRouteLabel, flightRouteLabel, routeType } from "@/lib/tours/routes";
import { FLIGHT_MODE_LABELS, PRICE_MATRIX_ROWS, PROMOTION_KIND_LABELS, type FlightMode, type PromotionKind } from "@/types/tours.types";
import { getDepartureView } from "@/lib/actions/tours-departure-actions";
import type { CardTab } from "./board-row";
import type { CardTarget } from "./departure-card";
import { activeFixedDiscount, isExpired, periodLabel, periodsOverlapping, promotionSummary } from "./departure-utils";
import { LEGS_LABELS, type BoardPeriod, type DepartureViewData, type ViewFlight } from "./types";
import { SaleStatusBadge } from "./ui-bits";

/** The tabs a viewer has. The staff card's "sales" tab (who sold what, docket numbers) is not among them. */
export const VIEW_TABS: readonly CardTab[] = ["general", "prices", "promotions", "flights"];

/** A label with its value, for a grid of facts. An empty value prints a dash. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children == null || children === "" || children === false;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-sm", empty && "text-muted-foreground")}>{empty ? "—" : children}</dd>
    </div>
  );
}

const yesNo = (value: boolean): string => (value ? "Included" : "Not included");

function Money({ value, currency, className }: { value: number | null | undefined; currency: string; className?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <Ltr className={cn("tabular-nums", className)}>
      {fmtMoney(value)}
      {currencySymbol(currency)}
    </Ltr>
  );
}

// ---------------------------------------------------------------- tabs
function GeneralTab({ data }: { data: DepartureViewData }) {
  const d = data.departure;
  const type = routeType(d.arrival_airport, d.return_airport);
  const flightMode = FLIGHT_MODE_LABELS[d.flight_mode as FlightMode] ?? d.flight_mode;
  return (
    <div className="space-y-4 py-4">
      <Section title="Dates and route">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Fact label="Departure date">
            <Ltr className="tabular-nums">{fmtDate(d.start_date)}</Ltr>
          </Fact>
          <Fact label="Return date">
            <Ltr className="tabular-nums">{fmtDate(d.end_date)}</Ltr>
          </Fact>
          <Fact label="Lands in">{d.arrival_airport && <Ltr className="font-mono">{d.arrival_airport}</Ltr>}</Fact>
          <Fact label="Returns from">{d.return_airport && <Ltr className="font-mono">{d.return_airport}</Ltr>}</Fact>
          <Fact label="Nights">{nightsBetween(d.start_date, d.end_date)}</Fact>
          <Fact label="Route type">{type && ROUTE_TYPE_LABELS[type]}</Fact>
          <Fact label="Season">{d.season}</Fact>
          <Fact label="Itinerary version">
            {data.itinerary
              ? `${data.itinerary.label ?? "Alternative version"}${
                  data.itinerary.arrival_city || data.itinerary.return_city
                    ? ` (\u2068${data.itinerary.arrival_city ?? "?"}\u2069 → \u2068${data.itinerary.return_city ?? "?"}\u2069)`
                    : ""
                }`
              : "The tour page's main itinerary"}
          </Fact>
        </dl>
      </Section>

      <Section title="Flight and meeting">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Flight">
            {flightMode}
            {d.flight_mode === "priced" && (
              <>
                {" · "}
                <Money value={d.flight_price} currency={d.currency} /> per traveler
              </>
            )}
          </Fact>
          <Fact label="Meeting time (Israel time)">
            {d.meeting_at && <Ltr className="tabular-nums">{fmtInstant(d.meeting_at)}</Ltr>}
          </Fact>
          <Fact label="Baggage">{yesNo(d.baggage_included)}</Fact>
          <Fact label="In-flight meal">{yesNo(d.meal_included)}</Fact>
          <Fact label="Transfers">{yesNo(d.transfers_included)}</Fact>
          <Fact label="Outbound connection">{d.connection_out}</Fact>
          <Fact label="Return connection">{d.connection_back}</Fact>
        </dl>
      </Section>

      <Section title="Age rules">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Fact label="Child up to age">{d.child_max_age}</Fact>
          <Fact label="Senior from age">{d.senior_min_age}</Fact>
          <Fact label="Senior discount">{d.senior_discount != null && <Money value={d.senior_discount} currency={d.currency} />}</Fact>
        </dl>
      </Section>

      <Section title="Tags on the site">
        {d.card_badge || d.date_labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {d.card_badge && <Chip className="border-destructive/30 bg-destructive/10 text-destructive">{d.card_badge}</Chip>}
            {d.date_labels.map((l) => (
              <Chip key={l}>{l}</Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This departure has no tags.</p>
        )}
      </Section>
    </div>
  );
}

function PricesTab({ data }: { data: DepartureViewData }) {
  const d = data.departure;
  const matrix = useMemo(() => toPriceMatrix(data.prices), [data.prices]);
  const discount = activeFixedDiscount(data.promotions);
  const rooms = pricedRooms(matrix, discount);
  const card = cardPrice(matrix, discount);
  const vacation = data.hotels.length > 0 || data.tickets.length > 0;
  const th = "px-3 py-1.5 text-start font-semibold";

  return (
    <div className="space-y-5 py-4">
      {discount > 0 && (
        <Notice tone="success" className="py-1.5 text-xs">
          Active fixed discount: <Money value={discount} currency={d.currency} /> per traveler. Prices after the discount are shown next to the full price.
        </Notice>
      )}

      {vacation && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Vacation package: price per person by hotel and room type</h3>
          {data.hotels.length === 0 ? (
            <Notice tone="warning">This departure has no hotel.</Notice>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm" data-testid="view-hotels">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className={th}>Hotel</th>
                    <th className={th}>Board</th>
                    <th className={th}>Nights</th>
                    <th className={cn(th, "text-end")}>Double</th>
                    <th className={cn(th, "text-end")}>Triple</th>
                    <th className={cn(th, "text-end")}>Quad</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hotels.map((h, i) => (
                    <tr key={`${h.name}-${i}`} className="border-t">
                      <td className="px-3 py-1.5">
                        {h.name}
                        {h.city && <span className="ms-2 text-xs text-muted-foreground">{h.city}</span>}
                        {i === 0 && data.hotels.length > 1 && <Chip className="ms-2">Default</Chip>}
                      </td>
                      <td className="px-3 py-1.5">{h.board ?? ""}</td>
                      <td className="px-3 py-1.5 tabular-nums">{h.nights ?? ""}</td>
                      <td className="px-3 py-1.5 text-end">
                        <Money value={h.perPerson.double} currency={d.currency} className="font-medium" />
                      </td>
                      <td className="px-3 py-1.5 text-end">
                        <Money value={h.perPerson.triple} currency={d.currency} />
                      </td>
                      <td className="px-3 py-1.5 text-end">
                        <Money value={h.perPerson.quad} currency={d.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The price per person includes the hotel and the first ticket category
            {d.flight_mode === "priced" ? ", plus the flight" : d.flight_mode === "included" ? ", and the flight is included" : ""}. Another ticket category
            adds its difference.
          </p>
          {data.tickets.length > 0 && (
            <div className="overflow-hidden rounded-md border" data-testid="view-tickets">
              {data.tickets.map((t, i) => (
                <div key={`${t.label}-${i}`} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-sm last:border-b-0">
                  <span>{t.label ?? `Category ${i + 1}`}</span>
                  <span className="text-xs text-muted-foreground">
                    {i === 0 || !t.extra ? (
                      "Included in the price"
                    ) : (
                      <>
                        <Ltr className="text-sm font-medium tabular-nums text-foreground">
                          {t.extra > 0 ? "+" : "-"}
                          {fmtMoney(Math.abs(t.extra))}
                          {currencySymbol(d.currency)}
                        </Ltr>{" "}
                        per person
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {data.prices.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold">Price per person by room composition</h3>
            <div className="overflow-hidden rounded-md border" data-testid="view-matrix">
              {PRICE_MATRIX_ROWS.map((row) => {
                const price = matrix[`${row.paxType}:${row.position}`];
                return (
                  <div key={row.sheetKey} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-sm last:border-b-0">
                    <span>{row.label}</span>
                    <Money value={price} currency={d.currency} className="font-medium" />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">A row with no price = that composition isn&apos;t offered on this departure.</p>
          </section>

          <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold">Price per room, as the customer sees it</h3>
            {rooms.length === 0 ? (
              <Notice tone="warning">This departure has no double-room price.</Notice>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm" data-testid="view-rooms">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className={th}>Composition</th>
                      <th className={cn(th, "text-center")}>Travelers</th>
                      <th className={cn(th, "text-end")}>Room price</th>
                      {discount > 0 && <th className={cn(th, "text-end")}>After discount</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr key={r.key} className="border-t">
                        <td className="px-3 py-1.5">
                          {r.title}
                          <span className="ms-2 text-xs text-muted-foreground">{r.summaryLabel}</span>
                        </td>
                        <td className="px-3 py-1.5 text-center tabular-nums">{r.passengers}</td>
                        <td className={cn("px-3 py-1.5 text-end", discount > 0 && "text-muted-foreground line-through decoration-1")}>
                          <Money value={r.price} currency={d.currency} />
                        </td>
                        {discount > 0 && (
                          <td className="px-3 py-1.5 text-end">
                            <Money value={r.priceSale} currency={d.currency} className="font-semibold text-success" />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {card.offer != null && (
              <p className="text-xs text-muted-foreground">
                On the site&apos;s date card: from{" "}
                <Money value={card.offer} currency={d.currency} className="font-semibold text-foreground" /> per person in a double room
                {card.regular != null && (
                  <>
                    {" "}
                    instead of <Money value={card.regular} currency={d.currency} className="line-through" />
                  </>
                )}
                .
              </p>
            )}
          </section>
        </div>
      )}

      {!vacation && data.prices.length === 0 && <Notice tone="warning">No prices entered for this departure yet.</Notice>}
    </div>
  );
}

function PromotionsTab({ data }: { data: DepartureViewData }) {
  const d = data.departure;
  if (data.promotions.length === 0) {
    return <p className="my-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">This departure has no active promotions.</p>;
  }
  return (
    <div className="space-y-3 py-4">
      <p className="text-xs text-muted-foreground">Active promotions apply automatically to every booking on this departure.</p>
      <ul className="space-y-2">
        {data.promotions.map((p) => (
          <li key={p.id} data-promotion-kind={p.kind} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{promotionSummary(p, d.currency)}</p>
              <p className="text-xs text-muted-foreground">
                {PROMOTION_KIND_LABELS[p.kind as PromotionKind] ?? p.kind}
                {p.valid_until ? ` · valid until ${fmtDate(p.valid_until)}` : " · no expiry date"}
                {p.show_on_card ? " · shown on the site card" : ""}
              </p>
            </div>
            {isExpired(p.valid_until) && (
              <Chip className="border-warning/40 bg-warning-muted text-warning" title="The promotion is still live on the site. Check with the office before promising it to a customer.">
                Expiry date passed
              </Chip>
            )}
            {p.scope === "series" && <Chip className="border-info/30 bg-info-muted text-info">Whole series</Chip>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlightLeg({ title, number, from, to, departs, arrives }: { title: string; number: string; from: string; to: string; departs: string; arrives: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
      <span className="w-10 text-xs font-medium text-muted-foreground">{title}</span>
      <Ltr className="font-mono font-semibold">{number}</Ltr>
      <Ltr className="font-mono text-xs">
        {from}→{to}
      </Ltr>
      <span className="text-xs text-muted-foreground">
        Departs <Ltr className="tabular-nums text-foreground">{fmtDateTime(departs)}</Ltr>
        {" · "}
        Arrives <Ltr className="tabular-nums text-foreground">{fmtDateTime(arrives)}</Ltr>
      </span>
    </div>
  );
}

function FlightItem({ flight }: { flight: ViewFlight }) {
  const airlines = [flight.airline_code, flight.inbound_airline_code].filter((c, i, all): c is string => Boolean(c) && all.indexOf(c) === i);
  return (
    <li className="space-y-1.5 rounded-md border px-3 py-2" data-view-flight={flight.outbound_flight_number}>
      <div className="flex flex-wrap items-center gap-2">
        <Ltr className="font-mono text-sm font-semibold">{flightRouteLabel(flight)}</Ltr>
        <span className="text-sm">
          {flight.airline_name ?? ""} <Ltr className="font-mono text-xs text-muted-foreground">{airlines.join("+")}</Ltr>
        </span>
        {flight.legs !== "both" && <Chip>{LEGS_LABELS[flight.legs]}</Chip>}
      </div>
      {flight.legs !== "inbound" && (
        <FlightLeg
          title="Out"
          number={flight.outbound_flight_number}
          from={flight.outbound_departure_airport}
          to={flight.outbound_arrival_airport}
          departs={flight.outbound_departure_time}
          arrives={flight.outbound_arrival_time}
        />
      )}
      {flight.legs !== "outbound" && (
        <FlightLeg
          title="Back"
          number={flight.inbound_flight_number}
          from={flight.inbound_departure_airport}
          to={flight.inbound_arrival_airport}
          departs={flight.inbound_departure_time}
          arrives={flight.inbound_arrival_time}
        />
      )}
    </li>
  );
}

function FlightsTab({ data }: { data: DepartureViewData }) {
  return (
    <div className="space-y-4 py-4">
      <dl className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 px-3 py-2" data-testid="view-seats">
        <Fact label="Allocated">
          <Ltr className="tabular-nums">{data.seats.allocated}</Ltr>
        </Fact>
        <Fact label="Sold">
          <Ltr className="tabular-nums">{data.seats.sold}</Ltr>
        </Fact>
        <Fact label="Left">
          <Ltr className={cn("font-semibold tabular-nums", data.seats.remaining <= 0 && data.seats.allocated > 0 && "text-destructive")}>
            {data.seats.remaining}
          </Ltr>
        </Fact>
      </dl>
      {data.flights.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Flight details to follow. This departure has no confirmed flight yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.flights.map((f, i) => (
            <FlightItem key={`${f.outbound_flight_number}-${f.inbound_flight_number}-${i}`} flight={f} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Schedule of confirmed flights only. Times are local airport times.</p>
    </div>
  );
}

// ---------------------------------------------------------------- card
export function DepartureViewCard({
  target,
  tab,
  onTabChange,
  periods,
  onClose,
}: {
  target: CardTarget | null;
  tab: CardTab;
  onTabChange: (tab: CardTab) => void;
  periods: BoardPeriod[];
  onClose: () => void;
}) {
  const [data, setData] = useState<DepartureViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const targetId = target?.id;
  const targetCode = target?.code;
  const shownTab: CardTab = VIEW_TABS.includes(tab) ? tab : "general";

  useEffect(() => {
    if (!targetId && !targetCode) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      // Opening the card writes `?code=` first; let the router settle before queueing the action.
      await afterUrlWrite();
      const result = await getDepartureView({ id: targetId, code: targetCode });
      if (cancelled) return;
      if (result.success) {
        setData(result.data);
        setError(null);
      } else {
        setData(null);
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId, targetCode]);

  const d = data?.departure;
  const holidays = useMemo(() => (d ? periodsOverlapping(periods, d.start_date, d.end_date) : []), [d, periods]);
  const type = d ? routeType(d.arrival_airport, d.return_airport) : null;
  const routeLabel = d ? departureRouteLabel(d.arrival_airport, d.return_airport) : "";
  /** The fixed per-passenger discount that is on - the same one the board row and the site apply. */
  const discount = data ? activeFixedDiscount(data.promotions) : 0;

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" data-testid="departure-view-card">
        {loading && !data ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">Loading departure</SheetTitle>
            <SheetDescription className="sr-only">The departure details are loading</SheetDescription>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error || !data || !d ? (
          <div className="space-y-4 p-6">
            <SheetTitle>Couldn&apos;t load the departure</SheetTitle>
            <SheetDescription className="sr-only">Error loading the departure details</SheetDescription>
            <Notice tone="error">{error ?? "Departure not found"}</Notice>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2 border-b pb-4 pe-12 ps-6 pt-5 text-start sm:text-start">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SheetTitle className="font-display text-xl">
                  <Ltr className="font-mono">{d.code}</Ltr>
                </SheetTitle>
                <Ltr className="text-sm tabular-nums text-muted-foreground">{fmtDateRange(d.start_date, d.end_date)}</Ltr>
                <span className="text-sm text-muted-foreground">{nightsBetween(d.start_date, d.end_date)} nights</span>
                {routeLabel && <Ltr className="font-mono text-sm">{routeLabel}</Ltr>}
                {type && type !== "round_trip" && <Chip className="border-info/30 bg-info-muted text-info">{ROUTE_TYPE_LABELS[type]}</Chip>}
              </div>
              <SheetDescription>
                {data.package?.name ?? ""}
                {data.series && (
                  <>
                    {" · Series "}
                    <Ltr className="font-mono">{data.series.code}</Ltr>
                    {data.series.label ? ` (${data.series.label})` : ""}
                  </>
                )}
                {" · Season "}
                {d.season_year}
              </SheetDescription>
              {holidays.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {holidays.map((h) => (
                    <Chip key={h.id} className="border-warning/40 bg-warning-muted text-warning">
                      {periodLabel(h)}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm">
                <SaleStatusBadge status={d.sale_status} />
                {data.doublePrice.price != null && (
                  <span>
                    From{" "}
                    <Money value={data.doublePrice.price - discount} currency={d.currency} className="font-semibold" /> per person in a double room
                    {discount > 0 && (
                      <>
                        {" "}
                        <Money value={data.doublePrice.price} currency={d.currency} className="text-muted-foreground line-through decoration-1" />
                      </>
                    )}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {data.seats.allocated > 0 ? (
                    <>
                      <Ltr className="font-semibold tabular-nums text-foreground">{data.seats.remaining}</Ltr> of{" "}
                      <Ltr className="tabular-nums">{data.seats.allocated}</Ltr> seats left
                    </>
                  ) : (
                    "Seat count to follow"
                  )}
                </span>
                <Chip className="ms-auto gap-1" title="This account can't edit">
                  <Eye className="h-3 w-3" />
                  View only
                </Chip>
              </div>
            </SheetHeader>

            <Tabs value={shownTab} onValueChange={(v) => onTabChange(v as CardTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-6 mt-3 grid h-9 grid-cols-4">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="prices">Prices</TabsTrigger>
                <TabsTrigger value="promotions">Promotions{data.promotions.length ? ` (${data.promotions.length})` : ""}</TabsTrigger>
                <TabsTrigger value="flights">Flights{data.flights.length ? ` (${data.flights.length})` : ""}</TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-2">
                <TabsContent value="general">
                  <GeneralTab data={data} />
                </TabsContent>
                <TabsContent value="prices">
                  <PricesTab data={data} />
                </TabsContent>
                <TabsContent value="promotions">
                  <PromotionsTab data={data} />
                </TabsContent>
                <TabsContent value="flights">
                  <FlightsTab data={data} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
