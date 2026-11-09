"use server";

// MEGA CLUB - the actions of /marketing/club (spec §10). Each one: requireAdmin() first, input checked before any
// read, `{ ok: false, kind }` instead of a throw (Next masks thrown action errors in production).
import { requireAdmin, requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { israelDayOf, previousWindow } from "@/lib/marketing/range";
import { DEFAULT_CLUB_SETTINGS, validateClubSettings } from "@/lib/club/settings";
import { clubOverview, clubWindow, memberViews, type ClubOverview, type ClubRange } from "@/lib/club/stats";
import type { ClubLogRow, ClubMemberView, ClubSettings } from "@/lib/club/types";
import {
  ClubNotReady,
  insertClubLog,
  readClubSettings,
  readEventNames,
  readMemberById,
  readMemberNoByCode,
  readMemberLog,
  readMemberOrders,
  readMembers,
  setMemberMarketing,
  setMemberStatus,
  writeClubSettings,
} from "@/lib/services/club-db";

type Fail = { ok: false; kind: "not_ready" | "invalid" | "not_found" | "error" | "site_not_ready"; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failOf(e: unknown, what: string): Fail {
  if (e instanceof ClubNotReady) return { ok: false, kind: "not_ready" };
  console.error(`club-actions: ${what}`, e);
  return { ok: false, kind: "error", message: e instanceof Error ? e.message : String(e) };
}

export async function getClubPage(range: string): Promise<
  | {
      ok: true;
      range: ClubRange;
      since: string;
      until: string;
      settings: ClubSettings;
      overview: ClubOverview;
      members: ClubMemberView[];
      topEventNames: Record<number, string>;
    }
  | Fail
> {
  await requireAdmin();
  try {
    const [rawSettings, members] = await Promise.all([readClubSettings(), readMembers()]);
    const parsed = validateClubSettings(rawSettings);
    const settings = parsed.ok ? parsed.value : DEFAULT_CLUB_SETTINGS;
    const firstJoin = members.length ? members.reduce((min, m) => (m.created_at < min ? m.created_at : min), members[0].created_at) : null;
    const win = clubWindow(range, new Date(), firstJoin ? israelDayOf(firstJoin) : null);
    const prev = previousWindow(win.since, win.until);
    const [orders, names] = await Promise.all([
      readMemberOrders(members.map((m) => m.coupon_code)),
      readEventNames(members.map((m) => m.event_id).filter((id): id is number => id != null)),
    ]);
    const overview = clubOverview(members, orders, win, prev);
    const topEventNames: Record<number, string> = {};
    for (const t of overview.topEvents) {
      const n = names.get(t.eventId);
      if (n) topEventNames[t.eventId] = n;
    }
    return {
      ok: true,
      range: win.range,
      since: win.since,
      until: win.until,
      settings,
      overview,
      members: memberViews(members, orders, names).reverse(), // newest first
      topEventNames,
    };
  } catch (e) {
    return failOf(e, "page load");
  }
}

export async function getClubMemberLog(memberId: string): Promise<{ ok: true; rows: ClubLogRow[] } | Fail> {
  await requireAdmin();
  if (!UUID.test(memberId)) return { ok: false, kind: "invalid" };
  try {
    return { ok: true, rows: await readMemberLog(memberId) };
  } catch (e) {
    return failOf(e, "log read");
  }
}

export async function saveClubSettings(input: unknown): Promise<{ ok: true; settings: ClubSettings; codesUpdated: number } | Fail> {
  const session = await requireAdmin();
  const v = validateClubSettings(input);
  if (!v.ok) return { ok: false, kind: "invalid", message: v.error };
  try {
    const before = validateClubSettings(await readClubSettings());
    const { codesUpdated } = await writeClubSettings(v.value, session.email);
    await logAudit({
      action: "club.settings",
      entityType: "club_settings",
      entityId: "program",
      changes: { before: before.ok ? before.value : null, after: v.value },
      metadata: { codes_updated: codesUpdated },
    });
    return { ok: true, settings: v.value, codesUpdated };
  } catch (e) {
    return failOf(e, "settings save");
  }
}

type MemberRead =
  | { found: false; fail: Fail }
  | { found: true; member: NonNullable<Awaited<ReturnType<typeof readMemberById>>> };

async function memberOrFail(id: string): Promise<MemberRead> {
  if (!UUID.test(id)) return { found: false, fail: { ok: false, kind: "invalid" } };
  const m = await readMemberById(id);
  if (!m) return { found: false, fail: { ok: false, kind: "not_found" } };
  return { found: true, member: m };
}

export async function unsubscribeClubMember(id: string): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  try {
    const r = await memberOrFail(id);
    if (!r.found) return r.fail;
    if (r.member.marketing === "unsubscribed") return { ok: true };
    await setMemberMarketing(id, "unsubscribed", "backoffice");
    await insertClubLog({ member_id: id, action: "unsubscribe", source: "backoffice" });
    await logAudit({ action: "club.unsubscribe", entityType: "club_member", entityId: id, changes: { marketing: { from: r.member.marketing, to: "unsubscribed" } } });
    return { ok: true };
  } catch (e) {
    return failOf(e, "unsubscribe");
  }
}

async function setStatus(id: string, status: "removed" | "active"): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  try {
    const r = await memberOrFail(id);
    if (!r.found) return r.fail;
    if (r.member.status === status) return { ok: true };
    await setMemberStatus(id, r.member.coupon_id, status);
    await insertClubLog({ member_id: id, action: status === "removed" ? "removed" : "restored", source: "backoffice" });
    await logAudit({
      action: status === "removed" ? "club.remove" : "club.restore",
      entityType: "club_member",
      entityId: id,
      changes: { status: { from: r.member.status, to: status } },
      metadata: { member_no: r.member.member_no, coupon_code: r.member.coupon_code },
    });
    return { ok: true };
  } catch (e) {
    return failOf(e, `set status ${status}`);
  }
}

export async function removeClubMember(id: string): Promise<{ ok: true } | Fail> {
  return setStatus(id, "removed");
}

export async function restoreClubMember(id: string): Promise<{ ok: true } | Fail> {
  return setStatus(id, "active");
}

/** The welcome mail lives in myt-main (one template); the backoffice asks the site to send it again. */
export async function resendClubWelcome(id: string): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  if (!UUID.test(id)) return { ok: false, kind: "invalid" };
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL;
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!base || !secret) return { ok: false, kind: "error", message: "The site address or secret is not set." };
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/club/resend`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hotel-secret": secret },
      body: JSON.stringify({ memberId: id }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, kind: "site_not_ready" };
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !body?.ok) return { ok: false, kind: "error", message: body?.error ?? `The site answered ${res.status}.` };
    await logAudit({ action: "club.resend_welcome", entityType: "club_member", entityId: id });
    return { ok: true };
  } catch (e) {
    return failOf(e, "resend welcome");
  }
}

/** The reservation page's "חבר מועדון #1041" chip: the member number behind an order's coupon code, else null. */
export async function getClubMemberNoByCode(code: string | null | undefined): Promise<number | null> {
  await requireStaff();
  const c = (code ?? "").trim().toUpperCase();
  if (!/^MEGA[A-Z0-9]{6}$/.test(c)) return null;
  try {
    return await readMemberNoByCode(c);
  } catch {
    return null;
  }
}
