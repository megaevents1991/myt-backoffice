import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    
    // Check for admin login
    if (
      email === process.env.NEXT_SECRET_ADMIN_EMAIL &&
      password === process.env.NEXT_SECRET_ADMIN_PASSWORD
    ) {
      // Create a new response with the user data
      const response = NextResponse.json({
        success: true,
        user: { id: "admin", email, role: "admin" },
      });
      
      // Set the session cookie
      response.cookies.set("session", "admin-session", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7, // 1 week
        path: "/",
      });
      
      console.log("Login successful, cookie set");
      return response;
    }
    
    // For non-admin users, reject login
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}