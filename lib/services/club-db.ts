// MEGA CLUB - reads and writes of the backoffice screen (spec §10). Server only, session-free: the actions in
// lib/actions/club-actions.ts guard every call. Every read tolerates the tables missing (a deploy that beat its
// migration) by throwing ClubNotReady, which the actions answer as `kind: "not_ready"`.
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import type { ClubLogRow, ClubMemberRow, ClubOrderRow, ClubSettings } from "@/lib/club/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-patched types until `npm run db:types`
const db = supabase as any;

/** `.in()` travels in the URL - keep lists near 200 (repo rule). */
const IN_CHUNK = 200;
const MAX_ROWS = 50_000;

const MEMBER_COLUMNS =
  "id,member_no,email,phone,first_name,last_name,coupon_code,status,marketing,unsubscribed_at,source,event_id,utm_source,utm_medium,utm_campaign,welcome_sent_at,welcome_error,created_at";

export class ClubNotReady extends Error {
  constructor() {
    super("The members club tables are not migrated yet.");
  }
}

type PgError = { code?: string; message: string } | null;

function check(error: PgError, what: string): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204") throw new ClubNotReady();
  console.error(`club-db: ${what} failed`, JSON.stringify(error));
  throw new Error(`${what} failed: ${error.message}`);
}

function chunks<T>(list: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function readClubSettings(): Promise<unknown> {
  const { data, error } = await db.from("club_settings").select("value").eq("key", "program").maybeSingle();
  check(error, "club settings read");
  return data?.value ?? null;
}

export async function readMembers(): Promise<ClubMemberRow[]> {
  const res = await fetchPaged<ClubMemberRow>(() => db.from("club_members").select(MEMBER_COLUMNS).order("member_no"), MAX_ROWS);
  check(res.error as PgError, "club members read");
  return res.rows;
}

export async function readMemberById(id: string): Promise<(ClubMemberRow & { coupon_id: number | null }) | null> {
  const { data, error } = await db.from("club_members").select(`${MEMBER_COLUMNS},coupon_id`).eq("id", id).maybeSingle();
  check(error, "club member read");
  return data ?? null;
}

/** Every live reservation whose coupon is one of the member codes. */
export async function readMemberOrders(codes: string[]): Promise<ClubOrderRow[]> {
  const out: ClubOrderRow[] = [];
  for (const part of chunks([...new Set(codes.map((c) => c.toUpperCase()))])) {
    const res = await fetchPaged<ClubOrderRow & { id: number }>(
      () =>
        db
          .from("reservations")
          .select("id,coupon_code,status,created_at,user_shown_price,coupon_discount_usd")
          .in("coupon_code", part)
          .is("is_deleted", null)
          .order("id"),
      MAX_ROWS,
    );
    check(res.error as PgError, "member orders read");
    out.push(...res.rows.map(({ id: _id, ...o }) => o));
  }
  return out;
}

export async function readEventNames(ids: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await db.from("events").select("id,name").in("id", part);
    check(error, "event names read");
    for (const e of (data ?? []) as { id: number; name: string | null }[]) if (e.name) names.set(e.id, e.name);
  }
  return names;
}

export async function readMemberLog(memberId: string): Promise<ClubLogRow[]> {
  const { data, error } = await db
    .from("club_log")
    .select("id,action,consent_text,consent_version,ip,user_agent,source,at")
    .eq("member_id", memberId)
    .order("at", { ascending: false })
    .limit(200);
  check(error, "club log read");
  return (data ?? []) as ClubLogRow[];
}

/** The amount goes to every member code first, then the settings row - a failure in between leaves the codes on the
 *  new amount and the screen says so; never the settings ahead of the codes. */
export async function writeClubSettings(value: ClubSettings, by: string): Promise<{ codesUpdated: number }> {
  const upd = await db
    .from("coupons")
    .update({ discount_value: value.discount_per_traveler_usd })
    .eq("source", "club")
    .select("id");
  check(upd.error, "member codes amount update");
  const { error } = await db
    .from("club_settings")
    .upsert({ key: "program", value, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
  check(error, "club settings write");
  return { codesUpdated: (upd.data ?? []).length };
}

export async function setMemberMarketing(id: string, marketing: "unsubscribed", source: "backoffice"): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("club_members")
    .update({ marketing, unsubscribed_at: now, unsubscribe_source: source, updated_at: now })
    .eq("id", id);
  check(error, "member unsubscribe");
}

/** removed = the code stops working; active = it works again. */
export async function setMemberStatus(id: string, couponId: number | null, status: "removed" | "active"): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("club_members")
    .update({ status, removed_at: status === "removed" ? now : null, updated_at: now })
    .eq("id", id);
  check(error, "member status update");
  if (couponId != null) {
    const c = await db.from("coupons").update({ is_active: status === "active" }).eq("id", couponId).eq("source", "club");
    check(c.error, "member code switch");
  }
}

export async function insertClubLog(row: { member_id: string; action: string; source: string }): Promise<void> {
  const { error } = await db.from("club_log").insert(row);
  check(error, "club log write");
}

export async function readMemberNoByCode(code: string): Promise<number | null> {
  const { data, error } = await db.from("club_members").select("member_no").eq("coupon_code", code).maybeSingle();
  check(error, "member by code read");
  return (data?.member_no as number | undefined) ?? null;
}
