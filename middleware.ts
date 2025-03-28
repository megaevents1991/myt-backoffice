import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  // Get session cookie
  const session = req.cookies.get("session");
  
  // Debug log info
  console.log(`[Middleware] Path: ${req.nextUrl.pathname}`);
  console.log(`[Middleware] Session: ${session ? session.value : "missing"}`);
  
  // Skip static files, API routes and images in middleware
  const pathname = req.nextUrl.pathname;
  if (
    pathname.startsWith('/_next/') || 
    pathname.includes('.') ||
    pathname.startsWith('/api/')
  ) {
    console.log("[Middleware] Skipping middleware for static file or API");
    return NextResponse.next();
  }
  
  // Check if the request is for an auth page
  const isAuthPage = pathname.startsWith("/auth");
  
  // If user is signed in and trying to access auth page, redirect to dashboard
  if (session && isAuthPage) {
    console.log("[Middleware] Redirecting authenticated user to dashboard");
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  
  // If user is not signed in and trying to access protected page, redirect to login
  if (!session && !isAuthPage && pathname !== "/") {
    console.log("[Middleware] Redirecting unauthenticated user to login");
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }
  
  console.log("[Middleware] Proceeding normally");
  return NextResponse.next();
}

// Use a simple matcher pattern
export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
