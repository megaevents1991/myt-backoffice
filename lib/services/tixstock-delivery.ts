// What staff do with a booking after TixStock sent its tickets: check them, send them to the customer (e-mail, or a
// WhatsApp text they paste themselves), fix an attendee, refresh the order from TixStock, settle an uncertain one.
// Server only; every caller has already passed the fulfilment gate (lib/actions/ticket-booking-actions.ts). Each
// function answers `{ ok: true }` or `{ ok: false, kind }` and never throws.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.4-7.6.
import { logAudit } from "@/lib/audit";
import { sendMail } from "@/lib/email";
import { tixstockClientFor } from "@/lib/services/tixstock-booking-env";
import { attachOrder, loadSweepReservation, realApplyDeps } from "@/lib/services/tixstock-booking-store";
import { TICKET_LINK_FROM } from "@/lib/services/tixstock-booking-sweep";
import { applyOrderUpdate, readOrderPayload } from "@/lib/services/tixstock-order-apply";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { toBookingView, type TicketBookingView } from "@/lib/tixstock-booking/booking-view";
import { attachmentsWithin, customerTicketEmail, seatsLine, sentPatch } from "@/lib/tixstock-booking/customer-email";
import { attendeeIssues, buildOrderRequest, canMoveTo, ourOrderId, safeHttpUrl, type AttendeeInput } from "@/lib/tixstock-booking/rules";
import type { TablesUpdate } from "@/types/database.types";

const FILES_BUCKET = "ticket-files";

export type DeliveryResult = { ok: true } | { ok: false; kind: string };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : JSON.stringify(e));
const fail = (where: string, e: unknown): DeliveryResult => {
  console.error(`[tixstock-delivery] ${where}:`, messageOf(e));
  return { ok: false, kind: "db" };
};

type Loaded = { view: TicketBookingView; row: Record<string, unknown> };

const loadRow = async (bookingId: string): Promise<Loaded | null> => {
  const { data, error } = await supabaseTyped.from("ticket_bookings").select("*").eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`ticket_bookings read failed: ${error.message}`);
  const view = data ? toBookingView(data, new Date()) : null;
  return data && view ? { view, row: data } : null;
};

type StoredFile = { id: string; kind: string; row: string | null; seat: string | null; storage_path: string | null; content_type: string | null; url: string | null };

const loadFiles = async (bookingId: string): Promise<StoredFile[]> => {
  const { data, error } = await supabaseTyped
    .from("ticket_booking_files")
    .select("id, kind, row, seat, storage_path, content_type, url")
    .eq("booking_id", bookingId)
    .order("received_at", { ascending: true });
  if (error) throw new Error(`ticket_booking_files read failed: ${error.message}`);
  return data ?? [];
};

const patchRow = async (bookingId: string, patch: Record<string, unknown>): Promise<void> => {
  // Column names are stated by the callers below; typed once, here, at the table's edge.
  const { error } = await supabaseTyped.from("ticket_bookings").update(patch as TablesUpdate<"ticket_bookings">).eq("id", bookingId);
  if (error) throw new Error(`ticket_bookings update failed: ${error.message}`);
};

const audit = (action: string, view: TicketBookingView, metadata: Record<string, unknown> = {}): Promise<void> =>
  logAudit({ action, entityType: "reservation", entityId: view.reservationId, metadata: { booking: view.id, env: view.env, ...metadata } });

/** "בדקתי את הכרטיסים": staff looked at what the seller sent. Only then may the tickets be sent. */
export async function markChecked(bookingId: string, actor: string): Promise<DeliveryResult> {
  try {
    const loaded = await loadRow(bookingId);
    if (!loaded) return { ok: false, kind: "not_found" };
    if ((await loadFiles(bookingId)).length === 0) return { ok: false, kind: "no_files" };
    if (loaded.view.checkedAt) return { ok: true };
    const at = new Date().toISOString();
    const { error } = await supabaseTyped.from("ticket_bookings").update({ checked_at: at, checked_by: actor }).eq("id", bookingId).is("checked_at", null);
    if (error) throw new Error(`ticket_bookings check failed: ${error.message}`);
    await audit("tixstock_tickets_checked", loaded.view);
    return { ok: true };
  } catch (e) {
    return fail("markChecked", e);
  }
}

const sendable = (loaded: Loaded | null): DeliveryResult | null => {
  if (!loaded) return { ok: false, kind: "not_found" };
  if (!loaded.view.checkedAt) return { ok: false, kind: "not_checked" };
  if (loaded.view.status === "cancelled" || loaded.view.status === "failed") return { ok: false, kind: "not_sendable" };
  return null;
};

const sentState = (row: Record<string, unknown>) => ({
  sent_to_customer_at: typeof row.sent_to_customer_at === "string" ? row.sent_to_customer_at : null,
  sent_channels: Array.isArray(row.sent_channels) ? row.sent_channels.filter((c): c is string => typeof c === "string") : [],
  released_to_customer_at: typeof row.released_to_customer_at === "string" ? row.released_to_customer_at : null,
});

/**
 * "שלח ללקוח": the e-mail with the ticket-page link, and the PDFs themselves while they fit together. It goes out
 * from the address customers know from the site's order confirmation. Sending is what releases the tickets to the
 * customer's page.
 */
export async function sendToCustomer(bookingId: string, actor: string): Promise<DeliveryResult> {
  try {
    const loaded = await loadRow(bookingId);
    const refusal = sendable(loaded);
    if (refusal || !loaded) return refusal ?? { ok: false, kind: "not_found" };
    const { view, row } = loaded;

    const reservation = await loadSweepReservation(view.reservationId);
    const to = reservation?.email ?? view.buyer.email;
    if (!to) return { ok: false, kind: "no_email" };

    const files = await loadFiles(bookingId);
    const stored: Array<{ filename: string; content: Buffer; contentType: string; bytes: number }> = [];
    for (const [index, file] of files.filter((f) => f.kind === "pdf" && f.storage_path).entries()) {
      const { data: blob, error } = await supabase.storage.from(FILES_BUCKET).download(file.storage_path ?? "");
      if (error || !blob) throw new Error(`ticket file download failed: ${error?.message ?? "empty"}`);
      const content = Buffer.from(await blob.arrayBuffer());
      stored.push({ filename: `ticket-${index + 1}.pdf`, content, contentType: "application/pdf", bytes: content.byteLength });
    }

    const eventDate = reservation?.eventDate ? new Date(reservation.eventDate) : null;
    const mail = customerTicketEmail({
      eventName: reservation?.eventName ?? "",
      eventDate: eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate.toLocaleDateString("he-IL", { timeZone: "UTC" }) : "",
      seats: seatsLine(view.listing),
      ticketType: view.listing.ticketType,
      restrictions: view.listing.restrictions,
      deliveryNote: null,
      pageUrl: view.customerPageUrl,
      externalTransfer: /external/i.test(view.listing.ticketType),
      mobileLinks: files.flatMap((f) => (f.kind === "mobile_link" && safeHttpUrl(f.url) ? [f.url ?? ""] : [])),
    });
    await sendMail({
      to,
      from: TICKET_LINK_FROM,
      ...mail,
      attachments: attachmentsWithin(stored).map(({ filename, content, contentType }) => ({ filename, content, contentType })),
    });

    await patchRow(bookingId, sentPatch(sentState(row), "email", actor, new Date().toISOString()));
    await audit("tixstock_tickets_sent", view, { channel: "email", attached: attachmentsWithin(stored).length });
    return { ok: true };
  } catch (e) {
    return fail("sendToCustomer", e);
  }
}

/** "נשלח בוואטסאפ": staff pasted the text themselves - nothing is sent from here; the row records it. */
export async function markWhatsapp(bookingId: string, actor: string): Promise<DeliveryResult> {
  try {
    const loaded = await loadRow(bookingId);
    const refusal = sendable(loaded);
    if (refusal || !loaded) return refusal ?? { ok: false, kind: "not_found" };
    await patchRow(bookingId, sentPatch(sentState(loaded.row), "whatsapp", actor, new Date().toISOString()));
    await audit("tixstock_tickets_sent", loaded.view, { channel: "whatsapp" });
    return { ok: true };
  } catch (e) {
    return fail("markWhatsapp", e);
  }
}

/** A traveller changed: the order's attendees are sent to TixStock again, and only then kept on the row. */
export async function updateAttendees(bookingId: string, attendees: AttendeeInput[], actor: string): Promise<DeliveryResult> {
  try {
    const loaded = await loadRow(bookingId);
    if (!loaded) return { ok: false, kind: "not_found" };
    const { view } = loaded;
    if (!view.tixstockOrderId || !["sale_on_hold", "approved", "commissionable"].includes(view.status)) return { ok: false, kind: "no_order" };
    if (attendees.length !== view.quantity || attendees.some((a) => attendeeIssues(a, view.listing.italian).length > 0)) {
      return { ok: false, kind: "attendees" };
    }
    const request = buildOrderRequest({
      status: "Approved",
      at: new Date(),
      reservationId: view.reservationId,
      bookingId: view.id,
      buyer: view.buyer,
      attendees,
      quantity: view.quantity,
      italian: view.listing.italian,
      listing: { generalAdmission: view.listing.generalAdmission, row: view.listing.row ?? "", pricePerTicket: view.pricePerTicket ?? 0 },
    });
    if (!request.ok) return { ok: false, kind: "attendees" };

    const made = tixstockClientFor(view.env);
    if (!made.ok) return { ok: false, kind: made.kind };
    const answer = await made.client.updateOrder(ourOrderId(view.reservationId, view.id), { items: request.body.items });
    if (!answer.ok) {
      console.error("[tixstock-delivery] attendees not updated:", answer.kind);
      return { ok: false, kind: answer.kind === "no_answer" ? "supplier" : "refused" };
    }
    await patchRow(bookingId, { attendees });
    await audit("tixstock_attendees_updated", view, { by: actor });
    return { ok: true };
  } catch (e) {
    return fail("updateAttendees", e);
  }
}

/** "רענן": read the order at TixStock (by OUR order id) and apply its status and files, as a webhook would. */
export async function refreshBooking(bookingId: string): Promise<DeliveryResult> {
  try {
    const loaded = await loadRow(bookingId);
    if (!loaded) return { ok: false, kind: "not_found" };
    const { view } = loaded;
    if (!view.tixstockOrderId) return { ok: false, kind: "no_order" };
    const made = tixstockClientFor(view.env);
    if (!made.ok) return { ok: false, kind: made.kind };
    const order = await made.client.getOrder(ourOrderId(view.reservationId, view.id));
    if (!order.ok) {
      console.error("[tixstock-delivery] order not read:", order.kind);
      return { ok: false, kind: order.kind === "no_answer" ? "supplier" : "refused" };
    }
    await applyOrderUpdate(view.id, readOrderPayload(order.data, view.id), realApplyDeps());
    return { ok: true };
  } catch (e) {
    return fail("refreshBooking", e);
  }
}

/**
 * An `uncertain` booking, settled by a person who looked in TixStock's Request Logs: either the order exists (its
 * id is kept and the row is approved) or it does not (the row is failed, and the reservation can be booked again).
 */
export async function settleUncertain(
  bookingId: string,
  resolution: { created: true; orderId: string } | { created: false },
  note: string,
  actor: string,
): Promise<DeliveryResult> {
  try {
    const loaded = await loadRow(bookingId);
    if (!loaded) return { ok: false, kind: "not_found" };
    const { view } = loaded;
    if (view.status !== "uncertain") return { ok: false, kind: "not_uncertain" };
    const orderId = resolution.created ? resolution.orderId.trim() : "";
    if (resolution.created && orderId === "") return { ok: false, kind: "order_id" };

    const to = resolution.created ? "approved" : "failed";
    if (!canMoveTo("uncertain", to)) return { ok: false, kind: "not_uncertain" };
    const at = new Date().toISOString();
    if (resolution.created) await attachOrder(view.id, orderId);
    const { data, error } = await supabaseTyped
      .from("ticket_bookings")
      .update({
        status: to,
        updated_at: at,
        ...(to === "approved" ? { approved_at: at } : {}),
        uncertain_resolution: { created: resolution.created, order_id: orderId || null, note: note.trim().slice(0, 500), by: actor, at },
      })
      .eq("id", view.id)
      .eq("status", "uncertain")
      .select("id");
    if (error) throw new Error(`ticket_bookings resolve failed: ${error.message}`);
    if ((data ?? []).length === 0) return { ok: false, kind: "not_uncertain" };
    await audit("tixstock_uncertain_resolved", view, { created: resolution.created, order: orderId || null });
    return { ok: true };
  } catch (e) {
    return fail("settleUncertain", e);
  }
}
