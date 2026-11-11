/**
 * The kinds of role a person can hold in a company (pure - the users screen and its server
 * actions both read it). Staff (admin / editor) work the company's backoffice; a sales agent
 * (tours_agent) works three screens; a forms operator (forms_operator, a company role since
 * 2026-11-11) works the forms of its company only. Moving a person from one kind to another
 * changes what they can reach, so it is a superadmin's move - a company admin changes a role
 * only inside its kind (editor <-> admin is already the superadmin's by the admin rule).
 */
import type { Role } from "@/types/auth.types";

export type CompanyRoleKind = "staff" | "tours_agent" | "forms_operator";

export function companyRoleKind(role: Role): CompanyRoleKind {
  if (role === "tours_agent") return "tours_agent";
  if (role === "forms_operator") return "forms_operator";
  return "staff";
}

/** True when going from one role to the other changes its kind. */
export function crossesRoleLine(from: Role, to: Role): boolean {
  return companyRoleKind(from) !== companyRoleKind(to);
}
