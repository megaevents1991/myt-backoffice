/** Blog post — typed row of the `blog_posts` table. */
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
