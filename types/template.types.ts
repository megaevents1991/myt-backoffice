/**
 * Backoffice CMS template types — one typed table per content type (replacing
 * Contentful). Every table shares `TemplateBase`; each adds its own columns.
 */
export interface TemplateBase {
  id: number;
  slug: string;
  name: string;
  name_english: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

/** Fields shared by every create form (base minus server-managed columns). */
export type CreateBase<T extends TemplateBase> = Omit<
  T,
  "id" | "is_deleted" | "created_at" | "updated_at"
>;
