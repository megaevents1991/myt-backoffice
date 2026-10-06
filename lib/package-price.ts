import type { EventTicket } from "@/types/app.types";
import { isTicketOnlyEvent } from "@/lib/package-mode";

/**
 * Main's pricing knobs, read from the SAME env names main uses
 * (NEXT_PUBLIC_MARKUP, NEXT_PUBLIC_HOTEL_SKIP_MARKUP_LOW/HIGH - see myt-main
 * lib/events/price.ts + app/order/hooks.tsx) with main's defaults. If those
 * are ever set on main's Vercel, set them HERE too - otherwise every
 * site_price the wizard shows silently diverges from checkout.
 */
const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const GLOBAL_MARKUP = num(process.env.NEXT_PUBLIC_MARKUP, 175);
const HOTEL_SKIP_MARKUP_LOW = num(
  process.env.NEXT_PUBLIC_HOTEL_SKIP_MARKUP_LOW,
  100,
);
const HOTEL_SKIP_MARKUP_HIGH = num(
  process.env.NEXT_PUBLIC_HOTEL_SKIP_MARKUP_HIGH,
  150,
);
/** Base-flight threshold separating LOW from HIGH hotel-skip fee (main hardcodes it). */
const HOTEL_SKIP_FLIGHT_THRESHOLD = 550;

export type PackagePriceEvent = {
  tickets_and_rates: EventTicket[] | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  event_additional_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
};

// Replicates main-app computePackagePrice: flight + hotel + min available
// ticket + markups (composed per-component when any markup_* set, else the
// global 175) + event_additional_markup. See myt-main lib/events/price.ts.
// Per-traveler USD, like main's - the order flow multiplies by pax.
// `ticketPrice` prices a SPECIFIC category instead of the cheapest one
// (main reaches the same number as min-based price + category delta).
export function computePackagePrice(
  event: PackagePriceEvent,
  ticketPrice?: number | null,
): number | null {
  const available = (event.tickets_and_rates || []).filter(
    (t) => t?.available !== false,
  );
  if (available.length === 0) return null;
  const ticket = ticketPrice ?? Math.min(...available.map((t) => t.price));
  const composed =
    event.markup_ticket != null ||
    event.markup_flight != null ||
    event.markup_hotel != null;
  const markup = composed
    ? (event.markup_ticket ?? 0) +
      (event.markup_flight ?? 0) +
      (event.markup_hotel ?? 0)
    : GLOBAL_MARKUP;
  return Math.round(
    (event.base_flight_price ?? 0) +
      (event.base_hotel_price ?? 0) +
      ticket +
      markup +
      (event.event_additional_markup ?? 0),
  );
}

export function hasAvailableTickets(
  event: Pick<PackagePriceEvent, "tickets_and_rates">,
): boolean {
  return (event.tickets_and_rates || []).some((t) => t?.available !== false);
}

export type SiteCardPriceEvent = PackagePriceEvent & {
  package_mode?: string | null;
  ticket_only_markup?: number | null;
  ready_package_token?: string | null;
  ready_package_mode?: string | null;
  ready_package_price_usd?: number | null;
};

/**
 * The price main's event CARD prints, branch for branch (its computePackagePrice,
 * myt-main lib/events/price.ts): an event that opens on its ready package (`live`)
 * costs what that package costs; a ticket-only event is its cheapest ticket + its own
 * Ticket-Only Markup - no bases, no package markup; everything else is the package
 * rule above. It is the number the product feed's price field carries, so it is the
 * number a creative must print: until 2026-10-06 creatives used the package rule
 * alone, and a ticket-only event's picture said ticket + 175 while the site charged
 * ticket + its markup (Stevie Wonder Hannover: $707 on the ad, $782 on the site).
 * A new branch in main's function belongs here too.
 */
export function siteCardPrice(event: SiteCardPriceEvent): number | null {
  const available = (event.tickets_and_rates || []).filter(
    (t) => t?.available !== false,
  );
  if (available.length === 0) return null;

  if (event.ready_package_token && event.ready_package_mode === "live") {
    const ready = Number(event.ready_package_price_usd);
    if (Number.isFinite(ready) && ready > 0) return Math.ceil(ready);
  }

  if (isTicketOnlyEvent(event)) {
    // Main's getTicketOnlyMarkup: a missing or unusable markup counts as 0.
    const raw = event.ticket_only_markup;
    const markup = raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : 0;
    return Math.ceil(Math.min(...available.map((t) => t.price)) + markup);
  }

  return computePackagePrice(event);
}

/** The pricing knobs a skip-aware per-person quote needs (no ticket list). */
export type PerPersonPricingFields = {
  base_flight_price: number | null;
  base_hotel_price: number | null;
  event_additional_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
  skip_flight?: boolean | null;
  skip_flight_markup?: number | null;
  skip_hotel_markup?: number | null;
  ticket_only_markup?: number | null;
};

export type PerPersonPriceInput = {
  /** The selected category's raw ticket price (live price for tx events). */
  ticketPrice: number;
  flightSkipped: boolean;
  hotelSkipped: boolean;
  /** Per-person upgrade delta vs the base (0 = at base / within the included band). */
  flightDelta?: number;
  hotelDelta?: number;
  /** Skip-fee reference per guest (Dor 24.8): the cheapest hotel available
   *  for the event (or the specific hotel that was removed). At or under the
   *  fee → the hotel-skip fee is waived entirely; above it → caps the fee.
   *  Mirrors main's hotelSkipRefPerGuest (app/order/hooks.tsx). Omit/null =
   *  unknown → the fee applies as before. */
  hotelSkipRefPerGuest?: number | null;
};

/**
 * Per-person package price the way main really charges it - a per-person
 * mirror of main's calculateBaseTotal (app/order/hooks.tsx), including the
 * skip paths the plain computePackagePrice above never sees:
 * - skipped flight drops base_flight_price and adds skip_flight_markup
 * - skipped hotel drops base_hotel_price and adds the hotel-skip fee
 *   (legacy: main's NEXT_PUBLIC_HOTEL_SKIP_MARKUP_LOW/HIGH pair - env-tunable
 *   there, mirrored here at the defaults: $100 under a $550 base flight, $150
 *   over; composed: the event's skip_hotel_markup)
 * - both skipped with ticket_only_markup set → exactly ticket + override
 * For a full package this reduces to computePackagePrice(category) + deltas.
 */
export function computePerPersonPackagePrice(
  event: PerPersonPricingFields,
  input: PerPersonPriceInput,
): number {
  const { ticketPrice, flightSkipped, hotelSkipped } = input;
  const flightDelta = input.flightDelta ?? 0;
  const hotelDelta = input.hotelDelta ?? 0;
  const hotelSkipRef = Number.isFinite(Number(input.hotelSkipRefPerGuest))
    ? Number(input.hotelSkipRefPerGuest)
    : null;
  // Waive/cap a hotel-skip fee by the reference hotel cost (main's rule).
  const applySkipRef = (fee: number): number =>
    hotelSkipRef != null
      ? hotelSkipRef <= fee
        ? 0
        : Math.min(fee, hotelSkipRef)
      : fee;

  const ticketOnly = Number(event.ticket_only_markup ?? NaN);
  if (
    flightSkipped &&
    hotelSkipped &&
    Number.isFinite(ticketOnly) &&
    ticketOnly >= 0
  ) {
    return Math.ceil(ticketPrice + ticketOnly);
  }

  const flightComponent = flightSkipped
    ? 0
    : (event.base_flight_price ?? 0) + flightDelta;
  const hotelComponent = hotelSkipped
    ? 0
    : (event.base_hotel_price ?? 0) + hotelDelta;
  const additional = event.event_additional_markup ?? 0;
  const skipFlightMarkup = Math.max(0, event.skip_flight_markup ?? 0);
  const skipHotelMarkup = Math.max(0, event.skip_hotel_markup ?? 0);

  const composed =
    event.markup_ticket != null ||
    event.markup_flight != null ||
    event.markup_hotel != null;
  if (composed) {
    const markup =
      (event.markup_ticket ?? 0) +
      additional +
      (flightSkipped ? skipFlightMarkup : (event.markup_flight ?? 0)) +
      (hotelSkipped ? applySkipRef(skipHotelMarkup) : (event.markup_hotel ?? 0));
    return Math.ceil(ticketPrice + markup + flightComponent + hotelComponent);
  }

  // Legacy: the global 175. A charged skip-flight markup suppresses the
  // hotel-skip fee (main's skipFlightMarkupAlreadyApplied), avoiding double margin.
  const chargedSkipFlight = flightSkipped ? skipFlightMarkup : 0;
  const suppressHotelFee =
    event.skip_flight === true && flightSkipped && skipFlightMarkup > 0;
  const hotelSkipFee =
    hotelSkipped && !suppressHotelFee
      ? applySkipRef(
          (event.base_flight_price ?? 0) < HOTEL_SKIP_FLIGHT_THRESHOLD
            ? HOTEL_SKIP_MARKUP_LOW
            : HOTEL_SKIP_MARKUP_HIGH,
        )
      : 0;
  return Math.ceil(
    ticketPrice +
      GLOBAL_MARKUP +
      additional +
      flightComponent +
      hotelComponent +
      chargedSkipFlight +
      hotelSkipFee,
  );
}

// Mirrors myt-main lib/events/price.ts isEventSoldOut. `lockedFlightSoldOut`
// is main's in-memory markLockedPackagesSoldOut flag - callers here derive it
// themselves (the backoffice reads `flights` directly) and pass it in.
export function isEventSoldOut(
  event: Pick<PackagePriceEvent, "tickets_and_rates"> & {
    tags?: string | null;
  },
  lockedFlightSoldOut = false,
): boolean {
  return (
    !hasAvailableTickets(event) || event.tags === "Sold" || lockedFlightSoldOut
  );
}
