/**
 * marketingSync - one cron, six steps, each in its own try/catch so one source failing
 * never skips the next (spec section 4). `dryRun` reads everything, writes nothing, mails
 * nothing. `only` runs one step. `backfillDays` widens the spend / click window for a one-off.
 */
import { mdb } from "@/lib/services/marketing-db";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { fetchMetaEntities, fetchMetaSpend } from "@/lib/services/ads/meta";
import { fetchGoogleClicks, fetchGoogleEntities, fetchGoogleSpend } from "@/lib/services/ads/google";
import { fetchIgAccount, fetchIgMedia, fetchIgMediaInsights, fetchIgStories } from "@/lib/services/ads/instagram";
import { fillTicketCosts } from "@/lib/services/reservation-cogs-fill";
import { runMarketingAlerts } from "@/lib/services/marketing-alerts";
import { invalidateMarketing } from "@/lib/services/marketing-cache";
import type { AdEntityRow, IgMediaRow } from "@/types/marketing.types";

export type SyncStep = "meta" | "google" | "instagram" | "cogs" | "alerts" | "retention";
export interface StepResult { step: SyncStep; ok: boolean; rows: number; note: string; ms: number }
export interface MarketingSyncSummary { dryRun: boolean; steps: StepResult[]; startedAt: string; ms: number }

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => day(new Date(Date.now() - n * 864e5));

/** One batch may not hold the same conflict key twice ("ON CONFLICT DO UPDATE command cannot affect row a second time" fails the whole call) - the last row wins, as sequential upserts would. */
function dedupeByKey(rows: unknown[], onConflict: string): unknown[] {
  const cols = onConflict.split(",").map((c) => c.trim());
  const byKey = new Map<string, unknown>();
  for (const r of rows) byKey.set(cols.map((c) => String((r as Record<string, unknown>)[c] ?? "")).join("\u0000"), r);
  return [...byKey.values()];
}

async function upsert(table: string, rows: unknown[], onConflict: string, dryRun: boolean): Promise<number> {
  const unique = dedupeByKey(rows, onConflict);
  if (dryRun || unique.length === 0) return unique.length;
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await mdb.from(table).upsert(unique.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
  return unique.length;
}

let warnedMissingEntities = false;

/** Keep a manual brand; copy the campaign's brand onto its adsets / ad groups / ads. */
async function writeEntities(rows: AdEntityRow[], platform: "meta" | "google", dryRun: boolean): Promise<number> {
  const { data: manual, error: manualError } = await mdb.from("ad_entities").select("id, brand").eq("platform", platform).eq("brand_source", "manual");
  if (manualError) {
    // The table is created by migration 20261008120000: until it lands a dry run has no manual brands to keep. Any other read error must not be swallowed.
    const missing = manualError.code === "42P01" || /does not exist/i.test(String(manualError.message));
    if (!missing) throw new Error(`ad_entities manual-brand read: ${manualError.message}`);
    if (!warnedMissingEntities) {
      warnedMissingEntities = true;
      console.warn(`[marketingSync] ad_entities not found (${manualError.message}) - treating every brand as rule-made`);
    }
  }
  const manualBrand = new Map<string, AdEntityRow["brand"]>((manual ?? []).map((m: { id: string; brand: AdEntityRow["brand"] }) => [m.id, m.brand]));
  const campaignBrand = new Map<string, AdEntityRow["brand"]>();
  for (const r of rows) if (r.kind === "campaign") campaignBrand.set(r.id, manualBrand.get(r.id) ?? r.brand);
  const out = rows.map((r) => {
    const brand = r.kind === "campaign" ? (campaignBrand.get(r.id) ?? r.brand) : (campaignBrand.get(r.campaign_id ?? "") ?? r.brand);
    const isManual = r.kind === "campaign" && manualBrand.has(r.id);
    return { ...r, brand, brand_source: isManual ? "manual" : "rule", updated_at: new Date().toISOString() };
  });
  return upsert("ad_entities", out, "platform,id", dryRun);
}

async function step(name: SyncStep, fn: () => Promise<{ rows: number; note?: string }>): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { step: name, ok: true, rows: r.rows, note: r.note ?? "", ms: Date.now() - t0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[marketingSync] ${name} failed: ${message}`);
    return { step: name, ok: false, rows: 0, note: message, ms: Date.now() - t0 };
  }
}

export async function runMarketingSync(opts: { dryRun: boolean; only?: SyncStep; backfillDays?: number; budgetMs?: number }): Promise<MarketingSyncSummary> {
  const startedAt = new Date();
  const budgetMs = opts.budgetMs ?? 270_000;
  const over = () => Date.now() - startedAt.getTime() > budgetMs;
  const want = (s: SyncStep) => !opts.only || opts.only === s;
  const steps: StepResult[] = [];
  const window = opts.backfillDays ?? 7;

  // convertToUSD reads the in-memory rates only (they start as a fallback stamped at epoch), so refresh them ONCE
  // before the spend steps need them. updateAllExchangeRates never throws - a failed fetch keeps the previous rate.
  const needsFx = want("meta") || want("google");
  if (needsFx) await multiCurrencyExchangeRateService.updateAllExchangeRates();
  const fxIls = multiCurrencyExchangeRateService.convertToUSD(1, "ILS"); // USD per 1 ILS
  const fxFallback = needsFx && multiCurrencyExchangeRateService.getAllExchangeRates().ILS.source === "fallback";
  const fxNote = fxFallback ? ` (ILS rate is the built-in fallback ${fxIls})` : "";
  if (fxFallback) console.warn(`[marketingSync] ILS rate refresh failed - spend_usd uses the fallback ${fxIls}`);

  if (want("meta")) steps.push(await step("meta", async () => {
    const accountId = process.env.NEXT_SECRET_META_AD_ACCOUNT_ID?.trim();
    if (!accountId) throw new Error("NEXT_SECRET_META_AD_ACCOUNT_ID is not set");
    const spend = await fetchMetaSpend({ accountId, since: daysAgo(window), until: daysAgo(0), currency: "ILS", fxRate: fxIls });
    const entities = await fetchMetaEntities({ accountId });
    const a = await upsert("ad_spend_daily", spend, "platform,campaign_id,adset_key,day", opts.dryRun);
    const b = await writeEntities(entities, "meta", opts.dryRun);
    return { rows: a + b, note: `${a} spend rows, ${b} entities${fxNote}` };
  }));

  if (want("google") && !over()) steps.push(await step("google", async () => {
    const customerId = process.env.NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID?.trim();
    if (!customerId) throw new Error("NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID is not set");
    const spend = await fetchGoogleSpend({ customerId, since: daysAgo(window), until: daysAgo(0), currency: "ILS", fxRate: fxIls });
    const entities = await fetchGoogleEntities({ customerId });
    const a = await upsert("ad_spend_daily", spend, "platform,campaign_id,adset_key,day", opts.dryRun);
    const b = await writeEntities(entities, "google", opts.dryRun);
    // click_view: the last 3 days every run; a backfill walks back day by day until the budget says stop.
    const clickDays = opts.backfillDays ? Math.min(opts.backfillDays, 90) : 3;
    let clicks = 0;
    let remaining = 0;
    for (let i = 0; i < clickDays; i += 1) {
      if (over()) { remaining = clickDays - i; break; }
      clicks += await upsert("ad_clicks", await fetchGoogleClicks({ customerId, day: daysAgo(i) }), "gclid", opts.dryRun);
    }
    return { rows: a + b + clicks, note: `${a} spend rows, ${b} entities, ${clicks} clicks${remaining ? `, ${remaining} click days left for the next run` : ""}${fxNote}` };
  }));

  if (want("instagram") && !over()) steps.push(await step("instagram", async () => {
    const igUserId = process.env.NEXT_SECRET_META_IG_USER_ID?.trim();
    if (!igUserId) throw new Error("NEXT_SECRET_META_IG_USER_ID is not set");
    // Stories are a bonus read: a failure (e.g. more than 50 live) must not cost the feed posts their write.
    let stories: IgMediaRow[] = [];
    let storiesNote = "";
    try {
      stories = await fetchIgStories({ igUserId });
    } catch (error) {
      storiesNote = `, stories skipped (${error instanceof Error ? error.message : String(error)})`;
      console.warn(`[marketingSync] instagram stories: ${storiesNote.slice(2)}`);
    }
    const media = [...(await fetchIgMedia({ igUserId, limit: 100 })), ...stories];
    const today = daysAgo(0);
    const withInsights: IgMediaRow[] = [];
    const mediaOnly: Omit<IgMediaRow, "reach" | "saved" | "shares" | "views" | "insights_at">[] = [];
    const daily: unknown[] = [];
    for (const m of media) {
      if (over()) break;
      const ins = await fetchIgMediaInsights(m);
      if (ins) {
        withInsights.push({ ...m, ...ins, insights_at: new Date().toISOString() });
        daily.push({ media_id: m.id, day: today, reach: ins.reach, saved: ins.saved, shares: ins.shares, views: ins.views, likes: m.like_count, comments: m.comments_count });
      } else {
        // No fresh insights: upsert the media columns only so the stored counters are not zeroed.
        const { reach: _r, saved: _s, shares: _sh, views: _v, insights_at: _i, ...rest } = m;
        mediaOnly.push(rest);
      }
    }
    const a = (await upsert("ig_media", withInsights, "id", opts.dryRun)) + (await upsert("ig_media", mediaOnly, "id", opts.dryRun));
    const b = await upsert("ig_media_insights_daily", daily, "media_id,day", opts.dryRun);
    const acct = await fetchIgAccount({ igUserId });
    await upsert("ig_account_daily", [{ ig_user_id: igUserId, day: today, followers: acct.followers, media_count: acct.mediaCount }], "ig_user_id,day", opts.dryRun);
    return { rows: a + b, note: `${media.length} media, ${daily.length} insight rows, ${acct.followers} followers${storiesNote}` };
  }));

  if (want("cogs") && !over()) steps.push(await step("cogs", async () => {
    const r = await fillTicketCosts({ dryRun: opts.dryRun, limit: 200 });
    return { rows: r.filled, note: `${r.filled} filled, ${r.skipped} skipped${r.errors.length ? `, ${r.errors.length} errors: ${r.errors.slice(0, 3).join(" | ")}` : ""}` };
  }));

  if (want("alerts") && !over()) steps.push(await step("alerts", async () => {
    const r = await runMarketingAlerts({ dryRun: opts.dryRun });
    return { rows: r.newAlerts, note: `${r.newAlerts} new, ${r.mailed} mailed, ${r.resolved} resolved, mail ${r.mail}` };
  }));

  if (want("retention") && !over()) steps.push(await step("retention", async () => {
    if (opts.dryRun) {
      const { count: c1, error: d1 } = await mdb.from("ad_clicks").select("gclid", { count: "exact", head: true }).lt("day", daysAgo(100));
      const { count: c2, error: d2 } = await mdb.from("ig_media_insights_daily").select("media_id", { count: "exact", head: true }).lt("day", daysAgo(180));
      // A HEAD count on a table that does not exist answers 204 with NO error and a null count (measured 2026-10-08) - null is a failure, never "0 rows".
      if (d1 || d2 || c1 === null || c2 === null) throw new Error((d1 ?? d2)?.message ?? "retention count unavailable (ad_clicks / ig_media_insights_daily missing?)");
      return { rows: 0, note: `would delete ${c1 ?? 0} clicks, ${c2 ?? 0} insight rows` };
    }
    const { error: e1 } = await mdb.from("ad_clicks").delete().lt("day", daysAgo(100));
    const { error: e2 } = await mdb.from("ig_media_insights_daily").delete().lt("day", daysAgo(180));
    if (e1 || e2) throw new Error((e1 ?? e2).message);
    return { rows: 0, note: "pruned" };
  }));

  if (!opts.dryRun) invalidateMarketing();
  return { dryRun: opts.dryRun, steps, startedAt: startedAt.toISOString(), ms: Date.now() - startedAt.getTime() };
}
