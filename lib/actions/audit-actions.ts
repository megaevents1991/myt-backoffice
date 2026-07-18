"use server";
import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

export interface AuditRow {
  id: number; created_at: string;
  actor_id: string | null; actor_email: string | null; actor_role: string | null;
  action: string; entity_type: string | null; entity_id: string | null;
  changes: unknown; metadata: unknown; ip: string | null;
}

export async function getAuditLogs(filters: {
  actorEmail?: string; action?: string; entityType?: string;
  from?: string; to?: string; limit?: number;
}): Promise<AuditRow[]> {
  await requireStaff();
  let q = (supabase as any)
    .from("audit_log")
    .select("id,created_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,changes,metadata,ip")
    .order("created_at", { ascending: false })
    .limit(Math.min(filters.limit ?? 200, 500));
  if (filters.actorEmail) q = q.ilike("actor_email", `%${filters.actorEmail}%`);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.entityType) q = q.eq("entity_type", filters.entityType);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59`);
  const { data, error } = await q;
  if (error) { console.error("getAuditLogs:", JSON.stringify(error)); return []; }
  return (data as AuditRow[]) ?? [];
}
