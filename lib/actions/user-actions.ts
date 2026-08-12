"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import type { Role, UserProfile } from "@/types/auth.types";
import { ADMIN_ROLES, PARTNER_ROLES } from "@/types/auth.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

const PROFILE_COLUMNS =
  "id,email,display_name,role,partner_tracking_code,logo_url,phone,contract_url,is_active,created_at,created_by";

const CONTRACTS_BUCKET = "user-contracts";
const CONTRACT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const CONTRACT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/**
 * Hierarchy: superadmin manages everyone; admin manages only non-admin roles.
 * An admin can never create, modify, disable or reset an admin/superadmin account.
 */
function canManage(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "superadmin") return true;
  return !ADMIN_ROLES.includes(targetRole);
}

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
    type: args.role,
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
}): Promise<CreateResult> {
  const actor = await requireAdmin();
  if (ADMIN_ROLES.includes(input.role) && actor.role !== "superadmin") {
    return { ok: false, error: "Only a superadmin can create admin users" };
  }

  const email = input.email?.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return {
      ok: false,
      error: "Email and a password of 8+ characters are required",
    };
  }
  if (PARTNER_ROLES.includes(input.role) && !input.partner_tracking_code) {
    return { ok: false, error: "Agent/affiliate users need a partner link" };
  }

  // An agent/affiliate login is meaningless without the partner row it points
  // at - the portal reads every figure from it, and the FK would reject the
  // profile anyway. Create it here so picking a brand-new code just works.
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
    console.error("createUser auth:", JSON.stringify(authError));
    await rollbackCreatedPartner(createdPartnerCode);
    return {
      ok: false,
      error: authError?.message ?? "Auth user creation failed",
    };
  }

  const { error: profileError } = await (supabase as any)
    .from("user_profiles")
    .insert({
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
    await supabase.auth.admin
      .deleteUser(created.user.id)
      .catch((e) =>
        console.error(
          "createUser rollback failed (orphan auth user):",
          JSON.stringify(e),
        ),
      );
    await rollbackCreatedPartner(createdPartnerCode);
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
  return { ok: true, id: created.user.id };
}

export async function updateUser(
  id: string,
  input: {
    display_name?: string | null;
    role?: Role;
    partner_tracking_code?: string | null;
    phone?: string | null;
    is_active?: boolean;
  },
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
  if (
    input.role &&
    ADMIN_ROLES.includes(input.role) &&
    actor.role !== "superadmin"
  ) {
    return { ok: false, error: "Only a superadmin can grant admin roles" };
  }

  // Map columns explicitly - never spread client input.
  const update: Record<string, unknown> = {};
  if (input.display_name !== undefined)
    update.display_name = input.display_name;
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

export async function resetUserPassword(
  id: string,
  newPassword: string,
): Promise<Result> {
  const actor = await requireAdmin();
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be 8+ characters" };
  }
  const targetRole = await getTargetRole(id);
  if (!targetRole) {
    return { ok: false, error: "User not found" };
  }
  if (!canManage(actor.role, targetRole)) {
    return {
      ok: false,
      error: "Only a superadmin can reset an admin's password",
    };
  }
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    console.error("resetUserPassword:", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  await logAudit({
    action: "password_reset",
    entityType: "user",
    entityId: id,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contract attachment (agent/affiliate). One file per user, PRIVATE bucket -
// contract_url stores the storage PATH; access only via short signed URLs.
// ---------------------------------------------------------------------------

async function getContractPath(id: string): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("contract_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getContractPath:", JSON.stringify(error));
    return null;
  }
  return (data?.contract_url as string) ?? null;
}

export async function uploadUserContract(
  id: string,
  formData: FormData,
): Promise<Result> {
  const actor = await requireAdmin();
  const targetRole = await getTargetRole(id);
  if (!targetRole) return { ok: false, error: "User not found" };
  if (!canManage(actor.role, targetRole)) {
    return { ok: false, error: "Only a superadmin can modify admin users" };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0)
    return { ok: false, error: "Contract file is required" };
  if (file.size > CONTRACT_MAX_BYTES)
    return { ok: false, error: "File too large (max 10MB)" };
  const ext = CONTRACT_TYPES[file.type];
  if (!ext)
    return {
      ok: false,
      error: "Only PDF, DOC, DOCX, PNG or JPG files are allowed",
    };

  const previous = await getContractPath(id);
  const path = `${id}/contract-${Date.now()}.${ext}`;
  const buffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("uploadUserContract storage:", JSON.stringify(uploadError));
    return { ok: false, error: "Contract upload failed" };
  }

  const { error } = await (supabase as any)
    .from("user_profiles")
    .update({ contract_url: path })
    .eq("id", id);
  if (error) {
    console.error("uploadUserContract profile:", JSON.stringify(error));
    // Roll the orphan file back so the bucket doesn't collect strays.
    await supabase.storage.from(CONTRACTS_BUCKET).remove([path]);
    return { ok: false, error: "Saving contract reference failed" };
  }

  // Replaced an older contract - best-effort cleanup, the row is source of truth.
  if (previous && previous !== path) {
    const { error: rmError } = await supabase.storage
      .from(CONTRACTS_BUCKET)
      .remove([previous]);
    if (rmError)
      console.error("uploadUserContract cleanup:", JSON.stringify(rmError));
  }

  await logAudit({
    action: "user_updated",
    entityType: "user",
    entityId: id,
    changes: { contract_url: path },
  });
  return { ok: true };
}

export async function getContractDownloadUrl(
  id: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireAdmin();
  const path = await getContractPath(id);
  if (!path) return { ok: false, error: "No contract on file" };
  const { data, error } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .createSignedUrl(path, 60);
  if (error || !data?.signedUrl) {
    console.error("getContractDownloadUrl:", JSON.stringify(error));
    return { ok: false, error: "Could not create download link" };
  }
  return { ok: true, url: data.signedUrl };
}

export async function removeUserContract(id: string): Promise<Result> {
  const actor = await requireAdmin();
  const targetRole = await getTargetRole(id);
  if (!targetRole) return { ok: false, error: "User not found" };
  if (!canManage(actor.role, targetRole)) {
    return { ok: false, error: "Only a superadmin can modify admin users" };
  }
  const path = await getContractPath(id);
  if (!path) return { ok: true };

  const { error } = await (supabase as any)
    .from("user_profiles")
    .update({ contract_url: null })
    .eq("id", id);
  if (error) {
    console.error("removeUserContract:", JSON.stringify(error));
    return { ok: false, error: "Removing contract failed" };
  }
  const { error: rmError } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .remove([path]);
  if (rmError)
    console.error("removeUserContract storage:", JSON.stringify(rmError));

  await logAudit({
    action: "user_updated",
    entityType: "user",
    entityId: id,
    changes: { contract_url: null },
  });
  return { ok: true };
}
