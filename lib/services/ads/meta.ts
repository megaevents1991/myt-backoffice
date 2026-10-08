/**
 * Meta Marketing API reader (Graph v26.0 - an unversioned call answers "deprecated" on
 * ads). Read token only (system user "Insights Reader"); the token travels in the
 * Authorization header, never in a URL. Returns rows shaped for the marketing tables; the
 * sync (lib/services/marketing-sync.ts) writes them. Spec section 4 step 1.
 */
import type { AdEntityRow, AdSpendRow } from "@/types/marketing.types";
import { brandOf, landingDomainOf, pickLandingDomain } from "./brand";

const GRAPH = "https://graph.facebook.com/v26.0";

type Json = Record<string, unknown>;

function token(): string {
  const t = process.env.NEXT_SECRET_META_READ_TOKEN?.trim();
  if (!t) throw new Error("NEXT_SECRET_META_READ_TOKEN is not set");
  return t;
}

/** One Graph GET with paging (`paging.next`). Throws when more than `maxPages` pages remain or a 200 carries no `data` array - a short list must never pass for the whole answer. */
export async function graphGetAll<T = Json>(path: string, params: Record<string, string>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  const first = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) first.searchParams.set(k, v);
  let url: string | null = first.toString();
  let pages = 0;
  while (url && pages < maxPages) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { data?: T[]; paging?: { next?: string }; error?: { message: string; code: number } };
    if (!res.ok || body.error) throw new Error(`Meta ${path}: ${body.error?.message ?? res.status} (code ${body.error?.code ?? "-"})`);
    if (!Array.isArray(body.data)) throw new Error(`Meta ${path}: no data array in response`);
    out.push(...body.data);
    url = body.paging?.next ?? null;
    pages += 1;
  }
  if (url) throw new Error(`Meta ${path}: more than ${maxPages} pages`);
  return out;
}

export interface MetaInsightRaw {
  campaign_id: string;
  adset_id?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

/** Pure: one insight row -> one ad_spend_daily row. `fxRate` = USD per 1 unit of `currency`. */
export function parseMetaInsight(raw: MetaInsightRaw, ctx: { accountId: string; currency: string; fxRate: number }): AdSpendRow {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const purchase = (list?: { action_type: string; value: string }[]) => n(list?.find((a) => a.action_type === "purchase")?.value);
  const spend = n(raw.spend);
  return {
    platform: "meta",
    account_id: ctx.accountId,
    campaign_id: raw.campaign_id,
    adset_key: raw.adset_id ?? "",
    level: raw.adset_id ? "adset" : "campaign",
    day: raw.date_start,
    spend,
    currency: ctx.currency,
    spend_usd: Math.round(spend * ctx.fxRate * 100) / 100,
    fx_rate: ctx.fxRate,
    impressions: n(raw.impressions),
    clicks: n(raw.clicks),
    platform_conversions: purchase(raw.actions),
    platform_value: purchase(raw.action_values),
  };
}

/** Daily adset-level spend between two yyyy-mm-dd days (inclusive). */
export async function fetchMetaSpend(opts: { accountId: string; since: string; until: string; currency: string; fxRate: number }): Promise<AdSpendRow[]> {
  const raws = await graphGetAll<MetaInsightRaw>(`/${opts.accountId}/insights`, {
    level: "adset",
    time_increment: "1",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    fields: "campaign_id,adset_id,spend,impressions,clicks,actions,action_values",
    limit: "500",
  });
  return raws.map((r) => parseMetaInsight(r, opts));
}

interface MetaCreative { url_tags?: string; link_url?: string; object_story_spec?: { link_data?: { link?: string }; video_data?: { call_to_action?: { value?: { link?: string } } } }; asset_feed_spec?: { link_urls?: { website_url?: string }[] } }

/** Pure: the landing domain of a creative, if it names one (catalog ads do not). */
export function creativeLandingDomain(c: MetaCreative | undefined): string | null {
  if (!c) return null;
  const link = c.link_url ?? c.object_story_spec?.link_data?.link ?? c.object_story_spec?.video_data?.call_to_action?.value?.link ?? c.asset_feed_spec?.link_urls?.[0]?.website_url ?? null;
  return landingDomainOf(link);
}

/** Campaigns, adsets and ads of the account -> ad_entities rows (brand by rule on campaigns; the sync copies it down and keeps manual brands). */
export async function fetchMetaEntities(opts: { accountId: string }): Promise<AdEntityRow[]> {
  // The edges list only the statuses asked for, and the default leaves out ARCHIVED (measured: 258 listed, 9 more
  // archived) - yet an archived campaign still has spend history and bookings that need an entity + brand.
  // Asked for: the seven run / pause / archive states on every edge, plus - on /ads - the review / billing states
  // (an ad stuck in review or refused still names its landing page and still carries bookings' ad ids).
  // NOT DELETED: the account edges refuse it outright - measured 2026-10-08 on v26.0, campaigns / adsets / ads with
  // DELETED in effective_status answer 400 code 100 subcode 1815001 ("requests for deleted objects are not supported
  // on this endpoint"), which would fail the whole entity walk. A deleted object is readable only by its own id; the
  // same day no deleted or archived campaign had spend in the last 90 days (insights filtered on effective_status).
  const base = ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES"];
  const effective_status = JSON.stringify(base);
  const adStatuses = JSON.stringify([...base, "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"]);
  // /ads expands the creative, so a big page answers "Please reduce the amount of data" (code 1) - 500 and, once archived ads are in, 100 both did; 50 a page, up to 200 pages.
  const [campaigns, adsets, ads] = await Promise.all([
    graphGetAll<{ id: string; name: string; effective_status: string; objective: string }>(`/${opts.accountId}/campaigns`, { fields: "id,name,effective_status,objective", effective_status, limit: "500" }),
    graphGetAll<{ id: string; name: string; effective_status: string; campaign_id: string }>(`/${opts.accountId}/adsets`, { fields: "id,name,effective_status,campaign_id", effective_status, limit: "500" }),
    graphGetAll<{ id: string; name: string; effective_status: string; campaign_id: string; adset_id: string; creative?: MetaCreative }>(`/${opts.accountId}/ads`, { fields: "id,name,effective_status,campaign_id,adset_id,creative{url_tags,link_url,object_story_spec,asset_feed_spec}", effective_status: adStatuses, limit: "50" }, 200),
  ]);
  const domainsByCampaign = new Map<string, string[]>();
  for (const ad of ads) {
    const d = creativeLandingDomain(ad.creative);
    if (!d) continue;
    const list = domainsByCampaign.get(ad.campaign_id);
    if (list) list.push(d);
    else domainsByCampaign.set(ad.campaign_id, [d]);
  }
  const rows: AdEntityRow[] = [];
  for (const c of campaigns) {
    const landing = pickLandingDomain(domainsByCampaign.get(c.id) ?? []);
    rows.push({ platform: "meta", id: c.id, kind: "campaign", name: c.name, parent_id: null, campaign_id: c.id, status: c.effective_status, channel: c.objective, landing_domain: landing, url_tags: null, brand: brandOf({ name: c.name, landingDomain: landing }), brand_source: "rule" });
  }
  for (const a of adsets) rows.push({ platform: "meta", id: a.id, kind: "adset", name: a.name, parent_id: a.campaign_id, campaign_id: a.campaign_id, status: a.effective_status, channel: null, landing_domain: null, url_tags: null, brand: "other", brand_source: "rule" });
  for (const ad of ads) rows.push({ platform: "meta", id: ad.id, kind: "ad", name: ad.name, parent_id: ad.adset_id, campaign_id: ad.campaign_id, status: ad.effective_status, channel: null, landing_domain: creativeLandingDomain(ad.creative), url_tags: ad.creative?.url_tags ?? null, brand: "other", brand_source: "rule" });
  return rows;
}
