"use server";

import { requireStaff, requireSuperadmin } from "@/lib/auth/guards";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { followUpDateOnSave, isFollowUpStatus } from "@/lib/reservations/follow-up";
import { isMissingColumn } from "@/lib/services/reservation-follow-ups";
import { israelDate } from "@/lib/tasks/reminders";
import { megaEventsFlights } from "@/lib/flights-scope";
import { fetchPaged } from "@/lib/supabase-paged";
import { getAgentLabelsForReservations } from "@/lib/portal-attribution";
import type {
  Reservation,
  ReservationListRow,
} from "@/types/reservation.types";
import type { UtmTouch } from "@/types/utm.types";
import { revalidatePath } from "next/cache";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

// Exactly the columns the reservations LIST page renders (reservations-table.tsx).
// The fat JSONB blobs (event/flight/hotel order info, pax list) are detail-only -
// they were ~90% of the old select("*") payload (8.4MB for 1000 rows).
// payment_info is fetched only to derive has_payment_info and never leaves the
// server. Rows are ordered newest-first with id as tiebreaker so paging is stable.
const RESERVATION_LIST_COLUMNS =
  "id,created_at,main_contact_first_name,main_contact_last_name," +
  "main_contact_phone_number,main_contact_email,user_shown_price," +
  "aff_partner_tracking_code,event_id,status,accounting_number,comments," +
  "offline_flight_id,offline_hotel_id,partner_settlement_method,payment_info," +
  "is_deleted";

type ReservationListDbRow = Omit<ReservationListRow, "has_payment_info"> & {
  payment_info: unknown;
};

export async function getReservations(): Promise<ReservationListRow[]> {
  await requireStaff();
  // Paged: PostgREST hard-caps every response at 1000 rows, so the old single
  // fetch silently dropped everything past the cap once the table outgrew it
  // (1331 rows as of 2026-08-19 → the 331 oldest were invisible).
  const read = (columns: string) => fetchPaged<ReservationListDbRow>(
    () =>
      supabase
        .from("reservations")
        .select(columns)
        // Agent payment-link DRAFTS are not reservations yet (אזור סוכן V2,
        // 2026-08-27: "לא פותח אצלנו הזמנה חדשה בבק אופיס - רק כאשר הלקוח
        // שילם או ביקש לפצל תשלום"). Such a draft is a 24Save hold whose
        // settlement method is payment_link; when the customer pays, a NEW
        // row is created (Pending/Paid) and shows here normally. A row
        // survives the filter if ANY branch holds - i.e. it is dropped only
        // when status=24Save AND partner_settlement_method=payment_link.
        // Customer self-holds (method is null) keep showing.
        .or(
          "status.neq.24Save,partner_settlement_method.is.null,partner_settlement_method.neq.payment_link",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    20000,
  );
  // follow_up_date is read separately from the fixed list so a deploy that beat
  // its migration still loads the table - every row simply has no call-back day.
  let { rows, truncated, error } = await read(`${RESERVATION_LIST_COLUMNS},follow_up_date`);
  if (error && isMissingColumn(error)) {
    ({ rows, truncated, error } = await read(RESERVATION_LIST_COLUMNS));
  }

  if (error) throw error;
  if (truncated)
    console.error("getReservations: hit the 20k paging cap - raise it");

  // Staff-facing "סוכן" column - which office agent the booking is credited
  // to, resolved across every office by slug (see getAgentLabelsForReservations).
  const agentLabels = await getAgentLabelsForReservations(
    rows.map((r) => r.id),
  );

  return rows.map(({ payment_info, ...row }) => ({
    ...row,
    has_payment_info: payment_info != null,
    agent_label: agentLabels.get(row.id) ?? null,
  }));
}

/** Row count only (head request, no payload) - for the new-reservations poll. */
export async function getReservationsCount() {
  await requireStaff();
  const { count, error } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    // Same draft exclusion as getReservations - an agent creating a payment
    // link must not ping staff with a "new reservation".
    .or(
      "status.neq.24Save,partner_settlement_method.is.null,partner_settlement_method.neq.payment_link",
    );

  if (error) throw error;
  return count ?? 0;
}

export async function getReservation(id: number) {
  await requireStaff();
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Reservation;
}

const todayStamp = () => {
  const today = new Date();
  return `${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}-${today.getFullYear()}`;
};

/**
 * Soft delete - same convention as events (softDeleteEvent): stamps
 * is_deleted with today's "MM-DD-YYYY" date, never a hard DELETE. Recoverable
 * (no UI for un-delete yet, but the row and every FK to it - utm_touches,
 * quote_id, etc - stay intact). Removes the row from the LIST page only
 * (reservations-table.tsx filters client-side, mirroring events-table.tsx);
 * direct-by-id lookups (getReservation) still work.
 */
export async function softDeleteReservation(id: number) {
  await requireSuperadmin();
  const formattedDate = todayStamp();

  const { data, error } = await supabase
    .from("reservations")
    .update({ is_deleted: formattedDate } as never)
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "reservation",
    entityId: id,
    changes: { is_deleted: formattedDate },
  });
  return data[0] as Reservation;
}

export async function bulkSoftDeleteReservations(ids: number[]) {
  await requireSuperadmin();
  const formattedDate = todayStamp();

  const { data, error } = await supabase
    .from("reservations")
    .update({ is_deleted: formattedDate } as never)
    .in("id", ids)
    .select();

  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "reservation",
    entityId: ids.join(","),
    changes: { is_deleted: formattedDate, count: ids.length },
  });
  return data as Reservation[];
}

/**
 * Attribution touches for this reservation, captured from the `myt_utm`
 * cookie at checkout (see types/utm.types.ts). position 0 is the primary
 * (attributed) touch. Returns [] on any query error - including the
 * expected case where `utm_touches` hasn't been migrated onto the connected
 * DB yet - so the reservation-detail attribution section just stays hidden.
 */
export async function getReservationUtmTouches(
  reservationId: number,
): Promise<UtmTouch[]> {
  await requireStaff();
  const { data, error } = await supabase
    .from("utm_touches")
    .select(
      "id, reservation_id, position, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, is_influencer, visited_at, created_at",
    )
    .eq("reservation_id", reservationId)
    .order("position", { ascending: true });
  if (error) {
    console.error(JSON.stringify(error));
    return [];
  }
  return (data ?? []) as UtmTouch[];
}

/** Staff-facing: which agent this single reservation is credited to (see
 *  getAgentLabelsForReservations), or null when unattributed. Reservation-detail
 *  counterpart to the bulk lookup the list page uses. */
export async function getReservationAgentLabel(
  reservationId: number,
): Promise<string | null> {
  await requireStaff();
  const labels = await getAgentLabelsForReservations([reservationId]);
  return labels.get(reservationId) ?? null;
}

export async function createReservation(
  reservation: Omit<Reservation, "id" | "created_at">,
) {
  await requireStaff();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reservations")
    .insert(reservation)
    .select();

  if (error) throw error;
  const created = data[0] as Reservation;
  await logAudit({
    action: "create",
    entityType: "reservation",
    entityId: created.id,
    changes: reservation,
  });
  return created;
}

/**
 * Statuses that hold NO offline inventory.
 *
 * `24Save` is a 24-hour price hold, not a booking: the customer has paid
 * nothing, reserved nothing, and may never return. The main app stopped
 * consuming seats for it at checkout, so anything that recomputes consumption
 * from reservations has to agree - otherwise the counters here would write the
 * seats straight back, and the customer's own hold would then read as sold out
 * when they came back through their recovery link.
 */
const RELEASED_STATUSES = new Set(["Cancelled", "Lost", "24Save"]);

/**
 * The call-back day a save leaves behind (lib/reservations/follow-up.ts): a reservation
 * that ENTERS Follow-up always gets one, and a date the form sends is cleaned to a real day
 * or null. A save that touches neither the status nor the date passes through untouched.
 * Before the column is migrated (or when the read fails) the date is dropped from the save,
 * so the rest of it still goes through - the row then reads "No date".
 */
async function withFollowUpDate(
  id: number,
  patch: Partial<Reservation>,
): Promise<Partial<Reservation>> {
  if (patch.status === undefined && patch.follow_up_date === undefined) return patch;
  const { data: prev, error } = await supabaseTyped
    .from("reservations")
    .select("status,follow_up_date")
    .eq("id", id)
    .maybeSingle();
  if (error || !prev) {
    if (error && !isMissingColumn(error)) {
      console.error("withFollowUpDate:", JSON.stringify(error));
    }
    const rest = { ...patch };
    delete rest.follow_up_date;
    return rest;
  }
  const next = followUpDateOnSave({
    prevStatus: prev.status,
    nextStatus: patch.status,
    current: prev.follow_up_date,
    requested: patch.follow_up_date,
    today: israelDate(new Date()),
  });
  return next === undefined ? patch : { ...patch, follow_up_date: next };
}

/**
 * Bulk status change: the reservations that ENTER Follow-up, grouped by the call-back day
 * they should get. Read BEFORE the status write (the rule needs the previous status).
 * Any failure = an empty map: the status change itself must never depend on this.
 */
async function followUpDatesForBulk(
  ids: number[],
  status: string,
): Promise<Map<string, number[]>> {
  const byDate = new Map<string, number[]>();
  if (!isFollowUpStatus(status)) return byDate;
  const { data, error } = await supabaseTyped
    .from("reservations")
    .select("id,status,follow_up_date")
    .in("id", ids);
  if (error) {
    if (!isMissingColumn(error)) console.error("followUpDatesForBulk:", JSON.stringify(error));
    return byDate;
  }
  const today = israelDate(new Date());
  for (const row of data ?? []) {
    const next = followUpDateOnSave({
      prevStatus: row.status,
      nextStatus: status,
      current: row.follow_up_date,
      today,
    });
    if (typeof next !== "string" || next === row.follow_up_date) continue;
    byDate.set(next, [...(byDate.get(next) ?? []), row.id]);
  }
  return byDate;
}

/**
 * The real supplier cost ops typed for a whole order: a finite number >= 0, to the cent.
 * Blank, NaN, negative or anything that is not a number = null ("no actual cost - the computed
 * one applies"). The edit form holds the box as text, so a string is parsed here.
 */
function cleanActualCost(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** The cost note: trimmed text, or null when empty. */
function cleanCostNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

/** True only for a "column does not exist" failure that NAMES one of the two cost columns
 *  (migration 20261008120000 may not be applied yet) - any other failure still throws. */
function isMissingCostColumn(error: unknown): boolean {
  if (!isMissingColumn(error)) return false;
  const { message, details, hint } = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  return /actual_cost/.test(`${message ?? ""} ${details ?? ""} ${hint ?? ""}`);
}

const COST_PENDING_NOTICE =
  "Actual cost was not saved - it needs the pending database update. Everything else was saved.";

export async function updateReservation(
  id: number,
  input: Partial<Reservation>,
): Promise<Reservation & { notice?: string }> {
  await requireStaff();
  // The two cost columns are mapped by hand: cleaned here, never trusted as the form sent them.
  // A key the caller did not send is left out entirely, so a save that never touched the cost
  // (the list's inline edits, or a page loaded before the migration) cannot write it.
  const { actual_cost_usd, actual_cost_note, ...rest } = input;
  const cost: { actual_cost_usd?: number | null; actual_cost_note?: string | null } = {};
  if (actual_cost_usd !== undefined) cost.actual_cost_usd = cleanActualCost(actual_cost_usd);
  if (actual_cost_note !== undefined) cost.actual_cost_note = cleanCostNote(actual_cost_note);
  const hasCost = Object.keys(cost).length > 0;

  const reservation = await withFollowUpDate(id, rest);
  // The before-snapshot asks for every column being written; when the cost columns are not
  // migrated that read fails whole, so ask again without them - the diff of the other fields
  // must survive the window between the deploy and its migration.
  let auditBefore = await fetchBefore("reservations", "id", id, { ...reservation, ...cost });
  if (!auditBefore && hasCost) {
    auditBefore = await fetchBefore("reservations", "id", id, reservation);
  }
  // Detect transition into a released status so we can return inventory
  let toRelease: Reservation | null = null;
  if (reservation.status && RELEASED_STATUSES.has(reservation.status)) {
    const { data: current } = await supabase
      .from("reservations")
      .select("*")
      .eq("id", id)
      .single();
    const prev = current as Reservation | null;
    if (prev && !RELEASED_STATUSES.has(prev.status)) toRelease = prev;
  }

  const write = (patch: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("reservations").update(patch).eq("id", id).select();

  let written: Record<string, unknown> = { ...reservation, ...cost };
  let { data, error } = await write(written);

  // Not migrated yet: save everything else and say so - the cost must never fail the save.
  let notice: string | undefined;
  if (error && hasCost && isMissingCostColumn(error)) {
    console.warn("updateReservation: actual cost columns missing, saved without them");
    notice = COST_PENDING_NOTICE;
    written = reservation;
    if (Object.keys(written).length > 0) {
      ({ data, error } = await write(written));
    } else {
      // Nothing but the cost was sent: there is no update left to make, just read the row back.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ data, error } = await (supabase as any).from("reservations").select("*").eq("id", id));
    }
  }

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: id,
    changes: diffChanges(auditBefore, written),
    ...(notice ? { metadata: { actual_cost_skipped: "columns not migrated yet" } } : {}),
  });
  if (toRelease) await releaseOfflineInventory(toRelease);
  return { ...(data[0] as Reservation), ...(notice ? { notice } : {}) };
}

/**
 * The voucher's own lifecycle, separate from `status` on purpose: main writes
 * status and 'Paid' means "money collected"; the chain sent → received →
 * collected is a backoffice-only fact (טאב התחשבנות שוברים, 2026-08-06).
 */
const VOUCHER_STATES = ["sent", "received", "collected"] as const;
export type VoucherState = (typeof VOUCHER_STATES)[number];

export async function setReservationVoucherState(
  id: number,
  state: VoucherState | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  if (state !== null && !VOUCHER_STATES.includes(state)) {
    return { ok: false, error: "מצב שובר לא מוכר" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("reservations")
    .update({ voucher_state: state })
    .eq("id", id);
  if (error) {
    console.error("setReservationVoucherState:", JSON.stringify(error));
    return {
      ok: false,
      error:
        error.code === "42703" || error.code === "PGRST204"
          ? "היכולת הזו תהיה זמינה אחרי עדכון המערכת"
          : "עדכון מצב השובר נכשל",
    };
  }
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: id,
    metadata: { voucher_state: state },
  });
  revalidatePath(`/reservations/${id}`);
  return { ok: true };
}

/** Staff stamp for "travel material sent to the customer" (חומר ללקוח). */
export async function setTravelMaterialsSent(
  id: number,
  sent: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("reservations")
    .update({
      travel_materials_sent_at: sent ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) {
    console.error("setTravelMaterialsSent:", JSON.stringify(error));
    return {
      ok: false,
      error:
        error.code === "42703" || error.code === "PGRST204"
          ? "היכולת הזו תהיה זמינה אחרי עדכון המערכת"
          : "עדכון סימון החומר נכשל",
    };
  }
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: id,
    metadata: { travel_materials_sent: sent },
  });
  revalidatePath(`/reservations/${id}`);
  return { ok: true };
}

export async function updateReservationsStatus(ids: number[], status: string) {
  await requireStaff();
  if (!ids || ids.length === 0) return [] as Reservation[];

  let toRelease: Reservation[] = [];
  if (RELEASED_STATUSES.has(status)) {
    const { data: current } = await supabase
      .from("reservations")
      .select("*")
      .in("id", ids);
    toRelease = ((current ?? []) as Reservation[]).filter(
      (r) => !RELEASED_STATUSES.has(r.status),
    );
  }

  const followUpDates = await followUpDatesForBulk(ids, status);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reservations")
    .update({ status })
    .in("id", ids)
    .select();

  if (error) throw error;

  // The status is saved; a call-back day that fails to save leaves the row "No date",
  // which still shows as waiting - never a reason to fail the whole change.
  for (const [date, datedIds] of followUpDates) {
    const { error: dateError } = await supabaseTyped
      .from("reservations")
      .update({ follow_up_date: date })
      .in("id", datedIds);
    if (dateError) console.error("updateReservationsStatus follow_up_date:", JSON.stringify(dateError));
  }

  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: null,
    metadata: { ids, status },
  });

  for (const r of toRelease) {
    await releaseOfflineInventory(r);
  }
  return data as Reservation[];
}

export async function cancelReservation(id: number): Promise<Reservation> {
  await requireStaff();
  const { data: current, error: fetchError } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError) throw fetchError;

  const reservation = current as Reservation;
  if (RELEASED_STATUSES.has(reservation.status)) return reservation;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reservations")
    .update({ status: "Cancelled" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: id,
    metadata: { cancelled: true },
  });

  await releaseOfflineInventory(reservation);

  revalidatePath(`/reservations/${id}`);
  revalidatePath("/reservations");
  return data as Reservation;
}

async function releaseOfflineInventory(reservation: Reservation) {
  try {
    const offlineFlightId = reservation.offline_flight_id ?? null;
    const flightInfo = reservation.flight_order_info as
      | { numOfTravelers?: number }
      | undefined;
    const numOfTravelers = flightInfo?.numOfTravelers || 0;
    if (offlineFlightId && numOfTravelers > 0) {
      // Reservations are Mega Events orders: only a Mega Events flight gets
      // its seats back. A block of another company is never read or written.
      const { data: flightRow } = await megaEventsFlights()
        .select("consumed_quantity")
        .eq("id", offlineFlightId)
        .maybeSingle();
      if (flightRow) {
        const { error: flErr } = await megaEventsFlights()
          .update({
            consumed_quantity: Math.max(
              0,
              (flightRow.consumed_quantity || 0) - numOfTravelers,
            ),
          })
          .eq("id", offlineFlightId);
        if (flErr) throw flErr;
      }
    }

    const offlineHotelIds: number[] =
      reservation.offline_hotel_ids && reservation.offline_hotel_ids.length > 0
        ? reservation.offline_hotel_ids
        : reservation.offline_hotel_id
          ? [reservation.offline_hotel_id]
          : [];

    if (offlineHotelIds.length > 0) {
      const counts = new Map<number, number>();
      for (const rowId of offlineHotelIds) {
        counts.set(rowId, (counts.get(rowId) || 0) + 1);
      }
      for (const [rowId, count] of counts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: hotelRow } = await (supabase as any)
          .from("offline_hotels")
          .select("consumed_rooms")
          .eq("id", rowId)
          .single();
        if (hotelRow) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("offline_hotels")
            .update({
              consumed_rooms: Math.max(
                0,
                (hotelRow.consumed_rooms || 0) - count,
              ),
            })
            .eq("id", rowId);
        }
      }
    }
  } catch (e) {
    console.error("Failed to release offline inventory on cancel:", e);
    throw e;
  }
}

export type InventoryReservation = Pick<
  Reservation,
  | "id"
  | "created_at"
  | "main_contact_first_name"
  | "main_contact_last_name"
  | "main_contact_email"
  | "main_contact_phone_number"
  | "status"
  | "more_pax_info"
  | "offline_flight_id"
  | "offline_hotel_id"
  | "offline_hotel_ids"
>;

const INVENTORY_RESERVATION_FIELDS =
  "id, created_at, main_contact_first_name, main_contact_last_name, main_contact_email, main_contact_phone_number, status, more_pax_info, offline_flight_id, offline_hotel_id, offline_hotel_ids";

// Cancelled/Lost/24Save reservations hold no inventory and are hidden from the
// inventory detail pages. Keep in step with RELEASED_STATUSES above.
const ACTIVE_RESERVATION_STATUSES_FILTER = "Cancelled,Lost,24Save";

// Belt-and-suspenders: the SQL `not.in` filter is case-sensitive and exact, so
// a stored status like "lost" or "Lost " would slip past it. Re-filter in JS
// against RELEASED_STATUSES, normalized, so released reservations never show in
// an inventory view or passenger manifest.
const RELEASED_STATUSES_LOWER = new Set(
  Array.from(RELEASED_STATUSES, (s) => s.toLowerCase()),
);
function dropReleased(rows: InventoryReservation[]): InventoryReservation[] {
  return rows.filter(
    (r) => !RELEASED_STATUSES_LOWER.has((r.status ?? "").trim().toLowerCase()),
  );
}

export async function getReservationsForFlight(
  flightId: number,
): Promise<InventoryReservation[]> {
  await requireStaff();
  const { data, error } = await supabase
    .from("reservations")
    .select(INVENTORY_RESERVATION_FIELDS)
    .eq("offline_flight_id", flightId)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return dropReleased((data ?? []) as unknown as InventoryReservation[]);
}

export async function getReservationsForHotel(
  hotelId: number,
): Promise<InventoryReservation[]> {
  await requireStaff();
  const { data, error } = await supabase
    .from("reservations")
    .select(INVENTORY_RESERVATION_FIELDS)
    .or(`offline_hotel_id.eq.${hotelId},offline_hotel_ids.cs.{${hotelId}}`)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return dropReleased((data ?? []) as unknown as InventoryReservation[]);
}

// Recomputes consumed_quantity for an offline flight from active reservations.
// Each reservation counts its `flight_order_info.numOfTravelers` (default 1).
// Idempotent - safe to run on every page view.
// MEGA EVENTS FLIGHTS ONLY: reservations are event orders. A group block of a
// tours company has no reservations here (its sold count comes from the tours
// module), so recomputing it from this table would write 0 over the real
// number. Both the read and the write are scoped; for any other company's
// flight this is a no-op.
export async function reconcileFlightInventory(
  flightId: number,
): Promise<number> {
  await requireStaff();
  const { data: rows, error } = await supabase
    .from("reservations")
    .select("flight_order_info, status")
    .eq("offline_flight_id", flightId)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`);
  if (error) throw error;

  let consumed = 0;
  for (const r of (rows ?? []) as {
    flight_order_info: { numOfTravelers?: number } | null;
  }[]) {
    const n = r?.flight_order_info?.numOfTravelers;
    consumed += typeof n === "number" && n > 0 ? n : 0;
  }

  const { data: current } = await megaEventsFlights()
    .select("consumed_quantity")
    .eq("id", flightId)
    .maybeSingle();
  if (current && current.consumed_quantity !== consumed) {
    const { error: upErr } = await megaEventsFlights()
      .update({ consumed_quantity: consumed })
      .eq("id", flightId);
    if (upErr) throw upErr;
  }
  return consumed;
}

// Recomputes consumed_rooms for an offline hotel from active reservations.
// Each occurrence of the hotel id in `offline_hotel_ids` (or `offline_hotel_id`
// fallback) counts as one room.
export async function reconcileHotelInventory(
  hotelId: number,
): Promise<number> {
  await requireStaff();
  const { data: rows, error } = await supabase
    .from("reservations")
    .select("offline_hotel_id, offline_hotel_ids, status")
    .or(`offline_hotel_id.eq.${hotelId},offline_hotel_ids.cs.{${hotelId}}`)
    .not("status", "in", `(${ACTIVE_RESERVATION_STATUSES_FILTER})`);
  if (error) throw error;

  let consumed = 0;
  for (const r of (rows ?? []) as {
    offline_hotel_id: number | null;
    offline_hotel_ids: number[] | null;
  }[]) {
    const ids =
      r.offline_hotel_ids && r.offline_hotel_ids.length > 0
        ? r.offline_hotel_ids
        : r.offline_hotel_id != null
          ? [r.offline_hotel_id]
          : [];
    consumed += ids.filter((id) => id === hotelId).length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current } = await (supabase as any)
    .from("offline_hotels")
    .select("consumed_rooms")
    .eq("id", hotelId)
    .single();
  if (current && current.consumed_rooms !== consumed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from("offline_hotels")
      .update({ consumed_rooms: consumed })
      .eq("id", hotelId);
    if (upErr) throw upErr;
  }
  return consumed;
}
