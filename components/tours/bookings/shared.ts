/**
 * Online bookings of a tours company (tours.bookings, migration 20261003100000):
 * what the customer site sends from its booking step - a request for a rep, or
 * a card payment on the CreditGuard page. Shared by the screen and its actions.
 */
export type { ActionResult } from "@/lib/tours/action-kit";

export const BOOKING_STATUSES = ["new", "in_progress", "pending_payment", "paid", "review", "failed", "done", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  new: "New",
  in_progress: "In progress",
  pending_payment: "Waiting for payment",
  paid: "Paid",
  review: "Check payment",
  failed: "Payment failed",
  done: "Done",
  cancelled: "Cancelled",
};

/** What each status means, for the status menu and the guide. */
export const BOOKING_STATUS_HINTS: Record<BookingStatus, string> = {
  new: "A request that nobody has handled yet.",
  in_progress: "Someone is handling it.",
  pending_payment: "The customer went to the payment page and has not paid (yet). A hot lead.",
  paid: "CreditGuard confirmed the exact amount. The seats were added to the departure.",
  review: "CreditGuard reported a charge, but the amount or currency does not match. Check it in CreditGuard.",
  failed: "The payment was declined or cancelled. The customer can try again.",
  done: "Handled: confirmation sent, receipt issued.",
  cancelled: "Cancelled.",
};

/** The statuses staff may set by hand. "paid" only to confirm a "Check payment" after checking CreditGuard. */
export const STAFF_STATUSES: BookingStatus[] = ["new", "in_progress", "done", "cancelled"];

export const bookingStatusLabel = (status: string): string => BOOKING_STATUS_LABELS[status as BookingStatus] ?? status;

export interface BookingLine {
  key: string;
  title: string;
  adults: number;
  children: number;
  price?: number;
  discount?: number;
  net?: number;
}

export interface BookingPassenger {
  room?: string | null;
  type: "adult" | "child";
  first: string;
  last: string;
  gender?: string | null;
  dob?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface BookingRow {
  id: string;
  ref: string;
  createdAt: string;
  kind: "request" | "card";
  status: string;
  priceBasis: "server" | "estimate";
  departureId: string;
  departureCode: string | null;
  departureStart: string | null;
  /** The site's ?product_id= of the departure, for the reservation dialog. */
  siteId: number | null;
  leadId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  note: string | null;
  sourcePath: string | null;
  currency: string;
  adults: number;
  children: number;
  seniors: number;
  subtotal: number;
  discount: number;
  total: number;
  lines: BookingLine[];
  passengers: BookingPassenger[];
  breakdown: Record<string, unknown>;
  rate: number | null;
  rateSource: string | null;
  totalIls: number | null;
  payments: number | null;
  cgTxId: string | null;
  cgAuthNumber: string | null;
  cardLast4: string | null;
  paidAt: string | null;
  salesEntryId: string | null;
  receiptNo: string | null;
  confirmationSentAt: string | null;
  staffNote: string | null;
}

export interface BookingChange {
  status?: string;
  receiptNo?: string | null;
  staffNote?: string | null;
  confirmationSent?: boolean;
}

/** Search across what the operator sees in the row. */
export function bookingMatches(row: BookingRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [row.ref, row.customerName, row.customerPhone, row.customerEmail, row.departureCode, row.note, row.receiptNo]
    .some((v) => (v ?? "").toLowerCase().includes(needle));
}
