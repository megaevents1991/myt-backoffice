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

    if (await verifySessionValue(sessionCookie)) {
      return NextResponse.json({
        user: {
          id: "admin",
          email: process.env.NEXT_SECRET_ADMIN_EMAIL,
          role: "admin",
        },
      });
    }

    // No valid session found
    return NextResponse.json({ user: null });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json(
      { error: "Failed to check session" },
      { status: 500 }
    );
  }
}
