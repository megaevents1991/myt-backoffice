// The review board's words and pure rules (/uploader/[id], spec §5.3 / §11) - no JSX, no I/O.
// Every component of the board reads its wording and its "may this card do X" answers from here,
// so two cards can never word or judge the same thing two ways. A server action's `kind` in Hebrew
// is the screen-wide `actionErrorText` (../copy.ts).
import type { SubjectArt } from "@/lib/uploader/action-types";
import { siteCardPrice, type SiteCardPriceEvent } from "@/lib/package-price";
import { canRebuildTwoCity, REJECTABLE_STATUSES } from "@/lib/uploader/run-rules";
import { farVenueOffer } from "@/lib/uploader/warnings";
import type { ItemStatus, UploaderItem } from "@/types/uploader.types";
import { actionErrorText } from "../copy";

export type BusyKind = "approve" | "reject" | "answer" | "retry" | "rebuild";

/** Every ITEM_STATUSES value as the card's pill says it - a status added to the type fails to compile here. */
export const ITEM_STATUS_HE: Record<ItemStatus, string> = {
  found: "ממתין לבנייה",
  building: "בבנייה",
  question: "שאלה חוסמת",
  ready: "מוכן",
  approved: "באתר ✓",
  skipped: "דולג",
  rejected: "נדחה",
  error: "שגיאה",
};

/** Why a show was not built (`uploader_items.skip_reason`); an unknown reason prints as stored. */
export const SKIP_REASON_HE: Record<string, string> = {
  no_tickets: "אין כרטיסים למכירה",
  no_location: "אין לוקיישן",
  exists: "כבר קיים באתר",
  rejected_before: "נדחה בעבר",
  skipped_by_answer: "דולג לפי תשובה",
};

/** Subject-level warning codes and their short chip text in the header (mockup: "cut-out ✗"). */
export const SUBJECT_WARNING_CHIP: Record<string, string> = {
  no_artist_page: "אין עמוד אמן",
  no_team_page: "אין עמוד קבוצה",
  no_cutout: "cut-out ✗",
  no_event_gallery: "גלריית אירועים ✗",
  no_crest: "סמל ✗",
  no_bio: "ביוגרפיה ✗",
};

/** "2027-05-20" -> "20.05.2027" (the show's calendar day as the supplier prints it - no time zone). */
export function showDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** A timestamp in Israel time, "21.10.2026, 14:22". */
export function stampHe(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "לונדון 20.05" - how a toast names one show. */
export function showLabel(item: UploaderItem): string {
  return `${item.show.city || item.show.venue || item.show.name_english} ${showDate(item.show.date).slice(0, 5)}`;
}

export const isRejectable = (item: UploaderItem): boolean => REJECTABLE_STATUSES.includes(item.status);
export const isApprovable = (item: UploaderItem): boolean => item.status === "ready" && (item.blockers ?? []).length === 0;

/** The far-venue offer the card may make: the item's nearest location, when the rule lets it rebuild two-city. */
export function farVenueTarget(item: UploaderItem): { id: number; text: string } | null {
  if (!item.location || !canRebuildTwoCity(item)) return null;
  const offered = (item.warnings ?? []).some((w) => w.code === "far_venue") || item.location.far;
  return offered ? { id: item.location.id, text: farVenueOffer(item.location.name, item.location.km) } : null;
}

// ---- the built event, read off the stored payload --------------------------------------------------

type PayloadTicket = { supplier?: unknown };

function payloadTickets(item: UploaderItem): PayloadTicket[] | null {
  const t = item.payload?.tickets_and_rates;
  return Array.isArray(t) ? (t as PayloadTicket[]) : null;
}

/** "החל מ-$X" of the built event - main's card rule over the row the builder wrote; null before it is built. */
export function builtPrice(item: UploaderItem): number | null {
  if (!item.payload || payloadTickets(item) === null) return null;
  // The payload IS the created `events` row (minus volatile columns) - the shape siteCardPrice reads.
  const price = siteCardPrice(item.payload as unknown as SiteCardPriceEvent);
  return price !== null && Number.isFinite(price) ? price : null;
}

const positiveId = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * The event an `exists` skip points at - only from structured data (the item's payload, or an
 * `event_id` field a `duplicate_dropped` decision carries). Never read out of the decision's text.
 */
export function existingEventId(item: UploaderItem): number | null {
  const fromPayload = positiveId(item.payload?.id);
  if (fromPayload !== null) return fromPayload;
  const line = (item.decisions ?? []).find((d) => d.code === "duplicate_dropped") as { event_id?: unknown } | undefined;
  return positiveId(line?.event_id);
}

/** A `rejected_before` skip's own line ("נדחתה בריצה #n על ידי X: <reason>") - the decision that carries them, else null. */
export function rejectedBeforeLine(item: UploaderItem): string | null {
  const line = (item.decisions ?? []).find((d) => d.code === "rejected_before");
  return line?.text?.trim() || null;
}

/**
 * The creative's subject on an approved card (spec §11): an artist's cut-out, or the flat photo
 * the creative falls back to when the build warned `no_cutout`; a team's crest. null = not known
 * (a competition, or a subject with no row).
 */
export function creativeSubject(item: UploaderItem, art: SubjectArt): string | null {
  if (!art) return null;
  if (art.kind === "team") return "סמל";
  return (item.warnings ?? []).some((w) => w.code === "no_cutout") ? "תמונה שטוחה" : "cut-out ✓";
}

export function creativeLine(item: UploaderItem, art: SubjectArt): string {
  const subject = creativeSubject(item, art);
  return `קריאייטיב: ייצור בשעה הקרובה${subject ? ` · נושא: ${subject}` : ""}`;
}

export type SupplierChip = { key: string; label: string; count: number | null; on: boolean; title: string };

/**
 * TixStock / LiveTickets as the card shows them: once built, the categories the event carries from
 * each; before that, what the supplier's catalog row says. A supplier the show does not have, or one
 * the build attached nothing from, is off ("✗").
 */
export function supplierChips(item: UploaderItem): SupplierChip[] {
  const tickets = payloadTickets(item);
  const of = (supplier: string): number => (tickets ?? []).filter((t) => t.supplier === supplier).length;
  const tix = item.show.suppliers?.tixstock ?? null;
  const live = item.show.suppliers?.livetickets ?? null;
  const built = tickets !== null;
  const tixCount = built ? of("tixstock") : (tix?.ticket_count ?? null);
  const liveCount = built ? of("livetickets") : (live?.sellable ?? null);
  return [
    {
      key: "tix",
      label: "Tix",
      count: tixCount,
      on: tix !== null && !(built && tixCount === 0),
      title: tix === null ? "TixStock לא מוכר את ההופעה" : built ? "קטגוריות TixStock באירוע" : "כרטיסים בקטלוג של TixStock",
    },
    {
      key: "live",
      label: "Live",
      count: liveCount,
      on: live !== null && !(built && liveCount === 0),
      title: live === null ? "LiveTickets לא מוכר את ההופעה" : built ? "קטגוריות LiveTickets באירוע" : "קטגוריות למכירה בקטלוג של LiveTickets",
    },
  ];
}

/** "Tix 11", "Live ✗", or just "Tix" when no count is known - never a trailing blank. */
export function supplierChipText(c: SupplierChip): string {
  if (!c.on) return `${c.label} ✗`;
  return c.count === null ? c.label : `${c.label} ${c.count}`;
}

// ---- counts and filters --------------------------------------------------------------------------------

export type BoardCounts = {
  total: number;
  found: number;
  building: number;
  question: number;
  ready: number;
  /** Ready with no blocker - what "אשר הכל" approves. */
  approvable: number;
  approved: number;
  skipped: number;
  rejected: number;
  error: number;
  /** Not decided yet and carrying a warning or a blocker. */
  attention: number;
  /** Hidden events the run created (built, whatever happened to them since). */
  built: number;
  packages: number;
  ticketOnly: number;
};

/** The item statuses `countItems` tallies one by one (all of ITEM_STATUSES). */
const TALLIED: Record<ItemStatus, true> = {
  found: true,
  building: true,
  question: true,
  ready: true,
  approved: true,
  skipped: true,
  rejected: true,
  error: true,
};

export const needsAttention = (i: UploaderItem): boolean =>
  i.status !== "approved" && i.status !== "rejected" && ((i.warnings ?? []).length > 0 || (i.blockers ?? []).length > 0);

export function countItems(items: UploaderItem[]): BoardCounts {
  const c: BoardCounts = {
    total: items.length,
    found: 0,
    building: 0,
    question: 0,
    ready: 0,
    approvable: 0,
    approved: 0,
    skipped: 0,
    rejected: 0,
    error: 0,
    attention: 0,
    built: 0,
    packages: 0,
    ticketOnly: 0,
  };
  for (const i of items) {
    // A status this build does not know counts in `total` only.
    if (Object.prototype.hasOwnProperty.call(TALLIED, i.status)) c[i.status] += 1;
    if (isApprovable(i)) c.approvable += 1;
    if (needsAttention(i)) c.attention += 1;
    if (i.status === "ready" || i.status === "approved") {
      c.built += 1;
      if (i.mode === "package") c.packages += 1;
      if (i.mode === "ticket_only") c.ticketOnly += 1;
    }
  }
  return c;
}

export const FILTERS = ["all", "questions", "ready", "attention", "approved", "skipped", "rejected", "errors"] as const;
export type Filter = (typeof FILTERS)[number];

export const FILTER_HE: Record<Filter, string> = {
  all: "הכל",
  questions: "שאלות",
  ready: "מוכנים",
  attention: "דורשים תשומת לב",
  approved: "אושרו",
  skipped: "דולגו",
  rejected: "נדחו",
  errors: "שגיאות",
};

export function inFilter(filter: Filter, item: UploaderItem): boolean {
  switch (filter) {
    case "all":
      return true;
    case "questions":
      return item.status === "question";
    case "ready":
      return item.status === "ready";
    case "attention":
      return needsAttention(item);
    case "approved":
      return item.status === "approved";
    case "skipped":
      return item.status === "skipped";
    case "rejected":
      return item.status === "rejected";
    case "errors":
      return item.status === "error";
  }
}

export function filterCount(filter: Filter, c: BoardCounts): number {
  switch (filter) {
    case "all":
      return c.total;
    case "questions":
      return c.question;
    case "ready":
      return c.ready;
    case "attention":
      return c.attention;
    case "approved":
      return c.approved;
    case "skipped":
      return c.skipped;
    case "rejected":
      return c.rejected;
    case "errors":
      return c.error;
  }
}

// ---- reading the run --------------------------------------------------------------------------------------

const LOAD_ERROR_HE: Record<string, string> = {
  not_found: "הריצה לא נמצאה - ייתכן שנמחקה",
  network: "אין חיבור לשרת - ננסה שוב בעוד רגע",
  db_error: "קריאת הריצה נכשלה - ננסה שוב בעוד רגע",
};

/** Why the board could not read its run (a `getRun` failure, or no answer at all). */
export const loadErrorText = (kind: string): string => LOAD_ERROR_HE[kind] ?? actionErrorText(kind);

export const NETWORK_TEXT = "אין חיבור לשרת - נסו שוב";
