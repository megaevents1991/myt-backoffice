import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Skip static files, API routes and images in middleware. API routes and
  // server actions enforce their own auth via requireAdmin()/guardAdminRoute().
  if (
    pathname.startsWith("/_next/") ||
    pathname.includes(".") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // Validate the SIGNED session token, not merely the cookie's presence — a
  // forged/expired/junk value no longer passes.
  const session = req.cookies.get(SESSION_COOKIE);
  const isAuthed = await verifySessionValue(session?.value);
  const isAuthPage = pathname.startsWith("/auth");

  // Signed-in user hitting an auth page → send to dashboard.
  if (isAuthed && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Unauthenticated user hitting a protected page → send to login.
  if (!isAuthed && !isAuthPage && pathname !== "/") {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  return NextResponse.next();
}

// Use a simple matcher pattern
export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
