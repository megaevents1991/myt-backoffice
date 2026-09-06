# Events Factory (מפעל האירועים) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate event creation end-to-end — one shared pricing rule, self-filling forms, a nightly base-price sync, batch wizards for every provider, and a draft-review factory grid.

**Architecture:** New pure/service modules under `lib/services/` consumed by every surface (form buttons, wizard, cron, factory). UI work rides the existing `/events/new?batch=1` wizard inside `app/(dashboard)/events/[id]/page.tsx`. Two additive migrations (`base_price_sync_log`, `event_drafts`), applied via master cherry-pick per repo rules.

**Tech Stack:** Next.js 15 App Router, React 19, TS, Supabase service-role client, shadcn/ui, Amadeus Enterprise client (`app/api/flights/amadeusClient.ts`), main-app hotel API proxy.

**Spec:** `docs/superpowers/specs/2026-09-02-events-factory-design.md`

## Global Constraints

- **No commits without Dor's go.** Every task ends at "stop & report"; commit text is given so it's ready when he says commit. Never push unless his last message asks.
- **Migrations:** file lands on the branch; applying = cherry-pick the migration file alone to master (workflow auto-applies). NEVER `db:push` / dispatch from a branch.
- **Type gate:** `npx tsc --noEmit` (ignore pre-existing `.next/types` errors) + `npx next lint --file <changed>` must be clean per task.
- **Testing pure logic:** repo has no test framework. Use the proven scratchpad harness: compile with `npx tsc --outDir <scratchpad>/factoryjs --module commonjs <files>` then run a `.cjs` case-runner with node. Test files live in the session scratchpad, never committed.
- **Money:** all quotes USD; margins/thresholds only from `lib/services/price-quote.ts` constants. Round base prices to whole tens (`round10`). Never write 0 as "no result" — `null` means unknown.
- **Supabase:** shared clients only; explicit column selects; `{data, error}` checked; soft-delete dialect: `events.is_deleted` is a DATE (`IS NULL` = live).
- **Server Actions preferred; cron routes guarded `guardCronRoute(request)`, admin APIs `guardAdminRoute()`/`requireAdmin()`.**
- `const db = supabase as any` single boundary cast allowed for tables missing from generated types (tasks/creative-gaps precedent) with scoped eslint-disable.
- UI: shadcn primitives only, Tailwind, Hebrew labels where the dashboard already uses Hebrew.

---

### Task 1: Price-quote service + pure decision logic

**Files:**
- Create: `lib/services/flight-search.ts` (extract Amadeus search from route)
- Create: `lib/services/price-quote.ts`
- Modify: `app/api/flights/search/route.ts` (use the extracted service; behavior unchanged)
- Test: scratchpad harness `price-quote-cases.cjs`

**Interfaces:**
- Consumes: `amadeus` from `app/api/flights/amadeusClient.ts`; env `NEXT_SECRET_HOTEL_SERVICE_URL`, `NEXT_SECRET_REVALIDATION_SECRET`.
- Produces (later tasks import these exact names from `@/lib/services/price-quote`):
  ```ts
  export const FLIGHT_MARGIN_USD = 100;
  export const HOTEL_MARGIN_USD = 120;
  export const DIRECT_GAP_USD = 300;
  export const SYNC_DEVIATION_USD = 150;
  export const SYNC_FREEZE_USD = 400;
  export function round10(n: number): number;
  export function pickFlightPrice(direct: number | null, anyStops: number | null): { raw: number; source: "direct" | "connection" } | null; // pure
  export function quoteFlight(cityIata: string, departDate: string, returnDate: string): Promise<QuoteResult>;
  export function quoteHotel(lat: number, lon: number, checkin: string, checkout: string): Promise<QuoteResult>;
  export type QuoteResult = { price: number; raw: number; source: "direct" | "connection" | "hotel" } | null;
  ```
  And from `@/lib/services/flight-search`:
  ```ts
  export function searchCheapestOffer(params: {
    destinationLocationCode: string; departureDate: string; returnDate?: string; nonStop: boolean;
  }): Promise<number | null>; // cheapest offer total in USD, TLV origin, null when none/failed
  ```

- [ ] **Step 1: extract flight search.** Create `lib/services/flight-search.ts`. Move from `app/api/flights/search/route.ts`: the `USA_AIRPORT_CODES` set, `isUSADestination`, `getStopsCount`, `pickTargetPrice`, and the Amadeus call block (primary + ≤1-stop fallback, `clientRef`). Export:

```ts
import { amadeus } from "@/app/api/flights/amadeusClient";

export interface FlightOffersQuery {
  originLocationCode?: string; // default "TLV"
  destinationLocationCode: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  currencyCode?: string;
  nonStop: boolean;
}

/** Raw offers for one query. Wraps the Amadeus call + client-ref. Throws on API error. */
export async function fetchFlightOffers(query: FlightOffersQuery): Promise<any[]> { /* moved code */ }

/**
 * Cheapest single offer for the query, USD. Returns null when no offers or
 * on API failure (logged). NO third-cheapest logic here - that stays in the
 * route's pickTargetPrice for the legacy path until Task 2 flips the buttons.
 */
export async function searchCheapestOffer(q: Omit<FlightOffersQuery, "originLocationCode" | "adults" | "currencyCode">): Promise<number | null> {
  try {
    const offers = await fetchFlightOffers({ ...q, originLocationCode: "TLV", adults: 1, currencyCode: "USD" });
    const prices = offers.map(o => Number.parseFloat(o?.price?.total)).filter(Number.isFinite);
    return prices.length ? Math.min(...prices) : null;
  } catch (error) {
    console.error("flight-search: searchCheapestOffer failed", JSON.stringify(error));
    return null;
  }
}
```

Route keeps its exact current response (`pickTargetPrice` third-cheapest, `usedFallback`, etc.) but calls `fetchFlightOffers` for both its primary and fallback queries. No behavior change to the route in this task.

- [ ] **Step 2: price-quote module.** Create `lib/services/price-quote.ts`:

```ts
// One pricing brain. Form buttons, creation auto-fill, the nightly sync and
// the factory all quote through here - the number is the same everywhere.
import { searchCheapestOffer } from "@/lib/services/flight-search";

export const FLIGHT_MARGIN_USD = 100;
export const HOTEL_MARGIN_USD = 120;
export const DIRECT_GAP_USD = 300;   // direct costlier than this over connection -> take connection
export const SYNC_DEVIATION_USD = 150;
export const SYNC_FREEZE_USD = 400;

export type QuoteResult = { price: number; raw: number; source: "direct" | "connection" | "hotel" } | null;

export function round10(n: number): number {
  return Math.round(n / 10) * 10;
}

/** Dor's rule: cheapest direct wins unless it beats the connection by > $300. */
export function pickFlightPrice(direct: number | null, anyStops: number | null):
  { raw: number; source: "direct" | "connection" } | null {
  if (direct === null && anyStops === null) return null;
  if (direct === null) return { raw: anyStops as number, source: "connection" };
  if (anyStops !== null && direct - anyStops > DIRECT_GAP_USD)
    return { raw: anyStops, source: "connection" };
  return { raw: direct, source: "direct" };
}

export async function quoteFlight(cityIata: string, departDate: string, returnDate: string): Promise<QuoteResult> {
  const [direct, anyStops] = await Promise.all([
    searchCheapestOffer({ destinationLocationCode: cityIata, departureDate: departDate, returnDate, nonStop: true }),
    searchCheapestOffer({ destinationLocationCode: cityIata, departureDate: departDate, returnDate, nonStop: false }),
  ]);
  const picked = pickFlightPrice(direct, anyStops);
  if (!picked) return null;
  return { price: round10(picked.raw + FLIGHT_MARGIN_USD), raw: picked.raw, source: picked.source };
}

export async function quoteHotel(lat: number, lon: number, checkin: string, checkout: string): Promise<QuoteResult> {
  try {
    const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL || "http://localhost:3000";
    const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
    const url = `${base}/api/hotels?lat=${lat}&lon=${lon}&checkin=${checkin}&checkout=${checkout}&secret=${secret}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.message || "hotel search failed");
    const cheapest = Number(data?.cheapest_price);
    if (!Number.isFinite(cheapest) || cheapest <= 0) return null;
    return { price: round10(cheapest + HOTEL_MARGIN_USD), raw: cheapest, source: "hotel" };
  } catch (error) {
    console.error("price-quote: quoteHotel failed", JSON.stringify(error));
    return null;
  }
}
```

(Main's `/api/hotels` already filters `star_rating = 3` — spec §1. `total_4star_hotels_found` in its response is a legacy misnomer; ignore it.)

- [ ] **Step 3: harness the pure fns.** Compile + run; all pass:

```js
// price-quote-cases.cjs (scratchpad) - run: node price-quote-cases.cjs
const { pickFlightPrice, round10, FLIGHT_MARGIN_USD } = require("./factoryjs/price-quote");
const cases = [
  ["direct only", () => pickFlightPrice(500, null), { raw: 500, source: "direct" }],
  ["connection only", () => pickFlightPrice(null, 380), { raw: 380, source: "connection" }],
  ["both null", () => pickFlightPrice(null, null), null],
  ["direct within gap", () => pickFlightPrice(650, 400), { raw: 650, source: "direct" }],
  ["gap exactly 300 keeps direct", () => pickFlightPrice(700, 400), { raw: 700, source: "direct" }],
  ["gap over 300 -> connection", () => pickFlightPrice(701, 400), { raw: 400, source: "connection" }],
  ["round10 down", () => round10(543 + FLIGHT_MARGIN_USD), 640],
  ["round10 up", () => round10(646), 650],
];
let fail = 0;
for (const [name, run, want] of cases) {
  const got = run();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
process.exit(fail ? 1 : 0);
```

Path aliases don't compile standalone — compile a copy of `price-quote.ts` with the `flight-search` import stripped (pure layer only), or inline-copy the two pure fns into the harness compile dir. The harness tests `pickFlightPrice`/`round10` only.

- [ ] **Step 4: gates.** `npx tsc --noEmit` (no new errors), `npx next lint --file lib/services/flight-search.ts --file lib/services/price-quote.ts --file app/api/flights/search/route.ts`.

- [ ] **Step 5: stop & report.** Ready commit: `feat(pricing): one price-quote service - direct-vs-connection rule + margins`

### Task 2: Quote API route + form buttons use it

**Files:**
- Create: `app/api/price-quote/route.ts`
- Modify: `lib/actions/flight-actions.ts` (add `fetchPriceQuote`)
- Modify: `app/(dashboard)/events/[id]/page.tsx` — `searchFlightPricesForEvent` (~line 614) and the hotel twin (~line 679)

**Interfaces:**
- Produces: `POST /api/price-quote` body `{ kind: "flight", cityIata, departDate, returnDate } | { kind: "hotel", lat, lon, checkin, checkout }` → `{ success: true, quote: QuoteResult } | { success: false, message }`; client helper `fetchPriceQuote(body): Promise<PriceQuote>`.

- [ ] **Step 1: route.**

```ts
import { NextRequest, NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { quoteFlight, quoteHotel } from "@/lib/services/price-quote";

export async function POST(request: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  try {
    const body = await request.json();
    if (body?.kind === "flight") {
      const { cityIata, departDate, returnDate } = body;
      if (!cityIata || !departDate || !returnDate)
        return NextResponse.json({ success: false, message: "Missing flight params" }, { status: 400 });
      return NextResponse.json({ success: true, quote: await quoteFlight(cityIata, departDate, returnDate) });
    }
    if (body?.kind === "hotel") {
      const { lat, lon, checkin, checkout } = body;
      if (typeof lat !== "number" || typeof lon !== "number" || !checkin || !checkout)
        return NextResponse.json({ success: false, message: "Missing hotel params" }, { status: 400 });
      return NextResponse.json({ success: true, quote: await quoteHotel(lat, lon, checkin, checkout) });
    }
    return NextResponse.json({ success: false, message: "Unknown kind" }, { status: 400 });
  } catch (error) {
    console.error("price-quote route failed", JSON.stringify(error));
    return NextResponse.json({ success: false, message: "Quote failed" }, { status: 500 });
  }
}
```

(Verify `guardAdminRoute()` at `lib/auth/guards.ts:163` — takes no args, returns `NextResponse | null`; adjust if different.)

- [ ] **Step 2: client helper** in `lib/actions/flight-actions.ts` (plain client fetch file, not "use server"):

```ts
export type PriceQuote = { price: number; raw: number; source: "direct" | "connection" | "hotel" } | null;

export async function fetchPriceQuote(body:
  | { kind: "flight"; cityIata: string; departDate: string; returnDate: string }
  | { kind: "hotel"; lat: number; lon: number; checkin: string; checkout: string },
): Promise<PriceQuote> {
  try {
    const response = await fetch("/api/price-quote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.success) return null;
    return data.quote;
  } catch { return null; }
}
```

- [ ] **Step 3: flip the two form buttons.** In `searchFlightPricesForEvent`: replace `searchFlightPrices(...)` + `Math.round(result.cheapestPrice!)` with `fetchPriceQuote({kind:"flight",...})` → `base_flight_price: quote.price`; success toast says source (`"קונקשיין — ישירה יקרה ביותר מ-$300"` vs `"ישירה"`); null → destructive toast. Hotel button same → `base_hotel_price: quote.price`. Spinners/disabled untouched.

- [ ] **Step 4: gates.** **Step 5: stop & report.** Ready commit: `feat(pricing): form search buttons quote through the shared rule (+100/+120, rounded)`

### Task 3: Event form cleanup (spec §2)

**Files:**
- Modify: `app/(dashboard)/events/[id]/page.tsx` (markups → collapsed Advanced; remove `usual_price` input ~line 1650)
- Modify: `lib/actions/event-actions.ts` `createEvent` (auto card image + auto-tags)

**Interfaces:**
- Consumes: `applyTagRules(eventIds?: number[])` from `lib/services/auto-tagger.ts:71`.

- [ ] **Step 1: enumerate markup inputs** (grep `markup` in the form). Visible stay exactly `ticket_only_markup` + `event_additional_markup`; the rest move to a `<Collapsible>` "Advanced markups" section below the price grid, chevron trigger like the sidebar groups. Auto-open: `defaultOpen` when any hidden field on the loaded event is a finite number > 0.
- [ ] **Step 2: remove `usual_price` input** — delete Label+Input cell only. KEEP `usual_price: 0` in the two initial-state literals (~313, 345) so `createEvent` still writes a value; only the UI goes. Keep the `fix-price` anchor + grid.
- [ ] **Step 3: `createEvent` additions** (`lib/actions/event-actions.ts:53`): before insert — `if (!event.card_image_url && event.campaign_image_url) event.card_image_url = event.campaign_image_url;` (manual wins; empty at create usually → nightly creative cron fills later). After insert returns id: `try { await applyTagRules([newId]); } catch (e) { console.error("auto-tag on create failed", JSON.stringify(e)); }` — non-blocking.
- [ ] **Step 4: gates + manual check** (`/events/new` clean; legacy event opens Advanced expanded). **Step 5: stop & report.** Ready commit: `feat(events): form cleanup - advanced markups collapsed, usual_price out of the UI, auto card image + tags on create`

### Task 4: `base_price_sync_log` migration file

**Files:**
- Create: `supabase/migrations/<timestamp>_base_price_sync_log.sql` via `npm run db:new base_price_sync_log`

- [ ] **Step 1:**

```sql
-- Nightly base-price sync audit. Backoffice-only; main never reads this.
create table if not exists public.base_price_sync_log (
  id          bigint generated always as identity primary key,
  event_id    bigint not null,
  component   text   not null check (component in ('flight','hotel')),
  old_price   integer,
  new_price   integer,
  live_price  integer,
  status      text   not null default 'applied', -- applied | needs_review | error
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists base_price_sync_log_event_idx on public.base_price_sync_log (event_id, created_at desc);
create index if not exists base_price_sync_log_review_idx on public.base_price_sync_log (created_at desc) where status = 'needs_review';
alter table public.base_price_sync_log enable row level security;
```

(No FK to events — log survives event lifecycle; CHECK allowed, main never writes here.)
- [ ] **Step 2:** prefix-uniqueness check (`ls supabase/migrations | cut -c1-14 | sort | uniq -d` → empty). **Do not apply** — master cherry-pick when stage 3 QA starts. **Step 3: stop & report.** Ready commit: `feat(pricing): base_price_sync_log migration (file only)`

### Task 5: base-price-sync service + cron route (dry-run first-class)

**Files:**
- Create: `lib/services/base-price-sync.ts`
- Create: `app/api/cron/base-price-sync/route.ts`
- Modify: `vercel.json`
- Test: scratchpad harness for `decideSync`

**Interfaces:**
- Produces: `runBasePriceSync(options: { dryRun: boolean; budgetMs: number }): Promise<SyncSummary>`;
  `decideSync(base: number, live: number): "skip" | "apply" | "needs_review"` (pure);
  `SyncSummary = { scanned: number; applied: SyncChange[]; needsReview: SyncChange[]; errors: { eventId: number; component: string; note: string }[]; remaining: number; dryRun: boolean }`;
  `SyncChange = { eventId: number; name: string; component: "flight" | "hotel"; oldPrice: number; livePrice: number }`.

- [ ] **Step 1: pure decision.**

```ts
import { SYNC_DEVIATION_USD, SYNC_FREEZE_USD } from "@/lib/services/price-quote";

export function decideSync(base: number, live: number): "skip" | "apply" | "needs_review" {
  const delta = Math.abs(live - base);
  if (delta < SYNC_DEVIATION_USD) return "skip";
  if (delta > SYNC_FREEZE_USD) return "needs_review";
  return "apply";
}
```

- [ ] **Step 2: runner.** `runBasePriceSync`:
  1. Candidates: `.from("events").select("id,name,date,def_date_depart,def_date_return,location,base_flight_price,base_hotel_price,skip_flight").is("is_deleted", null).gte("date", <today+2d ISO>).order("date")`.
  2. Weekly bucket: keep `date <= today+45d`, plus far ones where `event.id % 7 === new Date().getUTCDay()`.
  3. Offline exclusions: discover the link columns first (grep `event_id` in `types/offline*.types.ts` / offline actions) and build two Sets (event ids with offline flights / offline hotels); skip that component.
  4. Per component: skip base 0/null; skip flight when `skip_flight`. Quote via `quoteFlight(location.city_iata, def_date_depart, def_date_return)` / `quoteHotel(location.latitude, location.longitude, def_date_depart, def_date_return)`; null quote → errors, continue.
  5. `decideSync(base, quote.price)`: `"apply"` + real run → `.update({ base_flight_price: quote.price })` (explicit column per component, `.eq("id", event.id)`) + log row `status='applied'`; `"needs_review"` + real run → log row only. **Dry run: collect into summary, zero writes of any kind.**
  6. Budget: bail when `Date.now() - start > budgetMs`, count `remaining`. Read `lib/services/`'s tixstock price sync for the established budget/report pattern first.
- [ ] **Step 3: route.**

```ts
import { NextRequest, NextResponse } from "next/server";
import { guardCronRoute } from "@/lib/auth/guards";
import { runBasePriceSync } from "@/lib/services/base-price-sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardCronRoute(request);
  if (denied) return denied;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  try {
    const summary = await runBasePriceSync({ dryRun, budgetMs: 270_000 });
    console.log(`[base-price-sync] scanned=${summary.scanned} applied=${summary.applied.length} review=${summary.needsReview.length} errors=${summary.errors.length} remaining=${summary.remaining}${dryRun ? " (dry-run)" : ""}`);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[base-price-sync] fatal", JSON.stringify(error));
    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: vercel.json** — cron `{ "path": "/api/cron/base-price-sync", "schedule": "30 1 * * *" }` + functions `"app/api/cron/base-price-sync/route.ts": { "maxDuration": 300 }`.
- [ ] **Step 5: harness `decideSync`** — 149→skip, 150→apply, 400→apply, 401→needs_review, symmetric down-direction. **Step 6: gates.** **Step 7: stop & report** — note: real writes only after migration on master + merge; preview testing = `?key=<legacy>&dry_run=1`. Ready commit: `feat(pricing): nightly base-price sync - $150 rule, $400 freeze, dry-run`

### Task 6: Price-changes screen + daily email

**Files:**
- Create: `app/(dashboard)/price-changes/page.tsx` + `price-changes-client.tsx`
- Create: `lib/actions/base-price-log-actions.ts`
- Modify: `lib/services/base-price-sync.ts` (email at end of real run)
- Modify: `lib/nav.ts` (Products → "שינויי מחיר", admin roles)

**Interfaces:**
- Produces: `listSyncLog(filter: "all" | "needs_review", limit?: number): Promise<SyncLogRow[]>` (`SyncLogRow = { id: number; event_id: number; event_name: string | null; component: string; old_price: number | null; new_price: number | null; live_price: number | null; status: string; note: string | null; created_at: string }`), `approveReviewRow(logId: number): Promise<{ ok: boolean; error?: string }>`.
- Consumes: `lib/email.ts` transport (read its exported send signature first), `requireAdmin()`, `logAudit`.

- [ ] **Step 1: actions** — `"use server"`, `requireAdmin()`, boundary cast, explicit selects, event names joined via a second `.in("id", eventIds)` query (no FK). `approveReviewRow`: load row → require `status === 'needs_review'` → update the event's component column to `live_price` → row `status='applied'`, `note = 'approved manually'` → `logAudit`.
- [ ] **Step 2: screen** — DataTable v2: date / event (link `/events/<id>`) / component / old→new / live / status pill; views All | Needs review with counts; "אשר עדכון" button on needs_review rows. Empty state "ה־cron עוד לא רץ".
- [ ] **Step 3: email** — end of real run when `applied + needsReview + errors > 0`: subject `Base price sync: X applied · Y for review · Z errors`, body one line each + link `${process.env.NEXT_PUBLIC_APP_URL}/price-changes`, recipient `NEXT_SECRET_ADMIN_EMAIL`, try/caught (never fails the sync).
- [ ] **Step 4: gates + stop & report.** Ready commit: `feat(pricing): price-changes screen + approve-review + daily summary email`

### Task 7: Stadium memory (spec §4a)

**Files:**
- Create: `lib/services/venue-memory.ts`
- Create: `lib/actions/venue-memory-actions.ts`
- Modify: `app/(dashboard)/events/[id]/page.tsx` (wizard step init: apply + banner + undo)
- Test: harness for the pure matcher

**Interfaces:**
- Produces:
  ```ts
  export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number; // pure haversine
  export function normalizeVenueName(name: string): string; // pure - reuses normalizeForSearch from lib/search.ts
  export type VenueMemory = { fromEventId: number; fromEventName: string; tickets: EventTicket[] } | null;
  export async function findVenueMemory(venueName: string, lat: number, lon: number): Promise<VenueMemory>;
  ```
  Server action: `findVenueMemoryAction(venueName: string, lat: number, lon: number): Promise<VenueMemory>` (requireAdmin).

- [ ] **Step 1: service.** Query latest 400 live events `.select("id,name,date,location,tickets_and_rates").is("is_deleted", null).order("date", { ascending: false }).limit(400)`; first match on `normalizeVenueName(event.location?.name) === normalizeVenueName(venueName)`, fallback first `distanceKm(...) < 1`. Copy structure from `tickets_and_rates`: open `EventTicket` in `types/app.types.ts`, keep name/description/color/zone members, zero every price/amount member, regenerate ids the way the wizard's "add category" does.
- [ ] **Step 2: wizard wiring.** In the batch step-init (where the mapper seeds the form): if mapped `tickets_and_rates` empty → action → apply + banner state; dismissible banner "פירוט הכרטיסים הועתק מ־<name>" + "בטל" (restores empty). Existing reprice runs after; categories without a live listing keep the copied price + amber "לבדיקה" badge in the ticket rows.
- [ ] **Step 3: harness** — `normalizeVenueName("Estadio Santiago Bernabéu") === normalizeVenueName("estadio santiago bernabeu")`; `distanceKm` Wembley→900m ≈ true under 1, 2km false. **Step 4: gates + stop & report.** Ready commit: `feat(wizard): stadium memory - ticket structure copied from the last event at the venue`

### Task 8: Auto base-fill on creation (spec §4b)

**Files:**
- Modify: `app/(dashboard)/events/[id]/page.tsx`

- [ ] **Step 1:** effect in the new/batch path: when `city_iata && def_date_depart && def_date_return && base_flight_price === 0` → `fetchPriceQuote({kind:"flight",...})`; re-check the field is still 0 before writing (user may have typed); set + 2s `bg-success-muted` highlight. Hotel twin on `base_hotel_price === 0` with `location.latitude/longitude`. One-shot per step via `useRef<Set<string>>` keyed `stepIndex:kind`. Failure → inline warning under the field, never blocks save.
- [ ] **Step 2:** verify it refires per batch step. **Step 3: gates + stop & report.** Ready commit: `feat(wizard): base prices auto-fill on creation - empty fields only`

### Task 9: Multi-team batch + competition mode (spec §5)

**Files:**
- Modify: `app/(dashboard)/tixstock-events/tixstock-events-content.tsx` (drop reset ~line 321; chips; competition mode)
- Modify: `app/(dashboard)/events/[id]/page.tsx` (stash envelope + team-change form reset)
- Create: `lib/tixstock-home.ts`
- Test: harness for `isHomeGame`

**Interfaces:**
- Produces: `export function isHomeGame(eventName: string, teamName: string): boolean` — `normalizeForSearch(eventName).startsWith(normalizeForSearch(teamName))`.
- **Stash envelope (Task 11 contract):** localStorage key renamed `batch_create`, value `{ provider: "tixstock", rows: TixStockEventDB[] }`. This task updates writer + both reader sites (`events/[id]/page.tsx:237`, `:1230`).

- [ ] **Step 1:** selection accumulates across performers (keyed by event id); chips row: performer + count + ✕ clears that team's picks; "Batch create (N)" stashes union sorted `(performer, date)`.
- [ ] **Step 2: competition mode.** Toggle: pick `category_name` from loaded events' distinct values → performer checklist within that competition → auto-select rows where `isHomeGame(event_name, performer)`; competition rows failing the heuristic get amber "בית?" badge, unselected, manually pickable.
- [ ] **Step 3: wizard:** on step advance, `rows[i].performer !== rows[i-1].performer` → reset dragged form to that row's fresh mapping (stadium memory refires).
- [ ] **Step 4: harness** — ("Arsenal vs Chelsea","Arsenal")→true; ("Chelsea vs Arsenal","Arsenal")→false; ("Real Madrid CF v Barca","Real Madrid")→true; Hebrew pair. **Step 5: gates + stop & report.** Ready commit: `feat(batch): multi-team selection + competition mode with home-game heuristic`

### Task 10: Artist tour mode (spec §6)

**Files:**
- Create: `lib/services/nearest-location.ts`
- Modify: `app/(dashboard)/events/[id]/page.tsx`
- Test: harness

**Interfaces:**
- Produces: `findNearestIata(lat: number, lon: number, locations: Pick<Location,"latitude"|"longitude"|"city_iata">[], maxKm?: number): string | null` (pure, default 50, skips null-iata rows, imports `distanceKm` from venue-memory) + server action `nearestIataAction(lat: number, lon: number): Promise<string | null>` querying `locations` `.select("latitude,longitude,city_iata")`.

- [ ] **Step 1:** pure fn + action. **Step 2:** wizard step init: `city_iata` empty + coords present → action → fill + highlight; null → manual. (With Task 8 this gives per-city prices on tours.) **Step 3: harness** — within 50km picks nearest, 80km → null, null-iata skipped. **Step 4: gates + stop & report.** Ready commit: `feat(wizard): artist tour mode - city_iata resolves from locations per stop`

### Task 11: Batch wizard for every provider (spec §7)

**Files:**
- Create: `app/(dashboard)/live-events/batch/live-to-event.ts`, `app/(dashboard)/p1-events/batch/p1-to-event.ts`, `app/(dashboard)/sports-events/batch/sports-to-event.ts`
- Modify: the three `*-events-content.tsx` (multi-select + Batch create)
- Modify: `app/(dashboard)/events/[id]/page.tsx` (mapper dispatch)

**Interfaces:**
- Consumes: Task 9's envelope `{ provider, rows }` under key `batch_create`.
- Produces: `liveToEvent(row) / p1ToEvent(row) / sportsToEvent(row): Partial<Event>` mirroring `tixstockToEvent`'s output shape; provider row types from `types/live-events.types.ts` / `types/p1-events.types.ts` / `types/sports-events.types.ts`.

- [ ] **Step 1:** read each provider `[id]/page.tsx` create-event path; EXTRACT the mapping into the new file (move, not rewrite); single-event page imports it too — one mapping per provider for both flows.
- [ ] **Step 2:** checkbox column + "Batch create (N)" in the three tables → stash `{ provider, rows }` → open `/events/new?batch=1`.
- [ ] **Step 3:** wizard: `const mapper = { tixstock: tixstockToEvent, live: liveToEvent, p1: p1ToEvent, sports: sportsToEvent }[stash.provider]`. Tasks 7/8/10 hook the event layer → work for all four unchanged.
- [ ] **Step 4: gates + stop & report.** Ready commit: `feat(batch): batch create from every provider - shared wizard, per-provider mapping`

### Task 12: `event_drafts` migration file

**Files:**
- Create: `supabase/migrations/<timestamp>_event_drafts.sql` via `npm run db:new event_drafts`

- [ ] **Step 1:**

```sql
-- Factory work queue. Backoffice-only; main reads `events`, never this.
create table if not exists public.event_drafts (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                     -- tixstock | live | p1 | sports | artist | competition
  scope       jsonb not null default '{}',
  payload     jsonb not null,                    -- full event shape createEvent accepts
  status      text not null default 'building',  -- building | ready | needs_input | approved | created | error
  missing     jsonb not null default '[]',
  error       text,
  created_event_id bigint,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists event_drafts_status_idx on public.event_drafts (status, created_at desc);
alter table public.event_drafts enable row level security;
```

- [ ] **Step 2:** prefix check; do not apply (master cherry-pick at factory QA). **Stop & report.** Ready commit: `feat(factory): event_drafts migration (file only)`

### Task 13: Draft builder + factory actions

**Files:**
- Create: `types/factory.types.ts`, `lib/services/draft-builder.ts`, `lib/actions/factory-actions.ts`

**Interfaces:**
- Produces:
  ```ts
  // types/factory.types.ts
  export const DRAFT_STATUSES = ["building","ready","needs_input","approved","created","error"] as const;
  export type DraftStatus = (typeof DRAFT_STATUSES)[number];
  export type EventDraft = { id: string; source: string; scope: Record<string, unknown>;
    payload: Partial<Event>; status: DraftStatus; missing: string[]; error: string | null;
    created_event_id: number | null; created_at: string };
  // factory-actions.ts ("use server", requireAdmin, boundary cast, logAudit)
  export async function createDraftBatch(input: { source: string; scope: Record<string, unknown>; payloads: Partial<Event>[] }): Promise<{ ok: boolean; ids: string[] }>;
  export async function buildNextDraft(): Promise<{ done: boolean; built?: string }>;
  export async function listDrafts(): Promise<EventDraft[]>;
  export async function updateDraftPayload(id: string, patch: Partial<Event>): Promise<{ ok: boolean; error?: string }>;
  export async function approveDrafts(ids: string[]): Promise<{ created: number; failed: { id: string; error: string }[] }>;
  export async function discardDrafts(ids: string[]): Promise<{ ok: boolean }>;
  ```
- Consumes: `findVenueMemory` (7), `quoteFlight/quoteHotel` (1), `findNearestIata` (10), `createEvent`, `applyTagRules` (via createEvent, Task 3).

**Note:** client stashes mapper OUTPUT (`payloads`), so the builder is provider-agnostic — mappers stay client-side where the rows already live.

- [ ] **Step 1: builder.** `buildDraft(payload)`: fill in order — `city_iata` via `findNearestIata` when empty; `tickets_and_rates` via `findVenueMemory` when empty; `base_flight_price`/`base_hotel_price` via quotes when 0. Track `missing` (`'city_iata' | 'tickets' | 'base_flight_price' | 'base_hotel_price'`); status `missing.length ? "needs_input" : "ready"`; throws → caller marks `error`.
- [ ] **Step 2: actions.** `createDraftBatch` inserts rows (`status='building'`); `buildNextDraft` oldest `building` → build → save (catch → `status='error'`); `approveDrafts` per id → `createEvent(payload)` → `status='created'` + `created_event_id` (failure → error status + list); `discardDrafts` physical delete; `approveDrafts` also purges `created`/`error` rows older than 30 days (spec retention, no extra cron).
- [ ] **Step 3: gates + stop & report.** Ready commit: `feat(factory): draft builder + factory actions`

### Task 14: Factory screen + review grid

**Files:**
- Create: `app/(dashboard)/factory/page.tsx` + `factory-client.tsx`
- Modify: `lib/nav.ts` (Products → "מפעל האירועים"), the four provider content files (+"Send to factory" beside "Batch create" — same selection, `createDraftBatch` with mapper outputs)

**Interfaces:**
- Consumes: Task 13 verbatim.

- [ ] **Step 1: intake.** Factory page explains scope options; provider tables are the pickers ("Send to factory" per provider; competition/artist modes from Task 9/10 feed the same selection). Page shows current queue immediately.
- [ ] **Step 2: build loop.** While drafts are `building`: client loop `await buildNextDraft()` → refresh; progress "נבנו X מתוך Y"; stop button halts the loop (sequential — Amadeus/hotel load stays sane).
- [ ] **Step 3: grid.** DataTable v2: name (inline Input) / date / iata (inline, amber when in `missing`) / base flight+hotel (inline, amber when missing) / tickets count / status pill; views All | Needs input | Ready (counts); edits → `updateDraftPayload` optimistic. Bulk bar: "אשר נבחרים" → `approveDrafts` → toast + rows to `created` with link `/events/<id>`; "מחק" → `discardDrafts`.
- [ ] **Step 4: gates + full-flow preview test** (small scope after `event_drafts` lands on master; approve 2). **Stop & report.** Ready commit: `feat(factory): intake, background build loop, review grid`

---

## Self-review (run at write time)

- **Spec coverage:** §1→T1-2 · §2→T3 · §3→T4-6 · §4→T7-8 · §5→T9 · §6→T10 · §7→T11 · §8→T12-14 · §9 woven into task gates · §10 = task order. Decisions: 1-3 in T5, 4 in T9, 5 in T6, 6 in T3, 7-8 in T1, 9 in T11, 10 = plan scope, 11 honored (no AI anywhere).
- **Type consistency:** `QuoteResult`/`fetchPriceQuote` defined T1/T2, consumed T5/T8/T13; stash envelope defined T9, consumed T11; `EventDraft` single definition T13→T14; `distanceKm` exported T7, imported T10.
- **Explicit discovery steps (not placeholders):** markup field list (T3), offline link columns + tixstock budget pattern (T5), email signature (T6), `EventTicket` members (T7), provider mapper sources (T11).
