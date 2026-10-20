/**
 * Reads an order's payments (tours.booking_payments) and a tour's cancellation rules (tours.cancellation_rules) -
 * migration 20261020150000. A plain module shared by the card load (getCase) and the payment actions: a
 * "use server" file may export async functions only. Server side only. Before the migration both read as empty.
 */
import { toursDb } from "@/lib/tours/db";
import { taskPeopleOf } from "@/lib/services/task-people";
import type { Company } from "@/lib/company";
import { isPaymentKind, isPaymentMethod, isPaymentStatus, type OrderPayment } from "@/lib/tours/payments";
import { isCancelComponent, isCancelFeeKind, sortRules, type CancellationRule } from "@/lib/tours/cancellation";

/** The table is not there yet (the migration runs on the push to master). */
export const paymentsTableMissing = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === "42P01" || error?.code === "PGRST205" || /(booking_payments|cancellation_rules).*(does not exist|schema cache)/.test(error?.message ?? "");

export const PAYMENT_COLUMNS =
  "id, booking_id, kind, status, amount, currency, amount_ils, paid_at, due_date, method, payer_name, invoice_no, cg_tx_id, note, entered_by, created_at";

export type PaymentRecord = {
  id: string;
  booking_id: string;
  kind: string;
  status: string;
  amount: number | string;
  currency: string;
  amount_ils: number | string | null;
  paid_at: string | null;
  due_date: string | null;
  method: string | null;
  payer_name: string | null;
  invoice_no: string | null;
  cg_tx_id: string | null;
  note: string | null;
  entered_by: string | null;
  created_at: string;
};

/** The company's staff, id -> name (who typed a payment). */
export async function staffNames(company: Company): Promise<Map<string, string>> {
  const people = (await taskPeopleOf(company)) ?? [];
  return new Map(people.map((p) => [p.id, p.display_name || p.email]));
}

export function paymentOf(r: PaymentRecord, names: ReadonlyMap<string, string>): OrderPayment {
  return {
    id: r.id,
    kind: isPaymentKind(r.kind) ? r.kind : "other",
    status: isPaymentStatus(r.status) ? r.status : "paid",
    amount: Number(r.amount),
    currency: r.currency,
    amountIls: r.amount_ils == null ? null : Number(r.amount_ils),
    paidAt: r.paid_at,
    dueDate: r.due_date,
    method: isPaymentMethod(r.method) ? r.method : null,
    payerName: r.payer_name,
    invoiceNo: r.invoice_no,
    cgTxId: r.cg_tx_id,
    note: r.note,
    enteredBy: r.entered_by ? (names.get(r.entered_by) ?? "A teammate") : null,
    createdAt: r.created_at,
  };
}

/** When a payment happened or is due - the log reads oldest first, like a statement. */
const whenOf = (p: OrderPayment) => p.paidAt ?? (p.dueDate ? `${p.dueDate}T12:00:00Z` : p.createdAt);

/** The payments of some bookings, by booking id, oldest first. */
export async function readPaymentLog(companyId: string, bookingIds: string[], names: ReadonlyMap<string, string>): Promise<Map<string, OrderPayment[]>> {
  const out = new Map<string, OrderPayment[]>();
  const ids = [...new Set(bookingIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await toursDb()
      .from("booking_payments")
      .select(PAYMENT_COLUMNS)
      .eq("company_id", companyId)
      .in("booking_id", ids.slice(i, i + 200))
      .is("is_deleted", null);
    if (paymentsTableMissing(error)) return out;
    if (error) throw new Error(`booking_payments: ${error.message}`);
    for (const r of (data ?? []) as PaymentRecord[]) out.set(r.booking_id, [...(out.get(r.booking_id) ?? []), paymentOf(r, names)]);
  }
  for (const list of out.values()) list.sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
  return out;
}

/** A tour's cancellation rules, in the order the fee is read. */
export async function readCancellationRules(companyId: string, packageId: string): Promise<CancellationRule[]> {
  const { data, error } = await toursDb()
    .from("cancellation_rules")
    .select("component, until_days_before, fee_kind, fee_value, position")
    .eq("company_id", companyId)
    .eq("package_id", packageId)
    .order("position");
  if (paymentsTableMissing(error)) return [];
  if (error) throw new Error(`cancellation_rules: ${error.message}`);
  const rules: CancellationRule[] = [];
  for (const r of data ?? []) {
    if (!isCancelComponent(r.component) || !isCancelFeeKind(r.fee_kind)) continue;
    rules.push({ component: r.component, untilDaysBefore: r.until_days_before, feeKind: r.fee_kind, feeValue: Number(r.fee_value) });
  }
  return sortRules(rules);
}
