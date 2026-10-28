# AI Uploader - Alon's round 2 (28.10.2026)

Source: Alon's doc "באגים / תיקונים - אלון תום ודור", tab "אי אי אפלואדר" (`t.fclqdo4xd71i`), ten notes.
Diagnosed against prod on 28.10: run `dc0743eb` (Lazio home games, 28.10) and run `ecd50031` (Thirty Seconds
to Mars, 26.10). Dor approved the whole round with the four recommendations ("יאלה רוץ", 28.10).

## 1. What happened (the evidence)

| Note | What Alon saw | Cause found on prod |
|---|---|---|
| 1 | "SS לאציו ולאציו" - it should ask me and learn | Every Lazio home game became TWO shows: TixStock prints the city "Roma", LiveTickets "Rome"; `groupRows` keys a show by the normalized city, so they never paired. The club rule already equates "SS Lazio" / "Lazio" (`clubKey` drops `ss`). The same split on the 30STM run: Lisboa/Lisbon, Wien/Vienna, München/Munich, Milan/Milano, Antwerpen/Antwerp, Köln/"K�ln" (LiveTickets sends a broken character), Frankfurt am Main/Frankfurt. |
| 2 | A standing description rule, editable BEFORE the run | Built 27.10 as a board dialog, never saved (`uploader_settings` is empty) - Lazio's events read "SS Lazio vs Cagliari Calcio at Stadio Olimpico". The venue prints in English ("בקאמפ נאו" impossible). |
| 3 | No team / artist page - open a task from here | The panel's subject row only opens the names dialog. |
| 4 | Hebrew names do not attach to existing pages; let me merge | The names dialog created **10 duplicate teams** on the Lazio run (Cagliari, Lecce, Atalanta, Bologna, Venezia, Juventus, Torino, Sassuolo, Udinese, Fiorentina - twice each, ids 56/58 ... 85/87): `distinctSides` dedupes by `normalizeName` ("Cagliari Calcio" ≠ "Cagliari"), both rows clean to "Cagliari", both are inserted. There is no way to say "this is the existing page X". |
| 5 | Classify: no exclude; must see the map; no Hebrew description line | The dialog has no map. "Exclude" = the event editor's exclude-sections mode on the TixStock map (`events.tx_excluded_sections`); the uploader builds every event with `tx_excluded_sections: []`, and learn-from-event does not copy it. |
| 6 | LIVE is not brought because it is not instant-confirm | (a) the split of note 1 left the LiveTickets rows as shows of their own; (b) `ticketsFromLiveStock` drops every `nonInstantOnly` category, so those shows had zero tickets and were skipped. The site already sells a category attached on purpose as `nonInstant` (Alon 23.09; the price sync keeps it, main warns). |
| 7 | Berlin not recognized (30STM) | TixStock gives "Velodrome Berlin" the coordinates 51.5, 10.5 - the middle of Germany. Nearest location = Hannover 110 km -> ticket-only, although location 8 "ברלין, גרמניה" exists. `locations` holds Hebrew names only, so the city name could not overrule. |
| 8 | Rejected should filter out | "הכל" lists rejected and skipped shows. |
| 9 | No location -> force creating one, with human approval (Valencia) | No location within 50 km -> silently ticket-only (Valencia, Frankfurt, Antwerp, Dublin). |
| 10 | Unclear which flow ("learn from this event") | The learn button appears only AFTER an event was fixed in the editor; nothing says the first step is the editor. |

## 2. Decisions (Dor, 28.10)

- **D1** LiveTickets categories that are not instant-confirm are BROUGHT by default, marked `nonInstant: true`
  (the site warns, confirm-order already records it). A plan-card switch turns it off per run.
- **D2** A show with no location ALWAYS asks: create a location / package through a nearby city (two-city) /
  ticket only / skip. The brief's `without_location` rule only marks the recommended option and is what
  "apply to the similar questions" does. Never a silent ticket-only again.
- **D3** Each hall gets a Hebrew name: the AI proposes it in the classify dialog, a person confirms;
  `{אולם}` prints it.
- **D4** The Hebrew zone description leaves the dialog and the AI stops proposing it; descriptions already
  stored in a venue template stay untouched.
- **Cleanup** the 10 duplicate inactive teams (58, 61, 64, 67, 70, 74, 77, 81, 84, 87 - the LiveTickets
  spelling twins) are soft-deleted (`is_deleted = true`) on prod.

## 3. Same show, same city, same team - and learning it (notes 1, 4, 6, 7)

### 3.1 Data
- `locations.aliases text[] not null default '{}'` - other spellings of the city (English, local, common
  supplier forms). Seeded by the migration for the existing rows (Rome/Roma, Milan/Milano, Munich/München/Muenchen,
  Vienna/Wien, Lisbon/Lisboa, Berlin, Madrid, Barcelona, Paris, Krakow/Kraków, Warsaw/Warszawa, Amsterdam, London,
  Budapest, Prague/Praha, Bucharest/București, Athens/Athína, Düsseldorf/Dusseldorf, Hannover/Hanover, Liverpool,
  Manchester, Abu Dhabi, Limassol, and the US cities). Main never reads `locations` (checked), so the column is
  backoffice-only. The Locations form edits it ("שמות נוספים", comma-separated).
- `uploader_aliases` (new, RLS on, no policies, anon/authenticated revoked): `id uuid pk`, `kind text`
  (`city` | `team`, no CHECK), `from_name text`, `from_key text` (= `normalizeName(from_name)`), `to_name text`,
  `to_key text`, `team_id int null` (kind team), `created_by uuid null`, `created_at timestamptz default now()`,
  unique `(kind, from_key)`. What a person confirmed once and the code reuses on every later run.

### 3.2 One equivalence rule (pure, `lib/uploader/equivalence.ts`)
- `cityKey(name)`: normalized name; a `�` / `?` inside a word matches any one letter (the LiveTickets broken
  character); then mapped through the groups: every location's `shortPlace(name)` + its aliases form one group,
  every confirmed city alias joins two names into one group (union-find). The key of a group is stable (the
  smallest member key). A name in no group is its own key.
- `teamKey(name)`: `clubKey(cleanClubName(name)) || normalizeName(name)`, then mapped through confirmed team
  aliases (all spellings linked to one `team_id` share the key `team:<id>`).
- `groupRows` uses `cityKey` / `teamKey` for its grouping keys only. `showKey` / `questionKey` (the keys earlier
  answers and rejections are stored under) do NOT change.

### 3.3 The new question `same_show`
After the exact pairing (and the existing one-day `pick_date` step), a TixStock-only show and a LiveTickets-only
show of the subject **on the same day** (same home side for football) whose cities did not match, paired
uniquely both ways, become ONE item with the question:
"TixStock מוכר הופעה ב-Lisboa ו-LiveTickets ב-Lisbon באותו יום (06.04.2027) - זו אותה הופעה?"
Options: `same` "כן, אותה הופעה" · `both` "לא, שתי הופעות" · `skip` "דלג".
- `same`: the item builds as one show carrying both suppliers (TixStock's identity, LiveTickets attached), and
  the server records a city alias (`from` = LiveTickets' city, `to` = TixStock's) - the next run merges them
  silently.
- `both`: split exactly like `pick_date`'s "both" (TixStock's show stays, LiveTickets' becomes its own item).
- An exact repeat across runs is answered by `priorAnswerFor` as today; "apply to the similar questions" works
  for `same` / `both` / `skip`.

### 3.4 City beats bad coordinates (note 7)
`decidePlace` gains a step before the nearest-by-coordinates one: a flyable location whose name or alias equals
the show's city (`cityKey`, and the country codes agree when both are known) is the package's location. When the
venue's coordinates are more than `NEAR_LOCATION_KM` from it, the decision says so and a warning
`venue_coords_far` names the distance ("הקואורדינטות של האולם רחוקות 110 ק"מ מברלין - נבנה לפי שם העיר").
LiveTickets' own city (no-coordinates path) matches aliases too.

### 3.5 LiveTickets non-instant (note 6, D1)
`UploaderPlan.rules.livetickets_non_instant: boolean` (default `true`; a stored plan without it reads `true`;
the parse tool may set it false when the brief says "instant only"). With it on, a `nonInstantOnly` category
becomes a ticket with `nonInstant: true`; the decision line reads "N קטגוריות LiveTickets ללא אישור מיידי (יסומנו
באתר)". Categories blocked for any other reason are still dropped.

## 4. Missing location -> create one (note 9, D2)

### 4.1 Asking
`decidePlace` step 6 (no location within `NEAR_LOCATION_KM`, no memory) no longer builds or skips by itself: it
asks `create_location`:
"אין לנו מיקום ל-Valencia (Roig Arena). מה לעשות?" with options, in this order, the brief's rule first among
the last two and labelled "(לפי הבריף)":
- `create` "צור מיקום ל-Valencia" (opens the form, 4.2)
- `two_city:<locationId>` "חבילה דרך <city> (N ק"מ) עם פיצול מלון" - only when a flyable location is within
  `FAR_VENUE_KM`
- `ticket_only` "כרטיס בלבד"
- `skip` "דלג"
`pick_location` (a show with no coordinates) gets the `create` option too.

### 4.2 Creating
The question card's `create` opens a form: Hebrew name ("ולנסיה, ספרד" - the `locations.name` convention
"<city>, <country>"), IATA (3 letters), latitude / longitude, other spellings. It is filled by
`proposeLocation(itemId)` - one AI call (`propose_location`, the agent's discipline: forced non-strict tool,
20 s, `maxRetries: 0`, an `agent.call` row, the parse's rate cap) seeded with the show's city, country code,
venue and coordinates; off / no answer / cap -> the same form, empty except the coordinates of the venue.
`createLocationAndAnswer(itemId, input)` validates (Hebrew letter in the name, IATA `^[A-Z]{3}$`, lat in
[-90, 90], lon in [-180, 180], no existing location with the same IATA AND a name of the same city), inserts the
row (aliases included), audits `uploader.location_created`, answers the question with the new location id and
re-queues the item; every other open `create_location` question of the run whose show is in the same city
(`cityKey`) is answered with it too. `uploader.location_created` is a lesson source of `propose_location`.

### 4.3 Answers
`ticket_only` builds ticket-only (today's step 6 body), `skip` skips `skipped_by_answer`, `two_city:<id>` builds
the two-city package (`decidePlace`'s `twoCity` path). Run rule: `ticket_only` / `skip` apply to every open
`create_location`; `two_city` / a created location only to the same city.

## 5. Names (note 4) and pages (note 3)

- `distinctSides` / `missingSides` dedupe by `teamKey` (3.2); `cleanClubName` also strips `ACF`, `SS`, `US`,
  `AS`, `CFC`, `SV`, `FK`, `SK`, `CD`, `UD`, `RC`, `RCD`, `SL`, `CA` and a trailing `Calcio` or 4-digit year.
- The dialog's rows get a third mode beside create / Hebrew name: **"זה עמוד קיים"** - a search over every
  `football_teams` row (Hebrew + English, inactive included, deleted excluded). Picking one records a team
  alias (`from` = the supplier spelling, `team_id`) and that team's Hebrew name names the events.
- `createTeamsAndRename` collapses rows with the same `teamKey` of the typed English name (or the same Hebrew
  name) into ONE team, and before inserting re-reads `football_teams`: a row matching by the club rule is linked,
  never created again.
- Panel: the subject row ("אין עמוד ...") and every fix row (crest / bio / cut-out / gallery) get a second
  button **"פתח משימה"**: the shared `TaskEditor` prefilled - title "לבנות עמוד קבוצה: <name>" / "לבנות עמוד
  אמן: <name>" / "<fix text>: <name>", description with the run link, source `creative_gap`, `source_ref`
  `{ kind: "uploader_page", table: "football_teams" | "artists", row_id: <id or name_en>, label, url }`
  (url = the Templates edit page when the row exists, else `/templates`), board `marketing`.

## 6. Classify dialog (note 5, D3, D4)

- The Hebrew description column is gone; `classify_venue` no longer asks for `description_he`; saving a
  classification keeps the description already stored for a zone.
- The venue's drawing is shown beside the table (the TixStock SVG of `source_url`): hovering a row highlights its
  category; clicking a section toggles it EXCLUDED (the editor's `svg-excluded` look). Excluded sections are
  stored on the venue template (`venue_maps.dropped_categories.tixstock_sections`, no migration) and written to
  `events.tx_excluded_sections` of every ready / approved event of the venue (prices follow at the next TixStock
  price sync / approve re-check); a new build of that venue starts with them and prices with them.
- "Learn from this event" copies the event's `tx_excluded_sections` to the template and the venue's other shows.
- `venue_maps.name_he text` (migration): "שם האולם בעברית" at the top of the dialog, proposed by `classify_venue`
  (`venue_he`), saved by the confirm; `{אולם}` prints it (else the English venue). The confirm rewrites the
  descriptions of the venue's events whose description is still the uploader's own.

## 7. Plan card (notes 1, 2, 6)

- **"כוון את ה-AI"**: a box under the plan; sending re-parses with the brief, the plan as it stands on the card
  and the instruction (all inside the data fence), counts against the parse cap, and audits
  `uploader.plan_steered` (`steer`, `before`, `after`) - a lesson source of the parse.
- The parse tool returns `questions: string[]` (at most 5, 200 chars each) - what it could not map. Shown on
  the card as "ה-AI שואל:"; Alon answers through the steering box. Not part of `UploaderPlan`.
- **Description template** for the subject's family, editable on the card with its token chips and a sample
  preview; saved with the run (`createRun` writes it when changed). The migration seeds the defaults
  (`on conflict do nothing`):
  - football: `{בית} נגד {חוץ} ב{אולם}, במסגרת {מפעל}.`
  - artist: `{אמן} יוצא לסיבוב הופעות שחובה לראות! כרטיסים להופעה שלו ב{עיר}.`
- The non-instant switch (3.5): "כולל קטגוריות LiveTickets ללא אישור מיידי".

## 8. Board (notes 8, 10)

- A new default filter **"פעילים"** = everything but rejected and skipped; "הכל" stays, last. A rejected show
  leaves the default view at once.
- Learn in two steps on a card whose hall has other shows: before any edit, "1. סדרו את האירוע בעורך" (opens
  `/events/<id>` in a new tab) and a disabled "2. למדו והחילו על N ההופעות" with the line "אחרי השמירה בעורך
  הכפתור נפתח"; once the event was fixed by hand, step 2 is live (today's button). The panel's venue row and the
  classify dialog's footer carry the same one-line recipe.

## 9. Out of scope
A standing rule across runs other than aliases; LiveTickets categories in the classify dialog; hotel warm-up on a
created location (the base-price quote searches hotels live); the menu badge; "בנה בכל זאת"; inline editing of
board fields.

## 10. Deploy
Migration (`locations.aliases` + seed, `uploader_aliases`, `venue_maps.name_he`, the two template rows) rides the
push to master; every new read tolerates the column / table missing (42703 / 42P01 / PGRST204 / PGRST205) so the
code may land first. Nothing on myt-main. After the push: soft-delete the 10 duplicates; Alon re-runs Lazio.
