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
 * tours_agent: the SALES AGENT of a TOURS company (Mega Family) - "Sales agent"
 * / "נציג מכירות" on screen (22.10; a read-only viewer from 01.10 to then).
 * Deliberately not the `agent` role - that one is a Mega Events partner
 * (portal, partner code, credit, coupons). A tours_agent is neither staff nor a
 * partner:
 *  - it signs in through the normal login and holds the site-wide cookie;
 *  - it works only in the companies it is assigned to (company_members) and
 *    has NO Mega Events floor - unassigned means access to nothing;
 *  - it works three screens as a REP (its own and the unassigned cards, never
 *    a manager): the tours dashboard, the Reservations board + customer pages,
 *    the tasks board (requireCompanyRep in lib/company.ts); the departures
 *    board stays read-only for it (requireCompanyViewer). lib/auth/tours-agent.ts
 *    holds its home, its menu and the paths it may open.
 */
export const TOURS_AGENT_ROLE = "tours_agent" satisfies Role;

/** Display names of the roles that are shown by more than their id. */
export const ROLE_LABELS: Partial<Record<Role, { en: string; he: string }>> = {
  tours_agent: { en: "Sales agent", he: "נציג מכירות" },
};

export const STAFF_ROLES: Role[] = ["superadmin", "admin", "editor"];
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
