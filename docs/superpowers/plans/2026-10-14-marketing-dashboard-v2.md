# Marketing Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tom's CMO round on `/marketing` - a period picker on every tab, ₪/$ money, an Executive screen laid out like the reference (spend split, funnel, efficiency, charts), purchase-only platform conversions, a live ad preview, and a GA4 Traffic tab.

**Architecture:** Pure rules in `lib/marketing/*` (range, order source, funnel, traffic) and `lib/services/marketing-pnl.ts`, each with a `scripts/*-selftest.ts`; reads in `lib/services/*`; one guarded server action per screen load in `lib/actions/marketing-*.ts`; client tabs under `app/(dashboard)/marketing/`. GA4 and the ad previews are read live (no new table, no migration).

**Tech Stack:** Next 15 server actions, React 19, shadcn/ui, recharts 2.15, react-day-picker 9, GA4 Data API v1beta, Meta Graph v26.0, Google Ads API v25.

**Spec:** `docs/superpowers/specs/2026-10-14-marketing-dashboard-v2-design.md`

Dor (14.10): "מאשר, תכתוב spec ותבצע" - executed inline (native) right after this plan; the plan is kept compact on purpose: interfaces + test cases per task, code written in the task itself.

## Global Constraints

- UI text English only (Dor, 09.10). Guide stays bilingual.
- Every server action starts with `requireAdmin()`; a read that fails THROWS (an empty answer would read as "nothing").
- Money: ILS default, `cur=usd` switch; ILS spend = `ad_spend_daily.spend` as billed; order money in ILS = USD x the reservation's `exchange_rate_usd_ils_100 / 100`, else the current rate.
- Days = Israel calendar days (Asia/Jerusalem).
- No migration, nothing in myt-main.
- `.in()` lists stay ≤200 ids (URL length); PostgREST pages of 1000 (`fetchPaged` / `readAll`).
- Commit by explicit paths (`git commit -- <paths>`) - the checkout is shared with other sessions.

## Review Focus

1. A custom range with `from > to`, a future `to`, or garbage in the URL -> falls back to 30 days, never a thrown page (Task 1 tests).
2. A reservation with no `exchange_rate_usd_ils_100` in ILS view -> converted at the current rate, never 0 (Task 2 test).
3. Source filter `partners` / `no_utm` / `other` -> spend 0 and cost metrics "—", never a divide-by-zero `Infinity` (Task 3 test).
4. Meta preview returning an iframe on an unexpected host -> refused, never rendered (Task 8 test on `previewSrcFrom`).
5. GA4 env missing -> Traffic tab explains, the other tabs keep working (Task 9: action returns `{ connected: false }`).

---

### Task 1: Period rules (`lib/marketing/range.ts`)

**Files:** Create `lib/marketing/range.ts`, `scripts/marketing-range-selftest.ts`. Modify `lib/services/marketing-pnl.ts` (`rangeWindow` kept for the alerts / old callers).

**Interfaces - Produces:**
- `MARKETING_PERIODS = ["today","yesterday","7d","30d","90d","month","last_month","custom"] as const`, `type MarketingPeriod`.
- `israelToday(now?: Date): string` (yyyy-mm-dd in Asia/Jerusalem).
- `resolveWindow(input: { range?: string; from?: string; to?: string }, now?: Date): { range: MarketingPeriod; since: string; until: string }` - invalid -> 30d.
- `daysBetween(since, until): string[]` (every day inclusive).
- `israelDayOf(iso: string): string` (a timestamp's Israel date).
- `israelDayStartUtc(day: string): string` (ISO of 00:00 Asia/Jerusalem that day) - for the reservations read.

- [ ] Selftest cases: 30d on 2026-10-14 = 09-15..10-14; yesterday; month; last_month on 2026-03-05 = 02-01..02-28; custom valid; custom from>to -> 30d; custom future `to` -> 30d; span 367 days -> 30d; `israelDayOf("2026-10-13T22:30:00Z")` = "2026-10-14" (IDT +3); `israelDayStartUtc("2026-10-14")` = "2026-10-13T21:00:00.000Z"; winter (IST +2) `israelDayStartUtc("2026-12-01")` = "2026-11-30T22:00:00.000Z"; `daysBetween` length 30.
- [ ] Run `npx tsx scripts/marketing-range-selftest.ts` -> fails (no module), implement, passes.
- [ ] Commit.

### Task 2: P&L in ₪/$ + source slice (`marketing-pnl.ts`, `marketing-purchases.ts`, actions)

**Files:** Modify `lib/services/marketing-pnl.ts`, `scripts/marketing-pnl-selftest.ts`, `lib/services/marketing-purchases.ts`, `lib/actions/marketing-actions.ts`, any reader of the renamed fields.

**Interfaces:**
- `type MarketingCurrency = "ils" | "usd"`.
- `SpendLike` += `spend: number; currency: string; fx_rate: number`.
- `AttributedReservation` += `usdIls: number | null` (ILS per USD of that order).
- `PnlTotals` money fields renamed: `spend, revenue, cogs, fee, net, platformValue, cac` (+ counts unchanged).
- `buildPnl({ spend, entities, reservations, feePct, brand, currency, platform?: "meta" | "google", fallbackUsdIls })` - `platform` keeps only that platform's spend, campaigns and unresolved.
- `Pnl` += `currency`.
- `attributedReservations(since, until)` reads by Israel day boundaries, `day` = Israel day, adds `usdIls`.

- [ ] Selftest additions: ILS view (spend in ILS = stored `spend`); a reservation with `usdIls: 3.7` -> revenue x3.7; `usdIls: null` -> `fallbackUsdIls`; platform value ILS as is, USD x fx_rate; `platform: "google"` keeps only google rows.
- [ ] Update existing asserts to the renamed fields; run -> pass.
- [ ] Commit.

### Task 3: Order source + funnel (`lib/marketing/order-source.ts`, `lib/marketing/funnel.ts`, `lib/services/marketing-funnel.ts`)

**Interfaces:**
- `ORDER_SOURCES = ["meta","google","partners","no_utm","other"] as const`; `type OrderSource`; `type SourceFilter = "all" | OrderSource`.
- `orderSourceOf(o: { touches: UtmTouchLike[]; partnerCode: string | null }): OrderSource` (paidTouchOf with null lookups -> platform; partner; any touch -> other; none -> no_utm).
- `FunnelOrder = { day: string; paid: boolean; tickets: number; source: OrderSource }`.
- `buildFunnel(orders, spendDaily: { day; meta; google }[], days: string[], src: SourceFilter)` -> totals + ratios (`null` when a side is 0) + `daily`.
- `funnelOrders(since, until): Promise<FunnelOrder[]>` (all statuses, not deleted, touches chunked 150).

- [ ] Selftest: gclid touch -> google; fbclid -> meta; partner code -> partners; influencer at position 0 + no paid touch -> partners; utm_source=newsletter -> other; none -> no_utm; funnel counts; src=partners -> spend 0 and every cost `null`; daily covers every day with zeros.
- [ ] Commit.

### Task 4: Google purchases only (`lib/services/ads/google.ts`)

**Interfaces:** `mergeGooglePurchases(rows: AdSpendRow[], purchases: { campaignId; adsetKey; day; conversions; value }[]): AdSpendRow[]` - sets `platform_conversions` / `platform_value` from the purchase rows (0 when none), never adds a row.

- [ ] Selftest (`scripts/marketing-google-selftest.ts`): a matching purchase row replaces the old all-conversions; a row with no purchase row -> 0; a purchase row with no spend row is dropped.
- [ ] `fetchGoogleSpend` drops `metrics.conversions*` from the cost queries and runs two more: ad-group and P.Max campaign level with `segments.conversion_action_category = 'PURCHASE'`, `metrics.all_conversions, metrics.all_conversions_value`.
- [ ] Commit.

### Task 5: Filter bar (`components/date-range-picker.tsx`, `marketing-shared.tsx`, `marketing-client.tsx`)

**Interfaces:** `DateRangePicker` generic (presets + two-month range calendar in a Popover). `useMarketingFilters()` over `useQueryState(["range","from","to","cur","brand","src"])`. `money(n, cur)` formatter. One `MarketingFilterBar` above the tabs; hidden on `settings`.

- [ ] Build, wire, commit.

### Task 6: Executive (`exec-tab.tsx`)

One action `getMarketingOverview(q)` = P&L + funnel in ONE call (Next runs a tab's actions one at a time). Sections SPEND / FUNNEL / EFFICIENCY / PROFIT + 3 charts (AreaChart spend by platform, LineChart leads/signups/passengers, ComposedChart spend bars + revenue line + signups on a right axis).

- [ ] Build, commit.

### Task 7: Media (`media-tab.tsx`)

Columns: Platform revenue (own column), Purchases (platform) with one decimal only when fractional, ⓘ tooltips, totals row, money in the chosen currency.

- [ ] Build, commit.

### Task 8: Live ad (`lib/actions/marketing-ads-actions.ts`, `lib/marketing/ad-preview.ts`, `ad-preview.tsx`)

**Interfaces:**
- `previewSrcFrom(body: string): string | null` (pure; https + host `business.facebook.com` / `www.facebook.com` only; `&amp;` unescaped).
- `listAdsetAds(adsetId)` -> Meta `ad_entities` rows `{ id, name, status }`.
- `getMetaAdPreview(adId, format)` -> `{ ok: true, src } | { ok: false, error }`.
- `getGoogleAds(q: { adGroupId } | { campaignId })` -> `{ ok, items: { id, kind, headlines[], descriptions[], images[], finalUrl }[] }`.
- [ ] Selftest cases for `previewSrcFrom` (good body, other host, http, no iframe, `&amp;`).
- [ ] Commit.

### Task 9: Traffic (`lib/services/ga4.ts`, `lib/marketing/traffic.ts`, `traffic-tab.tsx`)

**Interfaces:**
- `ga4Configured(): boolean`; `ga4BatchReports(requests): Promise<Ga4Row[][]>`; `Ga4Row = { dims: string[]; mets: number[] }`.
- `trafficBucket(source, medium, partnerCodes: Set<string>): OrderSource`.
- `buildTraffic({ daily, steps, partnerCodes, src, orders, days })` -> cards + per-day by bucket + three funnels + sources table + landing pages.
- `getTraffic(q)` -> `{ connected: false } | { connected: true, view }`, cached 600 s.
- [ ] Selftest: buckets (facebook/cpc, m.facebook.com/referral, google/cpc, google/organic -> other, michaela/influencer, partner code "sagi"/referral -> partners, (direct)/(none) -> no_utm); funnel step sums per landing kind; src filter; confirmed = begin_checkout + generate_lead.
- [ ] Commit.

### Task 10: Instagram + Alerts follow the period

`getInstagramFeed({ since, until })`, `getMarketingAlerts({ since, until })` (open alerts always).

- [ ] Commit.

### Task 11: Docs + verify

Guide section "Marketing dashboard" (EN + HE) + `npx tsx scripts/guide-selftest.ts`; CLAUDE.md marketing section + env block (`NEXT_SECRET_GA4_PROPERTY_ID`, `NEXT_SECRET_GA4_SA_JSON_B64`); `npx tsc --noEmit`; `npm run lint`; every marketing selftest; browser check on the dev server.

- [ ] Commit.
