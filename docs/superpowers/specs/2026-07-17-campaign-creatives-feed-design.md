# Campaign Creatives → Meta Product Feed — Design

Approved by Dor 2026-07-17 (trigger: nightly auto with original-image fallback;
staleness: auto-regenerate on price/date change).

## Goal

Every feed-eligible event gets a branded campaign image (the creative-designer
output) in the Meta catalog automatically — no duplicated rendering code.
Backoffice renders; main only reads URLs.

## Architecture

**DB (migration, `events` table):**
- `campaign_image_url text` — square 1080×1080 creative (feed `image_link`)
- `campaign_banner_url text` — banner 1200×628 (`additional_image_link`)
- `campaign_input_hash text` — hash of (dateText, package price, event name)
- `campaign_generated_at timestamptz`

`card_image_url` untouched — site cards keep their look; feed falls back to it.

**Backoffice — shared cores (no duplication):**
- `lib/creative/auto.ts` (server-only): guard-free cores extracted from
  `creative-actions.ts` — `deriveCreativeDefaults(eventId)`,
  `renderAndUploadCreative(input, pathPrefix)` — plus
  `generateCampaignForEvent(event)`: hash-check → derive → skip on ANY
  warning → render both sizes to stable paths `output/auto/event-{id}-{size}.png`
  (upsert) → store URLs with `?v={hash}` (CDN/Meta cache-bust) → update the 4
  columns (explicit column map).
- `creative-actions.ts` becomes thin guarded wrappers over the cores; designer
  behavior unchanged.

**Backoffice — cron `nightlyCampaignCreatives`:**
- `guardCronRoute`, nightly 03:30 UTC, `maxDuration 300`.
- Feed-eligible events (not deleted, date ≥ today), oldest-first;
  processes up to 40 needing (re)generation per run — first run catches up
  over a few nights.
- Regenerates when stored hash ≠ current hash (price/date/name change).
- Any derivation warning (unmatched teams, missing artist image, no price)
  → skip + report; event keeps original image.
- Returns JSON summary {generated, skipped:[{id,reason}], errors}.

**Main (feed only):**
- `image_link` = `campaign_image_url ?? card_image_url`;
  `<g:additional_image_link>` = banner when present.
- `Event` type: two optional nullable fields (synced backoffice ↔ main).
- `/product-feed` stats card: "with campaign creative".

## Error handling

- Cron: per-event try/catch — one bad event never kills the run.
- Pre-migration safety: main reads undefined column → falls back to
  `card_image_url`; cron write fails loudly in summary until migration applied.
- Render/upload failure → event stays on fallback, retried next night.

## Testing

- metaCatalog test: image_link fallback both directions + additional_image_link.
- tsc both repos, main `yarn build` (lint gate), cron invoked locally with key.
