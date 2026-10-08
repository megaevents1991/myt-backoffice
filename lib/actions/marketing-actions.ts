"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { mdb } from "@/lib/services/marketing-db";
import { attributedReservations } from "@/lib/services/marketing-purchases";
import { buildPnl, rangeWindow, MARKETING_RANGES, type MarketingRange, type Pnl } from "@/lib/services/marketing-pnl";
import { MARKETING_TAG, MARKETING_TTL_S, invalidateMarketing } from "@/lib/services/marketing-cache";
import { runMarketingSync, type MarketingSyncSummary } from "@/lib/services/marketing-sync";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type AdBrand, type AdPlatform, type IgMediaRow, type MarketingAlertRow, type MarketingSettings } from "@/types/marketing.types";

/**
 * Every read here THROWS on a database error (a missing table included, until the marketing
 * migration is applied): an empty list or a default setting would read as "nothing to see".
 * Server actions run behind requireAdmin() as the first line.
 */

async function readSettings(): Promise<MarketingSettings> {
  const { data, error } = await mdb.from("marketing_settings").select("key, value");
  if (error) throw new Error(`marketing_settings read: ${error.message}`);
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const row of (data ?? []) as { key: keyof MarketingSettings; value: unknown }[]) {
    if (MARKETING_SETTING_KEYS.includes(row.key)) (out as unknown as Record<string, unknown>)[row.key] = row.value;
  }
  return out;
}

/** PostgREST answers at most 1000 rows (max_rows) and says nothing - a plain `.limit(20000)` is
 *  the first 1000. Page by a stable order (the table's key) until a short page; throw past `max`. */
const PAGE = 1000;
async function readAll<T>(
  label: string,
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  max = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${label} read: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
  throw new Error(`${label} read: more than ${max} rows - narrow the range`);
}

async function buildPnlFor(range: MarketingRange, brand: AdBrand | "all"): Promise<Pnl & { since: string; until: string; settings: MarketingSettings }> {
  const { since, until } = rangeWindow(range);
  const [settings, reservations, spend, entities] = await Promise.all([
    readSettings(),
    attributedReservations(since, until),
    readAll<Parameters<typeof buildPnl>[0]["spend"][number]>("ad_spend_daily", () =>
      mdb.from("ad_spend_daily").select("platform, campaign_id, adset_key, day, spend_usd, clicks, impressions, platform_conversions, platform_value").gte("day", since).lte("day", until).order("day").order("platform").order("campaign_id").order("adset_key")),
    readAll<Parameters<typeof buildPnl>[0]["entities"][number]>("ad_entities", () =>
      mdb.from("ad_entities").select("platform, id, kind, name, brand, status, campaign_id, channel").in("kind", ["campaign", "adset", "ad_group"]).order("platform").order("id")),
  ]);
  return { ...buildPnl({ spend, entities, reservations, feePct: settings.processing_fee_pct, brand }), since, until, settings };
}

const cachedPnl = unstable_cache(buildPnlFor, ["marketing-pnl"], { tags: [MARKETING_TAG.pnl], revalidate: MARKETING_TTL_S.pnl });

export async function getMarketingPnl(range: MarketingRange, brand: AdBrand | "all") {
  await requireAdmin();
  const safeRange = MARKETING_RANGES.includes(range) ? range : "30d";
  const safeBrand = brand === "all" || brand === "other" ? brand : "mega_events";
  return cachedPnl(safeRange, safeBrand);
}

/** `viralPct` rides along (the editable `viral_pct` setting, 200 when never saved) so the grid's "ויראלי" badge
 *  uses the alert's own threshold without a second action on mount. */
export async function getInstagramFeed(): Promise<{ media: IgMediaRow[]; followers: { day: string; followers: number }[]; viralPct: number }> {
  await requireAdmin();
  const [m, f, settings] = await Promise.all([
    mdb.from("ig_media").select("*").order("posted_at", { ascending: false }).limit(200),
    mdb.from("ig_account_daily").select("day, followers").order("day", { ascending: false }).limit(90),
    readSettings(),
  ]);
  if (m.error) throw new Error(`ig_media read: ${m.error.message}`);
  if (f.error) throw new Error(`ig_account_daily read: ${f.error.message}`);
  return { media: m.data ?? [], followers: [...(f.data ?? [])].reverse(), viralPct: settings.viral_pct };
}

export async function getMarketingAlerts(): Promise<MarketingAlertRow[]> {
  await requireAdmin();
  const { data, error } = await mdb.from("marketing_alerts").select("*").order("first_seen_at", { ascending: false }).limit(200);
  if (error) throw new Error(`marketing_alerts read: ${error.message}`);
  return data ?? [];
}

export async function getMarketingSettings(): Promise<MarketingSettings> { await requireAdmin(); return readSettings(); }

export async function saveMarketingSettings(patch: Partial<MarketingSettings>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const before = await readSettings();
  const rows: { key: string; value: unknown; updated_by: string; updated_at: string }[] = [];
  for (const key of MARKETING_SETTING_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (key === "alert_emails") {
      if (!Array.isArray(v) || !v.every((e) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return { ok: false, error: "alert_emails must be valid addresses" };
    } else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false, error: `${key} must be a number ≥ 0` };
    rows.push({ key, value: v, updated_by: session.sub, updated_at: new Date().toISOString() });
  }
  if (rows.length === 0) return { ok: true };
  const { error } = await mdb.from("marketing_settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "marketing.settings", entityType: "marketing_settings", changes: { before, after: Object.fromEntries(rows.map((r) => [r.key, r.value])) }, actor: { id: session.sub, email: session.email, role: session.role } });
  invalidateMarketing("pnl", "alerts");
  return { ok: true };
}

export async function listCampaignBrands(): Promise<{ platform: AdPlatform; id: string; name: string; brand: AdBrand; brand_source: string; status: string | null }[]> {
  await requireAdmin();
  return readAll("ad_entities", () => mdb.from("ad_entities").select("platform, id, name, brand, brand_source, status").eq("kind", "campaign").order("name").order("platform").order("id"));
}

export async function setCampaignBrand(platform: AdPlatform, id: string, brand: AdBrand | "rule"): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  if ((platform !== "meta" && platform !== "google") || typeof id !== "string" || id === "" || !(brand === "rule" || brand === "mega_events" || brand === "other")) return { ok: false, error: "invalid campaign or brand" };
  const patch = brand === "rule" ? { brand_source: "rule" } : { brand, brand_source: "manual" };
  const { error } = await mdb.from("ad_entities").update(patch).eq("platform", platform).eq("id", id).eq("kind", "campaign");
  if (error) return { ok: false, error: error.message };
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
  return runMarketingSync({ dryRun: false, budgetMs: 50_000 });
}
