"use server";

/**
 * Card payment links of an order (migration 20261028140806; spec docs/superpowers/specs/2026-10-28-tours-card-payments-design.md
 * - Alon's "סליקה אשראי לחבר", 28.10.2026). A rep makes a link for a deposit, the balance or another amount; the
 * customer pays it on the company site (`{siteUrl}/pay/<token>/`) through CreditGuard's own page, and the database
 * writes the payment into the order's log by itself (tours.link_finish_payment). Nothing here charges a card or
 * sees one. Every rule of what a link may hold is pure in lib/tours/payment-links.ts.
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireCompanyRep, type Company } from "@/lib/company";
import { assertCardVisible } from "@/lib/services/tours-board-viewer";
import { toursDb } from "@/lib/tours/db";
import { logAudit } from "@/lib/audit";
import { actionFail, actionOk, UserError, UUID, type ActionResult } from "@/lib/tours/action-kit";
import { companyAudit } from "@/lib/tours/company-kit";
import { orderBalance } from "@/lib/tours/payments";
import { readPaymentLog, staffNames } from "@/lib/tours/payment-log";
import { LINK_COLUMNS, linkViewOf, linksTableMissing, readPaymentLinks, type LinkRecord } from "@/lib/tours/payment-link-log";
import { LINK_DAYS_DEFAULT, checkLinkInput, openLinksTotal, type LinkInput, type PaymentLinkView } from "@/lib/tours/payment-links";

const SCOPE = "tours-payment-link-actions";
const NOT_READY = "Payment links are available after the system update - try again in a few minutes.";

type LinkBooking = { id: string; ref: string; status: string; currency: string; total: number; adults: number; children: number; lead_id: string | null };

/** The booking a link belongs to - of this company, not deleted. */
async function bookingOf(company: Company, id: string): Promise<LinkBooking> {
  if (!UUID.test(id)) throw new UserError("The order was not found.");
  const { data, error } = await toursDb()
    .from("bookings")
    .select("id, ref, status, currency, total, adults, children, lead_id")
    .eq("company_id", company.id)
    .eq("id", id)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) throw new Error(`bookings: ${error.message}`);
  if (!data) throw new UserError("The order was not found - it may have been deleted.");
  return { ...data, total: Number(data.total) } as LinkBooking;
}

async function linksOf(company: Company, bookingId: string): Promise<PaymentLinkView[]> {
  const names = await staffNames(company);
  return (await readPaymentLinks(company.id, [bookingId], company.siteUrl, names)).get(bookingId) ?? [];
}

/** The link of this company. */
async function linkRecord(company: Company, id: string): Promise<LinkRecord> {
  if (!UUID.test(id)) throw new UserError("The link was not found.");
  const { data, error } = await toursDb().from("payment_links").select(LINK_COLUMNS).eq("company_id", company.id).eq("id", id).maybeSingle();
  if (linksTableMissing(error)) throw new UserError(NOT_READY);
  if (error) throw new Error(`payment_links: ${error.message}`);
  if (!data) throw new UserError("The link was not found.");
  return data as LinkRecord;
}

/** The order's links, newest first (the card loads them with the order; this re-reads after a change). */
export async function listPaymentLinks(bookingId: string): Promise<ActionResult<PaymentLinkView[]>> {
  try {
    const { company, session } = await requireCompanyRep("tours");
    const booking = await bookingOf(company, bookingId);
    await assertCardVisible(session, company, booking.lead_id);
    return actionOk(await linksOf(company, booking.id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to load the payment links");
  }
}

/** Make a link. Answers the new link and the order's links as they stand now. */
export async function createPaymentLink(bookingId: string, input: LinkInput): Promise<ActionResult<{ link: PaymentLinkView; links: PaymentLinkView[] }>> {
  try {
    const { company, session } = await requireCompanyRep("tours");
    if (!company.siteUrl) throw new UserError("The company has no site address - set it in the company settings first.");
    const booking = await bookingOf(company, bookingId);
    await assertCardVisible(session, company, booking.lead_id);
    const names = await staffNames(company);
    const log = (await readPaymentLog(company.id, [booking.id], names)).get(booking.id) ?? [];
    const balance = orderBalance(booking.total, booking.currency, log);
    // the links still open on the order count as asked for already
    const open = openLinksTotal(await linksOf(company, booking.id), booking.currency);
    const order = { status: booking.status, currency: booking.currency, travelers: booking.adults + booking.children, due: Math.round((balance.due - open) * 100) / 100 };
    const problem = checkLinkInput(input, order);
    if (problem) throw new UserError(problem);

    const days = input.days ?? LINK_DAYS_DEFAULT;
    const { data, error } = await toursDb()
      .from("payment_links")
      .insert({
        company_id: company.id,
        booking_id: booking.id,
        kind: input.kind,
        amount: input.amount,
        currency: booking.currency,
        payments: input.payments ?? 1,
        token: randomBytes(24).toString("base64url"),
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
        created_by: session.sub,
      })
      .select(LINK_COLUMNS)
      .single();
    if (linksTableMissing(error)) throw new UserError(NOT_READY);
    if (error) throw new Error(`payment_links: ${error.message}`);
    const record = data as LinkRecord;
    await logAudit({
      action: "create",
      entityType: "tours_payment_link",
      entityId: record.id,
      changes: { kind: { from: null, to: input.kind }, amount: { from: null, to: input.amount }, payments: { from: null, to: record.payments } },
      metadata: { ...companyAudit(company), ref: booking.ref, booking_id: booking.id, lead_id: booking.lead_id, days },
    });
    revalidatePath("/tours/reservations");
    return actionOk({ link: linkViewOf(record, company.siteUrl, names), links: await linksOf(company, booking.id) });
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to make the payment link");
  }
}

/** The rep sent it (a click on WhatsApp or e-mail - copying is not sending). */
export async function markPaymentLinkSent(linkId: string): Promise<ActionResult<PaymentLinkView[]>> {
  try {
    const { company, session } = await requireCompanyRep("tours");
    const link = await linkRecord(company, linkId);
    const booking = await bookingOf(company, link.booking_id);
    await assertCardVisible(session, company, booking.lead_id);
    const { error } = await toursDb()
      .from("payment_links")
      .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("company_id", company.id)
      .eq("id", link.id);
    if (error) throw new Error(`payment_links: ${error.message}`);
    return actionOk(await linksOf(company, booking.id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to mark the link as sent");
  }
}

/** Cancel a link nobody paid. A customer already on the card page who pays anyway is kept for a human (review). */
export async function cancelPaymentLink(linkId: string): Promise<ActionResult<PaymentLinkView[]>> {
  try {
    const { company, session } = await requireCompanyRep("tours");
    const link = await linkRecord(company, linkId);
    const booking = await bookingOf(company, link.booking_id);
    await assertCardVisible(session, company, booking.lead_id);
    if (link.status !== "open" && link.status !== "started") throw new UserError("This link is no longer open.");
    const { data, error } = await toursDb()
      .from("payment_links")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("company_id", company.id)
      .eq("id", link.id)
      .in("status", ["open", "started"])
      .select("id");
    if (error) throw new Error(`payment_links: ${error.message}`);
    if (!data?.length) throw new UserError("This link was paid or closed a moment ago - refresh the card.");
    await logAudit({
      action: "update",
      entityType: "tours_payment_link",
      entityId: link.id,
      changes: { status: { from: link.status, to: "cancelled" } },
      metadata: { ...companyAudit(company), ref: booking.ref, booking_id: booking.id, lead_id: booking.lead_id },
    });
    revalidatePath("/tours/reservations");
    return actionOk(await linksOf(company, booking.id));
  } catch (e) {
    return actionFail(e, SCOPE, "Failed to cancel the link");
  }
}
