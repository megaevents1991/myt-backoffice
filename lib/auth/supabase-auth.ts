/**
 * Supabase Auth integration (server-only). Supabase is the IDENTITY provider —
 * password verification, Google OAuth, admin user CRUD. Sessions stay our own
 * HMAC cookie (lib/auth/session.ts); Supabase sessions are never persisted.
 */
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-server";
import type { UserProfile } from "@/types/auth.types";

/** Verify email+password against Supabase Auth. Returns the auth user id, or null. */
export async function verifyPassword(
  email: string,
  password: string
): Promise<{ userId: string } | null> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  // We never use the Supabase session — sign it out server-side immediately.
  await anon.auth.signOut().catch(() => {});
  return { userId: data.user.id };
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by"
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("getProfile:", JSON.stringify(error));
    return null;
  }
  return (data as UserProfile) ?? null;
}

export async function getProfileByEmail(email: string): Promise<UserProfile | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by"
    )
    .ilike("email", email)
    .maybeSingle();
  if (error) {
    console.error("getProfileByEmail:", JSON.stringify(error));
    return null;
  }
  return (data as UserProfile) ?? null;
}
