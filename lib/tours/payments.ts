/**
 * An order's payments (tours.booking_payments, migration 20261020150000 - Alon's drawing of an opened order,
 * 20.10.2026): what a rep types (a deposit, the balance, a refund; paid or scheduled) and what a site card payment
 * adds by itself, and the balance they leave. Pure - selftest scripts/tours-payments-selftest.ts.
 */

export const PAYMENT_KINDS = ["deposit", "balance", "full", "refund", "other"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  deposit: "Deposit",
  balance: "Balance payment",
  full: "Full payment",
  refund: "Refund",
  other: "Other",
};

export const PAYMENT_STATUSES = ["paid", "scheduled", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { paid: "Paid", scheduled: "Scheduled", failed: "Failed" };

export const PAYMENT_METHODS = ["site", "card", "transfer", "cash", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  site: "Card on the site",
  card: "Card by phone",
  transfer: "Bank transfer",
  cash: "Cash",
  check: "Check",
  other: "Other",
};
/** What a rep may pick - "Card on the site" is written by the site's payment alone. */
export const STAFF_PAYMENT_METHODS = PAYMENT_METHODS.filter((m) => m !== "site");

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
export const isPaymentKind = (v: unknown): v is PaymentKind => isOneOf(PAYMENT_KINDS, v);
export const isPaymentStatus = (v: unknown): v is PaymentStatus => isOneOf(PAYMENT_STATUSES, v);
export const isPaymentMethod = (v: unknown): v is PaymentMethod => isOneOf(PAYMENT_METHODS, v);

/** A payment as the order shows it. */
export interface OrderPayment {
  id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  /** In the payment's currency - the booking's currency, for every payment a rep types. */
  amount: number;
  currency: string;
  amountIls: number | null;
  paidAt: string | null;
  dueDate: string | null;
  method: PaymentMethod | null;
  payerName: string | null;
  invoiceNo: string | null;
  cgTxId: string | null;
  note: string | null;
  /** The rep who typed it; null = the site. */
  enteredBy: string | null;
  createdAt: string;
}

/** What a rep sends for a new payment or an edit. Amount in the booking's currency. */
export interface PaymentInput {
  kind: string;
  status: string;
  amount: number;
  amountIls?: number | null;
  /** yyyy-mm-dd - the day it was paid (paid) */
  paidOn?: string | null;
  /** yyyy-mm-dd - the day it is due (scheduled) */
  dueDate?: string | null;
  method?: string | null;
  payerName?: string | null;
  invoiceNo?: string | null;
  note?: string | null;
}

export const PAYMENT_AMOUNT_MAX = 10_000_000;
export const PAYMENT_TEXT_MAX = 200;
export const PAYMENT_NOTE_MAX = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Why a payment cannot be saved, or null. */
export function checkPaymentInput(input: PaymentInput): string | null {
  if (!isPaymentKind(input.kind)) return "Choose what the payment is.";
  if (!isPaymentStatus(input.status)) return "Choose whether it was paid or is scheduled.";
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) return "The amount must be more than 0.";
  if (input.amount > PAYMENT_AMOUNT_MAX) return "The amount is too big.";
  if (input.amountIls != null && (!Number.isFinite(input.amountIls) || input.amountIls < 0 || input.amountIls > PAYMENT_AMOUNT_MAX)) {
    return "The amount in shekels is not a number.";
  }
  if (input.status === "paid" && !isDay(input.paidOn)) return "Pick the day it was paid.";
  if (input.status === "scheduled" && !isDay(input.dueDate)) return "Pick the day it is due.";
  if (input.method != null && input.method !== "" && !isOneOf(STAFF_PAYMENT_METHODS, input.method)) return "Choose how it was paid.";
  for (const [label, value] of [
    ["The payer", input.payerName],
    ["The invoice number", input.invoiceNo],
  ] as const) {
    if (value && value.length > PAYMENT_TEXT_MAX) return `${label} is too long.`;
  }
  if (input.note && input.note.length > PAYMENT_NOTE_MAX) return "The note is too long.";
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OrderBalance {
  currency: string;
  total: number;
  /** Paid in, refunds taken off. */
  paid: number;
  /** Scheduled and not paid yet. */
  scheduled: number;
  /** What is still owed: total - paid. Below 0 = paid more than the order. */
  due: number;
  /** A payment in another currency was left out of the sum. */
  otherCurrency: boolean;
}

/** The balance of an order: only paid payments count, a refund counts back, a failed one not at all. */
export function orderBalance(
  total: number,
  currency: string,
  payments: readonly Pick<OrderPayment, "kind" | "status" | "amount" | "currency">[],
): OrderBalance {
  let paid = 0;
  let scheduled = 0;
  let otherCurrency = false;
  for (const p of payments) {
    if (p.currency !== currency) {
      otherCurrency = true;
      continue;
    }
    const sign = p.kind === "refund" ? -1 : 1;
    if (p.status === "paid") paid += sign * p.amount;
    else if (p.status === "scheduled" && p.kind !== "refund") scheduled += p.amount;
  }
  return { currency, total: round2(total), paid: round2(paid), scheduled: round2(scheduled), due: round2(total - paid), otherCurrency };
}

/** How the balance reads on an order's line: owed, paid in full, or paid more. */
export function balanceTone(balance: Pick<OrderBalance, "due">): "owed" | "settled" | "over" {
  if (balance.due > 0.005) return "owed";
  if (balance.due < -0.005) return "over";
  return "settled";
}
