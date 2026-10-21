"use server";

/**
 * The cases of a tours company - one table for its leads and reservations
 * (spec docs/superpowers/specs/2026-10-14-tours-unified-reservations-design.md).
 *
 * A case is a row of public.leads: every site form, every site booking (which
 * hangs on its case through tours.bookings.lead_id) and every reservation staff
 * type in. The rules (TYPE, TASK, statuses, the booking link) live in
 * lib/tours/cases.ts; this file reads and writes, company-scoped, audited
 * (entity "tours_case"). Every answer is an ActionResult - nothing throws to the
 * client.
 */
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

import { logAudit } from "@/lib/audit";
import { matchesSearch } from "@/lib/search";
import { requireCompany, type Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { taskPeopleOf } from "@/lib/services/task-people";
import { toursDb } from "@/lib/tours/db";
import { todayIso } from "@/lib/tours/deadlines";
import { arrivalOf, canSeeCard, cleanOrderIds, visibleCards, type BoardViewer } from "@/lib/tours/board";
import { boardViewerFor } from "@/lib/services/tours-board-viewer";
import { actionFail, actionOk, chunk, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit } from "@/lib/tours/company-kit";
import { isoToJerusalemLocal } from "@/lib/tours/format";
import { bookingRowOf, departuresOf } from "@/lib/tours/booking-rows";
import { readCancellationRules, readPaymentLog } from "@/lib/tours/payment-log";
import { holdOwedSeats, readCaseStatuses } from "@/lib/tours/case-seats";
import { sendTemplate, whatsappApiReady } from "@/lib/services/whatsapp-cloud";
import { countUnseen, relinkCardCustomer, relinkCaseMessages, relinkCustomerMessages } from "@/lib/services/whatsapp-db";
import { threadOf } from "@/lib/services/whatsapp-thread";
import { ROOM_COMPOSITIONS, roomPrice, toPriceMatrix } from "@/lib/tours/pricing";
import { departureSiteId, LEAD_KIND_LABELS } from "@/types/tours.types";
import type { Database, Json } from "@/types/database.types";
import { MAX_TRAVELERS, TRAVELERS_RULE, type ToursReservationRow } from "@/components/tours/reservations/types";
import {
  CASE_SOURCE_LABELS,
  CASE_TYPE_LABELS,
  PHONES_MAX,
  SEASON_MAX,
  TODAY_REASON_LABELS,
  bookingBlocksDelete,
  bookingPhase,
  checkFuture,
  cleanPhones,
  closeBlockedBy,
  customerLabel,
  customerName,
  inquiriesOf,
  isOfferChannel,
  knownFrom,
  owedSeatRefs,
  parseOffer,
  paymentAnswerOf,
  caseName,
  checkCloseReason,
  isClosedStatus,
  isPaidStatus,
  needsCloseReason,
  phoneKey,
  sameEmailSuggestion,
  seasonOptions,
  statusAfterLink,
  statusOnReturn,
  todayRank,
  todayReason,
  whatsappAppLink,
  whatsappPhone,
  type BoardOrder,
  type BoardPage,
  type CaseCandidate,
  type CustomerCandidate,
  type CustomerChange,
  type CustomerInfo,
  type CustomerPageData,
  type FutureTour,
  type KnownFrom,
  confirmationPendingOf,
  LINK_ROOMS_MAX,
  bookingLink,
  cleanRoomKeys,
  isCaseSource,
  isCaseType,
  linkMessage,
  packagePathOf,
  seatBookingOf,
  seatGap,
  sourceLabel,
  splitName,
  statusOf,
  validateStatuses,
  waLink,
  type BookingLinkResult,
  type CaseOffer,
  type LinkQuote,
  type OfferChannel,
  type CaseChange,
  type CaseDetail,
  type CaseHistoryItem,
  type CaseRep,
  type CaseRow,
  type CasesPage,
  type CaseStatus,
  type SeatBooking,
  type SeatHold,
  type LinkDeparture,
  type NewCaseInput,
  type StatusDraft,
} from "@/lib/tours/cases";

const SCOPE = "tours-cases-actions";
/** The screen loads the company's cases in one go, newest first, up to this many. */
const LIST_LIMIT = 5000;
const NOTES_MAX = 4000;
const NAME_MAX = 80;
const ACC_MAX = 40;
const HISTORY_MAX = 100;
const BULK_MAX = 500;
const IN_CHUNK = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NATIONAL_ID = /^\d{5,9}$/;

const CASE_COLUMNS =
  "id, case_no, created_at, updated_at, type, kind, status, name, first_name, last_name, phone, email, id_number, acc_num, notes, message, assigned_to, follow_up_date, source, utm, source_path, departure_id, package_id, link_token, link_sent_at, payload, close_reason, related_lead_id, offer, customer_id, to_file, season, notes_at, wa_seen_at";

/** The same without wa_seen_at (20261021172647), without notes_at (20261021164145), then without the customer columns (20261019180000): a deploy that beat its migration still reads. */
const CASE_COLUMNS_NO_WA = CASE_COLUMNS.replace(", wa_seen_at", "");
const CASE_COLUMNS_NO_NOTES_AT = CASE_COLUMNS_NO_WA.replace(", notes_at", "");
const LEGACY_CASE_COLUMNS = CASE_COLUMNS_NO_NOTES_AT.replace(", customer_id, to_file, season", "");
const CASE_COLUMN_SETS = [CASE_COLUMNS, CASE_COLUMNS_NO_WA, CASE_COLUMNS_NO_NOTES_AT, LEGACY_CASE_COLUMNS];
/** Reads with the full column list, then without each column set a missing migration would lack. */
async function readCaseColumns<T extends { error: { code?: string; message?: string } | null | undefined }>(read: (columns: string) => PromiseLike<T>): Promise<T> {
  let answer = await read(CASE_COLUMN_SETS[0]);
  for (let i = 1; i < CASE_COLUMN_SETS.length && missingColumn(answer.error); i++) answer = await read(CASE_COLUMN_SETS[i]);
  return answer;
}
const missingColumn = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === "42703" ||
  error?.code === "PGRST204" ||
  /(close_reason|related_lead_id|offer|customer_id|to_file|season|notes_at|wa_seen_at).*does not exist/.test(error?.message ?? "");
/** public.customers is not there yet (the migration runs on the push to master). */
const missingTable = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === "42P01" || error?.code === "PGRST205" || /relation .*customers.* does not exist/.test(error?.message ?? "");
const NOT_READY = "Customers are available after the system update - try again in a few minutes.";

type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
type CaseRecord = Pick<
  LeadRow,
  | "id"
  | "case_no"
  | "created_at"
  | "updated_at"
  | "type"
  | "kind"
  | "status"
  | "name"
  | "first_name"
  | "last_name"
  | "phone"
  | "email"
  | "id_number"
  | "acc_num"
  | "notes"
  | "message"
  | "assigned_to"
  | "follow_up_date"
  | "source"
  | "utm"
  | "source_path"
  | "departure_id"
  | "package_id"
  | "link_token"
  | "link_sent_at"
  | "payload"
  | "close_reason"
  | "related_lead_id"
  | "offer"
  | "customer_id"
  | "to_file"
  | "season"
  | "notes_at"
  | "wa_seen_at"
>;
type LeadUpdate = Database["public"]["Tables"]["leads"]["Update"];
type CustomerRecord = Database["public"]["Tables"]["customers"]["Row"];

/** An order of the case as the board lists it, before the seats chip is known. */
interface RawOrder {
  ref: string;
  source: "site" | "staff";
  status: string;
  departureId: string;
  travelers: number;
  total: number | null;
  currency: string | null;
  createdAt: string;
}

/** What a row needs from the departure, the tour, the newest booking and the seats. */
interface Enrichment {
  departures: Map<string, { code: string; startDate: string; packageId: string | null; tourName: string | null }>;
  packages: Map<string, string>;
  bookings: Map<string, { ref: string; status: string; confirmationPending: boolean }>;
  /** Every booking's status, newest first - what paymentAnswerOf reads. */
  bookingStatuses: Map<string, string[]>;
  travelers: Map<string, number>;
  /** Every booking of the case, newest first, and its seat ledger - what seatGap reads. */
  seatBookings: Map<string, SeatBooking[]>;
  seatHolds: Map<string, SeatHold[]>;
  /** The case number of each related case (related_lead_id), live ones only. */
  related: Map<string, number>;
  /** Each customer's number (customer_id -> customer_no). */
  customers: Map<string, number>;
  /** The case's orders: its site bookings and the seat rows a rep typed (each with its T number). */
  orders: Map<string, RawOrder[]>;
  /** Inbound WhatsApp messages after each card's wa_seen_at (empty before the migration or on a failed read). */
  waUnseen: Map<string, number>;
}

const clean = (value: string | null | undefined, max: number): string | null => {
  const text = (value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  return text === "" ? null : text;
};

// ---------------------------------------------------------------- reads shared by the actions
/** The company's status list, in its order (lib/tours/case-seats.ts - the booking actions read it too). */
const statusesOf = (company: Company): Promise<CaseStatus[]> => readCaseStatuses(company);

/** Staff who can own a case - the people the company's tasks can be given to. */
async function repsOf(company: Company): Promise<CaseRep[]> {
  const people = await taskPeopleOf(company);
  if (!people) throw new Error("cases: the staff list could not be read");
  return people
    .map((p) => ({ id: p.id, name: p.display_name || p.email }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

async function enrich(companyId: string, records: CaseRecord[]): Promise<Enrichment> {
  const departureIds = [...new Set(records.map((r) => r.departure_id).filter((v): v is string => !!v))];
  const caseIds = records.map((r) => r.id);
  const out: Enrichment = {
    departures: new Map(),
    packages: new Map(),
    bookings: new Map(),
    bookingStatuses: new Map(),
    travelers: new Map(),
    seatBookings: new Map(),
    seatHolds: new Map(),
    related: new Map(),
    customers: new Map(),
    orders: new Map(),
    waUnseen: new Map(),
  };
  const addOrder = (leadId: string, order: RawOrder) => out.orders.set(leadId, [...(out.orders.get(leadId) ?? []), order]);

  const readDepartures = async () => {
    for (const part of chunk(departureIds, IN_CHUNK)) {
      const { data, error } = await toursDb()
        .from("departures")
        .select("id, code, start_date, package_id, packages(name)")
        .eq("company_id", companyId)
        .in("id", part);
      if (error) throw new Error(`departures: ${error.message}`);
      for (const d of data ?? []) {
        out.departures.set(d.id, {
          code: d.code,
          startDate: d.start_date,
          packageId: d.package_id,
          tourName: (d.packages as { name: string } | null)?.name ?? null,
        });
      }
    }
  };
  const readPackages = async () => {
    const ids = [...new Set(records.map((r) => r.package_id).filter((v): v is string => !!v))];
    for (const part of chunk(ids, IN_CHUNK)) {
      const { data, error } = await toursDb().from("packages").select("id, name").eq("company_id", companyId).in("id", part);
      if (error) throw new Error(`packages: ${error.message}`);
      for (const p of data ?? []) out.packages.set(p.id, p.name);
    }
  };
  const readBookings = async () => {
    for (const part of chunk(caseIds, IN_CHUNK)) {
      const { data, error } = await toursDb()
        .from("bookings")
        .select("lead_id, ref, status, kind, confirmation_sent_at, created_at, departure_id, adults, children, sales_entry_id, total, currency")
        .eq("company_id", companyId)
        .in("lead_id", part)
        .is("is_deleted", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`bookings: ${error.message}`);
      const all = new Map<string, { status: string; confirmationSentAt: string | null }[]>();
      for (const b of data ?? []) {
        if (!b.lead_id) continue;
        // newest first: the first one seen per case is the one the row names
        if (!out.bookings.has(b.lead_id)) out.bookings.set(b.lead_id, { ref: b.ref, status: b.status, confirmationPending: false });
        all.set(b.lead_id, [...(all.get(b.lead_id) ?? []), { status: b.status, confirmationSentAt: b.confirmation_sent_at }]);
        out.bookingStatuses.set(b.lead_id, [...(out.bookingStatuses.get(b.lead_id) ?? []), b.status]);
        addOrder(b.lead_id, {
          ref: b.ref,
          source: "site",
          status: b.status,
          departureId: b.departure_id,
          travelers: b.adults + b.children,
          total: b.total === null || b.total === undefined ? null : Number(b.total),
          currency: b.currency ?? null,
          createdAt: b.created_at,
        });
        const seat = seatBookingOf({
          ref: b.ref,
          status: b.status,
          departureId: b.departure_id,
          adults: b.adults,
          children: b.children,
          kind: b.kind,
          createdAt: b.created_at,
          salesEntryId: b.sales_entry_id,
        });
        out.seatBookings.set(b.lead_id, [...(out.seatBookings.get(b.lead_id) ?? []), seat]);
      }
      // "send the confirmation" while ANY paid booking of the case waits for it, not only the newest
      for (const [leadId, list] of all) {
        const row = out.bookings.get(leadId);
        if (row) row.confirmationPending = confirmationPendingOf(list);
      }
    }
  };
  const readSeats = async () => {
    for (const part of chunk(caseIds, IN_CHUNK)) {
      const read = (columns: string) =>
        toursDb().from("departure_sales_entries").select(columns).eq("company_id", companyId).in("lead_id", part).is("is_deleted", null);
      // `ref` arrives with the customers migration; before it a typed order simply has no number
      let { data, error } = await read("id, lead_id, pax, departure_id, ref, created_at");
      if (missingColumn(error)) ({ data, error } = await read("id, lead_id, pax, departure_id, created_at"));
      if (error) throw new Error(`departure_sales_entries: ${error.message}`);
      const rows = (data ?? []) as unknown as { id: string; lead_id: string | null; pax: number; departure_id: string; ref?: string | null; created_at: string }[];
      for (const e of rows) {
        if (!e.lead_id) continue;
        out.travelers.set(e.lead_id, (out.travelers.get(e.lead_id) ?? 0) + e.pax);
        out.seatHolds.set(e.lead_id, [...(out.seatHolds.get(e.lead_id) ?? []), { id: e.id, departureId: e.departure_id, pax: e.pax }]);
        if (e.ref) {
          addOrder(e.lead_id, {
            ref: e.ref,
            source: "staff",
            status: "staff",
            departureId: e.departure_id,
            travelers: e.pax,
            total: null,
            currency: null,
            createdAt: e.created_at,
          });
        }
      }
    }
  };
  const readCustomers = async () => {
    const ids = [...new Set(records.map((r) => r.customer_id).filter((v): v is string => !!v))];
    for (const part of chunk(ids, IN_CHUNK)) {
      const { data, error } = await supabaseTyped.from("customers").select("id, customer_no").eq("company_id", companyId).in("id", part);
      if (missingTable(error)) return;
      if (error) throw new Error(`customers: ${error.message}`);
      for (const c of data ?? []) out.customers.set(c.id, c.customer_no);
    }
  };
  const readRelated = async () => {
    const ids = [...new Set(records.map((r) => r.related_lead_id).filter((v): v is string => !!v))];
    for (const part of chunk(ids, IN_CHUNK)) {
      const { data, error } = await supabaseTyped.from("leads").select("id, case_no").eq("company_id", companyId).in("id", part).is("is_deleted", null);
      if (error) throw new Error(`leads: ${error.message}`);
      for (const l of data ?? []) out.related.set(l.id, l.case_no);
    }
  };
  // a failed WhatsApp count never fails the board - the chip reads 0 and the thread on the card says why
  const readWaUnseen = async () => {
    try {
      out.waUnseen = await countUnseen(records.map((r) => ({ id: r.id, waSeenAt: r.wa_seen_at ?? null })));
    } catch (e) {
      console.error("cases: wa unseen count failed:", e instanceof Error ? e.message : e);
    }
  };
  await Promise.all([readDepartures(), readPackages(), readBookings(), readSeats(), readRelated(), readCustomers(), readWaUnseen()]);
  // the bookings' own departures (a booking may sit on another date than its case)
  const bookingDeps = [...out.orders.values()].flat().map((o) => o.departureId).filter((id) => !out.departures.has(id));
  if (bookingDeps.length) {
    const deps = await departuresOf(companyId, bookingDeps);
    for (const [id, d] of deps) out.departures.set(id, { code: d.code, startDate: d.start_date, packageId: null, tourName: null });
  }
  return out;
}

/** A case's orders as the board shows them: the seats chip from owedSeatRefs, the phase from the trip's day. */
function ordersOf(r: CaseRecord, x: Enrichment, statuses: readonly CaseStatus[], today: string): BoardOrder[] {
  const raw = x.orders.get(r.id) ?? [];
  const seatBookings = x.seatBookings.get(r.id) ?? [];
  const holds = x.seatHolds.get(r.id) ?? [];
  const owed = owedSeatRefs(statuses, seatBookings, holds);
  // a typed order is cancelled by a minus row on its date: the seat rows of no booking, netted per departure
  const bound = new Set(seatBookings.map((b) => b.salesEntryId).filter((v): v is string => !!v));
  const typedNet = new Map<string, number>();
  for (const h of holds) if (!h.id || !bound.has(h.id)) typedNet.set(h.departureId, (typedNet.get(h.departureId) ?? 0) + h.pax);
  return raw
    .map((o) => {
      const departure = x.departures.get(o.departureId);
      const settled = o.status === "done" || o.status === "paid";
      const typedGone = o.source === "staff" && (typedNet.get(o.departureId) ?? 0) <= 0;
      return {
        ref: o.ref,
        source: o.source,
        cardId: r.id,
        status: typedGone ? "cancelled" : o.status,
        phase: typedGone ? "cancelled" : bookingPhase({ status: o.status, departureStart: departure?.startDate ?? null }, today),
        departureCode: departure?.code ?? null,
        departureDate: departure?.startDate ?? null,
        travelers: o.travelers,
        total: o.total,
        currency: o.currency,
        // a typed order is a seat row itself
        seats: o.source === "staff" ? (typedGone ? null : "held") : settled ? (owed.has(o.ref) ? "missing" : "held") : null,
        createdAt: o.createdAt,
      } satisfies BoardOrder;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function toCaseRow(r: CaseRecord, x: Enrichment, statuses: readonly CaseStatus[]): CaseRow {
  const departure = r.departure_id ? x.departures.get(r.departure_id) : undefined;
  const booking = x.bookings.get(r.id);
  // a row written before the case columns existed may carry only `name`
  const split = !r.first_name && !r.last_name ? splitName(r.name) : null;
  return {
    id: r.id,
    caseNo: r.case_no,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    arrivedAt: arrivalOf(r.created_at, inquiriesOf(asObject(r.payload)).map((i) => i.at)),
    type: isCaseType(r.type) ? r.type : "lead",
    kind: r.kind,
    status: r.status,
    firstName: split ? split.first || null : r.first_name,
    lastName: split ? split.last || null : r.last_name,
    phone: r.phone,
    email: r.email,
    idNumber: r.id_number,
    accNum: r.acc_num,
    notes: r.notes,
    notesAt: r.notes_at ?? null,
    message: r.message,
    assignedTo: r.assigned_to,
    followUpDate: r.follow_up_date,
    source: r.source,
    utm: asObject(r.utm),
    sourcePath: r.source_path,
    departureId: r.departure_id,
    departureCode: departure?.code ?? null,
    departureDate: departure?.startDate ?? null,
    packageId: r.package_id ?? departure?.packageId ?? null,
    tourName: departure?.tourName ?? (r.package_id ? (x.packages.get(r.package_id) ?? null) : null),
    customerId: r.customer_id ?? null,
    customerNo: r.customer_id ? (x.customers.get(r.customer_id) ?? null) : null,
    // an inquiry that got a booking since is a card like any other
    toFile: !!r.to_file && !booking,
    season: r.season ?? null,
    bookingRef: booking?.ref ?? null,
    bookingStatus: booking?.status ?? null,
    paymentAnswer: paymentAnswerOf(r.status, x.bookingStatuses.get(r.id) ?? []),
    confirmationPending: booking?.confirmationPending ?? false,
    // filled by the thread read (Task 7 of the WhatsApp plan); 0 / null until then and before the migration
    waUnseen: x.waUnseen.get(r.id) ?? 0,
    waSeenAt: r.wa_seen_at ?? null,
    travelers: x.travelers.get(r.id) ?? 0,
    seatsMissing: seatGap(r.status, statuses, x.seatBookings.get(r.id) ?? [], x.seatHolds.get(r.id) ?? [])?.missing ?? 0,
    closeReason: r.close_reason ?? null,
    relatedCaseNo: r.related_lead_id ? (x.related.get(r.related_lead_id) ?? null) : null,
    offer: parseOffer(r.offer),
  };
}

/** One case of the company (not deleted), or a UserError. */
/**
 * One case of the company (not deleted), or a UserError. With a `viewer`, a card the viewer may not see (another
 * rep's - lib/tours/board.ts canSeeCard) is refused: every user-triggered single-card action passes it on its FIRST
 * read; the re-read that answers a fresh row after a write passes none (a rep handing a card away still gets it back).
 */
async function caseRecord(company: Company, id: string, viewer?: BoardViewer): Promise<CaseRecord> {
  if (!UUID.test(id)) throw new UserError("The case was not found.");
  const read = (columns: string) =>
    supabaseTyped.from("leads").select(columns).eq("company_id", company.id).eq("id", id).is("is_deleted", null).maybeSingle();
  const { data, error } = await readCaseColumns(read);
  if (error) throw new Error(`leads: ${error.message}`);
  if (!data) throw new UserError("The case was not found - it may have been deleted.");
  const record = withDefaults(data as unknown as CaseRecord);
  if (viewer && !canSeeCard({ assignedTo: record.assigned_to }, viewer)) throw new UserError("This card belongs to another rep");
  return record;
}

/** A row read before a migration lacks its columns: they read as empty. */
const withDefaults = (record: CaseRecord): CaseRecord => ({
  ...record,
  close_reason: record.close_reason ?? null,
  related_lead_id: record.related_lead_id ?? null,
  offer: record.offer ?? null,
  customer_id: record.customer_id ?? null,
  to_file: record.to_file ?? false,
  season: record.season ?? null,
  notes_at: record.notes_at ?? null,
  wa_seen_at: record.wa_seen_at ?? null,
});

/** Every case of the company (not deleted), newest first - tolerant of the close_reason migration. */
async function allCaseRecords(company: Company) {
  const read = (columns: string) =>
    fetchPaged<CaseRecord>(
      () =>
        supabaseTyped
          .from("leads")
          .select(columns)
          .eq("company_id", company.id)
          .is("is_deleted", null)
          // case_no is unique: paging never skips or repeats a row
          .order("case_no", { ascending: false }),
      LIST_LIMIT,
    );
  return readCaseColumns(read);
}

async function freshRow(company: Company, id: string): Promise<CaseRow> {
  const record = await caseRecord(company, id);
  const [x, statuses] = await Promise.all([enrich(company.id, [record]), statusesOf(company)]);
  return toCaseRow(record, x, statuses);
}

/** Each case's site bookings (ref + status), newest first - what closeBlockedBy reads. */
async function liveBookingsOf(company: Company, ids: string[]): Promise<Map<string, { ref: string; status: string }[]>> {
  const out = new Map<string, { ref: string; status: string }[]>();
  for (const part of chunk(ids, IN_CHUNK)) {
    const { data, error } = await toursDb()
      .from("bookings")
      .select("lead_id, ref, status")
      .eq("company_id", company.id)
      .in("lead_id", part)
      .is("is_deleted", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`bookings: ${error.message}`);
    for (const b of data ?? []) if (b.lead_id) out.set(b.lead_id, [...(out.get(b.lead_id) ?? []), { ref: b.ref, status: b.status }]);
  }
  return out;
}

/** A tour of the company that a card may name. */
async function companyPackage(company: Company, id: string): Promise<{ id: string; name: string }> {
  if (!UUID.test(id)) throw new UserError("Choose a tour.");
  const { data, error } = await toursDb().from("packages").select("id, name").eq("company_id", company.id).eq("id", id).is("is_deleted", null).maybeSingle();
  if (error) throw new Error(`packages: ${error.message}`);
  if (!data) throw new UserError("The tour was not found - it may have been deleted.");
  return data;
}

/** A departure of the company that a case may point at. */
async function companyDeparture(company: Company, id: string): Promise<{ id: string; code: string; package_id: string }> {
  if (!UUID.test(id)) throw new UserError("Choose a departure.");
  const { data, error } = await toursDb()
    .from("departures")
    .select("id, code, package_id")
    .eq("company_id", company.id)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) throw new Error(`departures: ${error.message}`);
  if (!data) throw new UserError("The departure was not found - it may have been deleted.");
  return data;
}

// ---------------------------------------------------------------- the screen
/** The Reservations screen in one load: every case, the status list and the reps. */
export async function listCases(): Promise<ActionResult<CasesPage>> {
  try {
    const { session, company } = await requireCompany("tours");
    const [page, statuses, reps, viewer] = await Promise.all([allCaseRecords(company), statusesOf(company), repsOf(company), boardViewerFor(session, company)]);
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    const x = await enrich(company.id, page.rows);
    return actionOk({
      rows: visibleCards(
        page.rows.map((r) => toCaseRow(r, x, statuses)),
        viewer,
      ),
      truncated: page.truncated,
      statuses,
      reps,
      currentUserId: session.sub,
      viewer,
    });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the reservations");
  }
}

/**
 * Change one case. Every field is checked before anything is written; the
 * audit records each change (notes as their length only - a customer
 * conversation stays out of the trail). Answers the fresh row.
 */
export async function updateCase(id: string, change: CaseChange): Promise<ActionResult<CaseRow>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const before = await caseRecord(company, id, viewer);
    const patch: LeadUpdate = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set = <K extends keyof LeadUpdate>(column: K, from: unknown, to: LeadUpdate[K]) => {
      if ((from ?? null) === (to ?? null)) return;
      patch[column] = to;
      changes[column as string] = { from: from ?? null, to: to ?? null };
    };

    let settled = false;
    if (change.status !== undefined && change.status !== before.status) {
      const statuses = await statusesOf(company);
      const status = statusOf(change.status, statuses);
      if (!status || !status.isActive) throw new UserError("Unknown status - reload the screen.");
      // "not relevant" (and any closing but Done / Spam) says why, or it is not saved (Alon 15.10)
      if (needsCloseReason(status.key, statuses)) {
        // ...and a case whose booking is live is not irrelevant: the booking is cancelled first (Alon 18.10)
        const blocking = closeBlockedBy(status.key, statuses, (await liveBookingsOf(company, [id])).get(id) ?? []);
        if (blocking) throw new UserError(`Booking ${blocking} on this case is live - set it Cancelled first, then close the case as "${status.label}".`);
        const checked = checkCloseReason(change.closeReason);
        if (!checked.ok) throw new UserError(checked.error);
        set("close_reason", before.close_reason, checked.reason);
      } else if (!isClosedStatus(status.key, statuses)) {
        set("close_reason", before.close_reason, null);
      }
      // a card payment with another amount is checked on the booking first: "paid" here would hold seats for it unseen
      if (before.status === "pending_payment" && (status.key === "paid" || status.key === "deposit_paid")) {
        const bookings = (await liveBookingsOf(company, [id])).get(id) ?? [];
        if (paymentAnswerOf(before.status, bookings.map((b) => b.status)) === "review") {
          throw new UserError(`Booking ${bookings[0]?.ref ?? ""}'s card charge has another amount - check it in CreditGuard and set the booking "Paid" first.`);
        }
      }
      set("status", before.status, status.key);
      settled = status.key === "paid" || status.key === "done" || status.key === "deposit_paid";
    }
    if (change.assignedTo !== undefined && change.assignedTo !== before.assigned_to) {
      if (change.assignedTo !== null && !(await repsOf(company)).some((p) => p.id === change.assignedTo)) {
        throw new UserError("A case can be assigned only to a member of the company's staff.");
      }
      set("assigned_to", before.assigned_to, change.assignedTo);
    }
    if (change.followUpDate !== undefined) {
      if (change.followUpDate !== null && !DAY.test(change.followUpDate)) throw new UserError("The follow-up date is not a valid day.");
      set("follow_up_date", before.follow_up_date, change.followUpDate);
    }
    if (change.notes !== undefined) {
      const notes = change.notes.trim();
      if (notes.length > NOTES_MAX) throw new UserError(`Notes can be up to ${NOTES_MAX} characters.`);
      if (notes !== (before.notes ?? "")) {
        patch.notes = notes || null;
        // TODAY highlights a note written today (Alon 21.10)
        if (notes) patch.notes_at = new Date().toISOString();
        changes.notes = { from: before.notes ? `${before.notes.length} chars` : null, to: notes ? `${notes.length} chars` : null };
      }
    }
    if (change.accNum !== undefined) set("acc_num", before.acc_num, clean(change.accNum, ACC_MAX));
    if (change.idNumber !== undefined) {
      const value = (change.idNumber ?? "").replace(/\D/g, "");
      if (value && !NATIONAL_ID.test(value)) throw new UserError("A national id is 5 to 9 digits.");
      set("id_number", before.id_number, value || null);
    }
    let namesChanged = false;
    let first = before.first_name;
    let last = before.last_name;
    if (change.firstName !== undefined) {
      first = clean(change.firstName, NAME_MAX);
      if (!first) throw new UserError("The first name cannot be empty.");
      set("first_name", before.first_name, first);
      namesChanged = true;
    }
    if (change.lastName !== undefined) {
      last = clean(change.lastName, NAME_MAX);
      set("last_name", before.last_name, last);
      namesChanged = true;
    }
    // the older readers (exports, mails) read `name`: keep it the two names joined
    if (namesChanged) set("name", before.name, [first, last].filter(Boolean).join(" ") || null);
    if (change.phone !== undefined) set("phone", before.phone, clean(change.phone, 40));
    if (change.email !== undefined) {
      const email = clean(change.email, 200)?.toLowerCase() ?? null;
      if (email && !EMAIL.test(email)) throw new UserError("The e-mail address is not valid.");
      set("email", before.email, email);
    }
    if (change.type !== undefined) {
      if (!isCaseType(change.type)) throw new UserError("Unknown type.");
      set("type", before.type, change.type);
    }
    if (change.departureId !== undefined) {
      if (change.departureId === null) {
        set("departure_id", before.departure_id, null);
      } else {
        const departure = await companyDeparture(company, change.departureId);
        set("departure_id", before.departure_id, departure.id);
        set("package_id", before.package_id, departure.package_id);
      }
    }
    // the tour without a date (a future lead) - a date of another tour no longer holds
    if (change.packageId !== undefined && change.departureId === undefined) {
      const packageId = change.packageId === null ? null : (await companyPackage(company, change.packageId)).id;
      set("package_id", before.package_id, packageId);
      if (before.departure_id && packageId !== before.package_id) set("departure_id", before.departure_id, null);
    }
    if (change.season !== undefined) {
      const season = clean(change.season, SEASON_MAX);
      set("season", before.season, season);
    }
    // "ליד עתידי" names the tour and the season (Nir 19.10)
    const nextStatus = (patch.status as string | undefined) ?? before.status;
    if (nextStatus === "future" && (patch.status !== undefined || change.packageId !== undefined || change.season !== undefined)) {
      const packageId = patch.package_id !== undefined ? patch.package_id : before.package_id;
      const season = patch.season !== undefined ? patch.season : before.season;
      const problem = checkFuture(packageId, season);
      if (problem) throw new UserError(problem);
    }
    if (change.source !== undefined) {
      if (!isCaseSource(change.source)) throw new UserError("Unknown source.");
      set("source", before.source, change.source);
    }

    if (Object.keys(patch).length) {
      let { error } = await supabaseTyped.from("leads").update(patch).eq("company_id", company.id).eq("id", id);
      if (missingColumn(error) && patch.notes_at !== undefined) {
        // a deploy that beat the notes_at migration: the note saves, the stamp waits
        const rest = { ...patch };
        delete rest.notes_at;
        ({ error } = await supabaseTyped.from("leads").update(rest).eq("company_id", company.id).eq("id", id));
      }
      if (missingColumn(error)) throw new UserError("A closing reason can be saved after the system update - try again in a few minutes.");
      if (error) throw new Error(`leads: ${error.message}`);
      await logAudit({
        action: "update",
        entityType: "tours_case",
        entityId: id,
        changes,
        metadata: { ...companyAudit(company), case_no: before.case_no },
      });
      revalidatePath("/tours/reservations");
    }
    // a deal closed by hand puts its travelers on the departure, as a card payment does (Dor 15.10)
    const held = settled ? await holdOwedSeats(company, id, session.sub) : null;
    return actionOk(await freshRow(company, id), held ? seatsHeldNote(held) : undefined);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to update the case");
  }
}

const seatsHeldNote = (held: { ref: string; pax: number; departureCode: string | null }): string =>
  `${held.pax === 1 ? "1 seat" : `${held.pax} seats`} of ${held.ref.includes(",") ? "bookings" : "booking"} ${held.ref} now held on the departure${held.departureCode ? ` (${held.departureCode})` : ""}.`;

/** The status or the rep of several cases at once (the screen's bulk bar). */
export async function bulkUpdateCases(
  ids: string[],
  change: { status?: string; assignedTo?: string | null; closeReason?: string },
): Promise<ActionResult<{ updated: number }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const unique = [...new Set(ids)];
    if (unique.length === 0 || unique.length > BULK_MAX) throw new UserError(`Select between 1 and ${BULK_MAX} rows.`);
    if (unique.some((id) => !UUID.test(id))) throw new UserError("A selected case was not found - reload the screen.");
    const patch: LeadUpdate = {};
    if (change.status !== undefined) {
      const statuses = await statusesOf(company);
      const status = statusOf(change.status, statuses);
      if (!status || !status.isActive) throw new UserError("Unknown status - reload the screen.");
      if (status.key === "future") throw new UserError(`"${status.label}" names a tour and a season - set it on each card.`);
      patch.status = status.key;
      // the same rule as one case: a closing status says why, one reason for the whole selection
      if (needsCloseReason(status.key, statuses)) {
        const bookings = await liveBookingsOf(company, unique);
        const blocked = unique.map((id) => closeBlockedBy(status.key, statuses, bookings.get(id) ?? [])).filter((ref): ref is string => !!ref);
        if (blocked.length) {
          throw new UserError(
            `${blocked.length === 1 ? `Booking ${blocked[0]} is` : `Bookings ${blocked.slice(0, 5).join(", ")}${blocked.length > 5 ? "…" : ""} are`} live - cancel ${blocked.length === 1 ? "it" : "them"} first, or leave those cases out of the selection.`,
          );
        }
        const checked = checkCloseReason(change.closeReason);
        if (!checked.ok) throw new UserError(checked.error);
        patch.close_reason = checked.reason;
      } else if (!isClosedStatus(status.key, statuses)) {
        patch.close_reason = null;
      }
    }
    if (change.assignedTo !== undefined) {
      // handing out leads in bulk is the manager's (Dor 21.10)
      if (!viewer.manager) throw new UserError("Only a manager assigns cards in bulk.");
      if (change.assignedTo !== null && !(await repsOf(company)).some((p) => p.id === change.assignedTo)) {
        throw new UserError("A case can be assigned only to a member of the company's staff.");
      }
      patch.assigned_to = change.assignedTo;
    }
    if (Object.keys(patch).length === 0) throw new UserError("Nothing to change.");
    if (!viewer.manager) {
      for (const part of chunk(unique, IN_CHUNK)) {
        const { data, error } = await supabaseTyped.from("leads").select("id, assigned_to").eq("company_id", company.id).in("id", part);
        if (error) throw new Error(`leads: ${error.message}`);
        if ((data ?? []).some((row) => !canSeeCard({ assignedTo: row.assigned_to }, viewer))) throw new UserError("A selected card belongs to another rep - reload the screen.");
      }
    }

    const before: { id: string; case_no: number; status: string; assigned_to: string | null }[] = [];
    for (const part of chunk(unique, IN_CHUNK)) {
      const { data, error } = await supabaseTyped
        .from("leads")
        .update(patch)
        .eq("company_id", company.id)
        .is("is_deleted", null)
        .in("id", part)
        .select("id, case_no, status, assigned_to");
      if (missingColumn(error)) throw new UserError("A closing reason can be saved after the system update - try again in a few minutes.");
      if (error) throw new Error(`leads: ${error.message}`);
      before.push(...(data ?? []));
    }
    for (const row of before) {
      await logAudit({
        action: "update",
        entityType: "tours_case",
        entityId: row.id,
        changes: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { to: v }])),
        metadata: { ...companyAudit(company), case_no: row.case_no, bulk: true },
      });
    }
    // closed by hand in bulk: the same seats as one case closed by hand
    let heldSeats = 0;
    if (patch.status === "paid" || patch.status === "done" || patch.status === "deposit_paid") {
      for (const row of before) heldSeats += (await holdOwedSeats(company, row.id, session.sub))?.pax ?? 0;
    }
    revalidatePath("/tours/reservations");
    return actionOk({ updated: before.length }, heldSeats ? `${heldSeats} seats of closed bookings now held on their departures.` : undefined);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to update the cases");
  }
}

/** A case staff open by hand. A reservation also puts its travelers on the departure's seats. */
export async function createCase(input: NewCaseInput): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isCaseType(input.type)) throw new UserError("Choose a type.");
    if (!isCaseSource(input.source)) throw new UserError("Choose how the customer reached us.");
    // "+ New card" on a customer's page: the contact is the customer's own
    const customer = input.customerId ? await customerRecord(company, input.customerId) : null;
    const first = clean(input.firstName, NAME_MAX) ?? customer?.first_name ?? null;
    if (!first) throw new UserError("Enter the customer's first name.");
    const last = clean(input.lastName, NAME_MAX) ?? customer?.last_name ?? null;
    const phone = clean(input.phone, 40) ?? customer?.phones[0] ?? null;
    const email = clean(input.email, 200)?.toLowerCase() ?? customer?.email ?? null;
    if (!phone && !email) throw new UserError("Enter a phone number or an e-mail address.");
    if (email && !EMAIL.test(email)) throw new UserError("The e-mail address is not valid.");
    const idNumber = (input.idNumber ?? "").replace(/\D/g, "") || customer?.id_number || null;
    if (idNumber && !NATIONAL_ID.test(idNumber)) throw new UserError("A national id is 5 to 9 digits.");
    if (input.followUpDate && !DAY.test(input.followUpDate)) throw new UserError("The follow-up date is not a valid day.");
    const notes = (input.notes ?? "").trim();
    if (notes.length > NOTES_MAX) throw new UserError(`Notes can be up to ${NOTES_MAX} characters.`);

    const departure = input.departureId ? await companyDeparture(company, input.departureId) : null;
    let travelers = 0;
    if (input.type === "reservation") {
      if (!departure) throw new UserError("A reservation needs a departure.");
      travelers = Number(input.travelers);
      if (!Number.isInteger(travelers) || travelers < 1 || travelers > MAX_TRAVELERS) throw new UserError(TRAVELERS_RULE);
    }
    const reps = await repsOf(company);
    // "Unassigned" (null) is a choice; only a field left out defaults to whoever creates the case
    let assignedTo = input.assignedTo !== undefined ? input.assignedTo : reps.some((p) => p.id === session.sub) ? session.sub : null;
    if (assignedTo && !reps.some((p) => p.id === assignedTo)) assignedTo = null;

    const values = {
        company_id: company.id,
        kind: "manual",
        type: input.type,
        status: "new",
        name: [first, last].filter(Boolean).join(" "),
        first_name: first,
        last_name: last,
        phone,
        email,
        id_number: idNumber,
        source: input.source,
        assigned_to: assignedTo,
        notes: notes || null,
        notes_at: notes ? new Date().toISOString() : null,
        follow_up_date: input.followUpDate || null,
        departure_id: departure?.id ?? null,
        package_id: departure?.package_id ?? null,
        ...(customer ? { customer_id: customer.id, acc_num: customer.acc_num } : {}),
    };
    const insert = (row: typeof values | Omit<typeof values, "notes_at">) => supabaseTyped.from("leads").insert(row).select("id, case_no").single();
    let { data: created, error } = await insert(values);
    if (missingColumn(error)) {
      // a deploy that beat the notes_at migration: the card is created, the stamp waits
      const { notes_at: _stamp, ...rest } = values;
      void _stamp;
      ({ data: created, error } = await insert(rest));
    }
    if (error || !created) throw new Error(`leads: ${error?.message ?? "no row"}`);
    await logAudit({
      action: "create",
      entityType: "tours_case",
      entityId: created.id,
      changes: { type: input.type, source: input.source, departure_id: departure?.id ?? null, travelers: travelers || null },
      metadata: { ...companyAudit(company), case_no: created.case_no },
    });

    let warning: string | undefined;
    if (departure && travelers > 0) {
      const { error: seatsError } = await toursDb()
        .from("departure_sales_entries")
        .insert({
          company_id: company.id,
          departure_id: departure.id,
          pax: travelers,
          note: `Entered with case ${created.case_no}`,
          customer_name: [first, last].filter(Boolean).join(" "),
          customer_phone: phone,
          customer_email: email,
          lead_id: created.id,
          entered_by: session.sub,
        });
      if (seatsError) {
        console.error(`${SCOPE}: seats of case ${created.case_no} not added:`, seatsError.message);
        warning = "The case was created, but its travelers were not added to the departure - add them on the case page.";
      }
    }
    revalidatePath("/tours/reservations");
    return actionOk({ id: created.id }, warning);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to create the case");
  }
}

/** Marks a case deleted (it stays recoverable). A case with a paid site booking is cancelled, not deleted. */
export async function deleteCase(id: string): Promise<ActionResult> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const before = await caseRecord(company, id, viewer);
    const { data: bookings, error: bookingsError } = await toursDb()
      .from("bookings")
      .select("ref, status")
      .eq("company_id", company.id)
      .eq("lead_id", id)
      .is("is_deleted", null);
    if (bookingsError) throw new Error(`bookings: ${bookingsError.message}`);
    // money taken or on the way: the booking would vanish with the case
    const live = (bookings ?? []).find((b) => bookingBlocksDelete(b.status));
    if (live) throw new UserError(`Booking ${live.ref} on this case is ${live.status === "paid" ? "paid" : live.status === "review" ? "waiting for a payment check" : "at the payment page"} - set the booking Cancelled (or Done) instead of deleting the case.`);
    const { error } = await supabaseTyped
      .from("leads")
      .update({ is_deleted: todayIso() })
      .eq("company_id", company.id)
      .eq("id", id);
    if (error) throw new Error(`leads: ${error.message}`);
    await logAudit({
      action: "delete",
      entityType: "tours_case",
      entityId: id,
      changes: { case_no: before.case_no, name: before.name, phone: before.phone },
      metadata: { ...companyAudit(company), soft: true },
    });
    revalidatePath("/tours/reservations");
    return actionOk(undefined);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to delete the case");
  }
}

/** Saves the company's status list (order, names, colours, closed / on) - checked whole before any write. */
export async function saveCaseStatuses(drafts: StatusDraft[]): Promise<ActionResult<CaseStatus[]>> {
  try {
    const { company } = await requireCompany("tours");
    if (!Array.isArray(drafts)) throw new UserError("Nothing to save.");
    const current = await statusesOf(company);
    const checked = validateStatuses(drafts, current);
    if (!checked.ok) throw new UserError(checked.error);
    const { error } = await supabaseTyped.from("lead_statuses").upsert(
      checked.statuses.map((s, position) => ({
        company_id: company.id,
        key: s.key,
        label: s.label,
        color: s.color,
        position,
        is_closed: s.isClosed,
        is_system: s.isSystem,
        is_active: s.isActive,
      })),
      { onConflict: "company_id,key" },
    );
    if (error) throw new Error(`lead_statuses: ${error.message}`);
    await logAudit({
      action: "update",
      entityType: "tours_case_status",
      entityId: company.id,
      changes: { before: current.map((s) => `${s.key}:${s.label}`), after: checked.statuses.map((s) => `${s.key}:${s.label}`) },
      metadata: companyAudit(company),
    });
    revalidatePath("/tours/reservations");
    return actionOk(checked.statuses);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save the statuses");
  }
}

// ---------------------------------------------------------------- the case page
type DepartureFull = {
  id: string;
  code: string;
  start_date: string;
  end_date: string;
  legacy_product_id: number | null;
  site_id: number;
  is_published: boolean;
  series_id: string;
  package_id: string;
};

async function historyOf(id: string): Promise<CaseHistoryItem[]> {
  const columns = "created_at, actor_email, action, entity_type, changes";
  // the case's own rows (and the old inbox's "lead" rows), then its bookings' and seats' rows
  const [own, linked] = await Promise.all([
    supabaseTyped
      .from("audit_log")
      .select(columns)
      .in("entity_type", ["tours_case", "lead"])
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_MAX),
    supabaseTyped
      .from("audit_log")
      .select(columns)
      .in("entity_type", ["tours_booking", "tours_reservation"])
      .eq("metadata->>lead_id", id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_MAX),
  ]);
  if (own.error) throw new Error(`audit_log: ${own.error.message}`);
  if (linked.error) throw new Error(`audit_log: ${linked.error.message}`);
  return [...(own.data ?? []), ...(linked.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, HISTORY_MAX)
    .map((r) => ({
      at: r.created_at,
      actor: r.actor_email,
      action: r.entity_type === "tours_booking" ? `booking ${r.action}` : r.entity_type === "tours_reservation" ? `seats ${r.action}` : r.action,
      changes: asObject(r.changes as never),
    }));
}

/** The case page in one load: the case, its bookings, seats, tour, gift, history, statuses and reps. */
export async function getCase(id: string): Promise<ActionResult<CaseDetail>> {
  try {
    const { session, company } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const record = await caseRecord(company, id, viewer);

    const readDeparture = async (): Promise<DepartureFull | null> => {
      if (!record.departure_id) return null;
      const { data, error } = await toursDb()
        .from("departures")
        .select("id, code, start_date, end_date, legacy_product_id, site_id, is_published, series_id, package_id")
        .eq("company_id", company.id)
        .eq("id", record.departure_id)
        .maybeSingle();
      if (error) throw new Error(`departures: ${error.message}`);
      return data as DepartureFull | null;
    };
    const readBookings = async () => {
      const { data, error } = await toursDb()
        .from("bookings")
        .select("*")
        .eq("company_id", company.id)
        .eq("lead_id", id)
        .is("is_deleted", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`bookings: ${error.message}`);
      const rows = data ?? [];
      const deps = await departuresOf(company.id, rows.map((b) => b.departure_id));
      return rows.map((b) => bookingRowOf(b, deps.get(b.departure_id)));
    };
    const readSeats = async () => {
      const { data, error } = await toursDb()
        .from("departure_sales_entries")
        .select("id, departure_id, pax, docket_no, note, customer_name, customer_phone, customer_email, lead_id, entered_by, created_at")
        .eq("company_id", company.id)
        .eq("lead_id", id)
        .is("is_deleted", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`departure_sales_entries: ${error.message}`);
      return data ?? [];
    };

    const [statuses, reps, x, departure, bookings, seats, history, whatsapp] = await Promise.all([
      statusesOf(company),
      repsOf(company),
      enrich(company.id, [record]),
      readDeparture(),
      readBookings(),
      readSeats(),
      historyOf(id),
      threadOf(company, record.customer_id ?? null, record.phone ? [record.phone] : [], { viewer }),
    ]);

    const packageId = record.package_id ?? departure?.package_id ?? null;
    const repNames = new Map(reps.map((p) => [p.id, p.name]));
    // each order's payments and the tour's cancellation fees ride with the card (20261020150000 - empty before it)
    const [pkgAnswer, giftsAnswer, seatDepartures, paymentLog, cancellationRules] = await Promise.all([
      packageId
        ? toursDb().from("packages").select("id, name, slug, data, cancellation_html").eq("company_id", company.id).eq("id", packageId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      departure
        ? toursDb()
            .from("promotions")
            .select("label, valid_until")
            .eq("company_id", company.id)
            .eq("kind", "gift")
            .eq("is_active", true)
            .or(`departure_id.eq.${departure.id},series_id.eq.${departure.series_id}`)
        : Promise.resolve({ data: [], error: null }),
      departuresOf(company.id, seats.map((s) => s.departure_id)),
      readPaymentLog(company.id, bookings.map((b) => b.id), repNames),
      packageId ? readCancellationRules(company.id, packageId) : Promise.resolve([]),
    ]);
    if (pkgAnswer.error) throw new Error(`packages: ${pkgAnswer.error.message}`);
    if (giftsAnswer.error) throw new Error(`promotions: ${giftsAnswer.error.message}`);
    const pkg = pkgAnswer.data as { id: string; name: string; slug: string; data: unknown; cancellation_html: string | null } | null;
    const row = toCaseRow(record, x, statuses);

    const sales: ToursReservationRow[] = seats.map((s) => {
      const d = seatDepartures.get(s.departure_id);
      return {
        id: s.id,
        createdAt: s.created_at,
        departureId: s.departure_id,
        departureCode: d?.code ?? "",
        departureDate: d?.start_date ?? null,
        tourName: s.departure_id === departure?.id ? (pkg?.name ?? row.tourName) : null,
        pax: s.pax,
        docketNo: s.docket_no,
        note: s.note,
        customerName: s.customer_name,
        customerPhone: s.customer_phone,
        customerEmail: s.customer_email,
        leadId: s.lead_id,
        enteredBy: s.entered_by ? (repNames.get(s.entered_by) ?? null) : null,
      };
    });

    const payload = asObject(record.payload);
    const related = record.related_lead_id;
    const [[relatedCase], known] = await Promise.all([
      related && related !== record.id ? candidatesOf(company, [related], record) : Promise.resolve([] as CaseCandidate[]),
      knownOf(company, record, statuses),
    ]);
    return actionOk({
      row,
      payload,
      bookings: bookings.map((b) => ({ ...b, paymentLog: paymentLog.get(b.id) ?? [] })),
      cancellationRules,
      whatsapp,
      sales,
      departure: departure
        ? {
            id: departure.id,
            code: departure.code,
            startDate: departure.start_date,
            endDate: departure.end_date,
            siteId: departureSiteId(departure),
            isPublished: departure.is_published,
          }
        : null,
      pkg: pkg
        ? {
            id: pkg.id,
            name: pkg.name,
            path: packagePathOf(pkg.slug, (asObject(pkg.data as never).path as string | undefined) ?? null),
            cancellationHtml: pkg.cancellation_html,
          }
        : null,
      gifts: (giftsAnswer.data ?? []).map((g) => ({ label: g.label ?? "Gift", validUntil: g.valid_until })),
      history,
      statuses,
      reps,
      currentUserId: session.sub,
      viewer,
      siteUrl: company.siteUrl,
      linkSentAt: record.link_sent_at,
      relatedCase: relatedCase ?? null,
      whatsappApi: await whatsappApiReady(company),
      offer: parseOffer(record.offer),
      inquiries: inquiriesOf(payload, { name: customerName(row), email: row.email }),
      known,
    });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the case");
  }
}

/** The customer's other cards as knownFrom reads them (each with its tour's name). */
async function customerCards(company: Company, customerId: string): Promise<(KnownFrom & { id: string })[]> {
  const { data, error } = await supabaseTyped
    .from("leads")
    .select("id, case_no, status, close_reason, created_at, package_id")
    .eq("company_id", company.id)
    .eq("customer_id", customerId)
    .is("is_deleted", null);
  if (missingColumn(error)) return [];
  if (error) throw new Error(`leads: ${error.message}`);
  const packageIds = [...new Set((data ?? []).map((l) => l.package_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  for (const part of chunk(packageIds, IN_CHUNK)) {
    const { data: pkgs, error: pkgError } = await toursDb().from("packages").select("id, name").eq("company_id", company.id).in("id", part);
    if (pkgError) throw new Error(`packages: ${pkgError.message}`);
    for (const p of pkgs ?? []) names.set(p.id, p.name);
  }
  return (data ?? []).map((l) => ({
    id: l.id,
    caseNo: l.case_no,
    status: l.status,
    closeReason: l.close_reason,
    tourName: l.package_id ? (names.get(l.package_id) ?? null) : null,
    createdAt: l.created_at,
  }));
}

/** What the card should know about the customer's earlier deals (knownFrom), or null. */
async function knownOf(company: Company, record: CaseRecord, statuses: readonly CaseStatus[]): Promise<KnownFrom | null> {
  if (!record.customer_id) return null;
  return knownFrom({ id: record.id, createdAt: record.created_at }, await customerCards(company, record.customer_id), statuses);
}

/** "Hold N seats" on the case page: what each closed booking still owes, held now (the same rule as closing by hand). */
export async function holdCaseSeats(caseId: string): Promise<ActionResult<CaseRow>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    await caseRecord(company, caseId, viewer);
    const held = await holdOwedSeats(company, caseId, session.sub);
    revalidatePath("/tours/reservations");
    return actionOk(await freshRow(company, caseId), held ? seatsHeldNote(held) : "Nothing to hold - every closed booking already has its seats.");
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to hold the seats");
  }
}

// ---------------------------------------------------------------- one customer, one case
const CANDIDATES_MAX = 20;
type CandidateRecord = Pick<LeadRow, "id" | "case_no" | "name" | "first_name" | "last_name" | "phone" | "email" | "status" | "type" | "created_at" | "assigned_to">;

const samePerson = (a: { phone: string | null; email: string | null }, b: { phone: string | null; email: string | null }): boolean => {
  const keyA = phoneKey(a.phone);
  const emailA = a.email?.trim().toLowerCase();
  return (!!keyA && keyA === phoneKey(b.phone)) || (!!emailA && emailA === b.email?.trim().toLowerCase());
};

/** Cases (by id) as the merge picker shows them, with their booking refs. */
async function candidatesOf(company: Company, ids: string[], self: { phone: string | null; email: string | null }): Promise<CaseCandidate[]> {
  if (ids.length === 0) return [];
  const [leads, bookings] = await Promise.all([
    supabaseTyped
      .from("leads")
      .select("id, case_no, name, first_name, last_name, phone, email, status, type, created_at")
      .eq("company_id", company.id)
      .in("id", ids)
      .is("is_deleted", null),
    toursDb().from("bookings").select("lead_id, ref").eq("company_id", company.id).in("lead_id", ids).is("is_deleted", null).order("created_at", { ascending: false }),
  ]);
  if (leads.error) throw new Error(`leads: ${leads.error.message}`);
  if (bookings.error) throw new Error(`bookings: ${bookings.error.message}`);
  const refs = new Map<string, string[]>();
  for (const b of bookings.data ?? []) if (b.lead_id) refs.set(b.lead_id, [...(refs.get(b.lead_id) ?? []), b.ref]);
  const byId = new Map((leads.data ?? []).map((l) => [l.id, l]));
  return ids
    .map((id) => byId.get(id))
    .filter((l): l is CandidateRecord => !!l)
    .map((l) => ({
      id: l.id,
      caseNo: l.case_no,
      name: caseName({ firstName: l.first_name, lastName: l.last_name }) || l.name || "",
      phone: l.phone,
      email: l.email,
      status: l.status,
      type: isCaseType(l.type) ? l.type : "lead",
      createdAt: l.created_at,
      bookingRefs: refs.get(l.id) ?? [],
      samePerson: samePerson(self, l),
    }));
}

/**
 * Cases this one may be merged with: the same customer first (same phone - last 9 digits - or
 * e-mail, any time), then what the rep searched (case number, name, phone, e-mail, booking ref).
 * Alon 15.10: a customer who booked with another phone must still be linkable to their lead.
 */
export async function findMergeCandidates(caseId: string, query: string): Promise<ActionResult<CaseCandidate[]>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const self = await caseRecord(company, caseId, viewer);
    const q = (query ?? "").trim().slice(0, 80);
    const page = await fetchPaged<CandidateRecord>(
      () =>
        supabaseTyped
          .from("leads")
          .select("id, case_no, name, first_name, last_name, phone, email, status, type, created_at, assigned_to")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .order("case_no", { ascending: false }),
      LIST_LIMIT,
    );
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    // a rep merges only with cards they can see
    const others = page.rows.filter((l) => l.id !== self.id && canSeeCard({ assignedTo: l.assigned_to }, viewer));
    const same = others.filter((l) => samePerson(self, l)).map((l) => l.id);
    let found: string[] = [];
    if (q) {
      const ref = /^t?\d{4,9}$/i.test(q) ? (q.toUpperCase().startsWith("T") ? q.toUpperCase() : `T${q}`) : null;
      const byRef = ref
        ? await toursDb().from("bookings").select("lead_id").eq("company_id", company.id).eq("ref", ref).is("is_deleted", null).maybeSingle()
        : { data: null, error: null };
      if (byRef.error) throw new Error(`bookings: ${byRef.error.message}`);
      const digits = q.replace(/\D/g, "");
      found = others
        .filter(
          (l) =>
            l.id === byRef.data?.lead_id ||
            String(l.case_no) === q.replace(/^#/, "") ||
            (digits.length >= 6 && (l.phone ?? "").replace(/\D/g, "").includes(digits)) ||
            matchesSearch(q, caseName({ firstName: l.first_name, lastName: l.last_name }), l.name, l.email),
        )
        .map((l) => l.id);
    }
    const ids = [...new Set([...same, ...found])].slice(0, CANDIDATES_MAX);
    return actionOk(await candidatesOf(company, ids, self));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to search the cases");
  }
}

/**
 * Merges two cases of one customer: the NEWER case's bookings, seats, notes and anything the older
 * one lacks move into the older one (the customer's first file - its rep, its campaign), and the
 * newer one is marked deleted, naming where it went. One database transaction
 * (public.merge_lead_cases). Answers the case that stays.
 */
export async function mergeCases(caseId: string, otherId: string): Promise<ActionResult<{ keptId: string; keptNo: number; mergedNo: number }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const [a, b] = await Promise.all([caseRecord(company, caseId, viewer), caseRecord(company, otherId, viewer)]);
    if (a.id === b.id) throw new UserError("A case cannot be merged with itself.");
    const [target, source] = a.case_no < b.case_no ? [a, b] : [b, a];
    const { data, error } = await supabaseTyped.rpc("merge_lead_cases", { p_company: company.id, p_source: source.id, p_target: target.id });
    if (error?.code === "PGRST202") throw new UserError("Merging is available after the system update - try again in a few minutes.");
    if (error) throw new Error(`merge_lead_cases: ${error.message}`);
    const answer = asObject(data as never);
    if (answer.ok !== true) throw new UserError(answer.error === "not_found" ? "One of the cases was deleted meanwhile - reload." : "The cases could not be merged.");
    const moved = { bookings: Number(answer.bookings) || 0, seats: Number(answer.seats) || 0 };
    // merge_lead_cases moves bookings, seats and notes; the WhatsApp messages of the merged card follow here (never fails the merge)
    await relinkCaseMessages(source.id, target.id).catch((e: unknown) => console.error("cases: wa_messages relink failed:", e instanceof Error ? e.message : e));
    await Promise.all([
      logAudit({
        action: "merge",
        entityType: "tours_case",
        entityId: target.id,
        changes: { merged_case: source.case_no, ...moved },
        metadata: { ...companyAudit(company), case_no: target.case_no },
      }),
      logAudit({
        action: "merge",
        entityType: "tours_case",
        entityId: source.id,
        changes: { merged_into: target.case_no, ...moved },
        metadata: { ...companyAudit(company), case_no: source.case_no },
      }),
    ]);
    revalidatePath("/tours/reservations");
    return actionOk({ keptId: target.id, keptNo: target.case_no, mergedNo: source.case_no });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to merge the cases");
  }
}

// ---------------------------------------------------------------- the booking link
type LinkDepartureRow = {
  id: string;
  code: string;
  start_date: string;
  legacy_product_id: number | null;
  site_id: number;
  sale_status: string;
  packages: { name: string; slug: string; data: unknown } | null;
};

/** Departures a link can point at - published, from today on, still selling - with the rooms each prices. */
async function linkDepartures(company: Company, onlyId?: string): Promise<LinkDeparture[]> {
  let query = toursDb()
    .from("departures")
    .select("id, code, start_date, legacy_product_id, site_id, sale_status, packages(name, slug, data)")
    .eq("company_id", company.id)
    .eq("is_published", true)
    .is("is_deleted", null)
    .gte("start_date", todayIso())
    .not("sale_status", "in", "(sold_out,closed)");
  if (onlyId) query = query.eq("id", onlyId);
  const { data, error } = await query.order("start_date", { ascending: true }).order("code", { ascending: true });
  if (error) throw new Error(`departures: ${error.message}`);
  const rows = (data ?? []) as unknown as LinkDepartureRow[];
  const prices = new Map<string, { pax_type: string; room_position: number; price: number }[]>();
  for (const part of chunk(rows.map((d) => d.id), IN_CHUNK)) {
    const { data: priceRows, error: priceError } = await toursDb()
      .from("departure_prices")
      .select("departure_id, pax_type, room_position, price")
      .eq("company_id", company.id)
      .in("departure_id", part);
    if (priceError) throw new Error(`departure_prices: ${priceError.message}`);
    for (const p of priceRows ?? []) {
      const list = prices.get(p.departure_id) ?? [];
      list.push({ pax_type: p.pax_type, room_position: p.room_position, price: Number(p.price) });
      prices.set(p.departure_id, list);
    }
  }
  return rows
    .filter((d) => d.packages)
    .map((d) => {
      const matrix = toPriceMatrix(prices.get(d.id) ?? []);
      const pkg = d.packages as { name: string; slug: string; data: unknown };
      return {
        id: d.id,
        code: d.code,
        startDate: d.start_date,
        tourName: pkg.name,
        siteId: departureSiteId(d),
        packagePath: packagePathOf(pkg.slug, (asObject(pkg.data as never).path as string | undefined) ?? null),
        rooms: ROOM_COMPOSITIONS.filter((c) => roomPrice(c.key, matrix) !== null).map((c) => ({ key: c.key, title: c.title })),
      };
    });
}

/** Departures a link can point at: open on the site AND priced - a date with no price table takes no booking (Alon 18.10). */
export async function listLinkDepartures(): Promise<ActionResult<LinkDeparture[]>> {
  try {
    const { company } = await requireCompany("tours");
    return actionOk((await linkDepartures(company)).filter((d) => d.rooms.length > 0));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the departures");
  }
}

/** What the site charges for these rooms on this departure - its own price function, discounts included. */
async function quoteRooms(company: Company, siteId: number, rooms: string[]): Promise<LinkQuote | null> {
  const { data, error } = await toursDb().rpc("booking_quote", { p_company: company.id, p_args: { product_id: String(siteId), rooms } });
  if (error) throw new Error(`booking_quote: ${error.message}`);
  const q = asObject(data as never);
  if (q.ok !== true) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return {
    currency: typeof q.currency === "string" ? q.currency : "USD",
    lines: (Array.isArray(q.lines) ? q.lines : []).map((l) => {
      const line = asObject(l as never);
      return { key: String(line.key ?? ""), title: String(line.title ?? line.key ?? ""), price: num(line.price), discount: num(line.discount) };
    }),
    subtotal: num(q.subtotal),
    discount: num(q.discount),
    total: num(q.total),
    reason: typeof q.reason === "string" ? q.reason : null,
  };
}

/** The price of a choice in the link card, as the rep changes rooms. Null = the site cannot price it. */
export async function quoteLink(input: { departureId: string; rooms: string[] }): Promise<ActionResult<LinkQuote | null>> {
  try {
    const { company } = await requireCompany("tours");
    if (!UUID.test(input.departureId)) throw new UserError("Choose a departure.");
    const [departure] = await linkDepartures(company, input.departureId);
    if (!departure) throw new UserError("This departure is not open on the site.");
    const rooms = cleanRoomKeys(Array.isArray(input.rooms) ? input.rooms : [], departure.rooms.map((r) => r.key));
    if (rooms.length === 0) return actionOk(null);
    return actionOk(await quoteRooms(company, departure.siteId, rooms));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to price the rooms");
  }
}

/** The patch that marks the case's offer as SENT: "Offer sent" (statusAfterLink), its follow-up day, the time. */
function sentPatch(record: CaseRecord, offer: CaseOffer, via: OfferChannel, statuses: readonly CaseStatus[]): { patch: LeadUpdate; status: string } {
  const now = new Date().toISOString();
  const status = statusAfterLink(record.status, statuses);
  const patch: LeadUpdate = {
    offer: { ...offer, sentAt: now, sentVia: via } as unknown as Json,
    link_sent_at: now,
  };
  if (DAY.test(offer.followUpDate) && offer.followUpDate >= todayIso()) patch.follow_up_date = offer.followUpDate;
  if (status !== record.status) {
    patch.status = status;
    // an offer reopens a lead closed as not relevant: its reason no longer holds
    if (!isClosedStatus(status, statuses) && record.close_reason) patch.close_reason = null;
  }
  return { patch, status };
}

/**
 * Prepares the booking link for the case: the tour page on the site, the date, the rooms and the case's
 * token (`lr`) - a booking sent through it lands on this case. It is an OFFER (Alon 18.10): kept on the
 * case (leads.offer) with the site's price and the follow-up day, and it counts as sent only once it goes
 * out on WhatsApp or e-mail (markOfferSent) - preparing changes no status. `sendWhatsApp` sends it at once
 * from the company's own number when the Cloud API is connected. The token is minted once per case.
 */
export async function prepareOffer(
  caseId: string,
  input: { departureId: string; rooms: string[]; followUpDate: string; sendWhatsApp?: boolean },
): Promise<ActionResult<BookingLinkResult>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    if (!company.siteUrl) throw new UserError("The company has no site address - set it in the company settings first.");
    const record = await caseRecord(company, caseId, viewer);
    if (!UUID.test(input.departureId)) throw new UserError("Choose a departure.");
    if (!input.followUpDate || !DAY.test(input.followUpDate)) throw new UserError("Pick the day to follow up with the customer.");
    if (input.followUpDate < todayIso()) throw new UserError("The follow-up day cannot be in the past.");
    const [departure] = await linkDepartures(company, input.departureId);
    if (!departure) throw new UserError("This departure is not open on the site (unpublished, past, sold out or closed).");
    if (departure.rooms.length === 0) throw new UserError("This date has no price table yet, so the site cannot take a booking for it.");
    if ((input.rooms ?? []).length > LINK_ROOMS_MAX) throw new UserError(`A booking holds up to ${LINK_ROOMS_MAX} rooms.`);
    const rooms = cleanRoomKeys(Array.isArray(input.rooms) ? input.rooms : [], departure.rooms.map((r) => r.key));
    if (rooms.length === 0) throw new UserError("Choose at least one room this date sells.");

    const quote = await quoteRooms(company, departure.siteId, rooms).catch((e) => {
      console.error(`${SCOPE}: quote for case ${record.case_no} failed:`, e instanceof Error ? e.message : e);
      return null;
    });
    const token = record.link_token ?? randomBytes(24).toString("base64url");
    const url = bookingLink({ siteUrl: company.siteUrl, packagePath: departure.packagePath, productId: departure.siteId, rooms, token });
    const titles = new Map(departure.rooms.map((r) => [r.key, r.title]));
    const offer: CaseOffer = {
      departureId: departure.id,
      departureCode: departure.code,
      startDate: departure.startDate,
      tourName: departure.tourName,
      rooms,
      roomTitles: rooms.map((k) => titles.get(k) ?? k),
      total: quote?.total ?? null,
      currency: quote?.currency ?? null,
      url,
      followUpDate: input.followUpDate,
      createdAt: new Date().toISOString(),
      sentAt: null,
      sentVia: null,
      bookingRef: null,
    };
    let patch: LeadUpdate = { link_token: token, offer: offer as unknown as Json };
    if (!record.departure_id) {
      const own = await companyDeparture(company, departure.id);
      patch.departure_id = own.id;
      patch.package_id = own.package_id;
    }

    const first = record.first_name ?? splitName(record.name).first;
    const message = linkMessage(first, departure.tourName, url);
    // from the company's own number, when connected; a refusal never loses the prepared offer
    let warning: string | undefined;
    let sent = false;
    if (input.sendWhatsApp) {
      const to = whatsappPhone(record.phone);
      const answer = to
        ? await sendTemplate(company, {
            to,
            params: [first || "שלום", departure.tourName ?? "הטיול", url],
            origin: "api",
            caseId,
            customerId: record.customer_id ?? null,
            sentBy: session.sub,
          })
        : ({ ok: false, error: "The case has no phone number WhatsApp can use." } as const);
      if (answer.ok) {
        const applied = sentPatch(record, offer, "whatsapp_api", await statusesOf(company));
        patch = { ...patch, ...applied.patch };
        sent = true;
      } else {
        warning = `The offer is ready but was not sent on WhatsApp: ${answer.error}`;
      }
    }
    const { error } = await supabaseTyped.from("leads").update(patch).eq("company_id", company.id).eq("id", caseId);
    if (missingColumn(error)) throw new UserError("Offers can be saved after the system update - try again in a few minutes.");
    if (error) throw new Error(`leads: ${error.message}`);
    await logAudit({
      action: sent ? "offer_sent" : "offer_prepared",
      entityType: "tours_case",
      entityId: caseId,
      changes: { departure: departure.code, rooms, total: offer.total, follow_up_date: input.followUpDate, ...(sent ? { via: "whatsapp_api" } : {}) },
      metadata: { ...companyAudit(company), case_no: record.case_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk(
      {
        offer: (parseOffer(patch.offer) ?? offer) as CaseOffer,
        message,
        whatsapp: waLink(record.phone, message),
        whatsappApp: whatsappAppLink(record.phone, message),
        mailto: record.email ? `mailto:${record.email}?subject=${encodeURIComponent("קישור להזמנה")}&body=${encodeURIComponent(message)}` : null,
      },
      warning ?? (sent ? "Sent on WhatsApp from the company number." : undefined),
    );
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to prepare the booking link");
  }
}

/** The rep sent the prepared offer on WhatsApp or by e-mail: the case moves to "Offer sent" with its follow-up day. */
export async function markOfferSent(caseId: string, via: OfferChannel): Promise<ActionResult<CaseRow>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    if (!isOfferChannel(via) || via === "whatsapp_api") throw new UserError("Send the link on WhatsApp or by e-mail.");
    const record = await caseRecord(company, caseId, viewer);
    const offer = parseOffer(record.offer);
    if (!offer) throw new UserError("Prepare the booking link first.");
    const { patch, status } = sentPatch(record, offer, via, await statusesOf(company));
    const { error } = await supabaseTyped.from("leads").update(patch).eq("company_id", company.id).eq("id", caseId);
    if (error) throw new Error(`leads: ${error.message}`);
    await logAudit({
      action: "offer_sent",
      entityType: "tours_case",
      entityId: caseId,
      changes: {
        via,
        departure: offer.departureCode,
        rooms: offer.rooms,
        ...(status !== record.status ? { status: { from: record.status, to: status } } : {}),
        follow_up_date: { from: record.follow_up_date, to: patch.follow_up_date ?? record.follow_up_date },
      },
      metadata: { ...companyAudit(company), case_no: record.case_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk(await freshRow(company, caseId));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to record the offer as sent");
  }
}

/**
 * Withdraws the offer: it leaves the case and its link stops landing here - the case's token is dropped, so
 * a booking through the old link is matched like any other (by phone / e-mail). The next offer mints a new
 * token. The status stays the rep's call.
 */
export async function withdrawOffer(caseId: string): Promise<ActionResult<CaseRow>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const record = await caseRecord(company, caseId, viewer);
    const offer = parseOffer(record.offer);
    if (!offer && !record.link_token) throw new UserError("This case has no offer to withdraw.");
    const { error } = await supabaseTyped.from("leads").update({ offer: null, link_token: null }).eq("company_id", company.id).eq("id", caseId);
    if (error) throw new Error(`leads: ${error.message}`);
    await logAudit({
      action: "offer_withdrawn",
      entityType: "tours_case",
      entityId: caseId,
      changes: offer ? { departure: offer.departureCode, rooms: offer.rooms, total: offer.total, sent: offer.sentVia } : { link: "token dropped" },
      metadata: { ...companyAudit(company), case_no: record.case_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk(await freshRow(company, caseId));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to withdraw the offer");
  }
}

// ---------------------------------------------------------------- one customer, deal cards (Nir 19.10)
const CUSTOMER_COLUMNS = "id, company_id, customer_no, first_name, last_name, phones, phone_keys, email, id_number, acc_num, not_same, merged_into, is_deleted, created_at, updated_at";

/** One customer of the company (not deleted, not merged away), or a UserError. */
async function customerRecord(company: Company, id: string): Promise<CustomerRecord> {
  if (!UUID.test(id)) throw new UserError("The customer was not found.");
  const { data, error } = await supabaseTyped
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("company_id", company.id)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (missingTable(error)) throw new UserError(NOT_READY);
  if (error) throw new Error(`customers: ${error.message}`);
  if (!data) throw new UserError("The customer was not found - they may have been merged into another one.");
  return data as CustomerRecord;
}

const customerInfoOf = (c: CustomerRecord): CustomerInfo => ({
  id: c.id,
  customerNo: c.customer_no,
  firstName: c.first_name,
  lastName: c.last_name,
  phones: c.phones ?? [],
  email: c.email,
  idNumber: c.id_number,
  accNum: c.acc_num,
  createdAt: c.created_at,
});

/** What each of `forCards` should know about its customer's earlier deals, read over `all` the customer's cards. */
function knownForCards(all: readonly CaseRow[], forCards: readonly CaseRow[], statuses: readonly CaseStatus[]): Record<string, KnownFrom> {
  const byCustomer = new Map<string, { id: string; caseNo: number; status: string; closeReason: string | null; tourName: string | null; createdAt: string }[]>();
  for (const c of all) {
    if (!c.customerId) continue;
    byCustomer.set(c.customerId, [...(byCustomer.get(c.customerId) ?? []), { id: c.id, caseNo: c.caseNo, status: c.status, closeReason: c.closeReason, tourName: c.tourName, createdAt: c.createdAt }]);
  }
  const known: Record<string, KnownFrom> = {};
  for (const c of forCards) {
    const k = c.customerId ? knownFrom(c, byCustomer.get(c.customerId) ?? [], statuses) : null;
    if (k) known[c.id] = k;
  }
  return known;
}

/** The viewer's own TODAY order (21.10): [] before the migration, before a first drag, or on a failed read. */
async function boardOrderOf(company: Company, userId: string): Promise<string[]> {
  const { data, error } = await supabaseTyped.from("lead_board_orders").select("lead_ids").eq("company_id", company.id).eq("user_id", userId).maybeSingle();
  if (error) {
    if (!missingTable(error)) console.error(`${SCOPE}: board order read failed`, JSON.stringify(error));
    return [];
  }
  return cleanOrderIds((data as { lead_ids?: unknown[] } | null)?.lead_ids ?? []);
}

/** Saves the viewer's own order of TODAY - the whole list, after a drag or a typed place. Private: never audited. */
export async function saveBoardOrder(ids: string[]): Promise<ActionResult<{ saved: number }>> {
  try {
    const { session, company } = await requireCompany("tours");
    // a superadmin looking as a rep must not rewrite that rep's own list (the task_reads precedent)
    if (session.impersonator) return actionOk({ saved: 0 }, "Not saved while impersonating - the order is the rep's own.");
    const lead_ids = cleanOrderIds(Array.isArray(ids) ? ids : []);
    const { error } = await supabaseTyped
      .from("lead_board_orders")
      .upsert({ company_id: company.id, user_id: session.sub, lead_ids, updated_at: new Date().toISOString() }, { onConflict: "company_id,user_id" });
    if (missingTable(error)) throw new UserError("Your order is kept after the system update - try again in a few minutes.");
    if (error) throw new Error(`lead_board_orders: ${error.message}`);
    return actionOk({ saved: lead_ids.length });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save the order");
  }
}

/**
 * The Reservations board in one load: every card (TODAY and LEADS read them) and every order (RESERVATIONS - a
 * site booking or a typed one, each a row). The ALL tab keeps reading listCases.
 */
export async function listBoard(): Promise<ActionResult<BoardPage>> {
  try {
    const { session, company } = await requireCompany("tours");
    const [page, statuses, reps, viewer, order] = await Promise.all([
      allCaseRecords(company),
      statusesOf(company),
      repsOf(company),
      boardViewerFor(session, company),
      boardOrderOf(company, session.sub),
    ]);
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    const records = page.rows.map(withDefaults);
    const x = await enrich(company.id, records);
    const today = todayIso();
    // the viewer's cards only (lib/tours/board.ts); what each card knows of its customer is read over EVERY card
    const all = records.map((r) => toCaseRow(r, x, statuses));
    const cards = visibleCards(all, viewer);
    const shown = new Set(cards.map((c) => c.id));
    return actionOk({
      cards,
      orders: records.filter((r) => shown.has(r.id)).flatMap((r) => ordersOf(r, x, statuses, today)),
      truncated: page.truncated,
      statuses,
      reps,
      currentUserId: session.sub,
      viewer,
      order,
      known: knownForCards(all, cards, statuses),
    });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the reservations");
  }
}

/**
 * A customer's page in one load: the person, every card of theirs (deleted ones out), their orders, what each card
 * should know of the earlier ones, and a same-e-mail suggestion. Opened by the customer, or by one of their cards
 * (`/tours/reservations/<card>` - that card opens).
 */
export async function getCustomerPage(input: { customerId?: string; cardId?: string }): Promise<ActionResult<CustomerPageData>> {
  try {
    const { session, company } = await requireCompany("tours");
    let customerId = input.customerId ?? null;
    if (!customerId && input.cardId) {
      const card = await caseRecord(company, input.cardId);
      if (!card.customer_id) throw new UserError(NOT_READY);
      customerId = card.customer_id;
    }
    if (!customerId) throw new UserError("The customer was not found.");
    const customer = await customerRecord(company, customerId);

    const [cardsAnswer, statuses, reps, viewer] = await Promise.all([
      readCaseColumns((columns) =>
        fetchPaged<CaseRecord>(
          () =>
            supabaseTyped
              .from("leads")
              .select(columns)
              .eq("company_id", company.id)
              .eq("customer_id", customer.id)
              .is("is_deleted", null)
              .order("case_no", { ascending: false }),
          LIST_LIMIT,
        ),
      ),
      statusesOf(company),
      repsOf(company),
      boardViewerFor(session, company),
    ]);
    if (cardsAnswer.error) throw new Error(`leads: ${cardsAnswer.error.message}`);
    const records = cardsAnswer.rows.map(withDefaults);
    // the thread is cut to the cards this viewer sees (security review 21.10) - the same rule as the cards below
    const visibleIds = new Set(records.filter((r) => canSeeCard({ assignedTo: r.assigned_to ?? null }, viewer)).map((r) => r.id));
    const [x, whatsapp] = await Promise.all([enrich(company.id, records), threadOf(company, customer.id, customer.phones ?? [], { scope: viewer.manager ? { all: true } : { visibleCaseIds: visibleIds } })]);
    const today = todayIso();
    // the viewer's cards; the others are counted, never listed (21.10) - what a card knows is still read over all of them
    const all = records.map((r) => toCaseRow(r, x, statuses));
    const cards = visibleCards(all, viewer);
    const shown = new Set(cards.map((c) => c.id));
    const known = knownForCards(all, cards, statuses);
    const travelled = all.some((c) => isPaidStatus(c.status) && !!c.departureDate && c.departureDate < today);

    // another customer with the same e-mail and no phone in common (never joined by itself)
    let suggestion: CustomerPageData["suggestion"] = null;
    if (customer.email) {
      const { data: same, error: sameError } = await supabaseTyped
        .from("customers")
        .select(CUSTOMER_COLUMNS)
        .eq("company_id", company.id)
        .ilike("email", customer.email.replace(/[\\%_]/g, (m) => `\\${m}`))
        .is("is_deleted", null)
        .neq("id", customer.id)
        .limit(10);
      if (sameError) throw new Error(`customers: ${sameError.message}`);
      const others = (same ?? []) as CustomerRecord[];
      const key = (c: CustomerRecord) => ({ id: c.id, email: c.email, phones: c.phones ?? [], notSame: c.not_same ?? [] });
      const found = sameEmailSuggestion(key(customer), others.map(key));
      const other = others.find((o) => o.id === found);
      if (other) {
        suggestion = { id: other.id, customerNo: other.customer_no, name: customerName({ firstName: other.first_name, lastName: other.last_name }), phones: other.phones ?? [], email: other.email };
      }
    }

    // the card to open: the one asked for, else the one most waiting for the rep, else the newest open one
    const waiting = cards
      .map((c) => ({ c, reason: todayReason(c, statuses, today) }))
      .filter((w) => w.reason && !w.c.toFile)
      .sort((a, b) => todayRank(a.reason!) - todayRank(b.reason!));
    const openCardId =
      (input.cardId && cards.some((c) => c.id === input.cardId) ? input.cardId : null) ??
      waiting[0]?.c.id ??
      cards.find((c) => !c.toFile && !isClosedStatus(c.status, statuses))?.id ??
      null;

    return actionOk({
      customer: customerInfoOf(customer),
      cards,
      orders: records.filter((r) => shown.has(r.id)).flatMap((r) => ordersOf(r, x, statuses, today)),
      known,
      suggestion,
      openCardId,
      statuses,
      reps,
      currentUserId: session.sub,
      viewer,
      hiddenCards: all.length - cards.length,
      travelled,
      whatsapp,
    });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the customer");
  }
}

/**
 * Change the customer. Names, e-mail, national id and ACC NUM are the person's: every card of theirs takes them too
 * (exports, mails and the link message read the card). Phones: up to five, the main one first; a card keeps the
 * phone it came with.
 */
export async function updateCustomer(id: string, change: CustomerChange): Promise<ActionResult<CustomerInfo>> {
  try {
    const { company } = await requireCompany("tours");
    const before = await customerRecord(company, id);
    const patch: Database["public"]["Tables"]["customers"]["Update"] = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set = <K extends keyof typeof patch>(column: K, from: unknown, to: (typeof patch)[K]) => {
      if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return;
      patch[column] = to;
      changes[column as string] = { from: from ?? null, to: to ?? null };
    };
    if (change.firstName !== undefined) {
      const first = clean(change.firstName, NAME_MAX);
      if (!first) throw new UserError("The first name cannot be empty.");
      set("first_name", before.first_name, first);
    }
    if (change.lastName !== undefined) set("last_name", before.last_name, clean(change.lastName, NAME_MAX));
    if (change.email !== undefined) {
      const email = clean(change.email, 200)?.toLowerCase() ?? null;
      if (email && !EMAIL.test(email)) throw new UserError("The e-mail address is not valid.");
      set("email", before.email, email);
    }
    if (change.idNumber !== undefined) {
      const value = (change.idNumber ?? "").replace(/\D/g, "");
      if (value && !NATIONAL_ID.test(value)) throw new UserError("A national id is 5 to 9 digits.");
      set("id_number", before.id_number, value || null);
    }
    if (change.accNum !== undefined) set("acc_num", before.acc_num, clean(change.accNum, ACC_MAX));
    if (change.phones !== undefined) {
      const checked = cleanPhones(Array.isArray(change.phones) ? change.phones : []);
      if (!checked.ok) throw new UserError(checked.error);
      const nextEmail = "email" in patch ? patch.email : before.email;
      if (checked.phones.length === 0 && !nextEmail) throw new UserError("Keep a phone or an e-mail address.");
      // a phone that is another customer's would make two people one: merge them instead
      const keys = checked.phones.map(phoneKey).filter(Boolean);
      if (keys.length) {
        const { data: taken, error: takenError } = await supabaseTyped
          .from("customers")
          .select("customer_no, phone_keys")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .neq("id", before.id)
          .overlaps("phone_keys", keys);
        if (takenError) throw new Error(`customers: ${takenError.message}`);
        if (taken?.length) throw new UserError(`That phone is customer ${customerLabel(taken[0].customer_no)}'s - merge the two customers instead.`);
      }
      set("phones", before.phones, checked.phones);
    }
    if (Object.keys(patch).length === 0) return actionOk(customerInfoOf(before));

    const { data: after, error } = await supabaseTyped.from("customers").update(patch).eq("company_id", company.id).eq("id", id).select(CUSTOMER_COLUMNS).single();
    if (error) throw new Error(`customers: ${error.message}`);
    // the person's details on every card of theirs
    const cardPatch: LeadUpdate = {};
    if (patch.first_name !== undefined) cardPatch.first_name = patch.first_name;
    if (patch.last_name !== undefined) cardPatch.last_name = patch.last_name;
    if (patch.first_name !== undefined || patch.last_name !== undefined) {
      cardPatch.name = [after.first_name, after.last_name].filter(Boolean).join(" ") || null;
    }
    if (patch.email !== undefined) cardPatch.email = patch.email;
    if (patch.id_number !== undefined) cardPatch.id_number = patch.id_number;
    if (patch.acc_num !== undefined) cardPatch.acc_num = patch.acc_num;
    if (Object.keys(cardPatch).length) {
      const { error: cardsError } = await supabaseTyped.from("leads").update(cardPatch).eq("company_id", company.id).eq("customer_id", id).is("is_deleted", null);
      if (cardsError) throw new Error(`leads: ${cardsError.message}`);
    }
    await logAudit({
      action: "update",
      entityType: "tours_customer",
      entityId: id,
      changes: { ...changes, ...(changes.id_number ? { id_number: { from: "…", to: "…" } } : {}) },
      metadata: { ...companyAudit(company), customer_no: before.customer_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk(customerInfoOf(after as CustomerRecord));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to update the customer");
  }
}

/** Customers as the merge / move pickers show them: whatever the rep typed - a name, a phone, a C-number, an e-mail. */
export async function searchCustomers(query: string, excludeId?: string): Promise<ActionResult<CustomerCandidate[]>> {
  try {
    const { company } = await requireCompany("tours");
    const q = (query ?? "").trim().slice(0, 80);
    if (q.length < 2) return actionOk([]);
    const page = await fetchPaged<CustomerRecord>(
      () =>
        supabaseTyped
          .from("customers")
          .select(CUSTOMER_COLUMNS)
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .order("customer_no", { ascending: false }),
      LIST_LIMIT,
    );
    if (missingTable(page.error)) throw new UserError(NOT_READY);
    if (page.error) throw new Error(`customers: ${page.error.message}`);
    const digits = q.replace(/\D/g, "");
    const number = /^c?-?\d{3,9}$/i.test(q) ? Number(digits) : null;
    const found = page.rows
      .filter((c) => c.id !== excludeId)
      .filter(
        (c) =>
          c.customer_no === number ||
          (digits.length >= 6 && (c.phones ?? []).some((p) => p.replace(/\D/g, "").includes(digits))) ||
          matchesSearch(q, customerName({ firstName: c.first_name, lastName: c.last_name }), c.email),
      )
      .slice(0, CANDIDATES_MAX);
    const counts = new Map<string, number>();
    for (const part of chunk(found.map((c) => c.id), IN_CHUNK)) {
      const { data, error } = await supabaseTyped.from("leads").select("customer_id").eq("company_id", company.id).in("customer_id", part).is("is_deleted", null);
      if (error) throw new Error(`leads: ${error.message}`);
      for (const l of data ?? []) if (l.customer_id) counts.set(l.customer_id, (counts.get(l.customer_id) ?? 0) + 1);
    }
    return actionOk(
      found.map((c) => ({
        id: c.id,
        customerNo: c.customer_no,
        name: customerName({ firstName: c.first_name, lastName: c.last_name }),
        phones: c.phones ?? [],
        email: c.email,
        cards: counts.get(c.id) ?? 0,
      })),
    );
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to search the customers");
  }
}

/**
 * Two customers are one person: every card of `otherId` moves to `keepId`, its phones join (the kept one's main phone
 * stays first, five at most), an empty field of the kept one takes the other's, and the other is marked merged.
 */
export async function mergeCustomers(keepId: string, otherId: string): Promise<ActionResult<{ moved: number }>> {
  try {
    const { company } = await requireCompany("tours");
    if (keepId === otherId) throw new UserError("A customer cannot be merged with themselves.");
    const [keep, other] = await Promise.all([customerRecord(company, keepId), customerRecord(company, otherId)]);
    const phones = cleanPhones([...(keep.phones ?? []), ...(other.phones ?? [])]);
    const { data: moved, error: moveError } = await supabaseTyped
      .from("leads")
      .update({ customer_id: keep.id })
      .eq("company_id", company.id)
      .eq("customer_id", other.id)
      .select("id");
    if (moveError) throw new Error(`leads: ${moveError.message}`);
    // the other customer's phones would otherwise still find them: it leaves first
    const { error: otherError } = await supabaseTyped
      .from("customers")
      .update({ is_deleted: todayIso(), merged_into: keep.id })
      .eq("company_id", company.id)
      .eq("id", other.id);
    if (otherError) throw new Error(`customers: ${otherError.message}`);
    const { error: keepError } = await supabaseTyped
      .from("customers")
      .update({
        phones: phones.ok ? phones.phones : [...(keep.phones ?? []), ...(other.phones ?? [])].slice(0, PHONES_MAX),
        first_name: keep.first_name || other.first_name,
        last_name: keep.last_name || other.last_name,
        email: keep.email || other.email,
        id_number: keep.id_number || other.id_number,
        acc_num: keep.acc_num || other.acc_num,
        not_same: (keep.not_same ?? []).filter((x) => x !== other.id),
      })
      .eq("company_id", company.id)
      .eq("id", keep.id);
    if (keepError) throw new Error(`customers: ${keepError.message}`);
    await relinkCustomerMessages(otherId, keep.id).catch((e: unknown) => console.error("cases: wa_messages relink failed:", e instanceof Error ? e.message : e));
    const count = moved?.length ?? 0;
    await Promise.all([
      logAudit({
        action: "merge",
        entityType: "tours_customer",
        entityId: keep.id,
        changes: { merged_customer: other.customer_no, cards: count },
        metadata: { ...companyAudit(company), customer_no: keep.customer_no },
      }),
      logAudit({
        action: "merge",
        entityType: "tours_customer",
        entityId: other.id,
        changes: { merged_into: keep.customer_no, cards: count },
        metadata: { ...companyAudit(company), customer_no: other.customer_no },
      }),
    ]);
    revalidatePath("/tours/reservations");
    return actionOk({ moved: count });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to merge the customers");
  }
}

/** "Not the same": the same e-mail is not the same person - neither side suggests the other again. */
export async function dismissCustomerSuggestion(customerId: string, otherId: string): Promise<ActionResult> {
  try {
    const { company } = await requireCompany("tours");
    const [me, other] = await Promise.all([customerRecord(company, customerId), customerRecord(company, otherId)]);
    for (const [row, add] of [
      [me, other.id],
      [other, me.id],
    ] as const) {
      if ((row.not_same ?? []).includes(add)) continue;
      const { error } = await supabaseTyped
        .from("customers")
        .update({ not_same: [...(row.not_same ?? []), add] })
        .eq("company_id", company.id)
        .eq("id", row.id);
      if (error) throw new Error(`customers: ${error.message}`);
    }
    await logAudit({
      action: "not_same",
      entityType: "tours_customer",
      entityId: me.id,
      changes: { other: other.customer_no },
      metadata: { ...companyAudit(company), customer_no: me.customer_no },
    });
    return actionOk(undefined);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save");
  }
}

/** The card belongs to another customer (a relative booked from their own phone): it moves with all it holds. */
export async function moveCardToCustomer(cardId: string, customerId: string): Promise<ActionResult<{ customerId: string }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const [card, target] = await Promise.all([caseRecord(company, cardId, viewer), customerRecord(company, customerId)]);
    if (card.customer_id === target.id) throw new UserError("The card is already this customer's.");
    const { error } = await supabaseTyped.from("leads").update({ customer_id: target.id }).eq("company_id", company.id).eq("id", card.id);
    if (error) throw new Error(`leads: ${error.message}`);
    await relinkCardCustomer(card.id, target.id).catch((e: unknown) => console.error("cases: wa_messages relink failed:", e instanceof Error ? e.message : e));
    await logAudit({
      action: "move",
      entityType: "tours_case",
      entityId: card.id,
      changes: { customer_id: { from: card.customer_id, to: target.id }, customer_no: target.customer_no },
      metadata: { ...companyAudit(company), case_no: card.case_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk({ customerId: target.id });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to move the card");
  }
}

/**
 * An inquiry with no tour from a customer with open cards: the rep puts it on one of their cards (the customer came
 * back on it - the same as a form that joins by itself) or keeps it as a card of its own (`cardId` null).
 */
export async function fileInquiry(inquiryId: string, cardId: string | null): Promise<ActionResult<{ cardId: string }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const inquiry = await caseRecord(company, inquiryId, viewer);
    if (!inquiry.to_file) throw new UserError("This inquiry was filed already - reload.");
    if (cardId === null) {
      const { error } = await supabaseTyped.from("leads").update({ to_file: false }).eq("company_id", company.id).eq("id", inquiry.id);
      if (error) throw new Error(`leads: ${error.message}`);
      await logAudit({ action: "file", entityType: "tours_case", entityId: inquiry.id, changes: { to: "own card" }, metadata: { ...companyAudit(company), case_no: inquiry.case_no } });
      revalidatePath("/tours/reservations");
      return actionOk({ cardId: inquiry.id });
    }
    const target = await caseRecord(company, cardId, viewer);
    if (target.id === inquiry.id || target.customer_id !== inquiry.customer_id) throw new UserError("Choose one of this customer's cards.");
    const statuses = await statusesOf(company);
    const today = todayIso();
    const payload = asObject(target.payload);
    const inquiries = Array.isArray(payload.inquiries) ? payload.inquiries : [];
    const entry = {
      id: inquiry.id,
      case_no: inquiry.case_no,
      at: inquiry.created_at,
      kind: inquiry.kind,
      message: inquiry.message ? inquiry.message.slice(0, 500) : null,
      source_path: inquiry.source_path,
      utm: inquiry.utm,
      // what the form was sent as - the card page compares it with the card's person (senderDiffers)
      name: inquiry.name?.trim() || null,
      phone: inquiry.phone?.trim() || null,
      email: inquiry.email?.trim().toLowerCase() || null,
      fields: asObject(inquiry.payload),
    };
    const nextStatus = statusOnReturn(target.status, statuses);
    const { error: targetError } = await supabaseTyped
      .from("leads")
      .update({ status: nextStatus, follow_up_date: today, payload: { ...payload, inquiries: [...inquiries, entry] } as unknown as Json })
      .eq("company_id", company.id)
      .eq("id", target.id);
    if (targetError) throw new Error(`leads: ${targetError.message}`);
    const { error: inquiryError } = await supabaseTyped
      .from("leads")
      .update({
        to_file: false,
        is_deleted: today,
        payload: { ...asObject(inquiry.payload), joined_into: { id: target.id, case_no: target.case_no } } as unknown as Json,
      })
      .eq("company_id", company.id)
      .eq("id", inquiry.id);
    if (inquiryError) throw new Error(`leads: ${inquiryError.message}`);
    await logAudit({
      action: "file",
      entityType: "tours_case",
      entityId: target.id,
      changes: { inquiry: inquiry.case_no, ...(nextStatus !== target.status ? { status: { from: target.status, to: nextStatus } } : {}) },
      metadata: { ...companyAudit(company), case_no: target.case_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk({ cardId: target.id });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to file the inquiry");
  }
}

/** The tours a future lead can name, each with its seasons (its coming departures', then its own). */
export async function listFutureTours(): Promise<ActionResult<FutureTour[]>> {
  try {
    const { company } = await requireCompany("tours");
    const today = todayIso();
    const [packages, departures, seasons] = await Promise.all([
      toursDb().from("packages").select("id, name").eq("company_id", company.id).is("is_deleted", null).order("name", { ascending: true }),
      toursDb()
        .from("departures")
        .select("package_id, season, season_year, start_date")
        .eq("company_id", company.id)
        .is("is_deleted", null)
        .gte("start_date", today),
      toursDb().from("package_seasons").select("package_id, name, position").eq("company_id", company.id).order("position", { ascending: true }),
    ]);
    if (packages.error) throw new Error(`packages: ${packages.error.message}`);
    if (departures.error) throw new Error(`departures: ${departures.error.message}`);
    if (seasons.error) throw new Error(`package_seasons: ${seasons.error.message}`);
    return actionOk(
      (packages.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        seasons: seasonOptions(
          (departures.data ?? [])
            .filter((d) => d.package_id === p.id)
            .map((d) => ({ season: d.season ?? null, seasonYear: d.season_year ?? null, startDate: d.start_date })),
          (seasons.data ?? []).filter((s) => s.package_id === p.id).map((s) => s.name),
          today,
        ),
      })),
    );
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the tours");
  }
}

// ---------------------------------------------------------------- export
/** A spreadsheet cell has no timezone: show the operators' Israel clock. */
function wallClock(iso: string): Date {
  const instant = Date.parse(iso);
  const minute = instant - (instant % 60_000);
  return new Date(instant + (Date.parse(`${isoToJerusalemLocal(iso)}Z`) - minute));
}

/** The cases the screen shows (their ids) as an .xlsx file, columns in the screen's order. */
export async function exportCases(ids: string[]): Promise<ActionResult<{ fileName: string; base64: string; rows: number }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const viewer = await boardViewerFor(session, company);
    const wanted = new Set(ids.filter((id) => UUID.test(id)));
    if (wanted.size === 0) throw new UserError("Nothing to export.");
    const [page, statuses, reps] = await Promise.all([allCaseRecords(company), statusesOf(company), repsOf(company)]);
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    const records = page.rows.filter((r) => wanted.has(r.id) && canSeeCard({ assignedTo: r.assigned_to }, viewer));
    const x = await enrich(company.id, records);
    const repNames = new Map(reps.map((p) => [p.id, p.name]));
    const today = todayIso();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Reservations", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "ID", key: "caseNo", width: 8 },
      { header: "First name", key: "first", width: 16 },
      { header: "Last name", key: "last", width: 16 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Rep", key: "rep", width: 18 },
      { header: "Email", key: "email", width: 28 },
      { header: "ACC NUM", key: "acc", width: 12 },
      { header: "Notes", key: "notes", width: 40 },
      { header: "Product", key: "product", width: 28 },
      { header: "Status", key: "status", width: 14 },
      { header: "Source", key: "source", width: 18 },
      { header: "Follow-up", key: "followUp", width: 12 },
      { header: "Departure", key: "departure", width: 12 },
      { header: "Customer", key: "customerNo", width: 10 },
      { header: "TYPE", key: "type", width: 12 },
      { header: "Today", key: "task", width: 20 },
      { header: "Created", key: "created", width: 18 },
      { header: "National id", key: "idNumber", width: 12 },
      { header: "Form", key: "kind", width: 22 },
      { header: "Message", key: "message", width: 40 },
      { header: "UTM", key: "utm", width: 30 },
    ];
    for (const record of records) {
      const row = toCaseRow(record, x, statuses);
      const reason = todayReason(row, statuses, today);
      sheet.addRow({
        customerNo: customerLabel(row.customerNo),
        caseNo: row.caseNo,
        first: row.firstName ?? "",
        last: row.lastName ?? "",
        phone: row.phone ?? "",
        rep: row.assignedTo ? (repNames.get(row.assignedTo) ?? "") : "",
        email: row.email ?? "",
        acc: row.accNum ?? "",
        notes: row.notes ?? "",
        product: row.tourName ?? "",
        status: statusOf(row.status, statuses)?.label ?? row.status,
        source: sourceLabel(row.source, row.utm),
        followUp: row.followUpDate ?? "",
        departure: row.departureDate ?? "",
        type: CASE_TYPE_LABELS[row.type],
        task: reason ? TODAY_REASON_LABELS[reason] : "",
        created: wallClock(row.createdAt),
        idNumber: row.idNumber ?? "",
        kind: LEAD_KIND_LABELS[row.kind] ?? (row.kind === "manual" ? `Entered by staff (${CASE_SOURCE_LABELS[row.source as keyof typeof CASE_SOURCE_LABELS] ?? row.source})` : row.kind),
        message: row.message ?? "",
        utm: Object.keys(row.utm).length ? JSON.stringify(row.utm) : "",
      });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn("created").numFmt = "dd.mm.yy hh:mm";
    const buffer = await workbook.xlsx.writeBuffer();
    return actionOk({
      fileName: `reservations-${company.slug}-${today}.xlsx`,
      base64: Buffer.from(buffer as ArrayBuffer).toString("base64"),
      rows: records.length,
    });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to export the reservations");
  }
}

