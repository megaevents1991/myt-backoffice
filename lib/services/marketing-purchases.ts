/**
 * Paid reservations of a window with their revenue / cogs and last paid touch (spec
 * section 5) - the one read both /marketing and the alerts use. Session-free; the
 * callers guard.
 */
import { mdb } from "@/lib/services/marketing-db";
import { fetchPaged } from "@/lib/supabase-paged";
import { cogsUsd, revenueUsd, type PnlReservation } from "@/lib/services/reservation-pnl";
import { META_ID, paidTouchOf, type UtmTouchLike } from "@/lib/services/marketing-attribution";
import type { AttributedReservation } from "@/lib/services/marketing-pnl";

const PNL_COLUMNS = "id, created_at, status, user_shown_price, exchange_rate_usd_ils_100, agent_card_discount_ils, partner_settlement_method, flight_order_info, hotel_order_info, hotel_segments, offline_flight_cost, offline_hotel_cost, ticket_cost_usd, ticket_cost_source, actual_cost_usd, event_order_info";

/** PostgREST answers at most 1000 rows (max_rows) and says nothing, so every `.in()` chunk must be
 *  provably under it: a reservation holds up to 6 touches (primary + HISTORY_MAX 5, myt-main
 *  lib/utm.ts) -> 150 reservations = 900 rows at worst. */
const TOUCH_CHUNK = 150;
/** An id list travels in the URL (a 27KB one got a bare 400 on 2026-10-05); Meta ids are ~20
 *  chars, a gclid ~90, so gclids go in much smaller bites. */
const AD_CHUNK = 200;
const GCLID_CHUNK = 50;
/** Paid reservations read per window. Past it the read throws - a P&L missing rows is worse than none. */
const RESERVATIONS_MAX = 5000;

function chunks<T>(arr: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }

export async function attributedReservations(since: string, until: string): Promise<AttributedReservation[]> {
  const { rows, truncated, error } = await fetchPaged<{ id: number; created_at: string } & PnlReservation>(
    () => mdb.from("reservations").select(PNL_COLUMNS).eq("status", "Paid").is("is_deleted", null).gte("created_at", `${since}T00:00:00Z`).lte("created_at", `${until}T23:59:59Z`).order("id"),
    RESERVATIONS_MAX,
  );
  if (error) throw new Error(`reservations read: ${error.message}`);
  if (truncated) throw new Error(`reservations read: more than ${RESERVATIONS_MAX} Paid reservations in ${since}..${until} - narrow the range`);
  const ids = rows.map((r) => r.id);
  const touches = new Map<number, UtmTouchLike[]>();
  for (const chunk of chunks(ids, TOUCH_CHUNK)) {
    const { data, error: terr } = await mdb.from("utm_touches").select("reservation_id, position, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, is_influencer").in("reservation_id", chunk);
    if (terr) throw new Error(`utm_touches read: ${terr.message}`);
    for (const t of (data ?? []) as (UtmTouchLike & { reservation_id: number })[]) { const list = touches.get(t.reservation_id) ?? []; list.push(t); touches.set(t.reservation_id, list); }
  }
  const adIds = new Set<string>();
  const gclids = new Set<string>();
  for (const list of touches.values()) for (const t of list) { if (t.utm_content && META_ID.test(t.utm_content)) adIds.add(t.utm_content); if (t.gclid) gclids.add(t.gclid); }
  const ads = new Map<string, { campaignId: string; adsetId: string | null }>();
  for (const chunk of chunks([...adIds], AD_CHUNK)) {
    const { data, error: aerr } = await mdb.from("ad_entities").select("id, campaign_id, parent_id").eq("platform", "meta").eq("kind", "ad").in("id", chunk);
    if (aerr) throw new Error(`ad_entities read: ${aerr.message}`);
    for (const a of (data ?? []) as { id: string; campaign_id: string; parent_id: string | null }[]) ads.set(a.id, { campaignId: a.campaign_id, adsetId: a.parent_id });
  }
  const clicks = new Map<string, { campaignId: string; adGroupId: string | null }>();
  for (const chunk of chunks([...gclids], GCLID_CHUNK)) {
    const { data, error: cerr } = await mdb.from("ad_clicks").select("gclid, campaign_id, ad_group_id").in("gclid", chunk);
    if (cerr) throw new Error(`ad_clicks read: ${cerr.message}`);
    for (const c of (data ?? []) as { gclid: string; campaign_id: string; ad_group_id: string | null }[]) clicks.set(c.gclid, { campaignId: c.campaign_id, adGroupId: c.ad_group_id });
  }
  const lookups = { metaAdCampaign: (id: string) => ads.get(id) ?? null, gclidCampaign: (g: string) => clicks.get(g) ?? null };
  return rows.map((r) => { const c = cogsUsd(r); return { id: r.id, day: r.created_at.slice(0, 10), revenue: revenueUsd(r) ?? 0, cogs: c.total, estimated: c.estimated, touch: paidTouchOf(touches.get(r.id) ?? [], lookups) }; });
}

/** Purchases of ours per resolved campaign id, for the budget-bleed rule. */
export async function getPurchasesByCampaign(since: string, until: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await attributedReservations(since, until)) {
    if (r.touch?.resolved && r.touch.campaignId) out.set(r.touch.campaignId, (out.get(r.touch.campaignId) ?? 0) + 1);
  }
  return out;
}
