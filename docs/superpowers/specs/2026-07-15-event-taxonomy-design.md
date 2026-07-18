# Event Taxonomy (Category Tree) + Feed Tags — Design

**Date:** 2026-07-15
**Project:** myt-backoffice (writes) → myt-main (reads)
**Status:** Approved design, pending implementation plan

## Problem

Events have no real categorization. The existing `events.tags` column is a
single-value **display badge** (Sold / Popular / VIP) — not a taxonomy. The
existing `categories` table is a flat CMS **marketing-card** type (homepage
cards + `/category/[slug]`) with no hierarchy and no event linkage.

We need two independent capabilities:

1. **Category tree** — hierarchical taxonomy (כדורגל → ליגה אנגלית → …,
   מוזיקה → פופ → …) so the main app can build any page and navigate up/down
   the tree (Shopify-style). An event can belong to multiple branches
   (a match + a concert on the same trip).
2. **Feed/promo tags** — a curated flat pool for product-feed targeting
   ("promote כדורגל בליגה האנגלית to fans of that").

Both must be assignable per-event and in bulk (first job: tag all current live
events), via multi-select — same UX as the existing skip-flight / markup bulk
actions.

## Decisions (locked)

- **Two separate systems**: a hierarchical category tree AND a flat tag pool.
- **Event→tree attachment**: multi-node, at any depth, with **ancestors
  inferred at query time** (assign the deepest node; parent pages include it
  automatically). Junction stores only directly-assigned nodes.
- **Tags**: curated pool (managed list, multi-assign) — not free-typing, to
  keep the feed clean.
- **Table structure — Approach A**: new dedicated taxonomy tables. Leave the
  existing `categories` marketing-card table and the legacy `events.tags` badge
  **untouched** (zero risk to live main-app reads).
- **Traversal**: in-memory. Fetch all active nodes once, build the tree in JS.
  No recursive SQL / RPC (tree is small).
- **Seeding**: none. Migration creates empty tables; all nodes built in the UI.

## Data Model — 4 new tables

### `event_categories` (the tree)
```
id             bigint generated always as identity primary key
parent_id      bigint references event_categories(id)   -- null = root node
slug           text not null unique
name           text not null            -- Hebrew display name
name_english   text
image_url      text                     -- optional hero/card image
description    text
display_order  integer not null default 0
is_active      boolean not null default true
is_deleted     boolean not null default false
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```
Indexes: `parent_id`, `slug`, `(is_active) where is_deleted = false`,
`display_order`.

Guard: prevent an event_category from being its own ancestor (no cycles) —
enforced in the server action (a node's parent cannot be itself or one of its
descendants).

### `event_category_links` (event ↔ node, many-to-many)
```
event_id     bigint not null references events(id) on delete cascade
category_id  bigint not null references event_categories(id) on delete cascade
primary key (event_id, category_id)
```
Stores **only directly-assigned nodes**. Ancestors are inferred at read time —
never denormalized here.

### `event_tags` (curated flat pool)
```
id             bigint generated always as identity primary key
slug           text not null unique
name           text not null
name_english   text
is_active      boolean not null default true
is_deleted     boolean not null default false
created_at     timestamptz not null default now()
updated_at     timestamptz not null default now()
```

### `event_tag_links` (event ↔ tag)
```
event_id  bigint not null references events(id) on delete cascade
tag_id    bigint not null references event_tags(id) on delete cascade
primary key (event_id, tag_id)
```

## Backoffice UI

### Taxonomy manager (new page, under תבניות / Templates)
Tree view of `event_categories`: add / edit / delete (soft) / reorder nodes,
assign a parent (dropdown of eligible nodes — excludes self + descendants).
shadcn primitives, no new UI lib.

### Tags manager (new page)
Simple curated CRUD list for `event_tags` (add / edit / soft-delete).

### Reusable combobox — `EventTaxonomySelect` (Shopify-style)
A single shared multi-select component used in the event editor, the new-event
flow, and the bulk dialogs. Behavior:
- Searchable multi-select seeded from the **managed pool** ("the enum we already
  have") — all active categories (path-labelled, e.g. "כדורגל › ליגה אנגלית")
  or all active tags.
- **Inline create**: typing a value with no match shows "Create 'X'" — creating
  it via `createCategory` / `createTag` and immediately selecting it, without
  leaving the form (Shopify pattern). For a new category, the create affordance
  lets you pick a parent (defaults to root).
- Built on existing shadcn primitives (Command / Popover) — no new UI lib.

### Event editor (`app/(dashboard)/events/[id]/page.tsx`) + new-event flow
Both the **edit** page and the **create-new-event** flow get two
`EventTaxonomySelect` fields — **Categories** and **Tags** — with the same
inline-create behavior. Saved to the junction tables (not columns on `events`);
on create, links are written after the event row is inserted (needs the new id).
Legacy `tags` badge dropdown stays exactly as-is.

### Bulk assign (`app/(dashboard)/events/events-table.tsx`)
With rows selected → "Assign categories" and "Assign tags" dialog actions,
mirroring the existing `handleBulkUpdate` / skip-flight pattern. Each dialog
uses the same `EventTaxonomySelect` (inline-create available) + a mode toggle
**add** (append) vs **replace**. Covers "tag all current live events": filter to
live events → select all → Assign → add.

### Server actions — `lib/actions/event-taxonomy-actions.ts`
- Tree CRUD: `getCategoryTree`, `createCategory`, `updateCategory`,
  `softDeleteCategory`, `reorderCategories` (columns mapped explicitly).
- Category links: `setEventCategories(eventId, categoryIds)`,
  `bulkAssignCategories(eventIds, categoryIds, mode)`.
- Tag CRUD: `getTags`, `createTag`, `updateTag`, `softDeleteTag`.
- Tag links: `setEventTags(eventId, tagIds)`,
  `bulkAssignTags(eventIds, tagIds, mode)`.
All server-side (service-role client), `{ data, error }` checked, soft-delete
only, no whole-object spreads.

## Main App Consumption — new `lib/taxonomy.ts`

- `getCategoryTree()` — all active nodes → nested tree (in-memory build).
- `getCategoryBySlug(slug)` — single node.
- `getAncestors(node)` — walk `parent_id` up → breadcrumbs.
- `getEventsInCategory(slug, { includeDescendants })` — resolve node +
  descendant ids in JS → one query on `event_category_links`.
- `getEventsByTag(slug)` — feed/promo targeting via `event_tag_links`.
- Enables a dynamic `/c/[...slug]` catch-all page rendering any node.

## Types + Cross-Project

- New `types/taxonomy.types.ts` (backoffice): `EventCategory`
  (`children?: EventCategory[]` for the built tree), `EventTag`, link row types.
- Mirror to main `lib/taxonomy.types.ts`; add to the `/sync-types` list.
- **New shared tables** → document in `CLAUDE.md` (shared-tables table +
  cross-project rule): backoffice writes `event_categories`,
  `event_category_links`, `event_tags`, `event_tag_links`; main reads them.
- Migration: `npm run db:new event_taxonomy` → 4 tables + indexes; then
  `npm run db:types` to regenerate `types/database.types.ts`.

## Non-Goals (YAGNI)

- No change to legacy `events.tags` badge, existing `categories` cards, or
  pricing.
- No free-typing tags (curated only).
- No denormalized ancestor storage, no recursive SQL, no seed data.
- Skip-flight and other event flags unaffected.

## Rollout / First Task

1. Ship migration + types + UI.
2. In the taxonomy manager, build roots (כדורגל, מוזיקה, …) + needed sub-nodes.
3. In the tags manager, create the feed tags.
4. On the events table, filter to live events, select all, bulk-assign
   categories + tags (mode: add).
5. Wire main `lib/taxonomy.ts` + a `/c/[...slug]` page + feed targeting.
