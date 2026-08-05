import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PORTAL_MEMBER_HINT_COOKIE,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  verifySessionValue,
} from "@/lib/auth/session";

const PARTNER_ROLES = ["agent", "affiliate"];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Skip static files, API routes and images. API routes and server actions
  // enforce their own auth via guards.
  if (
    pathname.startsWith("/_next/") ||
    pathname.includes(".") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // Public form fill pages (/f/<slug>, /f/i/<token>) — the only unauthenticated
  // pages in the app. They are read-only renders; the submit server action does
  // its own validation, publish-state check and rate limiting.
  if (pathname === "/f" || pathname.startsWith("/f/")) {
    return NextResponse.next();
  }

  // Partner sessions live in a /portal-scoped cookie (multi-session: a staff
  // `session` and a partner portal login coexist in the same browser — see
  // lib/auth/session.ts). The browser only sends it on /portal paths; prefer
  // it there, mirroring getSession(). Partner roles only — it can't escalate.
  const isPortalPath = pathname === "/portal" || pathname.startsWith("/portal/");
  const portalSession = isPortalPath
    ? await verifySessionValue(req.cookies.get(PORTAL_SESSION_COOKIE)?.value)
    : null;
  const portal =
    portalSession && PARTNER_ROLES.includes(portalSession.role) ? portalSession : null;

  const session =
    portal ?? (await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value));
  const isAuthPage = pathname.startsWith("/auth");

  const home = session && PARTNER_ROLES.includes(session.role) ? "/portal" : "/dashboard";

  // Signed-in user hitting an auth page → send to their home.
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Unauthenticated user hitting a protected page → login. Exception: a
  // partner's session cookie is /portal-scoped and invisible here, so their
  // stray /dashboard bookmark would read as "logged out" — the routing-hint
  // cookie (no auth value) sends them home to /portal instead, where the real
  // cookie IS sent and actually gates them.
  if (!session && !isAuthPage && pathname !== "/") {
    const isPortalPath = pathname === "/portal" || pathname.startsWith("/portal/");
    if (!isPortalPath && req.cookies.get(PORTAL_MEMBER_HINT_COOKIE)?.value === "1") {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (session) {
    const isPortal = pathname === "/portal" || pathname.startsWith("/portal/");
    const isUsersAdmin = pathname === "/users" || pathname.startsWith("/users/");

    // Partner roles may ONLY use /portal (staff may also enter /portal to debug).
    if (PARTNER_ROLES.includes(session.role) && !isPortal && pathname !== "/") {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    // /users is for superadmin/admin only.
    if (isUsersAdmin && session.role !== "admin" && session.role !== "superadmin") {
      return NextResponse.redirect(new URL(home, req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
