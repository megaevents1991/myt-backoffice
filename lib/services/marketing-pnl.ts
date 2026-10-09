/**
 * The campaign P&L join (spec section 5): spend rows x entities x attributed Paid
 * reservations -> one row per campaign (with its adsets), the unresolved rows per
 * platform ("Meta · unresolved"), the unattributed line, the other-brand line, brand totals
 * and a daily series. net = revenue - cogs - fee - spend; POAS = net / spend;
 * ROAS = revenue / spend; CAC = spend / purchases. Pure; scripts/marketing-pnl-selftest.ts.
 *
 * Revenue never drops out: a Paid reservation lands on a campaign of the chosen brand, on
 * "unresolved" (a paid touch we cannot resolve), on "unattributed" (no paid touch) or on
 * "otherBrand" (its resolved campaign is not in the chosen brand - a campaign with no entity
 * row has no known brand and counts as "other", exactly as its spend does). `totals` = the
 * brand's campaigns + `unresolved` when the brand is mega_events or all (an unresolved touch
 * came through OUR ad links, so it is never another brand's).
 */
import type { AdBrand, AdPlatform } from "@/types/marketing.types";
import type { PaidTouch } from "@/lib/services/marketing-attribution";

export const MARKETING_RANGES = ["7d", "30d", "90d", "month"] as const;
export type MarketingRange = (typeof MARKETING_RANGES)[number];

/** "7d" = the last 7 calendar days INCLUSIVE of today (since = today - 6), same for 30d / 90d - the
 *  alerts' `windowStart` semantics; "month" = the 1st of this month to today. */
export function rangeWindow(range: MarketingRange, now = new Date()): { since: string; until: string } {
  const until = now.toISOString().slice(0, 10);
  if (range === "month") return { since: `${until.slice(0, 7)}-01`, until };
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return { since: new Date(now.getTime() - (days - 1) * 864e5).toISOString().slice(0, 10), until };
}

export interface SpendLike { platform: AdPlatform; campaign_id: string; adset_key: string; day: string; spend_usd: number; clicks: number; impressions: number; platform_conversions: number; platform_value: number }
export interface EntityLike { platform: AdPlatform; id: string; kind: string; name: string; brand: AdBrand; status: string | null; campaign_id?: string | null; channel?: string | null }
export interface AttributedReservation { id: number; day: string; revenue: number; cogs: number; estimated: boolean; touch: PaidTouch | null }

export interface PnlTotals { spendUsd: number; revenueUsd: number; cogsUsd: number; feeUsd: number; netUsd: number; purchases: number; clicks: number; impressions: number; platformPurchases: number; platformValue: number; estimatedCount: number; poas: number | null; roas: number | null; cacUsd: number | null }
export interface AdsetPnl extends PnlTotals { key: string; name: string }
export interface CampaignPnl extends PnlTotals { key: string; platform: AdPlatform; campaignId: string; name: string; brand: AdBrand; status: string | null; channel: string | null; adsets: AdsetPnl[] }
export interface DailyPoint { day: string; spendUsd: number; revenueUsd: number }
export interface Pnl { campaigns: CampaignPnl[]; unresolved: (PnlTotals & { platform: AdPlatform })[]; unattributed: PnlTotals; otherBrand: PnlTotals; totals: PnlTotals; daily: DailyPoint[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const empty = (): PnlTotals => ({ spendUsd: 0, revenueUsd: 0, cogsUsd: 0, feeUsd: 0, netUsd: 0, purchases: 0, clicks: 0, impressions: 0, platformPurchases: 0, platformValue: 0, estimatedCount: 0, poas: null, roas: null, cacUsd: null });
function addSpend(t: PnlTotals, s: SpendLike) { t.spendUsd += s.spend_usd; t.clicks += s.clicks; t.impressions += s.impressions; t.platformPurchases += s.platform_conversions; t.platformValue += s.platform_value; }
function addSale(t: PnlTotals, r: AttributedReservation, feePct: number) { t.revenueUsd += r.revenue; t.cogsUsd += r.cogs; t.feeUsd += (r.revenue * feePct) / 100; t.purchases += 1; if (r.estimated) t.estimatedCount += 1; }
function addTotals(t: PnlTotals, u: PnlTotals) { t.spendUsd += u.spendUsd; t.revenueUsd += u.revenueUsd; t.cogsUsd += u.cogsUsd; t.feeUsd += u.feeUsd; t.purchases += u.purchases; t.clicks += u.clicks; t.impressions += u.impressions; t.platformPurchases += u.platformPurchases; t.platformValue += u.platformValue; t.estimatedCount += u.estimatedCount; }
function finish<T extends PnlTotals>(t: T): T {
  t.spendUsd = r2(t.spendUsd); t.revenueUsd = r2(t.revenueUsd); t.cogsUsd = r2(t.cogsUsd); t.feeUsd = r2(t.feeUsd);
  t.netUsd = r2(t.revenueUsd - t.cogsUsd - t.feeUsd - t.spendUsd);
  t.poas = t.spendUsd > 0 ? r2(t.netUsd / t.spendUsd) : null;
  t.roas = t.spendUsd > 0 ? r2(t.revenueUsd / t.spendUsd) : null;
  t.cacUsd = t.purchases > 0 ? r2(t.spendUsd / t.purchases) : null;
  return t;
}

export function buildPnl(input: { spend: SpendLike[]; entities: EntityLike[]; reservations: AttributedReservation[]; feePct: number; brand: AdBrand | "all" }): Pnl {
  const ent = new Map(input.entities.map((e) => [`${e.platform}:${e.id}`, e]));
  const entityOf = (platform: AdPlatform, id: string) => ent.get(`${platform}:${id}`);
  const inBrand = (platform: AdPlatform, campaignId: string) => input.brand === "all" || (entityOf(platform, campaignId)?.brand ?? "other") === input.brand;

  type Camp = CampaignPnl & { adsetMap: Map<string, AdsetPnl> };
  const campaigns = new Map<string, Camp>();
  const campaign = (platform: AdPlatform, id: string): Camp => {
    const key = `${platform}:${id}`;
    let c = campaigns.get(key);
    if (!c) {
      const e = entityOf(platform, id);
      c = { ...empty(), key, platform, campaignId: id, name: e?.name ?? id, brand: e?.brand ?? "other", status: e?.status ?? null, channel: e?.channel ?? null, adsets: [], adsetMap: new Map() };
      campaigns.set(key, c);
    }
    return c;
  };
  const adset = (c: Camp, key: string): AdsetPnl => {
    let a = c.adsetMap.get(key);
    if (!a) { a = { ...empty(), key, name: entityOf(c.platform, key)?.name ?? (key || "—") }; c.adsetMap.set(key, a); }
    return a;
  };

  const daily = new Map<string, DailyPoint>();
  const dayOf = (d: string) => { let p = daily.get(d); if (!p) { p = { day: d, spendUsd: 0, revenueUsd: 0 }; daily.set(d, p); } return p; };

  for (const s of input.spend) {
    if (!inBrand(s.platform, s.campaign_id)) continue;
    const c = campaign(s.platform, s.campaign_id);
    addSpend(c, s); addSpend(adset(c, s.adset_key), s);
    dayOf(s.day).spendUsd += s.spend_usd;
  }
  // An unresolved touch is a click on one of OUR ad links - it belongs to Mega Events, never to the "other" view.
  const unresolvedInTotals = input.brand === "mega_events" || input.brand === "all";
  const unresolved = new Map<AdPlatform, PnlTotals & { platform: AdPlatform }>();
  const unattributed = empty();
  const otherBrand = empty();
  for (const r of input.reservations) {
    const t = r.touch;
    if (!t) { addSale(unattributed, r, input.feePct); continue; }
    if (!t.resolved || !t.campaignId) {
      let u = unresolved.get(t.platform);
      if (!u) { u = { ...empty(), platform: t.platform }; unresolved.set(t.platform, u); }
      addSale(u, r, input.feePct);
      if (unresolvedInTotals) dayOf(r.day).revenueUsd += r.revenue;
      continue;
    }
    // Same predicate as the spend side, so a campaign's spend and its sales are always on the same side of the filter.
    if (!inBrand(t.platform, t.campaignId)) { addSale(otherBrand, r, input.feePct); continue; }
    const c = campaign(t.platform, t.campaignId);
    addSale(c, r, input.feePct); addSale(adset(c, t.adsetId ?? ""), r, input.feePct);
    dayOf(r.day).revenueUsd += r.revenue;
  }

  const list: CampaignPnl[] = [...campaigns.values()].map((c) => {
    const { adsetMap, ...rest } = c;
    const adsets = [...adsetMap.values()].map((a) => finish(a)).sort((a, b) => b.spendUsd - a.spendUsd);
    return { ...finish(rest), adsets };
  }).sort((a, b) => b.spendUsd - a.spendUsd);
  const totals = empty();
  for (const c of list) addTotals(totals, c);
  const unresolvedList = [...unresolved.values()].map((u) => finish(u));
  if (unresolvedInTotals) for (const u of unresolvedList) addTotals(totals, u);
  return {
    campaigns: list,
    unresolved: unresolvedList,
    unattributed: finish(unattributed),
    otherBrand: finish(otherBrand),
    totals: finish(totals),
    daily: [...daily.values()].map((d) => ({ ...d, spendUsd: r2(d.spendUsd), revenueUsd: r2(d.revenueUsd) })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}
