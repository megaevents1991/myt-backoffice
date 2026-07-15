import { NextResponse } from "next/server";
import {
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";
import {
  verifyPassword,
  getProfile,
  getProfileByEmail,
} from "@/lib/auth/supabase-auth";
import type { UserProfile } from "@/types/auth.types";
import { logAudit, requestIp } from "@/lib/audit";

async function respondWithSession(profile: UserProfile, request: Request) {
  await logAudit({
    action: "login",
    entityType: "user",
    entityId: profile.id,
    actor: { id: profile.id, email: profile.email, role: profile.role },
    ip: requestIp(request),
  });
  const response = NextResponse.json({
    success: true,
    user: {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      partner_code: profile.partner_tracking_code,
      display_name: profile.display_name,
    },
  });
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionValue({
      sub: profile.id,
      email: profile.email,
      role: profile.role,
      partner_code: profile.partner_tracking_code,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    }
  );
  return response;
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string") {
      await logAudit({
        action: "login_failed",
        actor: { email: null },
        ip: requestIp(request),
        metadata: { reason: "malformed_request" },
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Supabase Auth path — real users created by an admin.
    const verified = await verifyPassword(email, password);
    if (verified) {
      const profile = await getProfile(verified.userId);
      if (profile && profile.is_active) {
        return respondWithSession(profile, request);
      }
      await logAudit({
        action: "login_failed",
        actor: { email },
        ip: requestIp(request),
        metadata: { reason: "invalid_credentials" },
      });
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // TODO(remove-after-bootstrap): legacy env-credential fallback so the
    // dashboard stays accessible until the first admin users exist in prod.
    if (
      process.env.NEXT_SECRET_ADMIN_EMAIL &&
      email === process.env.NEXT_SECRET_ADMIN_EMAIL &&
      password === process.env.NEXT_SECRET_ADMIN_PASSWORD
    ) {
      const profile = await getProfileByEmail(email);
      if (profile) {
        if (profile.is_active) return respondWithSession(profile, request);
        await logAudit({
          action: "login_failed",
          actor: { email },
          ip: requestIp(request),
          metadata: { reason: "invalid_credentials" },
        });
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }
      // No profile row yet (pre-migration): mint a superadmin session with a
      // placeholder sub so the dashboard keeps working (legacy creds = Dor).
      return respondWithSession(
        {
          id: "00000000-0000-0000-0000-000000000000",
          email,
          display_name: "Legacy Admin",
          role: "superadmin",
          partner_tracking_code: null,
          logo_url: null,
          phone: null,
          is_active: true,
          created_at: new Date().toISOString(),
          created_by: null,
        },
        request
      );
    }

    await logAudit({
      action: "login_failed",
      actor: { email },
      ip: requestIp(request),
      metadata: { reason: "invalid_credentials" },
    });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
