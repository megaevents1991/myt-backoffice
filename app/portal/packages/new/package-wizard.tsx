"use client";

/**
 * The portal's package wizard, rebuilt to mirror myt-main's order flow
 * end-to-end (user: the agent must get the exact experience the site gives):
 * Stepper on top, main's step screens (ticket-step / flight-step / hotel-step /
 * review-step), and the sticky ContinueBar with slot pills + running
 * per-person total. State lives here and never unmounts across steps, so
 * edit-from-summary (returnToSummary) keeps every selection — main's model.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { BedDouble, Check, Copy, Plane, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createPreparedPackage,
  getLiveTicketOffers,
  getPackageBuilderInventory,
  searchLiveFlights,
  searchLiveHotels,
  type BuilderCommissionTerms,
  type BuilderEvent,
  type BuilderFlight,
  type BuilderHotelRoom,
  type LiveFlightOffer,
  type LiveHotelOption,
  type LiveTicketCategory,
} from "@/lib/actions/portal-package-actions";
import type { TixStockMatchableListing } from "@/lib/tixstock-map";
import {
  WizardContext,
  type FlightChoice,
  type HotelChoice,
  type WizardState,
} from "./wizard-context";
import {
  ContinueBar,
  dateOnly,
  deltaAmount,
  deltaNote,
  deltaVsBase,
  dateFmt,
  usd,
  WizardStepper,
  type ContinueSlot,
  type Delta,
} from "./wizard-ui";
import { TicketStep } from "./ticket-step";
import { FlightStep } from "./flight-step";
import { HotelStep } from "./hotel-step";
import { ReviewStep } from "./review-step";

const STEPS = ["אירוע", "כרטיסים", "טיסה", "מלון", "סיום"] as const;

const MINT_CTA =
  "rounded-full bg-brand-mint px-5 font-semibold text-brand-forest transition-all duration-200 hover:bg-brand-mint/90 hover:shadow-mint-glow active:scale-[0.98]";

export function PackageWizard({
  events,
  initialEventId,
  commissionTerms,
}: {
  events: BuilderEvent[];
  /** Deep entry from the unified packages page — lands straight on tickets. */
  initialEventId?: number;
  commissionTerms?: BuilderCommissionTerms | null;
}) {
  const [step, setStep] = useState(0);
  const [returnToSummary, setReturnToSummary] = useState(false);
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
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  // tx_event live pricing + dynamic map — mirrors main's ticket step.
  const [liveTix, setLiveTix] = useState<LiveTicketCategory[] | null>(null);
  const [tixListings, setTixListings] = useState<TixStockMatchableListing[]>([]);
  const [tixLoading, setTixLoading] = useState(false);
  const [tixError, setTixError] = useState<string | null>(null);
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);

  const isTx = event?.type === "tx_event";

  useEffect(() => {
    if (!event || event.type !== "tx_event" || !event.tix_event_id) {
      setLiveTix(null);
      setTixListings([]);
      setTixError(null);
      return;
    }
    let cancelled = false;
    setTixLoading(true);
    setTixError(null);
    getLiveTicketOffers({ eventId: event.id, qty })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setLiveTix(res.categories);
          setTixListings(
            res.listings.map((l) => ({
              id: l.id,
              seat_details: l.seat_details ?? {},
              proceed_price: (() => {
                const n = parseFloat(l.proceed_price?.amount ?? "");
                return Number.isFinite(n) ? n : null;
              })(),
            })),
          );
          setCategory((prev) =>
            prev && res.categories.some((c) => c.category === prev)
              ? prev
              : cheapestCategory(res.categories),
          );
        } else {
          setTixError(res.error);
        }
      })
      .catch(() => {
        if (!cancelled) setTixError("טעינת המחירים החיים נכשלה. נסו שוב.");
      })
      .finally(() => {
        if (!cancelled) setTixLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, event?.type, event?.tix_event_id, qty]);

  // Party size drives both searches — a qty change invalidates old results.
  useEffect(() => {
    setFsResults(null);
    setHsResults(null);
    setFlightChoice((prev) => (prev.mode === "live-offer" ? { mode: "live" } : prev));
    setHotelChoice((prev) => (prev.mode === "live-offer" ? { mode: "live" } : prev));
  }, [qty]);

  // Main scrolls to the top on every step change (OrderForm.tsx).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

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
    setCategory(cheapestCategory(e.tickets));
    setFlightChoice({ mode: "live" });
    setHotelChoice({ mode: "live" });
    setFsResults(null);
    setHsResults(null);
    setFsError(null);
    setHsError(null);
    setFsDepart(dateOnly(e.def_date_depart));
    setFsReturn(dateOnly(e.def_date_return));
    setHsCheckin("");
    setHsCheckout("");
    setReturnToSummary(false);
    setStep(1);
    setInventoryLoading(true);
    getPackageBuilderInventory(e.id)
      .then((inv) => {
        setFlights(inv.flights);
        setHotels(inv.hotels);
      })
      .catch(() => {
        setFlights([]);
        setHotels([]);
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

  // tx events price from the live feed; everything else from the event row.
  const activeTickets = useMemo(
    () => (isTx && liveTix ? liveTix : event?.tickets ?? []),
    [isTx, liveTix, event],
  );
  const selectedTicket = activeTickets.find((t) => t.category === category) ?? null;

  // ------- offline hotel mechanics (unchanged) -------
  const selectedUnits = useMemo<Record<number, number>>(
    () => (hotelChoice.mode === "offline" ? hotelChoice.units : {}),
    [hotelChoice],
  );

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
    hotelChoice.mode !== "offline" ||
    (Object.keys(selectedUnits).length > 0 && hotelCapacity >= qty);

  // ------- pricing: per-person deltas vs the site's package baselines -------
  const basePerPerson = event?.site_price ?? null;

  const ticketDelta: Delta | null =
    selectedTicket?.site_price != null && basePerPerson != null
      ? deltaVsBase(selectedTicket.site_price, basePerPerson)
      : null;

  const flightDelta: Delta | null = (() => {
    if (!event) return null;
    if (flightChoice.mode === "offline" && chosenFlight) {
      return deltaVsBase(chosenFlight.price, event.base_flight_price);
    }
    if (flightChoice.mode === "live-offer") {
      const offer = flightChoice.offer;
      const travelers = Math.max(1, offer.numOfTravelers || qty);
      return deltaVsBase(offer.price / travelers, event.base_flight_price);
    }
    return null;
  })();

  const hotelDelta: Delta | null = (() => {
    if (!event) return null;
    if (hotelChoice.mode === "offline" && hotelTotal > 0) {
      return deltaVsBase(hotelTotal / Math.max(1, qty), event.base_hotel_price);
    }
    if (hotelChoice.mode === "live-offer") {
      return deltaVsBase(hotelChoice.option.price / Math.max(1, qty), event.base_hotel_price);
    }
    return null;
  })();

  // Main's continue-bar preview: base + max(0, ticket) + flight + hotel deltas.
  const totalPerPerson = (() => {
    if (basePerPerson == null) return null;
    let total = basePerPerson + Math.max(0, ticketDelta ? deltaAmount(ticketDelta) : 0);
    if (flightDelta) total += deltaAmount(flightDelta);
    if (hotelDelta) total += deltaAmount(hotelDelta);
    return total;
  })();

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
      .catch(() => setFsError("החיפוש נכשל. נסו שוב."))
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
      .catch(() => setHsError("החיפוש נכשל. נסו שוב."))
      .finally(() => setHsLoading(false));
  };

  // ------- navigation -------
  const flowComplete = !!event && !!selectedTicket;

  const goNext = () => {
    if (returnToSummary && flowComplete) {
      setReturnToSummary(false);
      setStep(4);
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const editStep = (target: number) => {
    setReturnToSummary(true);
    setStep(target);
  };
  useEffect(() => {
    if (step === 4) setReturnToSummary(false);
  }, [step]);

  // ------- submit -------
  const submit = () => {
    if (!event || !category) return;
    setSubmitError(null);
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
      else setSubmitError(result.error);
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

  // ------- continue bar wiring -------
  const flightSlotValue = (() => {
    if (flightChoice.mode === "offline") return chosenFlight?.airline_name ?? null;
    if (flightChoice.mode === "live-offer") {
      return flightChoice.offer.metadata?.name || flightChoice.offer.airline;
    }
    if (flightChoice.mode === "none") return "ללא טיסה";
    return step > 2 || returnToSummary ? "הלקוח יבחר באתר" : null;
  })();
  const hotelSlotValue = (() => {
    if (hotelChoice.mode === "offline") {
      const names = [
        ...new Set(
          hotels.filter((h) => (selectedUnits[h.rowId] ?? 0) > 0).map((h) => h.hotel_name),
        ),
      ];
      return names[0] ?? null;
    }
    if (hotelChoice.mode === "live-offer") return hotelChoice.option.name;
    if (hotelChoice.mode === "none") return "ללא מלון";
    return step > 3 ? "הלקוח יבחר באתר" : null;
  })();

  const primaryDisabled =
    (step === 1 && !selectedTicket) || (step === 3 && !canContinueFromHotel);

  const slotTarget = (target: number): number | null => {
    if (target === step) return null;
    if (target < step) return target;
    if (target === step + 1 && !primaryDisabled) return target;
    return null;
  };

  const slots: ContinueSlot[] = [
    {
      key: "ticket",
      icon: Ticket,
      label: "כרטיס",
      value: selectedTicket ? `${qty} × ${selectedTicket.category}` : null,
      note: ticketDelta ? deltaNote(ticketDelta) : null,
      target: slotTarget(1),
    },
    {
      key: "flight",
      icon: Plane,
      label: "טיסה",
      value: flightSlotValue,
      note: flightDelta ? deltaNote(flightDelta) : null,
      target: slotTarget(2),
    },
    {
      key: "hotel",
      icon: BedDouble,
      label: "מלון",
      value: hotelSlotValue,
      note: hotelDelta ? deltaNote(hotelDelta) : null,
      target: slotTarget(3),
    },
  ];

  const primaryLabel = returnToSummary
    ? "שמור וחזור לסיכום"
    : step === 1
      ? "בחר והמשך לטיסה"
      : step === 2
        ? "בחר והמשך למלון"
        : "בחר והמשך לסיכום";

  const skip =
    step === 2
      ? {
          label: "דלג — הלקוח יבחר",
          action: () => {
            setFlightChoice({ mode: "live" });
            goNext();
          },
        }
      : step === 3
        ? {
            label: "דלג — הלקוח יבחר",
            action: () => {
              setHotelChoice({ mode: "live" });
              goNext();
            },
          }
        : null;

  // ------- context value -------
  const wizardState: WizardState = {
    step,
    setStep,
    goNext,
    goBack,
    returnToSummary,
    events,
    event,
    selectEvent,
    qty,
    setQty,
    category,
    setCategory,
    activeTickets,
    selectedTicket,
    isTx,
    liveTix,
    tixListings,
    tixLoading,
    tixError,
    hoveredCat,
    setHoveredCat,
    flights,
    hotels,
    inventoryLoading,
    flightChoice,
    setFlightChoice,
    fsDepart,
    setFsDepart,
    fsReturn,
    setFsReturn,
    fsLoading,
    fsError,
    fsResults,
    runFlightSearch,
    hotelChoice,
    setHotelChoice,
    selectedUnits,
    setUnitCount,
    hotelCapacity,
    hotelTotal,
    hsCheckin,
    setHsCheckin,
    hsCheckout,
    setHsCheckout,
    hsLoading,
    hsError,
    hsResults,
    runHotelSearch,
    defaultHotelDates,
    basePerPerson,
    ticketDelta,
    flightDelta,
    hotelDelta,
    totalPerPerson,
    commissionTerms: commissionTerms ?? null,
    allowEdit,
    setAllowEdit,
    submit,
    isPending,
    submitError,
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
    <WizardContext.Provider value={wizardState}>
      <div className="space-y-4">
        <WizardStepper
          steps={STEPS}
          current={step}
          locked={returnToSummary}
          onStepClick={(i) => setStep(i)}
        />

        {/* Step 0 — event picker */}
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
                    <button
                      type="button"
                      onClick={() => selectEvent(e)}
                      className={cn(
                        "w-full rounded-xl border-2 bg-card p-3 text-start shadow-lg transition-shadow hover:shadow-xl hover:outline hover:outline-2 hover:outline-offset-[-2px] hover:outline-brand-forest",
                        event?.id === e.id ? "border-brand-forest bg-brand-mint/10" : "border-border",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {e.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={e.image_url}
                            alt=""
                            className="size-12 shrink-0 rounded-full border-2 border-white object-cover object-top shadow-md"
                          />
                        ) : (
                          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Ticket className="h-5 w-5 text-muted-foreground" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{e.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {[dateFmt(e.date), e.location_name].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        {e.site_price != null && (
                          <span className="shrink-0 text-sm font-bold tabular-nums">
                            {usd(e.site_price)}
                            <span className="ms-1 block text-end text-xs font-normal text-muted-foreground">
                              לנוסע
                            </span>
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {step === 1 && <TicketStep />}
        {step === 2 && <FlightStep />}
        {step === 3 && <HotelStep />}
        {step === 4 && <ReviewStep editStep={editStep} />}

        {/* Sticky continue bar — steps 1-3, exactly like main */}
        {step >= 1 && step <= 3 && (
          <ContinueBar
            slots={slots}
            totalPerPerson={totalPerPerson}
            onSlotClick={(target) => {
              if (target < step) setStep(target);
              else if (target === step + 1 && !primaryDisabled) goNext();
            }}
            primaryLabel={primaryLabel}
            primaryDisabled={primaryDisabled}
            onPrimary={goNext}
            skipLabel={skip?.label ?? null}
            onSkip={skip?.action}
          />
        )}
      </div>
    </WizardContext.Provider>
  );
}

/** Cheapest category by site price (falls back to raw price), like main. */
function cheapestCategory(
  tickets: { category: string; price: number; site_price: number | null }[],
): string | null {
  if (tickets.length === 0) return null;
  return tickets.reduce((min, t) =>
    (t.site_price ?? t.price) < (min.site_price ?? min.price) ? t : min,
  ).category;
}
