"use server";

/**
 * Online bookings of a tours company (tours.bookings). The customer site writes
 * them through c_<slug>.site_booking(); each one hangs on its customer's case
 * (public.leads, lead_id) and is shown on the case page. This file is the
 * backoffice side of one booking: set the status, the receipt number and the
 * "confirmation sent" mark, and confirm a payment that CreditGuard reported with
 * an unexpected amount. The case follows the booking's payment state by itself
 * (trigger bookings_status_to_case).
 */
import { revalidatePath } from "next/cache";

import { requireCompany } from "@/lib/company";
import { assertCardVisible } from "@/lib/services/tours-board-viewer";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { actionFail } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import { bookingRowOf, departuresOf } from "@/lib/tours/booking-rows";
import { holdOwedSeats, releaseBookingSeats } from "@/lib/tours/case-seats";
import type { TourBooking } from "@/types/tours.types";
import {
  STAFF_STATUSES,
  type ActionResult,
  type BookingChange,
  type BookingRow,
  type BookingStatus,
} from "@/components/tours/bookings/shared";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-bookings-actions", fallback);

/**
 * Change what staff own on a booking: its status (new / in progress / done /
 * cancelled), the receipt number, the "confirmation sent" mark and a note.
 * "Paid" can be set by hand only on a "Check payment" booking, after checking
 * the charge in CreditGuard: that adds the passengers to the departure's sold
 * seats, the same as an automatic payment does.
 */
export async function updateBooking(id: string, change: BookingChange): Promise<ActionResult<BookingRow>> {
  try {
    const { company, session } = await requireCompany("tours");
    const { data: before, error } = await toursDb()
      .from("bookings")
      .select("*")
      .eq("company_id", company.id)
      .eq("id", id)
      .is("is_deleted", null)
      .maybeSingle();
    if (error) throw error;
    if (!before) return { success: false, error: "The booking was not found." };
    // a rep moves only the bookings of cards they can see (21.10)
    await assertCardVisible(session, company, before.lead_id);

    const patch: Partial<TourBooking> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    let confirmPayment = false;

    if (change.status !== undefined && change.status !== before.status) {
      const confirming = change.status === "paid" && before.status === "review";
      if (!confirming && !STAFF_STATUSES.includes(change.status as BookingStatus)) {
        return { success: false, error: "This status is set by the payment itself." };
      }
      if (before.status === "paid" && change.status !== "done" && change.status !== "cancelled") {
        return { success: false, error: "A paid booking can only become Done or Cancelled." };
      }
      patch.status = change.status;
      changes.status = { from: before.status, to: change.status };
      confirmPayment = confirming;
    }
    if (change.receiptNo !== undefined) {
      const value = change.receiptNo?.trim() || null;
      if (value !== before.receipt_no) {
        patch.receipt_no = value;
        changes.receipt_no = { from: before.receipt_no, to: value };
      }
    }
    if (change.staffNote !== undefined) {
      const value = change.staffNote?.trim() || null;
      if (value !== before.staff_note) {
        patch.staff_note = value;
        changes.staff_note = { from: before.staff_note, to: value };
      }
    }
    if (change.giftPassengers !== undefined) {
      // the passengers the departure's gift went to (Alon 20.10) - indexes into this booking's own passengers
      const count = Array.isArray(before.passengers) ? before.passengers.length : 0;
      const picked = [...new Set(change.giftPassengers)].sort((a, b) => a - b);
      if (picked.some((i) => !Number.isInteger(i) || i < 0 || i >= count)) {
        return { success: false, error: "Pick passengers of this booking." };
      }
      const was = (before.gift_passengers ?? []).slice().sort((a, b) => a - b);
      if (picked.join(",") !== was.join(",")) {
        patch.gift_passengers = picked;
        changes.gift_passengers = { from: was, to: picked };
      }
    }
    if (change.confirmationSent !== undefined && change.confirmationSent !== !!before.confirmation_sent_at) {
      patch.confirmation_sent_at = change.confirmationSent ? new Date().toISOString() : null;
      changes.confirmation_sent_at = { from: before.confirmation_sent_at, to: patch.confirmation_sent_at };
    }

    if (confirmPayment && !before.sales_entry_id) {
      const { data: entry, error: entryError } = await toursDb()
        .from("departure_sales_entries")
        .insert({
          company_id: company.id,
          departure_id: before.departure_id,
          pax: before.adults + before.children,
          note: `Online booking ${before.ref}, paid by card (confirmed by hand)`,
          customer_name: before.customer_name,
          customer_phone: before.customer_phone,
          customer_email: before.customer_email,
          lead_id: before.lead_id,
          entered_by: session.sub,
        })
        .select("id")
        .single();
      if (entryError) throw entryError;
      patch.sales_entry_id = entry.id;
      patch.paid_at = new Date().toISOString();
    }

    if (Object.keys(patch).length) {
      // the case's status follows a payment state by itself (trigger bookings_status_to_case)
      const { error: updateError } = await toursDb().from("bookings").update(patch).eq("company_id", company.id).eq("id", id);
      if (updateError) throw updateError;
      await logAudit({
        action: "update",
        entityType: "tours_booking",
        entityId: id,
        changes,
        metadata: { ...companyAudit(company), ref: before.ref, lead_id: before.lead_id },
      });
      revalidatePath("/tours/reservations");
    }

    // a request closed by phone (Done) holds its travelers' seats by itself, as a card payment does
    // (Dor 15.10) - seatGap decides how many are still missing, so nothing is ever held twice
    const held = patch.status === "done" && before.lead_id ? await holdOwedSeats(company, before.lead_id, session.sub) : null;
    // a cancelled booking gives its own seats back (Alon 18.10); seats added by hand for the case stay
    const released = patch.status === "cancelled" ? await releaseBookingSeats(company, before) : null;

    const { data: fresh, error: freshError } = await toursDb().from("bookings").select("*").eq("company_id", company.id).eq("id", id).single();
    if (freshError) throw freshError;
    const deps = await departuresOf(company.id, [fresh.departure_id]);
    const data = bookingRowOf(fresh, deps.get(fresh.departure_id));
    if (held) {
      return { success: true, data, warning: `${held.pax === 1 ? "1 seat" : `${held.pax} seats`} now held on the departure${held.departureCode ? ` (${held.departureCode})` : ""}.` };
    }
    // only a booking that was closed held seats - a cancelled request that never closed has nothing to say
    if (patch.status === "cancelled" && (released?.released || before.status === "done" || before.status === "paid")) {
      const freed = released?.released ?? 0;
      return {
        success: true,
        data,
        warning: freed
          ? `${freed === 1 ? "1 seat" : `${freed} seats`} of booking ${before.ref} given back to the departure.`
          : "This booking held no seats of its own. Seats added by hand for the customer stay - remove them under Seats if they should go.",
      };
    }
    return { success: true, data };
  } catch (e) {
    return failure(e, "Failed to update the booking");
  }
}
