import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    // Get the session cookie from the request
    const cookieHeader = request.headers.get("cookie") || "";
    const sessionCookie = cookieHeader
      .split(';')
      .find(c => c.trim().startsWith('session='))
      ?.split('=')[1];
    
    console.log("Session cookie:", sessionCookie);
    
    if (sessionCookie === "admin-session") {
      return NextResponse.json({
        user: {
          id: "admin",
          email: process.env.NEXT_SECRET_ADMIN_EMAIL,
          role: "admin",
        }
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