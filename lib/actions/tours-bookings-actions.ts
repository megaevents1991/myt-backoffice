"use server";

/**
 * Online bookings of a tours company (tours.bookings). The customer site writes
 * them through c_<slug>.site_booking(); this file is the backoffice side: read,
 * set the status, the receipt number and the "confirmation sent" mark, and
 * confirm a payment that CreditGuard reported with an unexpected amount.
 */
import { revalidatePath } from "next/cache";

import { requireCompany } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { actionFail } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import type { TourBooking } from "@/types/tours.types";
import {
  STAFF_STATUSES,
  type ActionResult,
  type BookingChange,
  type BookingLine,
  type BookingPassenger,
  type BookingRow,
  type BookingStatus,
} from "@/components/tours/bookings/shared";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-bookings-actions", fallback);

const LIST_LIMIT = 2000;

type DepartureBits = { id: string; code: string; start_date: string; legacy_product_id: number | null; site_id: number | null };

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const num = (value: unknown): number | null => (value == null ? null : Number(value));

function toRow(b: TourBooking, dep: DepartureBits | undefined): BookingRow {
  return {
    id: b.id,
    ref: b.ref,
    createdAt: b.created_at,
    kind: b.kind as BookingRow["kind"],
    status: b.status,
    priceBasis: b.price_basis as BookingRow["priceBasis"],
    departureId: b.departure_id,
    departureCode: dep?.code ?? null,
    departureStart: dep?.start_date ?? null,
    siteId: dep ? (dep.legacy_product_id ?? dep.site_id) : null,
    leadId: b.lead_id,
    customerName: b.customer_name,
    customerPhone: b.customer_phone,
    customerEmail: b.customer_email,
    note: b.note,
    sourcePath: b.source_path,
    currency: b.currency,
    adults: b.adults,
    children: b.children,
    seniors: b.seniors,
    subtotal: Number(b.subtotal),
    discount: Number(b.discount),
    total: Number(b.total),
    lines: asArray<BookingLine>(b.rooms),
    passengers: asArray<BookingPassenger>(b.passengers),
    breakdown: asRecord(b.breakdown),
    rate: num(b.rate),
    rateSource: b.rate_source,
    totalIls: num(b.total_ils),
    payments: b.payments,
    cgTxId: b.cg_tx_id,
    cgAuthNumber: b.cg_auth_number,
    cardLast4: b.cg_card_last4,
    paidAt: b.paid_at,
    salesEntryId: b.sales_entry_id,
    receiptNo: b.receipt_no,
    confirmationSentAt: b.confirmation_sent_at,
    staffNote: b.staff_note,
  };
}

async function departuresOf(companyId: string, ids: string[]): Promise<Map<string, DepartureBits>> {
  const map = new Map<string, DepartureBits>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await toursDb()
      .from("departures")
      .select("id, code, start_date, legacy_product_id, site_id")
      .eq("company_id", companyId)
      .in("id", unique.slice(i, i + 200));
    if (error) throw error;
    for (const d of data ?? []) map.set(d.id, d as DepartureBits);
  }
  return map;
}

/** The company's online bookings, newest first. */
export async function listBookings(): Promise<ActionResult<{ rows: BookingRow[]; truncated: boolean }>> {
  try {
    const { company } = await requireCompany("tours");
    const { data, error } = await toursDb()
      .from("bookings")
      .select("*")
      .eq("company_id", company.id)
      .is("is_deleted", null)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT + 1);
    if (error) throw error;
    const rows = (data ?? []).slice(0, LIST_LIMIT);
    const deps = await departuresOf(company.id, rows.map((r) => r.departure_id));
    return { success: true, data: { rows: rows.map((r) => toRow(r, deps.get(r.departure_id))), truncated: (data ?? []).length > LIST_LIMIT } };
  } catch (e) {
    return failure(e, "Failed to load the online bookings");
  }
}

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
      const { error: updateError } = await toursDb().from("bookings").update(patch).eq("company_id", company.id).eq("id", id);
      if (updateError) throw updateError;
      if (confirmPayment && before.lead_id) {
        await supabaseTyped.from("leads").update({ status: "done" }).eq("company_id", company.id).eq("id", before.lead_id).neq("status", "spam");
      }
      await logAudit({ action: "update", entityType: "tours_booking", entityId: id, changes, metadata: { ...companyAudit(company), ref: before.ref } });
      revalidatePath("/tours/bookings");
    }

    const { data: fresh, error: freshError } = await toursDb().from("bookings").select("*").eq("company_id", company.id).eq("id", id).single();
    if (freshError) throw freshError;
    const deps = await departuresOf(company.id, [fresh.departure_id]);
    return { success: true, data: toRow(fresh, deps.get(fresh.departure_id)) };
  } catch (e) {
    return failure(e, "Failed to update the booking");
  }
}
