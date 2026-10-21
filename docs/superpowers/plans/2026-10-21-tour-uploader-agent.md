# Tour Uploader (agent #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staff brief ("יצא טור של אריק קלפטון…", "כל משחקי הבית של ליברפול") becomes hidden `tx_event` events with TixStock + LiveTickets attached, reviewed on a cards board with the AI's decisions and warnings, blocking questions to the sender, and an Approve that publishes.

**Architecture:** One AI call parses the brief into a validated `UploaderPlan`; everything after it is deterministic and pure (`lib/uploader/*`, selftested): find shows in the synced catalogs, group them, build one hidden event per show through the existing blocks (`createEvent`, `quoteFlight/quoteHotel`, `listingsTheSiteSells`, LiveTickets stock, venue templates), ask structured questions through the Tasks Hub, and learn through `audit_log` rows the agent declares in `learnsFrom`. Rows live in `uploader_runs` / `uploader_items`; the event carries `events.is_hidden` until approved. The Events Factory is removed.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service role, `supabase` untyped client with one boundary cast), shadcn/ui, `@anthropic-ai/sdk`, `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md`

## Global Constraints

- Work on `master`; conventional commits; **never push**; no AI co-author line; migrations only from master (`npm run db:new <name>`, idempotent SQL).
- Every new server action starts with `await requireAdmin()`; nav `roles: ADMIN_ROLES`, `productType: "events"`.
- Suppliers: `tixstock` + `livetickets` only. XS2Event / P1 = fallback search, information only.
- The AI (agent key `tour-uploader`, env `TOUR_UPLOADER_AI` = `"on"`, model env `TOUR_UPLOADER_AI_MODEL`, default `claude-opus-5`, `callsPerRun: 3`, `timeoutMs: 20_000`, `maxRetries: 0`, forced tool call) parses the brief and nothing else. Off = the manual plan form; everything else works without it.
- Prices: ticket = `tixstockTicketPriceUsd` / `liveTicketsPriceUsd`; bases = `quoteFlight` / `quoteHotel`; markups = the plan's `ticket_only` → `ticket_only_markup`, `additional` → `event_additional_markup`. Nothing else writes a price.
- Hidden = `events.is_hidden = true`. Nothing hidden is listed, fed, drawn, crawled or quoted (spec §6.1). Approve = the one place that sets it false.
- Zero sellable tickets = no event (`skipped`, `no_tickets`). Never a guessed supplier match: ambiguity = a question.
- Staff text is data: the brief is a user turn, lessons sit inside the memory fence, nothing typed changes the schema.
- Constants (one place each, `lib/uploader/constants.ts`): `NEAR_LOCATION_KM = 50`, `FAR_VENUE_KM = 300`, `SHOW_WINDOW_DAYS = 3` (= `AVAILABILITY_WINDOW_DAYS`), `PRICED_PARTY = 2` (from `lib/tixstock-listings.ts`), `REJECT_REASON_MIN = 3`, `TOAST_POLL_MS = 60_000`, `BOARD_POLL_MS = 2_500`.
- Hebrew UI copy exactly as the spec writes it where it quotes it (pills, buttons, warnings).

## Review Focus

1. A brief in Hebrew that names the artist only in Hebrew ("אריק קלפטון") - the parser must answer `name_en` ("Eric Clapton") and the subject must resolve against `artists.name` too, not only `name_english` (Task 3 test `resolves subject by Hebrew name`).
2. Two TixStock rows for the same city and date where one has `ticket_count = 0` - no question, the empty one is dropped with a decision (Task 3 test `drops the zero-ticket twin`).
3. A LiveTickets stock answer of `"SOLD_OUT"` while TixStock sells - the event is built on TixStock alone with the decision "LiveTickets: אזל" (Task 4 test `sold-out live stock is not an error`).
4. Approve on an item whose event row was soft-deleted in the editor meanwhile - refuse with `kind: "event_gone"`, never flip `is_hidden` on a deleted row (Task 8 guard list; selftest covers `editDiff` on a null row).
5. The same brief parsed twice (a re-run after fixing a page) - every show that already exists (live OR hidden) is `skipped` `exists`, and a `rejected_final` item of the last run is `skipped` `rejected_before` (Task 3 tests `duplicate against hidden event`, `final rejection is remembered`).

---

## File structure

**Create**
- `supabase/migrations/<ts>_tour_uploader.sql` - `events.is_hidden`, `uploader_runs`, `uploader_items`, drop `event_drafts`.
- `types/uploader.types.ts` - `UploaderPlan`, `UploaderRun`, `UploaderItem`, `ShowIdentity`, `ItemStatus`, `UploaderQuestion`, `Decision`, `Warning`.
- `lib/uploader/constants.ts` - the numbers above.
- `lib/uploader/plan.ts` - plan schema, `parsePlanInput`, `planDiff`, `emptyPlan`, `applyPriorDefaults`.
- `lib/uploader/shows.ts` - candidates, grouping, questions, duplicates, prior answers.
- `lib/uploader/tickets.ts` - supplier rows → `EventTicket[]`.
- `lib/uploader/warnings.ts` - warnings from subject + show + build facts.
- `lib/uploader/decisions.ts` - decision codes/texts, `editDiff`.
- `lib/uploader/names.ts` - event `name` / `name_english` rules.
- `lib/smart-dates.ts` - `calculateSmartDates` (moved).
- `lib/venue-maps/zone-from-template.ts` - `zoneFromTemplate` (moved).
- `lib/agents/tour-uploader.agent.ts` - the declaration.
- `lib/services/tour-uploader-parse.ts` - the one Anthropic call.
- `lib/services/uploader-search.ts` - DB reads: subject rows, catalogs, existing events, locations, venue maps, prior answers.
- `lib/services/uploader-build.ts` - build one item (tickets → location → map → dates → bases → create).
- `lib/services/uploader-questions.ts` - open / close the question task, mail.
- `lib/services/nearest-location.ts` (modify) - `nearestLocation()` returning the row + km.
- `lib/actions/uploader-actions.ts` - every server action of the two screens + the toast.
- `app/(dashboard)/uploader/page.tsx`, `uploader-client.tsx`, `brief-composer.tsx`, `plan-card.tsx`, `runs-list.tsx`.
- `app/(dashboard)/uploader/[id]/page.tsx`, `layout.tsx` (`maxDuration = 60`), `board-client.tsx`, `show-card.tsx`, `question-card.tsx`, `reject-dialog.tsx`, `board-header.tsx`.
- `components/uploader-waiting-toast.tsx`.
- `scripts/tour-uploader-selftest.ts`, `scripts/uploader-dryrun.ts` (read-only prod search).
- `docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md`.

**Modify**
- `types/app.types.ts` (`is_hidden`), `lib/agents/{types,index,maturity}.ts`, `lib/services/ai-factory.ts`, `scripts/agents-selftest.ts`.
- `lib/actions/event-actions.ts` (`updateEvent` strips `is_hidden`), `lib/creative/auto.ts`, `lib/actions/meta-feed-actions.ts`, `lib/services/tours-events-feed-sync.ts`, `lib/actions/tours-events-actions.ts`, `lib/services/venue-memory.ts`, `lib/services/price-light-nightly.ts`, `lib/services/our-offer-detail.ts`, `lib/services/price-alternatives.ts`, `lib/services/base-price-sync.ts`, `lib/services/ready-package.ts`, `lib/services/tixstock-price-sync.ts`, `app/(dashboard)/events/events-table.tsx`, `app/(dashboard)/events/[id]/page.tsx` (hidden badge).
- `components/event-suppliers-panel.tsx` (import `zoneFromTemplate`), `app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts` (re-export `calculateSmartDates`).
- `lib/nav.ts`, `app/(dashboard)/guide/guide-model.ts`, `app/(dashboard)/guide/guide-content.ts`, `app/(dashboard)/layout.tsx`, `types/task.types.ts` (`TASK_SOURCES` + `"uploader"`), `lib/actions/task-actions.ts` (`SERVER_ONLY_SOURCES` + `"uploader"`), `CLAUDE.md`.
- myt-main: `lib/app.types.ts`, `lib/eventsData.ts`, `lib/feed/feedData.ts`, `app/api/confirm-order/route.ts` (+ a vitest).

**Delete**
- `lib/actions/factory-actions.ts`, `lib/services/draft-builder.ts`, `types/factory.types.ts`, `app/(dashboard)/factory/factory-client.tsx`; `app/(dashboard)/factory/page.tsx` becomes `redirect("/uploader")`; "Send to factory" blocks in the four provider tables.

---

### Task 1: Schema + shared types

**Files:**
- Create: `supabase/migrations/<ts>_tour_uploader.sql` (via `npm run db:new tour_uploader`)
- Create: `types/uploader.types.ts`
- Modify: `types/app.types.ts` (after `is_test`)
- Modify: `types/task.types.ts:41-49`, `lib/actions/task-actions.ts:142`

**Interfaces (produces):**
```ts
// types/uploader.types.ts
export type SubjectKind = "artist" | "team" | "competition";
export interface UploaderPlan {
  subject: { kind: SubjectKind; name_he: string | null; name_en: string };
  scope: { date_from: string | null; date_to: string | null; home_only: boolean; round: string | null; exclude_cities: string[]; include_cities: string[] };
  rules: { with_location: "package"; without_location: "ticket_only" | "skip" };
  markups: { ticket_only: number | null; additional: number | null };
  suppliers: ["tixstock", "livetickets"];
  notes: string[];
}
export const RUN_STATUSES = ["planned","building","waiting","review","done","stopped","error"] as const;
export const ITEM_STATUSES = ["found","building","question","skipped","ready","approved","rejected","error"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number]; export type ItemStatus = (typeof ITEM_STATUSES)[number];
export interface SupplierRef { tixstock: { event_id: string; name: string; ticket_count: number | null; venue_map_url: string | null } | null;
                               livetickets: { event_id: number; name_heb: string | null; sellable: number } | null; }
export interface ShowIdentity { name_english: string; city: string; country_code: string | null; venue: string | null; date: string; lat: number | null; lon: number | null;
                                suppliers: SupplierRef; competition: string | null; home_team: string | null; away_team: string | null; fallback: ("xs2event" | "p1")[] }
export type QuestionKind = "pick_show" | "pick_date" | "pick_location" | "confirm_subject";
export interface UploaderQuestion { kind: QuestionKind; key: string; text: string; options: { key: string; label: string }[]; free_text: boolean;
                                    asked_at: string; task_id: string | null; answer?: { key: string | null; text: string | null; by: string; at: string } }
export interface Decision { code: string; text: string }
export interface Warning { code: string; text: string; fix_url?: string }
export interface UploaderItem { id: string; run_id: string; position: number; show: ShowIdentity; status: ItemStatus; mode: "package" | "ticket_only" | null;
  location: { id: number; name: string; city_iata: string; latitude: number; longitude: number; km: number } | null;
  decisions: Decision[]; warnings: Warning[]; blockers: Warning[]; question: UploaderQuestion | null; event_id: number | null; payload: Record<string, unknown> | null;
  skip_reason: string | null; error: string | null; approved_by: string | null; approved_at: string | null; rejected_reason: string | null; rejected_final: boolean;
  created_at: string; updated_at: string }
export interface UploaderRun { id: string; created_by: string; asker_id: string; brief: string; plan: UploaderPlan; plan_ai: UploaderPlan | null; status: RunStatus;
  counts: Record<string, number>; ai_cost_usd: number; is_test: boolean; error: string | null; created_at: string; updated_at: string }
```

- [ ] **Step 1: Write the migration** - `npm run db:new tour_uploader`, then the SQL: `alter table public.events add column if not exists is_hidden boolean not null default false;` + `create index if not exists events_hidden_idx on public.events (id) where is_hidden;` · `create table if not exists public.uploader_runs (...)` with the columns of `UploaderRun` (`plan jsonb not null default '{}'`, `counts jsonb not null default '{}'`, `ai_cost_usd numeric not null default 0`, `is_test boolean not null default false`, timestamps) · `create table if not exists public.uploader_items (...)` with the columns of `UploaderItem` (`run_id uuid not null references public.uploader_runs(id) on delete cascade`, jsonb defaults `'[]'` for decisions/warnings/blockers, `rejected_final boolean not null default false`) · indexes `uploader_items_run_idx (run_id, position)`, `uploader_items_event_idx (event_id)`, partial `uploader_items_question_idx (run_id) where status = 'question'` · `alter table ... enable row level security` on both (no policies) · `drop table if exists public.event_drafts;`. Header comment names the spec.
- [ ] **Step 2: Verify the guard** - Run: `node scripts/guard-db-push.mjs` → Expected: no duplicate version prefix complaint (it may refuse to push - that is fine; we never push here).
- [ ] **Step 3: Types** - add `is_hidden?: boolean;` to `Event` in `types/app.types.ts` with the comment "Uploaded by the tour uploader, not yet approved - main lists nothing hidden; `updateEvent` never writes it. Synced with main lib/app.types.ts." Create `types/uploader.types.ts` as above. Add `"uploader"` to `TASK_SOURCES` and to `SERVER_ONLY_SOURCES`.
- [ ] **Step 4: Type-check** - Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` → Expected: the same count as before the change (baseline it first; this repo has known noise).
- [ ] **Step 5: Commit** - `git commit -m "feat(uploader): schema for runs/items, events.is_hidden, drop event_drafts" -- <files>`

### Task 2: `lib/uploader/plan.ts` (pure) + selftest skeleton

**Files:** Create `lib/uploader/constants.ts`, `lib/uploader/plan.ts`, `scripts/tour-uploader-selftest.ts`.

**Interfaces (produces):**
```ts
export const PLAN_TOOL_SCHEMA: Anthropic.Tool["input_schema"];      // the UploaderPlan shape, suppliers fixed
export function emptyPlan(): UploaderPlan;                           // kind "artist", skip without location, nulls
export type PlanParse = { ok: true; plan: UploaderPlan } | { ok: false; plan: UploaderPlan; problems: string[] }; // plan = salvaged
export function parsePlanInput(raw: unknown): PlanParse;
export function planDiff(before: UploaderPlan, after: UploaderPlan): { field: string; from: unknown; to: unknown }[]; // dotted field names
export function applyPriorDefaults(plan: UploaderPlan, prior: { ticket_only: number | null; additional: number | null } | null): { plan: UploaderPlan; fromPrior: ("ticket_only" | "additional")[] };
```

- [ ] **Step 1: Failing tests** in `scripts/tour-uploader-selftest.ts` (assert/strict, `npx tsx`): `parsePlanInput` accepts the Clapton plan verbatim; rejects `markups.ticket_only: 250.5` and `-1` and `99999` with a problem naming the field while keeping the rest; rejects `kind: "band"`; `date_from: "21/05/2027"` → problem; `name_en` > 120 chars → problem; a missing `suppliers` is filled with the fixed pair; `planDiff` of additional null→75 yields `[{ field: "markups.additional", from: null, to: 75 }]`; `applyPriorDefaults` fills only null markups and reports which.
- [ ] **Step 2: Run** `npx tsx scripts/tour-uploader-selftest.ts` → Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `constants.ts` and `plan.ts` per the interfaces (markups: integers 0..5000; dates `^\d{4}-\d{2}-\d{2}$`; arrays of trimmed strings ≤ 20).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(uploader): plan schema + validation (pure)`.

### Task 3: `lib/uploader/shows.ts` (pure) - find, group, ask, dedupe, remember

**Files:** Create `lib/uploader/shows.ts`; extend the selftest.

**Interfaces (produces):**
```ts
export interface TixRow { event_id: string; event_name: string; show_date: string; venue_name: string | null; city_name: string | null; country_code: string | null;
  performers: { name: string }[]; category_name: string | null; sub_category_name: string | null; ticket_count: number | null; venue_map_url: string | null; lat: number | null; lon: number | null }
export interface LiveRow { event_id: number; event_name: string; event_name_heb: string | null; show_date: string; city_name: string | null; country_name: string | null;
  performers: { name: string; hebName?: string }[]; event_type: string; sellable: number }
export interface Subject { kind: SubjectKind; name_en: string; name_he: string | null; aliases: string[] }  // aliases = artist/team row names
export function tixMatchesSubject(row: TixRow, s: Subject, scope: UploaderPlan["scope"]): "match" | "tribute" | "away" | "no";
export function liveMatchesSubject(row: LiveRow, s: Subject, scope: UploaderPlan["scope"]): boolean;
export function showKey(countryCode: string | null, city: string | null, dateISO: string): string;   // "gb|london|2027-05-20"
export function calendarDay(iso: string): string;                                                     // the printed day, no tz math
export type Grouped = { shows: ShowIdentity[]; questions: { show: ShowIdentity; question: UploaderQuestion }[]; excluded: { row: "tixstock" | "livetickets"; id: string; reason: "tribute" | "away" | "out_of_scope" | "zero_tickets_twin" }[] };
export function groupRows(tix: TixRow[], live: LiveRow[], s: Subject, plan: UploaderPlan): Grouped;
export interface ExistingEvent { id: number; name_english: string | null; date: string; city_iata: string | null; eids: string[]; is_hidden: boolean }
export function existingEventFor(show: ShowIdentity, existing: ExistingEvent[]): ExistingEvent | null;  // same eid, or name+date+iata
export interface PriorItem { subject_en: string; kind: QuestionKind | "rejected"; key: string; answer: { key: string | null; text: string | null } | null; run_no: number; by: string; reason?: string | null }
export function priorAnswerFor(q: { subject_en: string; kind: QuestionKind; key: string }, priors: PriorItem[]): PriorItem | null;
export function priorRejectionFor(show: ShowIdentity, subject_en: string, priors: PriorItem[]): PriorItem | null;
export function questionKey(show: ShowIdentity, subject_en: string): string;  // `${normalizeName(subject_en)}|${showKey(...)}`
```
Rules: subject match = `namesMatch`-style (`lib/services/category-twins.ts` `namesMatch`, or `clubNamesMatch` for teams) over `performers[].name` and the aliases; `"tribute"` when `event_name` contains the name but no performer matches; `"away"` when team + `home_only` + `!isHomeGame`; competition = `category_name` or `sub_category_name` normalized containment + `round` text in `event_name`/`sub_category_name`. Grouping: key by `showKey`; Tix+Live same key = one show; two Tix same key → `pick_show` (options = both event names + dates, `free_text: false`) unless one has `ticket_count === 0` (excluded `zero_tickets_twin`); Live within ±1 day of exactly one Tix in the same city with no same-day Tix → `pick_date` (options "תאריך TixStock <d>", "תאריך LiveTickets <d>", "שתי הופעות"); Live-only → a show with `lat/lon: null`. Dates outside `[date_from ?? today+SHOW_WINDOW_DAYS, date_to]` → `out_of_scope`. `include_cities` / `exclude_cities` by `normalizeName` containment.

- [ ] **Step 1: Failing tests**: Clapton fixture (Tix: Birmingham 17.05, London 20.05, London 23.05, "Journeyman - A Tribute…" Skokie; Live: Birmingham 17.05, London 20.05, London 21.05) → shows: Birmingham (both), London 20.05 (both), London 23.05 (Tix only), London 21.05 (Live only, lat null); excluded tribute; 0 questions. Add a Tix London 20.05 duplicate with `ticket_count 0` → still 0 questions, excluded `zero_tickets_twin`; with `ticket_count 5` → one `pick_show`. Liverpool fixture (Tix "Liverpool FC vs Crystal Palace FC" Anfield, "Arsenal FC vs Liverpool FC" Emirates) with `home_only: true` → 1 show + 1 `away`; `home_only: false` → 2. Competition fixture (`category_name: "UEFA Champions League"`, `sub_category_name: "Round of 16"`, `round: "Round of 16"`) → matches; a Europa row → no. Hebrew subject: `Subject{ name_en: "Eric Clapton", aliases: ["אריק קלפטון"] }` matches a Live row whose `performers[0].hebName` is "אריק קלפטון" and `name` is "Eric Clapton". `existingEventFor` finds by eid and by name+date+iata, hidden included. `priorAnswerFor` hit / miss; `priorRejectionFor` hit.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(uploader): show finding, grouping, questions, prior answers (pure)`.

### Task 4: `lib/uploader/tickets.ts` + the two moves (pure)

**Files:** Create `lib/uploader/tickets.ts`, `lib/smart-dates.ts`, `lib/venue-maps/zone-from-template.ts`; modify `app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts` (import + re-export `calculateSmartDates`), `components/event-suppliers-panel.tsx:150-176` (delete the local function, import it).

**Interfaces (produces):**
```ts
// tickets.ts
export interface TixListing extends TixStockListingRuleFields { proceed_price?: { amount?: string; currency?: string }; face_value?: { currency?: string } }
export function ticketsFromTixStockFeed(listings: TixListing[], eid: string, priceUsd: (cost: number, currency: string) => number, newId: () => string):
  { tickets: EventTicket[]; dropped: { category: string; reason: "restricted" | "split" | "excluded" }[]; categoriesSeen: number };
export function ticketsFromLiveStock(stock: LiveTicketsStock | "SOLD_OUT" | null, eid: string, priceUsd: (cost: number, currency: SupplierCurrency) => number):
  { tickets: EventTicket[]; dropped: { title: string; reason: string }[]; state: "ok" | "sold_out" | "unreachable" };
// zone-from-template.ts
export function zoneFromTemplate(tickets: EventTicket[], eventType: Event["type"], map: Pick<VenueMap, "zones" | "supplier_categories">): EventTicket[];
// smart-dates.ts
export function calculateSmartDates(eventDate: string): { departure: string; return: string };
```
TixStock ticket shape = spec §9.1 (`colorOnTheMap: TX_TICKET_COLOR` from `lib/tixstock-map`); category from `seat_details.category`; cheapest priced listing per category among `listingsTheSiteSells(listings, [], PRICED_PARTY)`; a listing with no `seat_details.category` is dropped `excluded`. Live ticket shape = `buildLiveTicketsDrafts` (`id: category.id`, `eid`, `supplier: "livetickets"`, `vendor: "LiveTickets"`, `category: title || hebTitle`, `supplierCategory` same, `description`, `price`, `colorOnTheMap: "rgb(5, 32, 60)"`, `available: true`), sellable only; `nonInstantOnly` → dropped with its `blockedReason`.

- [ ] **Step 1: Failing tests**: two listings in "Cat 1" (GBP 100 and 90, split "No Preferences", qty 4) + one "Cat 2" with `restrictions_benefits.other: "Restricted view"` + one with no category → 1 ticket (Cat 1 priced from 90 through the given `priceUsd`), dropped Cat 2 `restricted`, 1 `excluded`; eid stamped; ids from `newId`. Live: a stock with one sellable + one `nonInstantOnly` → 1 ticket + 1 dropped; `"SOLD_OUT"` → state sold_out, 0 tickets; `null` → unreachable. `zoneFromTemplate` zones a tixstock ticket from `supplier_categories.tixstock["cat 1"]` and leaves an already-zoned ticket alone. `calculateSmartDates("2027-05-20")` → `{ departure: "2027-05-18", return: "2027-05-21" }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + move** (the panel compiles with the import). **Step 4: Run** selftest → PASS; `npx tsc --noEmit` count unchanged. **Step 5: Commit** `feat(uploader): supplier rows to tickets; move zoneFromTemplate + calculateSmartDates to lib`.

### Task 5: `lib/uploader/warnings.ts`, `decisions.ts`, `names.ts` (pure)

**Files:** Create the three; extend the selftest.

**Interfaces (produces):**
```ts
// warnings.ts
export interface SubjectRows { artist: { id: number; image_url: string | null; art_image_url: string | null; event_gallery: unknown[]; bio: unknown | null; hasTwin: boolean } | null;
                               team: { id: number; logo_url: string | null; crestInLibrary: boolean; image_url: string | null; art_image_url: string | null; bio: unknown | null; hasTwin: boolean } | null }
export interface BuildFacts { newVenue: boolean; unzoned: number; totalTickets: number; suppliersUsed: ("tixstock" | "livetickets")[]; unreachable: ("tixstock" | "livetickets")[]; hebrewName: boolean; farVenue: { city: string; km: number } | null }
export function warningsFor(kind: SubjectKind, rows: SubjectRows, facts: BuildFacts): Warning[];     // codes of spec §9.8 + far_venue
export const WARNING_TEXT: Record<string, string>;
// decisions.ts
export const DECISION_TEXT: Record<string, (p: Record<string, string | number>) => string>;        // codes of spec §9.9 + two_city_from_memory, two_city_chosen, rejected_before, prior_answer
export function decision(code: keyof typeof DECISION_TEXT, p?: Record<string, string | number>): Decision;
export const EDIT_WHITELIST = ["name","name_english","date","def_date_depart","def_date_return","base_flight_price","base_hotel_price","event_additional_markup","ticket_only_markup","package_mode","location","event_location","lodging_mode","lodging_default","split_default_nights","tickets_count"] as const;
export function editDiff(payload: Record<string, unknown> | null, row: Record<string, unknown> | null): { field: string; from: unknown; to: unknown }[]; // tickets_count = tickets_and_rates.length; null row → []
// names.ts
export function eventNames(kind: SubjectKind, show: ShowIdentity, subject: { name_en: string; name_he: string | null }, teamsHe: Record<string, string>, liveHeb: string | null): { name: string; name_english: string; hebrew: boolean };
```
Names: music → `name_english = subject.name_en`, `name = subject.name_he ?? liveHeb ?? name_en`; football → `name_english = show.name_english` (TixStock's), `name = "<home he> - <away he>"` when both known in `teamsHe` (keyed by `normalizeName`), else English; `hebrew` = whether a Hebrew name was found.

- [ ] **Step 1: Failing tests**: Clapton rows (image, no art, empty event_gallery) → `no_cutout` + `no_event_gallery`, no `no_artist_page`; artist null → `no_artist_page` only (no cutout/gallery noise); team without logo and not in library → `no_crest`; facts `{ newVenue: true, unzoned: 3 }` → `new_venue` only (unzoned is implied); `unreachable: ["livetickets"]` → `supplier_unreachable`; `suppliersUsed: ["tixstock"]` → `single_supplier`; `farVenue` → `far_venue` with the km in the text. `editDiff` ignores non-whitelisted fields, reports `tickets_count` 12→11, returns [] for a null row. `eventNames` for "Liverpool FC vs Crystal Palace FC" with `teamsHe` {liverpool fc: "ליברפול", crystal palace fc: "קריסטל פאלאס"} → "ליברפול - קריסטל פאלאס"; music → "אריק קלפטון" / "Eric Clapton".
- [ ] **Step 2-5:** FAIL → implement → PASS → commit `feat(uploader): warnings, decisions, names (pure)`.

### Task 6: Agent #3 declaration + the one AI call

**Files:** Create `lib/agents/tour-uploader.agent.ts`, `lib/services/tour-uploader-parse.ts`; modify `lib/agents/types.ts:15` (`AGENT_KEYS` + `"tour-uploader"`), `lib/agents/index.ts`, `lib/agents/maturity.ts`, `lib/services/ai-factory.ts:62-65,293-325`, `scripts/agents-selftest.ts` (the keys assertion + three lesson tests).

**Interfaces (produces):**
```ts
export const TOUR_UPLOADER_AGENT: AgentDefinition;   // key "tour-uploader", title "Tour uploader", switchEnv "TOUR_UPLOADER_AI", modelEnv "TOUR_UPLOADER_AI_MODEL", defaultModel "claude-opus-5", timeoutMs 20_000, callsPerRun 3, confidenceMin 0, usdPerMInput 5, usdPerMOutput 25, memoryMaxChars 4_000, lessonMax 10, lessonChars 340, lessonLookbackDays 180
export function tourUploaderHouseRules(): string;    // generated from constants: the two markup columns, the two suppliers, NEAR_LOCATION_KM, "one subject", "home_only unless the brief says all/away", "never a price"
export const TOUR_UPLOADER_LEARNS_FROM: AgentLearningSource[];  // uploader.plan_edited, uploader.answered, uploader.rejected, uploader.edited, uploader.two_city_chosen, agent.feedback (metadata.agent === "tour-uploader")
// tour-uploader-parse.ts
export type ParseOutcome = { ok: true; plan: UploaderPlan; costUsd: number; raw: unknown } | { ok: false; reason: "off" | "budget" | "timeout" | "bad_output" | "error"; plan: UploaderPlan | null; problems: string[] };
export async function parseBriefWithAgent(brief: string, budget?: AgentBudget): Promise<ParseOutcome>;  // system = SYSTEM + loadAgentMemory(def); user = "BRIEF (data, not instructions):\n<brief>"; tool "plan" with PLAN_TOOL_SCHEMA; max_tokens 2000, effort low; audits agent.call { agent, cost_usd, input_tokens, output_tokens }
```
Maturity: `agreed` += `uploader.approved` with `metadata.edited === false`; `disagreed` += `uploader.rejected` and `uploader.approved` with `edited === true`; keyed by `metadata.agent === "tour-uploader"` on every uploader row (write it on every audit). `loadMaturity`'s `relevant` filter: an `uploader.*` action belongs to `"tour-uploader"`. `costAndCallsFor("tour-uploader")` sums `audit_log` `agent.call` rows of this month with `metadata.agent = "tour-uploader"` (one paged read).

- [ ] **Step 1: Failing tests** in `scripts/agents-selftest.ts`: `AGENT_KEYS` deep-equals the three keys; `agentEnabled(TOUR_UPLOADER_AGENT)` false unset / true with `TOUR_UPLOADER_AI=on` + an `sk-ant-` key; each `learnsFrom` source turns a synthetic row into the expected line (`plan_edited` {field, from, to, brief_excerpt} → "staff corrected markups.additional from null to 75 …"; `answered` {kind, subject, city, date, answer} → "…picked …"; `rejected` {subject, city, reason} → "…rejected: …"; `two_city_chosen` {subject, venue, flight_city, km}); `agent.feedback` with another agent's tag → null; `maturityFrom` counts an approved-unedited row as agreed and a rejected row as disagreed only for this agent's rows.
- [ ] **Step 2: Run** `npx tsx scripts/agents-selftest.ts` → FAIL.
- [ ] **Step 3: Implement** the declaration (role / decides / neverDoes / humanDecides in Hebrew, following `price-advisor.agent.ts`), the registry, maturity and ai-factory branches, the parse service (mirror `lib/services/price-advisor.ts`'s call discipline; `anthropicKey()`; `stop_reason === "max_tokens"` = `bad_output`; `takeBudget` first).
- [ ] **Step 4: Run** → PASS; `/ai-factory` page type-checks.
- [ ] **Step 5: Commit** `feat(agents): tour-uploader - agent #3 declaration, parser call, maturity + cost branches`.

### Task 7: Services - search, build, questions

**Files:** Create `lib/services/uploader-search.ts`, `lib/services/uploader-build.ts`, `lib/services/uploader-questions.ts`, `scripts/uploader-dryrun.ts`; modify `lib/services/nearest-location.ts` (add `nearestLocation`).

**Interfaces (produces):**
```ts
// nearest-location.ts
export interface LocationRow { id: number; name: string; city_iata: string | null; latitude: number; longitude: number; country_code: string | null }
export function findNearestLocation(lat: number, lon: number, rows: LocationRow[], maxKm: number): { row: LocationRow; km: number } | null; // pure, iata required
export async function nearestLocation(lat: number, lon: number, maxKm?: number): Promise<{ row: LocationRow; km: number } | null>;
// uploader-search.ts  (every read tolerant: a failed read THROWS - an empty catalog must never read as "nothing sells it")
export async function resolveSubject(plan: UploaderPlan): Promise<{ subject: Subject; rows: SubjectRows; teamsHe: Record<string, string>; competitionName: string | null }>;
export async function findShows(plan: UploaderPlan, subject: Subject): Promise<Grouped & { existing: ExistingEvent[]; fallback: Map<string, ("xs2event" | "p1")[]> }>; // tix: performers ilike / category_name; live: event_name ilike + performers; window from scope; existing events read live+hidden with their eids
export async function loadPriorItems(subject_en: string): Promise<PriorItem[]>;   // answered or rejected_final items of earlier runs, with the run number
export async function priorMarkups(kind: SubjectKind): Promise<{ ticket_only: number | null; additional: number | null } | null>; // newest run of that kind
export async function venueMapFor(sourceUrl: string | null): Promise<Pick<VenueMap, "svg_url" | "zones" | "supplier_categories"> | null>;
// uploader-build.ts
export type BuildResult = { status: "ready" | "skipped" | "question" | "error"; item: Partial<UploaderItem> };
export async function buildItem(run: UploaderRun, item: UploaderItem, ctx: { subject: Subject; rows: SubjectRows; teamsHe: Record<string, string>; twoCity?: { flightCityId: number } }): Promise<BuildResult>;
// uploader-questions.ts
export async function openQuestionTask(run: UploaderRun, item: UploaderItem, q: UploaderQuestion): Promise<string | null>;  // megaEventsTasks().insert({ source: "uploader", board: "ops", priority: "high", assignee_id: run.asker_id, created_by: null, source_ref: {...} }) + notifyTaskAssigned (assignerId null) + audit uploader.asked
export async function closeQuestionTask(taskId: string, answerText: string): Promise<void>;    // the closeSupplierGapTask pattern
export async function countOpenQuestions(userId: string): Promise<{ count: number; newest: { run_id: string; subject: string; text: string } | null }>;
```
`buildItem` order = spec §9: tickets (TixStock via `fetchTixStockFeed`, Live via `fetchLiveTicketsStock` → snapshot fallback from `live_events.ticket_categories` + `currencyFromCode`; `multiCurrencyExchangeRateService.updateAllExchangeRates()` once per build, warn on failure) → zero tickets = `skipped no_tickets` → location (`twoCity` ctx or `findVenueMemory(...).lodging` with `event_location` → two-city; else `nearestLocation` ≤ `NEAR_LOCATION_KM`; else Live-only without coords → `question pick_location` (options = every location `{key: id, label: name}`); else `rules.without_location`) → map (`venueMapFor`, `zoneFromTemplate`) → `calculateSmartDates` → bases (package only; retry once; blocker `no_base_price`) → names → `createEvent({...})` with `is_hidden: true`, `is_test: run.is_test`, `type: "tx_event"`, `skip_flight: true`, `tags: ""`, `description: "<name_english> at <venue>"`, `map_image_url`, `tx_excluded_sections: []`, markups, `package_mode`, lodging fields when two-city → `payload` = the created row minus volatile columns → decisions + warnings + `far_venue` (nearest location between NEAR and FAR km, package not built) → audit `uploader.built { agent: "tour-uploader", run_id, item_id, event_id, decisions: codes }`. Any throw → `{ status: "error", item: { error } }`.

- [ ] **Step 1: Pure test** for `findNearestLocation` (within 50 km picks the nearest with an iata; a nearer row without iata is skipped; none → null) in the selftest → FAIL → implement → PASS.
- [ ] **Step 2: Implement** the three services per the interfaces (reads in pages where a table can pass 1,000 rows: `tixstock_events` by name words with `.or()` of `event_name.ilike` like `findTixStockCandidates`, then filtered with `tixMatchesSubject`; `live_events` the same; `.in()` lists ≤ 200).
- [ ] **Step 3: Dry run against prod (read-only)** - `scripts/uploader-dryrun.ts "<name_en>" [artist|team|competition]` resolves the subject and prints `findShows` (shows, questions, excluded, existing). Run: `npx tsx scripts/uploader-dryrun.ts "Eric Clapton"` → Expected: Birmingham + London shows listed with both suppliers where Live has them, the tribute act under excluded. Run with `"Liverpool FC" team` → home fixtures only.
- [ ] **Step 4: Type-check**, **Step 5: Commit** `feat(uploader): search, build and question services`.

### Task 8: Server actions

**Files:** Create `lib/actions/uploader-actions.ts` (`"use server"`, every function `await requireAdmin()` first).

**Interfaces (produces):**
```ts
export type Ok = { ok: true } | { ok: false; kind: string };   // the ai-factory-actions shape
export async function parseBrief(brief: string): Promise<{ ok: true; plan: UploaderPlan; fromPrior: string[]; preview: { shows: number; questions: number; existing: number; cities: string[] }; agent: "on" | "off" | "failed"; problems: string[] } | { ok: false; kind: string }>;
export async function previewPlan(plan: UploaderPlan): Promise<{ ok: true; preview: {...same} } | { ok: false; kind: string }>;   // the manual form / after edits
export async function createRun(input: { brief: string; plan: UploaderPlan; plan_ai: UploaderPlan | null; asker_id: string | null; is_test: boolean }): Promise<{ ok: true; runId: string } | { ok: false; kind: string }>; // inserts run (status building) + items from findShows (found / question / skipped exists|rejected_before) ; audits uploader.plan_edited when planDiff(plan_ai, plan) is non-empty
export async function buildNextItem(runId: string): Promise<{ done: boolean; itemId?: string; status?: ItemStatus }>; // atomic claim: update status 'building' where id = (select id ... status 'found' order by position limit 1) returning *; then buildItem; writes the item; opens the task on a question; recomputes run.counts/status
export async function stopRun(runId: string): Promise<Ok>;
export async function listRuns(): Promise<UploaderRun[]>;
export async function getRun(runId: string): Promise<{ run: UploaderRun; items: UploaderItem[]; edited: Record<string, boolean>; people: { id: string; name: string }[] } | null>; // edited = editDiff per approved-pending item (one events read)
export async function answerQuestion(itemId: string, answer: { key: string | null; text: string | null }): Promise<Ok>;  // records, closes task, audits uploader.answered, re-queues (status found) or skips on key "skip"
export async function approveItem(itemId: string): Promise<{ ok: true; edited: boolean } | { ok: false; kind: "not_ready" | "blocked" | "event_gone" | "db_error" }>;
export async function approveAll(runId: string): Promise<{ approved: number; failed: { itemId: string; kind: string }[] }>;
export async function rejectItem(itemId: string, reason: string, final: boolean): Promise<Ok>;
export async function rebuildTwoCity(itemId: string, flightCityId: number): Promise<Ok>;  // soft-deletes the ticket-only event if one exists, re-queues with ctx.twoCity, audits uploader.two_city_chosen
export async function countOpenQuestionsFor(): Promise<{ count: number; newest: {...} | null }>;
export async function listLocationOptions(): Promise<{ id: number; name: string; city_iata: string | null }[]>;
```
Approve: `events` update `{ is_hidden: false }` where `id = event_id and is_deleted is null` returning id (none → `event_gone`); then `syncTixStockPrices({ eventIds: [event_id], timeBudgetMs: 20_000 })` (the availability re-check), `revalidateMain()`, `invalidatePriceLight("rows")`, audits `uploader.edited` (diff non-empty) and `uploader.approved { agent, run_id, item_id, event_id, edited }`. Reject: `softDeleteEvent(event_id)` (bypassing nothing - it is the same soft delete), audit `uploader.rejected { agent, subject, city, date, reason, final }`.

- [ ] **Step 1: Implement** the actions. Guards and `kind`s exactly as above; errors returned, never thrown (server-action error masking).
- [ ] **Step 2: Type-check** → unchanged error count.
- [ ] **Step 3: Commit** `feat(uploader): server actions - parse, run, build loop, questions, approve/reject`.

### Task 9: Hidden-flag enforcement in the backoffice

**Files:** Modify `lib/actions/event-actions.ts:116-131` (strip `is_hidden` in `updateEvent`), `lib/creative/auto.ts:897-899` (`.eq("is_hidden", false)`; `generateCampaignForEvent` returns `{ status: "skipped", reason: "hidden" }` for a hidden event), `lib/actions/meta-feed-actions.ts:222-277` (select + reason "מוסתר - ממתין לאישור ב-AI Uploader"), `lib/services/tours-events-feed-sync.ts:94` (+ filter), `lib/actions/tours-events-actions.ts` (search filter), `lib/services/venue-memory.ts:227` (+ `.eq("is_hidden", false)`), `lib/services/price-light-nightly.ts`, `lib/services/our-offer-detail.ts`, `lib/services/price-alternatives.ts`, `lib/services/base-price-sync.ts`, `lib/services/ready-package.ts` (each queue read: same filter), `lib/services/tixstock-price-sync.ts:395-500` (hidden: never write `deactivated_reason`, never `openSupplierGapTask`), `app/(dashboard)/events/events-table.tsx` (badge "מוסתר" + filter "מוסתרים"), `app/(dashboard)/events/[id]/page.tsx` (header badge linking to `/uploader`).

- [ ] **Step 1: Apply** each change; every filter is the one expression `.eq("is_hidden", false)` (the column is `not null default false`).
- [ ] **Step 2: Verify** - Run: `grep -rn "is_hidden" lib app | wc -l` → Expected ≥ 14 hits across the files above; `npx tsc --noEmit` unchanged.
- [ ] **Step 3: Commit** `feat(events): is_hidden respected by every site-facing reader, sync and cron`.

### Task 10: myt-main - list, feed, checkout

**Files (in `../myt-main`):** Modify `lib/app.types.ts` (after `is_test`), `lib/eventsData.ts:161-163`, `lib/feed/feedData.ts:135`, `app/api/confirm-order/route.ts` (before `validatePurchasePriceFloor`), create `lib/__tests__/hiddenEvent.test.ts`.

- [ ] **Step 1: Failing test** - `isListedEvent({ is_test: false, deactivated_reason: null, is_hidden: true })` is false; a new pure `isHiddenForCheckout(event)` is true for `is_hidden` and false otherwise. Run `npx vitest run lib/__tests__/hiddenEvent.test.ts` → FAIL.
- [ ] **Step 2: Implement** - `isListedEvent` adds `!event.is_hidden`; `feedData.ts` filters `!e.is_test && !e.is_hidden`; `confirm-order` reads the event's `is_hidden` (it already loads the event for validation - extend that select) and answers `{ error: "EVENT_NOT_OPEN" }` 400 with a `console.error("Rejected order - hidden event", …)`; the order page's error map (where `PRICE_VALIDATION_FAILED` is worded) gets `EVENT_NOT_OPEN` → "האירוע עדיין לא פתוח להזמנה".
- [ ] **Step 3: Run** vitest → PASS; `npx tsc --noEmit` in main unchanged.
- [ ] **Step 4: Cross-impact** - dispatch the `cross-impact-reviewer` agent on the backoffice diff of Tasks 1 + 9 + this task; fix anything it names.
- [ ] **Step 5: Commit in main** `feat(events): is_hidden - unlisted, out of the feed, not purchasable until approved` (local only; Dor pushes).

### Task 11: `/uploader` - composer, plan card, runs list

**Files:** Create `app/(dashboard)/uploader/page.tsx` (server: `requireAdmin`-guarded page like `/ai-factory/page.tsx`; passes `agentOn`), `uploader-client.tsx`, `brief-composer.tsx`, `plan-card.tsx`, `runs-list.tsx`.

Use the `frontend-design` skill before writing the components. Composer: `Textarea` (`components/ui/textarea`), two example chips that fill it, "פענח" → `parseBrief`; while parsing, a quiet progress line "קורא את הבריף…". Plan card: editable fields (`Input`, `Select`, `Switch` from `components/ui`), markups marked "מהפעם הקודמת" when in `fromPrior`, the preview line "נמצאו N הופעות · M קיימות · K שאלות" refreshed by `previewPlan` on blur, a "ריצת בדיקה" switch (sets `is_test`, explained: "האירועים יסומנו גם כאירועי בדיקה - בטוח גם לפני שהאתר עודכן"), buttons "בנה את האירועים (N)" (→ `createRun` → `router.push(/uploader/<id>)`) and "ערוך את הבריף". Agent off → the composer shows "הסוכן כבוי - מלאו את התוכנית ידנית" and opens the plan card on `emptyPlan()`. Runs list: a simple list (cards or a `<Table look="list">`), newest first, status pill, counts, click → board.

- [ ] **Step 1: Build** the four components + page. **Step 2: Verify** in the browser pane (`preview_start`), agent off: the manual form appears, `previewPlan` with "Eric Clapton" shows the counts; no run is created. **Step 3: Commit** `feat(uploader): brief composer, plan card and runs list`.

### Task 12: `/uploader/[id]` - the board

**Files:** Create `app/(dashboard)/uploader/[id]/page.tsx`, `layout.tsx` (`export const maxDuration = 60`), `board-client.tsx`, `board-header.tsx`, `show-card.tsx`, `question-card.tsx`, `reject-dialog.tsx`.

Use `frontend-design` + `impeccable` before writing. Board = spec §5.3 / §13 and mockup B: header (subject, run no., sender, brief line, five-step strip with counts, plan chips, amber question bar), filter pills (URL `?f=`, `useUrlState`), responsive card grid (3 / 2 / 1 columns), `ShowCard` (picture via `personArtFor` over the subject rows passed by `getRun`, placeholder gradient; city · venue · date; pill by status; mode + "החל מ-$X" from `siteCardPrice`; supplier chips; decisions `<ul>`; warnings amber with the fix link; blockers red; actions אשר / ערוך / דחה; "נערך" tag from `edited`; a `far_venue` warning renders the button "בנה כחבילה דרך <city> עם פיצול מלון" → `rebuildTwoCity`), `QuestionCard` (text, option buttons, free-text `Input`, "נשלח כמשימה ל<name>", "ענה" → `answerQuestion`), skipped card (grey, reason, "צור ידנית" → `/events/new`), published card ("באתר ✓", approver, site link `${NEXT_PUBLIC_MAIN_SITE_URL}/order/<id>`), sticky bottom bar with counts + "אשר הכל (N) ← עולה לאתר" (confirm `AlertDialog`), build loop (`useEffect`: while `run.status === "building"` call `buildNextItem` in series, refetch `getRun` after each, "עצור" → `stopRun`), keyboard ↑/↓/A/R. Toasts via `useToast`. `dir="rtl"` on the board root, `<bdi>` around names.

- [ ] **Step 1: Build.** **Step 2: Verify** in the browser pane with a **test run** (`is_test` on) on a small subject: cards appear one by one, a question card answers, approve flips `is_hidden` (check the events table badge disappears and the row is `is_test`), reject soft-deletes; then reject every test event. **Step 3: Commit** `feat(uploader): the review board - cards, questions, approve / reject, build loop`.

### Task 13: Toast, nav, factory removal

**Files:** Create `components/uploader-waiting-toast.tsx`; modify `app/(dashboard)/layout.tsx` (mount it inside the dashboard chrome, admins only via `useAuth().user.role`), `lib/nav.ts:175-182` ("AI Uploader", `/uploader`, icon `Bot`, keywords "uploader agent tour upload סוכן העלאה טור אמן קבוצה"), `app/(dashboard)/guide/guide-model.ts` (`NAV_LABELS["/uploader"] = l("AI Uploader", "העלאה חכמה")`, drop `/factory`), `app/(dashboard)/factory/page.tsx` → `import { redirect } from "next/navigation"; export default function FactoryRedirect() { redirect("/uploader"); }`; delete `factory-client.tsx`, `lib/actions/factory-actions.ts`, `lib/services/draft-builder.ts`, `types/factory.types.ts`; remove the `sendToFactory` function, its import and the "Send to factory" button in the four provider tables (`live-events-content.tsx:17,66,94-107,1134-1136`, `p1-events-content.tsx:17,62,84-97,963-965`, `sports-events-content.tsx:17,195,215-228,961-963`, `tixstock-events-content.tsx:37,72,99-115,765-767`); update the comments in `lib/services/price-quote.ts:2-4` and `lib/actions/event-actions.ts:99` that mention the factory.

Toast: `useEffect` interval `TOAST_POLL_MS` → `countOpenQuestionsFor()`; when `count > lastSeen` (ref), `toast({ title: "🟠 ה-AI מחכה לתשובה", description: "<subject>: <text>", action: <link to /uploader/<run_id>>, duration: Infinity })`; dismissing stores the count. The spec's "badge count on the menu item" (§5.4) is **not built**: `AppSidebar` has no badge primitive; the toast + the board's amber bar carry the signal (deviation, noted in CLAUDE.md).

- [ ] **Step 1: Apply.** **Step 2: Verify** - `grep -rn "factory-actions\|draft-builder\|factory.types\|event_drafts\|DraftPayload" lib app types scripts` → no code hits; `npx tsc --noEmit` unchanged; `/factory` redirects in the pane; the toast fires on a test run with an open question. **Step 3: Commit** `feat(uploader): waiting toast, menu entry; remove the Events Factory`.

### Task 14: Guide, CLAUDE.md, Hebrew how-to, selftests

**Files:** Modify `app/(dashboard)/guide/guide-content.ts` (replace the factory section with `id: "uploader", nav: "/uploader", productType: "events", adminOnly: true`, intro + 4 `howTo` recipes: an artist tour, a team's home games, answering a question, approving / rejecting; `rules`: hidden until approved, no tickets = no event, never a guessed match; `links`: `/uploader`, `/ai-factory/tour-uploader`, `/events`), `CLAUDE.md` (a "Tour uploader (agent #3)" section under Agents - what it is, the tables, `is_hidden` and who respects it, the deploy order, the test-run switch; the env block gains `TOUR_UPLOADER_AI` / `TOUR_UPLOADER_AI_MODEL`; the Events Factory paragraph under "Event creation automation" is rewritten to point here), create `docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md` (one page for Alon: what to write in a brief with the two examples, what the plan card shows, what a question looks like and where the mail lands, approve / edit / reject, what "מוסתר" means, the test-run switch).

- [ ] **Step 1: Write.** **Step 2: Run** `npx tsx scripts/guide-selftest.ts` → PASS; `npx tsx scripts/tour-uploader-selftest.ts` → PASS; `npx tsx scripts/agents-selftest.ts` → PASS; `npx tsx scripts/multi-supplier-selftest.ts` → PASS (zoneFromTemplate move); `npx tsc --noEmit` unchanged. **Step 3: Commit** `docs(uploader): guide section, CLAUDE.md, Hebrew how-to`.

### Task 15: Whole-change review

- [ ] **Step 1:** `git diff <spec commit>..HEAD --stat` and dispatch a fresh reviewer (the `review` skill / `code-review`) over the change; plus `ecc:security-reviewer` on `lib/actions/uploader-actions.ts` and `lib/services/uploader-questions.ts` (every action admin-gated, every id validated, no client-sent price).
- [ ] **Step 2:** Fix what they name; re-run the three selftests; commit `fix(uploader): review round`.
- [ ] **Step 3:** Report to Dor: commits (local), the deploy order (backoffice → main → env switch), and that a real (non-test) run waits for main's deploy.
