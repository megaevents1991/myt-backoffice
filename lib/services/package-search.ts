// Live flight / hotel search for prepared packages, proxied to myt-main's own
// customer-facing APIs - so an offer pinned here is EXACTLY what a customer
// would be offered. Bodies moved verbatim out of
// lib/actions/portal-package-actions.ts (2026-10-04): the portal's two search
// actions keep their requirePartner() gate and call these; the ready-package
// service (staff actions + cron) calls them directly. These are NOT server
// actions - every caller does its own auth.

import { supabase } from "@/lib/supabase-server";
import type {
  LiveFlightOffer,
  LiveFlightSearchResult,
  LiveHotelOption,
  LiveHotelSearchResult,
} from "@/lib/actions/portal-package-actions";

/** myt-main's deployment - the same base URL the hotel proxy already uses. */
const MAIN_APP_URL = (
  process.env.NEXT_SECRET_HOTEL_SERVICE_URL || "https://www.mega-events.co.il"
).replace(/\/$/, "");

type WorldotaRate = {
  room_name?: string;
  meal?: string;
  payment_options?: {
    payment_types?: {
      show_amount?: string;
      cancellation_penalties?: { free_cancellation_before?: string | null };
    }[];
  };
  [key: string]: unknown;
};

type WorldotaHotel = { hid: number; id: string; rates: WorldotaRate[] };

type HotelsInfoEntry = {
  rooms?: Record<string, { name?: string }>;
  general?: { amenities?: string[]; images?: string[] };
  metadata?: {
    hotelName?: string;
    address?: string;
    rating?: number;
    distanceFromCenter?: number;
    kind?: string;
  };
};

export async function searchFlightsViaMain(input: {
  eventId: number;
  departureDate: string;
  returnDate: string;
  adults: number;
}): Promise<LiveFlightSearchResult> {
  const eventId = Number(input.eventId);
  if (!Number.isFinite(eventId)) return { ok: false, error: "אירוע לא תקין" };
  if (!input.departureDate || !input.returnDate) {
    return { ok: false, error: "יש לבחור תאריכי טיסה" };
  }
  // Amadeus rejects adults > 9 - surface that instead of a generic upstream 500.
  if ((input.adults || 1) > 9) {
    return {
      ok: false,
      error:
        "חיפוש טיסות חי נתמך עד 9 נוסעים - לקבוצה גדולה השאירו את בחירת הטיסה ללקוח או הצמידו טיסה מהמלאי",
    };
  }

  try {
    const res = await fetch(
      `${MAIN_APP_URL}/api/flights/search?eventId=${eventId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departureDate: input.departureDate,
          returnDate: input.returnDate,
          adults: Math.max(1, Math.min(9, Math.floor(input.adults || 1))),
          originLocationCode: "TLV",
          nonStop: false,
        }),
        // Amadeus searches are slow; main's route caps itself at 30s.
        signal: AbortSignal.timeout(35_000),
      },
    );
    const data = (await res.json()) as {
      flights?: LiveFlightOffer[];
      locked?: boolean;
      lockedSoldOut?: boolean;
      error?: string;
    };
    if (!res.ok) {
      console.error("searchLiveFlights upstream:", res.status, data?.error);
      return { ok: false, error: "חיפוש הטיסות נכשל. נסו שוב." };
    }
    return {
      ok: true,
      flights: data.flights ?? [],
      locked: data.locked === true,
      lockedSoldOut: data.lockedSoldOut === true,
    };
  } catch (err) {
    console.error("searchLiveFlights:", err);
    return { ok: false, error: "חיפוש הטיסות נכשל. נסו שוב." };
  }
}

export async function searchHotelsViaMain(input: {
  eventId: number;
  checkin: string;
  checkout: string;
  travelers: number;
  /** Optional hotel-name filter, matched against the FULL serp result. */
  query?: string;
  /**
   * An explicit room split (adults per room) instead of the usual one - e.g. [2, 1]
   * for a trio in a hotel that has no room for three. Its sum is the party.
   */
  rooms?: number[];
}): Promise<LiveHotelSearchResult> {
  const eventId = Number(input.eventId);
  if (!Number.isFinite(eventId)) return { ok: false, error: "אירוע לא תקין" };
  if (!input.checkin || !input.checkout || input.checkin >= input.checkout) {
    return { ok: false, error: "יש לבחור תאריכי שהייה תקינים" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eventData, error: eventError } = await (supabase as any)
    .from("events")
    .select("id, location")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError || !eventData) {
    console.error("searchLiveHotels event:", JSON.stringify(eventError));
    return { ok: false, error: "האירוע לא נמצא" };
  }
  const location = (
    eventData as {
      location: {
        latitude?: number;
        longitude?: number;
        country_code?: string;
      };
    }
  ).location;
  if (location?.latitude == null || location?.longitude == null) {
    return { ok: false, error: "לאירוע אין מיקום מוגדר" };
  }

  // Rooms of two, remainder joins the last room - same spirit as main's
  // getRoomParams seeding the party from the traveler count.
  const travelers = Math.max(1, Math.min(20, Math.floor(input.travelers || 1)));
  const guests: { adults: number; children: number[] }[] = [];
  const asked = (input.rooms ?? [])
    .map((n) => Math.floor(Number(n)))
    .filter((n) => n >= 1 && n <= 4);
  if (asked.length > 0) {
    for (const adults of asked) guests.push({ adults, children: [] });
  } else {
    let left = travelers;
    while (left > 0) {
      const take = left === 3 ? 3 : Math.min(2, left);
      guests.push({ adults: take, children: [] });
      left -= take;
    }
  }

  try {
    const searchRes = await fetch(`${MAIN_APP_URL}/api/hotels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location,
        checkin: input.checkin,
        checkout: input.checkout,
        guests,
        radius: location.country_code === "US" ? 5000 : 2000,
        eventId,
      }),
      signal: AbortSignal.timeout(35_000),
    });
    const search = (await searchRes.json()) as {
      data?: { hotels?: WorldotaHotel[] };
      debug?: {
        request?: { guests?: unknown; checkin?: string; checkout?: string };
      };
      error?: string | null;
    };
    if (!searchRes.ok || !search?.data?.hotels) {
      console.error(
        "searchLiveHotels upstream:",
        searchRes.status,
        search?.error,
      );
      return { ok: false, error: "חיפוש המלונות נכשל. נסו שוב." };
    }

    // Main shows EVERY hotel the serp returned - a hard cap here is why agents
    // couldn't find hotels the customer flow shows (the 2026-08 Tavistock gap:
    // central London returns ~224 hotels; a 20/60 cap hid most of them). The
    // 250 cap is a payload safety net (one rate ≈ 2KB, ≤4 rates per hotel kept)
    // that in practice lets the whole serp result through. A name query filters
    // the full list BEFORE the cap so a searched-for hotel always survives it.
    const allHotels = search.data.hotels ?? [];
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const q = slug(input.query ?? "");
    const pool = q
      ? allHotels.filter((h) => slug(h.id).includes(q))
      : allHotels;
    const hotels = pool.slice(0, q ? 50 : 250);
    if (hotels.length === 0) {
      return {
        ok: true,
        options: [],
        checkin: input.checkin,
        checkout: input.checkout,
      };
    }

    const infoRes = await fetch(`${MAIN_APP_URL}/api/hotels-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotels: hotels.map((h) => ({
          hid: h.hid,
          id: h.id,
          rooms: (h.rates ?? [])
            .map((r) => r.room_name)
            .filter(Boolean)
            .slice(0, 10),
        })),
        event: { location },
      }),
      signal: AbortSignal.timeout(35_000),
    });
    const info = (await infoRes.json()) as Record<string, HotelsInfoEntry>;

    const echoedGuests = search.debug?.request?.guests ?? guests;
    const checkin = search.debug?.request?.checkin ?? input.checkin;
    const checkout = search.debug?.request?.checkout ?? input.checkout;

    const options: LiveHotelOption[] = [];
    for (const hotel of hotels) {
      const entry = infoRes.ok ? info?.[hotel.id] : undefined;
      // Main drops hotels without usable static info from its cards too.
      if (!entry?.metadata) continue;

      const priced = (hotel.rates ?? [])
        .filter((r) => r?.payment_options?.payment_types?.[0]?.show_amount)
        .sort(
          (a, b) =>
            Number(a.payment_options!.payment_types![0].show_amount) -
            Number(b.payment_options!.payment_types![0].show_amount),
        );
      const rates = priced.slice(0, 3);
      // Same test as main's hotelFilter.ts `matchFreeCancellation`: ANY rate,
      // ANY payment type - over every priced rate, not the few kept below.
      const hotelHasFreeCancellation = priced.some((r) =>
        r.payment_options?.payment_types?.some(
          (pt) => !!pt.cancellation_penalties?.free_cancellation_before,
        ),
      );
      // "Add breakfast" = offering the breakfast rate: when the three cheapest
      // are all room-only, pull in the cheapest rate that includes a meal so
      // the agent can pick it side by side.
      const hasMeal = (r: WorldotaRate) => !!r.meal && r.meal !== "nomeal";
      if (!rates.some(hasMeal)) {
        const cheapestWithMeal = priced.find(hasMeal);
        if (cheapestWithMeal) rates.push(cheapestWithMeal);
      }

      for (const rate of rates) {
        const amount = Number(
          rate.payment_options!.payment_types![0].show_amount,
        );
        const roomName =
          rate.room_name ||
          entry.rooms?.[Object.keys(entry.rooms || {})[0]]?.name ||
          "";
        // The exact shape main's HotelSelection setHotel() produces for a live
        // hotel - /api/package/[id] and confirm-order round-trip it unchanged.
        const snapshot: Record<string, unknown> = {
          rate,
          address: entry.metadata.address ?? "",
          name: entry.metadata.hotelName ?? "",
          id: hotel.id,
          price: String(amount),
          guests: echoedGuests,
          checkin,
          checkout,
          hotelInformation: {
            hotelName: entry.metadata.hotelName ?? "",
            roomName,
            stars: entry.metadata.rating ?? 0,
            amenities: entry.general?.amenities ?? [],
            distance: entry.metadata.distanceFromCenter ?? 0,
          },
        };
        options.push({
          key: `${hotel.id}|${roomName}|${amount}`,
          name: entry.metadata.hotelName ?? "",
          stars: entry.metadata.rating ?? 0,
          address: entry.metadata.address ?? "",
          distance_m: entry.metadata.distanceFromCenter ?? 0,
          // Worldota image URLs carry a literal "{size}" placeholder - main's
          // hotelCard substitutes it too; without this the <img> 404s.
          image:
            entry.general?.images?.[0]?.replace("{size}", "x500") ?? null,
          room_name: roomName,
          meal: rate.meal ?? "nomeal",
          free_cancellation_before:
            rate.payment_options?.payment_types?.[0]?.cancellation_penalties
              ?.free_cancellation_before ?? null,
          kind: entry.metadata.kind ?? null,
          hotel_has_free_cancellation: hotelHasFreeCancellation,
          price: amount,
          checkin,
          checkout,
          snapshot,
        });
      }
    }

    options.sort((a, b) => a.price - b.price);
    // Up to ~4 rates per hotel; 1000 keeps every hotel the cap above let
    // through instead of silently dropping the pricier half of them.
    return { ok: true, options: options.slice(0, 1000), checkin, checkout };
  } catch (err) {
    console.error("searchLiveHotels:", err);
    return { ok: false, error: "חיפוש המלונות נכשל. נסו שוב." };
  }
}
