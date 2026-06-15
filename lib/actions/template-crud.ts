/**
 * Shared CRUD helpers for the per-type CMS "Template" tables (categories,
 * artists, football_teams, blogs...). Each type's `*-actions.ts` ("use server")
 * file is a thin wrapper that passes its table name here — so a new type needs
 * only a typed table + a ~6-line actions file. Server-only (imports
 * supabase-server + next/cache); never import from a client component.
 */
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

// Tables aren't in Supabase generated types — cast to bypass never inference.
const tbl = (table: string) => (supabase as any).from(table);

const TEMPLATE_BUCKET = "templates";

export async function listRows<T>(table: string): Promise<T[]> {
  const { data, error } = await tbl(table)
    .select("*")
    .eq("is_deleted", false)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function getRow<T>(table: string, id: number): Promise<T> {
  const { data, error } = await tbl(table).select("*").eq("id", id).single();
  if (error) throw error;
  return data as T;
}

export async function createRow<T>(
  table: string,
  row: Record<string, unknown>,
  revalidate: string[]
): Promise<T> {
  const { data, error } = await tbl(table)
    .insert({ ...row, is_deleted: false })
    .select();
  if (error) throw error;
  revalidate.forEach((p) => revalidatePath(p));
  return data[0] as T;
}

export async function updateRow<T>(
  table: string,
  id: number,
  row: Record<string, unknown>,
  revalidate: string[]
): Promise<T> {
  const { data, error } = await tbl(table)
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select();
  if (error) throw error;
  revalidate.forEach((p) => revalidatePath(p));
  return data[0] as T;
}

export async function softDeleteRow<T>(
  table: string,
  id: number,
  revalidate: string[]
): Promise<T> {
  const { data, error } = await tbl(table)
    .update({ is_deleted: true })
    .eq("id", id)
    .select();
  if (error) throw error;
  revalidate.forEach((p) => revalidatePath(p));
  return data[0] as T;
}

/** Upload a template image to the public `templates` bucket; returns its URL. */
export async function uploadTemplateImage(formData: FormData): Promise<string> {
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file provided");

  try {
    await supabase.storage.createBucket(TEMPLATE_BUCKET, { public: true });
  } catch {
    /* bucket already exists */
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}-${safeName}`;
  const buffer = await file.arrayBuffer();

  const { error } = await supabase.storage
    .from(TEMPLATE_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(TEMPLATE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
