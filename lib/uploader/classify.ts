/**
 * Venue classification (tour uploader, round "אלון 1") - the rules behind the "classify venue" dialog,
 * the build's ticket step and "learn from one event". Pure: no DB, no network, no `server-only`; the
 * server actions read the rows and the drawing and hand them in, this module decides.
 *
 * A venue's TixStock tickets are sorted by a KEY - `normalizeSupplierCategory(category)`, the key the
 * venue template (`venue_maps.supplier_categories.tixstock`) and `venue_maps.dropped_categories` use:
 *  - `dropRule`, `drawingCategories`, `parseDroppedCategories`: the facts the dialog starts from.
 *  - `parseClassification`, `proposalRows`: the model's proposal checked, and the dialog's rows
 *    (stored label > proposal, the code rule for "away" stands first). The model proposes a label, a drop
 *    and the HALL's Hebrew name - never a zone description (round 2, D4); a description already stored on
 *    a zone is shown by `proposalRows` and kept by `templateFromRows`.
 *  - `cleanVenueHe`, `parseVenueHeInput`: the hall's Hebrew name (`venue_maps.name_he`, what `{אולם}`
 *    prints) - the proposal's and the confirm's.
 *  - `cleanConfirmedRows`, `readyToConfirm`, `templateFromRows`, `forgetUnconfirmed`, `classificationDiff`:
 *    what a person confirmed -> the final template (zones, mapping, drops; a left-out key is unsure), and
 *    what they changed against the proposal.
 *  - `templateFromEvent`, `ticketsFixedByHand`, `sectionsFixedByHand`, `isFixedByHand`: the same template learned from one event a
 *    person arranged in the editor.
 *  - `applyClassification`, `isAppliedState`: drop + zone (and re-sync) a list of tickets by the template
 *    (confirm, learn AND build), and whether an event already holds that result.
 *  - `parseExcludedSectionsInput`, `toggleExcludedSection`, `hallExcludedSections` (round 2, Task 10): the
 *    hall's EXCLUDED map sections (`venue_maps.dropped_categories.tixstock_sections`) - the dialog's map
 *    clicks, the confirm's list, and what an event's `tx_excluded_sections` becomes. A section id is the
 *    drawing's `data-section` ("<category slug>_<section>", the format `isExcludedSection` reads).
 * A zone label with no Hebrew letter is no label (ruling R26): never "existing", never spread by a learn.
 *
 * Zones and mappings are MERGED over the existing template: ids are reused per key, zones of keys that
 * are not mentioned stay as they were, a dropped or unsure key loses its zone and its mapping.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Round אלון 1, Task 2").
 * Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (6.2).
 */
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import { isUnlabeledSectionId, unlabeledSectionGroupId } from "@/lib/tixstock-map";
import {
  cleanZoneDescription,
  isUnsellableCategory,
  isValidZoneId,
  listSectionIds,
  newZoneId,
  sectionCategory,
  ZONE_DESCRIPTION_MAX,
  ZONE_LABEL_MAX,
  type SupplierCategoryMap,
  type VenueZone,
} from "@/lib/venue-maps/svg-zones";
import { zoneFromTemplate } from "@/lib/venue-maps/zone-from-template";
import type { EventTicket } from "@/types/app.types";

/** The longest zone label (the ticket card's title) - svg-zones' cap (80, ruling R23), re-exported for the dialog and the actions. */
export { ZONE_LABEL_MAX };
/** The longest category name a confirmed row may carry. */
const CATEGORY_NAME_MAX = 200;
/**
 * How long the `classify_venue` call may take (ruling R28) - a big stadium is ~2.5K Hebrew output tokens,
 * more than the agent's 20 s (which the parse and `name_teams` keep). The dialog's wait bar fills over it.
 * Here, not in the service: the dialog (a client component) reads it.
 */
export const CLASSIFY_TIMEOUT_MS = 40_000;
/** `classifyVenue`'s refusal of a first confirm with no zone named (ruling R25). */
export const FIRST_CONFIRM_NEEDS_NAME = "name at least one zone before the first confirm";
/** The longest Hebrew name of a hall (round 2, D3) - the dialog's box, the tool's schema and the confirm's check. */
export const VENUE_HE_MAX = 80;
/** The longest map section id the hall's excluded list keeps (a TixStock `data-section` is ~10-40 characters). */
export const EXCLUDED_SECTION_MAX = 64;
/** Most sections a hall may exclude (a big stadium draws a few hundred). */
export const EXCLUDED_SECTIONS_MAX = 500;

const HEBREW_LETTER = /[א-ת]/;
/** The words that make a stand an away stand. Word-bounded, so "Getaway Lounge" is not one. */
const AWAY_WORDS = /\b(?:away|visitors?|visiting)\b/;

// ---- Types -----------------------------------------------------------------------------------------

/** One sellable category of a drawing: `category` is the slug read as words, `key` the template key. */
export type DrawingCategory = { category: string; key: string; sections: string[] };

/** A venue template, as far as these rules read it. */
export type TemplateLike = { zones: VenueZone[]; supplier_categories: SupplierCategoryMap };

/**
 * `venue_maps.dropped_categories` as keys: what the venue never sells, and the rule-drops a person kept; `sections` =
 * the map sections excluded for every show of the hall (`tixstock_sections`, round 2 Task 10 - section ids, not keys).
 */
export type DroppedCategories = { dropped: string[]; kept: string[]; sections: string[] };

/** What the model (or the rule) says about one category. `description_he` is never the model's (D4): "" in a proposal, the stored zone's in a row the template already holds. */
export type ProposedRow = {
  label_he: string;
  description_he: string;
  drop: boolean;
  drop_reason: "away" | "other" | null;
  unsure: boolean;
};

/** A category of the venue, from its tickets and/or its drawing. */
export type CategoryInput = { category: string; key: string; sections: string[]; shows: number };

/** A row of the dialog as first shown. */
export type ClassificationRow = CategoryInput &
  ProposedRow & {
    /** What `dropRule` says about the key, whether or not a person overruled it before. */
    ruleDrop: "away" | null;
    /** The drawing has sections for the category. */
    onMap: boolean;
    /** The stored template's label and description for it, when it has one IN HEBREW (ruling R26 - a label with no Hebrew letter is no label). */
    existing: { label: string; description: string } | null;
    /** A stored label with no Hebrew letter (the English slug a drawing adoption gives): the label box's placeholder, never its value; "" = none. */
    placeholder: string;
    status: "ai" | "rule_drop" | "unsure" | "existing" | "manual";
  };

/** A row of the dialog as confirmed. A dropped or unsure row may carry no label; the dialog sends no description (D4) - "" keeps the stored one. */
export type ConfirmedRow = {
  category: string;
  label_he: string;
  description_he: string;
  drop: boolean;
  unsure: boolean;
};

/** What `templateFromRows` / `templateFromEvent` hand the writer. */
export type TemplateUpdate = {
  /** The FINAL zone list (replace). */
  zones: VenueZone[];
  /** key -> zone id for the keys decided now (the write merges it into the stored mapping). */
  categoryToZone: Record<string, string>;
  /** Keys whose stored mapping goes ("" in `rememberSupplierCategories`): dropped and unsure rows. */
  forget: string[];
  /** The FINAL `dropped_categories.tixstock` list (replace). */
  dropped: string[];
  /** The FINAL `dropped_categories.tixstock_kept` list (replace). */
  kept: string[];
  /** The FINAL `dropped_categories.tixstock_sections` list (replace): the hall's excluded map sections. */
  sections: string[];
};

export type ClassificationChange = {
  category: string;
  field: "label" | "description" | "drop";
  from: string | boolean | null;
  to: string | boolean;
};

// ---- Small helpers ---------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const unique = (items: string[]): string[] => [...new Set(items)];
const hasHebrew = (text: string): boolean => HEBREW_LETTER.test(text);
/** A string, trimmed and cut to `max`; anything else is "". */
const cut = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max).trimEnd() : "";

/**
 * A hall's Hebrew name (round 2, D3): trimmed, at most `VENUE_HE_MAX`, with a Hebrew letter - else null.
 * Over the cap is no name rather than a cut one (the tool's schema says 80, the dialog's box too).
 */
export function cleanVenueHe(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name !== "" && name.length <= VENUE_HE_MAX && hasHebrew(name) ? name : null;
}

/**
 * The confirm's `venueHe`, checked: `undefined` (not sent) leaves the stored name alone, null / empty clears
 * it, a Hebrew name is set trimmed. Anything else - text with no Hebrew letter, over the cap, not text - is
 * refused (`bad_input`): a person typed it, so it is never silently dropped.
 */
export function parseVenueHeInput(raw: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  if (raw.trim() === "") return { ok: true, value: null };
  const name = cleanVenueHe(raw);
  return name === null ? { ok: false } : { ok: true, value: name };
}

/** The category as the supplier names it - what ops buy by, and what the template key is made of. */
const ticketCategory = (ticket: EventTicket): string => ticket.supplierCategory || ticket.category;
const ticketKey = (ticket: EventTicket): string => normalizeSupplierCategory(ticketCategory(ticket));
const isTixStock = (ticket: EventTicket): boolean => ticketSupplier(ticket, "tx_event") === "tixstock";

const tixstockMap = (template: TemplateLike | null): Record<string, string> =>
  template?.supplier_categories?.tixstock ?? {};
const cloneZone = (zone: VenueZone): VenueZone => ({ ...zone, sections: [...zone.sections] });
const emptyRow = (): ProposedRow => ({ label_he: "", description_he: "", drop: false, drop_reason: null, unsure: false });
/** What a category the model never answered looks like: nothing known, a person decides. */
const skippedRow = (): ProposedRow => ({ ...emptyRow(), unsure: true });

/** Zone ids that suppliers other than TixStock map to - a zone one of them uses is never pruned. */
const otherSuppliersZoneIds = (template: TemplateLike | null): string[] =>
  Object.entries(template?.supplier_categories ?? {})
    .filter(([supplier]) => supplier !== "tixstock")
    .flatMap(([, categories]) => Object.values(categories ?? {}));

/**
 * The zone list without the zones only a forgotten key used: a dropped or unsure category loses its zone
 * (its sections stay in no zone), but a zone another key, another supplier or this very update still maps
 * stays. Zones nothing maps at all (drawn by hand on the board) are not touched.
 */
function withoutOrphanedZones(
  zones: VenueZone[],
  existing: TemplateLike | null,
  forgotten: string[],
  remapped: Record<string, string>,
): VenueZone[] {
  if (forgotten.length === 0) return zones;
  const current = tixstockMap(existing);
  const gone = new Set(forgotten);
  const stillUsed = new Set<string>([
    ...Object.entries(current)
      .filter(([key]) => !gone.has(key))
      .map(([, zoneId]) => zoneId),
    ...Object.values(remapped),
    ...otherSuppliersZoneIds(existing),
  ]);
  const orphaned = new Set(
    forgotten.map((key) => current[key]).filter((zoneId): zoneId is string => !!zoneId && !stillUsed.has(zoneId)),
  );
  return zones.filter((zone) => !orphaned.has(zone.id));
}

// ---- The facts the dialog starts from ---------------------------------------------------------------

/**
 * Away stands are never sold to our customers: "away", "visitor(s)", "visiting" as whole words, any case.
 * Every caller in this module passes the normalized KEY (`normalizeSupplierCategory`), so the parenthesised
 * part of a supplier name never decides and the dialog, the confirm and the build always agree.
 */
export function dropRule(category: string): { drop: boolean; reason: "away" | null } {
  const text = typeof category === "string" ? category.toLowerCase() : "";
  return AWAY_WORDS.test(text) ? { drop: true, reason: "away" } : { drop: false, reason: null };
}

/**
 * The sellable categories of a drawing, in document order: TixStock names every section
 * `<category slug>_<section>`. The pitch and the grey filler are skipped; two spellings of one key are one
 * category holding both sections.
 */
export function drawingCategories(svg: string): DrawingCategory[] {
  const byKey = new Map<string, DrawingCategory>();
  for (const section of listSectionIds(svg)) {
    const slug = sectionCategory(section);
    const key = normalizeSupplierCategory(slug);
    if (isUnsellableCategory(key)) continue;
    const found = byKey.get(key);
    if (found) found.sections.push(section);
    else byKey.set(key, { category: slug.replace(/-+/g, " ").replace(/\s+/g, " ").trim(), key, sections: [section] });
  }
  return [...byKey.values()];
}

const keyList = (value: unknown): string[] =>
  Array.isArray(value)
    ? unique(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => normalizeSupplierCategory(item))
          .filter(Boolean),
      )
    : [];

/** A section id as the hall's list keeps it: trimmed, non-empty, at most `EXCLUDED_SECTION_MAX` - else null. */
function sectionIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id !== "" && id.length <= EXCLUDED_SECTION_MAX ? id : null;
}

/** A stored list of section ids, leniently: the usable ids, deduped, at most `EXCLUDED_SECTIONS_MAX`. */
const sectionList = (value: unknown): string[] =>
  Array.isArray(value)
    ? unique(value.map(sectionIdOf).filter((id): id is string => id !== null)).slice(0, EXCLUDED_SECTIONS_MAX)
    : [];

/** `venue_maps.dropped_categories` (`{ tixstock, tixstock_kept, tixstock_sections }`) - keys, and the section ids as they are; anything unreadable is empty. */
export function parseDroppedCategories(value: unknown): DroppedCategories {
  if (!isObject(value)) return { dropped: [], kept: [], sections: [] };
  return { dropped: keyList(value.tixstock), kept: keyList(value.tixstock_kept), sections: sectionList(value.tixstock_sections) };
}

/**
 * The confirm's `excludedSections` (round 2, Task 10), checked: `undefined` (not sent) leaves the stored list alone; a
 * list of at most `EXCLUDED_SECTIONS_MAX` strings, each non-empty once trimmed and at most `EXCLUDED_SECTION_MAX`, is
 * the hall's new list (trimmed, deduped). Anything else - not a list, a non-string, an empty or over-long id, too many -
 * is refused (`bad_input`): a person clicked it, so it is never silently cut.
 */
export function parseExcludedSectionsInput(raw: unknown): { ok: true; value: string[] | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw) || raw.length > EXCLUDED_SECTIONS_MAX) return { ok: false };
  const ids: string[] = [];
  for (const item of raw) {
    const id = sectionIdOf(item);
    if (id === null) return { ok: false };
    ids.push(id);
  }
  return { ok: true, value: unique(ids) };
}

/**
 * A click on a section of the hall's map (the dialog): excluded -> back, else excluded. The event editor's rule for a
 * legacy shared id (`upper-tier_`, saved before unlabeled wedges were numbered - `isSectionExcluded` still reads it as
 * every wedge of the group): the shared id is first expanded into one id per wedge (`groupWedges` = the numbered ids of
 * the clicked wedge's group on the drawing), so the click toggles this wedge alone.
 */
export function toggleExcludedSection(current: readonly string[], clicked: string, groupWedges: readonly string[] = []): string[] {
  let list = [...current];
  if (isUnlabeledSectionId(clicked)) {
    const group = unlabeledSectionGroupId(clicked);
    if (list.includes(group)) list = unique([...list.filter((id) => id !== group), ...groupWedges]);
  }
  return list.includes(clicked) ? list.filter((id) => id !== clicked) : [...list, clicked];
}

/**
 * What an event's `tx_excluded_sections` becomes when its hall's list is applied: `before` = the sections that came from
 * the hall (what the uploader itself last wrote to the event - the actions read it off the item's payload) follow the
 * hall (dropped from the event when the hall no longer excludes them), one a person excluded on this show alone stays,
 * and the hall's whole list is added - the zone description's rule (R21: what came from the template follows it, what a
 * person typed stays). A new build passes no list of its own: it gets the hall's.
 */
export function hallExcludedSections(own: readonly string[], before: readonly string[], hall: readonly string[]): string[] {
  const fromHall = new Set(before);
  return unique([...own.filter((id) => !fromHall.has(id)), ...hall]);
}

// ---- The model's proposal ---------------------------------------------------------------------------

/**
 * One answered category. A drop stands only with a reason (away / other) and only for a row the model is
 * sure about - "drop + unsure" is unsure, which keeps the ticket for a person to look at. A kept row whose
 * label has no Hebrew letter is unsure too: the customer reads that title. The model proposes no description
 * (round 2, D4): one it sends anyway is never read.
 */
function proposedFrom(entry: Record<string, unknown>): ProposedRow {
  const label = cut(entry.label_he, ZONE_LABEL_MAX);
  const reason = entry.drop_reason === "away" || entry.drop_reason === "other" ? entry.drop_reason : null;
  const unsure = entry.unsure === true;
  if (entry.drop === true && reason && !unsure) {
    return { label_he: label, description_he: "", drop: true, drop_reason: reason, unsure: false };
  }
  return { label_he: label, description_he: "", drop: false, drop_reason: null, unsure: unsure || !hasHebrew(label) };
}

/**
 * The model's tool output (`{ venue_he, categories: [{ category, label_he, drop, drop_reason, unsure }] }`)
 * checked field by field against the keys it was asked about. One row per asked key, in asked order: an
 * unknown category is ignored (a problem line), a key it skipped is an unsure row. `venueHe` = the hall's
 * Hebrew name when the answer holds a usable one (`cleanVenueHe`), else null - whatever became of the rows.
 * Never throws.
 */
export function parseClassification(
  answer: unknown,
  keys: string[],
): { rows: Map<string, ProposedRow>; problems: string[]; venueHe: string | null } {
  const asked = new Set(keys);
  const answered = new Map<string, ProposedRow>();
  const problems: string[] = [];
  const entries = isObject(answer) && Array.isArray(answer.categories) ? answer.categories : null;
  if (!entries) problems.push("the answer has no categories list");

  for (const entry of entries ?? []) {
    if (!isObject(entry) || typeof entry.category !== "string") {
      problems.push("an entry without a category name was ignored");
      continue;
    }
    const name = entry.category.slice(0, 80);
    const key = normalizeSupplierCategory(entry.category);
    if (!asked.has(key)) {
      problems.push(`unknown category "${name}" was ignored`);
    } else if (answered.has(key)) {
      problems.push(`category "${name}" was answered twice - the second answer was ignored`);
    } else {
      answered.set(key, proposedFrom(entry));
    }
  }

  const rows = new Map<string, ProposedRow>();
  for (const key of keys) {
    const row = answered.get(key);
    if (!row && entries) problems.push(`no answer for "${key}" - left for review`);
    rows.set(key, row ?? skippedRow());
  }
  return { rows, problems, venueHe: isObject(answer) ? cleanVenueHe(answer.venue_he) : null };
}

// ---- The dialog's rows ------------------------------------------------------------------------------

/** One entry per key, in first-seen order (its first spelling is the one shown): shows summed, sections merged. */
function collapseByKey(categories: CategoryInput[]): CategoryInput[] {
  const groups = new Map<string, CategoryInput>();
  for (const category of categories) {
    const group = groups.get(category.key);
    if (!group) {
      groups.set(category.key, { ...category, sections: unique(category.sections) });
      continue;
    }
    group.shows += category.shows;
    group.sections = unique([...group.sections, ...category.sections]);
  }
  return [...groups.values()];
}

/** The stored template's label and description for a key, when its mapping points at a zone that exists. */
function existingEntry(template: TemplateLike | null, key: string): { label: string; description: string } | null {
  const zoneId = tixstockMap(template)[key];
  const zone = zoneId ? template?.zones?.find((z) => z.id === zoneId) : undefined;
  return zone ? { label: zone.label, description: zone.description ?? "" } : null;
}

/**
 * The rows the dialog opens with, one per key. What a row shows, strongest first: the rule drop (unless a
 * person kept that key before), a category the venue already dropped, the stored template entry, the
 * model's proposal, and - with no proposal at all (`null`: AI off or failed) - an empty manual row.
 * A stored entry counts only with a Hebrew label (ruling R26): an English one (the slug a drawing adoption
 * gives) is the label box's `placeholder` and the row is the proposal's / a manual one - though a
 * description stored on it (a person wrote it in the editor) stays the row's description.
 */
export function proposalRows(
  categories: CategoryInput[],
  proposed: Map<string, ProposedRow> | null,
  template: TemplateLike | null,
  dropped: DroppedCategories,
): ClassificationRow[] {
  const droppedKeys = new Set(dropped.dropped);
  const keptKeys = new Set(dropped.kept);

  return collapseByKey(categories).map((input) => {
    const { key } = input;
    const ruleDrop = dropRule(key).reason;
    const stored = existingEntry(template, key);
    const existing = stored && hasHebrew(stored.label) ? stored : null;
    const placeholder = stored && !existing ? stored.label : "";
    const proposal = proposed?.get(key) ?? null;
    const kept = keptKeys.has(key);

    let shown: ProposedRow;
    let status: ClassificationRow["status"];
    if (existing) {
      shown = { ...emptyRow(), label_he: existing.label, description_he: existing.description };
      status = "existing";
    } else if (proposal) {
      shown = { ...proposal };
      status = proposal.unsure ? "unsure" : "ai";
    } else if (proposed === null) {
      shown = emptyRow();
      status = "manual";
    } else {
      shown = skippedRow();
      status = "unsure";
    }
    if (!existing && stored?.description) shown = { ...shown, description_he: stored.description };

    if (ruleDrop && !kept) {
      shown = { ...shown, drop: true, drop_reason: ruleDrop, unsure: false };
      status = "rule_drop";
    } else if (droppedKeys.has(key) && !kept) {
      shown = { ...shown, drop: true, drop_reason: "other", unsure: false };
      status = "existing";
    }

    return { ...input, ...shown, ruleDrop, onMap: input.sections.length > 0, existing, placeholder, status };
  });
}

// ---- What a person confirmed -------------------------------------------------------------------------

/**
 * The dialog's answer, checked on the server. `null` when anything is wrong: not a list, a row that is not
 * an object or has a wrongly typed field, a category outside `allowedKeys` or named twice, a description
 * over `ZONE_DESCRIPTION_MAX`, or a kept, sure row with no label. A label over `ZONE_LABEL_MAX` is CUT to it
 * (ruling R23): a stored label longer than the cap is prefilled into the dialog as it is, and must never
 * make every confirm at that venue fail.
 */
export function cleanConfirmedRows(raw: unknown, allowedKeys: Set<string>): ConfirmedRow[] | null {
  if (!Array.isArray(raw) || raw.length > allowedKeys.size) return null;
  const seen = new Set<string>();
  const rows: ConfirmedRow[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const { category, label_he, description_he, drop, unsure } = item;
    if (
      typeof category !== "string" ||
      typeof label_he !== "string" ||
      typeof description_he !== "string" ||
      typeof drop !== "boolean" ||
      typeof unsure !== "boolean"
    ) {
      return null;
    }
    const name = category.trim();
    const key = normalizeSupplierCategory(name);
    if (!name || name.length > CATEGORY_NAME_MAX || !allowedKeys.has(key) || seen.has(key)) return null;
    const label = cut(label_he, ZONE_LABEL_MAX);
    const description = description_he.trim();
    if (description.length > ZONE_DESCRIPTION_MAX) return null;
    if (!drop && !unsure && !label) return null;
    seen.add(key);
    rows.push({ category: name, label_he: label, description_he: description, drop, unsure });
  }
  return rows;
}

/**
 * May these confirmed rows be confirmed? With a template (ruling R19): something must be decided - a row
 * named or dropped. With NO template (ruling R25): a NAMED row (kept, sure, with a label) - the first
 * confirm adopts the drawing and moves the venue's events onto our copy, and with no zone named (only the
 * rule's away drop, say) nothing would light on it. The dialog gates its button on this, and
 * `classifyVenue` refuses a first confirm that fails it (`FIRST_CONFIRM_NEEDS_NAME`).
 */
export function readyToConfirm(rows: ConfirmedRow[], hasTemplate: boolean): boolean {
  const named = rows.some((row) => !row.drop && !row.unsure && row.label_he.trim() !== "");
  return hasTemplate ? named || rows.some((row) => row.drop) : named;
}

/**
 * The final template after a confirm, merged over the existing one (a second confirm, or the template
 * `adoptVenueMap` just wrote, is the same call):
 *  - a confirmed row (not dropped, not unsure) gets a zone: the one its key already maps to, else a new id;
 *    its label is the row's, its description the row's when it has one (the dialog sends none since round 2,
 *    D4 - the stored description stays); its sections are the drawing's for the key (several keys in
 *    one zone add up; an off-map key keeps the sections already painted on its zone, else none);
 *  - zones of keys that are not in `rows` stay as they were;
 *  - a dropped or unsure row has no zone and no mapping (`forget`);
 *  - `dropped` / `kept` are the venue's lists after this confirm: this call's decisions replace the old
 *    ones for the keys in `rows`, the old ones for other keys stay. `kept` = rule-drops a person did not drop;
 *  - `sections` = the hall's excluded map sections: the dialog's list when it sent one, else the stored list.
 */
export function templateFromRows(
  rows: ConfirmedRow[],
  drawing: DrawingCategory[],
  existing: TemplateLike | null,
  existingDropped: DroppedCategories,
  /** The dialog's excluded map sections (`parseExcludedSectionsInput`); absent = the stored list stays. */
  excludedSections?: readonly string[],
): TemplateUpdate {
  const drawn = new Map(drawing.map((category) => [category.key, category]));
  const current = tixstockMap(existing);
  let zones = (existing?.zones ?? []).map(cloneZone);
  const categoryToZone: Record<string, string> = {};
  const sectionsOf = new Map<string, Set<string>>();
  const rowKeys = new Set<string>();
  const forget: string[] = [];
  const dropped: string[] = [];
  const kept: string[] = [];

  for (const row of rows) {
    const key = normalizeSupplierCategory(row.category);
    if (!key) continue;
    rowKeys.add(key);
    if (row.drop) {
      dropped.push(key);
      forget.push(key);
      continue;
    }
    if (dropRule(key).drop) kept.push(key);
    if (row.unsure) {
      forget.push(key);
      continue;
    }

    const known = categoryToZone[key] ?? current[key];
    let zone = known ? zones.find((z) => z.id === known) : undefined;
    if (!zone) {
      zone = { id: newZoneId(key, zones), label: "", sections: [] };
      zones.push(zone);
    }
    zone.label = cut(row.label_he, ZONE_LABEL_MAX) || zone.label || drawn.get(key)?.category || cut(row.category, ZONE_LABEL_MAX);
    // The dialog has no description box (round 2, D4): an empty one clears nothing - what is stored stays.
    const description = cleanZoneDescription(row.description_he);
    if (description) zone.description = description;
    categoryToZone[key] = zone.id;

    const sections = sectionsOf.get(zone.id) ?? new Set<string>();
    for (const section of drawn.get(key)?.sections ?? []) sections.add(section);
    sectionsOf.set(zone.id, sections);
  }

  for (const zone of zones) {
    const sections = sectionsOf.get(zone.id);
    if (sections && sections.size > 0) zone.sections = [...sections];
  }
  zones = withoutOrphanedZones(zones, existing, forget, categoryToZone);

  return {
    zones,
    categoryToZone,
    forget: unique(forget),
    dropped: unique([...existingDropped.dropped.filter((key) => !rowKeys.has(key)), ...dropped]),
    kept: unique([...existingDropped.kept.filter((key) => !rowKeys.has(key)), ...kept]),
    sections: excludedSections ? unique([...excludedSections]) : [...existingDropped.sections],
  };
}

/**
 * The venue's keys a confirm left out are UNSURE (ruling R16), applied after `templateFromRows` over the
 * same `existing` template: a key the template already labels in Hebrew keeps its stored entry; every other
 * one - the English slug zone `adoptVenueMap` gives each drawing category, or no entry at all - is
 * forgotten, so no mapping remains and a zone only it used goes. `dropped` / `kept` are left as they are
 * (a left-out key is undecided, never un-dropped).
 */
export function forgetUnconfirmed(
  update: TemplateUpdate,
  existing: TemplateLike | null,
  venueKeys: string[],
  confirmed: ConfirmedRow[],
): TemplateUpdate {
  const answered = new Set(confirmed.map((row) => normalizeSupplierCategory(row.category)));
  const omitted = unique(venueKeys).filter((key) => key !== "" && !answered.has(key) && !hasHebrew(existingEntry(existing, key)?.label ?? ""));
  if (omitted.length === 0) return update;
  const forget = unique([...update.forget, ...omitted]);
  return { ...update, forget, zones: withoutOrphanedZones(update.zones, existing, forget, update.categoryToZone) };
}

// ---- Learning from one event -------------------------------------------------------------------------

/**
 * The template an event a person arranged by hand teaches (only TixStock tickets count):
 *  - a ticket with a `zoneId` maps its category to that zone (a zone the template lacks is created, with
 *    the drawing's sections for the category);
 *  - the zone's label becomes the ticket's `zoneLabel` when that differs and has a Hebrew letter - a label
 *    with none never replaces another (ruling R26);
 *  - a non-empty ticket `description` becomes the zone's description;
 *  - a category the payload (what the build wrote) had and the event no longer has is a drop - one the
 *    payload never had is not; a zoned ticket of a category the venue dropped un-drops it;
 *  - it NEVER keeps a rule-drop (`kept`, ruling R22): adopting the drawing in the editor zones every TixStock
 *    ticket, the away one included, so a zoned away ticket says nothing about the away rule - only the
 *    dialog's explicit un-drop keeps one (`templateFromRows`);
 *  - a key whose zone ends with no Hebrew label is NOT spread (ruling R26): it is not mapped, and its stored
 *    mapping is forgotten when that also points at a zone with no Hebrew label - the siblings stay unzoned
 *    for it (the panel keeps asking for a Hebrew name); the zone itself stays (the source event uses it).
 *  - the event's `tx_excluded_sections` (`eventSections`, round 2 Task 10) becomes the hall's excluded list as it is -
 *    copied, an empty one included (a person who cleared the editor's list cleared it for the hall); not handed in =
 *    the stored list stays.
 * Everything is merged over `existing`, as `templateFromRows` does. `learned` is what the confirm quotes
 * (`zones` = the Hebrew-labelled zones it maps, `sections` = how many sections the hall excludes after it).
 */
export function templateFromEvent(
  eventTickets: EventTicket[],
  payloadTickets: EventTicket[],
  existing: TemplateLike | null,
  drawing: DrawingCategory[],
  existingDropped: DroppedCategories,
  eventSections?: readonly string[],
): TemplateUpdate & { learned: { zones: number; newZones: number; dropped: string[]; descriptions: number; sections: number } } {
  const drawn = new Map(drawing.map((category) => [category.key, category]));
  let zones = (existing?.zones ?? []).map(cloneZone);
  // Tickets are compared with the zone as the template had it: a stale ticket of the same zone must not undo an edit.
  const before = new Map<string, { label: string; description: string | undefined }>(
    zones.map((zone) => [zone.id, { label: zone.label, description: zone.description }]),
  );
  const categoryToZone: Record<string, string> = {};
  const created = new Set<string>();
  const relabelled = new Set<string>();
  const described = new Set<string>();
  const eventKeys = new Set<string>();
  const zonedKeys = new Set<string>();

  for (const ticket of eventTickets) {
    if (!isTixStock(ticket)) continue;
    const key = ticketKey(ticket);
    if (!key) continue;
    eventKeys.add(key);
    const zoneId = typeof ticket.zoneId === "string" ? ticket.zoneId.trim() : "";
    if (!zoneId) continue;

    let zone = zones.find((z) => z.id === zoneId);
    if (!zone) {
      if (!isValidZoneId(zoneId)) continue;
      const label = cut(ticket.zoneLabel, ZONE_LABEL_MAX) || drawn.get(key)?.category || cut(ticketCategory(ticket), ZONE_LABEL_MAX) || zoneId;
      zone = { id: zoneId, label, sections: [] };
      zones.push(zone);
      created.add(zoneId);
      before.set(zoneId, { label, description: undefined });
    }
    if (created.has(zone.id)) {
      for (const section of drawn.get(key)?.sections ?? []) {
        if (!zone.sections.includes(section)) zone.sections.push(section);
      }
    }
    zonedKeys.add(key);
    categoryToZone[key] = zone.id;

    const was = before.get(zone.id) ?? { label: zone.label, description: undefined };
    const ticketLabel = cut(ticket.zoneLabel, ZONE_LABEL_MAX);
    if (!relabelled.has(zone.id) && ticketLabel && ticketLabel !== was.label && hasHebrew(ticketLabel)) {
      zone.label = ticketLabel;
      relabelled.add(zone.id);
    }
    const description = cleanZoneDescription(ticket.description);
    if (!described.has(zone.id) && description && description !== was.description) {
      zone.description = description;
      described.add(zone.id);
    }
  }

  // Ruling R26: a key whose zone has no Hebrew label is not spread to the siblings.
  const current = tixstockMap(existing);
  const hebrewZone = (zoneId: string | undefined): boolean => hasHebrew(zones.find((z) => z.id === zoneId)?.label ?? "");
  const unlabelled: string[] = [];
  for (const [key, zoneId] of Object.entries(categoryToZone)) {
    if (hebrewZone(zoneId)) continue;
    delete categoryToZone[key];
    if (current[key] && !hebrewZone(current[key])) unlabelled.push(key);
  }

  const payloadNames = new Map<string, string>();
  for (const ticket of payloadTickets) {
    if (!isTixStock(ticket)) continue;
    const key = ticketKey(ticket);
    if (key && !payloadNames.has(key)) payloadNames.set(key, cut(ticketCategory(ticket), CATEGORY_NAME_MAX));
  }
  const eventDropped = [...payloadNames.keys()].filter((key) => !eventKeys.has(key));
  // Only the dropped keys' zones may go: an unlabelled key's zone stays (the source event points at it).
  zones = withoutOrphanedZones(zones, existing, eventDropped, categoryToZone);
  const sections = eventSections ? sectionList(eventSections) : [...existingDropped.sections];

  return {
    zones,
    categoryToZone,
    forget: unique([...eventDropped, ...unlabelled]),
    dropped: unique([...existingDropped.dropped.filter((key) => !zonedKeys.has(key)), ...eventDropped]),
    kept: existingDropped.kept.filter((key) => !eventDropped.includes(key)),
    sections,
    learned: {
      zones: new Set(Object.values(categoryToZone)).size,
      newZones: created.size,
      dropped: eventDropped.map((key) => payloadNames.get(key) ?? key),
      descriptions: described.size,
      sections: sections.length,
    },
  };
}

/** The TixStock tickets of a stored `tickets_and_rates`; `null` when it is not a list of tickets. */
const tixstockTicketsOf = (raw: unknown): EventTicket[] | null =>
  Array.isArray(raw)
    ? raw.filter((item): item is EventTicket => isObject(item) && typeof item.category === "string").filter(isTixStock)
    : null;

/**
 * Did a person arrange this event after the build? True when its TixStock tickets differ from the
 * payload's (what the build wrote) in the set of categories, in any `zoneId`, or in a non-empty
 * `description` that is not the payload's. A price alone, a cleared description, or LiveTickets tickets
 * do not count; nor does anything unreadable.
 */
export function ticketsFixedByHand(
  payload: Record<string, unknown> | null,
  row: { tickets_and_rates: unknown } | null,
): boolean {
  if (!payload || !row) return false;
  const built = tixstockTicketsOf(payload.tickets_and_rates);
  const now = tixstockTicketsOf(row.tickets_and_rates);
  if (!built || !now) return false;

  const byKey = (list: EventTicket[]) => new Map(list.map((ticket) => [ticketKey(ticket), ticket]));
  const was = byKey(built);
  const is = byKey(now);
  if (was.size !== is.size) return true;
  for (const [key, ticket] of is) {
    const old = was.get(key);
    if (!old) return true;
    if ((ticket.zoneId || "") !== (old.zoneId || "")) return true;
    const description = typeof ticket.description === "string" ? ticket.description.trim() : "";
    const oldDescription = typeof old.description === "string" ? old.description.trim() : "";
    if (description && description !== oldDescription) return true;
  }
  return false;
}

/** A stored list of section ids (`tx_excluded_sections`): its string entries; anything else (null, missing) = none. */
const sectionIdsOf = (raw: unknown): Set<string> =>
  new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && id !== "") : []);

/**
 * Did a person change this event's excluded map sections after the build (final fix wave B4)? True when the row's
 * `tx_excluded_sections` and the payload's differ as SETS (order aside); a payload without the list reads as none.
 * No payload or no row = nothing to compare.
 */
export function sectionsFixedByHand(
  payload: Record<string, unknown> | null,
  row: { tx_excluded_sections?: unknown } | null,
): boolean {
  if (!payload || !row) return false;
  const was = sectionIdsOf(payload.tx_excluded_sections);
  const is = sectionIdsOf(row.tx_excluded_sections);
  if (was.size !== is.size) return true;
  for (const id of is) if (!was.has(id)) return true;
  return false;
}

/**
 * The board's "fixed by hand" for one item (`getRun`'s `fixedByHand`, the panel's `fixed` venue row and the
 * card's learn button): `ticketsFixedByHand` or `sectionsFixedByHand` (an editor save that only excluded map
 * sections unlocks the learn too - B4), until the item has taught the venue (ruling R20). A learn never rewrites its
 * source event, so the payload's tickets keep differing for ever; once the decisions carry `taught_venue` the item
 * stops counting and the venue row falls back to `new` / `unzoned` by its warnings.
 */
export function isFixedByHand(
  item: { payload: Record<string, unknown> | null; decisions: { code: string }[] },
  row: { tickets_and_rates: unknown; tx_excluded_sections?: unknown } | null,
): boolean {
  if (item.decisions.some((d) => d.code === "taught_venue")) return false;
  return ticketsFixedByHand(item.payload, row) || sectionsFixedByHand(item.payload, row);
}

// ---- Apply -------------------------------------------------------------------------------------------

/**
 * A TixStock ticket that already has a zone, brought in step with the template (ruling R21 - the editor's
 * zones board keeps the same invariant on a save): its `zoneLabel` is the zone's current label; its
 * `description` follows the zone's when the ticket's is empty or is the one the PREVIOUS template gave that
 * zone (it came from the template, so it follows it) - one a person typed stays. A zone gone from the
 * template clears `zoneId` / `zoneLabel` (and a description that came from that zone), so the ticket is zoned
 * by the mapping like a new one, or listed as unzoned. A ticket already in step is handed back as is.
 */
function inStepWithTemplate(ticket: EventTicket, zones: Map<string, VenueZone>, previous: Map<string, VenueZone>): EventTicket {
  if (!isTixStock(ticket) || !ticket.zoneId) return ticket;
  const own = (ticket.description ?? "").trim();
  const fromTemplate = (previous.get(ticket.zoneId)?.description ?? "").trim();
  const zone = zones.get(ticket.zoneId);
  if (!zone) {
    const cleared: EventTicket = { ...ticket };
    delete cleared.zoneId;
    delete cleared.zoneLabel;
    if (own !== "" && own === fromTemplate) cleared.description = "";
    return cleared;
  }
  const description = own === "" || own === fromTemplate ? (zone.description ?? "") : ticket.description;
  if (ticket.zoneLabel === zone.label && description === ticket.description) return ticket;
  return { ...ticket, zoneLabel: zone.label, description };
}

/**
 * Drop and zone a list of tickets by a classified venue - the dialog's confirm, the learn and the build's
 * ticket step run this same function. A TixStock ticket leaves when its key is in the venue's dropped list or
 * the rule drops its key, unless the key is in `kept`. Every TixStock ticket that already has a zone is then
 * brought in step with the template (`inStepWithTemplate`, ruling R21; `previous` = the template before this
 * write - the confirm and the learn pass it, the build passes `null`); the rest go through `zoneFromTemplate`
 * (the zone's description lands on an empty one only). `dropped` = the category of each removed key;
 * `unzoned` = the category of every TIXSTOCK ticket left without a zone. A LiveTickets ticket is never
 * touched nor listed: a classification writes the TixStock template only, and zoning LiveTickets is the
 * editor's board (ruling R17) - listing it would keep the show's `unzoned_review` (and the panel's venue row)
 * for ever. `tx_excluded_sections` = what the event's excluded map sections become (`hallExcludedSections` over
 * `sections` = the event's list now and the part of it that came from the hall - the confirm and the learn pass them;
 * the build passes none, so a new event gets exactly the hall's `dropped.sections`).
 */
export function applyClassification(
  tickets: EventTicket[],
  template: TemplateLike,
  dropped: DroppedCategories,
  previous: TemplateLike | null = null,
  sections: { current: readonly string[]; before: readonly string[] } | null = null,
): { tickets: EventTicket[]; dropped: string[]; unzoned: string[]; tx_excluded_sections: string[] } {
  const listed = new Set(dropped.dropped);
  const kept = new Set(dropped.kept);
  const zonesById = new Map(template.zones.map((zone) => [zone.id, zone]));
  const previousById = new Map((previous?.zones ?? []).map((zone) => [zone.id, zone]));

  const staying: EventTicket[] = [];
  const removed = new Map<string, string>();
  for (const ticket of tickets) {
    const key = ticketKey(ticket);
    if (isTixStock(ticket) && key && !kept.has(key) && (listed.has(key) || dropRule(key).drop)) {
      if (!removed.has(key)) removed.set(key, ticket.category);
      continue;
    }
    staying.push(inStepWithTemplate(ticket, zonesById, previousById));
  }

  const zoned = zoneFromTemplate(staying, "tx_event", template);
  return {
    tickets: zoned,
    dropped: [...removed.values()],
    unzoned: zoned.filter((ticket) => isTixStock(ticket) && !ticket.zoneId).map((ticket) => ticket.category),
    tx_excluded_sections: hallExcludedSections(sections?.current ?? [], sections?.before ?? [], dropped.sections),
  };
}

/** A value with every object's keys in order, so two equal values print alike whatever order their keys came in. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedKeys(value[key])]),
  );
}

/** Two lists of section ids hold the same ids (order and repeats aside). */
const sameSections = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/**
 * Is this event already in the state a classification would write (ruling R27): the same map and the same
 * tickets, deep (key order aside) - and, when `excludedSections` is given, the same excluded map sections (a null
 * column = none)? The rewrite skips such an event, so a second confirm after a cut-off one goes on where the first
 * stopped instead of rewriting what is done.
 */
export function isAppliedState(
  row: { tickets_and_rates: EventTicket[]; map_image_url: string | null; tx_excluded_sections?: readonly string[] | null },
  tickets: EventTicket[],
  mapUrl: string,
  excludedSections?: readonly string[],
): boolean {
  if (row.map_image_url !== mapUrl || JSON.stringify(sortedKeys(row.tickets_and_rates)) !== JSON.stringify(sortedKeys(tickets))) return false;
  return excludedSections === undefined || sameSections(row.tx_excluded_sections ?? [], excludedSections);
}

// ---- The confirm's answer -----------------------------------------------------------------------------

/**
 * The classification confirm's / the learn's answer once the events were rewritten. An item that could not be
 * recorded makes it a `db_error` (a second confirm is a no-op merge that records it). A description rewrite
 * that did not finish never does (`describeFailed`, round 2 D3): the classification itself is saved by then, so
 * the answer stays `ok` with the flag - the dialog says so, and the next confirm fills what is left.
 */
export function classifyResultOf(
  rewrite: { eventIds: number[]; reached: number; itemsFailed: number },
  total: number,
  counts: { zones: number; dropped: number; unsure: number },
  describeFailed = false,
):
  | { ok: true; events: number; reached: number; total: number; zones: number; dropped: number; unsure: number; describeFailed?: boolean }
  | { ok: false; kind: string; message?: string } {
  if (rewrite.itemsFailed > 0) {
    return { ok: false, kind: "db_error", message: `${rewrite.eventIds.length} events were rewritten, but ${rewrite.itemsFailed} show(s) could not be saved - confirm again` };
  }
  return { ok: true, events: rewrite.eventIds.length, reached: rewrite.reached, total, ...counts, ...(describeFailed ? { describeFailed: true } : {}) };
}

// ---- What a person changed ---------------------------------------------------------------------------

/**
 * What a person changed against what the dialog showed them - the lessons and the audit rows quote it
 * ("a row confirmed as proposed writes nothing"). Per confirmed row, in this order: its label (a kept, sure
 * row with a non-empty new label), its description, and its drop.
 *
 * CONTRACT: `proposed` is the rows AS THE DIALOG SHOWED THEM, keyed by `key` - the `proposalRows` output
 * (a `ClassificationRow` is a `ProposedRow`), which already carries the rule drops, the venue's dropped /
 * kept lists and the stored template's labels and descriptions. Nothing is re-derived here (no `dropRule`),
 * so a row left as shown is no change, whatever put it in that state. A key the dialog did not show has
 * nothing to compare and is skipped.
 *  - `null` (nothing was proposed, a manual fill): every kept, sure row's label and description, `from: null`.
 */
export function classificationDiff(
  proposed: Map<string, ProposedRow> | null,
  confirmed: ConfirmedRow[],
): ClassificationChange[] {
  const changes: ClassificationChange[] = [];
  for (const row of confirmed) {
    const named = !row.drop && !row.unsure;
    if (proposed === null) {
      if (named && row.label_he) changes.push({ category: row.category, field: "label", from: null, to: row.label_he });
      if (named && row.description_he) changes.push({ category: row.category, field: "description", from: null, to: row.description_he });
      continue;
    }

    const shown = proposed.get(normalizeSupplierCategory(row.category));
    if (!shown) continue;
    if (named) {
      if (row.label_he && row.label_he !== shown.label_he) {
        changes.push({ category: row.category, field: "label", from: shown.label_he || null, to: row.label_he });
      }
      if (row.description_he !== shown.description_he) {
        changes.push({ category: row.category, field: "description", from: shown.description_he || null, to: row.description_he });
      }
    }
    if (row.drop !== shown.drop) changes.push({ category: row.category, field: "drop", from: shown.drop, to: row.drop });
  }
  return changes;
}
