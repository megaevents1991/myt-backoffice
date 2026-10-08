# Marketing dashboard ("God Mode") - design

**Date:** 2026-10-08
**Source:** marketing PRD (Google Doc `1GWpUof1AXba-FI6-nI9UhfP2k1JnhzWbQcW9_pgmKVU`) and the action file
`docs/superpowers/plans/2026-09-18-marketing-god-mode-actions.md`.
**Decisions (Dor, 08.10):** COGS = snapshot at order time AND a manual actual-cost field, both from
day one; attribution = last paid touch; display currency USD; this round builds everything the
accesses we hold allow - phase 0, modules A + B (Meta + Google, read only), D (Instagram), alerts
by email. No Slack - the alert engine mails through `lib/email.ts`. Mixpanel is being retired, so
GA4 becomes the only behaviour source once marketing grants it; until then modules C/E/G/H wait
(the ask list is the doc "גישות חסרות - דשבורד שיווק").

## 1. What exists, measured 2026-10-08

- **Access verified live.** Meta Graph API `v26.0` (unversioned calls answer "deprecated" on ads):
  read token = system user "Insights Reader" (never expires; `ads_read`, `read_insights`,
  `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`),
  ad account `act_360794632318231` "מגה תיירות" (ILS, ONE account for every brand), page
  `175999802507985`, IG `@megatr_il` (`17841409316422785`). Write token "Campaign Toggle"
  (`ads_management`, expires 2026-11-27) - not used this round. Google Ads: service account
  `mega-events-google-ads@cellular-motif-510911-c6.iam.gserviceaccount.com`, customer
  `2422579340` (ILS, not a manager), `googleAds:search` on **v25 with no developer token**.
  Secrets are in `.env.local` under "MARKETING DASHBOARD" (`NEXT_SECRET_META_READ_TOKEN`,
  `NEXT_SECRET_META_WRITE_TOKEN`, `NEXT_SECRET_META_AD_ACCOUNT_ID`, `NEXT_SECRET_META_PAGE_ID`,
  `NEXT_SECRET_META_IG_USER_ID`, `NEXT_SECRET_META_PIXEL_ID`, `NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID`,
  `NEXT_SECRET_GOOGLE_SA_JSON_B64`, `NEXT_SECRET_GA4_MEASUREMENT_ID`,
  `NEXT_SECRET_GOOGLE_ADS_CONVERSION_ID`) - upload to Vercel with this code.
- **Join keys exist without touching the ads.** Meta ads send `utm_content={{ad.id}}` (183 of 197
  Meta touches in 90 days are numeric; 16/16 sampled resolve to a campaign through
  `/{ad_id}?fields=campaign`); the feed campaign also sends the campaign id in `utm_campaign` and
  the adset id in `utm_term`. Google touches carry `gclid` (149 of 163) and `click_view` maps a
  gclid to campaign + ad group for 90 days (one day per query). `utm_campaign` NAMES are the key on
  neither side (Meta: `{{campaign.name}}_{{adset.name}}_{{ad.name}}`; Google: `google_ads` or
  `p.max`).
- **The truth vs the platforms (30 days):** 203 reservations, 91 Paid, 112 Lost; 163 carry a
  primary touch (google 59, meta 49, partners/other 55). Meta reports 39 purchases worth 51,000
  (= 34 x the hardcoded 1,500); Google reports 312 "conversions" (page-view goals).
- **Money on a reservation today:** `user_shown_price` (USD, what the customer pays, net of
  coupon), `final_purchase_price_ils` = ceil(USD x rate), `exchange_rate_usd_ils_100` (the rate
  at purchase), `agent_card_discount_ils`, `coupon_discount_usd`, `offline_flight_cost`
  (= `offlineRawPrice` x travellers, written by confirm-order), `offline_hotel_cost` (room total).
  Amadeus cost is already on the row: `flight_order_info.offer.price.grandTotal` (USD, all
  travellers); bags (`added_bags.*.total_usd`) are passed through at cost. A hotel has no markup:
  cost = `hotel_order_info.price` (+ each `hotel_segments[]` price). **A ticket's cost exists
  nowhere** - confirm-order receives only our selling `price_per_ticket`.
- **Revenue in the backoffice dashboard is fake:** `lib/actions/dashboard-actions.ts:166-172`
  sums `pax * 175`. `partners-dashboard-actions.ts` `knownSupplierCosts` (390-415) counts the
  ticket SALE price as a cost and multiplies offline flight cost by tickets again.
- **Purchase value is fake on the site:** `app/confirmation/[...params]/page.tsx`
  `trackAnalyticsEvent` sends no value, so `lib/gtmAnalytics.ts` fires `value || 1500`.
  `begin_checkout` (confirm-order) already sends the real `user_shown_price`.

## 2. Phase 0 - data truth

### 2.1 Revenue and COGS per reservation - `lib/services/reservation-pnl.ts` (pure)

```ts
export type PnlReservation = Pick<ReservationRow,
  "status" | "user_shown_price" | "exchange_rate_usd_ils_100" | "agent_card_discount_ils" |
  "partner_settlement_method" | "flight_order_info" | "hotel_order_info" | "hotel_segments" |
  "offline_flight_cost" | "offline_hotel_cost" | "ticket_cost_usd" | "ticket_cost_source" |
  "actual_cost_usd" | "event_order_info" | "more_pax_info">;

export function revenueUsd(r): number | null        // null unless status is Paid
export function cogsUsd(r): { total: number; flight; hotel; ticket; source: "actual" | "computed"; estimated: boolean }
export function netUsd(r, feePct): number | null    // revenue - cogs - revenue * feePct
```

- `revenueUsd` = `user_shown_price`, minus `agent_card_discount_ils / (exchange_rate_usd_ils_100 / 100)`
  when `partner_settlement_method === "agent_card"`. Paid only (`isPaid` from
  `lib/partner-commission.ts`). The coupon is already inside `user_shown_price` - never subtracted
  again.
- `cogsUsd`: `actual_cost_usd` wins whole when set (`source: "actual"`). Else flight = offline cost
  (already the total) | `offer.price.grandTotal` + bags | fallback `flight_order_info.price`
  (`estimated`); hotel = offline cost | sum of `hotel_order_info.price` and the other segments;
  ticket = `ticket_cost_usd` (`estimated` when `ticket_cost_source` is `estimated`, and the
  SALE ticket price when null - flagged, never silent). `estimated` bubbles up so the screen can
  say "משוער".
- Partner commission is NOT in COGS here - it belongs to the partner P&L that already exists and
  would double-count against "last paid touch" attribution. The executive tab shows it as its own
  line, read from `commissionForReservation`.
- `getDashboardStats` replaces `pax * 175` with `revenueUsd` (same Paid filter).

### 2.2 Migration `reservations` (+ settings, alerts)

```sql
alter table public.reservations
  add column if not exists ticket_cost_usd     numeric,
  add column if not exists ticket_cost_source  text,      -- 'live' | 'estimated' | 'manual' (no CHECK - main writes this table)
  add column if not exists actual_cost_usd     numeric,   -- ops: the whole order's real supplier cost, wins over everything
  add column if not exists actual_cost_note    text;
```

Edit page: an "Actual cost (USD)" field + note; audited through the existing `updateReservation`
path.

### 2.3 Ticket cost snapshot - who writes `ticket_cost_usd`

| Supplier | Writer | How |
|---|---|---|
| LiveTickets | **main** confirm-order, `live` | `validateLiveTicketsOffer` already fetches the offer; `getLiveTicketsOffers` exposes `cost`, `currency`, `groupFeePct` -> USD at the same rate the price used |
| TixStock | **main** confirm-order, `live` | server-side re-fetch of `/tickets/feed?event_id=<eid>`, the cheapest listing the site sells for this category + quantity (`lib/tixstock-quantity.ts` rules, the same ones mirrored in backoffice `lib/tixstock-listings.ts`); `proceed_price` -> USD |
| XS2Event | backoffice nightly fill, `estimated` | `xs2e` local rates `net_rate_eur` (cents) for the ticket's category when found, else the inverse of the sync formula |
| P1 | backoffice nightly fill, `estimated` | P1 feed `price_ticket` when the event is still in the feed, else the inverse |
| LiveTickets-typed events with no supplier field | backoffice nightly fill, `estimated` | `live_events.ticket_categories[].cost` |
| Own stock / static | backoffice nightly fill, `estimated` | inverse of the markup formula on `price_per_ticket` (price / 1.035 - 40 USD); ops corrects with `actual_cost_usd` |

Main's write is tolerant: the column may not exist yet (the 42703 retry already in confirm-order
drops the new keys). A cost that cannot be found at order time stays null and the nightly fill
takes it. The fill touches only Paid reservations of the last 120 days with `ticket_cost_usd`
null, 200 per run, and never overwrites `live` or `manual`.

### 2.4 Purchase value (main)

- `GET /api/confirm-order/[id]` returns `user_shown_price` too.
- `trackAnalyticsEvent` sends `value: user_shown_price`, `currency: "USD"`,
  `quantity: number_of_ticket`.
- `trackServerSideEvent` drops the `|| 1500` defaults: no value -> no `value` / `price` keys
  (never a made-up number). `view_cart` and the flight-search `add_to_cart` keep firing without
  a value.

## 3. Tables (backoffice-only: RLS on, no policies, service role; main never reads them)

| Table | Columns | Key |
|---|---|---|
| `ad_spend_daily` | `platform` (`meta`/`google`), `account_id`, `campaign_id`, `adset_key` (Meta adset id; Google ad-group id; `''` for a campaign-level row), `level` (`adset`/`campaign`), `day` date, `spend` numeric, `currency`, `spend_usd`, `fx_rate`, `impressions`, `clicks`, `platform_conversions` numeric, `platform_value` numeric, `synced_at` | PK (`platform`, `campaign_id`, `adset_key`, `day`) |
| `ad_entities` | `platform`, `id`, `kind` (`campaign`/`adset`/`ad_group`/`ad`), `name`, `parent_id`, `campaign_id`, `status`, `channel` (objective / advertising_channel_type), `landing_domain`, `url_tags`, `brand` (`mega_events`/`other`), `brand_source` (`rule`/`manual`), `first_seen_at`, `updated_at` | PK (`platform`, `id`) |
| `ad_clicks` | `gclid` text, `campaign_id`, `ad_group_id`, `day`, `synced_at` | PK `gclid` |
| `ig_media` | `id`, `ig_user_id`, `media_type`, `media_product_type` (`FEED`/`REELS`/`STORY`), `caption`, `permalink`, `media_url`, `thumbnail_url`, `posted_at`, `like_count`, `comments_count`, `reach`, `saved`, `shares`, `views`, `insights_at`, `synced_at` | PK `id` |
| `ig_media_insights_daily` | `media_id`, `day`, `reach`, `saved`, `shares`, `views`, `likes`, `comments` | PK (`media_id`, `day`) |
| `ig_account_daily` | `ig_user_id`, `day`, `followers`, `media_count` | PK (`ig_user_id`, `day`) |
| `marketing_settings` | `key` text, `value` jsonb, `updated_at`, `updated_by` | PK `key` |
| `marketing_alerts` | `kind`, `key`, `payload` jsonb, `first_seen_at`, `last_mailed_at`, `resolved_at` | PK (`kind`, `key`) |

Rules the writers keep:
- A campaign has EITHER adset-level rows OR one campaign-level row per day, never both. Meta ->
  adset level always; Google -> ad-group level for SEARCH / DISPLAY / VIDEO / SHOPPING, campaign
  level for PERFORMANCE_MAX (asset groups carry no daily metrics worth a row). Campaign totals =
  `sum(spend)` over its rows.
- `spend` is the account's native currency (ILS today); `spend_usd` = `spend x fx_rate` with the
  rate the sync read from `multiCurrencyExchangeRateService` at sync time, stored per row so a
  re-sync of the 7-day window recomputes with the then-current rate and the history explains itself.
- `brand`: `brand_source = 'rule'` rows are recomputed on every sync by the pure
  `brandOf({ name, landingDomain })` - `mega_events` when the name contains MYT / מייטי /
  Mega Events / MegaEvents or the landing domain is `mega-events.co.il`; else `other`. A
  `manual` brand (set on the Settings tab) is never touched by the sync.
- Retention: `ad_clicks` older than 100 days and `ig_media_insights_daily` older than 180 days
  are deleted by the sync's last step (`?dry_run=1` counts, writes nothing).

`types/database.types.ts` is regenerated (`npm run db:types`) after the migration lands.

## 4. One cron: `marketingSync` - `20 */6 * * *` (01:20, 07:20, 13:20, 19:20 UTC), 270 s budget

`app/api/cron/marketingSync/route.ts` -> `lib/services/marketing-sync.ts` `runMarketingSync({ dryRun, only? })`.
Steps, each in its own try/catch (one source failing never skips the next), each reporting
`{ ok, rows, note }` into one summary:

1. **Meta spend** (`lib/services/ads/meta.ts`): `act_<id>/insights?level=adset&time_increment=1`
   for the last 7 days (Meta restates numbers for days), fields `spend, impressions, clicks,
   actions, action_values, campaign_id, adset_id` -> upsert `ad_spend_daily`; `campaigns`,
   `adsets`, `ads` (with `creative{url_tags, link_url, object_story_spec}`) -> upsert
   `ad_entities` (`landing_domain` from the creative's link; catalog ads have none).
2. **Google spend** (`lib/services/ads/google.ts`): a JWT-signed service-account token
   (`RS256`, scope `adwords`, 10 minutes - no library), `googleAds:search` on v25 with
   `segments.date DURING LAST_7_DAYS` at `ad_group` level for non-P.Max and `campaign` level for
   P.Max; `metrics.cost_micros / 1e6`; `campaign` + `ad_group` + `ad_group_ad.ad.final_urls` ->
   `ad_entities`; `click_view` per day for the last 3 days -> `ad_clicks` (the first run takes
   90 days in day-sized queries until the budget says stop; `remaining` reported).
3. **Instagram** (`lib/services/ads/instagram.ts`): `/{ig-user}/media?fields=id,media_type,
   media_product_type,caption,permalink,media_url,thumbnail_url,timestamp,like_count,comments_count`
   (newest 100) + `/{ig-user}/stories` -> `ig_media`; per media `insights?metric=reach,saved,
   shares,views` (reels/feed; stories: `reach,replies` - whatever the API allows for the type,
   unsupported metrics are skipped per type, never fail the row) -> counters on `ig_media` and a
   row in `ig_media_insights_daily` for today; `/{ig-user}?fields=followers_count,media_count` ->
   `ig_account_daily`.
4. **COGS fill** (`lib/services/reservation-cogs-fill.ts`): section 2.3's backoffice column.
5. **Alerts** (section 6).
6. **Retention** (section 3).

`?dry_run=1` = every read, zero writes, zero mails; `?only=meta|google|instagram|cogs|alerts`
runs one step. A summary mail to `NEXT_SECRET_ADMIN_EMAIL` only when a step failed or an alert
went out (the healthy run is silent - 4 mails a day would be noise). `invalidateMarketing()`
(tags, `lib/services/marketing-cache.ts`) once at the end.

## 5. Attribution - `lib/services/marketing-attribution.ts` (pure, selftest)

```ts
export type PaidTouch = { platform: "meta" | "google"; campaignId: string | null; adsetId: string | null; adId: string | null; resolved: boolean };
export function paidTouchOf(touches: UtmTouchRow[], lookups: { metaAdCampaign: (adId) => {campaignId, adsetId} | null; gclidCampaign: (gclid) => {campaignId, adGroupId} | null }): PaidTouch | null
```

- Touches are scanned from `position` 0 (the newest / credited one) upward; the first PAID touch
  wins. A touch at position 0 with `is_influencer` = partner, never paid (the cookie's influencer
  protection stands).
- Paid = Meta: `utm_source` in `facebook | fb | ig | instagram` or an `fbclid`; the ad id is the
  numeric `utm_content` (when `utm_campaign` is itself an 18-digit id, that is the campaign and
  `utm_term` the adset - the feed campaign's shape). Google: a `gclid`, or `utm_source=google` with
  `utm_medium=cpc`. Resolution through `ad_entities` (Meta) / `ad_clicks` (Google);
  unresolved -> `resolved: false`, shown as "מטא · לא זוהה" / "גוגל · לא זוהה" rows with their
  revenue, so attributed revenue never silently vanishes.
- No paid touch -> `null` = organic / direct / partner, one "לא מיוחס" row with its own revenue.

The P&L join (`lib/services/marketing-pnl.ts`, pure over rows) groups Paid reservations of the
range by (platform, campaignId, adsetId) and merges with `ad_spend_daily` sums:
`revenue`, `cogs`, `purchases`, `spend_usd`, `POAS = (revenue - cogs - spend) / spend`,
`ROAS = revenue / spend`, `CAC = spend / purchases`. Blended (tab A) = the same over every
campaign of the chosen brand + the unattributed revenue line. The reservation side is read once
per request (`fetchPaged`, 90-day cap on the picker) and cached 300 s (`unstable_cache`, tag
`marketing-pnl`).

## 6. Alerts - `lib/services/marketing-alerts.ts` (pure rules, selftest) + mail

| kind | rule | key |
|---|---|---|
| `budget_bleed` | a campaign (brand `mega_events`) whose spend over the last `budget_bleed_days` (default 3) exceeds `budget_bleed_ils` (default 1,500) with ZERO purchases of ours attributed in that window | `campaign_id` |
| `viral_post` | an IG media whose engagement (likes + comments + saves + shares) is above `viral_pct` (default 200) % of the mean of the 30 posts before it, at least 24 h old (so a fresh post is not compared at zero) | `media_id` |

`marketing_alerts` dedupes: a row is mailed once when first seen, re-mailed only after the
condition cleared (`resolved_at` set when it no longer holds) and fired again. Mail through
`sendMail` to `marketing_settings.alert_emails` (default `NEXT_SECRET_ADMIN_EMAIL`), one mail per
run listing every new alert, Hebrew, with a link to `/marketing?tab=alerts`. The thresholds live
in `marketing_settings` (Settings tab), never in code.

## 7. Screen `/marketing` (nav group Marketing, `roles: ADMIN_ROLES`, `requireAdmin()` on the page)

`app/(dashboard)/marketing/page.tsx` + `marketing-client.tsx` with `UrlTabs` (`?tab=`), one load
action per tab (`lib/actions/marketing-actions.ts`, each `requireAdmin()` then cached data):

- **הנהלה (`exec`, default):** range picker (7 / 30 / 90 days / this month, `?range=`, kept in
  the URL) and brand select (default Mega Events; "הכל" = every campaign). Cards: Spend, Revenue
  (Paid, USD), COGS (with "משוער N" when any), Net profit vs the monthly target
  (`monthly_profit_target_usd`, green/red), partner commission line, Blended CAC, ROAS, POAS.
  Daily chart spend vs revenue (recharts through `components/ui/chart.tsx`, like
  `components/dashboard/trend-chart.tsx`).
- **מדיה (`media`):** `DataTable` of campaigns: platform, name, brand, status, spend (USD, ILS in
  the tooltip), clicks / CTR, platform purchases + value, OUR purchases, OUR revenue, COGS, POAS,
  ROAS; `defaultSorting` by spend; an expandable row lists its adsets / ad groups; the
  "לא זוהה" and "לא מיוחס" rows at the end. No pause/resume toggle this round.
- **אינסטגרם (`instagram`):** a grid of `ig_media` cards (thumbnail, type, date, reach, likes,
  comments, saves, shares, "ויראלי" badge), sort by engagement / reach / date, followers line
  from `ig_account_daily`.
- **התראות (`alerts`):** `marketing_alerts` newest first, open vs resolved, with the campaign /
  post it points at.
- **הגדרות (`settings`):** `processing_fee_pct`, `monthly_profit_target_usd`,
  `budget_bleed_ils`, `budget_bleed_days`, `viral_pct`, `alert_emails`; a campaign list with a
  brand select per row (`setCampaignBrand` -> `brand_source = 'manual'`); a "Sync now" button
  (`runMarketingSyncNow`, `requireAdmin`, audited `marketing.sync_triggered`).

Every write is audited (`logAudit`, `marketing.settings` / `marketing.brand` / `marketing.sync_triggered`).
The dashboard's `getDashboardStats` revenue card reads `revenueUsd` (section 2.1).

## 8. Out of this round, on purpose

- Campaign pause/resume (write token; last, with confirm dialog + audit, once the read side is trusted).
- Module C traffic / CVR (`event_traffic_daily` from GA4 once the Data API is granted), E (Search
  Console), G (Clarity), H (Ads Library - the app lacks permission and the API serves EU ads
  only). F stays on `/partners` (built).
- Replacing Mixpanel in main (26 call sites) - a separate change after GA4 is in.
- A daily USD/ILS rate table - `fx_rate` per spend row and `exchange_rate_usd_ils_100` per
  reservation cover every number on the screen.

## 9. Testing and deploy

- Pure modules + selftests under `scripts/`: `marketing-pnl-selftest.ts` (revenue / cogs /
  net on synthetic rows incl. agent_card, offline, Amadeus, missing ticket cost),
  `marketing-attribution-selftest.ts` (the paid-touch rule over every utm shape measured above),
  `marketing-alerts-selftest.ts`, `ad-brand-selftest.ts`. Run with `npx tsx`.
- `marketingSync?dry_run=1` against prod from a preview before the first real run; the first
  real run backfills 90 days of spend (`?backfill_days=90`, one-off) and `click_view`.
- Screen verified in the browser on dev with prod data (read only).
- Order: backoffice migration (reservations columns + the new tables) -> backoffice code +
  Vercel env (the ten secrets) -> main (confirm-order cost snapshot, purchase value). Main
  tolerates the columns missing; the backoffice tolerates a reservation with no cost (estimated).
- Docs: CLAUDE.md (cron list, env block, tables list), `/guide` section for the new screen
  (`guide-selftest` fails on a menu screen without one), the memory file.
