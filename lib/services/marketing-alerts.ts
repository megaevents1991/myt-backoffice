/**
 * Marketing alerts (spec section 6): two pure rules + a runner that dedupes through
 * `marketing_alerts` and mails once per new alert. Thresholds come from marketing_settings.
 * scripts/marketing-alerts-selftest.ts covers the rules.
 */
import { mdb } from "@/lib/services/marketing-db";
import { appOrigin, sendMail } from "@/lib/email";
import { getPurchasesByCampaign } from "@/lib/services/marketing-purchases";
import { viralPosts, type ViralMedia } from "@/lib/marketing/engagement";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type AdBrand, type MarketingSettings } from "@/types/marketing.types";

export interface AlertCandidate { kind: "budget_bleed" | "viral_post"; key: string; title: string; payload: Record<string, unknown> }

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
      out.push({ kind: "budget_bleed", key: id, title: `${c.name}: ₪${Math.round(c.spend)} ב-${input.settings.budget_bleed_days} ימים בלי רכישה`, payload: { campaign_id: id, name: c.name, spend_ils: Math.round(c.spend * 100) / 100, days: input.settings.budget_bleed_days } });
    }
  }
  return out;
}

/** The candidates of the viral rule - the rule itself (`viralPosts`) lives in lib/marketing/engagement.ts, shared with the grid's badge. */
export function viralPostAlerts(input: { media: ViralMedia[]; settings: Pick<MarketingSettings, "viral_pct">; now: Date }): AlertCandidate[] {
  return viralPosts(input.media, input.settings.viral_pct, input.now).map(({ media: m, engagement, mean }) => ({
    kind: "viral_post" as const,
    key: m.id,
    title: `פוסט ויראלי: ${engagement} מעורבות מול ממוצע ${Math.round(mean)}`,
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
 */
export function planAlerts(candidates: AlertCandidate[], openRows: OpenAlertRow[]): { fresh: AlertCandidate[]; toMail: AlertCandidate[]; toResolve: string[] } {
  const id = (c: { kind: string; key: string }) => `${c.kind}:${c.key}`;
  const open = new Set(openRows.map(id));
  const unmailed = new Set(openRows.filter((a) => !a.last_mailed_at).map(id));
  const fresh = candidates.filter((c) => !open.has(id(c)));
  const toMail = new Map<string, AlertCandidate>();
  for (const c of [...fresh, ...candidates.filter((c) => unmailed.has(id(c)))]) if (!toMail.has(id(c))) toMail.set(id(c), c);
  const still = new Set(candidates.map(id));
  return { fresh, toMail: [...toMail.values()], toResolve: [...open].filter((k) => !still.has(k)) };
}

async function settings(): Promise<MarketingSettings> {
  const data = rowsOrThrow<{ key: keyof MarketingSettings; value: unknown }>("marketing_settings", await mdb.from("marketing_settings").select("key, value"));
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const r of data) if (MARKETING_SETTING_KEYS.includes(r.key)) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  return out;
}

const PAGE = 1000;

/** A plain select answers 1,000 rows at most and says nothing: page by a stable order until a short page; throw past `max` or on any error. */
export async function readAll<T>(
  label: string,
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  max = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE - 1);
    if (error) throw new Error(`alerts read ${label}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
  throw new Error(`alerts read ${label}: more than ${max} rows`);
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Pure: the mail body. Every interpolated value is escaped - a campaign title starts with `ad_entities.name`, whatever someone typed in Ads Manager. */
export function alertMailHtml(items: AlertCandidate[], origin: string): string {
  return [`<div dir="rtl">`, ...items.map((c) => `<p><b>${c.kind === "budget_bleed" ? "שריפת תקציב" : "ויראליות"}</b> - ${esc(c.title)}</p>`), `<p><a href="${esc(origin)}/marketing?tab=alerts">לכל ההתראות</a></p></div>`].join("");
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

/**
 * Evaluate both rules over the stored tables, dedupe, mail the new ones (and any open one whose mail never went out).
 * A failed read or write throws. `last_mailed_at` is the mail's idempotency key, so it is stamped BEFORE the send and
 * cleared again if the send fails - a failed stamp can never mail on every run, a failed send is retried next run.
 */
export async function runMarketingAlerts(opts: { dryRun: boolean }): Promise<{ newAlerts: number; resolved: number; mailed: number; mail: "sent" | "skipped" | "failed" }> {
  const now = new Date();
  const s = await settings();
  const windowSince = windowStart(now, s.budget_bleed_days);
  const [spendRows, entRows, mediaRes, openRes, purchasesByCampaign] = await Promise.all([
    readAll<{ campaign_id: string; platform: string; day: string; spend: number }>("ad_spend_daily", () =>
      mdb.from("ad_spend_daily").select("campaign_id, platform, day, spend").gte("day", windowSince).order("day").order("platform").order("campaign_id").order("adset_key")),
    readAll<{ platform: string; id: string; name: string; brand: AdBrand }>("ad_entities", () =>
      mdb.from("ad_entities").select("platform, id, name, brand").eq("kind", "campaign").order("platform").order("id")),
    mdb.from("ig_media").select("id, posted_at, like_count, comments_count, saved, shares, media_product_type").order("posted_at", { ascending: false }).limit(120),
    mdb.from("marketing_alerts").select("kind, key, last_mailed_at").is("resolved_at", null),
    getPurchasesByCampaign(windowSince, dayStr(now)),
  ]);
  // Check every read BEFORE computing anything: a failed read must never look like "no candidates".
  const mediaRows = rowsOrThrow<{ id: string; posted_at: string | null; like_count: number; comments_count: number; saved: number; shares: number; media_product_type: string | null }>("ig_media", mediaRes);
  const openRows = rowsOrThrow<OpenAlertRow>("marketing_alerts", openRes);
  const ent = new Map<string, { name: string; brand: AdBrand }>(entRows.map((e) => [`${e.platform}:${e.id}`, e]));
  const spend = spendRows.map((r) => ({ campaign_id: r.campaign_id, day: r.day, spend: Number(r.spend), brand: ent.get(`${r.platform}:${r.campaign_id}`)?.brand ?? ("other" as AdBrand), name: ent.get(`${r.platform}:${r.campaign_id}`)?.name ?? r.campaign_id }));
  const candidates = [...budgetBleedAlerts({ spend, purchasesByCampaign, settings: s, now }), ...viralPostAlerts({ media: mediaRows, settings: s, now })];
  const { fresh, toMail, toResolve } = planAlerts(candidates, openRows);
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
      await sendMail({ to, subject: `MYT Admin · ${toMail.length} התראות שיווק`, html: alertMailHtml(toMail, appOrigin()) });
      mail = "sent";
      mailed = toMail.length;
    } catch (e) {
      console.error("[marketing-alerts] mail failed", e);
      mail = "failed";
      try { await patchAlerts(toMail, { last_mailed_at: null }, "unstamp"); } catch (u) { console.error("[marketing-alerts] could not clear the mail stamp - these alerts will not be retried", u); }
    }
  }
  return { newAlerts: fresh.length, resolved: toResolve.length, mailed, mail };
}
