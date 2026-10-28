# Marketing dashboard - sales breakdown, influencers, page & influencer alerts (2026-10-28)

Dor's list (28.10, "תוספות לדאשבורד"), built on his "תעשה מה שהבנת - מקסימום אדייק אותך לאחר מכן": the calls
below are mine unless marked as his, and are the first things to check with him.

## 1. Sales tab (`?tab=sales`) - "פירוק של האירועים שנמכרו לפי התאריך שנבחר: שם האמן, קטגוריה"

- Paid orders of the bar's period, each against the **previous period of the same length** (`previousWindow`,
  `lib/marketing/range.ts`). Source filter applies (the Executive funnel's `orderSourceOf`); brand does not (our
  orders are the Mega Events site's).
- Tables: by artist, football team, category (= the `vertical` tag), league / genre, event (links to `/order/{id}` on
  the site). Each row: orders, tickets, share of tickets, revenue (the P&L's `revenueUsd`, in the bar's currency,
  an order's own USD/ILS rate), trend on tickets.
- Groups come from the event's typed tags (`event_tag_links` -> `event_tags.type`). An event with two team tags counts
  for both teams (my call: tags do not say which side is home - 111 of 425 team-tagged events carry two).
- Pure rules `lib/marketing/sales.ts` (`buildSales`, `splitOrder`, `trendOf`); reads `lib/services/marketing-sales.ts`.

## 2. Alerts - pages and influencers, negative and positive

Four kinds on the existing `marketing_alerts` machinery (free-text kind, no migration), mailed once like the others.

- **What a page sells** (my call, after measuring): GA4's purchases per landing page count only a purchase in the
  same session - 5 in the week to 28.10 against ~30 Paid orders, and the Oasis page had 974 sessions with "0
  purchases" while Oasis sold 81 tickets that month. So a page's sales are OUR Paid orders of what it sells: an event
  page its event, a `/c/` page the events carrying its category's tags (`categories.link_url` -> `category_tags` ->
  `event_tag_links`). The homepage and pages that sell nothing of their own are never judged.
  `lib/marketing/page-subject.ts`, `lib/services/marketing-page-sales.ts`.
- `page_no_sales`: `page_min_sessions`+ sessions in `page_alert_days` and nothing sold. `page_converting`: 2+ orders
  at `page_hot_pct`%+ of sessions. Defaults 14 days / 150 sessions / 1.5% - calibrated on the 30 days to 28.10.
- `influencer_no_sales`: an affiliate with `influencer_min_visitors`+ visitors and no Paid order in
  `influencer_alert_days`; `influencer_selling`: `influencer_hot_orders`+ Paid orders. Defaults 14 days / 30 / 2.
  Visitors and orders are the Partners screen's numbers (`partners_visitors_by_code`, `aff_partner_tracking_code`).
- "Trend detection" (his words) = every alert names its change against the window before it.
- At most 3 NEW alerts per kind per run (the top ones); an open one stays open while it still qualifies, so two
  pages swapping places never re-mail. GA4 not connected / failing = the page kinds are not evaluated and their open
  alerts stay open (`planAlerts(..., skipped)`); a GA4 failure still fails the sync step after the rest ran.
- The same rule paints "No sales" / "Selling" badges on the Traffic landing table and the Influencers table.
- Thresholds on the Settings tab (six new `marketing_settings` keys, validated in `lib/marketing/settings.ts`).
- Pure rules `lib/marketing/perf-alerts.ts`; selftest `scripts/marketing-sales-selftest.ts`. A dry run of the sync
  (`?dry_run=1&only=alerts`) names what it would open.

## 4. Clickable pages (Traffic tab)

Every landing page links to the site (`PUBLIC_SITE_URL` + path; GA4's "(not set)" stays text). The table also shows
sessions vs the previous period (a fifth GA4 report - GA4's batch limit), GA4 purchases, what the page sold, its sale
rate and the badge. 40 pages (was 25).

## 5 + 6. Influencers tab + leaders on Executive

- `?tab=influencers`: every affiliate partner with traffic or orders in either period (agents are not influencers -
  my call). Cards: visitors, Paid orders, revenue, commission (their own terms), conversion; top seller, top traffic
  maker, best conversion (only among those with `influencer_min_visitors`+). Names link to `/partners/{code}/view`.
- Executive "Leaders" row: best-selling artist, best-selling football team, top seller, top traffic maker, Rising
  (artists + teams with the biggest ticket gain). From the same cached reads as the tabs. Influencers only for All
  sources / Partners; nothing for "Other brand". A failure there shows a line, never takes the tab down.

## Not built / open for Dor

- Agents in the Influencers tab (a toggle) - left out.
- A standing "best-selling city / venue" - not asked.
- Positive page alerts will be rare at 1.5%: only Celine Dion, football and event 617 cleared it in the 30 days to
  28.10.
