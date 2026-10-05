/**
 * What the pickers of the site editors choose from: the active company's tours,
 * terms and content pages. Shared by the home page / header & footer editors
 * (lib/actions/tours-site-actions.ts) and the world editor
 * (lib/actions/tours-content-actions.ts).
 *
 * Server code, not a "use server" module: it takes a Company, so it must never
 * become an action a browser can call.
 */
import type { Company } from "@/lib/company";
import { toursDb } from "@/lib/tours/db";
import { fetchAll } from "@/lib/tours/action-kit";
import { asObject } from "@/lib/tours/company-kit";

export interface SiteEditorOptions {
  tours: { slug: string; name: string }[];
  terms: { kind: string; slug: string; name: string; path: string }[];
  pages: { path: string; title: string }[];
}

/** Route folder of each term kind on the site (mega-family scripts/sync-content.mjs TERM_FOLDER). */
const TERM_FOLDER: Record<string, string> = {
  destinations: "destinations",
  audiences: "audience",
  tags: "product-tag",
  artists: "artists",
  categories: "product-category",
};

export async function siteEditorOptions(company: Company): Promise<SiteEditorOptions> {
  const db = toursDb();
  const [tours, terms, pages] = await Promise.all([
    fetchAll((from, to) =>
      db
        .from("packages")
        .select("slug, name, data")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .is("is_deleted", null)
        .order("name")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      db
        .from("terms")
        .select("kind, slug, name, data")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .in("kind", Object.keys(TERM_FOLDER))
        .order("position")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      db
        .from("cms_pages")
        .select("path, title")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .in("kind", ["page", "post"])
        .order("title")
        .order("id")
        .range(from, to),
    ),
  ]);
  return {
    // a series without a page of its own is not a tour the site lists
    tours: tours.filter((t) => asObject(t.data).stub !== true).map((t) => ({ slug: t.slug, name: t.name })),
    terms: terms.map((t) => {
      const stored = asObject(t.data).path;
      return {
        kind: t.kind,
        slug: t.slug,
        name: t.name,
        path: typeof stored === "string" && stored ? stored : `/${TERM_FOLDER[t.kind]}/${t.slug}/`,
      };
    }),
    pages: pages.filter((p) => p.path.startsWith("/")).map((p) => ({ path: p.path, title: p.title })),
  };
}
