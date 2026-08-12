/**
 * Authorization guards for the backoffice.
 *
 * Role-based access control: superadmin, admin, editor, agent, affiliate. Every server action
 * and mutating/data API route must call a role guard (requireRole, requireStaff,
 * requireAdmin, requirePartner) as the first line - they confirm the caller holds
 * the required role before the RLS-bypassing service-role Supabase client touches
 * the database. For cron routes, use guardCronRoute(request) instead.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  verifySessionValue,
  type SessionPayload,
} from "./session";
import { STAFF_ROLES, type Role } from "@/types/auth.types";

/**
 * Verified session payload from the request cookie, or null.
 *
 * The portal cookie wins when present: it is path-scoped to /portal (real
 * partner logins and superadmin impersonation both mint it - see
 * lib/auth/session.ts), so only portal pages and their server actions ever
 * see it, and it coexists with a staff `session` cookie in the same browser.
 * Restricted to partner roles so a forged/stale value can never ESCALATE
 * above the real session.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const portal = await verifySessionValue(
    store.get(PORTAL_SESSION_COOKIE)?.value,
  );
  if (portal && (portal.role === "agent" || portal.role === "affiliate")) {
    return portal;
  }
  const cookie = store.get(SESSION_COOKIE);
  return verifySessionValue(cookie?.value);
}

/** Server-action guard: caller must hold one of the given roles. Returns the actor. */
export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) {
    throw new Error("Unauthorized");
  }
  return session;
}

/** superadmin, admin or editor - the default guard for all dashboard mutations. */
export async function requireStaff(): Promise<SessionPayload> {
  return requireRole("superadmin", "admin", "editor");
}

/** superadmin or admin - user management. Per-target hierarchy enforced in user-actions. */
export async function requireAdmin(): Promise<SessionPayload> {
  return requireRole("superadmin", "admin");
}

/** superadmin only - managing admin-level accounts. */
export async function requireSuperadmin(): Promise<SessionPayload> {
  return requireRole("superadmin");
}

/** agent or affiliate with a linked partner code - portal actions. */
export async function requirePartner(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requireRole("agent", "affiliate");
  if (!session.partner_code) throw new Error("Unauthorized");
  return session as SessionPayload & { partner_code: string };
}

/**
 * Guard for API route handlers used by dashboard staff.
 *   const denied = await guardAdminRoute();
 *   if (denied) return denied;
 */
export async function guardAdminRoute(): Promise<NextResponse | null> {
  const session = await getSession();
  if (session && STAFF_ROLES.includes(session.role)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Guard for Vercel-scheduled cron routes.
 *
 * Preferred: Vercel injects `Authorization: Bearer <CRON_SECRET>` on every cron
 * invocation when the CRON_SECRET env var is set - this keeps the secret out of
 * the committed repo (the old `?key=monthlyAlonSecret` in vercel.json was
 * public). A legacy fallback still accepts `?key=<NEXT_SECRET_CRON_SECRET_KEY>`
 * (or that key in the JSON body) so manual/non-Vercel triggers keep working;
 * rotate that value since it was previously committed.
 *
 * Returns a 401 NextResponse to return early, or null when authorized.
 */
export async function guardCronRoute(
  request: Request,
): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (cronSecret && header === `Bearer ${cronSecret}`) return null;

  const legacyKey = process.env.NEXT_SECRET_CRON_SECRET_KEY;
  if (legacyKey) {
    const queryKey = new URL(request.url).searchParams.get("key");
    if (queryKey && queryKey === legacyKey) return null;
    // Some routes pass the key in a JSON body instead of the query string.
    if (request.method === "POST") {
      try {
        const body = await request.clone().json();
        if (body?.key && body.key === legacyKey) return null;
      } catch {
        /* not JSON - fall through to 401 */
      }
    }
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
