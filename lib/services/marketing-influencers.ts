/**
 * The reads behind the Influencers tab, the Executive tab's top seller / top traffic maker and the influencer alerts
 * (spec 2026-10-28 section 3): the affiliate partners, their visitors in the period and the previous one (the
 * Partners screen's `partners_visitors_by_code`), and every booking carrying their codes over both periods.
 * Session-free; the callers guard. Throws on any read error - an influencer with "no sales" because a read failed
 * would raise a false alert.
 */
import { unstable_cache } from "next/cache";
import { mdb } from "@/lib/services/marketing-db";
import { fetchPaged } from "@/lib/supabase-paged";
import { usdIlsOf } from "@/lib/services/marketing-purchases";
import { revenueUsd, type RevenueColumns } from "@/lib/services/reservation-pnl";
import { currentUsdIls } from "@/lib/services/marketing-fx";
import { MARKETING_TAG, MARKETING_TTL_S } from "@/lib/services/marketing-cache";
import { addDays, israelDayStartUtc, previousWindow } from "@/lib/marketing/range";
import { buildInfluencers, type InfluencerOrder, type InfluencerPartner, type InfluencersView } from "@/lib/marketing/influencers";
import { commissionForReservation, countReservationTickets, isPaid } from "@/lib/partner-commission";
import type { MarketingCurrency } from "@/lib/services/marketing-pnl";
import { CUSTOMER_REFUND_NAME_MARKER, type CommissionType } from "@/types/partner.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";
import type { MarketingSettings } from "@/types/marketing.types";

const ORDERS_MAX = 10_000;

type PartnerRow = { partner_tracking_code: string | null; name_hebrew: string | null; email: string | null; is_active: boolean | null; commission: number | null; commission_type: CommissionType | null };
type OrderRow = RevenueColumns & {
  id: number;
  created_at: string;
  aff_partner_tracking_code: string;
  event_order_info: ReservationEventOrderInfo | null;
  coupon_code: string | null;
  coupon_discount_usd: number | null;
  commission_type: string | null;
  commission_rate: number | null;
};

async function visitorsByCode(since: string, until: string): Promise<Map<string, number>> {
  const { data, error } = await mdb.rpc("partners_visitors_by_code", { p_from: israelDayStartUtc(since), p_to: israelDayStartUtc(addDays(until, 1)) });
  if (error) throw new Error(`partners_visitors_by_code: ${error.message}`);
  const out = new Map<string, number>();
  for (const r of (data ?? []) as { affiliate_id: string; visitors: number }[]) out.set(r.affiliate_id, Number(r.visitors) || 0);
  return out;
}

export async function influencerStats(
  since: string,
  until: string,
  currency: MarketingCurrency,
  settings: Pick<MarketingSettings, "influencer_min_visitors" | "influencer_hot_orders">,
): Promise<InfluencersView & { since: string; until: string; prevSince: string; prevUntil: string }> {
  const prev = previousWindow(since, until);
  const { data: partnerData, error: partnerError } = await mdb
    .from("partners")
    .select("partner_tracking_code, name_hebrew, email, is_active, commission, commission_type")
    .eq("type", "affiliate")
    .or(`name_hebrew.is.null,name_hebrew.not.ilike.*${CUSTOMER_REFUND_NAME_MARKER}*`)
    .limit(1000);
  if (partnerError) throw new Error(`partners read: ${partnerError.message}`);
  const partnerRows = ((partnerData ?? []) as PartnerRow[]).filter((p) => (p.partner_tracking_code ?? "").trim());
  const codes = partnerRows.map((p) => (p.partner_tracking_code as string).trim());

  const [visitors, prevVisitors, orders, usdIls] = await Promise.all([
    visitorsByCode(since, until),
    visitorsByCode(prev.since, prev.until),
    codes.length === 0
      ? Promise.resolve({ rows: [] as OrderRow[], truncated: false, error: null })
      : fetchPaged<OrderRow>(
          () =>
            mdb
              .from("reservations")
              .select("id, created_at, status, user_shown_price, exchange_rate_usd_ils_100, agent_card_discount_ils, partner_settlement_method, aff_partner_tracking_code, event_order_info, coupon_code, coupon_discount_usd, commission_type, commission_rate")
              .in("aff_partner_tracking_code", codes)
              .is("is_deleted", null)
              .gte("created_at", israelDayStartUtc(prev.since))
              .lt("created_at", israelDayStartUtc(addDays(until, 1)))
              .order("id"),
          ORDERS_MAX,
        ),
    currency === "ils" ? currentUsdIls() : Promise.resolve(1),
  ]);
  if (orders.error) throw new Error(`reservations read: ${orders.error.message}`);
  if (orders.truncated) throw new Error(`reservations read: more than ${ORDERS_MAX} influencer bookings in ${prev.since}..${until} - narrow the range`);

  const termsByCode = new Map(partnerRows.map((p) => [(p.partner_tracking_code as string).trim(), { type: p.commission_type ?? ("fixed_per_ticket" as CommissionType), rate: p.commission ?? 0 }]));
  const currentFrom = Date.parse(israelDayStartUtc(since));
  const inCur = (usd: number, r: OrderRow) => (currency === "usd" ? usd : usd * (usdIlsOf(r.exchange_rate_usd_ils_100) ?? usdIls));
  const list: InfluencerOrder[] = orders.rows.map((r) => {
    const paid = isPaid(r);
    const terms = termsByCode.get(r.aff_partner_tracking_code.trim());
    return {
      code: r.aff_partner_tracking_code,
      current: Date.parse(r.created_at) >= currentFrom,
      paid,
      tickets: paid ? countReservationTickets(r) : 0,
      revenue: paid ? inCur(revenueUsd(r) ?? 0, r) : 0,
      commission: paid && terms ? inCur(commissionForReservation(r, terms), r) : 0,
    };
  });
  const partners: InfluencerPartner[] = partnerRows.map((p) => ({ code: (p.partner_tracking_code as string).trim(), name: (p.name_hebrew ?? "").trim() || (p.email ?? "").trim() || (p.partner_tracking_code as string), active: p.is_active !== false }));
  return { ...buildInfluencers({ partners, visitors, prevVisitors, orders: list, settings }), since, until, prevSince: prev.since, prevUntil: prev.until };
}

// unstable_cache keys on the arguments - the two thresholds included, so a saved setting is a new entry at once.
export const cachedInfluencerStats = unstable_cache(influencerStats, ["marketing-influencers-v1"], { tags: [MARKETING_TAG.pnl], revalidate: MARKETING_TTL_S.pnl });
