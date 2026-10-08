/**
 * Marketing alerts (spec section 6): two pure rules + a runner that dedupes through
 * `marketing_alerts` and mails once per new alert. Thresholds come from marketing_settings.
 * scripts/marketing-alerts-selftest.ts covers the rules.
 */
import { mdb } from "@/lib/services/marketing-db";
import { appOrigin, sendMail } from "@/lib/email";
import { getPurchasesByCampaign } from "@/lib/services/marketing-purchases";
import { baselineBefore, engagementOf } from "@/lib/marketing/engagement";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type AdBrand, type MarketingSettings } from "@/types/marketing.types";

export interface AlertCandidate { kind: "budget_bleed" | "viral_post"; key: string; title: string; payload: Record<string, unknown> }

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export function budgetBleedAlerts(input: { spend: { campaign_id: string; day: string; spend: number; brand: AdBrand; name: string }[]; purchasesByCampaign: Map<string, number>; settings: Pick<MarketingSettings, "budget_bleed_ils" | "budget_bleed_days">; now: Date }): AlertCandidate[] {
  const since = dayStr(new Date(input.now.getTime() - (input.settings.budget_bleed_days - 1) * 864e5));
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

export function viralPostAlerts(input: { media: { id: string; posted_at: string | null; like_count: number; comments_count: number; saved: number; shares: number; media_product_type: string | null }[]; settings: Pick<MarketingSettings, "viral_pct">; now: Date }): AlertCandidate[] {
  const posts = input.media.filter((m) => m.posted_at && m.media_product_type !== "STORY").sort((a, b) => (a.posted_at! < b.posted_at! ? -1 : 1));
  const out: AlertCandidate[] = [];
  posts.forEach((m, i) => {
    if (input.now.getTime() - new Date(m.posted_at!).getTime() < 24 * 3600e3) return;
    const mean = baselineBefore(posts, i);
    if (mean === null || mean <= 0) return;
    const eng = engagementOf(m);
    if (eng > (mean * input.settings.viral_pct) / 100) {
      out.push({ kind: "viral_post", key: m.id, title: `פוסט ויראלי: ${eng} מעורבות מול ממוצע ${Math.round(mean)}`, payload: { media_id: m.id, engagement: eng, mean: Math.round(mean) } });
    }
  });
  return out;
}

async function settings(): Promise<MarketingSettings> {
  const { data } = await mdb.from("marketing_settings").select("key, value");
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const r of (data ?? []) as { key: keyof MarketingSettings; value: unknown }[]) if (MARKETING_SETTING_KEYS.includes(r.key)) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  return out;
}

/** Evaluate both rules over the stored tables, dedupe, mail the new ones. */
export async function runMarketingAlerts(opts: { dryRun: boolean }): Promise<{ newAlerts: number; resolved: number; mail: "sent" | "skipped" | "failed" }> {
  const now = new Date();
  const s = await settings();
  const since = dayStr(new Date(now.getTime() - 14 * 864e5));
  const windowSince = dayStr(new Date(now.getTime() - (s.budget_bleed_days - 1) * 864e5));
  const [spendRes, entRes, mediaRes, openRes, purchasesByCampaign] = await Promise.all([
    mdb.from("ad_spend_daily").select("campaign_id, platform, day, spend").gte("day", since),
    mdb.from("ad_entities").select("platform, id, name, brand").eq("kind", "campaign"),
    mdb.from("ig_media").select("id, posted_at, like_count, comments_count, saved, shares, media_product_type").order("posted_at", { ascending: false }).limit(120),
    mdb.from("marketing_alerts").select("kind, key").is("resolved_at", null),
    getPurchasesByCampaign(windowSince, dayStr(now)),
  ]);
  const ent = new Map<string, { name: string; brand: AdBrand }>((entRes.data ?? []).map((e: { platform: string; id: string; name: string; brand: AdBrand }) => [`${e.platform}:${e.id}`, e]));
  const spend = (spendRes.data ?? []).map((r: { campaign_id: string; platform: string; day: string; spend: number }) => ({ campaign_id: r.campaign_id, day: r.day, spend: Number(r.spend), brand: ent.get(`${r.platform}:${r.campaign_id}`)?.brand ?? ("other" as AdBrand), name: ent.get(`${r.platform}:${r.campaign_id}`)?.name ?? r.campaign_id }));
  const candidates = [...budgetBleedAlerts({ spend, purchasesByCampaign, settings: s, now }), ...viralPostAlerts({ media: mediaRes.data ?? [], settings: s, now })];
  const open = new Set<string>((openRes.data ?? []).map((a: { kind: string; key: string }) => `${a.kind}:${a.key}`));
  const fresh = candidates.filter((c) => !open.has(`${c.kind}:${c.key}`));
  const still = new Set(candidates.map((c) => `${c.kind}:${c.key}`));
  const toResolve = [...open].filter((k) => !still.has(k));
  if (!opts.dryRun) {
    if (fresh.length) await mdb.from("marketing_alerts").upsert(fresh.map((c) => ({ kind: c.kind, key: c.key, payload: c.payload, first_seen_at: now.toISOString(), resolved_at: null, last_mailed_at: null })), { onConflict: "kind,key" });
    for (const k of toResolve) { const i = k.indexOf(":"); await mdb.from("marketing_alerts").update({ resolved_at: now.toISOString() }).eq("kind", k.slice(0, i)).eq("key", k.slice(i + 1)); }
  }
  let mail: "sent" | "skipped" | "failed" = "skipped";
  const to = s.alert_emails.length ? s.alert_emails.join(",") : process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (fresh.length && to && !opts.dryRun) {
    try {
      await sendMail({ to, subject: `MYT Admin · ${fresh.length} התראות שיווק`, html: [`<div dir="rtl">`, ...fresh.map((c) => `<p><b>${c.kind === "budget_bleed" ? "שריפת תקציב" : "ויראליות"}</b> - ${c.title}</p>`), `<p><a href="${appOrigin()}/marketing?tab=alerts">לכל ההתראות</a></p></div>`].join("") });
      for (const c of fresh) await mdb.from("marketing_alerts").update({ last_mailed_at: now.toISOString() }).eq("kind", c.kind).eq("key", c.key);
      mail = "sent";
    } catch (e) { console.error("[marketing-alerts] mail failed", e); mail = "failed"; }
  }
  return { newAlerts: fresh.length, resolved: toResolve.length, mail };
}
