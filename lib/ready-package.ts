// Ready package ("חבילה מוכנה") - the pure rules. No DB, no fetch: runs under
// plain node via scripts/ready-package-selftest.ts.
// Spec: docs/superpowers/specs/2026-10-04-ready-package-design.md.
//
// A ready package is a house-built prepared package attached to an event. It
// stores the IDENTITY of each piece (`spec`) and one priced composition per
// party size (`variants`). A refresh looks the same pieces up again for every
// size; these functions say what "the same piece" means.

import {
  READY_PACKAGE_MODES,
  type ReadyFlightSpec,
  type ReadyHotelSpec,
  type ReadyPackageMode,
  type ReadyPackageSpec,
  type ReadyRefreshStatus,
  type ReadyVariants,
} from "../types/ready-package.types";

/** Top of the traveller picker when staff set nothing. */
export const READY_MAX_TRAVELERS_DEFAULT = 4;
/** The most a picker may offer - a bigger party is a group quote, not a click. */
export const READY_MAX_TRAVELERS_CAP = 6;

/** `events.ready_package_mode` as read: anything but a known mode is "off". */
export function readyMode(value: unknown): ReadyPackageMode {
  return (READY_PACKAGE_MODES as readonly string[]).includes(String(value))
    ? (value as ReadyPackageMode)
    : "off";
}

export function clampMaxTravelers(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return READY_MAX_TRAVELERS_DEFAULT;
  return Math.min(READY_MAX_TRAVELERS_CAP, n);
}

/** The sizes a refresh builds: 1..max. */
export function targetSizes(maxTravelers: number): number[] {
  const max = clampMaxTravelers(maxTravelers);
  return Array.from({ length: max }, (_, i) => i + 1);
}

/** The day of a supplier time as written - their local time, no timezone maths. */
export const isoDay = (value: string | null | undefined): string =>
  String(value ?? "").slice(0, 10);

/** A time down to the minute, as written ("2027-03-11T08:20"). */
const minuteKey = (value: string | null | undefined): string =>
  String(value ?? "").slice(0, 16);

const flightNo = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

export const hasMeal = (meal: string | null | undefined): boolean =>
  !!meal && meal !== "nomeal";

// ---------------------------------------------------------------------------
// Identity: what a stored composition says about its pieces
// ---------------------------------------------------------------------------

/** The part of main's `Flight` the identity reads. */
export type FlightLike = {
  isOffline?: boolean;
  offlineId?: number | null;
  airline?: string | null;
  price?: number | string;
  outbound?: { departureTime?: string; flightNumber?: string | null };
  inbound?: { departureTime?: string; flightNumber?: string | null };
  metadata?: { iata?: string | null; name?: string | null };
};

/** The part of main's `OrderHotel` the identity reads. */
export type HotelLike = {
  id?: string;
  name?: string;
  isOffline?: boolean;
  offlineId?: number | null;
  offlineIds?: number[] | null;
  checkin?: string;
  checkout?: string;
  rate?: { room_name?: string; meal?: string };
  hotelInformation?: { roomName?: string; hotelName?: string; stars?: number };
};

/**
 * null = the piece was left for the customer to pick live (not skipped, not
 * pinned). A ready package cannot carry one: there would be nothing to show.
 */
export function flightSpecOf(
  flight: FlightLike | null | undefined,
  skipped: boolean,
): ReadyFlightSpec | null {
  if (!flight) return skipped ? { mode: "none" } : null;
  if (flight.isOffline && flight.offlineId != null) {
    return { mode: "offline", offlineId: Number(flight.offlineId) };
  }
  const outbound = flight.outbound?.departureTime;
  const inbound = flight.inbound?.departureTime;
  if (!outbound || !inbound) return null;
  return {
    mode: "live",
    airline: flight.metadata?.iata || flight.airline || null,
    outboundFlightNumber: flight.outbound?.flightNumber || null,
    outboundDeparture: outbound,
    inboundFlightNumber: flight.inbound?.flightNumber || null,
    inboundDeparture: inbound,
    departureDate: isoDay(outbound),
    returnDate: isoDay(inbound),
  };
}

export function hotelSpecOf(
  hotel: HotelLike | null | undefined,
  skipped: boolean,
): ReadyHotelSpec | null {
  if (!hotel) return skipped ? { mode: "none" } : null;
  if (hotel.isOffline) {
    const rowIds =
      hotel.offlineIds && hotel.offlineIds.length > 0
        ? hotel.offlineIds.map(Number)
        : hotel.offlineId != null
          ? [Number(hotel.offlineId)]
          : [];
    return rowIds.length > 0 ? { mode: "offline", rowIds } : null;
  }
  if (!hotel.id || !hotel.checkin || !hotel.checkout) return null;
  return {
    mode: "live",
    hotelId: hotel.id,
    roomName: hotel.rate?.room_name || hotel.hotelInformation?.roomName || "",
    meal: hotel.rate?.meal || "nomeal",
    checkin: hotel.checkin,
    checkout: hotel.checkout,
  };
}

export type CompositionLike = {
  event_order_info: { id?: string | null; category?: string } | null;
  flight_order_info: FlightLike | null;
  flight_skipped: boolean;
  hotel_order_info: HotelLike | null;
  hotel_skipped: boolean;
  num_travelers: number;
};

export type SpecResult =
  | { ok: true; spec: ReadyPackageSpec }
  | { ok: false; error: string };

/** The identity of a prepared package's pieces, or why it cannot become a ready package. */
export function specFromComposition(row: CompositionLike): SpecResult {
  const category = row.event_order_info?.category;
  if (!category) return { ok: false, error: "The package has no ticket." };
  const flight = flightSpecOf(row.flight_order_info, row.flight_skipped);
  if (!flight) {
    return {
      ok: false,
      error:
        "The flight was left for the customer to pick. A ready package needs a chosen flight, or an explicit \"no flight\".",
    };
  }
  const hotel = hotelSpecOf(row.hotel_order_info, row.hotel_skipped);
  if (!hotel) {
    return {
      ok: false,
      error:
        "The hotel was left for the customer to pick. A ready package needs a chosen hotel, or an explicit \"no hotel\".",
    };
  }
  return {
    ok: true,
    spec: {
      ticket: { id: row.event_order_info?.id ?? null, category },
      flight,
      hotel,
      defaultTravelers: Math.max(1, Math.floor(Number(row.num_travelers) || 1)),
    },
  };
}

// ---------------------------------------------------------------------------
// Matching: the same piece, in a fresh search
// ---------------------------------------------------------------------------

/**
 * The same flight in a fresh search. Offline: the same inventory row. Live:
 * both legs leave at the same minute, and wherever both sides know a flight
 * number it is the same one. Several fares of one flight -> the cheapest.
 */
export function matchFlight<T extends FlightLike>(
  spec: ReadyFlightSpec,
  offers: T[],
): T | null {
  if (spec.mode === "none") return null;
  if (spec.mode === "offline") {
    return (
      offers.find(
        (o) => o.isOffline === true && Number(o.offlineId) === spec.offlineId,
      ) ?? null
    );
  }
  const sameNumber = (a: string | null, b: string | null | undefined) =>
    !a || !b || flightNo(a) === flightNo(b);
  const same = offers.filter(
    (o) =>
      o.isOffline !== true &&
      minuteKey(o.outbound?.departureTime) === minuteKey(spec.outboundDeparture) &&
      minuteKey(o.inbound?.departureTime) === minuteKey(spec.inboundDeparture) &&
      sameNumber(spec.outboundFlightNumber, o.outbound?.flightNumber) &&
      sameNumber(spec.inboundFlightNumber, o.inbound?.flightNumber),
  );
  if (same.length === 0) return null;
  return [...same].sort((a, b) => Number(a.price ?? 0) - Number(b.price ?? 0))[0];
}

/** The part of a hotel search option the match reads (LiveHotelOption has all of it). */
export type HotelOptionLike = {
  room_name: string;
  meal: string;
  price: number;
  snapshot: { id?: unknown };
};

export type HotelMatch<T> = { option: T; note?: string };

const roomKey = (name: string | null | undefined): string =>
  String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]+/g, " ")
    .trim();

/**
 * The same hotel in a fresh search, in this order: the same room with the same
 * meal; any room with the same meal; (only when a meal was promised) any room
 * WITH a meal. A promised breakfast is never dropped - no meal on offer means
 * no match, and that size is reported instead of sold short.
 */
export function matchHotelOption<T extends HotelOptionLike>(
  spec: Extract<ReadyHotelSpec, { mode: "live" }>,
  options: T[],
): HotelMatch<T> | null {
  const ofHotel = options.filter((o) => String(o.snapshot?.id ?? "") === spec.hotelId);
  if (ofHotel.length === 0) return null;
  const cheapest = (list: T[]): T => [...list].sort((a, b) => a.price - b.price)[0];

  const sameMeal = ofHotel.filter((o) => (o.meal || "nomeal") === (spec.meal || "nomeal"));
  const sameRoom = sameMeal.filter((o) => roomKey(o.room_name) === roomKey(spec.roomName));
  if (sameRoom.length > 0) return { option: cheapest(sameRoom) };
  if (sameMeal.length > 0) {
    const option = cheapest(sameMeal);
    return { option, note: `room changed to "${option.room_name}"` };
  }
  if (hasMeal(spec.meal)) {
    const withMeal = ofHotel.filter((o) => hasMeal(o.meal));
    if (withMeal.length === 0) return null;
    const option = cheapest(withMeal);
    return { option, note: `meal plan changed to "${option.meal}" ("${option.room_name}")` };
  }
  const roomOnly = ofHotel.filter((o) => !hasMeal(o.meal));
  const option = cheapest(roomOnly.length > 0 ? roomOnly : ofHotel);
  return { option, note: `room changed to "${option.room_name}"` };
}

/**
 * Offline hotel rooms for another party size. Rooms of ONE inventory row scale
 * (as many as the party needs); a package built from several different rows
 * keeps its built size only - which mix a bigger party gets is staff's call.
 */
export function offlineHotelUnitsFor(
  rowIds: number[],
  capacityOf: (rowId: number) => number,
  travelers: number,
  builtFor: number,
): { rowId: number; count: number }[] | null {
  if (rowIds.length === 0 || travelers < 1) return null;
  const counts = new Map<number, number>();
  for (const id of rowIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  if (travelers === builtFor) {
    return [...counts.entries()].map(([rowId, count]) => ({ rowId, count }));
  }
  if (counts.size !== 1) return null;
  const rowId = rowIds[0];
  const capacity = Math.max(1, Math.floor(capacityOf(rowId)) || 1);
  return [{ rowId, count: Math.ceil(travelers / capacity) }];
}

// ---------------------------------------------------------------------------
// Variants and status
// ---------------------------------------------------------------------------

/** Party sizes the picker may offer: priced, within the max, ascending. */
export function variantSizes(
  variants: ReadyVariants | null | undefined,
  maxTravelers: number,
): number[] {
  const max = clampMaxTravelers(maxTravelers);
  return Object.keys(variants ?? {})
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= max)
    .sort((a, b) => a - b);
}

export type SizeFailure = { size: number; reason: string };

/**
 * ok = every size up to the max is priced; partial = some are missing (the
 * picker simply does not offer them); broken = the DEFAULT size is missing, so
 * the package cannot open at all.
 */
export function summarizeRefresh(input: {
  defaultTravelers: number;
  maxTravelers: number;
  built: number[];
  failures: SizeFailure[];
  notes?: string[];
}): { status: ReadyRefreshStatus; note: string | null } {
  const wanted = targetSizes(input.maxTravelers);
  const built = new Set(input.built);
  const missing = wanted.filter((n) => !built.has(n));
  const lines = [
    ...input.failures.map((f) => `${f.size} travellers: ${f.reason}`),
    ...(input.notes ?? []),
  ];
  const note = lines.length > 0 ? lines.join(" | ").slice(0, 900) : null;
  if (!built.has(input.defaultTravelers)) return { status: "broken", note };
  return { status: missing.length > 0 ? "partial" : "ok", note };
}

/** May the event go `live` on this package? Only when its default size is priced. */
export function canGoLive(
  variants: ReadyVariants | null | undefined,
  defaultTravelers: number,
): boolean {
  return !!variants && !!variants[String(defaultTravelers)];
}

/** The link that opens the package on the site in `preview` and `live` alike. */
export function readyPreviewUrl(siteUrl: string, eventId: number, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/order/${eventId}?ready=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Labels for the editor card
// ---------------------------------------------------------------------------

const MEAL_LABELS: Record<string, string> = {
  nomeal: "room only",
  breakfast: "breakfast",
  "half-board": "half board",
  "full-board": "full board",
  "all-inclusive": "all inclusive",
};

export const mealLabel = (meal: string | null | undefined): string =>
  MEAL_LABELS[meal || "nomeal"] ?? String(meal);

export function flightLabel(flight: FlightLike | null | undefined, skipped: boolean): string {
  if (!flight) return skipped ? "No flight" : "Flight not chosen";
  const name = flight.metadata?.name || flight.airline || "Flight";
  const out = flight.outbound?.departureTime;
  const back = flight.inbound?.departureTime;
  const numbers = [flight.outbound?.flightNumber, flight.inbound?.flightNumber]
    .filter(Boolean)
    .join(" / ");
  const days = out && back ? `${isoDay(out)} → ${isoDay(back)}` : "";
  return [name, numbers, days, flight.isOffline ? "our inventory" : "online"]
    .filter(Boolean)
    .join(" · ");
}

export function hotelLabel(hotel: HotelLike | null | undefined, skipped: boolean): string {
  if (!hotel) return skipped ? "No hotel" : "Hotel not chosen";
  const name = hotel.hotelInformation?.hotelName || hotel.name || "Hotel";
  const stars = hotel.hotelInformation?.stars ? `${hotel.hotelInformation.stars}★` : "";
  const room = hotel.rate?.room_name || hotel.hotelInformation?.roomName || "";
  const days = hotel.checkin && hotel.checkout ? `${hotel.checkin} → ${hotel.checkout}` : "";
  return [name, stars, room, mealLabel(hotel.rate?.meal), days, hotel.isOffline ? "our inventory" : "online"]
    .filter(Boolean)
    .join(" · ");
}
