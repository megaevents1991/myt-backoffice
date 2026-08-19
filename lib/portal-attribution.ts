/**
 * Per-agent attribution + portal scoping (spec: 2026-08-19-office-agents-design.md).
 *
 * Attribution rides the UTM pipeline: every portal link carries
 * `utm_content=ag-<agent_slug>`, myt-main captures it into `utm_touches`
 * (position 0 = the primary/credited touch), and this module joins it back.
 * Money stays office-level - this is reporting only.
 *
 * Server-only (service-role client) - never import VALUES from a client
 * component (type-only imports are fine, they erase at build).
 */

import { supabase } from "@/lib/supabase-server";
import type { Role } from "@/types/auth.types";
import { PARTNER_ROLES } from "@/types/auth.types";

/** Namespaces agent slugs from marketing uses of utm_content (ad-creative names etc). */
export const AGENT_UTM_PREFIX = "ag-";

/** The utm_content value for a user's links, or null when they have no slug. */
export function agentUtmContent(slug: string | null | undefined): string | null {
  return slug ? `${AGENT_UTM_PREFIX}${slug}` : null;
}

/**
 * 6 hex chars - short enough for a URL, random enough for uniqueness at this
 * scale. The DB unique index is the backstop; callers retry once on 23505.
 * NEVER regenerate an existing user's slug - old links must keep attributing.
 */
export function generateAgentSlug(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type OfficeUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  agent_slug: string | null;
  is_active: boolean;
  created_at: string;
};

/**
 * Every portal user (any partner role) linked to the office's tracking code.
 *
 * Returns `null` ONLY on a query error - distinct from `[]` (genuinely no
 * office users) - so resolvePortalScope can fail CLOSED: null must never be
 * treated as soloOffice, or an isolated agent would see the whole office the
 * moment this query has a transient error.
 */
export async function getOfficeUsers(
  partnerCode: string,
): Promise<OfficeUser[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("id,email,display_name,role,agent_slug,is_active,created_at")
    .eq("partner_tracking_code", partnerCode)
    .in("role", PARTNER_ROLES)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getOfficeUsers:", JSON.stringify(error));
    return null;
  }
  return (data as OfficeUser[]) ?? [];
}

/** The viewer's own slug (for building their links). */
export async function getAgentSlugForUser(sub: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("agent_slug")
    .eq("id", sub)
    .maybeSingle();
  if (error) {
    console.error("getAgentSlugForUser:", JSON.stringify(error));
    return null;
  }
  return (data?.agent_slug as string | null) ?? null;
}

export type PortalScope = {
  /** office_manager - sees the whole office. */
  isManager: boolean;
  /** The viewer's own agent_slug (null for impersonating admins with no profile). */
  slug: string | null;
  /**
   * Exactly one active portal user on the code. Solo offices keep today's
   * behavior: the sole agent sees unattributed (pre-slug) reservations and
   * keeps the credit/coupons screens - existing partners feel no change.
   */
  soloOffice: boolean;
  officeUsers: OfficeUser[];
};

export async function resolvePortalScope(session: {
  sub: string;
  role: Role;
  partner_code: string;
}): Promise<PortalScope> {
  const officeUsers = await getOfficeUsers(session.partner_code);
  if (officeUsers === null) {
    // Query failed - fail CLOSED. An isolated agent transiently sees nothing
    // rather than (wrongly) the whole office; the safe direction for a
    // reporting scope. Whoever asked retries on the next render/request.
    return {
      isManager: session.role === "office_manager",
      slug: null,
      soloOffice: false,
      officeUsers: [],
    };
  }
  const me = officeUsers.find((u) => u.id === session.sub) ?? null;
  return {
    isManager: session.role === "office_manager",
    slug: me?.agent_slug ?? null,
    soloOffice: officeUsers.filter((u) => u.is_active).length <= 1,
    officeUsers,
  };
}

const TOUCH_CHUNK = 200;

/**
 * reservation id → the office user CREDITED with it (their `id`), from the
 * primary UTM touch. Missing key / null = unattributed (pre-slug link, coupon
 * code typed directly, organic).
 */
export async function getReservationAttribution(
  reservationIds: number[],
  officeUsers: OfficeUser[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (reservationIds.length === 0) return map;
  const bySlug = new Map<string, string>();
  for (const u of officeUsers) {
    if (u.agent_slug) bySlug.set(`${AGENT_UTM_PREFIX}${u.agent_slug}`, u.id);
  }
  for (let i = 0; i < reservationIds.length; i += TOUCH_CHUNK) {
    const chunk = reservationIds.slice(i, i + TOUCH_CHUNK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("utm_touches")
      .select("reservation_id,utm_content")
      .eq("position", 0)
      .in("reservation_id", chunk);
    if (error) {
      // Fail open to "unattributed" - a report gap, never a broken page.
      console.error("getReservationAttribution:", JSON.stringify(error));
      continue;
    }
    for (const row of (data ?? []) as {
      reservation_id: number;
      utm_content: string | null;
    }[]) {
      map.set(
        row.reservation_id,
        row.utm_content ? (bySlug.get(row.utm_content) ?? null) : null,
      );
    }
  }
  return map;
}

/** The agent-isolation rule, in one place. */
export function visibleToAgent(
  ownerSub: string | null | undefined,
  viewerSub: string,
  soloOffice: boolean,
): boolean {
  const owner = ownerSub ?? null;
  return owner === viewerSub || (owner === null && soloOffice);
}
