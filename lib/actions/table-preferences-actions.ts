"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

// Not in the generated types yet — cast at the call site like the other
// post-baseline tables in this codebase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prefsTable = () => (supabase as any).from("user_table_preferences");

export type TablePreferences = Record<string, unknown>;

/**
 * Per-user UI state for one backoffice table. Generic by design: pass a stable
 * `tableKey` ("offline-flights", "reservations", …) and store whatever that
 * table needs — visible columns, sort, page size.
 */
export async function getTablePreferences(
  tableKey: string,
): Promise<TablePreferences | null> {
  const session = await requireStaff();
  if (!tableKey) throw new Error("tableKey is required");

  const { data, error } = await prefsTable()
    .select("preferences")
    .eq("user_id", session.sub)
    .eq("table_key", tableKey)
    .maybeSingle();

  if (error) {
    console.error("Failed to read table preferences:", JSON.stringify(error));
    // Preferences are cosmetic — a read failure must never break the page.
    return null;
  }
  return (data?.preferences as TablePreferences | undefined) ?? null;
}

export async function saveTablePreferences(
  tableKey: string,
  preferences: TablePreferences,
): Promise<void> {
  const session = await requireStaff();
  if (!tableKey) throw new Error("tableKey is required");

  const { error } = await prefsTable().upsert(
    {
      user_id: session.sub,
      table_key: tableKey,
      preferences,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,table_key" },
  );

  if (error) {
    console.error("Failed to save table preferences:", JSON.stringify(error));
    throw error;
  }
}
