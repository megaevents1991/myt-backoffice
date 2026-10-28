# AI Uploader - Alon round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Alon's ten notes on the AI Uploader: pair the same show across suppliers and learn it, place by city name, ask before a show without a location, names without duplicates, a map with section exclusion in the classify dialog, steering + a description template before the run, a cleaner board.

**Architecture:** Pure rules in `lib/uploader/*` (selftested in `scripts/tour-uploader-selftest.ts`), DB reads/writes in `lib/services/uploader-*.ts`, admin server actions in `lib/actions/uploader-actions.ts` (each `requireAdmin()` first, returns `{ ok: false, kind }` - never throws), screens in `app/(dashboard)/uploader/`. One new equivalence module feeds grouping, placement and names.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service role, `supabaseTyped` / the `db = supabase as any` boundary for tables newer than `types/database.types.ts`), shadcn/ui, Anthropic SDK through `lib/agents/` (agent `tour-uploader`).

**Spec:** `docs/superpowers/specs/2026-10-28-uploader-alon-round-2-design.md` - read it first; section numbers below refer to it.

## Global Constraints

- Every Hebrew string the spec quotes is copied verbatim (Hebrew UI, RTL; English for code).
- `showKey` / `questionKey` output never changes (earlier answers and rejections are stored under them).
- A read of a new column / table tolerates it missing: 42703, 42P01, PGRST204, PGRST205 -> behave as before the migration (log once).
- AI calls follow `lib/services/tour-uploader-classify.ts`: same agent + `TOUR_UPLOADER_AI` switch, forced non-strict tool, 20 s, `maxRetries: 0`, an `agent.call` audit row with cost and `user_id`, the shared cap `PARSE_RATE_MAX` / `PARSE_RATE_WINDOW_MS`; staff text and lessons inside the data fence; off / no answer / cap -> the same form with empty boxes.
- No price is ever written by the AI; no CHECK constraints; soft deletes only.
- Commits: conventional, `git commit -- <paths>` (shared checkout), NO AI co-author line, never push.
- Gates per task: `npx tsx scripts/tour-uploader-selftest.ts` passes; `npx tsc --noEmit -p .` shows no error beyond the baseline (12 errors in 6 files, 2 of them in `lib/actions/location-actions.ts`).

## Review Focus

1. A city spelled with LiveTickets' broken character ("K�ln") beside TixStock's "Köln" -> one show (Task 2 test `wildcard city`).
2. Two locations rows for one city (Munich ids 11 and 30, Krakow 7 and 34) -> city match picks one deterministically: nearest to the venue, else lowest id (Task 4 test `duplicate location rows`).
3. A stored plan from before this round (no `livetickets_non_instant`) reads `true` and keeps building (Task 6 test `old plan`).
4. The names dialog confirming two rows that clean to one club -> ONE team insert (Task 7 test `collapse`).
5. Excluded sections set in the dialog survive a later learn-from-event that has none on its event only if the event really cleared them (learn copies the event's list as it is - Task 10 test `learn copies sections`).

---

### Task 1: Migration, location aliases, the alias store

**Files:**
- Create: `supabase/migrations/<timestamp>_uploader_alon_round_2.sql` (make it with `npm run db:new uploader_alon_round_2`; the timestamp must be after `20261027120500`)
- Create: `lib/services/uploader-aliases.ts`
- Modify: `lib/services/nearest-location.ts` (`LocationRow`, `loadLocations`), `types/location.types.ts`, `lib/actions/location-actions.ts`, the Locations form under `app/(dashboard)/locations/` (new + `[id]`)

**Interfaces:**
- Produces: `LocationRow.aliases: string[]`; `type UploaderAlias = { kind: "city" | "team"; from_name: string; from_key: string; to_name: string; to_key: string; team_id: number | null }`; `loadAliases(): Promise<UploaderAlias[]>` (missing table -> `[]`, any other error THROWS); `recordAlias(input: { kind: "city" | "team"; from_name: string; to_name: string; team_id?: number | null; created_by: string | null }): Promise<boolean>` (upsert on `(kind, from_key)`, keys = `normalizeName`, refuses equal keys, false + log on failure).

- [ ] **Step 1:** Write the migration (idempotent): `alter table public.locations add column if not exists aliases text[] not null default '{}'`; seed by Hebrew city (`where split_part(name, ',', 1) = '<city>' and aliases = '{}'`) with: מדריד Madrid · מילאנו Milan, Milano · אבו דאבי Abu Dhabi · לונדון London · ברצלונה Barcelona · פריז Paris · קרקוב Krakow, Kraków, Cracow · ברלין Berlin · ורשה Warsaw, Warszawa · אמסטרדם Amsterdam · מינכן Munich, München, Muenchen · וינה Vienna, Wien · לימסול Limassol, Lemesos · בודפשט Budapest · פראג Prague, Praha · בוקרסט Bucharest, București, Bucuresti · רומא Rome, Roma · ליסבון Lisbon, Lisboa · ניו יורק New York, New York City · מיאמי Miami, Miami Gardens · אטלנטה Atlanta · לוס אנגלס Los Angeles · דיסלדורף Düsseldorf, Dusseldorf, Duesseldorf · אתונה Athens, Athina · בוסטון Boston · פילדלפיה Philadelphia · ארלינגטון-דאלאס Arlington, Dallas · יוסטון Houston · קנזס סיטי Kansas City · ליברפול Liverpool · מנצ'סטר Manchester · האנובר Hannover, Hanover. Fix two wrong coordinates found on prod: `פילדלפיה` -> 39.9526, -75.1652 (stored 39.95, **+**75.16); `ארלינגטון-דאלאס` -> 32.7357, -97.1081 (stored 32.19, 34.87 = Israel) - each guarded by its current wrong value. `create table if not exists public.uploader_aliases (...)` per spec 3.1 with `unique (kind, from_key)`, RLS on, `revoke all on public.uploader_aliases from anon, authenticated`. `alter table public.venue_maps add column if not exists name_he text`. `insert into public.uploader_settings (key, value) values ('description_template:football', '{"template":"{בית} נגד {חוץ} ב{אולם}, במסגרת {מפעל}."}'), ('description_template:artist', '{"template":"{אמן} יוצא לסיבוב הופעות שחובה לראות! כרטיסים להופעה שלו ב{עיר}."}') on conflict (key) do nothing` (check the table's real column names in `20261027120500_uploader_settings.sql` first).
- [ ] **Step 2:** `loadLocations` selects `aliases` too; on 42703 it re-reads without it and fills `aliases: []`. Add `aliases?: string[]` to `Location` / `CreateLocationData` / `UpdateLocationData`.
- [ ] **Step 3:** Implement `lib/services/uploader-aliases.ts` (server-only, `db` boundary cast) per Interfaces.
- [ ] **Step 4:** Locations form: a "שמות נוספים (אנגלית / שפה מקומית)" text input, comma-separated <-> `aliases` (trimmed, empty parts dropped); create/update actions pass it through (explicit column mapping, never a spread of the client object).
- [ ] **Step 5:** Gates (tsc baseline, selftest). Commit `feat(uploader): location aliases, uploader_aliases and venue Hebrew names (migration)`.

### Task 2: One equivalence rule + the `same_show` question (pure)

**Files:**
- Create: `lib/uploader/equivalence.ts`
- Modify: `types/uploader.types.ts`, `lib/uploader/shows.ts` (`groupRows`), `lib/uploader/run-rules.ts` (`answerEffect`, `runRuleOf`, `applyRuleTo`), `lib/uploader/team-names.ts` (re-export `cleanClubName` from equivalence), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Consumes: `UploaderAlias`, `LocationRow` (Task 1) - type imports only.
- Produces:
  - `QuestionKind` += `"same_show" | "create_location"`.
  - `UploaderQuestion.pair?: { tixstock_city: string; livetickets_city: string; live_show: ShowIdentity }` (set on `same_show` only).
  - `cleanClubName(name: string): string` (moved here; qualifiers `FC|CF|AFC|SC|AC|SSC|BC|ACF|SS|US|AS|CFC|SV|FK|SK|CD|UD|RC|RCD|SL|CA` at either end, plus a trailing `Calcio` or 4-digit year).
  - `type Equivalence = { cityKey(name: string | null, pool?: readonly string[]): string; teamKey(name: string | null): string }`.
  - `buildEquivalence(locations: Pick<LocationRow, "name" | "aliases">[], aliases: Pick<UploaderAlias, "kind" | "from_key" | "to_key" | "team_id">[]): Equivalence`; `NO_EQUIVALENCE: Equivalence` (= `buildEquivalence([], [])`).
  - `groupRows(tix, live, s, plan, now = new Date(), eq: Equivalence = NO_EQUIVALENCE)`.

- [ ] **Step 1: Failing tests** (new section above `planTokenChecks`):
```ts
const eq = buildEquivalence([{ name: "רומא, איטליה", aliases: ["Rome", "Roma"] }], [{ kind: "city", from_key: "lisbon", to_key: "lisboa", team_id: null }]);
same(eq.cityKey("Roma"), eq.cityKey("Rome"), "location aliases share a key");
same(eq.cityKey("רומא"), eq.cityKey("Rome"), "the Hebrew short name joins its aliases");
same(eq.cityKey("Lisbon"), eq.cityKey("Lisboa"), "a confirmed city alias");
check(eq.cityKey("Paris") !== eq.cityKey("Rome"), "different cities stay apart");
same(eq.cityKey("K�ln", ["Köln", "Bonn"]), eq.cityKey("Köln"), "wildcard city");
same(NO_EQUIVALENCE.teamKey("SS Lazio"), NO_EQUIVALENCE.teamKey("Lazio"), "club rule");
same(NO_EQUIVALENCE.teamKey("ACF Fiorentina"), NO_EQUIVALENCE.teamKey("Fiorentina"), "ACF stripped");
same(buildEquivalence([], [{ kind: "team", from_key: "internazionale", to_key: "inter milan", team_id: 33 }]).teamKey("Internazionale"), "team:33", "team alias");
same(cleanClubName("US Sassuolo Calcio"), "Sassuolo", "cleanClubName");
```
  plus `groupRows` cases with synthetic rows: (a) Tix "SS Lazio vs Cagliari Calcio"/Roma + Live "Lazio vs Cagliari"/Rome same day with the Rome location equivalence -> ONE show carrying both suppliers, no question; (b) without equivalence -> one item with a `same_show` question whose `pair` is `{ tixstock_city: "Roma", livetickets_city: "Rome" }`, options keys `["same", "both", "skip"]`, text `TixStock מוכר הופעה ב-Roma ו-LiveTickets ב-Rome באותו יום (01.11.2026) - זו אותה הופעה?`; (c) two Tix-only rows + one Live-only row on one day (artist, three cities) -> no `same_show`, three shows; (d) a `pick_date` case from the existing tests still produces `pick_date` (no regression).
  `answerEffect` on `same_show`: `same` -> `requeue` with the show unchanged; `both` -> `split`: the item keeps TixStock only, `extra[0].show` = `pair.live_show` (LiveTickets only) with its question answered `both` and key suffixed `#both:2`; `skip` -> skip. `runRuleOf(same_show, …, { key: "same" })` -> `{ kind: "same_show", key: "same", venue: null, city: null }`; `applyRuleTo` answers another open `same_show` with `same`.
- [ ] **Step 2:** Run the selftest - the new section fails.
- [ ] **Step 3:** Implement. `cityKey`: `normalizeName`; a name holding `�` or `?` is resolved first against `pool` (each pool name normalized; the unique one matching with that character as any one letter, else unchanged); then the union-find group key (every location = one group of `normalizeName(shortPlace(name))` + its aliases; every city alias unites `from_key` and `to_key`; the key of a group = its smallest member). `teamKey`: `team:<id>` when `normalizeName(name)` is the `from_key` of a team alias, else `clubKey(cleanClubName(name)) || normalizeName(name)`. In `groupRows` use `eq` for every bucket key (replace the city / home parts: build the key as `${eq.cityKey(city, poolOfAllRowCities)}|${calendarDay(date)}|${football ? eq.teamKey(home) : ""}`), for the `away` days set and for `pick_date`'s `sameCity`. After the `pick_date` step, pair the remaining Tix-only and Live-only shows by day (+ home key for football) when the pairing is unique both ways -> a `same_show` question (`question(...)` helper, show = `tixShow(t, l, s)`, `pair.live_show = liveShow(l, s)`).
- [ ] **Step 4:** Selftest passes (all old checks too).
- [ ] **Step 5:** Commit `feat(uploader): one equivalence rule for cities and teams, and the same_show question`.

### Task 3: Equivalence on the server, learning city aliases

**Files:**
- Modify: `lib/services/uploader-search.ts` (`findCandidates`), `lib/actions/uploader-actions.ts` (`answerQuestion` and its per-item helper), `app/(dashboard)/uploader/[id]/question-card.tsx` (render `same_show` like the other kinds; nothing special beyond its options), `lib/uploader/decisions.ts` / board words only if a label is missing for the new kinds.

**Interfaces:**
- Consumes: `loadAliases`, `recordAlias`, `loadLocations` (Task 1); `buildEquivalence`, `groupRows(…, eq)` (Task 2).
- Produces: `loadEquivalence(): Promise<Equivalence>` in `lib/services/uploader-aliases.ts` (locations + aliases; a failed locations read throws like `loadLocations`).

- [ ] **Step 1:** `findCandidates` builds `eq = await loadEquivalence()` (in parallel with the supplier reads) and passes it to `groupRows`.
- [ ] **Step 2:** In the answer path: when the question is `same_show`, the key is `same` and `pair` exists -> `recordAlias({ kind: "city", from_name: pair.livetickets_city, to_name: pair.tixstock_city, created_by: session user })`; the audit `uploader.answered` metadata gets `alias_recorded: boolean`. A failed alias write never fails the answer. The run-rule path ("החל גם על …") goes through the same helper, so every answered item records its own pair.
- [ ] **Step 3:** `same_show` items are counted / filtered / tasked like any question (check `uploader-questions.ts` texts per kind; the task title for `same_show`: "אותה הופעה? <subject> <date>").
- [ ] **Step 4:** Gates. Commit `feat(uploader): pair shows by the equivalence rule and learn a confirmed city alias`.

### Task 4: City beats bad coordinates; `create_location` asked (pure placement)

**Files:**
- Modify: `lib/uploader/place.ts`, `lib/uploader/warnings.ts`, `lib/uploader/decisions.ts`, `lib/uploader/run-rules.ts` (`runRuleOf` / `applyRuleTo` for `create_location`), `lib/services/uploader-build.ts` (`readPlaceInput`, the place step, warnings input), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Consumes: `Equivalence` (Task 2), `loadEquivalence` (Task 3).
- Produces: `PlaceInput.cityKey: (name: string | null) => string`; `PlaceInput.prior` gains `kind: QuestionKind`; `PlaceResult` `placed` gains `coordsFar: { city: string; km: number } | null`; `pickLocationQuestion` options end with `{ key: "create", label: "צור מיקום חדש" }` before `skip`; `createLocationQuestion(show, subject_en, rows, withoutLocation, far: FarVenue | null, now): UploaderQuestion`.

- [ ] **Step 1: Failing tests:** Berlin case - show city "Berlin", coords 51.5/10.5, rows incl. Berlin (52.53, 13.39, BER, aliases ["Berlin"]) and Hannover -> `placed`, package, `location.city_iata === "BER"`, decision code `location_by_city`, `coordsFar.km > 50` (≈ 226); a venue 4 km from Madrid with city "Madrid" -> today's `location_found` (no `coordsFar`); duplicate location rows (two Munich rows) -> the nearer to the venue; a country mismatch (show "Birmingham" GB, location "Birmingham" US) -> not by city; no location within 50 km, Valencia coords, a far location 300 km -> `ask` with `kind: "create_location"`, options keys `["create", "two_city:<id>", "ticket_only", "skip"]` when `withoutLocation = "ticket_only"`, and labels `צור מיקום ל-Valencia`, `כרטיס בלבד (לפי הבריף)`; with `withoutLocation = "skip"` the order is `create, two_city, skip, ticket_only` and `דלג (לפי הבריף)`; answers on that question: `ticket_only` -> `placed` ticket-only (today's step-6 body), `skip` -> skip `skipped_by_answer`, `two_city:<id>` -> the two-city package, `"<id>"` -> package at that row; a `prior` of kind `create_location` with `ticket_only` -> ticket-only with the `prior_answer` decision. Run rule: `ticket_only` / `skip` on `create_location` apply to every open `create_location`; `two_city:<id>` only where the other show's city is the same (`normalizeName`) and has that option.
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement per spec 3.4 / 4.1 / 4.3. The by-city step sits after step 3 (no coordinates) and before step 4, and only fires when the city location is farther than `NEAR_LOCATION_KM` (nearer = step 4 already finds it). `liveCityLocation` also matches `cityKey`. Step 2 handles an answered `pick_location` OR `create_location`; step 6 asks `createLocationQuestion` (text `אין לנו מיקום ל-${city}${venue ? ` (${venue})` : ""}. מה לעשות?`). `warningsFor` input gets `coordsFar` -> warning `venue_coords_far` text `הקואורדינטות של האולם רחוקות ${km} ק"מ מ${city} - נבנה לפי שם העיר`. Decision `location_by_city`: `מיקום לפי שם העיר: ${city} (${iata})`. In the build: `readPlaceInput` passes `eq.cityKey`, reads the item's answer when its question is `pick_location` or `create_location`, and reads priors whenever there is no answer and no two-city (a prior of either kind for the same `questionKey`).
- [ ] **Step 4:** Selftest passes.
- [ ] **Step 5:** Commit `feat(uploader): place by the city name over bad coordinates, ask before a show with no location`.

### Task 5: Create a location from a question

**Files:**
- Create: `lib/uploader/location.ts` (pure), `lib/services/tour-uploader-location.ts` (AI call), `app/(dashboard)/uploader/[id]/create-location-dialog.tsx`
- Modify: `lib/actions/uploader-actions.ts`, `lib/uploader/action-types.ts`, `app/(dashboard)/uploader/[id]/question-card.tsx`, `lib/agents/tour-uploader.agent.ts` (learnsFrom += `uploader.location_created`), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Consumes: `loadLocations`, `loadEquivalence` (Tasks 1, 3); the answer/requeue helper used by `answerQuestion`.
- Produces: `type LocationInput = { name_he: string; iata: string; latitude: number; longitude: number; country_code: string | null; aliases: string[] }`; `validateLocationInput(raw: unknown, existing: Pick<LocationRow, "id" | "name" | "city_iata">[]): { ok: true; value: LocationInput } | { ok: false; problem: string }`; `parseLocationProposal(raw: unknown, fallback: LocationInput): LocationInput`; actions `proposeLocation(itemId: string): Promise<{ ok: true; proposal: LocationInput; ai: "ok" | "off" | "no_answer" | "rate_limited" } | { ok: false; kind: string }>` and `createLocationAndAnswer(itemId: string, input: unknown): Promise<{ ok: true; location_id: number; applied: number } | { ok: false; kind: string; problem?: string }>`.

- [ ] **Step 1: Failing tests:** `validateLocationInput` - valid Valencia (`"ולנסיה, ספרד"`, `"vlc"` -> `"VLC"`, 39.47, -0.38, `"ES"`, `["Valencia", "València", "valencia"]` -> aliases deduped by `normalizeName`, max 10, each ≤ 60) ok; refuses: no Hebrew letter (`"Valencia, Spain"`), IATA `"VL"` / `"VLC1"`, lat 95, lon -200, country `"ESP"`, and an existing row `{ id: 40, name: "ולנסיה, ספרד", city_iata: "VLC" }` -> problem `המיקום כבר קיים (#40)`. `parseLocationProposal` keeps the fallback's coordinates when the model's are missing or out of range and drops a bad IATA to `""`.
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement the pure module; the AI call `propose_location` (tool fields `name_he`, `iata`, `latitude`, `longitude`, `aliases`; prompt: the city, country code, venue and coordinates as data; house rule "name_he is `<city>, <country>` in Hebrew like the existing rows"; lessons `uploader.location_created`); `proposeLocation` = item's show -> fallback `{ name_he: "", iata: "", latitude: show.lat ?? 0, longitude: show.lon ?? 0, country_code: show.country_code, aliases: [show.city] }`; `createLocationAndAnswer` = `requireAdmin` -> item must be `question` with kind `create_location` or `pick_location` -> validate -> insert into `locations` (with `aliases`; on 42703 insert without and say so in the log) -> audit `uploader.location_created` (`agent: "tour-uploader"`, location id, name, iata, the show's city, `ai_proposed` flags per field) -> append option `{ key: String(id), label: name_he }` and answer it through the same per-item answer helper `answerQuestion` uses (task closed, item re-queued, `uploader.answered`) -> every other open `create_location` / `pick_location` item of the run whose `cityKey(show.city)` equals this one's gets the same -> `{ ok: true, location_id, applied }`. Dialog: opened by the `create` option on the question card; fields name / IATA / lat / lon / aliases (comma-separated); calls `proposeLocation` on open (spinner, the `aiLine` texts of the classify dialog), "צור מיקום ובנה" calls `createLocationAndAnswer`, a problem shows under the form, success toasts `נוצר מיקום ${name} · ${applied + 1} הופעות ייבנו כחבילה` and refetches the board.
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `feat(uploader): create a location from the board, proposed by the agent and confirmed by a person`.

### Task 6: LiveTickets categories that are not instant-confirm

**Files:**
- Modify: `types/uploader.types.ts` (`rules.livetickets_non_instant: boolean`), `lib/uploader/plan.ts` (`PLAN_TOOL_SCHEMA`, `parsePlanInput`, `emptyPlan`, `planDiff`, `applyPriorDefaults` if it touches rules), `lib/uploader/tickets.ts` (`ticketsFromLiveStock`), `lib/services/uploader-build.ts` (the LiveTickets step + its decision line), `app/(dashboard)/uploader/plan-card.tsx` (switch), every place that reads a stored `run.plan` (default the field), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Produces: `ticketsFromLiveStock(stock, eid, priceUsd, opts: { nonInstant: boolean } = { nonInstant: false })` - with `nonInstant`, a `nonInstantOnly` category with a usable cost becomes a ticket carrying `nonInstant: true`; the return gains `nonInstant: number` (how many such tickets). `planNonInstant(plan: UploaderPlan): boolean` = `plan.rules.livetickets_non_instant !== false`.

- [ ] **Step 1: Failing tests:** stock with one sellable, one `nonInstantOnly`, one `Single seats` category: with `{ nonInstant: true }` -> 2 tickets, the second `nonInstant === true`, `nonInstant: 1`, the singles one in `dropped`; without -> today's result. `parsePlanInput` of a raw plan with no `livetickets_non_instant` -> `true`; with `false` -> `false`. `planNonInstant` of a plan object missing the field (an old stored plan, cast) -> `true` (`old plan`).
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement. Tool schema: `livetickets_non_instant` boolean under `rules`, described "false only when the brief asks for instant-confirm tickets only". The build passes `{ nonInstant: planNonInstant(run.plan) }` and adds the decision `tickets_livetickets_non_instant` text `${n} קטגוריות LiveTickets ללא אישור מיידי (יסומנו באתר)` when n > 0; the "dropped as not instant" line stays only when the switch is off. Plan card: a switch "כולל קטגוריות LiveTickets ללא אישור מיידי" under the suppliers line, default on.
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `feat(uploader): bring LiveTickets non-instant categories marked nonInstant (switch on the plan card)`.

### Task 7: Names without duplicates, link to an existing page

**Files:**
- Modify: `lib/uploader/team-names.ts` (`distinctSides`, `missingSides`, `cleanTeamRows` + the dialog row types), `lib/services/uploader-search.ts` (`resolveSubject`'s `teamsHe`: add each team alias' `from_key` -> that team's Hebrew name), `lib/actions/uploader-actions.ts` (`createTeamsAndRename`, new `searchTeamsForLink`), `app/(dashboard)/uploader/[id]/names-dialog.tsx`, `lib/services/tour-uploader-classify.ts` (`NAMES_LESSON_SOURCES` += `uploader.team_linked`), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Consumes: `teamKey` / `NO_EQUIVALENCE` / `cleanClubName` (Task 2), `recordAlias`, `loadAliases` (Task 1).
- Produces: a dialog row may carry `link_team_id: number | null` (read the existing row / answer types first and extend them - mode create / link / skip as they are today plus link); `searchTeamsForLink(query: string): Promise<{ ok: true; teams: { id: number; name: string; name_english: string | null; is_active: boolean }[] } | { ok: false; kind: string }>` (admin, query 2..60 chars, `matchesSearch` over both names, not deleted, at most 20).

- [ ] **Step 1: Failing tests:** `missingSides` over items whose sides are "Cagliari Calcio" and "Cagliari", "ACF Fiorentina" and "Fiorentina" -> two rows, not four (`teamKey` dedupe, first spelling kept); `cleanTeamRows` of two create rows named "Cagliari" / "cagliari" with the same Hebrew -> ONE row to create carrying both supplier spellings (`collapse`); a link row with `link_team_id: 33` passes and is not a create.
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement. `createTeamsAndRename`: after `cleanTeamRows`, re-read `football_teams` (not deleted, inactive included) and turn a create row whose English name matches an existing team by `clubNamesMatch` into a link; one insert per collapsed row; for every link `recordAlias({ kind: "team", from_name: supplier spelling, to_name: team.name_english ?? team.name, team_id })` and audit `uploader.team_linked` (`agent`, run_id, team_id, from_supplier_name); the rename uses the linked team's Hebrew name for every spelling of the row. Dialog: each row gets "זה עמוד קיים" -> a search box (debounced 250 ms, `searchTeamsForLink`) listing "<Hebrew> · <English>" (+ "לא פעיל"); picking one shows it in the row with an "×" to undo.
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `fix(uploader): one team per club in the names dialog, and link a name to an existing page`.

### Task 8: "פתח משימה" on the panel's page rows

**Files:**
- Modify: `lib/uploader/run-panel.ts` (`PanelRow.task`, `runLevelRows` input `subject.row_id`), `app/(dashboard)/uploader/[id]/run-panel.tsx`, the caller that builds the panel input (`board-client.tsx` / `getRun` - the subject row id comes from the run's resolved subject), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Produces: `PanelRow.task?: { title: string; table: "football_teams" | "artists"; row_id: number | string; label: string; url: string }`.

- [ ] **Step 1: Failing tests:** the subject row of a team run with no page -> `task.title === "לבנות עמוד קבוצה: Lazio"`, `table: "football_teams"`, `row_id: "Lazio"` when `row_id` is null, `url: "/templates"`; with `row_id: 55` -> `row_id: 55` and `url` = the Templates edit path of team 55 (find the real route under `app/(dashboard)/templates/`); an artist run -> `לבנות עמוד אמן: …`, `artists`; a fix row (crest) -> `task.title === "<the row's text>: Lazio"` and `url` = the warning's `fix_url`.
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement; `run-panel.tsx` renders "פתח משימה" beside the row's button and opens the shared `TaskEditor` (`components/task-editor.tsx`) with `prefill = { title, description: "מתוך ריצת העלאה: <absolute board url>", priority: "medium", source: "creative_gap", source_ref: { kind: "uploader_page", table, row_id, label, url }, origin: "מה-AI Uploader" }` and `defaults: { board: "marketing" }`.
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `feat(uploader): open a task for a missing page from the run panel`.

### Task 9: Classify dialog - no description line, the hall's Hebrew name

**Files:**
- Modify: `lib/services/tour-uploader-classify.ts` (`classify_venue` tool: drop `description_he`, add top-level `venue_he`), `lib/uploader/classify.ts` (proposal parse, `templateFromRows` keeps a zone's stored description), `lib/services/uploader-store.ts` (venue template read/write `name_he`, tolerant), `lib/actions/uploader-actions.ts` (`proposeVenueClassification` returns `venue_he`; `classifyVenue` takes it), `lib/uploader/description.ts` (`descriptionValues` input `venueHe`), `lib/services/uploader-description.ts` + `lib/services/uploader-build.ts` (pass the template's `name_he`), `app/(dashboard)/uploader/[id]/classify-dialog.tsx`, `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Produces: `classifyVenue(runId, sourceUrl, rows, opts?: { venueHe?: string | null; excludedSections?: string[] })` (Task 10 fills `excludedSections`); `descriptionValues({ …, venueHe: string | null })` - `אולם.he = venueHe ?? <English venue>`; venue template gains `name_he: string | null`.

- [ ] **Step 1: Failing tests:** `descriptionValues` with `venueHe: "קאמפ נאו"` and template `{בית} נגד {חוץ} ב{אולם}, במסגרת {מפעל}.` fills `ברצלונה נגד ויאריאל בקאמפ נאו, במסגרת הלה ליגה.` (teams / league fed through the existing inputs); without `venueHe` -> the English venue. `templateFromRows` with a row whose description is `""` and a stored template zone description `"מאחורי השער"` keeps `"מאחורי השער"`. The proposal parse ignores a model `description_he` and reads `venue_he` (trimmed, ≤ 80, Hebrew letter required, else null).
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement. Dialog: remove the description column and its state; add at the top "שם האולם בעברית" (input, prefilled from the stored `name_he`, else the proposal). The confirm saves `name_he` and rewrites the descriptions of the venue's items through `rewriteRunDescriptions` (only events whose description is still the uploader's own).
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `feat(uploader): classify dialog names the hall in Hebrew and drops the description line`.

### Task 10: The map in the classify dialog, excluded sections for the whole hall

**Files:**
- Create: `components/venue-section-map.tsx`
- Modify: `app/(dashboard)/uploader/[id]/classify-dialog.tsx`, `lib/actions/uploader-actions.ts` (`proposeVenueClassification` returns the drawing's SVG text; `classifyVenue` stores and applies sections; `learnPreview` / `learnFromEvent`), `lib/services/uploader-store.ts` (`parseDroppedCategories` -> `sections: string[]`, the dropped write keeps `tixstock_sections`), `lib/uploader/classify.ts` (`applyClassification` sets `tx_excluded_sections`; `templateFromEvent` copies the event's list), `lib/uploader/tickets.ts` + `lib/services/uploader-build.ts` (a new build starts with the template's sections and prices with them), `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Consumes: `classifyVenue(…, { excludedSections })` (Task 9); the editor's section helpers (`isSectionExcluded` - find its module from `app/(dashboard)/events/[id]/page.tsx`'s import) and the supplier SVG fetch (`lib/venue-maps/supplier-svg.ts`).
- Produces: `<VenueSectionMap svg={string} excluded={string[]} highlightCategory={string | null} onToggle={(sectionId: string) => void} />`.

- [ ] **Step 1: Failing tests:** `applyClassification` with template sections `["101", "102"]` -> the event update carries `tx_excluded_sections: ["101", "102"]`; `templateFromEvent` of an event with `tx_excluded_sections: ["7"]` -> template sections `["7"]` (`learn copies sections`); the TixStock ticket builder with excluded `["101"]` never prices a listing in section 101 (reuse `listingsTheSiteSells` - the same rule main uses).
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement. The map renders the SVG the way the event editor does (same sanitizing / `data-section` / `data-category` handling and the `svg-excluded` / `svg-highlighted` classes from `app/globals.css`); hovering a table row sets `highlightCategory`; clicking a section toggles it; a line under the map counts "N גושים מוחרגים - לא יימכרו בכל ההופעות באולם". Layout: map beside the table from `md` up, above it on a phone. The confirm passes `excludedSections`; `classifyVenue` writes them to the template and to `tx_excluded_sections` of every ready / approved event of the venue (direct column update, payload follows so the approve-time edit diff stays clean); the toast adds "המחירים יתעדכנו בסנכרון הבא".
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `feat(uploader): the hall's map in the classify dialog, with sections excluded for every show`.

### Task 11: Plan card - steer the AI, its questions, the description template

**Files:**
- Modify: `lib/uploader/plan.ts` (`PLAN_TOOL_SCHEMA` += `questions`; new `parseQuestions`), `lib/services/tour-uploader-parse.ts` (`parsePrompt` takes the steer; returns questions), `lib/actions/uploader-actions.ts` (`parseBrief(brief, steer?)`, `createRun` takes `descriptionTemplate`, new `getFamilyTemplate`), `lib/services/tour-uploader-parse.ts` lesson sources += `uploader.plan_steered`, `app/(dashboard)/uploader/uploader-client.tsx`, `app/(dashboard)/uploader/plan-card.tsx`, `scripts/tour-uploader-selftest.ts`

**Interfaces:**
- Produces: `parseQuestions(raw: unknown): string[]` (strings only, trimmed, ≤ 200 chars each, ≤ 5, blanks dropped); `parseBrief(brief: string, steer?: { instruction: string; plan: UploaderPlan }): Promise<… existing result … & { questions: string[] }>`; `getFamilyTemplate(family: TemplateFamily): Promise<{ ok: true; template: string | null } | { ok: false; kind: string }>`; `createRun(…existing…, descriptionTemplate?: string | null)`.

- [ ] **Step 1: Failing tests:** `parseQuestions(["  מה העונה? ", "", 5, "x".repeat(300), "a", "b", "c", "d"])` -> `["מה העונה?", "x".repeat(200), "a", "b", "c"]`; `parsePrompt` with a steer contains the current plan JSON and the instruction INSIDE the fence (between the open and close markers) and defuses a fence marker typed in the instruction.
- [ ] **Step 2:** Run - fails.
- [ ] **Step 3:** Implement. The steer instruction is 3..500 chars (`steer_invalid` otherwise), counted by the parse cap; after an answer audit `uploader.plan_steered` (`agent`, `user_id`, `steer`, `before`, `after` - the plans) - only when the AI answered. Plan card: under the plan, "ה-AI שואל:" with the questions (when any), then "כוון את ה-AI" - a textarea + "שלח" (busy state; the new plan replaces the card's, the card's own edits are lost only after confirming like "ערוך את הבריף" does); then "תבנית תיאור" for the subject's family - the template (from `getFamilyTemplate`), the token chips of `DESCRIPTION_TOKENS[family]` (click inserts at the cursor), a preview filled with sample values (football: ברצלונה / ויאריאל / קאמפ נאו / הלה ליגה / ברצלונה / today; artist: the plan's `name_he` or `name_en` / לונדון / The O2), and `cleanTemplate`'s problem under it. `createRun` saves the template (`cleanTemplate`, then the existing service write + `uploader.description_template` audit) only when it differs from the stored one; a failed template save never fails the run (toast says so).
- [ ] **Step 4:** Gates.
- [ ] **Step 5:** Commit `feat(uploader): steer the AI before the run, show its questions, edit the description template on the plan card`.

### Task 12: Board - "פעילים" by default, learn in two steps

**Files:**
- Modify: `app/(dashboard)/uploader/[id]/board-words.ts` (`FILTERS`, `FILTER_HE`, `inFilter`, `filterCount`, new `LEARN_STEP_1`, `LEARN_STEP_2(n)`, `LEARN_LOCKED_LINE`, `LEARN_RECIPE`), `board-client.tsx` (default filter), `show-card.tsx` (`LearnSteps`), `run-panel.tsx` / `lib/uploader/run-panel.ts` (venue row line), `classify-dialog.tsx` (footer line), `scripts/tour-uploader-selftest.ts` if `board-words` is covered there (else no test - UI copy)

**Interfaces:** none new outside the board.

- [ ] **Step 1:** `FILTERS = ["active", "questions", "ready", "attention", "approved", "skipped", "rejected", "errors", "all"]`; `FILTER_HE.active = "פעילים"`; `inFilter("active", i)` = status not `rejected` / `skipped`; `filterCount("active", c) = c.total - c.rejected - c.skipped`; `useUrlState("f", "active", FILTERS)`; the empty-filter "show all" link goes to `active`.
- [ ] **Step 2:** `LearnSteps` on a card with `hallmates > 0` and an `event_id`: not fixed by hand -> `1. סדרו את האירוע בעורך` (link `/events/<id>`, new tab) + disabled `2. למדו והחילו על ${n} ההופעות` + `אחרי השמירה בעורך הכפתור נפתח`; fixed -> step 1 shows "✓" and step 2 is today's `LearnButton`. `LEARN_RECIPE = "רוצים לסדר ידנית? סדרו אירוע אחד בעורך, חזרו ולחצו \"למדו והחילו\" בכרטיס שלו"` - under the panel's venue rows and in the classify dialog's footer.
- [ ] **Step 3:** Gates.
- [ ] **Step 4:** Commit `feat(uploader): active shows by default, learn-from-event in two clear steps`.

### Task 13: Guide, CLAUDE.md, how-to

**Files:**
- Modify: `app/(dashboard)/guide/guide-content.ts` (the uploader section: aliases + same-show question, create location, non-instant switch, steering, template on the card, the map, "פעילים", learn steps - both languages), `CLAUDE.md` (a paragraph "Alon's round 2 (28.10.2026 …)" after the 27.10 one under Agent #3: what changed + the migration name + the four decisions), `docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md` (the steps that changed)

- [ ] **Step 1:** Write the three; `npx tsx scripts/guide-selftest.ts` passes.
- [ ] **Step 2:** Commit `docs(uploader): Alon round 2 in the guide, CLAUDE.md and the how-to`.
