/**
 * Audit trail. Fire-and-forget: logAudit NEVER throws and never fails the
 * calling mutation — failures are console.error'd only. Rows go to
 * public.audit_log (RLS-locked, service-role only).
 */
import { supabase } from "@/lib/supabase-server";
import { getSession } from "@/lib/auth/guards";

export type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  changes?: unknown;
  metadata?: Record<string, unknown>;
  actor?: { id?: string | null; email?: string | null; role?: string | null };
  ip?: string | null;
};

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    let actor = input.actor;
    let metadata = input.metadata ?? null;
    if (!actor) {
      const session = await getSession().catch(() => null);
      actor = session
        ? { id: session.sub, email: session.email, role: session.role }
        : { id: null, email: null, role: null };
      // A superadmin acting AS a partner must stay attributable — without
      // this, an impersonated write is indistinguishable from the partner's.
      if (session?.impersonator) {
        metadata = {
          ...(metadata ?? {}),
          impersonated_by: session.impersonator.email,
          impersonated_by_id: session.impersonator.sub,
        };
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("audit_log").insert({
      actor_id: actor.id ?? null,
      actor_email: actor.email ?? null,
      actor_role: actor.role ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId == null ? null : String(input.entityId),
      changes: input.changes ?? null,
      metadata,
      ip: input.ip ?? null,
    });
    if (error) console.error("logAudit insert failed:", JSON.stringify(error));
  } catch (e) {
    console.error("logAudit failed:", e);
  }
}

/** Changed-fields diff: only keys present in `after` that differ from `before`. */
export function diffChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before ? before[key] : undefined;
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      diff[key] = { from: from === undefined ? null : from, to: to === undefined ? null : to };
    }
  }
  return diff;
}

/** Pre-update snapshot limited to the columns being changed (cheap select). */
export async function fetchBefore(
  table: string,
  idColumn: string,
  idValue: string | number,
  payload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const columns = Object.keys(payload);
    if (columns.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from(table)
      .select(columns.join(","))
      .eq(idColumn, idValue)
      .maybeSingle();
    if (error) {
      console.error("fetchBefore failed:", JSON.stringify(error));
      return null;
    }
    return (data as Record<string, unknown>) ?? null;
  } catch (e) {
    console.error("fetchBefore failed:", e);
    return null;
  }
}

/** Client IP from proxy headers (Vercel). */
export function requestIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}
