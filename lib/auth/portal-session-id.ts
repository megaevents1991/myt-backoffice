/**
 * The portal login id - the one fact myt-main checks before it will treat a
 * visitor as a signed-in agent (doc 2026-08-30, items 1-3).
 *
 * The customer site has its own domain and its own cookie, so it cannot see
 * whether the agent is still signed in here. It used to just trust its
 * week-long cookie, which is why a stale identity survived a logout and even
 * a login as somebody else. Now every partner login stamps a fresh id into
 * `user_profiles.portal_session_id` AND into the session cookie; the handoff
 * token carries it to main, which compares the two on every partner request.
 *
 * Consequences, all intended:
 *  - portal logout clears the column  → agent mode on main dies.
 *  - a login somewhere else overwrites it → the older browser's agent mode dies.
 *  - a cookie minted before this change has no id → treated as not connected.
 *
 * Server-only (service-role client).
 */

import { supabase } from "@/lib/supabase-server";

/** A fresh login id. `crypto.randomUUID` exists in the Node and Edge runtimes. */
export function newPortalSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Stamp the id on the profile. Fails SOFT on a DB error: login must not break
 * because the revocation bookkeeping did - main then simply refuses agent mode
 * (fail-closed on its side), which is the safe direction.
 */
export async function setPortalSessionId(
  userId: string,
  sid: string,
): Promise<void> {
  // `as any`: types/database.types.ts is regenerated (npm run db:types) only
  // after the migration is applied - same posture as every other action here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_profiles")
    .update({ portal_session_id: sid })
    .eq("id", userId);
  if (error) {
    console.error("setPortalSessionId:", JSON.stringify(error));
  }
}

/**
 * Clear it on logout, but ONLY when it still belongs to the session that is
 * logging out: if the partner signed in again elsewhere in the meantime, that
 * newer login owns the column and must keep working.
 */
export async function clearPortalSessionId(
  userId: string,
  sid?: string | null,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("user_profiles")
    .update({ portal_session_id: null })
    .eq("id", userId);
  if (sid) query = query.eq("portal_session_id", sid);
  const { error } = await query;
  if (error) {
    console.error("clearPortalSessionId:", JSON.stringify(error));
  }
}
