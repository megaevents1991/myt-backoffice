import { NextResponse } from "next/server";
import {
  createSessionValue,
  PORTAL_MEMBER_HINT_COOKIE,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";
import { verifyPassword, getProfile } from "@/lib/auth/supabase-auth";
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
  const value = await createSessionValue({
    sub: profile.id,
    email: profile.email,
    role: profile.role,
    partner_code: profile.partner_tracking_code,
  });
  const isPartner = profile.role === "agent" || profile.role === "affiliate";
  // Partners live in their own /portal-scoped cookie so a partner login in one
  // tab never logs out a staff `session` in another (multi-session, same
  // Chrome). Staff keep the site-wide cookie. See lib/auth/session.ts.
  response.cookies.set(
    isPartner ? PORTAL_SESSION_COOKIE : SESSION_COOKIE,
    value,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: isPartner ? "/portal" : "/",
    },
  );
  if (isPartner) {
    // Site-wide ROUTING HINT (no auth value): lets middleware send a
    // partner's stray /dashboard bookmark home to /portal - the path-scoped
    // session cookie is invisible there.
    response.cookies.set(PORTAL_MEMBER_HINT_COOKIE, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
  }
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
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // Supabase Auth path - real users created by an admin.
    const verified = await verifyPassword(email, password);
    if (verified.ok) {
      // The password is correct - a null profile here is either a transient DB
      // blip or a genuinely missing/inactive account. Retry once before
      // rejecting so a hiccup doesn't read as "invalid credentials".
      let profile = await getProfile(verified.userId);
      if (!profile) {
        await new Promise((r) => setTimeout(r, 300));
        profile = await getProfile(verified.userId);
      }
      if (profile && profile.is_active) {
        return respondWithSession(profile, request);
      }
      await logAudit({
        action: "login_failed",
        actor: { email },
        ip: requestIp(request),
        metadata: { reason: profile ? "inactive_account" : "no_profile" },
      });
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    if (verified.reason === "transient") {
      // Rate limit / auth-server hiccup - the password was NOT judged wrong.
      await logAudit({
        action: "login_failed",
        actor: { email },
        ip: requestIp(request),
        metadata: { reason: "rate_limited_or_transient" },
      });
      return NextResponse.json(
        {
          error:
            "Too many login attempts right now. Wait a minute and try again.",
        },
        { status: 429 },
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
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 },
    );
  }
}
