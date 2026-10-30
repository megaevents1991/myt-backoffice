// The review board's words and pure rules (/uploader/[id], spec §5.3 / §11) - no JSX, no I/O.
// Every component of the board reads its wording and its "may this card do X" answers from here,
// so two cards can never word or judge the same thing two ways. A server action's `kind` in Hebrew
// is the screen-wide `actionErrorText` (../copy.ts).
import type { EditKind, NotCarried, PlaceField, SkipReason } from "@/lib/uploader/edit-changes";
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

/**
 * The pills, in order. "פעילים" (round 2, Alon: "give me a reject option that filters out") is the board's default - everything
 * but the shows a person rejected or the build skipped; "הכל" stays, last, for the ones who want them back on screen.
 */
export const FILTERS = ["active", "questions", "ready", "attention", "approved", "skipped", "rejected", "errors", "all"] as const;
export type Filter = (typeof FILTERS)[number];
export const DEFAULT_FILTER: Filter = "active";

export const FILTER_HE: Record<Filter, string> = {
  active: "פעילים",
  questions: "שאלות",
  ready: "מוכנים",
  attention: "דורשים תשומת לב",
  approved: "אושרו",
  skipped: "דולגו",
  rejected: "נדחו",
  errors: "שגיאות",
  all: "הכל",
};

export function inFilter(filter: Filter, item: UploaderItem): boolean {
  switch (filter) {
    case "active":
      return item.status !== "rejected" && item.status !== "skipped";
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
    case "active":
      return c.total - c.rejected - c.skipped;
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
/** The panel's page rows (the subject's page, a missing crest / bio / cut-out / gallery): opens the shared task dialog prefilled (round "אלון 2", spec 5). */
export const BTN_OPEN_TASK = "פתח משימה";
/** The task's description, after its steps (Alon round 3, note 1): the run's absolute board link. */
export const TASK_FROM_RUN = "מתוך ריצת העלאה";
/** ... how many shows of the run wait for it. */
export const TASK_WAITING = (n: number): string => (n === 1 ? "הופעה אחת בריצה מחכה לזה" : `${n} הופעות בריצה מחכות לזה`);
/** ... and where the fix lives. */
export const TASK_PAGE_LINE = "העמוד";
/** The small note under the task form ("From ..."), the `origin` of the prefill. */
export const TASK_ORIGIN = "מה-AI Uploader";
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
export const CLASSIFY_DESCRIPTION = "כותרת הזון היא כותרת הכרטיס באתר. קטגוריה שנפסלת יורדת מהאירועים.";
export const COL_CATEGORY = "קטגוריה (TixStock)";
export const COL_LABEL = "שם הזון בעברית (כותרת הכרטיס באתר)";
export const COL_DROP = "לפסול";
/** The box above the table: the hall's Hebrew name - what `{אולם}` prints in the event description (round 2, D3). */
export const COL_VENUE_HE = "שם האולם בעברית";
export const VENUE_HE_HINT = "מודפס בתיאור האירוע במקום {אולם}. ריק - יודפס שם האולם כפי שהספק כותב אותו.";
export const VENUE_HE_HINT_AI = "הצעת ה-AI - בדקו ואשרו. מודפס בתיאור האירוע במקום {אולם}.";
export const VENUE_HE_NEEDS_HEBREW = "השם חייב להכיל אותיות בעברית (או שתשאירו ריק)";
/** Under the hall's map in the classify dialog (round 2, Task 10): how many sections are excluded for every show of the hall. */
export const MAP_EXCLUDED_LINE = (n: number): string =>
  n === 1 ? "גוש אחד מוחרג - לא יימכר בכל ההופעות באולם" : `${n} גושים מוחרגים - לא יימכרו בכל ההופעות באולם`;
/** The same place with nothing excluded yet: what a click on the map does. */
export const MAP_HINT = "לחיצה על גוש במפה מחריגה אותו - הוא לא יימכר בכל ההופעות באולם. לחיצה נוספת מחזירה אותו.";
/** Above the map: hovering a row lights its category. */
export const MAP_TITLE = "מפת האולם";
/** The confirm's toast, when the excluded sections changed: the ticket prices follow at the TixStock price sync. */
export const MAP_PRICES_LINE = "המחירים יתעדכנו בסנכרון הבא";
/** The map could not be drawn (the drawing is not a usable SVG in the browser). */
export const MAP_UNAVAILABLE = "לא ניתן להציג את מפת האולם";
export const COL_STATUS = "סטטוס";
export const BTN_CONFIRM_CLASSIFY = (n: number): string =>
  n === 0 ? "אשר - יישמר כתבנית האולם" : n === 1 ? "אשר - יחול על ההופעה ויישמר כתבנית האולם" : `אשר - יחול על ${n} ההופעות ויישמר כתבנית האולם`;
export const STATUS_AI = "הצעת ה-AI";
export const STATUS_RULE_DROP = "נפסל: יציע אוהדי חוץ (כלל)";
export const STATUS_UNSURE = "לבדיקה - ה-AI לא בטוח (יישאר בלי זון)";
/** A row a person emptied (its label box) - "לבדיקה" without blaming the AI. */
export const STATUS_REVIEW = "לבדיקה (יישאר בלי זון)";
export const STATUS_DROPPED = "נפסל";
export const STATUS_DROPPED_AI = (away: boolean): string => (away ? "נפסל: יציע אוהדי חוץ (הצעת ה-AI)" : "נפסל (הצעת ה-AI)");
export const STATUS_DROPPED_STORED = "נפסל בתבנית האולם";
/** A row the away rule drops that is kept - un-dropped now, or kept at an earlier confirm (ruling R22): the hint that it is sold. */
export const STATUS_KEPT_AGAINST_RULE = "נשמר למרות כלל אוהדי החוץ";
/** The stored label is often English - isolated, so the " · N הופעות" after it keeps its number (`iso`). */
export const STATUS_EXISTING = (label: string): string => `בתבנית: ${iso(label)}`;
export const STATUS_NOT_SOLD = "לא במכירה בריצה הזו";
export const STATUS_SHOWS = showsHe;
export const STATUS_OFF_MAP = "לא מסומן במפה - יקבל כותרת בלי סימון";
export const CLASSIFY_EMPTY = "לא נמצאו קטגוריות לסווג באולם הזה.";
export const CLASSIFY_FAILED = "הסיווג לא נשמר";
export const CLASSIFY_OPEN_FAILED = "לא הצלחתי לפתוח את הסיווג";
/** The toast after a confirm: "15 אירועים עודכנו · 7 זונים · נפסל אחד · 1 לבדיקה" (`withUnsure` false: learn-from-event, which has none). */
export function CLASSIFY_DONE(r: { events: number; zones: number; dropped: number; unsure: number }, withUnsure = true): string {
  const parts = [
    r.events === 1 ? "אירוע אחד עודכן" : `${r.events} אירועים עודכנו`,
    r.zones === 1 ? "זון אחד" : `${r.zones} זונים`,
    r.dropped === 1 ? "נפסל אחד" : `${r.dropped} נפסלו`,
  ];
  if (withUnsure) parts.push(`${r.unsure} לבדיקה`);
  return parts.join(" · ");
}
const notReached = (left: number): string => (left === 1 ? "הופעה אחת לא הספיקה להתעדכן" : `${left} הופעות לא הספיקו להתעדכן`);
/** A classification confirm that was saved but could not rewrite every event description with the hall's Hebrew name (round 2, D3). */
export const DESCRIBE_FAILED_LINE = "תיאורי האירועים לא עודכנו - אשרו שוב";
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
// "זה עמוד קיים" (round 2, spec 5): link a supplier's name to a page that already exists instead of creating a team.
export const BTN_LINK_EXISTING = "זה עמוד קיים";
export const LINK_SEARCH_LABEL = "חיפוש עמוד קיים";
export const LINK_SEARCH_PLACEHOLDER = "שם הקבוצה בעברית או באנגלית";
export const LINK_SEARCH_HINT = "הקלידו לפחות שתי אותיות";
export const LINK_NONE = "לא נמצא עמוד בשם הזה";
export const LINK_SEARCH_FAILED = "החיפוש נכשל - נסו שוב";
export const LINK_INACTIVE = "לא פעיל";
export const LINK_UNDO = "בטל את הקישור";
export const LINK_CLOSE = "סגור את החיפוש";
export const STATUS_TEAM_LINKED = "מקושרת לעמוד קיים - ישתמש בה, לא ייווצר עמוד חדש";
export const NAME_NEEDS_HEBREW = "צריך אותיות בעברית";
export const NAME_NEEDS_ENGLISH = "חסר שם באנגלית";
/** How many built shows the confirm gives a Hebrew name with no row to fill (`proposeTeamNames`' `renamable`, ruling R24). */
export const RENAMABLE_LINE = (n: number): string => (n === 1 ? "אירוע אחד יקבל שם בעברית" : `${n} אירועים יקבלו שם בעברית`);
export const NAMES_NONE = "אין שמות חסרים בריצה הזו.";
export const BTN_NAMES_LIVE = "עדכן שמות בעברית";
export const BTN_CONFIRM_TEAMS = "צור את הקבוצות ועדכן את שמות האירועים";
export const BTN_CONFIRM_ARTIST = "צור את האמן ועדכן את שמות האירועים";
export const NAMES_FAILED = "השמות לא נשמרו";
export const NAMES_OPEN_FAILED = "לא הצלחתי לפתוח את השמות";
/** The toast after a confirm: "3 קבוצות נוצרו · 2 קישורים לעמוד קיים · 15 אירועים קיבלו שם בעברית". */
export function TEAMS_DONE(r: { created: number; linked?: number; renamed: number }, artist: boolean): string {
  const linked = r.linked ?? 0;
  const made = artist
    ? r.created === 1
      ? "אמן נוצר"
      : `${r.created} אמנים נוצרו`
    : r.created === 1
      ? "קבוצה אחת נוצרה"
      : `${r.created} קבוצות נוצרו`;
  const used = linked === 1 ? "קישור אחד לעמוד קיים" : `${linked} קישורים לעמוד קיים`;
  const parts = r.created > 0 || linked === 0 ? [made] : [];
  if (linked > 0) parts.push(used);
  parts.push(`${r.renamed === 1 ? "אירוע אחד קיבל" : `${r.renamed} אירועים קיבלו`} שם בעברית`);
  return parts.join(" · ");
}

// Learn from an event a person arranged in the editor (5.5).
// Learn in two clear steps (round 2, Alon: "not clear which flow"): the button used to appear only AFTER an event was
// fixed in the editor, with nothing saying the editor comes first. A card whose hall has other shows now shows both steps.
export const LEARN_STEP_1 = "1. סדרו את האירוע בעורך";
export const LEARN_STEP_1_DONE = "1. האירוע סודר בעורך";
export const LEARN_STEP_2 = (n: number): string => (n === 1 ? "2. למדו והחילו על ההופעה הנוספת" : `2. למדו והחילו על ${n} ההופעות`);
export const LEARN_ANYTIME_LINE = "אפשר ללחוץ בכל רגע - תראו מה השתנה, על מה זה יחול ולמה לא על השאר";
/** The one-line recipe under the panel's venue rows and in the classify dialog's footer. */
export const LEARN_RECIPE = 'רוצים לסדר ידנית? סדרו אירוע אחד בעורך, חזרו ולחצו "למדו והחילו" בכרטיס שלו';
export const LEARN_TITLE = "ללמוד מהאירוע הזה?";
export const LEARN_DESCRIPTION = "מה שיניתם באירוע הזה בעורך מאז הלמידה האחרונה. סמנו מה להחיל על שאר ההופעות - בלי AI. האירוע עצמו לא משתנה.";
// Alon round 3 (note 2b): the dialog lists each kind of change with a checkbox, and an optional note for the AI.
export const LEARN_KIND_VENUE = "תבנית האולם";
export const LEARN_KIND_VENUE_HINT = "זונים, קטגוריות שנפסלו, תיאורי TixStock וגושים מוחרגים - לשאר ההופעות באותו אולם";
export const LEARN_VENUE_UNAVAILABLE = 'אי אפשר ללמוד את האולם מהאירוע הזה. אפשר לסווג אותו מהפאנל ("סווג כרטיסים"); השאר עדיין יוחל.';
export const LEARN_KIND_DESCRIPTIONS = "תיאורי כרטיסי LiveTickets";
export const LEARN_KIND_DESCRIPTIONS_HINT =
  "מחיקה - בכל ההופעות בריצה; תיאור חדש - רק באותו אולם. כרטיס שמישהו כתב לו תיאור בעצמו לא נוגעים בו. תיאורי TixStock הולכים עם תבנית האולם.";
export const LEARN_VENUE_PART_FAILED = "תבנית האולם לא נשמרה עד הסוף - לחצו שוב על \"החל\"";
export const LEARN_CLEAR_ALL = (supplier: string): string => `כל התיאורים של ${supplier} נמחקו - יימחקו בכל ההופעות`;
export const LEARN_CLEARED = "התיאור נמחק";
export const LEARN_SET = "תיאור חדש";
export const LEARN_DESC_REACH = (tickets: number, events: number): string =>
  tickets === 0
    ? "בשאר ההופעות אין כרטיס שעדיין מחזיק את התיאור המקורי - אין מה לשנות"
    : `יחול על ${tickets === 1 ? "כרטיס אחד" : `${tickets} כרטיסים`} ב-${showsHe(events)}`;
export const LEARN_MORE = (n: number): string => `ועוד ${n}`;
export const LEARN_NOTHING = "לא מצאתי שינוי שאפשר להחיל מאז הלמידה האחרונה. נבדקים: תבנית האולם, תיאורי כרטיסי LiveTickets, תיאור האירוע, מיקום ולינה. אפשר לכתוב הערה ל-AI.";
export const LEARN_NOTE_LABEL = "הערה ל-AI (לא חובה)";
export const LEARN_NOTE_HINT =
  "נשמרת כחוק קבוע של ה-AI Uploader ונקראת בכל ריצה הבאה (פענוח הבריף, סיווג, שמות, מיקום). היא לא משנה אירועים בעצמה - את זה עושים הסימונים למעלה.";
export const LEARN_NOTE_PLACEHOLDER = "למשל: בלאציו לא מביאים את התיאורים באנגלית של LiveTickets";
export const LEARN_KIND_EVENT_DESCRIPTION = "תיאור האירוע";
export const LEARN_KIND_EVENT_DESCRIPTION_HINT = "רק להופעות באותו אולם שהטקסט שלהן עדיין זהה למה שהיה כאן לפני העריכה. טקסט שמישהו כתב בהופעה אחרת נשאר שלו.";
export const LEARN_TEMPLATE_HINT = 'בהופעות אחרות הטקסט שונה (למשל שם יריבה אחר). לשינוי בכולן - "תבנית תיאור" בראש הלוח.';
export const LEARN_KIND_PLACE = "מיקום ולינה";
export const LEARN_KIND_PLACE_HINT = "רק להופעות באותו אולם שעדיין טסות לאותו מקום. מיקום שמישהו שינה בהופעה אחרת נשאר שלו.";
export const PLACE_FIELD_LABEL: Record<PlaceField, string> = {
  location: "שם המיקום",
  event_location: "עיר האירוע",
  lodging_mode: "אפשרויות לינה",
  lodging_default: "לינת ברירת מחדל",
  lodging_note: "הערת לינה",
  split_default_nights: "לילות בפיצול",
};
export const LEARN_REACH_EVENTS = (n: number): string => (n === 0 ? "לא יחול על אף הופעה - הסיבות ברשימה למטה" : `יחול על ${showsHe(n)}`);
export const LEARN_SHOWS_TITLE = "מה יקרה בכל הופעה";
/** A kind's short name in the per-show list. */
export const LEARN_KIND_SHORT: Record<EditKind, string> = { venue: "אולם", descriptions: "כרטיסים", event_description: "תיאור", place: "מיקום" };
/** Why a kind does not reach a show. `different` reads by kind: a text or a place. */
export const LEARN_SKIP_TEXT = (kind: EditKind, reason: SkipReason): string => {
  switch (reason) {
    case "other_hall":
      return kind === "venue" ? "שרטוט אחר" : "אולם אחר";
    case "typed_by_hand":
      return "נכתב שם ידנית - נשאר";
    case "different":
      return kind === "place" ? "מיקום אחר" : "נוסח אחר";
    case "already":
      return "כבר זהה";
    case "no_category":
      return "אין שם כרטיס כזה";
  }
};
export const LEARN_NOT_CARRIED_TITLE = "השתנה כאן ולא מוחל על הופעות אחרות:";
export const LEARN_NOT_CARRIED: Record<NotCarried, string> = {
  name: "שם האירוע",
  name_english: "השם באנגלית",
  date: "תאריך",
  def_date_depart: "תאריך יציאה",
  def_date_return: "תאריך חזרה",
  base_flight_price: "בסיס טיסה",
  base_hotel_price: "בסיס מלון",
  event_additional_markup: "תוספת לאירוע",
  ticket_only_markup: "תוספת כרטיס בלבד",
  package_mode: "סוג החבילה",
  flight_city: "עיר הטיסה - משנה טיסות ומחירי בסיס, ולכן גם המיקום והלינה לא מוחלים",
  description_cleared: "תיאור שנמחק - לא מוחקים תיאור בכל ההופעות בבת אחת",
  ticket_label: "שם של כרטיס",
  livetickets_zone: "אזור של כרטיס LiveTickets - נקבע בלוח האזורים של כל אירוע",
  livetickets_tickets: "כרטיס LiveTickets שנוסף או נמחק",
  tixstock_description_cleared: "תיאור TixStock שנמחק - ההופעות האחרות מקבלות אותו מתבנית האולם",
};
export const LEARN_FIELDS_DONE = (events: number, description: boolean, place: boolean): string =>
  `${description && place ? "התיאור והמיקום עודכנו" : description ? "התיאור עודכן" : "המיקום עודכן"} ב-${showsHe(events)}`;
export const LEARN_FIELDS_PARTIAL = (left: number): string => `${notReached(left)} בתיאור ובמיקום - לחצו שוב על "${BTN_LEARN_CONFIRM}" כדי לסיים.`;
export const LEARN_DESC_DONE = (tickets: number, events: number): string =>
  `${tickets === 1 ? "תיאור כרטיס אחד" : `${tickets} תיאורי כרטיסים`} עודכנו ב-${showsHe(events)}`;
export const LEARN_DESC_PARTIAL = (left: number): string => `${notReached(left)} בתיאורים - לחצו שוב על "${BTN_LEARN_CONFIRM}" כדי לסיים.`;
export const LEARN_DESC_FAILED = (n: number): string => (n === 1 ? "כתיבה אחת לא נשמרה - נסו שוב" : `${n} כתיבות לא נשמרו - נסו שוב`);
export const LEARN_NOTE_SAVED = "ההערה נשמרה כחוק של ה-AI";
export const LEARN_NOTE_FAILED = "ההערה ל-AI לא נשמרה";
export const LEARN_SAVED_NOTHING = "נשמר";
export const LEARN_READING = "קורא את האירוע…";
export const BTN_LEARN_CONFIRM = "החל";
export const LEARN_FAILED = "הלמידה מהאירוע לא נשמרה";
export const LEARN_OPEN_FAILED = "לא הצלחתי לקרוא את האירוע";
export const LEARN_ZONES = (zones: number, newZones: number): string =>
  `${zones === 1 ? "זון אחד" : `${zones} זונים`} (${newZones === 1 ? "חדש אחד" : `${newZones} חדשים`})`;
export const LEARN_DROPPED = (n: number): string => (n === 1 ? "קטגוריה אחת נפסלה" : `${n} קטגוריות נפסלו`);
export const LEARN_DESCRIPTIONS = (n: number): string => (n === 1 ? "תיאור אחד" : `${n} תיאורים`);
/** Round 2, Task 10: the event's excluded map sections become the hall's. */
export const LEARN_SECTIONS = (n: number): string => (n === 0 ? "בלי גושים מוחרגים" : n === 1 ? "גוש אחד מוחרג" : `${n} גושים מוחרגים`);
export const LEARN_SIBLINGS = (n: number): string => `יחול על ${showsHe(n)}`;

// A rule for the run, on a question card (5.4).
export const SIMILAR_LINE = (n: number): string => (n === 1 ? "החל גם על השאלה הדומה בריצה" : `החל גם על ${n} השאלות הדומות בריצה`);
export const ANSWERED_MANY = (n: number): string => `נענו ${n} שאלות`;
/** The description under ANSWERED_MANY: what happened to those shows, then their tasks. */
export const ANSWERED_MANY_SKIPPED = "ההופעות דולגו.";
export const ANSWERED_MANY_REQUEUED = "ההופעות חוזרות לבנייה.";
export const ANSWERED_MANY_TASKS = "המשימות נסגרו.";

// The description template (Alon 25.10): one standing template per family, filled per show.
export const BTN_DESCRIPTION = "תבנית תיאור";
export const DESCRIPTION_TITLE = (family: "football" | "artist"): string =>
  family === "football" ? "תבנית תיאור קבועה - כדורגל" : "תבנית תיאור קבועה - הופעות";
export const DESCRIPTION_INTRO =
  "התיאור מופיע באתר מתחת לשם האירוע, ונכנס לטקסט של הפיד במטא. כותבים פעם אחת, והמערכת משלימה לכל הופעה את המקומות בסוגריים. התבנית נשמרת לכל הריצות הבאות.";
export const DESCRIPTION_READING = "קורא את התבנית…";
export const DESCRIPTION_OPEN_FAILED = "לא הצלחתי לקרוא את התבנית";
export const DESCRIPTION_PLACEHOLDER = "לדוגמה: חבילת טיסה, מלון וכרטיס למשחק {בית} נגד {חוץ} ב{מפעל}, ב{אולם}.";
export const DESCRIPTION_TOKENS_LINE = "לחיצה מוסיפה במקום הסמן:";
export const DESCRIPTION_PREVIEW = (name: string | null): string => (name ? `כך זה ייראה ב: ${name}` : "כך זה ייראה");
export const DESCRIPTION_NO_SAMPLE = "אין עדיין אירוע בנוי בריצה הזו - התצוגה תופיע אחרי שאירוע ייבנה.";
export const DESCRIPTION_STILL_ENGLISH = (tokens: string[]): string =>
  `עדיין באנגלית: ${tokens.join(", ")}. יתעדכן לבד אחרי "תן שמות בעברית" (קבוצות), או אחרי הוספת תגית ליגה עם שם באנגלית (מפעל).`;
export const DESCRIPTION_NOT_READY = "התבנית תהיה זמינה אחרי עדכון המערכת הבא.";
export const DESCRIPTION_HAND_LINE = "תיאור שמישהו כבר כתב ידנית בעורך לא יידרס.";
export const BTN_DESCRIPTION_SAVE = "שמור לריצות הבאות";
export const BTN_DESCRIPTION_APPLY = (n: number): string => (n === 1 ? "שמור והחל על האירוע בריצה" : `שמור והחל על ${n} האירועים בריצה`);
export const DESCRIPTION_SAVED = "התבנית נשמרה";
export const DESCRIPTION_CLEARED = "התבנית נמחקה - אירועים חדשים ייבנו עם התיאור באנגלית";
export const DESCRIPTION_SAVE_FAILED = "התבנית לא נשמרה";
export const DESCRIPTION_APPLIED = (r: { events: number; editedByHand: number; english: number }): string => {
  const done = r.events === 0 ? "אף אירוע לא השתנה" : r.events === 1 ? "התיאור עודכן באירוע אחד" : `התיאור עודכן ב-${r.events} אירועים`;
  const hand = r.editedByHand === 0 ? "" : ` · ${r.editedByHand === 1 ? "אחד נערך ידנית ולא נגעתי בו" : `${r.editedByHand} נערכו ידנית ולא נגעתי בהם`}`;
  const english = r.english === 0 ? "" : ` · ב-${r.english} נשאר חלק באנגלית`;
  return `${done}${hand}${english}`;
};

// The create-location dialog (round 2, spec 4.2): opened by a location question's "create" option.
export const LOCATION_TITLE = (city: string): string => `יצירת מיקום ל-${city || "העיר"}`;
export const LOCATION_INTRO =
  "המיקום נכנס לטבלת המיקומים - ממנו טסים ובו מחפשים מלון. אחרי היצירה ההופעה הזו, וכל הופעה פתוחה באותה עיר בריצה הזו, ייבנו כחבילה.";
export const LOCATION_OPEN_FAILED = "הטופס לא נפתח";
export const LOCATION_WAIT = "ה-AI ממלא את הטופס…";
export const LOCATION_NAME_LABEL = "שם בעברית (עיר, מדינה)";
export const LOCATION_NAME_PLACEHOLDER = "ולנסיה, ספרד";
export const LOCATION_IATA_LABEL = "קוד שדה תעופה (IATA)";
export const LOCATION_LAT_LABEL = "קו רוחב";
export const LOCATION_LON_LABEL = "קו אורך";
export const LOCATION_COORDS_HINT = "מרכז העיר - לפיו מחפשים טיסות ומלונות";
export const LOCATION_NO_COORDS_HINT = "לאולם אין קואורדינטות - הזינו את מרכז העיר";
export const LOCATION_COUNTRY_LABEL = "קוד מדינה (ISO-2)";
export const LOCATION_ALIASES_LABEL = "כתיבים נוספים של העיר";
export const LOCATION_ALIASES_HINT = "מופרדים בפסיק - כך הספקים מדפיסים את העיר (Valencia, València). ההופעות באותה עיר מזוהות לפיהם.";
export const BTN_CREATE_LOCATION = "צור מיקום ובנה";
/** A3: the server called the location far from the venue - the same button, now a confirm. */
export const BTN_CONFIRM_FAR_LOCATION = "המיקום נכון - צור ובנה";
/** A2: the city was already a location with an IATA - it was used, nothing was created. */
export const LOCATION_EXISTING = (id: number): string => `המיקום כבר קיים (#${id}) - ההופעות ייבנו דרכו`;
export const LOCATION_TASK_OPEN = "משימת השאלה לא נסגרה - סגרו אותה ידנית";
/** The success toast: the new location and how many shows (this one included) now build as a package. */
export const LOCATION_DONE = (name: string, shows: number): string =>
  shows === 1 ? `נוצר מיקום ${name} · הופעה אחת תיבנה כחבילה` : `נוצר מיקום ${name} · ${shows} הופעות ייבנו כחבילה`;
