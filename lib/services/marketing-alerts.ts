/**
 * Marketing alerts (spec section 6): pure rules + a runner that dedupes through `marketing_alerts` and mails once per
 * new alert. Thresholds come from marketing_settings. scripts/marketing-alerts-selftest.ts covers the rules; the page
 * and influencer pairs (spec 2026-10-28) live in lib/marketing/perf-alerts.ts (scripts/marketing-sales-selftest.ts).
 */
import { mdb, readAll } from "@/lib/services/marketing-db";
import { appOrigin, sendMail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { getPurchasesByCampaign } from "@/lib/services/marketing-purchases";
import { IG_MEDIA_READ, viralPosts, type ViralMedia } from "@/lib/marketing/engagement";
import { ga4BatchReports, ga4Configured } from "@/lib/services/ga4";
import { influencerStats } from "@/lib/services/marketing-influencers";
import { salesBreakdown } from "@/lib/services/marketing-sales";
import { pageSales } from "@/lib/services/marketing-page-sales";
import { addDays, israelToday, previousWindow } from "@/lib/marketing/range";
import { influencerAlertCandidates, pageAlertCandidates, pageTotals, type AlertCandidate } from "@/lib/marketing/perf-alerts";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type AdBrand, type MarketingAlertKind, type MarketingSettings } from "@/types/marketing.types";

export type { AlertCandidate } from "@/lib/marketing/perf-alerts";

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/** First day (YYYY-MM-DD) of a window of `days` days ending today - the rule's `since` and the runner's spend read share it. */
export const windowStart = (now: Date, days: number): string => dayStr(new Date(now.getTime() - (days - 1) * 864e5));

export function budgetBleedAlerts(input: { spend: { campaign_id: string; day: string; spend: number; brand: AdBrand; name: string }[]; purchasesByCampaign: Map<string, number>; settings: Pick<MarketingSettings, "budget_bleed_ils" | "budget_bleed_days">; now: Date }): AlertCandidate[] {
  const since = windowStart(input.now, input.settings.budget_bleed_days);
  const byCampaign = new Map<string, { spend: number; name: string }>();
  for (const s of input.spend) {
    if (s.brand !== "mega_events" || s.day < since) continue;
    const c = byCampaign.get(s.campaign_id) ?? { spend: 0, name: s.name };
    c.spend += s.spend;
    byCampaign.set(s.campaign_id, c);
  }
  const out: AlertCandidate[] = [];
  for (const [id, c] of byCampaign) {
    if (c.spend > input.settings.budget_bleed_ils && (input.purchasesByCampaign.get(id) ?? 0) === 0) {
      out.push({ kind: "budget_bleed", key: id, title: `${c.name}: ₪${Math.round(c.spend)} in ${input.settings.budget_bleed_days} day${input.settings.budget_bleed_days === 1 ? "" : "s"} with no purchase`, payload: { campaign_id: id, name: c.name, spend_ils: Math.round(c.spend * 100) / 100, days: input.settings.budget_bleed_days } });
    }
  }
  return out;
}

/** Only a post published within this many days may raise a viral alert - an old post that crosses the bar late (or a
 *  first sync over a year of posts) is no news. The grid's badge is NOT capped: it is a display. */
export const VIRAL_MAX_AGE_DAYS = 7;

/** The candidates of the viral rule - the rule itself (`viralPosts`) lives in lib/marketing/engagement.ts, shared with the grid's badge. */
export function viralPostAlerts(input: { media: ViralMedia[]; settings: Pick<MarketingSettings, "viral_pct">; now: Date }): AlertCandidate[] {
  const oldest = input.now.getTime() - VIRAL_MAX_AGE_DAYS * 864e5;
  return viralPosts(input.media, input.settings.viral_pct, input.now)
    .filter(({ media: m }) => new Date(m.posted_at as string).getTime() >= oldest)
    .map(({ media: m, engagement, mean }) => ({
      kind: "viral_post" as const,
      key: m.id,
      // The mail prints the kind ("Viral post") in front of the title, so the title is the numbers alone.
      title: `${engagement} engagement vs an average of ${Math.round(mean)}`,
      payload: { media_id: m.id, engagement, mean: Math.round(mean) },
    }));
}

/** A failed read must never look like "no rows": an empty spend list reads as "no candidates" and would resolve every open alert. */
export function rowsOrThrow<T>(table: string, res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(`alerts read ${table}: ${res.error.message}`);
  return res.data ?? [];
}

export interface OpenAlertRow { kind: string; key: string; last_mailed_at: string | null }

/**
 * Pure: what a run does with the candidates against the OPEN alert rows.
 * fresh = not open yet (written); toMail = fresh + still-live open alerts whose mail never went out (last_mailed_at null -
 * a failed sendMail must be retried next run), deduped by kind:key; toResolve = open keys no candidate asks for any more.
 * `skipped` = kinds this run could not evaluate (GA4 not connected or failing): their open alerts are left as they
 * are - "not checked" is not "cleared".
 */
export function planAlerts(candidates: AlertCandidate[], openRows: OpenAlertRow[], skipped: ReadonlySet<string> = new Set()): { fresh: AlertCandidate[]; toMail: AlertCandidate[]; toResolve: string[] } {
  const id = (c: { kind: string; key: string }) => `${c.kind}:${c.key}`;
  const open = new Set(openRows.map(id));
  const unmailed = new Set(openRows.filter((a) => !a.last_mailed_at).map(id));
  const fresh = candidates.filter((c) => !open.has(id(c)));
  const toMail = new Map<string, AlertCandidate>();
  for (const c of [...fresh, ...candidates.filter((c) => unmailed.has(id(c)))]) if (!toMail.has(id(c))) toMail.set(id(c), c);
  const still = new Set(candidates.map(id));
  return { fresh, toMail: [...toMail.values()], toResolve: [...open].filter((k) => !still.has(k) && !skipped.has(k.slice(0, k.indexOf(":")))) };
}

async function settings(): Promise<MarketingSettings> {
  const data = rowsOrThrow<{ key: keyof MarketingSettings; value: unknown }>("marketing_settings", await mdb.from("marketing_settings").select("key, value"));
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const r of data) if (MARKETING_SETTING_KEYS.includes(r.key)) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  return out;
}

/** The kind's name - the same words as the "Alerts" tab's badges (alerts-tab.tsx) and the guide. */
export const ALERT_KIND_LABEL: Record<MarketingAlertKind, string> = {
  budget_bleed: "Budget bleed",
  viral_post: "Viral post",
  page_no_sales: "Page with no sales",
  page_converting: "Converting page",
  influencer_no_sales: "Influencer with no sales",
  influencer_selling: "Influencer selling",
};

/** Pure: the mail body. Every interpolated value is escaped - a campaign title starts with `ad_entities.name`, whatever someone typed in Ads Manager. */
export function alertMailHtml(items: AlertCandidate[], origin: string): string {
  return [`<div dir="ltr">`, ...items.map((c) => `<p><b>${ALERT_KIND_LABEL[c.kind]}</b> - ${escapeHtml(c.title)}</p>`), `<p><a href="${escapeHtml(origin)}/marketing?tab=alerts">All alerts</a></p></div>`].join("");
}

const WRITE_CHUNK = 200; // a `.in()` filter travels in the URL

/** One update per kind and chunk of keys; a failed write THROWS (a silent failure here re-mails or re-opens alerts every run). */
async function patchAlerts(items: { kind: string; key: string }[], patch: Record<string, string | null>, what: string): Promise<void> {
  const byKind = new Map<string, string[]>();
  for (const it of items) byKind.set(it.kind, [...(byKind.get(it.kind) ?? []), it.key]);
  for (const [kind, keys] of byKind) {
    for (let i = 0; i < keys.length; i += WRITE_CHUNK) {
      const { error } = await mdb.from("marketing_alerts").update(patch).eq("kind", kind).in("key", keys.slice(i, i + WRITE_CHUNK));
      if (error) throw new Error(`alerts write marketing_alerts (${what}): ${error.message}`);
    }
  }
}

const PAGE_KINDS: MarketingAlertKind[] = ["page_no_sales", "page_converting"];

/** The page pair: sessions per landing page in the last `page_alert_days` Israel days and the days before them (GA4,
 *  one batch, two reports), against OUR Paid orders of what each page sells (lib/marketing/page-subject.ts). Only a
 *  page with enough sessions to be judged is looked up. Throws on a GA4 failure - the caller decides what that means. */
async function pageCandidates(s: MarketingSettings, open: Set<string>, now: Date): Promise<AlertCandidate[]> {
  const until = israelToday(now);
  const since = addDays(until, -(s.page_alert_days - 1));
  const prev = previousWindow(since, until);
  const report = (startDate: string, endDate: string) => ({
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "landingPage" }, { name: "eventName" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "session_start" } } },
  });
  const [cur, before] = await ga4BatchReports([report(since, until), report(prev.since, prev.until)]);
  const rows = (r: { dims: string[]; mets: number[] }[]) => r.map((x) => ({ landingPage: x.dims[0], eventName: x.dims[1], sessions: x.mets[0] }));
  const pages = pageTotals(rows(cur));
  const prevPages = pageTotals(rows(before));
  const judged = [...pages].filter(([, p]) => p.sessions >= s.page_min_sessions).map(([page]) => page);
  if (judged.length === 0) return [];
  const sold = await pageSales(judged, await salesBreakdown(since, until, "all", "usd"));
  return pageAlertCandidates({
    pages: judged.map((page) => ({ page, sessions: pages.get(page)?.sessions ?? 0, prevSessions: prevPages.get(page)?.sessions ?? 0, sold: sold.get(page)?.sold ?? null, prevSold: sold.get(page)?.prevSold ?? null })),
    settings: s,
    open,
  });
}

/** The influencer pair over the Partners screen's numbers, in the last `influencer_alert_days` Israel days. */
async function influencerCandidates(s: MarketingSettings, open: Set<string>, now: Date): Promise<AlertCandidate[]> {
  const until = israelToday(now);
  const since = addDays(until, -(s.influencer_alert_days - 1));
  const view = await influencerStats(since, until, "usd", s);
  return influencerAlertCandidates({ rows: view.rows.map((r) => ({ code: r.code, name: r.name, visitors: r.visitors, paid: r.paid, prevVisitors: r.prevVisitors, prevPaid: r.prevPaid })), settings: s, open });
}

/**
 * Evaluate every rule over the stored tables (pages: GA4), dedupe, mail the new ones (and any open one whose mail never went out).
 * A failed read or write throws. `last_mailed_at` is the mail's idempotency key, so it is stamped BEFORE the send and
 * cleared again if the send fails - a failed stamp can never mail on every run, a failed send is retried next run.
 */
export async function runMarketingAlerts(opts: { dryRun: boolean }): Promise<{ newAlerts: number; resolved: number; mailed: number; mail: "sent" | "skipped" | "failed"; pages: string; wouldOpen?: string[] }> {
  const now = new Date();
  const s = await settings();
  const windowSince = windowStart(now, s.budget_bleed_days);
  const [spendRows, entRows, mediaRes, openRes, purchasesByCampaign] = await Promise.all([
    // adset_key is selected only because it is part of the order (= the dedupe key): without it two adsets of one campaign-day would collapse.
    readAll<{ campaign_id: string; platform: string; day: string; adset_key: string; spend: number }>("ad_spend_daily", "campaign_id, platform, day, adset_key, spend", ["day", "platform", "campaign_id", "adset_key"], 50_000, "alerts",
      (q) => q.gte("day", windowSince)),
    readAll<{ platform: string; id: string; name: string; brand: AdBrand }>("ad_entities", "platform, id, name, brand", ["platform", "id"], 50_000, "alerts",
      (q) => q.eq("kind", "campaign")),
    // The same window the grid reads (IG_MEDIA_READ), so the baseline behind the alert is the badge's.
    mdb.from("ig_media").select("id, posted_at, like_count, comments_count, saved, shares, media_product_type").order("posted_at", { ascending: false }).limit(IG_MEDIA_READ),
    mdb.from("marketing_alerts").select("kind, key, last_mailed_at").is("resolved_at", null),
    getPurchasesByCampaign(windowSince, dayStr(now)),
  ]);
  // Check every read BEFORE computing anything: a failed read must never look like "no candidates".
  const mediaRows = rowsOrThrow<{ id: string; posted_at: string | null; like_count: number; comments_count: number; saved: number; shares: number; media_product_type: string | null }>("ig_media", mediaRes);
  const openRows = rowsOrThrow<OpenAlertRow>("marketing_alerts", openRes);
  const ent = new Map<string, { name: string; brand: AdBrand }>(entRows.map((e) => [`${e.platform}:${e.id}`, e]));
  const spend = spendRows.map((r) => ({ campaign_id: r.campaign_id, day: r.day, spend: Number(r.spend), brand: ent.get(`${r.platform}:${r.campaign_id}`)?.brand ?? ("other" as AdBrand), name: ent.get(`${r.platform}:${r.campaign_id}`)?.name ?? r.campaign_id }));
  const openKeys = new Set(openRows.map((a) => `${a.kind}:${a.key}`));
  // Pages need GA4: not connected = not evaluated (their open alerts stay); a GA4 failure is reported after the rest
  // of the run went through (`pages`), never mistaken for "no page qualifies".
  const skipped = new Set<string>();
  let pages = "checked";
  let pageList: AlertCandidate[] = [];
  if (!ga4Configured()) {
    PAGE_KINDS.forEach((k) => skipped.add(k));
    pages = "skipped (GA4 not connected)";
  } else {
    try {
      pageList = await pageCandidates(s, openKeys, now);
    } catch (e) {
      PAGE_KINDS.forEach((k) => skipped.add(k));
      pages = `GA4 failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const candidates = [
    ...budgetBleedAlerts({ spend, purchasesByCampaign, settings: s, now }),
    ...viralPostAlerts({ media: mediaRows, settings: s, now }),
    ...pageList,
    ...(await influencerCandidates(s, openKeys, now)),
  ];
  const { fresh, toMail, toResolve } = planAlerts(candidates, openRows, skipped);
  if (!opts.dryRun) {
    if (fresh.length) {
      const { error } = await mdb.from("marketing_alerts").upsert(fresh.map((c) => ({ kind: c.kind, key: c.key, payload: c.payload, first_seen_at: now.toISOString(), resolved_at: null, last_mailed_at: null })), { onConflict: "kind,key" });
      if (error) throw new Error(`alerts write marketing_alerts (upsert): ${error.message}`);
    }
    await patchAlerts(toResolve.map((k) => { const i = k.indexOf(":"); return { kind: k.slice(0, i), key: k.slice(i + 1) }; }), { resolved_at: now.toISOString() }, "resolve");
  }
  let mail: "sent" | "skipped" | "failed" = "skipped";
  const to = s.alert_emails.length ? s.alert_emails.join(",") : process.env.NEXT_SECRET_ADMIN_EMAIL;
  let mailed = 0;
  if (toMail.length && to && !opts.dryRun) {
    await patchAlerts(toMail, { last_mailed_at: now.toISOString() }, "stamp"); // throws on failure: nothing is mailed unmarked
    try {
      await sendMail({ to, subject: `MYT Admin · ${toMail.length} marketing alert${toMail.length === 1 ? "" : "s"}`, html: alertMailHtml(toMail, appOrigin()) });
      mail = "sent";
      mailed = toMail.length;
    } catch (e) {
      console.error("[marketing-alerts] mail failed", e);
      mail = "failed";
      try { await patchAlerts(toMail, { last_mailed_at: null }, "unstamp"); } catch (u) { console.error("[marketing-alerts] could not clear the mail stamp - these alerts will not be retried", u); }
    }
  }
  // A dry run names what it would open (the cron's `?dry_run=1&only=alerts` is how a threshold is tried on prod).
  return { newAlerts: fresh.length, resolved: toResolve.length, mailed, mail, pages, ...(opts.dryRun ? { wouldOpen: fresh.map((c) => `${ALERT_KIND_LABEL[c.kind]}: ${c.title}`) } : {}) };
}
