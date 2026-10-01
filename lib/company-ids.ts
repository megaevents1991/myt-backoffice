/**
 * Fixed company ids, set in supabase/migrations/20261001100000_companies_core.sql.
 *
 * A file of its own (no imports) so the auth guards and lib/company.ts can both
 * use the Mega Events id without importing each other.
 */

/** Also the column default of flights.company_id. */
export const MEGA_EVENTS_COMPANY_ID = "a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f601";

/**
 * Site-wide ROUTING HINT with no auth value (the pattern of
 * PORTAL_MEMBER_HINT_COOKIE): "tours" while this browser works in a company
 * that sells no events (Mega Family). Middleware uses it to send the post-login
 * landing on /dashboard to the Tours overview, and the dashboard layout uses it
 * to wait for the company instead of flashing a Mega Events screen. It grants
 * nothing - what a user may see is decided on the server from memberships - and
 * a stale value corrects itself on the next page (components/company-route-gate.tsx).
 * Readable by client code on purpose (not httpOnly).
 */
export const COMPANY_HOME_HINT_COOKIE = "company_home";
export type CompanyHomeHint = "tours" | "events";
/** One year, like the active-company cookie. */
export const COMPANY_HOME_HINT_MAX_AGE = 60 * 60 * 24 * 365;
