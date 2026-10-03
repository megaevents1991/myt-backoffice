"use server";

/**
 * The approvals area of a tours company (/tours/approvals, "Approvals"):
 * everything that waits for a person. Approvals only a manager gives on flight
 * blocks, and data the import could not settle on its own.
 *
 * Nothing is stored: every list is computed from the tables on each load, and a
 * row leaves its list the moment the thing it points at is handled.
 *
 * Company manager (`admin`) and `superadmin` only - checked here on every
 * action, not only on the page. Every statement carries the company filter.
 *
 * The steps themselves reuse the existing actions, called from the screen:
 *   transitionTourBlock / setTourBlockReviewed  (lib/actions/tours-flight-actions.ts)
 *   addFlightAllocation / saveDeparturePrices / setDeparturesPublished
 *                                               (lib/actions/tours-departure-actions.ts)
 * What is written here is only what those do not offer: the bulk review mark,
 * the "we keep this block" decision and the catalog hotel of one option row.
 */
import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { flightsOf } from "@/lib/flights-scope";
import { logAudit } from "@/lib/audit";
import { companyAudit } from "@/lib/tours/company-kit";
import { toPriceMatrix } from "@/lib/tours/pricing";
import { checkBlockFitsDeparture, departureRouteLabel, flightRouteLabel } from "@/lib/tours/routes";
import {
  DEADLINE_FIELDS,
  DEADLINE_LABELS,
  addDays,
  daysBetween,
  formatDateShort,
  toDateOnly,
  todayIso,
  type DeadlineField,
} from "@/lib/tours/deadlines";
import { ALLOCATION_MAX_DAY_GAP, allocatedSeats, isManagerRole } from "@/components/tours/flights/block-rules";
import {
  doublePricePerPerson,
  effectiveRoute,
  readRoomPrices,
  type RoomPrices,
} from "@/components/tours/departures/departure-utils";
import { addTourBlockEvent, setTourBlockReviewed } from "@/lib/actions/tours-flight-actions";
import { LIVE_BLOCK_STATUSES, type BlockStatus } from "@/types/tours.types";
import type { Database } from "@/types/database.types";
import { chunk, dbFail as databaseFail, fetchAll, plainFail as fail, UUID, type ActionResult } from "@/lib/tours/action-kit";

const dbFail = (where: string, error: unknown) => databaseFail("tours-approvals-actions", where, error);

// ------------------------------------------------------------------ shapes

/** A cancellation deadline that is close enough to need a decision. */
export interface CancelDecision {
  kind: "first" | "last";
  date: string;
  daysLeft: number;
}

/** A flight block with the facts a manager decides by. Dates are `yyyy-mm-dd`. */
export interface ApprovalBlock {
  id: number;
  /** null = a draft that was never approved to order. */
  status: string | null;
  airline: string;
  /** Set only when the way back is flown by another airline. */
  inboundAirline: string | null;
  /** Both legs: "TLV→LHR · CDG→TLV". */
  route: string;
  outboundFlight: string | null;
  inboundFlight: string | null;
  outboundDate: string;
  inboundDate: string;
  seats: number;
  /** What was ordered at first, when the count changed since. */
  originalSeats: number | null;
  /** Seats already given to departures. */
  allocated: number;
  /** Codes of the departures that lean on this block. */
  allocatedTo: string[];
  costPrice: number | null;
  costTax: number | null;
  costCurrency: string | null;
  pnr: string | null;
  seriesName: string | null;
  seasonLabel: string | null;
  hasContract: boolean;
  /** The nearest deadline that has not passed, of the six a block carries. */
  nearestDeadline: { field: DeadlineField; label: string; date: string; daysLeft: number } | null;
  /** Filled on the "decide before the cancellation date" list. */
  cancelDecision: CancelDecision | null;
  reviewedAt: string | null;
}

export interface BlockList {
  rows: ApprovalBlock[];
  /** May be larger than rows.length when the list was cut. */
  total: number;
}

export interface ReviewPage extends BlockList {
  page: number;
  pageSize: number;
}

/** A live block of the company that could serve a departure, both ways. */
export interface BlockCandidate {
  flightId: number;
  status: string;
  airline: string;
  inboundAirline: string | null;
  route: string;
  outboundFlight: string | null;
  inboundFlight: string | null;
  outboundDate: string;
  inboundDate: string;
  seats: number;
  freeSeats: number;
  seriesName: string | null;
  /** Days between the flight and the trip on each side (0 = the same day). */
  gapOut: number;
  gapIn: number;
  /** What one click allocates: the free seats, capped by the departure's capacity. */
  suggestedSeats: number;
}

/** A sub-tour made from a flight whose dates no longer match that flight (lib/tours/flight-sync.ts). */
export interface SubTourOffFlight {
  id: string;
  code: string;
  packageName: string | null;
  startDate: string;
  endDate: string;
  flightId: number;
  /** yyyy-mm-dd the flight takes off, out and back; null when the flight has no such leg. */
  flightOut: string | null;
  flightBack: string | null;
}

export interface DepartureWithoutBlock {
  id: string;
  code: string;
  packageName: string | null;
  startDate: string;
  endDate: string;
  /** "LHR" for a round trip, "LTN → LHR" when the group returns from elsewhere. */
  route: string;
  capacity: number | null;
  /** Blocks allocated to it that are not live (requested, cancelled, declined). */
  deadBlocks: number;
  candidates: BlockCandidate[];
  /** Candidates beyond the ones listed. */
  moreCandidates: number;
  /** Live blocks that fit by city and date but have no free seat. */
  fullCandidates: number;
}

export interface UnmatchedHotelOption {
  optionId: string;
  departureId: string;
  departureCode: string;
  packageName: string | null;
  startDate: string;
  endDate: string;
  isPublished: boolean;
  /** The departure already returned. */
  isPast: boolean;
  currency: string | null;
  position: number;
  /** The code the row carries now (the sheet's own code). */
  refCode: string | null;
  label: string | null;
  board: string | null;
  nights: number | null;
  roomPrices: RoomPrices;
  /** A catalog code that is the same text once case and separators are ignored. */
  suggestedCode: string | null;
}

export interface CatalogHotel {
  code: string;
  name: string;
  city: string | null;
}

export interface DepartureWithoutPrice {
  id: string;
  code: string;
  packageName: string | null;
  /** `vacation` packages are priced by hotel and ticket rows, not by the matrix. */
  packageKind: string | null;
  startDate: string;
  endDate: string;
  currency: string | null;
  /** Double-room prices of the other departures of the same series, in the same currency. */
  seriesPrices: { min: number; max: number; count: number } | null;
}

export interface ApprovalsData {
  /** `yyyy-mm-dd` in Israel - what "upcoming" and "days left" were measured from. */
  today: string;
  decisionWindowDays: number;
  /** Drafts that wait for the manager's approval to order the dates. */
  awaitingApproval: BlockList;
  /** Confirmed blocks whose cancellation date is close: keep the seats or cancel. */
  cancelDecisions: BlockList;
  /** Upcoming live blocks the manager has not signed off yet. */
  review: ReviewPage;
  /** Unreviewed rows that do not wait here: flown, cancelled, declined, not confirmed yet. */
  otherUnreviewed: number;
  departuresWithoutBlock: DepartureWithoutBlock[];
  unmatchedHotels: UnmatchedHotelOption[];
  hotelCatalog: CatalogHotel[];
  departuresWithoutPrice: DepartureWithoutPrice[];
  subToursOffFlight: SubTourOffFlight[];
}

// ------------------------------------------------------------------ plumbing

/** How close a cancellation date must be to ask for a decision, in days. */
const DECISION_WINDOW_DAYS = 14;
/** Once the airline confirmed, only these still hold seats that can be given back. */
const CANCEL_DECISION_STATUSES: readonly string[] = ["confirmed", "operational"];
const REVIEW_PAGE_SIZE = 25;
/** The two short lists are cut here; the review list is paged. */
const LIST_CAP = 50;
const CANDIDATES_SHOWN = 3;
const BULK_REVIEW_MAX = 200;
const ID_CHUNK = 100;

const MANAGERS_ONLY = "Managers only.";

// ------------------------------------------------------------------ flight blocks

type FlightRow = Database["public"]["Tables"]["flights"]["Row"];

// One literal (not concatenated) so the typed client can parse the column list.
const BLOCK_COLUMNS =
  "id,block_status,airline_code,inbound_airline_code,outbound_departure_airport,outbound_arrival_airport,inbound_departure_airport,inbound_arrival_airport,outbound_departure_time,outbound_arrival_time,inbound_departure_time,outbound_flight_number,inbound_flight_number,initial_quantity,original_quantity,cost_price,cost_tax,cost_currency,pnr,series_name,season_label,contract_id,first_cancellation_date,last_cancellation_date,names_deadline,ticketing_deadline,payment_deadline,option_expiry,reviewed_at";

type QueueBlock = Pick<
  FlightRow,
  | "id"
  | "block_status"
  | "airline_code"
  | "inbound_airline_code"
  | "outbound_departure_airport"
  | "outbound_arrival_airport"
  | "inbound_departure_airport"
  | "inbound_arrival_airport"
  | "outbound_departure_time"
  | "outbound_arrival_time"
  | "inbound_departure_time"
  | "outbound_flight_number"
  | "inbound_flight_number"
  | "initial_quantity"
  | "original_quantity"
  | "cost_price"
  | "cost_tax"
  | "cost_currency"
  | "pnr"
  | "series_name"
  | "season_label"
  | "contract_id"
  | "first_cancellation_date"
  | "last_cancellation_date"
  | "names_deadline"
  | "ticketing_deadline"
  | "payment_deadline"
  | "option_expiry"
  | "reviewed_at"
>;

interface AllocationRow {
  flight_id: number;
  departure_id: string;
  seats: number;
  legs: string;
}

const isLive = (status: string | null): boolean =>
  status !== null && (LIVE_BLOCK_STATUSES as readonly string[]).includes(status);

const outboundDay = (block: QueueBlock): string => toDateOnly(block.outbound_departure_time) ?? "";

/** The Israel date of a stored instant. */
const israelDay = (instant: string): string => todayIso(new Date(instant));

/**
 * The cancellation date this block needs a decision for, or null. A date counts
 * while it is within the window and nobody signed the row off since that window
 * opened: the review mark given here ("we keep the seats") is what closes it.
 */
function cancelDecisionOf(block: QueueBlock, today: string): CancelDecision | null {
  if (block.block_status === null || !CANCEL_DECISION_STATUSES.includes(block.block_status)) return null;
  const until = addDays(today, DECISION_WINDOW_DAYS);
  const reviewedOn = block.reviewed_at ? israelDay(block.reviewed_at) : null;
  const dates: { kind: "first" | "last"; date: string | null }[] = [
    { kind: "first", date: toDateOnly(block.first_cancellation_date) },
    { kind: "last", date: toDateOnly(block.last_cancellation_date) },
  ];
  for (const { kind, date } of dates) {
    if (!date || date < today || date > until) continue;
    if (reviewedOn && reviewedOn >= addDays(date, -DECISION_WINDOW_DAYS)) continue;
    return { kind, date, daysLeft: daysBetween(today, date) };
  }
  return null;
}

function nearestDeadlineOf(block: QueueBlock, today: string): ApprovalBlock["nearestDeadline"] {
  let best: ApprovalBlock["nearestDeadline"] = null;
  for (const field of DEADLINE_FIELDS) {
    const date = toDateOnly(block[field]);
    if (!date || date < today) continue;
    if (!best || date < best.date) {
      best = { field, label: DEADLINE_LABELS[field], date, daysLeft: daysBetween(today, date) };
    }
  }
  return best;
}

interface BlockState {
  today: string;
  /** Drafts and live blocks that fly from two days ago on (the two days serve the candidates). */
  blocks: QueueBlock[];
  allocationsByFlight: Map<number, AllocationRow[]>;
  allocationsByDeparture: Map<string, AllocationRow[]>;
  drafts: QueueBlock[];
  decisions: { block: QueueBlock; decision: CancelDecision }[];
  review: QueueBlock[];
}

/** Everything the block lists are cut from. Throws on a failed read. */
async function loadBlockState(companyId: string): Promise<BlockState> {
  const today = todayIso();
  const from = `${addDays(today, -ALLOCATION_MAX_DAY_GAP)}T00:00:00`;
  const [blocks, allocations] = await Promise.all([
    fetchAll<QueueBlock>((a, b) =>
      supabaseTyped
        .from("flights")
        .select(BLOCK_COLUMNS)
        .eq("company_id", companyId)
        .not("is_deleted", "is", true)
        .gte("outbound_departure_time", from)
        .or(`block_status.is.null,block_status.in.(${LIVE_BLOCK_STATUSES.join(",")})`)
        .order("id", { ascending: true })
        .range(a, b),
    ),
    fetchAll<AllocationRow>((a, b) =>
      toursDb()
        .from("flight_allocations")
        .select("flight_id,departure_id,seats,legs")
        .eq("company_id", companyId)
        .order("id", { ascending: true })
        .range(a, b),
    ),
  ]);

  const allocationsByFlight = new Map<number, AllocationRow[]>();
  const allocationsByDeparture = new Map<string, AllocationRow[]>();
  for (const row of allocations) {
    allocationsByFlight.set(row.flight_id, [...(allocationsByFlight.get(row.flight_id) ?? []), row]);
    allocationsByDeparture.set(row.departure_id, [...(allocationsByDeparture.get(row.departure_id) ?? []), row]);
  }

  const drafts: QueueBlock[] = [];
  const decisions: BlockState["decisions"] = [];
  const review: QueueBlock[] = [];
  for (const block of blocks) {
    if (outboundDay(block) < today) continue;
    if (block.block_status === null) {
      drafts.push(block);
      continue;
    }
    if (!isLive(block.block_status)) continue;
    const decision = cancelDecisionOf(block, today);
    if (decision) decisions.push({ block, decision });
    else if (!block.reviewed_at) review.push(block);
  }

  const byFlight = (a: QueueBlock, b: QueueBlock) =>
    a.outbound_departure_time.localeCompare(b.outbound_departure_time) || a.id - b.id;
  drafts.sort(byFlight);
  decisions.sort((a, b) => a.decision.date.localeCompare(b.decision.date) || byFlight(a.block, b.block));
  // The row with the closest open deadline first; rows with no deadline last, by flight date.
  const deadlineKey = new Map(review.map((b) => [b.id, nearestDeadlineOf(b, today)?.date ?? "9999-12-31"]));
  review.sort(
    (a, b) => (deadlineKey.get(a.id) ?? "").localeCompare(deadlineKey.get(b.id) ?? "") || byFlight(a, b),
  );

  return { today, blocks, allocationsByFlight, allocationsByDeparture, drafts, decisions, review };
}

/** Codes of the departures the given blocks are allocated to, by departure id. */
async function loadDepartureCodes(
  companyId: string,
  state: BlockState,
  blocks: QueueBlock[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const block of blocks) {
    for (const a of state.allocationsByFlight.get(block.id) ?? []) ids.add(a.departure_id);
  }
  const codes = new Map<string, string>();
  for (const part of chunk([...ids], ID_CHUNK)) {
    const { data, error } = await toursDb()
      .from("departures")
      .select("id,code")
      .eq("company_id", companyId)
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) codes.set(row.id, row.code);
  }
  return codes;
}

function toApprovalBlock(
  block: QueueBlock,
  state: BlockState,
  codes: Map<string, string>,
  decision: CancelDecision | null = null,
): ApprovalBlock {
  const allocations = state.allocationsByFlight.get(block.id) ?? [];
  const changed = block.original_quantity !== null && block.original_quantity !== block.initial_quantity;
  return {
    id: block.id,
    status: block.block_status,
    airline: block.airline_code,
    inboundAirline:
      block.inbound_airline_code && block.inbound_airline_code !== block.airline_code
        ? block.inbound_airline_code
        : null,
    route: flightRouteLabel(block),
    outboundFlight: block.outbound_flight_number || null,
    inboundFlight: block.inbound_flight_number || null,
    outboundDate: outboundDay(block),
    inboundDate: toDateOnly(block.inbound_departure_time) ?? "",
    seats: block.initial_quantity,
    originalSeats: changed ? block.original_quantity : null,
    allocated: allocatedSeats(allocations),
    allocatedTo: [...new Set(allocations.map((a) => codes.get(a.departure_id)).filter((c): c is string => !!c))].sort(),
    costPrice: block.cost_price,
    costTax: block.cost_tax,
    costCurrency: block.cost_currency,
    pnr: block.pnr?.trim() || null,
    seriesName: block.series_name?.trim() || null,
    seasonLabel: block.season_label?.trim() || null,
    hasContract: !!block.contract_id,
    nearestDeadline: nearestDeadlineOf(block, state.today),
    cancelDecision: decision,
    reviewedAt: block.reviewed_at,
  };
}

/** One page of the review list; a page past the end falls back to the last one. */
function reviewSlice(state: BlockState, page: number): { blocks: QueueBlock[]; page: number } {
  const pages = Math.max(1, Math.ceil(state.review.length / REVIEW_PAGE_SIZE));
  const wanted = Number.isInteger(page) && page > 0 ? page : 1;
  const current = Math.min(wanted, pages);
  const start = (current - 1) * REVIEW_PAGE_SIZE;
  return { blocks: state.review.slice(start, start + REVIEW_PAGE_SIZE), page: current };
}

// ------------------------------------------------------------------ departures

const DEPARTURE_COLUMNS =
  "id, code, series_id, start_date, end_date, currency, arrival_airport, return_airport, capacity, flight_mode, flight_price, markup_fixed, packages(name, kind), departure_prices(pax_type, room_position, price), departure_options(kind, position, price, room_prices)";

/** Published departures that have not left yet, with what the price rule reads. */
async function loadPublishedDepartures(companyId: string, today: string) {
  const pageOf = (a: number, b: number) =>
    toursDb()
      .from("departures")
      .select(DEPARTURE_COLUMNS)
      .eq("company_id", companyId)
      .eq("departure_prices.company_id", companyId)
      .eq("departure_options.company_id", companyId)
      .eq("is_published", true)
      .is("is_deleted", null)
      .gte("start_date", today)
      .order("start_date", { ascending: true })
      .order("code", { ascending: true })
      .range(a, b);
  type Row = NonNullable<Awaited<ReturnType<typeof pageOf>>["data"]>[number];
  return fetchAll<Row>(pageOf);
}

type PublishedDeparture = Awaited<ReturnType<typeof loadPublishedDepartures>>[number];

interface SeriesEnds {
  arrival_airport: string | null;
  return_airport: string | null;
}

/** Live blocks that could carry this departure both ways, the best fit first. */
function candidatesFor(
  departure: PublishedDeparture,
  route: SeriesEnds,
  state: BlockState,
): { fitting: BlockCandidate[]; full: number } {
  const own = new Set((state.allocationsByDeparture.get(departure.id) ?? []).map((a) => a.flight_id));
  const fitting: BlockCandidate[] = [];
  let full = 0;
  for (const block of state.blocks) {
    if (!isLive(block.block_status) || own.has(block.id)) continue;
    const outDate = toDateOnly(block.outbound_departure_time);
    const outArrival = toDateOnly(block.outbound_arrival_time) ?? outDate;
    const inDate = toDateOnly(block.inbound_departure_time);
    if (!outDate || !outArrival || !inDate) continue;
    // The same distances the allocation action measures - nothing is offered that it would refuse.
    const gapOut = Math.min(
      Math.abs(daysBetween(outDate, departure.start_date)),
      Math.abs(daysBetween(outArrival, departure.start_date)),
    );
    const gapIn = Math.abs(daysBetween(inDate, departure.end_date));
    if (gapOut > ALLOCATION_MAX_DAY_GAP || gapIn > ALLOCATION_MAX_DAY_GAP) continue;
    if (!checkBlockFitsDeparture(block, route, "both").ok) continue;
    const freeSeats = block.initial_quantity - allocatedSeats(state.allocationsByFlight.get(block.id) ?? []);
    if (freeSeats < 1) {
      full += 1;
      continue;
    }
    fitting.push({
      flightId: block.id,
      status: block.block_status as BlockStatus,
      airline: block.airline_code,
      inboundAirline:
        block.inbound_airline_code && block.inbound_airline_code !== block.airline_code
          ? block.inbound_airline_code
          : null,
      route: flightRouteLabel(block),
      outboundFlight: block.outbound_flight_number || null,
      inboundFlight: block.inbound_flight_number || null,
      outboundDate: outDate,
      inboundDate: inDate,
      seats: block.initial_quantity,
      freeSeats,
      seriesName: block.series_name?.trim() || null,
      gapOut,
      gapIn,
      suggestedSeats:
        departure.capacity && departure.capacity > 0 ? Math.min(freeSeats, departure.capacity) : freeSeats,
    });
  }
  fitting.sort(
    (a, b) => a.gapOut + a.gapIn - (b.gapOut + b.gapIn) || b.freeSeats - a.freeSeats || a.flightId - b.flightId,
  );
  return { fitting, full };
}

/** Lower case, every run of other characters as one dash: "Soho_Boutique_Congreso" = "soho-boutique-congreso". */
const codeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

async function loadUnmatchedHotels(
  companyId: string,
  today: string,
): Promise<{ unmatched: UnmatchedHotelOption[]; catalog: CatalogHotel[] }> {
  const [options, catalog] = await Promise.all([
    fetchAll((a, b) =>
      toursDb()
        .from("departure_options")
        .select("id, departure_id, position, ref_code, label, board, nights, room_prices")
        .eq("company_id", companyId)
        .eq("kind", "hotel")
        .order("id", { ascending: true })
        .range(a, b),
    ),
    fetchAll((a, b) =>
      toursDb()
        .from("hotels")
        .select("code, name, city")
        .eq("company_id", companyId)
        .order("name", { ascending: true })
        .order("code", { ascending: true })
        .range(a, b),
    ),
  ]);
  const codes = new Set(catalog.map((h) => h.code));
  const byKey = new Map(catalog.map((h) => [codeKey(h.code), h.code]));
  const orphans = options.filter((o) => !o.ref_code || !codes.has(o.ref_code));
  if (orphans.length === 0) return { unmatched: [], catalog };

  const departureIds = [...new Set(orphans.map((o) => o.departure_id))];
  const departures = new Map<
    string,
    {
      id: string;
      code: string;
      start_date: string;
      end_date: string;
      currency: string;
      is_published: boolean;
      packages: { name: string } | null;
    }
  >();
  for (const part of chunk(departureIds, ID_CHUNK)) {
    const { data, error } = await toursDb()
      .from("departures")
      .select("id, code, start_date, end_date, currency, is_published, packages(name)")
      .eq("company_id", companyId)
      .is("is_deleted", null)
      .in("id", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) departures.set(row.id, row);
  }

  const unmatched: UnmatchedHotelOption[] = [];
  for (const option of orphans) {
    // An option of a deleted departure is nobody's problem.
    const departure = departures.get(option.departure_id);
    if (!departure) continue;
    const sheetCode = option.ref_code ?? option.label;
    unmatched.push({
      optionId: option.id,
      departureId: departure.id,
      departureCode: departure.code,
      packageName: departure.packages?.name ?? null,
      startDate: departure.start_date,
      endDate: departure.end_date,
      isPublished: departure.is_published,
      isPast: departure.end_date < today,
      currency: departure.currency,
      position: option.position,
      refCode: option.ref_code,
      label: option.label,
      board: option.board,
      nights: option.nights,
      roomPrices: readRoomPrices(option.room_prices),
      suggestedCode: sheetCode ? (byKey.get(codeKey(sheetCode)) ?? null) : null,
    });
  }
  // What is still ahead first, then by date.
  unmatched.sort(
    (a, b) =>
      Number(a.isPast) - Number(b.isPast) ||
      a.startDate.localeCompare(b.startDate) ||
      a.departureCode.localeCompare(b.departureCode) ||
      a.position - b.position,
  );
  return { unmatched, catalog };
}

/** Double-room prices of the other departures of each series, per currency. */
async function loadSeriesPrices(
  companyId: string,
  seriesIds: string[],
): Promise<Map<string, { currency: string; price: number; departureId: string }[]>> {
  const out = new Map<string, { currency: string; price: number; departureId: string }[]>();
  for (const part of chunk([...new Set(seriesIds)], ID_CHUNK)) {
    const rows = await fetchAll((a, b) =>
      toursDb()
        .from("departures")
        .select("id, series_id, currency, departure_prices(pax_type, room_position, price)")
        .eq("company_id", companyId)
        .eq("departure_prices.company_id", companyId)
        .is("is_deleted", null)
        .in("series_id", part)
        .order("id", { ascending: true })
        .range(a, b),
    );
    for (const row of rows) {
      const double = toPriceMatrix(row.departure_prices)["adult:2"];
      if (double == null || !(double > 0)) continue;
      out.set(row.series_id, [
        ...(out.get(row.series_id) ?? []),
        { currency: row.currency, price: double, departureId: row.id },
      ]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ read

/** Everything the approvals screen shows, except the data-problems summary (it has its own action). */
export async function getApprovalsQueue(input: { reviewPage?: number } = {}): Promise<ActionResult<ApprovalsData>> {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) return fail(MANAGERS_ONLY);

  try {
    const [state, seriesRows, unreviewedCount] = await Promise.all([
      loadBlockState(company.id),
      fetchAll((a, b) =>
        toursDb()
          .from("series")
          .select("id, arrival_airport, return_airport")
          .eq("company_id", company.id)
          .order("id", { ascending: true })
          .range(a, b),
      ),
      supabaseTyped
        .from("flights")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .not("is_deleted", "is", true)
        .is("reviewed_at", null),
    ]);
    if (unreviewedCount.error) throw new Error(unreviewedCount.error.message);
    const { today } = state;

    const [published, hotels, offFlight] = await Promise.all([
      loadPublishedDepartures(company.id, today),
      loadUnmatchedHotels(company.id, today),
      loadSubToursOffFlight(company, today),
    ]);

    // --- flight blocks
    const slice = reviewSlice(state, input.reviewPage ?? 1);
    const shownDrafts = state.drafts.slice(0, LIST_CAP);
    const shownDecisions = state.decisions.slice(0, LIST_CAP);
    const codes = await loadDepartureCodes(company.id, state, [
      ...shownDrafts,
      ...shownDecisions.map((d) => d.block),
      ...slice.blocks,
    ]);
    const unreviewedHere =
      state.review.length + state.decisions.filter((d) => !d.block.reviewed_at).length;

    // --- published departures with no live block (a land-only departure needs none)
    const series = new Map(seriesRows.map((s) => [s.id, s]));
    const needFlight = published.filter((d) => d.flight_mode !== "none");
    const liveBlocks = new Map<string, number>();
    for (const part of chunk(needFlight.map((d) => d.id), ID_CHUNK)) {
      const { data, error } = await toursDb()
        .from("departure_stats")
        .select("departure_id, live_blocks")
        .eq("company_id", company.id)
        .in("departure_id", part);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) if (row.departure_id) liveBlocks.set(row.departure_id, row.live_blocks ?? 0);
    }
    const departuresWithoutBlock: DepartureWithoutBlock[] = needFlight
      .filter((d) => (liveBlocks.get(d.id) ?? 0) === 0)
      .map((d) => {
        const route = effectiveRoute(d, series.get(d.series_id));
        const { fitting, full } = candidatesFor(d, route, state);
        return {
          id: d.id,
          code: d.code,
          packageName: d.packages?.name ?? null,
          startDate: d.start_date,
          endDate: d.end_date,
          route: departureRouteLabel(route.arrival_airport, route.return_airport),
          capacity: d.capacity,
          deadBlocks: (state.allocationsByDeparture.get(d.id) ?? []).length,
          candidates: fitting.slice(0, CANDIDATES_SHOWN),
          moreCandidates: Math.max(0, fitting.length - CANDIDATES_SHOWN),
          fullCandidates: full,
        };
      });

    // --- published departures with no double-room price (the rule that blocks a publish)
    const unpriced = published.filter(
      (d) =>
        doublePricePerPerson({
          prices: toPriceMatrix(d.departure_prices),
          options: d.departure_options,
          flight_mode: d.flight_mode,
          flight_price: d.flight_price,
          markup_fixed: d.markup_fixed,
        }).price == null,
    );
    const seriesPrices = unpriced.length
      ? await loadSeriesPrices(company.id, unpriced.map((d) => d.series_id))
      : new Map<string, { currency: string; price: number; departureId: string }[]>();
    const departuresWithoutPrice: DepartureWithoutPrice[] = unpriced.map((d) => {
      const siblings = (seriesPrices.get(d.series_id) ?? []).filter(
        (p) => p.departureId !== d.id && p.currency === d.currency,
      );
      return {
        id: d.id,
        code: d.code,
        packageName: d.packages?.name ?? null,
        packageKind: d.packages?.kind ?? null,
        startDate: d.start_date,
        endDate: d.end_date,
        currency: d.currency,
        seriesPrices: siblings.length
          ? {
              min: Math.min(...siblings.map((p) => p.price)),
              max: Math.max(...siblings.map((p) => p.price)),
              count: siblings.length,
            }
          : null,
      };
    });

    return {
      success: true,
      data: {
        today,
        decisionWindowDays: DECISION_WINDOW_DAYS,
        awaitingApproval: {
          rows: shownDrafts.map((b) => toApprovalBlock(b, state, codes)),
          total: state.drafts.length,
        },
        cancelDecisions: {
          rows: shownDecisions.map((d) => toApprovalBlock(d.block, state, codes, d.decision)),
          total: state.decisions.length,
        },
        review: {
          rows: slice.blocks.map((b) => toApprovalBlock(b, state, codes)),
          total: state.review.length,
          page: slice.page,
          pageSize: REVIEW_PAGE_SIZE,
        },
        otherUnreviewed: Math.max(0, (unreviewedCount.count ?? 0) - unreviewedHere),
        departuresWithoutBlock,
        unmatchedHotels: hotels.unmatched,
        hotelCatalog: hotels.catalog,
        departuresWithoutPrice,
        subToursOffFlight: offFlight,
      },
    };
  } catch (e) {
    return dbFail("queue read", e);
  }
}

/**
 * Upcoming sub-tours whose dates left the flight they were made from: the flight
 * moved while the sub-tour had customers (a task was opened), or it moved through
 * a path that does not sync. A deleted flight is not listed here - its sub-tour
 * shows under "without a block".
 */
async function loadSubToursOffFlight(company: { id: string }, today: string): Promise<SubTourOffFlight[]> {
  type SubTourRow = {
    id: string;
    code: string;
    start_date: string;
    end_date: string;
    origin_flight_id: number;
    packages: { name: string } | null;
  };
  const deps = (await fetchAll((a, b) =>
    toursDb()
      .from("departures")
      .select("id, code, start_date, end_date, origin_flight_id, packages(name)")
      .eq("company_id", company.id)
      .is("is_deleted", null)
      .not("origin_flight_id", "is", null)
      .gte("end_date", today)
      .order("start_date", { ascending: true })
      .range(a, b),
  )) as unknown as SubTourRow[];
  if (deps.length === 0) return [];
  const flights = new Map<number, { out: string | null; back: string | null }>();
  const ids = [...new Set(deps.map((d) => d.origin_flight_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await flightsOf(company)
      .select("id, outbound_departure_time, inbound_departure_time, is_deleted")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as { id: number; outbound_departure_time: string | null; inbound_departure_time: string | null; is_deleted: boolean | null }[]) {
      if (f.is_deleted) continue;
      flights.set(f.id, {
        out: f.outbound_departure_time ? f.outbound_departure_time.slice(0, 10) : null,
        back: f.inbound_departure_time ? f.inbound_departure_time.slice(0, 10) : null,
      });
    }
  }
  const rows: SubTourOffFlight[] = [];
  for (const d of deps) {
    const f = flights.get(d.origin_flight_id);
    if (!f || (f.out === d.start_date && f.back === d.end_date)) continue;
    rows.push({
      id: d.id,
      code: d.code,
      packageName: d.packages?.name ?? null,
      startDate: d.start_date,
      endDate: d.end_date,
      flightId: d.origin_flight_id,
      flightOut: f.out,
      flightBack: f.back,
    });
  }
  return rows.slice(0, LIST_CAP);
}

/** Another page of the review list - the rest of the screen stays as it is. */
export async function getApprovalsReviewPage(page: number): Promise<ActionResult<ReviewPage>> {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) return fail(MANAGERS_ONLY);

  try {
    const state = await loadBlockState(company.id);
    const slice = reviewSlice(state, page);
    const codes = await loadDepartureCodes(company.id, state, slice.blocks);
    return {
      success: true,
      data: {
        rows: slice.blocks.map((b) => toApprovalBlock(b, state, codes)),
        total: state.review.length,
        page: slice.page,
        pageSize: REVIEW_PAGE_SIZE,
      },
    };
  } catch (e) {
    return dbFail("review page read", e);
  }
}

// ------------------------------------------------------------------ write

/**
 * "סמן כנבדק" on many rows at once: the same mark setTourBlockReviewed gives one
 * row (who and when), in one statement, with one audit row that lists the blocks.
 */
export async function markTourBlocksReviewed(flightIds: number[]): Promise<ActionResult<{ done: number }>> {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) return fail("Only the company manager can mark a row Reviewed");

  const ids = Array.isArray(flightIds)
    ? [...new Set(flightIds.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0))]
    : [];
  if (ids.length === 0) return fail("No flight blocks selected");
  if (ids.length > BULK_REVIEW_MAX) return fail(`You can mark up to ${BULK_REVIEW_MAX} rows at once`);

  const done: number[] = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await supabaseTyped
      .from("flights")
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: session.sub })
      .eq("company_id", company.id)
      .eq("is_deleted", false)
      .in("id", part)
      .select("id");
    if (error) return dbFail("bulk review", error);
    done.push(...(data ?? []).map((row) => row.id));
  }
  if (done.length === 0) return fail("The flight blocks were not found in the active company");

  await logAudit({
    action: "tours.flight.reviewed",
    entityType: "flight",
    entityId: done.length === 1 ? done[0] : null,
    metadata: { ...companyAudit(company), ids: done, count: done.length, bulk: done.length > 1, source: "approvals" },
  });
  return {
    success: true,
    data: { done: done.length },
    ...(done.length < ids.length ? { warning: `${ids.length - done.length} rows were not found and were not marked.` } : {}),
  };
}

/**
 * "משאירים את הקבוצה": the manager looked at a block whose cancellation date is
 * close and decided to keep the seats. Written to the block's timeline as a note
 * and signed with the review mark, through the two existing actions - so the
 * event, the mark and both audit rows are exactly the ones the block card writes.
 */
export async function keepTourBlock(flightId: number): Promise<ActionResult<null>> {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) return fail("Only the company manager decides on a flight block the airline confirmed");
  if (typeof flightId !== "number" || !Number.isInteger(flightId) || flightId <= 0) return fail("Flight block not found");

  const { data: block, error } = await supabaseTyped
    .from("flights")
    .select(BLOCK_COLUMNS)
    .eq("id", flightId)
    .eq("company_id", company.id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) return dbFail("block read", error);
  if (!block) return fail("Flight block not found");

  const decision = cancelDecisionOf(block, todayIso());
  if (!decision) return fail("This flight block no longer waits for a decision. Refresh the screen.");

  // The note is data and keeps its Hebrew wording; DEADLINE_LABELS are English screen copy.
  const label = decision.kind === "first" ? "ביטול ראשון" : "ביטול אחרון";
  const noted = await addTourBlockEvent(flightId, {
    kind: "note",
    note: `הוחלט להשאיר את הקבוצה. מועד ${label}: ${formatDateShort(decision.date)}`,
  });
  if (!noted.success) return fail(noted.error);
  const marked = await setTourBlockReviewed(flightId, true);
  if (!marked.success) return fail(marked.error);
  return { success: true, data: null };
}

/**
 * Points one hotel row of a vacation departure at a hotel of the catalog. Only
 * `ref_code` changes; the text the import kept in `label` stays as the trace of
 * what the sheet said.
 */
export async function setHotelOptionCatalogCode(optionId: string, hotelCode: string): Promise<ActionResult<null>> {
  const { session, company } = await requireCompany("tours");
  if (!isManagerRole(session.role)) return fail(MANAGERS_ONLY);
  if (typeof optionId !== "string" || !UUID.test(optionId)) return fail("Hotel row not found");
  const code = typeof hotelCode === "string" ? hotelCode.trim() : "";
  if (!code) return fail("Pick a hotel from the catalog");

  const db = toursDb();
  const [optionRes, hotelRes] = await Promise.all([
    db
      .from("departure_options")
      .select("id, departure_id, kind, ref_code, label")
      .eq("id", optionId)
      .eq("company_id", company.id)
      .maybeSingle(),
    db.from("hotels").select("code, name").eq("company_id", company.id).eq("code", code).maybeSingle(),
  ]);
  if (optionRes.error) return dbFail("option read", optionRes.error);
  if (hotelRes.error) return dbFail("hotel read", hotelRes.error);
  const option = optionRes.data;
  if (!option || option.kind !== "hotel") return fail("Hotel row not found");
  if (!hotelRes.data) return fail("The hotel is not in the company catalog");
  if (option.ref_code === code) return { success: true, data: null };

  const { data: departure, error: departureError } = await db
    .from("departures")
    .select("id, code")
    .eq("id", option.departure_id)
    .eq("company_id", company.id)
    .is("is_deleted", null)
    .maybeSingle();
  if (departureError) return dbFail("departure read", departureError);
  if (!departure) return fail("The departure of the hotel row was not found");

  const { data: updated, error } = await db
    .from("departure_options")
    .update({ ref_code: code })
    .eq("id", option.id)
    .eq("company_id", company.id)
    .eq("kind", "hotel")
    .select("id");
  if (error) return dbFail("option update", error);
  if (!updated || updated.length === 0) return fail("Hotel row not found");

  await logAudit({
    action: "update",
    entityType: "tours_departure_options",
    entityId: departure.id,
    changes: { option_id: option.id, ref_code: { from: option.ref_code, to: code }, label: option.label },
    metadata: { ...companyAudit(company), code: departure.code, hotel: hotelRes.data.name, source: "approvals" },
  });
  return { success: true, data: null };
}
