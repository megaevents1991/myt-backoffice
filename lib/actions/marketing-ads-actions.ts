"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { mdb } from "@/lib/services/marketing-db";
import { graphGetAll } from "@/lib/services/ads/meta";
import { gaqlSearch } from "@/lib/services/ads/google";
import { isAdId, META_PREVIEW_FORMATS, previewSrcFrom, type MetaPreviewFormat } from "@/lib/marketing/ad-preview";

/**
 * The live ad behind a Media row (spec 2026-10-14 section 6) - read on click, never stored. Every action is
 * admin-only, takes ids that must be digits (they enter a Graph path or a GAQL string), and answers
 * `{ ok: false, error }` instead of throwing: Next hides a thrown message in production, and a preview that
 * fails should say why inside its dialog.
 */

type Fail = { ok: false; error: string };
const fail = (e: unknown): Fail => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

export interface AdRow { id: string; name: string; status: string | null }

/** A Meta ad set's ads, from the synced entities (name + status). */
export async function listAdsetAds(adsetId: string): Promise<{ ok: true; ads: AdRow[] } | Fail> {
  await requireAdmin();
  if (!isAdId(adsetId)) return { ok: false, error: "invalid ad set id" };
  const { data, error } = await mdb.from("ad_entities").select("id, name, status").eq("platform", "meta").eq("kind", "ad").eq("parent_id", adsetId).order("name").limit(200);
  if (error) return fail(new Error(`ad_entities read: ${error.message}`));
  return { ok: true, ads: (data ?? []) as AdRow[] };
}

/** Meta's own rendering of the ad, as an iframe URL on facebook.com (anything else is refused). */
export async function getMetaAdPreview(adId: string, format: MetaPreviewFormat): Promise<{ ok: true; src: string } | Fail> {
  await requireAdmin();
  if (!isAdId(adId)) return { ok: false, error: "invalid ad id" };
  if (!(META_PREVIEW_FORMATS as readonly string[]).includes(format)) return { ok: false, error: "invalid format" };
  try {
    const rows = await graphGetAll<{ body?: string }>(`/${adId}/previews`, { ad_format: format }, 1);
    const src = previewSrcFrom(rows[0]?.body ?? "");
    return src ? { ok: true, src } : { ok: false, error: "Meta returned no preview for this format" };
  } catch (e) {
    return fail(e);
  }
}

export interface GoogleAdCard {
  id: string;
  kind: string;
  name: string | null;
  headlines: string[];
  descriptions: string[];
  images: string[];
  finalUrl: string | null;
  status: string | null;
}

const customerId = () => (process.env.NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID ?? "").replace(/-/g, "");
const texts = (list?: { text?: string }[]) => (list ?? []).map((a) => a.text ?? "").filter(Boolean);
const MAX_IMAGES = 6;

/** A search / display ad group's ads (headlines, descriptions, final URL). */
async function adGroupAds(adGroupId: string): Promise<GoogleAdCard[]> {
  type Row = {
    adGroupAd: {
      status?: string;
      ad: {
        id: string;
        type?: string;
        name?: string;
        finalUrls?: string[];
        responsiveSearchAd?: { headlines?: { text?: string }[]; descriptions?: { text?: string }[] };
        expandedTextAd?: { headlinePart1?: string; headlinePart2?: string; description?: string };
        responsiveDisplayAd?: { headlines?: { text?: string }[]; descriptions?: { text?: string }[]; longHeadline?: { text?: string } };
      };
    };
  };
  const rows = await gaqlSearch<Row>(
    customerId(),
    `SELECT ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.name, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.expanded_text_ad.headline_part2, ad_group_ad.ad.expanded_text_ad.description, ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.responsive_display_ad.long_headline FROM ad_group_ad WHERE ad_group.id = ${adGroupId} AND ad_group_ad.status != 'REMOVED' LIMIT 50`,
  );
  return rows.map(({ adGroupAd: { status, ad } }) => {
    const eta = ad.expandedTextAd;
    const rda = ad.responsiveDisplayAd;
    return {
      id: ad.id,
      kind: ad.type ?? "AD",
      name: ad.name ?? null,
      headlines: [
        ...texts(ad.responsiveSearchAd?.headlines),
        ...[eta?.headlinePart1, eta?.headlinePart2].filter((s): s is string => Boolean(s)),
        ...texts(rda?.headlines),
        ...(rda?.longHeadline?.text ? [rda.longHeadline.text] : []),
      ],
      descriptions: [...texts(ad.responsiveSearchAd?.descriptions), ...(eta?.description ? [eta.description] : []), ...texts(rda?.descriptions)],
      images: [],
      finalUrl: ad.finalUrls?.[0] ?? null,
      status: status ?? null,
    };
  });
}

/** A Performance Max campaign's asset groups - headlines, descriptions, up to six images, final URL. */
async function assetGroups(campaignId: string): Promise<GoogleAdCard[]> {
  type Row = {
    assetGroup: { id: string; name?: string; status?: string; finalUrls?: string[] };
    assetGroupAsset: { fieldType?: string };
    asset: { type?: string; textAsset?: { text?: string }; imageAsset?: { fullSize?: { url?: string } } };
  };
  const rows = await gaqlSearch<Row>(
    customerId(),
    `SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.final_urls, asset_group_asset.field_type, asset.type, asset.text_asset.text, asset.image_asset.full_size.url FROM asset_group_asset WHERE campaign.id = ${campaignId} AND asset_group.status != 'REMOVED' AND asset_group_asset.status != 'REMOVED'`,
  );
  const groups = new Map<string, GoogleAdCard>();
  for (const r of rows) {
    const g = r.assetGroup;
    let card = groups.get(g.id);
    if (!card) {
      card = { id: g.id, kind: "ASSET_GROUP", name: g.name ?? null, headlines: [], descriptions: [], images: [], finalUrl: g.finalUrls?.[0] ?? null, status: g.status ?? null };
      groups.set(g.id, card);
    }
    const field = r.assetGroupAsset.fieldType ?? "";
    const text = r.asset.textAsset?.text;
    const image = r.asset.imageAsset?.fullSize?.url;
    if (text && (field === "HEADLINE" || field === "LONG_HEADLINE")) card.headlines.push(text);
    else if (text && field === "DESCRIPTION") card.descriptions.push(text);
    else if (image && card.images.length < MAX_IMAGES) card.images.push(image);
  }
  return [...groups.values()];
}

/** `adGroupId` for a search / display ad group, `campaignId` for a Performance Max campaign. */
export async function getGoogleAds(q: { adGroupId: string } | { campaignId: string }): Promise<{ ok: true; items: GoogleAdCard[] } | Fail> {
  await requireAdmin();
  try {
    if ("adGroupId" in q) {
      if (!isAdId(q.adGroupId)) return { ok: false, error: "invalid ad group id" };
      return { ok: true, items: await adGroupAds(q.adGroupId) };
    }
    if (!isAdId(q.campaignId)) return { ok: false, error: "invalid campaign id" };
    return { ok: true, items: await assetGroups(q.campaignId) };
  } catch (e) {
    return fail(e);
  }
}
