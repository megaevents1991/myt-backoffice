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
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { cardPrice, pricedRooms, toPriceMatrix } from "@/lib/tours/pricing";
import { ROUTE_TYPE_LABELS, departureRouteLabel, flightRouteLabel, routeType } from "@/lib/tours/routes";
import { FLIGHT_MODE_LABELS, PRICE_MATRIX_ROWS, PROMOTION_KIND_LABELS, type FlightMode, type PromotionKind } from "@/types/tours.types";
import { getDepartureView } from "@/lib/actions/tours-departure-actions";
import type { CardTab } from "./board-row";
import type { CardTarget } from "./departure-card";
import {
  activeFixedDiscount,
  currencySymbol,
  fmtDate,
  fmtDateRange,
  fmtDateTime,
  fmtInstant,
  fmtMoney,
  isExpired,
  nightsBetween,
  periodLabel,
  periodsOverlapping,
  promotionSummary,
} from "./departure-utils";
import { LEGS_LABELS, type BoardPeriod, type DepartureViewData, type ViewFlight } from "./types";
import { Chip, Ltr, Notice, SaleStatusBadge } from "./ui-bits";
import { afterUrlWrite } from "./use-query-state";

/** The tabs a viewer has. The staff card's "sales" tab (who sold what, docket numbers) is not among them. */
export const VIEW_TABS: readonly CardTab[] = ["general", "prices", "promotions", "flights"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b py-4 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

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

const yesNo = (value: boolean): string => (value ? "כלול" : "לא כלול");

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
    <div>
      <Section title="תאריכים ומסלול">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Fact label="תאריך יציאה">
            <Ltr className="tabular-nums">{fmtDate(d.start_date)}</Ltr>
          </Fact>
          <Fact label="תאריך חזרה">
            <Ltr className="tabular-nums">{fmtDate(d.end_date)}</Ltr>
          </Fact>
          <Fact label="נוחתים ב">{d.arrival_airport && <Ltr className="font-mono">{d.arrival_airport}</Ltr>}</Fact>
          <Fact label="חוזרים מ">{d.return_airport && <Ltr className="font-mono">{d.return_airport}</Ltr>}</Fact>
          <Fact label="לילות">{nightsBetween(d.start_date, d.end_date)}</Fact>
          <Fact label="סוג המסלול">{type && ROUTE_TYPE_LABELS[type]}</Fact>
          <Fact label="עונה">{d.season}</Fact>
          <Fact label="גרסת המסלול היומי">
            {data.itinerary
              ? `${data.itinerary.label ?? "גרסה נוספת"}${
                  data.itinerary.arrival_city || data.itinerary.return_city
                    ? ` (${data.itinerary.arrival_city ?? "?"} ← ${data.itinerary.return_city ?? "?"})`
                    : ""
                }`
              : "המסלול הראשי של העמוד"}
          </Fact>
        </dl>
      </Section>

      <Section title="טיסה ומפגש">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="טיסה">
            {flightMode}
            {d.flight_mode === "priced" && (
              <>
                {" · "}
                <Money value={d.flight_price} currency={d.currency} /> לנוסע
              </>
            )}
          </Fact>
          <Fact label="מועד מפגש (שעון ישראל)">
            {d.meeting_at && <Ltr className="tabular-nums">{fmtInstant(d.meeting_at)}</Ltr>}
          </Fact>
          <Fact label="כבודה">{yesNo(d.baggage_included)}</Fact>
          <Fact label="ארוחה בטיסה">{yesNo(d.meal_included)}</Fact>
          <Fact label="העברות">{yesNo(d.transfers_included)}</Fact>
          <Fact label="קונקשן בהלוך">{d.connection_out}</Fact>
          <Fact label="קונקשן בחזור">{d.connection_back}</Fact>
        </dl>
      </Section>

      <Section title="כללי גיל">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
          <Fact label="ילד עד גיל">{d.child_max_age}</Fact>
          <Fact label="ותיק מגיל">{d.senior_min_age}</Fact>
          <Fact label="הנחת ותיק">{d.senior_discount != null && <Money value={d.senior_discount} currency={d.currency} />}</Fact>
        </dl>
      </Section>

      <Section title="תגיות באתר">
        {d.card_badge || d.date_labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {d.card_badge && <Chip className="border-destructive/30 bg-destructive/10 text-destructive">{d.card_badge}</Chip>}
            {d.date_labels.map((l) => (
              <Chip key={l}>{l}</Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">אין תגיות ליציאה הזו.</p>
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
          הנחה קבועה פעילה: <Money value={discount} currency={d.currency} /> לנוסע. המחירים אחרי ההנחה מופיעים לצד המחיר המלא.
        </Notice>
      )}

      {vacation && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">חבילת נופש: מחיר לאדם לפי מלון וסוג חדר</h3>
          {data.hotels.length === 0 ? (
            <Notice tone="warning">אין מלון ביציאה הזו.</Notice>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm" data-testid="view-hotels">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className={th}>מלון</th>
                    <th className={th}>בסיס אירוח</th>
                    <th className={th}>לילות</th>
                    <th className={cn(th, "text-end")}>בחדר זוגי</th>
                    <th className={cn(th, "text-end")}>בטריפל</th>
                    <th className={cn(th, "text-end")}>ברביעייה</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hotels.map((h, i) => (
                    <tr key={`${h.name}-${i}`} className="border-t">
                      <td className="px-3 py-1.5">
                        {h.name}
                        {h.city && <span className="ms-2 text-xs text-muted-foreground">{h.city}</span>}
                        {i === 0 && data.hotels.length > 1 && <Chip className="ms-2">ברירת המחדל</Chip>}
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
            המחיר לאדם כולל את המלון, את קטגוריית הכרטיס הראשונה
            {d.flight_mode === "priced" ? " ואת הטיסה" : d.flight_mode === "included" ? ", והטיסה כלולה" : ""}. קטגוריית כרטיס אחרת
            מוסיפה את ההפרש שלה.
          </p>
          {data.tickets.length > 0 && (
            <div className="overflow-hidden rounded-md border" data-testid="view-tickets">
              {data.tickets.map((t, i) => (
                <div key={`${t.label}-${i}`} className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-sm last:border-b-0">
                  <span>{t.label ?? `קטגוריה ${i + 1}`}</span>
                  <span className="text-xs text-muted-foreground">
                    {i === 0 || !t.extra ? (
                      "כלול במחיר"
                    ) : (
                      <>
                        <Ltr className="text-sm font-medium tabular-nums text-foreground">
                          {t.extra > 0 ? "+" : "-"}
                          {fmtMoney(Math.abs(t.extra))}
                          {currencySymbol(d.currency)}
                        </Ltr>{" "}
                        לאדם
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
            <h3 className="text-sm font-semibold">מחיר לאדם לפי הרכב החדר</h3>
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
            <p className="text-xs text-muted-foreground">שורה בלי מחיר = ההרכב הזה לא מוצע ביציאה.</p>
          </section>

          <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold">מחיר לחדר, כפי שהלקוח רואה</h3>
            {rooms.length === 0 ? (
              <Notice tone="warning">אין מחיר לחדר זוגי ביציאה הזו.</Notice>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm" data-testid="view-rooms">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className={th}>הרכב</th>
                      <th className={cn(th, "text-center")}>נוסעים</th>
                      <th className={cn(th, "text-end")}>מחיר לחדר</th>
                      {discount > 0 && <th className={cn(th, "text-end")}>אחרי הנחה</th>}
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
                על כרטיס התאריך באתר: החל מ-
                <Money value={card.offer} currency={d.currency} className="font-semibold text-foreground" /> לאדם בחדר זוגי
                {card.regular != null && (
                  <>
                    {" "}
                    במקום <Money value={card.regular} currency={d.currency} className="line-through" />
                  </>
                )}
                .
              </p>
            )}
          </section>
        </div>
      )}

      {!vacation && data.prices.length === 0 && <Notice tone="warning">עוד לא הוזנו מחירים ליציאה הזו.</Notice>}
    </div>
  );
}

function PromotionsTab({ data }: { data: DepartureViewData }) {
  const d = data.departure;
  if (data.promotions.length === 0) {
    return <p className="my-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">אין הטבות פעילות ליציאה הזו.</p>;
  }
  return (
    <div className="space-y-3 py-4">
      <p className="text-xs text-muted-foreground">ההטבות הפעילות חלות אוטומטית על כל הזמנה ליציאה הזו.</p>
      <ul className="space-y-2">
        {data.promotions.map((p) => (
          <li key={p.id} data-promotion-kind={p.kind} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{promotionSummary(p, d.currency)}</p>
              <p className="text-xs text-muted-foreground">
                {PROMOTION_KIND_LABELS[p.kind as PromotionKind] ?? p.kind}
                {p.valid_until ? ` · בתוקף עד ${fmtDate(p.valid_until)}` : " · בלי תאריך תפוגה"}
                {p.show_on_card ? " · מוצגת על הכרטיס באתר" : ""}
              </p>
            </div>
            {isExpired(p.valid_until) && (
              <Chip className="border-warning/40 bg-warning-muted text-warning" title="ההטבה עדיין פעילה באתר. כדאי לוודא מול המשרד לפני שמבטיחים אותה ללקוח.">
                תאריך התפוגה עבר
              </Chip>
            )}
            {p.scope === "series" && <Chip className="border-info/30 bg-info-muted text-info">לכל הסדרה</Chip>}
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
        המראה <Ltr className="tabular-nums text-foreground">{fmtDateTime(departs)}</Ltr>
        {" · "}
        נחיתה <Ltr className="tabular-nums text-foreground">{fmtDateTime(arrives)}</Ltr>
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
          title="הלוך"
          number={flight.outbound_flight_number}
          from={flight.outbound_departure_airport}
          to={flight.outbound_arrival_airport}
          departs={flight.outbound_departure_time}
          arrives={flight.outbound_arrival_time}
        />
      )}
      {flight.legs !== "outbound" && (
        <FlightLeg
          title="חזור"
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
        <Fact label="מקומות בטיסות">
          <Ltr className="tabular-nums">{data.seats.allocated}</Ltr>
        </Fact>
        <Fact label="נמכרו">
          <Ltr className="tabular-nums">{data.seats.sold}</Ltr>
        </Fact>
        <Fact label="נשארו">
          <Ltr className={cn("font-semibold tabular-nums", data.seats.remaining <= 0 && data.seats.allocated > 0 && "text-destructive")}>
            {data.seats.remaining}
          </Ltr>
        </Fact>
      </dl>
      {data.flights.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          פרטי הטיסות יעודכנו. עדיין אין ליציאה הזו טיסה מאושרת.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.flights.map((f, i) => (
            <FlightItem key={`${f.outbound_flight_number}-${f.inbound_flight_number}-${i}`} flight={f} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">לוח הזמנים של הטיסות המאושרות בלבד. השעות הן שעות מקומיות בשדה.</p>
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
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" data-testid="departure-view-card">
        {loading && !data ? (
          <div className="space-y-4 p-6">
            <SheetTitle className="sr-only">טוען יציאה</SheetTitle>
            <SheetDescription className="sr-only">פרטי היציאה נטענים</SheetDescription>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : error || !data || !d ? (
          <div className="space-y-4 p-6">
            <SheetTitle>היציאה לא נטענה</SheetTitle>
            <SheetDescription className="sr-only">שגיאה בטעינת פרטי היציאה</SheetDescription>
            <Notice tone="error">{error ?? "לא נמצאה יציאה"}</Notice>
            <Button variant="outline" onClick={onClose}>
              סגירה
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2 border-b pb-4 pe-6 ps-12 pt-5 text-start sm:text-start">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SheetTitle className="font-display text-xl">
                  <Ltr className="font-mono">{d.code}</Ltr>
                </SheetTitle>
                <Ltr className="text-sm tabular-nums text-muted-foreground">{fmtDateRange(d.start_date, d.end_date)}</Ltr>
                <span className="text-sm text-muted-foreground">{nightsBetween(d.start_date, d.end_date)} לילות</span>
                {routeLabel && <Ltr className="font-mono text-sm">{routeLabel}</Ltr>}
                {type && type !== "round_trip" && <Chip className="border-info/30 bg-info-muted text-info">{ROUTE_TYPE_LABELS[type]}</Chip>}
              </div>
              <SheetDescription>
                {data.package?.name ?? ""}
                {data.series && (
                  <>
                    {" · סדרה "}
                    <Ltr className="font-mono">{data.series.code}</Ltr>
                    {data.series.label ? ` (${data.series.label})` : ""}
                  </>
                )}
                {" · עונה "}
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
                    החל מ-
                    <Money value={data.doublePrice.price - discount} currency={d.currency} className="font-semibold" /> לאדם בחדר זוגי
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
                      נשארו <Ltr className="font-semibold tabular-nums text-foreground">{data.seats.remaining}</Ltr> מתוך{" "}
                      <Ltr className="tabular-nums">{data.seats.allocated}</Ltr> מקומות
                    </>
                  ) : (
                    "מספר המקומות יעודכן"
                  )}
                </span>
                <Chip className="ms-auto gap-1" title="אין לחשבון הזה הרשאת עריכה">
                  <Eye className="h-3 w-3" />
                  צפייה בלבד
                </Chip>
              </div>
            </SheetHeader>

            <Tabs dir="rtl" value={shownTab} onValueChange={(v) => onTabChange(v as CardTab)} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-6 mt-3 grid h-9 grid-cols-4">
                <TabsTrigger value="general">כללי</TabsTrigger>
                <TabsTrigger value="prices">מחירים</TabsTrigger>
                <TabsTrigger value="promotions">הטבות{data.promotions.length ? ` (${data.promotions.length})` : ""}</TabsTrigger>
                <TabsTrigger value="flights">טיסות{data.flights.length ? ` (${data.flights.length})` : ""}</TabsTrigger>
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
