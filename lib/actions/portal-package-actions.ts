"use server";

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { partnerLink } from "@/lib/site";
import type { EventTicket, EventType } from "@/types/app.types";

/**
 * Prepared packages — the portal's live-link builder.
 *
 * A partner assembles a concrete ticket(+flight)(+hotel) combination from the
 * inventory this backoffice already manages and gets a link that lands their
 * follower on myt-main's order page with everything pre-selected:
 * `{main}/order/{eventId}?utm_source={code}&pkg={share_token}`.
 *
 * myt-main consumes the token in `app/api/package/[id]/route.ts`, re-validating
 * every piece against live data (event gone/sold out → 410, stale flight/hotel
 * → dropped with a `_needs_repick` flag). So the snapshots written here are a
 * convenience, never a price commitment — but their JSON shapes MUST match what
 * main's own order flow round-trips through `reservations.*_order_info`:
 * the flattened ticket object, main's `Flight`, and main's `OrderHotel`.
 * The builders below mirror main's `transformDbFlightToFlight`
 * (app/api/flights/search/route.ts) and the synthetic offline-hotel rate
 * (app/api/offline-hotels/route.ts). Change those → change these.
 */

const PORTAL_PACKAGES_PATH = "/portal/packages";

/** Mirrors main's OFFLINE_ROOM_CAPACITY (lib/offlineRoomCapacity.ts). */
const ROOM_CAPACITY: Record<string, number> = {
  Standard: 2,
  Double: 2,
  Twin: 2,
  Triple: 3,
  Deluxe: 2,
  "Junior Suite": 2,
  Suite: 2,
  "Family Room": 4,
  Studio: 2,
};

const roomCapacity = (roomType: string | null | undefined): number =>
  (roomType && ROOM_CAPACITY[roomType]) || 2;

/**
 * Postgres renders `interval` as "HH:MM:SS" over the REST API; main's flight
 * search converts that to an ISO-8601 duration with tinyduration. Same output
 * here without the dependency ("04:05:00" → "PT4H5M").
 */
function pgIntervalToPT(value: string | null | undefined): string {
  if (!value) return "PT0M";
  const raw = String(value);
  if (raw.startsWith("PT") || raw.startsWith("P")) return raw;
  const [hours, minutes] = raw.split(":").map(Number);
  const h = Number.isFinite(hours) ? hours : 0;
  const m = Number.isFinite(minutes) ? minutes : 0;
  if (h && m) return `PT${h}H${m}M`;
  if (h) return `PT${h}H`;
  return `PT${m}M`;
}

function intervalToHours(value: string | null | undefined): number | null {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isFinite(hours)) return null;
  return Math.round((hours + (Number.isFinite(minutes) ? minutes : 0) / 60) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Builder data — what the wizard shows
// ---------------------------------------------------------------------------

export interface BuilderEvent {
  id: number;
  name: string;
  date: string;
  location_name: string;
  type: EventType;
  tickets: { category: string; price: number; id: string; vendor?: string }[];
}

type EventListRow = {
  id: number;
  name: string;
  date: string;
  location: { name?: string } | null;
  type: string;
  tickets_and_rates: EventTicket[] | null;
  is_deleted?: string | null;
};

export async function getPackageBuilderEvents(): Promise<BuilderEvent[]> {
  await requirePartner();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("events")
    .select("id, name, date, location, type, tickets_and_rates")
    .is("is_deleted", null)
    .gte("date", new Date().toISOString())
    .order("date", { ascending: true })
    .limit(300);

  if (error) {
    console.error("getPackageBuilderEvents:", JSON.stringify(error));
    return [];
  }

  return ((data ?? []) as EventListRow[]).map((row) => {
    const tickets = ((row.tickets_and_rates ?? []) as EventTicket[])
      .filter((t) => t && t.available !== false && typeof t.category === "string")
      .map((t) => ({ category: t.category, price: t.price, id: t.id, vendor: t.vendor }));
    const location = (row.location ?? {}) as { name?: string };
    return {
      id: row.id,
      name: row.name,
      date: row.date,
      location_name: location.name ?? "",
      type: row.type as EventType,
      tickets,
    };
  });
}

export interface BuilderFlight {
  id: number;
  airline_name: string;
  airline_logo: string;
  /** Per-traveler price in USD. */
  price: number;
  remaining: number;
  outbound_departure_time: string;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  outbound_flight_number: string;
  inbound_departure_time: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
  inbound_flight_number: string;
  outbound_stop_airport: string | null;
  inbound_stop_airport: string | null;
}

export interface BuilderHotelRoom {
  rowId: number;
  hid: number | null;
  hotel_name: string;
  city: string;
  room_type: string;
  capacity: number;
  check_in: string;
  check_out: string;
  /** Total per room for the whole stay, USD. */
  price: number;
  remaining: number;
  meal_plan: string | null;
  stars: number;
}

export interface BuilderInventory {
  flights: BuilderFlight[];
  hotels: BuilderHotelRoom[];
}

const FLIGHT_COLUMNS =
  "id, price, duration, stops, airline_code, initial_quantity, consumed_quantity, " +
  "outbound_departure_time, outbound_departure_airport, outbound_arrival_airport, outbound_arrival_time, outbound_duration, outbound_check_bags_included, outbound_cabin_bags_included, outbound_flight_number, " +
  "inbound_departure_time, inbound_departure_airport, inbound_arrival_airport, inbound_arrival_time, inbound_duration, inbound_check_bags_included, inbound_cabin_bags_included, inbound_flight_number, " +
  "metadata_iata, metadata_name, metadata_logo, checked_bag_kg, cabin_bag_kg, " +
  "outbound_stop_airport, outbound_stop_duration, inbound_stop_airport, inbound_stop_duration";

type FlightRow = {
  id: number;
  price: number | string;
  duration: string;
  stops: number;
  airline_code: string;
  initial_quantity: number;
  consumed_quantity: number;
  outbound_departure_time: string;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  outbound_arrival_time: string;
  outbound_duration: string;
  outbound_check_bags_included: boolean;
  outbound_cabin_bags_included: boolean;
  outbound_flight_number: string;
  inbound_departure_time: string;
  inbound_departure_airport: string;
  inbound_arrival_airport: string;
  inbound_arrival_time: string;
  inbound_duration: string;
  inbound_check_bags_included: boolean;
  inbound_cabin_bags_included: boolean;
  inbound_flight_number: string;
  metadata_iata: string;
  metadata_name: string;
  metadata_logo: string;
  checked_bag_kg: number | null;
  cabin_bag_kg: number | null;
  outbound_stop_airport: string | null;
  outbound_stop_duration: string | null;
  inbound_stop_airport: string | null;
  inbound_stop_duration: string | null;
};

const HOTEL_COLUMNS =
  "id, hid, hotel_name, city, check_in, check_out, price, room_type, num_rooms, consumed_rooms, meal_plan, last_cancellation_date";

type HotelRow = {
  id: number;
  hid: number | null;
  hotel_name: string;
  city: string;
  check_in: string;
  check_out: string;
  price: number | string;
  room_type: string;
  num_rooms: number;
  consumed_rooms: number;
  meal_plan: string | null;
  last_cancellation_date: string | null;
};

type HotelMetaRow = {
  hid: number;
  name: string;
  star_rating: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  amenity_groups: { group_name: string; amenities: string[] }[] | null;
};

export async function getPackageBuilderInventory(eventId: number): Promise<BuilderInventory> {
  await requirePartner();

  const id = Number(eventId);
  if (!Number.isFinite(id)) return { flights: [], hotels: [] };

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const [flightsRes, hotelsRes] = await Promise.all([
    supabase
      .from("flights")
      .select(FLIGHT_COLUMNS)
      .contains("event_ids", [id])
      .eq("is_deleted", false)
      .gte("outbound_departure_time", nowIso)
      .order("outbound_departure_time", { ascending: true }),
    supabase
      .from("offline_hotels")
      .select(HOTEL_COLUMNS)
      .contains("event_ids", [id])
      .eq("is_deleted", false)
      .gte("check_in", today)
      .order("price", { ascending: true }),
  ]);

  if (flightsRes.error) console.error("getPackageBuilderInventory flights:", JSON.stringify(flightsRes.error));
  if (hotelsRes.error) console.error("getPackageBuilderInventory hotels:", JSON.stringify(hotelsRes.error));

  const flights = ((flightsRes.data ?? []) as FlightRow[])
    .map((f) => ({
      id: f.id,
      airline_name: f.metadata_name,
      airline_logo: f.metadata_logo,
      price: Number(f.price),
      remaining: (f.initial_quantity ?? 0) - (f.consumed_quantity ?? 0),
      outbound_departure_time: f.outbound_departure_time,
      outbound_departure_airport: f.outbound_departure_airport,
      outbound_arrival_airport: f.outbound_arrival_airport,
      outbound_flight_number: f.outbound_flight_number,
      inbound_departure_time: f.inbound_departure_time,
      inbound_departure_airport: f.inbound_departure_airport,
      inbound_arrival_airport: f.inbound_arrival_airport,
      inbound_flight_number: f.inbound_flight_number,
      outbound_stop_airport: f.outbound_stop_airport,
      inbound_stop_airport: f.inbound_stop_airport,
    }))
    .filter((f) => f.remaining > 0);

  const hotelRows = (hotelsRes.data ?? []) as HotelRow[];
  const hids = hotelRows.filter((h) => h.hid != null).map((h) => h.hid as number);
  let meta: HotelMetaRow[] = [];
  if (hids.length > 0) {
    const { data: metaRows } = await supabase
      .from("hotels")
      .select("hid, name, star_rating, address, latitude, longitude, amenity_groups")
      .in("hid", hids);
    meta = (metaRows ?? []) as HotelMetaRow[];
  }

  const hotels = hotelRows
    .map((h) => ({
      rowId: h.id,
      hid: h.hid,
      hotel_name: meta.find((m) => m.hid === h.hid)?.name || h.hotel_name,
      city: h.city,
      room_type: h.room_type,
      capacity: roomCapacity(h.room_type),
      check_in: h.check_in,
      check_out: h.check_out,
      price: Number(h.price),
      remaining: (h.num_rooms ?? 0) - (h.consumed_rooms ?? 0),
      meal_plan: h.meal_plan,
      stars: meta.find((m) => m.hid === h.hid)?.star_rating ?? 0,
    }))
    .filter((h) => h.remaining > 0);

  return { flights, hotels };
}

// ---------------------------------------------------------------------------
// Snapshot builders — shapes owned by myt-main, mirrored here
// ---------------------------------------------------------------------------

type FlightStop = { iataCode: string; duration: number | null };

/** Mirrors main's buildOfflineStops (lib/flights/offlineStops.ts). */
function buildStops(
  arrivalAirport: string,
  stopAirport: string | null,
  stopDurationHours: number | null,
): FlightStop[] {
  const destination: FlightStop = { iataCode: arrivalAirport, duration: null };
  if (!stopAirport) return [destination];
  return [{ iataCode: stopAirport, duration: stopDurationHours }, destination];
}

/** Main's `Flight` for an offline row — mirrors transformDbFlightToFlight. */
function buildFlightSnapshot(row: FlightRow, travelers: number) {
  return {
    offer: {},
    id: "1",
    numOfTravelers: travelers,
    price: Number(row.price) * travelers,
    duration: pgIntervalToPT(row.duration),
    stops: Number(row.stops) || 0,
    airline: row.airline_code,
    outbound: {
      stops: buildStops(
        row.outbound_arrival_airport,
        row.outbound_stop_airport,
        intervalToHours(row.outbound_stop_duration),
      ),
      departureTime: row.outbound_departure_time,
      departureAirport: row.outbound_departure_airport,
      arrivalAirport: row.outbound_arrival_airport,
      arrivalTime: row.outbound_arrival_time,
      duration: pgIntervalToPT(row.outbound_duration),
      checkBagsIncluded: row.outbound_check_bags_included,
      cabinBagsIncluded: row.outbound_cabin_bags_included,
      checkedBagKg: row.checked_bag_kg ?? null,
      cabinBagKg: row.cabin_bag_kg ?? null,
      flightNumber: row.outbound_flight_number,
    },
    inbound: {
      stops: buildStops(
        row.inbound_arrival_airport,
        row.inbound_stop_airport,
        intervalToHours(row.inbound_stop_duration),
      ),
      departureTime: row.inbound_departure_time,
      departureAirport: row.inbound_departure_airport,
      arrivalAirport: row.inbound_arrival_airport,
      arrivalTime: row.inbound_arrival_time,
      duration: pgIntervalToPT(row.inbound_duration),
      checkBagsIncluded: row.inbound_check_bags_included,
      cabinBagsIncluded: row.inbound_cabin_bags_included,
      checkedBagKg: row.checked_bag_kg ?? null,
      cabinBagKg: row.cabin_bag_kg ?? null,
      flightNumber: row.inbound_flight_number,
    },
    metadata: {
      iata: row.metadata_iata,
      country: "",
      name: row.metadata_name,
      logo: row.metadata_logo,
    },
    isOffline: true,
    offlineId: row.id,
    offlineRawPrice: Number(row.price),
  };
}

/**
 * Main's `OrderHotel` for a set of offline room units — mirrors the synthetic
 * rate main's /api/offline-hotels builds, so OrderReview renders it exactly
 * like a hotel the customer picked themselves.
 */
function buildHotelSnapshot(
  units: { row: HotelRow; count: number }[],
  meta: HotelMetaRow | null,
  travelers: number,
) {
  const anchor = units[0].row;
  const id = `offline-${anchor.hid ?? anchor.id}`;

  const offlineIds: number[] = [];
  let totalPrice = 0;
  for (const { row, count } of units) {
    for (let i = 0; i < count; i++) {
      offlineIds.push(row.id);
      totalPrice += Number(row.price);
    }
  }

  // One guests entry per room unit, travelers distributed by capacity.
  const guests: { adults: number; children: number[] }[] = [];
  let unassigned = travelers;
  const flatUnits = units.flatMap(({ row, count }) => Array(count).fill(row) as HotelRow[]);
  flatUnits.forEach((row, i) => {
    const remainingUnits = flatUnits.length - i - 1;
    const take = Math.max(1, Math.min(roomCapacity(row.room_type), unassigned - remainingUnits));
    guests.push({ adults: Math.max(1, take), children: [] });
    unassigned -= take;
  });

  const cancellationDates = units
    .map(({ row }) => row.last_cancellation_date)
    .filter((d): d is string => !!d);
  const freeCancellationBefore = cancellationDates.length > 0 ? [...cancellationDates].sort()[0] : "";

  const totalPriceStr = String(totalPrice);
  const roomName = anchor.room_type || "Standard Room";

  const rate = {
    match_hash: `offline-${id}`,
    daily_prices: [],
    meal: anchor.meal_plan || "nomeal",
    payment_options: {
      payment_types: [
        {
          amount: totalPriceStr,
          show_amount: totalPriceStr,
          currency_code: "USD",
          show_currency_code: "USD",
          by: "offline",
          is_need_credit_card_data: false,
          is_need_cvc: false,
          type: "deposit",
          tax_data: { taxes: [] },
          cancellation_penalties: {
            policies: [],
            free_cancellation_before: freeCancellationBefore,
          },
        },
      ],
    },
    rg_ext: { class: 0, quality: 0, sex: 0, bathroom: 0, bedding: 0, family: 0, capacity: 0, club: 0 },
    room_name: roomName,
    room_name_info: null,
    serp_filters: [],
    allotment: null,
    amenities_data: [],
    any_residency: false,
    deposit: null,
    no_show: null,
    room_data_trans: {
      main_room_type: roomName,
      main_name: roomName,
      bathroom: null,
      bedding_type: "",
      misc_room_type: null,
    },
    meal_data: {
      has_breakfast: !!anchor.meal_plan,
      no_child_meal: false,
      value: anchor.meal_plan || "",
    },
  };

  const generalAmenities =
    (meta?.amenity_groups ?? []).find((g) => g.group_name === "General")?.amenities ?? [];

  return {
    rate,
    address: meta?.address || anchor.city,
    name: meta?.name || anchor.hotel_name,
    id,
    price: totalPriceStr,
    guests,
    checkin: anchor.check_in,
    checkout: anchor.check_out,
    isOffline: true,
    offlineId: offlineIds[0],
    offlineIds,
    offlineRawPrice: totalPrice,
    hotelInformation: {
      hotelName: meta?.name || anchor.hotel_name,
      roomName,
      stars: meta?.star_rating ?? 0,
      amenities: generalAmenities,
      distance: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Create / list / delete
// ---------------------------------------------------------------------------

export type CreatePackageInput = {
  eventId: number;
  category: string;
  qty: number;
  flight: { mode: "offline"; flightId: number } | { mode: "live" } | { mode: "none" };
  hotel: { mode: "offline"; units: { rowId: number; count: number }[] } | { mode: "live" } | { mode: "none" };
};

export type CreatePackageResult = { ok: true; link: string } | { ok: false; error: string };

export async function createPreparedPackage(input: CreatePackageInput): Promise<CreatePackageResult> {
  const session = await requirePartner();

  const eventId = Number(input.eventId);
  if (!Number.isFinite(eventId)) return { ok: false, error: "אירוע לא תקין" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eventData, error: eventError } = await (supabase as any)
    .from("events")
    .select("id, name, date, location, type, tickets_and_rates, is_deleted")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    console.error("createPreparedPackage event:", JSON.stringify(eventError));
    return { ok: false, error: "שגיאה בטעינת האירוע" };
  }
  const event = eventData as EventListRow | null;
  if (!event || event.is_deleted || new Date(event.date).getTime() <= Date.now()) {
    return { ok: false, error: "האירוע לא נמצא או שאינו זמין יותר" };
  }

  const qty = Math.max(1, Math.min(999, Math.floor(input.qty || 1)));

  // Re-derive the ticket from the live event — the client sends only the
  // category name, never a price (same rule as main's savePreparedPackage).
  const liveTicket = ((event.tickets_and_rates ?? []) as EventTicket[]).find(
    (t) => t && t.category === input.category && t.available !== false,
  );
  if (!liveTicket) return { ok: false, error: "סוג הכרטיס שנבחר אינו זמין" };

  const location = (event.location ?? {}) as { name?: string };
  const eventOrderInfo = {
    event_id: event.id,
    date: event.date,
    name: event.name,
    location_name: location.name ?? "",
    number_of_ticket: qty,
    category: liveTicket.category,
    event_type: event.type,
    price_per_ticket: liveTicket.price,
    total_tickets_price: liveTicket.price * qty,
    vendor: liveTicket.vendor,
    id: liveTicket.id,
  };

  // Flight
  let flightOrderInfo: ReturnType<typeof buildFlightSnapshot> | null = null;
  const flightSkipped = input.flight.mode === "none";
  if (input.flight.mode === "offline") {
    const { data: flightRow, error: flightError } = await supabase
      .from("flights")
      .select(`${FLIGHT_COLUMNS}, event_ids, is_deleted`)
      .eq("id", input.flight.flightId)
      .maybeSingle();
    if (flightError) {
      console.error("createPreparedPackage flight:", JSON.stringify(flightError));
      return { ok: false, error: "שגיאה בטעינת הטיסה" };
    }
    const row = flightRow as (FlightRow & { event_ids: number[]; is_deleted: boolean | null }) | null;
    if (
      !row ||
      row.is_deleted ||
      !(row.event_ids ?? []).includes(eventId) ||
      new Date(row.outbound_departure_time).getTime() <= Date.now()
    ) {
      return { ok: false, error: "הטיסה שנבחרה אינה זמינה לאירוע הזה" };
    }
    if ((row.initial_quantity ?? 0) - (row.consumed_quantity ?? 0) < qty) {
      return { ok: false, error: "אין מספיק מקומות פנויים בטיסה שנבחרה" };
    }
    flightOrderInfo = buildFlightSnapshot(row, qty);
  }

  // Hotel
  let hotelOrderInfo: ReturnType<typeof buildHotelSnapshot> | null = null;
  const hotelSkipped = input.hotel.mode === "none";
  if (input.hotel.mode === "offline") {
    const requested = (input.hotel.units ?? []).filter((u) => u && u.count > 0);
    if (requested.length === 0) return { ok: false, error: "יש לבחור חדרים" };

    const rowIds = requested.map((u) => Number(u.rowId));
    const { data: hotelRows, error: hotelError } = await supabase
      .from("offline_hotels")
      .select(`${HOTEL_COLUMNS}, event_ids, is_deleted`)
      .in("id", rowIds);
    if (hotelError) {
      console.error("createPreparedPackage hotel:", JSON.stringify(hotelError));
      return { ok: false, error: "שגיאה בטעינת המלון" };
    }

    const units: { row: HotelRow; count: number }[] = [];
    for (const u of requested) {
      const row = ((hotelRows ?? []) as (HotelRow & { event_ids: number[]; is_deleted: boolean | null })[]).find(
        (r) => r.id === Number(u.rowId),
      );
      if (!row || row.is_deleted || !(row.event_ids ?? []).includes(eventId)) {
        return { ok: false, error: "אחד החדרים שנבחרו אינו זמין לאירוע הזה" };
      }
      const count = Math.max(1, Math.min(9, Math.floor(u.count)));
      if ((row.num_rooms ?? 0) - (row.consumed_rooms ?? 0) < count) {
        return { ok: false, error: `אין מספיק חדרים פנויים (${row.hotel_name} — ${row.room_type})` };
      }
      units.push({ row, count });
    }

    // All units must belong to one hotel with one date window — that is the
    // one combination main can present as a single OrderHotel.
    const anchor = units[0].row;
    const sameHotel = units.every(
      ({ row }) =>
        (row.hid != null && row.hid === anchor.hid) ||
        (row.hid == null && anchor.hid == null && row.hotel_name === anchor.hotel_name),
    );
    const sameDates = units.every(
      ({ row }) => row.check_in === anchor.check_in && row.check_out === anchor.check_out,
    );
    if (!sameHotel || !sameDates) {
      return { ok: false, error: "יש לבחור חדרים מאותו מלון ובאותם תאריכים" };
    }

    const totalCapacity = units.reduce(
      (sum, { row, count }) => sum + roomCapacity(row.room_type) * count,
      0,
    );
    if (totalCapacity < qty) {
      return { ok: false, error: "החדרים שנבחרו אינם מספיקים למספר הנוסעים" };
    }

    let meta: HotelMetaRow | null = null;
    if (anchor.hid != null) {
      const { data: metaRow } = await supabase
        .from("hotels")
        .select("hid, name, star_rating, address, latitude, longitude, amenity_groups")
        .eq("hid", anchor.hid)
        .maybeSingle();
      meta = (metaRow as HotelMetaRow | null) ?? null;
    }

    hotelOrderInfo = buildHotelSnapshot(units, meta, qty);
  }

  // Opaque token — main looks packages up by this, never by the row id.
  const shareToken = crypto.randomUUID();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: insertError } = await (supabase as any)
    .from("prepared_packages")
    .insert({
      share_token: shareToken,
      partner_tracking_code: session.partner_code,
      created_by: session.sub,
      event_id: event.id,
      event_order_info: eventOrderInfo,
      flight_order_info: flightOrderInfo,
      flight_skipped: flightSkipped,
      hotel_order_info: hotelOrderInfo,
      hotel_skipped: hotelSkipped,
      num_travelers: qty,
    })
    .select("share_token")
    .single();

  if (insertError || !inserted) {
    console.error("createPreparedPackage insert:", JSON.stringify(insertError));
    return { ok: false, error: "שמירת החבילה נכשלה. נסו שוב." };
  }

  revalidatePath(PORTAL_PACKAGES_PATH);
  const token = (inserted as { share_token: string }).share_token;
  return { ok: true, link: partnerLink(session.partner_code, event.id, token) };
}

export interface PreparedPackageListItem {
  id: number;
  link: string;
  created_at: string;
  event_name: string;
  event_date: string;
  location_name: string;
  category: string;
  qty: number;
  price_per_ticket: number;
  /** "offline" = a specific flight is attached, "live" = customer picks, "none" = no flight. */
  flight: "offline" | "live" | "none";
  flight_summary: string | null;
  hotel: "offline" | "live" | "none";
  hotel_summary: string | null;
}

type PreparedPackageRow = {
  id: number;
  share_token: string;
  created_at: string;
  event_id: number;
  event_order_info: {
    name?: string;
    date?: string;
    location_name?: string;
    category?: string;
    number_of_ticket?: number;
    price_per_ticket?: number;
  } | null;
  flight_order_info: { airline?: string; outbound?: { departureTime?: string } } | null;
  flight_skipped: boolean;
  hotel_order_info: { name?: string; checkin?: string; checkout?: string } | null;
  hotel_skipped: boolean;
  num_travelers: number;
};

export async function getMyPreparedPackages(): Promise<PreparedPackageListItem[]> {
  const session = await requirePartner();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("prepared_packages")
    .select(
      "id, share_token, created_at, event_id, event_order_info, flight_order_info, flight_skipped, hotel_order_info, hotel_skipped, num_travelers",
    )
    .eq("partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("getMyPreparedPackages:", JSON.stringify(error));
    return [];
  }

  return ((data ?? []) as PreparedPackageRow[]).map((row) => {
    const info = row.event_order_info ?? {};
    const flightMode = row.flight_skipped ? "none" : row.flight_order_info ? "offline" : "live";
    const hotelMode = row.hotel_skipped ? "none" : row.hotel_order_info ? "offline" : "live";
    return {
      id: row.id,
      link: partnerLink(session.partner_code, row.event_id, row.share_token),
      created_at: row.created_at,
      event_name: info.name ?? `אירוע ${row.event_id}`,
      event_date: info.date ?? "",
      location_name: info.location_name ?? "",
      category: info.category ?? "",
      qty: info.number_of_ticket ?? row.num_travelers,
      price_per_ticket: info.price_per_ticket ?? 0,
      flight: flightMode,
      flight_summary:
        flightMode === "offline"
          ? `${row.flight_order_info?.airline ?? ""} · ${
              row.flight_order_info?.outbound?.departureTime?.slice(0, 10) ?? ""
            }`
          : null,
      hotel: hotelMode,
      hotel_summary:
        hotelMode === "offline"
          ? `${row.hotel_order_info?.name ?? ""} · ${row.hotel_order_info?.checkin ?? ""} → ${
              row.hotel_order_info?.checkout ?? ""
            }`
          : null,
    };
  });
}

export type DeletePackageResult = { ok: true } | { ok: false; error: string };

export async function deletePreparedPackage(id: number): Promise<DeletePackageResult> {
  const session = await requirePartner();

  const packageId = Number(id);
  if (!Number.isFinite(packageId)) return { ok: false, error: "חבילה לא תקינה" };

  // Scoped to the caller's own tracking code — a partner can only ever kill
  // their own links. Deleting a link only invalidates it; main answers 404 and
  // falls back to a normal order flow for anyone still holding it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("prepared_packages")
    .delete()
    .eq("id", packageId)
    .eq("partner_tracking_code", session.partner_code);

  if (error) {
    console.error("deletePreparedPackage:", JSON.stringify(error));
    return { ok: false, error: "מחיקת החבילה נכשלה" };
  }

  revalidatePath(PORTAL_PACKAGES_PATH);
  return { ok: true };
}
