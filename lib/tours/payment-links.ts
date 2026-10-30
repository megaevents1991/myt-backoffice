/**
 * Card payment links of an order (tours.payment_links, migration 20261028140806; spec
 * docs/superpowers/specs/2026-10-28-tours-card-payments-design.md - Alon's "סליקה אשראי לחבר", 28.10.2026).
 * A rep makes a link for a deposit, the balance or another amount; the customer pays it on the company site
 * through CreditGuard's page and the payment writes itself into the order's log. Dor 28.10: the rep types the
 * amount, the deposit's default is $200 per traveler. Pure - selftest scripts/tours-payment-links-selftest.ts.
 */

export const LINK_KINDS = ["deposit", "balance", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABELS: Record<LinkKind, string> = { deposit: "Deposit", balance: "Balance", other: "Other amount" };
/** How the customer reads it, in the message and on the page. */
export const LINK_KIND_HE: Record<LinkKind, string> = { deposit: "מקדמה", balance: "יתרת תשלום", other: "תשלום" };

/** The row's status; `expired` is read from the day, never stored. */
export type LinkState = "open" | "started" | "paid" | "review" | "cancelled" | "expired";
export const LINK_STATE_LABELS: Record<LinkState, string> = {
  open: "Open",
  started: "Customer on the card page",
  paid: "Paid",
  review: "Needs checking",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const DEPOSIT_PER_TRAVELER_USD = 200;
export const LINK_DAYS_DEFAULT = 7;
export const LINK_DAYS_MAX = 30;
export const LINK_PAYMENTS_MAX = 12;
export const LINK_AMOUNT_MAX = 10_000_000;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
export const isLinkKind = (v: unknown): v is LinkKind => isOneOf(LINK_KINDS, v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A link as the order shows it. */
export interface PaymentLinkView {
  id: string;
  kind: LinkKind;
  amount: number;
  currency: string;
  payments: number;
  state: LinkState;
  url: string | null;
  expiresAt: string;
  sentAt: string | null;
  paidAt: string | null;
  amountIls: number | null;
  cardLast4: string | null;
  attempts: number;
  /** What the database kept for a human (a mismatch, a second charge), or the last failed card page. */
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** What a rep sends for a new link. Amount in the order's currency. */
export interface LinkInput {
  kind: string;
  amount: number;
  payments?: number;
  days?: number;
}

/** The order a link is for, as the rules need it. */
export interface LinkOrder {
  status: string;
  currency: string;
  travelers: number;
  /** What the order still owes (orderBalance(...).due). */
  due: number;
}

/** An order that takes no link: cancelled, failed, or nothing left to pay. */
export function linkBlockedBy(order: LinkOrder): string | null {
  if (order.status === "cancelled" || order.status === "failed") return "This order is cancelled - it takes no payment.";
  if (!(order.due > 0)) return "Nothing is left to pay on this order.";
  return null;
}

/**
 * The amount the dialog opens with. Deposit: $200 per traveler (Dor 28.10), in a USD order only, never above what is
 * owed; balance: what is owed; other: empty.
 */
export function defaultLinkAmount(kind: LinkKind, order: LinkOrder): number | null {
  if (!(order.due > 0)) return null;
  if (kind === "balance") return round2(order.due);
  if (kind === "deposit") {
    if (order.currency !== "USD" || !(order.travelers > 0)) return null;
    return round2(Math.min(DEPOSIT_PER_TRAVELER_USD * order.travelers, order.due));
  }
  return null;
}

/** Why a link cannot be made, or null. */
export function checkLinkInput(input: LinkInput, order: LinkOrder): string | null {
  const blocked = linkBlockedBy(order);
  if (blocked) return blocked;
  if (!isLinkKind(input.kind)) return "Choose what the payment is for.";
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0) return "The amount must be more than 0.";
  if (round2(input.amount) !== input.amount) return "The amount takes two decimals at most.";
  if (input.amount > LINK_AMOUNT_MAX) return "The amount is too big.";
  if (input.amount > round2(order.due)) return `The amount is more than the order still owes (${round2(order.due)} ${order.currency}).`;
  const payments = input.payments ?? 1;
  if (!Number.isInteger(payments) || payments < 1 || payments > LINK_PAYMENTS_MAX) return `Payments: 1 to ${LINK_PAYMENTS_MAX}.`;
  if (input.kind === "deposit" && payments !== 1) return "A deposit is one payment.";
  const days = input.days ?? LINK_DAYS_DEFAULT;
  if (!Number.isInteger(days) || days < 1 || days > LINK_DAYS_MAX) return `The link is valid 1 to ${LINK_DAYS_MAX} days.`;
  return null;
}

/** The state a link shows: an open one past its day reads as expired. */
export function linkState(status: string, expiresAt: string, now: number): LinkState {
  if (status === "paid" || status === "review" || status === "cancelled") return status;
  if (Date.parse(expiresAt) <= now) return "expired";
  return status === "started" ? "started" : "open";
}

/** A link the rep may still send or cancel. */
export const isLiveLink = (state: LinkState): boolean => state === "open" || state === "started";

/**
 * What the order's links still open could charge, in its currency. A new link gets the balance minus this - so two
 * open links can never together ask for more than the order owes (the database checks again when one is paid).
 */
export function openLinksTotal(links: readonly Pick<PaymentLinkView, "state" | "amount" | "currency">[], currency: string): number {
  return round2(links.filter((l) => isLiveLink(l.state) && l.currency === currency).reduce((sum, l) => sum + l.amount, 0));
}

/** The page on the company site: {siteUrl}/pay/<token>/ (the site has trailingSlash on). */
export function payLinkUrl(siteUrl: string | null | undefined, token: string): string | null {
  if (!siteUrl?.trim() || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return `${siteUrl.trim().replace(/\/+$/, "")}/pay/${token}/`;
}

/** dd.mm of an ISO moment, in Israel. */
export function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit" }).format(new Date(iso)).replace("/", ".");
}

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", ILS: "₪" };
/** "$400" / "₪1,480.50" - the way the message prints a sum. */
export function moneyText(amount: number, currency: string): string {
  const n = amount.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 });
  const sym = SYMBOLS[currency];
  return sym ? `${sym}${n}` : `${n} ${currency}`;
}

/** The number a customer reads: T10049 is 10049 to them (Alon 30.10; mega-family's mails and pages say the same). */
export const customerOrderNumber = (ref: string): string => ref.replace(/^T(?=\d)/, "");

/** The message that goes with a link (WhatsApp / e-mail). */
export function payLinkMessage(args: { firstName: string | null | undefined; kind: LinkKind; amount: number; currency: string; ref: string; url: string; expiresAt: string }): string {
  const hello = args.firstName?.trim() ? `היי ${args.firstName.trim()},` : "היי,";
  return `${hello} מצרפים קישור ל${LINK_KIND_HE[args.kind]} של הזמנה ${customerOrderNumber(args.ref)} (${moneyText(args.amount, args.currency)}). התשלום בכרטיס אשראי בדף המאובטח של חברת הסליקה: ${args.url}\nהקישור בתוקף עד ${dayMonth(args.expiresAt)}.`;
}

/** The first word of a name, for "היי דנה". */
export const firstNameOf = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] || null;
