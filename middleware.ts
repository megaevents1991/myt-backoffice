import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Get session cookie
  const session = req.cookies.get("session")

  // Check if the request is for an auth page
  const isAuthPage = req.nextUrl.pathname.startsWith("/auth")

  // If user is signed in and trying to access auth page, redirect to dashboard
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  // If user is not signed in and trying to access protected page, redirect to login
  if (!session && !isAuthPage) {
    return NextResponse.redirect(new URL("/auth/login", req.url))
  }

  return res
}

// Specify which routes this middleware should run on
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg).*)"],
}
