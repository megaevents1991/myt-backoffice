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
import {
  ADMIN_ROLES,
  PARTNER_ROLES,
  STAFF_ROLES,
  type Role,
} from "@/types/auth.types";
import { supabase } from "@/lib/supabase-server";

/**
 * Verified session payload from the request cookie, or null.
 *
 * The portal cookie wins when present: it is path-scoped to /portal (real
 * partner logins and superadmin impersonation both mint it - see
 * lib/auth/session.ts), so only portal pages and their server actions ever
 * see it, and it coexists with a staff `session` cookie in the same browser.
 * Restricted to partner roles so a forged/stale value can never ESCALATE
 * above the real session.
 *
 * A STAFF session is checked against the live profile (liveStaffSession), so
 * what /users says now - not what it said at sign-in - decides.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const portal = await verifySessionValue(
    store.get(PORTAL_SESSION_COOKIE)?.value,
  );
  if (portal && PARTNER_ROLES.includes(portal.role)) {
    return portal;
  }
  const cookie = store.get(SESSION_COOKIE);
  const session = await verifySessionValue(cookie?.value);
  if (session && STAFF_ROLES.includes(session.role)) {
    return liveStaffSession(session);
  }
  return session;
}

/**
 * The staff cookie is signed for a week with the role it was minted with, so
 * deactivating someone in /users or changing their role used to wait for their
 * next sign-in. Same re-check partners and forms_operator already get
 * (assertActorActive), on every staff request:
 *  - no row, a failed read or is_active=false -> no session (fail closed);
 *  - the role changed -> the session carries the CURRENT role, so a demoted
 *    admin loses admin powers on the next request and a promotion lands at
 *    once. A move to a non-staff role (partner / forms_operator) needs a new
 *    sign-in - that account lives on a different cookie - so it reads as none.
 */
async function liveStaffSession(
  session: SessionPayload,
): Promise<SessionPayload | null> {
  const profile = await loadActorProfile(session.sub);
  if (!profile || profile.is_active === false) return null;
  const role = profile.role;
  if (!role || !STAFF_ROLES.includes(role)) return null;
  return role === session.role ? session : { ...session, role };
}

type ActorProfile = { is_active: boolean | null; role: Role | null };

/**
 * Per-request memo for loadActorProfile, keyed on the request's own cookie
 * store: Next 15 resolves every `await cookies()` of one request to the same
 * object - in page renders, server actions and route handlers alike - so a
 * guard plus logAudit's getSession() cost ONE profile read. (React cache()
 * only dedupes inside a page render; in actions and route handlers it is a
 * pass-through.) A request that ever saw a different object would just read
 * again - never a stale answer, and never one shared across requests.
 */
const actorProfileReads = new WeakMap<
  object,
  Map<string, Promise<ActorProfile | null>>
>();

/** The actor's live user_profiles row; null on a failed read or no row (callers fail closed). */
async function loadActorProfile(sub: string): Promise<ActorProfile | null> {
  const store = await cookies();
  let reads = actorProfileReads.get(store);
  if (!reads) {
    reads = new Map();
    actorProfileReads.set(store, reads);
  }
  let read = reads.get(sub);
  if (!read) {
    read = readActorProfile(sub);
    reads.set(sub, read);
  }
  return read;
}

async function readActorProfile(sub: string): Promise<ActorProfile | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("user_profiles")
      .select("is_active, role")
      .eq("id", sub)
      .maybeSingle();
    if (error) {
      console.error("loadActorProfile:", JSON.stringify(error));
      return null;
    }
    return (data as ActorProfile | null) ?? null;
  } catch (e) {
    console.error("loadActorProfile:", e);
    return null;
  }
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

/**
 * Staff or forms_operator - the READ/RUN side of the forms area: list, view,
 * duplicate, trip links, responses, trips report. Anything that edits or
 * publishes a questionnaire stays behind requireStaff.
 */
export async function requireFormsAccess(): Promise<SessionPayload> {
  const session = await requireRole(
    "superadmin",
    "admin",
    "editor",
    "forms_operator",
  );
  // An external operator's still-signed cookie must stop working the moment
  // the account is disabled in /users - same decision as requirePartner
  // (QA 20.08). Staff roles were already re-checked by getSession.
  if (session.role === "forms_operator") await assertActorActive(session.sub);
  return session;
}

/**
 * Deep check for per-form actions: staff pass; a forms_operator passes only
 * when the form is flagged operator_visible. Fail-closed on query errors.
 * Guards the ACTIONS (trip links, invites, responses, report) - list/read
 * filtering alone would still leave direct action calls open.
 */
export async function requireFormVisible(
  actor: SessionPayload,
  formId: number,
): Promise<void> {
  if (actor.role !== "forms_operator") return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("forms")
    .select("operator_visible")
    .eq("id", formId)
    .is("is_deleted", null)
    .maybeSingle();
  if (error) {
    console.error("requireFormVisible:", JSON.stringify(error));
    throw new Error("Unauthorized");
  }
  if (!data?.operator_visible) throw new Error("Unauthorized");
}

/** superadmin or admin - user management. Per-target hierarchy enforced in user-actions. */
export async function requireAdmin(): Promise<SessionPayload> {
  return requireRole("superadmin", "admin");
}

/** superadmin only - managing admin-level accounts. */
export async function requireSuperadmin(): Promise<SessionPayload> {
  return requireRole("superadmin");
}

/** office_manager, agent or affiliate with a linked partner code - portal actions. */
export async function requirePartner(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requireRole("office_manager", "agent", "affiliate");
  if (!session.partner_code) throw new Error("Unauthorized");
  // A disabled user's still-signed cookie must not keep working for the rest
  // of its week-long life - this re-checks is_active on every portal action.
  // One extra indexed PK query per action, accepted (QA item 10, 20.08).
  await assertActorActive(session.sub);
  return session as SessionPayload & { partner_code: string };
}

/**
 * Fail-closed actor check behind requirePartner (and requireOfficeManager,
 * which does NOT route through requirePartner - it calls requireRole
 * directly, so it asserts separately): a disabled user's still-valid signed
 * cookie must not keep working. Query error and "row missing" are treated the
 * same as is_active === false - only a confirmed active row passes.
 */
async function assertActorActive(sub: string): Promise<void> {
  const profile = await loadActorProfile(sub);
  if (!profile || profile.is_active === false) {
    throw new Error("Unauthorized");
  }
}

/** office_manager only - team management, office-wide views, credit/coupons. */
export async function requireOfficeManager(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requireRole("office_manager");
  if (!session.partner_code) throw new Error("Unauthorized");
  await assertActorActive(session.sub);
  return session as SessionPayload & { partner_code: string };
}

/**
 * Guard for API route handlers used by dashboard staff.
 *   const denied = await guardAdminRoute();
 *   if (denied) return denied;
 * Despite the name it admits EVERY staff role (editor included) - the route
 * twin of requireStaff(). For an admin-only route use guardAdminOnlyRoute.
 */
export async function guardAdminRoute(): Promise<NextResponse | null> {
  const session = await getSession();
  if (session && STAFF_ROLES.includes(session.role)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Admin-only route guard (ADMIN_ROLES) - the route twin of requireAdmin().
 * 401 with no session, 403 for a signed-in role below admin.
 */
export async function guardAdminOnlyRoute(): Promise<NextResponse | null> {
  const session = await getSession();
  if (session && ADMIN_ROLES.includes(session.role)) return null;
  return session
    ? NextResponse.json({ error: "Admins only" }, { status: 403 })
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

/**
 * Credit + coupons are per-agent now (QA wave 2, 20.08): office money is
 * split by attribution (lib/actions/partner-credit-actions.ts loadCredit
 * scoping), so every partner role may reach these screens/actions - this is
 * now a plain alias for requirePartner(). Kept as its own export so the call
 * sites read as an intent ("this needs credit/coupons access") rather than
 * the generic partner guard, and so the solo-only restriction can come back
 * here alone if that ever changes again.
 */
export async function requireCreditAccess(): Promise<
  SessionPayload & { partner_code: string }
> {
  return requirePartner();
}
