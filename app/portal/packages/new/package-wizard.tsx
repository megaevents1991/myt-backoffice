"use client";

/**
 * The portal's package wizard, rebuilt to mirror myt-main's order flow
 * end-to-end (user: the agent must get the exact experience the site gives):
 * Stepper on top, main's step screens (ticket-step / flight-step / hotel-step /
 * review-step), and the sticky ContinueBar with slot pills + running
 * per-person total. State lives here and never unmounts across steps, so
 * edit-from-summary (returnToSummary) keeps every selection - main's model.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BedDouble, Plane, Search, Ticket } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { computePerPersonPackagePrice } from "@/lib/package-price";
import {
  createPreparedPackage,
  updatePreparedPackage,
  getAgentOrderHandoffLink,
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
  type TopFlightCandidate,
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
  type ContinueSecondaryAction,
  type ContinueSlot,
  type Delta,
} from "./wizard-ui";
import { TicketStep } from "./ticket-step";
import { FlightStep } from "./flight-step";
import { HotelStep } from "./hotel-step";
import { ReviewStep } from "./review-step";

const STEPS = ["אירוע", "כרטיסים", "טיסה", "מלון", "סיום"] as const;

export function PackageWizard({
  events,
  initialEventId,
  commissionTerms,
  isAgent = false,
}: {
  events: BuilderEvent[];
  /** Deep entry from the unified packages page - lands straight on tickets. */
  initialEventId?: number;
  commissionTerms?: BuilderCommissionTerms | null;
  /** Agents also get "order for the customer" + "send offer" on the success screen. */
  isAgent?: boolean;
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
  // Ticket-first flow (Dor, 2026-09-06): every build starts with flight and
  // hotel OFF ("ללא"), so picking a ticket lands straight on the summary.
  // A flight or hotel is added from there (the summary's +להוספה chips or
  // the bar pills), never walked through by default.
  const [flightChoice, setFlightChoice] = useState<FlightChoice>({ mode: "none" });
  const [hotelChoice, setHotelChoice] = useState<HotelChoice>({ mode: "none" });
  // What each step is currently showing FIRST - "בחר והמשך" picks it when the
  // agent tapped nothing (2026-08-31: continuing without a tap used to keep
  // the silent "live" default, so a "full" build saved with no flight/hotel
  // and its link dropped the customer back onto the flight step).
  const [topFlightCandidate, setTopFlightCandidate] =
    useState<TopFlightCandidate | null>(null);
  const [topHotelCandidate, setTopHotelCandidate] =
    useState<LiveHotelOption | null>(null);
  const [allowEdit, setAllowEdit] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [handoffPending, startHandoffTransition] = useTransition();
  // V2 summary: price adjustment per traveller (positive = extra commission,
  // negative = discount out of the commission). Reaches the customer through
  // the quote link/PDF only - the plain package link always prices live.
  const [adjustPerPerson, setAdjustPerPerson] = useState(0);

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

  // tx_event live pricing + dynamic map - mirrors main's ticket step.
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

  // Party size drives both searches - a qty change invalidates old results.
  // A dropped live-offer also cancels edit-from-summary (main clears the
  // flight/hotel on a quantity change and walks the flow normally), so the
  // agent re-decides on the affected step instead of silently losing the pick.
  useEffect(() => {
    searchQtyRef.current = qty;
    setFsResults(null);
    setHsResults(null);
    // An in-flight search for the old qty will drop its response (stale
    // guard), so its finally never runs - stop the spinners here.
    setFsLoading(false);
    setHsLoading(false);
    if (flightChoice.mode === "live-offer") setFlightChoice({ mode: "live" });
    if (hotelChoice.mode === "live-offer") setHotelChoice({ mode: "live" });
    if (flightChoice.mode === "live-offer" || hotelChoice.mode === "live-offer") {
      setReturnToSummary(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  // Snap to the top instantly on step change - the step body's entrance
  // animation carries the transition; smooth-scrolling under freshly-swapped
  // content made the page slide beneath it (and was a vestibular trigger).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
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

  // Guards the inventory load against a quick event re-pick: only the LAST
  // selected event's response may land (stale flights/hotels used to win).
  const activeEventIdRef = useRef<number | null>(null);
  // Same guard for party size: a live search issued for qty=2 must not land
  // after the agent bumped to 4 mid-flight (Amadeus can take ~30s) - its
  // offers are priced and seated for the old party, and the qty-change effect
  // just cleared the lists on purpose.
  const searchQtyRef = useRef<number>(2);
  // V2 auto-build: the composition signature last sent to the server - the
  // step-4 effect submits only when it changes (create once, then updates).
  const lastSubmittedSigRef = useRef<string | null>(null);
  // One auto-search attempt per (event, qty, dates) key - a failed search must
  // not retry in a loop; the agent can still hit the search button manually.
  const autoFsKeyRef = useRef<string | null>(null);
  const autoHsKeyRef = useRef<string | null>(null);

  const selectEvent = (e: BuilderEvent) => {
    activeEventIdRef.current = e.id;
    // Picking a DIFFERENT event starts a NEW package - never silently
    // repoint a link that may already be in a customer's hands.
    if (event && event.id !== e.id) {
      setLink(null);
      setCreatedId(null);
      lastSubmittedSigRef.current = null;
    }
    setAdjustPerPerson(0);
    setEvent(e);
    setCategory(cheapestCategory(e.tickets));
    // Every build starts with both parts OFF, so the summary is one step away.
    setFlightChoice({ mode: "none" });
    setHotelChoice({ mode: "none" });
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
        if (activeEventIdRef.current !== e.id) return;
        setFlights(inv.flights);
        setHotels(inv.hotels);
        // A locked package sells exactly one flight - pin it up front, the way
        // main's flight step auto-picks it. The seat guard on the flight step
        // still blocks continuing if the party outgrows the seats left.
        if (e.locked_flight_id != null) {
          const locked = inv.flights.find((f) => f.id === e.locked_flight_id);
          if (locked) setFlightChoice({ mode: "offline", flightId: locked.id });
        }
      })
      .catch(() => {
        if (activeEventIdRef.current !== e.id) return;
        setFlights([]);
        setHotels([]);
      })
      .finally(() => {
        if (activeEventIdRef.current !== e.id) return;
        setInventoryLoading(false);
      });
  };

  // ?event= deep entry: skip the search step when the event is buildable.
  // Runs once - a later manual "build another" must not snap back here.
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

  // Cheapest hotel available for this event, per guest - the hotel-skip-fee
  // reference (Dor 24.8, mirrors main's hotelSkipRefPerGuest): a market at or
  // under the fee waives it, above it caps it. Live search results when the
  // agent ran one, offline inventory rooms otherwise; null → fee as before.
  const hotelSkipRefPerGuest = (() => {
    let min = Infinity;
    for (const o of hsResults ?? []) {
      const per = o.price / Math.max(1, qty);
      if (Number.isFinite(per) && per > 0) min = Math.min(min, per);
    }
    for (const room of hotels) {
      if (room.capacity > 0 && room.remaining > 0) {
        const per = room.price / room.capacity;
        if (Number.isFinite(per) && per > 0) min = Math.min(min, per);
      }
    }
    return Number.isFinite(min) ? min : null;
  })();

  // The price main really charges, per person - calculateBaseTotal's mirror.
  // For a full package this equals base + ticket/flight/hotel deltas; skipped
  // components drop their base and charge the skip fee instead (the additive
  // preview used to overstate no-flight/no-hotel packages by the base price).
  const totalPerPerson = (() => {
    if (!event) return null;
    if (!selectedTicket) return basePerPerson;
    return computePerPersonPackagePrice(event, {
      ticketPrice: selectedTicket.price,
      flightSkipped: flightChoice.mode === "none",
      hotelSkipped: hotelChoice.mode === "none",
      flightDelta: flightDelta ? deltaAmount(flightDelta) : 0,
      hotelDelta: hotelDelta ? deltaAmount(hotelDelta) : 0,
      hotelSkipRefPerGuest,
    });
  })();

  // ------- live searches -------
  const runFlightSearch = () => {
    if (!event) return;
    const forEventId = event.id;
    const forQty = qty;
    setFsLoading(true);
    setFsError(null);
    const stale = () =>
      activeEventIdRef.current !== forEventId || searchQtyRef.current !== forQty;
    searchLiveFlights({
      eventId: forEventId,
      departureDate: fsDepart,
      returnDate: fsReturn,
      adults: qty,
    })
      .then((res) => {
        if (stale()) return;
        if (res.ok) {
          setFsResults(res.flights);
          if (res.flights.length === 0) setFsError("לא נמצאו טיסות לתאריכים האלה");
        } else {
          setFsError(res.error);
        }
      })
      .catch(() => {
        if (stale()) return;
        setFsError("החיפוש נכשל. נסו שוב.");
      })
      .finally(() => {
        if (stale()) return;
        setFsLoading(false);
      });
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

  const runHotelSearch = (opts?: { query?: string }) => {
    if (!event) return;
    const forEventId = event.id;
    const forQty = qty;
    setHsLoading(true);
    setHsError(null);
    const stale = () =>
      activeEventIdRef.current !== forEventId || searchQtyRef.current !== forQty;
    searchLiveHotels({
      eventId: forEventId,
      checkin: hsCheckin,
      checkout: hsCheckout,
      travelers: qty,
      query: opts?.query,
    })
      .then((res) => {
        if (stale()) return;
        if (res.ok) {
          if (opts?.query) {
            // Name search digs through the FULL serp result - merge its hits
            // into the loaded list (dedup by key) so clearing the filter still
            // shows the default result set.
            setHsResults((prev) => {
              const seen = new Set((prev ?? []).map((o) => o.key));
              return [
                ...(prev ?? []),
                ...res.options.filter((o) => !seen.has(o.key)),
              ];
            });
            if (res.options.length === 0)
              setHsError("המלון הזה לא נמצא בהיצע החי סביב האירוע לתאריכים שנבחרו");
          } else {
            setHsResults(res.options);
            if (res.options.length === 0) setHsError("לא נמצאו מלונות לתאריכים האלה");
          }
        } else {
          setHsError(res.error);
        }
      })
      .catch(() => {
        if (stale()) return;
        setHsError("החיפוש נכשל. נסו שוב.");
      })
      .finally(() => {
        if (stale()) return;
        setHsLoading(false);
      });
  };

  // ------- navigation -------
  // A pinned offline flight must still seat the whole party (qty can grow
  // after the pick - offline choices deliberately survive a qty change).
  const flightSeatsOk =
    flightChoice.mode !== "offline" || (chosenFlight != null && chosenFlight.remaining >= qty);

  // Edit-from-summary may shortcut back only while EVERY step is still
  // satisfied - main's flowComplete check. A choice a qty change invalidated
  // walks the flow normally so its step's guard can catch it.
  const flowStillValid =
    !!event && !!selectedTicket && flightSeatsOk && canContinueFromHotel;

  // The next step that still needs the agent. A flight or hotel at "ללא"
  // (the default, or the bar's skip shortcut) is settled - stepping forward
  // from the ticket lands on the summary, not on "בחר והמשך לטיסה". Both
  // stay addable: the bar pill of a settled step walks onto it explicitly.
  const nextUnresolvedStep = (from: number): number => {
    let next = from + 1;
    if (next === 2 && flightChoice.mode === "none") next = 3;
    if (next === 3 && hotelChoice.mode === "none") next = 4;
    return Math.min(4, next);
  };

  const goNext = () => {
    if (returnToSummary && flowStillValid) {
      setReturnToSummary(false);
      setStep(4);
      return;
    }
    // "בחר והמשך" does what it says (2026-08-31): continuing past the flight
    // or hotel step with nothing tapped picks the offer the step is showing
    // first - the highlighted card already reads as chosen, and the silent
    // "live" default meant a "full" build saved with no flight/hotel and its
    // link dropped the customer onto the flight step ("שולח להתחלה").
    // "הלקוח יבחר באתר" and "ללא" remain explicit choices, and both survive
    // this untouched (explicit flag / mode "none").
    if (
      step === 2 &&
      flightChoice.mode === "live" &&
      !flightChoice.explicit &&
      topFlightCandidate
    ) {
      setFlightChoice(
        topFlightCandidate.kind === "offline"
          ? { mode: "offline", flightId: topFlightCandidate.flightId }
          : { mode: "live-offer", offer: topFlightCandidate.offer },
      );
    }
    if (
      step === 3 &&
      hotelChoice.mode === "live" &&
      !hotelChoice.explicit &&
      topHotelCandidate
    ) {
      setHotelChoice({ mode: "live-offer", option: topHotelCandidate });
    }
    setStep(nextUnresolvedStep(step));
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const editStep = (target: number) => {
    setReturnToSummary(true);
    setStep(target);
  };
  useEffect(() => {
    if (step === 4) setReturnToSummary(false);
  }, [step]);

  // ------- submit (V2: auto-build on the summary; edits UPDATE the row) -------
  // What identifies a composition - when this changes on the summary, the
  // package row is (re)written. allowEdit is part of it so flipping the lock
  // syncs too. hotelSkipRefPerGuest is data-derived, not a choice - excluded.
  const compositionSig = JSON.stringify({
    e: event?.id ?? null,
    c: category,
    q: qty,
    ae: allowEdit,
    // The price change is part of the composition since 2026-08-30 (doc item
    // 4): it is stored ON the package, so changing it must re-sync the row -
    // otherwise the link keeps quoting the old price.
    adj: adjustPerPerson,
    f:
      flightChoice.mode === "offline"
        ? ["offline", flightChoice.flightId]
        : flightChoice.mode === "live-offer"
          ? ["live-offer", flightChoice.offer.id]
          : [flightChoice.mode],
    h:
      hotelChoice.mode === "offline"
        ? ["offline", selectedUnits]
        : hotelChoice.mode === "live-offer"
          ? ["live-offer", hotelChoice.option.key]
          : [hotelChoice.mode],
  });

  const submit = () => {
    if (!event || !category) return;
    setSubmitError(null);
    lastSubmittedSigRef.current = compositionSig;
    startTransition(async () => {
      const input = {
        eventId: event.id,
        category,
        qty,
        allowEdit,
        hotelSkipRefPerGuest,
        priceAdjustPerPerson: adjustPerPerson,
        flight:
          flightChoice.mode === "live-offer"
            ? ({ mode: "live-offer", offer: flightChoice.offer } as const)
            : flightChoice,
        hotel:
          hotelChoice.mode === "offline"
            ? ({
                mode: "offline",
                units: Object.entries(selectedUnits).map(([rowId, count]) => ({
                  rowId: Number(rowId),
                  count,
                })),
              } as const)
            : hotelChoice.mode === "live-offer"
              ? ({ mode: "live-offer", offer: hotelChoice.option.snapshot } as const)
              : hotelChoice,
      };
      const result =
        createdId != null
          ? await updatePreparedPackage(createdId, input)
          : await createPreparedPackage(input);
      if (result.ok) {
        setLink(result.link);
        setCreatedId(result.packageId);
      } else {
        // Allow a manual retry (and the effect to re-fire after a change).
        lastSubmittedSigRef.current = null;
        setSubmitError(result.error);
      }
    });
  };

  // Auto-build: entering the summary (or changing the composition on it)
  // creates/updates the package - no "יצירת לינק" button anymore (V2 spec:
  // "לינק יבנה אוטמטי").
  useEffect(() => {
    if (step !== 4 || !event || !selectedTicket || isPending) return;
    if (lastSubmittedSigRef.current === compositionSig) return;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, compositionSig, isPending, !!event, !!selectedTicket]);

  // Auto flight search: the flight step opens with results running (V2 spec:
  // "שכבר יופיעו התוצאות") - dates are preseeded from the event. One attempt
  // per key; the manual search button still works after a failure.
  useEffect(() => {
    if (step !== 2 || !event || event.locked_flight_id != null) return;
    if (!fsDepart || !fsReturn) return;
    if (fsResults != null || fsLoading) return;
    const key = `${event.id}|${qty}|${fsDepart}|${fsReturn}`;
    if (autoFsKeyRef.current === key) return;
    autoFsKeyRef.current = key;
    runFlightSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, event?.id, qty, fsDepart, fsReturn, fsResults, fsLoading]);

  // Auto hotel search: same for the hotel step - seed the dates first (the
  // state lands next render, which re-runs this effect into the search).
  useEffect(() => {
    if (step !== 3 || !event) return;
    if (hsResults != null || hsLoading) return;
    if (!hsCheckin || !hsCheckout) {
      const d = defaultHotelDates();
      if (!d.checkin || !d.checkout) return;
      setHsCheckin(d.checkin);
      setHsCheckout(d.checkout);
      return;
    }
    const key = `${event.id}|${qty}|${hsCheckin}|${hsCheckout}`;
    if (autoHsKeyRef.current === key) return;
    autoHsKeyRef.current = key;
    runHotelSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, event?.id, qty, hsCheckin, hsCheckout, hsResults, hsLoading]);

  const copyLink = async (override?: string) => {
    const value = override ?? link;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // "הזמן" - popup-blocker-safe: open the window synchronously, fill in the
  // short-lived handoff URL once it's minted (same pattern as the packages
  // list). Lands on main's order flow with a live partner session, where the
  // agent screen (אשראי סוכן / שובר / לינק תשלום) is already open.
  const orderForCustomer = () => {
    if (createdId == null) return;
    const win = window.open("about:blank", "_blank");
    startHandoffTransition(async () => {
      const result = await getAgentOrderHandoffLink(createdId);
      if (!result.ok) {
        win?.close();
        setSubmitError(result.error);
        return;
      }
      if (win) win.location.href = result.url;
      else window.open(result.url, "_blank");
    });
  };

  const resetWizard = () => {
    setLink(null);
    setCreatedId(null);
    setSubmitError(null);
    setAdjustPerPerson(0);
    lastSubmittedSigRef.current = null;
    setStep(0);
    setEvent(null);
    setQuery("");
  };

  // ------- continue bar wiring -------
  const flightSlotValue = (() => {
    if (flightChoice.mode === "offline") return chosenFlight?.airline_name ?? null;
    if (flightChoice.mode === "live-offer") {
      return flightChoice.offer.metadata?.name || flightChoice.offer.airline;
    }
    if (flightChoice.mode === "none") return "ללא טיסה";
    // "live": fills on an explicit pick right away; a silent default fills
    // only once the flight step is behind us.
    return flightChoice.explicit || step > 2 || returnToSummary
      ? "הלקוח יבחר באתר"
      : null;
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
    return hotelChoice.explicit || step > 3 ? "הלקוח יבחר באתר" : null;
  })();

  const primaryDisabled =
    (step === 1 && !selectedTicket) ||
    (step === 2 && !flightSeatsOk) ||
    (step === 3 && !canContinueFromHotel) ||
    // While a search is still running and nothing is chosen yet, "בחר והמשך"
    // has nothing to choose - letting it through here is exactly how a "full"
    // build used to save with no flight/hotel (2026-08-31). An explicit
    // "הלקוח יבחר באתר" / "ללא" passes immediately.
    (step === 2 &&
      fsLoading &&
      flightChoice.mode === "live" &&
      !flightChoice.explicit) ||
    (step === 3 &&
      hsLoading &&
      hotelChoice.mode === "live" &&
      !hotelChoice.explicit);

  // Pills: back to a done step, forward to the next unresolved step (the
  // primary CTA's twin), or onto a settled "ללא" step in between to add that
  // part after all. Never past the next unresolved step.
  const slotTarget = (target: number): number | null => {
    if (target === step) return null;
    if (target < step) return target;
    if (primaryDisabled) return null;
    return target <= nextUnresolvedStep(step) ? target : null;
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

  // "Save & return" only while the shortcut is really taken (main's
  // editReturnActive) - an edit that invalidated a later step walks forward.
  // The label names where "בחר והמשך" actually lands - a settled flight/hotel
  // ("ללא") is folded in, so a ticket-only build reads "בחר והמשך לסיכום".
  const primaryTarget = nextUnresolvedStep(step);
  const primaryLabel = returnToSummary && flowStillValid
    ? "שמור וחזור לסיכום"
    : primaryTarget === 2
      ? "בחר והמשך לטיסה"
      : primaryTarget === 3
        ? "בחר והמשך למלון"
        : "בחר והמשך לסיכום";

  // V2 bar shortcuts (2026-08-27): each step's bar answers ITS OWN skip
  // question only - tickets/flights offer "ללא טיסה", hotels offer "ללא מלון".
  // The "הלקוח יבחר באתר" decision moved into the steps themselves as a
  // pinned option row above the live results. Mid-edit (returnToSummary) a
  // shortcut returns to the summary once the rest of the flow is valid.
  const skipFlight = () => {
    setFlightChoice({ mode: "none" });
    if (returnToSummary && !!event && !!selectedTicket && canContinueFromHotel) {
      setReturnToSummary(false);
      setStep(4);
      return;
    }
    setStep(3);
  };
  const skipHotel = () => {
    setHotelChoice({ mode: "none" });
    setStep(4); // the step-4 effect clears returnToSummary
  };

  const secondaryActions: ContinueSecondaryAction[] | null =
    // The ticket step has no skip to offer - flight and hotel already start
    // OFF. A locked package's flight is fixed - no flight skip to offer.
    step === 2 && event?.locked_flight_id == null
        ? [
            {
              label: "ללא טיסה",
              onClick: skipFlight,
              disabled: false,
            },
          ]
        : step === 3
          ? [
              {
                label: "ללא מלון",
                onClick: skipHotel,
                disabled: false,
              },
            ]
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
    setTopFlightCandidate,
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
    setTopHotelCandidate,
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
    link,
    createdId,
    copied,
    copyLink,
    orderForCustomer,
    handoffPending,
    isAgent,
    adjustPerPerson,
    setAdjustPerPerson,
    resetWizard,
  };

  return (
    <WizardContext.Provider value={wizardState}>
      <div className="space-y-4">
        <WizardStepper
          steps={STEPS}
          current={step}
          locked={returnToSummary}
          onStepClick={(i) => setStep(i)}
        />

        {/* Step 0 - event picker */}
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

        {/* key={step} remounts the wrapper so each step enters with a short
            fade+rise instead of a hard cut (the stepper dots already animate). */}
        <div
          key={step}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {step === 1 && <TicketStep />}
          {step === 2 && <FlightStep />}
          {step === 3 && <HotelStep />}
          {step === 4 && <ReviewStep editStep={editStep} />}
        </div>

        {/* Sticky continue bar - steps 1-3, exactly like main */}
        {step >= 1 && step <= 3 && (
          <ContinueBar
            // Edit-from-summary hides the flow pills - a focused "pick → save"
            // task, exactly like main's OrderForm.
            slots={returnToSummary ? [] : slots}
            totalPerPerson={totalPerPerson}
            qty={qty}
            onSlotClick={(target) => {
              if (target < step) setStep(target);
              else if (target === nextUnresolvedStep(step) && !primaryDisabled) goNext();
              // A settled "ללא" step ahead - open it to add that part.
              else if (target > step && target < nextUnresolvedStep(step) && !primaryDisabled)
                setStep(target);
            }}
            primaryLabel={primaryLabel}
            primaryDisabled={primaryDisabled}
            onPrimary={goNext}
            secondaryActions={secondaryActions}
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
