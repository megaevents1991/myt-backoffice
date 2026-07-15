/**
 * Roles for backoffice users.
 * superadmin/admin/editor = staff; agent/affiliate = partner-linked.
 * Hierarchy: superadmin manages everyone (incl. admins); admin manages
 * editor/agent/affiliate only — an admin can never touch admin/superadmin accounts.
 */
export const ROLES = ["superadmin", "admin", "editor", "agent", "affiliate"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = ["superadmin", "admin", "editor"];
/** Roles allowed into user management. Only superadmin may manage these roles' accounts. */
export const ADMIN_ROLES: Role[] = ["superadmin", "admin"];
export const PARTNER_ROLES: Role[] = ["agent", "affiliate"];

/** Row shape of public.user_profiles (hand-typed until `npm run db:types` regen). */
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  partner_tracking_code: string | null;
  logo_url: string | null;
  phone: string | null;
  /** Storage path in the private `user-contracts` bucket (not a public URL). */
  contract_url: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

/** The user object exposed to the client (auth context / session route). */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  partner_code: string | null;
  display_name?: string | null;
}
