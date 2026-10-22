/**
 * The tour uploader board's run-level panel ("לטיפול ברמת הריצה") and the fold that goes with it
 * (round "אלון 1", spec 5.1): the warnings that say the same thing on every card of a run - the hall is
 * new, the team has no page, the crest is missing - become ONE row each at the top of the board, with
 * one action, and fold into one grey line on the cards. Pure - no DB, no network: the board hands in
 * the run's items, `getRun`'s `fixedByHand` and `missingNames`, and gets rows back.
 *
 * `cardWarnings` is a VIEW: `uploader_items.warnings` is never touched. A row exists while at least one
 * item carries its warning; the dialogs remove the warnings they resolve, so the row follows by itself.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Round אלון 1, Task 4").
 * Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (5.1).
 */
import type { SubjectKind, UploaderItem, Warning } from "@/types/uploader.types";

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

export type PanelRow = {
  kind: "venue" | "names" | "subject" | "fix" | "info";
  /** Stable per row - the board's React key. */
  key: string;
  text: string;
  /** The shows the row touches. */
  count: number;
  /** What the row's button does: the classification dialog, learn-from-an-edited-event, the names dialog, the warning's own link; null = information only. */
  action: "classify" | "learn" | "names" | "link" | null;
  /** A venue row: its drawing, hall name and which of the three forms it is in. */
  venue?: {
    sourceUrl: string;
    name: string;
    /** new = no template yet; unzoned = a template with categories left to review; fixed = a person arranged one event in the editor. */
    state: "new" | "unzoned" | "fixed";
    /** `fixed`: the item to learn from (the newest edit); the other edited items are listed under it. */
    fixedItemId: string | null;
    otherFixedItemIds: string[];
  };
  /** A fix row: where the fix lives (the first link the warnings carried). */
  fix_url?: string;
};

/** An item with the run-level warnings it carries (only items that carry one). */
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

function venueRow(sourceUrl: string, group: Carrier[], items: UploaderItem[], fixedByHand: Record<string, boolean>): PanelRow {
  const name = venueName(group);
  const count = group.length;
  const base = { kind: "venue" as const, key: `venue:${sourceUrl}`, count };
  const edited = items.filter((i) => drawingOf(i) === sourceUrl && fixedByHand[i.id] === true).sort(newestFirst);
  if (edited.length > 0) {
    const waiting = group.filter((c) => fixedByHand[c.item.id] !== true).length;
    const head = `אולם: ${name} · ${edited[0].event_id === null ? "אירוע סודר בעורך" : `אירוע ${edited[0].event_id} סודר בעורך`}`;
    return {
      ...base,
      text: waiting > 0 ? `${head} · ${shows(waiting)} עדיין בלי זונים` : head,
      action: "learn",
      venue: { sourceUrl, name, state: "fixed", fixedItemId: edited[0].id, otherFixedItemIds: edited.slice(1).map((i) => i.id) },
    };
  }
  const isNew = group.some((c) => has(c, "new_venue"));
  return {
    ...base,
    text: isNew ? `אולם חדש: ${name} · ${shows(count)} · הכרטיסים עלו באנגלית ובלי זונים` : `אולם: ${name} · קטגוריות לבדיקה · ${shows(count)}`,
    action: "classify",
    venue: { sourceUrl, name, state: isNew ? "new" : "unzoned", fixedItemId: null, otherFixedItemIds: [] },
  };
}

/** One venue row per exact drawing url among the shows with a venue warning, in the order the drawings first appear. */
function venueRows(carriers: Carrier[], items: UploaderItem[], fixedByHand: Record<string, boolean>): PanelRow[] {
  const byDrawing = new Map<string, Carrier[]>();
  for (const c of carriers) {
    const url = drawingOf(c.item);
    if (url === null || !c.run.some((w) => NEEDS_DRAWING.has(w.code))) continue;
    byDrawing.set(url, [...(byDrawing.get(url) ?? []), c]);
  }
  return [...byDrawing].map(([url, group]) => venueRow(url, group, items, fixedByHand));
}

/** The first three names and "(+k)" for the rest. */
function nameList(names: string[]): string {
  const more = names.length - 3;
  return `${names.slice(0, 3).join(", ")}${more > 0 ? ` (+${more})` : ""}`;
}

function namesRow(carriers: Carrier[], missing: string[]): PanelRow[] {
  const events = carriers.filter((c) => has(c, "no_hebrew_name")).length;
  if (missing.length === 0 && events === 0) return [];
  const head = missing.length > 0 ? `שמות בעברית חסרים: ${nameList(missing)}` : "שמות בעברית חסרים";
  const tail = events === 0 ? "" : ` · ${events === 1 ? "אירוע אחד נבנה" : `${events} אירועים נבנו`} עם שם באנגלית`;
  return [{ kind: "names", key: "names", text: `${head}${tail}`, count: events, action: "names" }];
}

function subjectRow(carriers: Carrier[], name_en: string): PanelRow[] {
  const group = carriers.filter((c) => has(c, "no_team_page") || has(c, "no_artist_page"));
  if (group.length === 0) return [];
  const word = group.some((c) => has(c, "no_team_page")) ? "קבוצה" : "אמן";
  const subject = name_en.trim();
  return [{ kind: "subject", key: "subject", text: `אין עמוד ${word} באתר${subject === "" ? "" : ` ל-${subject}`}`, count: group.length, action: "names" }];
}

/** The fix rows, in this order; each links to the first fix_url any of its warnings carried. */
const FIX_ROWS: readonly (readonly [string, string])[] = [
  ["no_crest", "אין סמל לקבוצה"],
  ["no_bio", "אין ביוגרפיה"],
  ["no_cutout", "אין גזרה לאמן"],
  ["no_event_gallery", "אין גלריית אירועים"],
];

function fixRows(carriers: Carrier[]): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const [code, text] of FIX_ROWS) {
    const group = carriers.filter((c) => has(c, code));
    if (group.length === 0) continue;
    const fix_url = group.flatMap((c) => c.run.filter((w) => w.code === code)).find((w) => !!w.fix_url)?.fix_url;
    rows.push({ kind: "fix", key: `fix:${code}`, text, count: group.length, action: fix_url ? "link" : null, ...(fix_url ? { fix_url } : {}) });
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
 * `missing` are `getRun`'s (`RunBoard.fixedByHand` / `missingNames`); `subject` names the page row.
 * Empty = no panel.
 */
export function runLevelRows(
  items: UploaderItem[],
  fixedByHand: Record<string, boolean>,
  subject: { kind: SubjectKind; name_en: string },
  missing: string[],
): PanelRow[] {
  const carriers = items
    .map((item): Carrier => ({ item, run: item.warnings.filter((w) => isRunLevel(item, w)) }))
    .filter((c) => c.run.length > 0);
  return [
    ...venueRows(carriers, items, fixedByHand),
    ...namesRow(carriers, missing),
    ...subjectRow(carriers, subject.name_en),
    ...fixRows(carriers),
    ...infoRow(carriers),
  ];
}
