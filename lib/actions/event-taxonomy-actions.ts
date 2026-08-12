"use server";

import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import { slugify } from "@/lib/slug";
import type {
  EventCategory,
  EventTag,
  AssignMode,
} from "@/types/taxonomy.types";

/**
 * Event taxonomy: TAGS COMPOSE CATEGORIES.
 *
 * You only ever tag an event. A category declares which tags make it up
 * (`category_tags`), and every event carrying one of them is pulled in - the
 * `event_category_links` VIEW is that join, and it is what main reads for /c/
 * pages and the feed's product_type.
 *
 * There is ONE category table: `categories`, the Templates card the team
 * builds (image, subtitle, blob art, tree position). The old parallel
 * `event_categories` node is gone - see the one_category_table migration.
 */

// event_tags / category_tags aren't in the generated Supabase types yet.
const tbl = (t: string) => (supabase as any).from(t);

async function uniqueSlug(table: string, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data, error } = await tbl(table)
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Case-insensitive same-name lookup. Tag creates are IDEMPOTENT: a
 * double-tap returns the existing row instead of inserting a twin (names have
 * no unique constraint - Hebrew-only names all slug to "item-N", so slug
 * uniqueness never blocks duplicates).
 */
async function findByName(
  table: string,
  name: string,
): Promise<{ id: number } | null> {
  const { data, error } = await tbl(table)
    .select("*")
    .ilike("name", name.trim().replace(/[%_]/g, "\\$&"))
    .eq("is_deleted", false)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ---------- categories (read-only here; CRUD lives in category-actions) ---------- */

/**
 * The category tree, for the events table's column/filter and the derived
 * list on the event form. Editing happens on the Templates category form.
 */
export async function listCategories(): Promise<EventCategory[]> {
  await requireStaff();
  const { data, error } = await tbl("categories")
    .select(
      "id,parent_id,slug,name,name_english,image_url,subtitle,display_order,is_active,is_deleted",
    )
    .eq("is_deleted", false)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventCategory[];
}

/* ---------- tags ---------- */

export async function listTags(): Promise<EventTag[]> {
  await requireStaff();
  const { data, error } = await tbl("event_tags")
    .select("*")
    .eq("is_deleted", false)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventTag[];
}

export async function createTag(input: {
  name: string;
  name_english?: string;
}): Promise<EventTag> {
  await requireStaff();
  if (!input.name?.trim()) throw new Error("Tag name is required.");
  // Checked FIRST so re-adding an old Hebrew-only tag doesn't demand English.
  const existing = await findByName("event_tags", input.name);
  if (existing) return existing as EventTag;
  // Feed labels are slug-keyed - a Hebrew-only tag slugs to a meaningless
  // "item-N", so a REAL latin English name is mandatory at create time
  // (slugify falls back to "item" on non-latin input, so test letters directly).
  if (!input.name_english?.trim() || !/[a-z]/i.test(input.name_english)) {
    throw new Error("English name is required - it becomes the feed slug.");
  }

  const slug = await uniqueSlug("event_tags", slugify(input.name_english));
  const { data, error } = await tbl("event_tags")
    .insert({
      name: input.name.trim(),
      name_english: input.name_english ?? null,
      slug,
      is_active: true,
      is_deleted: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data as EventTag;
}

export async function updateTag(
  id: number,
  patch: Partial<Pick<EventTag, "name" | "name_english" | "is_active">>,
): Promise<void> {
  await requireStaff();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.name_english !== undefined) row.name_english = patch.name_english;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  // Replace the "item-N" fallback once an English name exists (feed/tag URLs
  // are slug-keyed).
  if (patch.name_english) {
    const { data: existing, error: exErr } = await tbl("event_tags")
      .select("slug")
      .eq("id", id)
      .single();
    if (exErr) throw exErr;
    if (/^item(-\d+)?$/.test(existing.slug)) {
      row.slug = await uniqueSlug("event_tags", slugify(patch.name_english));
    }
  }
  const { error } = await tbl("event_tags").update(row).eq("id", id);
  if (error) throw error;
}

export async function softDeleteTag(id: number): Promise<void> {
  await requireStaff();
  // Unlink from events AND from every category it composes - otherwise ghost
  // links resurface in the derived view.
  const { error: linkErr } = await tbl("event_tag_links")
    .delete()
    .eq("tag_id", id);
  if (linkErr) throw linkErr;
  const { error: catErr } = await tbl("category_tags")
    .delete()
    .eq("tag_id", id);
  if (catErr) throw catErr;
  const { error } = await tbl("event_tags")
    .update({
      is_deleted: true,
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Bulk soft-delete tags; links removed first (same as softDeleteTag). */
export async function bulkSoftDeleteTags(ids: number[]): Promise<void> {
  await requireStaff();
  if (!ids.length) return;
  const { error: linkErr } = await tbl("event_tag_links")
    .delete()
    .in("tag_id", ids);
  if (linkErr) throw linkErr;
  const { error: catErr } = await tbl("category_tags")
    .delete()
    .in("tag_id", ids);
  if (catErr) throw catErr;
  const { error } = await tbl("event_tags")
    .update({
      is_deleted: true,
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (error) throw error;
}

/* ---------- category composition (which tags make up a category) ---------- */

/** category id → its tag ids, for the events table's derived-category column. */
export async function getCategoryTagMap(): Promise<Record<number, number[]>> {
  await requireStaff();
  const { data, error } =
    await tbl("category_tags").select("category_id,tag_id");
  if (error) throw error;
  const map: Record<number, number[]> = {};
  (data ?? []).forEach((r: any) => {
    (map[r.category_id] ??= []).push(r.tag_id);
  });
  return map;
}

/** Tags composing a category ([] when it has none - the category is empty). */
export async function getCategoryTagIds(categoryId: number): Promise<number[]> {
  await requireStaff();
  const { data, error } = await tbl("category_tags")
    .select("tag_id")
    .eq("category_id", categoryId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.tag_id as number);
}

/** Save the tag composition from the Templates category form. */
export async function setCategoryTags(
  categoryId: number,
  tagIds: number[],
): Promise<void> {
  await requireStaff();
  const { error: delErr } = await tbl("category_tags")
    .delete()
    .eq("category_id", categoryId);
  if (delErr) throw delErr;
  if (tagIds.length) {
    const rows = tagIds.map((tag_id) => ({ category_id: categoryId, tag_id }));
    const { error } = await tbl("category_tags").insert(rows);
    if (error) throw error;
  }
}

/* ---------- event links (tags only - categories are derived) ---------- */

export async function getEventTagIds(eventId: number): Promise<number[]> {
  await requireStaff();
  const { data, error } = await tbl("event_tag_links")
    .select("tag_id")
    .eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.tag_id as number);
}

export async function setEventTags(
  eventId: number,
  tagIds: number[],
): Promise<void> {
  await requireStaff();
  const { error: delErr } = await tbl("event_tag_links")
    .delete()
    .eq("event_id", eventId);
  if (delErr) throw delErr;
  if (tagIds.length) {
    const rows = tagIds.map((tag_id) => ({ event_id: eventId, tag_id }));
    const { error } = await tbl("event_tag_links").insert(rows);
    if (error) throw error;
  }
}

export async function bulkAssignTags(
  eventIds: number[],
  tagIds: number[],
  mode: AssignMode,
): Promise<void> {
  await requireStaff();
  if (!eventIds.length) return;
  if (mode === "replace") {
    const { error } = await tbl("event_tag_links")
      .delete()
      .in("event_id", eventIds);
    if (error) throw error;
  }
  if (!tagIds.length) return;
  const rows = eventIds.flatMap((event_id) =>
    tagIds.map((tag_id) => ({ event_id, tag_id })),
  );
  const { error } = await tbl("event_tag_links").upsert(rows, {
    onConflict: "event_id,tag_id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

/**
 * Full event→taxonomy maps for the events table (column + filters).
 * `cats` is READ-ONLY and derived - it comes from the event_category_links
 * view, i.e. from what the event's tags earn it.
 */
export async function getTaxonomyLinkMaps(): Promise<{
  cats: Record<number, number[]>;
  tags: Record<number, number[]>;
}> {
  await requireStaff();
  const [catRes, tagRes] = await Promise.all([
    tbl("event_category_links").select("event_id,category_id"),
    tbl("event_tag_links").select("event_id,tag_id"),
  ]);
  if (catRes.error) throw catRes.error;
  if (tagRes.error) throw tagRes.error;
  const cats: Record<number, number[]> = {};
  (catRes.data ?? []).forEach((r: any) => {
    (cats[r.event_id] ??= []).push(r.category_id);
  });
  const tags: Record<number, number[]> = {};
  (tagRes.data ?? []).forEach((r: any) => {
    (tags[r.event_id] ??= []).push(r.tag_id);
  });
  return { cats, tags };
}

/* ---------- counts (how many events each category/tag collects) ---------- */

export async function getCategoryEventCounts(): Promise<
  Record<number, number>
> {
  await requireStaff();
  const { data, error } = await tbl("event_category_links").select(
    "category_id",
  );
  if (error) throw error;
  const counts: Record<number, number> = {};
  (data ?? []).forEach((r: any) => {
    counts[r.category_id] = (counts[r.category_id] ?? 0) + 1;
  });
  return counts;
}

export async function getTagEventCounts(): Promise<Record<number, number>> {
  await requireStaff();
  const { data, error } = await tbl("event_tag_links").select("tag_id");
  if (error) throw error;
  const counts: Record<number, number> = {};
  (data ?? []).forEach((r: any) => {
    counts[r.tag_id] = (counts[r.tag_id] ?? 0) + 1;
  });
  return counts;
}
