"use server";

/**
 * An order's payments and a tour's cancellation fee rules (migration 20261020150000 - Alon's drawing of an opened
 * order, 20.10.2026; Dor chose a payments log and fee rules). A rep records a deposit, the balance or a refund, paid
 * or scheduled; a site card payment is written by the database itself (trigger bookings_payment_from_card) and can
 * only get an invoice number or a note - never be changed or removed (a refund is its own payment). Every rule of
 * what a payment / a rule may hold is pure in lib/tours/payments.ts and lib/tours/cancellation.ts.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { actionFail, actionOk, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import { todayIso } from "@/lib/tours/format";
import { PAYMENT_NOTE_MAX, PAYMENT_TEXT_MAX, checkPaymentInput, type OrderPayment, type PaymentInput } from "@/lib/tours/payments";
import { checkCancellationRules, sortRules, type CancellationRule } from "@/lib/tours/cancellation";
import {
  PAYMENT_COLUMNS,
  paymentsTableMissing,
  readCancellationRules,
  readPaymentLog,
  staffNames,
  type PaymentRecord,
} from "@/lib/tours/payment-log";

const SCOPE = "tours-payments-actions";
const NOT_READY = "Payments and fee rules are available after the system update - try again in a few minutes.";

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);

/** The booking a payment belongs to - of this company, not deleted. */
async function bookingOf(company: Company, id: string): Promise<{ id: string; ref: string; currency: string; lead_id: string | null }> {
  if (!UUID.test(id)) throw new UserError("The order was not found.");
  const { data, error } = await toursDb()
    .from("bookings")
    .select("id, ref, currency, lead_id")
    .eq("company_id", company.id)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) throw new Error(`bookings: ${error.message}`);
  if (!data) throw new UserError("The order was not found - it may have been deleted.");
  return data;
}

/** The columns a rep's payment writes. The day picked becomes noon of that day - today keeps the moment. */
function columnsOf(input: PaymentInput) {
  const today = todayIso();
  const paidAt = input.status === "paid" && input.paidOn ? (input.paidOn === today ? new Date().toISOString() : `${input.paidOn}T12:00:00Z`) : null;
  return {
    kind: input.kind,
    status: input.status,
    amount: round2(input.amount),
    amount_ils: input.amountIls == null ? null : round2(input.amountIls),
    paid_at: paidAt,
    due_date: input.status === "scheduled" ? (input.dueDate ?? null) : null,
    method: input.method || null,
    payer_name: text(input.payerName, PAYMENT_TEXT_MAX),
    invoice_no: text(input.invoiceNo, PAYMENT_TEXT_MAX),
    note: text(input.note, PAYMENT_NOTE_MAX),
  };
}

async function freshLog(company: Company, bookingId: string): Promise<OrderPayment[]> {
  const names = await staffNames(company);
  return (await readPaymentLog(company.id, [bookingId], names)).get(bookingId) ?? [];
}

/** Record a payment on an order. Answers the order's payments as they stand now. */
export async function addBookingPayment(bookingId: string, input: PaymentInput): Promise<ActionResult<OrderPayment[]>> {
  try {
    const { company, session } = await requireCompany("tours");
    const problem = checkPaymentInput(input);
    if (problem) throw new UserError(problem);
    const booking = await bookingOf(company, bookingId);
    const { data, error } = await toursDb()
      .from("booking_payments")
      .insert({ company_id: company.id, booking_id: booking.id, currency: booking.currency, entered_by: session.sub, ...columnsOf(input) })
      .select("id")
      .single();
    if (paymentsTableMissing(error)) throw new UserError(NOT_READY);
    if (error) throw new Error(`booking_payments: ${error.message}`);
    await logAudit({
      action: "create",
      entityType: "tours_booking_payment",
      entityId: data.id,
      changes: { kind: { from: null, to: input.kind }, status: { from: null, to: input.status }, amount: { from: null, to: input.amount } },
      metadata: { ...companyAudit(company), ref: booking.ref, booking_id: booking.id, lead_id: booking.lead_id },
    });
    revalidatePath("/tours/reservations");
    return actionOk(await freshLog(company, booking.id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save the payment");
  }
}

/** The payment of this company, not deleted. */
async function paymentRecord(company: Company, id: string): Promise<PaymentRecord> {
  if (!UUID.test(id)) throw new UserError("The payment was not found.");
  const { data, error } = await toursDb()
    .from("booking_payments")
    .select(PAYMENT_COLUMNS)
    .eq("company_id", company.id)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (paymentsTableMissing(error)) throw new UserError(NOT_READY);
  if (error) throw new Error(`booking_payments: ${error.message}`);
  if (!data) throw new UserError("The payment was not found - it may have been removed.");
  return data as PaymentRecord;
}

/** Change a payment. A site card payment takes only an invoice number and a note. */
export async function updateBookingPayment(paymentId: string, input: PaymentInput): Promise<ActionResult<OrderPayment[]>> {
  try {
    const { company } = await requireCompany("tours");
    const before = await paymentRecord(company, paymentId);
    const fromSite = before.method === "site";
    let patch: Record<string, unknown>;
    if (fromSite) {
      patch = { invoice_no: text(input.invoiceNo, PAYMENT_TEXT_MAX), note: text(input.note, PAYMENT_NOTE_MAX) };
    } else {
      const problem = checkPaymentInput(input);
      if (problem) throw new UserError(problem);
      patch = columnsOf(input);
      // an untouched paid day keeps its moment
      if (input.status === "paid" && before.paid_at?.slice(0, 10) === input.paidOn) patch.paid_at = before.paid_at;
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, to] of Object.entries(patch)) {
      const from = (before as Record<string, unknown>)[key];
      if (String(from ?? "") !== String(to ?? "")) changes[key] = { from, to };
    }
    if (Object.keys(changes).length) {
      const { error } = await toursDb()
        .from("booking_payments")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("company_id", company.id)
        .eq("id", before.id);
      if (error) throw new Error(`booking_payments: ${error.message}`);
      await logAudit({
        action: "update",
        entityType: "tours_booking_payment",
        entityId: before.id,
        changes,
        metadata: { ...companyAudit(company), booking_id: before.booking_id },
      });
      revalidatePath("/tours/reservations");
    }
    return actionOk(await freshLog(company, before.booking_id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save the payment");
  }
}

/** Remove a payment a rep typed (kept, marked deleted). A site card payment stays - add a refund instead. */
export async function deleteBookingPayment(paymentId: string): Promise<ActionResult<OrderPayment[]>> {
  try {
    const { company } = await requireCompany("tours");
    const before = await paymentRecord(company, paymentId);
    if (before.method === "site") throw new UserError("A card payment from the site stays on the order - record a refund instead.");
    const { error } = await toursDb()
      .from("booking_payments")
      .update({ is_deleted: todayIso(), updated_at: new Date().toISOString() })
      .eq("company_id", company.id)
      .eq("id", before.id);
    if (error) throw new Error(`booking_payments: ${error.message}`);
    await logAudit({
      action: "delete",
      entityType: "tours_booking_payment",
      entityId: before.id,
      metadata: { ...companyAudit(company), booking_id: before.booking_id, kind: before.kind, status: before.status, amount: before.amount },
    });
    revalidatePath("/tours/reservations");
    return actionOk(await freshLog(company, before.booking_id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to remove the payment");
  }
}

/** The tour of this company. */
async function packageOf(company: Company, id: string): Promise<{ id: string; name: string }> {
  if (!UUID.test(id)) throw new UserError("The tour was not found.");
  const { data, error } = await toursDb().from("packages").select("id, name").eq("company_id", company.id).eq("id", id).maybeSingle();
  if (error) throw new Error(`packages: ${error.message}`);
  if (!data) throw new UserError("The tour was not found.");
  return data;
}

/** A tour's cancellation fee rules (the tour editor loads them when the card is opened), in the company's currency. */
export async function getCancellationRules(packageId: string): Promise<ActionResult<{ rules: CancellationRule[]; currency: string }>> {
  try {
    const { company } = await requireCompany("tours");
    const pkg = await packageOf(company, packageId);
    return actionOk({ rules: await readCancellationRules(company.id, pkg.id), currency: company.defaultCurrency });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the cancellation fees");
  }
}

/** Replace a tour's cancellation fee rules. Validated whole before anything is written. */
export async function saveCancellationRules(packageId: string, rules: CancellationRule[]): Promise<ActionResult<CancellationRule[]>> {
  try {
    const { company } = await requireCompany("tours");
    const clean: CancellationRule[] = (Array.isArray(rules) ? rules : []).map((r) => ({
      component: r?.component,
      untilDaysBefore: r?.untilDaysBefore === null || r?.untilDaysBefore === undefined ? null : Number(r.untilDaysBefore),
      feeKind: r?.feeKind,
      feeValue: Number(r?.feeValue),
    }));
    const problem = checkCancellationRules(clean);
    if (problem) throw new UserError(problem);
    const pkg = await packageOf(company, packageId);
    const before = await readCancellationRules(company.id, pkg.id);
    const sorted = sortRules(clean);
    const { error: deleteError } = await toursDb().from("cancellation_rules").delete().eq("company_id", company.id).eq("package_id", pkg.id);
    if (paymentsTableMissing(deleteError)) throw new UserError(NOT_READY);
    if (deleteError) throw new Error(`cancellation_rules: ${deleteError.message}`);
    if (sorted.length) {
      const { error } = await toursDb()
        .from("cancellation_rules")
        .insert(
          sorted.map((r, position) => ({
            company_id: company.id,
            package_id: pkg.id,
            component: r.component,
            until_days_before: r.untilDaysBefore,
            fee_kind: r.feeKind,
            fee_value: r.feeValue,
            position,
          })),
        );
      if (error) throw new Error(`cancellation_rules: ${error.message}`);
    }
    await logAudit({
      action: "update",
      entityType: "tours_package",
      entityId: pkg.id,
      changes: { cancellation_rules: { from: before, to: sorted } },
      metadata: { ...companyAudit(company), name: pkg.name },
    });
    revalidatePath("/tours/reservations");
    return actionOk(sorted);
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to save the cancellation fees");
  }
}
