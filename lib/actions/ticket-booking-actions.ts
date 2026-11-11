"use server";

// The TixStock ticket-booking card of a reservation: what it reads. (The book action and the delivery actions are
// added to this file by the tasks that follow.)
//
// The reservation page is a client component that EVERY staff role opens, and `requireAdmin()` throws for the
// others - so each action here starts with `fulfilmentSession()` and answers `{ ok: false, kind: "hidden" }`. It
// never throws to the page: for anyone who is not allowed, the page looks exactly as it did before this work.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1-7.3.
import { requireAdmin } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";
import { adminOrHidden, fulfilmentVisibleTo } from "@/lib/fulfilment/visibility";
import { tixstockClientFor } from "@/lib/services/tixstock-booking-env";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { toBookingView, toFileView, type TicketBookingView, type TicketFileView } from "@/lib/tixstock-booking/booking-view";
import { hotelShippingOf, reservationAttendees, reservationBuyer, soldTicketOf } from "@/lib/tixstock-booking/office-open";
import { rankListings, type RankableListing, type RankedListing } from "@/lib/tixstock-booking/rank";
import { bookingEnvFor, type AttendeeInput, type BookingEnv, type Buyer } from "@/lib/tixstock-booking/rules";

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

export type OpenTicketBookingResult =
  | {
      ok: true;
      env: BookingEnv;
      tixstockEventId: string;
      italian: boolean;
      quantity: number;
      listings: { sameCategory: RankedListing[]; others: RankedListing[] };
      buyer: Buyer;
      attendees: AttendeeInput[];
      hotelShipping: Record<string, string> | null;
      costSoldTotalUsd: number | null;
    }
  | {
      ok: false;
      kind:
        | "hidden"
        | "not_paid"
        | "not_tixstock"
        | "no_event"
        | "test_without_sandbox"
        | "production_closed"
        | "not_configured"
        | "supplier"
        | "db";
    };

/**
 * Everything the booking dialog shows before staff pick a listing: the environment (decided by the EVENT - a test
 * event books in the sandbox, a real one in production), the live listings ranked with their gap to the cost sold,
 * the buyer, the attendees and the hotel address. It reads; it holds and orders nothing.
 *
 * `tixstockEventId` is for an order that kept no TixStock event id (a hand-typed reservation): staff pick the
 * event in the dialog (`searchTixstockEvents`) and the dialog opens again with it.
 */
export async function openTicketBooking(reservationId: number, tixstockEventId?: string): Promise<OpenTicketBookingResult> {
  if (!(await fulfilmentSession())) return { ok: false, kind: "hidden" };
  try {
    // `ticket_cost_usd` is not in the generated types yet: read through the untyped client, as the P&L does.
    const { data: reservation, error } = await supabase
      .from("reservations")
      .select(
        "id, status, is_deleted, event_id, event_order_info, hotel_order_info, more_pax_info, main_contact_first_name, main_contact_last_name, main_contact_email, main_contact_phone_number, ticket_cost_usd",
      )
      .eq("id", reservationId)
      .maybeSingle();
    if (error) throw new Error(`reservations read failed: ${error.message}`);
    const r: Record<string, unknown> = reservation ?? {};
    if (!reservation || r.status !== "Paid" || r.is_deleted !== null) return { ok: false, kind: "not_paid" };

    const { data: event, error: eventError } = await supabaseTyped
      .from("events")
      .select("is_test, tixstock_booking, tx_excluded_sections")
      .eq("id", Number(r.event_id))
      .maybeSingle();
    if (eventError) throw new Error(`events read failed: ${eventError.message}`);
    const env = bookingEnvFor({ is_test: event?.is_test, tixstock_booking: event?.tixstock_booking });
    if (!env.ok) return { ok: false, kind: "test_without_sandbox" };

    const sold = soldTicketOf(r.event_order_info);
    const picked = (tixstockEventId ?? "").trim();
    // An order sold from another supplier is not offered TixStock's listings by itself: staff may still pick a
    // TixStock event by hand, and then it is their decision.
    if (picked === "" && sold.supplier !== "tixstock" && sold.supplier !== "static") return { ok: false, kind: "not_tixstock" };
    const eventId = picked !== "" ? picked : sold.supplier === "tixstock" ? sold.tixEventId : null;
    if (!eventId || sold.quantity < 1) return { ok: false, kind: "no_event" };

    const made = tixstockClientFor(env.env);
    if (!made.ok) return { ok: false, kind: made.kind };

    const [listings, country] = await Promise.all([made.client.listings(eventId), made.client.eventVenueCountry(eventId)]);
    if (!listings.ok) {
      console.error("[ticket-booking] listings not read:", listings.kind);
      return { ok: false, kind: "supplier" };
    }
    // The attendee details TixStock asks for follow the TixStock event's own venue, never our event's location.
    let italian = country.ok && country.data === "IT";
    if (!country.ok && env.env === "production") {
      const { data: known } = await supabaseTyped.from("tixstock_events").select("country_code").eq("event_id", eventId).maybeSingle();
      italian = (known?.country_code ?? "").trim().toUpperCase() === "IT";
    }

    const cost = typeof r.ticket_cost_usd === "number" ? r.ticket_cost_usd : typeof r.ticket_cost_usd === "string" ? Number(r.ticket_cost_usd) : NaN;
    const costSoldTotalUsd = Number.isFinite(cost) && cost > 0 ? cost : null;
    return {
      ok: true,
      env: env.env,
      tixstockEventId: eventId,
      italian,
      quantity: sold.quantity,
      // The client hands the feed's listings on as it received them; the ranking reads them field by field.
      listings: rankListings(listings.data as readonly RankableListing[], {
        soldCategory: picked !== "" && sold.supplier !== "tixstock" ? null : sold.category,
        quantity: sold.quantity,
        together: sold.together,
        excludedSections: event?.tx_excluded_sections ?? [],
        costSoldTotalUsd,
      }),
      buyer: reservationBuyer(r),
      attendees: reservationAttendees(r),
      hotelShipping: hotelShippingOf(r.hotel_order_info),
      costSoldTotalUsd,
    };
  } catch (e) {
    console.error("[ticket-booking] openTicketBooking:", messageOf(e));
    return { ok: false, kind: "db" };
  }
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
