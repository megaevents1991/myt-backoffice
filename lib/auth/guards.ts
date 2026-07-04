/**
 * Authorization guards for the backoffice.
 *
 * The whole dashboard is a single-admin surface with no public/multi-tenant
 * callers, and it runs on the RLS-bypassing service-role Supabase client — so
 * every server action and every mutating/data API route must confirm the caller
 * holds a valid admin session (or, for cron, the Vercel CRON_SECRET) before
 * touching the database.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "./session";

/** True if the request carries a valid signed admin session cookie. */
export async function isAdmin(): Promise<boolean> {
  const cookie = (await cookies()).get(SESSION_COOKIE);
  return verifySessionValue(cookie?.value);
}

/**
 * Guard for server actions ("use server"). Throws if the caller is not an
 * authenticated admin — call it as the first line of every mutating/data action.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    throw new Error("Unauthorized");
  }
}

/**
 * Guard for API route handlers. Returns a 401 NextResponse to return early, or
 * null when the caller is an authenticated admin.
 *
 *   const denied = await guardAdminRoute();
 *   if (denied) return denied;
 */
export async function guardAdminRoute(): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Guard for Vercel-scheduled cron routes.
 *
 * Preferred: Vercel injects `Authorization: Bearer <CRON_SECRET>` on every cron
 * invocation when the CRON_SECRET env var is set — this keeps the secret out of
 * the committed repo (the old `?key=monthlyAlonSecret` in vercel.json was
 * public). A legacy fallback still accepts `?key=<NEXT_SECRET_CRON_SECRET_KEY>`
 * (or that key in the JSON body) so manual/non-Vercel triggers keep working;
 * rotate that value since it was previously committed.
 *
 * Returns a 401 NextResponse to return early, or null when authorized.
 */
export async function guardCronRoute(request: Request): Promise<NextResponse | null> {
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
        /* not JSON — fall through to 401 */
      }
    }
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
