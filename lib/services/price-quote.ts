// One pricing brain. Form buttons, creation auto-fill, the nightly sync and
// the factory all quote through here - the number is the same everywhere.
//
// Dor's rules (spec docs/superpowers/specs/2026-09-02-events-factory-design.md):
// - Flight: cheapest DIRECT + $100; but if the direct beats the cheapest
//   connection by more than $300, take the connection + $100.
// - Hotel: cheapest 3-star (main's /api/hotels already filters star_rating=3)
//   + $120.
// - Base prices round to whole tens. Tickets keep their own "tens minus 1"
//   rule elsewhere - not here.
import { searchCheapestOffer } from "@/lib/services/flight-search";

export const FLIGHT_MARGIN_USD = 100;
export const HOTEL_MARGIN_USD = 120;
/** Direct costlier than this over the connection -> take the connection. */
export const DIRECT_GAP_USD = 300;
/** Nightly sync: deviation at or above this updates the base price. */
export const SYNC_DEVIATION_USD = 150;
/** Nightly sync: a change bigger than this is frozen for manual review. */
export const SYNC_FREEZE_USD = 400;

export type QuoteResult = {
  price: number;
  raw: number;
  source: "direct" | "connection" | "hotel";
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
    const cheapest = Number(data?.cheapest_price);
    if (!Number.isFinite(cheapest) || cheapest <= 0) return null;
    return {
      price: round10(cheapest + HOTEL_MARGIN_USD),
      raw: cheapest,
      source: "hotel",
    };
  } catch (error) {
    console.error("price-quote: quoteHotel failed", JSON.stringify(error));
    return null;
  }
}
