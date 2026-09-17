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
