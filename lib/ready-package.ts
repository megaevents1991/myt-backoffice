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
  type ReadySwap,
  type ReadyVariants,
} from "../types/ready-package.types";

/**
 * Top of the traveller picker: the SITE's own cap on tickets per order (main's
 * ticket step MAX_TICKETS, and its 1..9 traveller select) - a bigger party is a
 * group quote there too. A ready package has no limit of its own (Alon 06.10:
 * "like the site today"): it is priced for every size up to this, and a size
 * that cannot be priced is simply not offered. Mirrored in main's
 * lib/events/readyPackage.ts.
 */
export const READY_MAX_TRAVELERS_CAP = 9;

/** `events.ready_package_mode` as read: anything but a known mode is "off". */
export function readyMode(value: unknown): ReadyPackageMode {
  return (READY_PACKAGE_MODES as readonly string[]).includes(String(value))
    ? (value as ReadyPackageMode)
    : "off";
}

/** A party-size ceiling as read: anything unusable, or above the site's cap, is the cap. */
export function clampMaxTravelers(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return READY_MAX_TRAVELERS_CAP;
  return Math.min(READY_MAX_TRAVELERS_CAP, n);
}

// ---------------------------------------------------------------------------
// Swapping: which pieces the customer may change on the site
// ---------------------------------------------------------------------------

export const SWAP_ALL: ReadySwap = { ticket: true, flight: true, hotel: true };
export const SWAP_NONE: ReadySwap = { ticket: false, flight: false, hotel: false };

/** A stored or posted `swap`, read strictly: three booleans or nothing. */
export function parseSwap(raw: unknown): ReadySwap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.ticket !== "boolean" ||
    typeof value.flight !== "boolean" ||
    typeof value.hotel !== "boolean"
  ) {
    return null;
  }
  return { ticket: value.ticket, flight: value.flight, hotel: value.hotel };
}

/**
 * Per piece: may the customer swap it. The spec's own answer when it has one;
 * a package saved before the breakdown existed follows the row's `allow_edit`
 * for every piece. Mirrored in main's lib/events/readyPackage.ts.
 */
export function swapOf(
  spec: { swap?: unknown } | null | undefined,
  allowEdit: boolean | null | undefined,
): ReadySwap {
  return parseSwap(spec?.swap) ?? (allowEdit === false ? SWAP_NONE : SWAP_ALL);
}

/** The row's `allow_edit` for a breakdown: open when at least one piece is. */
export const anySwap = (swap: ReadySwap): boolean => swap.ticket || swap.flight || swap.hotel;

/** The sizes a refresh builds: 1..max. */
export function targetSizes(maxTravelers: number): number[] {
  const max = clampMaxTravelers(maxTravelers);
  return Array.from({ length: max }, (_, i) => i + 1);
}

// ---------------------------------------------------------------------------
// Party sizes: which ones staff sell
// ---------------------------------------------------------------------------

/** A list of party sizes, read strictly: whole numbers within the site's cap, unique, ascending. null = not one. */
export function parseSizes(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sizes = new Set<number>();
  for (const value of raw) {
    const n = typeof value === "number" ? value : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > READY_MAX_TRAVELERS_CAP) return null;
    sizes.add(n);
  }
  return [...sizes].sort((a, b) => a - b);
}

/** "Sold in pairs": the even party sizes (2, 4, 6, 8). */
export const pairSizes = (): number[] =>
  targetSizes(READY_MAX_TRAVELERS_CAP).filter((n) => n % 2 === 0);

/**
 * The party sizes staff sell this package to (Dor 06.10: "it must be set in the
 * backoffice" - pairs only, or any other choice). The spec's own list when it
 * has one, else every size up to the site's cap. The size the package was built
 * for is always among them: it is the one the package opens on.
 * The site needs no rule of its own - a size that is not sold holds no variant,
 * and the picker offers exactly the sizes that do.
 */
export function allowedSizes(
  spec: { sizes?: unknown; defaultTravelers?: unknown } | null | undefined,
): number[] {
  const chosen = parseSizes(spec?.sizes) ?? targetSizes(READY_MAX_TRAVELERS_CAP);
  const built = Number(spec?.defaultTravelers);
  const withBuilt =
    Number.isInteger(built) && built >= 1 && built <= READY_MAX_TRAVELERS_CAP && !chosen.includes(built)
      ? [...chosen, built]
      : chosen;
  return [...withBuilt].sort((a, b) => a - b);
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

/** What the last visit to one party size had to say: why it is not sold, or what changed on it. */
export type SizeNote = { size: number; text: string };

const SIZE_LINE = /^(\d+(?:,\s*\d+)*) travellers: (.+)$/;

/**
 * `refresh_note` back into one line per size ("5, 6 travellers: x" names two sizes).
 * A line that names no size is not a size's line and is dropped.
 */
export function parseSizeNotes(note: string | null | undefined): SizeNote[] {
  const out: SizeNote[] = [];
  for (const line of String(note ?? "").split(" | ")) {
    const m = SIZE_LINE.exec(line.trim());
    if (!m) continue;
    for (const raw of m[1].split(",")) {
      const size = Number(raw.trim());
      if (Number.isInteger(size) && size >= 1) out.push({ size, text: m[2].trim() });
    }
  }
  return out;
}

/** The note as it is stored: sizes that say the same thing share a line, smallest size first. */
export function formatSizeNotes(lines: SizeNote[]): string | null {
  const byText = new Map<string, number[]>();
  for (const line of [...lines].sort((a, b) => a.size - b.size)) {
    const sizes = byText.get(line.text) ?? [];
    if (!sizes.includes(line.size)) sizes.push(line.size);
    byText.set(line.text, sizes);
  }
  const out = [...byText.entries()].map(([text, sizes]) => `${sizes.join(", ")} travellers: ${text}`);
  return out.length > 0 ? out.join(" | ").slice(0, 900) : null;
}

/**
 * The same party in rooms of two and ONE single - for a hotel that has no room for three.
 * A party is first searched the usual way (rooms of two, a trio takes one room of three);
 * null when that split holds no room of three, so there is nothing else to try.
 */
export function roomSplitWithoutTriple(travelers: number): number[] | null {
  const n = Math.floor(Number(travelers));
  if (!Number.isInteger(n) || n < 3 || n % 2 === 0) return null;
  return [...new Array<number>((n - 1) / 2).fill(2), 1];
}

/**
 * ok = every size up to the max is priced; partial = some are missing (the
 * picker simply does not offer them); broken = the DEFAULT size is missing, so
 * the package cannot open at all.
 *
 * The note holds one line per size. The editor's card prices ONE size per call, so a
 * call says which sizes it visited (`handled`) and hands in the stored note: what
 * earlier calls said about the OTHER sizes is kept. Until 2026-10-07 every call
 * rewrote the note with its own failures alone - after a full pass only the last
 * size (9) had a reason and nobody could tell why 3 or 5 were not on the site.
 * Without `handled` (a whole-package refresh) the note is this run's alone.
 */
export function summarizeRefresh(input: {
  defaultTravelers: number;
  maxTravelers: number;
  /** The sizes staff sell (`allowedSizes`); absent = every size up to the max. */
  sizes?: number[];
  built: number[];
  failures: SizeFailure[];
  /** What changed on a size that WAS priced (another room, two rooms instead of one). */
  notes?: SizeNote[];
  handled?: number[];
  previousNote?: string | null;
}): { status: ReadyRefreshStatus; note: string | null } {
  const wanted = input.sizes ?? targetSizes(input.maxTravelers);
  const built = new Set(input.built);
  const missing = wanted.filter((n) => !built.has(n));
  const fresh: SizeNote[] = [
    ...input.failures.map((f) => ({ size: f.size, text: f.reason })),
    ...(input.notes ?? []),
  ];
  const visited = new Set([...(input.handled ?? []), ...fresh.map((l) => l.size)]);
  const kept = input.handled
    ? parseSizeNotes(input.previousNote).filter((l) => !visited.has(l.size) && wanted.includes(l.size))
    : [];
  const note = formatSizeNotes([...kept, ...fresh]);
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

// ---------------------------------------------------------------------------
// The editor's builder: a suggestion, and the spec it sends back
// ---------------------------------------------------------------------------

const cheapestOf = <T extends { pricePerPerson: number }>(list: T[]): T | undefined =>
  [...list].sort((a, b) => a.pricePerPerson - b.pricePerPerson)[0];

/**
 * The flight "Compose automatically" proposes: the cheapest direct one with a
 * checked bag, else the cheapest direct, else the cheapest - saying which step
 * it had to take.
 */
export function pickSuggestedFlight<
  T extends { direct: boolean; checkedBag: boolean; pricePerPerson: number },
>(list: T[]): { choice: T; note?: string } | null {
  const direct = list.filter((f) => f.direct);
  const withBag = direct.filter((f) => f.checkedBag);
  if (withBag.length > 0) return { choice: cheapestOf(withBag)! };
  if (direct.length > 0) {
    return { choice: cheapestOf(direct)!, note: "no direct flight with a checked bag - took the cheapest direct" };
  }
  const any = cheapestOf(list);
  return any ? { choice: any, note: "no direct flight - took the cheapest" } : null;
}

/**
 * The hotel "Compose automatically" proposes: the cheapest of `minStars`+ with
 * a meal, else the cheapest of `minStars`+, else the cheapest.
 */
export function pickSuggestedHotel<
  T extends { stars: number; meal: string; pricePerPerson: number },
>(list: T[], minStars = 4): { choice: T; note?: string } | null {
  const starred = list.filter((h) => h.stars >= minStars);
  const withMeal = starred.filter((h) => hasMeal(h.meal));
  if (withMeal.length > 0) return { choice: cheapestOf(withMeal)! };
  if (starred.length > 0) {
    return { choice: cheapestOf(starred)!, note: `no ${minStars}★ hotel with a meal - took the cheapest ${minStars}★` };
  }
  const any = cheapestOf(list);
  return any ? { choice: any, note: `no ${minStars}★ hotel - took the cheapest` } : null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
const positiveInt = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** YYYY-MM-DD, as a date input gives it. */
export const isDay = (value: unknown): value is string =>
  typeof value === "string" && DAY_RE.test(value);

/**
 * A spec that came from the browser, checked field by field; null when any
 * part is not what a spec may hold. It only says the SHAPE is sound - whether
 * the pieces exist and what they cost is decided by looking them up again.
 */
export function parseSpecInput(raw: unknown): ReadyPackageSpec | null {
  const root = record(raw);
  if (!root) return null;

  const ticketIn = record(root.ticket);
  const category = text(ticketIn?.category, 300);
  if (!ticketIn || !category) return null;
  const ticket = { id: text(ticketIn.id, 200), category };

  const travelers = positiveInt(root.defaultTravelers);
  if (!travelers || travelers > READY_MAX_TRAVELERS_CAP) return null;

  const flightIn = record(root.flight);
  let flight: ReadyFlightSpec;
  if (flightIn?.mode === "none") flight = { mode: "none" };
  else if (flightIn?.mode === "offline") {
    const offlineId = positiveInt(flightIn.offlineId);
    if (!offlineId) return null;
    flight = { mode: "offline", offlineId };
  } else if (flightIn?.mode === "live") {
    const outboundDeparture = text(flightIn.outboundDeparture, 40);
    const inboundDeparture = text(flightIn.inboundDeparture, 40);
    const departureDate = flightIn.departureDate;
    const returnDate = flightIn.returnDate;
    if (!outboundDeparture || !inboundDeparture) return null;
    if (!isDay(departureDate) || !isDay(returnDate) || departureDate > returnDate) return null;
    flight = {
      mode: "live",
      airline: text(flightIn.airline, 20),
      outboundFlightNumber: text(flightIn.outboundFlightNumber, 20),
      outboundDeparture,
      inboundFlightNumber: text(flightIn.inboundFlightNumber, 20),
      inboundDeparture,
      departureDate,
      returnDate,
    };
  } else return null;

  const hotelIn = record(root.hotel);
  let hotel: ReadyHotelSpec;
  if (hotelIn?.mode === "none") hotel = { mode: "none" };
  else if (hotelIn?.mode === "offline") {
    const ids = Array.isArray(hotelIn.rowIds) ? hotelIn.rowIds.map(positiveInt) : [];
    if (ids.length === 0 || ids.length > 10 || ids.some((id) => id == null)) return null;
    hotel = { mode: "offline", rowIds: ids as number[] };
  } else if (hotelIn?.mode === "live") {
    const hotelId = text(hotelIn.hotelId, 200);
    const checkin = hotelIn.checkin;
    const checkout = hotelIn.checkout;
    if (!hotelId || !isDay(checkin) || !isDay(checkout) || checkin >= checkout) return null;
    hotel = {
      mode: "live",
      hotelId,
      roomName: typeof hotelIn.roomName === "string" ? hotelIn.roomName.slice(0, 300) : "",
      meal: text(hotelIn.meal, 40) ?? "nomeal",
      checkin,
      checkout,
    };
  } else return null;

  // A posted breakdown must be whole; none at all = the caller decides (keep the row's).
  const swap = root.swap === undefined ? undefined : parseSwap(root.swap);
  if (swap === null) return null;

  // The same for the sizes sold: a posted list must be sound; none = keep the row's.
  const sizes = root.sizes === undefined ? undefined : parseSizes(root.sizes);
  if (sizes === null) return null;

  return {
    ticket,
    flight,
    hotel,
    defaultTravelers: travelers,
    ...(swap ? { swap } : {}),
    ...(sizes ? { sizes } : {}),
  };
}
