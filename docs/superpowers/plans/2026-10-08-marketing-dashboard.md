# Marketing Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/marketing` screen in the backoffice that shows real spend (Meta + Google), real revenue and COGS per campaign (last paid touch), Instagram performance, and email alerts - on top of a data layer that stops lying (revenue, COGS, purchase value).

**Architecture:** One 6-hourly cron (`marketingSync`) mirrors Meta / Google / Instagram into backoffice-only tables and fills ticket costs; pure, selftested modules compute revenue/COGS per reservation, attribute each Paid reservation to its last paid touch, join it with spend, and raise alerts; server actions read those tables and the reservations (cached) for a tabbed admin screen. Main gets two small changes: a ticket-cost snapshot at confirm-order and a real purchase value.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (service role, `supabase as any` boundary until `npm run db:types`), shadcn/ui + `DataTable` + recharts (`components/ui/chart.tsx`), `node:crypto` for the Google JWT, `lib/email.ts` for mail, `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md`

## Global Constraints

- Backoffice repo: `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-backoffice`, branch `master`, commit freely, **never push** (Dor pushes). Main repo: `...\MYT_Git_Shered\myt-main` (detached HEAD - commit on it; push is Dor's).
- Conventional commits, no AI co-author line. Commit ONLY the files of the task: `git add <paths> && git commit -m "..." -- <paths>` (the checkout is shared with other sessions).
- Secrets: never print a token or key. They are in `.env.local` (backoffice) under "MARKETING DASHBOARD": `NEXT_SECRET_META_READ_TOKEN`, `NEXT_SECRET_META_AD_ACCOUNT_ID` (`act_...`), `NEXT_SECRET_META_PAGE_ID`, `NEXT_SECRET_META_IG_USER_ID`, `NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID`, `NEXT_SECRET_GOOGLE_SA_JSON_B64` (base64 of the service-account JSON). Meta Graph API version `v26.0`; Google Ads API `v25`, no developer token header.
- Display currency USD. Ad accounts bill in ILS: store `spend` + `currency` + `spend_usd` + `fx_rate`.
- New tables are backoffice-only: RLS on, no policies. No CHECK constraint on `reservations` columns (main writes that table).
- Pure modules have no DB / fetch imports and run under `npx tsx scripts/<name>-selftest.ts`; every one in this plan is listed in Task 15's checklist.
- Every cron route starts with `guardCronRoute(request)`; `?dry_run=1` = zero writes, zero mails. Server actions start with `requireAdmin()`.
- Hebrew UI labels as written in the spec; code and comments in English.
- `.claude/hooks` deny the first Write/Edit of a file (GateGuard): state the facts it asks for and retry once.

---

### Task 1: Migration - reservation cost columns and the eight marketing tables

**Files:**
- Create: `supabase/migrations/20261008120000_marketing_dashboard.sql`
- Create: `types/marketing.types.ts`
- Create: `lib/services/marketing-db.ts`

**Interfaces:**
- Produces: table shapes below; `mdb` boundary client; row types `AdSpendRow`, `AdEntityRow`, `AdClickRow`, `IgMediaRow`, `IgInsightRow`, `IgAccountRow`, `MarketingAlertRow`, `MarketingSettings`, `DEFAULT_MARKETING_SETTINGS`, `MARKETING_SETTING_KEYS`.

- [ ] **Step 1: Write the migration**

```sql
-- Marketing dashboard (spec docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md).
-- 1) reservations: the supplier cost of the ticket, snapshotted by main's confirm-order
--    ('live') or filled nightly by the backoffice ('estimated'), and ops' real total
--    (actual_cost_usd wins over everything). No CHECK - main writes this table.
-- 2) eight backoffice-only tables: RLS on, no policies, service role only; main never reads them.
-- Additive only. Rollback: drop the eight tables, drop the four columns.

alter table public.reservations
  add column if not exists ticket_cost_usd     numeric,
  add column if not exists ticket_cost_source  text,
  add column if not exists actual_cost_usd     numeric,
  add column if not exists actual_cost_note    text;

create table if not exists public.ad_spend_daily (
  platform             text not null,          -- 'meta' | 'google'
  account_id           text not null,
  campaign_id          text not null,
  adset_key            text not null default '', -- Meta adset id | Google ad-group id | '' = campaign-level row
  level                text not null default 'adset', -- 'adset' | 'campaign'
  day                  date not null,
  spend                numeric not null default 0,
  currency             text not null default 'ILS',
  spend_usd            numeric not null default 0,
  fx_rate              numeric not null default 0,  -- USD per 1 unit of currency, at sync time
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  platform_conversions numeric not null default 0,
  platform_value       numeric not null default 0,
  synced_at            timestamptz not null default now(),
  primary key (platform, campaign_id, adset_key, day)
);
create index if not exists ad_spend_daily_day_idx on public.ad_spend_daily (day);
alter table public.ad_spend_daily enable row level security;

create table if not exists public.ad_entities (
  platform       text not null,
  id             text not null,
  kind           text not null,   -- 'campaign' | 'adset' | 'ad_group' | 'ad'
  name           text not null default '',
  parent_id      text,
  campaign_id    text,
  status         text,
  channel        text,            -- Meta objective | Google advertising_channel_type
  landing_domain text,
  url_tags       text,
  brand          text not null default 'other',   -- 'mega_events' | 'other'
  brand_source   text not null default 'rule',    -- 'rule' | 'manual'
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (platform, id)
);
create index if not exists ad_entities_campaign_idx on public.ad_entities (platform, campaign_id);
alter table public.ad_entities enable row level security;

create table if not exists public.ad_clicks (
  gclid        text primary key,
  campaign_id  text not null,
  ad_group_id  text,
  day          date not null,
  synced_at    timestamptz not null default now()
);
create index if not exists ad_clicks_day_idx on public.ad_clicks (day);
alter table public.ad_clicks enable row level security;

create table if not exists public.ig_media (
  id                 text primary key,
  ig_user_id         text not null,
  media_type         text,
  media_product_type text,        -- 'FEED' | 'REELS' | 'STORY'
  caption            text,
  permalink          text,
  media_url          text,
  thumbnail_url      text,
  posted_at          timestamptz,
  like_count         integer not null default 0,
  comments_count     integer not null default 0,
  reach              integer not null default 0,
  saved              integer not null default 0,
  shares             integer not null default 0,
  views              integer not null default 0,
  insights_at        timestamptz,
  synced_at          timestamptz not null default now()
);
create index if not exists ig_media_posted_idx on public.ig_media (ig_user_id, posted_at desc);
alter table public.ig_media enable row level security;

create table if not exists public.ig_media_insights_daily (
  media_id  text not null references public.ig_media(id) on delete cascade,
  day       date not null,
  reach     integer not null default 0,
  saved     integer not null default 0,
  shares    integer not null default 0,
  views     integer not null default 0,
  likes     integer not null default 0,
  comments  integer not null default 0,
  primary key (media_id, day)
);
alter table public.ig_media_insights_daily enable row level security;

create table if not exists public.ig_account_daily (
  ig_user_id  text not null,
  day         date not null,
  followers   integer not null default 0,
  media_count integer not null default 0,
  primary key (ig_user_id, day)
);
alter table public.ig_account_daily enable row level security;

create table if not exists public.marketing_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.marketing_settings enable row level security;

create table if not exists public.marketing_alerts (
  kind           text not null,   -- 'budget_bleed' | 'viral_post'
  key            text not null,   -- campaign id | media id
  payload        jsonb not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  last_mailed_at timestamptz,
  resolved_at    timestamptz,
  primary key (kind, key)
);
alter table public.marketing_alerts enable row level security;
```

- [ ] **Step 2: Write the row types and settings defaults**

`types/marketing.types.ts`:

```ts
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
```

`lib/services/marketing-db.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// The ONE untyped boundary for the marketing tables (types/marketing.types.ts carries the
// shapes) until `npm run db:types` is rerun after migration 20261008120000 is applied.
import { supabase } from "@/lib/supabase-server";

export const mdb = supabase as any;
```

- [ ] **Step 3: Check the migration has a unique prefix and eight tables**

Run: `ls supabase/migrations | grep -c "^20261008120000"` -> `1`; `grep -c "create table if not exists" supabase/migrations/20261008120000_marketing_dashboard.sql` -> `8`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261008120000_marketing_dashboard.sql types/marketing.types.ts lib/services/marketing-db.ts
git commit -m "feat(marketing): migration - ticket cost columns on reservations, ad spend / entities / clicks, instagram, settings and alert tables" -- supabase/migrations/20261008120000_marketing_dashboard.sql types/marketing.types.ts lib/services/marketing-db.ts
```

---

### Task 2: Revenue and COGS per reservation (pure) + the dashboard's fake revenue

**Files:**
- Create: `lib/services/reservation-pnl.ts`
- Create: `scripts/reservation-pnl-selftest.ts`
- Modify: `lib/actions/dashboard-actions.ts:115-172` (the Paid query + `totalRevenue`)

**Interfaces:**
- Consumes: `isPaid` from `lib/partner-commission.ts` (exact `status === "Paid"`), `normalizeReservationEventOrderInfo` from `lib/utils.ts`.
- Produces: `PnlReservation`, `revenueUsd(r)`, `cogsUsd(r)`, `netUsd(r, feePct)`, `Cogs`.

- [ ] **Step 1: Write the failing selftest**

`scripts/reservation-pnl-selftest.ts`:

```ts
// Run: npx tsx scripts/reservation-pnl-selftest.ts
import assert from "node:assert/strict";
import { revenueUsd, cogsUsd, netUsd, type PnlReservation } from "../lib/services/reservation-pnl";

const base: PnlReservation = {
  status: "Paid",
  user_shown_price: 1000,
  exchange_rate_usd_ils_100: 370,
  agent_card_discount_ils: null,
  partner_settlement_method: null,
  flight_order_info: { price: 500, isOffline: false, offer: { price: { grandTotal: "420.50" } }, added_bags: { total_usd: 30, cabin: { total_usd: 0 } } },
  hotel_order_info: { price: "300", isOffline: false },
  hotel_segments: null,
  offline_flight_cost: null,
  offline_hotel_cost: null,
  ticket_cost_usd: 150,
  ticket_cost_source: "live",
  actual_cost_usd: null,
  event_order_info: { number_of_ticket: 2, price_per_ticket: 120, total_tickets_price: 240 },
};

assert.equal(revenueUsd(base), 1000);
assert.equal(revenueUsd({ ...base, status: "Lost" }), null, "only Paid has revenue");
assert.equal(revenueUsd({ ...base, status: "paid" }), null, "exact casing, like the commission engine");
assert.equal(
  revenueUsd({ ...base, partner_settlement_method: "agent_card", agent_card_discount_ils: 370 }),
  900,
  "agent card: the ILS discount comes off at the reservation's own rate",
);

const c = cogsUsd(base);
assert.equal(c.flight, 450.5, "Amadeus grandTotal + bags, never the customer price");
assert.equal(c.hotel, 300);
assert.equal(c.ticket, 150);
assert.equal(c.total, 900.5);
assert.equal(c.source, "computed");
assert.equal(c.estimated, false);

const offline = cogsUsd({ ...base, flight_order_info: { price: 600, isOffline: true, offlineRawPrice: 250 }, offline_flight_cost: 500, hotel_order_info: { price: "999", isOffline: true }, offline_hotel_cost: 280 });
assert.equal(offline.flight, 500, "offline flight cost is already the booking total");
assert.equal(offline.hotel, 280);

const split = cogsUsd({ ...base, hotel_segments: [{ price: "300" }, { price: "120" }] });
assert.equal(split.hotel, 420, "a split stay sums every segment; hotel_order_info is segment 0");

const noOffer = cogsUsd({ ...base, flight_order_info: { price: 500 } });
assert.equal(noOffer.flight, 500);
assert.equal(noOffer.estimated, true, "customer price as cost = estimated, never silent");

const noTicket = cogsUsd({ ...base, ticket_cost_usd: null, ticket_cost_source: null });
assert.equal(noTicket.ticket, 240, "no snapshot: the sale price, flagged");
assert.equal(noTicket.estimated, true);

const est = cogsUsd({ ...base, ticket_cost_source: "estimated" });
assert.equal(est.estimated, true);

const actual = cogsUsd({ ...base, actual_cost_usd: 777 });
assert.equal(actual.total, 777);
assert.equal(actual.source, "actual");
assert.equal(actual.estimated, false, "ops typed the real number");

assert.equal(netUsd(base, 2), 1000 - 900.5 - 20);
assert.equal(netUsd({ ...base, status: "Pending" }, 2), null);

const skipped = cogsUsd({ ...base, flight_order_info: {}, hotel_order_info: {} });
assert.equal(skipped.flight, 0, "a skipped flight costs nothing");
assert.equal(skipped.hotel, 0);

console.log("reservation-pnl selftest OK");
```

- [ ] **Step 2: Run it - expect a module-not-found failure**

Run: `npx tsx scripts/reservation-pnl-selftest.ts` -> `Cannot find module '../lib/services/reservation-pnl'`.

- [ ] **Step 3: Implement**

`lib/services/reservation-pnl.ts`:

```ts
/**
 * Revenue, COGS and net profit of ONE reservation, in USD - the marketing dashboard's
 * arithmetic (spec 2026-10-08-marketing-dashboard-design.md, section 2.1). Pure: no DB,
 * no fetch; `scripts/reservation-pnl-selftest.ts` runs it under plain node.
 *
 * Why these columns: `user_shown_price` IS what the customer pays in USD, net of the coupon
 * (never subtract coupon_discount_usd again). An Amadeus offer's `price.grandTotal` is what
 * WE pay; a hotel carries no markup, so its price is its cost; offline inventory already
 * stores its cost; a ticket's cost is the snapshot column (main / nightly fill) or, when
 * none, the SALE price flagged `estimated` so the screen says "משוער" instead of hiding it.
 */
import { isPaid } from "@/lib/partner-commission";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";

export type PnlReservation = {
  status: string | null;
  user_shown_price: number | null;
  exchange_rate_usd_ils_100: number | null;
  agent_card_discount_ils: number | string | null;
  partner_settlement_method: string | null;
  flight_order_info: unknown;
  hotel_order_info: unknown;
  hotel_segments: unknown;
  offline_flight_cost: number | string | null;
  offline_hotel_cost: number | string | null;
  ticket_cost_usd: number | string | null;
  ticket_cost_source: string | null;
  actual_cost_usd: number | string | null;
  event_order_info: unknown;
};

export interface Cogs {
  total: number;
  flight: number;
  hotel: number;
  ticket: number;
  source: "actual" | "computed";
  /** Some component is a stand-in (customer price as cost, inverted markup, no snapshot). */
  estimated: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the customer paid us, USD. null unless Paid. */
export function revenueUsd(r: PnlReservation): number | null {
  if (!isPaid(r as { status: string | null })) return null;
  const price = num(r.user_shown_price) ?? 0;
  if (r.partner_settlement_method !== "agent_card") return price;
  const discountIls = num(r.agent_card_discount_ils) ?? 0;
  const rate = (num(r.exchange_rate_usd_ils_100) ?? 0) / 100;
  return rate > 0 ? round2(price - discountIls / rate) : price;
}

function flightCost(r: PnlReservation): { usd: number; estimated: boolean } {
  const f = obj(r.flight_order_info);
  if (Object.keys(f).length === 0) return { usd: 0, estimated: false };
  if (f.isOffline === true) {
    const c = num(r.offline_flight_cost);
    return c !== null ? { usd: c, estimated: false } : { usd: num(f.price) ?? 0, estimated: true };
  }
  const grand = num(obj(obj(f.offer).price).grandTotal);
  if (grand !== null) {
    const bags = obj(f.added_bags);
    const extra = (num(bags.total_usd) ?? 0) + (num(obj(bags.cabin).total_usd) ?? 0);
    return { usd: round2(grand + extra), estimated: false };
  }
  return { usd: num(f.price) ?? 0, estimated: true };
}

function hotelCost(r: PnlReservation): { usd: number; estimated: boolean } {
  const h = obj(r.hotel_order_info);
  if (Object.keys(h).length === 0) return { usd: 0, estimated: false };
  if (h.isOffline === true) {
    const c = num(r.offline_hotel_cost);
    return c !== null ? { usd: c, estimated: false } : { usd: num(h.price) ?? 0, estimated: true };
  }
  const segments = Array.isArray(r.hotel_segments) && r.hotel_segments.length > 1 ? r.hotel_segments : [h];
  const sum = segments.reduce<number>((acc, s) => acc + (num(obj(s).price) ?? 0), 0);
  return { usd: round2(sum), estimated: false };
}

function ticketCost(r: PnlReservation): { usd: number; estimated: boolean } {
  const snap = num(r.ticket_cost_usd);
  if (snap !== null) return { usd: snap, estimated: r.ticket_cost_source === "estimated" };
  const sale = normalizeReservationEventOrderInfo(r.event_order_info as never).reduce<number>(
    (acc, e) => acc + (num((e as { total_tickets_price?: unknown }).total_tickets_price) ?? 0),
    0,
  );
  return { usd: sale, estimated: true };
}

/** Supplier cost of the whole order, USD. `actual_cost_usd` (ops) wins whole. */
export function cogsUsd(r: PnlReservation): Cogs {
  const actual = num(r.actual_cost_usd);
  if (actual !== null) return { total: actual, flight: 0, hotel: 0, ticket: 0, source: "actual", estimated: false };
  const f = flightCost(r);
  const h = hotelCost(r);
  const t = ticketCost(r);
  return {
    total: round2(f.usd + h.usd + t.usd),
    flight: f.usd,
    hotel: h.usd,
    ticket: t.usd,
    source: "computed",
    estimated: f.estimated || h.estimated || t.estimated,
  };
}

/** revenue - cogs - processing fee (percent of revenue). null unless Paid. */
export function netUsd(r: PnlReservation, feePct: number): number | null {
  const rev = revenueUsd(r);
  if (rev === null) return null;
  return round2(rev - cogsUsd(r).total - (rev * feePct) / 100);
}
```

- [ ] **Step 4: Run the selftest - expect OK**

Run: `npx tsx scripts/reservation-pnl-selftest.ts` -> `reservation-pnl selftest OK`.

- [ ] **Step 5: Replace `pax * 175` in the dashboard**

In `lib/actions/dashboard-actions.ts`, the Paid query (~line 115) selects `more_pax_info` only. Change its select to `"status, user_shown_price, exchange_rate_usd_ils_100, agent_card_discount_ils, partner_settlement_method"` and replace the reducer:

```ts
import { revenueUsd } from "@/lib/services/reservation-pnl";
// ...
const totalRevenue = paidReservations.reduce<number>(
  (sum, r) => sum + (revenueUsd({ ...EMPTY_PNL, ...r } as never) ?? 0),
  0,
);
```

with, near the top of the file:

```ts
/** revenueUsd reads only the five money columns; the rest of PnlReservation is irrelevant here. */
const EMPTY_PNL = { flight_order_info: null, hotel_order_info: null, hotel_segments: null, offline_flight_cost: null, offline_hotel_cost: null, ticket_cost_usd: null, ticket_cost_source: null, actual_cost_usd: null, event_order_info: null };
```

Keep the `pax` count if the card below it still shows travellers; otherwise delete the dead `pax` line.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "reservation-pnl|dashboard-actions"` -> no lines.

```bash
git add lib/services/reservation-pnl.ts scripts/reservation-pnl-selftest.ts lib/actions/dashboard-actions.ts
git commit -m "feat(marketing): revenue, COGS and net per reservation (pure, selftested); the dashboard's revenue card stops counting pax x 175" -- lib/services/reservation-pnl.ts scripts/reservation-pnl-selftest.ts lib/actions/dashboard-actions.ts
```

---

### Task 3: Brand rule + Meta client

**Files:**
- Create: `lib/services/ads/brand.ts`
- Create: `scripts/ad-brand-selftest.ts`
- Create: `lib/services/ads/meta.ts`

**Interfaces:**
- Produces: `brandOf({ name, landingDomain })`, `landingDomainOf(url)`, `MEGA_EVENTS_DOMAIN`; `graphGetAll(path, params, maxPages)`, `fetchMetaSpend(opts)`, `fetchMetaEntities(opts)`, `parseMetaInsight(raw, ctx)` (pure), `creativeLandingDomain(creative)` (pure).

- [ ] **Step 1: Selftest for the brand rule**

`scripts/ad-brand-selftest.ts`:

```ts
// Run: npx tsx scripts/ad-brand-selftest.ts
import assert from "node:assert/strict";
import { brandOf, landingDomainOf } from "../lib/services/ads/brand";

assert.equal(brandOf({ name: "MYT - Feed V2 - Aug 2026", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "לידים מייטי - Submit Application", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "מגה אירועים - 1-1-2026", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "P.Max - MegaEvents MYT - Football", landingDomain: null }), "mega_events");
assert.equal(brandOf({ name: "search_brand-newn", landingDomain: "mega-events.co.il" }), "mega_events");
assert.equal(brandOf({ name: "search_brand-newn", landingDomain: "www.mega-events.co.il" }), "mega_events");
assert.equal(brandOf({ name: "פמלי טיולי משפחות", landingDomain: "megatr.co.il" }), "other");
assert.equal(brandOf({ name: "פוסט באינסטגרם: ההרשמה לטיולי חגי תשרי", landingDomain: null }), "other");
assert.equal(brandOf({ name: "", landingDomain: null }), "other");

assert.equal(landingDomainOf("https://www.mega-events.co.il/c/football?utm_source=x"), "mega-events.co.il");
assert.equal(landingDomainOf("not a url"), null);
assert.equal(landingDomainOf(null), null);

console.log("ad-brand selftest OK");
```

- [ ] **Step 2: Run it - expect module not found**

- [ ] **Step 3: Implement `lib/services/ads/brand.ts`**

```ts
/**
 * Which brand an ad campaign belongs to. One Meta ad account and one Google Ads customer
 * serve MYT / Mega Events, Mega Family and Mega TR together, so every campaign row is
 * tagged: `mega_events` when its name says so or its landing page is our site, else
 * `other`. The sync re-applies this to `brand_source = 'rule'` rows only - a brand set by
 * hand on the Settings tab (`manual`) is never touched. Pure; scripts/ad-brand-selftest.ts.
 */
import type { AdBrand } from "@/types/marketing.types";

export const MEGA_EVENTS_DOMAIN = "mega-events.co.il";

const NAME_HINTS = /myt|מייטי|mega ?events|מגה ?אירועים|megaevents/i;

export function landingDomainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function brandOf(input: { name: string | null | undefined; landingDomain: string | null | undefined }): AdBrand {
  const domain = (input.landingDomain ?? "").replace(/^www\./, "").toLowerCase();
  if (domain === MEGA_EVENTS_DOMAIN) return "mega_events";
  if (NAME_HINTS.test(input.name ?? "")) return "mega_events";
  return "other";
}
```

- [ ] **Step 4: Run the selftest - expect OK**

- [ ] **Step 5: Implement `lib/services/ads/meta.ts`**

```ts
/**
 * Meta Marketing API reader (Graph v26.0 - an unversioned call answers "deprecated" on
 * ads). Read token only (system user "Insights Reader"); the token travels in the
 * Authorization header, never in a URL. Returns rows shaped for the marketing tables; the
 * sync (lib/services/marketing-sync.ts) writes them. Spec section 4 step 1.
 */
import type { AdEntityRow, AdSpendRow } from "@/types/marketing.types";
import { brandOf, landingDomainOf } from "./brand";

const GRAPH = "https://graph.facebook.com/v26.0";

type Json = Record<string, unknown>;

function token(): string {
  const t = process.env.NEXT_SECRET_META_READ_TOKEN?.trim();
  if (!t) throw new Error("NEXT_SECRET_META_READ_TOKEN is not set");
  return t;
}

/** One Graph GET with paging (`paging.next`) - at most `maxPages` pages. */
export async function graphGetAll<T = Json>(path: string, params: Record<string, string>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  const first = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) first.searchParams.set(k, v);
  let url: string | null = first.toString();
  let pages = 0;
  while (url && pages < maxPages) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { data?: T[]; paging?: { next?: string }; error?: { message: string; code: number } };
    if (!res.ok || body.error) throw new Error(`Meta ${path}: ${body.error?.message ?? res.status} (code ${body.error?.code ?? "-"})`);
    out.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
    pages += 1;
  }
  return out;
}

export interface MetaInsightRaw {
  campaign_id: string;
  adset_id?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

/** Pure: one insight row -> one ad_spend_daily row. `fxRate` = USD per 1 unit of `currency`. */
export function parseMetaInsight(raw: MetaInsightRaw, ctx: { accountId: string; currency: string; fxRate: number }): AdSpendRow {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const purchase = (list?: { action_type: string; value: string }[]) => n(list?.find((a) => a.action_type === "purchase")?.value);
  const spend = n(raw.spend);
  return {
    platform: "meta",
    account_id: ctx.accountId,
    campaign_id: raw.campaign_id,
    adset_key: raw.adset_id ?? "",
    level: raw.adset_id ? "adset" : "campaign",
    day: raw.date_start,
    spend,
    currency: ctx.currency,
    spend_usd: Math.round(spend * ctx.fxRate * 100) / 100,
    fx_rate: ctx.fxRate,
    impressions: n(raw.impressions),
    clicks: n(raw.clicks),
    platform_conversions: purchase(raw.actions),
    platform_value: purchase(raw.action_values),
  };
}

/** Daily adset-level spend between two yyyy-mm-dd days (inclusive). */
export async function fetchMetaSpend(opts: { accountId: string; since: string; until: string; currency: string; fxRate: number }): Promise<AdSpendRow[]> {
  const raws = await graphGetAll<MetaInsightRaw>(`/${opts.accountId}/insights`, {
    level: "adset",
    time_increment: "1",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    fields: "campaign_id,adset_id,spend,impressions,clicks,actions,action_values",
    limit: "500",
  });
  return raws.map((r) => parseMetaInsight(r, opts));
}

interface MetaCreative { url_tags?: string; link_url?: string; object_story_spec?: { link_data?: { link?: string }; video_data?: { call_to_action?: { value?: { link?: string } } } }; asset_feed_spec?: { link_urls?: { website_url?: string }[] } }

/** Pure: the landing domain of a creative, if it names one (catalog ads do not). */
export function creativeLandingDomain(c: MetaCreative | undefined): string | null {
  if (!c) return null;
  const link = c.link_url ?? c.object_story_spec?.link_data?.link ?? c.object_story_spec?.video_data?.call_to_action?.value?.link ?? c.asset_feed_spec?.link_urls?.[0]?.website_url ?? null;
  return landingDomainOf(link);
}

/** Campaigns, adsets and ads of the account -> ad_entities rows (brand by rule on campaigns; the sync copies it down and keeps manual brands). */
export async function fetchMetaEntities(opts: { accountId: string }): Promise<AdEntityRow[]> {
  const [campaigns, adsets, ads] = await Promise.all([
    graphGetAll<{ id: string; name: string; effective_status: string; objective: string }>(`/${opts.accountId}/campaigns`, { fields: "id,name,effective_status,objective", limit: "500" }),
    graphGetAll<{ id: string; name: string; effective_status: string; campaign_id: string }>(`/${opts.accountId}/adsets`, { fields: "id,name,effective_status,campaign_id", limit: "500" }),
    graphGetAll<{ id: string; name: string; effective_status: string; campaign_id: string; adset_id: string; creative?: MetaCreative }>(`/${opts.accountId}/ads`, { fields: "id,name,effective_status,campaign_id,adset_id,creative{url_tags,link_url,object_story_spec,asset_feed_spec}", limit: "500" }),
  ]);
  const domainByCampaign = new Map<string, string>();
  for (const ad of ads) {
    const d = creativeLandingDomain(ad.creative);
    if (d && !domainByCampaign.has(ad.campaign_id)) domainByCampaign.set(ad.campaign_id, d);
  }
  const rows: AdEntityRow[] = [];
  for (const c of campaigns) {
    const landing = domainByCampaign.get(c.id) ?? null;
    rows.push({ platform: "meta", id: c.id, kind: "campaign", name: c.name, parent_id: null, campaign_id: c.id, status: c.effective_status, channel: c.objective, landing_domain: landing, url_tags: null, brand: brandOf({ name: c.name, landingDomain: landing }), brand_source: "rule" });
  }
  for (const a of adsets) rows.push({ platform: "meta", id: a.id, kind: "adset", name: a.name, parent_id: a.campaign_id, campaign_id: a.campaign_id, status: a.effective_status, channel: null, landing_domain: null, url_tags: null, brand: "other", brand_source: "rule" });
  for (const ad of ads) rows.push({ platform: "meta", id: ad.id, kind: "ad", name: ad.name, parent_id: ad.adset_id, campaign_id: ad.campaign_id, status: ad.effective_status, channel: null, landing_domain: creativeLandingDomain(ad.creative), url_tags: ad.creative?.url_tags ?? null, brand: "other", brand_source: "rule" });
  return rows;
}
```

- [ ] **Step 6: Smoke the client read-only against the live account**

Write a throwaway `scripts/_meta-smoke.ts` (never committed; delete after): parse `.env.local` by hand (`fs.readFileSync`, split on `=`, set `process.env`), then print `(await fetchMetaSpend({ accountId: process.env.NEXT_SECRET_META_AD_ACCOUNT_ID!, since: <7 days ago>, until: <today>, currency: "ILS", fxRate: 0.27 })).length` and the campaign count of `fetchMetaEntities`. Expected: a few hundred spend rows, ~200 campaigns. `npx tsx scripts/_meta-smoke.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/services/ads/brand.ts scripts/ad-brand-selftest.ts lib/services/ads/meta.ts
git commit -m "feat(marketing): brand rule (pure) and the Meta insights / entities reader on Graph v26" -- lib/services/ads/brand.ts scripts/ad-brand-selftest.ts lib/services/ads/meta.ts
```

---

### Task 4: Google Ads client (service-account JWT, GAQL, spend, entities, click_view)

**Files:**
- Create: `lib/services/ads/google.ts`

**Interfaces:**
- Produces: `googleAccessToken()`, `gaqlSearch(customerId, query)`, `fetchGoogleSpend(opts)`, `fetchGoogleEntities(opts)`, `fetchGoogleClicks(opts)`.

- [ ] **Step 1: Implement**

```ts
/**
 * Google Ads API reader (v25) with a service account - no client library, no developer
 * token (verified 2026-10-08: `googleAds:search` answers 200 without the header). The
 * key is NEXT_SECRET_GOOGLE_SA_JSON_B64 (base64 of the JSON); the JWT is signed here with
 * node:crypto. Spec section 4 step 2.
 */
import { createSign } from "node:crypto";
import type { AdClickRow, AdEntityRow, AdSpendRow } from "@/types/marketing.types";
import { brandOf, landingDomainOf } from "./brand";

const API = "https://googleads.googleapis.com/v25";
const SCOPE = "https://www.googleapis.com/auth/adwords";

interface ServiceAccount { client_email: string; private_key: string; private_key_id: string; token_uri: string }

function serviceAccount(): ServiceAccount {
  const b64 = process.env.NEXT_SECRET_GOOGLE_SA_JSON_B64?.trim();
  if (!b64) throw new Error("NEXT_SECRET_GOOGLE_SA_JSON_B64 is not set");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount;
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
  do {
    const res = await fetch(`${API}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, pageSize: 10_000, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json().catch(() => ({}))) as { results?: T[]; nextPageToken?: string; error?: { message: string; details?: { errors?: { message: string }[] }[] } };
    if (!res.ok || body.error) {
      const detail = body.error?.details?.flatMap((d) => d.errors ?? []).map((e) => e.message).join("; ");
      throw new Error(`Google Ads: ${body.error?.message ?? res.status}${detail ? ` - ${detail}` : ""}`);
    }
    out.push(...(body.results ?? []));
    pageToken = body.nextPageToken;
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

/** Campaigns + ad groups; the landing domain = the first final URL of the campaign's ads (P.Max: its asset groups). */
export async function fetchGoogleEntities(opts: { customerId: string }): Promise<AdEntityRow[]> {
  type Camp = { campaign: { id: string; name: string; status: string; advertisingChannelType: string } };
  type Ag = { adGroup: { id: string; name: string; status: string }; campaign: { id: string } };
  type Ad = { campaign: { id: string }; adGroupAd: { ad: { finalUrls?: string[] } } };
  type Asset = { campaign: { id: string }; assetGroup: { finalUrls?: string[] } };
  const [camps, ags, ads, assets] = await Promise.all([
    gaqlSearch<Camp>(opts.customerId, "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'"),
    gaqlSearch<Ag>(opts.customerId, "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'"),
    gaqlSearch<Ad>(opts.customerId, "SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND campaign.status = 'ENABLED'"),
    gaqlSearch<Asset>(opts.customerId, "SELECT campaign.id, asset_group.final_urls FROM asset_group WHERE asset_group.status != 'REMOVED'"),
  ]);
  const domain = new Map<string, string>();
  for (const r of [...ads.map((a) => ({ id: a.campaign.id, urls: a.adGroupAd.ad.finalUrls })), ...assets.map((a) => ({ id: a.campaign.id, urls: a.assetGroup.finalUrls }))]) {
    const d = landingDomainOf(r.urls?.[0]);
    if (d && !domain.has(r.id)) domain.set(r.id, d);
  }
  const rows: AdEntityRow[] = camps.map((c) => {
    const landing = domain.get(c.campaign.id) ?? null;
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
```

- [ ] **Step 2: Smoke it read-only** (throwaway script as in Task 3 step 6): `fetchGoogleSpend` for the last 7 days (expect rows for ~7 campaigns), `fetchGoogleEntities` (campaign count ≥ 7), `fetchGoogleClicks` for 3 days ago (rows > 0). If `ad_group.id` is refused inside the `click_view` query, drop it from the SELECT and set `ad_group_id: null` - note the change in the file's header. Delete the script.

- [ ] **Step 3: Commit**

```bash
git add lib/services/ads/google.ts
git commit -m "feat(marketing): Google Ads reader - service-account JWT, GAQL spend by ad group / P.Max campaign, entities, click_view" -- lib/services/ads/google.ts
```

---

### Task 5: Instagram client

**Files:**
- Create: `lib/services/ads/instagram.ts`

**Interfaces:**
- Consumes: `graphGetAll` from Task 3.
- Produces: `fetchIgMedia(opts)`, `fetchIgStories(opts)`, `fetchIgMediaInsights(media)`, `fetchIgAccount(opts)`, `IG_INSIGHT_METRICS`.

- [ ] **Step 1: Implement**

```ts
/**
 * Instagram Graph API reader for the business account linked to the Facebook page the
 * read token can see (today @megatr_il). Media + per-media insights + stories (gone after
 * 24 h - the sync runs 4x a day to catch them) + account counters. Spec section 4 step 3.
 */
import type { IgMediaRow } from "@/types/marketing.types";
import { graphGetAll } from "./meta";

const GRAPH = "https://graph.facebook.com/v26.0";

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${process.env.NEXT_SECRET_META_READ_TOKEN?.trim() ?? ""}` }, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok || body.error) throw new Error(`Instagram ${path}: ${body.error?.message ?? res.status}`);
  return body;
}

interface RawMedia { id: string; media_type?: string; media_product_type?: string; caption?: string; permalink?: string; media_url?: string; thumbnail_url?: string; timestamp?: string; like_count?: number; comments_count?: number }

const MEDIA_FIELDS = "id,media_type,media_product_type,caption,permalink,media_url,thumbnail_url,timestamp,like_count,comments_count";

function toRow(m: RawMedia, igUserId: string, productType?: IgMediaRow["media_product_type"]): IgMediaRow {
  const pt = (productType ?? m.media_product_type ?? null) as IgMediaRow["media_product_type"];
  return { id: m.id, ig_user_id: igUserId, media_type: m.media_type ?? null, media_product_type: pt, caption: m.caption?.slice(0, 2000) ?? null, permalink: m.permalink ?? null, media_url: m.media_url ?? null, thumbnail_url: m.thumbnail_url ?? null, posted_at: m.timestamp ?? null, like_count: m.like_count ?? 0, comments_count: m.comments_count ?? 0, reach: 0, saved: 0, shares: 0, views: 0, insights_at: null };
}

/** Newest `limit` feed posts and reels. */
export async function fetchIgMedia(opts: { igUserId: string; limit?: number }): Promise<IgMediaRow[]> {
  const raws = await graphGetAll<RawMedia>(`/${opts.igUserId}/media`, { fields: MEDIA_FIELDS, limit: String(opts.limit ?? 100) }, 1);
  return raws.map((m) => toRow(m, opts.igUserId));
}

/** Stories live right now. */
export async function fetchIgStories(opts: { igUserId: string }): Promise<IgMediaRow[]> {
  const raws = await graphGetAll<RawMedia>(`/${opts.igUserId}/stories`, { fields: MEDIA_FIELDS, limit: "50" }, 1);
  return raws.map((m) => toRow(m, opts.igUserId, "STORY"));
}

/** Metrics the API serves per product type (an unsupported metric fails the whole call, so ask per type). */
export const IG_INSIGHT_METRICS: Record<string, string[]> = {
  FEED: ["reach", "saved", "shares", "views"],
  REELS: ["reach", "saved", "shares", "views"],
  STORY: ["reach", "shares", "views"],
};

/** reach / saved / shares / views of one media; a metric the type lacks reads 0, a failed call returns null (the row keeps its old counters). */
export async function fetchIgMediaInsights(media: Pick<IgMediaRow, "id" | "media_product_type">): Promise<Pick<IgMediaRow, "reach" | "saved" | "shares" | "views"> | null> {
  const metrics = IG_INSIGHT_METRICS[media.media_product_type ?? "FEED"] ?? IG_INSIGHT_METRICS.FEED;
  try {
    const body = await graphGet<{ data?: { name: string; values?: { value: number }[] }[] }>(`/${media.id}/insights`, { metric: metrics.join(",") });
    const read = (name: string) => body.data?.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
    return { reach: read("reach"), saved: read("saved"), shares: read("shares"), views: read("views") };
  } catch (error) {
    console.warn(`[instagram] insights ${media.id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function fetchIgAccount(opts: { igUserId: string }): Promise<{ followers: number; mediaCount: number }> {
  const body = await graphGet<{ followers_count?: number; media_count?: number }>(`/${opts.igUserId}`, { fields: "followers_count,media_count" });
  return { followers: body.followers_count ?? 0, mediaCount: body.media_count ?? 0 };
}
```

- [ ] **Step 2: Smoke read-only** (throwaway): `fetchIgMedia({ igUserId })` -> ~100 rows; `fetchIgMediaInsights(rows[0])` -> numbers; `fetchIgStories` -> 0..n; `fetchIgAccount` -> followers ≈ 9,4xx. If `views` is refused for FEED on this account, remove it from `IG_INSIGHT_METRICS.FEED` and note it in the file. Delete the script.

- [ ] **Step 3: Commit**

```bash
git add lib/services/ads/instagram.ts
git commit -m "feat(marketing): Instagram reader - media, stories, per-media insights, account counters" -- lib/services/ads/instagram.ts
```

---

### Task 6: Ticket cost fill (pure estimate + the nightly writer)

**Files:**
- Create: `lib/services/reservation-cogs-fill.ts`
- Create: `scripts/reservation-cogs-selftest.ts`

**Interfaces:**
- Consumes: `mdb`; `multiCurrencyExchangeRateService.convertToUSD(amount, "EUR" | "GBP" | "ILS")` from `lib/services/ticket-price-sync.ts`; `normalizeReservationEventOrderInfo`.
- Produces: `estimateTicketCostUsd(input)` (pure), `fillTicketCosts({ dryRun, limit })`.

- [ ] **Step 1: Selftest for the pure estimate**

`scripts/reservation-cogs-selftest.ts`:

```ts
// Run: npx tsx scripts/reservation-cogs-selftest.ts
import assert from "node:assert/strict";
import { estimateTicketCostUsd } from "../lib/services/reservation-cogs-fill";

assert.deepEqual(
  estimateTicketCostUsd({ supplier: "livetickets", quantity: 2, salePerTicketUsd: 180, liveCategoryCost: 100, liveCurrency: "GBP", toUsd: (a, c) => (c === "GBP" ? a * 1.3 : a) }),
  { usd: 260, how: "live_events category cost" },
);
assert.deepEqual(
  estimateTicketCostUsd({ supplier: "xs2event", quantity: 1, salePerTicketUsd: 150, xs2NetRateEurCents: 9000, toUsd: (a, c) => (c === "EUR" ? a * 1.1 : a) }),
  { usd: 99, how: "xs2 net rate" },
);
const inv = estimateTicketCostUsd({ supplier: "static", quantity: 2, salePerTicketUsd: 143.5, toUsd: (a) => a });
assert.equal(inv.how, "inverted markup");
assert.equal(inv.usd, Math.round((143.5 / 1.035 - 40) * 2 * 100) / 100);
assert.equal(estimateTicketCostUsd({ supplier: "static", quantity: 1, salePerTicketUsd: 20, toUsd: (a) => a }).usd, 0, "a sale below the markup floors at 0");
assert.equal(estimateTicketCostUsd({ supplier: "livetickets", quantity: 1, salePerTicketUsd: 100, toUsd: (a) => a }).how, "inverted markup", "no category cost known -> inverted");

console.log("reservation-cogs selftest OK");
```

- [ ] **Step 2: Run it - expect module not found**

- [ ] **Step 3: Implement**

```ts
/**
 * The nightly ticket-cost fill (spec section 2.3): Paid reservations whose
 * `ticket_cost_usd` is still null get an ESTIMATE from what the backoffice knows -
 * LiveTickets' category cost (`live_events.ticket_categories[].cost`), XS2Event's net rate
 * (EUR cents), else the markup formula inverted. Never overwrites a `live` or `manual`
 * cost (the UPDATE is scoped `ticket_cost_usd is null`). `estimateTicketCostUsd` is pure
 * (scripts/reservation-cogs-selftest.ts); `fillTicketCosts` is the writer the sync calls.
 */
import { mdb } from "@/lib/services/marketing-db";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";

/** The sync's own markup on a USD-costed ticket, and the 3.5% card step (lib/suppliers.ts). */
const USD_MARKUP = 40;
const CARD_FACTOR = 1.035;

export type ToUsd = (amount: number, currency: "EUR" | "GBP" | "ILS" | "USD") => number;

export interface EstimateInput {
  supplier: string | null | undefined;
  quantity: number;
  salePerTicketUsd: number;
  liveCategoryCost?: number | null;
  liveCurrency?: "EUR" | "GBP" | "ILS" | "USD" | null;
  xs2NetRateEurCents?: number | null;
  toUsd: ToUsd;
}

export function estimateTicketCostUsd(i: EstimateInput): { usd: number; how: string } {
  const qty = Math.max(1, i.quantity || 1);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (i.supplier === "livetickets" && i.liveCategoryCost != null && i.liveCategoryCost > 0) {
    return { usd: r2(i.toUsd(i.liveCategoryCost, i.liveCurrency ?? "USD") * qty), how: "live_events category cost" };
  }
  if (i.xs2NetRateEurCents != null && i.xs2NetRateEurCents > 0) {
    return { usd: r2(i.toUsd(i.xs2NetRateEurCents / 100, "EUR") * qty), how: "xs2 net rate" };
  }
  const perTicket = Math.max(0, i.salePerTicketUsd / CARD_FACTOR - USD_MARKUP);
  return { usd: r2(perTicket * qty), how: "inverted markup" };
}

const LIVE_CURRENCY: Record<number, "USD" | "EUR" | "GBP" | "ILS"> = { 1: "USD", 2: "EUR", 3: "GBP", 4: "ILS" };

/** Fill up to `limit` Paid reservations (last 120 days) that have no ticket cost. */
export async function fillTicketCosts(opts: { dryRun: boolean; limit?: number }): Promise<{ filled: number; skipped: number; errors: string[] }> {
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const { data, error } = await mdb
    .from("reservations")
    .select("id, event_id, event_order_info")
    .eq("status", "Paid")
    .is("is_deleted", null)
    .is("ticket_cost_usd", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw new Error(`cogs fill read: ${error.message}`);
  const toUsd: ToUsd = (a, c) => (c === "USD" ? a : multiCurrencyExchangeRateService.convertToUSD(a, c));
  let filled = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const r of (data ?? []) as { id: number; event_id: number; event_order_info: unknown }[]) {
    try {
      const items = normalizeReservationEventOrderInfo(r.event_order_info as never) as { supplier?: string; supplier_event_id?: string; id?: string; number_of_ticket?: number; price_per_ticket?: number; vendor?: string }[];
      const item = items[0];
      if (!item) { skipped += 1; continue; }
      let liveCategoryCost: number | null = null;
      let liveCurrency: EstimateInput["liveCurrency"] = null;
      let xs2NetRateEurCents: number | null = null;
      if (item.supplier === "livetickets" && item.supplier_event_id) {
        const { data: le } = await mdb.from("live_events").select("currency, ticket_categories").eq("id", item.supplier_event_id).maybeSingle();
        const cat = (le?.ticket_categories as { id: number; cost: number }[] | null)?.find((c) => String(c.id) === String(item.id));
        liveCategoryCost = cat?.cost ?? null;
        liveCurrency = LIVE_CURRENCY[Number(le?.currency)] ?? null;
      }
      // XS2Event rows: confirm the real column that links an events row to its xs2e_events row
      // (db.schema.sql / types/sports-events.types.ts) and the tickets column's shape before shipping.
      const { data: ev } = await mdb.from("events").select("type, supplier_event_id").eq("id", r.event_id).maybeSingle();
      if (ev?.type === "sports_event_dynamic" && ev.supplier_event_id) {
        const { data: xs } = await mdb.from("xs2e_events").select("tickets").eq("id", ev.supplier_event_id).maybeSingle();
        const t = (xs?.tickets as { id?: string; local_rates?: { net_rate_eur?: number }; net_rate?: number }[] | null)?.find((x) => String(x.id) === String(item.id));
        xs2NetRateEurCents = t?.local_rates?.net_rate_eur ?? t?.net_rate ?? null;
      }
      const est = estimateTicketCostUsd({ supplier: item.supplier ?? item.vendor, quantity: Number(item.number_of_ticket) || 1, salePerTicketUsd: Number(item.price_per_ticket) || 0, liveCategoryCost, liveCurrency, xs2NetRateEurCents, toUsd });
      if (!opts.dryRun) {
        const { error: werr } = await mdb.from("reservations").update({ ticket_cost_usd: est.usd, ticket_cost_source: "estimated" }).eq("id", r.id).is("ticket_cost_usd", null);
        if (werr) throw new Error(werr.message);
      }
      filled += 1;
    } catch (e) {
      errors.push(`#${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { filled, skipped, errors };
}
```

Before committing, open `db.schema.sql` (search `xs2e_events`) and `types/sports-events.types.ts` to confirm the tickets column name and the `events` column that links an XS2 event; fix the two selects and the comment to the real names.

- [ ] **Step 4: Run the selftest - expect OK**; `npx tsc --noEmit -p . 2>&1 | grep reservation-cogs` -> nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/services/reservation-cogs-fill.ts scripts/reservation-cogs-selftest.ts
git commit -m "feat(marketing): nightly ticket-cost fill - LiveTickets / XS2 supplier cost, else the markup inverted, flagged estimated" -- lib/services/reservation-cogs-fill.ts scripts/reservation-cogs-selftest.ts
```

---

### Task 7: The sync orchestrator + cron route + cache tags

**Files:**
- Create: `lib/services/marketing-cache.ts`
- Create: `lib/services/marketing-sync.ts`
- Create: `lib/services/marketing-alerts.ts` (STUB - Task 10 replaces it)
- Create: `app/api/cron/marketingSync/route.ts`
- Modify: `vercel.json` (crons array + functions entry)

**Interfaces:**
- Consumes: Tasks 3-6.
- Produces: `runMarketingSync(opts)`, `MarketingSyncSummary`, `SyncStep`, `invalidateMarketing(...kinds)`, `MARKETING_TAG`, `MARKETING_TTL_S`.

- [ ] **Step 1: Cache tags**

`lib/services/marketing-cache.ts`:

```ts
/** /marketing's cache tags - the sync invalidates ONCE at the end of a run (same rule as price-light-cache.ts). */
import { revalidateTag } from "next/cache";

export const MARKETING_TAG = { pnl: "marketing-pnl", instagram: "marketing-instagram", alerts: "marketing-alerts" } as const;
export const MARKETING_TTL_S = { pnl: 300, instagram: 300, alerts: 120 } as const;

export function invalidateMarketing(...kinds: (keyof typeof MARKETING_TAG)[]): void {
  const all = Object.keys(MARKETING_TAG) as (keyof typeof MARKETING_TAG)[];
  for (const kind of kinds.length ? kinds : all) {
    try { revalidateTag(MARKETING_TAG[kind]); } catch { /* no request context (script) */ }
  }
}
```

- [ ] **Step 2: The alerts stub** (`lib/services/marketing-alerts.ts`, replaced in Task 10):

```ts
export async function runMarketingAlerts(_opts: { dryRun: boolean }): Promise<{ newAlerts: number; resolved: number; mail: "sent" | "skipped" | "failed" }> {
  return { newAlerts: 0, resolved: 0, mail: "skipped" };
}
```

- [ ] **Step 3: The orchestrator**

`lib/services/marketing-sync.ts`:

```ts
/**
 * marketingSync - one cron, six steps, each in its own try/catch so one source failing
 * never skips the next (spec section 4). `dryRun` reads everything, writes nothing, mails
 * nothing. `only` runs one step. `backfillDays` widens the spend / click window for a one-off.
 */
import { mdb } from "@/lib/services/marketing-db";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { fetchMetaEntities, fetchMetaSpend } from "@/lib/services/ads/meta";
import { fetchGoogleClicks, fetchGoogleEntities, fetchGoogleSpend } from "@/lib/services/ads/google";
import { fetchIgAccount, fetchIgMedia, fetchIgMediaInsights, fetchIgStories } from "@/lib/services/ads/instagram";
import { fillTicketCosts } from "@/lib/services/reservation-cogs-fill";
import { runMarketingAlerts } from "@/lib/services/marketing-alerts";
import { invalidateMarketing } from "@/lib/services/marketing-cache";
import type { AdEntityRow, IgMediaRow } from "@/types/marketing.types";

export type SyncStep = "meta" | "google" | "instagram" | "cogs" | "alerts" | "retention";
export interface StepResult { step: SyncStep; ok: boolean; rows: number; note: string; ms: number }
export interface MarketingSyncSummary { dryRun: boolean; steps: StepResult[]; startedAt: string; ms: number }

const day = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => day(new Date(Date.now() - n * 864e5));

async function upsert(table: string, rows: unknown[], onConflict: string, dryRun: boolean): Promise<number> {
  if (dryRun || rows.length === 0) return rows.length;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await mdb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
  return rows.length;
}

/** Keep a manual brand; copy the campaign's brand onto its adsets / ad groups / ads. */
async function writeEntities(rows: AdEntityRow[], platform: "meta" | "google", dryRun: boolean): Promise<number> {
  const { data: manual } = await mdb.from("ad_entities").select("id, brand").eq("platform", platform).eq("brand_source", "manual");
  const manualBrand = new Map<string, AdEntityRow["brand"]>((manual ?? []).map((m: { id: string; brand: AdEntityRow["brand"] }) => [m.id, m.brand]));
  const campaignBrand = new Map<string, AdEntityRow["brand"]>();
  for (const r of rows) if (r.kind === "campaign") campaignBrand.set(r.id, manualBrand.get(r.id) ?? r.brand);
  const out = rows.map((r) => {
    const brand = r.kind === "campaign" ? (campaignBrand.get(r.id) ?? r.brand) : (campaignBrand.get(r.campaign_id ?? "") ?? r.brand);
    const isManual = r.kind === "campaign" && manualBrand.has(r.id);
    return { ...r, brand, brand_source: isManual ? "manual" : "rule", updated_at: new Date().toISOString() };
  });
  return upsert("ad_entities", out, "platform,id", dryRun);
}

async function step(name: SyncStep, fn: () => Promise<{ rows: number; note?: string }>): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { step: name, ok: true, rows: r.rows, note: r.note ?? "", ms: Date.now() - t0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[marketingSync] ${name} failed: ${message}`);
    return { step: name, ok: false, rows: 0, note: message, ms: Date.now() - t0 };
  }
}

export async function runMarketingSync(opts: { dryRun: boolean; only?: SyncStep; backfillDays?: number; budgetMs?: number }): Promise<MarketingSyncSummary> {
  const startedAt = new Date();
  const budgetMs = opts.budgetMs ?? 270_000;
  const over = () => Date.now() - startedAt.getTime() > budgetMs;
  const want = (s: SyncStep) => !opts.only || opts.only === s;
  const steps: StepResult[] = [];
  const window = opts.backfillDays ?? 7;
  const fxIls = multiCurrencyExchangeRateService.convertToUSD(1, "ILS"); // USD per 1 ILS (the service refreshes itself)

  if (want("meta")) steps.push(await step("meta", async () => {
    const accountId = process.env.NEXT_SECRET_META_AD_ACCOUNT_ID?.trim();
    if (!accountId) throw new Error("NEXT_SECRET_META_AD_ACCOUNT_ID is not set");
    const spend = await fetchMetaSpend({ accountId, since: daysAgo(window), until: daysAgo(0), currency: "ILS", fxRate: fxIls });
    const entities = await fetchMetaEntities({ accountId });
    const a = await upsert("ad_spend_daily", spend, "platform,campaign_id,adset_key,day", opts.dryRun);
    const b = await writeEntities(entities, "meta", opts.dryRun);
    return { rows: a + b, note: `${a} spend rows, ${b} entities` };
  }));

  if (want("google") && !over()) steps.push(await step("google", async () => {
    const customerId = process.env.NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID?.trim();
    if (!customerId) throw new Error("NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID is not set");
    const spend = await fetchGoogleSpend({ customerId, since: daysAgo(window), until: daysAgo(0), currency: "ILS", fxRate: fxIls });
    const entities = await fetchGoogleEntities({ customerId });
    const a = await upsert("ad_spend_daily", spend, "platform,campaign_id,adset_key,day", opts.dryRun);
    const b = await writeEntities(entities, "google", opts.dryRun);
    // click_view: the last 3 days every run; a backfill walks back day by day until the budget says stop.
    const clickDays = opts.backfillDays ? Math.min(opts.backfillDays, 90) : 3;
    let clicks = 0;
    let remaining = 0;
    for (let i = 0; i < clickDays; i += 1) {
      if (over()) { remaining = clickDays - i; break; }
      clicks += await upsert("ad_clicks", await fetchGoogleClicks({ customerId, day: daysAgo(i) }), "gclid", opts.dryRun);
    }
    return { rows: a + b + clicks, note: `${a} spend rows, ${b} entities, ${clicks} clicks${remaining ? `, ${remaining} click days left for the next run` : ""}` };
  }));

  if (want("instagram") && !over()) steps.push(await step("instagram", async () => {
    const igUserId = process.env.NEXT_SECRET_META_IG_USER_ID?.trim();
    if (!igUserId) throw new Error("NEXT_SECRET_META_IG_USER_ID is not set");
    const media = [...(await fetchIgMedia({ igUserId, limit: 100 })), ...(await fetchIgStories({ igUserId }))];
    const today = daysAgo(0);
    const withInsights: IgMediaRow[] = [];
    const mediaOnly: Omit<IgMediaRow, "reach" | "saved" | "shares" | "views" | "insights_at">[] = [];
    const daily: unknown[] = [];
    for (const m of media) {
      if (over()) break;
      const ins = await fetchIgMediaInsights(m);
      if (ins) {
        withInsights.push({ ...m, ...ins, insights_at: new Date().toISOString() });
        daily.push({ media_id: m.id, day: today, reach: ins.reach, saved: ins.saved, shares: ins.shares, views: ins.views, likes: m.like_count, comments: m.comments_count });
      } else {
        // No fresh insights: upsert the media columns only so the stored counters are not zeroed.
        const { reach: _r, saved: _s, shares: _sh, views: _v, insights_at: _i, ...rest } = m;
        mediaOnly.push(rest);
      }
    }
    const a = (await upsert("ig_media", withInsights, "id", opts.dryRun)) + (await upsert("ig_media", mediaOnly, "id", opts.dryRun));
    const b = await upsert("ig_media_insights_daily", daily, "media_id,day", opts.dryRun);
    const acct = await fetchIgAccount({ igUserId });
    await upsert("ig_account_daily", [{ ig_user_id: igUserId, day: today, followers: acct.followers, media_count: acct.mediaCount }], "ig_user_id,day", opts.dryRun);
    return { rows: a + b, note: `${media.length} media, ${daily.length} insight rows, ${acct.followers} followers` };
  }));

  if (want("cogs") && !over()) steps.push(await step("cogs", async () => {
    const r = await fillTicketCosts({ dryRun: opts.dryRun, limit: 200 });
    return { rows: r.filled, note: `${r.filled} filled, ${r.skipped} skipped${r.errors.length ? `, ${r.errors.length} errors: ${r.errors.slice(0, 3).join(" | ")}` : ""}` };
  }));

  if (want("alerts") && !over()) steps.push(await step("alerts", async () => {
    const r = await runMarketingAlerts({ dryRun: opts.dryRun });
    return { rows: r.newAlerts, note: `${r.newAlerts} new, ${r.resolved} resolved, mail ${r.mail}` };
  }));

  if (want("retention") && !over()) steps.push(await step("retention", async () => {
    if (opts.dryRun) {
      const { count: c1 } = await mdb.from("ad_clicks").select("gclid", { count: "exact", head: true }).lt("day", daysAgo(100));
      const { count: c2 } = await mdb.from("ig_media_insights_daily").select("media_id", { count: "exact", head: true }).lt("day", daysAgo(180));
      return { rows: 0, note: `would delete ${c1 ?? 0} clicks, ${c2 ?? 0} insight rows` };
    }
    const { error: e1 } = await mdb.from("ad_clicks").delete().lt("day", daysAgo(100));
    const { error: e2 } = await mdb.from("ig_media_insights_daily").delete().lt("day", daysAgo(180));
    if (e1 || e2) throw new Error((e1 ?? e2).message);
    return { rows: 0, note: "pruned" };
  }));

  if (!opts.dryRun) invalidateMarketing();
  return { dryRun: opts.dryRun, steps, startedAt: startedAt.toISOString(), ms: Date.now() - startedAt.getTime() };
}
```

Open `lib/services/ticket-price-sync.ts:185-215` first: if `convertToUSD` needs a prior refresh call (the class has an `ensureFresh` / `updateAllExchangeRates`-like method), await it once at the top of `runMarketingSync`.

- [ ] **Step 4: The route**

`app/api/cron/marketingSync/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runMarketingSync, type SyncStep } from "@/lib/services/marketing-sync";
import { appOrigin, sendMail } from "@/lib/email";

/**
 * Marketing dashboard sync - Meta + Google spend and entities, Google click_view,
 * Instagram media + insights, ticket-cost fill, alerts, retention. Every 6 h
 * (vercel.json `20 *\/6 * * *`). Manual: `?key=<NEXT_SECRET_CRON_SECRET_KEY>`;
 * `&dry_run=1` reads everything and writes / mails nothing; `&only=meta|google|instagram|cogs|alerts|retention`
 * runs one step; `&backfill_days=90` widens the spend / click window once.
 * Spec: docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md section 4.
 */
export const maxDuration = 300;

const STEPS: SyncStep[] = ["meta", "google", "instagram", "cogs", "alerts", "retention"];

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry_run") === "1";
  const onlyRaw = params.get("only");
  const only = STEPS.includes(onlyRaw as SyncStep) ? (onlyRaw as SyncStep) : undefined;
  const backfill = Number(params.get("backfill_days"));
  try {
    const summary = await runMarketingSync({ dryRun, only, backfillDays: Number.isFinite(backfill) && backfill > 0 ? Math.min(backfill, 180) : undefined, budgetMs: 270_000 });
    console.log(`[marketingSync]${dryRun ? " (dry-run)" : ""}`, JSON.stringify(summary));
    const failed = summary.steps.filter((s) => !s.ok);
    const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
    if (!dryRun && failed.length > 0 && to) {
      try {
        await sendMail({ to, subject: `Marketing sync: ${failed.length} step(s) failed`, html: [`<p><a href="${appOrigin()}/marketing">Open /marketing</a></p>`, ...failed.map((s) => `<p><b>${s.step}</b>: ${s.note}</p>`)].join("") });
      } catch (e) { console.error("[marketingSync] mail failed", e); }
    }
    return NextResponse.json({ ok: failed.length === 0, dryRun, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[marketingSync] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 5: vercel.json** - add to `crons`: `{ "path": "/api/cron/marketingSync", "schedule": "20 */6 * * *" }` and to `functions`: `"app/api/cron/marketingSync/route.ts": { "memory": 1024, "maxDuration": 300 }`.

- [ ] **Step 6: Dry run against prod data from dev**

Start the dev server (`preview_start` with the name in `.claude/launch.json`; never a second `next dev` in a folder that already runs one) and open `/api/cron/marketingSync?key=<NEXT_SECRET_CRON_SECRET_KEY>&dry_run=1`. Expected: meta / google / instagram steps `ok` with rows > 0 (reads only); `cogs` / `retention` / the entity "manual brand" read fail with "relation ... does not exist" until the migration is applied (Task 16) - acceptable and expected now.

- [ ] **Step 7: Commit**

```bash
git add lib/services/marketing-cache.ts lib/services/marketing-sync.ts lib/services/marketing-alerts.ts app/api/cron/marketingSync/route.ts vercel.json
git commit -m "feat(marketing): marketingSync cron - Meta, Google, Instagram, ticket-cost fill, alerts and retention, every six hours with a dry run" -- lib/services/marketing-cache.ts lib/services/marketing-sync.ts lib/services/marketing-alerts.ts app/api/cron/marketingSync/route.ts vercel.json
```

---

### Task 8: Attribution rule (pure)

**Files:**
- Create: `lib/services/marketing-attribution.ts`
- Create: `scripts/marketing-attribution-selftest.ts`

**Interfaces:**
- Produces: `UtmTouchLike`, `PaidTouch`, `AttributionLookups`, `paidTouchOf(touches, lookups)`, `isMetaSource(s)`, `META_ID`.

- [ ] **Step 1: Selftest**

```ts
// Run: npx tsx scripts/marketing-attribution-selftest.ts
import assert from "node:assert/strict";
import { paidTouchOf, type UtmTouchLike } from "../lib/services/marketing-attribution";

const touch = (p: Partial<UtmTouchLike>, position = 0): UtmTouchLike => ({ position, utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, gclid: null, fbclid: null, is_influencer: false, ...p });
const lookups = {
  metaAdCampaign: (adId: string) => (adId === "120248410418770141" ? { campaignId: "120248162596380141", adsetId: "120248410418760141" } : null),
  gclidCampaign: (g: string) => (g === "Cj0abc" ? { campaignId: "23996726850", adGroupId: null } : null),
};

assert.deepEqual(paidTouchOf([touch({ utm_source: "facebook", utm_content: "120248410418770141", fbclid: "x" })], lookups), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: "120248410418770141", resolved: true });
assert.deepEqual(paidTouchOf([touch({ utm_source: "fb", utm_medium: "paid", utm_campaign: "120248162596380141", utm_term: "120248410418760141", utm_content: "999" })], { ...lookups, metaAdCampaign: () => null }), { platform: "meta", campaignId: "120248162596380141", adsetId: "120248410418760141", adId: null, resolved: true });
assert.deepEqual(paidTouchOf([touch({ fbclid: "abc" })], lookups), { platform: "meta", campaignId: null, adsetId: null, adId: null, resolved: false });
assert.deepEqual(paidTouchOf([touch({ utm_source: "google", utm_campaign: "p.max", gclid: "Cj0abc" })], lookups), { platform: "google", campaignId: "23996726850", adsetId: null, adId: null, resolved: true });
assert.equal(paidTouchOf([touch({ utm_source: "google", utm_medium: "cpc", gclid: "unknown" })], lookups)?.resolved, false);
assert.equal(paidTouchOf([touch({ utm_source: "google", utm_campaign: "organic" })], lookups), null, "organic google is not paid");
assert.equal(paidTouchOf([touch({ utm_source: "michaela", is_influencer: true }, 0), touch({ utm_source: "google", gclid: "Cj0abc" }, 1)], lookups)?.platform, "google", "influencer at 0 is protected; the paid touch behind it wins");
assert.equal(paidTouchOf([touch({ utm_source: "website" }, 0), touch({ utm_source: "facebook", utm_content: "120248410418770141" }, 1)], lookups)?.platform, "meta", "last PAID touch, wherever it sits");
assert.equal(paidTouchOf([touch({ utm_source: "google", gclid: "Cj0abc" }, 2), touch({ utm_source: "facebook", fbclid: "z" }, 1)], lookups)?.platform, "meta", "positions scanned ascending whatever the array order");
assert.equal(paidTouchOf([touch({ utm_source: "alon_demo" })], lookups), null);
assert.equal(paidTouchOf([], lookups), null);

console.log("marketing-attribution selftest OK");
```

- [ ] **Step 2: Run - expect module not found**

- [ ] **Step 3: Implement**

```ts
/**
 * Last paid touch (spec section 5). Touches are the reservation's `utm_touches` rows -
 * position 0 is the credited / newest one, 1..n older. The first PAID touch scanning
 * upward wins; an influencer at position 0 stays a partner (the cookie's protection).
 * Pure - the lookups (ad id -> campaign, gclid -> campaign) are handed in.
 */
export interface UtmTouchLike {
  position: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  is_influencer: boolean;
}

export interface PaidTouch {
  platform: "meta" | "google";
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  resolved: boolean;
}

export interface AttributionLookups {
  metaAdCampaign: (adId: string) => { campaignId: string; adsetId: string | null } | null;
  gclidCampaign: (gclid: string) => { campaignId: string; adGroupId: string | null } | null;
}

const META_SOURCES = new Set(["facebook", "fb", "ig", "instagram", "meta"]);
/** A Meta object id (campaign / adset / ad) - 15 to 20 digits. */
export const META_ID = /^\d{15,20}$/;

export const isMetaSource = (s: string | null): boolean => META_SOURCES.has((s ?? "").trim().toLowerCase());

function metaTouch(t: UtmTouchLike, lookups: AttributionLookups): PaidTouch | null {
  if (!isMetaSource(t.utm_source) && !t.fbclid) return null;
  const adId = t.utm_content && META_ID.test(t.utm_content) ? t.utm_content : null;
  if (t.utm_campaign && META_ID.test(t.utm_campaign)) {
    return { platform: "meta", campaignId: t.utm_campaign, adsetId: t.utm_term && META_ID.test(t.utm_term) ? t.utm_term : null, adId, resolved: true };
  }
  const hit = adId ? lookups.metaAdCampaign(adId) : null;
  return hit ? { platform: "meta", campaignId: hit.campaignId, adsetId: hit.adsetId, adId, resolved: true } : { platform: "meta", campaignId: null, adsetId: null, adId, resolved: false };
}

function googleTouch(t: UtmTouchLike, lookups: AttributionLookups): PaidTouch | null {
  const src = (t.utm_source ?? "").trim().toLowerCase();
  const paid = Boolean(t.gclid) || (src === "google" && (t.utm_medium ?? "").toLowerCase() === "cpc");
  if (!paid) return null;
  const hit = t.gclid ? lookups.gclidCampaign(t.gclid) : null;
  return hit ? { platform: "google", campaignId: hit.campaignId, adsetId: hit.adGroupId, adId: null, resolved: true } : { platform: "google", campaignId: null, adsetId: null, adId: null, resolved: false };
}

export function paidTouchOf(touches: UtmTouchLike[], lookups: AttributionLookups): PaidTouch | null {
  const ordered = [...touches].sort((a, b) => a.position - b.position);
  for (const t of ordered) {
    if (t.position === 0 && t.is_influencer) continue;
    const hit = metaTouch(t, lookups) ?? googleTouch(t, lookups);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Run - expect OK; commit**

```bash
git add lib/services/marketing-attribution.ts scripts/marketing-attribution-selftest.ts
git commit -m "feat(marketing): last-paid-touch attribution rule (pure, selftested)" -- lib/services/marketing-attribution.ts scripts/marketing-attribution-selftest.ts
```

---

### Task 9: P&L join (pure) + the attributed-reservations service + the read actions

**Files:**
- Create: `lib/services/marketing-pnl.ts`
- Create: `scripts/marketing-pnl-selftest.ts`
- Create: `lib/services/marketing-purchases.ts`
- Create: `lib/actions/marketing-actions.ts`

**Interfaces:**
- Consumes: Tasks 2, 8; `mdb`; `fetchPaged` (`lib/supabase-paged.ts`); `requireAdmin` (`lib/auth/guards.ts`, returns `SessionPayload` - check its field names for the actor: open `types/auth.types.ts`); `logAudit` (`lib/audit.ts`).
- Produces: `buildPnl(input)`, `rangeWindow(range, now)`, `MARKETING_RANGES`, `MarketingRange`, `Pnl`, `CampaignPnl`, `PnlTotals`, `DailyPoint`, `AttributedReservation`; `attributedReservations(since, until)`, `getPurchasesByCampaign(since, until)`; actions `getMarketingPnl`, `getInstagramFeed`, `getMarketingAlerts`, `getMarketingSettings`, `saveMarketingSettings`, `listCampaignBrands`, `setCampaignBrand`, `runMarketingSyncNow`.

- [ ] **Step 1: Selftest for `buildPnl`**

```ts
// Run: npx tsx scripts/marketing-pnl-selftest.ts
import assert from "node:assert/strict";
import { buildPnl, rangeWindow, type AttributedReservation } from "../lib/services/marketing-pnl";

const spend = [
  { platform: "meta" as const, campaign_id: "c1", adset_key: "a1", day: "2026-10-01", spend_usd: 100, clicks: 50, impressions: 1000, platform_conversions: 3, platform_value: 4500 },
  { platform: "meta" as const, campaign_id: "c1", adset_key: "a2", day: "2026-10-02", spend_usd: 100, clicks: 50, impressions: 1000, platform_conversions: 0, platform_value: 0 },
  { platform: "google" as const, campaign_id: "g1", adset_key: "", day: "2026-10-02", spend_usd: 50, clicks: 10, impressions: 100, platform_conversions: 0, platform_value: 0 },
];
const entities = [
  { platform: "meta" as const, id: "c1", kind: "campaign", name: "MYT feed", brand: "mega_events" as const, status: "ACTIVE" },
  { platform: "meta" as const, id: "a1", kind: "adset", name: "adset 1", brand: "mega_events" as const, status: "ACTIVE", campaign_id: "c1" },
  { platform: "google" as const, id: "g1", kind: "campaign", name: "pmax", brand: "other" as const, status: "ENABLED" },
];
const res: AttributedReservation[] = [
  { id: 1, day: "2026-10-01", revenue: 1000, cogs: 700, estimated: false, touch: { platform: "meta", campaignId: "c1", adsetId: "a1", adId: null, resolved: true } },
  { id: 2, day: "2026-10-02", revenue: 500, cogs: 300, estimated: true, touch: { platform: "meta", campaignId: null, adsetId: null, adId: null, resolved: false } },
  { id: 3, day: "2026-10-02", revenue: 800, cogs: 500, estimated: false, touch: null },
];
const pnl = buildPnl({ spend, entities, reservations: res, feePct: 2, brand: "mega_events" });
const c1 = pnl.campaigns.find((c) => c.key === "meta:c1")!;
assert.equal(c1.spendUsd, 200);
assert.equal(c1.purchases, 1);
assert.equal(c1.revenueUsd, 1000);
assert.equal(c1.cogsUsd, 700);
assert.equal(c1.feeUsd, 20);
assert.equal(c1.netUsd, 80);
assert.equal(c1.poas, 0.4);
assert.equal(c1.roas, 5);
assert.equal(c1.cacUsd, 200);
assert.equal(c1.platformPurchases, 3);
assert.equal(c1.adsets.length, 2, "a2 has spend but no entity row -> still listed by its key");
assert.equal(c1.adsets.find((a) => a.key === "a1")!.purchases, 1);
assert.equal(pnl.campaigns.find((c) => c.key === "google:g1"), undefined, "other brand filtered out");
assert.equal(pnl.unresolved.find((u) => u.platform === "meta")!.revenueUsd, 500);
assert.equal(pnl.unattributed.revenueUsd, 800);
assert.equal(pnl.totals.spendUsd, 200);
assert.equal(pnl.totals.revenueUsd, 1500, "totals = campaigns of the brand + unresolved; unattributed shown apart");
assert.equal(pnl.totals.estimatedCount, 1);
assert.deepEqual(pnl.daily.map((d) => [d.day, d.spendUsd, d.revenueUsd]), [["2026-10-01", 100, 1000], ["2026-10-02", 100, 500]]);

const all = buildPnl({ spend, entities, reservations: res, feePct: 0, brand: "all" });
assert.equal(all.totals.spendUsd, 250);
assert.equal(all.campaigns.length, 2);

const w = rangeWindow("30d", new Date("2026-10-08T10:00:00Z"));
assert.equal(w.since, "2026-09-08");
assert.equal(w.until, "2026-10-08");
assert.equal(rangeWindow("month", new Date("2026-10-08T10:00:00Z")).since, "2026-10-01");

console.log("marketing-pnl selftest OK");
```

- [ ] **Step 2: Run - expect module not found**

- [ ] **Step 3: Implement `lib/services/marketing-pnl.ts`**

```ts
/**
 * The campaign P&L join (spec section 5): spend rows x entities x attributed Paid
 * reservations -> one row per campaign (with its adsets), the unresolved rows per
 * platform ("מטא · לא זוהה"), the unattributed line, brand totals and a daily series.
 * net = revenue - cogs - fee - spend; POAS = net / spend; ROAS = revenue / spend;
 * CAC = spend / purchases. Pure; scripts/marketing-pnl-selftest.ts.
 */
import type { AdBrand, AdPlatform } from "@/types/marketing.types";
import type { PaidTouch } from "@/lib/services/marketing-attribution";

export const MARKETING_RANGES = ["7d", "30d", "90d", "month"] as const;
export type MarketingRange = (typeof MARKETING_RANGES)[number];

export function rangeWindow(range: MarketingRange, now = new Date()): { since: string; until: string } {
  const until = now.toISOString().slice(0, 10);
  if (range === "month") return { since: `${until.slice(0, 7)}-01`, until };
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return { since: new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10), until };
}

export interface SpendLike { platform: AdPlatform; campaign_id: string; adset_key: string; day: string; spend_usd: number; clicks: number; impressions: number; platform_conversions: number; platform_value: number }
export interface EntityLike { platform: AdPlatform; id: string; kind: string; name: string; brand: AdBrand; status: string | null; campaign_id?: string | null; channel?: string | null }
export interface AttributedReservation { id: number; day: string; revenue: number; cogs: number; estimated: boolean; touch: PaidTouch | null }

export interface PnlTotals { spendUsd: number; revenueUsd: number; cogsUsd: number; feeUsd: number; netUsd: number; purchases: number; clicks: number; impressions: number; platformPurchases: number; platformValue: number; estimatedCount: number; poas: number | null; roas: number | null; cacUsd: number | null }
export interface AdsetPnl extends PnlTotals { key: string; name: string }
export interface CampaignPnl extends PnlTotals { key: string; platform: AdPlatform; campaignId: string; name: string; brand: AdBrand; status: string | null; channel: string | null; adsets: AdsetPnl[] }
export interface DailyPoint { day: string; spendUsd: number; revenueUsd: number }
export interface Pnl { campaigns: CampaignPnl[]; unresolved: (PnlTotals & { platform: AdPlatform })[]; unattributed: PnlTotals; totals: PnlTotals; daily: DailyPoint[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const empty = (): PnlTotals => ({ spendUsd: 0, revenueUsd: 0, cogsUsd: 0, feeUsd: 0, netUsd: 0, purchases: 0, clicks: 0, impressions: 0, platformPurchases: 0, platformValue: 0, estimatedCount: 0, poas: null, roas: null, cacUsd: null });
function addSpend(t: PnlTotals, s: SpendLike) { t.spendUsd += s.spend_usd; t.clicks += s.clicks; t.impressions += s.impressions; t.platformPurchases += s.platform_conversions; t.platformValue += s.platform_value; }
function addSale(t: PnlTotals, r: AttributedReservation, feePct: number) { t.revenueUsd += r.revenue; t.cogsUsd += r.cogs; t.feeUsd += (r.revenue * feePct) / 100; t.purchases += 1; if (r.estimated) t.estimatedCount += 1; }
function addTotals(t: PnlTotals, u: PnlTotals) { t.spendUsd += u.spendUsd; t.revenueUsd += u.revenueUsd; t.cogsUsd += u.cogsUsd; t.feeUsd += u.feeUsd; t.purchases += u.purchases; t.clicks += u.clicks; t.impressions += u.impressions; t.platformPurchases += u.platformPurchases; t.platformValue += u.platformValue; t.estimatedCount += u.estimatedCount; }
function finish<T extends PnlTotals>(t: T): T {
  t.spendUsd = r2(t.spendUsd); t.revenueUsd = r2(t.revenueUsd); t.cogsUsd = r2(t.cogsUsd); t.feeUsd = r2(t.feeUsd);
  t.netUsd = r2(t.revenueUsd - t.cogsUsd - t.feeUsd - t.spendUsd);
  t.poas = t.spendUsd > 0 ? r2(t.netUsd / t.spendUsd) : null;
  t.roas = t.spendUsd > 0 ? r2(t.revenueUsd / t.spendUsd) : null;
  t.cacUsd = t.purchases > 0 ? r2(t.spendUsd / t.purchases) : null;
  return t;
}

export function buildPnl(input: { spend: SpendLike[]; entities: EntityLike[]; reservations: AttributedReservation[]; feePct: number; brand: AdBrand | "all" }): Pnl {
  const ent = new Map(input.entities.map((e) => [`${e.platform}:${e.id}`, e]));
  const entityOf = (platform: AdPlatform, id: string) => ent.get(`${platform}:${id}`);
  const inBrand = (platform: AdPlatform, campaignId: string) => input.brand === "all" || (entityOf(platform, campaignId)?.brand ?? "other") === input.brand;

  type Camp = CampaignPnl & { adsetMap: Map<string, AdsetPnl> };
  const campaigns = new Map<string, Camp>();
  const campaign = (platform: AdPlatform, id: string): Camp => {
    const key = `${platform}:${id}`;
    let c = campaigns.get(key);
    if (!c) {
      const e = entityOf(platform, id);
      c = { ...empty(), key, platform, campaignId: id, name: e?.name ?? id, brand: e?.brand ?? "other", status: e?.status ?? null, channel: e?.channel ?? null, adsets: [], adsetMap: new Map() };
      campaigns.set(key, c);
    }
    return c;
  };
  const adset = (c: Camp, key: string): AdsetPnl => {
    let a = c.adsetMap.get(key);
    if (!a) { a = { ...empty(), key, name: entityOf(c.platform, key)?.name ?? (key || "—") }; c.adsetMap.set(key, a); }
    return a;
  };

  const daily = new Map<string, DailyPoint>();
  const dayOf = (d: string) => { let p = daily.get(d); if (!p) { p = { day: d, spendUsd: 0, revenueUsd: 0 }; daily.set(d, p); } return p; };

  for (const s of input.spend) {
    if (!inBrand(s.platform, s.campaign_id)) continue;
    const c = campaign(s.platform, s.campaign_id);
    addSpend(c, s); addSpend(adset(c, s.adset_key), s);
    dayOf(s.day).spendUsd += s.spend_usd;
  }
  const unresolved = new Map<AdPlatform, PnlTotals & { platform: AdPlatform }>();
  const unattributed = empty();
  for (const r of input.reservations) {
    const t = r.touch;
    if (!t) { addSale(unattributed, r, input.feePct); continue; }
    if (!t.resolved || !t.campaignId) {
      let u = unresolved.get(t.platform);
      if (!u) { u = { ...empty(), platform: t.platform }; unresolved.set(t.platform, u); }
      addSale(u, r, input.feePct); dayOf(r.day).revenueUsd += r.revenue; continue;
    }
    if (!inBrand(t.platform, t.campaignId)) continue;
    const c = campaign(t.platform, t.campaignId);
    addSale(c, r, input.feePct); addSale(adset(c, t.adsetId ?? ""), r, input.feePct);
    dayOf(r.day).revenueUsd += r.revenue;
  }

  const list: CampaignPnl[] = [...campaigns.values()].map((c) => {
    const { adsetMap, ...rest } = c;
    const adsets = [...adsetMap.values()].map((a) => finish(a)).sort((a, b) => b.spendUsd - a.spendUsd);
    return { ...finish(rest), adsets };
  }).sort((a, b) => b.spendUsd - a.spendUsd);
  const totals = empty();
  for (const c of list) addTotals(totals, c);
  const unresolvedList = [...unresolved.values()].map((u) => finish(u));
  for (const u of unresolvedList) addTotals(totals, u);
  return {
    campaigns: list,
    unresolved: unresolvedList,
    unattributed: finish(unattributed),
    totals: finish(totals),
    daily: [...daily.values()].map((d) => ({ ...d, spendUsd: r2(d.spendUsd), revenueUsd: r2(d.revenueUsd) })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}
```

- [ ] **Step 4: Run - expect OK.**

- [ ] **Step 5: `lib/services/marketing-purchases.ts`** - the reservation side, shared by the actions and the alerts:

```ts
/**
 * Paid reservations of a window with their revenue / cogs and last paid touch (spec
 * section 5) - the one read both /marketing and the alerts use. Session-free; the
 * callers guard.
 */
import { mdb } from "@/lib/services/marketing-db";
import { fetchPaged } from "@/lib/supabase-paged";
import { cogsUsd, revenueUsd, type PnlReservation } from "@/lib/services/reservation-pnl";
import { META_ID, paidTouchOf, type UtmTouchLike } from "@/lib/services/marketing-attribution";
import type { AttributedReservation } from "@/lib/services/marketing-pnl";

const PNL_COLUMNS = "id, created_at, status, user_shown_price, exchange_rate_usd_ils_100, agent_card_discount_ils, partner_settlement_method, flight_order_info, hotel_order_info, hotel_segments, offline_flight_cost, offline_hotel_cost, ticket_cost_usd, ticket_cost_source, actual_cost_usd, event_order_info";

function chunks<T>(arr: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }

export async function attributedReservations(since: string, until: string): Promise<AttributedReservation[]> {
  const { rows, error } = await fetchPaged<{ id: number; created_at: string } & PnlReservation>(
    () => mdb.from("reservations").select(PNL_COLUMNS).eq("status", "Paid").is("is_deleted", null).gte("created_at", `${since}T00:00:00Z`).lte("created_at", `${until}T23:59:59Z`).order("id"),
    5000,
  );
  if (error) throw new Error(`reservations read: ${error.message}`);
  const ids = rows.map((r) => r.id);
  const touches = new Map<number, UtmTouchLike[]>();
  for (const chunk of chunks(ids, 200)) {
    const { data, error: terr } = await mdb.from("utm_touches").select("reservation_id, position, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, is_influencer").in("reservation_id", chunk);
    if (terr) throw new Error(`utm_touches read: ${terr.message}`);
    for (const t of (data ?? []) as (UtmTouchLike & { reservation_id: number })[]) { const list = touches.get(t.reservation_id) ?? []; list.push(t); touches.set(t.reservation_id, list); }
  }
  const adIds = new Set<string>();
  const gclids = new Set<string>();
  for (const list of touches.values()) for (const t of list) { if (t.utm_content && META_ID.test(t.utm_content)) adIds.add(t.utm_content); if (t.gclid) gclids.add(t.gclid); }
  const ads = new Map<string, { campaignId: string; adsetId: string | null }>();
  for (const chunk of chunks([...adIds], 200)) {
    const { data } = await mdb.from("ad_entities").select("id, campaign_id, parent_id").eq("platform", "meta").eq("kind", "ad").in("id", chunk);
    for (const a of (data ?? []) as { id: string; campaign_id: string; parent_id: string | null }[]) ads.set(a.id, { campaignId: a.campaign_id, adsetId: a.parent_id });
  }
  const clicks = new Map<string, { campaignId: string; adGroupId: string | null }>();
  for (const chunk of chunks([...gclids], 200)) {
    const { data } = await mdb.from("ad_clicks").select("gclid, campaign_id, ad_group_id").in("gclid", chunk);
    for (const c of (data ?? []) as { gclid: string; campaign_id: string; ad_group_id: string | null }[]) clicks.set(c.gclid, { campaignId: c.campaign_id, adGroupId: c.ad_group_id });
  }
  const lookups = { metaAdCampaign: (id: string) => ads.get(id) ?? null, gclidCampaign: (g: string) => clicks.get(g) ?? null };
  return rows.map((r) => { const c = cogsUsd(r); return { id: r.id, day: r.created_at.slice(0, 10), revenue: revenueUsd(r) ?? 0, cogs: c.total, estimated: c.estimated, touch: paidTouchOf(touches.get(r.id) ?? [], lookups) }; });
}

/** Purchases of ours per resolved campaign id, for the budget-bleed rule. */
export async function getPurchasesByCampaign(since: string, until: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await attributedReservations(since, until)) {
    if (r.touch?.resolved && r.touch.campaignId) out.set(r.touch.campaignId, (out.get(r.touch.campaignId) ?? 0) + 1);
  }
  return out;
}
```

- [ ] **Step 6: The actions** - `lib/actions/marketing-actions.ts`:

```ts
"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { mdb } from "@/lib/services/marketing-db";
import { attributedReservations } from "@/lib/services/marketing-purchases";
import { buildPnl, rangeWindow, MARKETING_RANGES, type MarketingRange, type Pnl } from "@/lib/services/marketing-pnl";
import { MARKETING_TAG, MARKETING_TTL_S, invalidateMarketing } from "@/lib/services/marketing-cache";
import { runMarketingSync, type MarketingSyncSummary } from "@/lib/services/marketing-sync";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type AdBrand, type AdPlatform, type IgMediaRow, type MarketingAlertRow, type MarketingSettings } from "@/types/marketing.types";

async function readSettings(): Promise<MarketingSettings> {
  const { data } = await mdb.from("marketing_settings").select("key, value");
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const row of (data ?? []) as { key: keyof MarketingSettings; value: unknown }[]) {
    if (MARKETING_SETTING_KEYS.includes(row.key)) (out as unknown as Record<string, unknown>)[row.key] = row.value;
  }
  return out;
}

async function buildPnlFor(range: MarketingRange, brand: AdBrand | "all"): Promise<Pnl & { since: string; until: string; settings: MarketingSettings }> {
  const { since, until } = rangeWindow(range);
  const [settings, reservations, spendRes, entRes] = await Promise.all([
    readSettings(),
    attributedReservations(since, until),
    mdb.from("ad_spend_daily").select("platform, campaign_id, adset_key, day, spend_usd, clicks, impressions, platform_conversions, platform_value").gte("day", since).lte("day", until).limit(20000),
    mdb.from("ad_entities").select("platform, id, kind, name, brand, status, campaign_id, channel").in("kind", ["campaign", "adset", "ad_group"]).limit(20000),
  ]);
  if (spendRes.error) throw new Error(spendRes.error.message);
  if (entRes.error) throw new Error(entRes.error.message);
  return { ...buildPnl({ spend: spendRes.data ?? [], entities: entRes.data ?? [], reservations, feePct: settings.processing_fee_pct, brand }), since, until, settings };
}

const cachedPnl = unstable_cache(buildPnlFor, ["marketing-pnl"], { tags: [MARKETING_TAG.pnl], revalidate: MARKETING_TTL_S.pnl });

export async function getMarketingPnl(range: MarketingRange, brand: AdBrand | "all") {
  await requireAdmin();
  const safeRange = MARKETING_RANGES.includes(range) ? range : "30d";
  const safeBrand = brand === "all" || brand === "other" ? brand : "mega_events";
  return cachedPnl(safeRange, safeBrand);
}

export async function getInstagramFeed(): Promise<{ media: IgMediaRow[]; followers: { day: string; followers: number }[] }> {
  await requireAdmin();
  const [m, f] = await Promise.all([
    mdb.from("ig_media").select("*").order("posted_at", { ascending: false }).limit(200),
    mdb.from("ig_account_daily").select("day, followers").order("day", { ascending: false }).limit(90),
  ]);
  return { media: m.data ?? [], followers: [...(f.data ?? [])].reverse() };
}

export async function getMarketingAlerts(): Promise<MarketingAlertRow[]> {
  await requireAdmin();
  const { data } = await mdb.from("marketing_alerts").select("*").order("first_seen_at", { ascending: false }).limit(200);
  return data ?? [];
}

export async function getMarketingSettings(): Promise<MarketingSettings> { await requireAdmin(); return readSettings(); }

export async function saveMarketingSettings(patch: Partial<MarketingSettings>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const before = await readSettings();
  const rows: { key: string; value: unknown; updated_by: string; updated_at: string }[] = [];
  for (const key of MARKETING_SETTING_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (key === "alert_emails") {
      if (!Array.isArray(v) || !v.every((e) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return { ok: false, error: "alert_emails must be valid addresses" };
    } else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false, error: `${key} must be a number ≥ 0` };
    rows.push({ key, value: v, updated_by: session.sub, updated_at: new Date().toISOString() });
  }
  if (rows.length === 0) return { ok: true };
  const { error } = await mdb.from("marketing_settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "marketing.settings", entityType: "marketing_settings", changes: { before, after: Object.fromEntries(rows.map((r) => [r.key, r.value])) }, actor: { id: session.sub, email: session.email, role: session.role } });
  invalidateMarketing("pnl", "alerts");
  return { ok: true };
}

export async function listCampaignBrands(): Promise<{ platform: AdPlatform; id: string; name: string; brand: AdBrand; brand_source: string; status: string | null }[]> {
  await requireAdmin();
  const { data } = await mdb.from("ad_entities").select("platform, id, name, brand, brand_source, status").eq("kind", "campaign").order("name");
  return data ?? [];
}

export async function setCampaignBrand(platform: AdPlatform, id: string, brand: AdBrand | "rule"): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const patch = brand === "rule" ? { brand_source: "rule" } : { brand, brand_source: "manual" };
  const { error } = await mdb.from("ad_entities").update(patch).eq("platform", platform).eq("id", id).eq("kind", "campaign");
  if (error) return { ok: false, error: error.message };
  // Children follow the campaign at the next sync; do it now so the screen agrees at once.
  if (brand !== "rule") await mdb.from("ad_entities").update({ brand }).eq("platform", platform).eq("campaign_id", id).neq("kind", "campaign");
  await logAudit({ action: "marketing.brand", entityType: "ad_entities", entityId: `${platform}:${id}`, changes: patch, actor: { id: session.sub, email: session.email, role: session.role } });
  invalidateMarketing("pnl");
  return { ok: true };
}

export async function runMarketingSyncNow(): Promise<MarketingSyncSummary> {
  const session = await requireAdmin();
  await logAudit({ action: "marketing.sync_triggered", actor: { id: session.sub, email: session.email, role: session.role } });
  return runMarketingSync({ dryRun: false, budgetMs: 50_000 });
}
```

Open `types/auth.types.ts` for `SessionPayload`'s real field names (`sub` / `email` / `role` are assumed) and adjust the three `actor` objects.

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "marketing-(pnl|actions|purchases)"` -> nothing.

```bash
git add lib/services/marketing-pnl.ts scripts/marketing-pnl-selftest.ts lib/services/marketing-purchases.ts lib/actions/marketing-actions.ts
git commit -m "feat(marketing): campaign P&L join (pure, selftested), attributed-reservations read, and the /marketing actions" -- lib/services/marketing-pnl.ts scripts/marketing-pnl-selftest.ts lib/services/marketing-purchases.ts lib/actions/marketing-actions.ts
```

---

### Task 10: Alerts (pure rules + the runner that mails)

**Files:**
- Modify (replace the Task 7 stub whole): `lib/services/marketing-alerts.ts`
- Create: `lib/marketing/engagement.ts`
- Create: `scripts/marketing-alerts-selftest.ts`

**Interfaces:**
- Consumes: `getPurchasesByCampaign` (Task 9), `sendMail` / `appOrigin` (`lib/email.ts`), `mdb`.
- Produces: `engagementOf(media)` (pure, `lib/marketing/engagement.ts` - safe for the client bundle), `budgetBleedAlerts(input)`, `viralPostAlerts(input)` (pure), `AlertCandidate`, `runMarketingAlerts({ dryRun })` (same signature as the stub).

- [ ] **Step 1: Selftest**

```ts
// Run: npx tsx scripts/marketing-alerts-selftest.ts
import assert from "node:assert/strict";
import { budgetBleedAlerts, viralPostAlerts } from "../lib/services/marketing-alerts";

const now = new Date("2026-10-08T12:00:00Z");
const spend = (campaign_id: string, day: string, spend: number) => ({ campaign_id, day, spend, brand: "mega_events" as const, name: `camp ${campaign_id}` });
const bleed = budgetBleedAlerts({
  spend: [spend("c1", "2026-10-06", 600), spend("c1", "2026-10-07", 600), spend("c1", "2026-10-08", 600), spend("c2", "2026-10-07", 5000), spend("c3", "2026-10-07", 100)],
  purchasesByCampaign: new Map([["c2", 1]]),
  settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 },
  now,
});
assert.deepEqual(bleed.map((a) => a.key), ["c1"], "c1 bled 1800 with no purchase; c2 bought; c3 is under the bar");
assert.equal(bleed[0].kind, "budget_bleed");
assert.equal(bleed[0].payload.spend_ils, 1800);
assert.equal(budgetBleedAlerts({ spend: [spend("c1", "2026-10-01", 9000)], purchasesByCampaign: new Map(), settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 }, now }).length, 0, "outside the window");
assert.equal(budgetBleedAlerts({ spend: [{ ...spend("c9", "2026-10-07", 9000), brand: "other" }], purchasesByCampaign: new Map(), settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 }, now }).length, 0, "other brands never alert");

const post = (id: string, posted_at: string, eng: number) => ({ id, posted_at, like_count: eng, comments_count: 0, saved: 0, shares: 0, media_product_type: "FEED" as const });
const history = Array.from({ length: 30 }, (_, i) => post(`h${i}`, `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`, 100));
const viral = viralPostAlerts({ media: [...history, post("new", "2026-10-07T10:00:00Z", 250), post("fresh", "2026-10-08T11:30:00Z", 900), post("meh", "2026-10-07T09:00:00Z", 150)], settings: { viral_pct: 200 }, now });
assert.deepEqual(viral.map((a) => a.key), ["new"], "250 > 200% of 100; 'fresh' is under 24h; 'meh' is 150%");
assert.equal(viral[0].payload.engagement, 250);
assert.equal(viralPostAlerts({ media: [post("only", "2026-10-07T10:00:00Z", 999)], settings: { viral_pct: 200 }, now }).length, 0, "no history = no baseline");

console.log("marketing-alerts selftest OK");
```

- [ ] **Step 2: Run - expect a failure** (the stub exports neither rule).

- [ ] **Step 3: `lib/marketing/engagement.ts`**

```ts
/** Engagement of one Instagram media = likes + comments + saves + shares. Pure; used by the viral rule and the grid's badge. */
export const engagementOf = (m: { like_count: number; comments_count: number; saved: number; shares: number }): number =>
  m.like_count + m.comments_count + m.saved + m.shares;

/** Mean engagement of the up-to-30 posts BEFORE index i (posts sorted oldest first); null with fewer than 5. */
export function baselineBefore<T extends { like_count: number; comments_count: number; saved: number; shares: number }>(posts: T[], i: number): number | null {
  const before = posts.slice(Math.max(0, i - 30), i);
  if (before.length < 5) return null;
  return before.reduce((s, b) => s + engagementOf(b), 0) / before.length;
}
```

- [ ] **Step 4: Implement `lib/services/marketing-alerts.ts`**

```ts
/**
 * Marketing alerts (spec section 6): two pure rules + a runner that dedupes through
 * `marketing_alerts` and mails once per new alert. Thresholds come from marketing_settings.
 * scripts/marketing-alerts-selftest.ts covers the rules.
 */
import { mdb } from "@/lib/services/marketing-db";
import { appOrigin, sendMail } from "@/lib/email";
import { getPurchasesByCampaign } from "@/lib/services/marketing-purchases";
import { baselineBefore, engagementOf } from "@/lib/marketing/engagement";
import { DEFAULT_MARKETING_SETTINGS, MARKETING_SETTING_KEYS, type AdBrand, type MarketingSettings } from "@/types/marketing.types";

export interface AlertCandidate { kind: "budget_bleed" | "viral_post"; key: string; title: string; payload: Record<string, unknown> }

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export function budgetBleedAlerts(input: { spend: { campaign_id: string; day: string; spend: number; brand: AdBrand; name: string }[]; purchasesByCampaign: Map<string, number>; settings: Pick<MarketingSettings, "budget_bleed_ils" | "budget_bleed_days">; now: Date }): AlertCandidate[] {
  const since = dayStr(new Date(input.now.getTime() - (input.settings.budget_bleed_days - 1) * 864e5));
  const byCampaign = new Map<string, { spend: number; name: string }>();
  for (const s of input.spend) {
    if (s.brand !== "mega_events" || s.day < since) continue;
    const c = byCampaign.get(s.campaign_id) ?? { spend: 0, name: s.name };
    c.spend += s.spend;
    byCampaign.set(s.campaign_id, c);
  }
  const out: AlertCandidate[] = [];
  for (const [id, c] of byCampaign) {
    if (c.spend > input.settings.budget_bleed_ils && (input.purchasesByCampaign.get(id) ?? 0) === 0) {
      out.push({ kind: "budget_bleed", key: id, title: `${c.name}: ₪${Math.round(c.spend)} ב-${input.settings.budget_bleed_days} ימים בלי רכישה`, payload: { campaign_id: id, name: c.name, spend_ils: Math.round(c.spend * 100) / 100, days: input.settings.budget_bleed_days } });
    }
  }
  return out;
}

export function viralPostAlerts(input: { media: { id: string; posted_at: string | null; like_count: number; comments_count: number; saved: number; shares: number; media_product_type: string | null }[]; settings: Pick<MarketingSettings, "viral_pct">; now: Date }): AlertCandidate[] {
  const posts = input.media.filter((m) => m.posted_at && m.media_product_type !== "STORY").sort((a, b) => (a.posted_at! < b.posted_at! ? -1 : 1));
  const out: AlertCandidate[] = [];
  posts.forEach((m, i) => {
    if (input.now.getTime() - new Date(m.posted_at!).getTime() < 24 * 3600e3) return;
    const mean = baselineBefore(posts, i);
    if (mean === null || mean <= 0) return;
    const eng = engagementOf(m);
    if (eng > (mean * input.settings.viral_pct) / 100) {
      out.push({ kind: "viral_post", key: m.id, title: `פוסט ויראלי: ${eng} מעורבות מול ממוצע ${Math.round(mean)}`, payload: { media_id: m.id, engagement: eng, mean: Math.round(mean) } });
    }
  });
  return out;
}

async function settings(): Promise<MarketingSettings> {
  const { data } = await mdb.from("marketing_settings").select("key, value");
  const out: MarketingSettings = { ...DEFAULT_MARKETING_SETTINGS };
  for (const r of (data ?? []) as { key: keyof MarketingSettings; value: unknown }[]) if (MARKETING_SETTING_KEYS.includes(r.key)) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  return out;
}

/** Evaluate both rules over the stored tables, dedupe, mail the new ones. */
export async function runMarketingAlerts(opts: { dryRun: boolean }): Promise<{ newAlerts: number; resolved: number; mail: "sent" | "skipped" | "failed" }> {
  const now = new Date();
  const s = await settings();
  const since = dayStr(new Date(now.getTime() - 14 * 864e5));
  const windowSince = dayStr(new Date(now.getTime() - (s.budget_bleed_days - 1) * 864e5));
  const [spendRes, entRes, mediaRes, openRes, purchasesByCampaign] = await Promise.all([
    mdb.from("ad_spend_daily").select("campaign_id, platform, day, spend").gte("day", since),
    mdb.from("ad_entities").select("platform, id, name, brand").eq("kind", "campaign"),
    mdb.from("ig_media").select("id, posted_at, like_count, comments_count, saved, shares, media_product_type").order("posted_at", { ascending: false }).limit(120),
    mdb.from("marketing_alerts").select("kind, key").is("resolved_at", null),
    getPurchasesByCampaign(windowSince, dayStr(now)),
  ]);
  const ent = new Map<string, { name: string; brand: AdBrand }>((entRes.data ?? []).map((e: { platform: string; id: string; name: string; brand: AdBrand }) => [`${e.platform}:${e.id}`, e]));
  const spend = (spendRes.data ?? []).map((r: { campaign_id: string; platform: string; day: string; spend: number }) => ({ campaign_id: r.campaign_id, day: r.day, spend: Number(r.spend), brand: ent.get(`${r.platform}:${r.campaign_id}`)?.brand ?? ("other" as AdBrand), name: ent.get(`${r.platform}:${r.campaign_id}`)?.name ?? r.campaign_id }));
  const candidates = [...budgetBleedAlerts({ spend, purchasesByCampaign, settings: s, now }), ...viralPostAlerts({ media: mediaRes.data ?? [], settings: s, now })];
  const open = new Set<string>((openRes.data ?? []).map((a: { kind: string; key: string }) => `${a.kind}:${a.key}`));
  const fresh = candidates.filter((c) => !open.has(`${c.kind}:${c.key}`));
  const still = new Set(candidates.map((c) => `${c.kind}:${c.key}`));
  const toResolve = [...open].filter((k) => !still.has(k));
  if (!opts.dryRun) {
    if (fresh.length) await mdb.from("marketing_alerts").upsert(fresh.map((c) => ({ kind: c.kind, key: c.key, payload: c.payload, first_seen_at: now.toISOString(), resolved_at: null, last_mailed_at: null })), { onConflict: "kind,key" });
    for (const k of toResolve) { const i = k.indexOf(":"); await mdb.from("marketing_alerts").update({ resolved_at: now.toISOString() }).eq("kind", k.slice(0, i)).eq("key", k.slice(i + 1)); }
  }
  let mail: "sent" | "skipped" | "failed" = "skipped";
  const to = s.alert_emails.length ? s.alert_emails.join(",") : process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (fresh.length && to && !opts.dryRun) {
    try {
      await sendMail({ to, subject: `MYT Admin · ${fresh.length} התראות שיווק`, html: [`<div dir="rtl">`, ...fresh.map((c) => `<p><b>${c.kind === "budget_bleed" ? "שריפת תקציב" : "ויראליות"}</b> - ${c.title}</p>`), `<p><a href="${appOrigin()}/marketing?tab=alerts">לכל ההתראות</a></p></div>`].join("") });
      for (const c of fresh) await mdb.from("marketing_alerts").update({ last_mailed_at: now.toISOString() }).eq("kind", c.kind).eq("key", c.key);
      mail = "sent";
    } catch (e) { console.error("[marketing-alerts] mail failed", e); mail = "failed"; }
  }
  return { newAlerts: fresh.length, resolved: toResolve.length, mail };
}
```

- [ ] **Step 5: Run the selftest - expect OK; type-check; commit**

```bash
git add lib/services/marketing-alerts.ts lib/marketing/engagement.ts scripts/marketing-alerts-selftest.ts
git commit -m "feat(marketing): budget-bleed and viral-post alerts (pure rules, selftested) deduped in marketing_alerts and mailed once" -- lib/services/marketing-alerts.ts lib/marketing/engagement.ts scripts/marketing-alerts-selftest.ts
```

---

### Task 11: The `/marketing` screen

**Files:**
- Create: `app/(dashboard)/marketing/page.tsx`
- Create: `app/(dashboard)/marketing/loading.tsx`
- Create: `app/(dashboard)/marketing/marketing-client.tsx`
- Create: `app/(dashboard)/marketing/exec-tab.tsx`
- Create: `app/(dashboard)/marketing/media-tab.tsx`
- Create: `app/(dashboard)/marketing/instagram-tab.tsx`
- Create: `app/(dashboard)/marketing/alerts-tab.tsx`
- Create: `app/(dashboard)/marketing/settings-tab.tsx`
- Modify: `lib/nav.ts` (Marketing group item + `SEGMENT_LABELS`)

**Interfaces:**
- Consumes: Task 9 / 10 actions; `UrlTabs` (`components/url-tabs.tsx`), `useUrlState` (`hooks/use-view-state.ts`), `DataTable` + `SortableHeader` (`components/data-table.tsx`), `PageHeader`, `ChartContainer` / `ChartTooltip` / `ChartTooltipContent` (`components/ui/chart.tsx`) + recharts `LineChart` (copy the imports of `components/dashboard/trend-chart.tsx`), shadcn `Card`, `Select`, `Badge`, `Button`, `Input`, `Tabs*`; toasts the way `price-light-client.tsx` does; `engagementOf` / `baselineBefore` (`lib/marketing/engagement.ts`).

- [ ] **Step 1: page + loading + nav**

`page.tsx`:

```tsx
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingClient } from "./marketing-client";

export default async function MarketingPage() {
  await requireAdmin();
  return (
    <div className="container mx-auto space-y-6 py-10">
      <PageHeader title="Marketing" description="Spend from Meta and Google against the orders that were actually paid - revenue, supplier cost and profit per campaign; Instagram performance; alerts. Synced every six hours." />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <MarketingClient />
      </Suspense>
    </div>
  );
}
```

`loading.tsx`:

```tsx
import { DataTableSkeleton } from "@/components/data-table";
export default function Loading() { return <div><DataTableSkeleton label="Loading marketing" /></div>; }
```

`lib/nav.ts`: in the Marketing group, FIRST item (import `BarChart3` from `lucide-react`):

```ts
{ name: "Marketing Dashboard", href: "/marketing", icon: BarChart3, keywords: "spend revenue poas campaigns instagram שיווק קמפיינים", roles: ADMIN_ROLES, productType: "events" },
```

and `"marketing": "Marketing Dashboard"` in `SEGMENT_LABELS`.

- [ ] **Step 2: `marketing-client.tsx`** - copy how `app/(dashboard)/tasks/tasks-client.tsx` mounts `UrlTabs` (one `useSearchParams()`, `defaultValue`, `values`):

```tsx
"use client";

import { UrlTabs } from "@/components/url-tabs";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExecTab } from "./exec-tab";
import { MediaTab } from "./media-tab";
import { InstagramTab } from "./instagram-tab";
import { AlertsTab } from "./alerts-tab";
import { SettingsTab } from "./settings-tab";

const TAB_IDS = ["exec", "media", "instagram", "alerts", "settings"] as const;

export function MarketingClient() {
  return (
    <UrlTabs defaultValue="exec" values={TAB_IDS}>
      <TabsList>
        <TabsTrigger value="exec">הנהלה</TabsTrigger>
        <TabsTrigger value="media">מדיה</TabsTrigger>
        <TabsTrigger value="instagram">אינסטגרם</TabsTrigger>
        <TabsTrigger value="alerts">התראות</TabsTrigger>
        <TabsTrigger value="settings">הגדרות</TabsTrigger>
      </TabsList>
      <TabsContent value="exec" className="mt-4"><ExecTab /></TabsContent>
      <TabsContent value="media" className="mt-4"><MediaTab /></TabsContent>
      <TabsContent value="instagram" className="mt-4"><InstagramTab /></TabsContent>
      <TabsContent value="alerts" className="mt-4"><AlertsTab /></TabsContent>
      <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
    </UrlTabs>
  );
}
```

- [ ] **Step 3: `exec-tab.tsx`** - `const [range, setRange] = useUrlState("range", "30d", MARKETING_RANGES)` and `const [brand, setBrand] = useUrlState("brand", "mega_events", ["mega_events", "other", "all"] as const)`; two `Select`s; `useEffect` loads `getMarketingPnl(range, brand)` into state with a `cancelled` guard (as `trend-chart.tsx` does). Cards in `grid gap-4 md:grid-cols-4`:

| Card | Value | Note under it |
|---|---|---|
| הוצאה | `$totals.spendUsd` | `since → until` |
| הכנסה | `$totals.revenueUsd` | `totals.purchases הזמנות · לא מיוחס $unattributed.revenueUsd` |
| עלות ספקים | `$totals.cogsUsd` | `משוער ב-N הזמנות` when `estimatedCount > 0` · `עמלת סליקה $feeUsd` |
| רווח נקי | `$totals.netUsd` | when `range === "month"` and target > 0: green ≥ target / red below, "יעד $X"; target 0 → "יעד לא הוגדר" |
| CAC | `$cacUsd` or "—" | — |
| ROAS | `roas`× or "—" | — |
| POAS | `poas` or "—" | colour: `< 0` red, `0..1` amber, `> 1` green |

Then a `Card` with `ChartContainer` + recharts `LineChart` over `daily` (lines `spendUsd` → "הוצאה", `revenueUsd` → "הכנסה"; `ChartConfig` keys `spend` / `revenue`), height 260. Money: `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })`.

- [ ] **Step 4: `media-tab.tsx`** - same two `useUrlState` keys; `DataTable` over `campaigns` with columns: platform badge ("מטא" / "גוגל"), `name` (search column), `brand`, `status`, `spendUsd`, clicks + CTR (`clicks / impressions`), `platformPurchases` (title shows `platformValue`), `purchases` ("שלנו"), `revenueUsd`, `cogsUsd` (a "משוער" dot when `estimatedCount > 0`), `poas` (coloured as above), `roas`; `defaultSorting={[{ id: "spendUsd", desc: true }]}`; `getRowId={(r) => r.key}`; `onRowClick` toggles `expandedRowId`; `renderExpandedRow` lists `adsets` (name, spend, purchases, revenue, POAS); `dense`. Under the table two small cards: "לא זוהה" per platform (`unresolved`) and "לא מיוחס" (`unattributed`) with purchases + revenue.

- [ ] **Step 5: `instagram-tab.tsx`** - `getInstagramFeed()` on mount; a sort `Select` (מעורבות / reach / תאריך); "עוקבים: N" from the last `followers` row; grid `grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3` of cards: `<img src={thumbnail_url ?? media_url ?? ""} className="aspect-square w-full object-cover">` wrapped in `<a href={permalink} target="_blank" rel="noreferrer">`, a type `Badge`, the date, reach / likes / comments / saves + shares; "ויראלי" badge when `engagementOf(m) > 2 * baselineBefore(postsOldestFirst, i)` (STORY excluded, same rule as the alert).

- [ ] **Step 6: `alerts-tab.tsx`** - `getMarketingAlerts()`; two lists (פתוחות / נפתרו): kind badge, `payload.name ?? payload.media_id`, `first_seen_at` (`toLocaleString("he-IL")`), "נשלח במייל" when `last_mailed_at`, a link to `?tab=media` (budget bleed) or `?tab=instagram` (viral).

- [ ] **Step 7: `settings-tab.tsx`** - `getMarketingSettings()` into a form (six `Input`s; `alert_emails` comma-separated → split/trim), "שמירה" → `saveMarketingSettings(patch)` + toast; "סנכרן עכשיו" → `runMarketingSyncNow()` and a list of `steps` (step · ok ✓/✗ · note); the campaign brand table from `listCampaignBrands()` with a `Select` per row (Mega Events / אחר / לפי חוק) → `setCampaignBrand(platform, id, value)` + toast.

- [ ] **Step 8: Verify in the browser** - `preview_start` the dev server, open `/marketing` as admin: cards render (zeros before the first sync are fine), tabs switch and the URL carries `?tab=`, no console errors; on `?tab=settings` save `budget_bleed_ils` and see the toast (expect a failure toast "relation marketing_settings does not exist" until the migration lands - that is the correct message, not a crash). Screenshot.

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/marketing" lib/nav.ts
git commit -m "feat(marketing): /marketing screen - executive cards and chart, campaign table with adsets, Instagram grid, alerts, settings" -- "app/(dashboard)/marketing" lib/nav.ts
```

---

### Task 12: Actual cost on the reservation edit page

**Files:**
- Modify: `app/(dashboard)/reservations/[id]/edit/page.tsx` (next to `accounting_number`, ~line 595)
- Modify: `lib/actions/reservation-actions.ts` `updateReservation` (~line 302): map `actual_cost_usd` (number | null; blank / NaN / negative → null) and `actual_cost_note` (text | null) explicitly - never spread the form.
- Modify: `app/(dashboard)/reservations/[id]/page.tsx`: under the existing cost block show "Actual supplier cost (USD)" + the note when set.

- [ ] **Step 1:** Two inputs in the same card as `accounting_number`: `actual_cost_usd` (`type="number" step="0.01" min="0"`, label "Actual supplier cost (USD)") and `actual_cost_note` (label "Cost note"), bound like the fields around them.
- [ ] **Step 2:** Verify in the browser: a Paid reservation's edit page, type 950 + a note, save → the detail page shows both; the audit row of `updateReservation` carries the two keys.
- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/reservations/[id]/edit/page.tsx" "app/(dashboard)/reservations/[id]/page.tsx" lib/actions/reservation-actions.ts
git commit -m "feat(reservations): ops can record the order's actual supplier cost - it wins over the computed COGS on /marketing" -- "app/(dashboard)/reservations/[id]/edit/page.tsx" "app/(dashboard)/reservations/[id]/page.tsx" lib/actions/reservation-actions.ts
```

---

### Task 13: main - ticket cost snapshot at confirm-order + real purchase value

Repo: `myt-main` (detached HEAD; `git commit` works; Dor pushes with `git push origin HEAD:main`).

**Files:**
- Modify: `lib/livetickets.ts` (`LiveTicketsOffer` + `getLiveTicketsOffers`)
- Create: `lib/tixstock-feed.ts`
- Modify: `app/api/tixstock/tickets/route.ts` (~lines 300-345: call the extracted fetch)
- Create: `lib/ticket-cost.ts`
- Create: `lib/__tests__/ticketCost.test.ts`
- Modify: `app/api/confirm-order/route.ts:302-390` (payload + the 42703 strip list)
- Modify: `app/api/confirm-order/[id]/route.ts:20-24` (select)
- Modify: `app/confirmation/[...params]/page.tsx:108-135` (`trackAnalyticsEvent`)
- Modify: `lib/gtmAnalytics.ts:14-22, 79-93` (`EventData` + drop the 1500 defaults)
- Modify: `lib/app.types.ts` `OrderData` (add `user_shown_price?: number`) if that is the GET response type the page uses

- [ ] **Step 1: Expose the raw cost on a LiveTickets offer**

In `LiveTicketsOffer` add `/** What LiveTickets charges us for ONE ticket, USD at the same rate the price used, before our markup and the card step. */ costUsd: number;`. In `lib/supplier-pricing.ts` find the FX step `supplierCostToUsd` applies BEFORE the markup; export it as `rawCostToUsd(cost: number, currency: string): number | null` if it is not exported yet; in `getLiveTicketsOffers` set `costUsd: rawCostToUsd(category.cost, stock.currency) ?? 0`.

- [ ] **Step 2: `lib/tixstock-feed.ts`**

Move the page loop of `app/api/tixstock/tickets/route.ts` (`fetchPage` + the `remaining` pages block) into:

```ts
/** Every listing of a TixStock event, raw (proceed_price in the seller's currency). Shared by the tickets route and the confirm-order cost snapshot. */
export async function fetchTixstockListingsRaw(tixstockEventId: string): Promise<TixStockListing[]>
```

and have the route call it (behaviour unchanged - it still normalises `proceed_price` to USD afterwards). Add:

```ts
/** Per-ticket cost (USD) of the cheapest listing the SITE would sell for this category and party - the route's two filters + listingCanSatisfyQuantity - or null. */
export async function cheapestListingCostUsd(opts: { tixstockEventId: string; eventId: number; ticketId: string | null; category: string | null; quantity: number }): Promise<number | null>
```

using the route's own helpers: load the event's `tx_excluded_sections` the way the route does, `isExcludedSection`, the restricted-view filter, `categoryMatchesMapId` (or whatever the route uses to pair a listing with our ticket id), `listingCanSatisfyQuantity` (`lib/tixstock-quantity.ts`), then `toUsd(listing.proceed_price.amount, listing.proceed_price.currency)` and `Math.min`.

- [ ] **Step 3: `lib/ticket-cost.ts`**

```ts
/**
 * The supplier cost of the ticket on a new order, snapshotted into
 * `reservations.ticket_cost_usd` / `ticket_cost_source = 'live'` (backoffice migration
 * 20261008120000; the marketing P&L reads it). Only where the cost is in reach at confirm
 * time: LiveTickets (the live offer) and TixStock (the live feed, re-read on the server).
 * Anything else returns null and the backoffice estimates it overnight. Never throws -
 * a cost we could not read must never fail a checkout.
 */
import { getLiveTicketsOffers } from "@/lib/livetickets";
import { cheapestListingCostUsd } from "@/lib/tixstock-feed";

export type TicketCostSnapshot = { ticket_cost_usd: number; ticket_cost_source: "live" } | null;

export async function snapshotTicketCost(
  info: { supplier?: string; supplier_event_id?: string; id?: string; number_of_ticket?: number; supplier_category?: string },
  eventId: number,
  deps = { getLiveTicketsOffers, cheapestListingCostUsd },
): Promise<TicketCostSnapshot> {
  try {
    const qty = Math.max(1, Number(info.number_of_ticket) || 1);
    const round = (n: number) => Math.round(n * 100) / 100;
    if (info.supplier === "livetickets" && info.supplier_event_id) {
      const offers = await deps.getLiveTicketsOffers(info.supplier_event_id);
      const offer = offers?.find((o) => o.id === info.id);
      return offer && offer.costUsd > 0 ? { ticket_cost_usd: round(offer.costUsd * qty), ticket_cost_source: "live" } : null;
    }
    if (info.supplier === "tixstock" && info.supplier_event_id) {
      const perTicket = await deps.cheapestListingCostUsd({ tixstockEventId: info.supplier_event_id, eventId, ticketId: info.id ?? null, category: info.supplier_category ?? null, quantity: qty });
      return perTicket !== null && perTicket > 0 ? { ticket_cost_usd: round(perTicket * qty), ticket_cost_source: "live" } : null;
    }
    return null;
  } catch (error) {
    console.warn("[ticket-cost] snapshot skipped:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
```

`lib/__tests__/ticketCost.test.ts` (the repo's test runner - see `package.json` `test` script and a neighbouring test for the import style):

```ts
import { snapshotTicketCost } from "@/lib/ticket-cost";

const deps = {
  getLiveTicketsOffers: async () => [{ id: "77", costUsd: 101.5 } as never],
  cheapestListingCostUsd: async () => 80,
};

test("livetickets: offer cost x quantity", async () => {
  expect(await snapshotTicketCost({ supplier: "livetickets", supplier_event_id: "e1", id: "77", number_of_ticket: 2 }, 1, deps)).toEqual({ ticket_cost_usd: 203, ticket_cost_source: "live" });
});
test("tixstock: cheapest sellable listing x quantity", async () => {
  expect(await snapshotTicketCost({ supplier: "tixstock", supplier_event_id: "t1", id: "c", number_of_ticket: 3 }, 1, deps)).toEqual({ ticket_cost_usd: 240, ticket_cost_source: "live" });
});
test("unknown supplier or a throwing dep -> null, never a throw", async () => {
  expect(await snapshotTicketCost({ supplier: "static", number_of_ticket: 1 }, 1, deps)).toBeNull();
  expect(await snapshotTicketCost({ supplier: "livetickets", supplier_event_id: "e1", id: "77" }, 1, { ...deps, getLiveTicketsOffers: async () => { throw new Error("down"); } })).toBeNull();
});
```

- [ ] **Step 4: confirm-order**

After `settlement` is resolved and before `reservationPayload` is built:

```ts
const ticketCost = await snapshotTicketCost(validatedData.event_order_info, Number(validatedData.event_id));
```

and in the payload `...(ticketCost ?? {})`. In the `42703` retry add `ticket_cost_usd` and `ticket_cost_source` to the destructured-away keys (they are optional in the payload type - destructure with defaults or build `payloadWithoutSettlementColumns` with a filter over an array of the optional keys).

- [ ] **Step 5: Purchase value**

`[id]/route.ts` select: append `, user_shown_price`. `page.tsx` `trackAnalyticsEvent`: `eventData: { id: orderData.event_id, name: ..., date: ..., category: ..., value: orderData.user_shown_price, currency: "USD", quantity: orderData.event_order_info.number_of_ticket }`. `lib/gtmAnalytics.ts`: in the params replace `value: eventData.value || 1500` with `...(eventData.value != null ? { value: eventData.value } : {})` and the item's `price: eventData.value || 1500` with `...(eventData.value != null ? { price: eventData.value } : {})`; `currency` stays `eventData.currency || "USD"`.

- [ ] **Step 6: Tests + type-check**

Run the repo's test command on `lib/__tests__` and `npx tsc --noEmit -p .` - both clean.

- [ ] **Step 7: Commit (main)**

```bash
git add lib/livetickets.ts lib/supplier-pricing.ts lib/tixstock-feed.ts lib/ticket-cost.ts lib/__tests__/ticketCost.test.ts app/api/tixstock/tickets/route.ts app/api/confirm-order/route.ts "app/api/confirm-order/[id]/route.ts" "app/confirmation/[...params]/page.tsx" lib/gtmAnalytics.ts lib/app.types.ts
git commit -m "feat(order): snapshot the ticket's supplier cost at confirm-order (LiveTickets, TixStock) and send the real purchase value to analytics instead of 1500" -- lib/livetickets.ts lib/supplier-pricing.ts lib/tixstock-feed.ts lib/ticket-cost.ts lib/__tests__/ticketCost.test.ts app/api/tixstock/tickets/route.ts app/api/confirm-order/route.ts "app/api/confirm-order/[id]/route.ts" "app/confirmation/[...params]/page.tsx" lib/gtmAnalytics.ts lib/app.types.ts
```

---

### Task 14: Docs - CLAUDE.md and /guide

**Files:**
- Modify: `CLAUDE.md`: (a) a `marketingSync` bullet in the cron list (schedule, steps, `?dry_run=1`, `?only=`, `?backfill_days=`); (b) the ten marketing env names in the env block with one-line comments (no values); (c) the eight tables in the "Backoffice-only tables" list; (d) a short "Marketing dashboard (2026-10-08)" paragraph under Architecture naming the spec, the pure modules + selftests, the attribution rule, and the two main-side changes.
- Modify: `app/(dashboard)/guide/guide-content.ts`: a `GuideSection` `{ id: "marketing", nav: "/marketing", productType: "events", adminOnly: true, title: t("Marketing dashboard", "דשבורד שיווק"), intro: ..., howTo: [ t("Read the executive tab", "לקרוא את מסך ההנהלה") with 4 steps, t("Tag a campaign's brand / change a threshold", "לתייג קמפיין למותג / לשנות סף") with 3 steps ], points: [what POAS / ROAS / CAC are; what "לא זוהה" and "לא מיוחס" mean; what "משוער" means and how `actual cost` on a reservation overrides it], rules: [t("Numbers come from paid orders, never from pixels", "המספרים מהזמנות ששולמו, לא מפיקסלים"), t("The dashboard never writes to an ad account", "הדשבורד לא כותב לחשבונות הפרסום")] }`.

- [ ] **Step 1:** Write both; `npx tsx scripts/guide-selftest.ts` -> OK.
- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md "app/(dashboard)/guide/guide-content.ts"
git commit -m "docs(marketing): CLAUDE.md cron / env / tables for the marketing dashboard and its guide section" -- CLAUDE.md "app/(dashboard)/guide/guide-content.ts"
```

---

### Task 15: Selftest sweep + type gate (backoffice)

- [ ] Every selftest prints OK:

```bash
for s in reservation-pnl ad-brand reservation-cogs marketing-attribution marketing-pnl marketing-alerts guide; do npx tsx scripts/$s-selftest.ts || exit 1; done
```

- [ ] `npx tsc --noEmit -p . 2>&1 | grep -E "marketing|reservation-pnl|reservation-cogs|ads/"` -> no lines.
- [ ] `npm run lint -- --quiet 2>&1 | grep -E "marketing|ads/"` -> no errors.

---

### Task 16: Rollout (Dor + one session) - NOT part of the subagent run

1. **Push backoffice** (Dor): the migration applies on master ("Apply DB Migrations" workflow); watch it go green.
2. **Vercel env** (this session, with `VERCEL_TOKEN` from `.env.local`): add the ten `NEXT_SECRET_*` marketing vars to the backoffice project for `production` + `preview` through the Vercel REST API (`POST /v10/projects/{projectId}/env?teamId=...`, `type: "encrypted"`) - never echo values; verify with a `GET` that lists names only. Redeploy.
3. **First sync**: `GET /api/cron/marketingSync?key=...&dry_run=1` on prod → six steps `ok`; then `&backfill_days=90` once (spend 90 days back; click days follow over the next ticks); then open `/marketing?range=90d`.
4. `npm run db:types` on master after the migration → commit `types/database.types.ts`; retiring the `mdb` cast is a follow-up.
5. **Push main** (Dor) after the backoffice is live.
6. Memory: update `marketing-god-mode-plan-2026-09-18.md` → built; what is deferred (toggle, C/E/G/H, Mixpanel).

---

## Self-review

- **Spec coverage:** 2.1 → T2; 2.2 → T1 + T12; 2.3 → T6 + T13; 2.4 → T13; 3 → T1 (brand rule T3, retention T7); 4 → T3-T7; 5 → T8-T9; 6 → T10; 7 → T11; 8 → nothing to build; 9 → T15-T16, docs T14. The spec's "partner commission line" on the exec tab is NOT in this plan (it needs the partner terms the commission engine takes; the cards state revenue / COGS / net without it) - noted here so the spec is amended, not silently missed.
- **Placeholders:** none. The "confirm the real column name" notes (T6 xs2 columns, T9 session fields, T13 helper names) name the exact file to open and what to change.
- **Type consistency:** `AdSpendRow.adset_key` / `level` (T1) used by T3 / T4 / T7 / T9; `PaidTouch` (T8) consumed by T9 / T10; `MarketingSettings` keys (T1) used by T9 / T10 / T11; `runMarketingAlerts` stub (T7) replaced in T10 with the same signature; `fetchGoogleClicks` returns `AdClickRow` (T1) upserted on `gclid` (T7); `attributedReservations` lives in `marketing-purchases.ts` (T9) and is imported by the actions (T9) and the alerts (T10); `engagementOf` / `baselineBefore` (T10) used by the Instagram tab (T11).
