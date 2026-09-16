/**
 * Team/artist <-> category "twin" matching (Task 16, tasks hub, 2026-09-16).
 *
 * myt-main's `app/c/[...slug]/page.tsx` renders a category page as
 * `TeamCmsPage` / `ArtistCmsPage` (blob art in the hero) instead of the
 * generic category page when the category's parent is the `teams` /
 * `artists` hub, its name matches a real team/artist, AND that matched
 * person has both a non-empty name and a non-empty English name
 * (`twin.fields.name && twin.fields.nameDBenglish` - main's actual render
 * gate). Anything short of that renders the generic category page instead,
 * which DOES show `categories.image_url`/`page_content` - so this file's
 * `isRenderable` check matters, not just the name match.
 *
 * `lib/actions/portal-site-pages-actions.ts` already had this exact rule
 * inline (`twinFor`, for the partner link builder); this file is that rule
 * pulled out so the creative-gaps radar (`lib/services/creative-gaps.ts`)
 * can reuse it byte-for-byte instead of a second, possibly-drifting matcher.
 * portal-site-pages-actions.ts now imports `findCategoryTwin` from here -
 * behaviour there is unchanged except that a person with no English name no
 * longer counts as a twin (it previously could match on Hebrew name alone;
 * that link now falls back to the legacy `/artists/<slug>` or
 * `/football/<slug>` route, exactly what main's own 308 does when no twin
 * exists - see the report for the one case this can affect).
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
 * main's render gate: a matched person only actually gets `TeamCmsPage`/
 * `ArtistCmsPage` when BOTH names are non-empty. A person with a Hebrew name
 * but no English one still matches by name, but main falls back to the
 * generic category page for it - so it is not a twin here either.
 */
function isRenderable(person: TwinPerson): boolean {
  return !!person.name.trim() && !!(person.name_english ?? "").trim();
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
  if (hubId == null || !isRenderable(person)) return null;
  return categories.find((c) => c.parent_id === hubId && namesMatch(c, person)) ?? null;
}

/**
 * Category -> its team/artist twin, if any (the direction the creative-gaps
 * radar needs). Gated on the category's parent being the right hub, same as
 * main's cmsTwin.ts; checks the team roster when the parent is `teams`, the
 * artist roster when it's `artists`, never both. A candidate that fails
 * `isRenderable` is skipped, same as `findCategoryTwin`.
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
    const team = teams.find((t) => isRenderable(t) && namesMatch(category, t));
    if (team) return { kind: "team", id: team.id, name: team.name };
  }
  if (artistHubId != null && category.parent_id === artistHubId) {
    const artist = artists.find((a) => isRenderable(a) && namesMatch(category, a));
    if (artist) return { kind: "artist", id: artist.id, name: artist.name };
  }
  return null;
}
