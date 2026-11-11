/**
 * The database and storage boundary of TixStock ticket bookings: the real dependencies of the webhook
 * (tixstock-webhook.ts `WebhookDeps`), of applying an order update (tixstock-order-apply.ts `ApplyDeps`) and of
 * the sweep (tixstock-booking-sweep.ts `SweepDeps`). The logic itself lives in those files and runs over stubs in
 * scripts/tixstock-webhook-selftest.ts and scripts/tixstock-booking-sweep-selftest.ts. Server only.
 *
 * Tables `ticket_bookings`, `ticket_booking_files`, `tixstock_webhook_events` and the private bucket `ticket-files`
 * come from supabase/migrations/20261110100000_tixstock_ticket_booking.sql. `status`, `env` and `source` are plain
 * text there, so every row read is narrowed before it is used.
 */
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import type { Json } from "@/types/database.types";
import { isBookingStatus, type BookingEnv, type BookingStatus } from "@/lib/tixstock-booking/rules";
import { ticketFileStoragePath, type ApplyDeps, type BookingRow, type FileToSave } from "@/lib/services/tixstock-order-apply";
import type { WebhookDeps } from "@/lib/services/tixstock-webhook";
import type { SweepDeps, SweepReservation, SweepRow } from "@/lib/services/tixstock-booking-sweep";
import { tixstockClientFor } from "@/lib/services/tixstock-booking-env";
import { sendMail } from "@/lib/email";

export const TICKET_FILES_BUCKET = "ticket-files";

const BOOKING_COLUMNS =
  "id, reservation_id, env, source, status, listing_id, quantity, tixstock_order_id, released_to_customer_at, created_at";

type RawBooking = {
  id: string;
  reservation_id: number;
  env: string;
  source: string;
  status: string;
  listing_id: string;
  quantity: number;
  tixstock_order_id: string | null;
  released_to_customer_at: string | null;
  created_at: string;
};

/** A row whose env / source / status is not one we know is treated as absent, never guessed at. */
const toBookingRow = (r: RawBooking): BookingRow | null => {
  if (r.env !== "sandbox" && r.env !== "production") return null;
  if (r.source !== "office" && r.source !== "site") return null;
  if (!isBookingStatus(r.status)) return null;
  return { ...r, env: r.env, source: r.source, status: r.status };
};

export async function loadBooking(id: string): Promise<BookingRow | null> {
  const { data, error } = await supabaseTyped.from("ticket_bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`ticket_bookings read failed: ${error.message}`);
  return data ? toBookingRow(data) : null;
}

export async function findBookingByOrder(env: BookingEnv, orderId: string): Promise<BookingRow | null> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .select(BOOKING_COLUMNS)
    .eq("env", env)
    .eq("tixstock_order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ticket_bookings read by order failed: ${error.message}`);
  return data ? toBookingRow(data) : null;
}

/**
 * The booking an order id of ours names (`ourOrderId`: the reservation and the first 8 characters of the row's id).
 * A reservation has a handful of rows, so the prefix is matched here; two rows that share it name nothing.
 */
export async function findBookingByOurId(env: BookingEnv, reservationId: number, bookingPrefix: string): Promise<BookingRow | null> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .select(BOOKING_COLUMNS)
    .eq("env", env)
    .eq("reservation_id", reservationId);
  if (error) throw new Error(`ticket_bookings read by our order id failed: ${error.message}`);
  const found = (data ?? []).filter((r) => r.id.toLowerCase().startsWith(bookingPrefix));
  return found.length === 1 ? toBookingRow(found[0]) : null;
}

/** The tickets in hand for a booking: its stored PDF files and its mobile links. */
export async function countTicketFiles(bookingId: string): Promise<{ pdf: number; mobileLink: number }> {
  const { data, error } = await supabaseTyped
    .from("ticket_booking_files")
    .select("kind")
    .eq("booking_id", bookingId)
    .in("kind", ["pdf", "mobile_link"]);
  if (error) throw new Error(`ticket_booking_files count failed: ${error.message}`);
  const kinds = (data ?? []).map((r) => r.kind);
  return { pdf: kinds.filter((k) => k === "pdf").length, mobileLink: kinds.filter((k) => k === "mobile_link").length };
}

export async function findUncertain(env: BookingEnv, listingId: string, sinceIso: string): Promise<BookingRow[]> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .select(BOOKING_COLUMNS)
    .eq("env", env)
    .eq("status", "uncertain")
    .eq("listing_id", listingId)
    .gte("created_at", sinceIso);
  if (error) throw new Error(`ticket_bookings uncertain read failed: ${error.message}`);
  return (data ?? []).map(toBookingRow).filter((b): b is BookingRow => b !== null);
}

/** Gives an `uncertain` booking the order id a webhook revealed. A row that already has one is left alone. */
export async function attachOrder(bookingId: string, orderId: string): Promise<void> {
  const { error } = await supabaseTyped
    .from("ticket_bookings")
    .update({ tixstock_order_id: orderId, updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("status", "uncertain")
    .is("tixstock_order_id", null);
  if (error) throw new Error(`ticket_bookings attach order failed: ${error.message}`);
}

export async function fileExists(dedupeKey: string): Promise<boolean> {
  const { data, error } = await supabaseTyped.from("ticket_booking_files").select("id").eq("dedupe_key", dedupeKey).maybeSingle();
  if (error) throw new Error(`ticket_booking_files read failed: ${error.message}`);
  return data !== null;
}

/**
 * Bytes go to the private bucket first (over any earlier object, so a retry after a failed row insert works), then
 * the row is inserted; a second insert of the same dedupe key is ignored and reported as "exists".
 */
export async function saveFile(bookingId: string, file: FileToSave, webhookEventId?: string | null): Promise<"saved" | "exists"> {
  let storagePath: string | null = null;
  let contentType: string | null = null;
  if (file.base64) {
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.length === 0) throw new Error("ticket file has no bytes");
    contentType = bytes.subarray(0, 4).toString("latin1") === "%PDF" ? "application/pdf" : "application/octet-stream";
    storagePath = ticketFileStoragePath(bookingId, file.dedupeKey);
    const { error } = await supabase.storage.from(TICKET_FILES_BUCKET).upload(storagePath, bytes, { contentType, upsert: true });
    if (error) throw new Error(`ticket file upload failed: ${error.message}`);
  }
  const { data, error } = await supabaseTyped
    .from("ticket_booking_files")
    .upsert(
      {
        booking_id: bookingId,
        kind: file.kind,
        row: file.row,
        seat: file.seat,
        storage_path: storagePath,
        content_type: contentType,
        url: file.url ?? null,
        webhook_event_id: webhookEventId ?? null,
        dedupe_key: file.dedupeKey,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`ticket_booking_files insert failed: ${error.message}`);
  return (data ?? []).length > 0 ? "saved" : "exists";
}

/** Compare-and-set: the row moves only if it still has the status it was read with. */
export async function setStatus(id: string, from: BookingStatus, to: BookingStatus, atIso: string): Promise<boolean> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .update({
      status: to,
      updated_at: atIso,
      ...(to === "approved" ? { approved_at: atIso } : {}),
      ...(to === "commissionable" ? { commissionable_at: atIso } : {}),
    })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) throw new Error(`ticket_bookings status change failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function markReleased(id: string, atIso: string): Promise<void> {
  const { error } = await supabaseTyped
    .from("ticket_bookings")
    .update({ released_to_customer_at: atIso, updated_at: atIso })
    .eq("id", id)
    .is("released_to_customer_at", null);
  if (error) throw new Error(`ticket_bookings release failed: ${error.message}`);
}

export function realApplyDeps(): ApplyDeps {
  return { now: () => new Date(), loadBooking, fileExists, saveFile, setStatus, markReleased };
}

// ---- The sweep (tixstock-booking-sweep.ts) ----

const SWEEP_COLUMNS = `${BOOKING_COLUMNS}, hold_id, updated_at, attempt_started_at, last_refresh_at, link_email_sent_at, customer_token`;

type RawSweepRow = RawBooking & {
  hold_id: string | null;
  updated_at: string;
  attempt_started_at: string | null;
  last_refresh_at: string | null;
  link_email_sent_at: string | null;
  customer_token: string | null;
};

const toSweepRow = (r: RawSweepRow): SweepRow | null => {
  const base = toBookingRow(r);
  if (!base) return null;
  return {
    ...base,
    hold_id: r.hold_id,
    updated_at: r.updated_at,
    attempt_started_at: r.attempt_started_at,
    last_refresh_at: r.last_refresh_at,
    link_email_sent_at: r.link_email_sent_at,
    customer_token: r.customer_token,
  };
};

const OPEN_STATUSES: BookingStatus[] = ["holding", "on_hold", "ordering", "sale_on_hold"];

export async function listOpenBookings(limit: number): Promise<SweepRow[]> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .select(SWEEP_COLUMNS)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`ticket_bookings open read failed: ${error.message}`);
  return ((data ?? []) as unknown as RawSweepRow[]).map(toSweepRow).filter((r): r is SweepRow => r !== null);
}

/**
 * Orders past approval that still have no ticket stored. "No ticket" is an anti-join: the embedded
 * `ticket_booking_files` filtered `is null` keeps only bookings with no file row (PostgREST embed filter over
 * ticket_booking_files_booking_id_fkey). The untyped client: the typed one does not know an embed as a filter.
 * Should that filter ever be ignored, the sweep still stamps each row it looks at, so the cost is one extra
 * orders/get a day for a booking that has its tickets - nothing is stored twice (dedupe key).
 */
export async function listRefreshDueBookings(
  cutoffs: { createdBeforeIso: string; staleBeforeIso: string },
  limit: number,
): Promise<SweepRow[]> {
  const { data, error } = await supabase
    .from("ticket_bookings")
    .select(`${SWEEP_COLUMNS}, ticket_booking_files(id)`)
    .in("status", ["approved", "commissionable"])
    .not("tixstock_order_id", "is", null)
    .is("ticket_booking_files", null)
    .lt("created_at", cutoffs.createdBeforeIso)
    .or(`last_refresh_at.is.null,last_refresh_at.lt."${cutoffs.staleBeforeIso}"`)
    .order("last_refresh_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`ticket_bookings refresh read failed: ${error.message}`);
  return ((data ?? []) as unknown as RawSweepRow[]).map(toSweepRow).filter((r): r is SweepRow => r !== null);
}

/** `paid` = the reservation says Paid and is not deleted. A reservation that is gone reads as null. */
export async function loadSweepReservation(id: number): Promise<SweepReservation | null> {
  const { data, error } = await supabaseTyped
    .from("reservations")
    .select("id, status, is_deleted, main_contact_email, event_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`reservations read failed: ${error.message}`);
  if (!data) return null;
  const { data: event, error: eventError } = await supabaseTyped.from("events").select("name, date").eq("id", data.event_id).maybeSingle();
  if (eventError) throw new Error(`events read failed: ${eventError.message}`);
  return {
    paid: data.status === "Paid" && data.is_deleted === null,
    email: data.main_contact_email?.trim() || null,
    eventName: event?.name ?? null,
    eventDate: event?.date ?? null,
  };
}

/** `setStatus` that also records why the row was closed. Compare-and-set on the status it was read with. */
export async function setStatusWithError(
  id: string,
  from: BookingStatus,
  to: BookingStatus,
  atIso: string,
  lastError: string,
): Promise<boolean> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .update({ status: to, updated_at: atIso, last_error: lastError })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) throw new Error(`ticket_bookings status change failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** `updated_at` is left alone: it is the clock of the row's last status change. */
export async function markRefreshChecked(id: string, atIso: string): Promise<void> {
  const { error } = await supabaseTyped.from("ticket_bookings").update({ last_refresh_at: atIso }).eq("id", id);
  if (error) throw new Error(`ticket_bookings refresh stamp failed: ${error.message}`);
}

export async function claimLinkEmail(id: string, atIso: string): Promise<boolean> {
  const { data, error } = await supabaseTyped
    .from("ticket_bookings")
    .update({ link_email_sent_at: atIso })
    .eq("id", id)
    .is("link_email_sent_at", null)
    .select("id");
  if (error) throw new Error(`ticket_bookings link email claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function unclaimLinkEmail(id: string, atIso: string): Promise<void> {
  const { error } = await supabaseTyped
    .from("ticket_bookings")
    .update({ link_email_sent_at: null })
    .eq("id", id)
    .eq("link_email_sent_at", atIso);
  if (error) throw new Error(`ticket_bookings link email unclaim failed: ${error.message}`);
}

export function realSweepDeps(): SweepDeps {
  return {
    ...realApplyDeps(),
    listOpen: listOpenBookings,
    listRefreshDue: listRefreshDueBookings,
    loadReservation: loadSweepReservation,
    setStatusWithError,
    markRefreshChecked,
    claimLinkEmail,
    unclaimLinkEmail,
    clientFor(env) {
      const resolved = tixstockClientFor(env);
      return resolved.ok ? resolved.client : null;
    },
    sendMail,
  };
}

export function realWebhookDeps(): WebhookDeps {
  return {
    ...realApplyDeps(),
    findBookingByOrder,
    findBookingByOurId,
    countTicketFiles,
    findUncertain,
    attachOrder,
    // The log must never be the reason a webhook fails: both writes swallow their own errors.
    async logEvent(e) {
      try {
        const { data, error } = await supabaseTyped
          .from("tixstock_webhook_events")
          .insert({
            env: e.env,
            type: e.type,
            signature_valid: e.signatureValid,
            tixstock_order_id: e.orderId,
            payload: e.payload as Json,
          })
          .select("id")
          .single();
        if (error) {
          console.error("[tixstock-webhook] log insert failed:", JSON.stringify(error));
          return null;
        }
        return data.id;
      } catch (err) {
        console.error("[tixstock-webhook] log insert failed:", err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    async finishEvent(id, result) {
      if (id === null) return;
      try {
        const { error } = await supabaseTyped.from("tixstock_webhook_events").update({ result: result as Json }).eq("id", id);
        if (error) console.error("[tixstock-webhook] log update failed:", JSON.stringify(error));
      } catch (err) {
        console.error("[tixstock-webhook] log update failed:", err instanceof Error ? err.message : String(err));
      }
    },
  };
}
