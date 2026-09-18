"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { normalizeSupplierCategory, SUPPLIERS } from "@/lib/suppliers";
import {
  isValidZoneId,
  listSectionIds,
  stampZones,
  zonesFromCategories,
  type SupplierCategoryMap,
  type VenueMap,
  type VenueZone,
} from "@/lib/venue-maps/svg-zones";

// venue_maps isn't in the generated Database type yet - cast like venue-memory.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Venue maps we own. `public_resources` rather than `map_images`: that bucket
 * only accepts png/jpeg up to 512KB, an SVG drawing is neither.
 */
const BUCKET = "public_resources";
const sourcePath = (id: string) => `venue-maps/${id}/source.svg`;
const publishedPath = (id: string) => `venue-maps/${id}/map.svg`;

/** Supplier hosts a drawing may be adopted from. */
const ADOPTABLE_HOSTS = new Set(["tixstock.s3.eu-west-2.amazonaws.com"]);
const MAX_SVG_BYTES = 2_000_000;

const COLUMNS = "id,name,source_url,svg_url,zones,supplier_categories";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

function sanitizeZones(
  zones: VenueZone[],
  knownSections: Set<string>,
): Result<VenueZone[]> {
  const seen = new Set<string>();
  const clean: VenueZone[] = [];
  for (const zone of zones) {
    const id = String(zone.id ?? "").trim();
    const label = String(zone.label ?? "").trim();
    if (!isValidZoneId(id)) return fail(`Invalid zone id "${id}"`);
    if (seen.has(id)) return fail(`Duplicate zone id "${id}"`);
    if (!label) return fail(`Zone "${id}" has no label`);
    seen.add(id);
    clean.push({
      id,
      label,
      sections: [...new Set(zone.sections ?? [])].filter((s) =>
        knownSections.has(s),
      ),
    });
  }
  return { ok: true, data: clean };
}

async function readSource(id: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(sourcePath(id));
  if (error || !data) {
    console.error("venue-map: source download failed", JSON.stringify(error));
    return null;
  }
  return data.text();
}

/** Stamp `zones` onto our source copy and publish it at the stable map URL. */
async function publish(id: string, zones: VenueZone[]): Promise<string | null> {
  const source = await readSource(id);
  if (!source) return null;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(publishedPath(id), Buffer.from(stampZones(source, zones), "utf8"), {
      contentType: "image/svg+xml",
      upsert: true,
      // The URL is stable (events keep pointing at it), so keep the CDN copy
      // short-lived - a zone edit shows on the site within a minute.
      cacheControl: "60",
    });
  if (error) {
    console.error("venue-map: publish failed", JSON.stringify(error));
    return null;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(publishedPath(id)).data
    .publicUrl;
}

async function findByColumn(
  column: "svg_url" | "source_url",
  url: string,
): Promise<VenueMap | null> {
  const { data, error } = await db
    .from("venue_maps")
    .select(COLUMNS)
    .eq(column, url)
    .maybeSingle();
  if (error) {
    console.error("venue-map: lookup failed", JSON.stringify(error));
    return null;
  }
  return (data as VenueMap | null) ?? null;
}

/** The venue map behind an event's `map_image_url` - ours or a supplier's. */
export async function getVenueMapByUrl(
  mapUrl: string,
): Promise<VenueMap | null> {
  await requireStaff();
  if (!mapUrl) return null;
  return (
    (await findByColumn("svg_url", mapUrl)) ??
    (await findByColumn("source_url", mapUrl))
  );
}

/** Our source copy of the drawing + its section ids, for the zone editor. */
export async function getVenueMapDrawing(
  id: string,
): Promise<Result<{ svg: string; sections: string[] }>> {
  await requireStaff();
  const svg = await readSource(id);
  if (!svg) return fail("Could not read the map drawing");
  return { ok: true, data: { svg, sections: listSectionIds(svg) } };
}

/** Venue maps we own - for "this is the same stadium, new season". */
export async function listVenueMaps(): Promise<
  { id: string; name: string; zones: number }[]
> {
  await requireStaff();
  const { data, error } = await db
    .from("venue_maps")
    .select("id,name,zones")
    .not("svg_url", "is", null)
    .order("name", { ascending: true });
  if (error) {
    console.error("venue-map: list failed", JSON.stringify(error));
    return [];
  }
  return ((data ?? []) as Pick<VenueMap, "id" | "name" | "zones">[]).map(
    (map) => ({ id: map.id, name: map.name, zones: map.zones.length }),
  );
}

export type AdoptVenueMapOptions = {
  /**
   * normalized TixStock category → the name its zone should get (the ticket's
   * Hebrew description). Categories without one keep the supplier's name.
   */
  categoryLabels?: Record<string, string>;
  /**
   * Same stadium, new season: TixStock published a new file for a venue we
   * already zoned. Start from that venue's zones and template - sections that
   * no longer exist in the new drawing are dropped.
   */
  copyFromId?: string;
};

/** Zones + template of an existing venue, cut down to the sections of a new drawing. */
async function zonesCopiedFrom(
  venueMapId: string,
  knownSections: Set<string>,
): Promise<{ zones: VenueZone[]; template: SupplierCategoryMap } | null> {
  const { data, error } = await db
    .from("venue_maps")
    .select("zones,supplier_categories")
    .eq("id", venueMapId)
    .maybeSingle();
  if (error || !data) return null;

  const kept = sanitizeZones(data.zones as VenueZone[], knownSections);
  if (!kept.ok) return null;
  const zones = kept.data.filter((zone) => zone.sections.length > 0);
  if (zones.length === 0) return null;

  const alive = new Set(zones.map((zone) => zone.id));
  const template: SupplierCategoryMap = {};
  for (const [supplier, categories] of Object.entries(
    (data.supplier_categories ?? {}) as SupplierCategoryMap,
  )) {
    template[supplier] = Object.fromEntries(
      Object.entries(categories).filter(([, zoneId]) => alive.has(zoneId)),
    );
  }
  return { zones, template };
}

/**
 * Take ownership of a supplier's drawing: copy it into our storage, create
 * its venue map and publish it WITH starting zones - one per TixStock category
 * the drawing is already sliced into (or the zones of the same stadium's
 * previous season). TixStock tickets are linked through the template right
 * away; the operator only renames. Adopting the same drawing twice returns
 * the existing map - one venue map per drawing.
 */
export async function adoptVenueMap(
  sourceUrl: string,
  name: string,
  options: AdoptVenueMapOptions = {},
): Promise<Result<VenueMap>> {
  await requireStaff();

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return fail("Invalid map URL");
  }
  if (!ADOPTABLE_HOSTS.has(parsed.hostname)) {
    return fail("This map is not a supplier SVG we can adopt");
  }

  const existing = await findByColumn("source_url", sourceUrl);
  if (existing) return { ok: true, data: existing };

  let svg: string;
  try {
    const res = await fetch(parsed.toString(), { cache: "no-store" });
    if (!res.ok) return fail(`Supplier map returned ${res.status}`);
    svg = await res.text();
  } catch (error) {
    console.error("venue-map: source fetch failed", error);
    return fail("Could not download the supplier map");
  }
  if (!svg.includes("<svg") || svg.length > MAX_SVG_BYTES) {
    return fail("The supplier map is not a usable SVG");
  }
  if (listSectionIds(svg).length === 0) {
    return fail("The supplier map has no sections to zone");
  }

  const { data: row, error: insertError } = await db
    .from("venue_maps")
    .insert({ name: name.trim() || parsed.pathname, source_url: sourceUrl })
    .select(COLUMNS)
    .single();
  if (insertError || !row) {
    console.error("venue-map: insert failed", JSON.stringify(insertError));
    return fail("Could not create the venue map");
  }
  const map = row as VenueMap;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(sourcePath(map.id), Buffer.from(svg, "utf8"), {
      contentType: "image/svg+xml",
      upsert: true,
    });
  if (uploadError) {
    console.error(
      "venue-map: source upload failed",
      JSON.stringify(uploadError),
    );
    await db.from("venue_maps").delete().eq("id", map.id);
    return fail("Could not store the map drawing");
  }

  const copied = options.copyFromId
    ? await zonesCopiedFrom(options.copyFromId, new Set(listSectionIds(svg)))
    : null;
  const labels = options.categoryLabels ?? {};
  const fromCategories = copied
    ? null
    : zonesFromCategories(svg, (category) => labels[category]);
  const zones = copied?.zones ?? fromCategories?.zones ?? [];
  const supplierCategories: SupplierCategoryMap =
    copied?.template ??
    (fromCategories ? { tixstock: fromCategories.categoryToZone } : {});

  const svgUrl = await publish(map.id, zones);
  if (!svgUrl) {
    await db.from("venue_maps").delete().eq("id", map.id);
    return fail("Could not publish the map");
  }

  const { error: updateError } = await db
    .from("venue_maps")
    .update({
      svg_url: svgUrl,
      zones,
      supplier_categories: supplierCategories,
      updated_at: new Date().toISOString(),
    })
    .eq("id", map.id);
  if (updateError) {
    console.error("venue-map: url update failed", JSON.stringify(updateError));
    return fail("Could not save the map URL");
  }

  await logAudit({
    action: "create",
    entityType: "venue_map",
    entityId: map.id,
    metadata: {
      name: map.name,
      source_url: sourceUrl,
      zones: zones.length,
      copied_from: copied ? options.copyFromId : null,
    },
  });
  return {
    ok: true,
    data: {
      ...map,
      svg_url: svgUrl,
      zones,
      supplier_categories: supplierCategories,
    },
  };
}

/** Save the zones of a venue map and republish the drawing with them. */
export async function saveVenueZones(
  id: string,
  zones: VenueZone[],
): Promise<Result<VenueMap>> {
  await requireStaff();

  const source = await readSource(id);
  if (!source) return fail("Could not read the map drawing");
  const checked = sanitizeZones(zones, new Set(listSectionIds(source)));
  if (!checked.ok) return checked;

  const svgUrl = await publish(id, checked.data);
  if (!svgUrl) return fail("Could not publish the map");

  const { data, error } = await db
    .from("venue_maps")
    .update({
      zones: checked.data,
      svg_url: svgUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("venue-map: zones save failed", JSON.stringify(error));
    return fail("Could not save the zones");
  }

  await logAudit({
    action: "update",
    entityType: "venue_map",
    entityId: id,
    metadata: { zones: checked.data.length },
  });
  return { ok: true, data: data as VenueMap };
}

/**
 * Remember how this venue's supplier categories map to our zones - the
 * template the next event at the stadium is pre-filled from. Merges into what
 * is already known; a category mapped to "" is forgotten.
 */
export async function rememberSupplierCategories(
  id: string,
  supplier: string,
  categoryToZone: Record<string, string>,
): Promise<Result<SupplierCategoryMap>> {
  await requireStaff();
  if (!(SUPPLIERS as readonly string[]).includes(supplier)) {
    return fail(`Unknown supplier "${supplier}"`);
  }

  const { data: row, error } = await db
    .from("venue_maps")
    .select("zones,supplier_categories")
    .eq("id", id)
    .single();
  if (error || !row) return fail("Venue map not found");

  const zoneIds = new Set((row.zones as VenueZone[]).map((z) => z.id));
  const all = { ...(row.supplier_categories as SupplierCategoryMap) };
  const forSupplier = { ...(all[supplier] ?? {}) };
  for (const [category, zoneId] of Object.entries(categoryToZone)) {
    const key = normalizeSupplierCategory(category);
    if (!key) continue;
    if (zoneId && zoneIds.has(zoneId)) forSupplier[key] = zoneId;
    else delete forSupplier[key];
  }
  all[supplier] = forSupplier;

  const { error: updateError } = await db
    .from("venue_maps")
    .update({ supplier_categories: all, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) {
    console.error(
      "venue-map: template save failed",
      JSON.stringify(updateError),
    );
    return fail("Could not save the venue template");
  }
  return { ok: true, data: all };
}
