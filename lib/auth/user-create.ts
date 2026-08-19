/**
 * Shared user-creation/reset core. Two callers, each with its OWN guard:
 * admin user management (lib/actions/user-actions.ts, requireAdmin) and the
 * office manager's team page (lib/actions/portal-team-actions.ts,
 * requireOfficeManager). Auth checks live in the callers - everything here
 * assumes the caller already authorized the operation.
 */

import { supabase } from "@/lib/supabase-server";
import type { Role } from "@/types/auth.types";
import { PARTNER_ROLES } from "@/types/auth.types";
import { generateAgentSlug } from "@/lib/portal-attribution";
import { logAudit } from "@/lib/audit";

/**
 * Make sure the `partners` row an agent/affiliate login points at exists.
 * Existing codes are left untouched - commercial terms are edited on the
 * partner screen, and silently rewriting a live commission from the user form
 * is not something an admin picking a name from a dropdown is asking for.
 */
async function ensurePartnerForUser(args: {
  trackingCode: string;
  role: Role;
  email: string;
  name: string;
}): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const trackingCode = args.trackingCode.trim();
  const { data: existing, error: lookupError } = await supabase
    .from("partners")
    .select("partner_tracking_code")
    .eq("partner_tracking_code", trackingCode)
    .maybeSingle();
  if (lookupError) {
    console.error("ensurePartnerForUser lookup:", JSON.stringify(lookupError));
    return { ok: false, error: "Could not check the partner for this user" };
  }
  if (existing) return { ok: true, created: false };

  const { error: insertError } = await supabase.from("partners").insert({
    partner_tracking_code: trackingCode,
    name_hebrew: args.name || null,
    email: args.email,
    // Legacy plaintext column the main app reads for affiliate auth. The login
    // is Supabase Auth, so this gets an unusable sentinel - never "".
    password: `disabled-${crypto.randomUUID()}`,
    // Zeroed on purpose: an unconfigured partner must never quietly start
    // earning. Terms are set on the partner screen.
    commission: 0,
    commission_type: "fixed_per_ticket",
    user_discount: 0,
    // office_manager must NEVER leak into partners.type: myt-main's influencer
    // classifier only recognizes 'agent'/'affiliate' there. The office row is
    // an agent-type partner regardless of which portal role its users hold.
    type: args.role === "affiliate" ? "affiliate" : "agent",
    is_active: true,
    created_at: new Date().toISOString().slice(0, 10),
  });
  if (insertError) {
    console.error("ensurePartnerForUser insert:", JSON.stringify(insertError));
    return { ok: false, error: "Could not create the partner for this user" };
  }

  await logAudit({
    action: "create",
    entityType: "partner",
    entityId: trackingCode,
    metadata: { created_with_user: true, commission: 0 },
  });
  return { ok: true, created: true };
}

/** Undo a partner created moments ago for a user that then failed to be created. */
async function rollbackCreatedPartner(
  trackingCode: string | null,
): Promise<void> {
  if (!trackingCode) return;
  const { error } = await supabase
    .from("partners")
    .delete()
    .eq("partner_tracking_code", trackingCode);
  if (error) {
    console.error(
      `createUser rollback failed (orphan partner "${trackingCode}"):`,
      JSON.stringify(error),
    );
  }
}

export type CreatePortalUserInput = {
  email: string;
  password: string;
  display_name: string;
  role: Role;
  partner_tracking_code: string | null;
  phone: string | null;
  /** The authorized actor's sub - recorded as user_profiles.created_by. */
  created_by: string;
};

export async function createManagedUser(
  input: CreatePortalUserInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const email = input.email?.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return {
      ok: false,
      error: "Email and a password of 8+ characters are required",
    };
  }
  if (PARTNER_ROLES.includes(input.role) && !input.partner_tracking_code) {
    return { ok: false, error: "Partner-linked users need a partner link" };
  }

  let createdPartnerCode: string | null = null;
  if (PARTNER_ROLES.includes(input.role) && input.partner_tracking_code) {
    const ensured = await ensurePartnerForUser({
      trackingCode: input.partner_tracking_code,
      role: input.role,
      email,
      name: input.display_name,
    });
    if (!ensured.ok) return { ok: false, error: ensured.error };
    if (ensured.created)
      createdPartnerCode = input.partner_tracking_code.trim();
  }

  const { data: created, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
  if (authError || !created.user) {
    console.error("createManagedUser auth:", JSON.stringify(authError));
    await rollbackCreatedPartner(createdPartnerCode);
    return {
      ok: false,
      error: authError?.message ?? "Auth user creation failed",
    };
  }

  const insertProfile = (slug: string | null) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("user_profiles").insert({
      id: created.user.id,
      email,
      display_name: input.display_name || null,
      role: input.role,
      partner_tracking_code: input.partner_tracking_code || null,
      phone: input.phone || null,
      agent_slug: slug,
      is_active: true,
      created_by: input.created_by,
    });

  const wantsSlug = PARTNER_ROLES.includes(input.role);
  let { error: profileError } = await insertProfile(
    wantsSlug ? generateAgentSlug() : null,
  );
  if (profileError?.code === "23505" && wantsSlug) {
    // agent_slug unique-index collision (astronomically rare) - one retry.
    ({ error: profileError } = await insertProfile(generateAgentSlug()));
  }
  if (profileError) {
    console.error("createManagedUser profile:", JSON.stringify(profileError));
    await supabase.auth.admin
      .deleteUser(created.user.id)
      .catch((e) =>
        console.error(
          "createManagedUser rollback failed (orphan auth user):",
          JSON.stringify(e),
        ),
      );
    await rollbackCreatedPartner(createdPartnerCode);
    return { ok: false, error: "Profile creation failed" };
  }
  return { ok: true, id: created.user.id };
}

export async function resetPasswordById(
  id: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be 8+ characters" };
  }
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    console.error("resetPasswordById:", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
