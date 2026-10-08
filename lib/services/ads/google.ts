/**
 * Google Ads API reader (v25) with a service account - no client library, no developer
 * token (verified 2026-10-08: `googleAds:search` answers 200 without the header). The
 * key is NEXT_SECRET_GOOGLE_SA_JSON_B64 (base64 of the JSON); the JWT is signed here with
 * node:crypto. Spec section 4 step 2.
 *
 * v25 refuses `pageSize` ("Setting the page size is not supported"; a page is a fixed
 * 10,000 rows), so the request body carries the query and the page token only.
 */
import { createSign } from "node:crypto";
import type { AdClickRow, AdEntityRow, AdSpendRow } from "@/types/marketing.types";
import { brandOf, landingDomainOf, pickLandingDomain } from "./brand";

const API = "https://googleads.googleapis.com/v25";
const SCOPE = "https://www.googleapis.com/auth/adwords";

interface ServiceAccount { client_email: string; private_key: string; private_key_id: string; token_uri: string }

function serviceAccount(): ServiceAccount {
  const b64 = process.env.NEXT_SECRET_GOOGLE_SA_JSON_B64?.trim();
  if (!b64) throw new Error("NEXT_SECRET_GOOGLE_SA_JSON_B64 is not set");
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount;
  } catch {
    // V8's own message quotes a fragment of the input - a piece of the private key would land in a log and a mail.
    throw new Error("NEXT_SECRET_GOOGLE_SA_JSON_B64 is not valid JSON");
  }
}

let cached: { token: string; exp: number } | null = null;

/** OAuth2 access token for the service account, cached until a minute before expiry. */
export async function googleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = serviceAccount();
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT", kid: sa.private_key_id })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(sa.token_uri, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!body.access_token) throw new Error(`Google token: ${body.error_description ?? res.status}`);
  cached = { token: body.access_token, exp: now + (body.expires_in ?? 3600) };
  return body.access_token;
}

/** One GAQL search, every page. */
export async function gaqlSearch<T = Record<string, unknown>>(customerId: string, query: string): Promise<T[]> {
  const token = await googleAccessToken();
  const out: T[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    if (pages >= 100) throw new Error(`Google Ads: more than 100 pages for ${query.slice(0, 60)}`);
    pages += 1;
    const res = await fetch(`${API}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    type Body = { results?: T[]; nextPageToken?: string; error?: { message: string; details?: { errors?: { message: string }[] }[] } };
    const parsed = (await res.json().catch(() => null)) as Body | null;
    if (!res.ok || parsed?.error) {
      // The error path degrades: a non-JSON error body still reads "Google Ads: <status>".
      const err = parsed?.error;
      const detail = err?.details?.flatMap((d) => d.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(`Google Ads: ${err?.message ?? res.status}${detail ? ` - ${detail}` : ""}`);
    }
    // A successful answer that cannot be parsed is NOT "no rows" (and on page 2+ it would drop the tail).
    // A parsed object without `results` IS a legitimate empty page - Google omits the key when empty.
    if (!parsed || typeof parsed !== "object") throw new Error("Google Ads: unreadable response");
    out.push(...(parsed.results ?? []));
    pageToken = parsed.nextPageToken;
  } while (pageToken);
  return out;
}

const micros = (v: unknown) => Math.round((Number(v) || 0) / 10_000) / 100;
const n = (v: unknown) => Number(v) || 0;

/** Daily spend: ad-group rows for every channel but Performance Max, campaign rows for P.Max. */
export async function fetchGoogleSpend(opts: { customerId: string; since: string; until: string; currency: string; fxRate: number }): Promise<AdSpendRow[]> {
  const range = `segments.date BETWEEN '${opts.since}' AND '${opts.until}'`;
  type CRow = { campaign: { id: string; advertisingChannelType: string }; segments: { date: string }; metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number; conversionsValue?: number } };
  type AgRow = CRow & { adGroup: { id: string } };
  const [agRows, pmaxRows] = await Promise.all([
    gaqlSearch<AgRow>(opts.customerId, `SELECT campaign.id, campaign.advertising_channel_type, ad_group.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM ad_group WHERE ${range} AND campaign.advertising_channel_type != 'PERFORMANCE_MAX' AND metrics.cost_micros > 0`),
    gaqlSearch<CRow>(opts.customerId, `SELECT campaign.id, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${range} AND campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND metrics.cost_micros > 0`),
  ]);
  const toRow = (r: CRow, adsetKey: string, level: "adset" | "campaign"): AdSpendRow => {
    const spend = micros(r.metrics.costMicros);
    return { platform: "google", account_id: opts.customerId, campaign_id: r.campaign.id, adset_key: adsetKey, level, day: r.segments.date, spend, currency: opts.currency, spend_usd: Math.round(spend * opts.fxRate * 100) / 100, fx_rate: opts.fxRate, impressions: n(r.metrics.impressions), clicks: n(r.metrics.clicks), platform_conversions: n(r.metrics.conversions), platform_value: n(r.metrics.conversionsValue) };
  };
  return [...agRows.map((r) => toRow(r, r.adGroup.id, "adset")), ...pmaxRows.map((r) => toRow(r, "", "campaign"))];
}

/**
 * Campaigns + ad groups -> ad_entities (ads and asset groups are read only for the landing domain, never written).
 * Campaigns and ad groups are read in EVERY status, REMOVED included: a removed campaign keeps its spend rows and
 * its bookings inside the 90-day backfill, and without an entity it would have no name and no brand. The landing
 * domain = `pickLandingDomain` over the first final URL of every live ad of the campaign (P.Max: its asset groups) -
 * ours wins when any ad points at us.
 */
export async function fetchGoogleEntities(opts: { customerId: string }): Promise<AdEntityRow[]> {
  type Camp = { campaign: { id: string; name: string; status: string; advertisingChannelType: string } };
  type Ag = { adGroup: { id: string; name: string; status: string }; campaign: { id: string } };
  type Ad = { campaign: { id: string }; adGroupAd: { ad: { finalUrls?: string[] } } };
  type Asset = { campaign: { id: string }; assetGroup: { finalUrls?: string[] } };
  const [camps, ags, ads, assets] = await Promise.all([
    gaqlSearch<Camp>(opts.customerId, "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign"),
    gaqlSearch<Ag>(opts.customerId, "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group"),
    gaqlSearch<Ad>(opts.customerId, "SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'"),
    gaqlSearch<Asset>(opts.customerId, "SELECT campaign.id, asset_group.final_urls FROM asset_group WHERE asset_group.status != 'REMOVED'"),
  ]);
  const domains = new Map<string, string[]>();
  for (const r of [...ads.map((a) => ({ id: a.campaign.id, urls: a.adGroupAd.ad.finalUrls })), ...assets.map((a) => ({ id: a.campaign.id, urls: a.assetGroup.finalUrls }))]) {
    const d = landingDomainOf(r.urls?.[0]);
    if (!d) continue;
    const list = domains.get(r.id);
    if (list) list.push(d);
    else domains.set(r.id, [d]);
  }
  const rows: AdEntityRow[] = camps.map((c) => {
    const landing = pickLandingDomain(domains.get(c.campaign.id) ?? []);
    return { platform: "google", id: c.campaign.id, kind: "campaign", name: c.campaign.name, parent_id: null, campaign_id: c.campaign.id, status: c.campaign.status, channel: c.campaign.advertisingChannelType, landing_domain: landing, url_tags: null, brand: brandOf({ name: c.campaign.name, landingDomain: landing }), brand_source: "rule" };
  });
  for (const a of ags) rows.push({ platform: "google", id: a.adGroup.id, kind: "ad_group", name: a.adGroup.name, parent_id: a.campaign.id, campaign_id: a.campaign.id, status: a.adGroup.status, channel: null, landing_domain: null, url_tags: null, brand: "other", brand_source: "rule" });
  return rows;
}

/** gclid -> campaign / ad group for ONE day (click_view must be queried a day at a time). */
export async function fetchGoogleClicks(opts: { customerId: string; day: string }): Promise<AdClickRow[]> {
  type Row = { clickView: { gclid: string }; campaign: { id: string }; adGroup?: { id: string }; segments: { date: string } };
  const rows = await gaqlSearch<Row>(opts.customerId, `SELECT click_view.gclid, campaign.id, ad_group.id, segments.date FROM click_view WHERE segments.date = '${opts.day}'`);
  return rows.filter((r) => r.clickView?.gclid).map((r) => ({ gclid: r.clickView.gclid, campaign_id: r.campaign.id, ad_group_id: r.adGroup?.id ?? null, day: r.segments.date }));
}
