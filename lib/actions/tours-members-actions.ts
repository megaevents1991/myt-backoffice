"use server";

/**
 * Who works in the active tours company: public.company_members.
 *
 * Membership is what decides where a staff account works (lib/company.ts and
 * worksInMegaEvents in lib/auth/guards.ts):
 *  - an account with no membership at all is a Mega Events account;
 *  - an account with memberships works in exactly those companies.
 * So adding an unassigned account here MOVES it out of Mega Events unless the
 * caller asks to keep it there, and the last membership of an account is never
 * removed here - that would silently turn it into a Mega Events account.
 *
 * A sales agent of the company (role tours_agent) is assigned here too, and the
 * rules above do not apply to it: that role has no Mega Events floor
 * (lib/company.ts). It never gets a Mega Events row - "keep Mega Events" is
 * ignored for it - and its last membership may be removed: it then works
 * nowhere until it is assigned again.
 *
 * Company admins and superadmins only. The account itself (name, password,
 * role, active) is managed in the Users screen; this file only assigns it.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { TOURS_AGENT_ROLE } from "@/types/auth.types";
import type { SessionPayload } from "@/lib/auth/session";
import type { ActionResult, CompanyMemberRow } from "@/components/tours/content/shared";
import { actionFail } from "@/lib/tours/action-kit";

const failure = (e: unknown, fallback: string) => actionFail(e, "tours-members-actions", fallback);

const ASSIGNABLE_ROLES = ["admin", "editor", TOURS_AGENT_ROLE];

const NOT_ADMIN = { success: false as const, error: "Only company admins can manage members" };
const isAdmin = (session: SessionPayload): boolean => session.role === "superadmin" || session.role === "admin";

async function membersOf(company: Company): Promise<CompanyMemberRow[]> {
  const { data, error } = await supabaseTyped
    .from("company_members")
    .select("user_id, role, user_profiles!inner(email, display_name, is_active)")
    .eq("company_id", company.id);
  if (error) throw error;
  return (data ?? [])
    .map((m) => {
      const profile = m.user_profiles as unknown as { email: string; display_name: string | null; is_active: boolean };
      return {
        userId: m.user_id,
        name: profile.display_name || profile.email,
        email: profile.email,
        role: m.role,
        isActive: profile.is_active,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export interface AddMemberResult {
  members: CompanyMemberRow[];
  /** What the change means for the account, in Hebrew, for the toast. */
  note: string;
}

/**
 * Adds an existing staff account, or a tours_agent, to the active company, by
 * its email. `keepMegaEvents` matters only for a STAFF account that has no
 * membership yet (a Mega Events account by default): true keeps it in Mega
 * Events as well. It never applies to a tours_agent.
 */
export async function addCompanyMember(
  email: string,
  keepMegaEvents: boolean,
): Promise<ActionResult<AddMemberResult>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isAdmin(session)) return NOT_ADMIN;

    const wanted = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) return { success: false, error: "Invalid email address" };

    const { data: profile, error: profileError } = await supabaseTyped
      .from("user_profiles")
      .select("id, email, display_name, role, is_active")
      .ilike("email", wanted)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return { success: false, error: "No user has this email. Create the user on the Users screen first, then add them here." };
    }
    if (profile.role === "superadmin") {
      return { success: false, error: "A superadmin sees every company, so there is no need to add them." };
    }
    if (!ASSIGNABLE_ROLES.includes(profile.role)) {
      return { success: false, error: "Only staff users (admin or editor) or tours agents can be added." };
    }
    if (!profile.is_active) return { success: false, error: "This user is deactivated. Reactivate them on the Users screen before adding them." };

    const { data: existing, error: existingError } = await supabaseTyped
      .from("company_members")
      .select("company_id")
      .eq("user_id", profile.id);
    if (existingError) throw existingError;
    const companyIds = (existing ?? []).map((row) => row.company_id);
    if (companyIds.includes(company.id)) return { success: false, error: "This user is already a member of this company." };

    // A tours_agent works only where it is assigned: no Mega Events default, and never a Mega Events row.
    const isToursAgent = profile.role === TOURS_AGENT_ROLE;
    // A staff account nobody assigned yet works in Mega Events by default.
    const unassigned = companyIds.length === 0;
    const keepsEvents = !isToursAgent && unassigned && keepMegaEvents && company.id !== MEGA_EVENTS_COMPANY_ID;
    const rows = [{ user_id: profile.id, company_id: company.id, role: profile.role }];
    if (keepsEvents) {
      rows.push({ user_id: profile.id, company_id: MEGA_EVENTS_COMPANY_ID, role: profile.role });
    }
    const { error: insertError } = await supabaseTyped.from("company_members").insert(rows);
    if (insertError) throw insertError;

    const name = profile.display_name || profile.email;
    const staysInEvents = !isToursAgent && (companyIds.includes(MEGA_EVENTS_COMPANY_ID) || keepsEvents);
    const note = isToursAgent
      ? `${name} was added to ${company.name} as a tours agent: departures board only, read-only.`
      : staysInEvents
        ? `${name} now works in both ${company.name} and Mega Events.`
        : unassigned
          ? `${name} now works only in ${company.name}, without access to the Mega Events screens.`
          : `${name} was added to ${company.name}.`;

    await logAudit({
      action: "create",
      entityType: "company_member",
      entityId: profile.id,
      changes: {
        companies: {
          from: unassigned ? (isToursAgent ? [] : ["mega-events (default)"]) : companyIds,
          to: rows.map((r) => r.company_id),
        },
      },
      metadata: {
        company: company.slug,
        email: profile.email,
        role: profile.role,
        keepMegaEvents: unassigned && !isToursAgent ? keepMegaEvents : null,
      },
    });
    revalidatePath("/tours/settings");
    return { success: true, data: { members: await membersOf(company), note } };
  } catch (e) {
    return failure(e, "Failed to add the user");
  }
}

/** Removes an account from the active company. Never its last company, never the caller. */
export async function removeCompanyMember(userId: string): Promise<ActionResult<CompanyMemberRow[]>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isAdmin(session)) return NOT_ADMIN;
    if (userId === session.sub) return { success: false, error: "You cannot remove yourself from the company." };

    const { data: existing, error: existingError } = await supabaseTyped
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId);
    if (existingError) throw existingError;
    const companyIds = (existing ?? []).map((row) => row.company_id);
    if (!companyIds.includes(company.id)) return { success: false, error: "This user is not a member of this company." };

    // The "last membership" rule protects staff from turning into Mega Events
    // accounts. A tours_agent has no such default - with no membership it
    // simply works nowhere - so its last membership may go. A failed read of
    // the role keeps the rule (the stricter answer).
    const { data: target, error: targetError } = await supabaseTyped
      .from("user_profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw targetError;
    const isToursAgent = target?.role === TOURS_AGENT_ROLE;
    if (companyIds.length === 1 && !isToursAgent) {
      return {
        success: false,
        error:
          "This is the user's only company. A user with no company counts as a Mega Events user, so the last membership is not removed. To block the user, deactivate them on the Users screen.",
      };
    }

    const { error } = await supabaseTyped
      .from("company_members")
      .delete()
      .eq("user_id", userId)
      .eq("company_id", company.id);
    if (error) throw error;

    await logAudit({
      action: "delete",
      entityType: "company_member",
      entityId: userId,
      changes: { companies: { from: companyIds, to: companyIds.filter((id) => id !== company.id) } },
      metadata: { company: company.slug },
    });
    revalidatePath("/tours/settings");
    return { success: true, data: await membersOf(company) };
  } catch (e) {
    return failure(e, "Failed to remove the user");
  }
}
