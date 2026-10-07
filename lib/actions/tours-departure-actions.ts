"use server";

/**
 * Departures of the "tours" product type: the board (/tours/departures), the
 * departure card and everything edited from them - prices, promotions, flight
 * allocations, sales entries.
 *
 * Every action starts with requireCompany("tours") and filters every query by
 * that company. Expected failures come back as { success: false, error } in
 * Hebrew; nothing here throws to the client.
 *
 * Two READ actions start with requireCompanyViewer("tours") instead, because a
 * sales agent of the company (role tours_agent) shares them: getDeparturesBoard
 * and getDepartureView. For that viewer they answer with departures on sale
 * only and with the viewer's field list only (viewerBoardRow, DepartureViewData)
 * - no cost, PNR, docket, notes, markup, block status or sales entries. Every
 * other action here keeps requireCompany and so refuses the agent.
 *
 * Spec: mega-family/docs/plans/MEGA-FAMILY-FUNCTIONAL-SPEC.md (4.4-4.6, 5.1, 5.2, 6).
 */
import ExcelJS from "exceljs";
import { logAudit } from "@/lib/audit";
import { requireCompany, requireCompanyViewer } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { toPriceMatrix, type PriceMatrix } from "@/lib/tours/pricing";
import {
  ROUTE_TYPE_LABELS,
  checkBlockFitsDeparture,
  departureRouteLabel,
  routeType,
} from "@/lib/tours/routes";
import {
  BLOCK_STATUS_LABELS,
  CURRENCIES,
  FLIGHT_MODES,
  LIVE_BLOCK_STATUSES,
  PRICE_MATRIX_ROWS,
  PROMOTION_KINDS,
  SALE_STATUSES,
  SALE_STATUS_LABELS,
  type BlockStatus,
  type PromotionKind,
  type SaleStatus,
} from "@/types/tours.types";
import { ALLOCATION_LEGS } from "@/components/tours/flights/block-rules";
import { addDays, daysBetween, fmtDate, isDateOnly, nightsBetween, todayIso } from "@/lib/tours/format";
import {
  NO_LIVE_FLIGHT_WARNING,
  activeFixedDiscount,
  departureCode,
  doublePricePerPerson,
  effectiveRoute,
  normalizeAirport,
  promotionConflict,
  promotionSummary,
  publishBlockers,
  readRoomPrices,
  seasonYearOf,
  siteSaleStatus,
} from "@/components/tours/departures/departure-utils";
import type {
  ActionResult,
  AllocationLegs,
  BoardData,
  BoardFlight,
  BoardPackage,
  BoardPeriod,
  BoardPromotion,
  BoardRow,
  BoardSeries,
  BoardStats,
  BulkOutcome,
  CandidateBlock,
  CardAllocation,
  CardFlight,
  DepartureCardData,
  DepartureGeneralInput,
  DepartureViewData,
  PriceCellInput,
  PromotionInput,
  VacationPricingInput,
  ViewFlight,
  ViewHotelOption,
  TourDatesData,
  ViewTicketOption,
} from "@/components/tours/departures/types";
import { actionFail, actionOk as ok, chunk, fetchAll, intOrNull, must, mustRow, UserError, UUID } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";

const fail = (e: unknown) => actionFail(e, "tours-departure-actions");

const cleanIds = (ids: unknown): string[] =>
  Array.isArray(ids) ? Array.from(new Set(ids.filter((v): v is string => typeof v === "string" && UUID.test(v)))) : [];

const text = (value: unknown, max = 2000): string | null => {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v === "" ? null : v.slice(0, max);
};

/** UUID chunks stay well inside the URL length PostgREST accepts. */
const ID_CHUNK = 100;
const FLIGHT_ID_CHUNK = 300;

// ---------------------------------------------------------------- selects
const SERIES_SELECT =
  "id, code, label, package_id, arrival_airport, arrival_weekday, return_airport, return_weekday, default_nights, default_capacity, default_currency, child_max_age, senior_min_age, senior_discount, is_active";

const BOARD_SELECT =
  "id, code, series_id, package_id, season_year, start_date, end_date, season, season_id, itinerary_id, currency, is_published, sale_status, card_badge, date_labels, arrival_airport, return_airport, docket_no, flight_mode, flight_price, markup_fixed, is_deleted, departure_prices(pax_type, room_position, price), departure_options(kind, position, price, room_prices), promotions(id, kind, value, label, valid_until, show_on_card, is_active), flight_allocations(id, flight_id, seats, legs)";

const CARD_SELECT =
  "id, company_id, package_id, series_id, code, season_year, start_date, end_date, season, season_id, currency, is_published, sale_status, card_badge, date_labels, arrival_airport, return_airport, itinerary_id, leader_id, capacity, docket_no, meeting_at, flight_mode, flight_price, baggage_included, meal_included, transfers_included, connection_out, connection_back, child_max_age, senior_min_age, senior_discount, markup_percent, markup_fixed, price_source, costing_id, legacy_product_id, site_id, notes, origin_flight_id, is_deleted, created_at, updated_at";

/** What the publish rules and the price writers need to know about a departure. */
const CORE_SELECT =
  "id, code, series_id, package_id, season_year, start_date, end_date, currency, is_published, sale_status, arrival_airport, return_airport, flight_mode, flight_price, markup_fixed, is_deleted, departure_prices(pax_type, room_position, price), departure_options(kind, position, price, room_prices)";

const FLIGHT_SELECT =
  "id, airline_code, inbound_airline_code, block_status, is_deleted, outbound_departure_airport, outbound_arrival_airport, inbound_departure_airport, inbound_arrival_airport, outbound_flight_number, inbound_flight_number, outbound_departure_time, outbound_arrival_time, inbound_departure_time, initial_quantity, season_label, pnr";

const isLiveBlock = (f: { block_status: string | null; is_deleted: boolean | null }): boolean =>
  f.is_deleted !== true && LIVE_BLOCK_STATUSES.includes(f.block_status as BlockStatus);

const EMPTY_STATS: BoardStats = { allocated: 0, liveBlocks: 0, totalBlocks: 0, sold: 0, remaining: 0 };

// ---------------------------------------------------------------- loaders
/** The company's own holiday periods and the global ones (company_id is null). */
async function loadPeriods(companyId: string): Promise<BoardPeriod[]> {
  return fetchAll<BoardPeriod>((from, to) =>
    supabaseTyped
      .from("calendar_periods")
      .select("id, name, kind, year, holiday_date, start_date, end_date")
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order("year")
      .order("id")
      .range(from, to),
  );
}

async function loadSeries(companyId: string): Promise<BoardSeries[]> {
  return fetchAll<BoardSeries>((from, to) =>
    toursDb().from("series").select(SERIES_SELECT).eq("company_id", companyId).order("code").range(from, to),
  );
}

async function loadStats(companyId: string, ids?: string[]): Promise<Map<string, BoardStats>> {
  type Row = {
    departure_id: string | null;
    allocated_seats: number | null;
    live_blocks: number | null;
    total_blocks: number | null;
    sold: number | null;
    remaining: number | null;
  };
  const columns = "departure_id, allocated_seats, live_blocks, total_blocks, sold, remaining";
  let rows: Row[] = [];
  if (ids) {
    for (const part of chunk(ids, ID_CHUNK)) {
      rows = rows.concat(
        must(await toursDb().from("departure_stats").select(columns).eq("company_id", companyId).in("departure_id", part)) ?? [],
      );
    }
  } else {
    rows = await fetchAll<Row>((from, to) =>
      toursDb().from("departure_stats").select(columns).eq("company_id", companyId).order("departure_id").range(from, to),
    );
  }
  const out = new Map<string, BoardStats>();
  for (const r of rows) {
    if (!r.departure_id) continue;
    out.set(r.departure_id, {
      allocated: r.allocated_seats ?? 0,
      liveBlocks: r.live_blocks ?? 0,
      totalBlocks: r.total_blocks ?? 0,
      sold: r.sold ?? 0,
      remaining: r.remaining ?? 0,
    });
  }
  return out;
}

/** Flight blocks by id. public.flights holds every company's flights - the company filter is the guard. */
async function loadFlights(companyId: string, flightIds: number[]) {
  const unique = Array.from(new Set(flightIds));
  type Row = Omit<CardFlight, "allocatedOutbound" | "allocatedInbound">;
  let rows: Row[] = [];
  for (const part of chunk(unique, FLIGHT_ID_CHUNK)) {
    rows = rows.concat(
      must(await supabaseTyped.from("flights").select(FLIGHT_SELECT).eq("company_id", companyId).in("id", part)) ?? [],
    );
  }
  return new Map(rows.map((f) => [f.id, f]));
}

/** Seats of each block already given to departures, per direction. */
async function allocationSums(
  companyId: string,
  flightIds: number[],
): Promise<Map<number, { outbound: number; inbound: number }>> {
  const out = new Map<number, { outbound: number; inbound: number }>();
  for (const part of chunk(Array.from(new Set(flightIds)), FLIGHT_ID_CHUNK)) {
    const rows = await fetchAll<{ flight_id: number; seats: number; legs: string }>((from, to) =>
      toursDb()
        .from("flight_allocations")
        .select("flight_id, seats, legs")
        .eq("company_id", companyId)
        .in("flight_id", part)
        .order("id")
        .range(from, to),
    );
    for (const r of rows) {
      const sum = out.get(r.flight_id) ?? { outbound: 0, inbound: 0 };
      if (r.legs !== "inbound") sum.outbound += r.seats;
      if (r.legs !== "outbound") sum.inbound += r.seats;
      out.set(r.flight_id, sum);
    }
  }
  return out;
}

async function loadBoardRows(
  companyId: string,
  filter: { years?: number[]; ids?: string[]; packageId?: string; includeDeleted?: boolean; onSaleOnly?: boolean },
): Promise<BoardRow[]> {
  const pageOf = (ids: string[] | null) => (from: number, to: number) => {
    let q = toursDb()
      .from("departures")
      .select(BOARD_SELECT)
      .eq("company_id", companyId)
      .eq("departure_prices.company_id", companyId)
      .eq("departure_options.company_id", companyId)
      .eq("promotions.company_id", companyId)
      .eq("flight_allocations.company_id", companyId);
    if (filter.years?.length) q = q.in("season_year", filter.years);
    // On sale = published and not deleted - what a read-only viewer may see.
    if (filter.onSaleOnly) q = q.eq("is_published", true).is("is_deleted", null);
    else if (!filter.includeDeleted) q = q.is("is_deleted", null);
    if (ids) q = q.in("id", ids);
    if (filter.packageId) q = q.eq("package_id", filter.packageId);
    return q.order("start_date").order("code").order("id").range(from, to);
  };

  type Raw = Awaited<ReturnType<ReturnType<typeof pageOf>>>["data"];
  type RawRow = NonNullable<Raw>[number];
  let raw: RawRow[] = [];
  if (filter.ids) {
    for (const part of chunk(filter.ids, ID_CHUNK)) raw = raw.concat(await fetchAll<RawRow>(pageOf(part)));
  } else {
    raw = await fetchAll<RawRow>(pageOf(null));
  }
  if (raw.length === 0) return [];

  const [stats, flights, seriesPromotions] = await Promise.all([
    // one tour's dates read their own stats, not the whole company's
    loadStats(companyId, filter.ids ?? (filter.packageId ? raw.map((d) => d.id) : undefined)),
    loadFlights(
      companyId,
      raw.flatMap((d) => d.flight_allocations.map((a) => a.flight_id)),
    ),
    fetchAll<{
      id: string;
      series_id: string | null;
      kind: string;
      value: number | null;
      label: string | null;
      valid_until: string | null;
      show_on_card: boolean;
      is_active: boolean;
    }>((from, to) =>
      toursDb()
        .from("promotions")
        .select("id, series_id, kind, value, label, valid_until, show_on_card, is_active")
        .eq("company_id", companyId)
        .not("series_id", "is", null)
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
  ]);

  return raw.map((d): BoardRow => {
    const { departure_prices, departure_options, promotions, flight_allocations, ...row } = d;
    const own: BoardPromotion[] = promotions
      .filter((p) => p.is_active)
      .map((p) => ({ ...p, scope: "departure" as const }));
    const inherited: BoardPromotion[] = seriesPromotions
      .filter((p) => p.series_id === d.series_id)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        value: p.value,
        label: p.label,
        valid_until: p.valid_until,
        show_on_card: p.show_on_card,
        is_active: p.is_active,
        scope: "series" as const,
      }));
    const rowFlights: BoardFlight[] = [];
    for (const a of flight_allocations) {
      const f = flights.get(a.flight_id);
      if (!f) continue;
      rowFlights.push({
        allocationId: a.id,
        flightId: a.flight_id,
        seats: a.seats,
        legs: a.legs as AllocationLegs,
        airline: f.airline_code,
        blockStatus: f.block_status,
        isLive: isLiveBlock(f),
      });
    }
    return {
      ...row,
      prices: toPriceMatrix(departure_prices),
      options: departure_options,
      promotions: [...own, ...inherited],
      flights: rowFlights,
      stats: stats.get(d.id) ?? EMPTY_STATS,
    };
  });
}

/** Departures with what the publish rules need. Only rows of this company come back. */
async function loadCores(companyId: string, ids: string[]) {
  const pageOf = (part: string[]) =>
    toursDb()
      .from("departures")
      .select(CORE_SELECT)
      .eq("company_id", companyId)
      .eq("departure_prices.company_id", companyId)
      .eq("departure_options.company_id", companyId)
      .in("id", part);
  type Core = NonNullable<Awaited<ReturnType<typeof pageOf>>["data"]>[number];
  let rows: Core[] = [];
  for (const part of chunk(ids, ID_CHUNK)) rows = rows.concat(must(await pageOf(part)) ?? []);
  return rows;
}

type Core = Awaited<ReturnType<typeof loadCores>>[number];

async function loadCore(companyId: string, id: string): Promise<Core> {
  if (!UUID.test(id)) throw new UserError("Departure not found");
  const [core] = await loadCores(companyId, [id]);
  if (!core) throw new UserError("Departure not found in the active company");
  return core;
}

/** Why this departure may not be on the site, given an optional not-yet-saved change. */
function blockersOf(
  core: Core,
  series: BoardSeries | undefined,
  override: Partial<{
    start_date: string;
    end_date: string;
    currency: string;
    arrival_airport: string | null;
    return_airport: string | null;
    flight_mode: string;
    flight_price: number;
    markup_fixed: number | null;
    prices: PriceMatrix;
    options: Core["departure_options"];
  }> = {},
): string[] {
  const merged = { ...core, ...override };
  return publishBlockers({
    start_date: merged.start_date,
    end_date: merged.end_date,
    currency: merged.currency,
    route: effectiveRoute(merged, series),
    prices: override.prices ?? toPriceMatrix(core.departure_prices),
    options: override.options ?? core.departure_options,
    flight_mode: merged.flight_mode,
    flight_price: merged.flight_price,
    markup_fixed: merged.markup_fixed,
  });
}

// ---------------------------------------------------------------- read-only viewer (tours_agent)
/**
 * A board row as a read-only viewer receives it. Built key by key - an
 * allowlist - so a column added to BoardRow later does not reach the viewer by
 * accident. Left out: the docket number, the parts a vacation price is made of
 * (options, markup - the finished price goes in `doublePrice`), blocks that
 * are not live, and the status of every block.
 */
function viewerBoardRow(r: BoardRow): BoardRow {
  return {
    id: r.id,
    code: r.code,
    series_id: r.series_id,
    package_id: r.package_id,
    season_year: r.season_year,
    start_date: r.start_date,
    end_date: r.end_date,
    season: r.season,
    season_id: null,
    itinerary_id: null,
    currency: r.currency,
    is_published: r.is_published,
    // the agent sees what the customer sees: sold out / last places follow the seats
    sale_status: siteSaleStatus({ sale_status: r.sale_status, allocated: r.stats.allocated, remaining: r.stats.remaining }),
    card_badge: r.card_badge,
    date_labels: r.date_labels,
    arrival_airport: r.arrival_airport,
    return_airport: r.return_airport,
    docket_no: null,
    flight_mode: r.flight_mode,
    flight_price: r.flight_price,
    markup_fixed: null,
    is_deleted: null,
    prices: r.prices,
    options: [],
    doublePrice: doublePricePerPerson(r),
    promotions: r.promotions.map((p) => ({
      id: p.id,
      kind: p.kind,
      value: p.value,
      label: p.label,
      valid_until: p.valid_until,
      show_on_card: p.show_on_card,
      is_active: p.is_active,
      scope: p.scope,
    })),
    flights: r.flights
      .filter((f) => f.isLive)
      .map((f) => ({
        allocationId: f.allocationId,
        flightId: f.flightId,
        seats: f.seats,
        legs: f.legs,
        airline: f.airline,
        blockStatus: null,
        isLive: true,
      })),
    stats: {
      allocated: r.stats.allocated,
      liveBlocks: r.stats.liveBlocks,
      totalBlocks: r.stats.liveBlocks,
      sold: r.stats.sold,
      remaining: r.stats.remaining,
    },
  };
}

/** The board of a read-only viewer: departures on sale, and only the series and pages they belong to. */
async function loadViewerBoard(companyId: string, years: number[]): Promise<BoardData> {
  const edge = (ascending: boolean) =>
    toursDb()
      .from("departures")
      .select("season_year")
      .eq("company_id", companyId)
      .eq("is_published", true)
      .is("is_deleted", null)
      .order("season_year", { ascending })
      .limit(1)
      .maybeSingle();

  const [rows, series, packages, periods, first, last] = await Promise.all([
    loadBoardRows(companyId, { years, onSaleOnly: true }),
    loadSeries(companyId),
    fetchAll<BoardPackage>((from, to) =>
      toursDb().from("packages").select("id, name, kind, slug").eq("company_id", companyId).order("name").range(from, to),
    ),
    loadPeriods(companyId),
    edge(true),
    edge(false),
  ]);

  const seriesIds = new Set(rows.map((r) => r.series_id));
  const packageIds = new Set(rows.map((r) => r.package_id));
  const min = must(first)?.season_year;
  const max = must(last)?.season_year;
  return {
    rows: rows.map(viewerBoardRow),
    // The planned group size of a series is an operations figure, not a selling one.
    series: series.filter((s) => seriesIds.has(s.id)).map((s) => ({ ...s, default_capacity: null })),
    packages: packages.filter((p) => packageIds.has(p.id)),
    periods,
    yearRange: min != null && max != null ? { min, max } : null,
    loadedYears: years,
    readOnly: true,
  };
}

/** The columns a read-only viewer's departure is built from. markup_fixed is read to price a vacation, never sent. */
const VIEW_DEPARTURE_SELECT =
  "id, package_id, series_id, code, season_year, start_date, end_date, season, currency, sale_status, card_badge, date_labels, arrival_airport, return_airport, itinerary_id, meeting_at, flight_mode, flight_price, baggage_included, meal_included, transfers_included, connection_out, connection_back, child_max_age, senior_min_age, senior_discount, markup_fixed";

/** A block's schedule. block_status and is_deleted are read to keep live blocks only, never sent. */
const VIEW_FLIGHT_SELECT =
  "id, block_status, is_deleted, airline_code, inbound_airline_code, metadata_name, outbound_flight_number, outbound_departure_airport, outbound_arrival_airport, outbound_departure_time, outbound_arrival_time, inbound_flight_number, inbound_departure_airport, inbound_arrival_airport, inbound_departure_time, inbound_arrival_time";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * One departure for a read-only viewer: what a sales agent needs to sell it
 * and nothing else (the shape itself is the allowlist - see DepartureViewData).
 * Only a departure on sale (published, not deleted) is found. Staff may call it
 * too and get the same view.
 */
export async function getDepartureView(ref: { id?: string; code?: string }): Promise<ActionResult<DepartureViewData>> {
  try {
    const { company } = await requireCompanyViewer("tours");
    const db = toursDb();
    const onSale = () =>
      db
        .from("departures")
        .select(VIEW_DEPARTURE_SELECT)
        .eq("company_id", company.id)
        .eq("is_published", true)
        .is("is_deleted", null);

    let found: NonNullable<Awaited<ReturnType<typeof onSale>>["data"]>[number] | null = null;
    if (ref.id && UUID.test(ref.id)) {
      found = must(await onSale().eq("id", ref.id).maybeSingle());
    } else if (ref.code && ref.code.trim()) {
      // A code repeats across season years: the next one to depart, else the latest.
      const matches = must(await onSale().eq("code", ref.code.trim().toUpperCase()).order("start_date", { ascending: true })) ?? [];
      const today = todayIso();
      found = matches.find((m) => m.end_date >= today) ?? matches[matches.length - 1] ?? null;
    }
    if (!found) throw new UserError("Departure not found, or it is not on sale right now");
    const dep = found;

    const [series, pkg, itinerary, prices, options, promotions, allocations, stats] = await Promise.all([
      db
        .from("series")
        .select("code, label, arrival_airport, return_airport, child_max_age, senior_min_age, senior_discount")
        .eq("company_id", company.id)
        .eq("id", dep.series_id)
        .maybeSingle(),
      db.from("packages").select("name, kind").eq("company_id", company.id).eq("id", dep.package_id).maybeSingle(),
      dep.itinerary_id
        ? db
            .from("package_itineraries")
            .select("label, arrival_city, return_city")
            .eq("company_id", company.id)
            .eq("package_id", dep.package_id)
            .eq("id", dep.itinerary_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from("departure_prices").select("pax_type, room_position, price").eq("company_id", company.id).eq("departure_id", dep.id),
      db
        .from("departure_options")
        .select("kind, position, ref_code, label, board, nights, price, room_prices")
        .eq("company_id", company.id)
        .eq("departure_id", dep.id)
        .order("kind")
        .order("position"),
      db
        .from("promotions")
        .select("id, kind, value, label, valid_until, show_on_card, is_active, departure_id")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .or(`departure_id.eq.${dep.id},series_id.eq.${dep.series_id}`)
        .order("kind"),
      db
        .from("flight_allocations")
        .select("flight_id, legs, created_at")
        .eq("company_id", company.id)
        .eq("departure_id", dep.id)
        .order("created_at"),
      loadStats(company.id, [dep.id]),
    ]);

    const seriesRow = must(series);
    const pkgRow = must(pkg);
    const itineraryRow = must(itinerary);
    const priceRows = must(prices) ?? [];
    const optionRows = must(options) ?? [];
    const allocationRows = must(allocations) ?? [];
    const flightIds = Array.from(new Set(allocationRows.map((a) => a.flight_id)));
    const hotelCodes = optionRows.flatMap((o) => (o.kind === "hotel" && o.ref_code ? [o.ref_code] : []));

    const [flightRows, hotelRows] = await Promise.all([
      flightIds.length
        ? supabaseTyped.from("flights").select(VIEW_FLIGHT_SELECT).eq("company_id", company.id).in("id", flightIds)
        : Promise.resolve({ data: [], error: null }),
      hotelCodes.length
        ? db.from("hotels").select("code, name, city").eq("company_id", company.id).in("code", hotelCodes)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const flightById = new Map((must(flightRows) ?? []).map((f) => [f.id, f]));
    const hotelByCode = new Map((must(hotelRows) ?? []).map((h) => [h.code, h]));

    // Live blocks only, and only their schedule.
    const flights: ViewFlight[] = [];
    for (const a of allocationRows) {
      const f = flightById.get(a.flight_id);
      if (!f || !isLiveBlock(f)) continue;
      flights.push({
        legs: a.legs as AllocationLegs,
        airline_code: f.airline_code,
        inbound_airline_code: f.inbound_airline_code,
        airline_name: f.metadata_name || null,
        outbound_flight_number: f.outbound_flight_number,
        outbound_departure_airport: f.outbound_departure_airport,
        outbound_arrival_airport: f.outbound_arrival_airport,
        outbound_departure_time: f.outbound_departure_time,
        outbound_arrival_time: f.outbound_arrival_time,
        inbound_flight_number: f.inbound_flight_number,
        inbound_departure_airport: f.inbound_departure_airport,
        inbound_arrival_airport: f.inbound_arrival_airport,
        inbound_departure_time: f.inbound_departure_time,
        inbound_arrival_time: f.inbound_arrival_time,
      });
    }

    // Vacation parts, priced the way the site prices them (vacationDoublePerPerson
    // in departure-utils): room / people + default ticket + flight + fixed
    // markup. The viewer gets the finished price per person, not the parts.
    const ticketRows = optionRows.filter((o) => o.kind === "ticket");
    const defaultTicket = Number(ticketRows[0]?.price ?? 0);
    const flightPart = dep.flight_mode === "priced" ? Number(dep.flight_price ?? 0) : 0;
    const markup = Number(dep.markup_fixed ?? 0);
    const perPerson = (room: number | null, people: number): number | null =>
      room != null && room > 0 ? round2(room / people + defaultTicket + flightPart + markup) : null;
    const hotels: ViewHotelOption[] = optionRows
      .filter((o) => o.kind === "hotel")
      .map((o) => {
        const room = readRoomPrices(o.room_prices);
        const catalog = o.ref_code ? hotelByCode.get(o.ref_code) : undefined;
        return {
          name: catalog?.name ?? o.label ?? o.ref_code ?? "Hotel",
          city: catalog?.city ?? null,
          board: o.board,
          nights: o.nights,
          perPerson: { double: perPerson(room.double, 2), triple: perPerson(room.triple, 3), quad: perPerson(room.quad, 4) },
        };
      });
    const tickets: ViewTicketOption[] = ticketRows.map((o) => ({
      label: o.label,
      extra: o.price == null ? null : round2(Number(o.price) - defaultTicket),
    }));

    const stat = stats.get(dep.id) ?? EMPTY_STATS;
    return ok({
      departure: {
        id: dep.id,
        code: dep.code,
        season_year: dep.season_year,
        start_date: dep.start_date,
        end_date: dep.end_date,
        season: dep.season,
        currency: dep.currency,
        sale_status: dep.sale_status,
        card_badge: dep.card_badge,
        date_labels: dep.date_labels,
        arrival_airport: dep.arrival_airport ?? seriesRow?.arrival_airport ?? null,
        return_airport: dep.return_airport ?? seriesRow?.return_airport ?? null,
        meeting_at: dep.meeting_at,
        flight_mode: dep.flight_mode,
        flight_price: dep.flight_price,
        baggage_included: dep.baggage_included,
        meal_included: dep.meal_included,
        transfers_included: dep.transfers_included,
        connection_out: dep.connection_out,
        connection_back: dep.connection_back,
        child_max_age: dep.child_max_age ?? seriesRow?.child_max_age ?? null,
        senior_min_age: dep.senior_min_age ?? seriesRow?.senior_min_age ?? null,
        senior_discount: dep.senior_discount ?? seriesRow?.senior_discount ?? null,
      },
      series: seriesRow ? { code: seriesRow.code, label: seriesRow.label } : null,
      package: pkgRow ? { name: pkgRow.name, kind: pkgRow.kind } : null,
      itinerary: itineraryRow
        ? { label: itineraryRow.label, arrival_city: itineraryRow.arrival_city, return_city: itineraryRow.return_city }
        : null,
      prices: priceRows.map((p) => ({ pax_type: p.pax_type, room_position: p.room_position, price: Number(p.price) })),
      hotels,
      tickets,
      doublePrice: doublePricePerPerson({
        prices: toPriceMatrix(priceRows),
        options: optionRows,
        flight_mode: dep.flight_mode,
        flight_price: dep.flight_price,
        markup_fixed: dep.markup_fixed,
      }),
      promotions: (must(promotions) ?? []).map((p) => ({
        id: p.id,
        kind: p.kind,
        value: p.value,
        label: p.label,
        valid_until: p.valid_until,
        show_on_card: p.show_on_card,
        is_active: p.is_active,
        scope: p.departure_id ? ("departure" as const) : ("series" as const),
      })),
      flights,
      seats: { allocated: stat.allocated, sold: stat.sold, remaining: stat.remaining },
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- board
export async function getDeparturesBoard(input: {
  years: number[];
  includeDeleted?: boolean;
}): Promise<ActionResult<BoardData>> {
  try {
    // Staff, or a sales agent of the company - the agent gets the viewer's board.
    const { company, readOnly } = await requireCompanyViewer("tours");
    const years = (input.years ?? []).filter((y) => Number.isInteger(y) && y > 2000 && y < 2100);
    if (readOnly) return ok(await loadViewerBoard(company.id, years));

    const edge = (ascending: boolean) =>
      toursDb()
        .from("departures")
        .select("season_year")
        .eq("company_id", company.id)
        .is("is_deleted", null)
        .order("season_year", { ascending })
        .limit(1)
        .maybeSingle();

    const [rows, series, packages, periods, first, last] = await Promise.all([
      loadBoardRows(company.id, { years, includeDeleted: input.includeDeleted }),
      loadSeries(company.id),
      fetchAll<BoardPackage>((from, to) =>
        toursDb()
          .from("packages")
          .select("id, name, kind, slug")
          .eq("company_id", company.id)
          .order("name")
          .range(from, to),
      ),
      loadPeriods(company.id),
      edge(true),
      edge(false),
    ]);

    const min = must(first)?.season_year;
    const max = must(last)?.season_year;
    return ok({
      rows,
      series,
      packages,
      periods,
      yearRange: min != null && max != null ? { min, max } : null,
      loadedYears: years,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * The dates of one tour, for the Dates & Prices tab of its page: the board rows
 * of every departure of the tour (all years, not deleted), the tour's series and
 * the holiday periods the departure card marks.
 */
export async function getTourDates(packageId: string): Promise<ActionResult<TourDatesData>> {
  try {
    const { company } = await requireCompany("tours");
    if (typeof packageId !== "string" || !UUID.test(packageId)) throw new UserError("Tour not found");
    const [rows, series, periods, leaders] = await Promise.all([
      loadBoardRows(company.id, { packageId }),
      loadSeries(company.id),
      loadPeriods(company.id),
      fetchAll<{ id: string; leader_id: string | null }>((from, to) =>
        toursDb()
          .from("departures")
          .select("id, leader_id")
          .eq("company_id", company.id)
          .eq("package_id", packageId)
          .not("leader_id", "is", null)
          .order("id")
          .range(from, to),
      ),
    ]);
    const leaderIds = [...new Set(leaders.map((d) => d.leader_id).filter((id): id is string => !!id))];
    const names = leaderIds.length
      ? (must(await toursDb().from("instructors").select("id, name").eq("company_id", company.id).in("id", leaderIds)) ?? [])
      : [];
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    const leaderNames: Record<string, string> = {};
    for (const d of leaders) {
      const name = d.leader_id ? nameById.get(d.leader_id) : undefined;
      if (name) leaderNames[d.id] = name;
    }
    return ok({ rows, series: series.filter((s) => s.package_id === packageId), periods, leaderNames });
  } catch (e) {
    return fail(e);
  }
}

/** Fresh board rows for a few departures - what the board swaps in after an edit. */
export async function getBoardRows(ids: string[]): Promise<ActionResult<BoardRow[]>> {
  try {
    const { company } = await requireCompany("tours");
    const wanted = cleanIds(ids);
    if (wanted.length === 0) return ok([]);
    return ok(await loadBoardRows(company.id, { ids: wanted, includeDeleted: true }));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- card
export async function getDepartureCard(ref: { id?: string; code?: string }): Promise<ActionResult<DepartureCardData>> {
  try {
    const { company } = await requireCompany("tours");
    const db = toursDb();

    let departure: DepartureCardData["departure"] | null = null;
    if (ref.id && UUID.test(ref.id)) {
      departure = must(
        await db.from("departures").select(CARD_SELECT).eq("company_id", company.id).eq("id", ref.id).maybeSingle(),
      );
    } else if (ref.code && ref.code.trim()) {
      // A code repeats across season years: prefer a live row, then the next one to depart, then the latest.
      const matches =
        must(
          await db
            .from("departures")
            .select(CARD_SELECT)
            .eq("company_id", company.id)
            .eq("code", ref.code.trim().toUpperCase())
            .order("start_date", { ascending: true }),
        ) ?? [];
      const today = todayIso();
      const live = matches.filter((m) => !m.is_deleted);
      departure =
        live.find((m) => m.end_date >= today) ?? live[live.length - 1] ?? matches[matches.length - 1] ?? null;
    }
    if (!departure) throw new UserError("Departure not found in the active company");
    const dep = departure;

    const [series, pkg, itineraries, seasons, prices, options, promotions, allocations, stats] = await Promise.all([
      db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", dep.series_id).maybeSingle(),
      db.from("packages").select("id, name, kind, slug").eq("company_id", company.id).eq("id", dep.package_id).maybeSingle(),
      db
        .from("package_itineraries")
        .select("id, key, label, arrival_city, return_city")
        .eq("company_id", company.id)
        .eq("package_id", dep.package_id)
        .order("key"),
      db
        .from("package_seasons")
        .select("id, name")
        .eq("company_id", company.id)
        .eq("package_id", dep.package_id)
        .order("position")
        .order("name"),
      db
        .from("departure_prices")
        .select("pax_type, room_position, price")
        .eq("company_id", company.id)
        .eq("departure_id", dep.id),
      db
        .from("departure_options")
        .select("id, kind, position, ref_code, label, board, nights, price, price_unit, room_prices")
        .eq("company_id", company.id)
        .eq("departure_id", dep.id)
        .order("kind")
        .order("position"),
      db
        .from("promotions")
        .select("id, kind, value, label, valid_until, show_on_card, is_active, departure_id, series_id")
        .eq("company_id", company.id)
        .or(`departure_id.eq.${dep.id},series_id.eq.${dep.series_id}`)
        .order("is_active", { ascending: false })
        .order("kind"),
      db
        .from("flight_allocations")
        .select("id, flight_id, seats, legs, created_at")
        .eq("company_id", company.id)
        .eq("departure_id", dep.id)
        .order("created_at"),
      loadStats(company.id, [dep.id]),
    ]);

    const pkgRow = must(pkg);
    const allocationRows = must(allocations) ?? [];
    const flightIds = allocationRows.map((a) => a.flight_id);
    const [flights, sums, hotels, leaders] = await Promise.all([
      loadFlights(company.id, flightIds),
      allocationSums(company.id, flightIds),
      pkgRow?.kind === "vacation"
        ? db.from("hotels").select("code, name, city").eq("company_id", company.id).order("name")
        : Promise.resolve({ data: [], error: null }),
      db.from("instructors").select("id, name, is_active").eq("company_id", company.id).order("name"),
    ]);

    const cardAllocations: CardAllocation[] = [];
    for (const a of allocationRows) {
      const f = flights.get(a.flight_id);
      if (!f) continue;
      const sum = sums.get(a.flight_id) ?? { outbound: 0, inbound: 0 };
      cardAllocations.push({
        id: a.id,
        seats: a.seats,
        legs: a.legs as AllocationLegs,
        created_at: a.created_at,
        flight: { ...f, allocatedOutbound: sum.outbound, allocatedInbound: sum.inbound },
      });
    }

    return ok({
      departure: dep,
      series: must(series),
      package: pkgRow,
      itineraries: must(itineraries) ?? [],
      seasons: must(seasons) ?? [],
      hotels: must(hotels) ?? [],
      leaders: (must(leaders) ?? []).map((l) => ({ id: l.id, name: l.name, isActive: l.is_active })),
      prices: must(prices) ?? [],
      options: must(options) ?? [],
      promotions: must(promotions) ?? [],
      allocations: cardAllocations,
      stats: stats.get(dep.id) ?? EMPTY_STATS,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- general fields
// Whole numbers go through intOrNull (lib/tours/action-kit.ts); this is its decimal twin.
const numOrNull = (value: unknown, min: number, max: number, label: string): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`${label}: invalid value`);
  return n;
};

/**
 * Edit the fields of the card's general tab (and the inline cells of the
 * board). Only the keys present in `input` are written. A published departure
 * may not be edited into a state that could not have been published.
 */
export async function updateDeparture(id: string, input: DepartureGeneralInput): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, id);
    const patch: Record<string, unknown> = {};
    const has = (key: keyof DepartureGeneralInput) => Object.prototype.hasOwnProperty.call(input, key);

    if (has("start_date") || has("end_date")) {
      const start = input.start_date ?? core.start_date;
      const end = input.end_date ?? core.end_date;
      if (!isDateOnly(start) || !isDateOnly(end)) throw new UserError("Invalid date");
      if (end < start) throw new UserError("The return date is before the departure date");
      patch.start_date = start;
      patch.end_date = end;
      if (seasonYearOf(start) !== core.season_year) patch.season_year = seasonYearOf(start);
    }
    if (has("season")) patch.season = text(input.season, 60);
    if (has("season_id")) {
      // The season row decides the word: the database keeps `season` in step (departures_season_sync).
      const seasonId = input.season_id || null;
      if (seasonId) {
        const found = UUID.test(seasonId)
          ? must(
              await toursDb()
                .from("package_seasons")
                .select("id")
                .eq("company_id", company.id)
                .eq("package_id", core.package_id)
                .eq("id", seasonId)
                .maybeSingle(),
            )
          : null;
        if (!found) throw new UserError("The season doesn't belong to the departure's tour");
      }
      patch.season_id = seasonId;
      delete patch.season;
    }
    if (has("currency")) {
      if (!(CURRENCIES as readonly string[]).includes(input.currency ?? "")) throw new UserError("Unsupported currency");
      patch.currency = input.currency;
    }
    if (has("sale_status")) {
      if (!(SALE_STATUSES as readonly string[]).includes(input.sale_status ?? "")) throw new UserError("Invalid sale status");
      patch.sale_status = input.sale_status;
    }
    if (has("card_badge")) patch.card_badge = text(input.card_badge, 60);
    if (has("date_labels")) {
      const labels = Array.isArray(input.date_labels) ? input.date_labels : [];
      patch.date_labels = Array.from(
        new Set(labels.map((l) => (typeof l === "string" ? l.trim().slice(0, 60) : "")).filter(Boolean)),
      ).slice(0, 6);
    }
    for (const key of ["arrival_airport", "return_airport"] as const) {
      if (!has(key)) continue;
      const code = normalizeAirport(input[key]);
      if (code === undefined) throw new UserError("An airport code is three English letters (e.g. LHR)");
      patch[key] = code;
    }
    if (has("itinerary_id")) {
      const itineraryId = input.itinerary_id || null;
      if (itineraryId) {
        const found = must(
          await toursDb()
            .from("package_itineraries")
            .select("id")
            .eq("company_id", company.id)
            .eq("package_id", core.package_id)
            .eq("id", itineraryId)
            .maybeSingle(),
        );
        if (!found) throw new UserError("The itinerary version doesn't belong to the departure's tour page");
      }
      patch.itinerary_id = itineraryId;
    }
    if (has("leader_id")) {
      const leaderId = input.leader_id || null;
      if (leaderId) {
        const found = UUID.test(leaderId)
          ? must(await toursDb().from("instructors").select("id").eq("company_id", company.id).eq("id", leaderId).maybeSingle())
          : null;
        if (!found) throw new UserError("Group leader not found in the active company");
      }
      patch.leader_id = leaderId;
    }
    if (has("capacity")) patch.capacity = intOrNull(input.capacity, 0, 2000, "Capacity");
    if (has("docket_no")) patch.docket_no = text(input.docket_no, 60);
    if (has("meeting_at")) {
      const at = input.meeting_at ? new Date(input.meeting_at) : null;
      if (at && Number.isNaN(at.getTime())) throw new UserError("Invalid meeting time");
      patch.meeting_at = at ? at.toISOString() : null;
    }
    if (has("flight_mode")) {
      if (!(FLIGHT_MODES as readonly string[]).includes(input.flight_mode ?? "")) throw new UserError("Invalid flight type");
      patch.flight_mode = input.flight_mode;
    }
    if (has("flight_price")) patch.flight_price = numOrNull(input.flight_price, 0, 1_000_000, "Flight price") ?? 0;
    for (const key of ["baggage_included", "meal_included", "transfers_included"] as const) {
      if (has(key)) patch[key] = Boolean(input[key]);
    }
    if (has("connection_out")) patch.connection_out = text(input.connection_out, 300);
    if (has("connection_back")) patch.connection_back = text(input.connection_back, 300);
    if (has("child_max_age")) patch.child_max_age = intOrNull(input.child_max_age, 0, 25, "Child up to age");
    if (has("senior_min_age")) patch.senior_min_age = intOrNull(input.senior_min_age, 40, 120, "Senior from age");
    if (has("senior_discount")) patch.senior_discount = numOrNull(input.senior_discount, 0, 100_000, "Senior discount");
    if (has("notes")) patch.notes = text(input.notes, 4000);

    if (Object.keys(patch).length === 0) return ok(undefined);

    if (core.is_published) {
      const series = must(
        await toursDb().from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      );
      const blockers = blockersOf(core, series ?? undefined, patch);
      if (blockers.length) {
        throw new UserError(`The departure is published, and this change leaves it without required data: ${blockers.join(", ")}. Unpublish it first.`);
      }
    }

    const { error } = await toursDb().from("departures").update(patch).eq("company_id", company.id).eq("id", id);
    if (error) {
      if (error.code === "23505") throw new UserError(`A departure with code ${core.code} already exists in ${String(patch.season_year)}`);
      throw new Error(error.message);
    }
    await logAudit({
      action: "update",
      entityType: "tours_departure",
      entityId: id,
      changes: patch,
      metadata: { ...companyAudit(company), code: core.code },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- publish / sale status
/**
 * Publish or unpublish. Publishing needs dates, both route ends (own or the
 * series'), a currency and a double-room price; a departure that misses one is
 * skipped with the reason. Publishing without a live flight block goes through
 * with a warning (functional spec 4.4).
 */
export async function setDeparturesPublished(ids: string[], published: boolean): Promise<ActionResult<BulkOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    const wanted = cleanIds(ids);
    if (wanted.length === 0) throw new UserError("No departures selected");
    const cores = await loadCores(company.id, wanted);
    const outcome: BulkOutcome = { done: [], skipped: [], warnings: [] };

    if (published) {
      const [series, stats] = await Promise.all([loadSeries(company.id), loadStats(company.id, cores.map((c) => c.id))]);
      const seriesById = new Map(series.map((s) => [s.id, s]));
      for (const core of cores) {
        if (core.is_deleted) {
          outcome.skipped.push({ code: core.code, reason: "The departure is deleted" });
          continue;
        }
        const blockers = blockersOf(core, seriesById.get(core.series_id));
        if (blockers.length) {
          outcome.skipped.push({ code: core.code, reason: blockers.join(", ") });
          continue;
        }
        outcome.done.push(core.id);
        if ((stats.get(core.id)?.liveBlocks ?? 0) === 0) {
          outcome.warnings.push({ code: core.code, reason: NO_LIVE_FLIGHT_WARNING });
        }
      }
    } else {
      outcome.done = cores.map((c) => c.id);
    }

    for (const part of chunk(outcome.done, ID_CHUNK)) {
      must(
        await toursDb()
          .from("departures")
          .update({ is_published: published })
          .eq("company_id", company.id)
          .in("id", part),
      );
    }
    if (outcome.done.length) {
      const doneSet = new Set(outcome.done);
      await logAudit({
        action: "update",
        entityType: "tours_departure",
        entityId: outcome.done.length === 1 ? outcome.done[0] : null,
        changes: { is_published: published },
        metadata: {
          ...companyAudit(company),
          ids: outcome.done,
          codes: cores.filter((c) => doneSet.has(c.id)).map((c) => c.code),
          count: outcome.done.length,
          bulk: outcome.done.length > 1,
        },
      });
    }
    return ok(outcome);
  } catch (e) {
    return fail(e);
  }
}

export async function setDeparturesSaleStatus(ids: string[], status: string): Promise<ActionResult<BulkOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    const wanted = cleanIds(ids);
    if (wanted.length === 0) throw new UserError("No departures selected");
    if (!(SALE_STATUSES as readonly string[]).includes(status)) throw new UserError("Invalid sale status");
    const done: string[] = [];
    for (const part of chunk(wanted, ID_CHUNK)) {
      const rows =
        must(
          await toursDb()
            .from("departures")
            .update({ sale_status: status })
            .eq("company_id", company.id)
            .in("id", part)
            .select("id"),
        ) ?? [];
      done.push(...rows.map((r) => r.id));
    }
    if (done.length) {
      await logAudit({
        action: "update",
        entityType: "tours_departure",
        entityId: done.length === 1 ? done[0] : null,
        changes: { sale_status: status },
        metadata: { ...companyAudit(company), ids: done, count: done.length, bulk: done.length > 1 },
      });
    }
    return ok({ done, skipped: [], warnings: [] });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- prices
const MATRIX_KEYS = new Set(PRICE_MATRIX_ROWS.map((r) => `${r.paxType}:${r.position}`));

function validCells(cells: PriceCellInput[]): PriceCellInput[] {
  if (!Array.isArray(cells)) throw new UserError("No prices to save");
  const seen = new Set<string>();
  const out: PriceCellInput[] = [];
  for (const c of cells) {
    const key = `${c.paxType}:${c.position}`;
    if (!MATRIX_KEYS.has(key)) throw new UserError("Unknown price row");
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.price !== null && (!Number.isFinite(c.price) || c.price < 0 || c.price > 1_000_000)) {
      throw new UserError("A price must be a positive number");
    }
    out.push({ paxType: c.paxType, position: c.position, price: c.price });
  }
  return out;
}

/** The matrix of a departure after applying `cells` to what is stored. */
function matrixAfter(core: Core, cells: PriceCellInput[]): PriceMatrix {
  const next: Record<string, number> = {};
  for (const p of core.departure_prices) next[`${p.pax_type}:${p.room_position}`] = Number(p.price);
  for (const c of cells) {
    const key = `${c.paxType}:${c.position}`;
    if (c.price === null) delete next[key];
    else next[key] = c.price;
  }
  return next as PriceMatrix;
}

/** Write matrix cells for many departures: one upsert for the prices, one delete per emptied cell. */
async function writeCells(companyId: string, items: { departureId: string; cells: PriceCellInput[] }[]): Promise<void> {
  const upserts: { departure_id: string; company_id: string; pax_type: string; room_position: number; price: number }[] = [];
  const removals = new Map<string, string[]>();
  for (const item of items) {
    for (const c of item.cells) {
      if (c.price === null) {
        const key = `${c.paxType}:${c.position}`;
        removals.set(key, [...(removals.get(key) ?? []), item.departureId]);
      } else {
        upserts.push({
          departure_id: item.departureId,
          company_id: companyId,
          pax_type: c.paxType,
          room_position: c.position,
          price: c.price,
        });
      }
    }
  }
  for (const part of chunk(upserts, 500)) {
    must(await toursDb().from("departure_prices").upsert(part, { onConflict: "departure_id,pax_type,room_position" }));
  }
  for (const [key, departureIds] of removals) {
    const [paxType, position] = key.split(":");
    for (const part of chunk(departureIds, ID_CHUNK)) {
      must(
        await toursDb()
          .from("departure_prices")
          .delete()
          .eq("company_id", companyId)
          .eq("pax_type", paxType)
          .eq("room_position", Number(position))
          .in("departure_id", part),
      );
    }
  }
}

/** Save cells of the six-row matrix of one departure (and, optionally, its currency). */
export async function saveDeparturePrices(
  id: string,
  cells: PriceCellInput[],
  currency?: string,
): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, id);
    const clean = validCells(cells);
    if (currency !== undefined && !(CURRENCIES as readonly string[]).includes(currency)) throw new UserError("Unsupported currency");

    if (core.is_published) {
      const series = must(
        await toursDb().from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      );
      const blockers = blockersOf(core, series ?? undefined, { prices: matrixAfter(core, clean) });
      if (blockers.length) {
        throw new UserError(`The departure is published and can't stay that way: ${blockers.join(", ")}. Unpublish it first.`);
      }
    }
    await writeCells(company.id, [{ departureId: id, cells: clean }]);
    if (currency !== undefined && currency !== core.currency) {
      must(await toursDb().from("departures").update({ currency }).eq("company_id", company.id).eq("id", id));
    }
    await logAudit({
      action: "update",
      entityType: "tours_departure_prices",
      entityId: id,
      changes: { cells: clean, ...(currency !== undefined && currency !== core.currency ? { currency } : {}) },
      metadata: { ...companyAudit(company), code: core.code },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/**
 * "Paste from Excel": the full six-price row of many departures at once. An
 * empty cell removes that price. A published departure that would lose its
 * double-room price is skipped.
 */
export async function applyPastedPrices(
  items: { departureId: string; prices: (number | null)[] }[],
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    if (!Array.isArray(items) || items.length === 0) throw new UserError("No rows to apply");
    if (items.length > 5000) throw new UserError("Too many rows in one paste");
    const byId = new Map<string, PriceCellInput[]>();
    for (const item of items) {
      if (!UUID.test(item.departureId) || !Array.isArray(item.prices) || item.prices.length !== PRICE_MATRIX_ROWS.length) {
        throw new UserError("Invalid row in the paste");
      }
      byId.set(
        item.departureId,
        validCells(PRICE_MATRIX_ROWS.map((r, i) => ({ paxType: r.paxType, position: r.position, price: item.prices[i] }))),
      );
    }
    const [cores, series] = await Promise.all([loadCores(company.id, Array.from(byId.keys())), loadSeries(company.id)]);
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const outcome: BulkOutcome = { done: [], skipped: [], warnings: [] };
    const writes: { departureId: string; cells: PriceCellInput[] }[] = [];
    for (const core of cores) {
      const cells = byId.get(core.id) ?? [];
      if (core.is_deleted) {
        outcome.skipped.push({ code: core.code, reason: "The departure is deleted" });
        continue;
      }
      if (core.is_published) {
        const blockers = blockersOf(core, seriesById.get(core.series_id), { prices: matrixAfter(core, cells) });
        if (blockers.length) {
          outcome.skipped.push({ code: core.code, reason: `Published: ${blockers.join(", ")}` });
          continue;
        }
      }
      writes.push({ departureId: core.id, cells });
      outcome.done.push(core.id);
    }
    await writeCells(company.id, writes);
    if (outcome.done.length) {
      await logAudit({
        action: "update",
        entityType: "tours_departure_prices",
        entityId: null,
        metadata: { ...companyAudit(company), ids: outcome.done, count: outcome.done.length, bulk: true, source: "paste" },
      });
    }
    return ok(outcome);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Copy the price matrix and the currency of one departure onto others. With
 * `includeOptions`, the hotel and ticket rows and the markup of a vacation
 * package are copied as well (the target's own hotel and ticket rows are replaced).
 */
export async function copyDeparturePrices(
  sourceId: string,
  targetIds: string[],
  opts: { includeOptions?: boolean } = {},
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    const targets = cleanIds(targetIds).filter((id) => id !== sourceId);
    if (targets.length === 0) throw new UserError("No target departures selected");
    const source = await loadCore(company.id, sourceId);
    if (source.departure_prices.length === 0 && !opts.includeOptions) {
      throw new UserError(`Departure ${source.code} has no prices to copy`);
    }
    const db = toursDb();
    const sourceOptions = opts.includeOptions
      ? (must(
          await db
            .from("departure_options")
            .select("kind, position, ref_code, label, board, nights, stay_order, max_people, price, price_unit, room_prices")
            .eq("company_id", company.id)
            .eq("departure_id", sourceId)
            .in("kind", ["hotel", "ticket"]),
        ) ?? [])
      : [];
    const sourceMarkup = opts.includeOptions
      ? must(
          await db
            .from("departures")
            .select("markup_percent, markup_fixed")
            .eq("company_id", company.id)
            .eq("id", sourceId)
            .maybeSingle(),
        )
      : null;

    const sourceCells: PriceCellInput[] = PRICE_MATRIX_ROWS.map((r) => {
      const hit = source.departure_prices.find((p) => p.pax_type === r.paxType && p.room_position === r.position);
      return { paxType: r.paxType, position: r.position, price: hit ? Number(hit.price) : null };
    });

    const [cores, series] = await Promise.all([loadCores(company.id, targets), loadSeries(company.id)]);
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const outcome: BulkOutcome = { done: [], skipped: [], warnings: [] };
    for (const core of cores) {
      if (core.is_deleted) {
        outcome.skipped.push({ code: core.code, reason: "The departure is deleted" });
        continue;
      }
      if (core.is_published) {
        const blockers = blockersOf(core, seriesById.get(core.series_id), {
          prices: matrixAfter(core, sourceCells),
          currency: source.currency,
          ...(opts.includeOptions ? { options: sourceOptions, markup_fixed: sourceMarkup?.markup_fixed ?? null } : {}),
        });
        if (blockers.length) {
          outcome.skipped.push({ code: core.code, reason: `Published: ${blockers.join(", ")}` });
          continue;
        }
      }
      outcome.done.push(core.id);
    }

    await writeCells(
      company.id,
      outcome.done.map((departureId) => ({ departureId, cells: sourceCells })),
    );
    for (const part of chunk(outcome.done, ID_CHUNK)) {
      must(
        await db
          .from("departures")
          .update({
            currency: source.currency,
            ...(opts.includeOptions && sourceMarkup
              ? { markup_percent: sourceMarkup.markup_percent, markup_fixed: sourceMarkup.markup_fixed }
              : {}),
          })
          .eq("company_id", company.id)
          .in("id", part),
      );
      if (opts.includeOptions) {
        must(
          await db
            .from("departure_options")
            .delete()
            .eq("company_id", company.id)
            .in("departure_id", part)
            .in("kind", ["hotel", "ticket"]),
        );
        const copies = part.flatMap((departureId) =>
          sourceOptions.map((o) => ({ ...o, departure_id: departureId, company_id: company.id })),
        );
        if (copies.length) must(await db.from("departure_options").insert(copies));
      }
    }
    if (outcome.done.length) {
      await logAudit({
        action: "update",
        entityType: "tours_departure_prices",
        entityId: null,
        metadata: {
          ...companyAudit(company),
          copied_from: sourceId,
          copied_from_code: source.code,
          ids: outcome.done,
          count: outcome.done.length,
          include_options: Boolean(opts.includeOptions),
          bulk: true,
        },
      });
    }
    return ok(outcome);
  } catch (e) {
    return fail(e);
  }
}

/** Hotels, tickets and markup of a vacation departure. Rows not sent are removed. */
export async function saveVacationPricing(id: string, input: VacationPricingInput): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, id);
    const db = toursDb();
    const price = (v: unknown, label: string) => numOrNull(v, 0, 1_000_000, label);

    const hotels = (input.hotels ?? []).map((h, i) => ({
      id: h.id && UUID.test(h.id) ? h.id : undefined,
      kind: "hotel",
      position: i + 1,
      ref_code: text(h.ref_code, 120),
      label: text(h.label, 200),
      board: text(h.board, 120),
      nights: intOrNull(h.nights, 0, 60, "Nights"),
      price_unit: "per_stay",
      room_prices: {
        double: price(h.double, "Double-room price"),
        triple: price(h.triple, "Triple-room price"),
        quad: price(h.quad, "Quad-room price"),
      },
    }));
    const tickets = (input.tickets ?? []).map((t, i) => ({
      id: t.id && UUID.test(t.id) ? t.id : undefined,
      kind: "ticket",
      position: i + 1,
      label: text(t.label, 200),
      price: price(t.price, "Ticket price"),
      price_unit: "per_person",
    }));
    for (const h of hotels) if (!h.ref_code && !h.label) throw new UserError("Every hotel needs a hotel code or a name");
    for (const t of tickets) if (!t.label) throw new UserError("Every ticket needs a category name");
    const markupPercent = numOrNull(input.markup_percent, 0, 1000, "Markup percent");
    const markupFixed = numOrNull(input.markup_fixed, 0, 1_000_000, "Fixed markup");

    if (core.is_published) {
      const series = must(
        await db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      );
      const blockers = blockersOf(core, series ?? undefined, {
        options: [
          ...hotels.map((h) => ({ kind: h.kind, position: h.position, price: null, room_prices: h.room_prices })),
          ...tickets.map((t) => ({ kind: t.kind, position: t.position, price: t.price, room_prices: null })),
        ],
        markup_fixed: markupFixed,
      });
      if (blockers.length) {
        throw new UserError(`The departure is published and can't stay that way: ${blockers.join(", ")}. Unpublish it first.`);
      }
    }

    const existing =
      must(
        await db
          .from("departure_options")
          .select("id")
          .eq("company_id", company.id)
          .eq("departure_id", id)
          .in("kind", ["hotel", "ticket"]),
      ) ?? [];
    const existingIds = new Set(existing.map((o) => o.id));
    const kept = new Set<string>();

    for (const h of hotels) {
      const { id: optionId, ...row } = h;
      if (optionId && existingIds.has(optionId)) {
        kept.add(optionId);
        must(await db.from("departure_options").update(row).eq("company_id", company.id).eq("id", optionId));
      } else {
        must(await db.from("departure_options").insert({ ...row, departure_id: id, company_id: company.id }));
      }
    }
    for (const t of tickets) {
      const { id: optionId, ...row } = t;
      if (optionId && existingIds.has(optionId)) {
        kept.add(optionId);
        must(await db.from("departure_options").update(row).eq("company_id", company.id).eq("id", optionId));
      } else {
        must(await db.from("departure_options").insert({ ...row, departure_id: id, company_id: company.id }));
      }
    }
    const removed = Array.from(existingIds).filter((optionId) => !kept.has(optionId));
    if (removed.length) {
      must(await db.from("departure_options").delete().eq("company_id", company.id).in("id", removed));
    }
    must(
      await db
        .from("departures")
        .update({ markup_percent: markupPercent, markup_fixed: markupFixed })
        .eq("company_id", company.id)
        .eq("id", id),
    );
    await logAudit({
      action: "update",
      entityType: "tours_departure_options",
      entityId: id,
      changes: { hotels, tickets, markup_percent: markupPercent, markup_fixed: markupFixed },
      metadata: { ...companyAudit(company), code: core.code, removed: removed.length },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- promotions
function cleanPromotion(input: PromotionInput) {
  if (!(PROMOTION_KINDS as readonly string[]).includes(input.kind)) throw new UserError("Unknown promotion type");
  const kind = input.kind as PromotionKind;
  const label = text(input.label, 200);
  let value: number | null = null;
  if (kind === "gift") {
    if (!label) throw new UserError("A gift needs text that describes it");
    value = input.value == null ? null : numOrNull(input.value, 0, 1_000_000, "Value");
  } else {
    value = numOrNull(input.value, 0, 1_000_000, "Promotion value");
    if (value == null || value <= 0) throw new UserError("The promotion value must be a number greater than zero");
    if (kind === "percent_order" && value > 100) throw new UserError("A percent discount can't exceed 100");
    if (kind === "named_per_pax" && !label) throw new UserError("A named discount needs a name");
  }
  let validUntil: string | null = null;
  if (input.valid_until) {
    if (!isDateOnly(input.valid_until)) throw new UserError("Invalid expiry date");
    validUntil = input.valid_until;
  }
  return {
    kind,
    value,
    label,
    valid_until: validUntil,
    show_on_card: Boolean(input.show_on_card),
    is_active: Boolean(input.is_active),
  };
}

/** Active promotions that apply to a departure: its own and its series'. */
async function activePromotionsOf(companyId: string, departureId: string, seriesId: string) {
  return (
    must(
      await toursDb()
        .from("promotions")
        .select("id, kind, departure_id, series_id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .or(`departure_id.eq.${departureId},series_id.eq.${seriesId}`),
    ) ?? []
  );
}

/** Create (promotionId = null) or edit a promotion of one departure. */
export async function savePromotion(
  departureId: string,
  promotionId: string | null,
  input: PromotionInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, departureId);
    const row = cleanPromotion(input);
    if (row.is_active) {
      const others = (await activePromotionsOf(company.id, departureId, core.series_id)).filter((p) => p.id !== promotionId);
      const conflict = promotionConflict(row.kind, others);
      if (conflict) throw new UserError(conflict);
    }
    const db = toursDb();
    let id = promotionId;
    if (promotionId) {
      if (!UUID.test(promotionId)) throw new UserError("Promotion not found");
      const updated = must(
        await db
          .from("promotions")
          .update(row)
          .eq("company_id", company.id)
          .eq("id", promotionId)
          .eq("departure_id", departureId)
          .select("id"),
      );
      if (!updated || updated.length === 0) throw new UserError("Promotion not found on this departure");
    } else {
      const inserted = mustRow(
        await db
          .from("promotions")
          .insert({ ...row, departure_id: departureId, company_id: company.id })
          .select("id")
          .single(),
      );
      id = inserted.id;
    }
    await logAudit({
      action: promotionId ? "update" : "create",
      entityType: "tours_promotion",
      entityId: id,
      changes: row,
      metadata: { ...companyAudit(company), departure_id: departureId, code: core.code },
    });
    return ok({ id: id as string });
  } catch (e) {
    return fail(e);
  }
}

export async function setPromotionActive(promotionId: string, active: boolean): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(promotionId)) throw new UserError("Promotion not found");
    const db = toursDb();
    const promo = must(
      await db
        .from("promotions")
        .select("id, kind, departure_id, series_id")
        .eq("company_id", company.id)
        .eq("id", promotionId)
        .maybeSingle(),
    );
    if (!promo || !promo.departure_id) throw new UserError("Promotion not found");
    if (active) {
      const core = await loadCore(company.id, promo.departure_id);
      const others = (await activePromotionsOf(company.id, promo.departure_id, core.series_id)).filter(
        (p) => p.id !== promotionId,
      );
      const conflict = promotionConflict(promo.kind as PromotionKind, others);
      if (conflict) throw new UserError(conflict);
    }
    must(await db.from("promotions").update({ is_active: active }).eq("company_id", company.id).eq("id", promotionId));
    await logAudit({
      action: "update",
      entityType: "tours_promotion",
      entityId: promotionId,
      changes: { is_active: active },
      metadata: { ...companyAudit(company), departure_id: promo.departure_id },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

export async function deletePromotion(promotionId: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(promotionId)) throw new UserError("Promotion not found");
    const removed = must(
      await toursDb()
        .from("promotions")
        .delete()
        .eq("company_id", company.id)
        .eq("id", promotionId)
        .not("departure_id", "is", null)
        .select("id, departure_id, kind, value, label, valid_until"),
    );
    if (!removed || removed.length === 0) throw new UserError("Promotion not found");
    await logAudit({
      action: "delete",
      entityType: "tours_promotion",
      entityId: promotionId,
      changes: removed[0],
      metadata: { ...companyAudit(company), departure_id: removed[0].departure_id },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/**
 * Add one promotion to every selected departure. With `replaceSameKind`, an
 * active promotion of the same kind on a departure is switched off first;
 * without it, such a departure is skipped. The percent / fixed-per-passenger
 * rule always holds: a departure with the rival kind active is skipped.
 */
export async function addPromotionToDepartures(
  ids: string[],
  input: PromotionInput,
  replaceSameKind: boolean,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { company } = await requireCompany("tours");
    const wanted = cleanIds(ids);
    if (wanted.length === 0) throw new UserError("No departures selected");
    const row = cleanPromotion(input);
    const db = toursDb();
    const cores = await loadCores(company.id, wanted);

    const active: { id: string; kind: string; departure_id: string | null; series_id: string | null }[] = [];
    if (row.is_active) {
      for (const part of chunk(cores.map((c) => c.id), ID_CHUNK)) {
        active.push(
          ...(must(
            await db
              .from("promotions")
              .select("id, kind, departure_id, series_id")
              .eq("company_id", company.id)
              .eq("is_active", true)
              .in("departure_id", part),
          ) ?? []),
        );
      }
      active.push(
        ...(await fetchAll<{ id: string; kind: string; departure_id: string | null; series_id: string | null }>((from, to) =>
          db
            .from("promotions")
            .select("id, kind, departure_id, series_id")
            .eq("company_id", company.id)
            .eq("is_active", true)
            .not("series_id", "is", null)
            .order("id")
            .range(from, to),
        )),
      );
    }

    const outcome: BulkOutcome = { done: [], skipped: [], warnings: [] };
    const toDeactivate: string[] = [];
    for (const core of cores) {
      if (core.is_deleted) {
        outcome.skipped.push({ code: core.code, reason: "The departure is deleted" });
        continue;
      }
      const applying = active.filter((p) => p.departure_id === core.id || p.series_id === core.series_id);
      const sameKindOwn = applying.filter((p) => p.kind === row.kind && p.departure_id === core.id);
      const rest = replaceSameKind ? applying.filter((p) => !sameKindOwn.includes(p)) : applying;
      const conflict = row.is_active ? promotionConflict(row.kind, rest) : null;
      if (conflict) {
        outcome.skipped.push({ code: core.code, reason: conflict });
        continue;
      }
      if (replaceSameKind) toDeactivate.push(...sameKindOwn.map((p) => p.id));
      outcome.done.push(core.id);
    }

    for (const part of chunk(toDeactivate, ID_CHUNK)) {
      must(await db.from("promotions").update({ is_active: false }).eq("company_id", company.id).in("id", part));
    }
    for (const part of chunk(outcome.done, 500)) {
      must(await db.from("promotions").insert(part.map((departureId) => ({ ...row, departure_id: departureId, company_id: company.id }))));
    }
    if (outcome.done.length) {
      await logAudit({
        action: "create",
        entityType: "tours_promotion",
        entityId: null,
        changes: row,
        metadata: {
          ...companyAudit(company),
          departure_ids: outcome.done,
          count: outcome.done.length,
          deactivated: toDeactivate,
          bulk: true,
        },
      });
    }
    return ok(outcome);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- flight allocations
/** A block is offered for a departure when a leg flies within this many days of the trip's dates. */
const ALLOCATION_DAY_WINDOW = 2;

/** Blocks of the company that fly within two days of the departure's dates, with their free seats. */
export async function listCandidateBlocks(departureId: string): Promise<ActionResult<CandidateBlock[]>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, departureId);
    const outFrom = `${addDays(core.start_date, -ALLOCATION_DAY_WINDOW)}T00:00:00`;
    const outTo = `${addDays(core.start_date, ALLOCATION_DAY_WINDOW)}T23:59:59`;
    const inFrom = `${addDays(core.end_date, -ALLOCATION_DAY_WINDOW)}T00:00:00`;
    const inTo = `${addDays(core.end_date, ALLOCATION_DAY_WINDOW)}T23:59:59`;
    const blocks =
      must(
        await supabaseTyped
          .from("flights")
          .select(FLIGHT_SELECT)
          .eq("company_id", company.id)
          .not("is_deleted", "is", true)
          .or(
            `and(outbound_departure_time.gte.${outFrom},outbound_departure_time.lte.${outTo}),and(inbound_departure_time.gte.${inFrom},inbound_departure_time.lte.${inTo})`,
          )
          .order("outbound_departure_time")
          .limit(200),
      ) ?? [];
    // A cancelled or declined block holds no seats to give.
    const open = blocks.filter((b) => b.block_status !== "cancelled" && b.block_status !== "declined");
    const ids = open.map((b) => b.id);
    const [sums, own] = await Promise.all([
      allocationSums(company.id, ids),
      toursDb().from("flight_allocations").select("flight_id").eq("company_id", company.id).eq("departure_id", departureId),
    ]);
    const mine = new Set((must(own) ?? []).map((a) => a.flight_id));
    return ok(
      open.map((b) => ({
        ...b,
        allocatedOutbound: sums.get(b.id)?.outbound ?? 0,
        allocatedInbound: sums.get(b.id)?.inbound ?? 0,
        alreadyAllocated: mine.has(b.id),
      })),
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * The company's open flight blocks that fly from two days ago on, with their
 * free seats - what Create Tour matches to the new dates before they exist.
 * The match is only a proposal: addFlightAllocation checks route, dates and
 * seats again when it links a block.
 */
export async function listUpcomingBlocks(): Promise<ActionResult<CardFlight[]>> {
  try {
    const { company } = await requireCompany("tours");
    const from = `${addDays(todayIso(), -ALLOCATION_DAY_WINDOW)}T00:00:00`;
    const blocks = await fetchAll<Omit<CardFlight, "allocatedOutbound" | "allocatedInbound">>((start, end) =>
      supabaseTyped
        .from("flights")
        .select(FLIGHT_SELECT)
        .eq("company_id", company.id)
        .not("is_deleted", "is", true)
        .gte("outbound_departure_time", from)
        .order("outbound_departure_time")
        .order("id")
        .range(start, end),
    );
    const open = blocks.filter((b) => b.block_status !== "cancelled" && b.block_status !== "declined");
    const sums = await allocationSums(
      company.id,
      open.map((b) => b.id),
    );
    return ok(
      open.map((b) => ({
        ...b,
        allocatedOutbound: sums.get(b.id)?.outbound ?? 0,
        allocatedInbound: sums.get(b.id)?.inbound ?? 0,
      })),
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Give seats of a flight block to a departure. Checked here, not only in the
 * dialog: the block is the company's, both ends land in the departure's cities
 * (functional spec rule 7), the dates are within two days, and the block is not
 * handed out beyond its seats in either direction (rule 8).
 */
export async function addFlightAllocation(
  departureId: string,
  flightId: number,
  seats: number,
  legs: AllocationLegs,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, departureId);
    if (core.is_deleted) throw new UserError("The departure is deleted");
    if (!ALLOCATION_LEGS.includes(legs)) throw new UserError("Invalid direction");
    if (!Number.isInteger(seats) || seats < 1 || seats > 1000) throw new UserError("The number of seats must be a whole number greater than zero");
    if (!Number.isInteger(flightId)) throw new UserError("Block not found");

    const db = toursDb();
    const [flights, seriesRow, sums, existing] = await Promise.all([
      loadFlights(company.id, [flightId]),
      db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      allocationSums(company.id, [flightId]),
      db
        .from("flight_allocations")
        .select("id, legs")
        .eq("company_id", company.id)
        .eq("departure_id", departureId)
        .eq("flight_id", flightId),
    ]);
    const block = flights.get(flightId);
    if (!block || block.is_deleted) throw new UserError("Block not found in the active company");
    if (block.block_status === "cancelled" || block.block_status === "declined") {
      throw new UserError(`Can't allocate a block with status "${BLOCK_STATUS_LABELS[block.block_status as BlockStatus]}"`);
    }

    const takesOut = legs !== "inbound";
    const takesIn = legs !== "outbound";
    for (const a of must(existing) ?? []) {
      const clash = (a.legs !== "inbound" && takesOut) || (a.legs !== "outbound" && takesIn);
      if (clash) throw new UserError("The block is already allocated to this departure in the same direction. Remove the existing allocation to change it.");
    }

    const route = effectiveRoute(core, must(seriesRow));
    const fit = checkBlockFitsDeparture(block, route, legs);
    if (!fit.ok) throw new UserError(`The block doesn't match the departure's route: ${fit.reason}`);

    const warnings: string[] = [];
    if (takesOut) {
      const diff = Math.min(
        Math.abs(daysBetween(block.outbound_departure_time.slice(0, 10), core.start_date)),
        Math.abs(daysBetween(block.outbound_arrival_time.slice(0, 10), core.start_date)),
      );
      if (diff > ALLOCATION_DAY_WINDOW) {
        throw new UserError(`The outbound flight is on ${fmtDate(block.outbound_departure_time)} and the departure starts on ${fmtDate(core.start_date)} - more than two days apart`);
      }
      if (diff > 0) warnings.push(`The outbound flight is on ${fmtDate(block.outbound_departure_time)}, the departure starts on ${fmtDate(core.start_date)}`);
    }
    if (takesIn) {
      const diff = Math.abs(daysBetween(block.inbound_departure_time.slice(0, 10), core.end_date));
      if (diff > ALLOCATION_DAY_WINDOW) {
        throw new UserError(`The return flight is on ${fmtDate(block.inbound_departure_time)} and the departure ends on ${fmtDate(core.end_date)} - more than two days apart`);
      }
      if (diff > 0) warnings.push(`The return flight is on ${fmtDate(block.inbound_departure_time)}, the departure ends on ${fmtDate(core.end_date)}`);
    }

    const used = sums.get(flightId) ?? { outbound: 0, inbound: 0 };
    const freeOut = block.initial_quantity - used.outbound;
    const freeIn = block.initial_quantity - used.inbound;
    if (takesOut && seats > freeOut) {
      throw new UserError(`The block has ${block.initial_quantity} seats and ${used.outbound} are already allocated outbound - ${Math.max(freeOut, 0)} left`);
    }
    if (takesIn && seats > freeIn) {
      throw new UserError(`The block has ${block.initial_quantity} seats and ${used.inbound} are already allocated on the return - ${Math.max(freeIn, 0)} left`);
    }

    const { data: inserted, error } = await db
      .from("flight_allocations")
      .insert({ company_id: company.id, flight_id: flightId, departure_id: departureId, seats, legs })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new UserError("The block is already allocated to this departure in the same direction");
      throw new Error(error.message);
    }
    await logAudit({
      action: "create",
      entityType: "tours_flight_allocation",
      entityId: inserted.id,
      changes: { flight_id: flightId, departure_id: departureId, seats, legs },
      metadata: { ...companyAudit(company), code: core.code },
    });
    return ok({ id: inserted.id }, warnings.length ? warnings.join(". ") : undefined);
  } catch (e) {
    return fail(e);
  }
}

export async function removeFlightAllocation(allocationId: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(allocationId)) throw new UserError("Allocation not found");
    const removed = must(
      await toursDb()
        .from("flight_allocations")
        .delete()
        .eq("company_id", company.id)
        .eq("id", allocationId)
        .select("id, flight_id, departure_id, seats, legs"),
    );
    if (!removed || removed.length === 0) throw new UserError("Allocation not found");
    await logAudit({
      action: "delete",
      entityType: "tours_flight_allocation",
      entityId: allocationId,
      changes: removed[0],
      metadata: companyAudit(company),
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/**
 * A date opened by hand on a day a flight block already flies gets that block
 * without a visit to its card (Alon, 07.10.2026). Only a sure match is taken:
 * the one open block that leaves on the date's first day, lands and returns in
 * the date's cities and still has seats both ways. No match, or more than one,
 * links nothing and says how many there are - the card's Flights tab decides.
 */
export async function linkMatchingFlight(
  departureId: string,
): Promise<ActionResult<{ linked: { flightId: number; seats: number } | null; matches: number }>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, departureId);
    if (core.is_deleted) throw new UserError("The departure is deleted");
    const db = toursDb();
    const [seriesRow, own, candidates, extraRow] = await Promise.all([
      db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      db.from("flight_allocations").select("id").eq("company_id", company.id).eq("departure_id", departureId).limit(1),
      listCandidateBlocks(departureId),
      db.from("departures").select("capacity, origin_flight_id").eq("company_id", company.id).eq("id", departureId).maybeSingle(),
    ]);
    const extra = must(extraRow);
    if ((must(own) ?? []).length) return ok({ linked: null, matches: 0 });
    // a vacation package chooses its flights per package - only an organized tour's date takes a block by itself
    const tour = must(await db.from("packages").select("kind").eq("company_id", company.id).eq("id", core.package_id).maybeSingle());
    if (tour?.kind !== "organized") return ok({ linked: null, matches: 0 });
    if (!candidates.success) return candidates;
    const route = effectiveRoute(core, must(seriesRow));
    const free = (b: CandidateBlock) => Math.min(b.initial_quantity - b.allocatedOutbound, b.initial_quantity - b.allocatedInbound);
    const matches = candidates.data.filter(
      (b) => b.outbound_departure_time.slice(0, 10) === core.start_date && checkBlockFitsDeparture(b, route, "both").ok && free(b) >= 1,
    );
    if (matches.length !== 1) return ok({ linked: null, matches: matches.length });

    const block = matches[0];
    const capacity = extra?.capacity ?? 0;
    const seats = Math.max(1, Math.min(free(block), capacity > 0 ? capacity : free(block)));
    const link = await addFlightAllocation(departureId, block.id, seats, "both");
    if (!link.success) return link;
    // Same days out and back: the date now follows its flight when the airline moves it, like a sub-tour a
    // series opened. A date that ends on another day keeps its own dates.
    if (extra?.origin_flight_id == null && block.inbound_departure_time.slice(0, 10) === core.end_date) {
      must(await db.from("departures").update({ origin_flight_id: block.id }).eq("company_id", company.id).eq("id", departureId));
    }
    return ok({ linked: { flightId: block.id, seats }, matches: 1 }, link.warning);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- create / delete
/**
 * A new draft departure of a series. The code is the series code + month + day
 * (rule 1) and is unique within its season year; route, currency and capacity
 * start from the series.
 */
export async function createDeparture(input: {
  seriesId: string;
  start_date: string;
  end_date: string;
  season?: string | null;
}): Promise<ActionResult<{ id: string; code: string }>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(input.seriesId ?? "")) throw new UserError("Select a series");
    if (!isDateOnly(input.start_date) || !isDateOnly(input.end_date)) throw new UserError("Select a departure date and a return date");
    if (input.end_date < input.start_date) throw new UserError("The return date is before the departure date");
    if ((nightsBetween(input.start_date, input.end_date) ?? 0) > 60) throw new UserError("A trip of more than 60 nights - check the dates");

    const db = toursDb();
    const series = must(
      await db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", input.seriesId).maybeSingle(),
    );
    if (!series) throw new UserError("Series not found in the active company");
    if (!series.package_id) throw new UserError(`Series ${series.code} has no tour page. Link it to a tour page on the Series screen, then create the departure.`);

    const code = departureCode(series.code, input.start_date);
    const seasonYear = seasonYearOf(input.start_date);
    const clash = must(
      await db
        .from("departures")
        .select("id, is_deleted")
        .eq("company_id", company.id)
        .eq("code", code)
        .eq("season_year", seasonYear)
        .maybeSingle(),
    );
    if (clash) {
      throw new UserError(
        clash.is_deleted
          ? `A deleted departure with code ${code} exists in ${seasonYear}. Restore it from the board (the "Deleted" filter) instead of creating a new one.`
          : `A departure with code ${code} already exists in ${seasonYear}`,
      );
    }

    const { data: inserted, error } = await db
      .from("departures")
      .insert({
        company_id: company.id,
        package_id: series.package_id,
        series_id: series.id,
        code,
        season_year: seasonYear,
        start_date: input.start_date,
        end_date: input.end_date,
        season: text(input.season, 60),
        currency: series.default_currency,
        arrival_airport: series.arrival_airport,
        return_airport: series.return_airport,
        capacity: series.default_capacity,
        is_published: false,
        sale_status: "open",
      })
      .select("id, code")
      .single();
    if (error) {
      if (error.code === "23505") throw new UserError(`A departure with code ${code} already exists in ${seasonYear}`);
      throw new Error(error.message);
    }
    await logAudit({
      action: "create",
      entityType: "tours_departure",
      entityId: inserted.id,
      changes: { code, series_id: series.id, start_date: input.start_date, end_date: input.end_date },
      metadata: companyAudit(company),
    });
    return ok(inserted);
  } catch (e) {
    return fail(e);
  }
}

/** Soft delete: stamps today's date and takes the departure off the site. Never a hard delete. */
export async function softDeleteDeparture(id: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, id);
    if (core.is_deleted) return ok(undefined);
    const patch = { is_deleted: todayIso(), is_published: false };
    must(await toursDb().from("departures").update(patch).eq("company_id", company.id).eq("id", id));
    await logAudit({
      action: "delete",
      entityType: "tours_departure",
      entityId: id,
      changes: patch,
      metadata: { ...companyAudit(company), code: core.code, was_published: core.is_published },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

/** Bring a soft-deleted departure back as an unpublished draft. */
export async function restoreDeparture(id: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    const core = await loadCore(company.id, id);
    if (!core.is_deleted) return ok(undefined);
    must(await toursDb().from("departures").update({ is_deleted: null }).eq("company_id", company.id).eq("id", id));
    await logAudit({
      action: "update",
      entityType: "tours_departure",
      entityId: id,
      changes: { is_deleted: null },
      metadata: { ...companyAudit(company), code: core.code, restored: true },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- export
/** The current view of the board as an .xlsx file (base64), rows in the order given. */
export async function exportDeparturesXlsx(ids: string[]): Promise<ActionResult<{ filename: string; base64: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const wanted = cleanIds(ids);
    if (wanted.length === 0) throw new UserError("No departures to export in the current view");
    const [rows, series, packages] = await Promise.all([
      loadBoardRows(company.id, { ids: wanted, includeDeleted: true }),
      loadSeries(company.id),
      fetchAll<BoardPackage>((from, to) =>
        toursDb().from("packages").select("id, name, kind, slug").eq("company_id", company.id).order("name").range(from, to),
      ),
    ]);
    const seriesById = new Map(series.map((s) => [s.id, s]));
    const packageById = new Map(packages.map((p) => [p.id, p]));
    const order = new Map(wanted.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Departures", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "Series", key: "series", width: 9 },
      { header: "Tour page", key: "package", width: 30 },
      { header: "Code", key: "code", width: 12 },
      { header: "Year", key: "year", width: 7 },
      { header: "Departure date", key: "start", width: 12 },
      { header: "Return date", key: "end", width: 12 },
      { header: "Nights", key: "nights", width: 7 },
      { header: "Lands in", key: "arrival", width: 8 },
      { header: "Returns from", key: "ret", width: 8 },
      { header: "Route type", key: "routeType", width: 18 },
      { header: "Season", key: "season", width: 12 },
      { header: "Published", key: "published", width: 9 },
      { header: "Sale status", key: "status", width: 16 },
      { header: "Date labels", key: "labels", width: 24 },
      { header: "Currency", key: "currency", width: 7 },
      ...PRICE_MATRIX_ROWS.map((r) => ({ header: r.label, key: r.sheetKey, width: 16 })),
      { header: "Fixed discount per traveler", key: "fixedDiscount", width: 14 },
      { header: "Double-room price after discount", key: "doubleAfter", width: 16 },
      { header: "Active promotions", key: "promotions", width: 34 },
      { header: "Airline", key: "airline", width: 11 },
      { header: "Flight status", key: "flightStatus", width: 20 },
      { header: "Allocated", key: "allocated", width: 13 },
      { header: "Sold", key: "sold", width: 8 },
      { header: "Left", key: "remaining", width: 8 },
      { header: "Docket", key: "docket", width: 14 },
    ];
    for (const r of rows) {
      const s = seriesById.get(r.series_id);
      const route = effectiveRoute(r, s);
      const type = routeType(route.arrival_airport, route.return_airport);
      const discount = activeFixedDiscount(r.promotions);
      const double = doublePricePerPerson(r).price;
      const liveFlights = r.flights.filter((f) => f.isLive);
      const shownFlights = liveFlights.length ? liveFlights : r.flights;
      const line: Record<string, string | number | null> = {
        series: s?.code ?? "",
        package: packageById.get(r.package_id)?.name ?? "",
        code: r.code,
        year: r.season_year,
        start: fmtDate(r.start_date),
        end: fmtDate(r.end_date),
        nights: nightsBetween(r.start_date, r.end_date),
        arrival: route.arrival_airport ?? "",
        ret: route.return_airport ?? "",
        routeType: type ? ROUTE_TYPE_LABELS[type] : departureRouteLabel(route.arrival_airport, route.return_airport),
        season: r.season ?? "",
        published: r.is_published ? "Yes" : "No",
        status: SALE_STATUS_LABELS[r.sale_status as SaleStatus] ?? r.sale_status,
        labels: r.date_labels.join(", "),
        currency: r.currency,
        fixedDiscount: discount || null,
        doubleAfter: double != null && discount > 0 ? double - discount : null,
        promotions: r.promotions.map((p) => promotionSummary(p, r.currency)).join(" | "),
        airline: Array.from(new Set(shownFlights.map((f) => f.airline))).join(", "),
        flightStatus: liveFlights.length
          ? Array.from(new Set(liveFlights.map((f) => BLOCK_STATUS_LABELS[f.blockStatus as BlockStatus] ?? f.blockStatus ?? ""))).join(", ")
          : "No flight",
        allocated: r.stats.allocated,
        sold: r.stats.sold,
        remaining: r.stats.remaining,
        docket: r.docket_no ?? "",
      };
      for (const m of PRICE_MATRIX_ROWS) line[m.sheetKey] = r.prices[`${m.paxType}:${m.position}`] ?? null;
      sheet.addRow(line);
    }
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    await logAudit({
      action: "export",
      entityType: "tours_departure",
      entityId: null,
      metadata: { ...companyAudit(company), count: rows.length },
    });
    return ok({
      filename: `departures-${company.slug}-${todayIso()}.xlsx`,
      base64: Buffer.from(buffer).toString("base64"),
    });
  } catch (e) {
    return fail(e);
  }
}
