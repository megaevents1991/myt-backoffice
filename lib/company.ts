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
import { getSession, requireStaff } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";

/** Fixed in supabase/migrations/20261001100000_companies_core.sql. Also the default of flights.company_id. */
export const MEGA_EVENTS_COMPANY_ID = "a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601";
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
 * The companies this session may work in. superadmin: every active company.
 * Everyone else: their company_members rows. Never empty - Mega Events is the floor.
 */
export async function listCompaniesFor(session: SessionPayload | null): Promise<Company[]> {
  if (!session) return [MEGA_EVENTS_FALLBACK];
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

/** The company this request works in. Falls back to Mega Events on any doubt. */
export async function getActiveCompany(session?: SessionPayload | null): Promise<Company> {
  const actor = session === undefined ? await getSession() : session;
  const companies = await listCompaniesFor(actor);
  const store = await cookies();
  const wanted = store.get(ACTIVE_COMPANY_COOKIE)?.value;
  return (
    companies.find((c) => c.slug === wanted) ??
    companies.find((c) => c.id === MEGA_EVENTS_COMPANY_ID) ??
    companies[0] ??
    MEGA_EVENTS_FALLBACK
  );
}

/**
 * Server-action guard for company-scoped work: a staff session plus the active
 * company. Pass a product type to refuse the action when the active company
 * does not sell it (a tours action while working in Mega Events, and so on).
 */
export async function requireCompany(
  productType?: ProductType,
): Promise<{ session: SessionPayload; company: Company }> {
  const session = await requireStaff();
  const company = await getActiveCompany(session);
  if (productType && !company.productTypes.includes(productType)) {
    throw new Error(`Forbidden: the active company (${company.slug}) does not sell "${productType}"`);
  }
  return { session, company };
}
