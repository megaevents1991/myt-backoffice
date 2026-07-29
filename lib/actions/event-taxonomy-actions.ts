"use server";

import { supabase } from "@/lib/supabase-server";
import { requireStaff } from "@/lib/auth/guards";
import { slugify } from "@/lib/slug";
import type { EventCategory, EventTag, AssignMode } from "@/types/taxonomy.types";

// New tables aren't in the generated Supabase types yet — cast the builder.
const tbl = (t: string) => (supabase as any).from(t);

async function uniqueSlug(table: string, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data, error } = await tbl(table).select("id").eq("slug", slug).maybeSingle();
    if (error) throw error;
    if (!data) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Case-insensitive same-name lookup. Creates are IDEMPOTENT: a double-tap /
 * double-submit returns the existing row instead of inserting a twin (names
 * have no unique constraint — Hebrew-only names all slug to "item-N", so the
 * slug uniqueness never blocks duplicates).
 */
async function findByName(
  table: string,
  name: string,
  parentId?: number | null
): Promise<{ id: number } | null> {
  let q = tbl(table)
    .select("*")
    .ilike("name", name.trim().replace(/[%_]/g, "\\$&"))
    .eq("is_deleted", false);
  if (parentId !== undefined) {
    q = parentId === null ? q.is("parent_id", null) : q.eq("parent_id", parentId);
  }
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Every new taxonomy category also gets a HIDDEN card in the Templates CMS
 * `categories` table (is_active=false), pre-linked to its /c/ page on main —
 * the team edits the card and enables it when ready. Best-effort: a card
 * failure must never fail the taxonomy create.
 */
async function createHiddenTemplateCard(cat: EventCategory): Promise<void> {
  try {
    // Canonical /c/ path = ancestor slugs + own slug (walk parent chain).
    const { data: all, error } = await tbl("event_categories")
      .select("id,parent_id,slug")
      .eq("is_deleted", false);
    if (error) throw error;
    const byId = new Map<number, { parent_id: number | null; slug: string }>(
      (all ?? []).map((r: any) => [r.id, { parent_id: r.parent_id, slug: r.slug }])
    );
    const path: string[] = [cat.slug];
    const seen = new Set<number>([cat.id]);
    let cur = cat.parent_id;
    while (cur != null && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      path.unshift(byId.get(cur)!.slug);
      cur = byId.get(cur)!.parent_id;
    }

    const cardSlug = await uniqueSlug("categories", cat.slug);
    const { error: insErr } = await tbl("categories").insert({
      slug: cardSlug,
      name: cat.name,
      name_english: cat.name_english ?? null,
      image_url: cat.image_url ?? null,
      link_url: `/c/${path.join("/")}`,
      is_active: false, // hidden until the team finishes the card and enables it
      is_deleted: false,
    });
    if (insErr) throw insErr;
  } catch (e) {
    console.error("createHiddenTemplateCard failed (taxonomy create kept):", e);
  }
}

// Reject a parent that is self or a descendant (cycle guard).
async function assertNoCycle(id: number, parentId: number | null): Promise<void> {
  if (parentId == null) return;
  if (parentId === id) throw new Error("A category cannot be its own parent.");
  const { data, error } = await tbl("event_categories")
    .select("id,parent_id")
    .eq("is_deleted", false);
  if (error) throw error;
  const byId = new Map<number, number | null>(
    (data ?? []).map((r: any) => [r.id, r.parent_id])
  );
  // visited set: terminate even if the DB already holds a corrupt cycle.
  const seen = new Set<number>();
  let cur: number | null = parentId;
  while (cur != null && !seen.has(cur)) {
    if (cur === id) throw new Error("Cannot move a category under its own descendant.");
    seen.add(cur);
    cur = byId.get(cur) ?? null;
  }
}

/* ---------- categories ---------- */

export async function listCategories(): Promise<EventCategory[]> {
  await requireStaff();
  const { data, error } = await tbl("event_categories")
    .select("*")
    .eq("is_deleted", false)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventCategory[];
}

export async function createCategory(input: {
  name: string;
  name_english?: string;
  parent_id?: number | null;
  image_url?: string;
  description?: string;
}): Promise<EventCategory> {
  await requireStaff();
  if (!input.name?.trim()) throw new Error("Category name is required.");
  // Idempotent: same name under the same parent returns the existing node.
  const existing = await findByName("event_categories", input.name, input.parent_id ?? null);
  if (existing) return existing as EventCategory;

  const slug = await uniqueSlug("event_categories", slugify(input.name_english || input.name));
  const { data, error } = await tbl("event_categories")
    .insert({
      name: input.name.trim(),
      name_english: input.name_english ?? null,
      parent_id: input.parent_id ?? null,
      image_url: input.image_url ?? null,
      description: input.description ?? null,
      slug,
      // Hidden by default — the /c/ page and sitemap entry appear only after
      // the team finishes the category and enables it (same flow as the
      // auto-created hidden Templates card).
      is_active: false,
      is_deleted: false,
    })
    .select()
    .single();
  if (error) throw error;
  await createHiddenTemplateCard(data as EventCategory);
  return data as EventCategory;
}

export async function updateCategory(
  id: number,
  patch: Partial<
    Pick<
      EventCategory,
      "name" | "name_english" | "parent_id" | "image_url" | "description" | "display_order" | "is_active"
    >
  >
): Promise<void> {
  await requireStaff();
  if ("parent_id" in patch) await assertNoCycle(id, patch.parent_id ?? null);
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.name_english !== undefined) row.name_english = patch.name_english;
  if (patch.parent_id !== undefined) row.parent_id = patch.parent_id;
  if (patch.image_url !== undefined) row.image_url = patch.image_url;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.display_order !== undefined) row.display_order = patch.display_order;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  // Hebrew-only names fall back to a meaningless "item-N" slug; once an English
  // name arrives, upgrade the slug so Phase 2 main-app URLs (/c/[...slug]) are real.
  if (patch.name_english) {
    const { data: existing, error: exErr } = await tbl("event_categories")
      .select("slug").eq("id", id).single();
    if (exErr) throw exErr;
    if (/^item(-\d+)?$/.test(existing.slug)) {
      row.slug = await uniqueSlug("event_categories", slugify(patch.name_english));
    }
  }
  const { error } = await tbl("event_categories").update(row).eq("id", id);
  if (error) throw error;
}

export async function softDeleteCategory(id: number): Promise<void> {
  await requireStaff();
  // Block if it has active children — force moving/deleting them first.
  const { data: kids, error: kErr } = await tbl("event_categories")
    .select("id")
    .eq("parent_id", id)
    .eq("is_deleted", false)
    .limit(1);
  if (kErr) throw kErr;
  if (kids && kids.length) throw new Error("Move or delete child categories first.");
  // Drop the tag composition — event membership is derived from it, so this is
  // what empties the category (event_category_links is a view now).
  const { error: linkErr } = await tbl("event_category_tags").delete().eq("category_id", id);
  if (linkErr) throw linkErr;
  const { error } = await tbl("event_categories")
    .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Bulk soft-delete categories. Selection is expanded to each node's WHOLE
 * subtree (deleting a parent without its children would orphan them — the
 * single-delete path blocks that instead). Event links are removed first,
 * same as softDeleteCategory. Returns how many categories were deleted.
 */
export async function bulkSoftDeleteCategories(ids: number[]): Promise<number> {
  await requireStaff();
  if (!ids.length) return 0;
  const { data, error } = await tbl("event_categories")
    .select("id,parent_id")
    .eq("is_deleted", false);
  if (error) throw error;
  const childrenOf = new Map<number, number[]>();
  (data ?? []).forEach((r: any) => {
    if (r.parent_id != null) {
      const arr = childrenOf.get(r.parent_id) ?? [];
      arr.push(r.id);
      childrenOf.set(r.parent_id, arr);
    }
  });
  const all = new Set<number>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift()!;
    if (all.has(id)) continue;
    all.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  const targets = [...all];
  const { error: linkErr } = await tbl("event_category_tags")
    .delete()
    .in("category_id", targets);
  if (linkErr) throw linkErr;
  const { error: delErr } = await tbl("event_categories")
    .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() })
    .in("id", targets);
  if (delErr) throw delErr;
  return targets.length;
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
  // Idempotent: an existing tag with the same name is returned, not duplicated
  // (checked FIRST so re-adding an old Hebrew-only tag doesn't demand English).
  const existing = await findByName("event_tags", input.name);
  if (existing) return existing as EventTag;
  // Feed labels are slug-keyed — a Hebrew-only tag slugs to a meaningless
  // "item-N", so a REAL latin English name is mandatory at create time
  // (slugify falls back to "item" on non-latin input, so test letters directly).
  if (!input.name_english?.trim() || !/[a-z]/i.test(input.name_english)) {
    throw new Error("English name is required — it becomes the feed slug.");
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
  patch: Partial<Pick<EventTag, "name" | "name_english" | "is_active">>
): Promise<void> {
  await requireStaff();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.name_english !== undefined) row.name_english = patch.name_english;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  // Same slug upgrade as categories: replace the "item-N" fallback once an
  // English name exists (Phase 2 feed/tag URLs are slug-keyed).
  if (patch.name_english) {
    const { data: existing, error: exErr } = await tbl("event_tags")
      .select("slug").eq("id", id).single();
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
  // Remove event links first — otherwise ghost links resurface in Phase 2 reads.
  const { error: linkErr } = await tbl("event_tag_links").delete().eq("tag_id", id);
  if (linkErr) throw linkErr;
  // ...and stop it composing any category (tags are what categories are made of).
  const { error: catErr } = await tbl("event_category_tags").delete().eq("tag_id", id);
  if (catErr) throw catErr;
  const { error } = await tbl("event_tags")
    .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Bulk soft-delete tags; event links removed first (same as softDeleteTag). */
export async function bulkSoftDeleteTags(ids: number[]): Promise<void> {
  await requireStaff();
  if (!ids.length) return;
  const { error: linkErr } = await tbl("event_tag_links").delete().in("tag_id", ids);
  if (linkErr) throw linkErr;
  const { error: catErr } = await tbl("event_category_tags").delete().in("tag_id", ids);
  if (catErr) throw catErr;
  const { error } = await tbl("event_tags")
    .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

/* ---------- category composition (which tags make up a category) ---------- */

/**
 * Tags compose categories, not the other way around: an event is never
 * assigned to a category by hand. You tag the event; a category declares which
 * tags it is made of, and every event carrying one of them is pulled in
 * (`event_category_links` is a VIEW over this — see the migration).
 */
export async function getCategoryTagMap(): Promise<Record<number, number[]>> {
  await requireStaff();
  const { data, error } = await tbl("event_category_tags").select("category_id,tag_id");
  if (error) throw error;
  const map: Record<number, number[]> = {};
  (data ?? []).forEach((r: any) => {
    (map[r.category_id] ??= []).push(r.tag_id);
  });
  return map;
}

/**
 * The Templates category card is the single editing surface (that's where the
 * team builds the category page), so tags are chosen there — but they live on
 * the taxonomy node the card points at, which is what the main app's /c/ pages
 * and the feed's product_type read. A card that never had a node (built in
 * Templates rather than auto-created from the taxonomy screen) gets one here,
 * mirroring its name/image, hidden until someone flips it live.
 */
async function ensureNodeForCard(cardId: number): Promise<number> {
  const { data: card, error } = await tbl("categories")
    .select("id,name,name_english,slug,subtitle,image_url,link_url,event_category_id")
    .eq("id", cardId)
    .single();
  if (error) throw error;
  if (card.event_category_id) return card.event_category_id as number;

  // Pair with an existing node before creating a twin: same name, or the node
  // this card already links to via /c/<slug>.
  const linkedSlug = /^\/c\//.test(card.link_url ?? "")
    ? (card.link_url as string).replace(/\/+$/, "").split("/").pop()
    : null;
  let nodeId: number | null = null;
  if (linkedSlug) {
    const { data, error: sErr } = await tbl("event_categories")
      .select("id")
      .eq("slug", linkedSlug)
      .eq("is_deleted", false)
      .maybeSingle();
    if (sErr) throw sErr;
    nodeId = (data?.id as number) ?? null;
  }
  if (!nodeId) {
    const existing = await findByName("event_categories", card.name);
    nodeId = (existing?.id as number) ?? null;
  }
  if (!nodeId) {
    const slug = await uniqueSlug(
      "event_categories",
      slugify(card.name_english || card.slug || card.name),
    );
    const { data, error: insErr } = await tbl("event_categories")
      .insert({
        name: card.name,
        name_english: card.name_english ?? null,
        parent_id: null,
        image_url: card.image_url ?? null,
        description: card.subtitle ?? null,
        slug,
        is_active: false, // the /c/ page opens only when the team says so
        is_deleted: false,
      })
      .select()
      .single();
    if (insErr) throw insErr;
    nodeId = data.id as number;
  }

  const { error: linkErr } = await tbl("categories")
    .update({ event_category_id: nodeId })
    .eq("id", cardId);
  if (linkErr) throw linkErr;
  return nodeId;
}

/** Tags composing the category behind a Templates card ([] when it has none). */
export async function getTemplateCategoryTagIds(cardId: number): Promise<number[]> {
  await requireStaff();
  const { data: card, error } = await tbl("categories")
    .select("event_category_id")
    .eq("id", cardId)
    .single();
  if (error) throw error;
  if (!card.event_category_id) return [];
  const { data, error: tErr } = await tbl("event_category_tags")
    .select("tag_id")
    .eq("category_id", card.event_category_id);
  if (tErr) throw tErr;
  return (data ?? []).map((r: any) => r.tag_id as number);
}

/** Save the tag composition from the Templates category form. */
export async function setTemplateCategoryTagIds(
  cardId: number,
  tagIds: number[],
): Promise<void> {
  await requireStaff();
  const nodeId = await ensureNodeForCard(cardId);
  await setCategoryTags(nodeId, tagIds);
}

export async function setCategoryTags(categoryId: number, tagIds: number[]): Promise<void> {
  await requireStaff();
  const { error: delErr } = await tbl("event_category_tags")
    .delete()
    .eq("category_id", categoryId);
  if (delErr) throw delErr;
  if (tagIds.length) {
    const rows = tagIds.map((tag_id) => ({ category_id: categoryId, tag_id }));
    const { error } = await tbl("event_category_tags").insert(rows);
    if (error) throw error;
  }
}

/* ---------- links (single event) ---------- */

export async function getEventTagIds(eventId: number): Promise<number[]> {
  await requireStaff();
  const { data, error } = await tbl("event_tag_links").select("tag_id").eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.tag_id as number);
}

export async function setEventTags(eventId: number, tagIds: number[]): Promise<void> {
  await requireStaff();
  const { error: delErr } = await tbl("event_tag_links").delete().eq("event_id", eventId);
  if (delErr) throw delErr;
  if (tagIds.length) {
    const rows = tagIds.map((tag_id) => ({ event_id: eventId, tag_id }));
    const { error } = await tbl("event_tag_links").insert(rows);
    if (error) throw error;
  }
}

/* ---------- bulk ---------- */

/**
 * Full event→taxonomy maps for the events table (taxonomy column + filters).
 * `cats` is READ-ONLY and derived — it comes from the event_category_links
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

/* ---------- counts (managers show how many events each node/tag collects) ---------- */

export async function getCategoryEventCounts(): Promise<Record<number, number>> {
  await requireStaff();
  const { data, error } = await tbl("event_category_links").select("category_id");
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

export async function bulkAssignTags(
  eventIds: number[],
  tagIds: number[],
  mode: AssignMode
): Promise<void> {
  await requireStaff();
  if (!eventIds.length) return;
  if (mode === "replace") {
    const { error } = await tbl("event_tag_links").delete().in("event_id", eventIds);
    if (error) throw error;
  }
  if (!tagIds.length) return;
  const rows = eventIds.flatMap((event_id) => tagIds.map((tag_id) => ({ event_id, tag_id })));
  const { error } = await tbl("event_tag_links").upsert(rows, {
    onConflict: "event_id,tag_id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}
