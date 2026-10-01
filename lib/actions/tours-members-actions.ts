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
 * Company admins and superadmins only. The account itself (name, password,
 * role, active) is managed in the Users screen; this file only assigns it.
 */
import { revalidatePath } from "next/cache";

import { requireCompany, type Company } from "@/lib/company";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { supabaseTyped } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import type { SessionPayload } from "@/lib/auth/session";
import type { ActionResult, CompanyMemberRow } from "@/components/tours/content/shared";

const ASSIGNABLE_ROLES = ["admin", "editor"];

const NOT_ADMIN = { success: false as const, error: "שיוך משתמשים לחברה פתוח למנהל החברה בלבד" };
const isAdmin = (session: SessionPayload): boolean => session.role === "superadmin" || session.role === "admin";

function failure(e: unknown, fallback: string): { success: false; error: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith("Forbidden: the active company")) {
    return { success: false, error: "המסך הזה שייך לחברה שמוכרת טיולים. החליפו חברה בסרגל העליון." };
  }
  if (message === "Unauthorized") return { success: false, error: "אין הרשאה לפעולה הזו" };
  console.error(`${fallback}:`, e);
  return { success: false, error: fallback };
}

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
 * Adds an existing staff account to the active company, by its email.
 * `keepMegaEvents` matters only for an account that has no membership yet (a
 * Mega Events account by default): true keeps it in Mega Events as well.
 */
export async function addCompanyMember(
  email: string,
  keepMegaEvents: boolean,
): Promise<ActionResult<AddMemberResult>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isAdmin(session)) return NOT_ADMIN;

    const wanted = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wanted)) return { success: false, error: "כתובת אימייל לא תקינה" };

    const { data: profile, error: profileError } = await supabaseTyped
      .from("user_profiles")
      .select("id, email, display_name, role, is_active")
      .ilike("email", wanted)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return { success: false, error: "אין משתמש עם האימייל הזה. קודם יוצרים אותו במסך המשתמשים, ואז משייכים אותו כאן." };
    }
    if (profile.role === "superadmin") {
      return { success: false, error: "מנהל-על רואה כל חברה, אין צורך לשייך אותו." };
    }
    if (!ASSIGNABLE_ROLES.includes(profile.role)) {
      return { success: false, error: "אפשר לשייך רק משתמשי צוות (מנהל או עורך)." };
    }
    if (!profile.is_active) return { success: false, error: "המשתמש מושבת. מפעילים אותו במסך המשתמשים לפני השיוך." };

    const { data: existing, error: existingError } = await supabaseTyped
      .from("company_members")
      .select("company_id")
      .eq("user_id", profile.id);
    if (existingError) throw existingError;
    const companyIds = (existing ?? []).map((row) => row.company_id);
    if (companyIds.includes(company.id)) return { success: false, error: "המשתמש כבר משויך לחברה הזו." };

    // An account nobody assigned yet works in Mega Events by default.
    const unassigned = companyIds.length === 0;
    const rows = [{ user_id: profile.id, company_id: company.id, role: profile.role }];
    if (unassigned && keepMegaEvents && company.id !== MEGA_EVENTS_COMPANY_ID) {
      rows.push({ user_id: profile.id, company_id: MEGA_EVENTS_COMPANY_ID, role: profile.role });
    }
    const { error: insertError } = await supabaseTyped.from("company_members").insert(rows);
    if (insertError) throw insertError;

    const name = profile.display_name || profile.email;
    const staysInEvents = companyIds.includes(MEGA_EVENTS_COMPANY_ID) || (unassigned && keepMegaEvents);
    const note = staysInEvents
      ? `${name} עובד/ת מעכשיו גם ב-${company.name} וגם במגה איבנטס.`
      : unassigned
        ? `${name} עובד/ת מעכשיו רק ב-${company.name}, בלי גישה למסכי מגה איבנטס.`
        : `${name} שויך/ה ל-${company.name}.`;

    await logAudit({
      action: "create",
      entityType: "company_member",
      entityId: profile.id,
      changes: { companies: { from: unassigned ? ["mega-events (default)"] : companyIds, to: rows.map((r) => r.company_id) } },
      metadata: { company: company.slug, email: profile.email, keepMegaEvents: unassigned ? keepMegaEvents : null },
    });
    revalidatePath("/tours/settings");
    return { success: true, data: { members: await membersOf(company), note } };
  } catch (e) {
    return failure(e, "שיוך המשתמש נכשל");
  }
}

/** Removes an account from the active company. Never its last company, never the caller. */
export async function removeCompanyMember(userId: string): Promise<ActionResult<CompanyMemberRow[]>> {
  try {
    const { session, company } = await requireCompany("tours");
    if (!isAdmin(session)) return NOT_ADMIN;
    if (userId === session.sub) return { success: false, error: "אי אפשר להסיר את עצמך מהחברה." };

    const { data: existing, error: existingError } = await supabaseTyped
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId);
    if (existingError) throw existingError;
    const companyIds = (existing ?? []).map((row) => row.company_id);
    if (!companyIds.includes(company.id)) return { success: false, error: "המשתמש לא משויך לחברה הזו." };
    if (companyIds.length === 1) {
      return {
        success: false,
        error:
          "זו החברה היחידה של המשתמש. משתמש בלי חברה נחשב משתמש של מגה איבנטס, ולכן לא מסירים את השיוך האחרון. כדי לחסום אותו, משביתים אותו במסך המשתמשים.",
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
    return failure(e, "הסרת המשתמש נכשלה");
  }
}
