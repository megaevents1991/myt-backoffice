"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
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

// Categories are a TREE now (parent_id), and the only one - the old parallel
// event_categories node is gone. Two consequences handled here: a category may
// not be moved under its own descendant, and its public link follows its path.
const db = () => (supabase as any).from(TABLE);

async function assertNoCycle(
  id: number,
  parentId: number | null,
): Promise<void> {
  if (parentId == null) return;
  if (parentId === id) throw new Error("A category cannot be its own parent.");
  const { data, error } = await db()
    .select("id,parent_id")
    .eq("is_deleted", false);
  if (error) throw error;
  const parentOf = new Map<number, number | null>(
    (data ?? []).map((r: any) => [r.id, r.parent_id]),
  );
  // visited set: terminate even if the DB already holds a corrupt cycle.
  const seen = new Set<number>();
  let cur: number | null = parentId;
  while (cur != null && !seen.has(cur)) {
    if (cur === id)
      throw new Error("Cannot move a category under its own descendant.");
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
}

/** Canonical /c/ path: ancestor slugs + own slug. */
async function categoryPath(id: number): Promise<string> {
  const { data, error } = await db()
    .select("id,parent_id,slug")
    .eq("is_deleted", false);
  if (error) throw error;
  const byId = new Map<number, { parent_id: number | null; slug: string }>(
    (data ?? []).map((r: any) => [
      r.id,
      { parent_id: r.parent_id, slug: r.slug },
    ]),
  );
  const self = byId.get(id);
  if (!self) return "";
  const parts = [self.slug];
  const seen = new Set<number>([id]);
  let cur = self.parent_id;
  while (cur != null && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    parts.unshift(byId.get(cur)!.slug);
    cur = byId.get(cur)!.parent_id;
  }
  return `/c/${parts.join("/")}`;
}

/**
 * Point the card at its own category page unless someone set a deliberate
 * custom link. Runs after every save so renaming or re-parenting a category
 * doesn't leave the homepage tile linking at the old path.
 */
async function syncLink(id: number): Promise<void> {
  const { data, error } = await db().select("link_url").eq("id", id).single();
  if (error) throw error;
  const link = (data?.link_url ?? "").trim();
  const replaceable =
    link === "" || link.startsWith("/c/") || link.startsWith("/category/");
  if (!replaceable) return;
  const path = await categoryPath(id);
  if (path && path !== link) {
    const { error: upErr } = await db().update({ link_url: path }).eq("id", id);
    if (upErr) throw upErr;
  }
}

export async function getCategories(): Promise<Category[]> {
  await requireStaff();
  return listRows<Category>(TABLE, "display_order");
}

export async function getCategory(id: number): Promise<Category> {
  await requireStaff();
  return getRow<Category>(TABLE, id);
}

export async function createCategory(
  data: CreateCategoryData,
): Promise<Category> {
  await requireStaff();
  const created = await createRow<Category>(TABLE, data, REVALIDATE);
  await syncLink(created.id);
  return created;
}

export async function updateCategory(
  id: number,
  data: UpdateCategoryData,
): Promise<Category> {
  await requireStaff();
  if (data.parent_id !== undefined)
    await assertNoCycle(id, data.parent_id ?? null);
  const updated = await updateRow<Category>(TABLE, id, data, REVALIDATE);
  await syncLink(id);
  return updated;
}

export async function softDeleteCategory(id: number): Promise<Category> {
  await requireStaff();
  // Block while children point at it - deleting a parent would orphan a
  // subtree whose /c/ paths are built from it.
  const { data: kids, error } = await db()
    .select("id")
    .eq("parent_id", id)
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  if (kids?.length) throw new Error("Move or delete the sub-categories first.");
  return softDeleteRow<Category>(TABLE, id, REVALIDATE);
}
