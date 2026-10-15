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
import { actionFail, actionOk, chunk, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { asObject, companyAudit } from "@/lib/tours/company-kit";
import { isoToJerusalemLocal } from "@/lib/tours/format";
import { bookingRowOf, departuresOf } from "@/lib/tours/booking-rows";
import { holdOwedSeats, readCaseStatuses } from "@/lib/tours/case-seats";
import { sendTemplate, whatsappApiReady } from "@/lib/services/whatsapp-cloud";
import { ROOM_COMPOSITIONS, roomPrice, toPriceMatrix } from "@/lib/tours/pricing";
import { departureSiteId, LEAD_KIND_LABELS } from "@/types/tours.types";
import type { Database } from "@/types/database.types";
import { MAX_TRAVELERS, TRAVELERS_RULE, type ToursReservationRow } from "@/components/tours/reservations/types";
import {
  CASE_SOURCE_LABELS,
  CASE_TASK_LABELS,
  CASE_TYPE_LABELS,
  bookingBlocksDelete,
  caseName,
  checkCloseReason,
  isClosedStatus,
  needsCloseReason,
  phoneKey,
  relatedCaseOf,
  statusAfterLink,
  whatsappAppLink,
  whatsappPhone,
  type CaseCandidate,
  confirmationPendingOf,
  LINK_ROOMS_MAX,
  bookingLink,
  caseTask,
  cleanRoomKeys,
  isCaseSource,
  isCaseTask,
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
  "id, case_no, created_at, updated_at, type, kind, status, name, first_name, last_name, phone, email, id_number, acc_num, notes, message, assigned_to, follow_up_date, source, utm, source_path, departure_id, package_id, task_override, link_token, link_sent_at, payload, close_reason";

/** The same without close_reason (migration 20261015172708): a deploy that beat its migration still reads. */
const LEGACY_CASE_COLUMNS = CASE_COLUMNS.replace(", close_reason", "");
const missingColumn = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === "42703" || error?.code === "PGRST204" || /close_reason.*does not exist/.test(error?.message ?? "");

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
  | "task_override"
  | "link_token"
  | "link_sent_at"
  | "payload"
  | "close_reason"
>;
type LeadUpdate = Database["public"]["Tables"]["leads"]["Update"];

/** What a row needs from the departure, the tour, the newest booking and the seats. */
interface Enrichment {
  departures: Map<string, { code: string; startDate: string; packageId: string | null; tourName: string | null }>;
  packages: Map<string, string>;
  bookings: Map<string, { ref: string; status: string; confirmationPending: boolean }>;
  travelers: Map<string, number>;
  /** Every booking of the case, newest first, and its seat ledger - what seatGap reads. */
  seatBookings: Map<string, SeatBooking[]>;
  seatHolds: Map<string, SeatHold[]>;
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
    travelers: new Map(),
    seatBookings: new Map(),
    seatHolds: new Map(),
  };

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
        .select("lead_id, ref, status, confirmation_sent_at, created_at, departure_id, adults, children")
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
        const seat = seatBookingOf({ ref: b.ref, status: b.status, departureId: b.departure_id, adults: b.adults, children: b.children });
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
      const { data, error } = await toursDb()
        .from("departure_sales_entries")
        .select("lead_id, pax, departure_id")
        .eq("company_id", companyId)
        .in("lead_id", part)
        .is("is_deleted", null);
      if (error) throw new Error(`departure_sales_entries: ${error.message}`);
      for (const e of data ?? []) {
        if (!e.lead_id) continue;
        out.travelers.set(e.lead_id, (out.travelers.get(e.lead_id) ?? 0) + e.pax);
        out.seatHolds.set(e.lead_id, [...(out.seatHolds.get(e.lead_id) ?? []), { departureId: e.departure_id, pax: e.pax }]);
      }
    }
  };
  await Promise.all([readDepartures(), readPackages(), readBookings(), readSeats()]);
  return out;
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
    taskOverride: r.task_override,
    bookingRef: booking?.ref ?? null,
    bookingStatus: booking?.status ?? null,
    confirmationPending: booking?.confirmationPending ?? false,
    travelers: x.travelers.get(r.id) ?? 0,
    seatsMissing: seatGap(r.status, statuses, x.seatBookings.get(r.id) ?? [], x.seatHolds.get(r.id) ?? [])?.missing ?? 0,
    closeReason: r.close_reason ?? null,
    relatedCaseNo: relatedCaseOf(asObject(r.payload))?.caseNo ?? null,
  };
}

/** One case of the company (not deleted), or a UserError. */
async function caseRecord(company: Company, id: string): Promise<CaseRecord> {
  if (!UUID.test(id)) throw new UserError("The case was not found.");
  const read = (columns: string) =>
    supabaseTyped.from("leads").select(columns).eq("company_id", company.id).eq("id", id).is("is_deleted", null).maybeSingle();
  let { data, error } = await read(CASE_COLUMNS);
  if (missingColumn(error)) ({ data, error } = await read(LEGACY_CASE_COLUMNS));
  if (error) throw new Error(`leads: ${error.message}`);
  if (!data) throw new UserError("The case was not found - it may have been deleted.");
  const record = data as unknown as CaseRecord;
  return { ...record, close_reason: record.close_reason ?? null };
}

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
  const page = await read(CASE_COLUMNS);
  return missingColumn(page.error) ? read(LEGACY_CASE_COLUMNS) : page;
}

async function freshRow(company: Company, id: string): Promise<CaseRow> {
  const record = await caseRecord(company, id);
  const [x, statuses] = await Promise.all([enrich(company.id, [record]), statusesOf(company)]);
  return toCaseRow(record, x, statuses);
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
    const [page, statuses, reps] = await Promise.all([allCaseRecords(company), statusesOf(company), repsOf(company)]);
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    const x = await enrich(company.id, page.rows);
    return actionOk({
      rows: page.rows.map((r) => toCaseRow(r, x, statuses)),
      truncated: page.truncated,
      statuses,
      reps,
      currentUserId: session.sub,
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
    const before = await caseRecord(company, id);
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
        const checked = checkCloseReason(change.closeReason);
        if (!checked.ok) throw new UserError(checked.error);
        set("close_reason", before.close_reason, checked.reason);
      } else if (!isClosedStatus(status.key, statuses)) {
        set("close_reason", before.close_reason, null);
      }
      set("status", before.status, status.key);
      settled = status.key === "paid" || status.key === "done";
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
    if (change.taskOverride !== undefined) {
      if (change.taskOverride !== null && !isCaseTask(change.taskOverride)) throw new UserError("Unknown task.");
      set("task_override", before.task_override, change.taskOverride);
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
    if (change.source !== undefined) {
      if (!isCaseSource(change.source)) throw new UserError("Unknown source.");
      set("source", before.source, change.source);
    }

    if (Object.keys(patch).length) {
      const { error } = await supabaseTyped.from("leads").update(patch).eq("company_id", company.id).eq("id", id);
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
  `${held.pax === 1 ? "1 seat" : `${held.pax} seats`} of booking ${held.ref} now held on the departure${held.departureCode ? ` (${held.departureCode})` : ""}.`;

/** The status or the rep of several cases at once (the screen's bulk bar). */
export async function bulkUpdateCases(
  ids: string[],
  change: { status?: string; assignedTo?: string | null; closeReason?: string },
): Promise<ActionResult<{ updated: number }>> {
  try {
    const { company, session } = await requireCompany("tours");
    const unique = [...new Set(ids)];
    if (unique.length === 0 || unique.length > BULK_MAX) throw new UserError(`Select between 1 and ${BULK_MAX} rows.`);
    if (unique.some((id) => !UUID.test(id))) throw new UserError("A selected case was not found - reload the screen.");
    const patch: LeadUpdate = {};
    if (change.status !== undefined) {
      const statuses = await statusesOf(company);
      const status = statusOf(change.status, statuses);
      if (!status || !status.isActive) throw new UserError("Unknown status - reload the screen.");
      patch.status = status.key;
      // the same rule as one case: a closing status says why, one reason for the whole selection
      if (needsCloseReason(status.key, statuses)) {
        const checked = checkCloseReason(change.closeReason);
        if (!checked.ok) throw new UserError(checked.error);
        patch.close_reason = checked.reason;
      } else if (!isClosedStatus(status.key, statuses)) {
        patch.close_reason = null;
      }
    }
    if (change.assignedTo !== undefined) {
      if (change.assignedTo !== null && !(await repsOf(company)).some((p) => p.id === change.assignedTo)) {
        throw new UserError("A case can be assigned only to a member of the company's staff.");
      }
      patch.assigned_to = change.assignedTo;
    }
    if (Object.keys(patch).length === 0) throw new UserError("Nothing to change.");

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
    if (patch.status === "paid" || patch.status === "done") {
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
    const first = clean(input.firstName, NAME_MAX);
    if (!first) throw new UserError("Enter the customer's first name.");
    const last = clean(input.lastName, NAME_MAX);
    const phone = clean(input.phone, 40);
    const email = clean(input.email, 200)?.toLowerCase() ?? null;
    if (!phone && !email) throw new UserError("Enter a phone number or an e-mail address.");
    if (email && !EMAIL.test(email)) throw new UserError("The e-mail address is not valid.");
    const idNumber = (input.idNumber ?? "").replace(/\D/g, "") || null;
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

    const { data: created, error } = await supabaseTyped
      .from("leads")
      .insert({
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
        follow_up_date: input.followUpDate || null,
        departure_id: departure?.id ?? null,
        package_id: departure?.package_id ?? null,
      })
      .select("id, case_no")
      .single();
    if (error) throw new Error(`leads: ${error.message}`);
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
    const { company } = await requireCompany("tours");
    const before = await caseRecord(company, id);
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
    const record = await caseRecord(company, id);

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

    const [statuses, reps, x, departure, bookings, seats, history] = await Promise.all([
      statusesOf(company),
      repsOf(company),
      enrich(company.id, [record]),
      readDeparture(),
      readBookings(),
      readSeats(),
      historyOf(id),
    ]);

    const packageId = record.package_id ?? departure?.package_id ?? null;
    const [pkgAnswer, giftsAnswer, seatDepartures] = await Promise.all([
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
    ]);
    if (pkgAnswer.error) throw new Error(`packages: ${pkgAnswer.error.message}`);
    if (giftsAnswer.error) throw new Error(`promotions: ${giftsAnswer.error.message}`);
    const pkg = pkgAnswer.data as { id: string; name: string; slug: string; data: unknown; cancellation_html: string | null } | null;
    const repNames = new Map(reps.map((p) => [p.id, p.name]));
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
    const related = relatedCaseOf(payload);
    const [relatedCase] = related && related.id !== record.id ? await candidatesOf(company, [related.id], record) : [];
    return actionOk({
      row,
      payload,
      bookings,
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
      siteUrl: company.siteUrl,
      linkSentAt: record.link_sent_at,
      relatedCase: relatedCase ?? null,
      whatsappApi: whatsappApiReady(company),
    });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the case");
  }
}

// ---------------------------------------------------------------- one customer, one case
const CANDIDATES_MAX = 20;
type CandidateRecord = Pick<LeadRow, "id" | "case_no" | "name" | "first_name" | "last_name" | "phone" | "email" | "status" | "type" | "created_at">;

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
    const { company } = await requireCompany("tours");
    const self = await caseRecord(company, caseId);
    const q = (query ?? "").trim().slice(0, 80);
    const page = await fetchPaged<CandidateRecord>(
      () =>
        supabaseTyped
          .from("leads")
          .select("id, case_no, name, first_name, last_name, phone, email, status, type, created_at")
          .eq("company_id", company.id)
          .is("is_deleted", null)
          .order("case_no", { ascending: false }),
      LIST_LIMIT,
    );
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    const others = page.rows.filter((l) => l.id !== self.id);
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
    const { company } = await requireCompany("tours");
    const [a, b] = await Promise.all([caseRecord(company, caseId), caseRecord(company, otherId)]);
    if (a.id === b.id) throw new UserError("A case cannot be merged with itself.");
    const [target, source] = a.case_no < b.case_no ? [a, b] : [b, a];
    const { data, error } = await supabaseTyped.rpc("merge_lead_cases", { p_company: company.id, p_source: source.id, p_target: target.id });
    if (error?.code === "PGRST202") throw new UserError("Merging is available after the system update - try again in a few minutes.");
    if (error) throw new Error(`merge_lead_cases: ${error.message}`);
    const answer = asObject(data as never);
    if (answer.ok !== true) throw new UserError(answer.error === "not_found" ? "One of the cases was deleted meanwhile - reload." : "The cases could not be merged.");
    const moved = { bookings: Number(answer.bookings) || 0, seats: Number(answer.seats) || 0 };
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

export async function listLinkDepartures(): Promise<ActionResult<LinkDeparture[]>> {
  try {
    const { company } = await requireCompany("tours");
    return actionOk(await linkDepartures(company));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the departures");
  }
}

/**
 * A booking link for the case: the tour page on the site, the date, the rooms
 * and the case's token (`lr`). A booking sent through it lands on this case.
 * The token is minted once per case and kept. Sending it is an offer (Alon
 * 15.10): the case moves to "Offer sent" (statusAfterLink) and the rep must
 * give the day to call back. `sendWhatsApp` sends it from the company's own
 * number when the Cloud API is connected; the link is created either way.
 */
export async function mintBookingLink(
  caseId: string,
  input: { departureId: string; rooms: string[]; followUpDate: string; sendWhatsApp?: boolean },
): Promise<ActionResult<BookingLinkResult>> {
  try {
    const { company } = await requireCompany("tours");
    if (!company.siteUrl) throw new UserError("The company has no site address - set it in the company settings first.");
    const record = await caseRecord(company, caseId);
    if (!UUID.test(input.departureId)) throw new UserError("Choose a departure.");
    if (!input.followUpDate || !DAY.test(input.followUpDate)) throw new UserError("Pick the day to follow up with the customer.");
    if (input.followUpDate < todayIso()) throw new UserError("The follow-up day cannot be in the past.");
    const [departure] = await linkDepartures(company, input.departureId);
    if (!departure) throw new UserError("This departure is not open on the site (unpublished, past, sold out or closed).");
    const rooms = cleanRoomKeys(Array.isArray(input.rooms) ? input.rooms : [], departure.rooms.map((r) => r.key));
    // a date with no price table cannot be booked on the site - its page only takes a lead form
    if (departure.rooms.length === 0) throw new UserError("This date has no price table yet, so the site cannot take a booking for it. Price the date first, or send the tour page.");
    if (rooms.length === 0) throw new UserError("Choose at least one room this date sells.");
    if ((input.rooms ?? []).length > LINK_ROOMS_MAX) throw new UserError(`A booking holds up to ${LINK_ROOMS_MAX} rooms.`);

    const statuses = await statusesOf(company);
    const status = statusAfterLink(record.status, statuses);
    const token = record.link_token ?? randomBytes(24).toString("base64url");
    const patch: LeadUpdate = { link_token: token, link_sent_at: new Date().toISOString(), follow_up_date: input.followUpDate };
    if (status !== record.status) {
      patch.status = status;
      // an offer reopens a lead closed as not relevant: its reason no longer holds
      if (!isClosedStatus(status, statuses) && record.close_reason) patch.close_reason = null;
    }
    if (!record.departure_id) {
      const own = await companyDeparture(company, departure.id);
      patch.departure_id = own.id;
      patch.package_id = own.package_id;
    }
    const { error } = await supabaseTyped.from("leads").update(patch).eq("company_id", company.id).eq("id", caseId);
    if (error) throw new Error(`leads: ${error.message}`);

    const url = bookingLink({ siteUrl: company.siteUrl, packagePath: departure.packagePath, productId: departure.siteId, rooms, token });
    const first = record.first_name ?? splitName(record.name).first;
    const message = linkMessage(first, departure.tourName, url);

    // from the company's own number, when connected; a refusal never loses the link
    let warning: string | undefined;
    let sentVia: "api" | null = null;
    if (input.sendWhatsApp) {
      const to = whatsappPhone(record.phone);
      const sent = to
        ? await sendTemplate(company, { to, params: [first || "שלום", departure.tourName ?? "הטיול", url] })
        : ({ ok: false, error: "The case has no phone number WhatsApp can use." } as const);
      if (sent.ok) sentVia = "api";
      else warning = `The link was created but not sent on WhatsApp: ${sent.error}`;
    }
    await logAudit({
      action: "link",
      entityType: "tours_case",
      entityId: caseId,
      changes: {
        departure: departure.code,
        rooms,
        follow_up_date: { from: record.follow_up_date, to: input.followUpDate },
        ...(status !== record.status ? { status: { from: record.status, to: status } } : {}),
        ...(sentVia ? { sent: "whatsapp_api" } : {}),
      },
      metadata: { ...companyAudit(company), case_no: record.case_no },
    });
    revalidatePath("/tours/reservations");
    return actionOk(
      {
        url,
        message,
        status,
        whatsapp: waLink(record.phone, message),
        whatsappApp: whatsappAppLink(record.phone, message),
        mailto: record.email
          ? `mailto:${record.email}?subject=${encodeURIComponent("קישור להזמנה")}&body=${encodeURIComponent(message)}`
          : null,
      },
      warning ?? (sentVia ? "Sent on WhatsApp from the company number." : undefined),
    );
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to create the booking link");
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
    const { company } = await requireCompany("tours");
    const wanted = new Set(ids.filter((id) => UUID.test(id)));
    if (wanted.size === 0) throw new UserError("Nothing to export.");
    const [page, statuses, reps] = await Promise.all([allCaseRecords(company), statusesOf(company), repsOf(company)]);
    if (page.error) throw new Error(`leads: ${page.error.message}`);
    const records = page.rows.filter((r) => wanted.has(r.id));
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
      { header: "TYPE", key: "type", width: 12 },
      { header: "TASK", key: "task", width: 20 },
      { header: "Created", key: "created", width: 18 },
      { header: "National id", key: "idNumber", width: 12 },
      { header: "Form", key: "kind", width: 22 },
      { header: "Message", key: "message", width: 40 },
      { header: "UTM", key: "utm", width: 30 },
    ];
    for (const record of records) {
      const row = toCaseRow(record, x, statuses);
      const task = caseTask(row, statuses, today);
      sheet.addRow({
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
        task: task ? CASE_TASK_LABELS[task] : "",
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

