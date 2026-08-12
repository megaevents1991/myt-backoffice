/** Blog post - typed row of the `blog_posts` table. */
export interface BlogPost {
  id: number;
  slug: string;
  name: string;
  title: string | null;
  preview_text: string | null;
  by_who: string | null;
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
  main_content: unknown; // Contentful-compatible rich-text document
  seo_title_tag: string | null;
  meta_description: string | null;
  meta_tags: string | null;
  display_order: number;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export type CreateBlogData = Omit<
  BlogPost,
  "id" | "is_deleted" | "created_at" | "updated_at"
>;
export type UpdateBlogData = Partial<CreateBlogData>;
