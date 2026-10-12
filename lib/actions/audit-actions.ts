"use server";
import { getSession, requireAdmin } from "@/lib/auth/guards";
import { ADMIN_ROLES } from "@/types/auth.types";
import { supabase } from "@/lib/supabase-server";
import { flightAuditLabel } from "@/lib/audit-display";

export interface AuditRow {
  id: number; created_at: string;
  actor_id: string | null; actor_email: string | null; actor_role: string | null;
  action: string; entity_type: string | null; entity_id: string | null;
  changes: unknown; metadata: unknown; ip: string | null;
  /**
   * The entity named the way its own screen names it ("LY123 TLV→CDG 20/05/2027",
   * the event's name) - read from the entity's table when the rows are loaded,
   * never stored. Absent when the type has no table here or the row is gone.
   */
  entity_label?: string | null;
}

export type AuditFilters = {
  actorEmail?: string; action?: string; entityType?: string; entityId?: string;
  from?: string; to?: string; limit?: number;
};

const AUDIT_COLUMNS =
  "id,created_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,changes,metadata,ip";

export async function getAuditLogs(filters: AuditFilters): Promise<AuditRow[]> {
  // Admin-only, like the /audit-log screen (ADMIN_ROLES) - every staff member's actions are in here.
  await requireAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("audit_log")
    .select(AUDIT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(filters.limit ?? 200, 500));
  if (filters.actorEmail) q = q.ilike("actor_email", `%${filters.actorEmail}%`);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.entityType) q = q.eq("entity_type", filters.entityType);
  if (filters.entityId) q = q.eq("entity_id", filters.entityId.trim());
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59`);
  const { data, error } = await q;
  if (error) { console.error("getAuditLogs:", JSON.stringify(error)); return []; }
  return withEntityLabels((data as AuditRow[]) ?? []);
}

/**
 * The newest audit row of one entity - the "Last change: update by liz@… on
 * 12/10/2026" line on its page. Admins only, like the screen: anyone else gets
 * null, and so does a failed read - the line is a convenience, never a reason
 * for a page not to load.
 */
export async function latestAuditFor(
  entityTypes: string[],
  entityId: string | number,
): Promise<AuditRow | null> {
  try {
    const session = await getSession().catch(() => null);
    if (!session || !(ADMIN_ROLES as readonly string[]).includes(session.role)) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("audit_log")
      .select(AUDIT_COLUMNS)
      .in("entity_type", entityTypes)
      .eq("entity_id", String(entityId))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { console.error("latestAuditFor:", JSON.stringify(error)); return null; }
    return (data as AuditRow | null) ?? null;
  } catch (e) {
    console.error("latestAuditFor failed:", e);
    return null;
  }
}

// ── Entity labels ────────────────────────────────────────────────────────────
// A row says "offline_flight #57"; the reader wants "LY123 TLV→CDG 20/05/2027".
// The tables that already hold those names are asked once per load, in chunks
// (a `.in()` list travels in the URL - never near 1,000 ids). One lookup
// failing leaves its rows unnamed, never the whole screen empty.

const CHUNK = 200;
const chunks = <T,>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

type LabelLookup = {
  /** Which audit entity types this lookup names. */
  types: string[];
  table: string;
  idColumn: string;
  select: string;
  /** Only ids of this shape are asked for (a numeric key refuses "abc"). */
  idPattern?: RegExp;
  label: (row: Record<string, unknown>) => string;
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

const LOOKUPS: LabelLookup[] = [
  {
    types: ["event"],
    table: "events", idColumn: "id", select: "id,name", idPattern: /^\d+$/,
    label: (r) => text(r.name),
  },
  {
    types: ["offline_flight", "flight"],
    table: "flights", idColumn: "id", idPattern: /^\d+$/,
    select: "id,airline_code,outbound_flight_number,outbound_departure_airport,outbound_arrival_airport,outbound_departure_time",
    label: (r) => flightAuditLabel(r as Parameters<typeof flightAuditLabel>[0]),
  },
  {
    types: ["offline_hotel"],
    table: "offline_hotels", idColumn: "id", select: "id,hotel_name", idPattern: /^\d+$/,
    label: (r) => text(r.hotel_name),
  },
  {
    types: ["partner"],
    table: "partners", idColumn: "partner_tracking_code", select: "partner_tracking_code,name_hebrew",
    label: (r) => text(r.name_hebrew),
  },
  {
    types: ["coupon"],
    table: "coupons", idColumn: "id", select: "id,code", idPattern: /^\d+$/,
    label: (r) => text(r.code),
  },
  {
    types: ["reservation"],
    table: "reservations", idColumn: "id", idPattern: /^\d+$/,
    select: "id,main_contact_first_name,main_contact_last_name",
    label: (r) => [text(r.main_contact_first_name), text(r.main_contact_last_name)].filter(Boolean).join(" "),
  },
];

async function withEntityLabels(rows: AuditRow[]): Promise<AuditRow[]> {
  const labels = new Map<string, string>();
  await Promise.all(
    LOOKUPS.map(async (lookup) => {
      const ids = Array.from(
        new Set(
          rows
            .filter((r) => r.entity_type && lookup.types.includes(r.entity_type) && r.entity_id)
            .map((r) => String(r.entity_id))
            .filter((id) => !lookup.idPattern || lookup.idPattern.test(id)),
        ),
      );
      if (ids.length === 0) return;
      try {
        for (const part of chunks(ids)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from(lookup.table)
            .select(lookup.select)
            .in(lookup.idColumn, part);
          if (error) {
            console.error(`audit labels (${lookup.table}):`, JSON.stringify(error));
            return;
          }
          for (const row of (data ?? []) as Record<string, unknown>[]) {
            const label = lookup.label(row);
            if (!label) continue;
            for (const type of lookup.types) labels.set(`${type}:${String(row[lookup.idColumn])}`, label);
          }
        }
      } catch (e) {
        console.error(`audit labels (${lookup.table}) failed:`, e);
      }
    }),
  );
  return rows.map((r) => ({
    ...r,
    entity_label:
      r.entity_type && r.entity_id ? labels.get(`${r.entity_type}:${r.entity_id}`) ?? null : null,
  }));
}
