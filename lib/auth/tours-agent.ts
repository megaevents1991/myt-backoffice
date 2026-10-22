/**
 * Where a tours_agent (types/auth.types.ts) - the SALES AGENT of a tours
 * company since 22.10 - lives. No imports on purpose: middleware (Edge), the
 * nav and the client gate all read it.
 *
 * The role works three screens (Alon 22.10: "דשבורד, רזרויישן, טאסקס"): the
 * tours dashboard, the Reservations board with the customer pages it opens,
 * and the tasks board. The departures board it had since 01.10 stays reachable
 * read-only (the dashboard's "Departures" card links to it) but is not in the
 * menu. Everything else sends it home. What it may DO on those screens is the
 * server's call (requireCompanyRep in lib/company.ts); this only keeps it off
 * the other pages.
 */

/** Where a tours_agent lands after sign-in and from any page it may not open. */
export const TOURS_AGENT_HOME = "/tours";

/** The menu entries of the role - exact hrefs of lib/nav.ts items. */
export const TOURS_AGENT_MENU: readonly string[] = [TOURS_AGENT_HOME, "/tours/reservations", "/tasks"];

/** Paths the role may open exactly as written - `/tours` is the dashboard alone, never the whole tours area. */
const TOURS_AGENT_EXACT: readonly string[] = [TOURS_AGENT_HOME];
/** Path roots the role may open, with everything under them. */
const TOURS_AGENT_ROOTS: readonly string[] = ["/tours/reservations", "/tours/customers", "/tasks", "/tours/departures"];

export function isToursAgentPath(pathname: string): boolean {
  return TOURS_AGENT_EXACT.includes(pathname) || TOURS_AGENT_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/** A nav item the role's sidebar and palette show. */
export const isToursAgentMenuPath = (href: string): boolean => TOURS_AGENT_MENU.includes(href);

/**
 * Thrown (as the Error message) when a tours_agent has no company: unlike
 * staff there is no Mega Events floor for this role. Callers match on the
 * prefix and show COMPANY_UNASSIGNED_NOTICE.
 */
export const COMPANY_UNASSIGNED_ERROR = "Unassigned: this account is not a member of any company";

export const COMPANY_UNASSIGNED_NOTICE = "This account is not assigned to a company yet";
