/** Where a sourced task's subject lives on the CUSTOMER site (Alon, 2026-09-18:
 *  "שלוחצים זה מעביר לבק אופיס - שיהיה גם מעבר לעמוד באתר"). source_ref.url is
 *  the backoffice screen that fixes it; this is the page a customer sees.
 *
 *  events -> /order/{id}; teams / artists -> their legacy routes, which main
 *  redirects to the /c/ twin when one exists; categories -> the /c/ slug path.
 *  Best-effort: a failed lookup leaves the link out, never fails the list. */
import { supabase } from "@/lib/supabase-server";
import { eventSiteUrl, PUBLIC_SITE_URL } from "@/lib/site";
import { slugPathOf } from "@/lib/taxonomy-tree";
import type { EventCategory } from "@/types/taxonomy.types";

/** All the resolver needs - a task's source_ref and a creative gap both have it. */
type SiteRef = { table: string; row_id: string | number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PERSON_PREFIX: Record<string, string> = {
  football_teams: "/football/",
  artists: "/artists/",
};

const refKey = (ref: SiteRef) => `${ref.table}:${ref.row_id}`;

/** `${table}:${row_id}` -> absolute site URL, for every ref that has a page. */
export async function siteUrlsForRefs(
  refs: (SiteRef | null)[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  // Ids as strings: source_ref.row_id is a number on some rows and a string on others.
  const idsByTable = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref?.table || ref.row_id == null) continue;
    if (ref.table === "events") {
      urls.set(refKey(ref), eventSiteUrl(ref.row_id));
      continue;
    }
    if (ref.table in PERSON_PREFIX || ref.table === "categories") {
      const ids = idsByTable.get(ref.table) ?? new Set();
      ids.add(String(ref.row_id));
      idsByTable.set(ref.table, ids);
    }
  }

  try {
    for (const [table, prefix] of Object.entries(PERSON_PREFIX)) {
      const ids = idsByTable.get(table);
      if (!ids?.size) continue;
      const { data, error } = await db.from(table).select("id,slug").in("id", [...ids]);
      if (error) {
        console.error(`task-site-url: ${table} lookup failed`, JSON.stringify(error));
        continue;
      }
      for (const row of (data ?? []) as { id: number; slug: string | null }[]) {
        if (row.slug) urls.set(`${table}:${row.id}`, `${PUBLIC_SITE_URL}${prefix}${row.slug}`);
      }
    }

    const categoryIds = idsByTable.get("categories");
    if (categoryIds?.size) {
      // The whole tree (small): a category's URL is its slug PATH from the root.
      const { data, error } = await db
        .from("categories")
        .select("id,name,name_english,slug,parent_id,display_order")
        .eq("is_deleted", false);
      if (error) {
        console.error("task-site-url: categories lookup failed", JSON.stringify(error));
      } else {
        const categories = (data ?? []) as EventCategory[];
        for (const category of categories) {
          if (!category.slug || !categoryIds.has(String(category.id))) continue;
          urls.set(
            `categories:${category.id}`,
            `${PUBLIC_SITE_URL}/c/${slugPathOf(category, categories).join("/")}`,
          );
        }
      }
    }
  } catch (error) {
    console.error("task-site-url: lookup failed", error);
  }
  return urls;
}

export function siteUrlOf(ref: SiteRef | null, urls: Map<string, string>): string | null {
  if (!ref?.table || ref.row_id == null) return null;
  return urls.get(refKey(ref)) ?? null;
}
