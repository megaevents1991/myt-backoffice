/**
 * The database and storage boundary of TixStock ticket bookings: the real dependencies of the webhook
 * (tixstock-webhook.ts `WebhookDeps`) and of applying an order update (tixstock-order-apply.ts `ApplyDeps`). The
 * logic itself lives in those two files and runs over stubs in scripts/tixstock-webhook-selftest.ts. Server only.
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

export function realWebhookDeps(): WebhookDeps {
  return {
    ...realApplyDeps(),
    findBookingByOrder,
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
