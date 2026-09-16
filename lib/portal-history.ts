/**
 * The portal's history cut-off (`partners.portal_history_from`, 2026-09-16).
 *
 * A tracking code can be older than the partner's real start with us - reused,
 * dormant for a year, typed by hand into a link - and the portal lists every
 * booking ever attributed to it. Aviran (code since 03/2025, portal since
 * 09/2026) opened his reservations page onto a 06/2025 customer he had never
 * heard of. Staff set the date in the partner editor; every portal surface
 * that lists or counts bookings applies it through `portalHistoryFrom`.
 *
 * REPORTING ONLY. The monthly partner report and the commission maths never
 * read this - a paid booking earns whatever it earned, whenever it was made.
 *
 * Server-only (service-role client).
 */

import { supabase } from "@/lib/supabase-server";

/**
 * `YYYY-MM-DD` or null (= show everything). Null also on a not-yet-migrated
 * column (42703/PGRST204) and on any query error - the portal falls back to
 * its old behaviour rather than blanking the page.
 */
export async function portalHistoryFrom(
  partnerCode: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("partners")
    .select("portal_history_from")
    .eq("partner_tracking_code", partnerCode)
    .maybeSingle();
  if (error) {
    if (error.code !== "42703" && error.code !== "PGRST204") {
      console.error("portalHistoryFrom:", JSON.stringify(error));
    }
    return null;
  }
  const value = (data as { portal_history_from?: string | null } | null)
    ?.portal_history_from;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Applies the cut-off to a `reservations` query builder. One helper so every
 * portal surface agrees on the comparison: `created_at >= date`, the date read
 * as midnight UTC - the same convention as `rangeWindowISO`.
 */
export function fromPortalHistory<
  Q extends { gte: (column: string, value: string) => Q },
>(query: Q, from: string | null): Q {
  return from ? query.gte("created_at", from) : query;
}
