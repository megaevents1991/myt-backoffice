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

/**
 * Bulk sibling of getOfficeUsers - one query for MANY partner codes at once,
 * instead of N calls to getOfficeUsers (staff partners screen, QA item 1,
 * 20.08). Each row carries its own `partner_tracking_code` so callers can
 * group by partner (the list groups client-side into a Map; the single-code
 * view page just reads the one array).
 *
 * Fails OPEN (empty array) on a query error, unlike getOfficeUsers/
 * resolvePortalScope which fail closed - this is a staff-facing display, not
 * a security scope, so the safe direction is "show nothing" rather than
 * blocking the page.
 */
export async function getOfficeUsersForPartners(
  partnerCodes: string[],
): Promise<(OfficeUser & { partner_tracking_code: string })[]> {
  if (partnerCodes.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,agent_slug,is_active,created_at,partner_tracking_code",
    )
    .in("partner_tracking_code", partnerCodes)
    .in("role", PARTNER_ROLES)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getOfficeUsersForPartners:", JSON.stringify(error));
    return [];
  }
  return (data as (OfficeUser & { partner_tracking_code: string })[]) ?? [];
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

/**
 * ADMIN-side bulk attribution: reservation id → agent display label, resolved
 * across ALL offices by slug (unlike getReservationAttribution above, which is
 * scoped to a single office's officeUsers). Staff-facing reservation views use
 * this to show which agent a booking is credited to, whichever office they
 * belong to.
 *
 * The manager-set `reservations.agent_user_id` override (QA wave 2, 20.08)
 * wins over the UTM-derived attribution here too, same as everywhere else -
 * resolved first so the utm_touches lookup below only fills the gaps it
 * leaves. Missing key = unattributed (no override, no agent-prefixed touch,
 * or neither resolves to a user_profiles row).
 */
export async function getAgentLabelsForReservations(
  reservationIds: number[],
): Promise<Map<number, string>> {
  const labelByReservation = new Map<number, string>();
  if (reservationIds.length === 0) return labelByReservation;

  // Both loops below fan their chunks out with Promise.all instead of
  // awaiting one at a time - at 20k admin-reservation-page rows that was
  // ~200 sequential round-trips (100 chunks x 2 loops), now 2 parallel waves.
  // The two loops stay sequential RELATIVE TO EACH OTHER (the second reads
  // overrideByReservation, populated by the first) - only the chunks within
  // each loop run concurrently. Fail-open per-chunk error handling is
  // unchanged - `return` from the map callback is this loop's `continue`.
  const overrideByReservation = new Map<number, string>();
  const overrideChunks: number[][] = [];
  for (let i = 0; i < reservationIds.length; i += TOUCH_CHUNK) {
    overrideChunks.push(reservationIds.slice(i, i + TOUCH_CHUNK));
  }
  await Promise.all(
    overrideChunks.map(async (chunk) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("reservations")
        .select("id,agent_user_id")
        .in("id", chunk);
      if (error) {
        // 42703 = migration not landed yet - routine, not an error. Either
        // way, fall through to UTM-only attribution for this chunk.
        if (error.code !== "42703") {
          console.error(
            "getAgentLabelsForReservations override:",
            JSON.stringify(error),
          );
        }
        return;
      }
      for (const row of (data ?? []) as {
        id: number;
        agent_user_id: string | null;
      }[]) {
        // A forced-unassign still wins over UTM (recorded so the slug loop
        // below skips it via overrideByReservation.has), it just never
        // resolves to a label - explicit, rather than relying on the sentinel
        // incidentally matching no real user_profiles row.
        if (row.agent_user_id) overrideByReservation.set(row.id, row.agent_user_id);
      }
    }),
  );

  const slugByReservation = new Map<number, string>();
  const touchChunks: number[][] = [];
  for (let i = 0; i < reservationIds.length; i += TOUCH_CHUNK) {
    touchChunks.push(reservationIds.slice(i, i + TOUCH_CHUNK));
  }
  await Promise.all(
    touchChunks.map(async (chunk) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("utm_touches")
        .select("reservation_id,utm_content")
        .eq("position", 0)
        .in("reservation_id", chunk);
      if (error) {
        // Fail open to "unattributed" - a report gap, never a broken page.
        console.error(
          "getAgentLabelsForReservations touches:",
          JSON.stringify(error),
        );
        return;
      }
      for (const row of (data ?? []) as {
        reservation_id: number;
        utm_content: string | null;
      }[]) {
        // The override already wins for this row - no need to resolve its slug.
        if (overrideByReservation.has(row.reservation_id)) continue;
        if (row.utm_content?.startsWith(AGENT_UTM_PREFIX)) {
          slugByReservation.set(
            row.reservation_id,
            row.utm_content.slice(AGENT_UTM_PREFIX.length),
          );
        }
      }
    }),
  );

  // The sentinel is never a real user_profiles id - excluded here so it never
  // rides along into the `.in("id", ...)` lookup below for nothing.
  const overrideIds = Array.from(
    new Set(
      Array.from(overrideByReservation.values()).filter(
        (id) => id !== UNASSIGNED_AGENT_SENTINEL,
      ),
    ),
  );
  const slugs = Array.from(new Set(slugByReservation.values()));
  if (overrideIds.length === 0 && slugs.length === 0) return labelByReservation;

  const [byIdResult, bySlugResult] = await Promise.all([
    overrideIds.length > 0
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("user_profiles")
          .select("id,display_name,email")
          .in("id", overrideIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    slugs.length > 0
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("user_profiles")
          .select("display_name,email,agent_slug")
          .in("agent_slug", slugs)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  if (byIdResult.error) {
    console.error(
      "getAgentLabelsForReservations override users:",
      JSON.stringify(byIdResult.error),
    );
  }
  if (bySlugResult.error) {
    console.error("getAgentLabelsForReservations users:", JSON.stringify(bySlugResult.error));
  }

  const labelById = new Map<string, string>();
  for (const u of (byIdResult.data ?? []) as {
    id: string;
    display_name: string | null;
    email: string;
  }[]) {
    labelById.set(u.id, u.display_name || u.email);
  }
  const labelBySlug = new Map<string, string>();
  for (const u of (bySlugResult.data ?? []) as {
    display_name: string | null;
    email: string;
    agent_slug: string | null;
  }[]) {
    if (u.agent_slug) labelBySlug.set(u.agent_slug, u.display_name || u.email);
  }

  for (const [reservationId, ownerId] of overrideByReservation) {
    // Forced-unassign -> no label, same as "missing key" for every other
    // unattributed reservation (see the doc comment above).
    if (ownerId === UNASSIGNED_AGENT_SENTINEL) continue;
    const label = labelById.get(ownerId);
    if (label) labelByReservation.set(reservationId, label);
  }
  for (const [reservationId, slug] of slugByReservation) {
    const label = labelBySlug.get(slug);
    if (label) labelByReservation.set(reservationId, label);
  }
  return labelByReservation;
}

/**
 * Forced-unassigned sentinel (QA item 3, 21.08 - CONFIRMED BUG: manually
 * setting a reservation to "לא משויך" didn't stick). `assignReservationAgent`
 * writes this instead of plain NULL when a manager deliberately clears a
 * reservation's agent override. NULL alone cannot carry that meaning - every
 * merge below falls a NULL override back to the UTM-derived owner, so
 * clearing an override used to silently "revert" to whichever agent's link
 * the customer originally used instead of sticking as unattributed. This
 * value is never a real user_profiles id - just a marker `mergedOwner`
 * recognizes.
 */
export const UNASSIGNED_AGENT_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * THE merge rule for "who owns this reservation" - every consumer (portal
 * stats/reservations, dashboard, activity feed, credit buckets, admin agent
 * labels) must call this instead of inlining `row.agent_user_id ?? utmOwner`.
 * That inline form cannot distinguish "manager explicitly unassigned" from
 * "never touched" - both read as NULL - which was the root cause of the "לא
 * משויך" bug above.
 *
 * - `UNASSIGNED_AGENT_SENTINEL` -> null (forced unattributed - wins over UTM).
 * - a real uuid -> that uuid (manager override wins over UTM).
 * - null / undefined -> utmOwner (no override set - automatic, UTM-derived).
 */
export function mergedOwner(
  agentUserId: string | null | undefined,
  utmOwner: string | null,
): string | null {
  if (agentUserId === UNASSIGNED_AGENT_SENTINEL) return null;
  if (agentUserId != null) return agentUserId;
  return utmOwner;
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
