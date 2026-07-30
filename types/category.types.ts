import type { TemplateBase, CreateBase } from "./template.types";

/**
 * Category ("Template") — typed row of the `categories` table. Managed in the
 * backoffice, read by myt-main. Shared DB shape: keep in sync with myt-main
 * `lib/app.types.ts` (`Category`).
 */
export interface Category extends TemplateBase {
  subtitle: string | null;
  tag: string | null;
  sport: string | null;
  /** Tree position — a category page nests under its parent (/c/sport/football). */
  parent_id: number | null;
  /** Artist/team page IDs grouped under this category (Contentful IDs for now). */
  member_ids: string[];
  /** Optional override link; when set the card links here instead of /category/[slug]. */
  link_url: string | null;
}

export type CreateCategoryData = CreateBase<Category>;
export type UpdateCategoryData = Partial<CreateCategoryData>;
