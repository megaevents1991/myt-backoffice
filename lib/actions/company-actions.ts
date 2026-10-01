"use server";

/**
 * Company switcher actions. See lib/company.ts for the rules.
 *
 * The active company lives in its own cookie. Choosing a company the caller is
 * not a member of is refused; nothing here touches the session cookie.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/guards";
import { STAFF_ROLES } from "@/types/auth.types";
import {
  ACTIVE_COMPANY_COOKIE,
  MEGA_EVENTS_FALLBACK,
  getActiveCompany,
  listCompaniesFor,
  type Company,
} from "@/lib/company";

export interface CompanyContext {
  active: Company;
  /** Every company the caller may switch to. One entry = no switcher is shown. */
  companies: Company[];
}

/** What the top bar needs. Non-staff callers (portal roles) always get Mega Events alone. */
export async function getCompanyContext(): Promise<CompanyContext> {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    return { active: MEGA_EVENTS_FALLBACK, companies: [MEGA_EVENTS_FALLBACK] };
  }
  const companies = await listCompaniesFor(session);
  const active = await getActiveCompany(session);
  return { active, companies };
}

export async function setActiveCompany(slug: string): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    return { success: false, error: "Unauthorized" };
  }
  const companies = await listCompaniesFor(session);
  const target = companies.find((c) => c.slug === slug);
  if (!target) return { success: false, error: "אין לך גישה לחברה הזו" };

  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, target.slug, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  revalidatePath("/", "layout");
  return { success: true };
}
