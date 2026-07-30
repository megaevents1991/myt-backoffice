import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";

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

  const session = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value);
  const isAuthPage = pathname.startsWith("/auth");

  // Partner self-service (dashboard, links, credit, coupons, reservations,
  // quotes) moved entirely to the main site's /agent area (2026-07-30) — this
  // is no longer a real destination for a partner role, just a redirect out.
  // Staff keep their OWN, richer admin view at /partners/[code]/view; nothing
  // here touches that.
  const mainAgentUrl = () =>
    (process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://www.mega-events.co.il").replace(/\/$/, "") +
    "/agent";

  const home = session && PARTNER_ROLES.includes(session.role) ? mainAgentUrl() : "/dashboard";

  // Signed-in user hitting an auth page → send to their home.
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Unauthenticated user hitting a protected page → login.
  if (!session && !isAuthPage && pathname !== "/") {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (session) {
    const isPortal = pathname === "/portal" || pathname.startsWith("/portal/");
    const isUsersAdmin = pathname === "/users" || pathname.startsWith("/users/");

    // A partner role has nowhere left to go in this app at all — and /portal
    // itself is retired for everyone, not just partners (it can no longer
    // render anything a partner-scoped session could use).
    if (isPortal || (PARTNER_ROLES.includes(session.role) && pathname !== "/")) {
      return NextResponse.redirect(new URL(mainAgentUrl(), req.url));
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
