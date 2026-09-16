/**
 * Team/artist <-> category "twin" matching (Task 16, tasks hub, 2026-09-16).
 *
 * Mirrors myt-main's `app/c/[...slug]/page.tsx` EXACTLY (final review): for a
 * category whose parent is the `teams` / `artists` hub, main takes the ACTIVE
 * roster ordered by name (`lib/cms/people.ts` listAll), finds the FIRST person
 * whose name matches -
 *   `(catEn && (personEn === catEn || personName === catEn)) || personName === catHe`
 * (all trimmed + lowercased) - and only THEN renders `TeamCmsPage` /
 * `ArtistCmsPage` if that first person has a non-empty name AND English name.
 * Match first, gate after: if the first match lacks an English name the
 * category is NOT a twin, even when a later person would also have matched and
 * passed the gate. A non-twin renders the generic category page, which DOES
 * show `categories.image_url`/`page_content`.
 *
 * Callers must hand in the roster the way main reads it: `is_active = true`
 * (and not deleted), ordered by `name`. Used by the creative-gaps radar
 * (`lib/services/creative-gaps.ts`) and the partner link builder
 * (`lib/actions/portal-site-pages-actions.ts`), so the two can never drift.
 */
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
 * main's name comparison, verbatim (see the file header): a person matches a
 * category when the category has an English name equal to the person's English
 * OR Hebrew name, or the person's Hebrew name equals the category's Hebrew name.
 */
export function namesMatch(
  category: Pick<TwinCategory, "name" | "name_english">,
  person: Pick<TwinPerson, "name" | "name_english">,
): boolean {
  const catEn = (category.name_english ?? "").trim().toLowerCase();
  const catHe = category.name.trim().toLowerCase();
  const personEn = (person.name_english ?? "").trim().toLowerCase();
  const personName = person.name.trim().toLowerCase();
  return (!!catEn && (personEn === catEn || personName === catEn)) || personName === catHe;
}

/** main's render gate, applied to the FIRST match only. */
function isRenderable(person: TwinPerson): boolean {
  return !!person.name.trim() && !!(person.name_english ?? "").trim();
}

/** The person main would render for this category (first match, then the gate), or null. */
function twinPersonFor(category: TwinCategory, roster: TwinPerson[]): TwinPerson | null {
  const first = roster.find((person) => namesMatch(category, person));
  return first && isRenderable(first) ? first : null;
}

/**
 * Person -> its twin category, if any (the direction the partner link builder
 * needs). `hubId` is the id of the `teams` or `artists` category depending on
 * which `roster` `person` came from; `roster` is that whole active,
 * name-ordered list, because whether `person` wins a category depends on who
 * else matches it first. Generic over the caller's own category row shape so
 * the caller gets back its own richer type.
 */
export function findCategoryTwin<C extends TwinCategory>(
  person: TwinPerson,
  hubId: number | undefined,
  categories: C[],
  roster: TwinPerson[],
): C | null {
  if (hubId == null) return null;
  return (
    categories.find(
      (c) => c.parent_id === hubId && twinPersonFor(c, roster)?.id === person.id,
    ) ?? null
  );
}

/**
 * Category -> its team/artist twin, if any (the direction the creative-gaps
 * radar needs). Gated on the category's parent being the right hub; checks the
 * team roster when the parent is `teams`, the artist roster when it's
 * `artists`, never both.
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
    const team = twinPersonFor(category, teams);
    if (team) return { kind: "team", id: team.id, name: team.name };
  }
  if (artistHubId != null && category.parent_id === artistHubId) {
    const artist = twinPersonFor(category, artists);
    if (artist) return { kind: "artist", id: artist.id, name: artist.name };
  }
  return null;
}
