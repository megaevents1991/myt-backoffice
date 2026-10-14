# Marketing dashboard v2 - CMO round (2026-10-14)

Source: Tom's doc "מסמך שיפור דוחות" (`1VYcWHbiJb6Tuftwq9m2qjKKW7K4aZNuMtDK4_xRPWps`, one tab, 9 notes + 5 screenshots:
our Media table, our Partners screen twice, and two pictures of a reference dashboard "Events Deep Dive").
Dor's decisions (14.10): currency ₪ by default with a $ switch; the funnel counts EVERY order of every source, with a
source filter on top; Traffic reads GA4; the media dropdown shows the live ad. All UI text stays English (Dor, 09.10).

Builds on `docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md` - everything there still holds unless
changed below.

## 0. What was measured before writing this (14.10, live, read-only)

- **Spend currency.** Both ad accounts bill in ILS. `ad_spend_daily.spend` is the ILS amount, `spend_usd = spend x
  fx_rate` (the unrounded rate at sync time). So the answer to the doc's first question is yes, and ILS can be shown
  exactly as billed.
- **"Purchases (platform)" on Google is not purchases.** `fetchGoogleSpend` stores `metrics.conversions` = the sum of
  every PRIMARY conversion action: Form Submission (141 in 30 days), Phone Call (99), submit_application (47),
  begin_checkout (29), purchase (21), WhatsApp (4). Google's data-driven attribution splits them into fractions - the
  "11.368" in Tom's screenshot. The real purchase action exists: "MegaEvents - Production (web) purchase" (GA4 import,
  category PURCHASE, 21 in 30 days).
- **"Platform-reported revenue" is ILS printed with a `$`.** Meta `action_values` and Google `conversions_value` come in
  the account currency (ILS); the Media tab formats the raw number with `usd()`. Tom's "$131,151" is ₪131,151.
- **Meta purchases** = the `purchase` action (48 in 30 days, account-wide) - already right.
- **GA4.** Property `483131557` ("MegaEvents - Production"), service account `ga4-reader@mega-tourism-ads` with
  Viewer, Data API v1beta answers (quota 200k tokens/day; a report costs ~2). Sessions by source/medium in 30 days:
  facebook/cpc 17.5k, google/cpc 5.0k, google/organic 3.3k, influencer mediums ~3.7k, (direct)/(none) 2.2k.
  Events: session_start, select_item 4.7k sessions, add_to_cart 7.7k, view_cart 3.8k, form_start, begin_checkout 113,
  generate_lead 68, purchase 50.
- **Site traffic of non-partners is not in our DB.** `affiliates_tracking` has an FK to `partners` (main's
  `/api/affiliate/aff`), so Facebook / Google / no-UTM visits never land there. Traffic therefore comes from GA4.
- **Meta ad previews** (`GET /{ad_id}/previews?ad_format=...`) answer with the read token for MOBILE_FEED_STANDARD,
  INSTAGRAM_STANDARD and INSTAGRAM_STORY - an `<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=...">`.
- **Google ads** are readable live: `ad_group_ad` (search: TEXT_AD / RSA with final URLs) and, for Performance Max,
  `asset_group_asset` (headlines, descriptions, images, final URLs).
- **GA4 event -> order step** (main): `select_item` = an event card clicked (homepage, event buttons, events-info);
  `add_to_cart` = the flight search ran; `view_cart` = the order summary (OrderReview); `form_start`; `begin_checkout`
  (pay now) / `generate_lead` (phone order) = confirm-order; `purchase` = the confirmation page.

## 1. One filter bar for every tab

Above the tabs (not inside each tab), hidden on Settings. All values in the URL (`useQueryState`), so a refresh or a
pasted link lands on the same view.

| Control | URL | Values |
|---|---|---|
| Period | `range`, `from`, `to` | `today`, `yesterday`, `7d`, `30d` (default), `90d`, `month`, `last_month`, `custom` + `from`/`to` (yyyy-mm-dd) |
| Currency | `cur` | `ils` (default), `usd` |
| Brand | `brand` | `mega_events` (default), `other`, `all` - unchanged |
| Source | `src` | `all` (default), `meta`, `google`, `partners`, `no_utm`, `other` |

- **Custom** opens a two-month calendar (react-day-picker `mode="range"` in a Popover - `components/date-range-picker.tsx`,
  generic, no marketing knowledge) with the presets beside it.
- **Days are Israel calendar days.** Ad platforms report days in the account timezone (Asia/Jerusalem); a
  reservation's day is its `created_at` in Israel time (until now it was the UTC date - an order at 01:30 Israel time
  landed on the previous day). `rangeWindow` computes "today" in Israel too.
- Validation is pure (`lib/marketing/range.ts`, selftest): a custom window must be two valid dates, `from <= to`,
  `to` not after today, span at most 366 days; anything else falls back to 30 days. The server action re-validates.

## 2. Money in ₪ or $

- **Spend:** ILS = `spend` as billed (every account is ILS today; a non-ILS row is converted through USD with the
  stored rate); USD = `spend_usd`.
- **Revenue / COGS / fee of an order:** computed in USD as today; ILS = USD x that reservation's own
  `exchange_rate_usd_ils_100 / 100` (the rate the customer was charged at), else the sync's current rate.
- **Platform-reported value:** stored in account currency (ILS) -> as is for ILS, x the row's `fx_rate` for USD.
- `buildPnl` takes `currency` and every amount it returns is in it; the money fields lose their `Usd` suffix
  (`spend`, `revenue`, `cogs`, `fee`, `net`, `cac`) and `Pnl.currency` says which. The alerts keep their own USD/ILS
  reads (unchanged).
- The monthly profit target stays a USD setting; in ILS view the target line converts it at the current rate.

## 3. Executive - the reference layout, our theme

Section labels in small caps like the reference (SPEND / FUNNEL / EFFICIENCY / PROFIT), cards from `Card`.

- **SPEND:** a wide accent card "Total spend" (the period under it), then "Google" and "Meta" with their share of the
  total ("11.5% of spend"). Source filter `meta` / `google` shows that platform alone; `partners` / `no_utm` / `other`
  have no spend (the cards say "No ad spend for this source").
- **FUNNEL** - every order of the brand's site in the period, all sources (Dor, 14.10), narrowed by the source filter:
  - **Leads** = reservations created in the period, any status, not soft-deleted.
  - **Signups** = those whose status is Paid.
  - **Passengers** = tickets (`number_of_ticket` of every event line) on the Paid ones.
- **EFFICIENCY:** Cost / lead, Cost / signup, Cost / passenger (spend of the selected source / count; "—" when either
  side is 0), Lead → signup % and Pax / signup.
- **PROFIT** (the existing P&L, now in the chosen currency): Revenue, COGS, Net profit from media, ROAS, POAS, CAC -
  paid-campaign attributed as before. With source `meta` / `google` it is that platform's campaigns (plus its
  unresolved orders); with `partners` / `no_utm` / `other` the row is replaced by one line: "Media P&L covers paid
  campaigns - pick All, Meta or Google".
- **Brand:** the funnel reads the Mega Events site's reservations (the only site that writes `reservations`); with
  brand `other` the FUNNEL and EFFICIENCY sections say so instead of showing Mega Events numbers against another
  brand's spend.

**Order source** (pure, `lib/marketing/order-source.ts`, selftest), one rule shared by the funnel and Traffic's order
counts: the last paid touch (`paidTouchOf`, unchanged) -> `meta` / `google`; else a partner (`aff_partner_tracking_code`
set, or the credited touch is an influencer) -> `partners`; else any captured UTM touch -> `other`; else `no_utm`.

## 4. Charts (reference picture 2) - Executive

1. **Daily spend - Google vs Meta** (two areas).
2. **Leads, signups & passengers over time** (three lines, passengers dashed).
3. **Spend vs results** (the doc's "one of all, crossed"): total spend as bars and revenue as a line on the money axis,
   signups as a line on a count axis.

Daily series come from one pure builder next to the funnel (`dailyFunnel`), every day of the period present (zeros
included) so the lines do not skip days.

## 5. Media

- **Purchases (platform) = purchases only.** Google: the sync adds one query per level -
  `segments.conversion_action_category = 'PURCHASE'` with `metrics.all_conversions` / `all_conversions_value`
  (conversion segments cannot share a query with cost metrics) - merged into the spend rows by (campaign, ad group,
  day) through a pure `mergeGooglePurchases` (selftest). Meta unchanged (`purchase`). Rows already stored are
  rewritten by one `?only=google&backfill_days=90` run after the deploy.
- **Platform revenue** becomes its own column, converted (section 2). The Purchases (platform) number shows one
  decimal only when Google's attribution split it.
- **ⓘ on every non-obvious header** (Purchases (platform), Purchases (ours), Platform revenue, Revenue, COGS, POAS,
  ROAS) - a Tooltip with one or two sentences. The two purchase columns say it plainly: platform = what Meta / Google
  claim with their own pixel and attribution window (both may claim the same sale, and a view can count); ours = Paid
  orders in our database credited to the campaign by the last paid click.
- **Totals row** under the table (spend, clicks, both purchase counts, platform revenue, revenue, COGS, POAS, ROAS).

## 6. The live ad (media dropdown)

Opening a campaign row shows its ad sets as today; each ad set row gets "Ads" which opens its ads:

- **Meta:** the ads come from `ad_entities` (kind `ad`, `parent_id` = the ad set; name + status). "Preview" opens a
  Dialog with three format buttons (Facebook feed / Instagram feed / Instagram story); each loads
  `getMetaAdPreview(adId, format)` -> Graph `/{adId}/previews` -> the iframe `src`. Server side: `requireAdmin`, the ad
  id must be a Meta id (`META_ID`), the format one of the three, and the returned src must be `https://` on
  `business.facebook.com` or `www.facebook.com` - anything else is refused, never rendered.
- **Google:** "Ads" calls `getGoogleAdGroupAds(adGroupId)` live: for a search ad group its ads (type, headlines,
  descriptions, final URL); for a P.Max campaign (no ad groups) the campaign row offers "Asset groups" ->
  `getGoogleAssetGroups(campaignId)` (headlines, descriptions, up to 6 images, final URL). Drawn as a simple card,
  the final URL a link (new tab). Ids validated numeric before they enter a GAQL string.
- Nothing is stored; each preview is one API call on click.

## 7. Traffic (new tab, GA4)

`lib/services/ga4.ts` (token from `NEXT_SECRET_GA4_SA_JSON_B64`, scope `analytics.readonly`; `batchRunReports` on
property `NEXT_SECRET_GA4_PROPERTY_ID`, 30 s timeout, an error THROWS with GA4's message). One action
`getTraffic(window, src)` = one batch of two reports + our order counts, cached 10 minutes (`unstable_cache`, tag
`marketing-traffic`):

- report A: `date x sessionSource x sessionMedium` -> sessions, totalUsers, engagedSessions;
- report B: `sessionSource x sessionMedium x landingPage x eventName` -> sessions, filtered to session_start,
  select_item, add_to_cart, view_cart, begin_checkout, generate_lead, purchase.

Pure aggregation in `lib/marketing/traffic.ts` (selftest):

- **Source bucket** of a GA4 source/medium: `meta` (facebook / fb / ig / instagram / meta, or a `*facebook.com` /
  `*instagram.com` referrer), `google` (google + cpc), `partners` (medium `influencer`, or the source equals a partner
  tracking code, case-insensitive), `no_utm` ((direct)/(none), (not set), (data not available)), `other` (organic
  search, referrals, AI assistants...). The source filter narrows every number on the tab.
- **Landing kind** = `classifyEntry("VISIT", landingPage)` - the Partners screen's own rule (home / artist-team page /
  event / other).

Screen (shaped like the Partners screen in Tom's pictures):

- **Cards:** Sessions, Users, Engagement rate, Leads and Signups (ours, same source rule as section 3), Conversion
  (signups / sessions).
- **Sessions per day** stacked by source bucket.
- **Three funnels** - Entered on the homepage / on an artist or team page / on a specific event: Visited (session
  start) → Picked an event (select_item; not on the event funnel - they landed inside the order) → Searched flights
  (add_to_cart) → Order summary (view_cart) → Confirmed (begin_checkout + generate_lead) → Purchased (purchase). Each
  step = sessions in which that event fired, with % of Visited. A footnote counts sessions that entered elsewhere.
- **Sources table:** one row per bucket (expandable to its source / medium rows) - sessions, users, engagement,
  confirmed, purchased, conversion.
- **Top landing pages:** 25 rows - page, kind, sessions, purchased.
- GA4 env missing -> the tab says which two variables are needed; a GA4 error -> the error inline.

Users are summed over source rows (a user who came twice through two sources counts twice) - labelled "Users".
Traffic numbers are GA4's and say "GA4"; order numbers are ours and say "ours".

## 8. Instagram and Alerts follow the period

- Instagram: posts published inside the period (newest 200), followers chart over the period.
- Alerts: alerts first seen inside the period; open alerts (not resolved) are always listed.

## 9. Out of scope

Campaign pause / resume, GA4-based attribution, Search Console, Clarity, a per-ad spend breakdown (spend is stored
per ad set), storing previews.

## 10. Files

New: `components/date-range-picker.tsx`, `lib/marketing/range.ts`, `lib/marketing/order-source.ts`,
`lib/marketing/funnel.ts`, `lib/marketing/traffic.ts`, `lib/services/ga4.ts`, `lib/services/marketing-funnel.ts`
(reads), `lib/actions/marketing-ads-actions.ts` (previews), `app/(dashboard)/marketing/traffic-tab.tsx`,
`.../ad-preview.tsx`, selftests `scripts/marketing-{range,funnel,traffic,google}-selftest.ts`.
Changed: `marketing-client.tsx`, `marketing-shared.tsx`, `exec-tab.tsx`, `media-tab.tsx`, `instagram-tab.tsx`,
`alerts-tab.tsx`, `lib/actions/marketing-actions.ts`, `lib/services/marketing-pnl.ts` (+ selftest),
`lib/services/marketing-purchases.ts`, `lib/services/ads/google.ts`, `lib/services/marketing-cache.ts`, the guide,
CLAUDE.md (section + env block). No migration. Main untouched.

## 11. Rollout

1. Push (the push lock; another session may hold it).
2. Vercel env: `NEXT_SECRET_GA4_PROPERTY_ID`, `NEXT_SECRET_GA4_SA_JSON_B64` (prod + preview), redeploy.
3. `marketingSync?only=google&backfill_days=90` - rewrites Google's purchase columns.
4. Open `/marketing` on prod: every tab, ₪ / $, a custom range, one Meta preview, one Google ad group.
