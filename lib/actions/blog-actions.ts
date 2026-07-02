"use server";

import {
  listRows,
  getRow,
  createRow,
  updateRow,
  softDeleteRow,
} from "./template-crud";
import type {
  BlogPost,
  CreateBlogData,
  UpdateBlogData,
} from "../../types/blog.types";

const TABLE = "blog_posts";
const REVALIDATE = ["/templates", "/templates/blog"];

export async function getBlogPosts(): Promise<BlogPost[]> {
  return listRows<BlogPost>(TABLE, "display_order");
}
export async function getBlogPost(id: number): Promise<BlogPost> {
  return getRow<BlogPost>(TABLE, id);
}
export async function createBlogPost(data: CreateBlogData): Promise<BlogPost> {
  return createRow<BlogPost>(TABLE, data, REVALIDATE);
}
export async function updateBlogPost(id: number, data: UpdateBlogData): Promise<BlogPost> {
  return updateRow<BlogPost>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteBlogPost(id: number): Promise<BlogPost> {
  return softDeleteRow<BlogPost>(TABLE, id, REVALIDATE);
}
