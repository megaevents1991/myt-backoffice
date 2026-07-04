"use server";

import { requireAdmin } from "@/lib/auth/guards";
import {
  listRows,
  getRow,
  createRow,
  updateRow,
  softDeleteRow,
} from "./template-crud";
import type {
  Category,
  CreateCategoryData,
  UpdateCategoryData,
} from "../../types/category.types";

const TABLE = "categories";
const REVALIDATE = ["/templates", "/templates/categories"];

export async function getCategories(): Promise<Category[]> {
  await requireAdmin();
  return listRows<Category>(TABLE, "display_order");
}

export async function getCategory(id: number): Promise<Category> {
  await requireAdmin();
  return getRow<Category>(TABLE, id);
}

export async function createCategory(
  data: CreateCategoryData
): Promise<Category> {
  await requireAdmin();
  return createRow<Category>(TABLE, data, REVALIDATE);
}

export async function updateCategory(
  id: number,
  data: UpdateCategoryData
): Promise<Category> {
  await requireAdmin();
  return updateRow<Category>(TABLE, id, data, REVALIDATE);
}

export async function softDeleteCategory(id: number): Promise<Category> {
  await requireAdmin();
  return softDeleteRow<Category>(TABLE, id, REVALIDATE);
}
