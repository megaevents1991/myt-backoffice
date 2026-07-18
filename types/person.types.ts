/**
 * Person — typed row shared by the `artists` and `football_teams` tables
 * (identical schema). Managed in the backoffice, read by myt-main. Keep in sync
 * with myt-main `lib/app.types.ts` (`Artist`/`FootballTeam` runtime shapes).
 */
export interface Person {
  id: number;
  slug: string;
  name: string;
  name_english: string | null;
  preview_text: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  // Blob card-art (optional); falls back to image_url when art_image_url is null.
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
  // Zoom (1 = 100%): cut-out scale + background (blob/photo) scale.
  art_image_scale: number | null;
  art_bg_scale: number | null;
  // Cut-out position, % of frame (null/0 = default bottom-center). X+ = right, Y+ = down.
  art_image_offset_x: number | null;
  art_image_offset_y: number | null;
  // Club logo for the creative generator — transparent PNG only.
  logo_url: string | null;
  bio: unknown; // Contentful-compatible rich-text document
  seo_title: string | null;
  meta_description: string | null;
  meta_tags: string | null;
  featured_order: number | null;
  // Page enrichments (doc 19b/20/21/24) — read by myt-main artist/team pages.
  hero_video_url: string | null;
  banners: { image_url?: string; link_url?: string; title?: string }[] | null;
  gallery: string[] | null;
  videos: { url?: string; label?: string }[] | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export type CreatePersonData = Omit<
  Person,
  "id" | "is_deleted" | "created_at" | "updated_at"
>;
export type UpdatePersonData = Partial<CreatePersonData>;

export type PersonKind = "artists" | "football_teams";
