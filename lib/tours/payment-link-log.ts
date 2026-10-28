/**
 * Reads an order's card payment links (tours.payment_links, migration 20261028140806). A plain module shared by the
 * card load (getCase) and the link actions: a "use server" file may export async functions only. Server side only.
 * Before the migration the links read as empty.
 */
import { toursDb } from "@/lib/tours/db";
import { isLinkKind, linkState, payLinkUrl, type PaymentLinkView } from "@/lib/tours/payment-links";

/** The table is not there yet (the migration runs on the push to master). */
export const linksTableMissing = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === "42P01" || error?.code === "PGRST205" || /payment_links.*(does not exist|schema cache)/.test(error?.message ?? "");

export const LINK_COLUMNS =
  "id, booking_id, kind, amount, currency, payments, token, expires_at, status, amount_ils, cg_card_last4, attempts, last_error, created_by, created_at, sent_at, paid_at";

export type LinkRecord = {
  id: string;
  booking_id: string;
  kind: string;
  amount: number | string;
  currency: string;
  payments: number;
  token: string;
  expires_at: string;
  status: string;
  amount_ils: number | string | null;
  cg_card_last4: string | null;
  attempts: number;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
};

export function linkViewOf(r: LinkRecord, siteUrl: string | null, names: ReadonlyMap<string, string>, now = Date.now()): PaymentLinkView {
  return {
    id: r.id,
    kind: isLinkKind(r.kind) ? r.kind : "other",
    amount: Number(r.amount),
    currency: r.currency,
    payments: r.payments,
    state: linkState(r.status, r.expires_at, now),
    url: payLinkUrl(siteUrl, r.token),
    expiresAt: r.expires_at,
    sentAt: r.sent_at,
    paidAt: r.paid_at,
    amountIls: r.amount_ils == null ? null : Number(r.amount_ils),
    cardLast4: r.cg_card_last4,
    attempts: r.attempts,
    lastError: r.last_error,
    createdBy: r.created_by ? (names.get(r.created_by) ?? "A teammate") : null,
    createdAt: r.created_at,
  };
}

/** The links of some bookings, by booking id, newest first. */
export async function readPaymentLinks(
  companyId: string,
  bookingIds: string[],
  siteUrl: string | null,
  names: ReadonlyMap<string, string>,
): Promise<Map<string, PaymentLinkView[]>> {
  const out = new Map<string, PaymentLinkView[]>();
  const ids = [...new Set(bookingIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await toursDb()
      .from("payment_links")
      .select(LINK_COLUMNS)
      .eq("company_id", companyId)
      .in("booking_id", ids.slice(i, i + 200))
      .order("created_at", { ascending: false });
    if (linksTableMissing(error)) return out;
    if (error) throw new Error(`payment_links: ${error.message}`);
    for (const r of (data ?? []) as LinkRecord[]) out.set(r.booking_id, [...(out.get(r.booking_id) ?? []), linkViewOf(r, siteUrl, names)]);
  }
  return out;
}
