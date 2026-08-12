-- Auto-generated campaign creatives for the Meta product feed. The nightly
-- cron (nightlyCampaignCreatives) renders the designer's square/banner
-- creative per feed-eligible event and stores the public URLs here; the main
-- app's feed uses campaign_image_url (fallback: card_image_url).
-- campaign_input_hash = hash of (date text, package price, event name) -
-- when it stops matching, the cron regenerates.

alter table events add column if not exists campaign_image_url   text;
alter table events add column if not exists campaign_banner_url  text;
alter table events add column if not exists campaign_input_hash  text;
alter table events add column if not exists campaign_generated_at timestamptz;
