import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/guards";
import {
  PORTAL_MEMBER_HINT_COOKIE,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  verifySessionValue,
} from "@/lib/auth/session";
import { clearPortalSessionId } from "@/lib/auth/portal-session-id";
import { PARTNER_ROLES } from "@/types/auth.types";
import { logAudit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (session) {
      await logAudit({
        action: "logout",
        actor: { id: session.sub, email: session.email, role: session.role },
      });
      // Ends agent mode on myt-main too: the customer site holds its own
      // cookie, and the only thing that can revoke it from here is this id
      // disappearing from the profile (doc 2026-08-30, item 2).
      if (PARTNER_ROLES.includes(session.role)) {
        await clearPortalSessionId(session.sub, session.sid);
      }
    }

    // The portal's own logout button sends { scope: "portal" }: it must end
    // the partner (or impersonated) portal session WITHOUT killing a staff
    // `session` that may be signed in beside it in the same browser
    // (multi-session - see lib/auth/session.ts). The dashboard logout sends
    // no scope and clears everything.
    let portalOnly = false;
    try {
      const body = await request.json();
      portalOnly = body?.scope === "portal";
    } catch {
      // No/invalid body - full logout.
    }

    const response = NextResponse.json({ success: true });

    // The portal cookie is path-scoped; clearing must name the same path.
    response.cookies.set(PORTAL_SESSION_COOKIE, "", {
      expires: new Date(0),
      path: "/portal",
    });
    response.cookies.set(PORTAL_MEMBER_HINT_COOKIE, "", {
      expires: new Date(0),
      path: "/",
    });

    if (portalOnly) {
      // Legacy partner sessions predate the portal cookie and live in the
      // site-wide cookie - those must still die on portal logout. A staff
      // session beside the portal one stays.
      const legacy = await verifySessionValue(
        request.headers
          .get("cookie")
          ?.split(";")
          .find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`))
          ?.split("=")
          .slice(1)
          .join("="),
      );
      if (legacy && (legacy.role === "agent" || legacy.role === "affiliate")) {
        response.cookies.set(SESSION_COOKIE, "", {
          expires: new Date(0),
          path: "/",
        });
      }
    } else {
      response.cookies.set(SESSION_COOKIE, "", {
        expires: new Date(0),
        path: "/",
      });
    }

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}
