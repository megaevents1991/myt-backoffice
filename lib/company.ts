/**
 * Company context of the multi-company platform (server only).
 *
 * A "company" is a tenant: Mega Events (product type "events"), Mega Family
 * (product type "tours"), later others. The active company is a per-browser
 * choice kept in its own cookie - the signed session cookie is NOT touched, so
 * nothing about login, roles or existing sessions changes.
 *
 * Safety rule this file enforces: when anything about companies cannot be
 * resolved (no cookie, an unknown slug, a user who is not a member, the tables
 * not readable), the answer is Mega Events. The backoffice then behaves exactly
 * as it did before companies existed.
 */
import { cookies } from "next/headers";
import { supabaseTyped } from "@/lib/supabase-server";
import { getSession, requireStaffOfAnyCompany } from "@/lib/auth/guards";
import { COMPANY_UNASSIGNED_ERROR } from "@/lib/auth/tours-agent";
import {
  COMPANY_HOME_HINT_MAX_AGE,
  MEGA_EVENTS_COMPANY_ID,
  type CompanyHomeHint,
} from "@/lib/company-ids";
import { TOURS_AGENT_ROLE, type Role } from "@/types/auth.types";
import type { SessionPayload } from "@/lib/auth/session";

export { MEGA_EVENTS_COMPANY_ID };
export const ACTIVE_COMPANY_COOKIE = "active_company";

export type ProductType = "events" | "tours";

export interface Company {
  id: string;
  slug: string;
  name: string;
  productTypes: ProductType[];
  defaultCurrency: string;
  siteUrl: string | null;
}

export const MEGA_EVENTS_FALLBACK: Company = {
  id: MEGA_EVENTS_COMPANY_ID,
  slug: "mega-events",
  name: "מגה איבנטס",
  productTypes: ["events"],
  defaultCurrency: "USD",
  siteUrl: null,
};

const COLUMNS = "id, slug, name, product_types, default_currency, site_url";

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  product_types: string[];
  default_currency: string;
  site_url: string | null;
};

const toCompany = (row: CompanyRow): Company => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  productTypes: row.product_types.filter((p): p is ProductType => p === "events" || p === "tours"),
  defaultCurrency: row.default_currency,
  siteUrl: row.site_url,
});

/**
 * The tours companies a tours_agent is assigned to. May be EMPTY: this role has
 * no Mega Events floor, so "no membership" and "the memberships cannot be
 * read" both mean "works nowhere" (fail closed - the opposite of staff).
 * Only companies that sell tours count; a stray membership in an events
 * company gives the role nothing.
 */
async function listToursAgentCompanies(userId: string): Promise<Company[]> {
  try {
    const { data, error } = await supabaseTyped
      .from("company_members")
      .select(`companies!inner(${COLUMNS}, is_active, created_at)`)
      .eq("user_id", userId);
    if (error || !data) {
      if (error) console.error("listToursAgentCompanies:", JSON.stringify(error));
      return [];
    }
    return data
      .map((m) => m.companies as unknown as CompanyRow & { is_active: boolean; created_at: string })
      .filter((c) => c && c.is_active)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(toCompany)
      .filter((c) => c.productTypes.includes("tours"));
  } catch (e) {
    console.error("listToursAgentCompanies:", e);
    return [];
  }
}

/**
 * The companies this session may work in. superadmin: every active company.
 * Everyone else: their company_members rows. Never empty - Mega Events is the
 * floor - except for a tours_agent, which works only where it was assigned.
 */
export async function listCompaniesFor(session: SessionPayload | null): Promise<Company[]> {
  if (!session) return [MEGA_EVENTS_FALLBACK];
  if (session.role === TOURS_AGENT_ROLE) return listToursAgentCompanies(session.sub);
  try {
    if (session.role === "superadmin") {
      const { data, error } = await supabaseTyped
        .from("companies")
        .select(COLUMNS)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error || !data || data.length === 0) return [MEGA_EVENTS_FALLBACK];
      return data.map(toCompany);
    }
    const { data, error } = await supabaseTyped
      .from("company_members")
      .select(`companies!inner(${COLUMNS}, is_active)`)
      .eq("user_id", session.sub);
    if (error || !data) return [MEGA_EVENTS_FALLBACK];
    const rows = data
      .map((m) => m.companies as unknown as CompanyRow & { is_active: boolean })
      .filter((c) => c && c.is_active);
    return rows.length ? rows.map(toCompany) : [MEGA_EVENTS_FALLBACK];
  } catch (e) {
    console.error("listCompaniesFor:", e);
    return [MEGA_EVENTS_FALLBACK];
  }
}

/**
 * The company this request works in. Falls back to Mega Events on any doubt -
 * except for a tours_agent with no company, where it THROWS
 * (COMPANY_UNASSIGNED_ERROR): that role must never be handed Mega Events.
 */
export async function getActiveCompany(session?: SessionPayload | null): Promise<Company> {
  const actor = session === undefined ? await getSession() : session;
  const companies = await listCompaniesFor(actor);
  if (actor?.role === TOURS_AGENT_ROLE && companies.length === 0) {
    throw new Error(COMPANY_UNASSIGNED_ERROR);
  }
  const store = await cookies();
  const wanted = store.get(ACTIVE_COMPANY_COOKIE)?.value;
  return (
    companies.find((c) => c.slug === wanted) ??
    companies.find((c) => c.id === MEGA_EVENTS_COMPANY_ID) ??
    companies[0] ??
    MEGA_EVENTS_FALLBACK
  );
}

/** Where a company's home is: "tours" only for a company that sells no events. */
export const companyHomeHint = (company: Pick<Company, "productTypes">): CompanyHomeHint =>
  company.productTypes.includes("events") ? "events" : "tours";

/** Cookie options of COMPANY_HOME_HINT_COOKIE (lib/company-ids.ts). */
export const companyHomeHintOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: COMPANY_HOME_HINT_MAX_AGE,
  path: "/",
});

/**
 * The home hint of an account that is signing in (its session cookie is not
 * set yet, so the account is passed in). Never throws; any doubt is "events".
 */
export async function companyHomeHintFor(user: { id: string; email: string; role: Role }): Promise<CompanyHomeHint> {
  try {
    const session = { sub: user.id, email: user.email, role: user.role, partner_code: null } as SessionPayload;
    return companyHomeHint(await getActiveCompany(session));
  } catch (e) {
    console.error("companyHomeHintFor:", e);
    return "events";
  }
}

/**
 * Server-action guard for company-scoped work: a staff session plus the active
 * company. Pass a product type to refuse the action when the active company
 * does not sell it (a tours action while working in Mega Events, and so on).
 */
export async function requireCompany(
  productType?: ProductType,
): Promise<{ session: SessionPayload; company: Company }> {
  // No Mega Events gate here: the company comes from the caller's own
  // memberships (listCompaniesFor) and every query after it is scoped by it.
  const session = await requireStaffOfAnyCompany();
  const company = await getActiveCompany(session);
  if (productType && !company.productTypes.includes(productType)) {
    throw new Error(`Forbidden: the active company (${company.slug}) does not sell "${productType}"`);
  }
  return { session, company };
}

/**
 * Guard of the READ side that a tours_agent shares with staff - today the
 * departures board and its read-only card, later the agents portal.
 *
 * Admits:
 *  - staff, exactly as requireCompany() does -> readOnly: false;
 *  - a tours_agent that is a member of the active company -> readOnly: true.
 *    Its session was already checked against the live profile (getSession), its
 *    company comes from its own memberships only, and with no membership this
 *    throws COMPANY_UNASSIGNED_ERROR.
 * Everyone else (partners, forms_operator, no session) is refused.
 *
 * `readOnly: true` obliges the caller to answer with the viewer's field list
 * only (no cost, PNR, docket, notes, block operations). Mutations, exports and
 * settings never call this - they keep requireCompany(), which refuses the role.
 */
export async function requireCompanyViewer(
  productType?: ProductType,
): Promise<{ session: SessionPayload; company: Company; readOnly: boolean }> {
  const session = await getSession();
  if (session?.role !== TOURS_AGENT_ROLE) {
    return { ...(await requireCompany(productType)), readOnly: false };
  }
  const company = await getActiveCompany(session);
  if (productType && !company.productTypes.includes(productType)) {
    throw new Error(`Forbidden: the active company (${company.slug}) does not sell "${productType}"`);
  }
  return { session, company, readOnly: true };
}
