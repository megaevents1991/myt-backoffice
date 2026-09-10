"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { matchAllForEvent } from "@/lib/services/price-light-match";
import type { Lights } from "@/lib/services/price-light-store";
import type { LightDetail, ListingRow, MatchRow } from "@/types/price-light.types";

// New tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * "בדוק עכשיו": re-match against the stored catalogs and recompute both lights. No browsing.
 * Returns `lights` (package/ticket) together with `detail` (the `LightDetail` the label/tooltip
 * read) and `checked_at` so the caller can patch `light_package`, `light_ticket`, `light_detail`,
 * and `light_checked_at` on the row in one shot - patching only the first two leaves the
 * label/tooltip stale after a recheck.
 */
export async function recheckEvent(
  eventId: number,
): Promise<
  | { ok: true; lights: Lights; detail: LightDetail; checked_at: string }
  | { ok: false; error: string }
> {
  await requireStaff();
  try {
    const result = await matchAllForEvent(eventId, "manual");
    if (!result) return { ok: false, error: "event not found or deleted" };
    return { ok: true, lights: result.lights.after, detail: result.lights.detail, checked_at: new Date().toISOString() };
  } catch (e) {
    console.error("recheckEvent failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export async function listEventMatches(eventId: number): Promise<{ matches: MatchRow[]; listings: Record<number, ListingRow> }> {
  await requireStaff();
  const { data, error } = await db.from("competitor_matches")
    .select("id,event_id,competitor,scope,listing_id,status,method,ai_verdict,raw_price,raw_currency,price_usd,normalized_usd,adjustments,attrs,our_usd,diff_usd,light,listing_changed_at,note,created_at")
    .eq("event_id", eventId).order("created_at", { ascending: false }).limit(50);
  if (error) { console.error("listEventMatches failed", JSON.stringify(error)); return { matches: [], listings: {} }; }
  const matches = (data ?? []) as MatchRow[];
  const ids = [...new Set(matches.map((m) => m.listing_id).filter((id): id is number => id != null))];
  const listings: Record<number, ListingRow> = {};
  if (ids.length) {
    const { data: rows, error: lErr } = await db.from("competitor_listings")
      .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
      .in("id", ids);
    if (lErr) console.error("listEventMatches listings failed", JSON.stringify(lErr));
    for (const r of (rows ?? []) as ListingRow[]) listings[r.id] = r;
  }
  return { matches, listings };
}
