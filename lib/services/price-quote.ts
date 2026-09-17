// One pricing brain. Form buttons, creation auto-fill, the nightly sync and
// the factory all quote through here - the number is the same everywhere.
//
// Dor's rules (spec docs/superpowers/specs/2026-09-02-events-factory-design.md,
// units fixed 2026-09-07):
// - Flight: cheapest DIRECT + $100; but if the direct beats the cheapest
//   connection by more than $300, take the connection + $100. Amadeus is
//   queried for 1 adult, so this is already per person.
// - Hotel: cheapest 3-star (main's /api/hotels already filters star_rating=3)
//   PER PERSON + $120. main's /api/hotels prices a room for 2 adults for the
//   whole stay (`guests: [{ adults: 2 }]` there) while base_hotel_price is per
//   person (main compares `hotel.price / persons - base_hotel_price`), so the
//   room total is split by QUOTE_HOTEL_ADULTS first. Writing the room total
//   as the base doubled every hotel base the sync touched on 2026-09-07.
// - Base prices round to whole tens. Tickets keep their own "tens minus 1"
//   rule elsewhere - not here.
import { searchCheapestOffer } from "@/lib/services/flight-search";
import { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD } from "@/lib/services/price-margins";

// The margins live in a pure module the price light shares; re-exported so importers keep working.
export { FLIGHT_MARGIN_USD, HOTEL_MARGIN_USD };
/** Adults main's /api/hotels prices a room for - the per-person divisor. */
export const QUOTE_HOTEL_ADULTS = 2;
/** Direct costlier than this over the connection -> take the connection. */
export const DIRECT_GAP_USD = 300;
/**
 * Nightly sync: deviation at or above this updates the base price. Was $150
 * until 2026-09-07 - that dead-band left bases $80-$140 off the rule, which
 * on the site reads as "every flight is +" or "-220 on the hotel". The base
 * IS the rule now; $20 only absorbs the rounding-to-tens noise.
 */
export const SYNC_DEVIATION_USD = 20;
/** Nightly sync: a change bigger than this is frozen for manual review. */
export const SYNC_FREEZE_USD = 400;

export type QuoteResult = {
  /** The base price: raw + margin, rounded to tens. */
  price: number;
  /** Per-person market price before the margin. */
  raw: number;
  source: "direct" | "connection" | "hotel";
  /** Flight: what each search returned (null = no offer). */
  direct?: number | null;
  anyStops?: number | null;
  /** Hotel: the room total for QUOTE_HOTEL_ADULTS that `raw` was split from. */
  roomTotal?: number;
} | null;

export function round10(n: number): number {
  return Math.round(n / 10) * 10;
}

/** Cheapest direct wins unless it beats the connection by > $300. Pure. */
export function pickFlightPrice(
  direct: number | null,
  anyStops: number | null,
): { raw: number; source: "direct" | "connection" } | null {
  if (direct === null && anyStops === null) return null;
  if (direct === null) return { raw: anyStops as number, source: "connection" };
  if (anyStops !== null && direct - anyStops > DIRECT_GAP_USD)
    return { raw: anyStops, source: "connection" };
  return { raw: direct, source: "direct" };
}

/** Pure: the room-for-two total -> per-person base. */
export function hotelBaseFromRoomTotal(roomTotal: number): {
  perPerson: number;
  price: number;
} {
  const perPerson = roomTotal / QUOTE_HOTEL_ADULTS;
  return { perPerson, price: round10(perPerson + HOTEL_MARGIN_USD) };
}

/** One-line arithmetic for toasts, log notes and the price-changes screen. */
export function describeQuote(quote: NonNullable<QuoteResult>): string {
  const usd = (n: number) => `$${Math.round(n)}`;
  if (quote.source === "hotel") {
    const room = quote.roomTotal ?? quote.raw * QUOTE_HOTEL_ADULTS;
    return `3★ room ${usd(room)} ÷ ${QUOTE_HOTEL_ADULTS} = ${usd(quote.raw)}/person + $${HOTEL_MARGIN_USD} → ${usd(quote.price)}`;
  }
  if (quote.source === "direct") {
    return `direct ${usd(quote.raw)} + $${FLIGHT_MARGIN_USD} → ${usd(quote.price)}`;
  }
  const why =
    quote.direct == null
      ? "no direct offer"
      : `direct ${usd(quote.direct)} is over the $${DIRECT_GAP_USD} gap`;
  return `connection ${usd(quote.raw)} + $${FLIGHT_MARGIN_USD} → ${usd(quote.price)} (${why})`;
}

export async function quoteFlight(
  cityIata: string,
  departDate: string,
  returnDate: string,
): Promise<QuoteResult> {
  const [direct, anyStops] = await Promise.all([
    searchCheapestOffer({
      destinationLocationCode: cityIata,
      departureDate: departDate,
      returnDate,
      nonStop: true,
    }),
    searchCheapestOffer({
      destinationLocationCode: cityIata,
      departureDate: departDate,
      returnDate,
      nonStop: false,
    }),
  ]);
  const picked = pickFlightPrice(direct, anyStops);
  if (!picked) return null;
  return {
    price: round10(picked.raw + FLIGHT_MARGIN_USD),
    raw: picked.raw,
    source: picked.source,
    direct,
    anyStops,
  };
}

export async function quoteHotel(
  lat: number,
  lon: number,
  checkin: string,
  checkout: string,
): Promise<QuoteResult> {
  try {
    // Same upstream the /api/hotels/search proxy talks to - called directly so
    // the cron can quote server-side without a hop through our own route.
    const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL || "http://localhost:3000";
    const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
    const url = `${base}/api/hotels?lat=${lat}&lon=${lon}&checkin=${checkin}&checkout=${checkout}&secret=${secret}`;
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || "hotel search failed");
    const roomTotal = Number(data?.cheapest_price);
    if (!Number.isFinite(roomTotal) || roomTotal <= 0) return null;
    const { perPerson, price } = hotelBaseFromRoomTotal(roomTotal);
    return { price, raw: perPerson, source: "hotel", roomTotal };
  } catch (error) {
    console.error("price-quote: quoteHotel failed", JSON.stringify(error));
    return null;
  }
}
