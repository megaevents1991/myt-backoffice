"use server";

import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { buildLiveEventCounter, type OnTourEvent } from "@/lib/on-tour";
import type { CategoryPageContent } from "@/types/page-content.types";

// Several of these tables predate the generated database types - cast once at
// the boundary, same pattern as listUsers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import {
  GAP_KINDS,
  GAP_META,
  gapKey,
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

  const twins = loadTwinCategoryIds();
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
    // The blob IS the main picture of a team / artist - the page hero shows it
    // first and falls back to image_url only without one. No gap unless both
    // are missing (Dor, 2026-09-16).
    db
      .from("football_teams")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null)
      .is("art_image_url", null),
    db
      .from("artists")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .is("image_url", null)
      .is("art_image_url", null),
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
    twins
      .then((ids) => listCategoryImageGaps(ids))
      .then((rows) => ({ count: rows.length, error: null })),
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
    twins
      .then((ids) => listCategoryContentGaps(ids))
      .then((rows) => ({ count: rows.length, error: null })),
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

/** Which field on the team form fixes each form-fixable team gap. */
const TEAM_ANCHOR: Record<string, string> = {
  team_hero: "fix-image",
  team_gallery: "fix-gallery",
  team_bio: "fix-bio",
};

const LIST_LIMIT = 300;

/** Hubs whose leaves the site renders as a team / artist page. */
const PERSON_HUBS = ["teams", "artists"] as const;
type PersonHub = (typeof PERSON_HUBS)[number];

interface NameRow {
  name: string | null;
  name_english: string | null;
}

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * Categories the site renders AS a team / artist page: a leaf under the
 * "teams" / "artists" hub whose name matches a live row - the same match as
 * myt-main app/c/[...slug]/page.tsx. On those pages the category's own image
 * and text never show (the team's / artist's blob, bio and gallery do), so
 * they are not category gaps; the team / artist gaps cover them
 * (Dor, 2026-09-16: "עמוד קבוצה זה מה שחשוב").
 */
async function loadTwinCategoryIds(): Promise<Set<number>> {
  const [cats, teams, artists] = await Promise.all([
    db.from("categories").select("id,name,name_english,slug,parent_id").eq("is_deleted", false),
    db
      .from("football_teams")
      .select("name,name_english")
      .eq("is_deleted", false)
      .eq("is_active", true),
    db.from("artists").select("name,name_english").eq("is_deleted", false).eq("is_active", true),
  ]);
  for (const [what, res] of [
    ["categories", cats],
    ["teams", teams],
    ["artists", artists],
  ] as const) {
    if (res.error) console.error(`creative-gaps: twins ${what} failed`, JSON.stringify(res.error));
  }

  type CatRow = NameRow & { id: number; slug: string | null; parent_id: number | null };
  const categories = (cats.data ?? []) as CatRow[];
  const hubById = new Map<number, PersonHub>();
  for (const c of categories) {
    const hub = PERSON_HUBS.find((slug) => slug === c.slug);
    if (hub) hubById.set(c.id, hub);
  }
  // main only renders a twin that has both names
  const named = (rows: NameRow[] | null) =>
    (rows ?? []).filter((p) => !!norm(p.name) && !!norm(p.name_english));
  const people: Record<PersonHub, NameRow[]> = {
    teams: named(teams.data),
    artists: named(artists.data),
  };

  const twins = new Set<number>();
  for (const c of categories) {
    const hub = c.parent_id != null ? hubById.get(c.parent_id) : undefined;
    if (!hub) continue;
    const en = norm(c.name_english);
    const he = norm(c.name);
    const matched = people[hub].some(
      (p) =>
        (!!en && (norm(p.name_english) === en || norm(p.name) === en)) || norm(p.name) === he,
    );
    if (matched) twins.add(c.id);
  }
  return twins;
}

/**
 * Active categories with no image. Only switched-on ones: an inactive one has
 * no tile and no /c/ page (Tom, 2026-09-10). Team / artist twins are skipped.
 */
async function listCategoryImageGaps(twins: Set<number>): Promise<GapItem[]> {
  const { data, error } = await db
    .from("categories")
    .select("id,name,name_english")
    .eq("is_deleted", false)
    .eq("is_active", true)
    .is("image_url", null)
    .order("name")
    .limit(LIST_LIMIT * 2);
  if (error) {
    console.error("creative-gaps: category image failed", JSON.stringify(error));
    return [];
  }
  return (data ?? [])
    .filter((row: { id: number }) => !twins.has(row.id))
    .slice(0, LIST_LIMIT)
    .map((row: Record<string, string | number | null>) => ({
      kind: "category_image" as const,
      table: "categories",
      row_id: row.id as number,
      label: String(row.name || row.name_english || row.id),
      url: `/templates/categories/${row.id}/edit`,
      fixUrl: `/templates/categories/${row.id}/edit#fix-image`,
    }));
}

/**
 * "Has text for the page" - the fields the site renders as prose or cards
 * (intro, marketing text, facts, stadiums, FAQ, city info). Galleries, tile
 * images and hand-picked events are visuals / curation, not content.
 */
function hasPageText(content: CategoryPageContent | null | undefined): boolean {
  if (!content) return false;
  return (
    !!content.intro?.trim() ||
    !!content.seo_text?.trim() ||
    !!content.facts?.length ||
    !!content.stadiums?.length ||
    !!content.faq?.length ||
    !!content.city_info?.text?.trim()
  );
}

/**
 * Active categories whose page has no text at all. Team / artist twins are
 * skipped - their page text is the team's / artist's bio. Takes the on-sale
 * ranking when a context is given.
 */
async function listCategoryContentGaps(
  twins: Set<number>,
  ctx?: GapContext,
): Promise<GapItem[]> {
  const { data, error } = await db
    .from("categories")
    .select("id,name,name_english,page_content")
    .eq("is_deleted", false)
    .eq("is_active", true)
    .order("name")
    .limit(LIST_LIMIT * 2);
  if (error) {
    console.error("creative-gaps: category content failed", JSON.stringify(error));
    return [];
  }
  return (data ?? [])
    .filter(
      (row: { id: number; page_content: CategoryPageContent | null }) =>
        !twins.has(row.id) && !hasPageText(row.page_content),
    )
    .slice(0, LIST_LIMIT)
    .map((row: Record<string, string | number | null>) => ({
      kind: "category_content" as const,
      table: "categories",
      row_id: row.id as number,
      label: String(row.name || row.name_english || row.id),
      url: `/templates/categories/${row.id}/edit`,
      fixUrl: `/templates/categories/${row.id}/edit#fix-content`,
      liveEvents: ctx ? ctx.live(String(row.name_english ?? "")) : undefined,
    }));
}

/** Per-list context: the on-tour counter, built once per page load. */
interface GapContext {
  live: (nameEnglish?: string | null) => number;
  /** Category ids the site renders as a team / artist page. */
  twins: Set<number>;
}

async function buildGapContext(): Promise<GapContext> {
  const [{ data, error }, twins] = await Promise.all([
    db.from("events").select("name_english,date").is("is_deleted", null).gte("date", todayISO()),
    loadTwinCategoryIds(),
  ]);
  if (error) {
    console.error("creative-gaps: live events failed", JSON.stringify(error));
  }
  return { live: buildLiveEventCounter((data ?? []) as OnTourEvent[]), twins };
}

/** Concrete rows for one gap kind - the drill-down tab. */
export async function listCreativeGaps(kind: GapKind): Promise<GapItem[]> {
  await requireStaff();
  return listGapsOfKind(kind, await buildGapContext());
}

async function listGapsOfKind(kind: GapKind, ctx: GapContext): Promise<GapItem[]> {
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
        return (data ?? []).map((row: Record<string, string | number | null>) => {
          // The pipeline records WHY it skipped. Its only remaining skip is
          // "no computable price" (lib/creative/auto.ts) - so the fix for a
          // missing creative is almost always the event's price fields, not
          // the generator. Route "Do" at the actual cause.
          const reason = String(row.campaign_skip_reason ?? "").toLowerCase();
          const fixUrl = reason.includes("price")
            ? `/events/${row.id}#fix-price`
            : reason.includes("image")
              ? `/events/${row.id}#section-images`
              : `/creative-generator?eventId=${row.id}`;
          return {
            kind,
            table: "events",
            row_id: row.id,
            label: row.name,
            url: `/events/${row.id}`,
            fixUrl,
            detail: row.campaign_skip_reason
              ? `${row.date} · ${row.campaign_skip_reason}`
              : row.date,
          };
        });
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
          fixUrl: `/events/${row.id}#section-images`,
          detail: row.date,
        }));
      }
      case "team_logo":
      case "team_hero":
      case "team_gallery":
      case "team_bio": {
        let query = db
          .from("football_teams")
          .select("id,name,name_english,art_image_url")
          .eq("is_deleted", false)
          .order("name")
          .limit(LIST_LIMIT);
        query =
          kind === "team_logo"
            ? query.is("logo_url", null)
            : kind === "team_hero"
              ? query.is("image_url", null).is("art_image_url", null)
              : kind === "team_bio"
                ? query.is("bio", null)
                : query.eq("gallery", "[]");
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row: Record<string, string | number | null>) => {
          const label = String(row.name || row.name_english || row.id);
          // Crests are uploaded in the shared logo library (/assets), not on
          // the team form - send "Do" there with the search prefilled. Hero,
          // gallery and bio ARE edited on the form, so those keep their anchors.
          const fixUrl =
            kind === "team_logo"
              ? `/assets?q=${encodeURIComponent(String(row.name_english || row.name || ""))}`
              : `/templates/football/${row.id}/edit#${TEAM_ANCHOR[kind]}`;
          return personGap({
            kind,
            table: "football_teams",
            row,
            label,
            url: `/templates/football/${row.id}/edit`,
            fixUrl,
            ctx,
          });
        });
      }
      case "artist_hero":
      case "artist_gallery":
      case "artist_bio": {
        let query = db
          .from("artists")
          .select("id,name,name_english,art_image_url")
          .eq("is_deleted", false)
          .order("name")
          .limit(LIST_LIMIT);
        query =
          kind === "artist_hero"
            ? query.is("image_url", null).is("art_image_url", null)
            : kind === "artist_bio"
              ? query.is("bio", null)
              : query.eq("gallery", "[]");
        const { data, error } = await query;
        if (error) throw error;
        const anchor =
          kind === "artist_gallery" ? "fix-gallery" : kind === "artist_bio" ? "fix-bio" : "fix-image";
        return (data ?? []).map((row: Record<string, string | number | null>) =>
          personGap({
            kind,
            table: "artists",
            row,
            label: String(row.name || row.name_english || row.id),
            url: `/templates/artists/${row.id}/edit`,
            fixUrl: `/templates/artists/${row.id}/edit#${anchor}`,
            ctx,
          }),
        );
      }
      case "category_content":
        return listCategoryContentGaps(ctx.twins, ctx);
      case "category_image":
        return listCategoryImageGaps(ctx.twins);
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
          fixUrl: `/templates/blog/${row.id}/edit#fix-image`,
        }));
      }
    }
  } catch (error) {
    console.error(`creative-gaps: list ${kind} failed`, JSON.stringify(error));
    return [];
  }
}

/**
 * An artist / team gap row, plus liveEvents: packages selling now (main's
 * on-tour rule) - the queue puts these ahead of wishlist entities.
 */
function personGap(input: {
  kind: GapKind;
  table: "football_teams" | "artists";
  row: Record<string, string | number | null>;
  label: string;
  url: string;
  fixUrl: string;
  ctx: GapContext;
}): GapItem {
  const { kind, row, ctx } = input;
  return {
    kind,
    table: input.table,
    row_id: row.id as number,
    label: input.label,
    url: input.url,
    fixUrl: input.fixUrl,
    liveEvents: ctx.live(String(row.name_english ?? "")),
  };
}

/**
 * Every gap, in one list - what the gaps tab shows. Ordered by severity so the
 * things that block advertising sit above the page-quality ones; inside a
 * severity, artists / teams with packages selling NOW come before the wishlist
 * ones; then by type so identical
 * work stays together (all the missing crests in a row).
 *
 * Per-kind queries are capped, so the merged list is capped too; the count on
 * the dashboard panel is the exact total, this is the work queue.
 */
export async function listAllCreativeGaps(): Promise<GapItem[]> {
  await requireStaff();

  const ctx = await buildGapContext();
  const [lists, dismissed] = await Promise.all([
    Promise.all(GAP_KINDS.map((kind) => listGapsOfKind(kind, ctx))),
    db
      .from("creative_gap_dismissals")
      .select("gap_key")
      .then(({ data }: { data: { gap_key: string }[] | null }) =>
        new Set((data ?? []).map((row) => row.gap_key)),
      ),
  ]);

  const severityRank = (kind: GapKind) =>
    GAP_META[kind].severity === "crit" ? 0 : 1;
  const liveRank = (item: GapItem) => ((item.liveEvents ?? 0) > 0 ? 0 : 1);

  return lists
    .flat()
    .filter((item) => !dismissed.has(gapKey(item.kind, item.table, item.row_id)))
    .sort(
      (a, b) =>
        severityRank(a.kind) - severityRank(b.kind) ||
        liveRank(a) - liveRank(b) ||
        GAP_KINDS.indexOf(a.kind) - GAP_KINDS.indexOf(b.kind) ||
        (b.liveEvents ?? 0) - (a.liveEvents ?? 0) ||
        a.label.localeCompare(b.label),
    );
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
