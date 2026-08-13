# Taxonomy v2 — Shopify-Style Collections / Hubs / Typed Tags

**Date:** 2026-08-12 · **Status:** Approved by Dor (brainstorming session)
**Repos:** `myt-backoffice` (owner of schema + tagging) and `myt-main` (feed, nav, /c/ pages, filters)

## Goal

Restructure the event taxonomy to the Shopify mental model — broad root
collections, hub sub-collections, fine-grained tags — on MYT's own platform
(no actual Shopify store), and give the product feed's `custom_label_0-4` a
stable, campaign-friendly hierarchy. Scope is **everything**: data model,
re-tagging, feed labels, main-app navigation, category pages, faceted filters.

## Decisions (locked)

| Question | Decision |
|---|---|
| Target | MYT platform only — Shopify is the mental model, not a store |
| Scope | Data + feed + nav + faceted filters (all in this effort, staged rollout) |
| Existing data | Per-item disposition table below (no blind wipe) |
| Month / availability / package-composition / venue "tags" | **Derived at read time** — never stored in `event_tags` |
| `custom_label` scheme | 0=vertical · 1=league∥genre · 2=team∥artist · 3=city · 4=availability |
| Tree shape | 3 levels with tag-less **hub** categories (ליגות/קבוצות/ז'אנרים/אומנים/ערים) |
| Tag kind mechanism | `event_tags.type` column (string union), slugs stay clean |
| Event tagging | Rule-based auto-tagger (additive), manual stays for edge cases |
| formula-1 category | Soft-delete now; recreate when F1 inventory exists |

Unchanged invariants: tags compose categories (never the reverse);
`event_category_links` stays a derived VIEW; membership is OR over a
category's own tags with **no tree inheritance** — a tag-less category is a
hub page (child tiles, no events grid). Soft deletes only.

## 1. Data model (backoffice migrations)

### 1a. `event_tags.type`

```sql
alter table event_tags add column if not exists type text not null default 'other';
alter table event_tags add constraint chk_event_tags_type
  check (type in ('vertical','league','team','artist','genre','city','other'));
```

Main app only reads this table, so the CHECK is safe (migrations rule).
TS: `const TAG_TYPES = [...] as const; type TagType = typeof TAG_TYPES[number]`.

### 1b. `tag_rules`

```sql
create table if not exists tag_rules (
  id bigint generated always as identity primary key,
  tag_id bigint not null references event_tags(id) on delete cascade,
  field text not null check (field in ('name','city')),
  pattern text not null,           -- name: case-insensitive contains; city: IATA equality
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tag_rules_tag on tag_rules(tag_id);
```

(Implementation correction: events carry no venue column — the location jsonb
has `name` ("לונדון, בריטניה") and `city_iata` ("LON"). `field='name'` matches
event `name` + `name_english` (contains, case-insensitive); `field='city'`
matches `location->>city_iata` (equality, case-insensitive). No venue field.)

Backoffice-only table (main never reads it).

### 1c. Data cleanup migration (idempotent, keyed by slug)

Tag dispositions:

| Tag (events) | Action |
|---|---|
| `football` (100) | type=`vertical` |
| `music` (104) | type=`vertical` |
| `sport` (100) | **soft-delete** (links removed) — verticals replace the umbrella |
| `premier-league` (129), `la-liga` (51), `bundesliga` (15), `eredivisie` (15), `champions-league` (1) | type=`league` |
| `seria-a-itilian-league` (57) | slug→`serie-a`, name_english "Serie A", type=`league` |
| `item-4` פופ (108) | slug→`pop`, type=`genre` |
| `item-3` סלין דיון (25) | slug→`celine-dion`, name_english "Celine Dion", type=`artist` |
| `hip-hop` (77), `electronic-music` (2), `punk-rock` (1) | type=`genre` |
| `rock-roll` (87) | slug→`rock`, type=`genre` |
| `clasic-rock` (54) | slug→`classic-rock`, type=`genre` |
| `country-rock` קאנטרי (31) | slug→`country`, type=`genre` |
| `classic` (0) + `classic-2` (43) | **merge** into one `classical` genre tag (links re-pointed, deduped) |
| `tennis` (0) | type=`vertical`, `is_active=false` until inventory |
| `wimbledon` (0) | soft-delete |

Merge mechanics: re-point `event_tag_links` and `category_tags` from source
tag to target, `on conflict do nothing`, then soft-delete source. Slug renames
keep ids → links intact.

New tags seeded: city tags for live event cities (london, paris, madrid,
milan, …, type=`city`) — exact list extracted from live `events` city data at
implementation time; starter team tags (type=`team`) — exact list = teams
appearing most in live event names (top ~10, e.g. real-madrid, barcelona,
arsenal), confirmed with Dor in the implementation plan. Every seeded tag has
`name` (he), `name_english`, clean slug.

### 1d. Category tree reseed (same migration)

```
כדורגל (football)                — existing id 4 → parent null, tags:[football]
├─ ליגות (leagues)               — new hub, no tags
│  ├─ ליגת האלופות (champions-league, existing id 1 reparented, tags:[champions-league])
│  ├─ פרמייר ליג (premier-league) · לה ליגה (la-liga) · סריה א (serie-a)
│  ├─ בונדסליגה (bundesliga) · ארדיוויזיה (eredivisie)     — new leaves, tag each
└─ קבוצות בולטות (teams)         — new hub
   └─ ריאל מדריד · ברצלונה · ארסנל …                        — new leaves, team tag each
הופעות מוזיקה (music)            — existing id 5 → activated, tags:[music]
├─ ז'אנרים (genres)              — new hub
│  └─ פופ·רוק·קלאסי·היפ הופ·אלקטרוני·קאנטרי·קלאסיק-רוק      — new leaves, genre tag each
└─ אומנים (artists)              — new hub
   └─ סלין דיון …                                            — new leaves, artist tag each
יעדים (destinations)             — new hub root, no tags
└─ לונדון · פריז · מדריד · מילאנו …                          — new leaves, city tag each
```

Soft-deleted categories: `sport`, `shows`, `tennis`, `festivals`,
`formula-1`. `is_deleted` on `categories` is **boolean** (unlike `events`).
Every leaf gets its composing tag via `category_tags`. `link_url` re-synced to
canonical `/c/` paths (existing `syncLink` logic pattern).

### 1e. Types (mirror to main — `/sync-types`)

- `EventTag` += `type: TagType`; export `TAG_TYPES`, `TagType`, `TagRule`.
- Files: backoffice `types/taxonomy.types.ts` ↔ main `lib/taxonomy.types.ts`.
- After apply: `npm run db:types`.

## 2. Auto-tagger + backoffice UI

### Service — `lib/services/auto-tagger.ts`

`applyTagRules(eventIds?: number[]): Promise<{eventsMatched, linksAdded}>`
- Loads active rules + live events (id, name, city, venue fields).
- Case-insensitive contains match per rule field.
- **Additive only** — computes missing (event, tag) pairs, upserts with
  `onConflict: "event_id,tag_id", ignoreDuplicates`. Never removes links, so
  manual curation is never undone.
- Chunked writes; tolerant try/catch + logging (sync services must not die on
  tagging errors).

### Hooks

- (Implementation correction: NO sync service ever inserts into `events` — the
  only two insert points in the whole repo are `createEvent` and
  `duplicateEvent` in `lib/actions/event-actions.ts`. Provider syncs update
  provider tables; staff create `events` rows from them via the UI.)
- Hook: end of `createEvent` — `applyTagRules([created.id])` in a tolerant
  try/catch. `duplicateEvent` already copies the source event's tags.
- Manual: "Run rules on all events" button (server action) with result summary.
- Implication pass (inside the auto-tagger): any league/team tag ⇒ also the
  `football` vertical tag; any genre/artist tag ⇒ also the `music` vertical
  tag. Considers existing + newly-matched tags, so the backfill gives every
  league-tagged event its vertical automatically.

### Seeded rules (in the cleanup migration)

One rule per league/team/artist/city tag, e.g. `("Arsenal", name → arsenal)`,
`("London", city → london)`, `("Premier League", name → premier-league)`.
Post-deploy backfill run tags most of the 629 live events automatically.

### UI

- **New page `/tag-rules`** (sidebar under Tags): rules table CRUD (pattern,
  field, tag picker, active toggle) + run-all button. Actions in
  `lib/actions/tag-rule-actions.ts`, every function `requireStaff()`.
- **`/event-tags` manager:** type select on create + edit dialogs, type column,
  filter-by-type chips. `event-taxonomy-select` shows a type badge; inline
  create defaults to `other`.
- **Events table:** "ללא תגיות" quick filter (0 tag links) to hunt untagged.
- **Category screens:** zero-tag amber warning reworded — a category with
  children and no tags is a valid hub, not a mistake.

## 3. Main app — feed (`lib/feed/*`)

One shared label builder used by **both** builders (`metaCatalog.ts` and
`activitiesCatalog.ts`), replacing today's contradictory schemes:

| Label | Value | Fallback |
|---|---|---|
| `custom_label_0` | vertical tag slug | root category name lowercased → CMS name hint |
| `custom_label_1` | league tag slug ∥ genre tag slug | empty |
| `custom_label_2` | team ∥ artist tag slug (first alphabetically if several) | empty |
| `custom_label_3` | city tag slug | `location->>city_iata` lowercased (clean latin; the Hebrew city name doesn't slugify) |
| `custom_label_4` | `available` / `sold_out` (activities feed drops sold-out items entirely, so there it is always `available`) | — |

- `feedData.ts` fetches `event_tags.type` and passes typed tags through
  `getTaxonomyByEvent`.
- `product_type` = category path join (unchanged mechanism — now a real tree:
  "Football > Leagues > Premier League").
- `internal_label`s keep all slugs (junk `item-N` gone after cleanup).
- CSV header sets stay frozen — values change, headers don't.
- `google_product_category` stays hardcoded `499969` (out of scope).

**⚠ Campaign coordination:** live Meta/Google campaigns filtering on current
label values break at deploy — Dor re-points campaign filters immediately
after, then re-runs the feed publish so the storage snapshot
(`feeds/meta-catalog-feed.xml`) is regenerated.

## 4. Main app — nav, /c/, filters

- **Header nav:** remove `.slice(0, 3)` flat links in `getNavCategories`.
  Serve the tree (roots → hubs → leaves); desktop dropdown per root, mobile
  accordion. Roots: כדורגל, הופעות מוזיקה, יעדים.
- **/c/ pages:** nested slugs + child tiles already work. Hub = tiles-only
  page; polish the empty-events state (no "0 events" noise when children
  exist). No `includeDescendants` change — stays `false`.
- **Homepage tiles:** today every active category becomes a tile → the new
  tree would flood the homepage. Fix: tiles = root categories only
  (`parent_id is null`) in `lib/categories.ts`.
- **Faceted filters** (`CategoryEventsBrowser`): replace the ad-hoc 12-chip
  tag logic with structured facets:
  - Derived: month (event date), city (event field), price quartiles
    (existing), hide-sold-out (existing).
  - Tag facets grouped by `type` (league/team/genre/artist), showing only
    types present among the category's events.
  - Package-composition facet skipped — all products are full packages today;
    revisit when ticket-only inventory exists.

## Rollout (each step independently deployable)

1. **Backoffice migrations** (schema + cleanup + reseed + seeded rules) — one
   PR, applied by merging to master (never from a branch).
2. **Backoffice UI + auto-tagger** — deploy, run backfill, manual tag pass for
   whatever rules missed.
3. **Main feed labels** — deploy, Dor re-points campaigns, republish feed.
4. **Main nav + /c/ polish + facets** — deploy, revalidate.

## Risks

- Campaign breakage on label semantics change (coordinated in step 3).
- Feed storage snapshot stale until republished (step 3 includes it).
- ISR: `/c/` pages revalidate 3600s; trigger revalidate after reseed.
- `event_category_links` VIEW is unmaterialized — fine at current scale; noted
  for later if `event_tag_links × category_tags` grows.
- Two dead main-app readers (`getEventsByTag`, `getCategoryTagNames`,
  `getCategoryTree`) — clean up opportunistically in step 4, not load-bearing.

## Out of scope

- Linking tags to the CMS `artists` / `football_teams` template tables.
- `/t/<slug>` tag landing pages.
- `google_product_category` per-vertical mapping.
- F1 / tennis / festivals categories (recreate when inventory exists).
- Materializing the category-links view.
