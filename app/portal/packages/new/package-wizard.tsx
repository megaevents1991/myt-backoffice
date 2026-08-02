"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Check,
  Copy,
  Loader2,
  Minus,
  Plane,
  Plus,
  Search,
  Star,
  Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createPreparedPackage,
  getPackageBuilderInventory,
  type BuilderEvent,
  type BuilderFlight,
  type BuilderHotelRoom,
} from "@/lib/actions/portal-package-actions";

type FlightChoice = { mode: "offline"; flightId: number } | { mode: "live" } | { mode: "none" };
type HotelChoice =
  | { mode: "offline"; units: Record<number, number> }
  | { mode: "live" }
  | { mode: "none" };

const STEPS = ["אירוע", "כרטיסים", "טיסה", "מלון", "סיכום"] as const;

function StepHeader({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border font-medium",
              i < step && "border-transparent bg-primary text-primary-foreground",
              i === step && "border-primary text-primary",
              i > step && "text-muted-foreground",
            )}
          >
            {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-semibold" : "text-muted-foreground")}>{label}</span>
          {i < STEPS.length - 1 && <span className="text-muted-foreground/50">—</span>}
        </li>
      ))}
    </ol>
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
        "w-full rounded-xl border p-4 text-start transition-colors",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {children}
    </button>
  );
}

const dateFmt = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("he-IL") : "";

const timeFmt = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : "";

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

export function PackageWizard({ events }: { events: BuilderEvent[] }) {
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
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return events.slice(0, 8);
    return events.filter((e) => e.name.toLowerCase().includes(term)).slice(0, 8);
  }, [events, query]);

  const selectEvent = (e: BuilderEvent) => {
    setEvent(e);
    setCategory(e.tickets[0]?.category ?? null);
    setFlightChoice({ mode: "live" });
    setHotelChoice({ mode: "live" });
    setStep(1);
    setInventoryLoading(true);
    getPackageBuilderInventory(e.id)
      .then((inv) => {
        setFlights(inv.flights);
        setHotels(inv.hotels);
      })
      .finally(() => setInventoryLoading(false));
  };

  const selectedTicket = event?.tickets.find((t) => t.category === category) ?? null;

  // Hotel rows grouped per hotel + date window — one group is one bookable combo.
  const hotelGroups = useMemo(() => {
    const groups = new Map<string, BuilderHotelRoom[]>();
    for (const room of hotels) {
      const key = `${room.hid ?? room.hotel_name}|${room.check_in}|${room.check_out}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(room);
    }
    return [...groups.values()];
  }, [hotels]);

  const selectedUnits = hotelChoice.mode === "offline" ? hotelChoice.units : {};
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

  const submit = () => {
    if (!event || !category) return;
    setError(null);
    startTransition(async () => {
      const result = await createPreparedPackage({
        eventId: event.id,
        category,
        qty,
        flight: flightChoice,
        hotel:
          hotelChoice.mode === "offline"
            ? {
                mode: "offline",
                units: Object.entries(selectedUnits).map(([rowId, count]) => ({
                  rowId: Number(rowId),
                  count,
                })),
              }
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

  // Success screen
  if (link) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
          <Check className="h-6 w-6 text-primary" />
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
          <Button type="button" onClick={copyLink} className="shrink-0">
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
              placeholder="חיפוש אירוע..."
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
                  <OptionCard selected={event?.id === e.id} onClick={() => selectEvent(e)}>
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[dateFmt(e.date), e.location_name].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.tickets.length > 0
                        ? `כרטיסים החל מ-${usd(Math.min(...e.tickets.map((t) => t.price)))}`
                        : "אין קטגוריות זמינות"}
                    </p>
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
                  <span className="font-semibold tabular-nums">{usd(t.price)}</span>
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
      {step === 2 && (
        <section className="space-y-3">
          {inventoryLoading ? (
            <div className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> טוען טיסות...
            </div>
          ) : (
            <>
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
      {step === 3 && (
        <section className="space-y-3">
          {inventoryLoading ? (
            <div className="flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> טוען מלונות...
            </div>
          ) : (
            <>
              {hotelGroups.map((group) => {
                const anchor = group[0];
                const groupKey = `${anchor.hid ?? anchor.hotel_name}|${anchor.check_in}|${anchor.check_out}`;
                const otherGroupSelected = selectedGroupKey !== null && selectedGroupKey !== groupKey;
                return (
                  <div
                    key={groupKey}
                    className={cn(
                      "rounded-xl border p-4",
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
          <div className="divide-y rounded-2xl border bg-card shadow-sm">
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
                </p>
              </div>
              {chosenFlight && (
                <p className="font-semibold tabular-nums">{usd(chosenFlight.price * qty)}</p>
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
                </p>
              </div>
              {hotelChoice.mode === "offline" && (
                <p className="font-semibold tabular-nums">{usd(hotelTotal)}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            המחירים כאן הם רכיבי החבילה. המחיר הסופי ללקוח נקבע באתר, כולל תמחור
            החבילה המלא — ומאומת מחדש מול נתונים חיים בכל פתיחה של הלינק.
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
            <Button type="button" onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              יצירת לינק לחבילה
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
