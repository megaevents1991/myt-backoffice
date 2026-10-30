/**
 * A site booking (tours.bookings) as the screens read it. Shared by the booking
 * actions and the case actions - a plain module, because a "use server" file
 * may export async functions only. Server side only (it reads the database).
 */
import { toursDb } from "@/lib/tours/db";
import type { TourBooking } from "@/types/tours.types";
import type { BookingLine, BookingPassenger, BookingRow } from "@/components/tours/bookings/shared";

export type DepartureBits = { id: string; code: string; start_date: string; legacy_product_id: number | null; site_id: number | null };

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const num = (value: unknown): number | null => (value == null ? null : Number(value));

export function bookingRowOf(b: TourBooking, dep: DepartureBits | undefined): BookingRow {
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
    customerMails: asRecord(b.customer_mails) as Record<string, string>,
    staffNote: b.staff_note,
    giftPassengers: (b.gift_passengers ?? []).filter((i) => Number.isInteger(i) && i >= 0),
    paymentLog: [],
    paymentLinks: [],
  };
}

/** The departures of some bookings, company-scoped, in batches of 200. */
export async function departuresOf(companyId: string, ids: string[]): Promise<Map<string, DepartureBits>> {
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
