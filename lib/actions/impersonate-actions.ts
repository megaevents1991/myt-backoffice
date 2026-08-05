"use server"

import { cookies } from "next/headers"
import { requireSuperadmin } from "@/lib/auth/guards"
import {
  createSessionValue,
  PORTAL_SESSION_COOKIE,
  PORTAL_IMPERSONATION_MAX_AGE,
} from "@/lib/auth/session"
import { supabase } from "@/lib/supabase-server"
import { logAudit } from "@/lib/audit"

export type ImpersonateResult = { ok: true } | { ok: false; error: string }

/**
 * Superadmin "login as partner": sets a signed partner session in a SECOND
 * cookie scoped to `path=/portal`, then the caller opens /portal in a new
 * window. Only portal requests carry the cookie (getSession prefers it there),
 * so the admin's own dashboard session — including every other open tab —
 * stays exactly as it was. Expires after 2 hours, or click again to renew.
 *
 * Identity in the minted payload: the partner's real portal user when one
 * exists (so flows keyed on `sub`, like the main-site handoff, behave exactly
 * as they do for the partner), else the superadmin's own id with the
 * partner's role+code — every portal query is scoped by partner_code, which
 * is what actually matters.
 */
export async function impersonatePartner(trackingCode: string): Promise<ImpersonateResult> {
  const admin = await requireSuperadmin()

  const code = (trackingCode ?? "").trim()
  if (!code) return { ok: false, error: "Invalid tracking code" }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: partner, error } = await (supabase as any)
    .from("partners")
    .select("partner_tracking_code, name_hebrew, email, type, is_active")
    .eq("partner_tracking_code", code)
    .maybeSingle()
  if (error) {
    console.error("impersonatePartner:", JSON.stringify(error))
    return { ok: false, error: "Failed to load partner" }
  }
  if (!partner) return { ok: false, error: "Partner not found" }

  const role = partner.type === "agent" ? "agent" : "affiliate"

  // Prefer the partner's real portal login identity when they have one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("user_profiles")
    .select("id, email")
    .eq("partner_tracking_code", code)
    .in("role", ["agent", "affiliate"])
    .maybeSingle()

  // TTL passed explicitly: the SIGNED exp must match the cookie's 2h maxAge —
  // otherwise a copied cookie value would stay replayable for a week.
  const value = await createSessionValue(
    {
      sub: (profile?.id as string) || admin.sub,
      email: (profile?.email as string) || partner.email || admin.email,
      role,
      partner_code: code,
      // Actions taken while impersonating are audited under the REAL actor —
      // lib/audit.ts reads this off the session.
      impersonator: { sub: admin.sub, email: admin.email },
    },
    PORTAL_IMPERSONATION_MAX_AGE
  )

  const store = await cookies()
  store.set(PORTAL_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PORTAL_IMPERSONATION_MAX_AGE,
    // The whole trick: the browser attaches this cookie to /portal requests
    // only, so the dashboard keeps reading the admin's own session cookie.
    path: "/portal",
  })

  await logAudit({
    action: "partner.impersonate",
    entityType: "partner",
    entityId: code,
    metadata: { role },
    actor: { id: admin.sub, email: admin.email, role: admin.role },
  })

  return { ok: true }
}

/** Ends the portal impersonation early (the cookie also self-expires). */
export async function stopImpersonation(): Promise<ImpersonateResult> {
  await requireSuperadmin()
  const store = await cookies()
  store.set(PORTAL_SESSION_COOKIE, "", { maxAge: 0, path: "/portal" })
  return { ok: true }
}
