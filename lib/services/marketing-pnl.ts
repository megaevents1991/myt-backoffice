/**
 * The campaign P&L join (spec 2026-10-08 section 5): spend rows x entities x attributed Paid
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
 *
 * Money (spec 2026-10-14 section 2): every amount comes back in `currency`. ILS spend is the
 * amount as billed (`spend` of an ILS row); an order's USD money is converted at ITS OWN rate
 * (`usdIls`), else `fallbackUsdIls`; the platform-reported value is stored in the account
 * currency. `platform` slices the whole P&L to one ad platform (the Executive source filter).
 */
import type { AdBrand, AdPlatform } from "@/types/marketing.types";
import type { PaidTouch } from "@/lib/services/marketing-attribution";

export const MARKETING_CURRENCIES = ["ils", "usd"] as const;
export type MarketingCurrency = (typeof MARKETING_CURRENCIES)[number];

export interface SpendLike { platform: AdPlatform; campaign_id: string; adset_key: string; day: string; spend: number; currency: string; fx_rate: number; spend_usd: number; clicks: number; impressions: number; platform_conversions: number; platform_value: number }
export interface EntityLike { platform: AdPlatform; id: string; kind: string; name: string; brand: AdBrand; status: string | null; campaign_id?: string | null; channel?: string | null }
/** `revenue` / `cogs` are USD; `usdIls` = ILS per USD the order was charged at (null = not stored). */
export interface AttributedReservation { id: number; day: string; revenue: number; cogs: number; estimated: boolean; usdIls: number | null; touch: PaidTouch | null }

export interface PnlTotals { spend: number; revenue: number; cogs: number; fee: number; net: number; purchases: number; clicks: number; impressions: number; platformPurchases: number; platformValue: number; estimatedCount: number; poas: number | null; roas: number | null; cac: number | null }
export interface AdsetPnl extends PnlTotals { key: string; name: string }
export interface CampaignPnl extends PnlTotals { key: string; platform: AdPlatform; campaignId: string; name: string; brand: AdBrand; status: string | null; channel: string | null; adsets: AdsetPnl[] }
export interface DailyPoint { day: string; spend: number; revenue: number }
export interface Pnl { currency: MarketingCurrency; campaigns: CampaignPnl[]; unresolved: (PnlTotals & { platform: AdPlatform })[]; unattributed: PnlTotals; otherBrand: PnlTotals; totals: PnlTotals; daily: DailyPoint[] }

export interface BuildPnlInput {
  spend: SpendLike[];
  entities: EntityLike[];
  reservations: AttributedReservation[];
  feePct: number;
  brand: AdBrand | "all";
  currency: MarketingCurrency;
  /** ILS per USD for an order with no stored rate and for a non-ILS spend row. */
  fallbackUsdIls: number;
  platform?: AdPlatform;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const empty = (): PnlTotals => ({ spend: 0, revenue: 0, cogs: 0, fee: 0, net: 0, purchases: 0, clicks: 0, impressions: 0, platformPurchases: 0, platformValue: 0, estimatedCount: 0, poas: null, roas: null, cac: null });
function addTotals(t: PnlTotals, u: PnlTotals) { t.spend += u.spend; t.revenue += u.revenue; t.cogs += u.cogs; t.fee += u.fee; t.purchases += u.purchases; t.clicks += u.clicks; t.impressions += u.impressions; t.platformPurchases += u.platformPurchases; t.platformValue += u.platformValue; t.estimatedCount += u.estimatedCount; }
function finish<T extends PnlTotals>(t: T): T {
  t.spend = r2(t.spend); t.revenue = r2(t.revenue); t.cogs = r2(t.cogs); t.fee = r2(t.fee); t.platformValue = r2(t.platformValue);
  t.net = r2(t.revenue - t.cogs - t.fee - t.spend);
  t.poas = t.spend > 0 ? r2(t.net / t.spend) : null;
  t.roas = t.spend > 0 ? r2(t.revenue / t.spend) : null;
  t.cac = t.purchases > 0 ? r2(t.spend / t.purchases) : null;
  return t;
}

/** One spend row's money in the chosen currency. */
export function spendIn(s: Pick<SpendLike, "spend" | "currency" | "spend_usd">, currency: MarketingCurrency, fallbackUsdIls: number): number {
  if (currency === "usd") return s.spend_usd;
  return s.currency.toUpperCase() === "ILS" ? s.spend : s.spend_usd * fallbackUsdIls;
}

/** The platform-reported value (account currency) in the chosen currency. */
function platformValueIn(s: SpendLike, currency: MarketingCurrency, fallbackUsdIls: number): number {
  const ils = s.currency.toUpperCase() === "ILS";
  if (currency === "ils") return ils ? s.platform_value : s.platform_value * s.fx_rate * fallbackUsdIls;
  return s.platform_value * s.fx_rate;
}

export function buildPnl(input: BuildPnlInput): Pnl {
  const { currency, fallbackUsdIls } = input;
  const ent = new Map(input.entities.map((e) => [`${e.platform}:${e.id}`, e]));
  const entityOf = (platform: AdPlatform, id: string) => ent.get(`${platform}:${id}`);
  const inBrand = (platform: AdPlatform, campaignId: string) => input.brand === "all" || (entityOf(platform, campaignId)?.brand ?? "other") === input.brand;
  const onPlatform = (platform: AdPlatform) => !input.platform || input.platform === platform;
  const orderMoney = (usd: number, r: AttributedReservation) => (currency === "usd" ? usd : usd * (r.usdIls && r.usdIls > 0 ? r.usdIls : fallbackUsdIls));

  const addSpend = (t: PnlTotals, s: SpendLike) => { t.spend += spendIn(s, currency, fallbackUsdIls); t.clicks += s.clicks; t.impressions += s.impressions; t.platformPurchases += s.platform_conversions; t.platformValue += platformValueIn(s, currency, fallbackUsdIls); };
  const addSale = (t: PnlTotals, r: AttributedReservation) => { const revenue = orderMoney(r.revenue, r); t.revenue += revenue; t.cogs += orderMoney(r.cogs, r); t.fee += (revenue * input.feePct) / 100; t.purchases += 1; if (r.estimated) t.estimatedCount += 1; };

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
  const dayOf = (d: string) => { let p = daily.get(d); if (!p) { p = { day: d, spend: 0, revenue: 0 }; daily.set(d, p); } return p; };

  for (const s of input.spend) {
    if (!onPlatform(s.platform) || !inBrand(s.platform, s.campaign_id)) continue;
    const c = campaign(s.platform, s.campaign_id);
    addSpend(c, s); addSpend(adset(c, s.adset_key), s);
    dayOf(s.day).spend += spendIn(s, currency, fallbackUsdIls);
  }
  // An unresolved touch is a click on one of OUR ad links - it belongs to Mega Events, never to the "other" view.
  const unresolvedInTotals = input.brand === "mega_events" || input.brand === "all";
  const unresolved = new Map<AdPlatform, PnlTotals & { platform: AdPlatform }>();
  const unattributed = empty();
  const otherBrand = empty();
  for (const r of input.reservations) {
    const t = r.touch;
    if (!t) { addSale(unattributed, r); continue; }
    if (!onPlatform(t.platform)) continue;
    if (!t.resolved || !t.campaignId) {
      let u = unresolved.get(t.platform);
      if (!u) { u = { ...empty(), platform: t.platform }; unresolved.set(t.platform, u); }
      addSale(u, r);
      if (unresolvedInTotals) dayOf(r.day).revenue += orderMoney(r.revenue, r);
      continue;
    }
    // Same predicate as the spend side, so a campaign's spend and its sales are always on the same side of the filter.
    if (!inBrand(t.platform, t.campaignId)) { addSale(otherBrand, r); continue; }
    const c = campaign(t.platform, t.campaignId);
    addSale(c, r); addSale(adset(c, t.adsetId ?? ""), r);
    dayOf(r.day).revenue += orderMoney(r.revenue, r);
  }

  const list: CampaignPnl[] = [...campaigns.values()].map((c) => {
    const { adsetMap, ...rest } = c;
    const adsets = [...adsetMap.values()].map((a) => finish(a)).sort((a, b) => b.spend - a.spend);
    return { ...finish(rest), adsets };
  }).sort((a, b) => b.spend - a.spend);
  const totals = empty();
  for (const c of list) addTotals(totals, c);
  const unresolvedList = [...unresolved.values()].map((u) => finish(u));
  if (unresolvedInTotals) for (const u of unresolvedList) addTotals(totals, u);
  return {
    currency,
    campaigns: list,
    unresolved: unresolvedList,
    unattributed: finish(unattributed),
    otherBrand: finish(otherBrand),
    totals: finish(totals),
    daily: [...daily.values()].map((d) => ({ ...d, spend: r2(d.spend), revenue: r2(d.revenue) })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}
