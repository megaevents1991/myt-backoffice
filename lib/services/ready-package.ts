// Ready package ("חבילה מוכנה") - the service behind the event editor's card,
// the nightly refresh cron and scripts/ready-package-create.ts.
// Spec: docs/superpowers/specs/2026-10-04-ready-package-design.md.
//
// A ready package is a `kind = 'house'` row of prepared_packages that an event
// points at (events.ready_package_token). It keeps the IDENTITY of each piece
// (`spec`) and one priced composition per party size (`variants`). Everything
// here prices through code that already exists: main's own search APIs
// (package-search.ts - what a customer would be offered), the wizard's
// snapshot builders (package-snapshots.ts) and computePerPersonPackagePrice.
// No pricing rule lives in this file.
//
// NOT server actions - every caller does its own auth (requireStaff in
// ready-package-actions.ts, guardCronRoute in the cron).

import { randomUUID } from "node:crypto";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { megaEventsFlights } from "@/lib/flights-scope";
import { computePerPersonPackagePrice } from "@/lib/package-price";
import { PUBLIC_SITE_URL } from "@/lib/site";
import {
  searchFlightsViaMain,
  searchHotelsViaMain,
} from "@/lib/services/package-search";
import {
  FLIGHT_COLUMNS,
  HOTEL_COLUMNS,
  buildFlightSnapshot,
  buildHotelSnapshot,
  roomCapacity,
  type FlightRow,
  type HotelMetaRow,
  type HotelRow,
} from "@/lib/services/package-snapshots";
import {
  READY_MAX_TRAVELERS_CAP,
  allowedSizes,
  anySwap,
  flightLabel,
  flightSpecOf,
  hasMeal,
  hotelLabel,
  isoDay,
  matchFlight,
  matchHotelOption,
  offlineHotelUnitsFor,
  parseSizes,
  parseSwap,
  pickSuggestedFlight,
  pickSuggestedHotel,
  readyMode,
  readyPreviewUrl,
  specFromComposition,
  summarizeRefresh,
  swapOf,
  targetSizes,
  variantSizes,
  type CompositionLike,
  type FlightLike,
  type HotelLike,
  type SizeFailure,
} from "@/lib/ready-package";
import type { Json } from "@/types/database.types";
import type { EventTicket } from "@/types/app.types";
import type {
  LiveFlightOffer,
  LiveHotelOption,
} from "@/lib/actions/portal-package-actions";
import type {
  ReadyBuildOptions,
  ReadyFlightChoice,
  ReadyHotelChoice,
  ReadyInventory,
  ReadyPackageMode,
  ReadyPackageSpec,
  ReadyPackageView,
  ReadySwap,
  ReadyTicketChoice,
  ReadyRefreshStatus,
  ReadyVariant,
  ReadyVariants,
} from "@/types/ready-package.types";

type JsonObject = { [key: string]: unknown };

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const EVENT_COLUMNS =
  "id, name, date, location, type, tickets_and_rates, is_deleted, base_flight_price, base_hotel_price, " +
  "event_additional_markup, markup_ticket, markup_flight, markup_hotel, skip_flight, skip_flight_markup, " +
  "skip_hotel_markup, ticket_only_markup, def_date_depart, def_date_return, " +
  "ready_package_token, ready_package_mode, ready_package_price_usd";

export type ReadyEventRow = {
  id: number;
  name: string;
  date: string;
  location: { name?: string } | null;
  type: string;
  tickets_and_rates: EventTicket[] | null;
  is_deleted: string | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  event_additional_markup: number | null;
  markup_ticket: number | null;
  markup_flight: number | null;
  markup_hotel: number | null;
  skip_flight: boolean | null;
  skip_flight_markup: number | null;
  skip_hotel_markup: number | null;
  ticket_only_markup: number | null;
  def_date_depart: string | null;
  def_date_return: string | null;
  ready_package_token: string | null;
  ready_package_mode: string | null;
  ready_package_price_usd: number | null;
};

const HOUSE_COLUMNS =
  "id, share_token, event_id, kind, spec, variants, max_travelers, num_travelers, allow_edit, " +
  "refreshed_at, refresh_status, refresh_note";

export type HousePackageRow = {
  id: number;
  share_token: string;
  event_id: number;
  kind: string;
  spec: ReadyPackageSpec | null;
  variants: ReadyVariants | null;
  max_travelers: number | null;
  num_travelers: number;
  allow_edit: boolean;
  refreshed_at: string | null;
  refresh_status: string | null;
  refresh_note: string | null;
};

/** Postgres "undefined column" - a deploy that beat the migration (the columns arrive minutes later). */
const MISSING_COLUMN = "42703";

export async function loadReadyEvent(eventId: number): Promise<ReadyEventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  if (error?.code === MISSING_COLUMN) {
    // Not migrated yet: the event simply has no ready package.
    const { data: bare, error: bareError } = await supabase
      .from("events")
      .select(EVENT_COLUMNS.split(", ready_package_token")[0])
      .eq("id", eventId)
      .maybeSingle();
    if (bareError) {
      console.error("ready-package: event load failed", JSON.stringify(bareError));
      throw new Error("Could not load the event");
    }
    return bare
      ? {
          ...(bare as unknown as ReadyEventRow),
          ready_package_token: null,
          ready_package_mode: null,
          ready_package_price_usd: null,
        }
      : null;
  }
  if (error) {
    console.error("ready-package: event load failed", JSON.stringify(error));
    throw new Error("Could not load the event");
  }
  return (data as unknown as ReadyEventRow | null) ?? null;
}

/** The house package of an event - the newest one, should an older row linger. */
export async function loadHousePackageForEvent(eventId: number): Promise<HousePackageRow | null> {
  const { data, error } = await supabase
    .from("prepared_packages")
    .select(HOUSE_COLUMNS)
    .eq("event_id", eventId)
    .eq("kind", "house")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error?.code === MISSING_COLUMN) return null;
  if (error) {
    console.error("ready-package: package load failed", JSON.stringify(error));
    throw new Error("Could not load the ready package");
  }
  return (data as unknown as HousePackageRow | null) ?? null;
}

const isLive = (event: Pick<ReadyEventRow, "is_deleted" | "date">): boolean =>
  !event.is_deleted && new Date(event.date).getTime() > Date.now();

// ---------------------------------------------------------------------------
// One party size
// ---------------------------------------------------------------------------

export type VariantResult =
  | { ok: true; variant: ReadyVariant }
  /** transient = the search itself failed (keep what we had); otherwise the piece is gone. */
  | { ok: false; reason: string; transient: boolean };

type Piece =
  | { ok: true; info: JsonObject | null; skipped: boolean; perPerson: number | null; note?: string; image?: string | null }
  | { ok: false; reason: string; transient: boolean };

async function resolveFlight(
  event: ReadyEventRow,
  spec: ReadyPackageSpec["flight"],
  pax: number,
): Promise<Piece> {
  if (spec.mode === "none") return { ok: true, info: null, skipped: true, perPerson: null };

  if (spec.mode === "offline") {
    const { data, error } = await megaEventsFlights()
      .select(`${FLIGHT_COLUMNS}, event_ids, is_deleted`)
      .eq("id", spec.offlineId)
      .maybeSingle();
    if (error) {
      console.error("ready-package: flight load failed", JSON.stringify(error));
      return { ok: false, reason: "could not load the flight", transient: true };
    }
    const row = data as unknown as
      | (FlightRow & { event_ids: number[] | null; is_deleted: boolean | null })
      | null;
    if (
      !row ||
      row.is_deleted ||
      !(row.event_ids ?? []).includes(event.id) ||
      new Date(row.outbound_departure_time).getTime() <= Date.now()
    ) {
      return { ok: false, reason: "the inventory flight is no longer available for this event", transient: false };
    }
    if ((row.initial_quantity ?? 0) - (row.consumed_quantity ?? 0) < pax) {
      return { ok: false, reason: "not enough seats left on the inventory flight", transient: false };
    }
    return {
      ok: true,
      info: buildFlightSnapshot(row, pax) as JsonObject,
      skipped: false,
      perPerson: Number(row.price),
    };
  }

  const res = await searchFlightsViaMain({
    eventId: event.id,
    departureDate: spec.departureDate,
    returnDate: spec.returnDate,
    adults: pax,
  });
  if (!res.ok) return { ok: false, reason: "the flight search failed", transient: true };
  const offer = matchFlight(spec, res.flights);
  if (!offer) return { ok: false, reason: "the flight is not on offer for this party size", transient: false };
  if (new Date(offer.outbound.departureTime).getTime() <= Date.now()) {
    return { ok: false, reason: "the flight has already left", transient: false };
  }
  const price = Number(offer.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: "the flight came back without a price", transient: true };
  }
  return {
    ok: true,
    info: offer as JsonObject,
    skipped: false,
    perPerson: price / Math.max(1, Number(offer.numOfTravelers) || pax),
  };
}

async function resolveHotel(
  event: ReadyEventRow,
  spec: ReadyPackageSpec["hotel"],
  pax: number,
  builtFor: number,
): Promise<Piece> {
  if (spec.mode === "none") return { ok: true, info: null, skipped: true, perPerson: null };

  if (spec.mode === "offline") {
    const ids = [...new Set(spec.rowIds)];
    const { data, error } = await supabase
      .from("offline_hotels")
      .select(`${HOTEL_COLUMNS}, event_ids, is_deleted`)
      .in("id", ids);
    if (error) {
      console.error("ready-package: hotel load failed", JSON.stringify(error));
      return { ok: false, reason: "could not load the hotel rooms", transient: true };
    }
    const rows = (data ?? []) as unknown as (HotelRow & {
      event_ids: number[] | null;
      is_deleted: boolean | null;
    })[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const wanted = offlineHotelUnitsFor(
      spec.rowIds,
      (id) => roomCapacity(byId.get(id)?.room_type),
      pax,
      builtFor,
    );
    if (!wanted) {
      return {
        ok: false,
        reason: "the rooms come from several inventory rows - this package keeps its built size only",
        transient: false,
      };
    }
    const units: { row: HotelRow; count: number }[] = [];
    for (const u of wanted) {
      const row = byId.get(u.rowId);
      if (!row || row.is_deleted || !(row.event_ids ?? []).includes(event.id)) {
        return { ok: false, reason: "an inventory room is no longer available for this event", transient: false };
      }
      if ((row.num_rooms ?? 0) - (row.consumed_rooms ?? 0) < u.count) {
        return { ok: false, reason: `not enough rooms left (${row.hotel_name} - ${row.room_type})`, transient: false };
      }
      units.push({ row, count: u.count });
    }
    const capacity = units.reduce((sum, { row, count }) => sum + roomCapacity(row.room_type) * count, 0);
    if (capacity < pax) {
      return { ok: false, reason: "the rooms do not fit this party size", transient: false };
    }
    const anchor = units[0].row;
    if (anchor.check_in <= new Date().toISOString().slice(0, 10)) {
      return { ok: false, reason: "the hotel's check-in has passed", transient: false };
    }
    let meta: HotelMetaRow | null = null;
    if (anchor.hid != null) {
      const { data: metaRow } = await supabase
        .from("hotels")
        .select("hid, name, star_rating, address, latitude, longitude, amenity_groups")
        .eq("hid", anchor.hid)
        .maybeSingle();
      meta = (metaRow as unknown as HotelMetaRow | null) ?? null;
    }
    return {
      ok: true,
      info: buildHotelSnapshot(units, meta, pax) as JsonObject,
      skipped: false,
      perPerson: units.reduce((sum, { row, count }) => sum + Number(row.price) * count, 0) / pax,
    };
  }

  if (spec.checkin <= new Date().toISOString().slice(0, 10)) {
    return { ok: false, reason: "the hotel's check-in has passed", transient: false };
  }
  const res = await searchHotelsViaMain({
    eventId: event.id,
    checkin: spec.checkin,
    checkout: spec.checkout,
    travelers: pax,
    // Narrows the serp result to this hotel before the result cap and the info call.
    query: spec.hotelId,
  });
  if (!res.ok) return { ok: false, reason: "the hotel search failed", transient: true };
  const match = matchHotelOption(spec, res.options);
  if (!match) {
    return {
      ok: false,
      reason: hasMeal(spec.meal)
        ? "the hotel has no room with a meal on offer for this party size"
        : "the hotel is not on offer for this party size",
      transient: false,
    };
  }
  return {
    ok: true,
    info: match.option.snapshot as JsonObject,
    skipped: false,
    perPerson: match.option.price / pax,
    note: match.note,
    image: match.option.image,
  };
}

function resolveTicket(
  event: ReadyEventRow,
  spec: ReadyPackageSpec["ticket"],
  pax: number,
): { ok: true; ticket: EventTicket } | { ok: false; reason: string } {
  const available = (event.tickets_and_rates ?? []).filter((t) => t && t.available !== false);
  // Ticket id first: on a multi-supplier event two suppliers can share a category name.
  const ticket =
    available.find((t) => spec.id && t.id === spec.id) ??
    available.find((t) => t.category === spec.category);
  if (!ticket) return { ok: false, reason: "the ticket category is no longer on sale" };
  // Our own stock: seats we hold. The live count of what was sold is main's
  // (lib/own-stock.ts at booking); this only refuses a size the stock could never seat.
  if (ticket.supplier === "static" && typeof ticket.stock === "number" && ticket.stock < pax) {
    return { ok: false, reason: "our own ticket stock is smaller than this party size" };
  }
  return { ok: true, ticket };
}

function assembleVariant(
  event: ReadyEventRow,
  ticket: EventTicket,
  pax: number,
  flight: Extract<Piece, { ok: true }>,
  hotel: Extract<Piece, { ok: true }>,
): ReadyVariant {
  // What main will actually charge per traveller for THIS composition - the
  // same call the wizard stamps its packages with (buildPackageRowCore).
  const pricePerPerson = computePerPersonPackagePrice(event, {
    ticketPrice: Number(ticket.price) || 0,
    flightSkipped: flight.skipped,
    hotelSkipped: hotel.skipped,
    flightDelta: flight.perPerson != null ? flight.perPerson - (event.base_flight_price ?? 0) : 0,
    hotelDelta: hotel.perPerson != null ? hotel.perPerson - (event.base_hotel_price ?? 0) : 0,
  });
  const notes = [flight.note, hotel.note].filter(Boolean).join("; ");
  return {
    event_order_info: {
      event_id: event.id,
      date: event.date,
      name: event.name,
      location_name: event.location?.name ?? "",
      number_of_ticket: pax,
      category: ticket.category,
      event_type: event.type,
      price_per_ticket: ticket.price,
      total_tickets_price: ticket.price * pax,
      vendor: ticket.vendor,
      id: ticket.id,
      price_per_person: pricePerPerson,
    },
    flight_order_info: flight.info,
    flight_skipped: flight.skipped,
    hotel_order_info: hotel.info,
    hotel_skipped: hotel.skipped,
    price_per_person: pricePerPerson,
    ...(hotel.image ? { hotel_image: hotel.image } : {}),
    built_at: new Date().toISOString(),
    ...(notes ? { note: notes } : {}),
  };
}

/** The package's pieces, looked up again and priced for one party size. */
export async function buildVariant(
  event: ReadyEventRow,
  spec: ReadyPackageSpec,
  pax: number,
): Promise<VariantResult> {
  const ticket = resolveTicket(event, spec.ticket, pax);
  if (!ticket.ok) return { ok: false, reason: ticket.reason, transient: false };
  // Side by side: one flight search and one hotel search, independent of each other.
  const [flight, hotel] = await Promise.all([
    resolveFlight(event, spec.flight, pax),
    resolveHotel(event, spec.hotel, pax, spec.defaultTravelers),
  ]);
  if (!flight.ok) return flight;
  if (!hotel.ok) return hotel;
  return { ok: true, variant: assembleVariant(event, ticket.ticket, pax, flight, hotel) };
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export type RefreshSummary = {
  packageId: number;
  eventId: number;
  status: ReadyRefreshStatus;
  note: string | null;
  /** Sizes with a priced variant after this run. */
  sizes: number[];
  failures: SizeFailure[];
  pricePerPerson: number | null;
  /** The time budget ran out before every size was visited. */
  cut: boolean;
};

async function writeEventReady(
  eventId: number,
  patch: { token?: string | null; mode?: ReadyPackageMode; price?: number | null },
): Promise<void> {
  const update: {
    ready_package_token?: string | null;
    ready_package_mode?: string;
    ready_package_price_usd?: number | null;
  } = {};
  if (patch.token !== undefined) update.ready_package_token = patch.token;
  if (patch.mode !== undefined) update.ready_package_mode = patch.mode;
  if (patch.price !== undefined) update.ready_package_price_usd = patch.price;
  if (Object.keys(update).length === 0) return;
  const { error } = await supabaseTyped.from("events").update(update).eq("id", eventId);
  if (error) {
    console.error("ready-package: event write failed", JSON.stringify(error));
    throw new Error("Could not update the event");
  }
}

export const setEventReady = writeEventReady;

/**
 * Re-prices a house package: the given sizes (default: every size up to its
 * max), the DEFAULT size first so a cut budget still refreshes what opens.
 * A size whose piece is gone is dropped from the picker; a size whose SEARCH
 * failed keeps its last priced variant - one timeout must not break a package.
 */
export async function refreshHousePackage(
  pkg: HousePackageRow,
  opts: { sizes?: number[]; dryRun?: boolean; deadline?: number } = {},
): Promise<RefreshSummary> {
  const spec = pkg.spec;
  // No limit of its own: every size up to the site's cap (the row's `max_travelers`
  // is kept at that cap below, for main - it is no longer something staff set).
  const max = READY_MAX_TRAVELERS_CAP;
  // The sizes staff sell it to (all of them unless they chose - pairs only, say). A size
  // that is not sold holds no variant, which is how the site knows not to offer it.
  const allowed = allowedSizes(spec ?? { defaultTravelers: pkg.num_travelers });
  const variants: ReadyVariants = {};
  for (const size of variantSizes(pkg.variants, max)) {
    if (allowed.includes(size)) variants[String(size)] = pkg.variants![String(size)];
  }

  const failures: SizeFailure[] = [];
  const notes: string[] = [];
  let cut = false;

  const event = await loadReadyEvent(pkg.event_id);
  const defaultSize = spec?.defaultTravelers ?? pkg.num_travelers;

  if (!spec) {
    failures.push({ size: defaultSize, reason: "the package has no stored identity" });
  } else if (!event || !isLive(event)) {
    for (const key of Object.keys(variants)) delete variants[key];
    failures.push({ size: defaultSize, reason: "the event is gone or has passed" });
  } else {
    const wanted = (opts.sizes ?? allowed).filter((n) => allowed.includes(n));
    const ordered = [...new Set(wanted)].sort(
      (a, b) => Number(b === defaultSize) - Number(a === defaultSize) || a - b,
    );
    for (const size of ordered) {
      if (opts.deadline && Date.now() > opts.deadline) {
        cut = true;
        break;
      }
      const result = await buildVariant(event, spec, size);
      if (result.ok) {
        variants[String(size)] = result.variant;
        if (result.variant.note) notes.push(`${size} travellers: ${result.variant.note}`);
        continue;
      }
      const kept = result.transient && !!variants[String(size)];
      if (!kept) delete variants[String(size)];
      failures.push({
        size,
        reason: kept ? `${result.reason} (kept the last priced one)` : result.reason,
      });
    }
  }

  const sizes = variantSizes(variants, max);
  const { status, note } = summarizeRefresh({
    defaultTravelers: defaultSize,
    maxTravelers: max,
    sizes: allowed,
    built: sizes,
    failures,
    notes,
  });
  const defaultVariant = variants[String(defaultSize)] ?? null;
  const pricePerPerson = defaultVariant?.price_per_person ?? null;

  if (!opts.dryRun) {
    const update: {
      variants: Json;
      max_travelers: number;
      refreshed_at: string;
      refresh_status: string;
      refresh_note: string | null;
      event_order_info?: Json;
      flight_order_info?: Json | null;
      flight_skipped?: boolean;
      hotel_order_info?: Json | null;
      hotel_skipped?: boolean;
      num_travelers?: number;
    } = {
      variants: variants as unknown as Json,
      // What main reads as the top of the picker - lifts a row saved under the old per-package max.
      max_travelers: max,
      refreshed_at: new Date().toISOString(),
      refresh_status: status,
      refresh_note: note,
    };
    // The top-level columns hold the default size, so every older reader of
    // the row (and main before its own deploy) sees a current composition.
    if (defaultVariant) {
      update.event_order_info = defaultVariant.event_order_info as unknown as Json;
      update.flight_order_info = defaultVariant.flight_order_info as unknown as Json | null;
      update.flight_skipped = defaultVariant.flight_skipped;
      update.hotel_order_info = defaultVariant.hotel_order_info as unknown as Json | null;
      update.hotel_skipped = defaultVariant.hotel_skipped;
      update.num_travelers = defaultSize;
    }
    const { error } = await supabaseTyped.from("prepared_packages").update(update).eq("id", pkg.id);
    if (error) {
      console.error("ready-package: refresh write failed", JSON.stringify(error));
      throw new Error("Could not save the refreshed package");
    }
    if (
      event &&
      event.ready_package_token === pkg.share_token &&
      pricePerPerson != null &&
      Number(event.ready_package_price_usd) !== pricePerPerson
    ) {
      await writeEventReady(event.id, { price: pricePerPerson });
    }
  }

  return { packageId: pkg.id, eventId: pkg.event_id, status, note, sizes, failures, pricePerPerson, cut };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type Composition = {
  event_order_info: JsonObject;
  flight_order_info: JsonObject | null;
  flight_skipped: boolean;
  hotel_order_info: JsonObject | null;
  hotel_skipped: boolean;
  num_travelers: number;
  /** Rides into the first variant only (see ReadyVariant.hotel_image). */
  hotel_image?: string | null;
};

export type CreateHouseResult =
  | { ok: true; row: HousePackageRow }
  | { ok: false; error: string };

/**
 * Writes the event's house row. One house row per event: a second call rewrites
 * the same row, so its token - and the preview link staff already hold - stays.
 * An event that had none opens in `preview`.
 */
async function saveHousePackage(input: {
  event: ReadyEventRow;
  spec: ReadyPackageSpec;
  first: ReadyVariant;
  createdBy: string | null;
  /** Which pieces the customer may swap. Undefined = keep what the row has (a new row: all of them). */
  swap?: ReadySwap;
}): Promise<CreateHouseResult> {
  const { event, first } = input;
  if (input.spec.defaultTravelers > READY_MAX_TRAVELERS_CAP) {
    return {
      ok: false,
      error: `The package is for ${input.spec.defaultTravelers} travellers - a ready package is for up to ${READY_MAX_TRAVELERS_CAP}.`,
    };
  }

  const existing = await loadHousePackageForEvent(event.id);
  // The breakdown rides in the spec, so a rebuilt package keeps what staff decided.
  const swap = input.swap ?? parseSwap(input.spec.swap) ?? swapOf(existing?.spec, existing?.allow_edit);
  // So do the party sizes staff sell it to; the built size is always one of them.
  const chosenSizes = parseSizes(input.spec.sizes) ?? parseSizes(existing?.spec?.sizes);
  const spec: ReadyPackageSpec = {
    ...input.spec,
    swap,
    ...(chosenSizes
      ? { sizes: allowedSizes({ sizes: chosenSizes, defaultTravelers: input.spec.defaultTravelers }) }
      : {}),
  };
  const variants: ReadyVariants = { [String(spec.defaultTravelers)]: first };
  const columns = {
    event_order_info: first.event_order_info as unknown as Json,
    flight_order_info: first.flight_order_info as unknown as Json | null,
    flight_skipped: first.flight_skipped,
    hotel_order_info: first.hotel_order_info as unknown as Json | null,
    hotel_skipped: first.hotel_skipped,
    num_travelers: spec.defaultTravelers,
    spec: spec as unknown as Json,
    variants: variants as unknown as Json,
    refreshed_at: new Date().toISOString(),
    // Only the built size is priced yet - the card builds the rest.
    refresh_status: "partial",
    refresh_note: null,
    // The site's cap - a package has no limit of its own.
    max_travelers: READY_MAX_TRAVELERS_CAP,
    // What an older reader of the row sees: open when at least one piece is.
    allow_edit: anySwap(swap),
  };

  let token: string;
  if (existing) {
    token = existing.share_token;
    const { error } = await supabaseTyped.from("prepared_packages").update(columns).eq("id", existing.id);
    if (error) {
      console.error("ready-package: update failed", JSON.stringify(error));
      return { ok: false, error: "Could not save the ready package." };
    }
  } else {
    token = randomUUID();
    const { error } = await supabaseTyped.from("prepared_packages").insert({
      ...columns,
      share_token: token,
      kind: "house",
      partner_tracking_code: null,
      created_by: input.createdBy,
      event_id: event.id,
      price_adjust_per_person: 0,
    });
    if (error) {
      console.error("ready-package: insert failed", JSON.stringify(error));
      return { ok: false, error: "Could not save the ready package." };
    }
  }

  await writeEventReady(event.id, {
    token,
    price: first.price_per_person,
    ...(readyMode(event.ready_package_mode) === "off" ? { mode: "preview" as const } : {}),
  });

  const row = await loadHousePackageForEvent(event.id);
  if (!row) return { ok: false, error: "The ready package was saved but could not be read back." };
  return { ok: true, row };
}

/** Makes an existing `composition` (a prepared package's pieces, as stored) the event's ready package. */
export async function createHousePackage(input: {
  eventId: number;
  composition: Composition;
  createdBy: string | null;
}): Promise<CreateHouseResult> {
  const event = await loadReadyEvent(input.eventId);
  if (!event || !isLive(event)) return { ok: false, error: "The event was not found or has passed." };

  const { composition } = input;
  const parsed = specFromComposition(composition as unknown as CompositionLike);
  if (!parsed.ok) return parsed;

  const price = Number(composition.event_order_info.price_per_person);
  const first: ReadyVariant = {
    event_order_info: composition.event_order_info,
    flight_order_info: composition.flight_order_info,
    flight_skipped: composition.flight_skipped,
    hotel_order_info: composition.hotel_order_info,
    hotel_skipped: composition.hotel_skipped,
    price_per_person: Number.isFinite(price) && price > 0 ? price : null,
    ...(composition.hotel_image ? { hotel_image: composition.hotel_image } : {}),
    built_at: new Date().toISOString(),
  };
  return saveHousePackage({ event, spec: parsed.spec, first, createdBy: input.createdBy });
}

/**
 * Makes the pieces a `spec` names the event's ready package - the editor's
 * "Build here". The browser sends only WHICH ticket, flight and hotel; they are
 * looked up again here (one flight search, one hotel search) and priced, so
 * nothing price-bearing ever comes from the client.
 */
export async function createHousePackageFromSpec(input: {
  eventId: number;
  spec: ReadyPackageSpec;
  createdBy: string | null;
  swap?: ReadySwap;
}): Promise<CreateHouseResult> {
  const event = await loadReadyEvent(input.eventId);
  if (!event || !isLive(event)) return { ok: false, error: "The event was not found or has passed." };
  const built = await buildVariant(event, input.spec, input.spec.defaultTravelers);
  if (!built.ok) {
    return {
      ok: false,
      error: `Could not price this package for ${input.spec.defaultTravelers} travellers: ${built.reason}.`,
    };
  }
  return saveHousePackage({
    event,
    spec: input.spec,
    first: built.variant,
    createdBy: input.createdBy,
    swap: input.swap,
  });
}

/** Copies a prepared package (a partner's, built in the portal wizard) into the event's house row. */
export async function adoptPackage(input: {
  eventId: number;
  sourcePackageId: number;
  createdBy: string | null;
}): Promise<CreateHouseResult> {
  const { data, error } = await supabase
    .from("prepared_packages")
    .select(
      "id, event_id, kind, event_order_info, flight_order_info, flight_skipped, hotel_order_info, hotel_skipped, num_travelers",
    )
    .eq("id", input.sourcePackageId)
    .maybeSingle();
  if (error) {
    console.error("ready-package: source load failed", JSON.stringify(error));
    return { ok: false, error: "Could not load the package." };
  }
  const source = data as unknown as (Composition & { id: number; event_id: number; kind: string | null }) | null;
  if (!source || Number(source.event_id) !== input.eventId) {
    return { ok: false, error: "That package does not belong to this event." };
  }
  if (source.kind === "house") return { ok: false, error: "That package is already a ready package." };
  return createHousePackage({
    eventId: input.eventId,
    createdBy: input.createdBy,
    composition: {
      event_order_info: source.event_order_info,
      flight_order_info: source.flight_order_info,
      flight_skipped: source.flight_skipped,
      hotel_order_info: source.hotel_order_info,
      hotel_skipped: source.hotel_skipped,
      num_travelers: source.num_travelers,
    },
  });
}

// ---------------------------------------------------------------------------
// The editor's builder ("Build here")
// ---------------------------------------------------------------------------

/** The event's default travel window; without one: the day before to the day after. */
function defaultWindow(event: ReadyEventRow): { departureDate: string; returnDate: string } {
  const day = (offset: number) =>
    new Date(new Date(event.date).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return {
    departureDate: event.def_date_depart ? isoDay(event.def_date_depart) : day(-1),
    returnDate: event.def_date_return ? isoDay(event.def_date_return) : day(1),
  };
}

const ticketsOnSale = (event: ReadyEventRow): ReadyTicketChoice[] =>
  (event.tickets_and_rates ?? [])
    .filter((t) => t && t.available !== false)
    .map((t) => ({
      id: t.id ?? null,
      category: t.category,
      price: Number(t.price) || 0,
      supplier: t.supplier ?? null,
      stock: t.supplier === "static" && typeof t.stock === "number" ? t.stock : null,
    }))
    // Our own stock first (it is what staff look for), then by price.
    .sort((a, b) => Number(b.supplier === "static") - Number(a.supplier === "static") || a.price - b.price);

/**
 * What the builder opens with: the tickets on sale, the default travel window and our own
 * inventory for `travelers` - one read, so the builder's mount is a single action.
 */
export async function loadBuildOptions(eventId: number, travelers: number): Promise<ReadyBuildOptions | null> {
  const event = await loadReadyEvent(eventId);
  if (!event || !isLive(event)) return null;
  const [flights, hotels] = await Promise.all([
    offlineFlightChoices(event, travelers),
    offlineHotelChoices(event, travelers),
  ]);
  return { tickets: ticketsOnSale(event), ...defaultWindow(event), inventory: { flights, hotels } };
}

function toFlightChoice(offer: LiveFlightOffer, pax: number): ReadyFlightChoice | null {
  const spec = flightSpecOf(offer, false);
  const price = Number(offer.price);
  if (!spec || spec.mode === "none" || !Number.isFinite(price) || price <= 0) return null;
  const leg = (l: LiveFlightOffer["outbound"]) => ({
    flightNumber: l.flightNumber ?? null,
    departure: l.departureTime,
    arrival: l.arrivalTime,
    from: l.departureAirport,
    to: l.arrivalAirport,
  });
  return {
    key:
      spec.mode === "offline"
        ? `inventory-${spec.offlineId}`
        : [spec.outboundFlightNumber, spec.outboundDeparture, spec.inboundFlightNumber, spec.inboundDeparture].join("|"),
    spec,
    airline: offer.metadata?.name || offer.airline,
    logo: offer.metadata?.logo || null,
    direct: Number(offer.stops) === 0,
    outbound: leg(offer.outbound),
    inbound: leg(offer.inbound),
    checkedBag: !!offer.outbound.checkBagsIncluded && !!offer.inbound.checkBagsIncluded,
    cabinBag: !!offer.outbound.cabinBagsIncluded && !!offer.inbound.cabinBagsIncluded,
    pricePerPerson: Math.round(price / Math.max(1, Number(offer.numOfTravelers) || pax)),
    offline: spec.mode === "offline",
  };
}

export type FlightChoicesResult =
  | { ok: true; flights: ReadyFlightChoice[] }
  | { ok: false; error: string };

/**
 * The flights a package of this event can carry, for this party: main's own
 * search (our inventory merged with the online offers). One row per flight -
 * several fares of the same flight collapse to the cheapest, which is the one a
 * refresh will find again. Our inventory first, then by price.
 */
export async function searchBuildFlights(input: {
  eventId: number;
  departureDate: string;
  returnDate: string;
  travelers: number;
}): Promise<FlightChoicesResult> {
  const res = await searchFlightsViaMain({
    eventId: input.eventId,
    departureDate: input.departureDate,
    returnDate: input.returnDate,
    adults: input.travelers,
  });
  if (!res.ok) return res;
  const byKey = new Map<string, ReadyFlightChoice>();
  for (const offer of res.flights) {
    const choice = toFlightChoice(offer, input.travelers);
    if (!choice) continue;
    const seen = byKey.get(choice.key);
    if (!seen || choice.pricePerPerson < seen.pricePerPerson) byKey.set(choice.key, choice);
  }
  const flights = [...byKey.values()].sort(
    (a, b) => Number(b.offline) - Number(a.offline) || a.pricePerPerson - b.pricePerPerson,
  );
  return { ok: true, flights };
}

function toHotelChoice(option: LiveHotelOption, pax: number): ReadyHotelChoice | null {
  const hotelId = String(option.snapshot?.id ?? "");
  if (!hotelId || !(option.price > 0)) return null;
  return {
    key: option.key,
    spec: {
      mode: "live",
      hotelId,
      roomName: option.room_name,
      meal: option.meal || "nomeal",
      checkin: option.checkin,
      checkout: option.checkout,
    },
    name: option.name,
    stars: Math.round(Number(option.stars) || 0),
    roomName: option.room_name,
    meal: option.meal || "nomeal",
    totalPrice: Math.round(option.price),
    pricePerPerson: Math.round(option.price / pax),
    image: option.image,
    distanceM: Number.isFinite(option.distance_m) ? option.distance_m : null,
    refundable: !!option.free_cancellation_before,
    offline: false,
  };
}

/** Rooms from our own inventory linked to the event, as many as this party needs of ONE room type. */
async function offlineHotelChoices(event: ReadyEventRow, pax: number): Promise<ReadyHotelChoice[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("offline_hotels")
    .select(HOTEL_COLUMNS)
    .contains("event_ids", [event.id])
    .eq("is_deleted", false)
    .gt("check_in", today)
    .order("price", { ascending: true });
  if (error) {
    console.error("ready-package: inventory rooms failed", JSON.stringify(error));
    return [];
  }
  const rows = (data ?? []) as unknown as HotelRow[];
  const hids = [...new Set(rows.map((r) => r.hid).filter((h): h is number => h != null))];
  let meta: Pick<HotelMetaRow, "hid" | "name" | "star_rating">[] = [];
  if (hids.length > 0) {
    const { data: metaRows } = await supabase.from("hotels").select("hid, name, star_rating").in("hid", hids);
    meta = (metaRows ?? []) as unknown as Pick<HotelMetaRow, "hid" | "name" | "star_rating">[];
  }
  const choices: ReadyHotelChoice[] = [];
  for (const row of rows) {
    const count = Math.ceil(pax / roomCapacity(row.room_type));
    if ((row.num_rooms ?? 0) - (row.consumed_rooms ?? 0) < count) continue;
    const info = meta.find((m) => m.hid === row.hid);
    const total = Number(row.price) * count;
    choices.push({
      key: `inventory-${row.id}`,
      spec: { mode: "offline", rowIds: Array(count).fill(row.id) as number[] },
      name: info?.name || row.hotel_name,
      stars: Math.round(Number(info?.star_rating) || 0),
      roomName: count > 1 ? `${count} x ${row.room_type}` : row.room_type,
      meal: row.meal_plan || "nomeal",
      totalPrice: Math.round(total),
      pricePerPerson: Math.round(total / pax),
      image: null,
      distanceM: null,
      refundable: !!row.last_cancellation_date,
      offline: true,
    });
  }
  return choices;
}

/** Flight blocks of our own inventory linked to the event that can still seat this party. */
async function offlineFlightChoices(event: ReadyEventRow, pax: number): Promise<ReadyFlightChoice[]> {
  const { data, error } = await megaEventsFlights()
    .select(FLIGHT_COLUMNS)
    .contains("event_ids", [event.id])
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("price", { ascending: true });
  if (error) {
    console.error("ready-package: inventory flights failed", JSON.stringify(error));
    return [];
  }
  const rows = (data ?? []) as unknown as FlightRow[];
  const choices: ReadyFlightChoice[] = [];
  for (const row of rows) {
    if (new Date(row.outbound_departure_time).getTime() <= Date.now()) continue;
    if ((row.initial_quantity ?? 0) - (row.consumed_quantity ?? 0) < pax) continue;
    const choice = toFlightChoice(buildFlightSnapshot(row, pax) as unknown as LiveFlightOffer, pax);
    if (choice) choices.push(choice);
  }
  return choices;
}

/**
 * Our own inventory linked to the event, for one party size - what the builder
 * shows before any search: a database read, no supplier call. A block or a room
 * that cannot seat the party is left out.
 */
export async function loadInventory(eventId: number, travelers: number): Promise<ReadyInventory | null> {
  const event = await loadReadyEvent(eventId);
  if (!event || !isLive(event)) return null;
  const [flights, hotels] = await Promise.all([
    offlineFlightChoices(event, travelers),
    offlineHotelChoices(event, travelers),
  ]);
  return { flights, hotels };
}

export type HotelChoicesResult =
  | { ok: true; hotels: ReadyHotelChoice[] }
  | { ok: false; error: string };

/** The hotel rooms a package of this event can carry, for this party: our inventory first, then main's search by price. */
export async function searchBuildHotels(input: {
  eventId: number;
  checkin: string;
  checkout: string;
  travelers: number;
  query?: string;
}): Promise<HotelChoicesResult> {
  const event = await loadReadyEvent(input.eventId);
  if (!event || !isLive(event)) return { ok: false, error: "The event was not found or has passed." };
  const [inventory, res] = await Promise.all([
    offlineHotelChoices(event, input.travelers),
    searchHotelsViaMain({
      eventId: input.eventId,
      checkin: input.checkin,
      checkout: input.checkout,
      travelers: input.travelers,
      query: input.query,
    }),
  ]);
  if (!res.ok) return inventory.length > 0 ? { ok: true, hotels: inventory } : res;
  const live = res.options
    .map((o) => toHotelChoice(o, input.travelers))
    .filter((c): c is ReadyHotelChoice => c !== null);
  const query = (input.query ?? "").trim().toLowerCase();
  const ours = query ? inventory.filter((c) => c.name.toLowerCase().includes(query)) : inventory;
  return { ok: true, hotels: [...ours, ...live] };
}

export type BuildSuggestion =
  | {
      ok: true;
      ticket: ReadyTicketChoice;
      /** Null when the search had nothing to offer - staff then search by hand. */
      flight: ReadyFlightChoice | null;
      hotel: ReadyHotelChoice | null;
      notes: string[];
      departureDate: string;
      returnDate: string;
    }
  | { ok: false; error: string };

/**
 * What "Compose automatically" fills in, by a plain rule over the event's
 * default travel window: the cheapest ticket on sale (or the named category),
 * the cheapest direct flight with a checked bag, the cheapest hotel of
 * `minStars`+ with a meal - each falling back one step when nothing fits, and
 * saying so. It chooses; it saves nothing.
 */
export async function suggestBuild(input: {
  eventId: number;
  travelers?: number;
  category?: string;
  minStars?: number;
}): Promise<BuildSuggestion> {
  const event = await loadReadyEvent(input.eventId);
  if (!event || !isLive(event)) return { ok: false, error: "The event was not found or has passed." };
  const pax = Math.max(1, Math.min(READY_MAX_TRAVELERS_CAP, Math.floor(input.travelers ?? 2)));
  const notes: string[] = [];

  const onSale = ticketsOnSale(event);
  const ticket = input.category
    ? onSale.find((t) => t.category === input.category)
    : [...onSale].sort((a, b) => a.price - b.price)[0];
  if (!ticket) return { ok: false, error: "No ticket on sale matches." };

  const { departureDate, returnDate } = defaultWindow(event);
  const [flights, hotels] = await Promise.all([
    searchBuildFlights({ eventId: event.id, departureDate, returnDate, travelers: pax }),
    searchBuildHotels({ eventId: event.id, checkin: departureDate, checkout: returnDate, travelers: pax }),
  ]);

  const flight = flights.ok ? pickSuggestedFlight(flights.flights) : null;
  if (!flights.ok) notes.push(`flight search failed: ${flights.error}`);
  else if (!flight) notes.push("the flight search came back empty");
  else if (flight.note) notes.push(flight.note);

  const hotel = hotels.ok ? pickSuggestedHotel(hotels.hotels, input.minStars ?? 4) : null;
  if (!hotels.ok) notes.push(`hotel search failed: ${hotels.error}`);
  else if (!hotel) notes.push("the hotel search came back empty");
  else if (hotel.note) notes.push(hotel.note);

  return {
    ok: true,
    ticket,
    flight: flight?.choice ?? null,
    hotel: hotel?.choice ?? null,
    notes,
    departureDate,
    returnDate,
  };
}

/**
 * A whole composition by the same rule, for a package made without any screen
 * (scripts/ready-package-create.ts): the suggestion, looked up and priced.
 */
export async function composeAuto(input: {
  eventId: number;
  travelers?: number;
  category?: string;
  minStars?: number;
}): Promise<{ ok: true; composition: Composition; notes: string[] } | { ok: false; error: string }> {
  const suggestion = await suggestBuild(input);
  if (!suggestion.ok) return suggestion;
  if (!suggestion.flight || !suggestion.hotel) {
    return { ok: false, error: suggestion.notes.join("; ") || "Nothing to compose from." };
  }
  const event = await loadReadyEvent(input.eventId);
  if (!event) return { ok: false, error: "The event was not found or has passed." };
  const pax = Math.max(1, Math.min(READY_MAX_TRAVELERS_CAP, Math.floor(input.travelers ?? 2)));
  const built = await buildVariant(
    event,
    {
      ticket: { id: suggestion.ticket.id, category: suggestion.ticket.category },
      flight: suggestion.flight.spec,
      hotel: suggestion.hotel.spec,
      defaultTravelers: pax,
    },
    pax,
  );
  if (!built.ok) return { ok: false, error: built.reason };
  const { variant } = built;
  return {
    ok: true,
    notes: suggestion.notes,
    composition: {
      event_order_info: variant.event_order_info,
      flight_order_info: variant.flight_order_info,
      flight_skipped: variant.flight_skipped,
      hotel_order_info: variant.hotel_order_info,
      hotel_skipped: variant.hotel_skipped,
      num_travelers: pax,
      hotel_image: variant.hotel_image ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// The card's view
// ---------------------------------------------------------------------------

export function toReadyView(pkg: HousePackageRow, event: ReadyEventRow): ReadyPackageView {
  const max = READY_MAX_TRAVELERS_CAP;
  const defaultTravelers = pkg.spec?.defaultTravelers ?? pkg.num_travelers;
  const allowed = allowedSizes(pkg.spec ?? { defaultTravelers });
  const sizes = variantSizes(pkg.variants, max).filter((n) => allowed.includes(n));
  const shown = pkg.variants?.[String(defaultTravelers)] ?? (sizes.length > 0 ? pkg.variants![String(sizes[0])] : null);
  const ticket = shown?.event_order_info as { category?: string; price_per_ticket?: number } | undefined;
  const status = pkg.refresh_status;
  return {
    packageId: pkg.id,
    token: pkg.share_token,
    // The event decides: a house row the event no longer points at is off.
    mode: event.ready_package_token === pkg.share_token ? readyMode(event.ready_package_mode) : "off",
    allowEdit: pkg.allow_edit !== false,
    swap: swapOf(pkg.spec, pkg.allow_edit),
    spec: pkg.spec,
    maxTravelers: max,
    defaultTravelers,
    allowed,
    sizes,
    pricePerPerson: shown?.price_per_person ?? null,
    refreshedAt: pkg.refreshed_at,
    refreshStatus: status === "ok" || status === "partial" || status === "broken" ? status : null,
    refreshNote: pkg.refresh_note,
    ticketLabel: ticket?.category
      ? `${ticket.category}${ticket.price_per_ticket != null ? ` · $${ticket.price_per_ticket}` : ""}`
      : pkg.spec?.ticket.category ?? "",
    flightLabel: flightLabel(shown?.flight_order_info as FlightLike | null, shown?.flight_skipped ?? false),
    hotelLabel: hotelLabel(shown?.hotel_order_info as HotelLike | null, shown?.hotel_skipped ?? false),
    previewUrl: readyPreviewUrl(PUBLIC_SITE_URL, event.id, pkg.share_token),
  };
}

// ---------------------------------------------------------------------------
// The nightly pass
// ---------------------------------------------------------------------------

export type ReadyRefreshPass = {
  candidates: number;
  refreshed: RefreshSummary[];
  /** Packages the budget did not reach - they are first tomorrow. */
  remaining: number;
  /** Events whose LIVE package cannot open. */
  brokenLive: { eventId: number; name: string; note: string | null }[];
};

/**
 * Every house package an event opens on (preview or live), least recently
 * refreshed first, inside one time budget.
 */
export async function runReadyPackageRefresh(opts: {
  dryRun?: boolean;
  budgetMs: number;
}): Promise<ReadyRefreshPass> {
  const deadline = Date.now() + opts.budgetMs;
  const { data: eventRows, error: eventsError } = await supabaseTyped
    .from("events")
    .select("id, name, ready_package_token, ready_package_mode")
    .not("ready_package_token", "is", null)
    .in("ready_package_mode", ["preview", "live"])
    .is("is_deleted", null);
  if (eventsError) {
    console.error("ready-package: refresh targets failed", JSON.stringify(eventsError));
    throw new Error("Could not load the events with a ready package");
  }
  const events = eventRows ?? [];
  const tokens = events.map((e) => e.ready_package_token).filter((t): t is string => !!t);
  if (tokens.length === 0) return { candidates: 0, refreshed: [], remaining: 0, brokenLive: [] };

  const { data: pkgRows, error: pkgError } = await supabase
    .from("prepared_packages")
    .select(HOUSE_COLUMNS)
    .eq("kind", "house")
    .in("share_token", tokens)
    .order("refreshed_at", { ascending: true, nullsFirst: true });
  if (pkgError) {
    console.error("ready-package: refresh packages failed", JSON.stringify(pkgError));
    throw new Error("Could not load the ready packages");
  }
  const packages = (pkgRows ?? []) as unknown as HousePackageRow[];

  const refreshed: RefreshSummary[] = [];
  const brokenLive: ReadyRefreshPass["brokenLive"] = [];
  let remaining = 0;
  for (const pkg of packages) {
    if (Date.now() > deadline) {
      remaining += 1;
      continue;
    }
    const summary = await refreshHousePackage(pkg, { dryRun: opts.dryRun, deadline });
    refreshed.push(summary);
    const event = events.find((e) => e.ready_package_token === pkg.share_token);
    if (summary.status === "broken" && event && readyMode(event.ready_package_mode) === "live") {
      brokenLive.push({ eventId: event.id, name: event.name, note: summary.note });
    }
  }
  return { candidates: packages.length, refreshed, remaining, brokenLive };
}
