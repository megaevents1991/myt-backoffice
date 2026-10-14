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
export const STATUS_COLORS = ["blue", "slate", "amber", "violet", "orange", "red", "rose", "teal", "green", "gray"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];
/** The tag of a status on the screens - one class set per colour, light and dark. */
export const STATUS_COLOR_CLASSES: Record<StatusColor, string> = {
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
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

export const SYSTEM_STATUS_KEYS = ["new", "pending_payment", "payment_failed", "payment_review", "paid", "cancelled", "spam"] as const;
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

/** The list every tours company starts with - the migration seeds the same rows. */
export const DEFAULT_STATUSES: CaseStatus[] = [
  st("new", "חדש", "blue"),
  st("no_answer", "אין מענה", "slate"),
  st("in_progress", "בטיפול", "amber"),
  st("follow_up", "פולו אפ", "violet"),
  st("pending_payment", "ממתין לתשלום", "orange"),
  st("payment_failed", "תשלום נכשל", "red"),
  st("payment_review", "בדיקת תשלום", "rose"),
  st("paid", "שולם", "teal"),
  st("done", "נסגר", "green", true),
  st("not_relevant", "לא רלוונטי", "gray", true),
  st("cancelled", "בוטל", "gray", true),
  st("spam", "ספאם", "gray", true),
];

export const STATUS_MAX = 30;
export const STATUS_LABEL_MAX = 40;

export const statusOf = (key: string, statuses: readonly CaseStatus[]): CaseStatus | undefined =>
  statuses.find((s) => s.key === key);

export function isClosedStatus(key: string, statuses: readonly CaseStatus[]): boolean {
  const found = statusOf(key, statuses);
  return found ? found.isClosed : DEFAULT_CLOSED_KEYS.has(key);
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

// ---------------------------------------------------------------- TASK
export const CASE_TASKS = [
  "payment_check",
  "follow_up",
  "payment_chase",
  "new_order",
  "service_call",
  "new_lead",
  "send_confirmation",
] as const;
export type CaseTask = (typeof CASE_TASKS)[number];
export const CASE_TASK_LABELS: Record<CaseTask, string> = {
  payment_check: "בדיקת תשלום",
  follow_up: "פולו אפ",
  payment_chase: "השלמת תשלום",
  new_order: "טיפול בהזמנה חדשה",
  service_call: "שיחת שירות חדשה",
  new_lead: "טיפול בליד",
  send_confirmation: "שליחת אישור",
};
export const isCaseTask = (value: unknown): value is CaseTask => CASE_TASKS.includes(value as CaseTask);

/** Forms that ask for service, not for a trip. */
const SERVICE_KINDS = new Set(["contact", "cancellation"]);

/** What the TASK is read from. */
export interface TaskFacts {
  type: string;
  kind: string;
  status: string;
  followUpDate: string | null;
  taskOverride: string | null;
  /** A paid site booking whose confirmation was not sent yet. */
  confirmationPending: boolean;
}

/** The follow-up day has come and the case is still open. */
export function followUpDue(
  c: { followUpDate: string | null; status: string },
  statuses: readonly CaseStatus[],
  today: string,
): boolean {
  return !!c.followUpDate && c.followUpDate <= today && !isClosedStatus(c.status, statuses);
}

/** What has to happen on the case now (spec section 4). First match wins; a rep's override beats them all. */
export function caseTask(c: TaskFacts, statuses: readonly CaseStatus[], today: string): CaseTask | null {
  if (isCaseTask(c.taskOverride)) return c.taskOverride;
  if (isClosedStatus(c.status, statuses)) return null;
  if (c.status === "payment_review") return "payment_check";
  if (followUpDue(c, statuses, today)) return "follow_up";
  if (c.status === "pending_payment" || c.status === "payment_failed") return "payment_chase";
  if (c.status === "new") {
    if (c.type === "reservation") return "new_order";
    if (SERVICE_KINDS.has(c.kind)) return "service_call";
    if (c.type === "lead") return "new_lead";
    return null;
  }
  if (c.status === "paid" && c.confirmationPending) return "send_confirmation";
  return null;
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
  taskOverride: string | null;
  /** The newest site booking of the case. */
  bookingRef: string | null;
  bookingStatus: string | null;
  confirmationPending: boolean;
  /** Travelers on the departure's seats (the sum of the case's sales rows). */
  travelers: number;
}

export const caseName = (row: Pick<CaseRow, "firstName" | "lastName">): string =>
  [row.firstName, row.lastName].filter(Boolean).join(" ");

/** The screen's search: every word, in any order, over what the row shows. */
export const caseMatches = (row: CaseRow, q: string): boolean =>
  matchesSearch(
    q,
    row.caseNo,
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

/** What staff change on a case; a field left out is not touched. */
export interface CaseChange {
  status?: string;
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
  taskOverride?: string | null;
  departureId?: string | null;
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

export interface BookingLinkResult {
  url: string;
  whatsapp: string | null;
  mailto: string | null;
  message: string;
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
