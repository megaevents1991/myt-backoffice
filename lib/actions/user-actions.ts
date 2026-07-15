"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import type { Role, UserProfile } from "@/types/auth.types";
import { ADMIN_ROLES, PARTNER_ROLES } from "@/types/auth.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

const PROFILE_COLUMNS =
  "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by";

/**
 * Hierarchy: superadmin manages everyone; admin manages only non-admin roles.
 * An admin can never create, modify, disable or reset an admin/superadmin account.
 */
function canManage(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "superadmin") return true;
  return !ADMIN_ROLES.includes(targetRole);
}

async function getTargetRole(id: string): Promise<Role | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getTargetRole:", JSON.stringify(error));
    return null;
  }
  return (data?.role as Role) ?? null;
}

export async function listUsers(): Promise<UserProfile[]> {
  await requireAdmin();
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(PROFILE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listUsers:", JSON.stringify(error));
    return [];
  }
  return (data as UserProfile[]) ?? [];
}

export async function createUser(input: {
  email: string;
  password: string;
  display_name: string;
  role: Role;
  partner_tracking_code?: string | null;
  phone?: string | null;
}): Promise<Result> {
  const actor = await requireAdmin();
  if (ADMIN_ROLES.includes(input.role) && actor.role !== "superadmin") {
    return { ok: false, error: "Only a superadmin can create admin users" };
  }

  const email = input.email?.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return { ok: false, error: "Email and a password of 8+ characters are required" };
  }
  if (PARTNER_ROLES.includes(input.role) && !input.partner_tracking_code) {
    return { ok: false, error: "Agent/affiliate users need a partner link" };
  }

  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  if (authError || !created.user) {
    console.error("createUser auth:", JSON.stringify(authError));
    return { ok: false, error: authError?.message ?? "Auth user creation failed" };
  }

  const { error: profileError } = await (supabase as any).from("user_profiles").insert({
    id: created.user.id,
    email,
    display_name: input.display_name || null,
    role: input.role,
    partner_tracking_code: input.partner_tracking_code || null,
    phone: input.phone || null,
    is_active: true,
    created_by: actor.sub,
  });
  if (profileError) {
    console.error("createUser profile:", JSON.stringify(profileError));
    // Roll back the orphan auth user so the email isn't locked.
    await supabase.auth.admin.deleteUser(created.user.id).catch((e) =>
      console.error("createUser rollback failed (orphan auth user):", JSON.stringify(e))
    );
    return { ok: false, error: "Profile creation failed" };
  }
  await logAudit({
    action: "user_created",
    entityType: "user",
    entityId: created.user.id,
    changes: {
      email,
      role: input.role,
      partner_tracking_code: input.partner_tracking_code || null,
      display_name: input.display_name || null,
    },
  });
  return { ok: true };
}

export async function updateUser(
  id: string,
  input: {
    display_name?: string | null;
    role?: Role;
    partner_tracking_code?: string | null;
    phone?: string | null;
    is_active?: boolean;
  }
): Promise<Result> {
  const actor = await requireAdmin();
  if (id === actor.sub && input.is_active === false) {
    return { ok: false, error: "You cannot disable your own account" };
  }
  if (id === actor.sub && input.role && input.role !== actor.role) {
    return { ok: false, error: "You cannot change your own role" };
  }

  const targetRole = await getTargetRole(id);
  if (!targetRole) {
    return { ok: false, error: "User not found" };
  }
  if (!canManage(actor.role, targetRole)) {
    return { ok: false, error: "Only a superadmin can modify admin users" };
  }
  if (input.role && ADMIN_ROLES.includes(input.role) && actor.role !== "superadmin") {
    return { ok: false, error: "Only a superadmin can grant admin roles" };
  }

  // Map columns explicitly — never spread client input.
  const update: Record<string, unknown> = {};
  if (input.display_name !== undefined) update.display_name = input.display_name;
  if (input.role !== undefined) update.role = input.role;
  if (input.partner_tracking_code !== undefined)
    update.partner_tracking_code = input.partner_tracking_code;
  if (input.phone !== undefined) update.phone = input.phone;
  if (input.is_active !== undefined) update.is_active = input.is_active;

  const before = await fetchBefore("user_profiles", "id", id, update);

  const { error } = await (supabase as any)
    .from("user_profiles")
    .update(update)
    .eq("id", id);
  if (error) {
    console.error("updateUser:", JSON.stringify(error));
    return { ok: false, error: "Update failed" };
  }
  await logAudit({
    action: input.is_active === false ? "user_disabled" : "user_updated",
    entityType: "user",
    entityId: id,
    changes: diffChanges(before, update),
  });
  return { ok: true };
}

export async function resetUserPassword(id: string, newPassword: string): Promise<Result> {
  const actor = await requireAdmin();
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be 8+ characters" };
  }
  const targetRole = await getTargetRole(id);
  if (!targetRole) {
    return { ok: false, error: "User not found" };
  }
  if (!canManage(actor.role, targetRole)) {
    return { ok: false, error: "Only a superadmin can reset an admin's password" };
  }
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    console.error("resetUserPassword:", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  await logAudit({ action: "password_reset", entityType: "user", entityId: id });
  return { ok: true };
}
