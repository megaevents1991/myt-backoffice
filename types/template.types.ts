/**
 * Backoffice CMS template types - one typed table per content type (replacing
 * Contentful). Every table shares `TemplateBase`; each adds its own columns.
 */
export interface TemplateBase {
  id: number;
  slug: string;
  name: string;
  name_english: string | null;
  image_url: string | null;
  // Blob card-art (optional). When art_image_url is set the site shows the
  // cut-out over a neon blob; otherwise it falls back to image_url.
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
  // Zoom (1 = 100%): cut-out scale + background (blob/photo) scale.
  art_image_scale: number | null;
  art_bg_scale: number | null;
  // Cut-out position, % of frame (null/0 = default bottom-center). X+ = right, Y+ = down.
  art_image_offset_x: number | null;
  art_image_offset_y: number | null;
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
