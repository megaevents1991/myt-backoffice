"use server";

import { revalidatePath } from "next/cache";
import { requirePartner } from "@/lib/auth/guards";
import { mintPartnerHandoffToken } from "@/lib/auth/partner-handoff";
import { supabase } from "@/lib/supabase-server";
import { megaEventsFlights } from "@/lib/flights-scope";
import { fetchPaged } from "@/lib/supabase-paged";
import { MEGA_EVENTS_CREATOR } from "@/lib/portal-labels";
import { partnerLink, PUBLIC_SITE_URL } from "@/lib/site";
import {
  getAgentSlugForUser,
  agentUtmContent,
  resolvePortalScope,
} from "@/lib/portal-attribution";
import { SELLER_ROLES } from "@/types/auth.types";
import {
  computePackagePrice,
  computePerPersonPackagePrice,
  isEventSoldOut,
} from "@/lib/package-price";
import {
  FLIGHT_COLUMNS,
  HOTEL_COLUMNS,
  buildFlightSnapshot,
  buildHotelSnapshot,
  pgIntervalToPT,
  roomCapacity,
  type FlightRow,
  type HotelMetaRow,
  type HotelRow,
} from "@/lib/services/package-snapshots";
import {
  searchFlightsViaMain,
  searchHotelsViaMain,
} from "@/lib/services/package-search";
import type { TixStockListing } from "@/lib/tixstock.types";
import type { EventTicket, EventType, PackageMode } from "@/types/app.types";

/** myt-main's deployment - the same base URL the hotel proxy already uses. */
const MAIN_APP_URL = (
  process.env.NEXT_SECRET_HOTEL_SERVICE_URL || "https://www.mega-events.co.il"
).replace(/\/$/, "");

/**
 * Prepared packages - the portal's live-link builder.
 *
 * A partner assembles a concrete ticket(+flight)(+hotel) combination from the
 * inventory this backoffice already manages and gets a link that lands their
 * follower on myt-main's order page with everything pre-selected:
 * `{main}/order/{eventId}?utm_source={code}&pkg={share_token}`.
 *
 * myt-main consumes the token in `app/api/package/[id]/route.ts`, re-validating
 * every piece against live data (event gone/sold out → 410, stale flight/hotel
 * → dropped with a `_needs_repick` flag). So the snapshots written here are a
 * convenience, never a price commitment - but their JSON shapes MUST match what
 * main's own order flow round-trips through `reservations.*_order_info`:
 * the flattened ticket object, main's `Flight`, and main's `OrderHotel`.
 * The builders below mirror main's `transformDbFlightToFlight`
 * (app/api/flights/search/route.ts) and the synthetic offline-hotel rate
 * (app/api/offline-hotels/route.ts). Change those → change these.
 */

const PORTAL_PACKAGES_PATH = "/portal/packages";

// ---------------------------------------------------------------------------
// Builder data - what the wizard shows
// ---------------------------------------------------------------------------

export interface BuilderEvent {
  id: number;
  name: string;
  /** Search only - a partner typing "Harry Styles" must hit "הארי סטיילס". */
  name_english: string | null;
  date: string;
  location_name: string;
  type: EventType;
  /** Venue/seating map the customer site shows on the ticket step. */
  map_image_url: string | null;
  /** Round event/artist photo the customer site shows in the order header. */
  image_url: string | null;
  /** Customer-facing site price per traveler (cheapest category); null = sold out. */
  site_price: number | null;
  /** Package-pricing baselines - the site shows component prices as ± deltas vs these. */
  base_flight_price: number | null;
  base_hotel_price: number | null;
  /** Skip-aware pricing knobs (computePerPersonPackagePrice) - main's skip fees. */
  event_additional_markup: number | null;
  markup_ticket: number | null;
  markup_flight: number | null;
  markup_hotel: number | null;
  skip_flight: boolean | null;
  skip_flight_markup: number | null;
  skip_hotel_markup: number | null;
  ticket_only_markup: number | null;
  /** 'ticket_only' = the site sells the ticket alone; the wizard is then locked to tickets. */
  package_mode: PackageMode;
  sold_out: boolean;
  locked_flight_id: number | null;
  def_date_depart: string | null;
  def_date_return: string | null;
  tickets: {
    category: string;
    price: number;
    id: string;
    vendor?: string;
    /** Site price per traveler with THIS category. */
    site_price: number | null;
  }[];
  /** tx_event only: TixStock event id (from any ticket's eid) → live pricing. */
  tix_event_id: string | null;
  /** tx_event only: sections excluded from sale - the map greys and ignores them. */
  tx_excluded_sections: string[] | null;
  /** Homepage-prioritized event ("קטלוג ותעדוף") - the V2 dashboard's default
   *  8 rows are these (V2 spec: "ה-8 ששמנו בעמוד הבית כמומלצות"). */
  is_prioritized: boolean;
  /** Event tags (comma string) - the dashboard's sport/music quick filter. */
  tags: string | null;
  /** Taxonomy tags (league/team/genre/city) - the dashboard's advanced
   *  search builds its mapped filter options from these. */
  tag_list: { type: string; name: string }[];
}

type EventListRow = {
  id: number;
  name: string;
  name_english?: string | null;
  date: string;
  location: { name?: string } | null;
  type: string;
  tickets_and_rates: EventTicket[] | null;
  map_image_url?: string | null;
  card_image_url?: string | null;
  art_image_url?: string | null;
  tx_excluded_sections?: string[] | null;
  is_deleted?: string | null;
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
  package_mode?: PackageMode | string | null;
  tags?: string | null;
  locked_flight_id?: number | null;
  def_date_depart?: string | null;
  def_date_return?: string | null;
  is_prioritized?: boolean | null;
};

const EVENT_COLUMNS =
  "id, name, name_english, date, location, type, tickets_and_rates, map_image_url, card_image_url, art_image_url, tx_excluded_sections, is_deleted, base_flight_price, base_hotel_price, " +
  "event_additional_markup, markup_ticket, markup_flight, markup_hotel, skip_flight, skip_flight_markup, skip_hotel_markup, ticket_only_markup, package_mode, tags, locked_flight_id, " +
  "def_date_depart, def_date_return, is_prioritized";

/**
 * Locked packages sell exactly one offline flight with no Amadeus fallback -
 * when that flight has no seats left the whole package is sold out (main's
 * markLockedPackagesSoldOut, mirrored lite: global remaining only).
 */
async function lockedFlightSoldOutSet(
  lockedIds: number[],
): Promise<Set<number>> {
  if (lockedIds.length === 0) return new Set();
  // Mega Events flights only: a locked id that belongs to another company is
  // not found, so the package reads as sold out instead of selling its seats.
  const { data, error } = await megaEventsFlights()
    .select("id, initial_quantity, consumed_quantity, is_deleted")
    .in("id", lockedIds);
  if (error) {
    console.error("lockedFlightSoldOutSet:", JSON.stringify(error));
    return new Set(); // fail open, like main
  }
  const rows = (data ?? []) as {
    id: number;
    initial_quantity: number | null;
    consumed_quantity: number | null;
    is_deleted: boolean | null;
  }[];
  const soldOut = new Set<number>();
  for (const id of lockedIds) {
    const row = rows.find((r) => r.id === id);
    if (
      !row ||
      row.is_deleted ||
      (row.initial_quantity ?? 0) - (row.consumed_quantity ?? 0) < 1
    ) {
      soldOut.add(id);
    }
  }
  return soldOut;
}

/** Ceiling on the portal's event list - far above the live catalog, logged when hit. */
const BUILDER_EVENTS_MAX = 3000;
/** event ids per tag-links read: ~6 tags an event keeps each chunk under PostgREST's 1000-row cap. */
const TAG_LINK_CHUNK = 100;

export async function getPackageBuilderEvents(): Promise<BuilderEvent[]> {
  await requirePartner();

  // Events starting inside the next 3 days are too close to sell a package
  // for (flights/hotel/ticket fulfilment can't be guaranteed) - keep them out
  // of the build-package and send-link lists.
  const minStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  // Paged, not `.limit(300)`: the catalog passed 300 live future events in
  // 09/2026 and everything dated after the 300th (the 2027 tours the "מה חדש"
  // carousel was advertising) silently fell out of the search.
  const { rows, truncated, error } = await fetchPaged<EventListRow>(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("events")
        .select(EVENT_COLUMNS)
        .is("is_deleted", null)
        .gte("date", minStart)
        .order("date", { ascending: true })
        .order("id", { ascending: true }),
    BUILDER_EVENTS_MAX,
  );

  if (error) {
    console.error("getPackageBuilderEvents:", JSON.stringify(error));
    return [];
  }
  if (truncated) {
    console.error(
      `getPackageBuilderEvents: more than ${BUILDER_EVENTS_MAX} live future events - the list is cut`,
    );
  }

  const lockedIds = [
    ...new Set(
      rows
        .map((r) => r.locked_flight_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const lockedSoldOut = await lockedFlightSoldOutSet(lockedIds);

  // Taxonomy tags drive the dashboard search: the "vertical" slugs
  // (football/music) feed the genre pills, and league/team/genre/city tag
  // NAMES feed the advanced-search selects. events.tags itself is
  // legacy-empty. Best-effort: a failure only degrades the filters.
  const verticalByEvent = new Map<number, string[]>();
  const tagListByEvent = new Map<number, { type: string; name: string }[]>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allTags } = await (supabase as any)
      .from("event_tags")
      .select("id,slug,name,type")
      .in("type", ["vertical", "league", "team", "genre", "city", "artist"])
      .eq("is_active", true)
      .eq("is_deleted", false);
    const tags = (allTags ?? []) as {
      id: number;
      slug: string;
      name: string;
      type: string;
    }[];
    const eventIds = rows.map((r) => r.id);
    if (tags.length > 0 && eventIds.length > 0) {
      const tagIds = tags.map((t) => t.id);
      const chunks: number[][] = [];
      for (let i = 0; i < eventIds.length; i += TAG_LINK_CHUNK) {
        chunks.push(eventIds.slice(i, i + TAG_LINK_CHUNK));
      }
      const pages = await Promise.all(
        chunks.map((chunk) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("event_tag_links")
            .select("event_id,tag_id")
            .in("tag_id", tagIds)
            .in("event_id", chunk),
        ),
      );
      const links: { event_id: number; tag_id: number }[] = [];
      for (const page of pages) {
        if (page.error) {
          console.error("getPackageBuilderEvents tag links:", JSON.stringify(page.error));
          continue;
        }
        links.push(...((page.data ?? []) as { event_id: number; tag_id: number }[]));
      }
      const tagById = new Map(tags.map((t) => [t.id, t]));
      for (const link of links) {
        const tag = tagById.get(link.tag_id);
        if (!tag) continue;
        if (tag.type === "vertical") {
          const existing = verticalByEvent.get(link.event_id) ?? [];
          existing.push(tag.slug);
          verticalByEvent.set(link.event_id, existing);
        } else {
          const existing = tagListByEvent.get(link.event_id) ?? [];
          existing.push({ type: tag.type, name: tag.name });
          tagListByEvent.set(link.event_id, existing);
        }
      }
    }
  } catch (error) {
    console.error("getPackageBuilderEvents taxonomy tags:", error);
  }

  const builderEvents = rows.map((row) => {
    const tickets = ((row.tickets_and_rates ?? []) as EventTicket[])
      .filter(
        (t) => t && t.available !== false && typeof t.category === "string",
      )
      .map((t) => ({
        category: t.category,
        price: t.price,
        id: t.id,
        vendor: t.vendor,
        site_price: computePackagePrice(row, t.price),
      }));
    const location = (row.location ?? {}) as { name?: string };
    const soldOut = isEventSoldOut(
      row,
      row.locked_flight_id != null && lockedSoldOut.has(row.locked_flight_id),
    );
    return {
      id: row.id,
      name: row.name,
      name_english: row.name_english ?? null,
      date: row.date,
      location_name: location.name ?? "",
      type: row.type as EventType,
      map_image_url: row.map_image_url ?? null,
      image_url: row.card_image_url ?? row.art_image_url ?? null,
      site_price: soldOut ? null : computePackagePrice(row),
      base_flight_price: row.base_flight_price ?? null,
      base_hotel_price: row.base_hotel_price ?? null,
      event_additional_markup: row.event_additional_markup ?? null,
      markup_ticket: row.markup_ticket ?? null,
      markup_flight: row.markup_flight ?? null,
      markup_hotel: row.markup_hotel ?? null,
      skip_flight: row.skip_flight ?? null,
      skip_flight_markup: row.skip_flight_markup ?? null,
      skip_hotel_markup: row.skip_hotel_markup ?? null,
      ticket_only_markup: row.ticket_only_markup ?? null,
      package_mode: (row.package_mode === "ticket_only" ? "ticket_only" : "package") as PackageMode,
      sold_out: soldOut,
      locked_flight_id: row.locked_flight_id ?? null,
      def_date_depart: row.def_date_depart ?? null,
      def_date_return: row.def_date_return ?? null,
      tickets,
      tix_event_id:
        row.type === "tx_event"
          ? ((
              (row.tickets_and_rates ?? []) as (EventTicket & {
                eid?: string;
              })[]
            ).find((t) => t?.eid)?.eid ?? null)
          : null,
      tx_excluded_sections: row.tx_excluded_sections ?? null,
      is_prioritized: row.is_prioritized === true,
      tags:
        [row.tags, ...(verticalByEvent.get(row.id) ?? [])]
          .filter(Boolean)
          .join(",") || null,
      tag_list: tagListByEvent.get(row.id) ?? [],
    };
  });

  // Sold-out events are dead rows for a link builder: no package can be built
  // and a shared link would land on a sold-out page. (Deleted and past events
  // are already excluded by the query itself.)
  return builderEvents.filter((event) => !event.sold_out);
}

export interface BuilderCommissionTerms {
  /** partners.commission_type - "percent_of_sale" | "fixed_per_ticket" (default). */
  type: string | null;
  /** partners.commission - % of sale or $ per ticket, per the type. */
  rate: number | null;
}

/**
 * The signed-in partner's commission terms, so the wizard's summary can show
 * an estimated commission next to the estimated package price (main shows the
 * same line to partner sessions on the order summary).
 */
export async function getMyCommissionTerms(): Promise<BuilderCommissionTerms | null> {
  const session = await requirePartner();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("partners")
    .select("commission, commission_type")
    .eq("partner_tracking_code", session.partner_code)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    commission: number | null;
    commission_type: string | null;
  };
  return { type: row.commission_type ?? null, rate: row.commission ?? null };
}

export interface LiveTicketCategory {
  category: string;
  id: string;
  vendor?: string;
  /** Live per-ticket price (ceil'd USD) - cheapest listing satisfying qty. */
  price: number;
  /** Customer-facing site price per traveler at that live price. */
  site_price: number | null;
}

export type LiveTicketsResult =
  | { ok: true; categories: LiveTicketCategory[]; listings: TixStockListing[] }
  | { ok: false; error: string };

/**
 * tx_event live pricing - proxied through main's own /api/tixstock/tickets so
 * the wizard shows EXACTLY what the customer's ticket step shows: the same
 * listings, the same per-quantity cheapest-qualifying rule, the same refreshed
 * category list. (Main: app/order/TicketSelection.tsx.)
 */
export async function getLiveTicketOffers(input: {
  eventId: number;
  qty: number;
}): Promise<LiveTicketsResult> {
  await requirePartner();

  const eventId = Number(input.eventId);
  const qty = Math.max(1, Math.min(20, Math.floor(input.qty || 1)));
  if (!Number.isFinite(eventId)) return { ok: false, error: "אירוע לא תקין" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) {
    console.error("getLiveTicketOffers event:", JSON.stringify(error));
    return { ok: false, error: "האירוע לא נמצא" };
  }
  const row = data as EventListRow;
  if (row.type !== "tx_event")
    return { ok: false, error: "לאירוע הזה אין תמחור חי" };

  const tickets = (
    (row.tickets_and_rates ?? []) as (EventTicket & { eid?: string })[]
  ).filter((t) => t && t.available !== false && typeof t.category === "string");
  const tixEventId = tickets.find((t) => t.eid)?.eid ?? null;
  if (!tixEventId) return { ok: false, error: "לאירוע אין מזהה TixStock" };

  try {
    const params = new URLSearchParams({
      event_id: tixEventId,
      ticket_quantity: String(qty),
      db_event_id: String(row.id),
    });
    if (row.tx_excluded_sections?.length) {
      params.set("excluded_sections", row.tx_excluded_sections.join(","));
    }
    const res = await fetch(
      `${MAIN_APP_URL}/api/tixstock/tickets?${params.toString()}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const json = (await res.json()) as {
      data?: { data?: TixStockListing[] };
      tickets_and_rates?: (EventTicket & { eid?: string })[];
    };
    if (!res.ok) {
      console.error("getLiveTicketOffers upstream:", res.status);
      return { ok: false, error: "טעינת המחירים החיים נכשלה. נסו שוב." };
    }
    const listings = json?.data?.data ?? [];
    const categories = (json?.tickets_and_rates ?? tickets).filter(
      (t) => t && t.available !== false && typeof t.category === "string",
    );

    // Main's rule verbatim: cheapest listing in the category that can satisfy
    // qty (singles need a true single or a fully splittable listing).
    const livePriceFor = (category: string): number | null => {
      const norm = category.trim().toLowerCase();
      const qualifying = listings.filter((l) => {
        const listingCat = l.seat_details?.category?.trim().toLowerCase();
        if (listingCat !== norm) return false;
        const qtyAvail = l.number_of_tickets_for_sale?.quantity_available ?? 0;
        const splitQty = l.number_of_tickets_for_sale?.split_quantity ?? 0;
        if (qty === 1) return qtyAvail === 1 || qtyAvail === splitQty;
        return qtyAvail >= qty || splitQty >= qty;
      });
      if (qualifying.length === 0) return null;
      const cheapest = qualifying.reduce((min, l) => {
        const a = parseFloat(l.proceed_price?.amount ?? "Infinity");
        const b = parseFloat(min.proceed_price?.amount ?? "Infinity");
        return a < b ? l : min;
      }, qualifying[0]);
      const amount = parseFloat(cheapest.proceed_price?.amount ?? "NaN");
      return Number.isFinite(amount) ? Math.ceil(amount) : null;
    };

    const result: LiveTicketCategory[] = [];
    for (const t of categories) {
      const live = livePriceFor(t.category);
      if (live == null) continue; // cannot satisfy the requested quantity
      result.push({
        category: t.category,
        id: t.id,
        vendor: t.vendor,
        price: live,
        site_price: computePackagePrice(row, live),
      });
    }
    return { ok: true, categories: result, listings };
  } catch (err) {
    console.error("getLiveTicketOffers:", err);
    return { ok: false, error: "טעינת המחירים החיים נכשלה. נסו שוב." };
  }
}

export interface BuilderFlight {
  id: number;
  airline_name: string;
  airline_logo: string;
  /** Per-traveler price in USD. */
  price: number;
  remaining: number;
  /** Checked bag included in BOTH directions. */
  bags_included: boolean;
  checked_bag_kg: number | null;
  cabin_bag_kg: number | null;
  outbound_departure_time: string;
  outbound_arrival_time: string;
  /** ISO-8601 duration ("PT4H5M") like main's flight search emits. */
  outbound_duration: string;
  outbound_departure_airport: string;
  outbound_arrival_airport: string;
  outbound_flight_number: string;
  inbound_departure_time: string;
  inbound_arrival_time: string;
  inbound_duration: string;
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
  /** Date the room cancels free until (offline inventory terms); null = none. */
  last_cancellation_date: string | null;
}

export interface BuilderInventory {
  flights: BuilderFlight[];
  hotels: BuilderHotelRoom[];
}

export async function getPackageBuilderInventory(
  eventId: number,
): Promise<BuilderInventory> {
  await requirePartner();

  const id = Number(eventId);
  if (!Number.isFinite(id)) return { flights: [], hotels: [] };

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const [flightsRes, hotelsRes] = await Promise.all([
    megaEventsFlights()
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

  if (flightsRes.error)
    console.error(
      "getPackageBuilderInventory flights:",
      JSON.stringify(flightsRes.error),
    );
  if (hotelsRes.error)
    console.error(
      "getPackageBuilderInventory hotels:",
      JSON.stringify(hotelsRes.error),
    );

  const flights = ((flightsRes.data ?? []) as FlightRow[])
    .map((f) => ({
      id: f.id,
      airline_name: f.metadata_name,
      airline_logo: f.metadata_logo,
      price: Number(f.price),
      remaining: (f.initial_quantity ?? 0) - (f.consumed_quantity ?? 0),
      bags_included:
        f.outbound_check_bags_included && f.inbound_check_bags_included,
      checked_bag_kg: f.checked_bag_kg ?? null,
      cabin_bag_kg: f.cabin_bag_kg ?? null,
      outbound_departure_time: f.outbound_departure_time,
      outbound_arrival_time: f.outbound_arrival_time,
      outbound_duration: pgIntervalToPT(f.outbound_duration),
      outbound_departure_airport: f.outbound_departure_airport,
      outbound_arrival_airport: f.outbound_arrival_airport,
      outbound_flight_number: f.outbound_flight_number,
      inbound_departure_time: f.inbound_departure_time,
      inbound_arrival_time: f.inbound_arrival_time,
      inbound_duration: pgIntervalToPT(f.inbound_duration),
      inbound_departure_airport: f.inbound_departure_airport,
      inbound_arrival_airport: f.inbound_arrival_airport,
      inbound_flight_number: f.inbound_flight_number,
      outbound_stop_airport: f.outbound_stop_airport,
      inbound_stop_airport: f.inbound_stop_airport,
    }))
    .filter((f) => f.remaining > 0);

  const hotelRows = (hotelsRes.data ?? []) as HotelRow[];
  const hids = hotelRows
    .filter((h) => h.hid != null)
    .map((h) => h.hid as number);
  let meta: HotelMetaRow[] = [];
  if (hids.length > 0) {
    const { data: metaRows } = await supabase
      .from("hotels")
      .select(
        "hid, name, star_rating, address, latitude, longitude, amenity_groups",
      )
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
      last_cancellation_date: h.last_cancellation_date,
    }))
    .filter((h) => h.remaining > 0);

  return { flights, hotels };
}

// ---------------------------------------------------------------------------
// Live search - proxied to myt-main's own customer-facing APIs, so the offers
// an agent pins are EXACTLY what a customer would be offered. Both actions are
// requirePartner-gated server-side; no new public routes are exposed here.
// ---------------------------------------------------------------------------

/**
 * A flight offer as main's /api/flights/search returns it (offline inventory
 * merged with live Amadeus). Display fields are typed; everything else (the
 * raw Amadeus `offer` blob etc.) rides along untyped and is snapshotted as-is
 * - main round-trips this exact object through reservations.flight_order_info.
 * `price` is the TOTAL for all travelers (main's semantics).
 */
export interface LiveFlightOffer {
  id: string;
  airline: string;
  price: number;
  numOfTravelers: number;
  stops: number;
  duration?: string;
  outbound: {
    departureTime: string;
    arrivalTime: string;
    departureAirport: string;
    arrivalAirport: string;
    flightNumber?: string;
    checkBagsIncluded?: boolean;
    cabinBagsIncluded?: boolean;
  };
  inbound: {
    departureTime: string;
    arrivalTime: string;
    departureAirport: string;
    arrivalAirport: string;
    flightNumber?: string;
    checkBagsIncluded?: boolean;
    cabinBagsIncluded?: boolean;
  };
  metadata?: { name?: string; logo?: string; iata?: string };
  virtualOfferType?: boolean;
  isOffline?: boolean;
  offlineId?: number;
  offlineRawPrice?: number;
  [key: string]: unknown;
}

export type LiveFlightSearchResult =
  | {
      ok: true;
      flights: LiveFlightOffer[];
      locked: boolean;
      lockedSoldOut: boolean;
    }
  | { ok: false; error: string };

export async function searchLiveFlights(input: {
  eventId: number;
  departureDate: string;
  returnDate: string;
  adults: number;
}): Promise<LiveFlightSearchResult> {
  await requirePartner();

  return searchFlightsViaMain(input);
}

/**
 * A ready-to-save OrderHotel candidate assembled the same way main's
 * HotelSelection assembles one on rate pick (rate + info metadata + the
 * search request echoed back for guests/checkin/checkout).
 */
export interface LiveHotelOption {
  /** Stable key within one search response. */
  key: string;
  name: string;
  stars: number;
  address: string;
  distance_m: number;
  image: string | null;
  room_name: string;
  meal: string;
  /** ISO datetime the rate cancels free until; null = non-refundable. */
  free_cancellation_before: string | null;
  /**
   * HOTEL-level, judged over ALL of the hotel's rates (not just the few listed
   * here): the two facts myt-main's default hotel filter reads - property kind
   * ("Hotel", "Apartment", ...) and "has at least one free-cancellation rate".
   * The builder's no-tap default uses them to land on the same hotel the site
   * auto-selects (hotel-step.tsx `siteDefaultHotelKey`).
   */
  kind: string | null;
  hotel_has_free_cancellation: boolean;
  /** Total stay price, USD (rate show_amount). */
  price: number;
  /** The stay window this option was priced for (what the snapshot carries). */
  checkin: string;
  checkout: string;
  /** The full OrderHotel snapshot main round-trips - saved verbatim on pick. */
  snapshot: Record<string, unknown>;
}

export type LiveHotelSearchResult =
  | { ok: true; options: LiveHotelOption[]; checkin: string; checkout: string }
  | { ok: false; error: string };

export async function searchLiveHotels(input: {
  eventId: number;
  checkin: string;
  checkout: string;
  travelers: number;
  /**
   * Optional hotel-name filter. Matched server-side against the FULL serp
   * result (via the Worldota id slug, e.g. "tavistock_hotel"), so an agent can
   * find a hotel that main shows but fell outside the default result cap.
   */
  query?: string;
}): Promise<LiveHotelSearchResult> {
  await requirePartner();

  return searchHotelsViaMain(input);
}

// ---------------------------------------------------------------------------
// Create / list / delete
// ---------------------------------------------------------------------------

export type CreatePackageInput = {
  eventId: number;
  category: string;
  qty: number;
  /** May the customer change the pinned composition? Default true (editable). */
  allowEdit?: boolean;
  /**
   * The agent's price change per traveler in USD: + uplift above site price,
   * - discount funded from their own commission (doc 2026-08-30, item 4 -
   * "שמשנים עמלה זה צריך להשפיע על הלינק"). Stored ON the package, so the
   * plain link, the copied link and the quote all quote the same number. The
   * discount side is clamped server-side to the partner's commission.
   */
  priceAdjustPerPerson?: number;
  /** Cheapest hotel available for the event, per guest, as the wizard saw it -
   *  the hotel-skip-fee reference (Dor 24.8, mirrors main). Only consulted
   *  when hotel.mode === "none"; keeps the stamped price_per_person equal to
   *  the wizard's preview and to what main will charge at checkout. */
  hotelSkipRefPerGuest?: number | null;
  flight:
    | { mode: "offline"; flightId: number }
    | { mode: "live-offer"; offer: LiveFlightOffer }
    | { mode: "live" }
    | { mode: "none" };
  hotel:
    | { mode: "offline"; units: { rowId: number; count: number }[] }
    | { mode: "live-offer"; offer: Record<string, unknown> }
    | { mode: "live" }
    | { mode: "none" };
};

export type CreatePackageResult =
  | { ok: true; link: string; packageId: number }
  | { ok: false; error: string };

type PackageRowCore = {
  event_id: number;
  event_order_info: object;
  flight_order_info: object | null;
  flight_skipped: boolean;
  hotel_order_info: object | null;
  hotel_skipped: boolean;
  num_travelers: number;
};

/**
 * Validates a wizard composition against LIVE data and assembles the row
 * columns shared by create and update (V2: the summary auto-builds the link
 * and updates the same row on later edits). Everything price-bearing is
 * re-derived server-side - the client only ever names choices.
 */
async function buildPackageRowCore(
  input: CreatePackageInput,
): Promise<{ ok: false; error: string } | { ok: true; core: PackageRowCore }> {
  const eventId = Number(input.eventId);
  if (!Number.isFinite(eventId)) return { ok: false, error: "אירוע לא תקין" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: eventData, error: eventError } = await (supabase as any)
    .from("events")
    .select(
      "id, name, date, location, type, tickets_and_rates, is_deleted, " +
        "base_flight_price, base_hotel_price, event_additional_markup, " +
        "markup_ticket, markup_flight, markup_hotel, " +
        "skip_flight, skip_flight_markup, skip_hotel_markup, ticket_only_markup",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    console.error("createPreparedPackage event:", JSON.stringify(eventError));
    return { ok: false, error: "שגיאה בטעינת האירוע" };
  }
  const event = eventData as EventListRow | null;
  if (
    !event ||
    event.is_deleted ||
    new Date(event.date).getTime() <= Date.now()
  ) {
    return { ok: false, error: "האירוע לא נמצא או שאינו זמין יותר" };
  }

  const qty = Math.max(1, Math.min(999, Math.floor(input.qty || 1)));

  // Re-derive the ticket from the live event - the client sends only the
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
  let flightOrderInfo: object | null = null;
  // Per-person component price, for the stored package price (quote baseline).
  let flightPerPerson: number | null = null;
  const flightSkipped = input.flight.mode === "none";
  if (input.flight.mode === "live-offer") {
    // A live (Amadeus) offer has no cheap ground truth to re-verify against -
    // main's own savePreparedPackage trusts it the same way, and confirm-order's
    // price floor remains the real backstop at booking time. Offline rows that
    // arrive through the live search DO carry their true inventory cost, so
    // those are floored here exactly like main does.
    const offer = input.flight.offer;
    if (
      !offer ||
      typeof offer !== "object" ||
      typeof offer.outbound?.departureTime !== "string" ||
      typeof offer.inbound?.departureTime !== "string" ||
      !Number.isFinite(Number(offer.price))
    ) {
      return { ok: false, error: "הטיסה שנבחרה אינה תקינה" };
    }
    if (new Date(offer.outbound.departureTime).getTime() <= Date.now()) {
      return { ok: false, error: "הטיסה שנבחרה כבר יצאה" };
    }
    if (
      offer.isOffline &&
      offer.offlineRawPrice != null &&
      Number(offer.price) < Number(offer.offlineRawPrice)
    ) {
      return { ok: false, error: "מחיר הטיסה שנבחרה אינו תקין" };
    }
    if (JSON.stringify(offer).length > 400_000) {
      return { ok: false, error: "הטיסה שנבחרה אינה תקינה" };
    }
    flightOrderInfo = offer;
    flightPerPerson =
      Number(offer.price) /
      Math.max(
        1,
        Number((offer as { numOfTravelers?: number }).numOfTravelers) || qty,
      );
  }
  if (input.flight.mode === "offline") {
    const { data: flightRow, error: flightError } = await megaEventsFlights()
      .select(`${FLIGHT_COLUMNS}, event_ids, is_deleted`)
      .eq("id", input.flight.flightId)
      .maybeSingle();
    if (flightError) {
      console.error(
        "createPreparedPackage flight:",
        JSON.stringify(flightError),
      );
      return { ok: false, error: "שגיאה בטעינת הטיסה" };
    }
    const row = flightRow as
      | (FlightRow & { event_ids: number[]; is_deleted: boolean | null })
      | null;
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
    flightPerPerson = Number(row.price);
  }

  // Hotel
  let hotelOrderInfo: object | null = null;
  let hotelPerPerson: number | null = null;
  const hotelSkipped = input.hotel.mode === "none";
  if (input.hotel.mode === "live-offer") {
    const offer = input.hotel.offer as {
      rate?: unknown;
      checkin?: unknown;
      checkout?: unknown;
      price?: unknown;
      isOffline?: unknown;
      offlineRawPrice?: unknown;
    };
    if (
      !offer ||
      typeof offer !== "object" ||
      !offer.rate ||
      typeof offer.checkin !== "string" ||
      typeof offer.checkout !== "string" ||
      !Number.isFinite(Number(offer.price))
    ) {
      return { ok: false, error: "המלון שנבחר אינו תקין" };
    }
    // Date-only checkin parses as UTC midnight on main's isInFuture - a
    // same-day checkin resolves as hotel_needs_repick the moment the link is
    // opened, so a package saved with one is dead on arrival. Require tomorrow+.
    if (offer.checkin <= new Date().toISOString().slice(0, 10)) {
      return {
        ok: false,
        error:
          "צ'ק-אין חייב להיות מחר או מאוחר יותר - צ'ק-אין של היום יידרש בחירה מחדש בפתיחת הלינק",
      };
    }
    if (
      offer.isOffline === true &&
      offer.offlineRawPrice != null &&
      Number(offer.price) < Number(offer.offlineRawPrice)
    ) {
      return { ok: false, error: "מחיר המלון שנבחר אינו תקין" };
    }
    if (JSON.stringify(offer).length > 400_000) {
      return { ok: false, error: "המלון שנבחר אינו תקין" };
    }
    hotelOrderInfo = input.hotel.offer;
    hotelPerPerson = Number(offer.price) / qty;
  }
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
      const row = (
        (hotelRows ?? []) as (HotelRow & {
          event_ids: number[];
          is_deleted: boolean | null;
        })[]
      ).find((r) => r.id === Number(u.rowId));
      if (!row || row.is_deleted || !(row.event_ids ?? []).includes(eventId)) {
        return { ok: false, error: "אחד החדרים שנבחרו אינו זמין לאירוע הזה" };
      }
      const count = Math.max(1, Math.min(9, Math.floor(u.count)));
      if ((row.num_rooms ?? 0) - (row.consumed_rooms ?? 0) < count) {
        return {
          ok: false,
          error: `אין מספיק חדרים פנויים (${row.hotel_name} - ${row.room_type})`,
        };
      }
      units.push({ row, count });
    }

    // All units must belong to one hotel with one date window - that is the
    // one combination main can present as a single OrderHotel.
    const anchor = units[0].row;
    const sameHotel = units.every(
      ({ row }) =>
        (row.hid != null && row.hid === anchor.hid) ||
        (row.hid == null &&
          anchor.hid == null &&
          row.hotel_name === anchor.hotel_name),
    );
    const sameDates = units.every(
      ({ row }) =>
        row.check_in === anchor.check_in && row.check_out === anchor.check_out,
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
        .select(
          "hid, name, star_rating, address, latitude, longitude, amenity_groups",
        )
        .eq("hid", anchor.hid)
        .maybeSingle();
      meta = (metaRow as HotelMetaRow | null) ?? null;
    }

    hotelOrderInfo = buildHotelSnapshot(units, meta, qty);
    hotelPerPerson =
      units.reduce(
        (sum, { row, count }) => sum + Number(row.price) * count,
        0,
      ) / qty;
  }

  // What main will actually charge per traveller for THIS composition - the
  // quote flow's baseline (מחיר היחידה חייב לשקף את החבילה, לא את האירוע).
  // Deltas are the chosen component vs the event baseline, exactly like the
  // wizard's preview; a live-picked component contributes no delta.
  const hotelSkipRefRaw = Number(input.hotelSkipRefPerGuest);
  const pricePerPerson = computePerPersonPackagePrice(event, {
    ticketPrice: Number(liveTicket.price) || 0,
    flightSkipped,
    hotelSkipped,
    flightDelta:
      flightPerPerson != null
        ? flightPerPerson - (event.base_flight_price ?? 0)
        : 0,
    hotelDelta:
      hotelPerPerson != null
        ? hotelPerPerson - (event.base_hotel_price ?? 0)
        : 0,
    hotelSkipRefPerGuest:
      Number.isFinite(hotelSkipRefRaw) && hotelSkipRefRaw > 0
        ? hotelSkipRefRaw
        : null,
  });

  return {
    ok: true,
    core: {
      event_id: event.id,
      event_order_info: { ...eventOrderInfo, price_per_person: pricePerPerson },
      flight_order_info: flightOrderInfo,
      flight_skipped: flightSkipped,
      hotel_order_info: hotelOrderInfo,
      hotel_skipped: hotelSkipped,
      num_travelers: qty,
    },
  };
}

/**
 * The agent's per-traveler price change, clamped the way the wizard's own
 * input is: an uplift is theirs to set, a DISCOUNT may never exceed the
 * commission they earn on the package (they would be paying to sell). Done
 * server-side because the client cap is a convenience, not a control.
 */
async function clampPriceAdjust(
  input: CreatePackageInput,
  pricePerPerson: number | null,
): Promise<number> {
  const raw = Number(input.priceAdjustPerPerson);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  if (raw > 0) return Math.round(raw * 100) / 100;

  const terms = await getMyCommissionTerms();
  const rate = Number(terms?.rate);
  if (!Number.isFinite(rate) || rate <= 0) return 0; // no commission = no room to discount
  const perPerson =
    terms?.type === "percentage"
      ? ((pricePerPerson ?? 0) * rate) / 100
      : // Fixed commission is per TICKET, and a package is one ticket per
        // traveler - so the per-traveler ceiling is the rate itself.
        rate;
  const floor = -Math.max(0, Math.round(perPerson * 100) / 100);
  return Math.max(floor, Math.round(raw * 100) / 100);
}

/** Reads the per-traveler site price the builder just stamped on the row. */
function stampedPricePerPerson(core: PackageRowCore): number | null {
  const info = core.event_order_info as { price_per_person?: number } | null;
  const value = Number(info?.price_per_person);
  return Number.isFinite(value) ? value : null;
}

export async function createPreparedPackage(
  input: CreatePackageInput,
): Promise<CreatePackageResult> {
  const session = await requirePartner();

  const built = await buildPackageRowCore(input);
  if (!built.ok) return built;
  const priceAdjust = await clampPriceAdjust(
    input,
    stampedPricePerPerson(built.core),
  );

  // Opaque token - main looks packages up by this, never by the row id.
  const shareToken = crypto.randomUUID();

  const baseRow = {
    share_token: shareToken,
    partner_tracking_code: session.partner_code,
    created_by: session.sub,
    ...built.core,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: inserted, error: insertError } = await (supabase as any)
    .from("prepared_packages")
    .insert({
      ...baseRow,
      allow_edit: input.allowEdit !== false,
      price_adjust_per_person: priceAdjust,
    })
    .select("id, share_token")
    .single();

  // Deploy/migration race: shed the newest column, then the older one, rather
  // than failing the whole package (defaults: adjust 0, allow_edit true).
  if (
    insertError &&
    (insertError.code === "PGRST204" || insertError.code === "42703")
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data: inserted, error: insertError } = await (supabase as any)
      .from("prepared_packages")
      .insert({ ...baseRow, allow_edit: input.allowEdit !== false })
      .select("id, share_token")
      .single());
  }
  if (
    insertError &&
    (insertError.code === "PGRST204" || insertError.code === "42703")
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data: inserted, error: insertError } = await (supabase as any)
      .from("prepared_packages")
      .insert(baseRow)
      .select("id, share_token")
      .single());
  }

  if (insertError || !inserted) {
    console.error("createPreparedPackage insert:", JSON.stringify(insertError));
    return { ok: false, error: "שמירת החבילה נכשלה. נסו שוב." };
  }

  revalidatePath(PORTAL_PACKAGES_PATH);
  const row = inserted as { id: number; share_token: string };
  const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));
  return {
    ok: true,
    link: partnerLink(
      session.partner_code,
      baseRow.event_id,
      row.share_token,
      agentUtm,
    ),
    // The summary's "הזמן" / "שלח הצעה" CTAs need the row id.
    packageId: row.id,
  };
}

/**
 * V2 summary (2026-08-27): the link auto-builds on entering the summary and
 * later edits UPDATE the same row - the share_token (and therefore the link
 * already copied or sent) keeps pointing at the newest composition.
 * Same ownership posture as delete/setPackageAllowEdit.
 */
export async function updatePreparedPackage(
  packageId: number,
  input: CreatePackageInput,
): Promise<CreatePackageResult> {
  const session = await requirePartner();
  const scope = await resolvePortalScope(session);

  const id = Number(packageId);
  if (!Number.isFinite(id)) return { ok: false, error: "חבילה לא תקינה" };

  const built = await buildPackageRowCore(input);
  if (!built.ok) return built;
  const priceAdjust = await clampPriceAdjust(
    input,
    stampedPricePerPerson(built.core),
  );

  const scoped = (q: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (q as any)
      .eq("id", id)
      .eq("partner_tracking_code", session.partner_code);
    if (session.role === "agent" && !scope.soloOffice) {
      query = query.eq("created_by", session.sub);
    }
    return query;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: updated, error } = await scoped(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("prepared_packages").update({
      ...built.core,
      allow_edit: input.allowEdit !== false,
      price_adjust_per_person: priceAdjust,
    }),
  )
    .select("id, share_token")
    .maybeSingle();

  // Same migration-race fallback as create - newest column first.
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data: updated, error } = await scoped(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("prepared_packages")
        .update({ ...built.core, allow_edit: input.allowEdit !== false }),
    )
      .select("id, share_token")
      .maybeSingle());
  }
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data: updated, error } = await scoped(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("prepared_packages").update(built.core),
    )
      .select("id, share_token")
      .maybeSingle());
  }

  if (error || !updated) {
    if (error) console.error("updatePreparedPackage:", JSON.stringify(error));
    return { ok: false, error: "עדכון החבילה נכשל. נסו שוב." };
  }

  revalidatePath(PORTAL_PACKAGES_PATH);
  const row = updated as { id: number; share_token: string };
  const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));
  return {
    ok: true,
    link: partnerLink(
      session.partner_code,
      built.core.event_id,
      row.share_token,
      agentUtm,
    ),
    packageId: row.id,
  };
}

export interface PreparedPackageListItem {
  id: number;
  link: string;
  created_at: string;
  event_id: number;
  event_name: string;
  event_date: string;
  location_name: string;
  category: string;
  qty: number;
  price_per_ticket: number;
  /** Per-traveller site price of the composition (stamped at creation);
   *  null for packages built before it existed. */
  price_per_person: number | null;
  /** The agent's change to that price, per traveller (+ uplift / - discount).
   *  Carried by the LINK itself since 2026-08-30 - see the migration. */
  price_adjust_per_person: number;
  /** "offline" = a specific flight is attached, "live" = customer picks, "none" = no flight. */
  flight: "offline" | "live" | "none";
  flight_summary: string | null;
  hotel: "offline" | "live" | "none";
  hotel_summary: string | null;
  /** False = the customer cannot change the pinned composition. */
  allow_edit: boolean;
  /** V2 merged table: the agent's follow-up date (null until set; UI falls
   *  back to created_at). */
  follow_up_date: string | null;
  /** "בוצע ע"י" - display name of the office user who built the package, or
   *  "מגה איבנטס" when the row is ours. Shown to every viewer since
   *  2026-08-30 (item 5), not just managers. */
  creator_name: string | null;
}

type PreparedPackageRow = {
  id: number;
  share_token: string;
  created_at: string;
  event_id: number;
  created_by?: string | null;
  event_order_info: {
    name?: string;
    date?: string;
    location_name?: string;
    category?: string;
    number_of_ticket?: number;
    price_per_ticket?: number;
    /** Per-traveller site price for THIS composition, stamped at creation. */
    price_per_person?: number;
  } | null;
  flight_order_info: {
    airline?: string;
    outbound?: { departureTime?: string };
  } | null;
  flight_skipped: boolean;
  hotel_order_info: {
    name?: string;
    checkin?: string;
    checkout?: string;
  } | null;
  hotel_skipped: boolean;
  num_travelers: number;
  allow_edit?: boolean | null;
  follow_up_date?: string | null;
  price_adjust_per_person?: number | string | null;
};

const LIST_COLUMNS =
  "id, share_token, created_at, event_id, event_order_info, flight_order_info, flight_skipped, hotel_order_info, hotel_skipped, num_travelers";

export async function getMyPreparedPackages(): Promise<
  PreparedPackageListItem[]
> {
  const session = await requirePartner();
  const scope = await resolvePortalScope(session);
  // An agent in a multi-user office only ever sees packages they built
  // themselves; managers and solo agents see the whole office (solo-office
  // legacy packages may predate `created_by` - never hide them from the only
  // user on the code).
  const isolate = session.role === "agent" && !scope.soloOffice;

  const fetchList = (columns: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from("prepared_packages")
      .select(columns)
      .eq("partner_tracking_code", session.partner_code)
      .order("created_at", { ascending: false })
      .limit(200);
    if (isolate) query = query.eq("created_by", session.sub);
    return query;
  };

  // Migration races: shed the newest columns first (follow_up_date is the V2
  // migration, allow_edit the older one) before the bare column list.
  let { data, error } = await fetchList(
    `${LIST_COLUMNS}, allow_edit, created_by, follow_up_date, price_adjust_per_person`,
  );
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await fetchList(
      `${LIST_COLUMNS}, allow_edit, created_by, follow_up_date`,
    ));
  }
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await fetchList(`${LIST_COLUMNS}, allow_edit, created_by`));
  }
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await fetchList(`${LIST_COLUMNS}, created_by`));
  }

  if (error) {
    console.error("getMyPreparedPackages:", JSON.stringify(error));
    return [];
  }

  // The VIEWER's slug on every row is intentional - credit follows whoever
  // distributes the link, not whoever originally built the package.
  const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));
  const nameBySub = new Map(
    scope.officeUsers.map((u) => [u.id, u.display_name || u.email]),
  );

  return ((data ?? []) as PreparedPackageRow[]).map((row) => {
    const info = row.event_order_info ?? {};
    const flightMode = row.flight_skipped
      ? "none"
      : row.flight_order_info
        ? "offline"
        : "live";
    const hotelMode = row.hotel_skipped
      ? "none"
      : row.hotel_order_info
        ? "offline"
        : "live";
    return {
      id: row.id,
      link: partnerLink(
        session.partner_code,
        row.event_id,
        row.share_token,
        agentUtm,
      ),
      created_at: row.created_at,
      event_id: row.event_id,
      event_name: info.name ?? `אירוע ${row.event_id}`,
      event_date: info.date ?? "",
      location_name: info.location_name ?? "",
      category: info.category ?? "",
      qty: info.number_of_ticket ?? row.num_travelers,
      price_per_ticket: info.price_per_ticket ?? 0,
      price_per_person: info.price_per_person ?? null,
      // numeric comes back as a string from PostgREST.
      price_adjust_per_person: Number(row.price_adjust_per_person ?? 0) || 0,
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
      allow_edit: row.allow_edit !== false,
      follow_up_date: row.follow_up_date ?? null,
      // Same rule as quotes (doc 2026-08-30, item 5): the agent who built it,
      // or "מגה איבנטס" for a row that came from us.
      creator_name:
        (row.created_by ? nameBySub.get(row.created_by) : null) ??
        MEGA_EVENTS_CREATOR,
    };
  });
}

/** V2 merged הצעות table: the agent picks a follow-up date per package row. */
export async function setPackageFollowUp(
  id: number,
  followUpDate: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requirePartner();
  const scope = await resolvePortalScope(session);

  const packageId = Number(id);
  if (!Number.isFinite(packageId))
    return { ok: false, error: "חבילה לא תקינה" };
  if (followUpDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
    return { ok: false, error: "תאריך לא תקין" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let updateQuery = (supabase as any)
    .from("prepared_packages")
    .update({ follow_up_date: followUpDate })
    .eq("id", packageId)
    .eq("partner_tracking_code", session.partner_code);
  if (session.role === "agent" && !scope.soloOffice) {
    updateQuery = updateQuery.eq("created_by", session.sub);
  }
  const { error } = await updateQuery;
  if (error) {
    console.error("setPackageFollowUp:", JSON.stringify(error));
    return { ok: false, error: "העדכון נכשל. נסו שוב." };
  }
  revalidatePath(PORTAL_PACKAGES_PATH);
  return { ok: true };
}

export type DeletePackageResult = { ok: true } | { ok: false; error: string };

export async function deletePreparedPackage(
  id: number,
): Promise<DeletePackageResult> {
  const session = await requirePartner();
  const scope = await resolvePortalScope(session);

  const packageId = Number(id);
  if (!Number.isFinite(packageId))
    return { ok: false, error: "חבילה לא תקינה" };

  // Scoped to the caller's own tracking code - a partner can only ever kill
  // their own links. Deleting a link only invalidates it; main answers 404 and
  // falls back to a normal order flow for anyone still holding it. In a
  // multi-user office an agent may only kill their OWN links; managers may
  // kill any office link.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deleteQuery = (supabase as any)
    .from("prepared_packages")
    .delete()
    .eq("id", packageId)
    .eq("partner_tracking_code", session.partner_code);
  if (session.role === "agent" && !scope.soloOffice) {
    deleteQuery = deleteQuery.eq("created_by", session.sub);
  }
  const { error } = await deleteQuery;

  if (error) {
    console.error("deletePreparedPackage:", JSON.stringify(error));
    return { ok: false, error: "מחיקת החבילה נכשלה" };
  }

  revalidatePath(PORTAL_PACKAGES_PATH);
  return { ok: true };
}

export type SetPackageAllowEditResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Lock or unlock an existing package after creation. A lock chosen by mistake
 * in the wizard was previously permanent - the customer link honored it and
 * nothing anywhere could flip it back.
 */
export async function setPackageAllowEdit(
  id: number,
  allowEdit: boolean,
): Promise<SetPackageAllowEditResult> {
  const session = await requirePartner();
  const scope = await resolvePortalScope(session);

  const packageId = Number(id);
  if (!Number.isFinite(packageId))
    return { ok: false, error: "חבילה לא תקינה" };

  // Scoped to the caller's own tracking code - same posture as delete. An
  // agent in a multi-user office may only lock/unlock their OWN packages;
  // managers may manage any office package.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let updateQuery = (supabase as any)
    .from("prepared_packages")
    .update({ allow_edit: allowEdit })
    .eq("id", packageId)
    .eq("partner_tracking_code", session.partner_code);
  if (session.role === "agent" && !scope.soloOffice) {
    updateQuery = updateQuery.eq("created_by", session.sub);
  }
  const { error } = await updateQuery;

  if (error) {
    console.error("setPackageAllowEdit:", JSON.stringify(error));
    return { ok: false, error: "עדכון הנעילה נכשל" };
  }

  revalidatePath(PORTAL_PACKAGES_PATH);
  return { ok: true };
}

export type AgentOrderLinkResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * "הזמנה עבור הלקוח" - the order link routed through main's partner-handoff
 * endpoint, so the agent lands on the order flow with a live partner session
 * on MAIN'S domain. Without it main's `requireAgent()` fails and both
 * agent-paid settlement methods (agent card / voucher) are rejected server-side.
 *
 * Minted per click, not at list render: the token is a short-lived credential
 * (see lib/auth/partner-handoff.ts) and must not sit for hours in the DOM of
 * an open tab.
 */
export async function getAgentOrderHandoffLink(
  packageId: number,
): Promise<AgentOrderLinkResult> {
  const session = await requirePartner();
  // Ordering on a customer's behalf is an agent tool - mirrors main's requireAgent.
  if (!SELLER_ROLES.includes(session.role))
    return { ok: false, error: "זמין לסוכנים בלבד" };
  const scope = await resolvePortalScope(session);

  const id = Number(packageId);
  if (!Number.isFinite(id)) return { ok: false, error: "חבילה לא תקינה" };

  // An agent in a multi-user office may hand off only their OWN package;
  // managers may hand off any office package.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lookupQuery = (supabase as any)
    .from("prepared_packages")
    .select("event_id, share_token")
    .eq("id", id)
    .eq("partner_tracking_code", session.partner_code);
  if (session.role === "agent" && !scope.soloOffice) {
    lookupQuery = lookupQuery.eq("created_by", session.sub);
  }
  const { data, error } = await lookupQuery.maybeSingle();
  if (error || !data) {
    if (error)
      console.error("getAgentOrderHandoffLink:", JSON.stringify(error));
    return { ok: false, error: "החבילה לא נמצאה" };
  }

  const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));
  const next = `/order/${data.event_id}?utm_source=${encodeURIComponent(
    session.partner_code,
  )}&utm_medium=influencer${
    agentUtm ? `&utm_content=${encodeURIComponent(agentUtm)}` : ""
  }&pkg=${encodeURIComponent(data.share_token)}`;
  return handoffUrl(session, next);
}

/**
 * "לאתר" in the portal menu (Dor, 2026-09-18): the agent's ONE login stays the
 * portal; this opens the customer site with agent mode already live, so whoever
 * prefers to browse and order on the site itself gets the agent settlement at
 * checkout without a second login on main. An influencer has no agent mode -
 * they land on the site through their own tracking link.
 */
export async function getSiteHandoffLink(): Promise<AgentOrderLinkResult> {
  const session = await requirePartner();
  const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));
  if (!SELLER_ROLES.includes(session.role)) {
    return { ok: true, url: partnerLink(session.partner_code, undefined, undefined, agentUtm) };
  }
  const next = `/?utm_source=${encodeURIComponent(session.partner_code)}&utm_medium=influencer${
    agentUtm ? `&utm_content=${encodeURIComponent(agentUtm)}` : ""
  }`;
  return handoffUrl(session, next);
}

/** Mints the short-lived handoff token and wraps `next` (a same-site path on main) with it. */
async function handoffUrl(
  session: Awaited<ReturnType<typeof requirePartner>>,
  next: string,
): Promise<AgentOrderLinkResult> {
  // Main re-verifies the token's sub against user_profiles - a partner with no
  // portal user (possible under impersonation, where the session may carry the
  // admin's own sub) would sail through minting and then die silently on
  // main's side. Fail loudly here instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileRow } = await (supabase as any)
    .from("user_profiles")
    .select("id")
    .eq("id", session.sub)
    .in("role", ["agent", "affiliate", "office_manager"])
    .maybeSingle();
  if (!profileRow) {
    return {
      ok: false,
      error:
        "לשותף אין משתמש פורטל מקושר - הזמנה בשם הלקוח דורשת חשבון שותף אמיתי",
    };
  }

  let token: string;
  try {
    // Always minted as "agent": main's requireAgent doesn't know office_manager
    // and doesn't need to.
    token = await mintPartnerHandoffToken({
      sub: session.sub,
      email: session.email,
      role: "agent",
      partner_code: session.partner_code,
      // Carries THIS portal login over to main, which keeps agent mode alive
      // only while it still matches user_profiles.portal_session_id.
      sid: session.sid,
    });
  } catch (e) {
    // NEXT_SECRET_SESSION_SECRET missing - the plain link still works, the
    // agent just won't get agent-mode settlement on main. Fail loudly here so
    // the misconfiguration is visible instead of silently downgrading.
    console.error("getAgentOrderHandoffLink mint:", e);
    return { ok: false, error: "החתימה לא מוגדרת - פנו לתמיכה" };
  }

  const url = `${PUBLIC_SITE_URL}/api/partner-handoff?token=${encodeURIComponent(
    token,
  )}&next=${encodeURIComponent(next)}`;
  return { ok: true, url };
}
