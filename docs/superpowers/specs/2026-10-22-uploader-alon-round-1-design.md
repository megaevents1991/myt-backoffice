# Tour uploader - round "אלון 1" (design)

Date 2026-10-22. Builds on `docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md` (agent #3, `/uploader`, live since 21.10) - read that first; this document changes the board, adds two AI calls, a template field, two columns and one name rule, and nothing else of the flow. Builder check done the same day (eight questions, eleven code contradictions - every one is settled below; the one that was Dor's, §17, he settled the same day together with two additions of his own, decisions 3 and 4).

## 1. Intent

Alon ran the uploader for real on 22.10 (run `386c906f`, Fulham FC: 15 hidden events 1227-1241 at Craven Cottage, one open `pick_show`, one skipped) and sent three notes:

> לכל החבילות יש את אותה שאלה - אפשרות לענות ולתת לו כלל על כולם יחד. (ראה פולהאם). הוא לא מסווג כרטיסים, הוא לא מתאר אותם בעברית כמו שצריך. אפשרות לעבור איתו על אירוע אחד ושיתאים לכל יתר האירועים בעצמו - אם יש כאלו שלא סיווגנו אז שישאיר הערה לבדיקה וגם שילמד את כל זה לפעמים הבאות. בגדול נראה מטורף ושינוי קיצוני.

What the run shows, read on prod:

- **"The same question on every package"** is the same FOUR warnings printed on all 15 cards - `no_team_page` (Fulham has no row in `football_teams`), `new_venue` (Craven Cottage has no `venue_maps` row), `no_hebrew_name` (the opponents have no Hebrew name), `single_supplier`. All but the last are facts about the RUN, repeated per card, each with no action but a link. The one real question (two LiveTickets rows for Fulham - Aston Villa on 23.01.2027, 12:30 and 15:00) stands alone, but Alon's ask - answer once, make it a rule for the run - applies to questions as well.
- **"Does not classify, does not describe in Hebrew":** the tickets are TixStock's raw English category names with no zone (`{ category: "Longside Lower Tier", price: 233, supplier: "tixstock" }`), because the venue had no template, and one of them is **"Away Fans Section" at $4,680** - a category we must never sell. Event names are English in both columns ("Fulham FC vs Newcastle United FC"). The standard Alon measures against is the hand-built event 1215: `{ category: "Fondo Grada Alta", zoneId: "fondo-grada-alta", description: "מאחורי השער קומה עליונה" }` - a zone on the map and a Hebrew line. On the site the ticket card's title is `zoneLabel || category` and its subtitle is `description` (main `app/order/TicketSelection.tsx` -> `EventTicketCard`), so "classified and in Hebrew" = a zone with a Hebrew label plus a Hebrew description.
- **"Go over one event with it, it applies to the rest, leaves a note where unsure, learns for next time"** is the shape of the fix: one decision per venue, applied to every show of that venue in the run, saved as the venue template.

## 2. Goals, non-goals, anti-goals

**Goals**
- Run-level facts are handled ONCE, at the top of the board, each with one action - never fifteen identical lines.
- A new venue's TixStock categories get Hebrew zone labels and Hebrew descriptions, away-fans categories are dropped, by an AI proposal a person confirms once; the confirmation rewrites every show of that venue in the run and becomes the venue template for every later run.
- A confirmed Hebrew name for an opponent (or the subject itself) creates the team in Templates and rewrites the run's event names in Hebrew.
- A question's answer can be made a rule for the rest of the run's similar questions.
- A category the AI cannot place is kept with a visible "לבדיקה" note - never dropped silently, never a blocker - and the venue stays on the panel until every category is placed.
- One event a person fixed by hand in the editor teaches the venue template and is applied to every other show of the venue in the run with one click (decision 3).
- A show's Hebrew name comes from our teams, else from LiveTickets; when neither has it the run asks once, as one task (decision 4).
- Works on EXISTING runs: Alon's 15 Fulham events are the first use, with no rebuild.

**Non-goals (this round)**
- The event editor's "Suppliers & zones" board keeps its job for LiveTickets categories at a venue with both suppliers (their Hebrew already comes from LiveTickets); it only learns to show the zone description (§6.1).
- No standing rule across runs from a question's answer (a later run still gets `priorAnswerFor`'s exact repeats; a standing rule is an AI Factory taught rule).
- No menu badge, no "בנה בכל זאת" (both still open from 21.10).
- Nothing on myt-main: it already renders `zoneLabel` / `description`.

**Anti-goals**
- **The AI never fetches, picks or attaches a picture** - not a crest, not a photo, not a logo. A team or artist it helps create has no image (Dor, 22.10: copyright, artists especially).
- The AI never writes a price, never removes a ticket on its own, never creates a team or a template on its own: every write below follows a human's click on a dialog that shows exactly what will be written.
- No warning kind disappears from the data: the panel is a different VIEW of `uploader_items.warnings`; nothing is hidden from the audit or the lessons.

## 3. Decisions (Dor, 22.10) and the calls this document makes

1. **AI proposes, a human manages** (Dor: "נכון בשנאדם יוכל לנהל את זה"). The first mapping of a new venue is the agent's proposal - per supplier category: a Hebrew zone label, a Hebrew description, "לפסול" on away-fans sections - and a person confirms or fixes it ONCE; the confirmation applies to every show at that venue in the run and is saved as the venue template. Not "a human maps the first event and the system copies".
2. **A confirmed Hebrew opponent name creates the team in Templates** ("רעיון מעולה") - **without any image** (anti-goal above), and **inactive** (Dor, 22.10, after the builder check: an active team is listed on main's homepage football row at once, crest or not): the Hebrew name serves the events now; staff activate the page in Templates once the crest is in (§6.4).
3. **One event fixed by hand teaches the rest** (Dor: "סידרתי את האצטדיון של פולהאם למשחק אחד - איך אני מוודא שהוא רץ מחדש ומשליך חזרה לכל האחרים"). Whatever a person arranged on ONE event of the run in the event editor - the venue's zones on the Suppliers & zones board, a ticket's Hebrew description, a dropped category - can be learned from that event and applied to every other show of the venue in the run with one click, no AI (§5.5, §6.5). Decision 1 (AI proposes) is the first path; this is the second, for the person who went to the editor first.
4. **The Hebrew event name follows a rule: ours, then LiveTickets', else ask** (Dor: "שיקח את השם העברי שיש בלייב טיקטס לאירוע, ואם אין ישאל אותנו"). Both sides known in `football_teams` → our convention "<home he> - <away he>"; else the LiveTickets twin's own Hebrew name; else the event is built with the English name AND the run asks - ONE task for the whole run, answered by the names dialog, never one question per show (§7.1).

My calls (reversible, marked where they land):
- a. The panel sits at the top of the board, one row per run-level warning kind, one action each (§5.1). Per-card lines of those kinds fold into one grey line.
- b. "החל גם על השאלות הדומות בריצה" is a checkbox on the question card, shown only when the rule reaches at least one other open question of the run (§7). A `pick_location` rule reaches only shows at the SAME venue (builder check Q3: every location is an option of every `pick_location`, so "among its options" filters nothing - a competition run would fly a Lyon show to Madrid).
- c. An unplaced category keeps its ticket with no zone and a "לבדיקה" line on the card; it is NOT written into the template (builder check Q1: `adoptVenueMap` otherwise labels it by its slug and `zoneFromTemplate` zones it in English, silently, in every later run); the venue row stays on the panel for it (§5.1).
- d. The drop rule is CODE for away-fans sections only - `away`, `visitor`, `visiting`, word-bounded on the category name. Obstructed views are NOT a category rule (builder check Q7): the build already refuses such LISTINGS by their restriction flags, and `normalizeSupplierCategory` strips parentheses, so "Longside Lower Tier (Restricted View)" and "Longside Lower Tier" are ONE ticket - a category drop would remove the good seats with the bad. The AI may propose an extra drop with a reason; a person can flip any drop either way.
- e. The uploader board only. Existing runs included.
- f. The dialog classifies the DRAWING's categories (every category TixStock sliced the SVG into), not only those with a ticket in this run - a stand sold out this season gets its Hebrew now, not an English zone next season. Categories with a ticket but no section on the drawing get a zone with no sections (title + description reach the customer, nothing lights on the map).
- g. Learning = the venue template (now with descriptions and drops) + the created teams + per-change `uploader.classify_changed` audit rows in the agent's lessons, each call reading its OWN lesson sources (§9). One extra AI call per venue per dialog open, same agent, same switch, forced tool, `maxRetries: 0`, the parse's per-person rate cap checked by the new actions themselves.
- h. The ticket's Hebrew `description` and the template zone's `description` are the same text, written once in the dialog; the zone `label` is the card title the customer sees.
- i. An artist run's names dialog has one row, the artist, and creates the artist row the same way (`createArtist`, no image) - the warning on an artist run means no row, no Hebrew in the brief, no LiveTickets Hebrew.
- j. A `new_venue` warning on a show with no TixStock drawing (LiveTickets only - the build sets it whenever no template applied) stays on the card and is not folded: there is no venue to classify.
- k. "Learn from this event" reads the EVENT ROW as it is now (its tickets' `zoneId` / `zoneLabel` / `description` / `supplierCategory`, the categories it no longer carries) - not the audit log, not the editor's state - so it covers every way a person fixes an event, and it merges over the venue template rather than replacing it (a label the person did not touch stays).
- l. The run-level names task is raised at `createRun` (the sides and the LiveTickets Hebrew names are known from the search), counts against `MAX_QUESTION_TASKS_PER_RUN`, and is closed by the names dialog's confirm - the build never stops a show for a name.
- m. LiveTickets' Hebrew name is taken as it is (trimmed, ≤ 120 chars); a decision line says where the name came from. Our own two-sides convention still wins when both teams are known, so the site stays consistent where we have the data.

## 4. What exists and is reused (read `CLAUDE.md` "Agent #3" and "Our own tickets" first)

- **`venue_maps`** (migration `20260918010000`): `zones = [{ id, label, sections }]`, `supplier_categories = { tixstock: { "<normalized category>": "<zone id>" } }`, `svg_url` our published copy. **TixStock names every section of its drawing `<category slug>_<section>`** (`sectionCategory` in `lib/venue-maps/svg-zones.ts`), so the drawing itself already groups sections by category - `adoptVenueMap(sourceUrl, name, { categoryLabels })` (`lib/actions/venue-map-actions.ts`) fetches the SVG from TixStock's S3 (`ADOPTABLE_HOSTS`, `MAX_SVG_BYTES`), copies it into our Storage, creates the row and makes ONE ZONE PER CATEGORY of the drawing (`zonesFromCategories`), labelled by `categoryLabels[normalized]` **or by the category's own slug when no label is given**, with every category mapped in the template. There is no grouping problem for the AI to solve: it NAMES zones in Hebrew, describes them, and flags drops. `saveVenueZones` replaces the zone list (and republishes the SVG), `rememberSupplierCategories` merges the template (a category mapped to `""` is forgotten). All `requireStaff` (an admin passes).
- **`zoneFromTemplate`** (`lib/venue-maps/zone-from-template.ts`, pure): stamps `zoneId` + `zoneLabel` on tickets by the template; the build (`uploader-build.ts` step 4, through `venueMapFor` → `zonesOf` in `lib/services/uploader-prior.ts`, which rebuilds each zone as `{ id, label, sections }`) and the editor use it. Both gain the description (§6.1, §6.2).
- **Main** prices stored tickets only (`app/api/tixstock/tickets/route.ts` maps live listings onto `tickets_and_rates` by category and never adds one); the TixStock price sync does the same. So dropping a category = removing its ticket from `tickets_and_rates`. `tx_excluded_sections` is not needed for it.
- **Obstructed views** are refused per LISTING by `hasObstructedViewRestriction` (`lib/tixstock-listings.ts`, private substring rule on the restriction text) inside `listingsTheSiteSells` - the build already applies it (`ticketsFromTixStockFeed`). Not touched.
- **Names:** `eventNames` / `withSupplierSpellings` (`lib/uploader/names.ts`) build "<home he> - <away he>" from `teamsHe` (`football_teams` Hebrew by normalized English name, inactive rows included - `uploader-search.ts` filters `is_deleted` only - with `clubNamesMatch` bridging "Newcastle United FC" / "Newcastle"). A team row is created by `createFootballTeam(CreatePersonData)` (`lib/actions/football-actions.ts`), which also runs `ensurePersonTaxonomy` (team tag + auto-tag rule + a `/c/` leaf that is ALWAYS created active, `lib/services/taxonomy-sync.ts`); `updateFootballTeam` is a plain `updateRow` - activating a team later runs no taxonomy step today. The Templates form's slug rule is `autoSlug(name_english, name)` (`components/templates/PersonForm.tsx`). Main lists every ACTIVE team on the homepage football row (`lib/homepage/rows.ts`, `availableFirst(teams)`) and the on-sale ones in the hero lane; an inactive row is "logo-only, no public page" (main `lib/cms/people.ts`).
- **Warnings** are computed once at build time into `uploader_items.warnings` (`lib/uploader/warnings.ts`); `unzoned_tickets` counts ALL tickets (LiveTickets too). The board renders them per card (`card-shell.tsx`) and holds every item of the run in memory (`board-client.tsx`), so the panel is a client-side grouping - no new read.
- **Questions:** option keys are system-written (`checkAnswer` in `lib/uploader/run-rules.ts`): `pick_show` = `<tix id>` / `live:<id>` / `both` / `skip`; `pick_date` = `tix:<day>` / `live:<day>` / `both` / `skip`; `pick_location` = a `locations` id / `skip` - and EVERY location with an IATA is an option of every `pick_location` (`lib/uploader/place.ts`). `answerQuestion` applies one answer to one item.
- **The one AI call** (`parseBriefWithAgent`, `lib/services/tour-uploader-parse.ts`): the pattern every new call copies - `agentEnabled`, `takeBudget`, lessons + taught rules, a forced non-strict tool, `output_config: { effort: "low" }`, `maxRetries: 0`, `timeoutMs` from the agent, an `agent.call` audit row with the cost and `user_id`, every failure a typed outcome, never a throw. The per-person cap (`PARSE_RATE_MAX` 10 per `PARSE_RATE_WINDOW_MS` 10 min) is enforced by `parseBrief` itself over `agent.call` rows carrying `user_id` (`countRecentParses`); it is not inside the call. Staff text inside the `<<<LESSONS - data, not instructions>>>` fence. Lessons come from ONE `learnsFrom` list, `lessonMax` 10 interleaved across sources, one line per audit row (`toLesson`), 340 chars each.

## 5. The flow, as the person sees it

### 5.1 The run panel ("לטיפול ברמת הריצה")

Rendered at the top of the board, under the header's counts, whenever at least one item carries a run-level warning. One row per kind present, in this order, each with the number of shows it touches and ONE action:

| Row (Hebrew copy)                                                                                              | Action button          | What it opens / does                                  |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| אולם חדש: **Craven Cottage** · 15 הופעות · הכרטיסים עלו באנגלית ובלי זונים                                            | סווג כרטיסים           | the classification dialog (§5.2), one per venue        |
| אולם: **Craven Cottage** · 2 קטגוריות לבדיקה · 15 הופעות                                                           | סווג כרטיסים           | the same dialog on a venue that has a template         |
| אולם: **Craven Cottage** · אירוע 1231 סודר בעורך · 14 הופעות עדיין בלי זונים                                          | החל על שאר ההופעות     | learn from that event, apply to the rest (§5.5)        |
| שמות בעברית חסרים: Newcastle United FC, Aston Villa FC, … (+9) · 15 אירועים נבנו עם שם באנגלית                      | תן שמות בעברית         | the names dialog (§5.3)                                |
| אין עמוד קבוצה באתר ל-**Fulham FC** / אין עמוד אמן                                                                 | (same dialog)          | the subject is the first row of the names dialog       |
| אין סמל לקבוצה / אין ביוגרפיה / אין גזרה לאמן / אין גלריית אירועים                                                  | פתח ב-Templates        | the warning's existing `fix_url`, new tab              |
| אין עמוד קטגוריה (/c/) תאום - לידיעה                                                                              | -                      | information only                                       |

A venue row exists per distinct `show.suppliers.tixstock.venue_map_url` (non-null) among the items carrying `new_venue` OR `unzoned_tickets`. The row's venue name is `show.venue`. Its third form ("אירוע 1231 סודר בעורך") appears when `getRun` finds, among the venue's items, an event whose `tickets_and_rates` differ from the item's `payload` in zone / description / category set (the same `events` read the board already makes for the "נערך" tag) - a person fixed that one in the editor; the button is `learnFromEvent` on that item (§6.5), the AI is not called. Several such events → the newest edit is offered, the others are listed under it. A row disappears when no item carries its warning any more (the dialogs remove the warnings they resolve - §6.3, §6.4, §6.5); the panel disappears with its last row.

**On the cards:** warnings whose code is run-level - `RUN_LEVEL_CODES` = `no_team_page`, `no_artist_page`, `no_crest`, `no_bio`, `no_cutout`, `no_event_gallery`, `no_category_twin`, `no_hebrew_name`, and `new_venue` / `unzoned_tickets` ONLY when the item has a TixStock drawing - fold into ONE grey line, "N הערות ברמת הריצה - בפאנל למעלה", that scrolls to the panel. Card-level warnings stay as they are: `new_venue` / `unzoned_tickets` on a LiveTickets-only show, `supplier_unreachable`, `single_supplier`, `far_venue`, `all_dropped`, and every blocker. The fold is a view: `uploader_items.warnings` is unchanged by it. The pure `cardWarnings(item)` decides, so the selftest pins it.

### 5.2 The classification dialog ("סיווג כרטיסים - Craven Cottage")

Opens from a venue row. On open the action `proposeVenueClassification(runId, sourceUrl)` reads the drawing (§8) and makes the AI call; the dialog shows a table, one row per category = the union of the DRAWING's categories (`sectionCategory` over `listSectionIds`, unsellable filler skipped - `isUnsellableCategory`) and the `supplierCategory` of the `tixstock` tickets on the venue's events in the run (read from the events; no supplier call):

| קטגוריה (TixStock)      | שם הזון בעברית (כותרת הכרטיס באתר) | תיאור בעברית (שורה מתחת)                     | לפסול | סטטוס                                        |
| ----------------------- | ----------------------------------- | -------------------------------------------- | ----- | -------------------------------------------- |
| Longside Lower Tier     | לאורך המגרש - יציע תחתון              | מושבים לאורך המגרש בקומה התחתונה               | ☐     | הצעת ה-AI · 15 הופעות                         |
| Away Fans Section       | -                                   | -                                            | ☑     | נפסל: יציע אוהדי חוץ (כלל) · 15 הופעות         |
| Riverside Stand Upper   | ריברסייד - יציע עליון                 | היציע לאורך הנהר, קומה עליונה                  | ☐     | הצעת ה-AI · 15 הופעות                         |
| Family Stand            | יציע המשפחות                         | …                                            | ☐     | הצעת ה-AI · לא במכירה בריצה הזו                |
| Hospitality Box 12      |                                     |                                              | ☐     | לבדיקה - ה-AI לא בטוח (יישאר בלי זון)          |
| Premium Seats           | מושבי פרימיום                        | …                                            | ☐     | לא מסומן במפה - יקבל כותרת בלי סימון           |

- Label and description are editable text boxes, prefilled with the proposal. "לפסול" is a switch, prefilled by the code rule (with its reason) or by the AI (reason shown); a person can flip it either way. A row the AI marked unsure - or one the person empties - is "לבדיקה": its ticket stays, unzoned, the category is left OUT of the template, and the card keeps a "לבדיקה: <category>" line (§6.3); the venue row stays on the panel for it.
- On a venue that already has a template (the second row kind of §5.1): rows already labelled show their stored label / description (editable - a change is a relabel) and only the unmapped categories are empty; the AI call proposes for the unmapped ones only.
- Under the table: a small drawing of the SVG with the category's sections lit on hover (the editor's own map component, read-only). Builder's call whether this ships in the first pass or the next (§16).
- Footer: **"אשר - יחול על 15 ההופעות ויישמר כתבנית האולם"** and "בטל". The confirm runs `classifyVenue(runId, sourceUrl, rows)` (§6.3) and the dialog reports what happened: "15 אירועים עודכנו · 7 זונים · 1 נפסל · 1 לבדיקה".
- AI off, timeout, budget, rate cap or a bad answer: the table opens with the Hebrew boxes EMPTY, the code-rule drops applied, and one line above it - "ה-AI כבוי / לא ענה - מלאו את השמות ידנית" (the parse card's rule: with the switch off everything but the proposal works). Confirm is enabled as soon as every non-dropped row has a label or is marked "לבדיקה".
- Opening the dialog again before confirming makes another call, inside the same per-person cap as the parse (§8).

### 5.3 The names dialog ("שמות בעברית")

Opens from the names row or the subject row. `proposeTeamNames(runId)` collects every side of every item of the run (home and away of `show`, plus the subject's own `name_en` when `no_team_page` / `no_artist_page` is on any item) that `teamsHe` + `clubNamesMatch` do not know, and makes ONE AI call (§8) for all of them. On an artist run the one row is the artist. Rows:

| שם אצל הספק            | שם באנגלית (לעמוד)  | שם בעברית        | מה יקרה                                   |
| ---------------------- | ------------------- | ---------------- | ----------------------------------------- |
| Fulham FC              | Fulham              | פולהאם            | תיווצר קבוצה (בלי סמל ותמונה)              |
| Newcastle United FC    | Newcastle United    | ניוקאסל יונייטד    | תיווצר קבוצה (בלי סמל ותמונה)              |
| Aston Villa FC         | Aston Villa         | אסטון וילה        | קיימת כבר - ישתמש בה                      |

- Every box is editable. A row whose Hebrew box is emptied is skipped (no row created, that fixture keeps its English name). "קיימת כבר" is a row `clubNamesMatch` found after all under the clean English name - it is used, not created.
- A line above the table, always: **"ה-AI לא מביא תמונות: הקבוצות ייווצרו לא פעילות, בלי סמל ובלי תמונה - הפעילו אותן ב-Templates אחרי שהסמל הועלה."**
- Under the table, when any show of the run takes its name from LiveTickets (§7.1): "N אירועים יקבלו את השם בעברית מלייב טיקטס" - no row to fill, the confirm applies it. A names dialog with zero rows and such a line is one button: "עדכן שמות בעברית".
- Footer: **"צור את הקבוצות ועדכן את שמות האירועים"** → `createTeamsAndRename(runId, rows)` (§6.4); report: "3 קבוצות נוצרו · 15 אירועים קיבלו שם בעברית". The confirm also closes the run's names task (§7.1).
- AI off / failed: the Hebrew boxes open empty, the English clean-name box holds `cleanClubName(supplier name)` (code: "FC" / "CF" / "AFC" / "SC" suffixes and prefixes stripped), same line as §5.2.

### 5.4 "החל גם על השאלות הדומות בריצה"

On a question card, under the options: a checkbox **"החל גם על N השאלות הדומות בריצה"**, shown only when `runRuleOf(question, pickedAnswer)` yields a rule and `applyRuleTo(rule, other)` answers at least one OTHER open question of the run (N = that count, computed on the client from the loaded items as the person picks). "שלח" then calls `answerQuestion(itemId, answer, { applyToSimilar: true })` and the toast says "נענו N+1 שאלות".

### 5.5 "למד מהאירוע הזה" - one event fixed by hand, applied to the rest

The second path to a classified venue (decision 3). A person opened one of the run's events in the editor and arranged it - adopted the drawing and named zones on the Suppliers & zones board, wrote Hebrew ticket descriptions, deleted the away section. Back on the board:

- The card of that event shows "נערך" (as today) and, when other shows of the same venue in the run still carry `new_venue` / `unzoned_tickets`, a button **"למד מהאירוע הזה והחל על 14 ההופעות"**. The panel's venue row offers the same button (§5.1, third form).
- The click opens a small confirm listing what will be learned - "7 זונים (3 חדשים) · 1 קטגוריה נפסלה (Away Fans Section) · 5 תיאורים" - and **"החל"** runs `learnFromEvent(itemId)` (§6.5): the template is updated from the event, every other show of the venue in the run is rewritten exactly as a classification confirm does (§6.3 steps 2-5). No AI call; nothing is asked.
- The event itself is not rewritten (it is the source). A category the event dropped is learned as a drop ONLY when the event's row carries no ticket of a category its `payload` had - a ticket removed by hand, not one that never existed.

## 6. Data and writes

### 6.1 `venue_maps` - two additions

- `zones[].description` (optional string, ≤ 160 chars) - the Hebrew line the customer reads under the zone's title. Inside the existing `zones` jsonb: no migration. Carried by EVERY reader and writer of a zone: `VenueZone` type, `sanitizeZones` (keeps it, trimmed, capped), `zonesOf` in `uploader-prior.ts` (rebuilds `{ id, label, sections, description? }`), `zoneFromTemplate` (copies it onto a ticket whose `description` is empty), the editor's zones board (a third box per zone; its save passes the field through); `stampZones` ignores it (the SVG only needs ids).
- `dropped_categories jsonb not null default '{}'` = `{ "tixstock": ["<normalized category>", ...], "tixstock_kept": [...] }` - categories this venue never sells, and rule-drops a person un-dropped (kept next run too). Keys are `normalizeSupplierCategory` output, the same key the template uses.
- `uploader_runs.names_task_id uuid null` (§7.1). One migration for both columns: `supabase/migrations/<ts>_uploader_alon_round_1.sql` (idempotent `add column if not exists`).

### 6.2 Pure rules (`lib/uploader/classify.ts`, selftested)

- `dropRule(category): { drop: boolean; reason: "away" | null }` - lower-cased, WORD-bounded: `away`, `visitor`, `visitors`, `visiting` → `away` ("Away Fans Section", "Visiting Supporters" drop; "Getaway Lounge", "Riverside View" do not). No obstructed-view half (§3 d).
- `applyClassification(tickets, template, dropped, kept)` → `{ tickets, dropped: string[], unzoned: string[] }`: removes the `tixstock` tickets whose normalized category is in `dropped` (the template's list ∪ the rule's, minus `kept`), zones the rest by `zoneFromTemplate` (description copied onto an empty one only - a LiveTickets description is never overwritten), and lists EVERY ticket still without a zone (LiveTickets too - the build's own count, so `unzoned_tickets` means one thing). Used by the dialog's confirm (§6.3) AND by the build (step 4) from now on, so a later run at a classified venue drops and describes by itself (decision lines `categories_dropped_by_template` / `zones_from_template`).
- `parseClassification(answer, categories)` - the model's tool output checked field by field: unknown categories ignored, a category the model skipped = unsure, a label without a Hebrew letter = unsure, label ≤ 40 / description ≤ 160 (cut), `drop` only with a reason. Returns `{ rows: ClassificationRow[]; problems: string[] }`.
- `templateFromRows(rows, drawing)` → `{ zones: VenueZone[]; categoryToZone; dropped; kept }` - the FINAL template: a zone per confirmed, non-dropped row (id by `newZoneId`, label, description, `sections` = the drawing's sections of that category, `[]` for a category off the map), NOTHING for unsure or dropped rows (no zone, no mapping - their sections stay in no zone; main greys them), `kept` = rule-drops the person un-dropped. The existing template's zones and mappings are merged in (a stored label the person did not touch stays).
- `classificationDiff(proposed, confirmed)` → `{ category, field: "label" | "description" | "drop", from, to }[]` - what the per-change audit rows and the lessons quote.
- `RUN_LEVEL_CODES`, `runLevelRows(items)` (the panel's rows, grouped by kind and venue, counted), `cardWarnings(item)` (the fold, with the drawing condition of §5.1) - in `lib/uploader/run-panel.ts`.

### 6.3 `classifyVenue(runId, sourceUrl, rows)` - the confirm (`lib/actions/uploader-actions.ts`, `requireAdmin`)

Validates the input before any read (`sourceUrl` on an adoptable host, every row's category among the venue's categories of §5.2, labels / descriptions within the caps, no two rows one category), then, in this order:

1. **Template.** No `venue_maps` row for `sourceUrl` → `adoptVenueMap(sourceUrl, venueName, { categoryLabels })` (the SVG copy, the row, the starting zones) → then `saveVenueZones(id, templateFromRows(...).zones)` REPLACES the starting zones with the final list (unsure / dropped categories lose their zone; off-map categories get a section-less zone; descriptions on) → `rememberSupplierCategories(id, "tixstock", { ...categoryToZone, <unsure>: "", <dropped>: "" })` so the template holds confirmed categories only → `dropped_categories` written (`tixstock` = the drops, `tixstock_kept`). A row already there → the same three writes over the merged template (§6.2). `adoptVenueMap` failing (supplier map down, no sections) → `{ ok: false, kind: "adopt_failed", message }` before anything else is written.
2. **Events.** Every item of the run with `event_id`, status `ready` or `approved`, whose `show.suppliers.tixstock.venue_map_url === sourceUrl` and whose event is not soft-deleted: `tickets_and_rates` = `applyClassification(...)` of the row's tickets, `map_image_url` = the template's `svg_url` - one UPDATE per event of those two columns (never `updateEvent`; the same direct-column discipline as approve). A `tickets_and_rates` with zero tickets left after the drops is NOT written: that event keeps its tickets and its card gets the warning `all_dropped` ("כל הקטגוריות נפסלו - בדקו ידנית") - a show with no sellable ticket is a person's call. Written in position order; the action reports how many it reached, a second confirm finishes the rest (step 1 is then a merge with no change).
3. **Items.** `warnings` minus `new_venue` / `unzoned_tickets`, plus `unzoned_tickets` again when any ticket is still unzoned ("{count} מתוך {total} כרטיסים בלי זון - לבדיקה: <categories>"); decision `classified` ("סווגו 7 זונים · 1 נפסל (Away Fans Section) · 1 לבדיקה"); `payload.tickets_and_rates` / `payload.map_image_url` = what was just written (the approve-time diff must not read the classification as a staff edit).
4. **Audit** - `uploader.classified` (one row per venue, the record): `{ agent, run_id, venue, source_url, categories: n, proposed, confirmed, dropped, kept, unsure, event_ids, ai: boolean }`; and `uploader.classify_changed` ONE ROW PER CHANGE of `classificationDiff` (plus one per manual label when `ai: false`): `{ agent, run_id, venue, category, field, from, to }` - the lesson source (§9).
5. `revalidateMain()` once when any touched event is `approved` (live), `invalidatePriceLight("rows")` as approve does. `recomputeRun` is not needed (no status changed).

Returns `{ ok: true, events: n, zones: n, dropped: n, unsure: n }` or `{ ok: false, kind }` (`not_found`, `bad_input`, `adopt_failed`, `db_error`).

### 6.4 `createTeamsAndRename(runId, rows)` (`requireAdmin`)

Validates (Hebrew letters in `name_he`, ≤ 60; `name_en` ≤ 80), then:

1. For every row not marked existing: a `football_teams` (artist run: `artists`) row through `createRow` directly - `{ name: name_he, name_english: name_en, slug: autoSlug(name_en, name_he) (a taken slug gets `-2`), is_active: false, ...the form's empty defaults }` - no `logo_url`, no `image_url`, no gallery, no `art_image_url`, and NO taxonomy leaf yet (decision 2). `updateFootballTeam` / `updateArtist` gain: when `is_active` flips false → true, run `ensurePersonTaxonomy` (tolerant, as create does) - the tag, the auto-tag rule and the `/c/` leaf appear when the page does. Audit `uploader.team_created` `{ agent, run_id, team_id, kind, name_he, name_en, from_supplier_name }`.
2. `teamsHe` is re-read; for every item of the run with `event_id` and status `ready` / `approved`, `eventNames` (§7.1 rule) is run again; where it now answers `hebrew: true` and the stored `name` differs, `events.name` is updated (one column); `payload.name` follows; `warnings` minus `no_hebrew_name`; `no_team_page` / `no_artist_page` removed from every item once the subject's row exists. Decision `named_he` ("שם בעברית: פולהאם - ניוקאסל יונייטד" / "שם בעברית מלייב טיקטס").
3. Audit `uploader.renamed` `{ run_id, event_ids, teams_created: n }`; the run's names task (§7.1) is closed with a note; `revalidateMain()` once when a live event was renamed.

The subject cache of the run (`uploader_runs.subject_cache`) is refreshed so the next build in the same run sees the row.

### 6.5 `learnFromEvent(itemId)` (`requireAdmin`) - decision 3

1. Reads the item, its run and its event row (`tickets_and_rates`, `map_image_url`, `tx_excluded_sections`), and the `venue_maps` row of the item's `show.suppliers.tixstock.venue_map_url` (none → `kind: "no_template"` unless the event's `map_image_url` is one of our `svg_url`s - the editor's board adopted it; then that row).
2. Pure `templateFromEvent(eventTickets, payloadTickets, template)` → `{ zones, categoryToZone, dropped, descriptions, learned: { zones: n, newZones: n, dropped: string[], descriptions: n } }`: for every `tixstock` ticket with a `zoneId`, the category maps to that zone; its `zoneLabel` becomes the zone's label when the template's label is still the English slug (a Hebrew label already in the template stays unless the ticket's differs AND is Hebrew); its `description` (non-empty) becomes the zone's description; a category present in `payloadTickets` and absent from `eventTickets` is a drop. Everything merges OVER the existing template.
3. Writes the template as §6.3 step 1 does (`saveVenueZones`, `rememberSupplierCategories`, `dropped_categories`), then §6.3 steps 2-5 for every OTHER item of the venue in the run (the source event untouched; its item gets decision `taught_venue` "האירוע הזה לימד את תבנית האולם").
4. Audit `uploader.classified` with `source: "event", event_id` and `uploader.classify_changed` rows for what the event taught (`from: null`, "by hand"). Returns the same shape as `classifyVenue`.

## 7. A rule for the run (questions)

Pure, in `lib/uploader/run-rules.ts`:

- `runRuleOf(q, item, answer): RunRule | null` - `pick_show`: `both` | `skip` (a listing id names ONE show, it is no rule); `pick_date`: `tix` | `live` | `both` | `skip` (the prefix of `tix:<day>` / `live:<day>`); `pick_location`: `{ locationId | "skip", venue: normalizeName(item.show.venue), city: normalizeName(item.show.city) }`. Free text → null.
- `applyRuleTo(rule, other: UploaderItem): string | null` - the key to answer `other`'s question with: same kind required; `pick_date` `tix` → the other's own `tix:<its day>` option (null when absent); `pick_location` → only when the other's show has the same venue AND city (a competition run across cities gets nothing; three nights at one hall get the rule), and the id is among its options; else null.

`answerQuestion(itemId, answer, { applyToSimilar?: boolean })`: after the item's own answer is written, when the flag is on and a rule exists, every other `question` item of the run that `applyRuleTo` answers goes through the SAME per-item path (effects, task close, `uploader.answered` with `rule_applied: true`), in position order, stopping at the first `db_error` (what was answered stays answered). Returns `{ ok: true, applied: n }`. The lesson line gains "(a rule for the run, applied to N more)".

### 7.1 The Hebrew event name - ours, LiveTickets', else ask (decision 4)

`eventNames` (`lib/uploader/names.ts`, pure) becomes, for a team / competition run: (1) both sides in `teamsHe` → `"<home he> - <away he>"`, `source: "teams"`; (2) else the LiveTickets twin's `event_name_heb` (trimmed, ≤ 120, must contain a Hebrew letter) → `source: "livetickets"`; (3) else the English name, `hebrew: false`. For an artist run the order is unchanged (the artist row / the brief, then LiveTickets, then English). The build's decision line names the source ("שם בעברית מלייב טיקטס"); `no_hebrew_name` is raised only at (3).

**The ask:** `createRun`, after the items are inserted, runs the pure `missingHebrewNames(items, teamsHe)` (the sides and `liveRef.name_heb` are in `show`); when it is not empty, ONE task is raised for the run - source `uploader`, board `ops`, priority `high`, assignee the asker, `created_by: null` (the same shape as a question task, `source_ref.kind = "uploader_names"`, url = the board), title "שמות בעברית חסרים: <N קבוצות> - ריצה <subject>", counted in `MAX_QUESTION_TASKS_PER_RUN`; its id is stored on the run (`uploader_runs.names_task_id`, nullable - a column, since `counts` is a numbers bag). The build goes on regardless. The names dialog's confirm closes it (§6.4 step 3); a task closed on the Tasks board by hand is refused like a question task ("ענו בלוח ההעלאה"). Run `386c906f` predates this and gets no task; its panel row is the ask.

## 8. The two new AI calls (same agent, same switch)

Both live in `lib/services/tour-uploader-classify.ts`, copying `parseBriefWithAgent`'s discipline exactly (§4): `agentEnabled(TOUR_UPLOADER_AGENT)` else `off`; the per-person cap checked FIRST by the action (`countRecentParses(session.sub, PARSE_RATE_WINDOW_MS) >= PARSE_RATE_MAX` → `rate_limited`; the two dialogs share the parse's 10-per-10-minutes allowance, the `agent.call` row carries `user_id`); a fresh `newBudget` per action call; the call's OWN lesson sources + taught rules in the fenced block (§9); forced non-strict tool; `effort: "low"`; `max_tokens` sized for 80 rows; `timeoutMs` 20 s, `maxRetries: 0`; `agent.call` audit with the cost; every failure a typed outcome. **No price, no listing, no URL reaches the model** - categories, section ids and names only.

- **`classify_venue`** - `proposeVenueClassification` first fetches the drawing read-only (the same fetch `adoptVenueMap` makes - factored into `fetchSupplierSvg(sourceUrl)` in `venue-map-actions.ts`: host allowlist, size cap; a venue already adopted reads our own copy through `getVenueMapDrawing`) and lists its categories with their section ids. Input: venue name, city, the run's subject and kind (football / music), the categories (raw name, normalized key, up to 12 section ids and the count - the drawing's own words help: "longside-lower-tier_L12"; a ticket category with no section says so), the stored labels of an existing template, and up to 6 Hebrew zone labels from OTHER venues as style examples (`venue_maps.zones[].label`, read once). Output per category: `{ category, label_he, description_he, drop, drop_reason: "away" | "other" | null, unsure }`. System prompt rules: label = the stand's position in plain Hebrew, ≤ 5 words, a proper name transliterated ("ריברסייד"); description = one sentence about the view / position, no prices, no promises about seats together; `drop` for away / visiting supporters' sections; `unsure` when the name says nothing about the position (hospitality boxes, codes). The code rule (`dropRule`) is applied over the answer regardless - the model can add a drop with `other`, it cannot remove a rule drop (the person can).
- **`name_teams`** - input: the supplier names (and the sport, or "artist"). Output per name: `{ supplier_name, name_en, name_he }`. Rules: `name_en` = the common English name without the legal suffix (Newcastle United, not Newcastle United FC); `name_he` = the Hebrew spelling used by Israeli sports / music press (אסטון וילה, ניוקאסל יונייטד, ווסטהאם יונייטד); never a translation of the words. `parseTeamNames` checks Hebrew letters and lengths; a name the model skipped opens empty.

`callsPerRun` (3) is the agent layer's per-call ceiling; each dialog open is one call. Cost per call is a few cents and is summed by AI Factory like the parse.

## 9. What the agent learns from (per call)

The agent keeps ONE `learnsFrom` list and one memory block; what changes is that a call reads only the sources that are about ITS job. `loadAgentLessons(def, { sources?: string[] })` gains that optional filter (`lib/agents/memory.ts`; `traceAgentLessons` shows the source of every quoted line, so AI Factory's trace still explains it). The parse call reads the five sources it reads today; `classify_venue` reads `uploader.classify_changed`; `name_teams` reads `uploader.team_created`. New sources:

- `uploader.classify_changed` → "at Craven Cottage staff renamed zone 'Longside Lower Tier' from 'יציע לאורך' to 'לאורך המגרש - יציע תחתון'", "at Craven Cottage staff un-dropped 'Family Section' (the rule flagged it)", "at Craven Cottage staff dropped 'Hospitality Box 12' (other)", "at Craven Cottage staff named 'Riverside Stand' 'ריברסייד' by hand" (`ai: false`). A row confirmed as proposed writes nothing.
- `uploader.team_created` → "staff named Newcastle United FC 'ניוקאסל יונייטד' (English page name Newcastle United)".
- `uploader.answered` with `rule_applied` → the existing line plus the suffix (§7).

Maturity: unchanged (approve with / without an edit). The classification is not an edit (§6.3 step 3). `purgeAuditLog` already exempts `uploader.%` (180 days).

## 10. Permissions, switches

Every new action `requireAdmin()` first, input validated before any read, `{ ok: false, kind }` never a throw. The venue-map and template actions it calls are `requireStaff` (an admin passes). The switch is `TOUR_UPLOADER_AI` as before; off = both dialogs open for manual fill. Nothing new in the env.

## 11. Design of the panel and dialogs

The board's own vocabulary (`board-words.ts`, `card-shell.tsx`): the panel is a card the width of the grid with a short title row ("לטיפול ברמת הריצה · 3 נושאים") and the rows as a compact list - number, text, button at the end; it collapses to its title once every row is handled (and disappears with the next refresh). Dialogs are shadcn `Dialog` with the table scrolling inside (a big stadium has 40+ categories); RTL, Hebrew boxes `dir="rtl"`, English cells `dir="ltr"`. Keyboard: Tab through the boxes, Enter in the last box = confirm. Same empty / loading / error states as the plan card ("ה-AI מציע…" with the 20 s bar).

## 12. Pure modules + selftest (`scripts/tour-uploader-selftest.ts`)

- `run-panel.ts`: `runLevelRows` groups by kind and venue, counts shows, orders rows, includes a template-known venue with `unzoned_tickets`, skips a null drawing; `cardWarnings` folds exactly `RUN_LEVEL_CODES` with the drawing condition and keeps the rest; an item with only card-level warnings shows no fold line.
- `classify.ts`: `dropRule` ("Away Fans Section" → away; "Visiting Supporters" → away; "Getaway Lounge" → none; "Longside Lower Tier (Restricted View)" → none - views are a listing rule, not a category rule); `applyClassification` removes dropped, keeps `kept`, zones by template, copies the description onto an empty one only, never touches a LiveTickets ticket's description, lists every unzoned ticket (LiveTickets included); `parseClassification` (unknown category ignored, no Hebrew → unsure, drop without reason → not a drop, caps); `templateFromRows` (unsure / dropped → no zone, no mapping; off-map → section-less zone; a stored label untouched stays); `classificationDiff` (renamed / un-dropped / dropped / unchanged → nothing).
- `run-rules.ts`: `runRuleOf` + `applyRuleTo` for the three kinds - a `pick_date` whose other question lacks the `tix:` day (null), a `pick_show` listing id (no rule), a `pick_location` at another venue of the same run (null) and at the same venue (the id).
- `team-names.ts`: `missingSides` (dedupes by `normalizeName`, skips sides `teamsHe` / `clubNamesMatch` know, includes the subject only when `no_team_page` / `no_artist_page` is present, the artist alone on an artist run), `cleanClubName` ("Newcastle United FC" → "Newcastle United", "Real Madrid CF" → "Real Madrid", "AFC Bournemouth" → "Bournemouth"), `parseTeamNames`, `missingHebrewNames` (empty when every show resolves by §7.1, lists the sides otherwise).
- `names.ts`: `eventNames` football - both sides → ours; one side missing + LiveTickets Hebrew → LiveTickets' (`source`); neither → English with `hebrew: false`; a LiveTickets name with no Hebrew letter is not a name.
- `classify.ts` `templateFromEvent`: a zoned ticket maps its category; a Hebrew `zoneLabel` relabels an English-slug zone and never a Hebrew one it did not change; a description lands on the zone; a category in `payload` and gone from the event is a drop; a category that never existed is not; the merge keeps an untouched template entry.
- `zone-from-template.ts` + `zonesOf`: description carried and copied, an existing description kept.

## 13. Guide, docs, memory

- `/guide` uploader section: the panel, the two dialogs, "לבדיקה", the rule checkbox (both languages; `guide-selftest`).
- `CLAUDE.md` "Agent #3": a paragraph for the round (the two calls, `dropped_categories`, `zones[].description`, `names_task_id`, the run-level panel, learn-from-event, the Hebrew name rule, the rule for the run, teams created inactive).
- `docs/superpowers/guides/2026-10-21-tour-uploader-how-to-he.md`: a section "סבב אלון 1" for Alon - what to do with his Fulham run (open the board, "סווג כרטיסים" OR fix one event in the editor and "למד מהאירוע הזה", "תן שמות בעברית", answer the one question, then approve; activate the new teams in Templates once their crests are in).

## 14. Deploy order

1. Push to master (the migration rides it; apply green). Nothing on myt-main.
2. First use = Alon's run `386c906f` on prod: the panel shows the Craven Cottage row and the names row at once (the warnings are already on the items). Classify, name, answer the `pick_show` (the 15:00 kick-off is Fulham's published time - Alon decides), approve.
3. `npm run db:types` afterwards (still owed from 21.10).

## 15. Measured limits

A classification call for a stadium with 60 categories is ~3 K input tokens and ~2.5 K output - under the 20 s budget on Opus 5 at low effort (the parse, a smaller call, answers in 6-10 s). Rewriting 15 events is 15 small UPDATEs inside one action, well under the page's `maxDuration` 60; a competition run with 60 shows at one venue is the upper bound this round designs for (§6.3 step 2 reports and resumes).

## 16. Left to the builder

- Whether the hover-lit mini map ships in the first pass of the classification dialog or right after (the table alone is complete).
- The exact `max_tokens` of the two calls and the number of section ids quoted per category.
- How the editor's zones board shows / edits `zones[].description` (a third box per zone is enough).
- Whether `cleanClubName` lives in `lib/on-tour.ts` beside `clubNamesMatch` or in `lib/uploader/team-names.ts`.
- The fold line's exact wording and the scroll target id of the panel.
- Whether `proposeVenueClassification` caches the drawing's category list per venue on the run row (`subject_cache`) or re-reads the SVG each open.

## 17. Open questions for Dor

None. The builder check's one question for Dor - a team the dialog creates, active or inactive - was settled 22.10: **inactive** (decision 2; the reason: main lists every active team on its homepage football row, crest or not, and `ensurePersonTaxonomy` would publish a `/c/` leaf at once; an inactive row still names the events and is "logo-only, no public page" on main). The same day Dor added decisions 3 (learn from one hand-fixed event) and 4 (the Hebrew name rule with a run-level ask). Everything else the check raised is settled above as my call (§3 b-m) or a correction to the text.
