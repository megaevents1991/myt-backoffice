"use server";

import { getSession, requireAdmin } from "@/lib/auth/guards";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import type {
  Role,
  UserListItem,
  UserMembership,
  UserProfile,
} from "@/types/auth.types";
import {
  ADMIN_ROLES,
  COMPANY_MEMBER_ROLES,
  PARTNER_ROLES,
  ROLE_LABELS,
  TOURS_AGENT_ROLE,
} from "@/types/auth.types";
import { logAudit, diffChanges, fetchBefore } from "@/lib/audit";
import { createManagedUser, resetPasswordById } from "@/lib/auth/user-create";
import { generateAgentSlug } from "@/lib/portal-attribution";
import type { SessionPayload } from "@/lib/auth/session";
import { getActiveCompany, requireCompany, type Company } from "@/lib/company";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { isManagerRole } from "@/components/tours/flights/block-rules";
import { companyAudit } from "@/lib/tours/company-kit";

type Result = { ok: true } | { ok: false; error: string };
/** `note`: company scope only - what happened when the email already had an account. */
type CreateResult =
  | { ok: true; id: string; note?: string }
  | { ok: false; error: string };

const PROFILE_COLUMNS =
  "id,email,display_name,role,partner_tracking_code,agent_slug,logo_url,phone,contract_url,is_active,created_at,created_by";

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
 * Hierarchy: superadmin manages everyone; admin manages only editor/agent/
 * affiliate and the other non-staff roles (forms_operator, tours_agent).
 * Admins can never touch admin, superadmin or office_manager accounts -
 * appointing/managing office managers is a superadmin call (Dor).
 */
function canManage(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "superadmin") return true;
  return !ADMIN_ROLES.includes(targetRole) && targetRole !== "office_manager";
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

/** The target's current slug, for the role-change backfill in updateUser. */
async function getTargetAgentSlug(id: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("agent_slug")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getTargetAgentSlug:", JSON.stringify(error));
    return null;
  }
  return (data?.agent_slug as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Scope. The active company decides what this screen manages:
//  - Mega Events, and any doubt about the company: the original screen -
//    every account, behind requireAdmin, exactly as before companies;
//  - any other company (Mega Family): the people of THAT company, for its
//    managers (a company admin or a superadmin) - "Company scope" below.
// ---------------------------------------------------------------------------

type CompanyScope = {
  kind: "company";
  actor: SessionPayload;
  company: Company;
};
type Scope = { kind: "events"; actor: SessionPayload } | CompanyScope;

async function resolveScope(): Promise<Scope> {
  const session = await getSession();
  // The companies of anyone but a superadmin are their memberships, read here
  // and failing CLOSED: getActiveCompany falls back to Mega Events when its
  // own read fails, and requireAdmin's company gate opens on a failed read -
  // together they would hand a company-only admin every account.
  let memberOf: string[] | null = null;
  if (session && session.role !== "superadmin") {
    const { data, error } = await supabaseTyped
      .from("company_members")
      .select("company_id")
      .eq("user_id", session.sub);
    if (error) {
      console.error("resolveScope memberships:", JSON.stringify(error));
      throw new Error("Unauthorized");
    }
    memberOf = (data ?? []).map((m) => m.company_id);
  }
  // getActiveCompany answers Mega Events on any doubt. It throws only for a
  // tours_agent with no company - a role requireAdmin refuses anyway.
  const active = await getActiveCompany(session).catch(() => null);
  // An active company the memberships do not back means getActiveCompany fell
  // back on a failed read of its own: refuse rather than guess.
  if (
    memberOf &&
    memberOf.length > 0 &&
    (!active || !memberOf.includes(active.id))
  ) {
    throw new Error("Unauthorized");
  }
  if (!active || active.id === MEGA_EVENTS_COMPANY_ID) {
    return { kind: "events", actor: await requireAdmin() };
  }
  const { session: actor, company } = await requireCompany();
  // A second read that disagrees must never run the company code elsewhere.
  if (company.id !== active.id) throw new Error("Unauthorized");
  if (!isManagerRole(actor.role)) throw new Error("Unauthorized");
  return { kind: "company", actor, company };
}

/** Which Users screen the caller gets - read by app/(dashboard)/users/page.tsx. */
export async function getUsersScope(): Promise<
  { scope: "events" } | { scope: "company"; companyName: string }
> {
  const scope = await resolveScope();
  return scope.kind === "company"
    ? { scope: "company", companyName: scope.company.name }
    : { scope: "events" };
}

export async function listUsers(): Promise<UserListItem[]> {
  const scope = await resolveScope();
  if (scope.kind === "company") return listCompanyUsers(scope);
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
  const scope = await resolveScope();
  if (scope.kind === "company") return createCompanyUser(scope, input);
  const actor = scope.actor;
  if (
    (ADMIN_ROLES.includes(input.role) || input.role === "office_manager") &&
    actor.role !== "superadmin"
  ) {
    return {
      ok: false,
      error: "Only a superadmin can create admin or office-manager users",
    };
  }

  const created = await createManagedUser({
    email: input.email,
    password: input.password,
    display_name: input.display_name,
    role: input.role,
    // A tours_agent is not a Mega Events partner: it never carries a partner link.
    partner_tracking_code:
      input.role === TOURS_AGENT_ROLE ? null : (input.partner_tracking_code ?? null),
    phone: input.phone ?? null,
    created_by: actor.sub,
  });
  if (!created.ok) return created;
  await logAudit({
    action: "user_created",
    entityType: "user",
    entityId: created.id,
    changes: {
      email: input.email?.trim().toLowerCase(),
      role: input.role,
      partner_tracking_code: input.partner_tracking_code || null,
      display_name: input.display_name || null,
    },
  });
  return { ok: true, id: created.id };
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
  const scope = await resolveScope();
  if (scope.kind === "company") return updateCompanyUser(scope, id, input);
  const actor = scope.actor;
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
    (ADMIN_ROLES.includes(input.role) || input.role === "office_manager") &&
    actor.role !== "superadmin"
  ) {
    return {
      ok: false,
      error: "Only a superadmin can grant admin or office-manager roles",
    };
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
  // A tours_agent is not a Mega Events partner: saving one drops any partner link.
  if (
    (input.role ?? targetRole) === TOURS_AGENT_ROLE &&
    (input.role !== undefined || input.partner_tracking_code !== undefined)
  ) {
    update.partner_tracking_code = null;
  }

  // A role change INTO a partner role must leave the user with a slug, or
  // their links carry no utm_content and every sale lands unattributed.
  // Never touch an existing non-null slug - old links must keep attributing.
  if (input.role !== undefined && PARTNER_ROLES.includes(input.role)) {
    const currentSlug = await getTargetAgentSlug(id);
    if (!currentSlug) {
      update.agent_slug = generateAgentSlug();
    }
  }

  const before = await fetchBefore("user_profiles", "id", id, update);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { error } = await (supabase as any)
    .from("user_profiles")
    .update(update)
    .eq("id", id);
  if (error?.code === "23505" && update.agent_slug !== undefined) {
    // agent_slug unique-index collision (astronomically rare) - one retry,
    // mirroring createManagedUser's retry.
    update.agent_slug = generateAgentSlug();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ error } = await (supabase as any)
      .from("user_profiles")
      .update(update)
      .eq("id", id));
  }
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
  const scope = await resolveScope();
  if (scope.kind === "company") {
    return resetCompanyUserPassword(scope, id, newPassword);
  }
  const actor = scope.actor;
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
  const result = await resetPasswordById(id, newPassword);
  if (!result.ok) return result;
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

// ---------------------------------------------------------------------------
// Company scope: the people of the active company (public.company_members),
// for every company but Mega Events. What a membership means (lib/company.ts,
// worksInMegaEvents in lib/auth/guards.ts):
//  - a staff account with NO membership is a Mega Events account;
//  - an account with memberships works in exactly those companies;
//  - a tours_agent works only where it is assigned (no Mega Events floor).
// The account role (user_profiles.role) is global - it is what the session
// carries. The membership role is the person's role in this company; the two
// are kept equal for a person who works in this company only. So:
//  - "only here" (this company is their only membership, not a superadmin):
//    managed fully here - name, phone, role, password, active;
//  - a person who also works in another company, or a superadmin: changed only
//    by a superadmin, and then only their role HERE (the account role is
//    shared with the other companies); never switched off here - removed from
//    the company instead;
//  - admins (by account or by role here) and the admin role: superadmin only,
//    the same hierarchy as canManage;
//  - a tours_agent becomes staff (or staff a tours_agent) by a superadmin only;
//  - a new account gets a membership of this company only, never Mega Events,
//    and is switched on only once that membership exists;
//  - no partner link and no contract: those are Mega Events features (the
//    contract actions stay behind requireAdmin).
// ---------------------------------------------------------------------------

const NOT_A_MEMBER = "This user is not a member of this company";
const NOT_A_COMPANY_ROLE =
  "In a company a user is an admin, an editor or a tours agent";
/** The one answer to every refused "add an existing account" - it tells nothing about that account. */
const CANNOT_ADD = "This email can't be added to the company - ask a superadmin";
const NOT_ACROSS_AGENT_LINE =
  "Only a superadmin can turn a tours agent into staff, or staff into a tours agent";
/** No "*" either: PostgREST reads it as a wildcard in the ilike lookup. */
const EMAIL_PATTERN = /^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/;
/** What the company table and its edit form show - no partner link, contract, slug or creator. */
const MEMBER_COLUMNS = "id,email,display_name,role,phone,is_active,created_at";

const isToursAgentRole = (role: Role) => role === TOURS_AGENT_ROLE;

type Member = {
  profile: UserProfile;
  /** company_members.role in the active company. */
  role: Role;
  /** Every company the person is a member of. */
  companyIds: string[];
};

/** A role in a sentence: "editor", "tours agent". */
const roleWord = (role: Role) => ROLE_LABELS[role]?.en.toLowerCase() ?? role;

const memberName = (profile: UserProfile) =>
  profile.display_name || profile.email;

/** True when the active company is the person's only company (never for a superadmin). */
function onlyHere(
  accountRole: Role,
  companyIds: string[],
  company: Company,
): boolean {
  return (
    accountRole !== "superadmin" &&
    companyIds.length === 1 &&
    companyIds[0] === company.id
  );
}

/** Why a person is not managed fully here, for the error messages. */
const worksElsewhere = (member: Member) =>
  member.profile.role === "superadmin"
    ? "is a superadmin"
    : "also works in another company";

/** canManage, on both the account role and the role in this company. */
function canManageMember(actor: SessionPayload, member: Member): boolean {
  return (
    canManage(actor.role, member.profile.role) &&
    canManage(actor.role, member.role)
  );
}

/** A member of the active company with all their memberships; null when not a member or the read failed. */
async function loadMember(
  company: Company,
  userId: string,
): Promise<Member | null> {
  const [profileRead, membershipsRead] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("user_profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle(),
    supabaseTyped
      .from("company_members")
      .select("company_id, role")
      .eq("user_id", userId),
  ]);
  const error = profileRead.error ?? membershipsRead.error;
  if (error) {
    console.error("loadMember:", JSON.stringify(error));
    return null;
  }
  const memberships = membershipsRead.data ?? [];
  const here = memberships.find((m) => m.company_id === company.id);
  if (!profileRead.data || !here) return null;
  return {
    profile: profileRead.data as UserProfile,
    role: here.role as Role,
    companyIds: memberships.map((m) => m.company_id),
  };
}

/** The members of the active company, each with its role here. Superadmins are not members. */
async function listCompanyUsers({
  company,
}: CompanyScope): Promise<UserListItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("company_members")
    .select(`role, user_profiles!inner(${MEMBER_COLUMNS})`)
    .eq("company_id", company.id);
  if (error) {
    console.error("listUsers (company):", JSON.stringify(error));
    return [];
  }
  const rows = (data ?? []) as {
    role: Role;
    user_profiles: Pick<
      UserProfile,
      "id" | "email" | "display_name" | "role" | "phone" | "is_active" | "created_at"
    >;
  }[];
  if (rows.length === 0) return [];

  // Where else each member works. A failed read leaves everyone "working
  // elsewhere too" - the stricter answer (fewer actions offered).
  const { data: all, error: allError } = await supabaseTyped
    .from("company_members")
    .select("user_id, company_id")
    .in(
      "user_id",
      rows.map((r) => r.user_profiles.id),
    );
  if (allError) {
    console.error("listUsers (company memberships):", JSON.stringify(allError));
  }
  const companiesOf = new Map<string, string[]>();
  for (const m of allError ? [] : (all ?? [])) {
    companiesOf.set(m.user_id, [
      ...(companiesOf.get(m.user_id) ?? []),
      m.company_id,
    ]);
  }

  return rows
    .map((r): UserListItem => {
      const profile = r.user_profiles;
      const membership: UserMembership = {
        role: r.role,
        onlyHere: onlyHere(
          profile.role,
          companiesOf.get(profile.id) ?? [],
          company,
        ),
      };
      return {
        ...profile,
        // Mega Events fields - never sent to a company screen.
        partner_tracking_code: null,
        agent_slug: null,
        logo_url: null,
        contract_url: null,
        created_by: null,
        membership,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function createCompanyUser(
  scope: CompanyScope,
  input: {
    email: string;
    password: string;
    display_name: string;
    role: Role;
    phone?: string | null;
  },
): Promise<CreateResult> {
  const { actor, company } = scope;
  if (!COMPANY_MEMBER_ROLES.includes(input.role)) {
    return { ok: false, error: NOT_A_COMPANY_ROLE };
  }
  if (input.role === "admin" && actor.role !== "superadmin") {
    return { ok: false, error: "Only a superadmin can add a company admin" };
  }
  const email = input.email?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Invalid email address" };
  }

  // One account per email: an existing one is added to the company instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: lookupError } = await (supabase as any)
    .from("user_profiles")
    .select(PROFILE_COLUMNS)
    // ilike for older mixed-case rows; its wildcards (_ and %) are escaped.
    .ilike("email", email.replace(/[\\%_]/g, (c: string) => `\\${c}`))
    .maybeSingle();
  if (lookupError) {
    console.error("createUser (company) lookup:", JSON.stringify(lookupError));
    return {
      ok: false,
      error: "Could not check whether this email already has an account",
    };
  }
  if (existing) {
    // The lookup is a pattern match: only the very email typed counts.
    if (String(existing.email ?? "").trim().toLowerCase() !== email) {
      return { ok: false, error: CANNOT_ADD };
    }
    return addExistingAccount(scope, existing as UserProfile, input.role);
  }

  // Created switched off and switched on only once it belongs to this
  // company: a staff account with no membership counts as a Mega Events
  // account (lib/company.ts), and must never be active for a moment.
  const created = await createManagedUser({
    email,
    password: input.password,
    display_name: input.display_name,
    role: input.role,
    // A company account is never a Mega Events partner.
    partner_tracking_code: null,
    phone: input.phone ?? null,
    created_by: actor.sub,
    isActive: false,
  });
  if (!created.ok) return created;

  const audit = {
    action: "user_created",
    entityType: "user",
    entityId: created.id,
    changes: {
      email,
      role: input.role,
      display_name: input.display_name || null,
    },
  };
  const { error: memberError } = await supabaseTyped
    .from("company_members")
    .insert({ user_id: created.id, company_id: company.id, role: input.role });
  if (memberError) {
    console.error(
      "createUser (company) membership:",
      JSON.stringify(memberError),
    );
    // The account was created switched off and stays so (never deleted).
    await logAudit({
      ...audit,
      metadata: {
        ...companyAudit(company),
        membership_failed: true,
        is_active: false,
      },
    });
    return {
      ok: false,
      error:
        "The account was created but could not be added to the company, so it stays switched off. Contact support to finish the setup.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: onError } = await (supabase as any)
    .from("user_profiles")
    .update({ is_active: true })
    .eq("id", created.id);
  if (onError) {
    console.error("createUser (company) switch on:", JSON.stringify(onError));
  }
  await logAudit({
    ...audit,
    metadata: {
      ...companyAudit(company),
      company_role: input.role,
      is_active: !onError,
    },
  });
  if (onError) {
    // It belongs to the company, so a company admin can switch it on.
    return {
      ok: true,
      id: created.id,
      note: `${email} was created and added to ${company.name}, but the account could not be switched on. Turn on its Active switch in the list.`,
    };
  }
  return { ok: true, id: created.id };
}

/**
 * The email already has an account: add it to the active company - no second
 * account. Rules of the old Settings > Members screen: no superadmin (they see
 * every company), only admin / editor / tours_agent accounts, active ones,
 * not twice. An account has ONE role in every company, so a different role
 * here is a superadmin's call. A staff account nobody assigned yet works in
 * Mega Events today, and being added here does not take that away: it keeps a
 * Mega Events membership with its own role. A tours_agent never gets one.
 * A company admin gets one answer for every refusal (CANNOT_ADD), so it
 * learns nothing about another company's account; a superadmin gets the reason.
 */
async function addExistingAccount(
  { actor, company }: CompanyScope,
  profile: UserProfile,
  role: Role,
): Promise<CreateResult> {
  const refuse = (reason: string): CreateResult => ({
    ok: false,
    error: actor.role === "superadmin" ? reason : CANNOT_ADD,
  });

  const { data: memberships, error: readError } = await supabaseTyped
    .from("company_members")
    .select("company_id")
    .eq("user_id", profile.id);
  if (readError) {
    console.error(
      "createUser (company) memberships:",
      JSON.stringify(readError),
    );
    return { ok: false, error: "Adding the user to the company failed" };
  }
  const companyIds = (memberships ?? []).map((m) => m.company_id);
  const name = memberName(profile);
  if (companyIds.includes(company.id)) {
    return { ok: false, error: `${name} is already a member of this company.` };
  }

  if (profile.role === "superadmin") {
    return refuse(
      "This email belongs to a superadmin, who sees every company - there is no need to add them.",
    );
  }
  if (!COMPANY_MEMBER_ROLES.includes(profile.role)) {
    return refuse(
      `This account (${profile.role}) cannot work in a company. Only admins, editors and tours agents can be added.`,
    );
  }
  if (!canManage(actor.role, profile.role)) return refuse(CANNOT_ADD);
  if (!profile.is_active) {
    return refuse("This account is switched off. Switch it on before adding it.");
  }
  if (role !== profile.role && actor.role !== "superadmin") {
    return refuse(CANNOT_ADD);
  }

  const isToursAgent = profile.role === TOURS_AGENT_ROLE;
  const keepsEvents = !isToursAgent && companyIds.length === 0;
  const rows = [{ user_id: profile.id, company_id: company.id, role }];
  if (keepsEvents) {
    rows.push({
      user_id: profile.id,
      company_id: MEGA_EVENTS_COMPANY_ID,
      role: profile.role,
    });
  }
  const { error: insertError } = await supabaseTyped
    .from("company_members")
    .insert(rows);
  if (insertError) {
    console.error("createUser (company) add:", JSON.stringify(insertError));
    return { ok: false, error: "Adding the user to the company failed" };
  }

  const note = [
    `${profile.email} already had an account, so no new one was created: ${name} was added to ${company.name} as ${roleWord(role)}.`,
    role !== profile.role
      ? `The account role stays ${roleWord(profile.role)}.`
      : "",
    keepsEvents
      ? "They keep their Mega Events access."
      : companyIds.length > 0
        ? "Their other companies do not change."
        : "",
  ]
    .filter(Boolean)
    .join(" ");

  await logAudit({
    action: "create",
    entityType: "company_member",
    entityId: profile.id,
    changes: {
      companies: {
        from:
          companyIds.length > 0
            ? companyIds
            : isToursAgent
              ? []
              : ["mega-events (default)"],
        to: [...companyIds, ...rows.map((r) => r.company_id)],
      },
    },
    metadata: {
      ...companyAudit(company),
      email: profile.email,
      role,
      account_role: profile.role,
      kept_mega_events: keepsEvents,
    },
  });
  return { ok: true, id: profile.id, note };
}

async function updateCompanyUser(
  { actor, company }: CompanyScope,
  id: string,
  input: {
    display_name?: string | null;
    role?: Role;
    phone?: string | null;
    is_active?: boolean;
  },
): Promise<Result> {
  if (id === actor.sub && input.is_active === false) {
    return { ok: false, error: "You cannot disable your own account" };
  }
  const member = await loadMember(company, id);
  if (!member) return { ok: false, error: NOT_A_MEMBER };
  if (id === actor.sub && input.role && input.role !== member.role) {
    return { ok: false, error: "You cannot change your own role" };
  }

  // The edit form sends every field: act on what actually changes. Columns
  // are mapped explicitly - never spread client input (no partner link here).
  const update: Record<string, unknown> = {};
  if (
    input.display_name !== undefined &&
    input.display_name !== member.profile.display_name
  )
    update.display_name = input.display_name;
  if (input.phone !== undefined && input.phone !== member.profile.phone)
    update.phone = input.phone;
  if (
    input.is_active !== undefined &&
    input.is_active !== member.profile.is_active
  )
    update.is_active = input.is_active;
  const newRole =
    input.role !== undefined && input.role !== member.role ? input.role : null;
  if (!newRole && Object.keys(update).length === 0) return { ok: true };

  const name = memberName(member.profile);
  const here = onlyHere(member.profile.role, member.companyIds, company);
  if (!canManageMember(actor, member)) {
    return { ok: false, error: "Only a superadmin can modify admin users" };
  }
  if (newRole && !COMPANY_MEMBER_ROLES.includes(newRole)) {
    return { ok: false, error: NOT_A_COMPANY_ROLE };
  }
  if (newRole === "admin" && actor.role !== "superadmin") {
    return {
      ok: false,
      error: "Only a superadmin can make someone a company admin",
    };
  }
  // A tours_agent with no company works nowhere; staff with no company is
  // Mega Events staff. Crossing that line, either way, is a superadmin's call -
  // a company admin could otherwise race a removal and mint Mega Events staff.
  if (
    newRole &&
    actor.role !== "superadmin" &&
    (isToursAgentRole(newRole) !== isToursAgentRole(member.role) ||
      isToursAgentRole(newRole) !== isToursAgentRole(member.profile.role))
  ) {
    return { ok: false, error: NOT_ACROSS_AGENT_LINE };
  }
  if (update.is_active !== undefined && !here) {
    return {
      ok: false,
      error: `${name} ${worksElsewhere(member)}, so the account is not switched on or off here. To take them out of this company, use "Remove from company".`,
    };
  }
  if (!here && actor.role !== "superadmin") {
    return {
      ok: false,
      error: `${name} ${worksElsewhere(member)}, so only a superadmin can change them.`,
    };
  }

  // The account role follows the role here only for a person who works here
  // only; anyone else shares their account role with their other companies.
  if (newRole && here) {
    update.role = newRole;
    // A tours_agent is not a Mega Events partner: saving one drops any partner link.
    if (newRole === TOURS_AGENT_ROLE) update.partner_tracking_code = null;
  }

  const before = await fetchBefore("user_profiles", "id", id, update);
  const setRoleHere = (role: Role) =>
    supabaseTyped
      .from("company_members")
      .update({ role })
      .eq("user_id", id)
      .eq("company_id", company.id);

  if (newRole) {
    const { error } = await setRoleHere(newRole);
    if (error) {
      console.error("updateUser (company) membership:", JSON.stringify(error));
      return { ok: false, error: "Update failed" };
    }
  }
  if (Object.keys(update).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_profiles")
      .update(update)
      .eq("id", id);
    if (error) {
      console.error("updateUser (company):", JSON.stringify(error));
      // Put the role here back, so the two roles do not drift apart.
      if (newRole) {
        const { error: undoError } = await setRoleHere(member.role);
        if (undoError) {
          console.error(
            "updateUser (company) membership undo:",
            JSON.stringify(undoError),
          );
        }
      }
      return { ok: false, error: "Update failed" };
    }
  }

  await logAudit({
    action: update.is_active === false ? "user_disabled" : "user_updated",
    entityType: "user",
    entityId: id,
    changes: {
      ...diffChanges(before, update),
      ...(newRole ? { company_role: { from: member.role, to: newRole } } : {}),
    },
    metadata: companyAudit(company),
  });
  return { ok: true };
}

async function resetCompanyUserPassword(
  { actor, company }: CompanyScope,
  id: string,
  newPassword: string,
): Promise<Result> {
  const member = await loadMember(company, id);
  if (!member) return { ok: false, error: NOT_A_MEMBER };
  if (!canManageMember(actor, member)) {
    return {
      ok: false,
      error: "Only a superadmin can reset an admin's password",
    };
  }
  if (
    !onlyHere(member.profile.role, member.companyIds, company) &&
    actor.role !== "superadmin"
  ) {
    return {
      ok: false,
      error: `${memberName(member.profile)} ${worksElsewhere(member)}, so only a superadmin can reset their password.`,
    };
  }
  const result = await resetPasswordById(id, newPassword);
  if (!result.ok) return result;
  await logAudit({
    action: "password_reset",
    entityType: "user",
    entityId: id,
    metadata: companyAudit(company),
  });
  return { ok: true };
}

/**
 * Takes a person out of the active company (company scope only). The rule of
 * the old Settings > Members screen: never yourself, and never the last
 * membership of a staff account - with no company it would count as a Mega
 * Events account. A tours_agent has no such default (with no membership it
 * works nowhere), so its last membership may go. Admins: superadmin only.
 */
export async function removeFromCompany(userId: string): Promise<Result> {
  const scope = await resolveScope();
  if (scope.kind !== "company") {
    return {
      ok: false,
      error:
        "Mega Events has no company members to remove. Switch to the company first.",
    };
  }
  const { actor, company } = scope;
  if (userId === actor.sub) {
    return { ok: false, error: "You cannot remove yourself from the company" };
  }
  const member = await loadMember(company, userId);
  if (!member) return { ok: false, error: NOT_A_MEMBER };
  if (!canManageMember(actor, member)) {
    return {
      ok: false,
      error: "Only a superadmin can remove an admin from the company",
    };
  }
  if (
    member.companyIds.length === 1 &&
    member.profile.role !== TOURS_AGENT_ROLE
  ) {
    return {
      ok: false,
      error:
        "This is the user's only company. A user with no company counts as a Mega Events user, so the last membership is not removed. To block the user, switch off their account (the Active switch) instead.",
    };
  }

  const { error } = await supabaseTyped
    .from("company_members")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", company.id);
  if (error) {
    console.error("removeFromCompany:", JSON.stringify(error));
    return { ok: false, error: "Removing the user from the company failed" };
  }

  // Defence in depth: a role change racing this removal could leave a staff
  // account with no company - a Mega Events account. Re-read; if that is what
  // is left (or the read fails), the membership goes back.
  const [after, left] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("user_profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle(),
    supabaseTyped
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId),
  ]);
  if (
    after.error ||
    left.error ||
    (after.data?.role !== TOURS_AGENT_ROLE && (left.data ?? []).length === 0)
  ) {
    console.error(
      "removeFromCompany: unsafe result, restoring the membership:",
      JSON.stringify({ role: after.data?.role, error: after.error ?? left.error }),
    );
    const { error: restoreError } = await supabaseTyped
      .from("company_members")
      .insert({ user_id: userId, company_id: company.id, role: member.role });
    if (!restoreError) {
      return {
        ok: false,
        error: "The user was not removed: their account changed meanwhile. Reload the page and try again.",
      };
    }
    console.error("removeFromCompany restore:", JSON.stringify(restoreError));
    // Last resort: a staff account with no company must not stay active.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: offError } = await (supabase as any)
      .from("user_profiles")
      .update({ is_active: false })
      .eq("id", userId);
    if (offError) {
      console.error("removeFromCompany switch off:", JSON.stringify(offError));
    }
    await logAudit({
      action: "delete",
      entityType: "company_member",
      entityId: userId,
      changes: { companies: { from: member.companyIds, to: [] } },
      metadata: {
        ...companyAudit(company),
        restore_failed: true,
        switched_off: !offError,
      },
    });
    return {
      ok: false,
      error: offError
        ? "The user was removed, but their account changed meanwhile and could not be put back or switched off. Contact support now."
        : "The user was removed, but their account changed meanwhile and could not be put back, so it was switched off. Contact support.",
    };
  }

  await logAudit({
    action: "delete",
    entityType: "company_member",
    entityId: userId,
    changes: {
      companies: {
        from: member.companyIds,
        to: member.companyIds.filter((c) => c !== company.id),
      },
    },
    metadata: companyAudit(company),
  });
  return { ok: true };
}
