/**
 * Reads and writes a tours case needs from more than one action file: the company's status list
 * and the seats a closed deal still owes its departure. A plain module (a "use server" file may
 * export async functions only, and these must never be callable from the browser). Server only.
 */
import { logAudit } from "@/lib/audit";
import type { Company } from "@/lib/company";
import { supabaseTyped } from "@/lib/supabase-server";
import { toursDb } from "@/lib/tours/db";
import { companyAudit } from "@/lib/tours/company-kit";
import { DEFAULT_STATUSES, isStatusColor, seatBookingOf, seatGap, type CaseStatus } from "@/lib/tours/cases";

/** The company's status list, in its order; the default list when it has none of its own. */
export async function readCaseStatuses(company: Company): Promise<CaseStatus[]> {
  const { data, error } = await supabaseTyped
    .from("lead_statuses")
    .select("key, label, color, position, is_closed, is_system, is_active")
    .eq("company_id", company.id)
    .order("position", { ascending: true });
  if (error) throw new Error(`lead_statuses: ${error.message}`);
  if (!data || data.length === 0) return DEFAULT_STATUSES;
  return data.map((s) => ({
    key: s.key,
    label: s.label,
    color: isStatusColor(s.color) ? s.color : "gray",
    isClosed: s.is_closed,
    isSystem: s.is_system,
    isActive: s.is_active,
  }));
}

export interface HeldSeats {
  ref: string;
  pax: number;
  departureCode: string | null;
}

/**
 * A closed deal holds its seats by itself (Dor 15.10, Alon's "why is it not on the departure if it
 * is PAID"): only a card payment used to put travelers on the departure, so a request closed by
 * phone - its booking set Done, or the case set Paid / Done - left the departure selling those
 * places (prod case #1004). Whatever seatGap says the case still owes is added as one seat row,
 * tied to the booking it came from. Nothing owed = nothing written; never throws past a log line,
 * because the status change that called it has already been saved.
 */
export async function holdOwedSeats(company: Company, leadId: string, enteredBy: string | null): Promise<HeldSeats | null> {
  try {
    const [lead, bookings, seats, statuses] = await Promise.all([
      supabaseTyped.from("leads").select("id, status, case_no").eq("company_id", company.id).eq("id", leadId).is("is_deleted", null).maybeSingle(),
      toursDb()
        .from("bookings")
        .select("id, ref, status, departure_id, adults, children, customer_name, customer_phone, customer_email, sales_entry_id")
        .eq("company_id", company.id)
        .eq("lead_id", leadId)
        .is("is_deleted", null)
        .order("created_at", { ascending: false }),
      toursDb()
        .from("departure_sales_entries")
        .select("departure_id, pax")
        .eq("company_id", company.id)
        .eq("lead_id", leadId)
        .is("is_deleted", null),
      readCaseStatuses(company),
    ]);
    if (lead.error) throw new Error(`leads: ${lead.error.message}`);
    if (bookings.error) throw new Error(`bookings: ${bookings.error.message}`);
    if (seats.error) throw new Error(`departure_sales_entries: ${seats.error.message}`);
    if (!lead.data) return null;

    const rows = bookings.data ?? [];
    const gap = seatGap(
      lead.data.status,
      statuses,
      rows.map((b) => seatBookingOf({ ref: b.ref, status: b.status, departureId: b.departure_id, adults: b.adults, children: b.children })),
      (seats.data ?? []).map((s) => ({ departureId: s.departure_id, pax: s.pax })),
    );
    if (!gap || gap.missing <= 0) return null;
    const booking = rows.find((b) => b.ref === gap.ref);
    if (!booking) return null;

    const { data: departure } = await toursDb().from("departures").select("code").eq("company_id", company.id).eq("id", gap.departureId).maybeSingle();
    const { data: entry, error: entryError } = await toursDb()
      .from("departure_sales_entries")
      .insert({
        company_id: company.id,
        departure_id: gap.departureId,
        pax: gap.missing,
        note: `Online booking ${booking.ref}, closed by hand`,
        customer_name: booking.customer_name,
        customer_phone: booking.customer_phone,
        customer_email: booking.customer_email,
        lead_id: leadId,
        entered_by: enteredBy,
      })
      .select("id, departure_id, pax, note")
      .single();
    if (entryError) throw new Error(`departure_sales_entries: ${entryError.message}`);
    if (!booking.sales_entry_id) {
      const { error: linkError } = await toursDb()
        .from("bookings")
        .update({ sales_entry_id: entry.id })
        .eq("company_id", company.id)
        .eq("id", booking.id)
        .is("sales_entry_id", null);
      if (linkError) console.error(`case-seats: booking ${booking.ref} not tied to its seats:`, linkError.message);
    }
    await logAudit({
      action: "create",
      entityType: "tours_reservation",
      entityId: entry.id,
      changes: { ...entry, automatic: true },
      metadata: { ...companyAudit(company), departure_id: gap.departureId, departure_code: departure?.code ?? null, lead_id: leadId, booking_ref: booking.ref },
    });
    return { ref: booking.ref, pax: gap.missing, departureCode: departure?.code ?? null };
  } catch (e) {
    console.error(`case-seats: seats of case ${leadId} not held:`, e instanceof Error ? e.message : e);
    return null;
  }
}
