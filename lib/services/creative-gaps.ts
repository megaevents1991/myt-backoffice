/**
 * Session-free core of the creative-gaps radar. Extracted out of
 * `lib/actions/creative-gap-actions.ts` (Task 8, tasks hub) so the weekly
 * cron generator (`lib/services/task-rules/creative-gaps.ts`) can compute the
 * open gap list without a request context - `listAllCreativeGaps()` there is
 * a `"use server"` action that starts with `requireStaff()`, which throws
 * with no session (a cron run has none). This file has no auth and no
 * "use server" directive; `creative-gap-actions.ts` stays the only
 * staff-facing entry point and now just guards + delegates.
 *
 * Live queries only - no table backs this. Two soft-delete dialects to get
 * right: events.is_deleted is a DATE (deleted = not null), while the template
 * tables (artists/football_teams/categories/blog_posts) use boolean is_deleted.
 * gallery is jsonb defaulting to '[]' - an empty one is never NULL.
 */
import { supabase } from "@/lib/supabase-server";
import { buildLiveEventCounter, type OnTourEvent } from "@/lib/on-tour";
import type { CategoryPageContent } from "@/types/page-content.types";
import { GAP_KINDS, GAP_META, gapKey, type GapItem, type GapKind } from "@/types/creative-gap.types";

// Several of these tables predate the generated database types - cast once at
// the boundary, same pattern as creative-gap-actions.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Feed window = the same eligibility meta-feed uses: live + not past. */
export function feedEvents() {
  return db
    .from("events")
    .select("id", { count: "exact", head: true })
    .is("is_deleted", null)
    .gte("date", todayISO());
}

/** Which field on the team form fixes each form-fixable team gap. */
const TEAM_ANCHOR: Record<string, string> = {
  team_hero: "fix-image",
  team_gallery: "fix-gallery",
  team_bio: "fix-bio",
};

const LIST_LIMIT = 300;

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

/** Options threaded down from computeOpenCreativeGaps() to every per-kind loader.
 *  See the doc comment on `strict` there for why the two callers differ. */
export interface GapLoadOptions {
  strict?: boolean;
}

/**
 * Active categories whose page has no text at all. Most of these are the
 * per-team / per-artist category pages (taxonomy v2), so they take the same
 * on-sale ranking as the team itself when a context is given.
 */
export async function listCategoryContentGaps(
  ctx?: GapContext,
  opts: GapLoadOptions = {},
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
    if (opts.strict) throw new Error("creative-gaps: category_content failed");
    return [];
  }
  return (data ?? [])
    .filter(
      (row: { page_content: CategoryPageContent | null }) => !hasPageText(row.page_content),
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
export interface GapContext {
  live: (nameEnglish?: string | null) => number;
}

export async function buildGapContext(): Promise<GapContext> {
  const { data, error } = await db
    .from("events")
    .select("name_english,date")
    .is("is_deleted", null)
    .gte("date", todayISO());
  if (error) {
    console.error("creative-gaps: live events failed", JSON.stringify(error));
  }
  return { live: buildLiveEventCounter((data ?? []) as OnTourEvent[]) };
}

/** Concrete rows for one gap kind - the drill-down tab. */
export async function listGapsOfKind(
  kind: GapKind,
  ctx: GapContext,
  opts: GapLoadOptions = {},
): Promise<GapItem[]> {
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
              ? query.is("image_url", null)
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
            ? query.is("image_url", null)
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
        return listCategoryContentGaps(ctx, opts);
      case "category_image": {
        const { data, error } = await db
          .from("categories")
          .select("id,name,name_english")
          .eq("is_deleted", false)
          .eq("is_active", true)
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
          fixUrl: `/templates/categories/${row.id}/edit#fix-image`,
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
          fixUrl: `/templates/blog/${row.id}/edit#fix-image`,
        }));
      }
    }
  } catch (error) {
    console.error(`creative-gaps: list ${kind} failed`, JSON.stringify(error));
    // strict (the rule generator): propagate so the whole Promise.all rejects instead of
    // reading this kind's failure as "no gaps". Non-strict (the /tasks gaps tab, unchanged):
    // this kind degrades to an empty list, exactly today's behaviour.
    if (opts.strict) throw error instanceof Error ? error : new Error(`creative-gaps: ${kind} failed`);
    return [];
  }
}

/**
 * An artist / team gap row. Two extras over the plain shape:
 * - liveEvents: packages selling now (main's on-tour rule) - the queue puts
 *   these ahead of wishlist entities.
 * - demoted: a hero gap on an entity that already has blob card-art. Cards on
 *   the site look right, only the page hero is missing - still listed, but
 *   ranked after the fully-missing ones.
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
  const liveEvents = ctx.live(String(row.name_english ?? ""));
  const demoted =
    (kind === "team_hero" || kind === "artist_hero") && !!row.art_image_url;
  return {
    kind,
    table: input.table,
    row_id: row.id as number,
    label: input.label,
    url: input.url,
    fixUrl: input.fixUrl,
    liveEvents,
    demoted,
    detail: demoted ? "יש בלוב לכרטיסים · חסרה תמונת ראש לעמוד" : undefined,
  };
}

/**
 * Every gap, in one list - what the gaps tab shows, and what the
 * `creative_gaps` rule generator filters. Ordered by severity so the things
 * that block advertising sit above the page-quality ones; inside a severity,
 * artists / teams with packages selling NOW come before the wishlist ones and
 * blob-demoted hero gaps drop to the end; then by type so identical work
 * stays together (all the missing crests in a row).
 *
 * Per-kind queries are capped, so the merged list is capped too; the count on
 * the dashboard panel is the exact total, this is the work queue.
 *
 * Session-free: no auth check here. `listAllCreativeGaps()` in
 * creative-gap-actions.ts is the staff-facing entry point (requireStaff() +
 * this); the weekly cron's creative_gaps rule generator calls this directly.
 *
 * `strict` (default false) governs what a per-kind DB failure does, and the two
 * callers deliberately differ: the `/tasks` gaps tab (`listAllCreativeGaps`,
 * unchanged, calls with no options) shows a partial list rather than an empty
 * screen when one kind's query fails - that's today's behaviour and stays.
 * The `creative_gaps` rule generator (`lib/services/task-rules/creative-gaps.ts`)
 * calls with `{ strict: true }`, because the weekly cron auto-closes a digest
 * task the moment its generator returns zero candidates - a swallowed failure
 * there would silently close an open digest, so it must reject the whole
 * `Promise.all` instead of quietly reading as "no gaps" for that kind.
 */
export async function computeOpenCreativeGaps(opts: GapLoadOptions = {}): Promise<GapItem[]> {
  const ctx = await buildGapContext();
  const [lists, dismissed] = await Promise.all([
    Promise.all(GAP_KINDS.map((kind) => listGapsOfKind(kind, ctx, opts))),
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
  const demotedRank = (item: GapItem) => (item.demoted ? 1 : 0);

  return lists
    .flat()
    .filter((item) => !dismissed.has(gapKey(item.kind, item.table, item.row_id)))
    .sort(
      (a, b) =>
        severityRank(a.kind) - severityRank(b.kind) ||
        liveRank(a) - liveRank(b) ||
        demotedRank(a) - demotedRank(b) ||
        GAP_KINDS.indexOf(a.kind) - GAP_KINDS.indexOf(b.kind) ||
        (b.liveEvents ?? 0) - (a.liveEvents ?? 0) ||
        a.label.localeCompare(b.label),
    );
}
