/**
 * Shared portal labels that BOTH server actions and client components render,
 * so the same row never reads one way in the table and another on the PDF.
 *
 * Plain constants, no server-only imports - `lib/actions/*` is "use server"
 * (which may only export async functions) and `lib/portal-attribution.ts` is
 * service-role code a client component must not pull in.
 */

/**
 * "בוצע ע"י" for a row that is ours rather than the partner's (doc
 * 2026-08-30, item 5: "רק השורה שלנו שיהיה רשום יבוצע ע"י מגה איבנטס").
 * Shown in the portal table and printed on the customer's quote PDF.
 */
export const MEGA_EVENTS_CREATOR = "מגה איבנטס";
