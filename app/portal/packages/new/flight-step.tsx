"use client";

/**
 * Flights step — myt-main's FlightSelection, agent-side.
 * Same anatomy: event band with pax+dates search, the 3-tab sort row, a
 * filters sidebar (stops / baggage / departure windows / airlines), and one
 * merged list of flight cards — offline inventory prioritized and badged,
 * live (Amadeus-via-main) results after a search. The whole card is the click
 * target; skip lives in the sticky continue bar, exactly like the site.
 */

import { useMemo, useState } from "react";
import {
  DollarSign,
  Loader2,
  Lock,
  Luggage,
  Moon,
  Plane,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  Sunset,
  type LucideIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BuilderFlight, LiveFlightOffer } from "@/lib/actions/portal-package-actions";
import { useWizard } from "./wizard-context";
import {
  CardWrapper,
  DashedOptionRow,
  dateFmt,
  deltaVsBase,
  DeltaPrice,
  durationLabel,
  EventBand,
  IssueState,
  minutesLabel,
  MobileDeltaPill,
  PromotedPill,
  SortTabs,
  timeFmt,
  usd,
  type Delta,
  type SortTabOption,
} from "./wizard-ui";

/* ------------------------------------------------------------------ */
/*  A single display shape for offline + live flights                  */
/* ------------------------------------------------------------------ */

type DisplayLeg = {
  depTime: string;
  depAirport: string;
  arrTime: string | null;
  arrAirport: string;
  durLabel: string;
  stops: number;
  flightNumber: string | null;
  checkedBag: boolean;
  cabinBag: boolean;
};

type DisplayFlight = {
  key: string;
  kind: "offline" | "live";
  airline: string;
  logo: string | null;
  perPerson: number;
  remaining: number | null;
  out: DisplayLeg;
  ret: DisplayLeg;
  bagKg: number | null;
  offlineId?: number;
  offer?: LiveFlightOffer;
};

const minutesBetween = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const from = new Date(a).getTime();
  const to = new Date(b).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return Math.round((to - from) / 60000);
};

function fromOffline(f: BuilderFlight): DisplayFlight {
  return {
    key: `off-${f.id}`,
    kind: "offline",
    airline: f.airline_name,
    logo: f.airline_logo || null,
    perPerson: f.price,
    remaining: f.remaining,
    offlineId: f.id,
    bagKg: f.checked_bag_kg,
    out: {
      depTime: f.outbound_departure_time,
      depAirport: f.outbound_departure_airport,
      arrTime: f.outbound_arrival_time,
      arrAirport: f.outbound_arrival_airport,
      durLabel: durationLabel(f.outbound_duration),
      stops: f.outbound_stop_airport ? 1 : 0,
      flightNumber: f.outbound_flight_number || null,
      checkedBag: f.bags_included,
      cabinBag: f.cabin_bag_kg != null && f.cabin_bag_kg > 0,
    },
    ret: {
      depTime: f.inbound_departure_time,
      depAirport: f.inbound_departure_airport,
      arrTime: f.inbound_arrival_time,
      arrAirport: f.inbound_arrival_airport,
      durLabel: durationLabel(f.inbound_duration),
      stops: f.inbound_stop_airport ? 1 : 0,
      flightNumber: f.inbound_flight_number || null,
      checkedBag: f.bags_included,
      cabinBag: f.cabin_bag_kg != null && f.cabin_bag_kg > 0,
    },
  };
}

function fromLive(offer: LiveFlightOffer): DisplayFlight {
  const travelers = Math.max(1, offer.numOfTravelers || 1);
  return {
    key: `live-${offer.id}`,
    kind: "live",
    airline: offer.metadata?.name || offer.airline,
    logo: offer.metadata?.logo || null,
    perPerson: offer.price / travelers,
    remaining: null,
    offer,
    bagKg: null,
    out: {
      depTime: offer.outbound.departureTime,
      depAirport: offer.outbound.departureAirport,
      arrTime: offer.outbound.arrivalTime,
      arrAirport: offer.outbound.arrivalAirport,
      durLabel: minutesLabel(
        minutesBetween(offer.outbound.departureTime, offer.outbound.arrivalTime),
      ),
      stops: offer.stops,
      flightNumber: offer.outbound.flightNumber ?? null,
      checkedBag: !!offer.outbound.checkBagsIncluded,
      cabinBag: !!offer.outbound.cabinBagsIncluded,
    },
    ret: {
      depTime: offer.inbound.departureTime,
      depAirport: offer.inbound.departureAirport,
      arrTime: offer.inbound.arrivalTime,
      arrAirport: offer.inbound.arrivalAirport,
      durLabel: minutesLabel(
        minutesBetween(offer.inbound.departureTime, offer.inbound.arrivalTime),
      ),
      stops: offer.stops,
      flightNumber: offer.inbound.flightNumber ?? null,
      checkedBag: !!offer.inbound.checkBagsIncluded,
      cabinBag: !!offer.inbound.cabinBagsIncluded,
    },
  };
}

const ISRAELI_AIRLINE =
  /אל[\s-]?על|el[\s-]?al|ארקיע|arkia|ישראייר|israir|blue[\s-]?bird|בלו[\s-]?בירד/i;

type FsSort = "best" | "cheap" | "israeli";
type DayPart = "morning" | "noon" | "evening";

const dayPartOf = (iso: string | null): DayPart => {
  const h = iso ? new Date(iso).getHours() : NaN;
  if (!Number.isFinite(h)) return "morning";
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "noon";
  return "evening";
};

/* ------------------------------------------------------------------ */
/*  FlightMeta — main's leg centerpiece                                */
/* ------------------------------------------------------------------ */

const STOPS_LABEL: Record<number, string> = {
  0: "טיסה ישירה",
  1: "עצירה אחת",
  2: "2 עצירות",
  3: "3 עצירות",
};

function FlightMeta({ leg }: { leg: DisplayLeg }) {
  return (
    <div className="flex w-full flex-row items-center justify-around" dir="ltr">
      <div className="text-center">
        <p className="whitespace-nowrap text-base font-bold tabular-nums lg:text-2xl">
          {timeFmt(leg.depTime)}
        </p>
        <p className="text-sm lg:text-lg">{leg.depAirport}</p>
      </div>
      <div className="relative flex w-full flex-col items-center px-3">
        <span className="pb-1 text-xs">{leg.durLabel}</span>
        <Plane
          size={14}
          fill="currentColor"
          aria-hidden
          className="absolute left-3 top-0 -rotate-45"
        />
        <div
          className={cn(
            "mx-4 flex w-[90%] flex-row items-center justify-center gap-2 whitespace-nowrap border-t-2 border-brand-forest pt-1 text-xs font-bold dark:border-brand-mint",
            leg.stops > 0 ? "text-destructive" : "text-success",
          )}
        >
          {STOPS_LABEL[Math.min(leg.stops, 3)] ?? `${leg.stops} עצירות`}
        </div>
      </div>
      <div className="text-center">
        <p className="whitespace-nowrap text-base font-bold tabular-nums lg:text-2xl">
          {leg.arrTime ? timeFmt(leg.arrTime) : "—"}
        </p>
        <p className="text-sm lg:text-lg">{leg.arrAirport}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filters sidebar                                                    */
/* ------------------------------------------------------------------ */

type FlightFilters = {
  direct: boolean;
  oneStop: boolean;
  bags: boolean;
  timeOut: Set<DayPart>;
  timeRet: Set<DayPart>;
  airlines: Set<string> | null; // null = all
};

const DAY_PARTS: { key: DayPart; label: string; time: string; icon: LucideIcon }[] = [
  { key: "morning", label: "בוקר", time: "05:00-12:00", icon: Sun },
  { key: "noon", label: "צהריים", time: "12:00-18:00", icon: Sunset },
  { key: "evening", label: "ערב", time: "18:00-05:00", icon: Moon },
];

function TimeBlocks({
  value,
  onToggle,
}: {
  value: Set<DayPart>;
  onToggle: (part: DayPart) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {DAY_PARTS.map(({ key, label, time, icon: Icon }) => {
        const selected = value.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={cn(
              "flex cursor-pointer flex-col items-center rounded-lg p-2 transition-colors",
              selected ? "bg-brand-mint/20" : "hover:bg-brand-mint/10",
            )}
          >
            <Icon size={34} strokeWidth={1} />
            <span className="text-base font-medium">{label}</span>
            <span className="whitespace-nowrap text-xs text-muted-foreground">{time}</span>
          </button>
        );
      })}
    </div>
  );
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 py-1 text-sm"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

function FlightFiltersPanel({
  filters,
  setFilters,
  airlines,
}: {
  filters: FlightFilters;
  setFilters: React.Dispatch<React.SetStateAction<FlightFilters>>;
  airlines: string[];
}) {
  const toggleSet = (set: Set<DayPart>, part: DayPart): Set<DayPart> => {
    const next = new Set(set);
    if (next.has(part)) next.delete(part);
    else next.add(part);
    return next;
  };
  return (
    <div className="w-full space-y-4 rounded-lg border-2 border-border p-4 shadow-lg" dir="rtl">
      <div className="px-1">
        <h3 className="mb-2 text-lg font-semibold">עצירות</h3>
        <CheckRow
          id="ff-direct"
          label="טיסה ישירה"
          checked={filters.direct}
          onChange={(v) => setFilters((f) => ({ ...f, direct: v }))}
        />
        <CheckRow
          id="ff-onestop"
          label="עצירה אחת"
          checked={filters.oneStop}
          onChange={(v) => setFilters((f) => ({ ...f, oneStop: v }))}
        />
      </div>
      <div className="px-1">
        <h3 className="mb-2 text-lg font-semibold">כבודה</h3>
        <CheckRow
          id="ff-bags"
          label={
            <span className="flex items-center gap-1.5">
              <Luggage className="h-4 w-4" /> כולל מזוודה
            </span>
          }
          checked={filters.bags}
          onChange={(v) => setFilters((f) => ({ ...f, bags: v }))}
        />
      </div>
      <div className="px-1">
        <h3 className="mb-2 text-lg font-semibold">זמן המראה הלוך</h3>
        <TimeBlocks
          value={filters.timeOut}
          onToggle={(p) => setFilters((f) => ({ ...f, timeOut: toggleSet(f.timeOut, p) }))}
        />
      </div>
      <div className="px-1">
        <h3 className="mb-2 text-lg font-semibold">זמן המראה חזור</h3>
        <TimeBlocks
          value={filters.timeRet}
          onToggle={(p) => setFilters((f) => ({ ...f, timeRet: toggleSet(f.timeRet, p) }))}
        />
      </div>
      {airlines.length > 1 && (
        <div className="px-1">
          <h3 className="mb-2 text-lg font-semibold">חברות תעופה</h3>
          <div className="mb-1 flex gap-3 text-xs">
            <button
              type="button"
              className="font-semibold text-brand-forest underline underline-offset-2 dark:text-brand-mint"
              onClick={() => setFilters((f) => ({ ...f, airlines: null }))}
            >
              בחר הכל
            </button>
            <button
              type="button"
              className="font-semibold text-muted-foreground underline underline-offset-2"
              onClick={() => setFilters((f) => ({ ...f, airlines: new Set() }))}
            >
              נקה הכל
            </button>
          </div>
          {airlines.map((name) => {
            const checked = filters.airlines == null || filters.airlines.has(name);
            return (
              <CheckRow
                key={name}
                id={`ff-al-${name}`}
                label={name}
                checked={checked}
                onChange={(v) =>
                  setFilters((f) => {
                    const current = f.airlines == null ? new Set(airlines) : new Set(f.airlines);
                    if (v) current.add(name);
                    else current.delete(name);
                    return {
                      ...f,
                      airlines: current.size === airlines.length ? null : current,
                    };
                  })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The step                                                           */
/* ------------------------------------------------------------------ */

export function FlightStep() {
  const w = useWizard();
  const [sort, setSort] = useState<FsSort>("best");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FlightFilters>({
    direct: false,
    oneStop: false,
    bags: false,
    timeOut: new Set(),
    timeRet: new Set(),
    airlines: null,
  });

  const { event } = w;

  const all = useMemo<DisplayFlight[]>(() => {
    const offline = w.flights.map(fromOffline);
    const live = (w.fsResults ?? []).filter((o) => !o.isOffline).map(fromLive);
    return [...offline, ...live];
  }, [w.flights, w.fsResults]);

  const airlineNames = useMemo(
    () => [...new Set(all.map((f) => f.airline).filter(Boolean))].sort(),
    [all],
  );

  const visible = useMemo(() => {
    const stopsAllowed = (stops: number) => {
      if (!filters.direct && !filters.oneStop) return true;
      return (filters.direct && stops === 0) || (filters.oneStop && stops === 1);
    };
    const filtered = all.filter((f) => {
      if (!stopsAllowed(Math.max(f.out.stops, f.ret.stops))) return false;
      if (filters.bags && !(f.out.checkedBag && f.ret.checkedBag)) return false;
      if (filters.timeOut.size > 0 && !filters.timeOut.has(dayPartOf(f.out.depTime))) return false;
      if (filters.timeRet.size > 0 && !filters.timeRet.has(dayPartOf(f.ret.depTime))) return false;
      if (filters.airlines != null && !filters.airlines.has(f.airline)) return false;
      return true;
    });
    const byPrice = (a: DisplayFlight, b: DisplayFlight) => a.perPerson - b.perPerson;
    if (sort === "cheap") return filtered.sort(byPrice);
    if (sort === "israeli") {
      return filtered.sort((a, b) => {
        const ai = ISRAELI_AIRLINE.test(a.airline) ? 0 : 1;
        const bi = ISRAELI_AIRLINE.test(b.airline) ? 0 : 1;
        return ai - bi || byPrice(a, b);
      });
    }
    // "best" — main's pickBestFlight order: offline first, fewest stops, cheapest.
    return filtered.sort((a, b) => {
      const ao = a.kind === "offline" ? 0 : 1;
      const bo = b.kind === "offline" ? 0 : 1;
      const asum = a.out.stops + a.ret.stops;
      const bsum = b.out.stops + b.ret.stops;
      return ao - bo || asum - bsum || byPrice(a, b);
    });
  }, [all, filters, sort]);

  const cheapestKey = useMemo(
    () =>
      visible.length > 0
        ? visible.reduce((min, f) => (f.perPerson < min.perPerson ? f : min)).key
        : null,
    [visible],
  );
  const bestKey = sort === "best" ? (visible[0]?.key ?? null) : null;

  if (!event) return null;
  const isLocked = event.locked_flight_id != null;

  const isSelectedFlight = (f: DisplayFlight) =>
    (f.kind === "offline" &&
      w.flightChoice.mode === "offline" &&
      w.flightChoice.flightId === f.offlineId) ||
    (f.kind === "live" &&
      w.flightChoice.mode === "live-offer" &&
      w.flightChoice.offer.id === f.offer?.id);

  const selectFlight = (f: DisplayFlight) => {
    if (f.kind === "offline" && f.offlineId != null) {
      w.setFlightChoice({ mode: "offline", flightId: f.offlineId });
    } else if (f.offer) {
      w.setFlightChoice({ mode: "live-offer", offer: f.offer });
    }
  };

  const sortOptions: SortTabOption<FsSort>[] = [
    { key: "best", title: "הטוב ביותר", subtitle: "ערך מיטבי לכסף", icon: Star },
    { key: "cheap", title: "הזול ביותר", subtitle: "המחיר הנמוך ביותר", icon: DollarSign },
    { key: "israeli", title: "ישראלי", subtitle: "חברות תעופה ישראליות", icon: ShieldCheck },
  ];

  return (
    <section className="space-y-2 lg:space-y-4">
      <EventBand
        name={event.name}
        date={event.date}
        location={event.location_name}
        imageUrl={event.image_url}
      >
        {!isLocked && (
          <div className="flex w-full flex-row flex-wrap items-center gap-2 text-xs lg:w-[60%] lg:justify-center">
            <span className="hidden text-xl lg:block">כמה טסים?</span>
            <select
              value={w.qty}
              onChange={(e) => w.setQty(Number(e.target.value))}
              className="h-[40px] w-20 cursor-pointer appearance-none rounded-lg border border-border bg-card px-3 text-center text-lg text-foreground"
            >
              {[...new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, w.qty])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
            <span className="hidden text-xl lg:block">ובאיזה תאריכים?</span>
            <Input
              type="date"
              dir="ltr"
              aria-label="תאריך יציאה"
              value={w.fsDepart}
              onChange={(e) => w.setFsDepart(e.target.value)}
              className="h-[40px] w-36 bg-card"
            />
            <Input
              type="date"
              dir="ltr"
              aria-label="תאריך חזרה"
              value={w.fsReturn}
              onChange={(e) => w.setFsReturn(e.target.value)}
              className="h-[40px] w-36 bg-card"
            />
            <button
              type="button"
              onClick={w.runFlightSearch}
              disabled={w.fsLoading || !w.fsDepart || !w.fsReturn}
              aria-label="חיפוש טיסות"
              className="flex h-[40px] items-center justify-center rounded-lg bg-brand-forest px-4 text-white transition-opacity disabled:opacity-50 dark:bg-brand-mint dark:text-brand-forest"
            >
              {w.fsLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search size={22} />}
            </button>
          </div>
        )}
      </EventBand>

      {isLocked ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          חבילה זו נמכרת עם טיסה קבועה — הטיסה אינה ניתנת לשינוי.
        </div>
      ) : (
        <div className="flex items-stretch gap-1.5">
          <button
            type="button"
            aria-label="סינון"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              "flex w-[38px] flex-shrink-0 items-center justify-center rounded-md border bg-card transition-colors lg:hidden",
              filtersOpen ? "border-brand-forest" : "border-border hover:border-brand-forest",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <SortTabs options={sortOptions} active={sort} onChange={setSort} />
          </div>
        </div>
      )}

      {w.fsError && <p className="text-sm text-destructive">{w.fsError}</p>}

      <div className="flex w-full flex-col items-start gap-2 lg:flex-row lg:gap-4">
        {!isLocked && (
          <div className={cn("w-full lg:w-1/4", !filtersOpen && "hidden lg:block")}>
            <FlightFiltersPanel filters={filters} setFilters={setFilters} airlines={airlineNames} />
          </div>
        )}

        <div className={cn("w-full", !isLocked && "lg:w-3/4")}>
          {w.inventoryLoading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" /> טוען טיסות...
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 py-2 lg:gap-4 lg:py-0" role="region" aria-live="polite">
              {visible.map((f) => {
                const selected = isSelectedFlight(f);
                const soldOutForQty = f.remaining != null && f.remaining < w.qty;
                const delta: Delta = deltaVsBase(f.perPerson, event.base_flight_price);
                return (
                  <div key={f.key} className="relative">
                    <MobileDeltaPill delta={delta} per="נוסע" selected={selected} />
                    {(bestKey === f.key || cheapestKey === f.key) && (
                      <span
                        className={cn(
                          "absolute left-2 top-0 z-10 -translate-y-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
                          bestKey === f.key
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700",
                        )}
                      >
                        {bestKey === f.key ? "★ הטוב ביותר" : "↓ הזול ביותר"}
                      </span>
                    )}
                    <CardWrapper
                      isSelected={selected}
                      disabled={soldOutForQty}
                      onClick={() => selectFlight(f)}
                      className="pt-4 lg:pt-2"
                    >
                      <div className="flex w-full items-center py-2">
                        <div className="w-full space-y-0 lg:w-5/6">
                          {/* Outbound */}
                          <LegRow flight={f} leg={f.out} label="הלוך" />
                          <div className="my-2 w-full border-t border-border" />
                          {/* Inbound */}
                          <LegRow flight={f} leg={f.ret} label="חזור" />
                        </div>
                        <div className="mx-4 hidden h-32 border-l border-border lg:block" />
                        <div className="hidden flex-col items-center gap-1.5 pt-2 text-center font-bold lg:flex lg:w-1/6">
                          <DeltaPrice delta={delta} per="נוסע" />
                          {f.kind === "offline" && (
                            <>
                              <PromotedPill />
                              <span className="text-[11px] font-normal text-muted-foreground">
                                {soldOutForQty
                                  ? "אין מספיק מקומות"
                                  : f.remaining != null
                                    ? `נותרו ${f.remaining}`
                                    : null}
                              </span>
                            </>
                          )}
                          {f.kind === "live" && (
                            <span className="text-[11px] font-normal text-muted-foreground">
                              {`סה"כ ${usd(f.perPerson * w.qty)} ל-${w.qty} נוסעים`}
                            </span>
                          )}
                        </div>
                      </div>
                    </CardWrapper>
                  </div>
                );
              })}

              {visible.length === 0 && (w.flights.length > 0 || w.fsResults != null) && (
                <IssueState
                  title="לא מצאנו טיסות שמתאימות למסננים"
                  subtitle="נסו לנקות חלק מהסינון או לחפש תאריכים אחרים"
                />
              )}
              {w.flights.length === 0 && w.fsResults == null && !isLocked && (
                <IssueState
                  title="חפשו טיסות לתאריכים שלכם"
                  subtitle="בחרו תאריכים למעלה ולחצו חיפוש — התוצאות מגיעות מהספקים בזמן אמת, בדיוק כמו באתר"
                />
              )}

              {!isLocked && (
                <div className="space-y-2 pt-2">
                  <DashedOptionRow
                    icon={Plane}
                    title="הלקוח יבחר טיסה באתר"
                    subtitle="הלינק יפתח את שלב הטיסות והלקוח יבחר מהזמינות בזמן אמת"
                    selected={w.flightChoice.mode === "live"}
                    onClick={() => w.setFlightChoice({ mode: "live" })}
                  />
                  <DashedOptionRow
                    icon={Plane}
                    title="חבילה ללא טיסה"
                    subtitle="הלקוח מגיע בכוחות עצמו"
                    selected={w.flightChoice.mode === "none"}
                    onClick={() => w.setFlightChoice({ mode: "none" })}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One direction row: airline block | FlightMeta | baggage (desktop). */
function LegRow({
  flight,
  leg,
  label,
}: {
  flight: DisplayFlight;
  leg: DisplayLeg;
  label: string;
}) {
  return (
    <div className="flex w-full flex-row items-center justify-between gap-2 lg:gap-1">
      <div className="flex w-[22%] flex-col items-center lg:w-[20%]">
        <span className="mb-1 text-[11px] font-semibold text-muted-foreground lg:hidden">
          {label}
        </span>
        {flight.logo ? (
          <span className="mb-1 rounded-md dark:bg-white/95 dark:p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flight.logo} alt={flight.airline} className="h-10 w-10 object-contain" />
          </span>
        ) : (
          <Plane size={32} className="mb-1 text-gray-400" />
        )}
        <span className="max-w-full truncate text-xs font-medium">{flight.airline}</span>
        <span className="text-[11px] text-muted-foreground" dir="ltr">
          {dateFmt(leg.depTime)}
        </span>
        {leg.flightNumber && (
          <span className="hidden text-sm text-muted-foreground lg:block" dir="ltr">
            {leg.flightNumber}
          </span>
        )}
      </div>
      <div className="flex w-full justify-center lg:w-[55%]">
        <FlightMeta leg={leg} />
      </div>
      <div className="hidden pr-2 lg:flex lg:w-[20%] lg:flex-col lg:items-start lg:gap-1.5">
        {leg.checkedBag && (
          <span className="flex items-center gap-1.5 text-[15px]">
            <Luggage className="h-4 w-4" />
            מזוודה{flight.bagKg ? ` · ${flight.bagKg} ק"ג` : ""}
          </span>
        )}
        {leg.cabinBag && (
          <span className="flex items-center gap-1.5 text-[15px] text-muted-foreground">
            <Luggage className="h-3.5 w-3.5" />
            טרולי
          </span>
        )}
        {!leg.checkedBag && !leg.cabinBag && (
          <span className="text-[13px] text-muted-foreground">ללא כבודה רשומה</span>
        )}
      </div>
    </div>
  );
}
