import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const sessionCookie = cookieHeader
      .split(";")
      .find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`))
      ?.split("=")
      .slice(1)
      .join("=");

    const payload = await verifySessionValue(sessionCookie);
    if (payload) {
      return NextResponse.json({
        user: {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          partner_code: payload.partner_code,
        },
      });
    }
    return NextResponse.json({ user: null });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json({ error: "Failed to check session" }, { status: 500 });
  }
}
