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
import { COMPANY_UNASSIGNED_NOTICE } from "@/lib/auth/tours-agent";
import { requireCompany, requireCompanyViewer } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { TOURS_PAGE_SIZE, toursDb } from "@/lib/tours/db";
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
import {
  NO_LIVE_FLIGHT_WARNING,
  activeFixedDiscount,
  addDays,
  dayDiff,
  departureCode,
  doublePricePerPerson,
  effectiveRoute,
  fmtDate,
  isIsoDate,
  nightsBetween,
  normalizeAirport,
  promotionConflict,
  promotionSummary,
  publishBlockers,
  readRoomPrices,
  seasonYearOf,
  todayIso,
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
  CardSalesEntry,
  DepartureCardData,
  DepartureGeneralInput,
  DepartureViewData,
  PriceCellInput,
  PromotionInput,
  VacationPricingInput,
  ViewFlight,
  ViewHotelOption,
  ViewTicketOption,
} from "@/components/tours/departures/types";

// ---------------------------------------------------------------- plumbing
/** A failure the operator can act on; its message is shown as is. */
class UserError extends Error {}

function fail(e: unknown): { success: false; error: string } {
  if (e instanceof UserError) return { success: false, error: e.message };
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith("Forbidden")) {
    return { success: false, error: "המסך הזה זמין רק כשהחברה הפעילה מוכרת טיולים. החליפו חברה בסרגל העליון." };
  }
  if (message.startsWith("Unauthorized")) return { success: false, error: "אין הרשאה לפעולה הזו." };
  if (message.startsWith("Unassigned")) {
    return { success: false, error: `${COMPANY_UNASSIGNED_NOTICE}. מנהל החברה צריך לשייך את החשבון לחברה.` };
  }
  console.error("tours-departure-actions:", e);
  return { success: false, error: `הפעולה נכשלה: ${message}` };
}

const ok = <T>(data: T, warning?: string): ActionResult<T> =>
  warning ? { success: true, data, warning } : { success: true, data };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** PostgREST answers at most 1000 rows - walk the pages until a short one. */
async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += TOURS_PAGE_SIZE) {
    const { data, error } = await page(from, from + TOURS_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < TOURS_PAGE_SIZE) return out;
  }
}

const must = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

/** A single row that must exist (insert ... select().single()). */
const mustRow = <T>(result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error("no row returned");
  return result.data;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  "id, code, series_id, package_id, season_year, start_date, end_date, season, currency, is_published, sale_status, card_badge, date_labels, arrival_airport, return_airport, docket_no, flight_mode, flight_price, markup_fixed, is_deleted, departure_prices(pax_type, room_position, price), departure_options(kind, position, price, room_prices), promotions(id, kind, value, label, valid_until, show_on_card, is_active), flight_allocations(id, flight_id, seats, legs)";

const CARD_SELECT =
  "id, company_id, package_id, series_id, code, season_year, start_date, end_date, season, currency, is_published, sale_status, card_badge, date_labels, arrival_airport, return_airport, itinerary_id, capacity, docket_no, meeting_at, flight_mode, flight_price, baggage_included, meal_included, transfers_included, connection_out, connection_back, child_max_age, senior_min_age, senior_discount, markup_percent, markup_fixed, price_source, costing_id, legacy_product_id, site_id, notes, is_deleted, created_at, updated_at";

/** What the publish rules and the price writers need to know about a departure. */
const CORE_SELECT =
  "id, code, series_id, package_id, season_year, start_date, end_date, currency, is_published, sale_status, arrival_airport, return_airport, flight_mode, flight_price, markup_fixed, is_deleted, departure_prices(pax_type, room_position, price), departure_options(kind, position, price, room_prices)";

const FLIGHT_SELECT =
  "id, airline_code, inbound_airline_code, block_status, is_deleted, outbound_departure_airport, outbound_arrival_airport, inbound_departure_airport, inbound_arrival_airport, outbound_flight_number, inbound_flight_number, outbound_departure_time, outbound_arrival_time, inbound_departure_time, initial_quantity, season_label, pnr";

const isLiveBlock = (f: { block_status: string | null; is_deleted: boolean | null }): boolean =>
  f.is_deleted !== true && LIVE_BLOCK_STATUSES.includes(f.block_status as BlockStatus);

const EMPTY_STATS: BoardStats = { allocated: 0, liveBlocks: 0, totalBlocks: 0, sold: 0, remaining: 0 };

// ---------------------------------------------------------------- loaders
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
  filter: { years?: number[]; ids?: string[]; includeDeleted?: boolean; onSaleOnly?: boolean },
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
    loadStats(companyId, filter.ids),
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
  if (!UUID.test(id)) throw new UserError("יציאה לא נמצאה");
  const [core] = await loadCores(companyId, [id]);
  if (!core) throw new UserError("היציאה לא נמצאה בחברה הפעילה");
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
    currency: r.currency,
    is_published: r.is_published,
    sale_status: r.sale_status,
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
    fetchAll<BoardPeriod>((from, to) =>
      supabaseTyped
        .from("calendar_periods")
        .select("id, name, kind, year, holiday_date, start_date, end_date")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("year")
        .order("id")
        .range(from, to),
    ),
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
    if (!found) throw new UserError("היציאה לא נמצאה, או שהיא לא במכירה כרגע");
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
          name: catalog?.name ?? o.label ?? o.ref_code ?? "מלון",
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
      // The company's own periods and the global ones (company_id is null).
      fetchAll<BoardPeriod>((from, to) =>
        supabaseTyped
          .from("calendar_periods")
          .select("id, name, kind, year, holiday_date, start_date, end_date")
          .or(`company_id.eq.${company.id},company_id.is.null`)
          .order("year")
          .order("id")
          .range(from, to),
      ),
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
    if (!departure) throw new UserError("היציאה לא נמצאה בחברה הפעילה");
    const dep = departure;

    const [series, pkg, itineraries, prices, options, promotions, allocations, sales, stats] = await Promise.all([
      db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", dep.series_id).maybeSingle(),
      db.from("packages").select("id, name, kind, slug").eq("company_id", company.id).eq("id", dep.package_id).maybeSingle(),
      db
        .from("package_itineraries")
        .select("id, key, label, arrival_city, return_city")
        .eq("company_id", company.id)
        .eq("package_id", dep.package_id)
        .order("key"),
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
      db
        .from("departure_sales_entries")
        .select("id, pax, docket_no, note, flight_id, entered_by, created_at")
        .eq("company_id", company.id)
        .eq("departure_id", dep.id)
        .order("created_at", { ascending: false }),
      loadStats(company.id, [dep.id]),
    ]);

    const pkgRow = must(pkg);
    const allocationRows = must(allocations) ?? [];
    const flightIds = allocationRows.map((a) => a.flight_id);
    const salesRows = must(sales) ?? [];
    const authorIds = Array.from(new Set(salesRows.map((s) => s.entered_by).filter((v): v is string => Boolean(v))));

    const [flights, sums, authors, hotels] = await Promise.all([
      loadFlights(company.id, flightIds),
      allocationSums(company.id, flightIds),
      authorIds.length
        ? supabaseTyped.from("user_profiles").select("id, display_name, email").in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
      pkgRow?.kind === "vacation"
        ? db.from("hotels").select("code, name, city").eq("company_id", company.id).order("name")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const authorName = new Map((must(authors) ?? []).map((u) => [u.id, u.display_name || u.email]));

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

    const cardSales: CardSalesEntry[] = salesRows.map((s) => ({
      ...s,
      entered_by_name: s.entered_by ? (authorName.get(s.entered_by) ?? null) : null,
    }));

    return ok({
      departure: dep,
      series: must(series),
      package: pkgRow,
      itineraries: must(itineraries) ?? [],
      hotels: must(hotels) ?? [],
      prices: must(prices) ?? [],
      options: must(options) ?? [],
      promotions: must(promotions) ?? [],
      allocations: cardAllocations,
      sales: cardSales,
      stats: stats.get(dep.id) ?? EMPTY_STATS,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- general fields
const intOrNull = (value: unknown, min: number, max: number, label: string): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label}: ערך לא תקין`);
  return n;
};

const numOrNull = (value: unknown, min: number, max: number, label: string): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`${label}: ערך לא תקין`);
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
      if (!isIsoDate(start) || !isIsoDate(end)) throw new UserError("תאריך לא תקין");
      if (end < start) throw new UserError("תאריך החזרה מוקדם מתאריך היציאה");
      patch.start_date = start;
      patch.end_date = end;
      if (seasonYearOf(start) !== core.season_year) patch.season_year = seasonYearOf(start);
    }
    if (has("season")) patch.season = text(input.season, 60);
    if (has("currency")) {
      if (!(CURRENCIES as readonly string[]).includes(input.currency ?? "")) throw new UserError("מטבע לא נתמך");
      patch.currency = input.currency;
    }
    if (has("sale_status")) {
      if (!(SALE_STATUSES as readonly string[]).includes(input.sale_status ?? "")) throw new UserError("סטטוס מכירה לא תקין");
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
      if (code === undefined) throw new UserError("קוד שדה תעופה הוא שלוש אותיות באנגלית (למשל LHR)");
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
        if (!found) throw new UserError("גרסת המסלול לא שייכת לעמוד של היציאה");
      }
      patch.itinerary_id = itineraryId;
    }
    if (has("capacity")) patch.capacity = intOrNull(input.capacity, 0, 2000, "קיבולת");
    if (has("docket_no")) patch.docket_no = text(input.docket_no, 60);
    if (has("meeting_at")) {
      const at = input.meeting_at ? new Date(input.meeting_at) : null;
      if (at && Number.isNaN(at.getTime())) throw new UserError("מועד מפגש לא תקין");
      patch.meeting_at = at ? at.toISOString() : null;
    }
    if (has("flight_mode")) {
      if (!(FLIGHT_MODES as readonly string[]).includes(input.flight_mode ?? "")) throw new UserError("סוג טיסה לא תקין");
      patch.flight_mode = input.flight_mode;
    }
    if (has("flight_price")) patch.flight_price = numOrNull(input.flight_price, 0, 1_000_000, "מחיר טיסה") ?? 0;
    for (const key of ["baggage_included", "meal_included", "transfers_included"] as const) {
      if (has(key)) patch[key] = Boolean(input[key]);
    }
    if (has("connection_out")) patch.connection_out = text(input.connection_out, 300);
    if (has("connection_back")) patch.connection_back = text(input.connection_back, 300);
    if (has("child_max_age")) patch.child_max_age = intOrNull(input.child_max_age, 0, 25, "גיל ילד מרבי");
    if (has("senior_min_age")) patch.senior_min_age = intOrNull(input.senior_min_age, 40, 120, "גיל ותיק מזערי");
    if (has("senior_discount")) patch.senior_discount = numOrNull(input.senior_discount, 0, 100_000, "הנחת ותיק");
    if (has("notes")) patch.notes = text(input.notes, 4000);

    if (Object.keys(patch).length === 0) return ok(undefined);

    if (core.is_published) {
      const series = must(
        await toursDb().from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      );
      const blockers = blockersOf(core, series ?? undefined, patch);
      if (blockers.length) {
        throw new UserError(`היציאה מפורסמת, והשינוי משאיר אותה בלי נתון חובה: ${blockers.join(", ")}. הסירו אותה מהפרסום קודם.`);
      }
    }

    const { error } = await toursDb().from("departures").update(patch).eq("company_id", company.id).eq("id", id);
    if (error) {
      if (error.code === "23505") throw new UserError(`כבר קיימת יציאה עם הקוד ${core.code} בשנת ${String(patch.season_year)}`);
      throw new Error(error.message);
    }
    await logAudit({
      action: "update",
      entityType: "tours_departure",
      entityId: id,
      changes: patch,
      metadata: { company_id: company.id, code: core.code },
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
    if (wanted.length === 0) throw new UserError("לא נבחרו יציאות");
    const cores = await loadCores(company.id, wanted);
    const outcome: BulkOutcome = { done: [], skipped: [], warnings: [] };

    if (published) {
      const [series, stats] = await Promise.all([loadSeries(company.id), loadStats(company.id, cores.map((c) => c.id))]);
      const seriesById = new Map(series.map((s) => [s.id, s]));
      for (const core of cores) {
        if (core.is_deleted) {
          outcome.skipped.push({ code: core.code, reason: "היציאה מחוקה" });
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
          company_id: company.id,
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
    if (wanted.length === 0) throw new UserError("לא נבחרו יציאות");
    if (!(SALE_STATUSES as readonly string[]).includes(status)) throw new UserError("סטטוס מכירה לא תקין");
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
        metadata: { company_id: company.id, ids: done, count: done.length, bulk: done.length > 1 },
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
  if (!Array.isArray(cells)) throw new UserError("אין מחירים לשמירה");
  const seen = new Set<string>();
  const out: PriceCellInput[] = [];
  for (const c of cells) {
    const key = `${c.paxType}:${c.position}`;
    if (!MATRIX_KEYS.has(key)) throw new UserError("שורת מחיר לא מוכרת");
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.price !== null && (!Number.isFinite(c.price) || c.price < 0 || c.price > 1_000_000)) {
      throw new UserError("מחיר חייב להיות מספר חיובי");
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
    if (currency !== undefined && !(CURRENCIES as readonly string[]).includes(currency)) throw new UserError("מטבע לא נתמך");

    if (core.is_published) {
      const series = must(
        await toursDb().from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", core.series_id).maybeSingle(),
      );
      const blockers = blockersOf(core, series ?? undefined, { prices: matrixAfter(core, clean) });
      if (blockers.length) {
        throw new UserError(`היציאה מפורסמת ולא יכולה להישאר כך: ${blockers.join(", ")}. הסירו אותה מהפרסום קודם.`);
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
      metadata: { company_id: company.id, code: core.code },
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
    if (!Array.isArray(items) || items.length === 0) throw new UserError("אין שורות להחלה");
    if (items.length > 5000) throw new UserError("יותר מדי שורות בהדבקה אחת");
    const byId = new Map<string, PriceCellInput[]>();
    for (const item of items) {
      if (!UUID.test(item.departureId) || !Array.isArray(item.prices) || item.prices.length !== PRICE_MATRIX_ROWS.length) {
        throw new UserError("שורה לא תקינה בהדבקה");
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
        outcome.skipped.push({ code: core.code, reason: "היציאה מחוקה" });
        continue;
      }
      if (core.is_published) {
        const blockers = blockersOf(core, seriesById.get(core.series_id), { prices: matrixAfter(core, cells) });
        if (blockers.length) {
          outcome.skipped.push({ code: core.code, reason: `מפורסמת: ${blockers.join(", ")}` });
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
        metadata: { company_id: company.id, ids: outcome.done, count: outcome.done.length, bulk: true, source: "paste" },
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
    if (targets.length === 0) throw new UserError("לא נבחרו יציאות יעד");
    const source = await loadCore(company.id, sourceId);
    if (source.departure_prices.length === 0 && !opts.includeOptions) {
      throw new UserError(`ליציאה ${source.code} אין מחירים להעתקה`);
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
        outcome.skipped.push({ code: core.code, reason: "היציאה מחוקה" });
        continue;
      }
      if (core.is_published) {
        const blockers = blockersOf(core, seriesById.get(core.series_id), {
          prices: matrixAfter(core, sourceCells),
          currency: source.currency,
          ...(opts.includeOptions ? { options: sourceOptions, markup_fixed: sourceMarkup?.markup_fixed ?? null } : {}),
        });
        if (blockers.length) {
          outcome.skipped.push({ code: core.code, reason: `מפורסמת: ${blockers.join(", ")}` });
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
          company_id: company.id,
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
      nights: intOrNull(h.nights, 0, 60, "לילות"),
      price_unit: "per_stay",
      room_prices: {
        double: price(h.double, "מחיר זוגי"),
        triple: price(h.triple, "מחיר טריפל"),
        quad: price(h.quad, "מחיר רביעייה"),
      },
    }));
    const tickets = (input.tickets ?? []).map((t, i) => ({
      id: t.id && UUID.test(t.id) ? t.id : undefined,
      kind: "ticket",
      position: i + 1,
      label: text(t.label, 200),
      price: price(t.price, "מחיר כרטיס"),
      price_unit: "per_person",
    }));
    for (const h of hotels) if (!h.ref_code && !h.label) throw new UserError("לכל מלון צריך קוד מלון או שם");
    for (const t of tickets) if (!t.label) throw new UserError("לכל כרטיס צריך שם קטגוריה");
    const markupPercent = numOrNull(input.markup_percent, 0, 1000, "אחוז markup");
    const markupFixed = numOrNull(input.markup_fixed, 0, 1_000_000, "markup קבוע");

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
        throw new UserError(`היציאה מפורסמת ולא יכולה להישאר כך: ${blockers.join(", ")}. הסירו אותה מהפרסום קודם.`);
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
      metadata: { company_id: company.id, code: core.code, removed: removed.length },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- promotions
function cleanPromotion(input: PromotionInput) {
  if (!(PROMOTION_KINDS as readonly string[]).includes(input.kind)) throw new UserError("סוג הטבה לא מוכר");
  const kind = input.kind as PromotionKind;
  const label = text(input.label, 200);
  let value: number | null = null;
  if (kind === "gift") {
    if (!label) throw new UserError("למתנה צריך טקסט שמתאר אותה");
    value = input.value == null ? null : numOrNull(input.value, 0, 1_000_000, "ערך");
  } else {
    value = numOrNull(input.value, 0, 1_000_000, "ערך ההטבה");
    if (value == null || value <= 0) throw new UserError("ערך ההטבה חייב להיות מספר גדול מאפס");
    if (kind === "percent_order" && value > 100) throw new UserError("אחוז הנחה לא יכול לעבור 100");
    if (kind === "named_per_pax" && !label) throw new UserError("להנחה בשם צריך שם");
  }
  let validUntil: string | null = null;
  if (input.valid_until) {
    if (!isIsoDate(input.valid_until)) throw new UserError("תאריך תפוגה לא תקין");
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
      if (!UUID.test(promotionId)) throw new UserError("הטבה לא נמצאה");
      const updated = must(
        await db
          .from("promotions")
          .update(row)
          .eq("company_id", company.id)
          .eq("id", promotionId)
          .eq("departure_id", departureId)
          .select("id"),
      );
      if (!updated || updated.length === 0) throw new UserError("ההטבה לא נמצאה ביציאה הזו");
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
      metadata: { company_id: company.id, departure_id: departureId, code: core.code },
    });
    return ok({ id: id as string });
  } catch (e) {
    return fail(e);
  }
}

export async function setPromotionActive(promotionId: string, active: boolean): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(promotionId)) throw new UserError("הטבה לא נמצאה");
    const db = toursDb();
    const promo = must(
      await db
        .from("promotions")
        .select("id, kind, departure_id, series_id")
        .eq("company_id", company.id)
        .eq("id", promotionId)
        .maybeSingle(),
    );
    if (!promo || !promo.departure_id) throw new UserError("ההטבה לא נמצאה");
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
      metadata: { company_id: company.id, departure_id: promo.departure_id },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

export async function deletePromotion(promotionId: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(promotionId)) throw new UserError("הטבה לא נמצאה");
    const removed = must(
      await toursDb()
        .from("promotions")
        .delete()
        .eq("company_id", company.id)
        .eq("id", promotionId)
        .not("departure_id", "is", null)
        .select("id, departure_id, kind, value, label, valid_until"),
    );
    if (!removed || removed.length === 0) throw new UserError("ההטבה לא נמצאה");
    await logAudit({
      action: "delete",
      entityType: "tours_promotion",
      entityId: promotionId,
      changes: removed[0],
      metadata: { company_id: company.id, departure_id: removed[0].departure_id },
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
    if (wanted.length === 0) throw new UserError("לא נבחרו יציאות");
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
        outcome.skipped.push({ code: core.code, reason: "היציאה מחוקה" });
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
          company_id: company.id,
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
const LEGS: AllocationLegs[] = ["both", "outbound", "inbound"];
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
    if (core.is_deleted) throw new UserError("היציאה מחוקה");
    if (!LEGS.includes(legs)) throw new UserError("כיוון לא תקין");
    if (!Number.isInteger(seats) || seats < 1 || seats > 1000) throw new UserError("מספר המושבים חייב להיות מספר שלם גדול מאפס");
    if (!Number.isInteger(flightId)) throw new UserError("בלוק לא נמצא");

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
    if (!block || block.is_deleted) throw new UserError("הבלוק לא נמצא בחברה הפעילה");
    if (block.block_status === "cancelled" || block.block_status === "declined") {
      throw new UserError(`אי אפשר לשייך בלוק בסטטוס "${BLOCK_STATUS_LABELS[block.block_status as BlockStatus]}"`);
    }

    const takesOut = legs !== "inbound";
    const takesIn = legs !== "outbound";
    for (const a of must(existing) ?? []) {
      const clash = (a.legs !== "inbound" && takesOut) || (a.legs !== "outbound" && takesIn);
      if (clash) throw new UserError("הבלוק כבר משויך ליציאה הזו באותו כיוון. הסירו את השיוך הקיים כדי לשנות אותו.");
    }

    const route = effectiveRoute(core, must(seriesRow));
    const fit = checkBlockFitsDeparture(block, route, legs);
    if (!fit.ok) throw new UserError(`הבלוק לא מתאים למסלול היציאה: ${fit.reason}`);

    const warnings: string[] = [];
    if (takesOut) {
      const diff = Math.min(
        dayDiff(block.outbound_departure_time.slice(0, 10), core.start_date),
        dayDiff(block.outbound_arrival_time.slice(0, 10), core.start_date),
      );
      if (diff > ALLOCATION_DAY_WINDOW) {
        throw new UserError(`טיסת ההלוך ב-${fmtDate(block.outbound_departure_time)} והיציאה מתחילה ב-${fmtDate(core.start_date)} - הפרש של יותר מיומיים`);
      }
      if (diff > 0) warnings.push(`טיסת ההלוך ב-${fmtDate(block.outbound_departure_time)}, היציאה מתחילה ב-${fmtDate(core.start_date)}`);
    }
    if (takesIn) {
      const diff = dayDiff(block.inbound_departure_time.slice(0, 10), core.end_date);
      if (diff > ALLOCATION_DAY_WINDOW) {
        throw new UserError(`טיסת החזור ב-${fmtDate(block.inbound_departure_time)} והיציאה מסתיימת ב-${fmtDate(core.end_date)} - הפרש של יותר מיומיים`);
      }
      if (diff > 0) warnings.push(`טיסת החזור ב-${fmtDate(block.inbound_departure_time)}, היציאה מסתיימת ב-${fmtDate(core.end_date)}`);
    }

    const used = sums.get(flightId) ?? { outbound: 0, inbound: 0 };
    const freeOut = block.initial_quantity - used.outbound;
    const freeIn = block.initial_quantity - used.inbound;
    if (takesOut && seats > freeOut) {
      throw new UserError(`בבלוק ${block.initial_quantity} מושבים ו-${used.outbound} כבר משויכים בהלוך - נשארו ${Math.max(freeOut, 0)}`);
    }
    if (takesIn && seats > freeIn) {
      throw new UserError(`בבלוק ${block.initial_quantity} מושבים ו-${used.inbound} כבר משויכים בחזור - נשארו ${Math.max(freeIn, 0)}`);
    }

    const { data: inserted, error } = await db
      .from("flight_allocations")
      .insert({ company_id: company.id, flight_id: flightId, departure_id: departureId, seats, legs })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new UserError("הבלוק כבר משויך ליציאה הזו באותו כיוון");
      throw new Error(error.message);
    }
    await logAudit({
      action: "create",
      entityType: "tours_flight_allocation",
      entityId: inserted.id,
      changes: { flight_id: flightId, departure_id: departureId, seats, legs },
      metadata: { company_id: company.id, code: core.code },
    });
    return ok({ id: inserted.id }, warnings.length ? warnings.join(". ") : undefined);
  } catch (e) {
    return fail(e);
  }
}

export async function removeFlightAllocation(allocationId: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(allocationId)) throw new UserError("שיוך לא נמצא");
    const removed = must(
      await toursDb()
        .from("flight_allocations")
        .delete()
        .eq("company_id", company.id)
        .eq("id", allocationId)
        .select("id, flight_id, departure_id, seats, legs"),
    );
    if (!removed || removed.length === 0) throw new UserError("השיוך לא נמצא");
    await logAudit({
      action: "delete",
      entityType: "tours_flight_allocation",
      entityId: allocationId,
      changes: removed[0],
      metadata: { company_id: company.id },
    });
    return ok(undefined);
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------- sales entries
/** Seats sold (or cancelled, as a negative number) outside MYT, typed in by operations. */
export async function addSalesEntry(
  departureId: string,
  input: { pax: number; docket_no?: string | null; note?: string | null },
): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, company } = await requireCompany("tours");
    const core = await loadCore(company.id, departureId);
    if (core.is_deleted) throw new UserError("היציאה מחוקה");
    const pax = Number(input.pax);
    if (!Number.isInteger(pax) || pax === 0 || Math.abs(pax) > 500) {
      throw new UserError("מספר הנוסעים חייב להיות מספר שלם, חיובי למכירה או שלילי לביטול");
    }
    const row = {
      company_id: company.id,
      departure_id: departureId,
      pax,
      docket_no: text(input.docket_no, 60),
      note: text(input.note, 500),
      entered_by: session.sub,
    };
    const inserted = mustRow(await toursDb().from("departure_sales_entries").insert(row).select("id").single());
    await logAudit({
      action: "create",
      entityType: "tours_sales_entry",
      entityId: inserted.id,
      changes: { pax: row.pax, docket_no: row.docket_no, note: row.note },
      metadata: { company_id: company.id, departure_id: departureId, code: core.code },
    });
    return ok({ id: inserted.id });
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSalesEntry(entryId: string): Promise<ActionResult<undefined>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(entryId)) throw new UserError("רישום לא נמצא");
    const removed = must(
      await toursDb()
        .from("departure_sales_entries")
        .delete()
        .eq("company_id", company.id)
        .eq("id", entryId)
        .select("id, departure_id, pax, docket_no, note, entered_by, created_at"),
    );
    if (!removed || removed.length === 0) throw new UserError("הרישום לא נמצא");
    await logAudit({
      action: "delete",
      entityType: "tours_sales_entry",
      entityId: entryId,
      changes: removed[0],
      metadata: { company_id: company.id, departure_id: removed[0].departure_id },
    });
    return ok(undefined);
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
    if (!UUID.test(input.seriesId ?? "")) throw new UserError("בחרו סדרה");
    if (!isIsoDate(input.start_date) || !isIsoDate(input.end_date)) throw new UserError("בחרו תאריך יציאה ותאריך חזרה");
    if (input.end_date < input.start_date) throw new UserError("תאריך החזרה מוקדם מתאריך היציאה");
    if ((nightsBetween(input.start_date, input.end_date) ?? 0) > 60) throw new UserError("טיול של יותר מ-60 לילות - בדקו את התאריכים");

    const db = toursDb();
    const series = must(
      await db.from("series").select(SERIES_SELECT).eq("company_id", company.id).eq("id", input.seriesId).maybeSingle(),
    );
    if (!series) throw new UserError("הסדרה לא נמצאה בחברה הפעילה");
    if (!series.package_id) throw new UserError(`לסדרה ${series.code} אין עמוד באתר. שייכו אותה לעמוד במסך הסדרות ואז צרו יציאה.`);

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
          ? `קיימת יציאה מחוקה עם הקוד ${code} בשנת ${seasonYear}. שחזרו אותה מהלוח (סינון "מחוקות") במקום ליצור חדשה.`
          : `כבר קיימת יציאה עם הקוד ${code} בשנת ${seasonYear}`,
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
      if (error.code === "23505") throw new UserError(`כבר קיימת יציאה עם הקוד ${code} בשנת ${seasonYear}`);
      throw new Error(error.message);
    }
    await logAudit({
      action: "create",
      entityType: "tours_departure",
      entityId: inserted.id,
      changes: { code, series_id: series.id, start_date: input.start_date, end_date: input.end_date },
      metadata: { company_id: company.id },
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
      metadata: { company_id: company.id, code: core.code, was_published: core.is_published },
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
      metadata: { company_id: company.id, code: core.code, restored: true },
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
    if (wanted.length === 0) throw new UserError("אין יציאות לייצוא בתצוגה הנוכחית");
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
    const sheet = workbook.addWorksheet("יציאות", { views: [{ state: "frozen", ySplit: 1, rightToLeft: true }] });
    sheet.columns = [
      { header: "סדרה", key: "series", width: 9 },
      { header: "עמוד", key: "package", width: 30 },
      { header: "קוד", key: "code", width: 12 },
      { header: "שנה", key: "year", width: 7 },
      { header: "יציאה", key: "start", width: 12 },
      { header: "חזרה", key: "end", width: 12 },
      { header: "לילות", key: "nights", width: 7 },
      { header: "נחיתה", key: "arrival", width: 8 },
      { header: "חזרה מ", key: "ret", width: 8 },
      { header: "סוג מסלול", key: "routeType", width: 18 },
      { header: "עונה", key: "season", width: 12 },
      { header: "מפורסם", key: "published", width: 9 },
      { header: "סטטוס מכירה", key: "status", width: 16 },
      { header: "תגיות תאריך", key: "labels", width: 24 },
      { header: "מטבע", key: "currency", width: 7 },
      ...PRICE_MATRIX_ROWS.map((r) => ({ header: r.label, key: r.sheetKey, width: 16 })),
      { header: "הנחה קבועה לנוסע", key: "fixedDiscount", width: 14 },
      { header: "מחיר זוגי אחרי הנחה", key: "doubleAfter", width: 16 },
      { header: "הטבות פעילות", key: "promotions", width: 34 },
      { header: "חברת תעופה", key: "airline", width: 11 },
      { header: "סטטוס טיסה", key: "flightStatus", width: 20 },
      { header: "מושבים משויכים", key: "allocated", width: 13 },
      { header: "נמכרו", key: "sold", width: 8 },
      { header: "יתרה", key: "remaining", width: 8 },
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
        published: r.is_published ? "כן" : "לא",
        status: SALE_STATUS_LABELS[r.sale_status as SaleStatus] ?? r.sale_status,
        labels: r.date_labels.join(", "),
        currency: r.currency,
        fixedDiscount: discount || null,
        doubleAfter: double != null && discount > 0 ? double - discount : null,
        promotions: r.promotions.map((p) => promotionSummary(p, r.currency)).join(" | "),
        airline: Array.from(new Set(shownFlights.map((f) => f.airline))).join(", "),
        flightStatus: liveFlights.length
          ? Array.from(new Set(liveFlights.map((f) => BLOCK_STATUS_LABELS[f.blockStatus as BlockStatus] ?? f.blockStatus ?? ""))).join(", ")
          : "אין טיסה",
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
      metadata: { company_id: company.id, count: rows.length },
    });
    return ok({
      filename: `departures-${company.slug}-${todayIso()}.xlsx`,
      base64: Buffer.from(buffer).toString("base64"),
    });
  } catch (e) {
    return fail(e);
  }
}
