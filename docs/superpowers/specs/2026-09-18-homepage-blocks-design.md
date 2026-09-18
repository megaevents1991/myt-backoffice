# Homepage free blocks - design

Date: 2026-09-18 · Status: approved by Dor (chat, 18.09) · Brief:
`docs/superpowers/briefs/2026-09-17-homepage-blocks-brief.html`

## What was asked

Team doc "באגים / תיקונים", tab "סליידרים הום פייג", notes 4-5:

> 4. אפשרות לערוך כותרת
> 5. אפשרות להוסיף סליידר / טקסט / סליידר יעדים / גלריית תמונות / באנרים ( + )
> זה בגדול מאפשר גמישות בהמשך למגה שתצטרף שתוכל לסדר את העמודים שלה איך שהיא
> רוצה עם ובלי אוטמציות ( CMS ).

The last sentence is the direction: not one more homepage feature but a layer
another brand can later build its own pages on.

## Decisions (Dor, 18.09)

| Question | Decision |
| --- | --- |
| Scope | Page-aware data model (`page` on every row), UI for the homepage only |
| Title editing | Every section - the six existing titled ones and new blocks. Title only, no subtitle / link |
| Phase 1 | Infrastructure + titles + **event slider** + **banner** |
| Phase 2 | Text, destinations slider, image gallery - same tables, no migration |
| Permissions | All staff, as the board is today |
| Draft / preview | None. Save publishes; the eye switch hides |
| Banner | One image + link + alt title per banner, 1-3 per block. No separate mobile image |

## Data model

One table keeps owning the page order. `homepage_sections` gains four columns
(migration `20260918120000_homepage_blocks.sql`, idempotent, nullable → backfill
→ default + not null):

| Column | Type | Meaning |
| --- | --- | --- |
| `page` | text, default `'home'` | Which page the row belongs to. Only `home` exists today |
| `type` | text, default `'builtin'` | `builtin` = one of the seven coded sections; otherwise a block type |
| `title` | text, null | Staff title. Null = the title in code (builtin) or no heading (block) |
| `config` | jsonb, default `{}` | Per-type settings, validated in the backoffice |

- `key` stays the primary key and stays globally unique: builtin keys are the
  seven known strings, a block's key is `blk_` + 8 random hex chars, minted in
  the board. A future page gets its own keys; nothing needs a composite key.
- No CHECK on `type`: phase 2 adds types without a migration, and an unknown
  type must never turn into a failed write. Validation lives in
  `lib/homepage/blocks.ts`.
- `homepage_items` is unchanged. A block's pinned events are rows with
  `section = <block key>`, `kind = 'event'` - the same strip, picker and drag the
  builtin rows use.
- Index `(page, position)`.

Rejected: a separate `page_blocks` table (two sources for one order) and
renaming the table to something generic (breaks main mid-deploy).

### Block types, phase 1

`event_slider` - `config: { category_id: number | null }`.
Pinned events first (board order), then - when a category is chosen - that
category's live events, soonest first, one card per artist/team page the way the
builtin rows collapse them, 12 cards max (`ROW_MAX`). Pinned only = manual
slider; category only = automatic; both = the builtin rows' model. Rendered with
the same `UniversalCarousel variant="row"` → `EventCard size="row"` as
"המבוקשים ביותר". An empty result renders nothing.

`banner` - `config: { banners: { image_url, link_url | null, title | null }[] }`,
1-3 entries. Rendered by main's existing `ArtistBanners` (lazy images). The
section title, when set, is a `SectionHeading` above it.

### Validation (server, `normalizeSection` in `lib/homepage/blocks.ts`, pure)

- `title`: trimmed, max 60 chars, empty → null.
- `image_url`: must start with `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`
  - only our own Storage (it is also the only host main's `next/image` allows).
- `link_url`: starts with `/` (not `//`) or `https://`; empty → null.
- `category_id`: positive integer or null. Existence is not checked at save -
  a category deleted later simply yields no automatic events.
- At most 12 blocks per page (`MAX_BLOCKS`), 3 banners per block.
- A block of an unknown type, or whose config does not validate, is rejected
  with a message naming the block - the save writes nothing.
- Every column is mapped explicitly; nothing from the client is spread into a
  write.

## Backoffice

- `types/homepage.types.ts`: builtin keys stay `as const`; rows become
  `{ key: string; type; title; config; position; is_visible }`. jsonb shapes are
  `type` aliases.
- `lib/homepage/blocks.ts` (pure, no DB): constants, `newBlockKey`,
  `normalizeSection`, `itemKindsFor(section)`. `scripts/homepage-blocks-selftest.ts`
  covers it (`npx tsx`), like the other selftests.
- `getHomepageLayout`: selects the new columns; on "column does not exist"
  (deploy landed before the migration) it retries the old select and the board
  shows builtins only - same tolerance the board already has for a missing table.
  Also returns the active categories (id, name, `/c/` path) for the slider's picker.
- `saveHomepageLayout`: upserts every row of the page, deletes block rows of the
  page that the board no longer has, replaces the item lists of every key it
  knew before or knows now. Builtin rows can never be deleted; `hero` stays first.
  Audit row carries titles and block types.
- Board (`homepage-board.tsx`, block editors in `homepage-blocks.tsx`):
  - pencil next to every title → inline input; placeholder = the default title;
    clearing it restores the default. Hero has no site title, so no pencil.
  - "+ Add block" between any two sections (never above hero): pick a type, the
    block appears in place, hidden rows and drag work as for any section.
  - event slider: the existing `ItemStrip` (events) + a category select
    ("no automatic fill" / a category). Auto cards preview is not computed for
    blocks in phase 1 - the strip shows pins, the select states the rule.
  - banner: up to three rows of `ImageFilePicker` (bucket `templates`) + link +
    title.
  - trash button on blocks only, takes effect on Save.
- `/guide` homepage section and `CLAUDE.md` updated in the same change.

## Main app

- `lib/homepageLayout.ts`: sections become
  `{ key, type, title, visible, config }`, pins `Record<string, HomepagePin[]>`.
  Reads the new columns and falls back to the old select on an undefined-column
  error, so main deployed before the migration keeps the saved order. Rows kept:
  `page = 'home'` and (`builtin` with a known key, or a known block type).
  Anything else is skipped silently. Total failure → default layout, as today.
- `app/page.tsx`: for the visible event sliders, one `getEventIdsByCategories`
  call for all their categories; the ordered event-id list per block is computed
  server-side and passed in the client layout.
- `ClientSideHomepage.tsx`: the section loop switches on `type`. Builtins read
  `title ?? <coded title>`. `event_slider` and `banner` render as above.
  An unknown type returns null.
- Types mirrored from the backoffice file (keys + block types + config shapes).

## Rollout

1. Backoffice first: merge to master → migration applies → board can save
   blocks. The main app in production ignores unknown keys, so nothing changes
   on the site yet.
2. Main second: titles and blocks appear.

Either order is safe (both sides retry the old select), this one just has no
dead time.

## Testing

- `scripts/homepage-blocks-selftest.ts` - validation and key rules.
- `tsc --noEmit` in both repos.
- The columns do not exist until the migration runs from master, so before the
  push only the fallback path can be exercised locally. After the push: add a
  banner and a slider on the prod board, check the site, check an emptied title
  returns to its default, delete a block.

## Out of scope

Text / destinations / gallery blocks (phase 2); pages other than the homepage
and any page-builder UI; per-block scheduling; draft/preview; a mobile banner
image; changes to the automatic rules of the builtin rows, to pricing or to
`events`.
