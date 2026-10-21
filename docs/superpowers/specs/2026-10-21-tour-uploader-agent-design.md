# Tour uploader - agent #3 (design)

**Date:** 2026-10-21 · **Owner:** Dor · **Builder:** Claude · **Repo:** myt-backoffice (`master`), one small change in myt-main.

## 1. Intent

A staff member types one Hebrew (or English) brief - "יצא טור של אריק קלפטון... חבילות לכל היעדים שיש לנו לוקיישן, השאר כרטיס בלבד 250, אדישנל 75, כל הספקים" - and the system turns the whole tour (or a team's home games, or a competition round) into events: every show found at our suppliers, every supplier attached to ONE event, priced by the one pricing rule, uploaded **hidden**, laid out on a review board with the decisions the AI took, warnings about what will go up incomplete, blocking questions back to the sender when the tickets cannot be resolved, and an Approve per event (or for all) that publishes to the site. Every approve, edit-before-approve, rejection and answered question is recorded and read back on the next run, so the next run has fewer gaps and fewer questions.

Dor's words (21.10): "מעלה את כל האירועים נסתר - מסדר בטבלה ברורה עם כל הפרטים הנחוצים + עמודה של החלטות שה-AI קיבל, ואם כפתור אישור לכל אירוע - שמעלה אותו לאתר - ואם יש חוסר בעמוד אמן או תמונות גלריה וכו' - לשים אזהרה... אם יש בכרטיסים משהו שלא מצליח - לתת פינג עם שאלה למי ששלח את ההודעה לפני שממשיך... שהאייג'נט ילמד מכל עלייה כזו מוצלחת." And: "זה לא רק לאמן - יכול לעשות משהו שתומך גם בכדורגל."

Why now: a tour of 10-20 shows is a day of clicking in the event editor (TixStock show → connect → LiveTickets → zones → location → base prices → save, per show), the Events Factory that was meant to batch it is "לא מאוד שמיש", and the suppliers' catalogs are already in our DB - the work is matching and assembling, which is what an agent is for.

## 2. Goals, non-goals, anti-goals

**Goals**
- One brief → one run → N hidden events with all requested suppliers attached, in minutes, with no event editor visit for the normal case.
- The person reviewing sees, per show: what was built, **why** (decisions), what is missing (warnings), and can approve / edit / reject.
- Nothing reaches a customer before a human approves it.
- The agent never guesses on tickets: an unresolvable ticket question blocks that show and asks the sender.
- Every run teaches the next one.
- Football is a first-class subject: a team's home games (default), all its fixtures, a competition round.

**Non-goals (phase 1)**
- WhatsApp pings (needs the Cloud API; the question goes to the screen + a task + mail).
- Creating artist / team pages or pictures - the board warns and links to the fix; it does not build CMS content.
- Attaching XS2Event / P1 as ticket suppliers (not attachable as a second supplier today). They are a fallback **search** only: a show no requested supplier sells is reported "found at XS2Event / P1 (information only)".
- Several subjects in one brief ("Clapton and Coldplay") - one subject per run; the parser refuses a multi-subject brief with a clear message.
- Auto-approve, even after many good runs. Approval stays human (Dor: "שעדיין מאפשר את יכולת האישור הסופי").
- Mega Family / tours companies. Mega Events only (`productType: "events"`).

**Anti-goals (what would make this a failure even if it "works")**
- A hidden event that shows up anywhere on the site, in the Meta feed, or in a Mega Family feed.
- A duplicate of an event that already exists.
- An event with no sellable ticket.
- A guessed supplier match (wrong show attached to an event).
- The AI writing a price. Prices come from the pricing rule, the supplier formula and the brief's markups only.
- Staff text (brief, answers, notes) steering the model as instructions.

## 3. Decisions made in the brainstorm (Dor, 21.10)

| # | Decision | Dor's answer |
|---|----------|--------------|
| 1 | Fate of the Events Factory | **Replaced.** Same menu slot, `/factory` and `event_drafts` go, dead code removed. |
| 2 | Confirm the plan before building | **Yes** - a "מה הבנתי" card, one click to build. Plus: a popup/toast on every screen when the AI is waiting for the user's answer. |
| 3 | A show no supplier sells | **No event.** "אין כרטיסים אין אירוע" is one of the first validations. The row is shown grey with "צור ידנית". |
| 4 | Question channel | Screen row + a task assigned to the sender (mail through the existing task mail). Answered on the screen, the task closes by itself. |
| 5 | Who | **Admin and up** (`ADMIN_ROLES`) runs, answers and approves. |
| 6 | Suppliers | **TixStock + LiveTickets only.** XS2Event / P1 only as a fallback search when neither sells a show. |
| 7 | Football default scope | Team = **home games only** unless the brief says otherwise; competition = every fixture of that stage found at a supplier. |
| 8 | Board layout | **Cards board (mockup B)** - a card per show with the picture the site will draw, filters on top (questions / ready / warnings / published / skipped), approve-all bar at the bottom. |
| 9 | A venue more than 50 km from every location (Manchester when we only have London) | **Memory first, no guessed flight city.** Two-city only when the last event at that venue was built two-city (stadium memory); a new far venue follows the brief (ticket only / skip) - and the agent must **learn, slowly, when to build a two-city package with a hotel split**: "שהמשחק לא באותה עיר אפשר לייצר פיצול מלון". See §9.2. |
| 10 | Buying through the preview link | **Blocked.** main's `confirm-order` refuses an `is_hidden` event ("האירוע עדיין לא פתוח להזמנה"); the preview page itself renders. |

## 4. What exists and is reused (read `CLAUDE.md` sections first)

- **Agent layer** `lib/agents/` - declaration (`<name>.agent.ts`), registry, `switch.ts` (opt-in, fails closed, budget, cost), `memory.ts` (house rules + taught rules + fenced lessons from `audit_log`), AI Factory screens (`/ai-factory`, `agent_instructions`, `agent.feedback`). Agent #3 is one more declaration.
- **Provider catalogs** in the DB: `tixstock_events` (performers[], category_name = competition, venue_data with coords, venue_map_url, ticket_count), `live_events` (performers[] with hebName, event_name_heb, venues[], ticket_categories, event_type music/sports), `xs2e_events`, `p1_events`.
- **Supplier plumbing**: `lib/suppliers.ts` (`SUPPLIERS`, `supplierPriceUsd`, `normalizeSupplierCategory`), `lib/tixstock-listings.ts` (`listingsTheSiteSells` - the site's three rules), `lib/services/tixstock-price-sync.ts` (`fetchTixStockFeed`, `tixstockTicketPriceUsd`), `lib/services/livetickets-offers.ts` (`fetchLiveTicketsStock`, `toLiveTicketsCategory`, `liveTicketsPriceUsd`), `lib/actions/supplier-attach-actions.ts` (candidate finders, `buildLiveTicketsDrafts` - the ticket shapes), `lib/tixstock-home.ts` (`isHomeGame`, `homeTeamOf`), the editor's `zoneFromTemplate` (`components/event-suppliers-panel.tsx` - moves to a pure module), `venue_maps` (our copy of a supplier drawing: `svg_url`, `zones`, `supplier_categories`).
- **Building blocks**: `lib/services/nearest-location.ts` (`findNearestIata` within 50 km over `locations`), `lib/services/venue-memory.ts` (`findVenueMemory` - lodging + map twin), `lib/services/price-quote.ts` (`quoteFlight`, `quoteHotel` - the ONE pricing rule), `calculateSmartDates` (`app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts`), `createEvent` / `softDeleteEvent` (`lib/actions/event-actions.ts`), `lib/package-mode.ts`, `lib/revalidate-main.ts`.
- **Warnings**: the creative-gaps predicates (`lib/services/creative-gaps.ts` - `artist_hero` = no `image_url` and no `art_image_url`, `artist_gallery`/`team_gallery` = `gallery` empty, `*_bio` = `bio` null, `team_crest` = no `logo_url` and no crest-library row), `lib/creative/auto.ts` (`creativeGap`: `photo-circle` = artist with a flat photo only), `lib/services/category-twins.ts`, `lib/on-tour.ts` (`eventMatchesName`, `clubNamesMatch`, `normalizeName`).
- **Asking a human**: tasks (`tasks` table, `openPriceLightTask` is the pattern for a system-opened task), `lib/services/task-notify.ts` (`notifyTaskAssigned`), `setTaskStatus`.
- **Learning**: `logAudit`, `AgentDefinition.learnsFrom`, `agent_instructions`.

## 5. The flow, as the person sees it

Menu: **AI Uploader** (group Products, `productType: "events"`, `roles: ADMIN_ROLES`, icon `Bot`), route `/uploader`. `/factory` redirects to it.

### 5.1 `/uploader` - runs + a new brief
Top: the composer - one big textarea ("כתבו מה להעלות, כמו שהייתם כותבים לעמית"), two example chips (an artist tour, a team's home games), a "פענח" button. Under it: the list of past runs (subject, when, by whom, counts: published / ready / questions / skipped, a status pill), newest first; a row opens `/uploader/[id]`.

When the agent is off (`TOUR_UPLOADER_AI` not "on", or no key): the composer says so and offers the **manual plan form** instead (subject search over artists / teams / TixStock competitions, markups, the location rule, scope). The rest of the flow is identical - the AI only ever fills this form.

### 5.2 The plan card ("מה הבנתי")
The parse answers a `UploaderPlan` (§7). The card shows it as editable fields:
- Subject: kind (אמן / קבוצה / תחרות), name (Hebrew + English), the matched page (artist / team row, with ✓ / "אין עמוד"), for a competition the TixStock category name.
- Scope: date from / to (default: from today + 3 days, open-ended), football: home only / all fixtures, a round / text filter, exclusions (cities).
- Rules: with a location → package; without → ticket only **or** skip (from the brief; "ticket only" when the brief says so, else skip - the brief must say).
- Markups: `ticket_only_markup`, `event_additional_markup`. A markup the brief did not state is prefilled from the last run of the same subject kind and marked "מהפעם הקודמת" - still a value the person sees before anything is built.
- Suppliers: TixStock ✓ LiveTickets ✓ (the only two; fixed).
- Who answers questions: the sender (default), changeable to another staff member.
- Preview: "נמצאו N הופעות אצל הספקים" (the search runs at parse time - DB only, fast) with the list of cities + dates, and the ones that already exist as events marked "קיים (#id)".

Buttons: **בנה את האירועים (N)** · "ערוך את הבריף". Building starts a run.

### 5.3 The board `/uploader/[id]` (layout B)
Header: subject + run number + sender + time, the brief (one line, expandable), the five-step strip (פענוח → חיפוש → בנייה → שאלות → אישור) with counts, the plan chips (subject page ✓/✗, counts, markups, suppliers). An amber bar when a question is open: "ה-AI מחכה לך: ...".

Filters: הכל · שאלות · מוכנים · אזהרות · באתר · לא נוצר.

A **card per show**: picture (the artist's / home team's picture the site would draw - `lib/homepage/event-art.ts` rule; a placeholder when none), city · venue · date, a status pill, mode (חבילה / כרטיס בלבד) and "החל מ-$X" (`siteCardPrice` of the built event), supplier chips (Tix 11 · Live 3 · Live ✗), the **decisions** list (short Hebrew lines, each a checkable fact), the **warnings** (amber), and the actions: **אשר** (primary) · **ערוך** (opens `/events/[id]` in a new tab) · **דחה** (reason dialog). A question card shows the question, its options as buttons, a free-text box, "נשלח כמשימה ל<name>", and a "ענה" button. A skipped card is grey with the reason and "צור ידנית" (→ `/events/new`). A published card shows "באתר ✓", who approved and when, a link to the site.

Bottom bar (sticky): counts + **אשר הכל (N)** - every `ready` card with no blocker.

Build progress: the board polls while the run is `building` (the client loops `buildNextItem(runId)` as the factory did, one item per server-action call, stoppable with "עצור"; a refresh resumes where it was). Each card appears as it is built.

### 5.4 The waiting toast (Dor's #2)
A small client component mounted in the dashboard layout, admins only: every 60 s it asks `countOpenQuestionsFor(me)` and, when the count rose, shows a persistent toast "🟠 ה-AI מחכה לתשובה - טור X: שאלה על Y" with a link to the board. Dismissing hides it until a new question arrives. Also a badge count on the menu item.

## 6. Data model

### 6.1 `events.is_hidden boolean not null default false` (+ partial index where true)
"Uploaded, not yet approved." Not `is_test` (QA events read as "test" on the events table and mean something else), not `deactivated_reason` (owned by the TixStock sync and shown as sold out). Written by the uploader only; `updateEvent` strips it like the light columns (a form opened before an approve would hide the event again). Approve sets it false.

**Who must respect it** (nothing hidden may be shown, drawn or fed):
- myt-main: `isListedEvent` (`lib/eventsData.ts`) adds `!event.is_hidden`; the feed read in `lib/feed/feedData.ts` filters it like `is_test`; `lib/app.types.ts` gets the field; **`app/api/confirm-order` refuses an `is_hidden` event** (Dor 21.10, decision 10 - the same family of checks as `validateOwnStock`, answered as a clear "האירוע עדיין לא פתוח להזמנה", never a generic failure). `/order/{id}` stays reachable by direct link - that is the preview an admin uses before approving (unlisted, like `is_test`) - but nobody can complete an order on it. Checked with the `cross-impact-reviewer` agent.
- Backoffice readers of live events for the site side: the creative cron and the forced-redraw panel (`lib/creative/auto.ts`, `lib/actions/meta-feed-actions.ts` - a hidden event gets no creative; the panel says "מוסתר - ממתין לאישור"), the Mega Family feed (`lib/services/tours-events-feed-sync.ts`, `tours-events-actions.ts` search), stadium memory (`venue-memory.ts` - never a source), the price-light nightly / ours / alternatives / base-price-sync queues (an unapproved event earns no crawl or quote), the ready-package refresh. Events table: a "מוסתר" badge and a filter.
- **The TixStock price sync (builder check Q4, builder's call):** it KEEPS pricing hidden events (an event approved a week after its build must carry today's prices, not build-day prices) but, on a hidden event, never writes `deactivated_reason` and never opens a `supplier_gap` task (`lib/services/tixstock-availability.ts` / `supplier-gap-tasks.ts` get one `is_hidden` branch each) - a 20-show run must not be a burst of tasks and mails nobody asked for. Approve re-runs the availability plan for that one event right after un-hiding (the editor's "Check now" path), so a show that sold out while waiting is deactivated the moment it goes live, not at the next tick.
- Migration + main change deploy BEFORE the first real run (§16). The switch `TOUR_UPLOADER_AI` stays off until both are live.

### 6.2 `uploader_runs`
`id uuid`, `created_by uuid`, `asker_id uuid` (who answers), `brief text`, `plan jsonb` (the confirmed `UploaderPlan`), `plan_ai jsonb` (what the AI answered before edits - the diff is a lesson), `status text` (`planned` | `building` | `waiting` | `review` | `done` | `stopped` | `error`), `counts jsonb` (found / built / questions / ready / approved / rejected / skipped), `ai_cost_usd numeric`, `error text`, `created_at`, `updated_at`. RLS on, no policies.

### 6.3 `uploader_items`
One per show the search found: `id uuid`, `run_id`, `position int`, `show jsonb` (the identity: `name_english`, `city`, `country_code`, `venue`, `date` (YYYY-MM-DD), `lat`, `lon`, supplier refs `{ tixstock: { event_id, name, ticket_count, venue_map_url } | null, livetickets: { event_id, name_heb, categories } | null }`, `competition`, `home_team`, `away_team`), `status text` (`found` | `building` | `question` | `skipped` | `ready` | `approved` | `rejected` | `error`), `mode text` (`package` | `ticket_only` | null), `location jsonb` (the matched `locations` row or null), `decisions jsonb` (`{ code, text }[]`), `warnings jsonb` (`{ code, text, fix_url? }[]`), `blockers jsonb` (same shape; approve disabled while non-empty), `question jsonb` (`{ kind, text, options: {key,label}[], free_text: bool, key, asked_at, task_id, answer?: { key?, text?, by, at } }`), `event_id bigint`, `payload jsonb` (the event as the uploader wrote it - the baseline for the edit diff), `skip_reason text`, `error text`, `approved_by`, `approved_at`, `rejected_reason`, timestamps. Indexes on `(run_id, position)`, on `event_id`, partial on `status = 'question'`.

### 6.4 Gone
`event_drafts` (table dropped in the same migration - a work table, nothing references it), `lib/actions/factory-actions.ts`, `lib/services/draft-builder.ts`, `types/factory.types.ts`, `app/(dashboard)/factory/*` (page becomes a redirect to `/uploader`), the "Send to factory" buttons on the four provider tables, the factory guide section (replaced). `/events/new?batch=1` (the batch wizard) stays - a different, manual path.

## 7. The brief → plan (the one AI call)

`UploaderPlan` (TypeScript + a tool schema, in `lib/uploader/plan.ts`, pure):
```
subject: { kind: "artist" | "team" | "competition"; name_he: string | null; name_en: string }
scope: { date_from: string | null; date_to: string | null; home_only: boolean; round: string | null; exclude_cities: string[]; include_cities: string[] }
rules: { with_location: "package"; without_location: "ticket_only" | "skip" }
markups: { ticket_only: number | null; additional: number | null }
suppliers: ["tixstock", "livetickets"]   // fixed, shown not asked
notes: string[]                          // anything in the brief the parser could not place - shown to the person
```
- System prompt: the role, the schema, the house rules (generated: the two markup columns, the suppliers list, "never a price", "one subject per brief", "football: home_only true unless the brief says all / away"), the taught rules, and the fenced lessons from past runs (§10).
- `parsePlanInput()` validates the model's answer field by field (markups 0..5000 integers, dates ISO, kind in the list, names ≤ 120 chars, no multi-subject); a bad answer = the manual form with what could be salvaged, never an exception to the user.
- Subject resolution is deterministic after the call (§8.1).
- One call per brief, `callsPerRun: 3` (one parse + at most two "ערוך את הבריף" re-parses), `timeoutMs` 20 s, model `claude-opus-5` by default (`TOUR_UPLOADER_AI_MODEL` overrides), `maxRetries: 0`, forced tool call, `max_tokens` 2000 + low effort like the other two agents. Cost per run: cents.
- The brief text is DATA inside the user turn; the fence sentence is in the system prompt as in the other agents.

## 8. Finding the shows (deterministic, pure in `lib/uploader/shows.ts`, DB reads in `lib/services/uploader-search.ts`)

### 8.1 Subject resolution
- `artist`: `artists` row by `namesMatch` on `name_english` / `name` (the category-twins rule), active, not deleted. None → warning on every card `no_artist_page` ("יעלה בלי עמוד אמן: בלי תמונה בכרטיס ובלי cut-out בקריאייטיב", fix → `/templates/artists/new`).
- `team`: `football_teams` row the same way (`clubNamesMatch`). Crest = `logo_url` or a `football_logos` row by name. None → `no_team_page` / `no_crest` warnings.
- `competition`: TixStock `category_name` (distinct values of active future rows) by normalized containment; the plan card shows the matched name; no match → the card says so and offers the list.

### 8.2 Candidates
- TixStock (`tixstock_events`, `is_active`, `show_date ≥ today + AVAILABILITY_WINDOW_DAYS`, inside the plan's window): artist → a row whose `performers[].name` matches the subject (`namesMatch`); **never** a row that only *contains* the name in `event_name` with a different performer (the tribute act rule: "Journeyman - A Tribute to Eric Clapton" has performer "Journeyman…" - excluded, listed under "לא נכלל" with the reason). Team → `performers` includes the team and (home_only) `isHomeGame(event_name, team)`. Competition → `category_name` matches, plus `round` text in `event_name` / `sub_categories.name` when given. `ticket_count === 0` → the row is kept as a candidate but the show is skipped later ("TixStock: 0 כרטיסים") unless LiveTickets sells it.
- LiveTickets (`live_events`, `is_active`, same window): artist → `performers[].name` / `hebName` match or `event_name` equals the subject; team → `performers` includes the team (home = the first performer / `event_name` starts with the team); competition → `primary_category` / `categories` text match (LiveTickets' competition naming is loose - a competition run is TixStock-led, Live rows join by city + date).
- Fallback (information only): when a show has no Tix and no Live row, `xs2e_events` / `p1_events` by name + date ± 1 → "נמצא ב-XS2Event / P1 (מידע בלבד)" on the grey card.

### 8.3 Grouping rows into shows
Key = (country_code, normalized city, calendar date as the supplier prints it). A Tix row and a Live row with the same key = one show, both suppliers. (Builder check Q5: prod rows checked on 21.10 - Clapton London 20.05 and Birmingham 17.05 print the same calendar day in both catalogs, so there is no systematic skew to absorb; the rule stays exact-day. The first runs report how many `pick_date` questions they raised; a systematic offset, if one ever appears for a region, is a one-line widening of the pairing, not a redesign.) Same city, Live one day off from the only Tix row and no exact pair → **question `pick_date`** ("TixStock אומר 20.05, LiveTickets 21.05 - איזה תאריך נכון? או שתי הופעות?") - the answer decides. Two Tix rows with the same key → **question `pick_show`** with both as options (unless one has `ticket_count 0` - then it is dropped with a decision line, no question). Two Live rows same key → the same question. A show already on `events` (a live or hidden event with a ticket carrying the same TixStock / LiveTickets `eid`, or same `name_english` + date + location iata, `is_deleted null`) → status `skipped`, reason `exists` (#id linked), never rebuilt.

### 8.4 Prior answers (deterministic memory)
Before asking, `priorAnswerFor(question)` looks for an answered question of the same `kind` + same `key` (subject English name + city + date) in earlier runs' `uploader_items`; a hit is applied with the decision "לפי תשובה קודמת של <name> (ריצה #n)" and no new question. That is the "fewer questions next time" promise made concrete: a re-run of the same tour after a correction asks nothing.

## 9. Building one show (`lib/services/uploader-build.ts`, one item per call)

Order matters - the cheapest checks first, the paid searches last:
1. **Tickets first** (Dor's validation #1). TixStock: `fetchTixStockFeed(event_id)` → `listingsTheSiteSells(listings, { excludedSections: [] })` → group by `category` → per category the cheapest listing priced by `tixstockTicketPriceUsd` → one `EventTicket` per category: `{ id: uuid, eid, supplier: "tixstock", vendor: "TixStock", category, supplierCategory: category, price, colorOnTheMap: TX_TICKET_COLOR, available: true }` (pure `ticketsFromTixStockFeed` in `lib/uploader/tickets.ts`). Categories the rules dropped are a decision line ("3 קטגוריות restricted view הושמטו"). LiveTickets: the `buildLiveTicketsDrafts` logic as a service function (`live stock` → snapshot fallback), **sellable only**, non-instant excluded (a decision line names them). Supplier unreachable → retry once, then that supplier is dropped from this build with a warning `supplier_unreachable` ("LiveTickets לא ענה - האירוע נבנה בלי Live; צרפו ידנית") - never a guess. **Zero tickets in total → `skipped`, reason `no_tickets`.** No event is created.
2. **Location.** `nearestLocation(lat, lon)` (a sibling of `nearestIataFor` that returns the `locations` row) within 50 km of the venue (TixStock `venue_data` coords; a Live-only show has no coords - its `live_events.iata` / `city_name` are tried against `locations` first, and only when that fails → question `pick_location` with the location list as options, free text allowed). Found → `mode = package`, `event.location = { name, city_iata, latitude, longitude, country_code }` of the row. Not found → **memory first (decision 9):** `findVenueMemory` is read BEFORE the brief's fallback - when the last event at that venue (same supplier drawing / our twin / same football venue name) carried an `event_location` (a two-city package: Manchester show, London flight), the show is built exactly that way: `location` = that event's flight city (the `locations` row by its iata), `event_location`, `lodging_mode`, `lodging_default`, `lodging_note`, `split_default_nights` copied from the memory (`VenueMemory.lodging`), decision `two_city_from_memory` ("דו-עירוני כמו <event>: הופעה במנצ'סטר, טיסה ללונדון, פיצול מלון"), base prices quoted on the flight city. No memory → `rules.without_location`: `ticket_only` (mode ticket_only, `location` = the venue city name + coords with `city_iata: ""`), or `skipped` reason `no_location` - and in BOTH cases, when the nearest location is within `FAR_VENUE_KM` (300), the card carries the offer **"בנה כחבילה דרך <city> (X ק"מ) עם פיצול מלון"** (`far_venue` warning + action): clicking it rebuilds that one item two-city with `lodging_mode: "choice_split"` and the defaults `lib/lodging.ts` gives such an event (`lodging_default: "event"`, `split_default_nights` = its default), records `uploader.two_city_chosen` `{ subject, venue, city, flight_city, km }`, and from then on stadium memory carries that venue's two-city setup into every later run by itself. That is the "learn slowly" Dor asked for: the first far show at a venue is a human's one click, the next ones are the agent's own decision - and `uploader.two_city_chosen` / `uploader.edited` (lodging fields are in the edit whitelist) quote the pattern to the parser so a brief like "ליברפול - טיסה למנצ'סטר" is understood. Never a guessed flight city without one of those two.
3. **Map + zones.** `venue_maps` by `source_url = tixstock venue_map_url`: found → `map_image_url = svg_url`, tickets zoned by `zoneFromTemplate` (moved to `lib/venue-maps/zone-from-template.ts`, pure); the count of unzoned tickets is a warning `unzoned_tickets`. Not found → `map_image_url = venue_map_url` (the supplier drawing), warning `new_venue` ("אולם חדש - אין תבנית זונים; הכרטיסים יעלו בלי זונים"). `findVenueMemory` is read for `lodging` only (event city / lodging mode of the last event at that venue) and its `fromEventName` is a decision line.
4. **Dates.** `calculateSmartDates(date)` → `def_date_depart` / `def_date_return`. Decision line "טיסות 18.05 → 21.05".
5. **Base prices** (package only). `quoteFlight(iata, depart, return)` and `quoteHotel(lat, lon, depart, return)` of the location. A `null` quote → retry once → still null → **blocker** `no_base_price` ("אין מחיר בסיס לטיסה - מלאו בעורך לפני האישור"). The event is still created (hidden) so the editor can fill it; Approve stays disabled while a blocker exists. Decision line "בסיס מהכלל: טיסה $310 · מלון $290".
6. **Names.** `name_english`: music = the performer's English name (the convention: "Eric Clapton"; the site adds the city), football = TixStock's `event_name` ("Liverpool FC vs Crystal Palace FC"); `name`: music = the artist row's Hebrew `name` or Live's `hebName`, else the English name; football = "<home he> - <away he>" from `football_teams.name` where known, else English (the convention: "אתלטיקו מדריד - סיביליה"). A missing Hebrew name is a warning `no_hebrew_name`.
7. **Create.** `createEvent({ ...payload, type: "tx_event", is_hidden: true, package_mode, ticket_only_markup, event_additional_markup, skip_flight: true, tags: "", description, tx_excluded_sections: [] })` - the same function every path uses (auto-tags, price light on_create rule-only). `payload` is stored on the item. Audit `uploader.built` with the decisions.
8. **Warnings** (computed from the subject rows + the show, pure `lib/uploader/warnings.ts`): `no_artist_page` / `no_team_page`, `no_cutout` (artist with `image_url` but no `art_image_url` - the creative draws a flat photo), `no_event_gallery` (artist `event_gallery` empty), `no_crest` (team), `no_bio`, `no_category_twin` (no `/c/` leaf - information only), `new_venue`, `unzoned_tickets`, `supplier_unreachable`, `single_supplier` (only one of the two sells it - information), `no_hebrew_name`. Each with the fix URL the gaps radar already uses.
9. **Decisions** are plain strings with a `code` so the selftest can assert them and the agent's lessons can count them (`location_found`, `location_missing_ticket_only`, `tickets_tixstock`, `tickets_livetickets`, `categories_dropped`, `zones_from_template`, `dates_smart`, `base_prices`, `prior_answer`, `lodging_from_memory`, `tribute_excluded`, `duplicate_dropped`).

Time per item ≈ 6-12 s (two supplier calls + two quotes). A 20-show tour ≈ 3-4 min, built one item per server-action call from the board (the page's layout sets `maxDuration = 60`); the run is resumable from any point (`status = 'found'` items are what is left).

## 10. Questions, answers, and what they teach

- A question is raised by the search (§8.3) or the build (§9.2) and **stops that show only**; the rest of the run goes on. Kinds: `pick_show`, `pick_date`, `pick_location`, `confirm_subject` (the brief named an artist with two plausible rows), `free` (reserved).
- Raising it: the item gets `status = 'question'`; a task is inserted (source `uploader`, board `ops`, priority `high`, `assignee_id = run.asker_id`, `created_by = null` - a system task like a rule's, so the assignment mail (`notifyTaskAssigned`) goes to the asker even when they started the run; `source_ref = { kind: "uploader_question", table: "uploader_items", row_id, label, url: /uploader/<run>#item-<id> }`); audit `uploader.asked`.
- Answering (on the board, by any admin): `answerQuestion(itemId, { key?, text? })` records the answer on the item, closes the task (`setTaskStatus done` with a note quoting the answer), audits **`uploader.answered`** `{ kind, key, question, answer, subject, city, date }`, and re-queues the item (`status = 'found'`) with the answer applied by the build. A "דלג" answer skips the show (reason `skipped_by_answer`).
- The toast (§5.4) and the menu badge read `count(status = 'question' and asker = me)`.

**What the agent learns from** (`learnsFrom`, newest first, interleaved by source as the memory module does):
- `uploader.answered` → "for Eric Clapton in Milan, staff picked TixStock's date over LiveTickets'" - quoted so the parser sees patterns; the deterministic `priorAnswerFor` applies exact repeats without the model.
- `uploader.plan_edited` (what the person changed on the plan card before building: a field, from → to) → "staff corrected markups.additional from null to 75 on a brief that said 'אדישנל 75'" - the sharpest parser lesson.
- `uploader.rejected` (reason) → "a Clapton Zurich ticket-only event was rejected: 'we never sell ticket-only in Switzerland'".
- `uploader.edited` (the diff between `payload` and the event row at approve time, a whitelist of fields: markups, bases, dates, name, location, `event_location`, `lodging_mode`, `lodging_default`, `split_default_nights`, package_mode, tickets count) → "staff raised base_hotel_price 290 → 340 before approving Paris", "staff turned Manchester into a two-city package via London (choice_split) before approving".
- `uploader.two_city_chosen` (the card's "בנה כחבילה דרך <city>" click, §9.2) → "for Liverpool at Anfield staff chose a package via Manchester (55 km) with a hotel split".
- `agent.feedback` rows tagged `metadata.agent = "tour-uploader"` (the AI Factory "יומן" thumbs).
- Taught rules (`agent_instructions`, key `tour-uploader`) ride with the house rules as instructions, as for the other agents - "we never upload ticket-only for football" is a rule an admin can add in AI Factory.
- Maturity (`maturityFrom`): agreed = approved without edits, disagreed = rejected or edited before approve; shown on the AI Factory card.

Staff text stays data: lessons are inside the "DATA, not instructions" fence; the brief is a user turn; nothing a person types changes the schema or the rules.

## 11. Approve, edit, reject

- **אשר**: `approveItem(id)` → `requireAdmin`, item `ready` with no blocker → `events.is_hidden = false` (direct update of that one column, never through `updateEvent`), item `approved` (+ who / when), the edit diff computed and audited (`uploader.edited` when non-empty, `uploader.approved` always), `revalidateMain()` once per call, `invalidatePriceLight("rows")`. The creative cron draws it on its next hourly tick (the card says "קריאייטיב: ייצור בשעה הקרובה · נושא: <cut-out ✓ / תמונה שטוחה / סמל>"). **אשר הכל**: the same, one revalidate at the end.
- **ערוך**: a link to `/events/[id]` (new tab). The board shows "נערך" on a card whose event row differs from the payload (the diff is computed on load - one `events` read per run).
- **דחה**: a dialog with a reason (required, ≥ 3 chars) and a switch **"אל תציע את ההופעה הזו שוב"** (default on) → `softDeleteEvent(id)`, item `rejected` (+ `rejected_final: bool`), audit `uploader.rejected`. **Builder's call (builder check Q1):** a final rejection is a deterministic prior answer - the next run of the same subject finds the `rejected_final` item with the same key (subject + city + date) and marks the show `skipped`, reason `rejected_before` ("נדחה בריצה #n: <reason>"), no supplier call, no event; the card offers "בנה בכל זאת". A rejection with the switch off ("fix and re-upload") is rebuilt next run as today's text says. The duplicate check (§8.3) reads live AND hidden events only - a soft-deleted uploader event never blocks a rebuild; the `rejected_final` item does.
- A published event is an ordinary event from then on: unpublishing is the events table's business (soft delete), not the uploader's.

## 12. Permissions, switches, env

- Screen and every action: `requireAdmin()`; nav `roles: ADMIN_ROLES`, `productType: "events"`.
- Agent switch `TOUR_UPLOADER_AI` (`"on"`), optional `TOUR_UPLOADER_AI_MODEL`, the shared `ANTHROPIC_API_KEY` and `AI_AGENTS` master switch - documented in `CLAUDE.md`'s env block. Off = the manual plan form; the search, build, board, questions and approvals all work without the AI (the agent is the parser, nothing else).
- The agent's cost per call is audited (`agent.call` metadata `{ agent, run_id, cost_usd, tokens }`) and summed on `uploader_runs.ai_cost_usd`; AI Factory's cost card reads it (the `costAndCallsFor` switch gains a branch).

## 13. Design of the board (the "best screen in the dashboard" bar)

Built with the `frontend-design` / `impeccable` skills, inside the MYT Admin theme (forest / mint tokens, `app/globals.css`), RTL content inside the LTR dashboard like the comparison sheet (`dir="rtl"` on the board root, `<bdi>` around mixed pieces). Cards use the site's own picture rule so the person sees what the customer will see. The decisions list is typographically quiet; warnings amber; a question card is the loudest thing on the screen. The approve-all bar is sticky and names exactly what it will do ("אשר הכל (4) ← עולה לאתר"). Keyboard: ↑/↓ moves between cards, A approves the focused ready card, R opens reject. Mobile width works (one column). Empty states: no runs yet (how to write a brief, with the two examples), a run with every show skipped (why, with the fallback-supplier findings).

The mockup Dor chose: `.superpowers/brainstorm/1701-1792579767/content/review-layout.html` (option B; throwaway, git-ignored).

## 14. Pure modules + selftest (`scripts/tour-uploader-selftest.ts`, `npx tsx`)

- `lib/uploader/plan.ts` - `UploaderPlan`, `parsePlanInput` (validation + salvage), `planDiff` (the plan_edited lesson), `defaultsFromPriorRuns`.
- `lib/uploader/shows.ts` - candidate predicates (artist / team / competition, the tribute rule, home games), grouping by key, ambiguity → question shapes, duplicate detection against existing events, `priorAnswerFor`.
- `lib/uploader/tickets.ts` - `ticketsFromTixStockFeed`, `ticketsFromLiveStock`, the drop reasons.
- `lib/uploader/warnings.ts` - warnings from subject rows + show + build facts.
- `lib/uploader/decisions.ts` - codes + Hebrew texts, `editDiff(payload, eventRow)` whitelist.
- `lib/venue-maps/zone-from-template.ts` - `zoneFromTemplate` moved out of the component (the component imports it).
- `lib/agents/tour-uploader.agent.ts` - declaration, house rules, `learnsFrom` formatters (covered in `scripts/agents-selftest.ts` too: the registry has three keys).
The selftest feeds synthetic TixStock / Live rows (Clapton with a tribute act and a two-London-dates case, Liverpool home + away fixtures, a competition round) and asserts the shows, questions, tickets and warnings. No DB, no API.

## 15. Guide, docs, memory

- `lib/nav.ts`: "AI Uploader" replaces "Events Factory" (`/uploader`, same group). `guide-model.ts` `NAV_LABELS`, a guide section `nav: "/uploader"` with `howTo` recipes (an artist tour, a team's home games, answering a question, approving) - `npx tsx scripts/guide-selftest.ts` green.
- `CLAUDE.md`: a section for agent #3 under Agents + the env block; the Events Factory section is rewritten to point here.
- A short Hebrew "how to use" for Alon (`docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md`).

## 16. Deploy order (operational)

1. Backoffice push to master (migration: `events.is_hidden`, the two tables, `drop table event_drafts`) - the workflow applies it. The hidden flag defaults false: nothing changes for existing events.
2. myt-main push (the `is_hidden` filters in `isListedEvent` + feed, the `confirm-order` refusal, `app.types.ts`). Main must be live BEFORE `TOUR_UPLOADER_AI=on` is set - until then a built event, hidden here, would be listed on the site. Documented in `CLAUDE.md` and the how-to.
3. Vercel env: `TOUR_UPLOADER_AI=on` (+ the key already there).
4. First real run on a small subject, approve one event, check it on the site and in the feed after the next creative tick.

## 17. Left to the builder

- Exact card typography / spacing, the picture placeholder, the keyboard shortcuts' discoverability.
- Whether `nearestLocation` lives in `nearest-location.ts` (preferred) or beside the uploader.
- The polling interval of the board (2-3 s while building) and of the toast (60 s).
- Chunking of the `events` duplicate check (`.in()` lists ≤ 200).
- Order of the events-table badge / filter work (small; may ship in the same PR or the next).
- `calculateSmartDates` moves from `app/(dashboard)/tixstock-events/batch/tixstock-to-event.ts` into `lib/` (a service must not import from a page folder); the page re-exports it.
- `buildNextItem` claims an item atomically (`update ... where status = 'found'` returning the row) so two open boards never build the same show twice.
- `costAndCallsFor`, `loadMaturity` / `maturityFrom` in `lib/services/ai-factory.ts` / `lib/agents/maturity.ts` gain an `uploader.*` branch each (they are price-light-only switches today); `AGENT_KEYS` becomes a three-key tuple and `scripts/agents-selftest.ts`'s assertion follows.

## 18. Open questions for Dor

None. The builder check (21.10) raised five; Dor settled the far-venue rule (decision 9) and the preview-purchase rule (decision 10); the other three are the builder's calls marked in §8.3, §6.1 and §11. Two defaults, reversible on the plan card: a brief that does not say what to do without a location → **skip** (the brief must say "כרטיס בלבד"); a brief that does not name an additional markup → the last run's value, shown, else null (= the site's default 175 only).
