"use server";

import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import {
  buildGapContext,
  computeOpenCreativeGaps,
  feedEvents,
  listCategoryContentGaps,
  listGapsOfKind,
} from "@/lib/services/creative-gaps";
import {
  GAP_KINDS,
  gapKey,
  type GapCounts,
  type GapItem,
  type GapKind,
} from "@/types/creative-gap.types";

// Several of these tables predate the generated database types - cast once at
// the boundary, same pattern as listUsers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Live queries only - no table backs this. Two soft-delete dialects to get
 * right: events.is_deleted is a DATE (deleted = not null), while the template
 * tables (artists/football_teams/categories/blog_posts) use boolean is_deleted.
 * gallery is jsonb defaulting to '[]' - an empty one is never NULL.
 *
 * The gap computation itself (buildGapContext / listGapsOfKind /
 * computeOpenCreativeGaps) lives in lib/services/creative-gaps.ts - this file
 * is "use server" and only guards + delegates, so the weekly-cron rule
 * generator (lib/services/task-rules/creative-gaps.ts) can call the
 * session-free service directly instead of a `requireStaff()`-gated action.
 */

export async function getCreativeGapCounts(): Promise<GapCounts> {
  await requireStaff();

  const [
    eventCreative,
    eventCard,
    teamLogo,
    teamHero,
    artistHero,
    teamGallery,
    artistGallery,
    categoryImage,
    blogHero,
    teamBio,
    artistBio,
    categoryContent,
  ] = await Promise.all([
    feedEvents().is("campaign_image_url", null),
    feedEvents().is("card_image_url", null),
    db
      .from("football_teams")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("logo_url", null),
    db
      .from("football_teams")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null),
    db
      .from("artists")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null),
    db
      .from("football_teams")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .eq("gallery", "[]"),
    db
      .from("artists")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .eq("gallery", "[]"),
    // Only categories that are switched on: an inactive one has no tile and
    // no /c/ page, so its missing image is noise (Tom, 2026-09-10).
    db
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .eq("is_active", true)
      .is("image_url", null),
    db
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null),
    db
      .from("football_teams")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("bio", null),
    db
      .from("artists")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("bio", null),
    // jsonb emptiness is not a PostgREST filter - the list does it in code.
    listCategoryContentGaps().then((rows) => ({ count: rows.length, error: null })),
  ]);

  const results = [
    eventCreative,
    eventCard,
    teamLogo,
    teamHero,
    artistHero,
    teamGallery,
    artistGallery,
    categoryImage,
    blogHero,
    teamBio,
    artistBio,
    categoryContent,
  ];
  results.forEach((result, index) => {
    if (result.error) {
      console.error(
        `creative-gaps: count ${GAP_KINDS[index]} failed`,
        JSON.stringify(result.error),
      );
    }
  });

  const counts = {
    event_creative: eventCreative.count ?? 0,
    event_card_image: eventCard.count ?? 0,
    team_logo: teamLogo.count ?? 0,
    team_hero: teamHero.count ?? 0,
    artist_hero: artistHero.count ?? 0,
    team_gallery: teamGallery.count ?? 0,
    artist_gallery: artistGallery.count ?? 0,
    category_image: categoryImage.count ?? 0,
    blog_hero: blogHero.count ?? 0,
    team_bio: teamBio.count ?? 0,
    artist_bio: artistBio.count ?? 0,
    category_content: categoryContent.count ?? 0,
  } satisfies GapCounts["counts"];

  return {
    counts,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

/** Concrete rows for one gap kind - the drill-down tab. */
export async function listCreativeGaps(kind: GapKind): Promise<GapItem[]> {
  await requireStaff();
  return listGapsOfKind(kind, await buildGapContext());
}

/**
 * Every gap, in one list - what the gaps tab shows. The computation
 * (severity/on-sale/demoted ranking, dismissal filtering) lives in
 * computeOpenCreativeGaps (lib/services/creative-gaps.ts) so the weekly-cron
 * creative_gaps rule generator can call it without a staff session; this stays
 * the staff-facing entry point.
 */
export async function listAllCreativeGaps(): Promise<GapItem[]> {
  await requireStaff();
  return computeOpenCreativeGaps();
}

export interface DismissedGap {
  gap_key: string;
  kind: string;
  label: string | null;
  note: string | null;
  created_at: string;
}

/**
 * "Already on the site" - files a gap away without touching the row it points
 * at. Arsenal's crest is on the site even though football_teams.logo_url is
 * null; the radar should stop reporting it, but the data stays as it is.
 */
export async function dismissCreativeGap(input: {
  kind: string;
  table: string;
  row_id: string | number;
  label: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireStaff();

  const { error } = await db.from("creative_gap_dismissals").upsert(
    {
      gap_key: gapKey(input.kind, input.table, input.row_id),
      kind: input.kind,
      source_table: input.table,
      row_id: String(input.row_id),
      label: input.label,
      note: input.note ?? null,
      dismissed_by: session.sub,
    },
    { onConflict: "gap_key" },
  );
  if (error) {
    console.error("creative-gaps: dismiss failed", JSON.stringify(error));
    return { ok: false, error: "Could not mark it as already on the site" };
  }

  await logAudit({
    action: "creative_gap.dismiss",
    entityType: "creative_gap",
    entityId: gapKey(input.kind, input.table, input.row_id),
    changes: { label: input.label },
  });
  return { ok: true };
}

/** Undo a dismissal - the gap reappears in the list on the next load. */
export async function restoreCreativeGap(
  key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();

  const { error } = await db.from("creative_gap_dismissals").delete().eq("gap_key", key);
  if (error) {
    console.error("creative-gaps: restore failed", JSON.stringify(error));
    return { ok: false, error: "Could not restore it" };
  }

  await logAudit({
    action: "creative_gap.restore",
    entityType: "creative_gap",
    entityId: key,
  });
  return { ok: true };
}

export async function listDismissedGaps(): Promise<DismissedGap[]> {
  await requireStaff();

  const { data, error } = await db
    .from("creative_gap_dismissals")
    .select("gap_key,kind,label,note,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("creative-gaps: dismissed list failed", JSON.stringify(error));
    return [];
  }
  return (data ?? []) as DismissedGap[];
}
