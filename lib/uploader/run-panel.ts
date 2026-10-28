/**
 * The tour uploader board's run-level panel ("לטיפול ברמת הריצה") and the fold that goes with it
 * (round "אלון 1", spec 5.1): the warnings that say the same thing on every card of a run - the hall is
 * new, the team has no page, the crest is missing - become ONE row each at the top of the board, with
 * one action, and fold into one grey line on the cards. Pure - no DB, no network: the board hands in
 * the run's items, `getRun`'s `fixedByHand` and `missingNames`, and gets rows back.
 *
 * `cardWarnings` is a VIEW: `uploader_items.warnings` is never touched. A row exists while at least one
 * item carries its warning; the dialogs remove the warnings they resolve, so the row follows by itself.
 * Only the shows the dialogs act on count - `ready` / `approved` (`COUNTED_STATUSES`): a rejected show
 * keeps its warnings but nothing would ever clear them, so it must not inflate a count or keep a row alive.
 *
 * `unzoned_review` (what is left unplaced after a classification) is NOT run-level - the card keeps its
 * "לבדיקה: <categories>" line - but it feeds the venue row: the hall still has categories to review.
 *
 * The subject's page row and the fix rows also carry `task` - what "פתח משימה" opens the shared task dialog with
 * (round "אלון 2", spec 5).
 *
 * Selftest: scripts/tour-uploader-selftest.ts (sections "Round אלון 1, Task 4" and "Round אלון 2, Task 8").
 * Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (5.1);
 * docs/superpowers/specs/2026-10-28-uploader-alon-round-2-design.md (5).
 */
import type { ItemStatus, SubjectKind, UploaderItem, Warning } from "@/types/uploader.types";
import type { SubjectRows } from "@/lib/uploader/warnings";

/**
 * A name inside a Hebrew line, isolated (FSI ... PDI): without it an English name followed by a number
 * ("Craven Cottage · 15 הופעות") glues the number to the English run and cuts "הופעות" from it (bidi
 * rules W7 / N1). Every Latin name a row's text interpolates goes through it, so the strings are right by
 * themselves, wherever they are printed.
 */
export const iso = (name: string): string => `⁨${name}⁩`;

/** The warning codes that are about the whole run, not one show. `new_venue` / `unzoned_tickets` only with a TixStock drawing (`isRunLevel`). */
export const RUN_LEVEL_CODES: readonly string[] = [
  "no_team_page",
  "no_artist_page",
  "no_crest",
  "no_bio",
  "no_cutout",
  "no_event_gallery",
  "no_category_twin",
  "no_hebrew_name",
  "new_venue",
  "unzoned_tickets",
];

/** The two codes the classification dialog resolves - run-level only when the show has a drawing to classify. */
const NEEDS_DRAWING = new Set(["new_venue", "unzoned_tickets"]);

/** The codes that make a venue row: the two above, and what a classification leaves unplaced (a card line, not folded). */
const VENUE_ROW_CODES = new Set([...NEEDS_DRAWING, "unzoned_review"]);

/** The statuses the dialogs act on (classify / rename rewrite `ready` and `approved` items only) - the only shows the panel counts. */
const COUNTED_STATUSES: readonly ItemStatus[] = ["ready", "approved"];

/** The show's TixStock drawing url; null = it has none (a LiveTickets-only show, or TixStock without a seat map). */
function drawingOf(item: UploaderItem): string | null {
  const url = item.show.suppliers.tixstock?.venue_map_url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
}

/**
 * Is this warning one the panel carries (and the card folds)? A venue warning on a LiveTickets-only
 * show stays on its card: there is no drawing to classify, so no dialog could resolve it.
 */
export function isRunLevel(item: UploaderItem, w: Warning): boolean {
  if (!RUN_LEVEL_CODES.includes(w.code)) return false;
  return !NEEDS_DRAWING.has(w.code) || drawingOf(item) !== null;
}

/** The warnings the card still prints, and how many it folded into the "N הערות ברמת הריצה" line. */
export function cardWarnings(item: UploaderItem): { card: Warning[]; folded: number } {
  const card = item.warnings.filter((w) => !isRunLevel(item, w));
  return { card, folded: item.warnings.length - card.length };
}

// ---- the panel's rows -----------------------------------------------------------------------------------

/**
 * What the "פתח משימה" button opens the shared task dialog with (round "אלון 2", spec 5): the title, and the
 * `source_ref` the task is linked back by (`kind: "uploader_page"` is added by the button). `row_id` = the
 * page row's id when it exists, else the subject's English name; `url` = where the fix lives.
 */
export type PanelTask = {
  title: string;
  table: "football_teams" | "artists";
  row_id: number | string;
  label: string;
  url: string;
};

export type PanelRow = {
  kind: "venue" | "names" | "subject" | "fix" | "info";
  /** Stable per row - the board's React key. */
  key: string;
  text: string;
  /** The shows the row touches. */
  count: number;
  /** What the row's button does: the classification dialog, learn-from-an-edited-event, the names dialog, the warning's own link; null = information only. */
  action: "classify" | "learn" | "names" | "link" | null;
  /**
   * A second, lesser button (ruling R20): a `fixed` venue row offers the classification dialog beside
   * "learn" - a learn can answer `no_template` (nothing adopted the drawing) or leave categories to review,
   * and the dialog must still be reachable. Absent on every other row.
   */
  secondary?: "classify";
  /** A venue row: its drawing, hall name and which of the three forms it is in. */
  venue?: {
    sourceUrl: string;
    name: string;
    /** new = no template yet; unzoned = a template with categories left to review; fixed = a person arranged one event in the editor and it has not taught the venue yet (`isFixedByHand`). */
    state: "new" | "unzoned" | "fixed";
    /** `fixed`: the item to learn from (the newest edit); the other edited items are listed under it. */
    fixedItemId: string | null;
    otherFixedItemIds: string[];
  };
  /** A fix row: where the fix lives (the first link the warnings carried). */
  fix_url?: string;
  /** The subject row and every fix row: the task the "פתח משימה" button prefills. Absent on the others (and when the subject has no name and no row to name a task by). */
  task?: PanelTask;
};

/** The run's subject, as the panel names its page rows: `row_id` = the page row the run's resolved subject found (`subjectRowId`), null = none. */
export type PanelSubject = { kind: SubjectKind; name_en: string; row_id?: number | null };

/** The id of the page row the run's resolved subject carries: the team row of a team run, the artist row of an artist run; null = none (a competition has no page of its own). */
export function subjectRowId(kind: SubjectKind, rows: Pick<SubjectRows, "team" | "artist">): number | null {
  const row = kind === "team" ? rows.team : kind === "artist" ? rows.artist : null;
  return row === null ? null : isRowId(row.id) ? row.id : null;
}

const isRowId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** The Templates edit page of a team / artist row; `/templates` (the hub) when the row is not known. */
function templateUrl(table: PanelTask["table"], rowId: number | null): string {
  if (rowId === null) return "/templates";
  return table === "artists" ? `/templates/artists/${rowId}/edit` : `/templates/football/${rowId}/edit`;
}

/**
 * The task for a page row: "<what is missing>: <the subject>". Named by the page row's id when there is one,
 * else by the subject's English name - the one thing that says which page it is. `url` = the fix's own link
 * (a fix row's warning carried it), else the row's Templates page. Undefined when the subject has neither a
 * name nor a row.
 */
function pageTask(base: string, table: PanelTask["table"], subject: PanelSubject, url?: string): PanelTask | undefined {
  const name = subject.name_en.trim();
  const rowId = isRowId(subject.row_id) ? subject.row_id : null;
  if (name === "" && rowId === null) return undefined;
  return { title: name === "" ? base : `${base}: ${name}`, table, row_id: rowId ?? name, label: name, url: url ?? templateUrl(table, rowId) };
}

/** A counted item with the run-level warnings it carries (possibly none - it may carry only an `unzoned_review`). */
type Carrier = { item: UploaderItem; run: Warning[] };

const has = (c: Carrier, code: string): boolean => c.run.some((w) => w.code === code);

/** "הופעה אחת" for one, "N הופעות" otherwise. */
const shows = (n: number): string => (n === 1 ? "הופעה אחת" : `${n} הופעות`);

/** The hall's name for the row: the first show's venue, else the city. */
function venueName(group: Carrier[]): string {
  return group.map((c) => c.item.show.venue?.trim()).find((v): v is string => !!v) ?? group[0].item.show.city;
}

/** Newest `updated_at` first; an unreadable time sorts last. */
const newestFirst = (a: UploaderItem, b: UploaderItem): number => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);

/** How many DISTINCT categories the group's `unzoned_review` lines name (trimmed; none carried = 0, an older line). */
function categoriesToReview(group: Carrier[]): number {
  const names = new Set<string>();
  for (const c of group) {
    for (const w of c.item.warnings) {
      if (w.code !== "unzoned_review" || !Array.isArray(w.categories)) continue;
      for (const n of w.categories) if (typeof n === "string" && n.trim() !== "") names.add(n.trim());
    }
  }
  return names.size;
}

/** "קטגוריות" without a number when none was carried, "קטגוריה אחת", or "N קטגוריות". */
const categoriesWord = (n: number): string => (n === 0 ? "קטגוריות" : n === 1 ? "קטגוריה אחת" : `${n} קטגוריות`);

function venueRow(sourceUrl: string, group: Carrier[], carriers: Carrier[], fixedByHand: Record<string, boolean>): PanelRow {
  const name = venueName(group);
  const count = group.length;
  const base = { kind: "venue" as const, key: `venue:${sourceUrl}`, count };
  const hall = carriers.filter((c) => drawingOf(c.item) === sourceUrl);
  const edited = hall
    .map((c) => c.item)
    .filter((i) => fixedByHand[i.id] === true)
    .sort(newestFirst);
  if (edited.length > 0) {
    const waiting = group.filter((c) => fixedByHand[c.item.id] !== true && hasVenueWarning(c.item)).length;
    const head = `אולם: ${iso(name)} · ${edited[0].event_id === null ? "אירוע סודר בעורך" : `אירוע ${edited[0].event_id} סודר בעורך`}`;
    return {
      ...base,
      // a learn rewrites every show of the hall, zoned or not - the row touches all of them
      count: hall.length,
      text: waiting > 0 ? `${head} · ${shows(waiting)} עדיין בלי זונים` : head,
      action: "learn",
      secondary: "classify",
      venue: { sourceUrl, name, state: "fixed", fixedItemId: edited[0].id, otherFixedItemIds: edited.slice(1).map((i) => i.id) },
    };
  }
  const isNew = group.some((c) => has(c, "new_venue"));
  return {
    ...base,
    text: isNew
      ? `אולם חדש: ${iso(name)} · ${shows(count)} · הכרטיסים עלו באנגלית ובלי זונים`
      : `אולם: ${iso(name)} · ${categoriesWord(categoriesToReview(group))} לבדיקה · ${shows(count)}`,
    action: "classify",
    venue: { sourceUrl, name, state: isNew ? "new" : "unzoned", fixedItemId: null, otherFixedItemIds: [] },
  };
}

const hasVenueWarning = (item: UploaderItem): boolean => item.warnings.some((w) => VENUE_ROW_CODES.has(w.code));

/**
 * One venue row per exact drawing url among the shows with a venue warning OR arranged by hand, in the
 * order the drawings first appear. The second half is Alon's 25.10 "I don't see the learn option": a hall
 * "סווג כרטיסים" had zoned carries no venue warning any more, so an event he then fixed in the editor had
 * no row to teach the rest from.
 */
function venueRows(carriers: Carrier[], fixedByHand: Record<string, boolean>): PanelRow[] {
  const byDrawing = new Map<string, Carrier[]>();
  for (const c of carriers) {
    const url = drawingOf(c.item);
    if (url === null || (!hasVenueWarning(c.item) && fixedByHand[c.item.id] !== true)) continue;
    byDrawing.set(url, [...(byDrawing.get(url) ?? []), c]);
  }
  return [...byDrawing].map(([url, group]) => venueRow(url, group, carriers, fixedByHand));
}

/** The first three names (each isolated) and "(+k)" for the rest. */
function nameList(names: string[]): string {
  const more = names.length - 3;
  return `${names.slice(0, 3).map(iso).join(", ")}${more > 0 ? ` (+${more})` : ""}`;
}

function namesRow(carriers: Carrier[], missing: string[]): PanelRow[] {
  const events = carriers.filter((c) => has(c, "no_hebrew_name")).length;
  if (missing.length === 0 && events === 0) return [];
  const head = missing.length > 0 ? `שמות בעברית חסרים: ${nameList(missing)}` : "שמות בעברית חסרים";
  const tail = events === 0 ? "" : ` · ${events === 1 ? "אירוע אחד נבנה" : `${events} אירועים נבנו`} עם שם באנגלית`;
  return [{ kind: "names", key: "names", text: `${head}${tail}`, count: events, action: "names" }];
}

function subjectRow(carriers: Carrier[], subject: PanelSubject): PanelRow[] {
  const group = carriers.filter((c) => has(c, "no_team_page") || has(c, "no_artist_page"));
  if (group.length === 0) return [];
  const isTeam = group.some((c) => has(c, "no_team_page"));
  const name = subject.name_en.trim();
  const task = pageTask(`לבנות עמוד ${isTeam ? "קבוצה" : "אמן"}`, isTeam ? "football_teams" : "artists", subject);
  return [
    {
      kind: "subject",
      key: "subject",
      text: `אין עמוד ${isTeam ? "קבוצה" : "אמן"} באתר${name === "" ? "" : ` ל-${iso(name)}`}`,
      count: group.length,
      action: "names",
      ...(task ? { task } : {}),
    },
  ];
}

/** The fix rows, in this order; each links to the first fix_url any of its warnings carried. */
const FIX_ROWS: readonly (readonly [string, string])[] = [
  ["no_crest", "אין סמל לקבוצה"],
  ["no_bio", "אין ביוגרפיה"],
  ["no_cutout", "אין גזרה לאמן"],
  ["no_event_gallery", "אין גלריית אירועים"],
];

/** Whose page a fix is on: the crest is a team's, the cut-out and the gallery an artist's, a bio is the subject's own. */
function fixTable(code: string, kind: SubjectKind): PanelTask["table"] {
  if (code === "no_crest") return "football_teams";
  if (code === "no_cutout" || code === "no_event_gallery") return "artists";
  return kind === "artist" ? "artists" : "football_teams";
}

function fixRows(carriers: Carrier[], subject: PanelSubject): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const [code, text] of FIX_ROWS) {
    const group = carriers.filter((c) => has(c, code));
    if (group.length === 0) continue;
    const fix_url = group.flatMap((c) => c.run.filter((w) => w.code === code)).find((w) => !!w.fix_url)?.fix_url;
    const task = pageTask(text, fixTable(code, subject.kind), subject, fix_url);
    rows.push({
      kind: "fix",
      key: `fix:${code}`,
      text,
      count: group.length,
      action: fix_url ? "link" : null,
      ...(fix_url ? { fix_url } : {}),
      ...(task ? { task } : {}),
    });
  }
  return rows;
}

function infoRow(carriers: Carrier[]): PanelRow[] {
  const group = carriers.filter((c) => has(c, "no_category_twin"));
  if (group.length === 0) return [];
  return [{ kind: "info", key: "info:no_category_twin", text: "אין עמוד קטגוריה (/c/) תאום - לידיעה", count: group.length, action: null }];
}

/**
 * The panel's rows for a run, in the spec's order: a row per hall (venue), the Hebrew names, the
 * subject's page, the fixes (crest, bio, cut-out, gallery), the information line. `fixedByHand` and
 * `missing` are `getRun`'s (`RunBoard.fixedByHand` / `missingNames`); `subject` names the page rows
 * (`row_id` = `RunBoard.subjectRowId`) and the task each of them offers. Empty = no panel.
 */
export function runLevelRows(
  items: UploaderItem[],
  fixedByHand: Record<string, boolean>,
  subject: PanelSubject,
  missing: string[],
): PanelRow[] {
  const carriers = items
    .filter((item) => COUNTED_STATUSES.includes(item.status))
    .map((item): Carrier => ({ item, run: item.warnings.filter((w) => isRunLevel(item, w)) }));
  return [
    ...venueRows(carriers, fixedByHand),
    ...namesRow(carriers, missing),
    ...subjectRow(carriers, subject),
    ...fixRows(carriers, subject),
    ...infoRow(carriers),
  ];
}
