import { NextResponse } from "next/server";
import { createSessionValue, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    // Check for admin login
    if (
      email === process.env.NEXT_SECRET_ADMIN_EMAIL &&
      password === process.env.NEXT_SECRET_ADMIN_PASSWORD
    ) {
      const response = NextResponse.json({
        success: true,
        user: { id: "admin", email, role: "admin" },
      });

      // Set a signed, tamper-proof session cookie (not a guessable constant).
      response.cookies.set(SESSION_COOKIE, await createSessionValue(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });

      return response;
    }

    // For non-admin users, reject login
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}