"use server";

import { requireStaff, requireSuperadmin } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
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
  const { rows, truncated, error } = await fetchPaged<ReservationListDbRow>(
    () =>
      supabase
        .from("reservations")
        .select(RESERVATION_LIST_COLUMNS)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    20000,
  );

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
    .select("id", { count: "exact", head: true });

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

export async function updateReservation(
  id: number,
  reservation: Partial<Reservation>,
) {
  await requireStaff();
  const auditBefore = await fetchBefore("reservations", "id", id, reservation);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reservations")
    .update(reservation)
    .eq("id", id)
    .select();

  if (error) throw error;
  await logAudit({
    action: "update",
    entityType: "reservation",
    entityId: id,
    changes: diffChanges(auditBefore, reservation),
  });
  if (toRelease) await releaseOfflineInventory(toRelease);
  return data[0] as Reservation;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("reservations")
    .update({ status })
    .in("id", ids)
    .select();

  if (error) throw error;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: flightRow } = await (supabase as any)
        .from("flights")
        .select("consumed_quantity")
        .eq("id", offlineFlightId)
        .single();
      if (flightRow) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: flErr } = await (supabase as any)
          .from("flights")
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current } = await (supabase as any)
    .from("flights")
    .select("consumed_quantity")
    .eq("id", flightId)
    .single();
  if (current && current.consumed_quantity !== consumed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from("flights")
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
