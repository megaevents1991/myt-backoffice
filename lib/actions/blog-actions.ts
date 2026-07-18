"use server";

import { requireStaff } from "@/lib/auth/guards";
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
  await requireStaff();
  return listRows<BlogPost>(TABLE, "display_order");
}
export async function getBlogPost(id: number): Promise<BlogPost> {
  await requireStaff();
  return getRow<BlogPost>(TABLE, id);
}
export async function createBlogPost(data: CreateBlogData): Promise<BlogPost> {
  await requireStaff();
  return createRow<BlogPost>(TABLE, data, REVALIDATE);
}
export async function updateBlogPost(id: number, data: UpdateBlogData): Promise<BlogPost> {
  await requireStaff();
  return updateRow<BlogPost>(TABLE, id, data, REVALIDATE);
}
export async function softDeleteBlogPost(id: number): Promise<BlogPost> {
  await requireStaff();
  return softDeleteRow<BlogPost>(TABLE, id, REVALIDATE);
}
