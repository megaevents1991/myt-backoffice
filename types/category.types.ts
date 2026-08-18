import type { TemplateBase, CreateBase } from "./template.types";
import type { CategoryPageContent } from "./page-content.types";

/**
 * Category ("Template") - typed row of the `categories` table. Managed in the
 * backoffice, read by myt-main. Shared DB shape: keep in sync with myt-main
 * `lib/app.types.ts` (`Category`).
 */
export interface Category extends TemplateBase {
  subtitle: string | null;
  tag: string | null;
  sport: string | null;
  /** Tree position - a category page nests under its parent (/c/sport/football). */
  parent_id: number | null;
  /** Artist/team page IDs grouped under this category (Contentful IDs for now). */
  member_ids: string[];
  /** Optional override link; when set the card links here instead of /category/[slug]. */
  link_url: string | null;
  /**
   * Rich content of the category's PAGE on the site (hub verticals like
   * כדורגל, and the league/genre pages under them): marketing text, gallery,
   * stadium cards, FAQ. NULL on plain nodes - myt-main then falls back to its
   * bundled launch copy. Edited with `PageContentField`.
   */
  page_content: CategoryPageContent | null;
}

export type CreateCategoryData = CreateBase<Category>;
export type UpdateCategoryData = Partial<CreateCategoryData>;
