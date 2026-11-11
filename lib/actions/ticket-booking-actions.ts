"use server";

// The TixStock ticket-booking card of a reservation: what it reads, the book action, and what staff do once the
// tickets arrive (check, send, fix an attendee, refresh, settle an uncertain order).
//
// The reservation page is a client component that EVERY staff role opens, and `requireAdmin()` throws for the
// others - so each action here starts with `fulfilmentSession()` and answers `{ ok: false, kind: "hidden" }`. It
// never throws to the page: for anyone who is not allowed, the page looks exactly as it did before this work.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1-7.3.
import { requireAdmin } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";
import { adminOrHidden, fulfilmentVisibleTo } from "@/lib/fulfilment/visibility";
import {
  markChecked,
  markWhatsapp,
  refreshBooking,
  sendToCustomer,
  settleUncertain,
  updateAttendees,
  type DeliveryResult,
} from "@/lib/services/tixstock-delivery";
import { loadOfficeOpen, realOfficeDeps, type OfficeOpen } from "@/lib/services/tixstock-office";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { toBookingView, toFileView, type TicketBookingView, type TicketFileView } from "@/lib/tixstock-booking/booking-view";
import { runOfficeBooking, type OfficeBookingInput, type OfficeBookingResult } from "@/lib/tixstock-booking/office-booking";
import type { AttendeeInput } from "@/lib/tixstock-booking/rules";

const FILES_BUCKET = "ticket-files";
const SIGNED_URL_SECONDS = 300;

/** The signed-in admin when the fulfilment tools are open to them; null for everyone else. Never throws. */
async function fulfilmentSession(): Promise<SessionPayload | null> {
  const held: { session: SessionPayload | null } = { session: null };
  const allowed = await adminOrHidden(async () => {
    held.session = await requireAdmin();
  });
  if (!allowed || !held.session) return null;
  return fulfilmentVisibleTo(held.session.role, process.env.NEXT_SECRET_FULFILMENT_OPEN) ? held.session : null;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : JSON.stringify(e));

export type GetTicketBookingResult =
  | { ok: true; booking: TicketBookingView | null; files: TicketFileView[] }
  | { ok: false; kind: "hidden" | "db" };

/** The reservation's newest booking and its files. Stored files come with a signed URL good for five minutes. */
export async function getTicketBooking(reservationId: number): Promise<GetTicketBookingResult> {
  if (!(await fulfilmentSession())) return { ok: false, kind: "hidden" };
  try {
    if (!Number.isInteger(reservationId) || reservationId < 1) return { ok: true, booking: null, files: [] };
    const { data: row, error } = await supabaseTyped
      .from("ticket_bookings")
      .select("*")
      .eq("reservation_id", reservationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ticket_bookings read failed: ${error.message}`);
    const booking = row ? toBookingView(row, new Date()) : null;
    if (!booking) return { ok: true, booking: null, files: [] };

    const { data: fileRows, error: filesError } = await supabaseTyped
      .from("ticket_booking_files")
      .select("id, kind, row, seat, storage_path, url, received_at")
      .eq("booking_id", booking.id)
      .order("received_at", { ascending: true });
    if (filesError) throw new Error(`ticket_booking_files read failed: ${filesError.message}`);

    const files = await Promise.all(
      (fileRows ?? []).map(async (file) => {
        let signed: string | null = null;
        if (file.storage_path) {
          const { data: link, error: signError } = await supabase.storage
            .from(FILES_BUCKET)
            .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS);
          if (signError) console.error("[ticket-booking] signed url failed:", signError.message);
          signed = link?.signedUrl ?? null;
        }
        return toFileView(file, signed);
      }),
    );
    return { ok: true, booking, files };
  } catch (e) {
    console.error("[ticket-booking] getTicketBooking:", messageOf(e));
    return { ok: false, kind: "db" };
  }
}

export type OpenTicketBookingResult = OfficeOpen | { ok: false; kind: "hidden" };

/**
 * Everything the booking dialog shows before staff pick a listing (`loadOfficeOpen`): the environment, the live
 * listings ranked with their gap to the cost sold, the buyer, the attendees, the hotel address. It reads only.
 */
export async function openTicketBooking(reservationId: number, tixstockEventId?: string): Promise<OpenTicketBookingResult> {
  if (!(await fulfilmentSession())) return { ok: false, kind: "hidden" };
  return loadOfficeOpen(reservationId, tixstockEventId);
}

/**
 * "הזמן כרטיס": hold the listing staff picked and order it at TixStock as Approved - a FINAL purchase. The rules
 * and their order are `runOfficeBooking`'s; errors come back as a result, never as a throw.
 */
export async function bookReservationTicket(input: OfficeBookingInput): Promise<OfficeBookingResult> {
  const session = await fulfilmentSession();
  if (!session) return { ok: false, kind: "hidden" };
  return runOfficeBooking(input, session.email, realOfficeDeps());
}

export type TixstockEventHit = { event_id: string; event_name: string; show_date: string; venue_name: string };

/** The dialog's event picker: upcoming TixStock events by name, from the table the sync keeps. Empty when hidden. */
export async function searchTixstockEvents(query: string): Promise<TixstockEventHit[]> {
  if (!(await fulfilmentSession())) return [];
  try {
    const term = query.trim().replace(/[%_,()]/g, " ").trim();
    if (term.length < 2) return [];
    const { data, error } = await supabaseTyped
      .from("tixstock_events")
      .select("event_id, event_name, show_date, venue_name")
      .ilike("event_name", `%${term}%`)
      .gte("show_date", new Date().toISOString().slice(0, 10))
      .order("show_date", { ascending: true })
      .limit(20);
    if (error) throw new Error(`tixstock_events read failed: ${error.message}`);
    return (data ?? []).map((e) => ({ event_id: e.event_id, event_name: e.event_name, show_date: e.show_date, venue_name: e.venue_name ?? "" }));
  } catch (e) {
    console.error("[ticket-booking] searchTixstockEvents:", messageOf(e));
    return [];
  }
}

const HIDDEN: DeliveryResult = { ok: false, kind: "hidden" };

/** "בדקתי את הכרטיסים". */
export async function markTicketsChecked(bookingId: string): Promise<DeliveryResult> {
  const session = await fulfilmentSession();
  return session ? markChecked(bookingId, session.email) : HIDDEN;
}

/** "שלח ללקוח": the e-mail with the ticket page link (and the PDFs when they fit). Refused until the tickets were checked. */
export async function sendTicketsToCustomer(bookingId: string): Promise<DeliveryResult> {
  const session = await fulfilmentSession();
  return session ? sendToCustomer(bookingId, session.email) : HIDDEN;
}

/** "נשלח בוואטסאפ": staff sent the text themselves; the row records it. */
export async function markWhatsappSent(bookingId: string): Promise<DeliveryResult> {
  const session = await fulfilmentSession();
  return session ? markWhatsapp(bookingId, session.email) : HIDDEN;
}

export async function updateTicketAttendees(bookingId: string, attendees: AttendeeInput[]): Promise<DeliveryResult> {
  const session = await fulfilmentSession();
  return session ? updateAttendees(bookingId, attendees, session.email) : HIDDEN;
}

export async function refreshTicketBooking(bookingId: string): Promise<DeliveryResult> {
  const session = await fulfilmentSession();
  return session ? refreshBooking(bookingId) : HIDDEN;
}

/** "בדקתי - נוצרה הזמנה <id>" / "בדקתי - לא נוצרה". */
export async function resolveUncertain(
  bookingId: string,
  resolution: { created: true; orderId: string } | { created: false },
  note: string,
): Promise<DeliveryResult> {
  const session = await fulfilmentSession();
  return session ? settleUncertain(bookingId, resolution, note, session.email) : HIDDEN;
}
