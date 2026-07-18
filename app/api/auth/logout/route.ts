import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";

export async function POST() {
  try {
    const session = await getSession();
    if (session) {
      await logAudit({
        action: "logout",
        actor: { id: session.sub, email: session.email, role: session.role },
      });
    }

    const response = NextResponse.json({ success: true });

    // Clear the session cookie
    response.cookies.set("session", "", {
      expires: new Date(0),
      path: "/",
    });
    
    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Logout failed" },
      { status: 500 }
    );
  }
}