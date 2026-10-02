/**
 * Roles for backoffice users.
 * superadmin/admin/editor = staff; agent/affiliate = partner-linked.
 * Hierarchy: superadmin manages everyone (incl. admins); admin manages
 * editor/agent/affiliate only - an admin can never touch admin/superadmin accounts.
 */
export const ROLES = [
  "superadmin",
  "admin",
  "editor",
  "office_manager",
  "agent",
  "affiliate",
  "forms_operator",
  "tours_agent",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * tours_agent: a sales agent of a TOURS company (Mega Family). Deliberately not
 * the `agent` role - that one is a Mega Events partner (portal, partner code,
 * credit, coupons). A tours_agent is neither staff nor a partner:
 *  - it signs in through the normal login and holds the site-wide cookie;
 *  - it works only in the companies it is assigned to (company_members) and
 *    has NO Mega Events floor - unassigned means access to nothing;
 *  - today it sees the departures board of its company, read-only
 *    (requireCompanyViewer in lib/company.ts); a portal of its own comes later
 *    (lib/auth/tours-agent.ts holds its home and the paths it may open).
 */
export const TOURS_AGENT_ROLE = "tours_agent" satisfies Role;

/** Display names of the roles that are shown by more than their id. */
export const ROLE_LABELS: Partial<Record<Role, { en: string; he: string }>> = {
  tours_agent: { en: "Tours agent", he: "סוכן טיולים" },
};

export const STAFF_ROLES: Role[] = ["superadmin", "admin", "editor"];
/**
 * forms_operator: a restricted account (e.g. Mega Travel's coordinator) that
 * lives entirely inside /forms - creates trip links, reads responses and the
 * trips report, duplicates forms. Never edits or publishes a questionnaire.
 */
export const FORMS_ACCESS_ROLES: Role[] = [...STAFF_ROLES, "forms_operator"];
/** Roles allowed into user management. Only superadmin may manage these roles' accounts. */
export const ADMIN_ROLES: Role[] = ["superadmin", "admin"];
/** Partner-linked, portal-confined roles. */
export const PARTNER_ROLES: Role[] = ["office_manager", "agent", "affiliate"];
/** Partner roles that SELL (build packages, quote, order for a customer). */
export const SELLER_ROLES: Role[] = ["agent", "office_manager"];
/**
 * The roles a person can hold in a company other than Mega Events - the Users
 * screen in company scope (lib/actions/user-actions.ts). Only a superadmin
 * gives `admin`.
 */
export const COMPANY_MEMBER_ROLES: Role[] = ["admin", "editor", "tours_agent"];

/** Row shape of public.user_profiles (hand-typed until `npm run db:types` regen). */
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  partner_tracking_code: string | null;
  /** Short stable id carried as utm_content=ag-<slug> on this user's links. Never regenerated. */
  agent_slug: string | null;
  logo_url: string | null;
  phone: string | null;
  /** Storage path in the private `user-contracts` bucket (not a public URL). */
  contract_url: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

/**
 * A person's place in the active company (public.company_members). Set only
 * on the Users screen of a company other than Mega Events.
 */
export interface UserMembership {
  /** Their role in this company (company_members.role). */
  role: Role;
  /**
   * True when this company is their only company and they are not a
   * superadmin - the only people a company admin manages fully.
   */
  onlyHere: boolean;
}

/** A row of the Users screen. */
export interface UserListItem extends UserProfile {
  membership?: UserMembership;
}

/** The user object exposed to the client (auth context / session route). */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  partner_code: string | null;
  display_name?: string | null;
}
