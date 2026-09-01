"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

// Several of these tables predate the generated database types - cast once at
// the boundary, same pattern as listUsers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import {
  GAP_KINDS,
  type GapCounts,
  type GapItem,
  type GapKind,
} from "@/types/creative-gap.types";

/**
 * Live queries only - no table backs this. Two soft-delete dialects to get
 * right: events.is_deleted is a DATE (deleted = not null), while the template
 * tables (artists/football_teams/categories/blog_posts) use boolean is_deleted.
 * gallery is jsonb defaulting to '[]' - an empty one is never NULL.
 */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Feed window = the same eligibility meta-feed uses: live + not past. */
function feedEvents() {
  return db
    .from("events")
    .select("id", { count: "exact", head: true })
    .is("is_deleted", null)
    .gte("date", todayISO());
}

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
    db
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null),
    db
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null),
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
  } satisfies GapCounts["counts"];

  return {
    counts,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

const LIST_LIMIT = 300;

/** Concrete rows for one gap kind - the drill-down tab. */
export async function listCreativeGaps(kind: GapKind): Promise<GapItem[]> {
  await requireStaff();

  try {
    switch (kind) {
      case "event_creative": {
        const { data, error } = await db
          .from("events")
          .select("id,name,date,campaign_skip_reason")
          .is("is_deleted", null)
          .gte("date", todayISO())
          .is("campaign_image_url", null)
          .order("date", { ascending: true })
          .limit(LIST_LIMIT);
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => ({
          kind,
          table: "events",
          row_id: row.id,
          label: row.name,
          url: `/events/${row.id}`,
          detail: row.campaign_skip_reason
            ? `${row.date} · ${row.campaign_skip_reason}`
            : row.date,
        }));
      }
      case "event_card_image": {
        const { data, error } = await db
          .from("events")
          .select("id,name,date")
          .is("is_deleted", null)
          .gte("date", todayISO())
          .is("card_image_url", null)
          .order("date", { ascending: true })
          .limit(LIST_LIMIT);
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => ({
          kind,
          table: "events",
          row_id: row.id,
          label: row.name,
          url: `/events/${row.id}`,
          detail: row.date,
        }));
      }
      case "team_logo":
      case "team_hero":
      case "team_gallery": {
        let query = db
          .from("football_teams")
          .select("id,name,name_english")
          .eq("is_deleted", false)
          .order("name")
          .limit(LIST_LIMIT);
        query =
          kind === "team_logo"
            ? query.is("logo_url", null)
            : kind === "team_hero"
              ? query.is("image_url", null)
              : query.eq("gallery", "[]");
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => ({
          kind,
          table: "football_teams",
          row_id: row.id,
          label: row.name || row.name_english || String(row.id),
          url: `/templates/football/${row.id}/edit`,
        }));
      }
      case "artist_hero":
      case "artist_gallery": {
        let query = db
          .from("artists")
          .select("id,name,name_english")
          .eq("is_deleted", false)
          .order("name")
          .limit(LIST_LIMIT);
        query =
          kind === "artist_hero"
            ? query.is("image_url", null)
            : query.eq("gallery", "[]");
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => ({
          kind,
          table: "artists",
          row_id: row.id,
          label: row.name || row.name_english || String(row.id),
          url: `/templates/artists/${row.id}/edit`,
        }));
      }
      case "category_image": {
        const { data, error } = await db
          .from("categories")
          .select("id,name,name_english")
          .eq("is_deleted", false)
          .is("image_url", null)
          .order("name")
          .limit(LIST_LIMIT);
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => ({
          kind,
          table: "categories",
          row_id: row.id,
          label: row.name || row.name_english || String(row.id),
          url: `/templates/categories/${row.id}/edit`,
        }));
      }
      case "blog_hero": {
        const { data, error } = await db
          .from("blog_posts")
          .select("id,title")
          .eq("is_deleted", false)
          .is("image_url", null)
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT);
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => ({
          kind,
          table: "blog_posts",
          row_id: row.id,
          label: row.title || String(row.id),
          url: `/templates/blog/${row.id}/edit`,
        }));
      }
    }
  } catch (error) {
    console.error(`creative-gaps: list ${kind} failed`, JSON.stringify(error));
    return [];
  }
}
