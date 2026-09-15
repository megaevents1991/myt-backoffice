# Price Light (רמזור) — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every live event gets two traffic lights (package, ticket-only) with a dollar amount, computed from competitor catalogs we crawl ourselves at most once per 48h per site and store, plus a daily snapshot of our own total price.

**Architecture:** A pure rules engine (`lib/services/price-light.ts`) turns "our price vs the cheapest stored competitor listing" into a light. Crawlers (`lib/services/competitor-scrapers/*`) harvest a competitor's catalog in one session into `competitor_listings`; a rule-based matcher pairs listings with our events into `competitor_matches`; the nightly cron snapshots our prices, computes the price-drop tag, re-matches and recomputes lights. LiveTickets needs no crawler — its listings come from the `live_events` table the existing API sync already fills. AI judging and the `/price-light` screen are phase 1.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (service-role client `@/lib/supabase-server`), `playwright-core` + `@sparticuz/chromium` (already deps), `linkedom` (new, HTML parsing without a browser), Vercel crons guarded by `guardCronRoute`, shadcn/ui, Node 22 (`node --env-file=.env.local scripts/*.ts` runs TS scripts via type stripping — see `scripts/richtext-roundtrip-test.ts`).

**Spec:** `docs/superpowers/specs/2026-09-09-price-light-design.md` (phase 0 = §12 row 0; this plan implements §1, §2, §3, §4 without AI, §6.1–6.3, §7.1, and the phase-0 parts of §10–§11).

## Global Constraints

- **Never commit or push.** Every task ends with "stop and report the diff to Dor" — Dor reviews and runs `/commit-push`. No `git commit`, no `git add`. No AI co-author lines ever.
- **Never apply the migration** (`npm run db:push`, workflow dispatch) from this branch. It lands via the PR merge to master.
- **Worktree:** run everything from `myt-backoffice/.claude/worktrees/feat-price-light`. Never `cd` to the main checkout. No bare `git stash`.
- **Soft deletes only:** `is_deleted` = `"MM-DD-YYYY"` string. Never hard-delete events.
- **Shared types stay in sync:** `types/app.types.ts` `Event` ↔ main `lib/app.types.ts` (absolute path: `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-main\lib\app.types.ts`). Main has no `comp_pricing` field — known intentional diff; do not add it there.
- **Price rules:** never compute a base price here; `lib/services/price-quote.ts` owns those. This feature only *reads* `base_flight_price` / `base_hotel_price` / tickets.
- **Thresholds and normalization constants live ONLY in `lib/services/price-light.ts`** (spec §2.1): `LIGHT_GREEN_USD −150`, `LIGHT_RED_USD +150`, `LIGHT_STALE_DAYS 14`, `PRICE_DROP_MIN_USD 50`, `PRICE_DROP_LOOKBACK_DAYS 14`, `PRICE_DROP_SHOW_DAYS 14`, `DATE_TOLERANCE_DAYS 1`, `BAG_USD 120`, `CONNECTION_USD 100`, `STAR_STEP_USD 40`, `NIGHT_USD 90`, `BREAKFAST_USD 15`, `TRANSFER_USD 30`, `LIVETICKETS_RETAIL_FACTOR 1.0`, `LIVETICKETS_RETAIL_OFFSET_USD 0`.
- **Light values:** `alone | green | orange | red | unchecked | na`. `null` column = `unchecked`.
- **Stealth (spec §3.4):** one crawl session at a time, random 20–60s pause between pages, images/media/fonts blocked, rotating Israeli UA list, `Accept-Language: he-IL,he;q=0.9,en-US;q=0.8`, no referrer, 45s page timeout, 240s per crawl, `PRICE_LIGHT_SCRAPE=off` kill switch.
- **New tables** are backoffice-only: RLS enabled, no policies; access via the service-role client with a single `const db = supabase as any` boundary cast per file (existing pattern, `base-price-sync.ts:39`).
- **Supabase standard:** explicit `.select("col,col")`, `.single()`/`.maybeSingle()` for one row, check `error` before `data`, `console.error(JSON.stringify(error))`.
- **`?dry_run=1`** on every cron: full computation, zero writes.
- **Type gate:** `npx tsc --noEmit` must stay clean for every file this plan touches (the build ignores TS errors, so run it yourself).
- **`/guide`** (`app/(dashboard)/guide/guide-content.ts`) is updated in Task 12 because the events-table competitor flow changes.

---

## File map

| File | Responsibility |
| --- | --- |
| `supabase/migrations/<ts>_price_light.sql` | 8 event columns, `competitor_crawl_runs`, `competitor_listings`, `competitor_matches`, `event_price_snapshots` |
| `types/price-light.types.ts` | Every enum/row/detail type for the feature |
| `types/app.types.ts`, main `lib/app.types.ts` | 8 optional `Event` columns |
| `types/task.types.ts` | `TASK_SOURCES` + `price_light` |
| `lib/services/price-light.ts` | **Pure** engine: constants, our prices, competitors per kind, normalize, light, price-drop rule, rule-match scoring. Zero runtime imports (node-testable) |
| `scripts/price-light-selftest.ts` | Assertions over the pure engine |
| `lib/services/price-light-store.ts` | DB side of the engine: latest matches per event, `recomputeEventLights`, snapshot + tag writes |
| `lib/services/competitor-scrapers/types.ts` | `CompetitorScraper`, `CrawlContext`, `Listing` |
| `lib/services/competitor-scrapers/index.ts` | Registry, `ACTIVE_COMPETITORS` |
| `lib/services/competitor-scrapers/liveevents.ts` | LiveEvents catalog + detail crawler |
| `lib/services/competitor-scrapers/livetickets-api.ts` | Listings from the `live_events` table |
| `lib/services/browser.ts` | `withBrowser()` — remote CDP or local chromium + proxy; page hardening |
| `lib/services/price-light-crawl.ts` | `runCrawl`, due-competitor pick, lock, circuit breaker, −50% alarm |
| `lib/services/price-light-match.ts` | `matchEvent` / `matchAllForEvent` (rule-based; AI hook empty in phase 0) |
| `lib/services/price-light-nightly.ts` | Snapshot + tag + match-all + lights, budgeted |
| `app/api/cron/price-light-crawl/route.ts`, `app/api/cron/price-light-nightly/route.ts` | Cron entry points |
| `app/api/price-light/crawl/route.ts` | Admin "crawl now" |
| `lib/actions/price-light-actions.ts` | `recheckEvent`, `listEventMatches` |
| `lib/actions/event-actions.ts` | Create hook, update guard, list columns |
| `app/(dashboard)/events/price-light-cell.tsx` | Pills + tooltip + history sheet |
| `app/(dashboard)/events/events-table.tsx` | Column swap, old competitor dialog removed |
| `scripts/scrape-once.ts`, `scripts/scrape-fixture.ts`, `scripts/livetickets-brt-check.ts`, `scripts/fixtures/liveevents/*` | Local tooling |
| `docs/superpowers/scrapers/liveevents.md` | Reconnaissance notes (URLs, selectors, price semantics) |
| `CLAUDE.md`, `.env.local`, `vercel.json`, `app/(dashboard)/guide/guide-content.ts` | Config + docs |

---

### Task 1: Migration + types (both repos)

**Files:**
- Create: `supabase/migrations/<timestamp>_price_light.sql` (via `npm run db:new price_light`)
- Create: `types/price-light.types.ts`
- Modify: `types/app.types.ts:96-106` (append after `comp_pricing`)
- Modify: `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-main\lib\app.types.ts` (same 8 fields, at the end of `Event`)
- Modify: `types/task.types.ts:20`, `lib/actions/task-actions.ts:134`

**Interfaces:**
- Produces: every type below, imported by all later tasks by name.

- [ ] **Step 1: Sync master and create the migration file**

```bash
git fetch origin && git merge origin/master
npm run db:new price_light
```

Expected: a new file `supabase/migrations/2026MMDDHHMMSS_price_light.sql`. Confirm no other file shares its 14-digit prefix (`ls supabase/migrations | cut -c1-14 | sort | uniq -d` prints nothing).

- [ ] **Step 2: Write the migration**

```sql
-- Price light (רמזור): competitor catalogs we crawl ourselves, the match per
-- event, our daily price snapshots, and the two lights on the event.
-- Spec: docs/superpowers/specs/2026-09-09-price-light-design.md §1.
-- No CHECK constraints (repo rule) - values validated in lib/services/price-light*.ts.

alter table public.events
  add column if not exists light_package        text,
  add column if not exists light_ticket         text,
  add column if not exists light_detail         jsonb,
  add column if not exists light_checked_at     timestamptz,
  add column if not exists light_silenced_until timestamptz,
  add column if not exists price_drop_usd       integer,
  add column if not exists price_drop_from      integer,
  add column if not exists price_drop_until     date;

create index if not exists events_light_package_idx
  on public.events (light_package) where is_deleted is null;

-- One crawl of one competitor site.
create table if not exists public.competitor_crawl_runs (
  id            bigserial primary key,
  competitor    text not null,          -- liveevents|issta|golasso|ontour|livetickets
  status        text not null,          -- running|ok|partial|blocked|error|skipped
  trigger       text not null,          -- schedule|manual|dry_run
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  pages         integer not null default 0,
  listings      integer not null default 0,
  prev_listings integer,
  note          text,
  browser_mode  text                    -- remote|local|fetch|table
);
create index if not exists ccr_comp_idx
  on public.competitor_crawl_runs (competitor, started_at desc);
alter table public.competitor_crawl_runs enable row level security;

-- The competitor's catalog, ours to keep.
create table if not exists public.competitor_listings (
  id              bigserial primary key,
  competitor      text not null,
  external_key    text not null,
  scope           text not null,        -- package|ticket
  title           text not null,
  title_he        text,
  event_date      date,
  city            text,
  venue           text,
  price_from      numeric,
  currency        text,                 -- ILS|USD|EUR|GBP
  price_usd       numeric,
  travel_depart   date,
  travel_return   date,
  attrs           jsonb,
  detail_text     text,
  url             text not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  run_id          bigint references public.competitor_crawl_runs(id) on delete set null,
  unique (competitor, external_key)
);
create index if not exists cl_date_idx
  on public.competitor_listings (competitor, event_date);
alter table public.competitor_listings enable row level security;

-- Our event <-> their listing. A new row only when something changed.
create table if not exists public.competitor_matches (
  id                 bigserial primary key,
  event_id           integer not null references public.events(id) on delete cascade,
  competitor         text not null,
  scope              text not null,
  listing_id         bigint references public.competitor_listings(id) on delete set null,
  status             text not null,     -- found|not_selling|unsure|na|skipped
  method             text not null,     -- rule|ai|manual|api
  ai_verdict         jsonb,
  raw_price          numeric,
  raw_currency       text,
  price_usd          numeric,
  normalized_usd     numeric,
  adjustments        jsonb,
  attrs              jsonb,
  our_usd            numeric,
  diff_usd           numeric,
  light              text,
  listing_changed_at timestamptz,
  note               text,
  created_at         timestamptz not null default now()
);
create index if not exists cm_event_idx
  on public.competitor_matches (event_id, created_at desc);
create index if not exists cm_listing_idx
  on public.competitor_matches (listing_id);
alter table public.competitor_matches enable row level security;

-- Our own total price, once a day - the proof behind the "price drop" tag.
create table if not exists public.event_price_snapshots (
  event_id     integer not null references public.events(id) on delete cascade,
  day          date not null,
  package_usd  integer,
  ticket_usd   integer,
  min_ticket   integer,
  base_flight  integer,
  base_hotel   integer,
  markup       integer,
  primary key (event_id, day)
);
alter table public.event_price_snapshots enable row level security;
```

- [ ] **Step 3: Write `types/price-light.types.ts`**

```ts
/**
 * Price light (רמזור) - hand-typed until the migration lands on master and
 * `npm run db:types` regenerates. Spec: docs/superpowers/specs/2026-09-09-price-light-design.md
 */

export const LIGHTS = ["alone", "green", "orange", "red", "unchecked", "na"] as const;
export type Light = (typeof LIGHTS)[number];

export const COMPETITORS = ["liveevents", "issta", "golasso", "ontour", "livetickets"] as const;
export type CompetitorKey = (typeof COMPETITORS)[number];

export const SCOPES = ["package", "ticket"] as const;
export type Scope = (typeof SCOPES)[number];

export type EventKind = "sports" | "music";

export const MATCH_STATUSES = ["found", "not_selling", "unsure", "na", "skipped"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_METHODS = ["rule", "ai", "manual", "api"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

export const CRAWL_STATUSES = ["running", "ok", "partial", "blocked", "error", "skipped"] as const;
export type CrawlStatus = (typeof CRAWL_STATUSES)[number];

export type CrawlTrigger = "schedule" | "manual" | "dry_run";
export type MatchTrigger = "crawl" | "nightly" | "on_create" | "manual" | "our_price_moved";

export type Currency = "ILS" | "USD" | "EUR" | "GBP";

/** What a competitor's page (or the AI) says is in the package. */
export interface ExtractedAttrs {
  bag_included: boolean | "unknown";
  direct_flight: boolean | "unknown";
  hotel_stars: number | "unknown";
  nights: number | "unknown";
  breakfast: boolean | "unknown";
  transfers: boolean | "unknown";
}

export const UNKNOWN_ATTRS: ExtractedAttrs = {
  bag_included: "unknown",
  direct_flight: "unknown",
  hotel_stars: "unknown",
  nights: "unknown",
  breakfast: "unknown",
  transfers: "unknown",
};

export interface Adjustment {
  key: "bag" | "connection" | "stars" | "nights" | "breakfast" | "transfers";
  usd: number;
  /** Short human label, e.g. "+bag −$120". */
  label: string;
}

export interface PerCompetitor {
  status: MatchStatus;
  normalized_usd: number | null;
  crawled_at: string | null;
}

export type UncheckedReason =
  | "never"
  | "stale"
  | "crawl_failed"
  | "unsure"
  | "partial_coverage";

export interface LightScopeDetail {
  light: Light;
  diff_usd: number | null;
  our_usd: number | null;
  competitor: CompetitorKey | null;
  raw: number | null;
  raw_currency: Currency | null;
  normalized_usd: number | null;
  adjustments: Adjustment[];
  partial: boolean;
  reason: UncheckedReason | null;
  crawled_at: string | null;
  match_id: number | null;
  per_competitor: Partial<Record<CompetitorKey, PerCompetitor>>;
}

export interface LightOverride {
  scope: Scope;
  light: Light;
  note: string;
  by: string;
  at: string;
  competitor_normalized_usd: number;
}

export interface LightDetail {
  package?: LightScopeDetail;
  ticket?: LightScopeDetail;
  override?: LightOverride | null;
}

export interface CrawlRunRow {
  id: number;
  competitor: CompetitorKey;
  status: CrawlStatus;
  trigger: CrawlTrigger;
  started_at: string;
  finished_at: string | null;
  pages: number;
  listings: number;
  prev_listings: number | null;
  note: string | null;
  browser_mode: "remote" | "local" | "fetch" | "table" | null;
}

export interface ListingRow {
  id: number;
  competitor: CompetitorKey;
  external_key: string;
  scope: Scope;
  title: string;
  title_he: string | null;
  event_date: string | null; // YYYY-MM-DD
  city: string | null;
  venue: string | null;
  price_from: number | null;
  currency: Currency | null;
  price_usd: number | null;
  travel_depart: string | null;
  travel_return: string | null;
  attrs: Partial<ExtractedAttrs> | null;
  detail_text: string | null;
  url: string;
  first_seen_at: string;
  last_seen_at: string;
  last_changed_at: string;
  run_id: number | null;
}

export interface MatchRow {
  id: number;
  event_id: number;
  competitor: CompetitorKey;
  scope: Scope;
  listing_id: number | null;
  status: MatchStatus;
  method: MatchMethod;
  ai_verdict: Record<string, unknown> | null;
  raw_price: number | null;
  raw_currency: Currency | null;
  price_usd: number | null;
  normalized_usd: number | null;
  adjustments: Adjustment[] | null;
  attrs: Partial<ExtractedAttrs> | null;
  our_usd: number | null;
  diff_usd: number | null;
  light: Light | null;
  listing_changed_at: string | null;
  note: string | null;
  created_at: string;
}

export interface PriceSnapshotRow {
  event_id: number;
  day: string; // YYYY-MM-DD
  package_usd: number | null;
  ticket_usd: number | null;
  min_ticket: number | null;
  base_flight: number | null;
  base_hotel: number | null;
  markup: number | null;
}
```

- [ ] **Step 4: Add the 8 columns to `Event` in `types/app.types.ts`**

Insert directly after the `comp_pricing` block (line 106, before the closing `};`):

```ts
  // Price light (רמזור) - written by the backoffice nightly/crawl crons
  // (lib/services/price-light-store.ts). Main reads light_package + the three
  // price_drop_* columns only (phase 3). Values: alone|green|orange|red|unchecked|na;
  // null = unchecked. Synced to main lib/app.types.ts.
  light_package?: string | null;
  light_ticket?: string | null;
  light_detail?: import("./price-light.types").LightDetail | null;
  light_checked_at?: string | null;
  light_silenced_until?: string | null;
  price_drop_usd?: number | null;
  price_drop_from?: number | null;
  price_drop_until?: string | null; // YYYY-MM-DD
```

- [ ] **Step 5: Mirror to main's `lib/app.types.ts`**

Open the main file (absolute path above), find the end of `export type Event = { ... };` and add the same 8 fields with `light_detail?: Record<string, unknown> | null;` (main has no `price-light.types.ts` and never reads the detail). Keep the comment.

- [ ] **Step 6: Extend `TASK_SOURCES`**

`types/task.types.ts:20` becomes:

```ts
export const TASK_SOURCES = ["manual", "creative_gap", "price_light"] as const;
```

And in `lib/actions/task-actions.ts:134` widen `source?: "manual" | "creative_gap";` to `source?: TaskSource;` (import `TaskSource` from `@/types/task.types`).

- [ ] **Step 7: Type gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "price-light|app.types|task" ; echo done`
Expected: no lines before `done`.

- [ ] **Step 8: Stop and report**

List the 6 files to Dor. Do not commit.

---

### Task 2: Pure rules engine + selftest

**Files:**
- Create: `lib/services/price-light.ts`
- Create: `scripts/price-light-selftest.ts`

**Interfaces:**
- Consumes: types from Task 1 (type-only imports).
- Produces (all exported from `lib/services/price-light.ts`):
  - constants listed in Global Constraints
  - `type PricedEvent` — the event fields the engine needs
  - `minAvailableTicketUsd(e): number | null`, `totalMarkupUsd(e): number`, `ourPackageUsd(e): number | null`, `ourTicketUsd(e): number | null`, `ourNights(e): number`
  - `kindOf(e): EventKind`, `competitorsFor(kind, scope, active: readonly CompetitorKey[]): CompetitorKey[]`
  - `normalize(priceUsd, attrs, ours: { nights: number }): { normalizedUsd: number; adjustments: Adjustment[]; partial: boolean }`
  - `type LatestMatch`, `computeScopeLight(input): LightScopeDetail`
  - `decidePriceDrop(input): PriceDropDecision | null`
  - `type MatchCandidate`, `ruleMatchScore(ours, candidate): number`, `pickRuleMatch(ours, candidates): { candidate; score } | null`
  - `lightLabel(detail): string`, `signedUsd(n): string`

- [ ] **Step 1: Write the failing selftest**

```ts
/**
 * Price-light engine selftest - pure functions only, no DB.
 * Run: node --env-file=.env.local scripts/price-light-selftest.ts
 */
import assert from "node:assert/strict";
import {
  BAG_USD, CONNECTION_USD, STAR_STEP_USD, NIGHT_USD, BREAKFAST_USD, TRANSFER_USD,
  ourPackageUsd, ourTicketUsd, ourNights, kindOf, competitorsFor, normalize,
  computeScopeLight, decidePriceDrop, pickRuleMatch, signedUsd,
  type PricedEvent, type LatestMatch,
} from "../lib/services/price-light.ts";
import { UNKNOWN_ATTRS } from "../types/price-light.types.ts";

const NOW = "2026-09-10T12:00:00.000Z";
const base: PricedEvent = {
  type: "sports_event",
  name: "Real Madrid vs Barcelona",
  name_english: "Real Madrid vs Barcelona",
  date: "2026-10-26",
  def_date_depart: "2026-10-24",
  def_date_return: "2026-10-27",
  base_flight_price: 500,
  base_hotel_price: 400,
  tickets_and_rates: [{ price: 300, available: true }, { price: 800, available: true }],
  skip_flight: false,
  ticket_only_markup: 60,
  markup_ticket: null, markup_flight: null, markup_hotel: null,
  event_additional_markup: 0,
};
const m = (over: Partial<LatestMatch>): LatestMatch => ({
  competitor: "liveevents", status: "found", normalized_usd: 1000, raw: 1000,
  raw_currency: "USD", crawled_at: NOW, match_id: 1, ...over,
});

// our prices
assert.equal(ourPackageUsd(base), 500 + 400 + 300 + 175);
assert.equal(ourTicketUsd(base), 300 + 60);
assert.equal(ourNights(base), 3);
assert.equal(ourPackageUsd({ ...base, skip_flight: true }), null);
assert.equal(ourPackageUsd({ ...base, tickets_and_rates: [] }), null);
assert.equal(ourTicketUsd({ ...base, ticket_only_markup: null }), null);
assert.equal(ourPackageUsd({ ...base, markup_ticket: 50, markup_flight: 30, markup_hotel: 20, event_additional_markup: 10 }), 500 + 400 + 300 + 110);

// kinds and competitors
assert.equal(kindOf(base), "sports");
assert.equal(kindOf({ ...base, type: "music_live_event_dynamic" }), "music");
assert.equal(kindOf({ ...base, type: "tx_event" }), "sports");
assert.deepEqual(competitorsFor("sports", "package", ["liveevents", "livetickets"]), ["liveevents"]);
assert.deepEqual(competitorsFor("music", "package", ["liveevents", "ontour", "issta"]), ["liveevents", "ontour"]);
assert.deepEqual(competitorsFor("sports", "ticket", ["liveevents", "livetickets"]), ["livetickets"]);

// normalization
const n1 = normalize(1000, { ...UNKNOWN_ATTRS, bag_included: true }, { nights: 3 });
assert.equal(n1.normalizedUsd, 1000 - BAG_USD);
assert.equal(n1.partial, true);
const n2 = normalize(1000, { bag_included: false, direct_flight: false, hotel_stars: 4, nights: 4, breakfast: true, transfers: true }, { nights: 3 });
assert.equal(n2.normalizedUsd, 1000 + CONNECTION_USD - STAR_STEP_USD * 3 - NIGHT_USD - BREAKFAST_USD * 3 - TRANSFER_USD);
assert.equal(n2.partial, false);
assert.equal(n2.adjustments.length, 5);
const n3 = normalize(1000, { bag_included: false, direct_flight: true, hotel_stars: 2, nights: 2, breakfast: false, transfers: false }, { nights: 3 });
assert.equal(n3.normalizedUsd, 1000 + STAR_STEP_USD * 3 + NIGHT_USD);

// lights
const ours = 1375;
const sports = ["liveevents", "issta", "golasso"] as const;
assert.equal(computeScopeLight({ ourUsd: null, matches: [], competitors: [...sports], now: NOW }).light, "na");
assert.equal(computeScopeLight({ ourUsd: ours, matches: [], competitors: [...sports], now: NOW }).reason, "never");
const allNot = sports.map((c) => m({ competitor: c, status: "not_selling", normalized_usd: null }));
assert.equal(computeScopeLight({ ourUsd: ours, matches: allNot, competitors: [...sports], now: NOW }).light, "alone");
const half = [m({ competitor: "liveevents", status: "not_selling", normalized_usd: null })];
const halfLight = computeScopeLight({ ourUsd: ours, matches: half, competitors: [...sports], now: NOW });
assert.equal(halfLight.light, "unchecked");
assert.equal(halfLight.reason, "partial_coverage");
const green = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1600 })], competitors: [...sports], now: NOW });
assert.equal(green.light, "green"); assert.equal(green.diff_usd, -225);
const orange = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1300 })], competitors: [...sports], now: NOW });
assert.equal(orange.light, "orange"); assert.equal(orange.diff_usd, 75);
const red = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1100 }), m({ competitor: "issta", normalized_usd: 1500 })], competitors: [...sports], now: NOW });
assert.equal(red.light, "red"); assert.equal(red.diff_usd, 275); assert.equal(red.competitor, "liveevents");
assert.equal(computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1525 })], competitors: [...sports], now: NOW }).light, "orange"); // exactly -150 is orange
const stale = computeScopeLight({ ourUsd: ours, matches: [m({ normalized_usd: 1600, crawled_at: "2026-08-01T00:00:00.000Z" })], competitors: [...sports], now: NOW });
assert.equal(stale.light, "unchecked"); assert.equal(stale.reason, "stale");
const unsure = computeScopeLight({ ourUsd: ours, matches: [m({ status: "unsure", normalized_usd: null })], competitors: [...sports], now: NOW });
assert.equal(unsure.light, "unchecked"); assert.equal(unsure.reason, "unsure");

// price drop
assert.deepEqual(decidePriceDrop({ today: "2026-09-10", todayUsd: 1300, refUsd: 1400, current: null }), { usd: 100, from: 1400, until: "2026-09-24" });
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1360, refUsd: 1400, current: null }), null);
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1400, refUsd: 1400, current: null }), null); // rose then came back
const cur = { usd: 100, from: 1400, until: "2026-09-20" };
assert.deepEqual(decidePriceDrop({ today: "2026-09-10", todayUsd: 1300, refUsd: 1400, current: cur }), cur); // not extended
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1380, refUsd: 1400, current: cur }), null); // price rose back above from-50
assert.equal(decidePriceDrop({ today: "2026-09-21", todayUsd: 1300, refUsd: 1300, current: cur }), null); // expired
assert.equal(decidePriceDrop({ today: "2026-09-10", todayUsd: 1300, refUsd: null, current: null }), null); // no reference

// rule match
const cands = [
  { id: 1, title: "Barcelona vs Real Madrid", event_date: "2026-10-26" },
  { id: 2, title: "Real Madrid vs Atletico", event_date: "2026-10-26" },
  { id: 3, title: "Real Madrid - Barcelona", event_date: "2026-10-27" },
];
const pick = pickRuleMatch({ names: ["Real Madrid vs Barcelona", "ריאל מדריד ברצלונה"], date: "2026-10-26" }, cands);
assert.equal(pick?.candidate.id, 1);
assert.equal(pickRuleMatch({ names: ["Liverpool vs Arsenal"], date: "2026-11-09" }, cands), null);
assert.equal(pickRuleMatch({ names: ["Real Madrid"], date: "2026-10-26" }, cands), null); // ambiguous: two same-date candidates

assert.equal(signedUsd(-180), "−$180");
assert.equal(signedUsd(35), "+$35");
assert.equal(signedUsd(0), "$0");

console.log("price-light selftest: all assertions passed");
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --env-file=.env.local scripts/price-light-selftest.ts`
Expected: fails with `Cannot find module '.../lib/services/price-light.ts'`.

- [ ] **Step 3: Write `lib/services/price-light.ts`**

Pure module. **No runtime imports** (only `import type`, which Node's type stripping erases) so the selftest runs under plain node.

```ts
// Price light (רמזור) rules engine - the ONLY place thresholds, normalization
// constants and the light decision live. Pure: no DB, no fetch, no runtime
// imports (scripts/price-light-selftest.ts runs it under plain node).
// Spec: docs/superpowers/specs/2026-09-09-price-light-design.md §2.
import type {
  Adjustment, CompetitorKey, Currency, EventKind, ExtractedAttrs, Light,
  LightScopeDetail, MatchStatus, PerCompetitor, Scope, UncheckedReason,
} from "../../types/price-light.types";

// ---- thresholds -----------------------------------------------------------
export const LIGHT_GREEN_USD = -150;
export const LIGHT_RED_USD = 150;
export const LIGHT_STALE_DAYS = 14;
export const OVERRIDE_DRIFT_USD = 20;
export const PRICE_DROP_MIN_USD = 50;
export const PRICE_DROP_LOOKBACK_DAYS = 14;
export const PRICE_DROP_SHOW_DAYS = 14;
export const DATE_TOLERANCE_DAYS = 1;

// ---- normalization (applied to the COMPETITOR's price to look like ours:
// direct, no bag, 3*, our nights, no breakfast, no transfers) ---------------
export const BAG_USD = 120;        // partners' number
export const CONNECTION_USD = 100; // opening values below - calibrate after a month
export const STAR_STEP_USD = 40;   // per star per night
export const NIGHT_USD = 90;       // per night
export const BREAKFAST_USD = 15;   // per night
export const TRANSFER_USD = 30;

// LiveTickets ticket light uses the API's `brt` (gross) as their shelf price.
// If the phase-0 spot check disproves that, calibrate cost -> shelf here.
export const LIVETICKETS_RETAIL_FACTOR = 1.0;
export const LIVETICKETS_RETAIL_OFFSET_USD = 0;

/** Main's legacy package markup (lib/events/price.ts DEFAULT_MARKUP). */
export const MAIN_DEFAULT_MARKUP_USD = 175;

// ---- our prices (mirrors main lib/events/price.ts - keep in step) ----------
export interface PricedEvent {
  type: string;
  name: string;
  name_english?: string | null;
  date: string;
  def_date_depart?: string | null;
  def_date_return?: string | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
  tickets_and_rates: { price: number; available?: boolean }[] | null;
  skip_flight?: boolean | null;
  ticket_only_markup?: number | null;
  markup_ticket?: number | null;
  markup_flight?: number | null;
  markup_hotel?: number | null;
  event_additional_markup?: number | null;
}

const amount = (v: number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function minAvailableTicketUsd(e: PricedEvent): number | null {
  const available = (e.tickets_and_rates ?? []).filter((t) => t?.available !== false);
  if (available.length === 0) return null;
  return Math.min(...available.map((t) => Number(t.price)));
}

/** Composed markups when any is set, else main's global 175; plus the per-event extra. */
export function totalMarkupUsd(e: PricedEvent): number {
  const extra = Number(e.event_additional_markup ?? 0) || 0;
  const composed = e.markup_ticket != null || e.markup_flight != null || e.markup_hotel != null;
  if (composed) {
    return amount(e.markup_ticket) + amount(e.markup_flight) + amount(e.markup_hotel) + extra;
  }
  return MAIN_DEFAULT_MARKUP_USD + extra;
}

/** The catalog-card price: flight + hotel + cheapest ticket + markup. null = na. */
export function ourPackageUsd(e: PricedEvent): number | null {
  if (e.skip_flight) return null;
  const ticket = minAvailableTicketUsd(e);
  if (ticket == null) return null;
  return Math.round(amount(e.base_flight_price) + amount(e.base_hotel_price) + ticket + totalMarkupUsd(e));
}

/** Ticket-only override price. null = na (no override configured). */
export function ourTicketUsd(e: PricedEvent): number | null {
  const markup = e.ticket_only_markup;
  if (markup == null || !Number.isFinite(Number(markup)) || Number(markup) < 0) return null;
  const ticket = minAvailableTicketUsd(e);
  if (ticket == null) return null;
  return Math.round(ticket + Number(markup));
}

export function ourNights(e: PricedEvent): number {
  const a = e.def_date_depart ? Date.parse(e.def_date_depart.slice(0, 10)) : NaN;
  const b = e.def_date_return ? Date.parse(e.def_date_return.slice(0, 10)) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 3;
  return Math.round((b - a) / 86_400_000);
}

// ---- competitors per kind ---------------------------------------------------
export function kindOf(e: Pick<PricedEvent, "type">): EventKind {
  return e.type === "music_event" || e.type === "music_live_event_dynamic" ? "music" : "sports";
}

const COMPETITORS_BY_KIND: Record<EventKind, Record<Scope, CompetitorKey[]>> = {
  sports: { package: ["liveevents", "issta", "golasso"], ticket: ["livetickets"] },
  music: { package: ["liveevents", "ontour"], ticket: ["livetickets"] },
};

/** Only competitors that have a crawler in the registry count ("alone" is never claimed against a site we cannot see). */
export function competitorsFor(kind: EventKind, scope: Scope, active: readonly CompetitorKey[]): CompetitorKey[] {
  return COMPETITORS_BY_KIND[kind][scope].filter((c) => active.includes(c));
}

// ---- normalization ------------------------------------------------------------
export function normalize(
  priceUsd: number,
  attrs: Partial<ExtractedAttrs> | null | undefined,
  ours: { nights: number },
): { normalizedUsd: number; adjustments: Adjustment[]; partial: boolean } {
  const a = attrs ?? {};
  const adjustments: Adjustment[] = [];
  let partial = false;
  const known = <T>(v: T | "unknown" | undefined): v is T => v !== undefined && v !== "unknown";

  if (known(a.bag_included)) { if (a.bag_included) adjustments.push({ key: "bag", usd: -BAG_USD, label: `+bag −$${BAG_USD}` }); }
  else partial = true;
  if (known(a.direct_flight)) { if (!a.direct_flight) adjustments.push({ key: "connection", usd: CONNECTION_USD, label: `connection +$${CONNECTION_USD}` }); }
  else partial = true;
  if (known(a.hotel_stars)) {
    const usd = (3 - a.hotel_stars) * STAR_STEP_USD * ours.nights;
    if (usd !== 0) adjustments.push({ key: "stars", usd, label: `${a.hotel_stars}★ ${usd > 0 ? "+" : "−"}$${Math.abs(usd)}` });
  } else partial = true;
  if (known(a.nights)) {
    const usd = (ours.nights - a.nights) * NIGHT_USD;
    if (usd !== 0) adjustments.push({ key: "nights", usd, label: `${a.nights} nights ${usd > 0 ? "+" : "−"}$${Math.abs(usd)}` });
  } else partial = true;
  if (known(a.breakfast)) { if (a.breakfast) adjustments.push({ key: "breakfast", usd: -BREAKFAST_USD * ours.nights, label: `+breakfast −$${BREAKFAST_USD * ours.nights}` }); }
  else partial = true;
  if (known(a.transfers)) { if (a.transfers) adjustments.push({ key: "transfers", usd: -TRANSFER_USD, label: `+transfers −$${TRANSFER_USD}` }); }
  else partial = true;

  const normalizedUsd = Math.round(priceUsd + adjustments.reduce((s, x) => s + x.usd, 0));
  return { normalizedUsd, adjustments, partial };
}

// ---- the light ------------------------------------------------------------------
export interface LatestMatch {
  competitor: CompetitorKey;
  status: MatchStatus;
  normalized_usd: number | null;
  raw: number | null;
  raw_currency: Currency | null;
  crawled_at: string | null;
  match_id: number | null;
  adjustments?: Adjustment[] | null;
  partial?: boolean;
  reason?: UncheckedReason | null; // carried from a failed crawl
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

export function computeScopeLight(input: {
  ourUsd: number | null;
  matches: LatestMatch[];
  competitors: readonly CompetitorKey[];
  now: string;
  staleDays?: number;
}): LightScopeDetail {
  const staleDays = input.staleDays ?? LIGHT_STALE_DAYS;
  const empty: LightScopeDetail = {
    light: "unchecked", diff_usd: null, our_usd: input.ourUsd, competitor: null, raw: null,
    raw_currency: null, normalized_usd: null, adjustments: [], partial: false, reason: null,
    crawled_at: null, match_id: null, per_competitor: {},
  };
  if (input.ourUsd == null) return { ...empty, light: "na" };
  if (input.competitors.length === 0) return { ...empty, reason: "never" };

  const per: Partial<Record<CompetitorKey, PerCompetitor>> = {};
  const valid: LatestMatch[] = [];
  let newestReason: UncheckedReason = "never";
  for (const c of input.competitors) {
    const match = input.matches.find((x) => x.competitor === c) ?? null;
    if (!match) { per[c] = { status: "skipped", normalized_usd: null, crawled_at: null }; continue; }
    per[c] = { status: match.status, normalized_usd: match.normalized_usd, crawled_at: match.crawled_at };
    const fresh = !!match.crawled_at && daysBetween(match.crawled_at, input.now) <= staleDays;
    if ((match.status === "found" || match.status === "not_selling") && fresh) valid.push(match);
    else newestReason = !fresh && match.crawled_at ? "stale" : match.status === "unsure" ? "unsure" : (match.reason ?? "crawl_failed");
  }

  if (valid.length === 0) return { ...empty, reason: newestReason, per_competitor: per };
  const found = valid.filter((x) => x.status === "found" && x.normalized_usd != null);
  if (found.length === 0) {
    if (valid.length === input.competitors.length) return { ...empty, light: "alone", per_competitor: per };
    return { ...empty, reason: "partial_coverage", per_competitor: per };
  }
  const best = found.reduce((a, b) => ((b.normalized_usd as number) < (a.normalized_usd as number) ? b : a));
  const diff = Math.round(input.ourUsd - (best.normalized_usd as number));
  const light: Light = diff < LIGHT_GREEN_USD ? "green" : diff > LIGHT_RED_USD ? "red" : "orange";
  return {
    light, diff_usd: diff, our_usd: input.ourUsd, competitor: best.competitor, raw: best.raw,
    raw_currency: best.raw_currency, normalized_usd: best.normalized_usd, adjustments: best.adjustments ?? [],
    partial: !!best.partial, reason: null, crawled_at: best.crawled_at, match_id: best.match_id, per_competitor: per,
  };
}

// ---- price-drop tag --------------------------------------------------------------
export interface PriceDropDecision { usd: number; from: number; until: string }

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Spec §6.2 step 2. `current` = the tag already on the event (or null). */
export function decidePriceDrop(input: {
  today: string;
  todayUsd: number | null;
  refUsd: number | null;
  current: PriceDropDecision | null;
}): PriceDropDecision | null {
  const { today, todayUsd, current } = input;
  if (todayUsd == null) return null;
  if (current && current.until >= today) {
    // Keep the tag unless the price climbed back to within $50 of the old price.
    return todayUsd <= current.from - PRICE_DROP_MIN_USD ? current : null;
  }
  if (input.refUsd == null) return null;
  const drop = input.refUsd - todayUsd;
  if (drop < PRICE_DROP_MIN_USD) return null;
  return { usd: Math.round(drop), from: Math.round(input.refUsd), until: addDays(today, PRICE_DROP_SHOW_DAYS) };
}

// ---- rule-based matching (before any AI) ----------------------------------------------
const STOP = new Set(["vs", "v", "fc", "cf", "the", "and", "at", "in", "match", "game", "tickets", "package", "משחק", "נגד", "מול", "חבילה", "כרטיסים"]);

export function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface MatchCandidate { id: number; title: string; title_he?: string | null; event_date: string | null }

/** 0..1 - share of our name tokens found in the candidate title (best over our names). */
export function ruleMatchScore(ours: { names: string[] }, candidate: MatchCandidate): number {
  const theirs = new Set([...nameTokens(candidate.title), ...nameTokens(candidate.title_he ?? "")]);
  let best = 0;
  for (const name of ours.names) {
    const tokens = nameTokens(name);
    if (tokens.length === 0) continue;
    const hit = tokens.filter((t) => theirs.has(t)).length / tokens.length;
    best = Math.max(best, hit);
  }
  return best;
}

export const RULE_MATCH_MIN_SCORE = 0.8;

/**
 * Deterministic pick: the single candidate on the exact date whose title covers
 * >= 80% of our name tokens. Two qualifying candidates with the same score =
 * ambiguous = null (the AI judge decides in phase 1). A ±1-day candidate is
 * never picked by rule.
 */
export function pickRuleMatch(
  ours: { names: string[]; date: string },
  candidates: MatchCandidate[],
): { candidate: MatchCandidate; score: number } | null {
  const sameDay = candidates.filter((c) => c.event_date === ours.date);
  const scored = sameDay
    .map((candidate) => ({ candidate, score: ruleMatchScore(ours, candidate) }))
    .filter((x) => x.score >= RULE_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1) return scored[0];
  if (scored.length > 1 && scored[0].score > scored[1].score) return scored[0];
  return null;
}

// ---- display helpers ------------------------------------------------------------
export function signedUsd(n: number): string {
  if (n === 0) return "$0";
  return `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n))}`;
}

export function lightLabel(detail: LightScopeDetail | null | undefined): string {
  if (!detail) return "unchecked";
  switch (detail.light) {
    case "alone": return "alone";
    case "na": return "—";
    case "unchecked": return detail.reason ? `unchecked · ${detail.reason.replace("_", " ")}` : "unchecked";
    default: return signedUsd(detail.diff_usd ?? 0);
  }
}
```

Selftest notes: `n2` → 4★ over **our** 3 nights = −40×3, they give 4 nights = −90, breakfast −15×3; `n3` → 2★ = +40×3, 2 nights = +90. The `"Real Madrid"` case: candidates 1 and 2 both score 1.0 on the same date → ambiguous → `null`; candidate 3 is on the 27th → never picked by rule.

- [ ] **Step 4: Run the selftest**

Run: `node --env-file=.env.local scripts/price-light-selftest.ts`
Expected: `price-light selftest: all assertions passed`.

- [ ] **Step 5: Type gate**

Run: `npx tsc --noEmit 2>&1 | grep -E "price-light" ; echo done` → nothing before `done`.

- [ ] **Step 6: Stop and report** (2 files). Do not commit.

---

### Task 3: Engine store — latest matches, `recomputeEventLights`, snapshot + tag

**Files:**
- Create: `lib/services/price-light-store.ts`

**Interfaces:**
- Consumes: Task 2 engine; `supabase` from `@/lib/supabase-server`; `ACTIVE_COMPETITORS` from Task 4 (`@/lib/services/competitor-scrapers`). *Task 4's registry must exist before this compiles — do Task 4 first if running out of order.*
- Produces:
  - `LIGHT_EVENT_COLUMNS: string`, `interface LightEvent`, `type Lights = { package: Light | null; ticket: Light | null }`
  - `loadEventForLight(eventId): Promise<LightEvent | null>`
  - `loadLatestMatches(eventId): Promise<(LatestMatch & { scope: Scope })[]>`
  - `recomputeEventLights(eventId, trigger, opts?: { dryRun?: boolean }): Promise<{ before: Lights; after: Lights; changed: boolean; detail: LightDetail }>`
  - `writeSnapshotAndTag(event: LightEvent, today: string, opts?: { dryRun?: boolean }): Promise<{ tagged: boolean; cleared: boolean; packageUsd: number | null }>`

- [ ] **Step 1: Write the store**

```ts
// DB side of the price-light engine. Every write to the events light/tag
// columns and to event_price_snapshots goes through here.
import { supabase } from "@/lib/supabase-server";
import { ACTIVE_COMPETITORS } from "@/lib/services/competitor-scrapers";
import {
  competitorsFor, computeScopeLight, decidePriceDrop, kindOf, minAvailableTicketUsd,
  ourPackageUsd, ourTicketUsd, totalMarkupUsd, PRICE_DROP_LOOKBACK_DAYS,
  type LatestMatch, type PricedEvent,
} from "@/lib/services/price-light";
import type { Light, LightDetail, LightScopeDetail, MatchRow, MatchTrigger, Scope } from "@/types/price-light.types";

// New tables predate the generated DB types - one boundary cast (repo pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const LIGHT_EVENT_COLUMNS =
  "id,name,name_english,type,date,def_date_depart,def_date_return,location," +
  "base_flight_price,base_hotel_price,tickets_and_rates,skip_flight,ticket_only_markup," +
  "markup_ticket,markup_flight,markup_hotel,event_additional_markup,is_deleted,is_test," +
  "light_package,light_ticket,light_detail,light_checked_at,price_drop_usd,price_drop_from,price_drop_until";

export interface LightEvent extends PricedEvent {
  id: number;
  location: { name?: string; city_iata?: string } | null;
  is_deleted: string | null;
  is_test?: boolean | null;
  light_package: Light | null;
  light_ticket: Light | null;
  light_detail: LightDetail | null;
  light_checked_at: string | null;
  price_drop_usd: number | null;
  price_drop_from: number | null;
  price_drop_until: string | null;
}

export type Lights = { package: Light | null; ticket: Light | null };

export async function loadEventForLight(eventId: number): Promise<LightEvent | null> {
  const { data, error } = await db.from("events").select(LIGHT_EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) { console.error("price-light: load event failed", JSON.stringify(error)); return null; }
  return (data as LightEvent | null) ?? null;
}

/** Newest match row per (competitor, scope), with its listing's crawl time. */
export async function loadLatestMatches(eventId: number): Promise<(LatestMatch & { scope: Scope })[]> {
  const { data, error } = await db
    .from("competitor_matches")
    .select("id,competitor,scope,status,listing_id,raw_price,raw_currency,normalized_usd,adjustments,attrs,note,created_at,competitor_listings(last_seen_at)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) { console.error("price-light: load matches failed", JSON.stringify(error)); return []; }
  const seen = new Set<string>();
  const out: (LatestMatch & { scope: Scope })[] = [];
  for (const row of (data ?? []) as (MatchRow & { competitor_listings: { last_seen_at: string } | null })[]) {
    const key = `${row.competitor}:${row.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const partial = !!(row.attrs && Object.values(row.attrs).some((v) => v === "unknown"));
    out.push({
      competitor: row.competitor, scope: row.scope, status: row.status,
      normalized_usd: row.normalized_usd == null ? null : Number(row.normalized_usd),
      raw: row.raw_price == null ? null : Number(row.raw_price), raw_currency: row.raw_currency,
      // A not_selling verdict is as fresh as the match itself (no listing to point at).
      crawled_at: row.competitor_listings?.last_seen_at ?? row.created_at,
      match_id: row.id, adjustments: row.adjustments ?? [], partial,
      reason: row.status === "skipped" ? "crawl_failed" : null,
    });
  }
  return out;
}

function scopeDetail(event: LightEvent, scope: Scope, matches: (LatestMatch & { scope: Scope })[], now: string): LightScopeDetail {
  const competitors = competitorsFor(kindOf(event), scope, ACTIVE_COMPETITORS);
  const ourUsd = scope === "package" ? ourPackageUsd(event) : ourTicketUsd(event);
  return computeScopeLight({ ourUsd, matches: matches.filter((m) => m.scope === scope), competitors, now });
}

export async function recomputeEventLights(
  eventId: number,
  trigger: MatchTrigger,
  opts: { dryRun?: boolean } = {},
): Promise<{ before: Lights; after: Lights; changed: boolean; detail: LightDetail }> {
  const event = await loadEventForLight(eventId);
  if (!event) throw new Error(`price-light: event ${eventId} not found`);
  const now = new Date().toISOString();
  const matches = await loadLatestMatches(eventId);
  const pkg = scopeDetail(event, "package", matches, now);
  const tkt = scopeDetail(event, "ticket", matches, now);
  const detail: LightDetail = { package: pkg, ticket: tkt, override: event.light_detail?.override ?? null };
  const before: Lights = { package: event.light_package, ticket: event.light_ticket };
  const after: Lights = { package: pkg.light, ticket: tkt.light };
  const changed = before.package !== after.package || before.ticket !== after.ticket;
  if (!opts.dryRun) {
    const { error } = await db
      .from("events")
      .update({ light_package: after.package, light_ticket: after.ticket, light_detail: detail, light_checked_at: now })
      .eq("id", eventId);
    if (error) { console.error(`price-light: write lights ${eventId} (${trigger}) failed`, JSON.stringify(error)); throw error; }
  }
  return { before, after, changed, detail };
}

function isoDaysAgo(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Spec §6.2 steps 1-2: today's snapshot + the price-drop tag decision. */
export async function writeSnapshotAndTag(
  event: LightEvent,
  today: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ tagged: boolean; cleared: boolean; packageUsd: number | null }> {
  const packageUsd = ourPackageUsd(event);
  const ticketUsd = ourTicketUsd(event);
  const snapshot = {
    event_id: event.id, day: today, package_usd: packageUsd, ticket_usd: ticketUsd,
    min_ticket: minAvailableTicketUsd(event), base_flight: Math.round(Number(event.base_flight_price) || 0),
    base_hotel: Math.round(Number(event.base_hotel_price) || 0), markup: Math.round(totalMarkupUsd(event)),
  };

  // Reference = the snapshot closest to 14 days back, at least 10 days back.
  const { data: refRow, error: refError } = await db
    .from("event_price_snapshots")
    .select("day,package_usd")
    .eq("event_id", event.id)
    .lte("day", isoDaysAgo(today, PRICE_DROP_LOOKBACK_DAYS - 4))
    .gte("day", isoDaysAgo(today, PRICE_DROP_LOOKBACK_DAYS + 7))
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (refError) console.error("price-light: snapshot ref failed", JSON.stringify(refError));

  const current = event.price_drop_usd != null && event.price_drop_from != null && event.price_drop_until
    ? { usd: event.price_drop_usd, from: event.price_drop_from, until: event.price_drop_until }
    : null;
  const decision = decidePriceDrop({ today, todayUsd: packageUsd, refUsd: refRow?.package_usd ?? null, current });
  const tagged = !!decision && !current;
  const cleared = !decision && !!current;

  if (!opts.dryRun) {
    const { error: snapError } = await db.from("event_price_snapshots").upsert(snapshot, { onConflict: "event_id,day" });
    if (snapError) console.error("price-light: snapshot upsert failed", JSON.stringify(snapError));
    if (tagged || cleared) {
      const { error } = await db.from("events").update({
        price_drop_usd: decision?.usd ?? null, price_drop_from: decision?.from ?? null, price_drop_until: decision?.until ?? null,
      }).eq("id", event.id);
      if (error) console.error("price-light: tag write failed", JSON.stringify(error));
    }
  }
  return { tagged, cleared, packageUsd };
}
```

- [ ] **Step 2: Type gate** — `npx tsc --noEmit 2>&1 | grep price-light ; echo done` → nothing (after Task 4's registry exists).

- [ ] **Step 3: Smoke against prod data, read-only**

Create a throwaway `scripts/price-light-smoke.ts` (delete before reporting):

```ts
import { recomputeEventLights } from "../lib/services/price-light-store.ts";
const id = Number(process.argv[2]);
console.log(JSON.stringify(await recomputeEventLights(id, "manual", { dryRun: true }), null, 2));
```

Run: `node --env-file=.env.local scripts/price-light-smoke.ts <a live event id from /events>`
Expected: `after.package` is `unchecked` with `reason: "never"` (no matches yet) or `na` for a `skip_flight` event; `detail.package.our_usd` equals the card price on the site for that event. If the `@/` alias breaks under node, this smoke is optional — the nightly dry-run in Task 9 covers it.

- [ ] **Step 4: Stop and report** (1 file). Do not commit.

---

### Task 4: Scraper contracts, registry, `withBrowser()`

**Files:**
- Create: `lib/services/competitor-scrapers/types.ts`
- Create: `lib/services/competitor-scrapers/index.ts`
- Create: `lib/services/browser.ts`
- Modify: `.env.local` (add the vars, empty)

**Interfaces:**
- Produces:
  - `interface CompetitorScraper { key; scopes; kinds; intervalHours; mode: "browser"|"fetch"|"table"; crawl(ctx): AsyncGenerator<Listing>; detail?(listing, ctx): Promise<Partial<Listing>> }`
  - `interface CrawlContext { page: Page | null; fetch: typeof fetch; pause(): Promise<void>; log(msg): void; dryRun: boolean }`
  - `type Listing = Omit<ListingRow, "id"|"first_seen_at"|"last_seen_at"|"last_changed_at"|"run_id">`
  - `SCRAPERS: Partial<Record<CompetitorKey, CompetitorScraper>>`, `ACTIVE_COMPETITORS: readonly CompetitorKey[]`, `scraperFor(key)`
  - `withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T>`, `browserMode(): "remote"|"local"`, `randomPause(): Promise<void>`, `scrapeEnabled(): boolean`

- [ ] **Step 1: `types.ts`**

```ts
import type { Page } from "playwright-core";
import type { CompetitorKey, EventKind, ListingRow, Scope } from "@/types/price-light.types";

export type Listing = Omit<ListingRow, "id" | "first_seen_at" | "last_seen_at" | "last_changed_at" | "run_id">;

export interface CrawlContext {
  /** null in "fetch" and "table" modes. */
  page: Page | null;
  fetch: typeof fetch;
  /** Random 20-60s pause - call between every page. */
  pause: () => Promise<void>;
  log: (msg: string) => void;
  dryRun: boolean;
}

export interface CompetitorScraper {
  key: CompetitorKey;
  scopes: Scope[];
  kinds: EventKind[];
  /** Minimum hours between two crawls of this site. >= 24. */
  intervalHours: number;
  /** browser = Playwright page; fetch = the site serves JSON; table = no network (LiveTickets from live_events). */
  mode: "browser" | "fetch" | "table";
  crawl(ctx: CrawlContext): AsyncGenerator<Listing>;
  /** Fetch the detail page of a listing we matched: attrs + detail_text. Same session. */
  detail?(listing: Listing, ctx: CrawlContext): Promise<Partial<Listing>>;
}
```

- [ ] **Step 2: `index.ts` (registry; Tasks 5 and 6 add their imports above the `ACTIVE_COMPETITORS` line)**

```ts
import type { CompetitorKey } from "@/types/price-light.types";
import type { CompetitorScraper } from "./types";

// Phase 0: liveevents (Task 6) + livetickets (Task 5). Phase 2 adds issta, golasso, ontour.
// A competitor NOT in this map never counts toward "alone".
export const SCRAPERS: Partial<Record<CompetitorKey, CompetitorScraper>> = {};

// Keep this line LAST - it must run after every SCRAPERS.x = ... assignment.
export const ACTIVE_COMPETITORS: readonly CompetitorKey[] = Object.keys(SCRAPERS) as CompetitorKey[];

export function scraperFor(key: CompetitorKey): CompetitorScraper {
  const scraper = SCRAPERS[key];
  if (!scraper) throw new Error(`price-light: no scraper registered for ${key}`);
  return scraper;
}
export type { CompetitorScraper, CrawlContext, Listing } from "./types";
```

- [ ] **Step 3: `lib/services/browser.ts`**

```ts
// The only file that knows how a browser is obtained (spec §3.3, decision D1).
//   NEXT_SECRET_BROWSER_CDP_URL set  -> remote stealth browser over CDP (Browserbase / Bright Data)
//   otherwise                         -> local @sparticuz/chromium + optional residential proxy
// Every page is hardened the same way regardless of mode.
import type { Browser, BrowserContext, Page } from "playwright-core";

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];
const VIEWPORTS = [{ width: 1366, height: 768 }, { width: 1536, height: 864 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];

export const PAGE_TIMEOUT_MS = 45_000;
export const PAUSE_MIN_MS = 20_000;
export const PAUSE_MAX_MS = 60_000;

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export function scrapeEnabled(): boolean {
  return (process.env.PRICE_LIGHT_SCRAPE ?? "on").toLowerCase() !== "off";
}

export function browserMode(): "remote" | "local" {
  return process.env.NEXT_SECRET_BROWSER_CDP_URL ? "remote" : "local";
}

export async function randomPause(): Promise<void> {
  const ms = PAUSE_MIN_MS + Math.floor(Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS));
  await new Promise((r) => setTimeout(r, ms));
}

function parseProxy(url: string): { server: string; username?: string; password?: string } {
  const u = new URL(url);
  return { server: `${u.protocol}//${u.host}`, username: u.username || undefined, password: u.password || undefined };
}

async function launch(): Promise<{ browser: Browser; context: BrowserContext }> {
  // Lazy imports keep chromium out of every other route's bundle.
  const { chromium: playwright } = await import("playwright-core");
  const cdp = process.env.NEXT_SECRET_BROWSER_CDP_URL;
  if (cdp) {
    const browser = await playwright.connectOverCDP(cdp, { timeout: PAGE_TIMEOUT_MS });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return { browser, context };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const chromium = require("@sparticuz/chromium");
  const proxy = process.env.NEXT_SECRET_SCRAPE_PROXY_URL;
  const localChrome = process.env.NODE_ENV !== "production" ? process.env.LOCAL_CHROME_PATH : undefined;
  const browser = await playwright.launch({
    args: localChrome ? [] : chromium.args,
    executablePath: localChrome || (await chromium.executablePath()),
    headless: true,
    proxy: proxy ? parseProxy(proxy) : undefined,
  });
  const context = await browser.newContext({
    userAgent: pick(UAS),
    viewport: pick(VIEWPORTS),
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    extraHTTPHeaders: { "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8" },
  });
  return { browser, context };
}

async function harden(page: Page): Promise<void> {
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "image" || type === "media" || type === "font" || type === "stylesheet") return route.abort();
    const headers = { ...route.request().headers() };
    delete headers.referer;
    return route.continue({ headers });
  });
}

export async function withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const { browser, context } = await launch();
  const page = await context.newPage();
  try {
    await harden(page);
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
```

- [ ] **Step 4: Env vars**

Append to `.env.local` (empty values):

```env
# --- price light (רמזור) ---
ANTHROPIC_API_KEY=
PRICE_LIGHT_AI=off
PRICE_LIGHT_AI_MODEL=claude-opus-5
PRICE_LIGHT_SCRAPE=on
NEXT_SECRET_BROWSER_CDP_URL=
NEXT_SECRET_SCRAPE_PROXY_URL=
# local dev only: a real Chrome binary for Playwright instead of @sparticuz/chromium
LOCAL_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

- [ ] **Step 5: Type gate + a local launch check**

Run: `npx tsc --noEmit 2>&1 | grep -E "browser.ts|competitor-scrapers" ; echo done` → nothing.

Create throwaway `scripts/browser-smoke.ts`:
```ts
import { withBrowser } from "../lib/services/browser.ts";
console.log(await withBrowser(async (page) => { await page.goto("https://example.com"); return page.title(); }));
```
Run: `node --env-file=.env.local scripts/browser-smoke.ts` → prints `Example Domain`. Delete the script.

- [ ] **Step 6: Stop and report** (3 files + `.env.local`). Do not commit.

---

### Task 5: LiveTickets listings from the `live_events` table + `brt` check

**Files:**
- Create: `lib/services/competitor-scrapers/livetickets-api.ts`
- Modify: `lib/services/competitor-scrapers/index.ts` (register)
- Create: `scripts/livetickets-brt-check.ts`

**Interfaces:**
- Consumes: `live_events` columns `event_id,event_name,event_name_heb,show_date,city_name,street_address,currency,ticket_categories,is_active,last_synced` (see `lib/services/live-events-sync.ts:216-247`); `multiCurrencyExchangeRateService.convertToUSD(amount, "EUR"|"ILS"|"GBP")` from `@/lib/services/ticket-price-sync` (sync, in-memory rates).
- Produces: `livetickets` scraper (`mode: "table"`, `scopes: ["ticket"]`, `kinds: ["sports","music"]`, `intervalHours: 24`); `toUsd(amount, currency)`, `cheapestShelf(categories)`.

- [ ] **Step 1: The "scraper"**

```ts
// LiveTickets is our API supplier - dailyLiveEventsSync already fills live_events
// twice a day. Their shelf price is assumed to be ticket_categories[].brt (gross);
// scripts/livetickets-brt-check.ts verifies that once in phase 0.
import { supabase } from "@/lib/supabase-server";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { LIVETICKETS_RETAIL_FACTOR, LIVETICKETS_RETAIL_OFFSET_USD } from "@/lib/services/price-light";
import type { Currency } from "@/types/price-light.types";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// live_events.currency: 1=USD, 2=EUR, 3=GBP, 4=ILS (types/live-events.types.ts)
const CURRENCY_BY_CODE: Record<number, Currency> = { 1: "USD", 2: "EUR", 3: "GBP", 4: "ILS" };

interface LiveRow {
  event_id: number; event_name: string; event_name_heb: string | null; show_date: string;
  city_name: string; street_address: string | null; currency: number;
  ticket_categories: { cost: number; brt: number; title: string }[] | null; last_synced: string;
}

export function toUsd(amount: number, currency: Currency): number {
  if (currency === "USD") return amount;
  return multiCurrencyExchangeRateService.convertToUSD(amount, currency);
}

/** Cheapest shelf price per person for one live event, in the site's currency. */
export function cheapestShelf(categories: LiveRow["ticket_categories"]): number | null {
  const prices = (categories ?? []).map((c) => Number(c.brt)).filter((n) => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

export const livetickets: CompetitorScraper = {
  key: "livetickets",
  scopes: ["ticket"],
  kinds: ["sports", "music"],
  intervalHours: 24,
  mode: "table",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const { data, error } = await db
      .from("live_events")
      .select("event_id,event_name,event_name_heb,show_date,city_name,street_address,currency,ticket_categories,last_synced")
      .eq("is_active", true)
      .gte("show_date", new Date().toISOString().slice(0, 10));
    if (error) throw new Error(`live_events read failed: ${error.message}`);
    let count = 0;
    for (const row of (data ?? []) as LiveRow[]) {
      const shelf = cheapestShelf(row.ticket_categories);
      if (shelf == null) continue;
      const currency = CURRENCY_BY_CODE[row.currency] ?? "USD";
      const usd = Math.round(toUsd(shelf, currency) * LIVETICKETS_RETAIL_FACTOR + LIVETICKETS_RETAIL_OFFSET_USD);
      count += 1;
      yield {
        competitor: "livetickets",
        external_key: String(row.event_id),
        scope: "ticket",
        title: row.event_name,
        title_he: row.event_name_heb,
        event_date: row.show_date.slice(0, 10),
        city: row.city_name,
        venue: row.street_address,
        price_from: shelf,
        currency,
        price_usd: usd,
        travel_depart: null,
        travel_return: null,
        attrs: null,
        detail_text: null,
        // Display only; confirm the site's real event URL scheme during the Task 6 recon.
        url: `https://www.livetickets.co.il/event/${row.event_id}`,
      };
    }
    ctx.log(`livetickets: ${count} listings built from live_events -> 1 page`);
  },
};
```

Register in `index.ts`: `import { livetickets } from "./livetickets-api";` at the top and `SCRAPERS.livetickets = livetickets;` **above** the `ACTIVE_COMPETITORS` line.

- [ ] **Step 2: The `brt` verification script**

```ts
/**
 * One-off: is live_events.ticket_categories[].brt the shelf price customers
 * see on livetickets.co.il? Prints cost / brt for 3 upcoming events so Dor can
 * open the site and compare. Run: node --env-file=.env.local scripts/livetickets-brt-check.ts
 */
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY!);
const { data, error } = await supabase
  .from("live_events")
  .select("event_id,event_name,show_date,currency,ticket_categories")
  .eq("is_active", true)
  .gte("show_date", new Date().toISOString().slice(0, 10))
  .order("show_date")
  .limit(3);
if (error) throw error;
for (const row of data ?? []) {
  console.log(`\n#${row.event_id} ${row.event_name} ${row.show_date} currency=${row.currency}`);
  for (const c of (row.ticket_categories as { title: string; cost: number; brt: number; specialCost: number }[]) ?? []) {
    console.log(`  ${c.title.padEnd(30)} cost=${c.cost}  brt=${c.brt}  specialCost=${c.specialCost}`);
  }
}
```

Run it; paste the output in the report and ask Dor to compare against the site. If `brt` is not the shelf price, set `LIVETICKETS_RETAIL_FACTOR` / `OFFSET` in `lib/services/price-light.ts` from the observed ratio and note it in the Task 12 guide text.

- [ ] **Step 3: Type gate** → `npx tsc --noEmit 2>&1 | grep -E "livetickets|competitor-scrapers" ; echo done` → nothing.

- [ ] **Step 4: Stop and report** (3 files + the brt output). Do not commit.

---

### Task 6: LiveEvents crawler — recon, parsers, fixtures, local runner

**Files:**
- Create: `docs/superpowers/scrapers/liveevents.md`
- Create: `lib/services/competitor-scrapers/liveevents.ts`
- Create: `scripts/fixtures/liveevents/catalog.html`, `scripts/fixtures/liveevents/detail.html`
- Create: `scripts/scrape-once.ts`, `scripts/scrape-fixture.ts`
- Modify: `lib/services/competitor-scrapers/index.ts` (register), `package.json` (`linkedom`)

**Interfaces:**
- Consumes: `withBrowser`, `randomPause` (Task 4), `toUsd` (Task 5).
- Produces: `liveevents` scraper (`mode: "browser"`, `scopes: ["package"]`, `kinds: ["sports","music"]`, `intervalHours: 48`) and pure parsers `parseCatalog(html: string, baseUrl: string): Listing[]`, `parseDetail(html: string): Partial<Listing>`, `parseHeDate(text): string | null`, `parsePrice(text): number | null`.

- [ ] **Step 1: Reconnaissance (manual, 1–2 h) → `docs/superpowers/scrapers/liveevents.md`**

Open the site in a normal browser with DevTools. Record, in this exact structure (the parser's constants are copied from this doc):

```markdown
# LiveEvents crawler notes (recon 2026-09-xx)

## Catalog pages
- URL per category: <football url>, <basketball url>, <concerts url> ...
- Pagination: <query param / infinite scroll / none>
- XHR JSON? <yes: endpoint + shape | no>
- One listing = <container selector>
  - title: <selector>        title_he: <selector or same>
  - date: <selector> format <DD/MM/YYYY | ...>
  - city / venue: <selector>
  - price: <selector> text like "החל מ-₪2,990 לאדם" -> per person? <yes/no> currency <ILS>
  - link: <selector href>  external_key = <slug or id from the href>
## Detail page
- travel dates default: <selector>; can we pick dates? <yes: how | no>
- stars: <selector>, direct flight text: <"טיסה ישירה" / "קונקשן">, nights: <selector>
- bag / breakfast / transfers: <text markers>
- price for our dates: <selector> / not available
## Semantics
- price_from is per person, includes flight + hotel + ticket: <confirm>
## LiveTickets event URL scheme (for livetickets-api.ts `url`)
- <pattern>
## Stealth notes
- captcha / bot wall seen? <no/yes where>
```

Fill every `<...>`. Save one catalog page and one detail page as `scripts/fixtures/liveevents/catalog.html` / `detail.html` (Ctrl+S "Webpage, HTML only"). Strip nothing.

- [ ] **Step 2: Parsers first, from the fixtures (failing test)**

`npm i linkedom` (HTML parser without a browser; used only by the parsers).

`scripts/scrape-fixture.ts`:

```ts
/**
 * Runs a crawler's pure parsers on saved HTML - regression without network.
 * Run: node --env-file=.env.local scripts/scrape-fixture.ts liveevents
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCatalog, parseDetail } from "../lib/services/competitor-scrapers/liveevents.ts";

const site = process.argv[2];
assert.equal(site, "liveevents", "only liveevents has fixtures so far");
const catalog = readFileSync(`scripts/fixtures/${site}/catalog.html`, "utf8");
const listings = parseCatalog(catalog, "https://www.liveevents.co.il");
assert.ok(listings.length >= 5, `expected >= 5 listings, got ${listings.length}`);
for (const l of listings) {
  assert.ok(l.title, "title");
  assert.ok(l.external_key, "external_key");
  assert.match(l.event_date ?? "", /^\d{4}-\d{2}-\d{2}$/, `date ${l.event_date}`);
  assert.ok((l.price_from ?? 0) > 0, `price ${l.title}`);
  assert.equal(l.currency, "ILS");
  assert.match(l.url, /^https:\/\//);
}
const detail = parseDetail(readFileSync(`scripts/fixtures/${site}/detail.html`, "utf8"));
assert.ok(detail.attrs, "detail attrs");
assert.ok((detail.detail_text ?? "").length > 200, "detail_text");
console.log(`${site}: ${listings.length} listings parsed, detail ok`, listings[0]);
```

Run: `node --env-file=.env.local scripts/scrape-fixture.ts liveevents` → fails: module not found.

- [ ] **Step 3: `liveevents.ts`**

The `SEL` / `CATALOG_URLS` values are copied from the recon doc — the shape below is fixed, the strings are discovered. The parsers work on HTML strings (so fixtures test them); the crawler only navigates and hands HTML over.

```ts
// LiveEvents package crawler. Selectors + URLs from docs/superpowers/scrapers/liveevents.md.
// Pure parsers (parseCatalog/parseDetail) are tested on scripts/fixtures/liveevents/*.html.
import { parseHTML } from "linkedom";
import type { ExtractedAttrs } from "@/types/price-light.types";
import { toUsd } from "./livetickets-api";
import type { CompetitorScraper, CrawlContext, Listing } from "./types";

const BASE = "https://www.liveevents.co.il";
// From the recon doc "Catalog pages" - one entry per category page.
const CATALOG_URLS: { url: string; kind: "sports" | "music" }[] = [
  // { url: `${BASE}/<football path from recon>`, kind: "sports" },
  // { url: `${BASE}/<concerts path from recon>`, kind: "music" },
];
// From the recon doc - CSS selectors.
const SEL = {
  item: "<container selector>",
  title: "<title selector>",
  date: "<date selector>",
  place: "<city/venue selector>",
  price: "<price selector>",
  link: "a[href]",
  detailStars: "<stars selector>",
  detailNights: "<nights selector>",
  detailBody: "<package details container>",
};
const HE_MONTHS: Record<string, number> = { "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6, "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12 };

/** "26/10/2026" | "26.10.26" | "26 באוקטובר 2026" -> "2026-10-26" */
export function parseHeDate(text: string): string | null {
  const t = text.trim();
  const dmy = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${y}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const he = t.match(/(\d{1,2})\s+ב?([\u05d0-\u05ea]+)\s+(\d{4})/);
  if (he && HE_MONTHS[he[2]]) return `${he[3]}-${String(HE_MONTHS[he[2]]).padStart(2, "0")}-${he[1].padStart(2, "0")}`;
  return null;
}

/** "החל מ-₪2,990 לאדם" -> 2990 */
export function parsePrice(text: string): number | null {
  const m = text.replace(/[,\s]/g, "").match(/(\d{3,6})/);
  return m ? Number(m[1]) : null;
}

function doc(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

export function parseCatalog(html: string, baseUrl: string): Listing[] {
  const d = doc(html);
  const out: Listing[] = [];
  for (const el of Array.from(d.querySelectorAll(SEL.item))) {
    const title = el.querySelector(SEL.title)?.textContent?.trim() ?? "";
    const href = el.querySelector(SEL.link)?.getAttribute("href") ?? "";
    if (!title || !href) continue;
    const url = href.startsWith("http") ? href : `${baseUrl}${href}`;
    const price = parsePrice(el.querySelector(SEL.price)?.textContent ?? "");
    out.push({
      competitor: "liveevents",
      external_key: url.replace(baseUrl, "").replace(/[?#].*$/, ""),
      scope: "package",
      title,
      title_he: title,
      event_date: parseHeDate(el.querySelector(SEL.date)?.textContent ?? ""),
      city: el.querySelector(SEL.place)?.textContent?.trim() ?? null,
      venue: null,
      price_from: price,
      currency: "ILS",
      price_usd: price == null ? null : Math.round(toUsd(price, "ILS")),
      travel_depart: null,
      travel_return: null,
      attrs: null,
      detail_text: null,
      url,
    });
  }
  return out;
}

export function parseDetail(html: string): Partial<Listing> {
  const d = doc(html);
  const body = d.querySelector(SEL.detailBody)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const stars = (d.querySelector(SEL.detailStars)?.textContent ?? "").match(/(\d)/)?.[1];
  const nights = (d.querySelector(SEL.detailNights)?.textContent ?? "").match(/(\d{1,2})/)?.[1];
  const attrs: Partial<ExtractedAttrs> = {
    hotel_stars: stars ? Number(stars) : "unknown",
    nights: nights ? Number(nights) : "unknown",
    direct_flight: /טיסה ישירה|ישירות/.test(body) ? true : /קונקשן|עצירה|חניית ביניים/.test(body) ? false : "unknown",
    bag_included: /מזוודה|כבודה/.test(body) ? !/ללא מזוודה|לא כולל מזוודה/.test(body) : "unknown",
    breakfast: /ארוחת בוקר/.test(body) ? !/ללא ארוחת בוקר|לא כולל ארוחת בוקר/.test(body) : "unknown",
    transfers: /העברות|הסעות/.test(body) ? !/ללא העברות|לא כולל העברות/.test(body) : "unknown",
  };
  return { attrs, detail_text: body.slice(0, 6000) };
}

export const liveevents: CompetitorScraper = {
  key: "liveevents",
  scopes: ["package"],
  kinds: ["sports", "music"],
  intervalHours: 48,
  mode: "browser",
  async *crawl(ctx: CrawlContext): AsyncGenerator<Listing> {
    const page = ctx.page;
    if (!page) throw new Error("liveevents needs a browser page");
    for (const { url } of CATALOG_URLS) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(SEL.item, { timeout: 15_000 }).catch(() => undefined);
      const listings = parseCatalog(await page.content(), BASE);
      ctx.log(`liveevents: ${url} -> ${listings.length} listings`);
      if (listings.length === 0) ctx.log(`liveevents: ZERO listings on ${url} - selectors may have changed`);
      for (const l of listings) yield l;
      await ctx.pause();
    }
  },
  async detail(listing: Listing, ctx: CrawlContext): Promise<Partial<Listing>> {
    const page = ctx.page;
    if (!page) throw new Error("liveevents needs a browser page");
    await page.goto(listing.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(SEL.detailBody, { timeout: 15_000 }).catch(() => undefined);
    return parseDetail(await page.content());
  },
};
```

Register in `index.ts`: `import { liveevents } from "./liveevents";` and `SCRAPERS.liveevents = liveevents;` above the `ACTIVE_COMPETITORS` line. If the recon showed an XHR JSON endpoint, set `mode: "fetch"` and replace `page.goto` + `parseCatalog` with `ctx.fetch(endpoint)` + a `parseCatalogJson()` that maps the JSON fields to the same `Listing` shape — keep `parseCatalog` for the fixture test regardless.

- [ ] **Step 4: Run the fixture test until green**

Run: `node --env-file=.env.local scripts/scrape-fixture.ts liveevents`
Expected: `liveevents: N listings parsed, detail ok` + the first listing printed with a real title, date, price.

- [ ] **Step 5: `scripts/scrape-once.ts` — one live session, locally**

```ts
/**
 * One real crawl session, no DB writes. Prints listings as JSON to stdout, logs to stderr.
 * Run: node --env-file=.env.local scripts/scrape-once.ts liveevents [--detail <external_key>]
 */
import { withBrowser, randomPause } from "../lib/services/browser.ts";
import { scraperFor } from "../lib/services/competitor-scrapers/index.ts";
import type { CrawlContext, Listing } from "../lib/services/competitor-scrapers/types.ts";
import type { CompetitorKey } from "../types/price-light.types.ts";

const key = process.argv[2] as CompetitorKey;
const detailKey = process.argv.includes("--detail") ? process.argv[process.argv.indexOf("--detail") + 1] : null;
const scraper = scraperFor(key);

const run = async (page: CrawlContext["page"]) => {
  const ctx: CrawlContext = { page, fetch, pause: randomPause, log: (m) => console.error(m), dryRun: true };
  const listings: Listing[] = [];
  for await (const l of scraper.crawl(ctx)) listings.push(l);
  console.log(JSON.stringify(listings, null, 2));
  if (detailKey && scraper.detail) {
    const target = listings.find((l) => l.external_key === detailKey);
    if (target) console.log(JSON.stringify(await scraper.detail(target, ctx), null, 2));
  }
  return listings.length;
};
const count = scraper.mode === "browser" ? await withBrowser(run) : await run(null);
console.error(`${key}: ${count} listings`);
```

Run: `node --env-file=.env.local scripts/scrape-once.ts liveevents` (local Chrome via `LOCAL_CHROME_PATH`).
Expected: the full catalog as JSON, count roughly equal to what you see on the site. Then `--detail <one external_key>` → `attrs` with real stars/nights.

- [ ] **Step 6: Type gate** → `npx tsc --noEmit 2>&1 | grep -E "liveevents|scrape" ; echo done` → nothing.

- [ ] **Step 7: Stop and report** — recon doc, crawler, fixtures, 2 scripts, `package.json` (`linkedom`). Do not commit.

---

### Task 7: `runCrawl` — runs, upserts, lock, circuit breaker, −50% alarm

**Files:**
- Create: `lib/services/price-light-crawl.ts`

**Interfaces:**
- Consumes: registry + `withBrowser`/`randomPause`/`scrapeEnabled`/`browserMode` (Task 4), `sendMail`/`appOrigin` from `@/lib/email`, `multiCurrencyExchangeRateService`.
- Produces:
  - `runCrawl(competitor, trigger, opts?: { dryRun?: boolean; budgetMs?: number }): Promise<CrawlSummary>`
  - `pickDueCompetitor(now?: Date): Promise<CompetitorKey | null>`
  - `isCrawlLocked(): Promise<boolean>`, `circuitOpen(competitor): Promise<boolean>`
  - `interface CrawlSummary { competitor; status: CrawlStatus; pages; listings; prevListings: number | null; changed; detailPages; ms; note: string | null; runId: number | null }`

- [ ] **Step 1: Write it**

```ts
// One crawl of one competitor site (spec §3.2 / §3.4). Writes competitor_crawl_runs
// + competitor_listings. Never throws past its own summary.
// Lock = a competitor_crawl_runs row in status "running" younger than LOCK_STALE_MS.
import { supabase } from "@/lib/supabase-server";
import { appOrigin, sendMail } from "@/lib/email";
import { multiCurrencyExchangeRateService } from "@/lib/services/ticket-price-sync";
import { browserMode, randomPause, scrapeEnabled, withBrowser } from "@/lib/services/browser";
import { ACTIVE_COMPETITORS, scraperFor, type CrawlContext, type Listing } from "@/lib/services/competitor-scrapers";
import type { CompetitorKey, CrawlStatus, CrawlTrigger } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const CRAWL_BUDGET_MS = 240_000;
export const LOCK_STALE_MS = 6 * 60_000;      // a "running" row older than this is a crashed run, not a lock
export const DROP_ALARM_RATIO = 0.5;          // listings < 50% of last ok run -> partial + email
export const CIRCUIT_AFTER_FAILURES = 3;      // consecutive blocked|error -> skip until a manual crawl

export interface CrawlSummary {
  competitor: CompetitorKey; status: CrawlStatus; pages: number; listings: number;
  prevListings: number | null; changed: number; detailPages: number; ms: number; note: string | null; runId: number | null;
}

interface RunRowLite { id: number; status: CrawlStatus; started_at: string; listings: number }

async function recentRuns(competitor: CompetitorKey, limit: number): Promise<RunRowLite[]> {
  const { data, error } = await db.from("competitor_crawl_runs")
    .select("id,status,started_at,listings").eq("competitor", competitor)
    .order("started_at", { ascending: false }).limit(limit);
  if (error) { console.error("price-light-crawl: runs load failed", JSON.stringify(error)); return []; }
  return (data ?? []) as RunRowLite[];
}

/** Another crawl (any competitor) is running and started less than LOCK_STALE_MS ago. */
export async function isCrawlLocked(): Promise<boolean> {
  const { data, error } = await db.from("competitor_crawl_runs").select("id,started_at")
    .eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error("price-light-crawl: lock check failed", JSON.stringify(error)); return true; }
  return !!data && Date.now() - Date.parse(data.started_at) < LOCK_STALE_MS;
}

/** Circuit: the last N real runs all blocked|error. */
export async function circuitOpen(competitor: CompetitorKey): Promise<boolean> {
  const runs = (await recentRuns(competitor, CIRCUIT_AFTER_FAILURES + 2))
    .filter((r) => r.status !== "skipped" && r.status !== "running").slice(0, CIRCUIT_AFTER_FAILURES);
  return runs.length >= CIRCUIT_AFTER_FAILURES && runs.every((r) => r.status === "blocked" || r.status === "error");
}

/** The competitor most overdue past its interval; null when none is due. */
export async function pickDueCompetitor(now: Date = new Date()): Promise<CompetitorKey | null> {
  let best: { key: CompetitorKey; overdueMs: number } | null = null;
  for (const key of ACTIVE_COMPETITORS) {
    const scraper = scraperFor(key);
    if (scraper.mode === "table") continue;                       // refreshed by the nightly, not the tick
    const runs = await recentRuns(key, 10);
    const lastGood = runs.find((r) => r.status === "ok" || r.status === "partial");
    const lastAny = runs.find((r) => r.status !== "running" && r.status !== "skipped");
    // A blocked site waits a full interval from the block, not from the last good run.
    const since = lastAny?.status === "blocked" ? lastAny : lastGood;
    const ageMs = since ? now.getTime() - Date.parse(since.started_at) : Number.POSITIVE_INFINITY;
    const overdueMs = ageMs - scraper.intervalHours * 3_600_000;
    if (overdueMs < 0) continue;
    if (await circuitOpen(key)) continue;
    if (!best || overdueMs > best.overdueMs) best = { key, overdueMs };
  }
  return best?.key ?? null;
}

function listingChanged(prev: { price_from: number | null; event_date: string | null; attrs: unknown } | null, next: Listing): boolean {
  if (!prev) return true;
  return Number(prev.price_from) !== Number(next.price_from) || prev.event_date !== next.event_date ||
    (next.attrs != null && JSON.stringify(prev.attrs ?? null) !== JSON.stringify(next.attrs));
}

async function upsertListing(l: Listing, runId: number | null, nowIso: string): Promise<{ id: number; changed: boolean }> {
  const { data: prev } = await db.from("competitor_listings").select("id,price_from,event_date,attrs")
    .eq("competitor", l.competitor).eq("external_key", l.external_key).maybeSingle();
  const changed = listingChanged(prev ?? null, l);
  const row: Record<string, unknown> = {
    competitor: l.competitor, external_key: l.external_key, scope: l.scope, title: l.title, title_he: l.title_he,
    event_date: l.event_date, city: l.city, venue: l.venue, price_from: l.price_from, currency: l.currency,
    price_usd: l.price_usd, travel_depart: l.travel_depart, travel_return: l.travel_return,
    attrs: l.attrs ?? prev?.attrs ?? null, url: l.url, last_seen_at: nowIso, run_id: runId,
  };
  if (l.detail_text) row.detail_text = l.detail_text;
  if (changed) row.last_changed_at = nowIso;
  const { data, error } = await db.from("competitor_listings")
    .upsert(row, { onConflict: "competitor,external_key" }).select("id").single();
  if (error) throw new Error(`listing upsert ${l.external_key}: ${error.message}`);
  return { id: data.id, changed };
}

/** Listings already matched, or on a date (±1 day) one of our live events has - the only ones worth a detail page. */
async function listingIdsWorthDetail(competitor: CompetitorKey, ids: number[]): Promise<Set<number>> {
  const { data: matched } = await db.from("competitor_matches").select("listing_id")
    .eq("competitor", competitor).eq("status", "found").in("listing_id", ids);
  const want = new Set<number>((matched ?? []).map((m: { listing_id: number }) => m.listing_id));
  const { data: dates } = await db.from("events").select("date").is("is_deleted", null).gte("date", new Date().toISOString().slice(0, 10));
  const ourDays = new Set<string>((dates ?? []).map((e: { date: string }) => e.date.slice(0, 10)));
  const { data: rows } = await db.from("competitor_listings").select("id,event_date,detail_text").in("id", ids);
  for (const r of (rows ?? []) as { id: number; event_date: string | null; detail_text: string | null }[]) {
    if (!r.event_date || r.detail_text) continue;
    const d = new Date(`${r.event_date}T00:00:00.000Z`);
    for (const delta of [-1, 0, 1]) {
      const x = new Date(d); x.setUTCDate(x.getUTCDate() + delta);
      if (ourDays.has(x.toISOString().slice(0, 10))) { want.add(r.id); break; }
    }
  }
  return want;
}

export async function runCrawl(
  competitor: CompetitorKey,
  trigger: CrawlTrigger,
  opts: { dryRun?: boolean; budgetMs?: number } = {},
): Promise<CrawlSummary> {
  const start = Date.now();
  const dryRun = !!opts.dryRun;
  const budget = opts.budgetMs ?? CRAWL_BUDGET_MS;
  const scraper = scraperFor(competitor);
  const mode = scraper.mode === "browser" ? browserMode() : scraper.mode;
  const summary: CrawlSummary = { competitor, status: "running", pages: 0, listings: 0, prevListings: null, changed: 0, detailPages: 0, ms: 0, note: null, runId: null };

  if (!scrapeEnabled() && scraper.mode !== "table") {
    summary.status = "skipped"; summary.note = "PRICE_LIGHT_SCRAPE=off";
    if (!dryRun) await insertRun(summary, trigger, mode);
    return finish(summary, start);
  }
  if (scraper.mode !== "table" && (await isCrawlLocked())) {
    summary.status = "skipped"; summary.note = "another crawl is running";
    return finish(summary, start);
  }

  const prev = (await recentRuns(competitor, 10)).find((r) => r.status === "ok" || r.status === "partial");
  summary.prevListings = prev?.listings ?? null;
  if (!dryRun) summary.runId = await insertRun(summary, trigger, mode);
  await multiCurrencyExchangeRateService.updateAllExchangeRates().catch((e) => console.error("price-light-crawl: rates refresh failed", e));

  const nowIso = new Date().toISOString();
  const ids: number[] = [];
  const ctx = (page: CrawlContext["page"]): CrawlContext => ({
    page, fetch, pause: scraper.mode === "table" ? async () => undefined : randomPause,
    log: (m) => { if (m.includes("->")) summary.pages += 1; console.log(`[price-light-crawl:${competitor}] ${m}`); }, dryRun,
  });

  const work = async (page: CrawlContext["page"]) => {
    const c = ctx(page);
    for await (const listing of scraper.crawl(c)) {
      if (Date.now() - start > budget) { summary.note = "budget exhausted during catalog"; summary.status = "partial"; break; }
      summary.listings += 1;
      if (dryRun) continue;
      const { id, changed } = await upsertListing(listing, summary.runId, nowIso);
      ids.push(id);
      if (changed) summary.changed += 1;
    }
    if (dryRun || !scraper.detail || ids.length === 0) return;
    const want = await listingIdsWorthDetail(competitor, ids);
    const { data: rows } = await db.from("competitor_listings").select("*").in("id", [...want]);
    for (const row of (rows ?? []) as (Listing & { id: number })[]) {
      if (Date.now() - start > budget) { summary.note = "budget exhausted during details"; summary.status = "partial"; break; }
      await c.pause();
      try {
        const extra = await scraper.detail(row, c);
        summary.detailPages += 1;
        const priceMoved = extra.price_from != null && Number(extra.price_from) !== Number(row.price_from);
        const { error } = await db.from("competitor_listings").update({
          attrs: extra.attrs ?? row.attrs, detail_text: extra.detail_text ?? row.detail_text,
          travel_depart: extra.travel_depart ?? row.travel_depart, travel_return: extra.travel_return ?? row.travel_return,
          price_from: extra.price_from ?? row.price_from, price_usd: extra.price_usd ?? row.price_usd,
          ...(priceMoved ? { last_changed_at: nowIso } : {}),
        }).eq("id", row.id);
        if (error) console.error("price-light-crawl: detail write failed", JSON.stringify(error));
      } catch (e) {
        console.error(`price-light-crawl: detail ${row.url} failed`, e instanceof Error ? e.message : e);
      }
    }
  };

  try {
    if (scraper.mode === "browser") await withBrowser(work); else await work(null);
    if (summary.status === "running") summary.status = "ok";
    if (summary.prevListings != null && summary.listings < summary.prevListings * DROP_ALARM_RATIO) {
      summary.status = "partial";
      summary.note = `listings dropped ${summary.prevListings} -> ${summary.listings} - site structure may have changed`;
      await alert(competitor, summary.note);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    summary.status = /403|captcha|blocked|access denied|429/i.test(msg) ? "blocked" : "error";
    summary.note = msg.slice(0, 500);
    console.error(`price-light-crawl: ${competitor} ${summary.status}`, msg);
    if (summary.status === "blocked" || (await circuitOpen(competitor))) await alert(competitor, `${summary.status}: ${summary.note}`);
  }
  if (!dryRun && summary.runId) await finishRun(summary);
  return finish(summary, start);
}

function finish(s: CrawlSummary, start: number): CrawlSummary { s.ms = Date.now() - start; return s; }

async function insertRun(s: CrawlSummary, trigger: CrawlTrigger, mode: string): Promise<number | null> {
  const { data, error } = await db.from("competitor_crawl_runs").insert({
    competitor: s.competitor, status: s.status, trigger, prev_listings: s.prevListings, note: s.note, browser_mode: mode,
    ...(s.status !== "running" ? { finished_at: new Date().toISOString() } : {}),
  }).select("id").single();
  if (error) { console.error("price-light-crawl: run insert failed", JSON.stringify(error)); return null; }
  return data.id as number;
}

async function finishRun(s: CrawlSummary): Promise<void> {
  const { error } = await db.from("competitor_crawl_runs").update({
    status: s.status, finished_at: new Date().toISOString(), pages: s.pages + s.detailPages, listings: s.listings, note: s.note,
  }).eq("id", s.runId);
  if (error) console.error("price-light-crawl: run finish failed", JSON.stringify(error));
}

async function alert(competitor: CompetitorKey, note: string): Promise<void> {
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (!to) return;
  try {
    await sendMail({ to, subject: `Price light: ${competitor} crawl needs attention`, html: `<p>${note}</p><p><a href="${appOrigin()}/events">Backoffice</a></p>` });
  } catch (e) { console.error("price-light-crawl: alert mail failed", e); }
}
```

- [ ] **Step 2: Type gate** → `npx tsc --noEmit 2>&1 | grep price-light-crawl ; echo done` → nothing.

- [ ] **Step 3: Dry-run the table source and the real site**

Throwaway `scripts/crawl-smoke.ts`:
```ts
import { runCrawl } from "../lib/services/price-light-crawl.ts";
console.log(await runCrawl(process.argv[2] as never, "dry_run", { dryRun: true }));
```
Run for `livetickets` (expect `status: "ok"`, `listings` = number of active future live events) and `liveevents` (expect `status: "ok"`, `listings` ≈ the catalog). Delete the script.

- [ ] **Step 4: Stop and report** (1 file). Do not commit.

---

### Task 8: `matchEvent` — rule-based matching into `competitor_matches`

**Files:**
- Create: `lib/services/price-light-match.ts`

**Interfaces:**
- Consumes: engine (`pickRuleMatch`, `normalize`, `ourPackageUsd`, `ourTicketUsd`, `ourNights`, `kindOf`, `competitorsFor`, `DATE_TOLERANCE_DAYS`, `MatchCandidate`), store (`loadEventForLight`, `recomputeEventLights`, `LightEvent`), registry.
- Produces:
  - `interface MatchOutcome { competitor; scope; status: MatchStatus; wrote: boolean; listingId: number | null; note: string | null }`
  - `type Judge` — the phase-1 AI hook; `null` = rule-only
  - `matchEvent(event: LightEvent, competitor, scope, trigger, opts?: { dryRun?; judge? }): Promise<MatchOutcome>`
  - `matchAllForEvent(eventId, trigger, opts?): Promise<{ outcomes: MatchOutcome[]; lights: Awaited<ReturnType<typeof recomputeEventLights>> } | null>`

- [ ] **Step 1: Write it**

```ts
// Pair one of our events with a competitor's stored listing (spec §4). Rule only
// in phase 0; `judge` is the phase-1 AI hook. Writes a competitor_matches row
// only when the verdict differs from the latest row.
import { supabase } from "@/lib/supabase-server";
import {
  DATE_TOLERANCE_DAYS, competitorsFor, kindOf, normalize, ourNights, ourPackageUsd, ourTicketUsd, pickRuleMatch,
  type MatchCandidate,
} from "@/lib/services/price-light";
import { ACTIVE_COMPETITORS, scraperFor } from "@/lib/services/competitor-scrapers";
import { loadEventForLight, recomputeEventLights, type LightEvent } from "@/lib/services/price-light-store";
import type { CompetitorKey, ExtractedAttrs, ListingRow, MatchMethod, MatchStatus, MatchTrigger, Scope } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface MatchOutcome { competitor: CompetitorKey; scope: Scope; status: MatchStatus; wrote: boolean; listingId: number | null; note: string | null }

/** Phase 1 plugs Claude in here. null = rule-only. */
export type Judge = (input: { event: LightEvent; candidates: ListingRow[] }) =>
  Promise<{ status: "found" | "not_selling" | "unsure"; listing: ListingRow | null; attrs: Partial<ExtractedAttrs> | null; verdict: Record<string, unknown> } | null>;

const STALE_LISTING_MS = 14 * 86_400_000;

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10);
}

async function candidatesFor(event: LightEvent, competitor: CompetitorKey, scope: Scope): Promise<ListingRow[]> {
  const day = event.date.slice(0, 10);
  const { data, error } = await db.from("competitor_listings")
    .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
    .eq("competitor", competitor).eq("scope", scope)
    .gte("event_date", shiftDay(day, -DATE_TOLERANCE_DAYS)).lte("event_date", shiftDay(day, DATE_TOLERANCE_DAYS))
    .gte("last_seen_at", new Date(Date.now() - STALE_LISTING_MS).toISOString());
  if (error) { console.error("price-light-match: candidates failed", JSON.stringify(error)); return []; }
  return (data ?? []) as ListingRow[];
}

async function hadGoodCrawl(competitor: CompetitorKey): Promise<boolean> {
  const { data } = await db.from("competitor_crawl_runs").select("id").eq("competitor", competitor)
    .in("status", ["ok", "partial"]).gte("started_at", new Date(Date.now() - STALE_LISTING_MS).toISOString()).limit(1);
  return (data ?? []).length > 0;
}

interface PrevRow { status: MatchStatus; listing_id: number | null; normalized_usd: number | null; our_usd: number | null; listing_changed_at: string | null }

async function latestRow(eventId: number, competitor: CompetitorKey, scope: Scope): Promise<PrevRow | null> {
  const { data } = await db.from("competitor_matches")
    .select("status,listing_id,normalized_usd,our_usd,listing_changed_at")
    .eq("event_id", eventId).eq("competitor", competitor).eq("scope", scope)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as PrevRow | null) ?? null;
}

export async function matchEvent(
  event: LightEvent,
  competitor: CompetitorKey,
  scope: Scope,
  trigger: MatchTrigger,
  opts: { dryRun?: boolean; judge?: Judge | null } = {},
): Promise<MatchOutcome> {
  const out: MatchOutcome = { competitor, scope, status: "skipped", wrote: false, listingId: null, note: null };
  const ourUsd = scope === "package" ? ourPackageUsd(event) : ourTicketUsd(event);
  const prev = await latestRow(event.id, competitor, scope);

  const write = async (row: Record<string, unknown>) => {
    if (opts.dryRun) { out.wrote = true; return; }
    const { error } = await db.from("competitor_matches").insert({ event_id: event.id, competitor, scope, ...row });
    if (error) console.error(`price-light-match: insert failed (${trigger})`, JSON.stringify(error)); else out.wrote = true;
  };

  if (ourUsd == null) {
    out.status = "na";
    if (prev?.status !== "na") await write({ status: "na", method: "rule", note: scope === "package" ? "skip_flight or no ticket" : "no ticket_only_markup" });
    return out;
  }

  const candidates = await candidatesFor(event, competitor, scope);
  let picked: ListingRow | null = null;
  let attrs: Partial<ExtractedAttrs> | null = null;
  let verdict: Record<string, unknown> | null = null;
  let method: MatchMethod = "rule";
  let status: MatchStatus;

  const rule = pickRuleMatch(
    { names: [event.name, event.name_english ?? ""].filter(Boolean), date: event.date.slice(0, 10) },
    candidates.map<MatchCandidate>((c) => ({ id: c.id, title: c.title, title_he: c.title_he, event_date: c.event_date })),
  );
  if (rule) {
    picked = candidates.find((c) => c.id === rule.candidate.id) ?? null;
    status = "found";
  } else if (candidates.length > 0 && opts.judge) {
    const j = await opts.judge({ event, candidates });
    if (j) { status = j.status; picked = j.listing; attrs = j.attrs; verdict = j.verdict; method = "ai"; }
    else status = "unsure";
  } else if (candidates.length > 0) {
    status = "unsure";                                          // ambiguous, no judge yet (phase 1)
  } else {
    status = (await hadGoodCrawl(competitor)) ? "not_selling" : "skipped";
  }

  out.status = status; out.listingId = picked?.id ?? null;

  if (status === "found" && picked) {
    const priceUsd = Number(picked.price_usd ?? 0);
    const merged = { ...(attrs ?? {}), ...(picked.attrs ?? {}) };          // page attrs win over AI attrs
    const norm = scope === "package"
      ? normalize(priceUsd, merged, { nights: ourNights(event) })
      : { normalizedUsd: Math.round(priceUsd), adjustments: [], partial: false };
    const unchanged = prev?.status === "found" && prev.listing_id === picked.id &&
      prev.listing_changed_at === picked.last_changed_at &&
      Number(prev.normalized_usd) === norm.normalizedUsd && Number(prev.our_usd) === ourUsd;
    if (!unchanged) {
      await write({
        status, method, listing_id: picked.id, ai_verdict: verdict, raw_price: picked.price_from, raw_currency: picked.currency,
        price_usd: priceUsd, normalized_usd: norm.normalizedUsd, adjustments: norm.adjustments, attrs: merged,
        our_usd: ourUsd, diff_usd: ourUsd - norm.normalizedUsd, listing_changed_at: picked.last_changed_at,
        note: norm.partial ? "partial normalization" : null,
      });
    }
    return out;
  }
  if (status !== "skipped" && prev?.status !== status) {
    await write({ status, method, ai_verdict: verdict, our_usd: ourUsd, note: status === "unsure" ? `${candidates.length} candidates, no rule match` : null });
  }
  return out;
}

export async function matchAllForEvent(eventId: number, trigger: MatchTrigger, opts: { dryRun?: boolean; judge?: Judge | null } = {}) {
  const event = await loadEventForLight(eventId);
  if (!event || event.is_deleted) return null;
  const outcomes: MatchOutcome[] = [];
  for (const scope of ["package", "ticket"] as const) {
    for (const competitor of competitorsFor(kindOf(event), scope, ACTIVE_COMPETITORS)) {
      if (!scraperFor(competitor).scopes.includes(scope)) continue;
      outcomes.push(await matchEvent(event, competitor, scope, trigger, opts));
    }
  }
  const lights = await recomputeEventLights(eventId, trigger, { dryRun: opts.dryRun });
  return { outcomes, lights };
}
```

- [ ] **Step 2: Type gate** → `npx tsc --noEmit 2>&1 | grep price-light-match ; echo done` → nothing.

- [ ] **Step 3: Dry-run one event end-to-end**

Throwaway `scripts/match-smoke.ts`:
```ts
import { matchAllForEvent } from "../lib/services/price-light-match.ts";
console.log(JSON.stringify(await matchAllForEvent(Number(process.argv[2]), "manual", { dryRun: true }), null, 2));
```
First run a non-dry `livetickets` crawl locally so listings exist (`runCrawl("livetickets","manual")` — table read only, safe), then pick a `*_live_event_dynamic` event → expect the `livetickets/ticket` outcome `found` with a sensible `diff_usd`. Delete the script.

- [ ] **Step 4: Stop and report** (1 file). Do not commit.

---

### Task 9: Crons — hourly crawl tick, nightly snapshot/tag/match, admin crawl-now

**Files:**
- Create: `lib/services/price-light-nightly.ts`
- Create: `app/api/cron/price-light-crawl/route.ts`
- Create: `app/api/cron/price-light-nightly/route.ts`
- Create: `app/api/price-light/crawl/route.ts`
- Modify: `vercel.json` (2 cron entries + 3 function configs)

**Interfaces:**
- Consumes: `pickDueCompetitor`, `runCrawl` (Task 7); `matchAllForEvent` (Task 8); `writeSnapshotAndTag`, `LIGHT_EVENT_COLUMNS`, `LightEvent` (Task 3); `guardCronRoute`, `guardAdminRoute`; `sendMail`/`appOrigin`; main's revalidate endpoint exactly as `app/api/revalidate/route.ts` already calls it.
- Produces: `runPriceLightNightly({ dryRun, budgetMs }): Promise<NightlySummary>`.

- [ ] **Step 1: Nightly service**

```ts
// Spec §6.2: snapshot + price-drop tag + match everything + lights, budgeted.
// Least-recently-computed events first so nothing is stranded.
import { supabase } from "@/lib/supabase-server";
import { appOrigin, sendMail } from "@/lib/email";
import { LIGHT_EVENT_COLUMNS, writeSnapshotAndTag, type LightEvent } from "@/lib/services/price-light-store";
import { matchAllForEvent } from "@/lib/services/price-light-match";
import { runCrawl } from "@/lib/services/price-light-crawl";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface NightlySummary {
  scanned: number; snapshots: number; tagged: number; cleared: number; matchesWritten: number;
  lightChanges: { eventId: number; name: string; from: string | null; to: string | null }[];
  errors: { eventId: number; note: string }[]; remaining: number; dryRun: boolean;
}

function isoDaysFromNow(days: number): string { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export async function runPriceLightNightly(options: { dryRun: boolean; budgetMs: number }): Promise<NightlySummary> {
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const summary: NightlySummary = { scanned: 0, snapshots: 0, tagged: 0, cleared: 0, matchesWritten: 0, lightChanges: [], errors: [], remaining: 0, dryRun: options.dryRun };

  // LiveTickets listings are a table read - refresh them every night before matching.
  await runCrawl("livetickets", options.dryRun ? "dry_run" : "schedule", { dryRun: options.dryRun });

  const { data, error } = await db.from("events").select(LIGHT_EVENT_COLUMNS)
    .is("is_deleted", null).gte("date", isoDaysFromNow(2))
    .order("light_checked_at", { ascending: true, nullsFirst: true }).order("date");
  if (error) { console.error("price-light-nightly: events load failed", JSON.stringify(error)); return summary; }
  const events = ((data ?? []) as LightEvent[]).filter((e) => !e.is_test);

  for (const [index, event] of events.entries()) {
    if (Date.now() - start > options.budgetMs) { summary.remaining = events.length - index; break; }
    summary.scanned += 1;
    try {
      const snap = await writeSnapshotAndTag(event, today, { dryRun: options.dryRun });
      summary.snapshots += 1; if (snap.tagged) summary.tagged += 1; if (snap.cleared) summary.cleared += 1;
      const result = await matchAllForEvent(event.id, "nightly", { dryRun: options.dryRun });
      if (!result) continue;
      summary.matchesWritten += result.outcomes.filter((o) => o.wrote).length;
      if (result.lights.changed) summary.lightChanges.push({ eventId: event.id, name: event.name, from: result.lights.before.package, to: result.lights.after.package });
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      console.error(`price-light-nightly: event ${event.id} failed`, note);
      summary.errors.push({ eventId: event.id, note });
    }
  }

  if (!options.dryRun) {
    if (summary.lightChanges.length || summary.tagged || summary.cleared) await revalidateMain();
    await sendSummaryEmail(summary);
  }
  return summary;
}

async function revalidateMain(): Promise<void> {
  // Mirror the exact request app/api/revalidate/route.ts makes to main (read that file; copy its URL + params).
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL; const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!base || !secret) return;
  try { await fetch(`${base}/api/revalidate?secret=${encodeURIComponent(secret)}`, { method: "GET" }); }
  catch (e) { console.error("price-light-nightly: revalidate failed", e); }
}

async function sendSummaryEmail(s: NightlySummary): Promise<void> {
  const redMoves = s.lightChanges.filter((c) => c.from === "red" || c.to === "red");
  if (!s.tagged && !s.cleared && redMoves.length === 0 && s.errors.length === 0) return;
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL; if (!to) return;
  try {
    await sendMail({ to, subject: `Price light: ${redMoves.length} red changes · ${s.tagged} new price-drop tags · ${s.errors.length} errors`,
      html: [`<p><a href="${appOrigin()}/events">Events</a> · scanned ${s.scanned} · ${s.remaining} left for tomorrow</p>`,
        redMoves.length ? `<ul>${redMoves.map((c) => `<li>#${c.eventId} ${c.name}: ${c.from ?? "—"} → ${c.to ?? "—"}</li>`).join("")}</ul>` : "",
        s.errors.length ? `<p><b>Errors</b></p><ul>${s.errors.map((e) => `<li>#${e.eventId}: ${e.note}</li>`).join("")}</ul>` : ""].join("") });
  } catch (e) { console.error("price-light-nightly: mail failed", e); }
}
```

Open `app/api/revalidate/route.ts` and make `revalidateMain` send the same request it does (URL, query names, method).

- [ ] **Step 2: Cron routes**

`app/api/cron/price-light-crawl/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { pickDueCompetitor, runCrawl } from "@/lib/services/price-light-crawl";
import { COMPETITORS, type CompetitorKey } from "@/types/price-light.types";

// Hourly tick (vercel.json "7 * * * *"): crawls at most ONE competitor whose
// interval elapsed. Most ticks do nothing. ?competitor=<key> forces one site,
// ?dry_run=1 crawls without writing.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  try {
    const forced = url.searchParams.get("competitor");
    if (forced && !COMPETITORS.includes(forced as CompetitorKey)) return NextResponse.json({ error: "unknown competitor" }, { status: 400 });
    const competitor = (forced as CompetitorKey | null) ?? (await pickDueCompetitor());
    if (!competitor) return NextResponse.json({ skipped: true, reason: "nothing due" });
    const summary = await runCrawl(competitor, dryRun ? "dry_run" : "schedule", { dryRun });
    console.log(`[price-light-crawl] ${competitor} ${summary.status} listings=${summary.listings} pages=${summary.pages + summary.detailPages} ms=${summary.ms}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-crawl] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "crawl failed" }, { status: 500 });
  }
}
```

`app/api/cron/price-light-nightly/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runPriceLightNightly } from "@/lib/services/price-light-nightly";

// 00:15 UTC nightly (vercel.json), before base-price-sync at 01:30. ?dry_run=1 = zero writes.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runPriceLightNightly({ dryRun, budgetMs: 270_000 });
    console.log(`[price-light-nightly] scanned=${summary.scanned} tagged=${summary.tagged} lightChanges=${summary.lightChanges.length} errors=${summary.errors.length} remaining=${summary.remaining}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[price-light-nightly] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "nightly failed" }, { status: 500 });
  }
}
```

`app/api/price-light/crawl/route.ts` (admin "crawl now"):
```ts
import { NextRequest, NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { runCrawl } from "@/lib/services/price-light-crawl";
import { COMPETITORS, type CompetitorKey } from "@/types/price-light.types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const competitor = body?.competitor as CompetitorKey | undefined;
  if (!competitor || !COMPETITORS.includes(competitor)) return NextResponse.json({ error: "competitor required" }, { status: 400 });
  try {
    return NextResponse.json(await runCrawl(competitor, "manual", { dryRun: body?.dryRun === true }));
  } catch (error) {
    console.error("[price-light/crawl] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "crawl failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: `vercel.json`**

Add to `crons`:
```json
{ "path": "/api/cron/price-light-crawl", "schedule": "7 * * * *" },
{ "path": "/api/cron/price-light-nightly", "schedule": "15 0 * * *" }
```
Add to `functions`:
```json
"app/api/cron/price-light-crawl/route.ts": { "memory": 1024, "maxDuration": 300 },
"app/api/cron/price-light-nightly/route.ts": { "memory": 1024, "maxDuration": 300 },
"app/api/price-light/crawl/route.ts": { "memory": 1024, "maxDuration": 300 }
```

- [ ] **Step 4: Type gate + dry runs through the dev server**

`npx tsc --noEmit 2>&1 | grep -E "price-light|cron" ; echo done` → nothing.
Start the dev server, then:
`curl "http://localhost:3000/api/cron/price-light-nightly?dry_run=1&key=$NEXT_SECRET_CRON_SECRET_KEY"` → JSON with `scanned` ≈ live future events, `dryRun: true`.
`curl "http://localhost:3000/api/cron/price-light-crawl?dry_run=1&competitor=liveevents&key=..."` → `status: "ok"`.

- [ ] **Step 5: Stop and report** (4 files + `vercel.json`). Do not commit.

---

### Task 10: Event hooks + server actions

**Files:**
- Modify: `lib/actions/event-actions.ts:14-18` (list columns), `:53-87` (create hook), `:89-106` (update guard)
- Create: `lib/actions/price-light-actions.ts`

**Interfaces:**
- Produces: `recheckEvent(eventId): Promise<{ ok: true; lights: Lights } | { ok: false; error: string }>`, `listEventMatches(eventId): Promise<{ matches: MatchRow[]; listings: Record<number, ListingRow> }>`.

- [ ] **Step 1: List columns**

`EVENT_LIST_COLUMNS` (line 14): remove `comp_pricing,` and append `,light_package,light_ticket,light_detail,light_checked_at,price_drop_usd,price_drop_until`. Update the comment (the competitor dialog is gone).

- [ ] **Step 2: Create hook**

In `createEvent`, after the auto-tag `try/catch` and before `return created;`:

```ts
  // Price light: match the new event against the stored competitor catalogs
  // right away (seconds, no browsing). Tolerant - the nightly run completes it.
  try {
    const { matchAllForEvent } = await import("@/lib/services/price-light-match");
    await matchAllForEvent(created.id, "on_create");
  } catch (e) {
    console.error("price-light on create failed:", e);
  }
```

- [ ] **Step 3: Update guard**

Rename `updateEvent`'s parameter to `input: Partial<Event>` and add before `fetchBefore`:

```ts
  // The lights and the price-drop tag are owned by the price-light crons - a
  // form save must never write them back (stale copy from page load).
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    light_package: _lp, light_ticket: _lt, light_detail: _ld, light_checked_at: _lc,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    price_drop_usd: _pu, price_drop_from: _pf, price_drop_until: _pt,
    ...event
  } = input;
```

The rest of the function keeps using `event`.

- [ ] **Step 4: Actions**

```ts
"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { matchAllForEvent } from "@/lib/services/price-light-match";
import type { Lights } from "@/lib/services/price-light-store";
import type { ListingRow, MatchRow } from "@/types/price-light.types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** "בדוק עכשיו": re-match against the stored catalogs and recompute both lights. No browsing. */
export async function recheckEvent(eventId: number): Promise<{ ok: true; lights: Lights } | { ok: false; error: string }> {
  await requireStaff();
  try {
    const result = await matchAllForEvent(eventId, "manual");
    if (!result) return { ok: false, error: "event not found or deleted" };
    return { ok: true, lights: result.lights.after };
  } catch (e) {
    console.error("recheckEvent failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export async function listEventMatches(eventId: number): Promise<{ matches: MatchRow[]; listings: Record<number, ListingRow> }> {
  await requireStaff();
  const { data, error } = await db.from("competitor_matches")
    .select("id,event_id,competitor,scope,listing_id,status,method,ai_verdict,raw_price,raw_currency,price_usd,normalized_usd,adjustments,attrs,our_usd,diff_usd,light,listing_changed_at,note,created_at")
    .eq("event_id", eventId).order("created_at", { ascending: false }).limit(50);
  if (error) { console.error("listEventMatches failed", JSON.stringify(error)); return { matches: [], listings: {} }; }
  const matches = (data ?? []) as MatchRow[];
  const ids = [...new Set(matches.map((m) => m.listing_id).filter((id): id is number => id != null))];
  const listings: Record<number, ListingRow> = {};
  if (ids.length) {
    const { data: rows, error: lErr } = await db.from("competitor_listings")
      .select("id,competitor,external_key,scope,title,title_he,event_date,city,venue,price_from,currency,price_usd,travel_depart,travel_return,attrs,detail_text,url,first_seen_at,last_seen_at,last_changed_at,run_id")
      .in("id", ids);
    if (lErr) console.error("listEventMatches listings failed", JSON.stringify(lErr));
    for (const r of (rows ?? []) as ListingRow[]) listings[r.id] = r;
  }
  return { matches, listings };
}
```

- [ ] **Step 5: Type gate** → `npx tsc --noEmit 2>&1 | grep -E "event-actions|price-light-actions" ; echo done` → nothing.

- [ ] **Step 6: Stop and report** (2 files). Do not commit.

---

### Task 11: Events table — the light column, history sheet, old dialog removed

**Files:**
- Create: `app/(dashboard)/events/price-light-cell.tsx`
- Modify: `app/(dashboard)/events/events-table.tsx` — remove `calculateSmartDates`/`getCompetitorTravelDates` (195-235), the `comp` colour/tooltip logic in `UsualPriceCell` (526-557), `persistComp` (1068-1090), the single/bulk competitor flows (≈1140-1240, 1285-1510, 2110-2140) and every `fetch("/api/competitor-pricing", …)`; add the column after `usual_price` (line 1687)
- Delete: `app/api/competitor-pricing/route.ts`
- Leave: `types/app.types.ts` `comp_pricing` (decision 20)

**Interfaces:**
- Consumes: `recheckEvent`, `listEventMatches` (Task 10); `lightLabel`, `signedUsd` (Task 2); shadcn `Tooltip`, `Sheet`, `Button`.

- [ ] **Step 1: The cell**

```tsx
"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { recheckEvent, listEventMatches } from "@/lib/actions/price-light-actions";
import { lightLabel, signedUsd } from "@/lib/services/price-light";
import type { Event } from "@/types/app.types";
import type { Light, LightScopeDetail, ListingRow, MatchRow } from "@/types/price-light.types";

const PILL: Record<Light, string> = {
  alone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  green: "bg-emerald-700 text-white dark:bg-emerald-600",
  orange: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  red: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  unchecked: "bg-muted text-muted-foreground",
  na: "bg-transparent text-muted-foreground",
};

function tipFor(detail: LightScopeDetail | undefined): string {
  if (!detail) return "not checked yet";
  if (detail.light === "green" || detail.light === "orange" || detail.light === "red") {
    return [
      `${detail.competitor}: raw ${detail.raw ?? "?"} ${detail.raw_currency ?? ""} → normalized $${detail.normalized_usd}`,
      ...detail.adjustments.map((a) => a.label),
      detail.partial ? "partial normalization" : null,
      detail.crawled_at ? `crawled ${detail.crawled_at.slice(0, 10)}` : null,
    ].filter(Boolean).join("\n");
  }
  if (detail.light === "alone") return "all active competitors checked - none sells it";
  if (detail.light === "na") return "not applicable for this event";
  return detail.reason ? `unchecked: ${detail.reason.replace("_", " ")}` : "not checked yet";
}

function Pill({ scope, detail, light }: { scope: "Pkg" | "Tkt"; detail: LightScopeDetail | undefined; light: Light }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${PILL[light]}`}>
            <span className="opacity-70">{scope}</span>
            {lightLabel(detail)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line text-xs">{tipFor(detail)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PriceLightCell({ event, onUpdated }: { event: Event; onUpdated: (patch: Partial<Event>) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ matches: MatchRow[]; listings: Record<number, ListingRow> } | null>(null);
  const { toast } = useToast();
  const detail = event.light_detail ?? null;
  const pkg = (event.light_package as Light | null) ?? "unchecked";
  const tkt = (event.light_ticket as Light | null) ?? "unchecked";

  const openHistory = async () => {
    setOpen(true);
    setHistory(await listEventMatches(event.id));
  };
  const recheck = async () => {
    setBusy(true);
    const res = await recheckEvent(event.id);
    setBusy(false);
    if (!res.ok) { toast({ variant: "destructive", title: "Recheck failed", description: res.error }); return; }
    onUpdated({ light_package: res.lights.package, light_ticket: res.lights.ticket });
    toast({ title: "Rechecked", description: `package ${res.lights.package ?? "—"} · ticket ${res.lights.ticket ?? "—"}` });
    if (open) setHistory(await listEventMatches(event.id));
  };

  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={openHistory} className="flex items-center gap-1" title="History">
        <Pill scope="Pkg" detail={detail?.package} light={pkg} />
        <Pill scope="Tkt" detail={detail?.ticket} light={tkt} />
      </button>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={recheck} disabled={busy} title="Recheck against stored catalogs">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[520px] overflow-y-auto sm:max-w-[520px]">
          <SheetHeader><SheetTitle>Price light · {event.name}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3 text-sm">
            {detail?.package && <p>Package: our ${detail.package.our_usd ?? "—"} · {lightLabel(detail.package)}</p>}
            {detail?.ticket && <p>Ticket: our ${detail.ticket.our_usd ?? "—"} · {lightLabel(detail.ticket)}</p>}
            {!history ? <p className="text-muted-foreground">Loading…</p> : history.matches.length === 0 ? <p className="text-muted-foreground">No checks yet.</p> : (
              <ul className="divide-y">
                {history.matches.map((m) => {
                  const l = m.listing_id ? history.listings[m.listing_id] : null;
                  return (
                    <li key={m.id} className="py-2">
                      <div className="flex justify-between"><span className="font-medium">{m.competitor} · {m.scope}</span><span className="text-muted-foreground">{m.created_at.slice(0, 10)}</span></div>
                      <div>{m.status}{m.diff_usd != null ? ` · ${signedUsd(Number(m.diff_usd))}` : ""}{m.note ? ` · ${m.note}` : ""}</div>
                      {l && <a href={l.url} target="_blank" rel="noreferrer" className="text-xs underline">{l.title} · {l.event_date} · {l.price_from} {l.currency}</a>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

If `components/ui/sheet.tsx` or `tooltip.tsx` is missing, add it with `npx shadcn@latest add sheet tooltip` (check `components/ui/` first).

- [ ] **Step 2: Wire the column, remove the old flow**

In `events-table.tsx`:
1. `import { PriceLightCell } from "./price-light-cell";`
2. After the `usual_price` column object (ends line 1687) add:
```tsx
    {
      id: "price_light",
      header: "Light",
      accessorFn: (row) => Number(row.light_detail?.package?.diff_usd ?? Number.POSITIVE_INFINITY),
      cell: ({ row }) => (
        <PriceLightCell
          event={row.original}
          onUpdated={(patch) => setEvents((prev) => prev.map((e) => (e.id === row.original.id ? { ...e, ...patch } : e)))}
        />
      ),
    },
```
3. `UsualPriceCell`: delete the `comp`/`priceColor`/`tooltipLines` block (526-557); render the price with no colour and no `title`.
4. Delete `calculateSmartDates`, `getCompetitorTravelDates`, `persistComp`, the competitor dialog state/handlers, the bulk competitor action, and all `fetch("/api/competitor-pricing", …)` calls. Verify: `grep -n "comp_pricing\|competitor-pricing\|persistComp\|calculateSmartDates" "app/(dashboard)/events/events-table.tsx"` → no results. Remove now-unused imports (check whether `exchangeRateClientService` on line 21 has other callers before removing it).
5. Delete `app/api/competitor-pricing/route.ts`.

- [ ] **Step 3: Type gate + lint** → `npx tsc --noEmit 2>&1 | grep -E "events-table|price-light-cell" ; echo done` → nothing; `npm run lint` → no new errors.

- [ ] **Step 4: Verify in the browser**

Dev server → `/events`. Expected: a "Light" column with two pills per row (`Pkg unchecked` / `Tkt unchecked` until the nightly has run once), hover shows the tooltip, click opens the sheet, the refresh icon rechecks and toasts. **Do not run the nightly without `dry_run=1` against prod from your machine.** Screenshot for the report.

- [ ] **Step 5: Stop and report** (2 files + 1 deleted). Do not commit.

---

### Task 12: Docs — CLAUDE.md, env, guide, spec touch-up

**Files:**
- Modify: `CLAUDE.md` (Cron Jobs list, env block, security TODO bullet)
- Modify: `app/(dashboard)/guide/guide-content.ts` (new section, EN + HE)
- Modify: `docs/superpowers/specs/2026-09-09-price-light-design.md` §3.4 first bullet

- [ ] **Step 1: CLAUDE.md**

Under "Cron Jobs (Vercel)" add:

```markdown
- `price-light-crawl` - hourly tick; crawls at most ONE competitor site whose interval (48h, `intervalHours` per scraper in `lib/services/competitor-scrapers/`) elapsed, into `competitor_listings`. `?competitor=liveevents` forces a site, `?dry_run=1` writes nothing. Stealth is code: one session at a time, 20-60s random pauses, blocked images, rotating UA, circuit breaker after 3 failures, −50% listing-count alarm. `PRICE_LIGHT_SCRAPE=off` stops crawling.
- `price-light-nightly` - 00:15 UTC: daily `event_price_snapshots`, the "ירידת מחיר" tag (≥$50 vs ~14 days ago, shown 14 days), rule-based matching of every live event against the stored catalogs (`competitor_matches`), and the two lights (`events.light_package` / `light_ticket` / `light_detail`). LiveTickets listings come from the `live_events` API table, no crawl. Spec `docs/superpowers/specs/2026-09-09-price-light-design.md`; rules + constants ONLY in `lib/services/price-light.ts`.
```

Env block: add the 6 vars from Task 4 with one-line comments. Delete `NEXT_SECRET_COMPETITOR_PRICING_URL` and the `competitor-pricing` mention in the security TODO's "unauth resource-abuse proxies" bullet.

- [ ] **Step 2: Guide section**

In `guide-content.ts`, following the file's existing section shape (copy the structure of the `price-changes` entry), add a section `price-light` with EN + HE text covering:

- The two pills on `/events`: `Pkg` / `Tkt`; values alone / green / orange / red / unchecked / —; the number is "our price minus the cheapest competitor after normalization"; unchecked is never treated as green.
- Hover = which competitor, raw → normalized, what was normalized, when crawled. Click = history. Refresh icon = recheck against the stored catalogs (no browsing).
- Competitor sites are crawled at most every 48h; LiveTickets comes from the API sync (`brt` = their shelf price). Red events do nothing automatically — the decision screen arrives in phase 1.

- [ ] **Step 3: Spec touch-up** — §3.4 first bullet becomes: "**session אחד בכל רגע.** שורת `competitor_crawl_runs` במצב `running` שנפתחה לפני פחות מ-6 דקות = נעילה; סריקה ידנית מכבדת אותה."

- [ ] **Step 4: Stop and report.** Final report to Dor lists every file of phase 0, the two dry-run outputs, the `brt` check result, and the screenshot. Dor commits and opens the PR; the migration applies on merge.

---

## Self-review

**Spec coverage (phase 0 scope):** §1 schema → T1 · §1.8 types + main sync + TASK_SOURCES → T1 · §2.1–2.5 → T2 · §2.6 → T3 · §3.1–3.3 → T4 · §3.7 LiveTickets API + brt check → T5 · §3.5 steps + §3.6 LiveEvents → T6 · §3.2/§3.4 crawl, lock, breaker, alarm, kill switch → T7 · §4 rule matching, "row only on change", Judge hook → T8 · §6.1 hourly tick, §6.2 nightly, §6.3 create hook + "check now" + admin crawl → T9/T10 · §7.1 column + sheet + old dialog removal → T11 · §10 env + docs + guide → T4/T12. Not in phase 0 by design: AI judge (§5), `/price-light` screen and 4 actions (§7.2), widget (§7.3), override UI, tasks auto-close (§6.4), main (§8).

**Placeholders:** Task 6's `SEL` values and `CATALOG_URLS` are filled from the recon doc written in the same task — the shape is fixed, the strings are discovered on the site. Task 5's `url` is flagged display-only and confirmed in the recon. Task 9's `revalidateMain` says to copy the exact call from `app/api/revalidate/route.ts`.

**Type consistency:** `Lights` (T3) used by T10/T11; `LatestMatch` (T2) produced by T3 `loadLatestMatches` with an added `scope`; `Listing`/`CrawlContext` (T4) consumed by T5/T6/T7; `MatchOutcome`/`Judge` (T8) consumed by T9; `CrawlSummary` (T7) returned by T9's routes; `LIGHT_EVENT_COLUMNS`/`LightEvent` (T3) consumed by T8/T9; `lightLabel`/`signedUsd` (T2) consumed by T11; `toUsd` (T5) consumed by T6. `competitorsFor(kind, scope, active)` signature identical in T2 selftest, T3 and T8. Engine imports types via a relative `import type` (erased under node) — T2 step 3 and the selftest agree.
