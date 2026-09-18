"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { flattenWithPath, slugPathOf } from "@/lib/taxonomy-tree";
import { findCategoryTwin } from "@/lib/services/category-twins";
import type { EventCategory } from "@/types/taxonomy.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * A site page a partner can point their tracking link at (Tom, 2026-09-10:
 * "לבחור עמוד מהאתר שיהיה ישירות עם הלינק שלהם - עמוד אמן או עמוד קטגוריה
 * או עמוד קבוצה").
 *
 * `path` is the canonical /c/ path on myt-main. Artists and teams resolve to
 * their category twin under the "artists" / "teams" hubs (the same match
 * myt-main's cmsTwin.ts makes); the legacy /artists/<slug> and
 * /football/<slug> routes are the fallback when no twin exists - they 308 to
 * the twin anyway, and the UTM is captured by the middleware before that.
 */
export interface SitePageOption {
  kind: "category" | "artist" | "team";
  /** "כדורגל › ליגה אנגלית › ליברפול" */
  label: string;
  /** Search only - "Liverpool" must find "ליברפול". */
  label_english: string | null;
  path: string;
}

/** Hub slugs on the site (myt-main lib/cmsTwin.ts HUB_SLUG). */
const HUB_SLUG = { team: "teams", artist: "artists" } as const;

interface PersonRow {
  id: number;
  name: string;
  name_english: string | null;
  slug: string;
}

// The name-matching rule lives in lib/services/category-twins.ts (findCategoryTwin),
// shared with the creative-gaps radar and mirroring main's /c/ page exactly: the
// FIRST name match in the active, name-ordered roster decides, so the whole roster
// travels with each lookup.
function twinFor(
  person: PersonRow,
  hubId: number | undefined,
  categories: EventCategory[],
  roster: PersonRow[],
): EventCategory | null {
  return findCategoryTwin(person, hubId, categories, roster);
}

export async function listSitePages(): Promise<SitePageOption[]> {
  await requirePartner();

  const [catsRes, artistsRes, teamsRes] = await Promise.all([
    db
      .from("categories")
      .select("id,name,name_english,slug,parent_id,display_order")
      .eq("is_deleted", false)
      .eq("is_active", true),
    db
      .from("artists")
      .select("id,name,name_english,slug")
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("name"),
    db
      .from("football_teams")
      .select("id,name,name_english,slug")
      .eq("is_deleted", false)
      .eq("is_active", true)
      .order("name"),
  ]);
  for (const [what, res] of [
    ["categories", catsRes],
    ["artists", artistsRes],
    ["teams", teamsRes],
  ] as const) {
    if (res.error) console.error(`site-pages: ${what} failed`, JSON.stringify(res.error));
  }

  const categories = (catsRes.data ?? []) as EventCategory[];
  const labelOf = new Map(flattenWithPath(categories).map((c) => [c.id, c.path]));
  const pathOf = (cat: EventCategory) => `/c/${slugPathOf(cat, categories).join("/")}`;

  const hubIds = {
    team: categories.find((c) => c.slug === HUB_SLUG.team)?.id,
    artist: categories.find((c) => c.slug === HUB_SLUG.artist)?.id,
  };
  const twinned = new Set<number>();
  const personPages = (
    [
      ["artist", (artistsRes.data ?? []) as PersonRow[], "/artists/"],
      ["team", (teamsRes.data ?? []) as PersonRow[], "/football/"],
    ] as const
  ).flatMap(([kind, rows, legacyPrefix]) =>
    rows.flatMap((person): SitePageOption[] => {
      const twin = twinFor(person, hubIds[kind], categories, rows);
      if (twin) {
        // The category row lists this page too - keep one entry, labelled
        // as the person so it reads naturally in the search.
        twinned.add(twin.id);
        return [{ kind, label: person.name, label_english: person.name_english, path: pathOf(twin) }];
      }
      if (!person.slug) return [];
      return [
        { kind, label: person.name, label_english: person.name_english, path: `${legacyPrefix}${person.slug}` },
      ];
    }),
  );

  const categoryPages: SitePageOption[] = categories
    .filter((c) => !!c.slug && !twinned.has(c.id))
    .map((c) => ({
      kind: "category",
      label: labelOf.get(c.id) ?? c.name,
      label_english: c.name_english ?? null,
      path: pathOf(c),
    }));

  return [...personPages, ...categoryPages].sort((a, b) =>
    a.label.localeCompare(b.label, "he"),
  );
}
