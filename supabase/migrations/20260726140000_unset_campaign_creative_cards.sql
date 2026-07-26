-- Detach auto-generated campaign creatives from the customer-facing event card.
--
-- The creative generator's "set as event card" checkbox writes the rendered
-- campaign PNG (brand background + logo + price text) into
-- events.card_image_url, so the site showed an ad creative where the artist
-- photo belongs (Celine Dion 12/09/26 and 8 more). Campaign creatives belong
-- to the Meta feed only, which reads campaign_image_url / campaign_banner_url
-- and is unaffected by this.
--
-- Cleared events fall back to the artist/team card art (myt-main
-- lib/events/fallbackImage.ts); all 9 rows were verified to have a matching
-- artist or football team with imagery, so no card goes blank.
--
-- Idempotent: re-running only affects rows still pointing at the bucket.

update events
set card_image_url = ''
where card_image_url like '%/storage/v1/object/public/creatives/%';
