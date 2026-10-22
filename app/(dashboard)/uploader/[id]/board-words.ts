// The review board's words and pure rules (/uploader/[id], spec §5.3 / §11) - no JSX, no I/O.
// Every component of the board reads its wording and its "may this card do X" answers from here,
// so two cards can never word or judge the same thing two ways. A server action's `kind` in Hebrew
// is the screen-wide `actionErrorText` (../copy.ts).
import type { SubjectArt } from "@/lib/uploader/action-types";
import { siteCardPrice, type SiteCardPriceEvent } from "@/lib/package-price";
import { iso } from "@/lib/uploader/run-panel";
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
 * the creative falls back to when the build warned `no_cutout`, or "בלי תמונה" when the artist has
 * no picture at all (`image_url` null - neither a cut-out nor a photo); a team's crest. null = not
 * known (a competition, or a subject with no row).
 */
export function creativeSubject(item: UploaderItem, art: SubjectArt): string | null {
  if (!art) return null;
  if (art.kind === "team") return "סמל";
  if (art.image_url === null) return "בלי תמונה";
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

// ---- round "אלון 1": the run panel, the two dialogs, learn-from-event, a rule for the run (spec 5.1-5.5) ----

/** "N הופעות", "הופעה אחת" for one. */
const showsHe = (n: number): string => (n === 1 ? "הופעה אחת" : `${n} הופעות`);

// The run panel (5.1).
export const PANEL_TITLE = "לטיפול ברמת הריצה";
export const PANEL_TOPICS = (n: number): string => (n === 1 ? "נושא אחד" : `${n} נושאים`);
export const PANEL_COLLAPSE = "קפל";
export const PANEL_EXPAND = "הצג";
export const BTN_CLASSIFY = "סווג כרטיסים";
export const BTN_LEARN_APPLY = "החל על שאר ההופעות";
export const BTN_NAMES = "תן שמות בעברית";
export const BTN_OPEN_TEMPLATES = "פתח ב-Templates";
/** Under a venue row with several events arranged by hand: the other ones, each offered as a source too. */
export const PANEL_OTHER_FIXED = "נערכו בעורך גם:";
export const PANEL_COUNT_TITLE = "הופעות שהנושא נוגע בהן";
/** The grey line a card folds its run-level warnings into (a button to the panel). */
export const FOLD_LINE = (n: number): string => (n === 1 ? "הערה אחת ברמת הריצה - בפאנל למעלה" : `${n} הערות ברמת הריצה - בפאנל למעלה`);

// Both dialogs: the proposal, and what is said when the AI gave none.
export const AI_WAIT = "ה-AI מציע…";
export const AI_OFF_LINE = "ה-AI כבוי / לא ענה - מלאו את השמות ידנית";
export const AI_RATE_LINE = "יותר מדי קריאות ל-AI בזמן קצר - מלאו את השמות ידנית";
/** The line above a dialog's table when the AI did not propose (`ai.reason`); null = nothing to say (it proposed, or nothing needed proposing). */
export function aiLine(ai: { used: boolean; reason: string | null }): string | null {
  if (ai.used || ai.reason === "not_needed") return null;
  return ai.reason === "rate_limited" ? AI_RATE_LINE : AI_OFF_LINE;
}
export const BTN_CANCEL = "בטל";
export const BTN_CLOSE = "סגור";

// The classification dialog (5.2).
export const CLASSIFY_TITLE = (venue: string): string => `סיווג כרטיסים - ${venue}`;
export const CLASSIFY_DESCRIPTION = "כותרת הזון היא כותרת הכרטיס באתר, התיאור הוא השורה שמתחתיה. קטגוריה שנפסלת יורדת מהאירועים.";
export const COL_CATEGORY = "קטגוריה (TixStock)";
export const COL_LABEL = "שם הזון בעברית (כותרת הכרטיס באתר)";
export const COL_DESCRIPTION = "תיאור בעברית (שורה מתחת)";
export const COL_DROP = "לפסול";
export const COL_STATUS = "סטטוס";
export const BTN_CONFIRM_CLASSIFY = (n: number): string =>
  n === 0 ? "אשר - יישמר כתבנית האולם" : n === 1 ? "אשר - יחול על ההופעה ויישמר כתבנית האולם" : `אשר - יחול על ${n} ההופעות ויישמר כתבנית האולם`;
export const STATUS_AI = "הצעת ה-AI";
export const STATUS_RULE_DROP = "נפסל: יציע אוהדי חוץ (כלל)";
export const STATUS_UNSURE = "לבדיקה - ה-AI לא בטוח (יישאר בלי זון)";
/** A row a person emptied (both boxes) - "לבדיקה" without blaming the AI. */
export const STATUS_REVIEW = "לבדיקה (יישאר בלי זון)";
export const STATUS_DROPPED = "נפסל";
export const STATUS_DROPPED_AI = (away: boolean): string => (away ? "נפסל: יציע אוהדי חוץ (הצעת ה-AI)" : "נפסל (הצעת ה-AI)");
export const STATUS_DROPPED_STORED = "נפסל בתבנית האולם";
export const STATUS_KEPT_AGAINST_RULE = "נשאר למרות הכלל";
/** The stored label is often English - isolated, so the " · N הופעות" after it keeps its number (`iso`). */
export const STATUS_EXISTING = (label: string): string => `בתבנית: ${iso(label)}`;
export const STATUS_NOT_SOLD = "לא במכירה בריצה הזו";
export const STATUS_SHOWS = showsHe;
export const STATUS_OFF_MAP = "לא מסומן במפה - יקבל כותרת בלי סימון";
export const CLASSIFY_NEEDS_LABEL = "חסר שם לזון - או רוקנו גם את התיאור (לבדיקה)";
export const CLASSIFY_EMPTY = "לא נמצאו קטגוריות לסווג באולם הזה.";
export const CLASSIFY_FAILED = "הסיווג לא נשמר";
export const CLASSIFY_OPEN_FAILED = "לא הצלחתי לפתוח את הסיווג";
/** The toast after a confirm: "15 אירועים עודכנו · 7 זונים · 1 נפסל · 1 לבדיקה" (`withUnsure` false: learn-from-event, which has none). */
export function CLASSIFY_DONE(r: { events: number; zones: number; dropped: number; unsure: number }, withUnsure = true): string {
  const parts = [
    r.events === 1 ? "אירוע אחד עודכן" : `${r.events} אירועים עודכנו`,
    r.zones === 1 ? "זון אחד" : `${r.zones} זונים`,
    `${r.dropped} נפסלו`,
  ];
  if (withUnsure) parts.push(`${r.unsure} לבדיקה`);
  return parts.join(" · ");
}
const notReached = (left: number): string => (left === 1 ? "הופעה אחת לא הספיקה להתעדכן" : `${left} הופעות לא הספיקו להתעדכן`);
/** A classification confirm that ran out of time before every show was rewritten (the panel's "סווג כרטיסים" reopens it). */
export const PARTIAL_LINE = (left: number): string => `${notReached(left)} - פתחו שוב את הסיווג ואשרו כדי לסיים את שאר ההופעות.`;
/** The same for learn-from-event (the panel's / the card's learn button runs it again). */
export const PARTIAL_LEARN_LINE = (left: number): string => `${notReached(left)} - לחצו שוב על "${BTN_LEARN_APPLY}" כדי לסיים את שאר ההופעות.`;

// The names dialog (5.3).
export const NAMES_TITLE = "שמות בעברית";
export const COL_SUPPLIER_NAME = "שם אצל הספק";
export const COL_NAME_EN = "שם באנגלית (לעמוד)";
export const COL_NAME_HE = "שם בעברית";
export const COL_WHAT = "מה יקרה";
export const NO_IMAGES_LINE =
  "ה-AI לא מביא תמונות: הקבוצות ייווצרו לא פעילות, בלי סמל ובלי תמונה - הפעילו אותן ב-Templates אחרי שהסמל הועלה.";
export const NO_IMAGES_LINE_ARTIST = "ה-AI לא מביא תמונות: האמן ייווצר לא פעיל, בלי תמונה - הפעילו אותו ב-Templates אחרי שהתמונה הועלתה.";
export const STATUS_TEAM_CREATE = "תיווצר קבוצה (בלי סמל ותמונה)";
export const STATUS_ARTIST_CREATE = "ייווצר אמן (בלי תמונה)";
export const STATUS_TEAM_EXISTING = "קיימת כבר - ישתמש בה";
export const STATUS_NAME_SKIPPED = "יידלג - האירועים יישארו עם השם באנגלית";
export const NAME_NEEDS_HEBREW = "צריך אותיות בעברית";
export const NAME_NEEDS_ENGLISH = "חסר שם באנגלית";
export const LIVE_NAMED_LINE = (n: number): string =>
  n === 1 ? "אירוע אחד יקבל את השם בעברית מלייב טיקטס" : `${n} אירועים יקבלו את השם בעברית מלייב טיקטס`;
export const NAMES_NONE = "אין שמות חסרים בריצה הזו.";
export const BTN_NAMES_LIVE = "עדכן שמות בעברית";
export const BTN_CONFIRM_TEAMS = "צור את הקבוצות ועדכן את שמות האירועים";
export const BTN_CONFIRM_ARTIST = "צור את האמן ועדכן את שמות האירועים";
export const NAMES_FAILED = "השמות לא נשמרו";
export const NAMES_OPEN_FAILED = "לא הצלחתי לפתוח את השמות";
/** The toast after a confirm: "3 קבוצות נוצרו · 15 אירועים קיבלו שם בעברית". */
export function TEAMS_DONE(r: { created: number; renamed: number }, artist: boolean): string {
  const made = artist
    ? r.created === 1
      ? "אמן נוצר"
      : `${r.created} אמנים נוצרו`
    : r.created === 1
      ? "קבוצה אחת נוצרה"
      : `${r.created} קבוצות נוצרו`;
  return `${made} · ${r.renamed === 1 ? "אירוע אחד קיבל" : `${r.renamed} אירועים קיבלו`} שם בעברית`;
}

// Learn from an event a person arranged in the editor (5.5).
export const BTN_LEARN_CARD = (n: number): string =>
  n === 1 ? "למד מהאירוע הזה והחל על ההופעה הנוספת" : `למד מהאירוע הזה והחל על ${n} ההופעות`;
export const LEARN_TITLE = "ללמוד מהאירוע הזה?";
export const LEARN_DESCRIPTION = "תבנית האולם תתעדכן מהאירוע שסודר בעורך, ושאר ההופעות באולם בריצה ייכתבו לפיה. בלי AI. האירוע עצמו לא משתנה.";
export const LEARN_READING = "קורא את האירוע…";
export const BTN_LEARN_CONFIRM = "החל";
export const LEARN_FAILED = "הלמידה מהאירוע לא נשמרה";
export const LEARN_OPEN_FAILED = "לא הצלחתי לקרוא את האירוע";
export const LEARN_ZONES = (zones: number, newZones: number): string =>
  `${zones === 1 ? "זון אחד" : `${zones} זונים`} (${newZones === 1 ? "חדש אחד" : `${newZones} חדשים`})`;
export const LEARN_DROPPED = (n: number): string => (n === 1 ? "קטגוריה אחת נפסלה" : `${n} קטגוריות נפסלו`);
export const LEARN_DESCRIPTIONS = (n: number): string => (n === 1 ? "תיאור אחד" : `${n} תיאורים`);
export const LEARN_SIBLINGS = (n: number): string => `יחול על ${showsHe(n)}`;

// A rule for the run, on a question card (5.4).
export const SIMILAR_LINE = (n: number): string => (n === 1 ? "החל גם על השאלה הדומה בריצה" : `החל גם על ${n} השאלות הדומות בריצה`);
export const ANSWERED_MANY = (n: number): string => `נענו ${n} שאלות`;
/** The description under ANSWERED_MANY: what happened to those shows, then their tasks. */
export const ANSWERED_MANY_SKIPPED = "ההופעות דולגו.";
export const ANSWERED_MANY_REQUEUED = "ההופעות חוזרות לבנייה.";
export const ANSWERED_MANY_TASKS = "המשימות נסגרו.";
