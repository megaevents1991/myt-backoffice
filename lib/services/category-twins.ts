/**
 * Team/artist <-> category "twin" matching (Task 16, tasks hub, 2026-09-16).
 *
 * myt-main's `lib/cmsTwin.ts` renders a category page as `TeamCmsPage` /
 * `ArtistCmsPage` (blob art in the hero, no separate card image needed) when
 * the category's parent is the `teams` / `artists` hub AND its name matches a
 * real team/artist. `lib/actions/portal-site-pages-actions.ts` already had
 * this exact rule inline (`twinFor`, for the partner link builder); this file
 * is that rule pulled out so the creative-gaps radar (`lib/services/creative-gaps.ts`)
 * can reuse it byte-for-byte instead of a second, possibly-drifting matcher.
 * portal-site-pages-actions.ts now imports `findCategoryTwin` from here -
 * behaviour there is unchanged.
 */
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";

// categories predates the generated database types on some call sites here -
// same boundary-cast pattern as creative-gaps.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Hub slugs on the site (myt-main lib/cmsTwin.ts HUB_SLUG). */
export const TWIN_HUB_SLUG = { team: "teams", artist: "artists" } as const;

export interface TwinHub {
  id: number;
  slug: string;
}

export interface TwinPerson {
  id: number;
  name: string;
  name_english: string | null;
}

export interface TwinCategory {
  id: number;
  parent_id: number | null;
  name: string;
  name_english: string | null;
}

export interface TwinMatch {
  kind: "team" | "artist";
  id: number;
  name: string;
}

/**
 * The name-matching rule itself - lifted verbatim from
 * portal-site-pages-actions.ts's old inline `twinFor` body. Case/whitespace
 * insensitive; a category and a person match when either side's English name
 * equals the other's Hebrew name, or both English names match, or both
 * Hebrew names match.
 */
export function namesMatch(
  category: Pick<TwinCategory, "name" | "name_english">,
  person: Pick<TwinPerson, "name" | "name_english">,
): boolean {
  const catEn = (category.name_english ?? "").trim().toLowerCase();
  const catHe = category.name.trim().toLowerCase();
  const en = (person.name_english ?? "").trim().toLowerCase();
  const he = person.name.trim().toLowerCase();
  return (!!en && (catEn === en || catHe === en)) || (!!he && catHe === he);
}

/**
 * Person -> its twin category, if any (the direction portal-site-pages-actions.ts
 * needs for the partner link builder). `hubId` is the id of the `teams` or
 * `artists` category depending on which roster `person` came from. Generic
 * over the caller's own category row shape (e.g. `EventCategory`, which
 * carries more fields than the bare `TwinCategory` this only needs to read)
 * so the caller gets back its own richer type, not a narrowed one.
 */
export function findCategoryTwin<C extends TwinCategory>(
  person: TwinPerson,
  hubId: number | undefined,
  categories: C[],
): C | null {
  if (hubId == null) return null;
  return categories.find((c) => c.parent_id === hubId && namesMatch(c, person)) ?? null;
}

/**
 * Category -> its team/artist twin, if any (the direction the creative-gaps
 * radar needs). Gated on the category's parent being the right hub, same as
 * main's cmsTwin.ts; checks the team roster when the parent is `teams`, the
 * artist roster when it's `artists`, never both.
 */
export function findTwin(
  category: TwinCategory,
  hubs: TwinHub[],
  teams: TwinPerson[],
  artists: TwinPerson[],
): TwinMatch | null {
  if (category.parent_id == null) return null;
  const teamHubId = hubs.find((h) => h.slug === TWIN_HUB_SLUG.team)?.id;
  const artistHubId = hubs.find((h) => h.slug === TWIN_HUB_SLUG.artist)?.id;
  if (teamHubId != null && category.parent_id === teamHubId) {
    const team = teams.find((t) => namesMatch(category, t));
    if (team) return { kind: "team", id: team.id, name: team.name };
  }
  if (artistHubId != null && category.parent_id === artistHubId) {
    const artist = artists.find((a) => namesMatch(category, a));
    if (artist) return { kind: "artist", id: artist.id, name: artist.name };
  }
  return null;
}

/**
 * Step 4 (Task 16): a team/artist that just got a hero (or, failing that,
 * blob) image fills its twin category's card image too, when that category
 * still has none - the category card and the person's own page are the same
 * photo, so an empty card is a copy step nobody did, not a missing asset.
 *
 * Writes ONLY `categories.image_url`, ONLY when it is currently null/empty,
 * and ONLY for a real twin; never overwrites an existing category image
 * (guarded both in code and by `.is("image_url", null)` on the write itself,
 * so a concurrent edit can't race it). Throws on a real failure - the caller
 * (the team/artist save action) wraps this in try/catch so a failure here
 * never fails the save.
 */
export async function fillTwinCategoryImage(input: {
  kind: "team" | "artist";
  personId: number;
  person: TwinPerson;
  imageUrl: string;
}): Promise<void> {
  const hubSlug = TWIN_HUB_SLUG[input.kind];
  const { data: hub, error: hubError } = await db
    .from("categories")
    .select("id")
    .eq("slug", hubSlug)
    .eq("is_deleted", false)
    .maybeSingle();
  if (hubError) throw hubError;
  if (!hub) return;

  const { data: categories, error: catError } = await db
    .from("categories")
    .select("id,parent_id,name,name_english,image_url")
    .eq("parent_id", hub.id)
    .eq("is_deleted", false);
  if (catError) throw catError;

  const rows = (categories ?? []) as (TwinCategory & { image_url: string | null })[];
  const twin = findCategoryTwin(input.person, hub.id, rows);
  if (!twin) return;
  const twinRow = rows.find((c) => c.id === twin.id);
  if (twinRow?.image_url) return; // never overwrite an existing category image

  const { error: updateError, data: updated } = await db
    .from("categories")
    .update({ image_url: input.imageUrl })
    .eq("id", twin.id)
    .is("image_url", null)
    .select("id");
  if (updateError) throw updateError;
  if (!updated || updated.length === 0) return; // lost the race - someone else filled it first

  await logAudit({
    action: "category.image_from_twin",
    entityType: "categories",
    entityId: twin.id,
    metadata: {
      category_id: twin.id,
      from: input.kind,
      person_id: input.personId,
      url: input.imageUrl,
    },
  });
}
