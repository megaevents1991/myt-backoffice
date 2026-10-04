// Snapshot builders for prepared packages - the JSON shapes main round-trips
// through reservations.*_order_info, built from our offline inventory rows.
// Moved verbatim out of lib/actions/portal-package-actions.ts (2026-10-04) so
// the ready-package service and its cron build the same snapshots the portal
// wizard does; that file imports them back. The shapes are owned by myt-main:
// they mirror its transformDbFlightToFlight (app/api/flights/search/route.ts)
// and the synthetic offline-hotel rate (app/api/offline-hotels/route.ts).
// Change those -> change these.

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

export const roomCapacity = (roomType: string | null | undefined): number =>
  (roomType && ROOM_CAPACITY[roomType]) || 2;

/**
 * Postgres renders `interval` as "HH:MM:SS" over the REST API; main's flight
 * search converts that to an ISO-8601 duration with tinyduration. Same output
 * here without the dependency ("04:05:00" → "PT4H5M").
 */
export function pgIntervalToPT(value: string | null | undefined): string {
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
  return (
    Math.round((hours + (Number.isFinite(minutes) ? minutes : 0) / 60) * 10) /
    10
  );
}

export const FLIGHT_COLUMNS =
  "id, price, duration, stops, airline_code, initial_quantity, consumed_quantity, " +
  "outbound_departure_time, outbound_departure_airport, outbound_arrival_airport, outbound_arrival_time, outbound_duration, outbound_check_bags_included, outbound_cabin_bags_included, outbound_flight_number, " +
  "inbound_departure_time, inbound_departure_airport, inbound_arrival_airport, inbound_arrival_time, inbound_duration, inbound_check_bags_included, inbound_cabin_bags_included, inbound_flight_number, " +
  "metadata_iata, metadata_name, metadata_logo, checked_bag_kg, cabin_bag_kg, " +
  "outbound_stop_airport, outbound_stop_duration, inbound_stop_airport, inbound_stop_duration";

export type FlightRow = {
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

export const HOTEL_COLUMNS =
  "id, hid, hotel_name, city, check_in, check_out, price, room_type, num_rooms, consumed_rooms, meal_plan, last_cancellation_date";

export type HotelRow = {
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

export type HotelMetaRow = {
  hid: number;
  name: string;
  star_rating: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  amenity_groups: { group_name: string; amenities: string[] }[] | null;
};

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

/** Main's `Flight` for an offline row - mirrors transformDbFlightToFlight. */
export function buildFlightSnapshot(row: FlightRow, travelers: number) {
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
 * Main's `OrderHotel` for a set of offline room units - mirrors the synthetic
 * rate main's /api/offline-hotels builds, so OrderReview renders it exactly
 * like a hotel the customer picked themselves.
 */
export function buildHotelSnapshot(
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
  const flatUnits = units.flatMap(
    ({ row, count }) => Array(count).fill(row) as HotelRow[],
  );
  flatUnits.forEach((row, i) => {
    const remainingUnits = flatUnits.length - i - 1;
    const take = Math.max(
      1,
      Math.min(roomCapacity(row.room_type), unassigned - remainingUnits),
    );
    guests.push({ adults: Math.max(1, take), children: [] });
    unassigned -= take;
  });

  const cancellationDates = units
    .map(({ row }) => row.last_cancellation_date)
    .filter((d): d is string => !!d);
  const freeCancellationBefore =
    cancellationDates.length > 0 ? [...cancellationDates].sort()[0] : "";

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
    rg_ext: {
      class: 0,
      quality: 0,
      sex: 0,
      bathroom: 0,
      bedding: 0,
      family: 0,
      capacity: 0,
      club: 0,
    },
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
    (meta?.amenity_groups ?? []).find((g) => g.group_name === "General")
      ?.amenities ?? [];

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
