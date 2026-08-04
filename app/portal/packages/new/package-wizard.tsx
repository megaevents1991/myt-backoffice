"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Check,
  Copy,
  Loader2,
  Luggage,
  MapPin,
  Minus,
  Plane,
  Plus,
  Search,
  Star,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  createPreparedPackage,
  getPackageBuilderInventory,
  searchLiveFlights,
  searchLiveHotels,
  type BuilderEvent,
  type BuilderFlight,
  type BuilderHotelRoom,
  type LiveFlightOffer,
  type LiveHotelOption,
} from "@/lib/actions/portal-package-actions";

type FlightChoice =
  | { mode: "offline"; flightId: number }
  | { mode: "live-offer"; offer: LiveFlightOffer }
  | { mode: "live" }
  | { mode: "none" };
type HotelChoice =
  | { mode: "offline"; units: Record<number, number> }
  | { mode: "live-offer"; option: LiveHotelOption }
  | { mode: "live" }
  | { mode: "none" };

const STEPS = ["אירוע", "כרטיסים", "טיסה", "מלון", "סיכום"] as const;

function StepHeader({ step }: { step: number }) {
  return (
    <div className="space-y-2">
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border font-medium transition-colors",
                i < step && "border-transparent bg-brand-mint text-brand-forest",
                i === step && "border-transparent bg-primary text-primary-foreground",
                i > step && "text-muted-foreground",
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn(i === step ? "font-semibold" : "text-muted-foreground")}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground/50">—</span>}
          </li>
        ))}
      </ol>
      <div className="h-1 w-full max-w-md overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand-mint transition-all duration-300"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  children,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border bg-card p-4 text-start shadow-card transition-all",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:-translate-y-0.5 hover:shadow-card-hover",
        disabled && "cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-card",
      )}
    >
      {children}
    </button>
  );
}

const MINT_CTA =
  "rounded-full bg-brand-mint px-5 font-semibold text-brand-forest transition-all duration-200 hover:bg-brand-mint/90 hover:shadow-mint-glow active:scale-[0.98]";

const dateFmt = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("he-IL") : "";

const timeFmt = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : "";

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

const dateOnly = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");

export function PackageWizard({
  events,
  initialEventId,
}: {
  events: BuilderEvent[];
  /** Deep entry from the unified packages page — lands straight on tickets. */
  initialEventId?: number;
}) {
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [event, setEvent] = useState<BuilderEvent | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [qty, setQty] = useState(2);
  const [flights, setFlights] = useState<BuilderFlight[]>([]);
  const [hotels, setHotels] = useState<BuilderHotelRoom[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [flightChoice, setFlightChoice] = useState<FlightChoice>({ mode: "live" });
  const [hotelChoice, setHotelChoice] = useState<HotelChoice>({ mode: "live" });
  const [allowEdit, setAllowEdit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Live flight search
  const [fsDepart, setFsDepart] = useState("");
  const [fsReturn, setFsReturn] = useState("");
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [fsResults, setFsResults] = useState<LiveFlightOffer[] | null>(null);

  // Live hotel search
  const [hsCheckin, setHsCheckin] = useState("");
  const [hsCheckout, setHsCheckout] = useState("");
  const [hsLoading, setHsLoading] = useState(false);
  const [hsError, setHsError] = useState<string | null>(null);
  const [hsResults, setHsResults] = useState<LiveHotelOption[] | null>(null);

  // Party size drives both searches — a qty change invalidates old results.
  useEffect(() => {
    setFsResults(null);
    setHsResults(null);
    setFlightChoice((prev) => (prev.mode === "live-offer" ? { mode: "live" } : prev));
    setHotelChoice((prev) => (prev.mode === "live-offer" ? { mode: "live" } : prev));
  }, [qty]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return events.slice(0, 8);
    return events
      .filter(
        (e) =>
          e.name.toLowerCase().includes(term) ||
          e.location_name.toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [events, query]);

  const selectEvent = (e: BuilderEvent) => {
    setEvent(e);
    setCategory(e.tickets[0]?.category ?? null);
    setFlightChoice({ mode: "live" });
    setHotelChoice({ mode: "live" });
    setFsResults(null);
    setHsResults(null);
    setFsError(null);
    setHsError(null);
    setFsDepart(dateOnly(e.def_date_depart));
    setFsReturn(dateOnly(e.def_date_return));
    setStep(1);
    setInventoryLoading(true);
    getPackageBuilderInventory(e.id)
      .then((inv) => {
        setFlights(inv.flights);
        setHotels(inv.hotels);
      })
      .finally(() => setInventoryLoading(false));
  };

  // ?event= deep entry: skip the search step when the event is buildable.
  // Runs once — a later manual "build another" must not snap back here.
  useEffect(() => {
    if (!initialEventId) return;
    const preselected = events.find((e) => e.id === initialEventId);
    if (preselected) selectEvent(preselected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTicket = event?.tickets.find((t) => t.category === category) ?? null;

  // ------- offline hotel grouping (unchanged mechanics) -------
  const hotelGroups = useMemo(() => {
    const groups = new Map<string, BuilderHotelRoom[]>();
    for (const room of hotels) {
      const key = `${room.hid ?? room.hotel_name}|${room.check_in}|${room.check_out}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(room);
    }
    return [...groups.values()];
  }, [hotels]);

  const selectedUnits = useMemo<Record<number, number>>(
    () => (hotelChoice.mode === "offline" ? hotelChoice.units : {}),
    [hotelChoice],
  );

  const selectedGroupKey = useMemo(() => {
    const activeRow = hotels.find((h) => (selectedUnits[h.rowId] ?? 0) > 0);
    return activeRow
      ? `${activeRow.hid ?? activeRow.hotel_name}|${activeRow.check_in}|${activeRow.check_out}`
      : null;
  }, [hotels, selectedUnits]);

  const setUnitCount = (room: BuilderHotelRoom, delta: number) => {
    setHotelChoice((prev) => {
      const units = prev.mode === "offline" ? { ...prev.units } : {};
      const next = Math.max(0, Math.min(room.remaining, (units[room.rowId] ?? 0) + delta));
      if (next === 0) delete units[room.rowId];
      else units[room.rowId] = next;
      return Object.keys(units).length > 0 ? { mode: "offline", units } : { mode: "live" };
    });
  };

  const hotelCapacity = hotels.reduce(
    (sum, room) => sum + (selectedUnits[room.rowId] ?? 0) * room.capacity,
    0,
  );
  const hotelTotal = hotels.reduce(
    (sum, room) => sum + (selectedUnits[room.rowId] ?? 0) * room.price,
    0,
  );

  const chosenFlight =
    flightChoice.mode === "offline"
      ? flights.find((f) => f.id === flightChoice.flightId) ?? null
      : null;

  const canContinueFromHotel =
    hotelChoice.mode !== "offline" || (Object.keys(selectedUnits).length > 0 && hotelCapacity >= qty);

  // ------- live searches -------
  const runFlightSearch = () => {
    if (!event) return;
    setFsLoading(true);
    setFsError(null);
    searchLiveFlights({
      eventId: event.id,
      departureDate: fsDepart,
      returnDate: fsReturn,
      adults: qty,
    })
      .then((res) => {
        if (res.ok) {
          setFsResults(res.flights);
          if (res.flights.length === 0) setFsError("לא נמצאו טיסות לתאריכים האלה");
        } else {
          setFsError(res.error);
        }
      })
      .finally(() => setFsLoading(false));
  };

  const defaultHotelDates = (): { checkin: string; checkout: string } => {
    if (flightChoice.mode === "live-offer") {
      return {
        checkin: dateOnly(flightChoice.offer.outbound.arrivalTime),
        checkout: dateOnly(flightChoice.offer.inbound.departureTime),
      };
    }
    if (chosenFlight) {
      return {
        checkin: dateOnly(chosenFlight.outbound_departure_time),
        checkout: dateOnly(chosenFlight.inbound_departure_time),
      };
    }
    return {
      checkin: dateOnly(event?.def_date_depart),
      checkout: dateOnly(event?.def_date_return),
    };
  };

  const runHotelSearch = () => {
    if (!event) return;
    setHsLoading(true);
    setHsError(null);
    searchLiveHotels({
      eventId: event.id,
      checkin: hsCheckin,
      checkout: hsCheckout,
      travelers: qty,
    })
      .then((res) => {
        if (res.ok) {
          setHsResults(res.options);
          if (res.options.length === 0) setHsError("לא נמצאו מלונות לתאריכים האלה");
        } else {
          setHsError(res.error);
        }
      })
      .finally(() => setHsLoading(false));
  };

  const submit = () => {
    if (!event || !category) return;
    setError(null);
    startTransition(async () => {
      const result = await createPreparedPackage({
        eventId: event.id,
        category,
        qty,
        allowEdit,
        flight:
          flightChoice.mode === "live-offer"
            ? { mode: "live-offer", offer: flightChoice.offer }
            : flightChoice,
        hotel:
          hotelChoice.mode === "offline"
            ? {
                mode: "offline",
                units: Object.entries(selectedUnits).map(([rowId, count]) => ({
                  rowId: Number(rowId),
                  count,
                })),
              }
            : hotelChoice.mode === "live-offer"
              ? { mode: "live-offer", offer: hotelChoice.option.snapshot }
              : hotelChoice,
      });
      if (result.ok) setLink(result.link);
      else setError(result.error);
    });
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // ------- success screen -------
  if (link) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-mint">
          <Check className="h-6 w-6 text-brand-forest" />
        </div>
        <h2 className="mt-4 font-display text-lg font-bold">החבילה מוכנה!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          שתפו את הלינק — הלקוח ינחת ישר על ההרכב שבחרתם.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <input
            readOnly
            dir="ltr"
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-sm"
          />
          <Button type="button" onClick={copyLink} className={cn("shrink-0", MINT_CTA)}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "הועתק" : "העתקה"}
          </Button>
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/portal/packages">לרשימת החבילות</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setLink(null);
              setStep(0);
              setEvent(null);
              setQuery("");
            }}
          >
            בניית חבילה נוספת
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader step={step} />

      {/* Step 1 — event */}
      {step === 0 && (
        <section className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש אירוע או עיר..."
              className="pe-9"
            />
          </div>
          {matches.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              לא נמצאו אירועים פתוחים למכירה
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {matches.map((e) => (
                <li key={e.id}>
                  <OptionCard
                    selected={event?.id === e.id}
                    disabled={e.sold_out}
                    onClick={() => selectEvent(e)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{e.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[dateFmt(e.date), e.location_name].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {e.sold_out ? (
                        <Badge variant="destructive" className="shrink-0">אזל</Badge>
                      ) : e.site_price != null ? (
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {usd(e.site_price)}
                          <span className="ms-1 text-xs font-normal text-muted-foreground">לנוסע</span>
                        </span>
                      ) : null}
                    </div>
                  </OptionCard>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Step 2 — tickets */}
      {step === 1 && event && (
        <section className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <span className="font-medium">{event.name}</span>
            <span className="text-muted-foreground"> · {dateFmt(event.date)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {event.tickets.map((t) => (
              <OptionCard
                key={t.category}
                selected={category === t.category}
                onClick={() => setCategory(t.category)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-medium">
                    <Ticket className="h-4 w-4 text-muted-foreground" />
                    {t.category}
                  </span>
                  <span className="text-end">
                    {t.site_price != null && (
                      <span className="block font-semibold tabular-nums">
                        {usd(t.site_price)}
                        <span className="ms-1 text-xs font-normal text-muted-foreground">
                          לנוסע באתר
                        </span>
                      </span>
                    )}
                  </span>
                </div>
              </OptionCard>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">מספר נוסעים / כרטיסים</span>
            <div className="flex items-center rounded-md border">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setQty((q) => Math.min(20, q + 1))}
                disabled={qty >= 20}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Step 3 — flight */}
      {step === 2 && event && (
        <section className="space-y-3">
          {inventoryLoading ? (
            <div className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> טוען טיסות...
            </div>
          ) : (
            <>
              {flights.length > 0 && (
                <p className="text-sm font-semibold text-muted-foreground">מלאי מובטח שלנו</p>
              )}
              {flights.map((f) => {
                const soldOutForQty = f.remaining < qty;
                return (
                  <OptionCard
                    key={f.id}
                    disabled={soldOutForQty}
                    selected={flightChoice.mode === "offline" && flightChoice.flightId === f.id}
                    onClick={() => setFlightChoice({ mode: "offline", flightId: f.id })}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {f.airline_logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={f.airline_logo} alt="" className="h-8 w-8 rounded object-contain" />
                        ) : (
                          <Plane className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{f.airline_name}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            {f.outbound_departure_airport}→{f.outbound_arrival_airport}{" "}
                            {dateFmt(f.outbound_departure_time)} {timeFmt(f.outbound_departure_time)}
                            {" · "}
                            {f.inbound_departure_airport}→{f.inbound_arrival_airport}{" "}
                            {dateFmt(f.inbound_departure_time)} {timeFmt(f.inbound_departure_time)}
                          </p>
                          {(f.outbound_stop_airport || f.inbound_stop_airport) && (
                            <p className="text-xs text-muted-foreground">
                              עצירה: {[f.outbound_stop_airport, f.inbound_stop_airport].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-end">
                        <p className="font-semibold tabular-nums">{usd(f.price)}</p>
                        <p className="text-xs text-muted-foreground">
                          לנוסע · {soldOutForQty ? "אין מספיק מקומות" : `נותרו ${f.remaining}`}
                        </p>
                      </div>
                    </div>
                  </OptionCard>
                );
              })}

              {/* Live search — locked packages sell exactly one flight, so no search there */}
              {event.locked_flight_id == null && (
                <div className="rounded-xl border bg-card p-4 shadow-card">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Plane className="h-4 w-4 text-muted-foreground" />
                    חיפוש טיסות בזמן אמת
                  </p>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-muted-foreground">
                      יציאה
                      <Input
                        type="date"
                        dir="ltr"
                        value={fsDepart}
                        onChange={(e) => setFsDepart(e.target.value)}
                        className="mt-1 w-40"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      חזרה
                      <Input
                        type="date"
                        dir="ltr"
                        value={fsReturn}
                        onChange={(e) => setFsReturn(e.target.value)}
                        className="mt-1 w-40"
                      />
                    </label>
                    <Button
                      type="button"
                      onClick={runFlightSearch}
                      disabled={fsLoading || !fsDepart || !fsReturn}
                      className={MINT_CTA}
                    >
                      {fsLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      חיפוש
                    </Button>
                  </div>
                  {fsError && <p className="mt-2 text-sm text-destructive">{fsError}</p>}
                  {fsResults && fsResults.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {fsResults.slice(0, 12).map((offer) => (
                        <li key={offer.id}>
                          <OptionCard
                            selected={
                              flightChoice.mode === "live-offer" &&
                              flightChoice.offer.id === offer.id
                            }
                            onClick={() => setFlightChoice({ mode: "live-offer", offer })}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                {offer.metadata?.logo ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={offer.metadata.logo}
                                    alt=""
                                    className="h-8 w-8 rounded object-contain"
                                  />
                                ) : (
                                  <Plane className="h-5 w-5 text-muted-foreground" />
                                )}
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {offer.metadata?.name || offer.airline}
                                    {offer.isOffline && (
                                      <Badge variant="secondary" className="ms-2 font-normal">
                                        מלאי שלנו
                                      </Badge>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground" dir="ltr">
                                    {offer.outbound.departureAirport}→{offer.outbound.arrivalAirport}{" "}
                                    {dateFmt(offer.outbound.departureTime)}{" "}
                                    {timeFmt(offer.outbound.departureTime)}
                                    {" · "}
                                    {offer.inbound.departureAirport}→{offer.inbound.arrivalAirport}{" "}
                                    {dateFmt(offer.inbound.departureTime)}{" "}
                                    {timeFmt(offer.inbound.departureTime)}
                                  </p>
                                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {offer.stops > 0 ? `${offer.stops} עצירות` : "ישירה"}
                                    {(offer.outbound.checkBagsIncluded ||
                                      offer.inbound.checkBagsIncluded) && (
                                      <span className="flex items-center gap-1">
                                        <Luggage className="h-3 w-3" /> כבודה כלולה
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="text-end">
                                <p className="font-semibold tabular-nums">{usd(offer.price)}</p>
                                <p className="text-xs text-muted-foreground">
                                  {`סה"כ ל-${offer.numOfTravelers} נוסעים`}
                                </p>
                              </div>
                            </div>
                          </OptionCard>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <OptionCard
                selected={flightChoice.mode === "live"}
                onClick={() => setFlightChoice({ mode: "live" })}
              >
                <p className="text-sm font-medium">הלקוח יבחר טיסה באתר</p>
                <p className="text-xs text-muted-foreground">
                  הלינק יפתח את שלב הטיסות והלקוח יבחר מהטיסות הזמינות בזמן אמת.
                </p>
              </OptionCard>
              <OptionCard
                selected={flightChoice.mode === "none"}
                onClick={() => setFlightChoice({ mode: "none" })}
              >
                <p className="text-sm font-medium">חבילה ללא טיסה</p>
                <p className="text-xs text-muted-foreground">הלקוח מגיע בכוחות עצמו.</p>
              </OptionCard>
            </>
          )}
        </section>
      )}

      {/* Step 4 — hotel */}
      {step === 3 && event && (
        <section className="space-y-3">
          {inventoryLoading ? (
            <div className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> טוען מלונות...
            </div>
          ) : (
            <>
              {hotelGroups.length > 0 && (
                <p className="text-sm font-semibold text-muted-foreground">מלאי מובטח שלנו</p>
              )}
              {hotelGroups.map((group) => {
                const anchor = group[0];
                const groupKey = `${anchor.hid ?? anchor.hotel_name}|${anchor.check_in}|${anchor.check_out}`;
                const otherGroupSelected = selectedGroupKey !== null && selectedGroupKey !== groupKey;
                return (
                  <div
                    key={groupKey}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-card",
                      selectedGroupKey === groupKey && "border-primary ring-1 ring-primary",
                      otherGroupSelected && "opacity-50",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <BedDouble className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{anchor.hotel_name}</span>
                        {anchor.stars > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            {anchor.stars}
                            <Star className="h-3 w-3 fill-current" />
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {anchor.check_in} → {anchor.check_out}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-2">
                      {group.map((room) => {
                        const count = selectedUnits[room.rowId] ?? 0;
                        return (
                          <li
                            key={room.rowId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-medium">
                                {room.room_type}
                                <span className="ms-2 text-xs font-normal text-muted-foreground">
                                  עד {room.capacity} נוסעים · נותרו {room.remaining}
                                  {room.meal_plan ? ` · ${room.meal_plan}` : ""}
                                </span>
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold tabular-nums">{usd(room.price)}</span>
                              <div className="flex items-center rounded-md border bg-background">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={count === 0 || otherGroupSelected}
                                  onClick={() => setUnitCount(room, -1)}
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </Button>
                                <span className="w-6 text-center text-sm font-semibold tabular-nums">
                                  {count}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={count >= room.remaining || otherGroupSelected}
                                  onClick={() => setUnitCount(room, 1)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}

              {hotelChoice.mode === "offline" && hotelCapacity < qty && (
                <p className="text-sm text-destructive">
                  החדרים שנבחרו מתאימים ל-{hotelCapacity} נוסעים, אבל בחבילה {qty} — הוסיפו חדר.
                </p>
              )}

              {/* Live hotel search (Ratehawk via the main site) */}
              <div className="rounded-xl border bg-card p-4 shadow-card">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <BedDouble className="h-4 w-4 text-muted-foreground" />
                  חיפוש מלונות בזמן אמת
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-muted-foreground">
                    {"צ'ק-אין"}
                    <Input
                      type="date"
                      dir="ltr"
                      value={hsCheckin}
                      onChange={(e) => setHsCheckin(e.target.value)}
                      onFocus={() => {
                        if (!hsCheckin && !hsCheckout) {
                          const d = defaultHotelDates();
                          setHsCheckin(d.checkin);
                          setHsCheckout(d.checkout);
                        }
                      }}
                      className="mt-1 w-40"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    {"צ'ק-אאוט"}
                    <Input
                      type="date"
                      dir="ltr"
                      value={hsCheckout}
                      onChange={(e) => setHsCheckout(e.target.value)}
                      className="mt-1 w-40"
                    />
                  </label>
                  <Button
                    type="button"
                    onClick={() => {
                      if (!hsCheckin || !hsCheckout) {
                        const d = defaultHotelDates();
                        setHsCheckin(d.checkin);
                        setHsCheckout(d.checkout);
                        if (!d.checkin || !d.checkout) return;
                      }
                      runHotelSearch();
                    }}
                    disabled={hsLoading}
                    className={MINT_CTA}
                  >
                    {hsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    חיפוש
                  </Button>
                </div>
                {hsError && <p className="mt-2 text-sm text-destructive">{hsError}</p>}
                {hsResults && hsResults.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {hsResults.slice(0, 12).map((option) => (
                      <li key={option.key}>
                        <OptionCard
                          selected={
                            hotelChoice.mode === "live-offer" &&
                            hotelChoice.option.key === option.key
                          }
                          onClick={() => setHotelChoice({ mode: "live-offer", option })}
                        >
                          <div className="flex items-center gap-3">
                            {option.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={option.image}
                                alt=""
                                className="h-14 w-14 shrink-0 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <BedDouble className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                                {option.name}
                                {option.stars > 0 && (
                                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                    {option.stars}
                                    <Star className="h-3 w-3 fill-current" />
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {option.room_name}
                                {option.meal && option.meal !== "nomeal" ? ` · ${option.meal}` : ""}
                              </p>
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                {option.distance_m > 0
                                  ? `${(option.distance_m / 1000).toFixed(1)} ק"מ מהאירוע`
                                  : option.address}
                              </p>
                            </div>
                            <div className="text-end">
                              <p className="font-semibold tabular-nums">{usd(option.price)}</p>
                              <p className="text-xs text-muted-foreground">לכל השהייה</p>
                            </div>
                          </div>
                        </OptionCard>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <OptionCard
                selected={hotelChoice.mode === "live"}
                onClick={() => setHotelChoice({ mode: "live" })}
              >
                <p className="text-sm font-medium">הלקוח יבחר מלון באתר</p>
                <p className="text-xs text-muted-foreground">
                  הלינק יפתח את שלב המלונות עם ההיצע החי סביב האירוע.
                </p>
              </OptionCard>
              <OptionCard
                selected={hotelChoice.mode === "none"}
                onClick={() => setHotelChoice({ mode: "none" })}
              >
                <p className="text-sm font-medium">חבילה ללא מלון</p>
                <p className="text-xs text-muted-foreground">הלקוח מסדר לינה לבד.</p>
              </OptionCard>
            </>
          )}
        </section>
      )}

      {/* Step 5 — review */}
      {step === 4 && event && selectedTicket && (
        <section className="max-w-xl space-y-4">
          <div className="divide-y rounded-2xl border bg-card shadow-card">
            <div className="p-4">
              <p className="text-xs text-muted-foreground">אירוע</p>
              <p className="mt-0.5 font-medium">{event.name}</p>
              <p className="text-xs text-muted-foreground">
                {[dateFmt(event.date), event.location_name].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">כרטיסים</p>
                <p className="mt-0.5 text-sm font-medium">
                  {qty} × {selectedTicket.category}
                </p>
              </div>
              <p className="font-semibold tabular-nums">{usd(selectedTicket.price * qty)}</p>
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">טיסה</p>
                <p className="mt-0.5 text-sm font-medium">
                  {flightChoice.mode === "none" && "ללא טיסה"}
                  {flightChoice.mode === "live" && "הלקוח יבחר באתר"}
                  {flightChoice.mode === "offline" && chosenFlight && (
                    <span dir="ltr">
                      {chosenFlight.airline_name} · {dateFmt(chosenFlight.outbound_departure_time)}–
                      {dateFmt(chosenFlight.inbound_departure_time)}
                    </span>
                  )}
                  {flightChoice.mode === "live-offer" && (
                    <span dir="ltr">
                      {flightChoice.offer.metadata?.name || flightChoice.offer.airline} ·{" "}
                      {dateFmt(flightChoice.offer.outbound.departureTime)}–
                      {dateFmt(flightChoice.offer.inbound.departureTime)}
                    </span>
                  )}
                </p>
              </div>
              {flightChoice.mode === "offline" && chosenFlight && (
                <p className="font-semibold tabular-nums">{usd(chosenFlight.price * qty)}</p>
              )}
              {flightChoice.mode === "live-offer" && (
                <p className="font-semibold tabular-nums">{usd(flightChoice.offer.price)}</p>
              )}
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">מלון</p>
                <p className="mt-0.5 text-sm font-medium">
                  {hotelChoice.mode === "none" && "ללא מלון"}
                  {hotelChoice.mode === "live" && "הלקוח יבחר באתר"}
                  {hotelChoice.mode === "offline" &&
                    hotels
                      .filter((h) => (selectedUnits[h.rowId] ?? 0) > 0)
                      .map((h) => `${selectedUnits[h.rowId]} × ${h.room_type} — ${h.hotel_name}`)
                      .join(", ")}
                  {hotelChoice.mode === "live-offer" &&
                    `${hotelChoice.option.name} · ${hotelChoice.option.room_name}`}
                </p>
              </div>
              {hotelChoice.mode === "offline" && (
                <p className="font-semibold tabular-nums">{usd(hotelTotal)}</p>
              )}
              {hotelChoice.mode === "live-offer" && (
                <p className="font-semibold tabular-nums">{usd(hotelChoice.option.price)}</p>
              )}
            </div>
            {selectedTicket.site_price != null && (
              <div className="flex items-center justify-between bg-muted/30 p-4">
                <p className="text-sm font-medium">מחיר חבילה משוער באתר</p>
                <p className="font-display text-lg font-bold tabular-nums">
                  {usd(selectedTicket.site_price * qty)}
                  <span className="ms-1 text-xs font-normal text-muted-foreground">
                    ({usd(selectedTicket.site_price)} לנוסע)
                  </span>
                </p>
              </div>
            )}
          </div>
          <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-card">
            <div>
              <p className="text-sm font-medium">הלקוח יכול לערוך את החבילה</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {allowEdit
                  ? "הלקוח יוכל להחליף כרטיסים, טיסה ומלון לפני התשלום."
                  : "החבילה נעולה — הלקוח משלם על ההרכב שבניתם. רכיב שהשארתם לבחירה חיה או שהתיישן עדיין ייבחר על ידו."}
              </p>
            </div>
            <Switch checked={allowEdit} onCheckedChange={setAllowEdit} />
          </div>
          <p className="text-xs text-muted-foreground">
            המחיר המשוער הוא מחיר החבילה הבסיסי באתר לקטגוריה שנבחרה; טיסה או מלון
            ספציפיים שהוצמדו עשויים להוסיף תוספת. הכל מאומת מחדש מול נתונים חיים בכל
            פתיחה של הלינק.
          </p>
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </section>
      )}

      {/* Footer nav */}
      {step > 0 && (
        <div className="flex items-center justify-between border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
            <ArrowRight className="h-4 w-4" />
            חזרה
          </Button>
          {step < 4 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && (!category || !selectedTicket)) ||
                (step === 3 && !canContinueFromHotel)
              }
            >
              המשך
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={submit}
              disabled={isPending}
              className={cn("px-6", MINT_CTA)}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              יצירת לינק לחבילה
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
