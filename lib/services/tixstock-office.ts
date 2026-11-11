// The server side of the reservation's "Book ticket" card: what the dialog reads before staff pick a listing, and
// the real dependencies of the book action (lib/tixstock-booking/office-booking.ts). Server only; every caller has
// already passed the fulfilment gate (lib/actions/ticket-booking-actions.ts).
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1-7.4.
import { randomBytes, randomUUID } from "node:crypto";
import { logAudit } from "@/lib/audit";
import { tixstockClientFor } from "@/lib/services/tixstock-booking-env";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import type { OfficeContext, OfficeDeps } from "@/lib/tixstock-booking/office-booking";
import { hotelShippingOf, reservationAttendees, reservationBuyer, soldTicketOf } from "@/lib/tixstock-booking/office-open";
import { rankListings, type RankableListing, type RankedListing } from "@/lib/tixstock-booking/rank";
import { bookingEnvFor, type AttendeeInput, type BookingEnv, type Buyer } from "@/lib/tixstock-booking/rules";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

export type OfficeOpen =
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
      kind: "not_paid" | "not_tixstock" | "no_event" | "test_without_sandbox" | "production_closed" | "not_configured" | "supplier" | "db";
    };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : JSON.stringify(e));

/**
 * Everything the booking dialog shows before staff pick a listing: the environment (decided by the EVENT - a test
 * event books in the sandbox, a real one in production), the live listings ranked with their gap to the cost sold,
 * the buyer, the attendees and the hotel address. It reads; it holds and orders nothing.
 *
 * `tixstockEventId` is for an order that kept no TixStock event id (a hand-typed reservation): staff pick the
 * event in the dialog and it is read again with it.
 */
export async function loadOfficeOpen(reservationId: number, tixstockEventId?: string): Promise<OfficeOpen> {
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
    console.error("[ticket-booking] loadOfficeOpen:", messageOf(e));
    return { ok: false, kind: "db" };
  }
}

const NO_CLIENT = { ok: false, kind: "no_answer", detail: "no TixStock client for this environment" } as const;

/** The real dependencies of `runOfficeBooking`. */
export function realOfficeDeps(): OfficeDeps {
  return {
    now: () => new Date(),
    newId: () => randomUUID(),
    newToken: () => randomBytes(32).toString("base64url"),

    // The listing is read again at the click, with the dialog's own rules: what staff saw may be gone or dearer.
    async loadContext(reservationId, tixstockEventId, listingId): Promise<OfficeContext> {
      const open = await loadOfficeOpen(reservationId, tixstockEventId);
      if (!open.ok) {
        if (open.kind === "production_closed") return { ok: false, kind: "production_closed" };
        if (open.kind === "not_configured" || open.kind === "test_without_sandbox") return { ok: false, kind: "not_configured" };
        if (open.kind === "db" || open.kind === "supplier") return { ok: false, kind: "db" };
        return { ok: false, kind: "gone" };
      }
      const listing = [...open.listings.sameCategory, ...open.listings.others].find((l) => l.listingId === listingId) ?? null;
      return { ok: true, env: open.env, quantity: open.quantity, listing, costSoldTotalUsd: open.costSoldTotalUsd };
    },

    async insertBooking(row) {
      // The rules build the row by column name (their selftest states each one); it is typed once, here, at the
      // table's edge.
      const { error } = await supabaseTyped.from("ticket_bookings").insert(row as TablesInsert<"ticket_bookings">);
      if (!error) return { ok: true };
      // 23505 = the unique index `ticket_bookings_one_live`: the reservation already has a live booking.
      if (error.code === "23505") return { ok: false, kind: "locked" };
      console.error("[tixstock-office-booking] insert failed:", error.message);
      return { ok: false, kind: "db" };
    },

    async moveStatus(id, from, to, atIso, patch) {
      const change: TablesUpdate<"ticket_bookings"> = {
        ...(patch as TablesUpdate<"ticket_bookings"> | undefined),
        status: to,
        updated_at: atIso,
        ...(to === "approved" ? { approved_at: atIso } : {}),
      };
      const { data, error } = await supabaseTyped
        .from("ticket_bookings")
        .update(change)
        .eq("id", id)
        .eq("status", from)
        .select("id");
      if (error) throw new Error(`ticket_bookings status change failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async hold(env, listingId, qty) {
      const made = tixstockClientFor(env);
      return made.ok ? made.client.hold(listingId, qty) : NO_CLIENT;
    },

    async release(env, holdId, qty) {
      const made = tixstockClientFor(env);
      return made.ok ? made.client.release(holdId, qty) : NO_CLIENT;
    },

    async addOrder(env, holdId, qty, body) {
      const made = tixstockClientFor(env);
      return made.ok ? made.client.addOrder(holdId, qty, body) : NO_CLIENT;
    },

    async audit(action, reservationId, metadata) {
      await logAudit({ action, entityType: "reservation", entityId: reservationId, metadata });
    },
  };
}
