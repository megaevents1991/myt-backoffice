import { supabase } from "@/lib/supabase-server";
import { slugify } from "@/lib/slug";
import { applyTagRules } from "@/lib/services/auto-tagger";

/**
 * Templates → taxonomy sync. Creating an artist / football-team CMS card also
 * creates its taxonomy trio (Dor, 2026-08-13):
 *
 *   1. an `event_tags` row (type artist/team) - the feed + filter key
 *   2. a `tag_rules` row (event name contains the English name → the tag)
 *   3. a leaf category under the אומנים / הקבוצות שלנו hub, composed of it
 *
 * then runs the auto-tagger so existing events pick the tag up immediately.
 * Everything is idempotent (keyed by slug) and ADDITIVE - re-syncing an
 * existing person is a no-op. Callers wrap in try/catch: a sync failure must
 * never fail the template create itself. English name is mandatory for the
 * slug - without one the sync is skipped (the Templates form asks for it).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (t: string) => (supabase as any).from(t);

const HUB_SLUG = { artist: "artists", team: "teams" } as const;

export async function ensurePersonTaxonomy(input: {
  kind: "artist" | "team";
  name: string;
  nameEnglish: string | null | undefined;
}): Promise<{ skipped?: string; tagId?: number; categoryId?: number }> {
  const nameEnglish = input.nameEnglish?.trim();
  const name = input.name?.trim();
  if (!name) return { skipped: "no name" };
  if (!nameEnglish || !/[a-z]/i.test(nameEnglish)) {
    return { skipped: "no english name - tag/category not created" };
  }
  const slug = slugify(nameEnglish);

  // 1. Tag (idempotent by slug; retype if it exists under another type).
  const { data: existingTag, error: tagFindErr } = await tbl("event_tags")
    .select("id,type,is_deleted")
    .eq("slug", slug)
    .maybeSingle();
  if (tagFindErr) throw tagFindErr;
  let tagId: number;
  if (existingTag && !existingTag.is_deleted) {
    tagId = existingTag.id;
    if (existingTag.type !== input.kind) {
      const { error } = await tbl("event_tags")
        .update({ type: input.kind, updated_at: new Date().toISOString() })
        .eq("id", tagId);
      if (error) throw error;
    }
  } else if (existingTag) {
    // Soft-deleted row holds the slug - revive it (total unique constraint).
    tagId = existingTag.id;
    const { error } = await tbl("event_tags")
      .update({
        name,
        name_english: nameEnglish,
        type: input.kind,
        is_active: true,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tagId);
    if (error) throw error;
  } else {
    const { data, error } = await tbl("event_tags")
      .insert({
        slug,
        name,
        name_english: nameEnglish,
        type: input.kind,
        is_active: true,
        is_deleted: false,
      })
      .select("id")
      .single();
    if (error) throw error;
    tagId = data.id;
  }

  // 2. Rule: event name contains the English name → the tag.
  const { data: existingRule, error: ruleFindErr } = await tbl("tag_rules")
    .select("id")
    .eq("tag_id", tagId)
    .eq("field", "name")
    .eq("pattern", nameEnglish)
    .maybeSingle();
  if (ruleFindErr) throw ruleFindErr;
  if (!existingRule) {
    const { error } = await tbl("tag_rules").insert({
      tag_id: tagId,
      field: "name",
      pattern: nameEnglish,
      is_active: true,
    });
    if (error) throw error;
  }

  // 3. Leaf category under the hub, composed of the tag.
  let categoryId: number | undefined;
  const { data: hub, error: hubErr } = await tbl("categories")
    .select("id,parent_id")
    .eq("slug", HUB_SLUG[input.kind])
    .eq("is_deleted", false)
    .maybeSingle();
  if (hubErr) throw hubErr;
  if (hub) {
    const { data: existingCat, error: catFindErr } = await tbl("categories")
      .select("id,is_deleted")
      .eq("slug", slug)
      .maybeSingle();
    if (catFindErr) throw catFindErr;
    if (existingCat && !existingCat.is_deleted) {
      categoryId = existingCat.id;
    } else if (!existingCat) {
      // link_url = canonical /c/<root>/<hub>/<leaf> path.
      const { data: root, error: rootErr } = await tbl("categories")
        .select("slug")
        .eq("id", hub.parent_id)
        .maybeSingle();
      if (rootErr) throw rootErr;
      const linkUrl = `/c/${root ? root.slug + "/" : ""}${HUB_SLUG[input.kind]}/${slug}`;
      const { data, error } = await tbl("categories")
        .insert({
          slug,
          name,
          name_english: nameEnglish,
          parent_id: hub.id,
          display_order: 99,
          is_active: true,
          is_deleted: false,
          link_url: linkUrl,
        })
        .select("id")
        .single();
      if (error) throw error;
      categoryId = data.id;
    }
    if (categoryId != null) {
      const { error } = await tbl("category_tags").upsert(
        [{ category_id: categoryId, tag_id: tagId }],
        { onConflict: "category_id,tag_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    }
  }

  // 4. Tag existing events that match the new rule.
  await applyTagRules();

  return { tagId, categoryId };
}
