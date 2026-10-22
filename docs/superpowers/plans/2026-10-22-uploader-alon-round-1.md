# Tour Uploader - round "אלון 1" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The uploader board handles run-level facts once (a panel with one action each), classifies a new venue's TixStock categories into Hebrew zones + descriptions by an AI proposal a person confirms once (or learns them from one hand-fixed event), creates missing teams inactive from confirmed Hebrew names, names events by the rule ours → LiveTickets → ask once per run, and lets one answer rule the run's similar questions.

**Architecture:** Every rule is pure in `lib/uploader/*` (selftested in `scripts/tour-uploader-selftest.ts`); two new AI calls copy `parseBriefWithAgent`'s discipline in `lib/services/tour-uploader-classify.ts`; five new server actions in `lib/actions/uploader-actions.ts` write through the existing venue-map actions, direct column updates and audit rows; the board gains a panel, two dialogs and a checkbox. The venue template (`venue_maps`) gains a zone description and a dropped-categories list; `uploader_runs` gains the names task id. Nothing changes on myt-main.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service role; `venue_maps` / uploader tables through the repo's `db = supabase as any` boundary cast), shadcn/ui, `@anthropic-ai/sdk`, `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md` (builds on `docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md`)

## Global Constraints

- Work on `master` in the shared checkout; conventional commits BY EXPLICIT PATHS (`git add <files>` then `git commit -- <files>`, never a bare `git add .`); **never push**; no AI co-author line; one migration, idempotent SQL, `npm run db:new <name>` from master.
- Repo hooks: the first Write/Edit of a file in a turn is refused by GateGuard until you state its facts (callers, purpose, data shape, the instruction) - state them in text and retry the same call; `rm -rf` is blocked (use the Write/Edit tools or PowerShell `Remove-Item`); an edited `.ts` file is lint/tsc-checked on stop - fix what it reports.
- Every new server action starts with `await requireAdmin()`, validates input BEFORE any read, and returns `{ ok: false, kind }` - never throws (Next masks thrown action errors in production).
- The AI never writes a price, never removes a ticket, never creates a team or template on its own; both new calls are the agent `tour-uploader` (switch `TOUR_UPLOADER_AI`), forced non-strict tool, `output_config: { effort: "low" }`, `timeoutMs: 20_000`, `maxRetries: 0`, every failure a typed outcome; no price, listing or URL in the prompt; staff text only inside `LESSONS_OPEN` … `LESSONS_CLOSE`.
- The AI never fetches, picks or attaches a picture; a created team / artist row has no `logo_url`, `image_url`, `art_image_url`, gallery - and is `is_active: false`, inserted WITHOUT `ensurePersonTaxonomy`.
- Caps: zone label ≤ 40, zone / ticket description ≤ 160, team `name_he` ≤ 60 (must contain a Hebrew letter `[א-ת]`), `name_en` ≤ 80, a LiveTickets event name ≤ 120 (Hebrew letter required). Drop words (word-bounded, lower-cased): `away`, `visitor`, `visitors`, `visiting`.
- Template keys are `normalizeSupplierCategory(category)`; `dropped_categories` = `{ tixstock: string[], tixstock_kept: string[] }`; `zones[].description` optional string.
- The per-person AI cap is the parse's: `countRecentParses(session.sub, PARSE_RATE_WINDOW_MS) >= PARSE_RATE_MAX` → `rate_limited`, checked by the ACTION before the call; the `agent.call` row carries `user_id`.
- Hebrew copy exactly as the spec quotes it (§5.1-5.5 tables and buttons).

## Review Focus

1. A LiveTickets `event_name_heb` that is Latin text (they sometimes fill it with the English name) - the rule must NOT take it as Hebrew; the show falls to English + the run's names task (Task 3 test `eventNames: a latin livetickets name is no hebrew name`).
2. Two TixStock categories that normalize to one key ("Cat 1" / "CAT-1") across the venue's shows - ONE dialog row, one zone, one template entry (Task 2 test `proposalRows: categories sharing a key collapse to one row`).
3. `classifyVenue` confirmed twice (two admins, or a second confirm after a partial write) - the second run merges over the template: the same zone id for the same key, no duplicate zones, a person's earlier Hebrew label kept (Task 2 test `templateFromRows: a second confirm reuses zone ids and keeps a hebrew label`).
4. A TixStock drawing replaced by a new season's file (`venue_map_url` differs from every `source_url` we hold) - it is a NEW venue row, never merged into the old template by name (Task 4 test `runLevelRows: venues group by the exact drawing url`; `readVenueTemplate` looks up by `urlSpellings` of the exact URL only).
5. "Apply to similar" when a sibling question was answered meanwhile - the sibling's status is no longer `question`, so `applyRuleTo` answers null and the loop skips it; `applied` counts successes only (Task 4 test `applyRuleTo: an answered sibling gets no key`; Task 8 loop rule).

---

## File structure

**Create**
- `supabase/migrations/<ts>_uploader_alon_round_1.sql` - `venue_maps.dropped_categories`, `uploader_runs.names_task_id`.
- `lib/uploader/classify.ts` - drop rule, drawing categories, proposal rows, template from rows / from event, apply, diff, fixed-by-hand.
- `lib/uploader/team-names.ts` - missing sides, club-name cleaning, name parsing, missing Hebrew names.
- `lib/uploader/run-panel.ts` - run-level codes, panel rows, card fold.
- `lib/services/tour-uploader-classify.ts` - the two AI calls + their prompts.
- `app/(dashboard)/uploader/[id]/run-panel.tsx`, `classify-dialog.tsx`, `names-dialog.tsx`, `learn-confirm.tsx` - the panel, the two dialogs, the learn confirm.

**Modify**
- `lib/venue-maps/svg-zones.ts` (`VenueZone.description`, export `isUnsellableCategory`), `lib/venue-maps/zone-from-template.ts` (copy description), `lib/services/uploader-prior.ts` (`zonesOf` carries description), `lib/actions/venue-map-actions.ts` (`sanitizeZones` keeps description; `fetchSupplierSvg` factored out of `adoptVenueMap`).
- `lib/uploader/names.ts` (LiveTickets fallback + `source`), `lib/uploader/run-rules.ts` (`runRuleOf`, `applyRuleTo`, `EDIT_EVENT_COLUMNS` + `map_image_url`), `lib/uploader/warnings.ts` (`all_dropped`, the "לבדיקה" unzoned text), `lib/uploader/decisions.ts` (new codes), `types/uploader.types.ts` (`names_task_id`), `lib/uploader/action-types.ts` (`RunBoard.fixedByHand`, result types).
- `lib/agents/memory.ts` (`sources` filter), `lib/agents/tour-uploader.agent.ts` (two sources + the `rule_applied` suffix), `scripts/agents-selftest.ts`.
- `lib/services/uploader-build.ts` (step 4 through `applyClassification`; names rule), `lib/services/uploader-questions.ts` (`openNamesTask`, `closeNamesTask`), `lib/services/uploader-store.ts` (template / event / run helpers), `lib/actions/uploader-actions.ts` (five actions, `answerQuestion` option, `getRun`, `createRun`).
- `lib/actions/football-actions.ts`, `lib/actions/artist-actions.ts` (inactive create without taxonomy; taxonomy on activation).
- `app/(dashboard)/uploader/[id]/board-client.tsx`, `board-words.ts`, `card-shell.tsx` (fold), `show-card.tsx` (learn button), `question-card.tsx` (checkbox), `app/(dashboard)/uploader/copy.ts` (error kinds).
- `components/event-suppliers-panel.tsx` (zone description box).
- `app/(dashboard)/guide/guide-content.ts`, `CLAUDE.md`, `docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md`.
- `scripts/tour-uploader-selftest.ts` (new sections per task).

---

### Task 1: Schema, zone description plumbing, run column

**Files:**
- Create: `supabase/migrations/<ts>_uploader_alon_round_1.sql`
- Modify: `lib/venue-maps/svg-zones.ts:13-20`, `lib/venue-maps/zone-from-template.ts`, `lib/services/uploader-prior.ts:119-131`, `lib/actions/venue-map-actions.ts:40-63` (`sanitizeZones`), `types/uploader.types.ts` (`UploaderRun`), `lib/uploader/run-rules.ts:353` (`EDIT_EVENT_COLUMNS`)
- Test: `scripts/tour-uploader-selftest.ts` (new section `// ---- Round אלון 1, Task 1: zone description`)

**Interfaces:**
- Produces: `VenueZone = { id: string; label: string; sections: string[]; description?: string }`; `isUnsellableCategory(normalized: string): boolean` exported from `svg-zones.ts`; `zoneFromTemplate` sets `description` on a ticket whose `description` is empty from the zone's `description`; `zonesOfTemplate(v: Json): VenueZone[]` (today's private `zonesOf`, exported) keeps `description` (trimmed, ≤ 160) when it is a non-empty string; `UploaderRun.names_task_id: string | null`; `EDIT_EVENT_COLUMNS` ends `,tickets_and_rates,map_image_url`.

- [ ] **Step 1: Write the failing tests** (selftest section): `zoneFromTemplate copies the zone description onto an empty ticket description`, `zoneFromTemplate keeps a ticket description that is already there`, `zonesOfTemplate keeps description and drops a blank one`.
- [ ] **Step 2: Run** `npx tsx scripts/tour-uploader-selftest.ts` → FAIL (description undefined / export missing).
- [ ] **Step 3: Migration** via `npm run db:new uploader_alon_round_1`: `alter table public.venue_maps add column if not exists dropped_categories jsonb not null default '{}'::jsonb; alter table public.uploader_runs add column if not exists names_task_id uuid;` with a header comment naming the spec.
- [ ] **Step 4: Implement** the `VenueZone` field, the `isUnsellableCategory` export, the copy in `zoneFromTemplate`, `zonesOfTemplate`, `sanitizeZones` (keeps `description` trimmed and cut to 160; absent stays absent), `names_task_id` on the type, the column list.
- [ ] **Step 5: Run** the selftest → PASS; `npx tsc --noEmit -p .` clean for the touched files.
- [ ] **Step 6: Commit** `feat(uploader): zone description on venue templates, dropped_categories + names_task_id columns`.

### Task 2: `lib/uploader/classify.ts` (pure)

**Files:**
- Create: `lib/uploader/classify.ts`
- Test: `scripts/tour-uploader-selftest.ts` (section `Task 2: classify`)

**Interfaces:**
- Consumes: `normalizeSupplierCategory`, `ticketSupplier` (`lib/suppliers.ts`), `listSectionIds`, `sectionCategory`, `isUnsellableCategory`, `newZoneId`, `VenueZone`, `SupplierCategoryMap` (`lib/venue-maps/svg-zones.ts`), `zoneFromTemplate`, `EventTicket`.
- Produces (all exported):
  - `type DrawingCategory = { category: string; key: string; sections: string[] }` and `drawingCategories(svg: string): DrawingCategory[]` - one per sellable category of the drawing in document order; `category` = the slug with `-` → space.
  - `type TemplateLike = { zones: VenueZone[]; supplier_categories: SupplierCategoryMap }`.
  - `type DroppedCategories = { dropped: string[]; kept: string[] }` and `parseDroppedCategories(v: unknown): DroppedCategories` (`{ tixstock, tixstock_kept }` jsonb → keys; anything else → empty).
  - `dropRule(category: string): { drop: boolean; reason: "away" | null }`.
  - `type ProposedRow = { label_he: string; description_he: string; drop: boolean; drop_reason: "away" | "other" | null; unsure: boolean }` and `parseClassification(answer: unknown, keys: string[]): { rows: Map<string, ProposedRow>; problems: string[] }` - the tool output `{ categories: [{ category, label_he, description_he, drop, drop_reason, unsure }] }` matched by `normalizeSupplierCategory(category)`; unknown key ignored (problem line), a key the model skipped → `unsure: true` row, a `label_he` without a Hebrew letter → `unsure: true`, labels cut to 40 / descriptions to 160, `drop` without a reason → `drop: false`.
  - `type CategoryInput = { category: string; key: string; sections: string[]; shows: number }` and `type ClassificationRow = CategoryInput & ProposedRow & { ruleDrop: "away" | null; onMap: boolean; existing: { label: string; description: string } | null; status: "ai" | "rule_drop" | "unsure" | "existing" | "manual" }`; `proposalRows(categories: CategoryInput[], proposed: Map<string, ProposedRow> | null, template: TemplateLike | null, dropped: DroppedCategories): ClassificationRow[]` - one row per key (categories sharing a key collapse; `shows` summed, `sections` merged), the rule drop applied over the proposal unless the key is in `kept`, an existing template entry prefilled as `existing` (status `existing`), `proposed === null` → status `manual` with empty Hebrew.
  - `type ConfirmedRow = { category: string; label_he: string; description_he: string; drop: boolean; unsure: boolean }` and `cleanConfirmedRows(raw: unknown, allowedKeys: Set<string>): ConfirmedRow[] | null` (null on any bad row: unknown key, duplicate key, caps, a non-dropped non-unsure row with an empty label).
  - `templateFromRows(rows: ConfirmedRow[], drawing: DrawingCategory[], existing: TemplateLike | null, existingDropped: DroppedCategories): { zones: VenueZone[]; categoryToZone: Record<string, string>; forget: string[]; dropped: string[]; kept: string[] }` - a zone per confirmed, non-dropped, non-unsure row: the existing zone id for that key (via `existing.supplier_categories.tixstock[key]`) else `newZoneId(key, zonesSoFar)`; `sections` = the drawing's for that key, `[]` off-map; `label` / `description` from the row; zones of the existing template whose key is not in `rows` are kept untouched; `forget` = keys of unsure + dropped rows; `dropped` = dropped keys; `kept` = keys whose `dropRule` says drop but the row un-dropped (∪ existing `kept` for keys not in rows).
  - `templateFromEvent(eventTickets: EventTicket[], payloadTickets: EventTicket[], existing: TemplateLike | null, drawing: DrawingCategory[], existingDropped: DroppedCategories): ReturnType<typeof templateFromRows> & { learned: { zones: number; newZones: number; dropped: string[]; descriptions: number } }` - per `tixstock` ticket with a `zoneId`: key → that zone; the zone's label = the ticket's `zoneLabel` when the existing label has no Hebrew letter or the ticket's differs and has one; `description` = the ticket's non-empty `description`; a key present in `payloadTickets` (tixstock) and absent from `eventTickets` → dropped; everything merged over `existing`.
  - `applyClassification(tickets: EventTicket[], template: TemplateLike, dropped: DroppedCategories): { tickets: EventTicket[]; dropped: string[]; unzoned: string[] }` - removes `tixstock` tickets whose key ∈ `dropped.dropped` ∪ { keys where `dropRule` drops } minus `dropped.kept`; the rest through `zoneFromTemplate(..., "tx_event", template)`; `unzoned` = `category` of EVERY ticket left without `zoneId` (LiveTickets included).
  - `type ClassificationChange = { category: string; field: "label" | "description" | "drop"; from: string | boolean | null; to: string | boolean }` and `classificationDiff(proposed: Map<string, ProposedRow> | null, confirmed: ConfirmedRow[]): ClassificationChange[]` (`proposed === null` → every confirmed label / description with `from: null`).
  - `ticketsFixedByHand(payload: Record<string, unknown> | null, row: { tickets_and_rates: unknown } | null): boolean` - true when the row's `tixstock` tickets differ from the payload's in the set of keys, any `zoneId`, or any non-empty `description` the payload lacked.

- [ ] **Step 1: Write the failing tests**, one `assert` block per rule: `dropRule` ("Away Fans Section" → away; "Visiting Supporters" → away; "Getaway Lounge" → no; "Riverside View" → no; "Longside Lower Tier (Restricted View)" → no); `drawingCategories` on a 6-section SVG string (`longside-lower-tier_L1`, `longside-lower-tier_L2`, `away-fans-section_A1`, `gray-fields_g1`, `field_f`, `riverside-stand-upper_R1` → 3 categories, `gray-fields` and `field` skipped); `parseClassification` (unknown ignored + problem; skipped key → unsure; latin label → unsure; drop without reason → false; caps); `proposalRows: categories sharing a key collapse to one row`; `proposalRows` rule drop beats the proposal unless kept; `templateFromRows: a second confirm reuses zone ids and keeps a hebrew label`; `templateFromRows` off-map row → `sections: []`, unsure → in `forget`, not in zones; `templateFromEvent` (zoned ticket maps; latin existing label replaced by the ticket's Hebrew; description lands; a payload category gone from the event is a drop; one never in the payload is not); `applyClassification` (drop removes; kept keeps; description copied onto an empty one only; a LiveTickets description untouched; `unzoned` lists LiveTickets too); `classificationDiff` (renamed / un-dropped / unchanged → nothing / manual → from null); `ticketsFixedByHand` (zoneId added → true; price changed only → false; category removed → true).
- [ ] **Step 2: Run** the selftest → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/uploader/classify.ts` with the signatures above (header comment: pure, spec §6.2, selftest).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(uploader): pure venue classification rules (drop rule, template from rows / from event, apply, diff)`.

### Task 3: Names - `lib/uploader/team-names.ts` + the LiveTickets rule in `names.ts`

**Files:**
- Create: `lib/uploader/team-names.ts`
- Modify: `lib/uploader/names.ts:26-44`
- Test: `scripts/tour-uploader-selftest.ts` (section `Task 3: names`)

**Interfaces:**
- Consumes: `normalizeName`, `clubNamesMatch` (`lib/on-tour.ts`), `withSupplierSpellings`, `ShowIdentity`, `SubjectKind`, `UploaderItem`.
- Produces:
  - `eventNames(kind, show, subject, teamsHe, liveHeb): { name: string; name_english: string; hebrew: boolean; source: "teams" | "livetickets" | "artist" | "english" }` - football: both sides → `teams`; else `liveHeb` trimmed, ≤ 120, containing a Hebrew letter → `livetickets`; else `english` (`hebrew: false`). Artist: the row / brief → `artist`, else LiveTickets → `livetickets`, else `english`.
  - `cleanClubName(name: string): string` - strips the suffixes / prefixes `FC`, `CF`, `AFC`, `SC`, `AC`, `SSC`, `BC` as whole words at either end ("Newcastle United FC" → "Newcastle United", "AFC Bournemouth" → "Bournemouth", "Real Madrid CF" → "Real Madrid"), collapses spaces.
  - `type MissingSide = { supplier_name: string; isSubject: boolean }` and `missingSides(items: Pick<UploaderItem, "show" | "warnings">[], subject: { kind: SubjectKind; name_en: string }, teamsHe: Record<string, string>): MissingSide[]` - distinct by `normalizeName`, a side `withSupplierSpellings(teamsHe, [side])` resolves is not missing; the subject first when any item carries `no_team_page` / `no_artist_page`; an artist run lists the subject only.
  - `missingHebrewNames(items: Pick<UploaderItem, "show">[], subject: { kind: SubjectKind; name_en: string; name_he: string | null }, teamsHe: Record<string, string>): string[]` - the `MissingSide.supplier_name`s of shows whose `eventNames(...).hebrew` is false (so a show LiveTickets names in Hebrew asks for nothing).
  - `type ProposedName = { name_en: string; name_he: string }` and `parseTeamNames(answer: unknown, names: string[]): { rows: Map<string, ProposedName>; problems: string[] }` - the tool output `{ teams: [{ supplier_name, name_en, name_he }] }`, matched by `normalizeName(supplier_name)`; a `name_he` without a Hebrew letter → the row is dropped (problem); caps 80 / 60; a skipped name → no row.
  - `type ConfirmedTeamRow = { supplier_name: string; name_en: string; name_he: string; existing_id: number | null }` and `cleanTeamRows(raw: unknown, allowed: Set<string>): ConfirmedTeamRow[] | null` (Hebrew letter in `name_he`, caps, `existing_id` a positive integer or null, no duplicates).
  - `teamRowsFor(names: MissingSide[], proposed: Map<string, ProposedName> | null, teams: { id: number; name: string; name_english: string | null }[]): (ConfirmedTeamRow & { status: "create" | "existing" | "manual" })[]` - `existing` when `clubNamesMatch` finds a row under the clean English name (its `name_he` = the row's `name`), `manual` when `proposed` is null (`name_en` = `cleanClubName(supplier_name)`, `name_he` = "").
  - `slugFor(name_en: string, name_he: string): string` - the Templates form's `autoSlug` rule copied (latin slug of `name_en`, else of `name_he`, else `item-` + 6 random chars).

- [ ] **Step 1: Write the failing tests**: `eventNames: both sides known → ours, source teams`; `eventNames: one side missing + livetickets hebrew → livetickets`; `eventNames: a latin livetickets name is no hebrew name`; `eventNames: a 200-char livetickets name is cut to 120`; `cleanClubName` (the three examples + "Manchester City" unchanged); `missingSides` (dedupe, resolved side skipped, subject first with `no_team_page`, artist run → subject only); `missingHebrewNames` (empty when LiveTickets names every show); `parseTeamNames`; `cleanTeamRows`; `teamRowsFor` (existing match, manual); `slugFor`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; update the callers of `eventNames` (`uploader-build.ts`, the selftest's existing names cases - `source` is additive, `hebrew` keeps its meaning).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(uploader): hebrew event name rule (ours, livetickets, else ask) + team-name helpers`.

### Task 4: Panel rows, card fold, run rules, new warning / decision codes

**Files:**
- Create: `lib/uploader/run-panel.ts`
- Modify: `lib/uploader/run-rules.ts`, `lib/uploader/warnings.ts:70-88`, `lib/uploader/decisions.ts:50-75`, `lib/uploader/action-types.ts`
- Test: `scripts/tour-uploader-selftest.ts` (section `Task 4: panel, fold, run rules`)

**Interfaces:**
- Produces:
  - `RUN_LEVEL_CODES: readonly string[]` = `no_team_page, no_artist_page, no_crest, no_bio, no_cutout, no_event_gallery, no_category_twin, no_hebrew_name, new_venue, unzoned_tickets`; `isRunLevel(item: UploaderItem, w: Warning): boolean` - `new_venue` / `unzoned_tickets` only when `item.show.suppliers.tixstock?.venue_map_url` is a non-empty string.
  - `cardWarnings(item: UploaderItem): { card: Warning[]; folded: number }`.
  - `type PanelRow = { kind: "venue" | "names" | "subject" | "fix" | "info"; key: string; text: string; count: number; action: "classify" | "learn" | "names" | "link" | null; venue?: { sourceUrl: string; name: string; state: "new" | "unzoned" | "fixed"; fixedItemId: string | null; otherFixedItemIds: string[] }; fix_url?: string }` and `runLevelRows(items: UploaderItem[], fixedByHand: Record<string, boolean>, subject: { kind: SubjectKind; name_en: string }, missing: string[]): PanelRow[]` - venue rows first (one per exact `venue_map_url` among items with a run-level `new_venue` / `unzoned_tickets`; state `fixed` when any item of that venue is `fixedByHand`, the newest `updated_at` first; else `new` when any carries `new_venue`, else `unzoned`), then the names row (when `missing.length > 0` or any item carries `no_hebrew_name`), the subject row, the fix rows (one per code among `no_crest, no_bio, no_cutout, no_event_gallery`, with the first `fix_url` seen), the info row. Texts = spec §5.1 table (`{venue}`, `{n}`, the first three names + `(+k)`).
  - `type RunRule = { kind: QuestionKind; key: string; venue: string | null; city: string | null }`; `runRuleOf(q: UploaderQuestion, item: Pick<UploaderItem, "show">, answer: { key: string | null; text: string | null }): RunRule | null` (`pick_show`: `both` | `skip`; `pick_date`: `tix` | `live` | `both` | `skip` from the key's prefix; `pick_location`: the key (an id or `skip`) with `venue` / `city` = `normalizeName` of the show's; anything else null); `applyRuleTo(rule: RunRule, other: UploaderItem): string | null` (other must be `status === "question"` with a question of the same kind; `pick_date` `tix` → the other's option whose key starts `tix:`, same for `live`, `both` / `skip` as is; `pick_location` → the key only when the other's show has the same `venue` and `city` by `normalizeName` AND the key is among its options).
  - `warnings.ts`: `WARNING_TEXT.all_dropped = "כל הקטגוריות נפסלו - בדקו ידנית"`, `WARNING_TEXT.unzoned_review = "{count} מתוך {total} כרטיסים בלי זון - לבדיקה: {categories}"`; exported `warning(code, params?, fix_url?)` (today private).
  - `decisions.ts` codes: `classified` (`סווגו {zones} זונים · {dropped} נפסלו · {unsure} לבדיקה`), `categories_dropped_by_template` (`{count} קטגוריות נפסלו לפי תבנית האולם: {names}`), `named_he` (`שם בעברית: {name}`), `name_from_livetickets` (`שם בעברית מלייב טיקטס: {name}`), `taught_venue` (`האירוע הזה לימד את תבנית האולם`).
  - `action-types.ts`: `RunBoard.fixedByHand: Record<string, boolean>`; `ClassifyResult = { ok: true; events: number; reached: number; total: number; zones: number; dropped: number; unsure: number } | { ok: false; kind: string; message?: string }`; `ProposeResult`, `NamesProposeResult`, `TeamsResult`, `LearnPreview` exactly as Task 8 defines them (declare them here).

- [ ] **Step 1: Write the failing tests**: `cardWarnings` (run-level folded; `new_venue` on a LiveTickets-only item stays; only card-level → folded 0); `runLevelRows: venues group by the exact drawing url`; `runLevelRows` states `new` / `unzoned` / `fixed` (fixed wins, newest item id); names row count; subject row; `runRuleOf` for the three kinds + listing id → null + free text → null; `applyRuleTo` (`pick_date` other without a `tix:` option → null; `pick_location` other venue → null, same venue → the id; `applyRuleTo: an answered sibling gets no key`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(uploader): run-level panel rows, card fold, rules for the run, new warning and decision codes`.

### Task 5: Agent layer - lesson sources per call

**Files:**
- Modify: `lib/agents/memory.ts:86-150`, `lib/agents/tour-uploader.agent.ts:60-140`
- Test: `scripts/agents-selftest.ts`

**Interfaces:**
- Produces: `loadAgentLessons(def, opts?: { sources?: string[] }): Promise<string[]>` and `traceAgentLessons(def, opts?: { sources?: string[] })` - with `sources`, only those `learnsFrom` entries are read (the `.in("action", ...)` list and the buckets); default = all, unchanged. New sources on `TOUR_UPLOADER_LEARNS_FROM`: `uploader.classify_changed` → `at {venue} staff renamed zone '{category}' from '{from}' to '{to}'` / `... changed the description of '{category}'` / `... dropped '{category}' ({reason})` / `... un-dropped '{category}' (the rule flagged it)` / `... named '{category}' '{to}' by hand` (`from === null`); `uploader.team_created` → `staff named {from_supplier_name} '{name_he}' (English page name {name_en})`; `uploader.answered` with `metadata.rule_applied === true` → the existing line + ` (a rule for the run, applied to {applied} more)`. Exported constants `CLASSIFY_LESSON_SOURCES = ["uploader.classify_changed"]`, `NAMES_LESSON_SOURCES = ["uploader.team_created"]`, `PARSE_LESSON_SOURCES` = the five existing actions + `agent.feedback`.

- [ ] **Step 1: Write the failing tests** in `scripts/agents-selftest.ts`: the three new line formats from synthetic rows; a `classify_changed` row with no `category` → null; the three constant arrays; `interleave` unchanged.
- [ ] **Step 2: Run** `npx tsx scripts/agents-selftest.ts` → FAIL.
- [ ] **Step 3: Implement**; `parseBriefWithAgent` passes `{ sources: PARSE_LESSON_SOURCES }`.
- [ ] **Step 4: Run** → PASS; `npx tsx scripts/tour-uploader-selftest.ts` still PASS.
- [ ] **Step 5: Commit** `feat(agents): lesson sources per call; uploader learns from classifications and team names`.

### Task 6: The two AI calls - `lib/services/tour-uploader-classify.ts`

**Files:**
- Create: `lib/services/tour-uploader-classify.ts`
- Modify: `lib/actions/venue-map-actions.ts:207-240` (factor `fetchSupplierSvg`)
- Test: `scripts/tour-uploader-selftest.ts` (section `Task 6: classify prompts`) - prompt builders only; the calls are not unit-tested.

**Interfaces:**
- Consumes: `TOUR_UPLOADER_AGENT`, `agentEnabled`, `agentModel`, `anthropicKey`, `takeBudget`, `callCostUsd`, `loadAgentLessons`, `loadActiveTaughtRules`, `LESSONS_OPEN` / `LESSONS_CLOSE`, `isTimeoutError` (all as `tour-uploader-parse.ts` uses them), `parseClassification`, `parseTeamNames`, the Task 5 source constants.
- Produces:
  - `fetchSupplierSvg(sourceUrl: string): Promise<{ ok: true; svg: string } | { ok: false; error: string }>` exported from `venue-map-actions.ts` (host allowlist, `MAX_SVG_BYTES`, `<svg` check) and used by `adoptVenueMap`.
  - `type ClassifyInput = { venue: string; city: string | null; subject: string; kind: SubjectKind; categories: { category: string; key: string; sections: string[]; shows: number; existingLabel: string | null }[]; styleExamples: string[] }`; `classifyPrompt(def, lessons, taught, input): { system: string; user: string }` - system = the rules of spec §8 (label ≤ 5 words, position in plain Hebrew, proper names transliterated; description one sentence, no prices, no seating promises; `drop` for away / visiting supporters; `unsure` for hospitality / codes; answer every category), house rules + taught rules; user = the venue facts, the categories (at most 12 section ids each + the count), the style examples, then the fenced lessons.
  - `CLASSIFY_TOOL` (`classify_venue`, non-strict; `categories: [{ category: string, label_he: string, description_he: string, drop: boolean, drop_reason: "away" | "other" | null, unsure: boolean }]`), `CLASSIFY_MAX_TOKENS = 6_000`.
  - `type ClassifyOutcome = { ok: true; rows: Map<string, ProposedRow>; problems: string[]; costUsd: number } | { ok: false; kind: "off" | "budget" | "timeout" | "error" | "bad_answer"; problems: string[] }`; `classifyVenueWithAgent(input: ClassifyInput, budget?: AgentBudget, opts?: { userId?: string }): Promise<ClassifyOutcome>`.
  - `type NamesInput = { names: string[]; kind: SubjectKind; hints: Record<string, string> }` (`hints` = LiveTickets Hebrew show names per supplier name, when any); `namesPrompt(def, lessons, taught, input)`; `NAMES_TOOL` (`name_teams`; `teams: [{ supplier_name, name_en, name_he }]`), `NAMES_MAX_TOKENS = 2_000`; `type NamesOutcome` like `ClassifyOutcome` with `rows: Map<string, ProposedName>`; `nameTeamsWithAgent(input, budget?, opts?)`.
  - Both calls: `agentEnabled` → `off`; `takeBudget` → `budget`; lessons with `{ sources: CLASSIFY_LESSON_SOURCES }` / `NAMES_LESSON_SOURCES`; `agent.call` audit `{ agent, cost_usd, input_tokens, output_tokens, model, call: "classify_venue" | "name_teams", user_id? }`; `stop_reason === "max_tokens"` → `bad_answer`.

- [ ] **Step 1: Write the failing tests**: `classifyPrompt` user text contains every category name and `LESSONS_OPEN` before a lesson, and contains no `$` / `price` / `http`; the fence markers inside a lesson are defused as `parsePrompt` does; `namesPrompt` lists the names and the hints; section ids capped at 12.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the service and the `fetchSupplierSvg` refactor (behaviour of `adoptVenueMap` unchanged).
- [ ] **Step 4: Run** → PASS; tsc clean.
- [ ] **Step 5: Commit** `feat(uploader): classify_venue and name_teams agent calls`.

### Task 7: Build + run creation - template drops / descriptions, the names rule, the names task

**Files:**
- Modify: `lib/services/uploader-build.ts:490-535`, `lib/services/uploader-questions.ts`, `lib/services/uploader-store.ts:216-248`, `lib/actions/uploader-actions.ts:209-345` (`createRun`), `lib/services/uploader-prior.ts:150-170` (`venueMapFor` returns `dropped` too)
- Test: selftest already covers the pure parts; this task is verified by tsc + the selftest + a read of the diff.

**Interfaces:**
- Consumes: `applyClassification`, `parseDroppedCategories`, `eventNames` (new `source`), `missingHebrewNames`.
- Produces:
  - `venueMapFor(sourceUrl): Promise<(Pick<VenueMap, "svg_url" | "zones" | "supplier_categories"> & { dropped: DroppedCategories }) | null>` (selects `dropped_categories` too).
  - Build step 4: with a template → `applyClassification(tickets, template, template.dropped)`; decisions `zones_from_template` as today, plus `categories_dropped_by_template` when `dropped.length > 0`; `unzoned` = `unzoned.length`. Step 3: `names.source === "livetickets"` → decision `name_from_livetickets`.
  - `openNamesTask(run: UploaderRun, missing: string[]): Promise<string | null>` in `uploader-questions.ts` - same insert shape as `openQuestionTask` (source `uploader`, board `ops`, priority `high`, assignee `run.asker_id`, `created_by: null`, `source_ref = { kind: "uploader_names", table: "uploader_runs", row_id: run.id, run_id: run.id, label, url: /uploader/<run.id> }`, title `שמות בעברית חסרים: {n} קבוצות - {subject}`, description = the names one per line + "ענו בלוח ההעלאה: תן שמות בעברית"), dedupe on an open task with the same `source_ref->>run_id` and kind, `notifyTaskAssigned`, audit `uploader.asked` with `kind: "names"`; `closeNamesTask(taskId: string, note: string): Promise<void>` = `closeQuestionTask`.
  - `insertRun` takes `names_task_id: string | null`; `createRun`: after the items are inserted and the question tasks raised, `missingHebrewNames(items, plan.subject, resolved.teamsHe)` → when non-empty and the task count is under `MAX_QUESTION_TASKS_PER_RUN`, `openNamesTask` and write `names_task_id` (`writeNamesTaskId(runId, id)` in the store). `countOpenQuestions` / the toast are unchanged (a names task is not a question).

- [ ] **Step 1: Implement** in that order; the existing selftest's build-related cases must still pass unchanged.
- [ ] **Step 2: Run** `npx tsx scripts/tour-uploader-selftest.ts` → PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 3: Commit** `feat(uploader): build applies template drops and descriptions; names rule; one names task per run`.

### Task 8: Server actions + store helpers + inactive team create

**Files:**
- Modify: `lib/actions/uploader-actions.ts` (five new actions, `answerQuestion` option, `getRun`), `lib/services/uploader-store.ts`, `lib/actions/football-actions.ts:29-54`, `lib/actions/artist-actions.ts:29-52`, `app/(dashboard)/uploader/copy.ts` (`ACTION_ERROR_HE` entries)
- Test: tsc + selftest; the actions are exercised by Task 9's screen.

**Interfaces:**
- Consumes: Tasks 2-7.
- Produces (store, `uploader-store.ts`): `readVenueTemplate(sourceUrl: string): Promise<{ row: { id: string; name: string; svg_url: string | null; zones: VenueZone[]; supplier_categories: SupplierCategoryMap; dropped: DroppedCategories } | null; failed: boolean }>` (by `urlSpellings` of the exact URL, newest `updated_at`); `writeDroppedCategories(id: string, dropped: string[], kept: string[]): Promise<boolean>`; `readEventTickets(ids: number[]): Promise<Map<number, { tickets_and_rates: EventTicket[]; map_image_url: string | null; is_hidden: boolean; name: string }> | null>`; `writeEventClassification(eventId: number, tickets: EventTicket[], mapUrl: string): Promise<boolean>`; `writeEventName(eventId: number, name: string): Promise<boolean>`; `writeNamesTaskId(runId: string, taskId: string | null): Promise<boolean>`; `readStyleLabels(exceptSourceUrl: string, max: number): Promise<string[]>` (Hebrew zone labels of other venues).
- Produces (people): `createFootballTeamInactive(data: CreatePersonData): Promise<Person>` / `createArtistInactive(data)` = `requireStaff` + `createRow` with `is_active: false`, no taxonomy; `updateFootballTeam` / `updateArtist`: when `data.is_active === true` and the stored row was inactive, run `ensurePersonTaxonomy({ kind, name, nameEnglish })` after the update, tolerant (try/catch, console.error).
- Produces (actions):
  - `proposeVenueClassification(runId: string, sourceUrl: string): Promise<ProposeResult>` - `ProposeResult = { ok: true; venue: { name: string; sourceUrl: string; templateId: string | null }; rows: ClassificationRow[]; proposed: Record<string, ProposedRow> | null; shows: number; ai: { used: boolean; reason: string | null; problems: string[] } } | { ok: false; kind: "bad_input" | "not_found" | "db_error" | "rate_limited" | "svg_failed"; message?: string }`. Steps: validate (uuid, URL on the adoptable host); rate cap; read run + items; the venue's items = `show.suppliers.tixstock?.venue_map_url === sourceUrl`; `readVenueTemplate`; the drawing = `fetchSupplierSvg` (no template) or `getVenueMapDrawing(templateId)`'s svg → `drawingCategories`; ticket categories from `readEventTickets` of the venue's items (`shows` per key); `CategoryInput[]` = the union; `classifyVenueWithAgent` for the keys with no existing label (existing ones ride as `existingLabel`); `proposalRows(...)`.
  - `classifyVenue(runId: string, sourceUrl: string, input: unknown): Promise<ClassifyResult>` - `input = { rows, proposed }` (`proposed` = what the dialog was shown, `null` when the AI gave nothing); spec §6.3 verbatim: `cleanConfirmedRows` against the venue's keys (re-derived as in propose, no AI); step 1 template (`adoptVenueMap` with `categoryLabels` from the rows when no template; then `saveVenueZones(id, templateFromRows(...).zones)`; `rememberSupplierCategories(id, "tixstock", { ...categoryToZone, ...Object.fromEntries(forget.map(k => [k, ""])) })`; `writeDroppedCategories`); step 2 events in position order (`applyClassification`; zero tickets left → warning `all_dropped`, not written); step 3 items (`transitionItem(id, ["ready", "approved"], { warnings, decisions, payload })`); step 4 audits (`uploader.classified` per venue; `uploader.classify_changed` per `classificationDiff(proposed, rows)` change, `ai: proposed !== null`); step 5 `revalidateMain` if any touched item is `approved`, `invalidatePriceLight("rows")`.
  - `learnPreview(itemId: string): Promise<LearnPreview>` - `LearnPreview = { ok: true; learned: { zones: number; newZones: number; dropped: string[]; descriptions: number }; siblings: number } | { ok: false; kind }`.
  - `learnFromEvent(itemId: string): Promise<ClassifyResult>` - spec §6.5: template from `templateFromEvent` over the item's event row + payload + drawing; then §6.3 steps 2-5 for the venue's OTHER items; the source item gets decision `taught_venue`; audits with `source: "event"`.
  - `proposeTeamNames(runId: string): Promise<NamesProposeResult>` - `{ ok: true; rows: (ConfirmedTeamRow & { status: "create" | "existing" | "manual" })[]; liveNamed: number; ai: { used: boolean; reason: string | null; problems: string[] } } | fail` - `missingSides` over the run's items with the cached subject's `teamsHe`, `nameTeamsWithAgent` (hints = `show.suppliers.livetickets?.name_heb`), `teamRowsFor`; `liveNamed` = items whose `eventNames` now answers `source: "livetickets"` while their stored name is English.
  - `createTeamsAndRename(runId: string, rows: unknown): Promise<TeamsResult>` - `{ ok: true; created: number; renamed: number } | fail`: `cleanTeamRows`; create (inactive) each `existing_id === null` row via the kind's `create*Inactive` with `slug = slugFor(name_en, name_he)` (on a unique violation retry with `-2`); audit `uploader.team_created`; refresh the subject cache (`writeSubjectCache` after `resolveSubject`); rename every `ready` / `approved` item's event by `eventNames` (write `events.name`, `payload.name`, warnings minus `no_hebrew_name`, and minus `no_team_page` / `no_artist_page` everywhere once the subject row exists, decision `named_he`); close `names_task_id` with the note; audit `uploader.renamed`; `revalidateMain` once if a live event was renamed.
  - `answerQuestion(itemId, answer, opts?: { applyToSimilar?: boolean }): Promise<Ok & { applied?: number }>` - after the own answer: `runRuleOf`; for each other `question` item of the run in position order, `applyRuleTo` → key → the same per-item path refactored into `answerOne(item, run, key, session, { ruleApplied: true })`; stop at the first `db_error`; the FIRST item's audit row carries `rule_applied: true, applied: n`.
  - `getRun`: adds `fixedByHand[item.id] = ticketsFixedByHand(item.payload, row)` beside `edited`.
  - `copy.ts`: `rate_limited` ("יותר מדי קריאות ל-AI - נסו בעוד כמה דקות"), `svg_failed` ("לא הצלחתי לקרוא את המפה של הספק"), `adopt_failed` ("לא הצלחתי לאמץ את המפה"), `no_template` ("לאירוע הזה אין תבנית אולם ללמוד ממנה").

- [ ] **Step 1: Implement** store helpers, people actions, then the actions, in that order; keep every action under the existing `requireAdmin` + validate-first + `{ ok: false, kind }` pattern.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .` clean; `npx tsx scripts/tour-uploader-selftest.ts` PASS; `npx next lint --file lib/actions/uploader-actions.ts` clean.
- [ ] **Step 3: Commit** `feat(uploader): classify / learn / names / rule-for-the-run actions, inactive team create`.

### Task 9: The board - panel, dialogs, fold, learn button, checkbox

**Files:**
- Create: `app/(dashboard)/uploader/[id]/run-panel.tsx`, `classify-dialog.tsx`, `names-dialog.tsx`, `learn-confirm.tsx`
- Modify: `board-client.tsx`, `board-words.ts`, `card-shell.tsx:234-255` (`Notices`), `show-card.tsx:180-197`, `question-card.tsx:24-60`
- Test: `npx tsc --noEmit -p .`; then the preview check below.

**Interfaces:**
- Consumes: Task 4 (`runLevelRows`, `cardWarnings`, `runRuleOf`, `applyRuleTo`), Task 8 actions and result types, `RunBoard.fixedByHand`.
- Produces: `RunPanel({ board, missing, onClassify(venue), onLearn(itemId), onNames() })` rendered by `BoardClient` between `BoardHeader` and `FilterBar` when `runLevelRows(...).length > 0`, element id `run-panel`; `ClassifyDialog({ runId, venue, open, onClose, onDone })` - calls `proposeVenueClassification` on open (spinner "ה-AI מציע…" with a 20 s bar), the §5.2 table (editable label / description, drop switch, status column text per `status` / `ruleDrop` / `onMap` / `shows`), the AI-off line, confirm enabled per §5.2, confirm → `classifyVenue(runId, sourceUrl, { rows, proposed })` → toast `"{events} אירועים עודכנו · {zones} זונים · {dropped} נפסלו · {unsure} לבדיקה"` → `refresh()`; `NamesDialog({ runId, open, onClose, onDone })` - `proposeTeamNames` on open, the §5.3 table, the fixed lines, zero rows + `liveNamed > 0` → the single button "עדכן שמות בעברית", confirm → `createTeamsAndRename` → toast → refresh; `LearnConfirm({ itemId, open, onClose, onDone })` - `learnPreview` on open, "7 זונים (3 חדשים) · 1 קטגוריה נפסלה (…) · 5 תיאורים", "החל" → `learnFromEvent` → toast → refresh; `Notices` folds via `cardWarnings` with the grey line "N הערות ברמת הריצה - בפאנל למעלה" (a button that scrolls `#run-panel` into view); `ShowCard` gets `fixedByHand: boolean`, `siblingsUnzoned: number`, `onLearn(item)` and shows "למד מהאירוע הזה והחל על {n} ההופעות" when `fixedByHand && siblingsUnzoned > 0`; `QuestionCard` gets `similar: number` (computed in `BoardClient` from `runRuleOf` + `applyRuleTo` over the picked key - `QuestionCard` reports the picked key up through `onPick(key)`), renders the checkbox "החל גם על {similar} השאלות הדומות בריצה" when `similar > 0`, and `onAnswer(item, answer, { applyToSimilar })`; toast "נענו {n} שאלות".
- `board-words.ts`: every new Hebrew string from spec §5.1-5.5 as named constants (`PANEL_TITLE = "לטיפול ברמת הריצה"`, `BTN_CLASSIFY = "סווג כרטיסים"`, `BTN_LEARN_APPLY = "החל על שאר ההופעות"`, `BTN_NAMES = "תן שמות בעברית"`, `BTN_NAMES_LIVE = "עדכן שמות בעברית"`, `BTN_CONFIRM_CLASSIFY(n) = "אשר - יחול על {n} ההופעות ויישמר כתבנית האולם"`, `BTN_CONFIRM_TEAMS = "צור את הקבוצות ועדכן את שמות האירועים"`, `AI_OFF_LINE = "ה-AI כבוי / לא ענה - מלאו את השמות ידנית"`, `NO_IMAGES_LINE = "ה-AI לא מביא תמונות: הקבוצות ייווצרו לא פעילות, בלי סמל ובלי תמונה - הפעילו אותן ב-Templates אחרי שהסמל הועלה."`, `FOLD_LINE(n) = "{n} הערות ברמת הריצה - בפאנל למעלה"`, the status texts `הצעת ה-AI`, `נפסל: יציע אוהדי חוץ (כלל)`, `לבדיקה - ה-AI לא בטוח (יישאר בלי זון)`, `לא במכירה בריצה הזו`, `לא מסומן במפה - יקבל כותרת בלי סימון`, `תיווצר קבוצה (בלי סמל ותמונה)`, `קיימת כבר - ישתמש בה`).

- [ ] **Step 1: Implement** the four components and the five modifications; shadcn `Dialog`, `Table`, `Input`, `Switch`, `Checkbox`, `Button` only; `dir="rtl"` on dialogs, `dir="ltr"` on English cells.
- [ ] **Step 2: tsc + lint** clean on every touched file.
- [ ] **Step 3: Preview check** (the one screen this round renders): `preview_start` the dev server (`.claude/launch.json` entry for `npm run dev`; another session's dev server on the same checkout must NOT be running - check `netstat -ano | grep LISTENING | grep ":300"` first and reuse it by navigating if it is), open `/uploader/<a run id from the runs list>` signed in with the dev account of `.env.development.local` (local Supabase; never the prod credentials), confirm the panel renders for a run with run-level warnings (seed one through the plan card if none exists), open each dialog, read `read_console_messages` for errors; screenshot the panel and one dialog into `docs/superpowers/guides/2026-10-21-tour-uploader-screens/` as `panel.jpg`, `classify-dialog.jpg`. If no local dev account or server can be had, say so in the report and leave the screenshots to the controller.
- [ ] **Step 4: Commit** `feat(uploader): run-level panel, classification and names dialogs, learn-from-event, rule for the run (board)`.

### Task 10: Editor zones board - the zone description

**Files:**
- Modify: `components/event-suppliers-panel.tsx` (the zone list around lines 2040-2070 and the save at ~586)

**Interfaces:**
- Consumes: Task 1 (`VenueZone.description`, `sanitizeZones`).
- Produces: a third box per zone ("תיאור ללקוח", placeholder "שורה מתחת לכותרת הכרטיס באתר", ≤ 160) bound to `zone.description`; `saveVenueZones` receives it unchanged; the "changed" detection (`savedZones.some(...)` at ~636) compares `description` too.

- [ ] **Step 1: Implement**; tsc + lint clean.
- [ ] **Step 2: Commit** `feat(venue-maps): zone description in the editor's zones board`.

### Task 11: Guide, CLAUDE.md, how-to

**Files:**
- Modify: `app/(dashboard)/guide/guide-content.ts` (the uploader section: the panel, the two dialogs, "לבדיקה", learn-from-event, the rule checkbox, teams created inactive - EN + HE), `CLAUDE.md` ("Agent #3": one paragraph per spec §13), `docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md` (section "סבב אלון 1" per spec §13).

- [ ] **Step 1: Write** the three texts.
- [ ] **Step 2: Run** `npx tsx scripts/guide-selftest.ts` → PASS.
- [ ] **Step 3: Commit** `docs(uploader): guide + CLAUDE.md + how-to for round אלון 1`.

### Task 12: Whole-change verification

- [ ] **Step 1: Run** `npx tsx scripts/tour-uploader-selftest.ts`, `npx tsx scripts/agents-selftest.ts`, `npx tsx scripts/guide-selftest.ts` → all PASS.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .` → clean; `npx next lint` → no new errors in touched files.
- [ ] **Step 3: Run** `npm run build` → green (the pre-push gate builds the tree; a red build here is a red push).
- [ ] **Step 4:** `git status --short` shows nothing of this round uncommitted; `git log --oneline origin/master..HEAD` lists this round's commits (plus any other session's own).
