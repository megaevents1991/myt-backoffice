/**
 * Supabase Auth integration (server-only). Supabase is the IDENTITY provider -
 * password verification, Google OAuth, admin user CRUD. Sessions stay our own
 * HMAC cookie (lib/auth/session.ts); Supabase sessions are never persisted.
 */
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-server";
import type { UserProfile } from "@/types/auth.types";

export type VerifyPasswordResult =
  | { ok: true; userId: string }
  /** "invalid" = wrong email/password. "transient" = rate limit (429) or a
   *  network/5xx failure - the password may well be CORRECT, so callers must
   *  NOT report it as bad credentials (shared office IP hits Supabase's
   *  token-endpoint rate limit and users see "invalid password" for no reason). */
  | { ok: false; reason: "invalid" | "transient" };

/** Verify email+password against Supabase Auth. */
export async function verifyPassword(
  email: string,
  password: string,
): Promise<VerifyPasswordResult> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const { data, error } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      const status = (error as { status?: number }).status;
      const transient =
        status === 429 || (status !== undefined && status >= 500);
      if (transient)
        console.error("verifyPassword transient:", status, error.message);
      return { ok: false, reason: transient ? "transient" : "invalid" };
    }
    if (!data.user) return { ok: false, reason: "invalid" };
    // No signOut round-trip: persistSession is false, the in-memory session
    // just gets dropped - the extra /logout call only burned rate-limit budget.
    return { ok: true, userId: data.user.id };
  } catch (e) {
    // fetch/network failure - not a credentials verdict.
    console.error("verifyPassword network failure:", e);
    return { ok: false, reason: "transient" };
  }
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("getProfile:", JSON.stringify(error));
    return null;
  }
  return (data as UserProfile) ?? null;
}

export async function getProfileByEmail(
  email: string,
): Promise<UserProfile | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by",
    )
    .ilike("email", email)
    .maybeSingle();
  if (error) {
    console.error("getProfileByEmail:", JSON.stringify(error));
    return null;
  }
  return (data as UserProfile) ?? null;
}
