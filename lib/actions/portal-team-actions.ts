"use server";

/**
 * Office-manager self-service team management (/portal/team).
 *
 * Hard rules, all server-enforced: the manager touches ONLY users of their own
 * partner_tracking_code; may CREATE only role='agent' (never managers/staff -
 * appointing managers is superadmin-only in /users); may reset/disable only
 * role='agent' targets. Everything is audited.
 */

import { requireOfficeManager } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { createManagedUser, resetPasswordById } from "@/lib/auth/user-create";
import { getOfficeUsers, type OfficeUser } from "@/lib/portal-attribution";
import { logAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The target row a manager may mutate: an AGENT of the manager's own office.
 * Fetched fresh per mutation - never trust a client-sent id.
 */
async function getManagedAgent(
  id: string,
  partnerCode: string,
): Promise<
  | { ok: true; user: { id: string; email: string; role: string } }
  | { ok: false; error: string }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("id,email,role,partner_tracking_code")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getManagedAgent:", JSON.stringify(error));
    return { ok: false, error: "טעינת המשתמש נכשלה" };
  }
  if (
    !data ||
    data.partner_tracking_code !== partnerCode ||
    data.role !== "agent"
  ) {
    // Same message for "not found", "other office" and "not an agent" -
    // don't confirm foreign ids exist.
    return { ok: false, error: "המשתמש לא נמצא במשרד שלך" };
  }
  return { ok: true, user: { id: data.id, email: data.email, role: data.role } };
}

export async function listOfficeUsers(): Promise<OfficeUser[]> {
  const session = await requireOfficeManager();
  return (await getOfficeUsers(session.partner_code)) ?? [];
}

export async function createOfficeAgent(input: {
  email: string;
  password: string;
  display_name: string;
  phone?: string | null;
}): Promise<CreateResult> {
  const session = await requireOfficeManager();
  const created = await createManagedUser({
    email: input.email,
    password: input.password,
    display_name: input.display_name,
    // Both FORCED - a manager creates agents of their own office, nothing else.
    role: "agent",
    partner_tracking_code: session.partner_code,
    phone: input.phone ?? null,
    created_by: session.sub,
  });
  if (!created.ok) return created;
  await logAudit({
    action: "user_created",
    entityType: "user",
    entityId: created.id,
    changes: {
      email: input.email?.trim().toLowerCase(),
      role: "agent",
      partner_tracking_code: session.partner_code,
      display_name: input.display_name || null,
    },
    metadata: { via: "portal_team" },
  });
  return created;
}

export async function resetOfficeAgentPassword(
  id: string,
  newPassword: string,
): Promise<Result> {
  const session = await requireOfficeManager();
  const target = await getManagedAgent(id, session.partner_code);
  if (!target.ok) return target;
  const result = await resetPasswordById(id, newPassword);
  if (!result.ok) return result;
  await logAudit({
    action: "password_reset",
    entityType: "user",
    entityId: id,
    metadata: { via: "portal_team" },
  });
  return { ok: true };
}

export async function setOfficeAgentActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const session = await requireOfficeManager();
  if (id === session.sub) {
    return { ok: false, error: "אי אפשר להשבית את החשבון של עצמך" };
  }
  const target = await getManagedAgent(id, session.partner_code);
  if (!target.ok) return target;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_profiles")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) {
    console.error("setOfficeAgentActive:", JSON.stringify(error));
    return { ok: false, error: "העדכון נכשל" };
  }
  await logAudit({
    action: isActive ? "user_updated" : "user_disabled",
    entityType: "user",
    entityId: id,
    changes: { is_active: isActive },
    metadata: { via: "portal_team" },
  });
  return { ok: true };
}
