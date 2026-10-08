/**
 * marketingSync - one cron, six steps, each in its own try/catch so one source failing
 * never skips the next (spec section 4). `dryRun` reads everything, writes nothing, mails
 * nothing. `only` runs one step. `backfillDays` widens the spend / click window for a one-off.
 *
 * Rules kept here (final review, 2026-10-08):
 *  - Spend is written right after it is fetched, BEFORE the slow entity walk (Meta's ads edge is
 *    most of a run): an entity walk that fails or runs out of time never costs the tick its spend.
 *  - `spend_usd` uses the UNROUNDED ILS rate (`getRawRate`, lib/services/ticket-price-sync.ts - that
 *    service's `rate` is ceil'd to 2 decimals for the ticket sync, ~1-3% off at 0.27). When the refresh
 *    failed and the rate is still the built-in fallback, NO spend is written: the meta / google steps
 *    fail "ILS rate unavailable (fallback) - spend not written, retried next tick" (entities and
 *    clicks are still written - they carry no money).
 *  - ticket-price-sync is imported dynamically inside the FX block: its module builds a service that
 *    throws without the supplier env, and a static import took every /marketing action down with it.
 *  - A step skipped because the budget is spent is reported `ok: false`, "skipped: budget" - the run is
 *    not ok and the failure mail names the step.
 *  - The click_view walk always re-reads the last CLICK_REFRESH_DAYS days (today's clicks keep coming)
 *    and, on a backfill, only the older days that have no row in `ad_clicks` yet, oldest first - so a
 *    backfill the budget cut short resumes where it stopped when it is run again.
 */
import { isMissingRelation, mdb, readAll } from "@/lib/services/marketing-db";
import { fetchMetaEntities, fetchMetaSpend } from "@/lib/services/ads/meta";
import { fetchGoogleClicks, fetchGoogleEntities, fetchGoogleSpend } from "@/lib/services/ads/google";
import { fetchIgAccount, fetchIgMedia, fetchIgMediaInsights, fetchIgStories } from "@/lib/services/ads/instagram";
import { fillTicketCosts } from "@/lib/services/reservation-cogs-fill";
import { runMarketingAlerts } from "@/lib/services/marketing-alerts";
import { invalidateMarketing } from "@/lib/services/marketing-cache";
import type { AdEntityRow, IgMediaRow } from "@/types/marketing.types";

export type SyncStep = "meta" | "google" | "instagram" | "cogs" | "alerts" | "retention";
export const SYNC_STEPS: readonly SyncStep[] = ["meta", "google", "instagram", "cogs", "alerts", "retention"];
export interface StepResult { step: SyncStep; ok: boolean; rows: number; note: string; ms: number }
export interface MarketingSyncSummary { dryRun: boolean; steps: StepResult[]; startedAt: string; ms: number }

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => day(new Date(Date.now() - n * 864e5));
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The click_view days every run re-reads, and the deepest a backfill walks. */
const CLICK_REFRESH_DAYS = 3;
const CLICK_DAYS_MAX = 90;
/** The ticket-cost fill stops this long before the run's budget, so the alerts / retention steps still fit. */
const COGS_RESERVE_MS = 20_000;
/** The Meta entity walk (~1,800 ads at 50 a page) measured ~75-95 s on prod; with less than this left after the spend read it waits for the next tick. */
const META_ENTITIES_RESERVE_MS = 100_000;
export const FX_UNAVAILABLE = "ILS rate unavailable (fallback) - spend not written, retried next tick";

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
    // Only a MISSING table is tolerated (migration 20261008120000 not applied yet - a dry run then has no manual
    // brands to keep): 42P01 from Postgres, PGRST205 from PostgREST's schema cache. Any other read error throws.
    if (!isMissingRelation(manualError)) throw new Error(`ad_entities manual-brand read: ${manualError.message}`);
    if (!warnedMissingEntities) {
      warnedMissingEntities = true;
      console.warn(`[marketingSync] ad_entities not found (${manualError.code}: ${manualError.message}) - treating every brand as rule-made`);
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

/** The days of [since..until] that already have a click row. A missing table (dry run before the migration) = none. */
async function clickDaysPresent(since: string, until: string): Promise<Set<string>> {
  try {
    const rows = await readAll<{ day: string; gclid: string }>("ad_clicks", "day, gclid", ["day", "gclid"], 300_000, "marketingSync", (q) => q.gte("day", since).lte("day", until));
    return new Set(rows.map((r) => r.day));
  } catch (e) {
    if (isMissingRelation(e)) return new Set();
    throw e;
  }
}

/** The fetch that follows a spend write: a failure says the spend is already in, so the note is not misread as "nothing written". */
async function afterSpend<T>(spendNote: string, what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`${spendNote}; ${what} failed: ${messageOf(e)}`);
  }
}

async function step(name: SyncStep, fn: () => Promise<{ rows: number; note?: string }>): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { step: name, ok: true, rows: r.rows, note: r.note ?? "", ms: Date.now() - t0 };
  } catch (error) {
    const message = messageOf(error);
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
  /** Run a wanted step - or, when the budget is already spent, record it as a failed skip (never a silent one). */
  const run = async (name: SyncStep, fn: () => Promise<{ rows: number; note?: string }>) => {
    if (!want(name)) return;
    if (over()) {
      console.warn(`[marketingSync] ${name} skipped: budget`);
      steps.push({ step: name, ok: false, rows: 0, note: "skipped: budget", ms: 0 });
      return;
    }
    steps.push(await step(name, fn));
  };

  // convertToUSD / the rates are in-memory and start as a fallback stamped at epoch, so refresh them ONCE before
  // the spend steps. updateAllExchangeRates never throws (a failed fetch keeps the previous rate); the import can
  // (the module's TicketPriceSyncService throws without the supplier env) - both end as "no usable rate".
  let fxIls = 0;
  let fxProblem: string | null = null;
  if (want("meta") || want("google")) {
    try {
      const { multiCurrencyExchangeRateService: fx } = await import("@/lib/services/ticket-price-sync");
      await fx.updateAllExchangeRates();
      if (fx.getAllExchangeRates().ILS.source === "fallback") fxProblem = "fallback";
      else fxIls = fx.getRawRate("ILS"); // USD per 1 ILS, unrounded
    } catch (e) {
      fxProblem = messageOf(e);
    }
    if (fxProblem) console.warn(`[marketingSync] ILS rate unavailable (${fxProblem}) - no spend is written this run`);
  }
  const fxNote = fxProblem === null ? "" : `${FX_UNAVAILABLE}${fxProblem === "fallback" ? "" : ` (${fxProblem})`}`;

  await run("meta", async () => {
    const accountId = process.env.NEXT_SECRET_META_AD_ACCOUNT_ID?.trim();
    if (!accountId) throw new Error("NEXT_SECRET_META_AD_ACCOUNT_ID is not set");
    let a = 0;
    if (!fxProblem) {
      const spend = await fetchMetaSpend({ accountId, since: daysAgo(window), until: daysAgo(0), currency: "ILS", fxRate: fxIls });
      a = await upsert("ad_spend_daily", spend, "platform,campaign_id,adset_key,day", opts.dryRun);
    }
    const spendNote = fxProblem ? fxNote : `${a} spend rows written`;
    // A 90-day backfill's spend read alone takes ~180 s (13 windows); the entity walk ~90 s more. When the walk no longer
    // fits, keep the spend (already written) and leave the entities to the next tick - every tick walks them anyway.
    const left = startedAt.getTime() + budgetMs - Date.now();
    if (left < META_ENTITIES_RESERVE_MS) {
      if (fxProblem) throw new Error(`${fxNote} · entities skipped (budget)`);
      return { rows: a, note: `${a} spend rows, entities skipped (budget: ${Math.round(left / 1000)} s left, next tick walks them)` };
    }
    const b = await afterSpend(spendNote, "entities", async () => writeEntities(await fetchMetaEntities({ accountId }), "meta", opts.dryRun));
    if (fxProblem) throw new Error(`${fxNote} · ${b} entities`);
    return { rows: a + b, note: `${a} spend rows, ${b} entities` };
  });

  await run("google", async () => {
    const customerId = process.env.NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID?.trim();
    if (!customerId) throw new Error("NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID is not set");
    let a = 0;
    if (!fxProblem) {
      const spend = await fetchGoogleSpend({ customerId, since: daysAgo(window), until: daysAgo(0), currency: "ILS", fxRate: fxIls });
      a = await upsert("ad_spend_daily", spend, "platform,campaign_id,adset_key,day", opts.dryRun);
    }
    const spendNote = fxProblem ? fxNote : `${a} spend rows written`;
    const b = await afterSpend(spendNote, "entities", async () => writeEntities(await fetchGoogleEntities({ customerId }), "google", opts.dryRun));

    // click_view, one day per call: the last CLICK_REFRESH_DAYS always, plus - on a backfill - every older day of
    // the window with no click row yet. Oldest first; stops at the budget and says how many days are left.
    const n = Math.min(Math.max(1, Math.floor(opts.backfillDays ?? CLICK_REFRESH_DAYS)), CLICK_DAYS_MAX);
    const recent = Array.from({ length: Math.min(n, CLICK_REFRESH_DAYS) }, (_, i) => daysAgo(i));
    const older = Array.from({ length: Math.max(0, n - CLICK_REFRESH_DAYS) }, (_, i) => daysAgo(CLICK_REFRESH_DAYS + i));
    const present = older.length
      ? await afterSpend(`${spendNote}, ${b} entities`, "click-day read", () => clickDaysPresent(older[older.length - 1], older[0]))
      : new Set<string>();
    const missingOlder = older.filter((d) => !present.has(d));
    const walk = [...missingOlder, ...recent].sort(); // yyyy-mm-dd sorts by date: oldest first
    let clicks = 0;
    let walked = 0;
    for (const d of walk) {
      if (over()) break;
      clicks += await afterSpend(`${spendNote}, ${b} entities, ${clicks} clicks`, `clicks of ${d}`, async () => upsert("ad_clicks", await fetchGoogleClicks({ customerId, day: d }), "gclid", opts.dryRun));
      walked += 1;
    }
    const remaining = walk.length - walked;
    const skippedOlder = older.length - missingOlder.length;
    const clickNote = `${clicks} clicks over ${walked} days${skippedOlder ? ` (${skippedOlder} older days already synced)` : ""}${remaining ? `, ${remaining} click days still missing - run the backfill again` : ""}`;
    if (fxProblem) throw new Error(`${fxNote} · ${b} entities, ${clickNote}`);
    return { rows: a + b + clicks, note: `${a} spend rows, ${b} entities, ${clickNote}` };
  });

  await run("instagram", async () => {
    const igUserId = process.env.NEXT_SECRET_META_IG_USER_ID?.trim();
    if (!igUserId) throw new Error("NEXT_SECRET_META_IG_USER_ID is not set");
    // Stories are a bonus read: a failure (e.g. more than 50 live) must not cost the feed posts their write.
    let stories: IgMediaRow[] = [];
    let storiesNote = "";
    try {
      stories = await fetchIgStories({ igUserId });
    } catch (error) {
      storiesNote = `, stories skipped (${messageOf(error)})`;
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
  });

  await run("cogs", async () => {
    const r = await fillTicketCosts({ dryRun: opts.dryRun, limit: 200, deadlineMs: startedAt.getTime() + budgetMs - COGS_RESERVE_MS });
    return { rows: r.filled, note: `${r.filled} filled, ${r.skipped} skipped${r.remaining ? `, ${r.remaining} left for the next run (budget)` : ""}${r.errors.length ? `, ${r.errors.length} errors: ${r.errors.slice(0, 3).join(" | ")}` : ""}` };
  });

  await run("alerts", async () => {
    const r = await runMarketingAlerts({ dryRun: opts.dryRun });
    return { rows: r.newAlerts, note: `${r.newAlerts} new, ${r.mailed} mailed, ${r.resolved} resolved, mail ${r.mail}` };
  });

  await run("retention", async () => {
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
  });

  if (!opts.dryRun) invalidateMarketing();
  return { dryRun: opts.dryRun, steps, startedAt: startedAt.toISOString(), ms: Date.now() - startedAt.getTime() };
}
