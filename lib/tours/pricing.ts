/**
 * Room compositions of an organized trip and what each one costs.
 *
 * A departure stores six per-person prices (the occupancy matrix). The customer
 * picks a room composition ("זוג + ילד") and sees one price for the room. The
 * formulas below were derived from what the WordPress site showed for the
 * departures that were live on 2026-10-01 and reproduce those room prices
 * exactly:
 *   double       = 2 x adult-in-double
 *   single       = adult-single
 *   adult + kid  = adult-in-double + second-kid
 *   couple + kid = 2 x adult-in-double + third-kid
 *   adult + 2 kids is priced like couple + kid (the first kid pays the adult price)
 *   every further person pays fourth-kid when it is set, else adult-in-double
 *
 * Pure functions, no I/O. The customer site carries the same table in
 * mega-family/scripts/sync-content.mjs - change both together.
 */
import type { PaxType } from "@/types/tours.types";

/** price by `${paxType}:${position}`, e.g. { "adult:2": 2145, "child:3": 1570 } */
export type PriceMatrix = Partial<Record<`${PaxType}:${number}`, number>>;

export interface RoomComposition {
  key: string;
  title: string;
  adults: number;
  children: number;
  /** Label printed in the order summary. */
  summaryLabel: string;
}

export const ROOM_COMPOSITIONS: RoomComposition[] = [
  { key: "double_room", title: "Double", adults: 2, children: 0, summaryLabel: "Double room" },
  { key: "single_room", title: "Single", adults: 1, children: 0, summaryLabel: "Single room" },
  { key: "adult_kid", title: "Adult + child", adults: 1, children: 1, summaryLabel: "Double room" },
  { key: "three_adults", title: "3 adults", adults: 3, children: 0, summaryLabel: "Triple room" },
  { key: "couple_kid", title: "Couple + child", adults: 2, children: 1, summaryLabel: "Triple room" },
  { key: "adult_2_kids", title: "Adult + 2 children", adults: 1, children: 2, summaryLabel: "Triple room" },
  { key: "couple_2_kids", title: "Couple + 2 children", adults: 2, children: 2, summaryLabel: "Quad room" },
  { key: "couple_3_kids", title: "Couple + 3 children", adults: 2, children: 3, summaryLabel: "Quintuple room" },
];

export function toPriceMatrix(rows: { pax_type: string; room_position: number; price: number }[]): PriceMatrix {
  const matrix: PriceMatrix = {};
  for (const r of rows) matrix[`${r.pax_type as PaxType}:${r.room_position}`] = Number(r.price);
  return matrix;
}

/** Price of the whole room for one composition, or null when the matrix cannot price it. */
export function roomPrice(key: string, m: PriceMatrix): number | null {
  const single = m["adult:1"];
  const double = m["adult:2"];
  const thirdAdult = m["adult:3"];
  const secondKid = m["child:2"];
  const thirdKid = m["child:3"];
  const extra = m["child:4"] ?? double;
  switch (key) {
    case "single_room":
      return single ?? null;
    case "double_room":
      return double != null ? 2 * double : null;
    case "adult_kid":
      return double != null && secondKid != null ? double + secondKid : null;
    case "three_adults":
      return double != null && thirdAdult != null ? 2 * double + thirdAdult : null;
    case "couple_kid":
    case "adult_2_kids":
      return double != null && thirdKid != null ? 2 * double + thirdKid : null;
    case "couple_2_kids":
      return double != null && thirdKid != null && extra != null ? 2 * double + thirdKid + extra : null;
    case "couple_3_kids":
      return double != null && thirdKid != null && extra != null ? 2 * double + thirdKid + 2 * extra : null;
    default:
      return null;
  }
}

export interface PricedRoom extends RoomComposition {
  price: number;
  /** Price after the fixed per-passenger discount, null when there is none. */
  priceSale: number | null;
  passengers: number;
}

/** Every composition the matrix can price, with the fixed per-passenger discount applied. */
export function pricedRooms(m: PriceMatrix, fixedDiscountPerPax = 0): PricedRoom[] {
  const out: PricedRoom[] = [];
  for (const c of ROOM_COMPOSITIONS) {
    const price = roomPrice(c.key, m);
    if (price === null) continue;
    const passengers = c.adults + c.children;
    out.push({
      ...c,
      price,
      priceSale: fixedDiscountPerPax > 0 ? price - fixedDiscountPerPax * passengers : null,
      passengers,
    });
  }
  return out;
}

/** The "from" price of a departure: per person in a double room, before and after the fixed discount. */
export function cardPrice(m: PriceMatrix, fixedDiscountPerPax = 0): { regular: number | null; offer: number | null } {
  const double = m["adult:2"];
  if (double == null) return { regular: null, offer: null };
  return fixedDiscountPerPax > 0
    ? { regular: double, offer: double - fixedDiscountPerPax }
    : { regular: null, offer: double };
}
