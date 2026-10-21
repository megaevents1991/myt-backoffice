/**
 * One table for a tours company's leads and reservations - the case
 * (spec docs/superpowers/specs/2026-10-14-tours-unified-reservations-design.md).
 *
 * A case is a row of public.leads: every form of the site, every site booking
 * and every reservation staff type in is one customer case with a TYPE, a
 * status from the company's own list, a rep, and a TASK derived from it all.
 * Pure - no DB, no React: the server actions, the screens and
 * scripts/tours-cases-selftest.ts share it. The SQL twins of typeOfKind,
 * splitName and the closed-status rule live in the migration
 * 20261014220000_tours_unified_cases.sql (public.leads_fill,
 * public.lead_status_closed) - change both together.
 */
import { matchesSearch } from "@/lib/search";
import type { BookingRow } from "@/components/tours/bookings/shared";
import type { ToursReservationRow } from "@/components/tours/reservations/types";
import type { CancellationRule } from "@/lib/tours/cancellation";

// ---------------------------------------------------------------- TYPE
export const CASE_TYPES = ["reservation", "lead", "potential"] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  reservation: "Reservation",
  lead: "Lead",
  potential: "Potential",
};
export const isCaseType = (value: unknown): value is CaseType => CASE_TYPES.includes(value as CaseType);

/** A future lead: interested in something that is not on sale yet. */
const POTENTIAL_KINDS = new Set(["notify", "waitlist", "newsletter"]);
/** Registered through the site's booking funnel (a request or a card payment). */
const RESERVATION_KINDS = new Set(["booking", "advisor"]);

/** The TYPE a new case opens with, from the form that opened it (SQL twin: public.leads_fill). */
export function typeOfKind(kind: string): CaseType {
  if (POTENTIAL_KINDS.has(kind)) return "potential";
  if (RESERVATION_KINDS.has(kind)) return "reservation";
  return "lead";
}

// ---------------------------------------------------------------- source
export const CASE_SOURCES = ["site", "phone", "whatsapp", "office", "agent", "other"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];
export const CASE_SOURCE_LABELS: Record<CaseSource, string> = {
  site: "Website",
  phone: "Phone",
  whatsapp: "WhatsApp",
  office: "Office",
  agent: "Agent",
  other: "Other",
};
export const isCaseSource = (value: unknown): value is CaseSource => CASE_SOURCES.includes(value as CaseSource);

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The Source column: the campaign when the visit carried one, else how the case came in. */
export function sourceLabel(source: string, utm: Record<string, unknown>): string {
  const campaign = text(utm.source);
  if (campaign) return text(utm.medium) ? `${campaign} / ${text(utm.medium)}` : campaign;
  return CASE_SOURCE_LABELS[source as CaseSource] ?? source;
}

// ---------------------------------------------------------------- statuses
export const STATUS_COLORS = ["blue", "slate", "amber", "violet", "indigo", "cyan", "orange", "red", "rose", "teal", "green", "gray"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];
/** The tag of a status on the screens - one class set per colour, light and dark. */
export const STATUS_COLOR_CLASSES: Record<StatusColor, string> = {
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  indigo: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-800 dark:text-cyan-300",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  red: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  green: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  gray: "border-border bg-muted text-muted-foreground",
};
export const isStatusColor = (value: unknown): value is StatusColor => STATUS_COLORS.includes(value as StatusColor);

/** One status of the company's list. The list's order is the order of the array. */
export interface CaseStatus {
  key: string;
  label: string;
  color: StatusColor;
  /** No more work on a case in it: no TASK, out of "follow-up due". */
  isClosed: boolean;
  /** Set by the system (a payment, a new booking): renamed and recoloured only, never switched off. */
  isSystem: boolean;
  /** Switched off: no longer offered, still shown on the cases that carry it. */
  isActive: boolean;
}

/**
 * Nir's list (19.10): the code reads these keys, so they stay on and keep their closed flag - a company may
 * rename and recolour them and add statuses of its own.
 */
export const SYSTEM_STATUS_KEYS = [
  "new",
  "no_answer",
  "returned",
  "offer_sent",
  "future",
  "pending_payment",
  "deposit_paid",
  "paid",
  "not_relevant",
  "cancelled",
  "spam",
] as const;
const isSystemKey = (key: string): boolean => (SYSTEM_STATUS_KEYS as readonly string[]).includes(key);
/** Closed when a company has no list of its own (SQL twin: public.lead_status_closed). */
const DEFAULT_CLOSED_KEYS = new Set(["done", "not_relevant", "cancelled", "spam"]);

const st = (key: string, label: string, color: StatusColor, isClosed = false): CaseStatus => ({
  key,
  label,
  color,
  isClosed,
  isSystem: isSystemKey(key),
  isActive: true,
});
/** A status of the list before 19.10: switched off, kept because an old card may still carry it. */
const retired = (key: string, label: string, color: StatusColor, isClosed = false): CaseStatus => ({ ...st(key, label, color, isClosed), isActive: false });

/** The list every tours company starts with - the migrations seed the same rows (20261019180000: Nir's order). */
export const DEFAULT_STATUSES: CaseStatus[] = [
  st("new", "חדש", "blue"),
  st("no_answer", "אין מענה", "slate"),
  // the customer came back: a site form on the same tour, or the rep marked it (Nir 19.10)
  st("returned", "חזר", "violet"),
  // set by the booking link (Alon 15.10), with the follow-up day the rep must pick
  st("offer_sent", "הצעה נשלחה", "indigo"),
  // interested in a tour that is not on sale for them yet - needs the tour and a season
  st("future", "ליד עתידי", "cyan"),
  st("pending_payment", "ממתין לתשלום", "orange"),
  // counts as paid: the seats are held
  st("deposit_paid", "שולם מקדמה", "teal"),
  st("paid", "שולם", "green"),
  st("not_relevant", "לא רלוונטי", "gray", true),
  st("cancelled", "בוטל", "gray", true),
  st("spam", "ספאם", "gray", true),
  retired("in_progress", "בטיפול", "amber"),
  retired("follow_up", "פולו אפ", "violet"),
  retired("done", "נסגר", "green", true),
  retired("payment_failed", "תשלום נכשל", "red"),
  retired("payment_review", "בדיקת תשלום", "rose"),
];

export const STATUS_MAX = 30;
export const STATUS_LABEL_MAX = 40;

export const statusOf = (key: string, statuses: readonly CaseStatus[]): CaseStatus | undefined =>
  statuses.find((s) => s.key === key);

export function isClosedStatus(key: string, statuses: readonly CaseStatus[]): boolean {
  const found = statusOf(key, statuses);
  return found ? found.isClosed : DEFAULT_CLOSED_KEYS.has(key);
}

// ---------------------------------------------------------------- why a case was closed
/** Closing statuses that need no reason: a deal closed, junk. */
const NO_REASON_KEYS = new Set(["done", "spam"]);
export const CLOSE_REASON_MIN = 3;
export const CLOSE_REASON_MAX = 500;
/** One click fills the reason box; the rep may still write their own. */
export const CLOSE_REASON_PRESETS = [
  "המחיר גבוה מדי",
  "התאריכים לא מתאימים",
  "הזמין אצל מתחרה",
  "לא עונה / לא זמין",
  "ביקש לא ליצור קשר",
  "כפילות / טעות",
] as const;

/**
 * Moving a case to a closed status other than Done or Spam asks the rep why (Alon 15.10: "not
 * relevant" must come with a reason before the window closes) - Not relevant, Cancelled, and any
 * closed status of the company's own.
 */
export function needsCloseReason(key: string, statuses: readonly CaseStatus[]): boolean {
  return isClosedStatus(key, statuses) && !NO_REASON_KEYS.has(key);
}

export function checkCloseReason(value: string | null | undefined): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = (value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < CLOSE_REASON_MIN) return { ok: false, error: "Write why the case is closed - a few words." };
  if (reason.length > CLOSE_REASON_MAX) return { ok: false, error: `The reason can be up to ${CLOSE_REASON_MAX} characters.` };
  return { ok: true, reason };
}

/** Statuses a payment owns: a booking link never writes over them. */
const PAYMENT_KEYS = new Set(["pending_payment", "payment_failed", "payment_review", "deposit_paid", "paid"]);

/**
 * The status a case takes when the rep sends it a booking link: "Offer sent" - unless money is on
 * its way or taken, or the deal is closed as Done. A lead closed as not relevant that gets a link is
 * being sold to again, so it reopens. A company list without the status (the migration not applied)
 * keeps the case's own.
 */
export function statusAfterLink(current: string, statuses: readonly CaseStatus[]): string {
  if (!statusOf("offer_sent", statuses)) return current;
  if (PAYMENT_KEYS.has(current) || current === "done") return current;
  return "offer_sent";
}

/** A row of the status editor: `key` null = a status staff just added. */
export interface StatusDraft {
  key: string | null;
  label: string;
  color: string;
  isClosed: boolean;
  isActive: boolean;
}

/**
 * The status list staff saved, checked before anything is written: 1 to 30
 * statuses, names 1 to 40 characters and unique, a known colour, every status
 * of the current list still there (a status is switched off, never removed - a
 * case may carry it), system statuses on and with their own closed flag. A new
 * status gets the next free `custom_<n>` key; a rename keeps the key.
 */
export function validateStatuses(
  drafts: readonly StatusDraft[],
  current: readonly CaseStatus[],
): { ok: true; statuses: CaseStatus[] } | { ok: false; error: string } {
  if (drafts.length === 0 || drafts.length > STATUS_MAX) return { ok: false, error: `Keep between 1 and ${STATUS_MAX} statuses.` };
  const base = current.length ? current : DEFAULT_STATUSES;
  const byKey = new Map(base.map((s) => [s.key, s]));
  const customNumbers = base.map((s) => /^custom_(\d+)$/.exec(s.key)).map((m) => (m ? Number(m[1]) : 0));
  let nextCustom = 1 + Math.max(0, ...customNumbers);
  const seenLabels = new Set<string>();
  const seenKeys = new Set<string>();
  const out: CaseStatus[] = [];
  for (const draft of drafts) {
    const label = draft.label.trim().replace(/\s+/g, " ");
    if (!label || label.length > STATUS_LABEL_MAX) {
      return { ok: false, error: `A status name must be 1 to ${STATUS_LABEL_MAX} characters.` };
    }
    const folded = label.toLowerCase();
    if (seenLabels.has(folded)) return { ok: false, error: `Two statuses are called "${label}".` };
    seenLabels.add(folded);
    if (!isStatusColor(draft.color)) return { ok: false, error: `"${label}" has an unknown colour.` };
    let key: string;
    if (draft.key) {
      if (!byKey.has(draft.key)) return { ok: false, error: `Unknown status "${label}" - reload the screen.` };
      key = draft.key;
    } else {
      key = `custom_${nextCustom++}`;
    }
    if (seenKeys.has(key)) return { ok: false, error: `"${label}" appears twice.` };
    seenKeys.add(key);
    const system = isSystemKey(key);
    if (system && !draft.isActive) return { ok: false, error: `"${label}" is set by the system and cannot be switched off.` };
    out.push({
      key,
      label,
      color: draft.color,
      isClosed: system ? (byKey.get(key)?.isClosed ?? DEFAULT_CLOSED_KEYS.has(key)) : draft.isClosed,
      isSystem: system,
      isActive: draft.isActive,
    });
  }
  const missing = base.find((s) => !seenKeys.has(s.key));
  if (missing) return { ok: false, error: `"${missing.label}" cannot be removed - switch it off instead.` };
  return { ok: true, statuses: out };
}

// ---------------------------------------------------------------- TODAY: why a card waits for a rep (Nir 19.10)
/**
 * The status IS the work now - there is no TASK column. TODAY lists every card a rep has to touch, with the
 * reason, in this order (Nir 19.10).
 */
export const TODAY_REASONS = ["returned", "payment", "file", "new", "late", "today", "confirmation"] as const;
export type TodayReason = (typeof TODAY_REASONS)[number];
export const TODAY_REASON_LABELS: Record<TodayReason, string> = {
  returned: "Came back",
  payment: "Site payment to confirm",
  file: "Inquiry to file",
  new: "New",
  late: "Follow-up late",
  today: "Follow-up today",
  confirmation: "Send the confirmation",
};
export const todayRank = (reason: TodayReason): number => TODAY_REASONS.indexOf(reason);

/** What a site card payment answered on a card that waits for its money - the rep confirms it (Nir 19.10). */
export type PaymentAnswer = "paid" | "failed" | "review";
export const PAYMENT_ANSWER_LABELS: Record<PaymentAnswer, string> = {
  paid: "Card payment approved",
  failed: "Card payment failed",
  review: "Card payment to check",
};

/** The card waits for money and its newest booking's payment has an answer (bookings newest first). */
export function paymentAnswerOf(status: string, bookingStatuses: readonly string[]): PaymentAnswer | null {
  if (status !== "pending_payment") return null;
  const newest = bookingStatuses[0];
  return newest === "paid" || newest === "failed" || newest === "review" ? newest : null;
}

/** What TODAY is read from. */
export interface TodayFacts {
  status: string;
  followUpDate: string | null;
  /** An inquiry that names no tour while the customer has open cards - the rep files it. */
  toFile: boolean;
  paymentAnswer: PaymentAnswer | null;
  /** A paid site booking whose confirmation was not sent yet. */
  confirmationPending: boolean;
}

/** Why the card waits for a rep today, or null. First match wins. */
export function todayReason(c: TodayFacts, statuses: readonly CaseStatus[], today: string): TodayReason | null {
  if (c.toFile) return "file";
  if (isClosedStatus(c.status, statuses)) return null;
  if (c.status === "returned") return "returned";
  if (c.paymentAnswer) return "payment";
  if (c.status === "new") return "new";
  if (c.followUpDate && /^\d{4}-\d{2}-\d{2}$/.test(c.followUpDate)) {
    if (c.followUpDate < today) return "late";
    if (c.followUpDate === today) return "today";
  }
  if (c.status === "paid" && c.confirmationPending) return "confirmation";
  return null;
}

/** Days between a follow-up day and today (both YYYY-MM-DD), for "Follow-up 2 days late". */
export function daysLate(day: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000));
}

// ---------------------------------------------------------------- the card: where the deal stands
/** Statuses of a deal that has an order and its money. Deposit counts as paid (the seats are held). */
const ORDER_KEYS = new Set(["pending_payment", "deposit_paid", "paid"]);
const PAID_KEYS = new Set(["deposit_paid", "paid"]);
export const isPaidStatus = (status: string): boolean => PAID_KEYS.has(status);

/** Lead -> Offer -> Order -> Paid: the step the card reached (0..3), 3.5 = a deposit; null = closed. */
export function cardStage(status: string, hasOrder: boolean, statuses: readonly CaseStatus[]): number | null {
  if (isClosedStatus(status, statuses)) return null;
  if (status === "paid") return 3;
  if (status === "deposit_paid") return 2.5;
  if (ORDER_KEYS.has(status) || hasOrder) return 2;
  if (status === "offer_sent") return 1;
  return 0;
}
export const CARD_STAGES = ["Lead", "Offer", "Order", "Paid"] as const;

/** A card a new inquiry may land on: not closed, not waiting to be filed, not a paid trip that already left. */
export interface RouteCard {
  id: string;
  packageId: string | null;
  status: string;
  toFile: boolean;
  /** The card's departure's first day. */
  departureStart: string | null;
  createdAt: string;
}
export function isOpenCard(card: RouteCard, statuses: readonly CaseStatus[], today: string): boolean {
  if (card.toFile || isClosedStatus(card.status, statuses)) return false;
  return !(PAID_KEYS.has(card.status) && !!card.departureStart && card.departureStart < today);
}

/** Forms that never route: bookings route themselves, staff choose by hand, a newsletter is no inquiry. */
const UNROUTED_KINDS = new Set(["booking", "advisor", "manual", "newsletter"]);
export type InquiryRoute = { kind: "join"; cardId: string } | { kind: "file" } | { kind: "new" };

/**
 * Where a SITE FORM of a known customer goes (SQL twin: public.leads_fill, 20261019180000). Its tour has an open
 * card -> it joins it (newest first); no tour while open cards exist -> the rep files it; else a new card.
 */
export function routeInquiry(
  form: { kind: string; packageId: string | null },
  cards: readonly RouteCard[],
  statuses: readonly CaseStatus[],
  today: string,
): InquiryRoute {
  if (UNROUTED_KINDS.has(form.kind)) return { kind: "new" };
  const open = cards.filter((c) => isOpenCard(c, statuses, today)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (form.packageId) {
    const same = open.find((c) => c.packageId === form.packageId);
    return same ? { kind: "join", cardId: same.id } : { kind: "new" };
  }
  return open.length ? { kind: "file" } : { kind: "new" };
}

/** The status a card takes when the customer comes back on it (a form joined it, or the rep filed one there). */
export function statusOnReturn(status: string, statuses: readonly CaseStatus[]): string {
  if (!statusOf("returned", statuses)) return status;
  return status === "no_answer" || status === "offer_sent" || status === "future" ? "returned" : status;
}

/**
 * The customer's history a new card should know about: the newest card of theirs opened before it that is closed
 * or paid - "was not relevant · price (06.10)", "travelled with us". Null for a first contact.
 */
export interface KnownFrom {
  caseNo: number;
  status: string;
  closeReason: string | null;
  tourName: string | null;
  createdAt: string;
}
export function knownFrom(
  card: { id: string; createdAt: string },
  cards: readonly (KnownFrom & { id: string })[],
  statuses: readonly CaseStatus[],
): KnownFrom | null {
  const earlier = cards
    .filter((c) => c.id !== card.id && c.createdAt < card.createdAt && (isClosedStatus(c.status, statuses) || PAID_KEYS.has(c.status)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!earlier) return null;
  return { caseNo: earlier.caseNo, status: earlier.status, closeReason: earlier.closeReason, tourName: earlier.tourName, createdAt: earlier.createdAt };
}

// ---------------------------------------------------------------- the customer
/** The customer number as the screens print it - bare since 21.10 (Alon: "להעיף את C לפני המספר לקוח"). */
export const customerLabel = (no: number | null | undefined): string => (no ? String(no) : "");
export const PHONES_MAX = 5;

/** A customer's phones as staff typed them: each 7+ digits, no two with the same key, at most 5, the main one first. */
export function cleanPhones(list: readonly string[]): { ok: true; phones: string[] } | { ok: false; error: string } {
  const phones: string[] = [];
  const keys = new Set<string>();
  for (const raw of list) {
    const phone = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!phone) continue;
    if (phone.replace(/\D/g, "").length < 7) return { ok: false, error: `"${phone}" is not a phone number.` };
    const key = phoneKey(phone) || phone.replace(/\D/g, "");
    if (keys.has(key)) continue;
    keys.add(key);
    phones.push(phone);
  }
  if (phones.length > PHONES_MAX) return { ok: false, error: `A customer can keep up to ${PHONES_MAX} phones.` };
  return { ok: true, phones };
}

/**
 * "Maybe the same customer": another customer with the same e-mail and no phone in common, that staff did not mark
 * as someone else. The same e-mail never joins by itself (a family shares one) - the rep merges or dismisses.
 */
export interface CustomerKey {
  id: string;
  email: string | null;
  phones: readonly string[];
  notSame: readonly string[];
}
export function sameEmailSuggestion(me: CustomerKey, others: readonly CustomerKey[]): string | null {
  const email = me.email?.trim().toLowerCase();
  if (!email) return null;
  const mine = new Set(me.phones.map(phoneKey).filter(Boolean));
  const found = others.find(
    (o) =>
      o.id !== me.id &&
      o.email?.trim().toLowerCase() === email &&
      !o.phones.some((p) => mine.has(phoneKey(p))) &&
      !me.notSame.includes(o.id) &&
      !o.notSame.includes(me.id),
  );
  return found?.id ?? null;
}

// ---------------------------------------------------------------- a future lead: a tour and a season
export const SEASON_MAX = 60;

/**
 * The seasons a future lead can name for a tour: the seasons its coming departures carry ("פסח 2027"), in date
 * order, then the tour's own seasons for this year and the next that no departure carries yet.
 */
export function seasonOptions(
  departures: readonly { season: string | null; seasonYear: number | null; startDate: string }[],
  tourSeasons: readonly string[],
  today: string,
): string[] {
  const out: string[] = [];
  const add = (label: string) => {
    if (!out.includes(label)) out.push(label);
  };
  [...departures]
    .filter((d) => d.season?.trim() && d.seasonYear && d.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .forEach((d) => add(`${d.season!.trim()} ${d.seasonYear}`));
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) for (const name of tourSeasons) if (name.trim()) add(`${name.trim()} ${y}`);
  return out;
}

/** "ליד עתידי" needs the tour and the season (Nir 19.10). Null = fine. */
export function checkFuture(packageId: string | null | undefined, season: string | null | undefined): string | null {
  if (!packageId) return "A future lead needs the tour it is for.";
  const s = (season ?? "").trim();
  if (!s) return "A future lead needs a season.";
  if (s.length > SEASON_MAX) return `A season can be up to ${SEASON_MAX} characters.`;
  return null;
}

/** The follow-up day has come and the case is still open. */
export function followUpDue(
  c: { followUpDate: string | null; status: string },
  statuses: readonly CaseStatus[],
  today: string,
): boolean {
  return !!c.followUpDate && c.followUpDate <= today && !isClosedStatus(c.status, statuses);
}

/**
 * Is a site booking's customer the case's own? A name differing only in case or spacing is the same
 * person ("tammy aharon" / "tammy Aharon" raised a false warning); a phone is compared by its key.
 * Nothing on one side to compare = no warning.
 */
export function sameCustomer(a: { name: string | null; phone: string | null }, b: { name: string | null; phone: string | null }): boolean {
  const norm = (name: string | null) => (name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const nameA = norm(a.name);
  const nameB = norm(b.name);
  if (nameA && nameB && nameA !== nameB) return false;
  const phoneA = phoneKey(a.phone);
  const phoneB = phoneKey(b.phone);
  return !(phoneA && phoneB && phoneA !== phoneB);
}

/**
 * How the table shows a case's follow-up day (the pill, the row tint) - the Mega Events
 * reservations' three states. Null = nothing to say: no day, a broken one, or a closed case.
 */
export function followUpTone(
  c: { followUpDate: string | null; status: string },
  statuses: readonly CaseStatus[],
  today: string,
): "overdue" | "today" | "upcoming" | null {
  if (!c.followUpDate || !/^\d{4}-\d{2}-\d{2}$/.test(c.followUpDate) || isClosedStatus(c.status, statuses)) return null;
  if (c.followUpDate < today) return "overdue";
  return c.followUpDate === today ? "today" : "upcoming";
}

// ---------------------------------------------------------------- people and pages
/** The key a site booking finds its lead by: the last 9 digits ("" when there are fewer). */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

/** "First Last Names" -> the first word / the rest (SQL twin in public.leads_fill). */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? "", last: words.slice(1).join(" ") };
}

/** The site's ?product_id= of the page a form was sent from. */
export function productIdOf(path: string | null | undefined): number | null {
  const match = /[?&]product_id=(\d{1,12})(?:[&#]|$)/.exec(path ?? "");
  return match ? Number(match[1]) : null;
}

/** The tour of a /package/<slug>/ page, decoded ("%D7%98..." -> "טיול"). */
export function packageSlugOf(path: string | null | undefined): string | null {
  const match = /^\/package\/([^/?#]+)/.exec(path ?? "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// ---------------------------------------------------------------- booking link
/** A booking holds 1 to 9 rooms (the site's own cap). */
export const LINK_ROOMS_MAX = 9;
/** The case's link token (`lr` on the site, `lead_ref` to tours.booking_create, which checks the same shape). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** The rooms of a link: only compositions the date prices, at most 9, in the order chosen. */
export function cleanRoomKeys(keys: readonly string[], offered: readonly string[]): string[] {
  return keys.filter((key) => offered.includes(key)).slice(0, LINK_ROOMS_MAX);
}

/** The tour page on the site: the WordPress path when the import kept one, else /package/<slug>/. */
export function packagePathOf(slug: string, dataPath: string | null | undefined): string {
  if (dataPath && /^\/[^/]/.test(dataPath)) return dataPath;
  return `/package/${encodeURIComponent(slug)}/`;
}

export function bookingLink(args: {
  siteUrl: string;
  packagePath: string;
  productId: number;
  rooms: readonly string[];
  token: string;
}): string {
  const base = args.siteUrl.replace(/\/+$/, "");
  const [path] = args.packagePath.split("?");
  const params = new URLSearchParams({ product_id: String(args.productId) });
  if (args.rooms.length) params.set("rooms", args.rooms.join(","));
  params.set("lr", args.token);
  return `${base}${path}?${params.toString()}`;
}

/** An Israeli number as wa.me wants it (972...), or null when it cannot be one. */
export function whatsappPhone(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/** Opens the rep's own WhatsApp on a chat with the customer, the text typed in (no API). */
export function waLink(phone: string | null | undefined, message: string): string | null {
  const number = whatsappPhone(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}

/**
 * Opens WhatsApp Desktop (or the phone's app) straight on the chat - no browser tab in between
 * (Alon 15.10: wa.me opened a new window every click). Same number rule as waLink.
 */
export function whatsappAppLink(phone: string | null | undefined, message: string): string | null {
  const number = whatsappPhone(phone);
  return number ? `whatsapp://send?phone=${number}&text=${encodeURIComponent(message)}` : null;
}

/** The message that goes with a booking link. */
export function linkMessage(firstName: string | null | undefined, tourName: string | null | undefined, url: string): string {
  const hello = firstName?.trim() ? `היי ${firstName.trim()},` : "היי,";
  const tour = tourName?.trim() ? ` ל${tourName.trim()}` : "";
  return `${hello} מצרפים קישור להזמנה${tour} עם ההרכב שדיברנו עליו. ממלאים את פרטי הנוסעים ושולחים: ${url}`;
}

// ---------------------------------------------------------------- the row
/** One row of the Reservations screen. */
export interface CaseRow {
  id: string;
  caseNo: number;
  createdAt: string;
  updatedAt: string | null;
  /** When the card last came to the rep: the newest joined inquiry, else createdAt (lib/tours/board.ts arrivalOf). */
  arrivedAt: string;
  type: CaseType;
  /** The form that opened it (lead, contact, advisor, booking, manual, ...). */
  kind: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  idNumber: string | null;
  accNum: string | null;
  notes: string | null;
  /** When the notes were last written (leads.notes_at, 21.10); null before the migration or for a note never written since. */
  notesAt: string | null;
  message: string | null;
  assignedTo: string | null;
  followUpDate: string | null;
  source: string;
  utm: Record<string, unknown>;
  sourcePath: string | null;
  departureId: string | null;
  departureCode: string | null;
  departureDate: string | null;
  packageId: string | null;
  tourName: string | null;
  /** The customer the card belongs to (20261019180000) - null before the migration. */
  customerId: string | null;
  customerNo: number | null;
  /** An inquiry with no tour from a customer with open cards: the rep files it. */
  toFile: boolean;
  /** A future lead's season ("פסח 2027"). */
  season: string | null;
  /** The newest site booking of the case. */
  bookingRef: string | null;
  bookingStatus: string | null;
  /** What the card payment answered while the card waits for its money (the rep confirms). */
  paymentAnswer: PaymentAnswer | null;
  confirmationPending: boolean;
  /** Travelers on the departure's seats (the sum of the case's sales rows). */
  travelers: number;
  /** Travelers of a settled booking that hold no seat (seatGap); 0 = nothing owed. */
  seatsMissing: number;
  /** Why the rep closed it (needsCloseReason); null while open. */
  closeReason: string | null;
  /** The customer's earlier case a site booking named (booking_create) - same rep, offered for a merge. */
  relatedCaseNo: number | null;
  /** The booking link prepared on the card (leads.offer) - the card's outside shortcut says where it stands. */
  offer?: CaseOffer | null;
}

export const caseName = (row: Pick<CaseRow, "firstName" | "lastName">): string =>
  [row.firstName, row.lastName].filter(Boolean).join(" ");

/** The screen's search: every word, in any order, over what the row shows. */
export const caseMatches = (row: CaseRow, q: string): boolean =>
  matchesSearch(
    q,
    row.caseNo,
    customerLabel(row.customerNo),
    // the C- label was printed until 21.10 - a hand still types it
    row.customerNo ? `C-${row.customerNo}` : null,
    caseName(row),
    row.phone,
    row.email,
    row.idNumber,
    row.accNum,
    row.bookingRef,
    row.tourName,
    row.departureCode,
    row.notes,
    row.message,
  );

// ---------------------------------------------------------------- what the actions answer
/** A member of the company's staff who can own a case. */
export interface CaseRep {
  id: string;
  name: string;
}

/** The Reservations screen in one load. */
export interface CasesPage {
  rows: CaseRow[];
  truncated: boolean;
  statuses: CaseStatus[];
  reps: CaseRep[];
  currentUserId: string;
}

/** A customer (public.customers, 20261019180000): the person, with every card under them. */
export interface CustomerInfo {
  id: string;
  customerNo: number;
  firstName: string | null;
  lastName: string | null;
  /** The main phone first. */
  phones: string[];
  email: string | null;
  idNumber: string | null;
  accNum: string | null;
  createdAt: string;
}
export const customerName = (c: Pick<CustomerInfo, "firstName" | "lastName">): string => [c.firstName, c.lastName].filter(Boolean).join(" ");

/** What a customer changes; a field left out is not touched. Names, e-mail, id and ACC are copied to every card. */
export interface CustomerChange {
  firstName?: string | null;
  lastName?: string | null;
  phones?: string[];
  email?: string | null;
  idNumber?: string | null;
  accNum?: string | null;
}

/** What a visitor typed on a site form - the name, phone and e-mail it was sent as. */
export interface InquirySender {
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Name words worth comparing: lower case, no accents or niqqud, no punctuation, two letters or more. */
const nameWords = (name: string | null | undefined): string[] =>
  (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-֑ͯ-ׇ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);

/**
 * A form joins a card by its PHONE alone, and anyone can type a phone. It was sent by someone else when the name
 * it carries shares no word with the card's name, or its e-mail is not the card's. Either side empty = nothing to
 * compare = not flagged (a form without a name is the common case).
 */
export function senderDiffers(sender: InquirySender | null, card: { name: string | null; email: string | null }): boolean {
  if (!sender) return false;
  const theirs = nameWords(sender.name);
  const ours = new Set(nameWords(card.name));
  if (theirs.length > 0 && ours.size > 0 && !theirs.some((w) => ours.has(w))) return true;
  const a = sender.email?.trim().toLowerCase();
  const b = card.email?.trim().toLowerCase();
  return !!a && !!b && a !== b;
}

/** A site form that joined a card (leads_fill): the customer came back on it. */
export interface CardInquiry {
  caseNo: number | null;
  at: string;
  kind: string;
  message: string | null;
  sourcePath: string | null;
  /** What the form was sent as; null when the entry carries none. */
  sentAs: InquirySender | null;
  /** sentAs is not the card's person (senderDiffers) - the rep checks before calling. */
  otherSender: boolean;
}
const textOf = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export function inquiriesOf(payload: Record<string, unknown>, card?: { name: string | null; email: string | null }): CardInquiry[] {
  const list = Array.isArray(payload.inquiries) ? payload.inquiries : [];
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
    .map((x) => {
      const sender = { name: textOf(x.name), phone: textOf(x.phone), email: textOf(x.email) };
      const sentAs = sender.name || sender.phone || sender.email ? sender : null;
      return {
        caseNo: typeof x.case_no === "number" ? x.case_no : null,
        at: typeof x.at === "string" ? x.at : "",
        kind: typeof x.kind === "string" ? x.kind : "",
        message: typeof x.message === "string" && x.message.trim() ? x.message : null,
        sourcePath: typeof x.source_path === "string" ? x.source_path : null,
        sentAs,
        otherSender: card ? senderDiffers(sentAs, card) : false,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** One order: a site booking (its T number) or an order a rep typed (a seat row with its T number). */
export interface BoardOrder {
  ref: string;
  source: "site" | "staff";
  cardId: string;
  /** The booking's own status; "staff" for a typed order. */
  status: string;
  phase: BookingPhase;
  departureCode: string | null;
  departureDate: string | null;
  travelers: number;
  total: number | null;
  currency: string | null;
  /** A closed booking's travelers hold their seats, or not (owedSeatRefs); null = nothing settled to hold. */
  seats: "held" | "missing" | null;
  createdAt: string;
}

/** The Reservations board (TODAY / RESERVATIONS / LEADS / ALL) in one load. */
export interface BoardPage {
  cards: CaseRow[];
  orders: BoardOrder[];
  truncated: boolean;
  statuses: CaseStatus[];
  reps: CaseRep[];
  currentUserId: string;
}

/** A customer's page in one load: the person and every card, the card to open first. */
export interface CustomerPageData {
  customer: CustomerInfo;
  cards: CaseRow[];
  orders: BoardOrder[];
  /** What each card should know about the customer's earlier deals, by card id. */
  known: Record<string, KnownFrom>;
  /** Another customer with the same e-mail and no phone in common (sameEmailSuggestion). */
  suggestion: { id: string; customerNo: number; name: string; phones: string[]; email: string | null } | null;
  openCardId: string | null;
  statuses: CaseStatus[];
  reps: CaseRep[];
  currentUserId: string;
}

/** A customer as the merge / move pickers show it. */
export interface CustomerCandidate {
  id: string;
  customerNo: number;
  name: string;
  phones: string[];
  email: string | null;
  cards: number;
}

/** A tour a future lead can name, with its seasons (seasonOptions). */
export interface FutureTour {
  id: string;
  name: string;
  seasons: string[];
}

/** What staff change on a case; a field left out is not touched. */
export interface CaseChange {
  status?: string;
  /** Required with a status that needsCloseReason. */
  closeReason?: string;
  assignedTo?: string | null;
  followUpDate?: string | null;
  notes?: string;
  accNum?: string | null;
  idNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  type?: CaseType;
  departureId?: string | null;
  /** The tour without a date (a future lead names the tour and a season). */
  packageId?: string | null;
  season?: string | null;
  source?: CaseSource;
}

/** A case staff open by hand (a call, a walk-in). A reservation needs a departure and travelers. */
export interface NewCaseInput {
  type: CaseType;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  idNumber?: string | null;
  source: CaseSource;
  departureId?: string | null;
  travelers?: number | null;
  assignedTo?: string | null;
  notes?: string | null;
  followUpDate?: string | null;
  /** A card for a customer that exists ("+ New card" on the customer page): the contact comes from the customer. */
  customerId?: string | null;
}

export interface CaseHistoryItem {
  at: string;
  actor: string | null;
  action: string;
  changes: Record<string, unknown>;
}

export interface CaseGift {
  label: string;
  validUntil: string | null;
}

/** The case page in one load. */
export interface CaseDetail {
  row: CaseRow;
  /** The form's other fields. */
  payload: Record<string, unknown>;
  bookings: BookingRow[];
  sales: ToursReservationRow[];
  departure: { id: string; code: string; startDate: string; endDate: string; siteId: number; isPublished: boolean } | null;
  pkg: { id: string; name: string; path: string; cancellationHtml: string | null } | null;
  gifts: CaseGift[];
  history: CaseHistoryItem[];
  statuses: CaseStatus[];
  reps: CaseRep[];
  currentUserId: string;
  siteUrl: string | null;
  linkSentAt: string | null;
  /** The customer's earlier case (relatedCaseOf), with what the merge dialog shows of it. */
  relatedCase: CaseCandidate | null;
  /** The company can send from its own WhatsApp number (Cloud API configured). */
  whatsappApi: boolean;
  /** The booking link prepared for the customer (leads.offer), sent or not yet. */
  offer: CaseOffer | null;
  /** Site forms that joined this card - the customer came back on it. */
  inquiries: CardInquiry[];
  /** The customer's earlier deal (closed or paid) this card should know about. */
  known: KnownFrom | null;
  /** The tour's cancellation fee rules (tours.cancellation_rules) - each order reads its fee as of today from them. */
  cancellationRules: CancellationRule[];
}

/** A case another one may be merged with - what the picker shows. */
export interface CaseCandidate {
  id: string;
  caseNo: number;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  type: CaseType;
  createdAt: string;
  bookingRefs: string[];
  /** Why it is offered: same phone / e-mail as this case. */
  samePerson: boolean;
}

/** A departure a booking link can point at, with the rooms its price table prices. */
export interface LinkDeparture {
  id: string;
  code: string;
  startDate: string;
  tourName: string | null;
  siteId: number;
  packagePath: string;
  rooms: { key: string; title: string }[];
}

/** A prepared offer and the ways to send it. It counts as sent only through markOfferSent. */
export interface BookingLinkResult {
  offer: CaseOffer;
  message: string;
  /** wa.me - WhatsApp Web / the phone. */
  whatsapp: string | null;
  /** whatsapp:// - the rep's WhatsApp Desktop, no browser tab. */
  whatsappApp: string | null;
  mailto: string | null;
}

/** What the site charges for a choice of rooms on a date (tours.booking_quote), for the link card. */
export interface LinkQuote {
  currency: string;
  lines: { key: string; title: string; price: number; discount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  /** The site would refuse a booking now: sold out, not enough seats... (null = bookable). */
  reason: string | null;
}

/**
 * Staff-written HTML (a tour's cancellation terms) as plain text with its line
 * breaks: scripts and styles dropped with their content, every other tag
 * stripped, the common entities decoded. The case page prints text, never HTML.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * A page of the company's own site from a path a VISITOR sent (a form's page,
 * the landing page): the absolute link when the path is site-relative and the
 * result stays on the site's origin, else null (print it as text, no link).
 */
export function siteHref(siteUrl: string | null | undefined, path: string | null | undefined): string | null {
  // "/x" only - not "//host" nor "/\host", which a browser reads as another host
  if (!siteUrl || !path || !/^\/(?![/\\])/.test(path)) return null;
  try {
    const base = new URL(siteUrl);
    const target = new URL(path, base);
    return target.origin === base.origin ? target.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- a customer's orders
export type BookingPhase = "active" | "past" | "cancelled";
export const BOOKING_PHASE_LABELS: Record<BookingPhase, string> = { active: "Active", past: "Past", cancelled: "Cancelled" };

/** Where one order of the customer stands: cancelled (or a card payment that failed), past (the trip left), else active. */
export function bookingPhase(b: { status: string; departureStart: string | null }, today: string): BookingPhase {
  if (b.status === "cancelled" || b.status === "failed") return "cancelled";
  if (b.departureStart && b.departureStart < today) return "past";
  return "active";
}

export interface TravelerGroup {
  ref: string;
  names: string[];
  passengers: { first: string; last: string; type: string }[];
}

/** Every traveler the customer sent, per live order, newest first - rows with no name dropped. */
export function travelerGroups(
  bookings: readonly { ref: string; status: string; passengers: readonly { first: string; last: string; type: string }[] }[],
): TravelerGroup[] {
  return bookings
    .filter((b) => b.status !== "cancelled" && b.status !== "failed")
    .map((b) => {
      const passengers = b.passengers.filter((p) => `${p.first ?? ""}${p.last ?? ""}`.trim() !== "");
      return {
        ref: b.ref,
        passengers,
        names: passengers.map((p) => [p.first, p.last].map((s) => (s ?? "").trim()).filter(Boolean).join(" ")),
      };
    })
    .filter((g) => g.passengers.length > 0);
}

/** A form field as one line: a waiting list's date by its label, anything else as text. */
export function payloadText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && !Array.isArray(value) && typeof (value as { label?: unknown }).label === "string") {
    return (value as { label: string }).label;
  }
  return JSON.stringify(value);
}

/** Booking states that mean money taken or on the way: a case holding one is never deleted (it would vanish with it). */
const LIVE_PAYMENT_STATES = new Set(["pending_payment", "review", "paid"]);
export const bookingBlocksDelete = (status: string): boolean => LIVE_PAYMENT_STATES.has(status);

/** "Send the confirmation" while ANY paid booking of the case has not had it - not only the newest. */
export const confirmationPendingOf = (bookings: readonly { status: string; confirmationSentAt: string | null }[]): boolean =>
  bookings.some((b) => b.status === "paid" && !b.confirmationSentAt);

// ---------------------------------------------------------------- seats a settled deal still owes
/**
 * Seats are put on the departure by a card payment, by "Check payment" -> Paid, and (since 15.10) by a
 * booking or a case closed by hand (holdOwedSeats). These rules say what a closed deal still owes.
 */
export interface SeatBooking {
  ref: string;
  status: string;
  departureId: string;
  travelers: number;
  /** "request" | "card". */
  kind: string;
  createdAt: string;
  /** The seat row that holds this booking's travelers (tours.bookings.sales_entry_id). */
  salesEntryId: string | null;
}
/** One row of the case's seat ledger: +travelers booked, -travelers given back. `id` ties it to a booking. */
export interface SeatHold {
  id?: string;
  departureId: string;
  pax: number;
}
/** One closed booking whose travelers are not all on the departure. */
export interface SeatOwed {
  ref: string;
  departureId: string;
  travelers: number;
  missing: number;
  /** The whole booking is owed: its new seat row is tied to it (sales_entry_id). */
  link: boolean;
}
/** What a closed deal still owes: the booking furthest short is named, `missing` is the total. */
export interface SeatGap {
  ref: string;
  departureId: string;
  travelers: number;
  missing: number;
  owed: SeatOwed[];
}

/** A booking's travelers = adults + children; seniors are adults with a discount (SQL: b.adults + b.children). */
export const seatBookingOf = (b: {
  ref: string;
  status: string;
  departureId: string;
  adults: number;
  children: number;
  kind: string;
  createdAt: string;
  salesEntryId: string | null;
}): SeatBooking => ({
  ref: b.ref,
  status: b.status,
  departureId: b.departureId,
  travelers: b.adults + b.children,
  kind: b.kind,
  createdAt: b.createdAt,
  salesEntryId: b.salesEntryId,
});

/** The deal is closed: the case says so (a deposit too), or one of its bookings does. */
const SETTLED = new Set(["paid", "done", "deposit_paid"]);
/** A booking that holds no one: cancelled, or a card payment that failed. */
const DEAD_BOOKING = new Set(["cancelled", "failed"]);

/**
 * The seats a closed deal still owes the departure, or null. Settled = a booking Done or Paid; or the case
 * Paid / Done, which then owes its newest booking. A cancelled or failed booking owes nothing, nor a case in
 * a closed status other than Done (cancelled, not relevant, spam, a closed status of the company's own).
 * EACH settled booking owes its own travelers (Alon 18.10 - five bookings are five parties), unless:
 *  - its own seat row is live (`salesEntryId`), or
 *  - it is a request and a PAID card payment for the same departure, sent after it, holds seats - the
 *    customer asked, then paid: one party, held once.
 * Seat rows of no live booking (added by hand, "Hold N seats", a cancellation's minus) cover what is owed,
 * oldest booking first, on the same departure first and then anywhere (a customer moved to another date).
 */
export function seatGap(
  status: string,
  statuses: readonly CaseStatus[],
  bookings: readonly SeatBooking[],
  sales: readonly SeatHold[],
): SeatGap | null {
  if (status !== "done" && isClosedStatus(status, statuses)) return null;
  const live = bookings.filter((b) => !DEAD_BOOKING.has(b.status) && b.travelers > 0);
  let settled = live.filter((b) => SETTLED.has(b.status));
  if (settled.length === 0 && SETTLED.has(status)) settled = live.slice(0, 1);
  if (settled.length === 0) return null;

  const liveRows = new Set(sales.map((s) => s.id).filter((id): id is string => !!id));
  const holds = (b: SeatBooking) => !!b.salesEntryId && liveRows.has(b.salesEntryId);
  const coveredByCard = (b: SeatBooking) =>
    b.kind !== "card" &&
    settled.some((c) => c !== b && c.kind === "card" && c.status === "paid" && holds(c) && c.departureId === b.departureId && c.createdAt > b.createdAt);
  const owed = settled
    .filter((b) => !holds(b) && !coveredByCard(b))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (owed.length === 0) return null;

  // rows that belong to no live booking are the case's free seats
  const bound = new Set(live.map((b) => b.salesEntryId).filter((id): id is string => !!id));
  const pool = new Map<string, number>();
  for (const s of sales) {
    if (s.id && bound.has(s.id)) continue;
    pool.set(s.departureId, (pool.get(s.departureId) ?? 0) + s.pax);
  }
  const rows: SeatOwed[] = owed.map((b) => {
    const here = Math.max(0, pool.get(b.departureId) ?? 0);
    const take = Math.min(b.travelers, here);
    pool.set(b.departureId, (pool.get(b.departureId) ?? 0) - take);
    return { ref: b.ref, departureId: b.departureId, travelers: b.travelers, missing: b.travelers - take, link: false };
  });
  let anywhere = [...pool.values()].reduce((sum, n) => sum + Math.max(0, n), 0);
  for (const r of rows) {
    const take = Math.min(r.missing, anywhere);
    r.missing -= take;
    anywhere -= take;
    r.link = r.missing === r.travelers;
  }
  const short = rows.filter((r) => r.missing > 0);
  if (short.length === 0) return null;
  const worst = short.reduce((a, b) => (b.missing > a.missing ? b : a));
  return {
    ref: worst.ref,
    departureId: worst.departureId,
    travelers: worst.travelers,
    missing: short.reduce((sum, r) => sum + r.missing, 0),
    owed: short,
  };
}

/**
 * The orders whose travelers hold no seat, read off the bookings alone - what each order's chip says. A closed case
 * keeps quiet about its gap (seatGap answers null), but its orders still tell the truth: case #1016 was set "not
 * relevant" over two Done bookings and both read "Seats held" on 7 travelers and 5 seats (18.10). "new" is neither
 * closed nor settled, so only the bookings' own statuses count.
 */
export function owedSeatRefs(statuses: readonly CaseStatus[], bookings: readonly SeatBooking[], sales: readonly SeatHold[]): Set<string> {
  return new Set(seatGap("new", statuses, bookings, sales)?.owed.map((o) => o.ref) ?? []);
}

// ---------------------------------------------------------------- closing a case that holds a booking
/**
 * A case whose booking is live cannot be closed as "not relevant" (or any closed status of the company's
 * own) - the booking is set Cancelled first (Alon 18.10). Done, Cancelled and Spam close it as they are.
 * Answers the blocking booking's ref, or null.
 */
export function closeBlockedBy(status: string, statuses: readonly CaseStatus[], bookings: readonly { ref: string; status: string }[]): string | null {
  if (!needsCloseReason(status, statuses) || status === "cancelled") return null;
  return bookings.find((b) => !DEAD_BOOKING.has(b.status))?.ref ?? null;
}

// ---------------------------------------------------------------- the offer a case was sent (Alon 18.10)
export const OFFER_CHANNELS = ["whatsapp", "whatsapp_api", "email"] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];
export const OFFER_CHANNEL_LABELS: Record<OfferChannel, string> = {
  whatsapp: "WhatsApp",
  whatsapp_api: "WhatsApp (company number)",
  email: "E-mail",
};
export const isOfferChannel = (value: unknown): value is OfferChannel => OFFER_CHANNELS.includes(value as OfferChannel);

/**
 * leads.offer: the booking link the rep prepared for the customer. It counts as sent only once it went out
 * on WhatsApp or e-mail - copying it is not sending (Alon: "force me to send it").
 */
export interface CaseOffer {
  departureId: string;
  departureCode: string;
  startDate: string;
  tourName: string | null;
  rooms: string[];
  roomTitles: string[];
  /** What the site charges for these rooms on this date (tours.booking_quote), discounts included. */
  total: number | null;
  currency: string | null;
  url: string;
  followUpDate: string;
  createdAt: string;
  sentAt: string | null;
  sentVia: OfferChannel | null;
  /** The site booking that came through this offer's link (booking_create). */
  bookingRef: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function parseOffer(value: unknown): CaseOffer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const departureId = str(o.departureId);
  const url = str(o.url);
  if (!departureId || !url || !Array.isArray(o.rooms) || !o.rooms.every((r) => typeof r === "string")) return null;
  const sentVia = isOfferChannel(o.sentVia) ? o.sentVia : null;
  return {
    departureId,
    departureCode: str(o.departureCode) ?? "",
    startDate: str(o.startDate) ?? "",
    tourName: str(o.tourName),
    rooms: o.rooms as string[],
    roomTitles: Array.isArray(o.roomTitles) ? o.roomTitles.filter((t): t is string => typeof t === "string") : [],
    total: typeof o.total === "number" && Number.isFinite(o.total) ? o.total : null,
    currency: str(o.currency),
    url,
    followUpDate: str(o.followUpDate) ?? "",
    createdAt: str(o.createdAt) ?? "",
    sentAt: sentVia ? str(o.sentAt) : null,
    sentVia,
    bookingRef: str(o.bookingRef),
  };
}

export const offerSent = (offer: CaseOffer | null): boolean => !!offer?.sentAt && !!offer.sentVia;
