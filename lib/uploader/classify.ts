/**
 * Venue classification (tour uploader, round "אלון 1") - the rules behind the "classify venue" dialog,
 * the build's ticket step and "learn from one event". Pure: no DB, no network, no `server-only`; the
 * server actions read the rows and the drawing and hand them in, this module decides.
 *
 * A venue's TixStock tickets are sorted by a KEY - `normalizeSupplierCategory(category)`, the key the
 * venue template (`venue_maps.supplier_categories.tixstock`) and `venue_maps.dropped_categories` use:
 *  - `dropRule`, `drawingCategories`, `parseDroppedCategories`: the facts the dialog starts from.
 *  - `parseClassification`, `proposalRows`: the model's proposal checked, and the dialog's rows
 *    (stored label > proposal, the code rule for "away" stands first).
 *  - `cleanConfirmedRows`, `templateFromRows`, `classificationDiff`: what a person confirmed -> the
 *    final template (zones, mapping, drops), and what they changed against the proposal.
 *  - `templateFromEvent`, `ticketsFixedByHand`: the same template learned from one event a person
 *    arranged in the editor.
 *  - `applyClassification`: drop + zone a list of tickets by the template (confirm AND build).
 *
 * Zones and mappings are MERGED over the existing template: ids are reused per key, zones of keys that
 * are not mentioned stay as they were, a dropped or unsure key loses its zone and its mapping.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Round אלון 1, Task 2").
 * Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (6.2).
 */
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import {
  cleanZoneDescription,
  isUnsellableCategory,
  isValidZoneId,
  listSectionIds,
  newZoneId,
  sectionCategory,
  ZONE_DESCRIPTION_MAX,
  type SupplierCategoryMap,
  type VenueZone,
} from "@/lib/venue-maps/svg-zones";
import { zoneFromTemplate } from "@/lib/venue-maps/zone-from-template";
import type { EventTicket } from "@/types/app.types";

/** The longest zone label (the ticket card's title) the dialog and the model may give. */
export const ZONE_LABEL_MAX = 40;
/** The longest category name a confirmed row may carry. */
const CATEGORY_NAME_MAX = 200;

const HEBREW_LETTER = /[א-ת]/;
/** The words that make a stand an away stand. Word-bounded, so "Getaway Lounge" is not one. */
const AWAY_WORDS = /\b(?:away|visitors?|visiting)\b/;

// ---- Types -----------------------------------------------------------------------------------------

/** One sellable category of a drawing: `category` is the slug read as words, `key` the template key. */
export type DrawingCategory = { category: string; key: string; sections: string[] };

/** A venue template, as far as these rules read it. */
export type TemplateLike = { zones: VenueZone[]; supplier_categories: SupplierCategoryMap };

/** `venue_maps.dropped_categories` as keys: what the venue never sells, and the rule-drops a person kept. */
export type DroppedCategories = { dropped: string[]; kept: string[] };

/** What the model (or the rule) says about one category. */
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
    /** The stored template's label and description for it, when it has one. */
    existing: { label: string; description: string } | null;
    status: "ai" | "rule_drop" | "unsure" | "existing" | "manual";
  };

/** A row of the dialog as confirmed. A dropped or unsure row may carry no label. */
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

/** `venue_maps.dropped_categories` (`{ tixstock, tixstock_kept }`) as keys; anything unreadable is empty. */
export function parseDroppedCategories(value: unknown): DroppedCategories {
  if (!isObject(value)) return { dropped: [], kept: [] };
  return { dropped: keyList(value.tixstock), kept: keyList(value.tixstock_kept) };
}

// ---- The model's proposal ---------------------------------------------------------------------------

/**
 * One answered category. A drop stands only with a reason (away / other) and only for a row the model is
 * sure about - "drop + unsure" is unsure, which keeps the ticket for a person to look at. A kept row whose
 * label has no Hebrew letter is unsure too: the customer reads that title.
 */
function proposedFrom(entry: Record<string, unknown>): ProposedRow {
  const label = cut(entry.label_he, ZONE_LABEL_MAX);
  const description = cleanZoneDescription(entry.description_he) ?? "";
  const reason = entry.drop_reason === "away" || entry.drop_reason === "other" ? entry.drop_reason : null;
  const unsure = entry.unsure === true;
  if (entry.drop === true && reason && !unsure) {
    return { label_he: label, description_he: description, drop: true, drop_reason: reason, unsure: false };
  }
  return { label_he: label, description_he: description, drop: false, drop_reason: null, unsure: unsure || !hasHebrew(label) };
}

/**
 * The model's tool output (`{ categories: [{ category, label_he, description_he, drop, drop_reason, unsure }] }`)
 * checked field by field against the keys it was asked about. One row per asked key, in asked order: an
 * unknown category is ignored (a problem line), a key it skipped is an unsure row. Never throws.
 */
export function parseClassification(
  answer: unknown,
  keys: string[],
): { rows: Map<string, ProposedRow>; problems: string[] } {
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
  return { rows, problems };
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
    const existing = existingEntry(template, key);
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

    if (ruleDrop && !kept) {
      shown = { ...shown, drop: true, drop_reason: ruleDrop, unsure: false };
      status = "rule_drop";
    } else if (droppedKeys.has(key) && !kept) {
      shown = { ...shown, drop: true, drop_reason: "other", unsure: false };
      status = "existing";
    }

    return { ...input, ...shown, ruleDrop, onMap: input.sections.length > 0, existing, status };
  });
}

// ---- What a person confirmed -------------------------------------------------------------------------

/**
 * The dialog's answer, checked on the server. `null` when anything is wrong: not a list, a row that is not
 * an object or has a wrongly typed field, a category outside `allowedKeys` or named twice, a label over
 * `ZONE_LABEL_MAX` or a description over `ZONE_DESCRIPTION_MAX`, or a kept, sure row with no label.
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
    const label = label_he.trim();
    const description = description_he.trim();
    if (label.length > ZONE_LABEL_MAX || description.length > ZONE_DESCRIPTION_MAX) return null;
    if (!drop && !unsure && !label) return null;
    seen.add(key);
    rows.push({ category: name, label_he: label, description_he: description, drop, unsure });
  }
  return rows;
}

/**
 * The final template after a confirm, merged over the existing one (a second confirm, or the template
 * `adoptVenueMap` just wrote, is the same call):
 *  - a confirmed row (not dropped, not unsure) gets a zone: the one its key already maps to, else a new id;
 *    its label and description are the row's; its sections are the drawing's for the key (several keys in
 *    one zone add up; an off-map key keeps the sections already painted on its zone, else none);
 *  - zones of keys that are not in `rows` stay as they were;
 *  - a dropped or unsure row has no zone and no mapping (`forget`);
 *  - `dropped` / `kept` are the venue's lists after this confirm: this call's decisions replace the old
 *    ones for the keys in `rows`, the old ones for other keys stay. `kept` = rule-drops a person did not drop.
 */
export function templateFromRows(
  rows: ConfirmedRow[],
  drawing: DrawingCategory[],
  existing: TemplateLike | null,
  existingDropped: DroppedCategories,
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
    const touched = sectionsOf.has(zone.id);
    zone.label = cut(row.label_he, ZONE_LABEL_MAX) || zone.label || drawn.get(key)?.category || cut(row.category, ZONE_LABEL_MAX);
    const description = cleanZoneDescription(row.description_he);
    if (description) zone.description = description;
    else if (!touched) delete zone.description;
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
  };
}

// ---- Learning from one event -------------------------------------------------------------------------

/**
 * The template an event a person arranged by hand teaches (only TixStock tickets count):
 *  - a ticket with a `zoneId` maps its category to that zone (a zone the template lacks is created, with
 *    the drawing's sections for the category);
 *  - the zone's label becomes the ticket's `zoneLabel` when the template's has no Hebrew letter, or when
 *    the ticket's differs and has one - so a Hebrew label never gives way to a latin one;
 *  - a non-empty ticket `description` becomes the zone's description;
 *  - a category the payload (what the build wrote) had and the event no longer has is a drop - one the
 *    payload never had is not; a zoned ticket of a category the rule drops keeps it (`kept`), and of a
 *    category the venue dropped un-drops it.
 * Everything is merged over `existing`, as `templateFromRows` does. `learned` is what the confirm quotes.
 */
export function templateFromEvent(
  eventTickets: EventTicket[],
  payloadTickets: EventTicket[],
  existing: TemplateLike | null,
  drawing: DrawingCategory[],
  existingDropped: DroppedCategories,
): TemplateUpdate & { learned: { zones: number; newZones: number; dropped: string[]; descriptions: number } } {
  const drawn = new Map(drawing.map((category) => [category.key, category]));
  let zones = (existing?.zones ?? []).map(cloneZone);
  // Tickets are compared with the zone as the template had it: a stale ticket of the same zone must not undo an edit.
  const before = new Map<string, { label: string; description: string | undefined }>(
    zones.map((zone) => [zone.id, { label: zone.label, description: zone.description }]),
  );
  const categoryToZone: Record<string, string> = {};
  const created = new Set<string>();
  const mapped = new Set<string>();
  const relabelled = new Set<string>();
  const described = new Set<string>();
  const eventKeys = new Set<string>();
  const zonedKeys = new Set<string>();
  const ruleKept: string[] = [];

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
    mapped.add(zone.id);
    categoryToZone[key] = zone.id;
    if (dropRule(key).drop) ruleKept.push(key);

    const was = before.get(zone.id) ?? { label: zone.label, description: undefined };
    const ticketLabel = cut(ticket.zoneLabel, ZONE_LABEL_MAX);
    if (!relabelled.has(zone.id) && ticketLabel && ticketLabel !== was.label && (!hasHebrew(was.label) || hasHebrew(ticketLabel))) {
      zone.label = ticketLabel;
      relabelled.add(zone.id);
    }
    const description = cleanZoneDescription(ticket.description);
    if (!described.has(zone.id) && description && description !== was.description) {
      zone.description = description;
      described.add(zone.id);
    }
  }

  const payloadNames = new Map<string, string>();
  for (const ticket of payloadTickets) {
    if (!isTixStock(ticket)) continue;
    const key = ticketKey(ticket);
    if (key && !payloadNames.has(key)) payloadNames.set(key, cut(ticketCategory(ticket), CATEGORY_NAME_MAX));
  }
  const eventDropped = [...payloadNames.keys()].filter((key) => !eventKeys.has(key));
  zones = withoutOrphanedZones(zones, existing, eventDropped, categoryToZone);

  return {
    zones,
    categoryToZone,
    forget: eventDropped,
    dropped: unique([...existingDropped.dropped.filter((key) => !zonedKeys.has(key)), ...eventDropped]),
    kept: unique([...existingDropped.kept.filter((key) => !eventDropped.includes(key)), ...ruleKept]),
    learned: {
      zones: mapped.size,
      newZones: created.size,
      dropped: eventDropped.map((key) => payloadNames.get(key) ?? key),
      descriptions: described.size,
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

// ---- Apply -------------------------------------------------------------------------------------------

/**
 * Drop and zone a list of tickets by a classified venue - the dialog's confirm and the build's ticket step
 * run this same function. A TixStock ticket leaves when its key is in the venue's dropped list or the rule
 * drops its key, unless the key is in `kept`. The rest go through `zoneFromTemplate` (the zone's
 * description lands on an empty one only). `dropped` = the category of each removed key;
 * `unzoned` = the category of EVERY ticket left without a zone, LiveTickets included.
 */
export function applyClassification(
  tickets: EventTicket[],
  template: TemplateLike,
  dropped: DroppedCategories,
): { tickets: EventTicket[]; dropped: string[]; unzoned: string[] } {
  const listed = new Set(dropped.dropped);
  const kept = new Set(dropped.kept);

  const staying: EventTicket[] = [];
  const removed = new Map<string, string>();
  for (const ticket of tickets) {
    const key = ticketKey(ticket);
    if (isTixStock(ticket) && key && !kept.has(key) && (listed.has(key) || dropRule(key).drop)) {
      if (!removed.has(key)) removed.set(key, ticket.category);
      continue;
    }
    staying.push(ticket);
  }

  const zoned = zoneFromTemplate(staying, "tx_event", template);
  return {
    tickets: zoned,
    dropped: [...removed.values()],
    unzoned: zoned.filter((ticket) => !ticket.zoneId).map((ticket) => ticket.category),
  };
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
