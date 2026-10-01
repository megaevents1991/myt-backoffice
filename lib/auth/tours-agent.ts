/**
 * Where a tours_agent (types/auth.types.ts) lives. No imports on purpose:
 * middleware (Edge), the nav and the client gate all read it.
 *
 * Today the role has one screen - the departures board of its company, read
 * only. The agents portal of the next phase adds its root to
 * TOURS_AGENT_ROOTS (and moves TOURS_AGENT_HOME there); middleware, the nav
 * and the login landing follow without another auth change.
 */

/** Where a tours_agent lands after sign-in and from any page it may not open. */
export const TOURS_AGENT_HOME = "/tours/departures";

/** Every path root a tours_agent may open. Middleware sends anything else home. */
const TOURS_AGENT_ROOTS: readonly string[] = [TOURS_AGENT_HOME];

export function isToursAgentPath(pathname: string): boolean {
  return TOURS_AGENT_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * Thrown (as the Error message) when a tours_agent has no company: unlike
 * staff there is no Mega Events floor for this role. Callers match on the
 * prefix and show COMPANY_UNASSIGNED_NOTICE.
 */
export const COMPANY_UNASSIGNED_ERROR = "Unassigned: this account is not a member of any company";

export const COMPANY_UNASSIGNED_NOTICE = "החשבון עוד לא שויך לחברה";
