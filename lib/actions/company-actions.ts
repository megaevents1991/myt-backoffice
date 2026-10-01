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
import { STAFF_ROLES, TOURS_AGENT_ROLE } from "@/types/auth.types";
import { COMPANY_HOME_HINT_COOKIE } from "@/lib/company-ids";
import {
  ACTIVE_COMPANY_COOKIE,
  MEGA_EVENTS_FALLBACK,
  companyHomeHint,
  companyHomeHintOptions,
  getActiveCompany,
  listCompaniesFor,
  type Company,
} from "@/lib/company";

export interface CompanyContext {
  /** null only together with `unassigned`. */
  active: Company | null;
  /** Every company the caller may switch to. One entry = no switcher is shown. */
  companies: Company[];
  /** A tours_agent that no company was assigned to yet: it works nowhere. */
  unassigned?: boolean;
}

/**
 * What the top bar needs. Partners and forms_operator always get Mega Events
 * alone. A tours_agent gets the companies it is a member of and nothing else -
 * never Mega Events - and `unassigned` when there is none.
 */
export async function getCompanyContext(): Promise<CompanyContext> {
  const session = await getSession();
  if (session?.role === TOURS_AGENT_ROLE) {
    const companies = await listCompaniesFor(session);
    if (companies.length === 0) return { active: null, companies: [], unassigned: true };
    return { active: await getActiveCompany(session), companies };
  }
  if (!session || !STAFF_ROLES.includes(session.role)) {
    return { active: MEGA_EVENTS_FALLBACK, companies: [MEGA_EVENTS_FALLBACK] };
  }
  const companies = await listCompaniesFor(session);
  const active = await getActiveCompany(session);
  return { active, companies };
}

export async function setActiveCompany(slug: string): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  // Staff, and a tours_agent that was assigned to more than one company: both
  // may only pick from their own list (listCompaniesFor), checked right below.
  if (!session || !(STAFF_ROLES.includes(session.role) || session.role === TOURS_AGENT_ROLE)) {
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
  // Routing hint for middleware and the dashboard layout - see lib/company-ids.ts.
  store.set(COMPANY_HOME_HINT_COOKIE, companyHomeHint(target), companyHomeHintOptions());
  revalidatePath("/", "layout");
  return { success: true };
}
