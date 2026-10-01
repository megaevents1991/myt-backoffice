import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  PORTAL_MEMBER_HINT_COOKIE,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  verifySessionValue,
} from "@/lib/auth/session";
import { PARTNER_ROLES, TOURS_AGENT_ROLE } from "@/types/auth.types";
import { TOURS_AGENT_HOME, isToursAgentPath } from "@/lib/auth/tours-agent";
import { COMPANY_HOME_HINT_COOKIE } from "@/lib/company-ids";

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

  // Public form fill pages (/f/<slug>, /f/i/<token>) - the only unauthenticated
  // pages in the app. They are read-only renders; the submit server action does
  // its own validation, publish-state check and rate limiting.
  if (pathname === "/f" || pathname.startsWith("/f/")) {
    return NextResponse.next();
  }

  // Partner sessions live in a /portal-scoped cookie (multi-session: a staff
  // `session` and a partner portal login coexist in the same browser - see
  // lib/auth/session.ts). The browser only sends it on /portal paths; prefer
  // it there, mirroring getSession(). Partner roles only - it can't escalate.
  const isPortalPath =
    pathname === "/portal" || pathname.startsWith("/portal/");
  const portalSession = isPortalPath
    ? await verifySessionValue(req.cookies.get(PORTAL_SESSION_COOKIE)?.value)
    : null;
  const portal =
    portalSession && PARTNER_ROLES.includes(portalSession.role)
      ? portalSession
      : null;

  const session =
    portal ??
    (await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value));
  const isAuthPage = pathname.startsWith("/auth");

  const home =
    session && PARTNER_ROLES.includes(session.role)
      ? "/portal"
      : session?.role === "forms_operator"
        ? "/forms"
        : session?.role === TOURS_AGENT_ROLE
          ? TOURS_AGENT_HOME
          : "/dashboard";

  // Signed-in user hitting an auth page → send to their home.
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Unauthenticated user hitting a protected page → login. Exception: a
  // partner's session cookie is /portal-scoped and invisible here, so their
  // stray /dashboard bookmark would read as "logged out" - the routing-hint
  // cookie (no auth value) sends them home to /portal instead, where the real
  // cookie IS sent and actually gates them.
  if (!session && !isAuthPage && pathname !== "/") {
    const isPortalPath =
      pathname === "/portal" || pathname.startsWith("/portal/");
    if (
      !isPortalPath &&
      req.cookies.get(PORTAL_MEMBER_HINT_COOKIE)?.value === "1"
    ) {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (session) {
    const isPortal = pathname === "/portal" || pathname.startsWith("/portal/");
    const isUsersAdmin =
      pathname === "/users" || pathname.startsWith("/users/");

    // Partner roles may ONLY use /portal (staff may also enter /portal to debug).
    if (PARTNER_ROLES.includes(session.role) && !isPortal && pathname !== "/") {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    // forms_operator may ONLY use /forms - same confinement pattern. The
    // builder page is additionally staff-gated inside its own server page.
    if (
      session.role === "forms_operator" &&
      pathname !== "/" &&
      pathname !== "/forms" &&
      !pathname.startsWith("/forms/")
    ) {
      return NextResponse.redirect(new URL("/forms", req.url));
    }
    // tours_agent may ONLY use its own screens (today the departures board of
    // its company, read-only) - same confinement pattern. The login page and
    // the OAuth callback send every non-partner to /dashboard, so this
    // redirect is also its landing. What it may READ there is decided on the
    // server (requireCompanyViewer); this only keeps it off the other pages.
    if (
      session.role === TOURS_AGENT_ROLE &&
      pathname !== "/" &&
      !isToursAgentPath(pathname)
    ) {
      return NextResponse.redirect(new URL(TOURS_AGENT_HOME, req.url));
    }
    // A staff browser that works in a company with no events (Mega Family)
    // lands on that company's home instead of the Mega Events dashboard - the
    // login page and the OAuth callback both send staff to /dashboard. A
    // routing hint only (lib/company-ids.ts): partners and forms_operator were
    // already sent home above, and Mega Events browsers never carry "tours".
    // Not when the URL carries a company deep link (`?company=<slug>`,
    // contexts/company-context.tsx): the link may be about to change the
    // company, and this redirect would drop it.
    if (
      pathname === "/dashboard" &&
      req.cookies.get(COMPANY_HOME_HINT_COOKIE)?.value === "tours" &&
      !req.nextUrl.searchParams.has("company")
    ) {
      return NextResponse.redirect(new URL("/tours", req.url));
    }
    // /users is for superadmin/admin only.
    if (
      isUsersAdmin &&
      session.role !== "admin" &&
      session.role !== "superadmin"
    ) {
      return NextResponse.redirect(new URL(home, req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
