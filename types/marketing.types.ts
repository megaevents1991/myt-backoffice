/** Rows of the marketing dashboard tables (migration 20261008120000). Hand-typed until
 *  `npm run db:types` runs after the migration lands; lib/services/marketing-db.ts is the
 *  one `as any` boundary. */

export type AdPlatform = "meta" | "google";
export type AdBrand = "mega_events" | "other";

export interface AdSpendRow {
  platform: AdPlatform;
  account_id: string;
  campaign_id: string;
  adset_key: string;
  level: "adset" | "campaign";
  day: string; // yyyy-mm-dd
  spend: number;
  currency: string;
  spend_usd: number;
  fx_rate: number;
  impressions: number;
  clicks: number;
  platform_conversions: number;
  platform_value: number;
  synced_at?: string;
}

export interface AdEntityRow {
  platform: AdPlatform;
  id: string;
  kind: "campaign" | "adset" | "ad_group" | "ad";
  name: string;
  parent_id: string | null;
  campaign_id: string | null;
  status: string | null;
  channel: string | null;
  landing_domain: string | null;
  url_tags: string | null;
  brand: AdBrand;
  brand_source: "rule" | "manual";
  first_seen_at?: string;
  updated_at?: string;
}

export interface AdClickRow {
  gclid: string;
  campaign_id: string;
  ad_group_id: string | null;
  day: string;
}

export interface IgMediaRow {
  id: string;
  ig_user_id: string;
  media_type: string | null;
  media_product_type: "FEED" | "REELS" | "STORY" | null;
  caption: string | null;
  permalink: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  like_count: number;
  comments_count: number;
  reach: number;
  saved: number;
  shares: number;
  views: number;
  insights_at: string | null;
}

export interface IgInsightRow {
  media_id: string;
  day: string;
  reach: number;
  saved: number;
  shares: number;
  views: number;
  likes: number;
  comments: number;
}

export interface IgAccountRow {
  ig_user_id: string;
  day: string;
  followers: number;
  media_count: number;
}

export interface MarketingAlertRow {
  kind: "budget_bleed" | "viral_post";
  key: string;
  payload: Record<string, unknown>;
  first_seen_at: string;
  last_mailed_at: string | null;
  resolved_at: string | null;
}

/** One row per key in marketing_settings; this is the merged, typed view. */
export interface MarketingSettings {
  processing_fee_pct: number;
  monthly_profit_target_usd: number;
  budget_bleed_ils: number;
  budget_bleed_days: number;
  viral_pct: number;
  alert_emails: string[];
}

export const DEFAULT_MARKETING_SETTINGS: MarketingSettings = {
  processing_fee_pct: 0,
  monthly_profit_target_usd: 0,
  budget_bleed_ils: 1500,
  budget_bleed_days: 3,
  viral_pct: 200,
  alert_emails: [],
};

export const MARKETING_SETTING_KEYS = Object.keys(DEFAULT_MARKETING_SETTINGS) as (keyof MarketingSettings)[];
