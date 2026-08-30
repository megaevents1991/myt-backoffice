import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  createSessionValue,
  PORTAL_MEMBER_HINT_COOKIE,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";
import { getProfileByEmail } from "@/lib/auth/supabase-auth";
import {
  newPortalSessionId,
  setPortalSessionId,
} from "@/lib/auth/portal-session-id";
import { logAudit, requestIp } from "@/lib/audit";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth", request.url),
    );
  }

  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {}, // we do not keep the Supabase session
        },
      },
    );

    const { data, error } =
      await supabaseAuth.auth.exchangeCodeForSession(code);
    if (error || !data.user?.email) {
      console.error("OAuth exchange error:", error);
      return NextResponse.redirect(
        new URL("/auth/login?error=oauth", request.url),
      );
    }

    // Only pre-created users may enter - no self-signup via Google.
    const profile = await getProfileByEmail(data.user.email);
    if (!profile || !profile.is_active) {
      await logAudit({
        action: "login_failed",
        actor: { email: data.user.email },
        ip: requestIp(request),
        metadata: { provider: "google", reason: "no_account" },
      });
      return NextResponse.redirect(
        new URL("/auth/login?error=no-account", request.url),
      );
    }

    await logAudit({
      action: "login",
      entityType: "user",
      entityId: profile.id,
      actor: { id: profile.id, email: profile.email, role: profile.role },
      ip: requestIp(request),
      metadata: { provider: "google" },
    });

    const isPartner = ["agent", "affiliate", "office_manager"].includes(
      profile.role,
    );
    const home = isPartner ? "/portal" : "/dashboard";
    const redirect = NextResponse.redirect(new URL(home, request.url));
    // Same login id the password route stamps - myt-main revokes agent mode
    // against it (lib/auth/portal-session-id.ts).
    const sid = isPartner ? newPortalSessionId() : null;
    if (sid) await setPortalSessionId(profile.id, sid);
    // Partners get the /portal-scoped cookie so their login coexists with a
    // staff `session` in the same browser - same split as the password login.
    redirect.cookies.set(
      isPartner ? PORTAL_SESSION_COOKIE : SESSION_COOKIE,
      await createSessionValue({
        sub: profile.id,
        email: profile.email,
        role: profile.role,
        partner_code: profile.partner_tracking_code,
        sid,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: isPartner ? "/portal" : "/",
      },
    );
    if (isPartner) {
      // Routing hint (no auth value) - see the login route.
      redirect.cookies.set(PORTAL_MEMBER_HINT_COOKIE, "1", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
    }
    // Clear the temporary Supabase PKCE cookies.
    cookieStore.getAll().forEach(({ name }) => {
      if (name.startsWith("sb-")) redirect.cookies.delete(name);
    });
    return redirect;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth", request.url),
    );
  }
}
