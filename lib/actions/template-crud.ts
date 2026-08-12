/**
 * Shared CRUD helpers for the per-type CMS "Template" tables (categories,
 * artists, football_teams, blogs...). Each type's `*-actions.ts` ("use server")
 * file is a thin wrapper that passes its table name here - so a new type needs
 * only a typed table + a ~6-line actions file. Server-only (imports
 * supabase-server + next/cache); never import from a client component.
 */
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/guards";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

// Tables aren't in Supabase generated types - cast to bypass never inference.
const tbl = (table: string) => (supabase as any).from(table);

// `orderBy` must be a real column on `table`.
export async function listRows<T>(table: string, orderBy = "id"): Promise<T[]> {
  await requireStaff();
  const { data, error } = await tbl(table)
    .select("*")
    .eq("is_deleted", false)
    .order(orderBy, { ascending: true });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function getRow<T>(table: string, id: number): Promise<T> {
  await requireStaff();
  const { data, error } = await tbl(table).select("*").eq("id", id).single();
  if (error) throw error;
  return data as T;
}

export async function createRow<T>(
  table: string,
  row: Record<string, unknown>,
  revalidate: string[],
): Promise<T> {
  await requireStaff();
  const { data, error } = await tbl(table)
    .insert({ ...row, is_deleted: false })
    .select();
  if (error) throw error;
  revalidate.forEach((p) => revalidatePath(p));
  await logAudit({
    action: "create",
    entityType: table,
    entityId: (data?.[0] as Record<string, unknown> | undefined)?.id as
      | string
      | number
      | undefined,
    changes: row,
  });
  return data[0] as T;
}

export async function updateRow<T>(
  table: string,
  id: number,
  row: Record<string, unknown>,
  revalidate: string[],
): Promise<T> {
  await requireStaff();
  const before = await fetchBefore(table, "id", id, row);
  const { data, error } = await tbl(table)
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select();
  if (error) throw error;
  revalidate.forEach((p) => revalidatePath(p));
  await logAudit({
    action: "update",
    entityType: table,
    entityId: id,
    changes: diffChanges(before, row),
  });
  return data[0] as T;
}

/**
 * Persist a full manual ordering: row at index i gets display_order = i + 1.
 * Used by the Templates → Homepage order screens (artists / football_teams).
 */
export async function saveRowOrder(
  table: string,
  orderedIds: number[],
  revalidate: string[],
): Promise<void> {
  await requireStaff();
  const stamp = new Date().toISOString();
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      tbl(table)
        .update({ display_order: i + 1, updated_at: stamp })
        .eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  revalidate.forEach((p) => revalidatePath(p));
  await logAudit({
    action: "update",
    entityType: table,
    changes: { display_order: orderedIds },
  });
}

export async function softDeleteRow<T>(
  table: string,
  id: number,
  revalidate: string[],
): Promise<T> {
  await requireStaff();
  const { data, error } = await tbl(table)
    .update({ is_deleted: true })
    .eq("id", id)
    .select();
  if (error) throw error;
  revalidate.forEach((p) => revalidatePath(p));
  await logAudit({ action: "delete", entityType: table, entityId: id });
  return data[0] as T;
}
