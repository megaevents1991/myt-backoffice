/**
 * A venue map we own: the zone model + stamping zones onto the SVG drawing.
 * Pure (no DB, no DOM) - runs in server actions and is unit-testable.
 *
 * The published SVG is the source drawing with `data-zones="<ids>"` on every
 * `[data-section]` element. Main's map (lib/tixstock-map.ts ZONES_ATTR) lights
 * a section for a ticket when the ticket's `zoneId` is in that list. A section
 * may sit in several zones: suppliers overlap ("Premium" = level 2 centre,
 * "Premium Plus" = levels 1-2 centre).
 */
import { normalizeSupplierCategory } from "@/lib/suppliers";

export type VenueZone = {
  /** Stable slug, stamped into the SVG and onto tickets. Never reused. */
  id: string;
  /** Customer-facing Hebrew name - the ticket card's title. */
  label: string;
  /** `data-section` ids of the source drawing that belong to this zone. */
  sections: string[];
};

/** supplier → normalized supplier category → zone id. The venue template. */
export type SupplierCategoryMap = Record<string, Record<string, string>>;

export type VenueMap = {
  id: string;
  name: string;
  source_url: string;
  svg_url: string | null;
  zones: VenueZone[];
  supplier_categories: SupplierCategoryMap;
};

export const ZONES_ATTR = "data-zones";

const SECTION_TAG =
  /<([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*)(\/?)>/g;
const SECTION_ID = /\sdata-section\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const EXISTING_ZONES = /\sdata-zones\s*=\s*(?:"[^"]*"|'[^']*')/g;

const decodeEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Every distinct `data-section` id in the drawing, in document order. */
export function listSectionIds(svg: string): string[] {
  const seen = new Set<string>();
  for (const tag of svg.matchAll(SECTION_TAG)) {
    const match = SECTION_ID.exec(tag[2]);
    if (!match) continue;
    seen.add(decodeEntities(match[1] ?? match[2] ?? ""));
  }
  return [...seen];
}

/**
 * Stamp `data-zones` on every section of the drawing. Sections outside any
 * zone get an EMPTY attribute on purpose: its presence is how main knows this
 * is one of our maps and must be matched by zone, not by supplier names.
 * Idempotent - restamping replaces the previous attribute.
 */
export function stampZones(svg: string, zones: VenueZone[]): string {
  const zonesBySection = new Map<string, string[]>();
  for (const zone of zones) {
    for (const section of zone.sections) {
      const list = zonesBySection.get(section) ?? [];
      if (!list.includes(zone.id)) list.push(zone.id);
      zonesBySection.set(section, list);
    }
  }

  return svg.replace(SECTION_TAG, (whole, name, attrs: string, close) => {
    const match = SECTION_ID.exec(attrs);
    if (!match) return whole;
    const sectionId = decodeEntities(match[1] ?? match[2] ?? "");
    const zoneIds = (zonesBySection.get(sectionId) ?? []).join(" ");
    const cleaned = attrs.replace(EXISTING_ZONES, "").replace(/\s+$/, "");
    return `<${name}${cleaned} ${ZONES_ATTR}="${zoneIds}"${close ? " /" : ""}>`;
  });
}

/**
 * TixStock names every section `<category slug>_<section>`, so the drawing
 * itself says which of the supplier's categories a section belongs to.
 */
export const sectionCategory = (sectionId: string): string => {
  const cut = sectionId.lastIndexOf("_");
  return cut > 0 ? sectionId.slice(0, cut) : sectionId;
};

/**
 * Parts of a drawing nobody sells: the pitch, blocked stands, and TixStock's
 * "gray-fields" filler for stands it has no listings category for.
 */
const isUnsellableCategory = (normalized: string): boolean =>
  !normalized ||
  normalized === "field" ||
  normalized === "pitch" ||
  /^gr[ae]y fields?$/.test(normalized) ||
  /\bdisabled\b/.test(normalized);

/**
 * Starting zones for a freshly adopted drawing: one zone per supplier category
 * the drawing is already sliced into, holding all of that category's sections.
 * The operator only renames them; finer zones are added later, when a second
 * supplier slices the stand differently.
 *
 * `labelFor` gets the normalized category and may return the name to show the
 * customer (the ticket's Hebrew description); otherwise the category's own
 * name is used. `categoryToZone` is the venue template for that supplier.
 */
export function zonesFromCategories(
  svg: string,
  labelFor: (normalizedCategory: string) => string | undefined,
): { zones: VenueZone[]; categoryToZone: Record<string, string> } {
  const zones: VenueZone[] = [];
  const categoryToZone: Record<string, string> = {};

  for (const section of listSectionIds(svg)) {
    const category = sectionCategory(section);
    const key = normalizeSupplierCategory(category);
    if (isUnsellableCategory(key)) continue;

    const existing = zones.find((z) => z.id === categoryToZone[key]);
    if (existing) {
      existing.sections.push(section);
      continue;
    }
    const label =
      labelFor(key)?.trim().slice(0, 80) ||
      category.replace(/-+/g, " ").replace(/\s+/g, " ").trim();
    const zone: VenueZone = {
      id: newZoneId(key, zones),
      label,
      sections: [section],
    };
    zones.push(zone);
    categoryToZone[key] = zone.id;
  }
  return { zones, categoryToZone };
}

/** Id for a new zone: latin slug of the label when it has one, else `zone-N`. */
export function newZoneId(label: string, existing: VenueZone[]): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "zone";
  const taken = new Set(existing.map((z) => z.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Zone ids must be safe inside a space-separated attribute. */
export const isValidZoneId = (id: string): boolean =>
  /^[a-z0-9][a-z0-9-]*$/.test(id);
