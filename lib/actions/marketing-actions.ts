"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { mdb, readAll } from "@/lib/services/marketing-db";
import { attributedReservations } from "@/lib/services/marketing-purchases";
import { buildPnl, MARKETING_CURRENCIES, type MarketingCurrency, type Pnl } from "@/lib/services/marketing-pnl";
import { addDays, daysBetween, israelDayStartUtc, resolveWindow, type MarketingWindow } from "@/lib/marketing/range";
import { parseSource, type SourceFilter } from "@/lib/marketing/order-source";
import { buildFunnel, type Funnel } from "@/lib/marketing/funnel";
import { funnelOrders } from "@/lib/services/marketing-funnel";
import { MARKETING_TAG, MARKETING_TTL_S, invalidateMarketing } from "@/lib/services/marketing-cache";
import { currentUsdIls } from "@/lib/services/marketing-fx";
import { readMarketingSettings } from "@/lib/services/marketing-settings";
import { cachedSalesBreakdown } from "@/lib/services/marketing-sales";
import { cachedInfluencerStats } from "@/lib/services/marketing-influencers";
import type { RisingRow, SalesRow } from "@/lib/marketing/sales";
import type { InfluencerRow } from "@/lib/marketing/influencers";
import { runMarketingSync, type MarketingSyncSummary } from "@/lib/services/marketing-sync";
import { IG_MEDIA_READ } from "@/lib/marketing/engagement";
import { validateSettingsPatch } from "@/lib/marketing/settings";
import { type AdBrand, type AdPlatform, type IgMediaRow, type MarketingAlertRow, type MarketingSettings } from "@/types/marketing.types";

/**
 * Every read here THROWS on a database error (a missing table included, until the marketing
 * migration is applied): an empty list or a default setting would read as "nothing to see".
 * Server actions run behind requireAdmin() as the first line.
 */

/** Paged reads (lib/services/marketing-db.ts `readAll`) stop here: past it the read throws - narrow the range. */
const READ_MAX = 50_000;

/** The screen's filters as they sit in the URL (`useMarketingFilters`). */
export interface MarketingQuery { range?: string; from?: string; to?: string; brand?: string; cur?: string; src?: string }

/** Validated filters - anything unknown falls to its default; the window never throws (range.ts falls back). */
function parseQuery(q: MarketingQuery): { window: MarketingWindow; brand: AdBrand | "all"; currency: MarketingCurrency; src: SourceFilter } {
  const brand = q.brand === "all" || q.brand === "other" ? q.brand : "mega_events";
  const currency = (MARKETING_CURRENCIES as readonly string[]).includes(q.cur ?? "") ? (q.cur as MarketingCurrency) : "ils";
  return { window: resolveWindow(q), brand, currency, src: parseSource(q.src) };
}

/** The P&L of one ad platform when the source filter names one, else every platform. */
const platformOf = (src: SourceFilter): AdPlatform | null => (src === "meta" || src === "google" ? src : null);

type PnlView = Pnl & { since: string; until: string; settings: MarketingSettings; usdIls: number };

async function buildPnlFor(since: string, until: string, brand: AdBrand | "all", currency: MarketingCurrency, platform: AdPlatform | null): Promise<PnlView> {
  const [settings, reservations, spend, entities, usdIls] = await Promise.all([
    readMarketingSettings(),
    attributedReservations(since, until),
    readAll<Parameters<typeof buildPnl>[0]["spend"][number]>(
      "ad_spend_daily", "platform, campaign_id, adset_key, day, spend, currency, fx_rate, spend_usd, clicks, impressions, platform_conversions, platform_value",
      ["day", "platform", "campaign_id", "adset_key"], READ_MAX, "marketing", (q) => q.gte("day", since).lte("day", until)),
    readAll<Parameters<typeof buildPnl>[0]["entities"][number]>(
      "ad_entities", "platform, id, kind, name, brand, status, campaign_id, channel",
      ["platform", "id"], READ_MAX, "marketing", (q) => q.in("kind", ["campaign", "adset", "ad_group"])),
    currentUsdIls(),
  ]);
  const pnl = buildPnl({ spend, entities, reservations, feePct: settings.processing_fee_pct, brand, currency, fallbackUsdIls: usdIls, platform: platform ?? undefined });
  return { ...pnl, since, until, settings, usdIls };
}

// unstable_cache keys on the arguments, so every (window, brand, currency, platform) is its own entry.
const cachedPnl = unstable_cache(buildPnlFor, ["marketing-pnl-v2"], { tags: [MARKETING_TAG.pnl], revalidate: MARKETING_TTL_S.pnl });

export async function getMarketingPnl(q: MarketingQuery): Promise<PnlView & { range: MarketingWindow["range"] }> {
  await requireAdmin();
  const { window, brand, currency, src } = parseQuery(q);
  return { ...(await cachedPnl(window.since, window.until, brand, currency, platformOf(src))), range: window.range };
}

const cachedFunnelOrders = unstable_cache(funnelOrders, ["marketing-funnel-orders"], { tags: [MARKETING_TAG.pnl], revalidate: MARKETING_TTL_S.pnl });

/** The Executive tab's "Leaders" row (spec 2026-10-28 section 4): the best-selling artist and football team, the
 *  biggest risers, and the influencer who sold most / brought most visitors - out of the Sales and Influencers tabs'
 *  own cached reads, so the cards and the tabs never disagree. Influencers only for All sources / Partners; nothing
 *  for "Other brand" (our orders are the Mega Events site's). A failure here never takes the tab down. */
export type ExecLeaders =
  | { ok: true; artist: SalesRow | null; team: SalesRow | null; rising: RisingRow[]; seller: InfluencerRow | null; traffic: InfluencerRow | null; showInfluencers: boolean; prevSince: string; prevUntil: string }
  | { ok: false; error: string };

async function execLeaders(window: MarketingWindow, src: SourceFilter, currency: MarketingCurrency): Promise<ExecLeaders> {
  try {
    const showInfluencers = src === "all" || src === "partners";
    const [sales, settings] = await Promise.all([cachedSalesBreakdown(window.since, window.until, src, currency), readMarketingSettings()]);
    const inf = showInfluencers
      ? await cachedInfluencerStats(window.since, window.until, currency, { influencer_min_visitors: settings.influencer_min_visitors, influencer_hot_orders: settings.influencer_hot_orders })
      : null;
    return { ok: true, artist: sales.bestArtist, team: sales.bestTeam, rising: sales.rising, seller: inf?.topSeller ?? null, traffic: inf?.topTraffic ?? null, showInfluencers, prevSince: sales.prevSince, prevUntil: sales.prevUntil };
  } catch (e) {
    console.error("[marketing] executive leaders:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The Executive tab in ONE action (Next runs a tab's actions one at a time): the P&L (sliced to Meta / Google when
 * the source filter names one) + the funnel of every order of the window (spec 2026-10-14 sections 3-4) + the
 * leaders row (spec 2026-10-28). The funnel's spend comes from the P&L's own daily series, so the two can never
 * disagree; brand applies to spend only (the funnel's orders are the Mega Events site's - the screen says so under
 * "Other brand").
 */
export async function getMarketingOverview(q: MarketingQuery): Promise<{ pnl: PnlView & { range: MarketingWindow["range"] }; funnel: Funnel; src: SourceFilter; leaders: ExecLeaders | null }> {
  await requireAdmin();
  const { window, brand, currency, src } = parseQuery(q);
  const [pnl, orders, leaders] = await Promise.all([
    cachedPnl(window.since, window.until, brand, currency, platformOf(src)),
    cachedFunnelOrders(window.since, window.until),
    brand === "other" ? Promise.resolve(null) : execLeaders(window, src, currency),
  ]);
  const spendDaily = pnl.daily.map((d) => ({ day: d.day, meta: d.spendMeta, google: d.spendGoogle }));
  const funnel = buildFunnel(orders, spendDaily, daysBetween(window.since, window.until), src);
  return { pnl: { ...pnl, range: window.range }, funnel, src, leaders };
}

/** `viralPct` rides along (the editable `viral_pct` setting, 200 when never saved) so the grid's "Viral" badge
 *  uses the alert's own threshold without a second action on mount. */
/**
 * Instagram follows the period (spec 2026-10-14 section 8): the newest posts published up to the period's end - the
 * whole read, so the "Viral" rule still has the 30 posts before each one - with `sinceIso` telling the grid which of
 * them to show; followers inside the period.
 */
export async function getInstagramFeed(q: MarketingQuery): Promise<{ media: IgMediaRow[]; followers: { day: string; followers: number }[]; viralPct: number; sinceIso: string }> {
  await requireAdmin();
  const { since, until } = resolveWindow(q);
  const sinceIso = israelDayStartUtc(since);
  const [m, f, settings] = await Promise.all([
    mdb.from("ig_media").select("*").lt("posted_at", israelDayStartUtc(addDays(until, 1))).order("posted_at", { ascending: false }).limit(IG_MEDIA_READ),
    mdb.from("ig_account_daily").select("day, followers").gte("day", since).lte("day", until).order("day", { ascending: false }).limit(400),
    readMarketingSettings(),
  ]);
  if (m.error) throw new Error(`ig_media read: ${m.error.message}`);
  if (f.error) throw new Error(`ig_account_daily read: ${f.error.message}`);
  return { media: m.data ?? [], followers: [...(f.data ?? [])].reverse(), viralPct: settings.viral_pct, sinceIso };
}

/** Alerts first seen inside the period; an open alert is always listed, whenever it started. */
export async function getMarketingAlerts(q: MarketingQuery): Promise<MarketingAlertRow[]> {
  await requireAdmin();
  const { since, until } = resolveWindow(q);
  // Compared as instants: PostgREST prints "+00:00", toISOString "Z" - as strings they do not sort together.
  const from = Date.parse(israelDayStartUtc(since));
  const to = Date.parse(israelDayStartUtc(addDays(until, 1)));
  const { data, error } = await mdb.from("marketing_alerts").select("*").order("first_seen_at", { ascending: false }).limit(500);
  if (error) throw new Error(`marketing_alerts read: ${error.message}`);
  return ((data ?? []) as MarketingAlertRow[]).filter((a) => {
    const seen = Date.parse(a.first_seen_at);
    return !a.resolved_at || (seen >= from && seen < to);
  });
}

type CampaignBrandRow = { platform: AdPlatform; id: string; name: string; brand: AdBrand; brand_source: string; status: string | null };

function readCampaignBrands(): Promise<CampaignBrandRow[]> {
  return readAll<CampaignBrandRow>("ad_entities", "platform, id, name, brand, brand_source, status", ["name", "platform", "id"], READ_MAX, "marketing", (q) => q.eq("kind", "campaign"));
}

/** Everything the Settings tab shows, in ONE action (one guard, both reads side by side) - Next runs a tab's server actions one at a time. */
export async function getMarketingSettingsPage(): Promise<{ settings: MarketingSettings; brands: CampaignBrandRow[] }> {
  await requireAdmin();
  const [settings, brands] = await Promise.all([readMarketingSettings(), readCampaignBrands()]);
  return { settings, brands };
}

export async function saveMarketingSettings(patch: Partial<MarketingSettings>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  // Validate first (lib/marketing/settings.ts, selftested): a bad value never costs a read, and nothing is written.
  const checked = validateSettingsPatch(patch);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (checked.rows.length === 0) return { ok: true };
  let before: MarketingSettings;
  try {
    before = await readMarketingSettings();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const now = new Date().toISOString();
  const rows = checked.rows.map((r) => ({ key: r.key, value: r.value, updated_by: session.sub, updated_at: now }));
  const { error } = await mdb.from("marketing_settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "marketing.settings", entityType: "marketing_settings", changes: { before, after: Object.fromEntries(rows.map((r) => [r.key, r.value])) }, actor: { id: session.sub, email: session.email, role: session.role } });
  // "traffic": the landing table's badges read the page thresholds.
  invalidateMarketing("pnl", "alerts", "traffic");
  return { ok: true };
}

export async function listCampaignBrands(): Promise<CampaignBrandRow[]> {
  await requireAdmin();
  return readCampaignBrands();
}

export async function setCampaignBrand(platform: AdPlatform, id: string, brand: AdBrand | "rule"): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if ((platform !== "meta" && platform !== "google") || typeof id !== "string" || id === "" || !(brand === "rule" || brand === "mega_events" || brand === "other")) return { ok: false, error: "invalid campaign or brand" };
  const patch = brand === "rule" ? { brand_source: "rule" } : { brand, brand_source: "manual" };
  const { data: updated, error } = await mdb.from("ad_entities").update(patch).eq("platform", platform).eq("id", id).eq("kind", "campaign").select("id");
  if (error) return { ok: false, error: error.message };
  // An UPDATE that matched nothing is not an error to PostgREST - without this the audit would record a change that never happened.
  if (!Array.isArray(updated) || updated.length === 0) return { ok: false, error: "campaign not found" };
  // Children follow the campaign at the next sync; do it now so the screen agrees at once.
  if (brand !== "rule") {
    const { error: childError } = await mdb.from("ad_entities").update({ brand }).eq("platform", platform).eq("campaign_id", id).neq("kind", "campaign");
    if (childError) console.error(`[marketing] setCampaignBrand children of ${platform}:${id}: ${childError.message}`);
  }
  await logAudit({ action: "marketing.brand", entityType: "ad_entities", entityId: `${platform}:${id}`, changes: patch, actor: { id: session.sub, email: session.email, role: session.role } });
  invalidateMarketing("pnl");
  return { ok: true };
}

export async function runMarketingSyncNow(): Promise<MarketingSyncSummary> {
  const session = await requireAdmin();
  await logAudit({ action: "marketing.sync_triggered", actor: { id: session.sub, email: session.email, role: session.role } });
  // The page's maxDuration is 300 (app/(dashboard)/marketing/page.tsx + vercel.json): 240 s leaves room for the
  // step in flight when the budget runs out, and a skipped step is reported ok:false ("skipped: budget").
  return runMarketingSync({ dryRun: false, budgetMs: 240_000 });
}
