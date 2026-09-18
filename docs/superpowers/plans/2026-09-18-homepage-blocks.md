# Homepage Free Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can rename every homepage section and add event-slider and banner blocks from the `/homepage` board; myt-main renders them.

**Architecture:** `homepage_sections` gains `page`, `type`, `title`, `config`. A block is a row with a `blk_` key; its pinned events reuse `homepage_items`. All validation is one pure module. Main reads the new columns, falls back to the old select, and ignores what it does not know.

**Tech Stack:** Next.js 15, React 19, Supabase (service role), shadcn/ui, `npx tsx` selftests.

**Spec:** `docs/superpowers/specs/2026-09-18-homepage-blocks-design.md`

## Global Constraints

- Migrations only in `supabase/migrations/`, idempotent, applied by the master workflow - never by hand, never from a branch.
- Version prefix `20260918120000` (newest existing: `20260918100000`). Re-check for a collision right before committing.
- No CHECK constraint on `type`. No spread of client objects into writes. No `any` beyond the file's existing `db` boundary cast.
- shadcn/ui only; native HTML5 drag as the board already does.
- `MAX_BLOCKS = 12`, `MAX_BANNERS = 3`, `TITLE_MAX = 60`, `ROW_MAX = 12`.
- Block key: `/^blk_[0-9a-f]{8}$/`. Page: `"home"`.
- `image_url` must start with `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`; `link_url` starts with `/` (not `//`) or `https://`.
- Another session shares this checkout: stage only the files a task names, never `git add -A`. Commit freely, never push.
- Conventional commits, no AI co-author line.

## File map

Backoffice
- Create `supabase/migrations/20260918120000_homepage_blocks.sql`
- Modify `types/homepage.types.ts` - row/config/block types, `siteTitle` in `SECTION_META`
- Create `lib/homepage/blocks.ts` - pure rules
- Create `scripts/homepage-blocks-selftest.ts`
- Modify `lib/actions/homepage-actions.ts` - read (with fallback) + save
- Modify `app/(dashboard)/homepage/homepage-board.tsx` - title pencil, add/delete block, block bodies
- Create `app/(dashboard)/homepage/homepage-blocks.tsx` - `AddBlockButton`, `SliderSettings`, `BannerEditor`
- Modify `app/(dashboard)/guide/guide-content.ts`, `CLAUDE.md`

Main
- Modify `lib/homepageLayout.ts`, `app/page.tsx`, `components/ClientSideHomepage.tsx`, `components/GoogleReviews*` (title prop), `CLAUDE.md`

---

### Task 1: Schema + types + pure rules (backoffice)

**Interfaces - Produces:**

```ts
// types/homepage.types.ts
export const HOMEPAGE_PAGE = "home";
export const HOMEPAGE_BLOCK_TYPES = ["event_slider", "banner"] as const;
export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];
export type HomepageSectionType = "builtin" | HomepageBlockType;
export type EventSliderConfig = { category_id: number | null };
export type BannerItem = { image_url: string; link_url: string | null; title: string | null };
export type BannerConfig = { banners: BannerItem[] };
export type HomepageSectionConfig = EventSliderConfig | BannerConfig | Record<string, never>;
export interface HomepageSectionRow {
  key: string; type: HomepageSectionType; title: string | null;
  config: HomepageSectionConfig; position: number; is_visible: boolean;
}
export interface HomepageItemRow { section: string; kind: HomepageItemKind; ref_id: string; position: number }
export interface HomepageCategoryOption { id: number; name: string; path: string }
export interface HomepageLayout {
  sections: HomepageSectionRow[]; items: HomepageItemRow[]; candidates: HomepageCandidate[];
  categories: HomepageCategoryOption[];
  /** false = the migration has not run yet: titles and blocks cannot be saved. */
  blocksReady: boolean;
}
// SECTION_META[key].siteTitle: string | null  (null = no heading on the site: hero)

// lib/homepage/blocks.ts
export const MAX_BLOCKS = 12, MAX_BANNERS = 3, TITLE_MAX = 60;
export const newBlockKey: () => string;
export const isBuiltinKey: (k: string) => k is HomepageSectionKey;
export const isBlockKey: (k: string) => boolean;
export const isBlockType: (t: unknown) => t is HomepageBlockType;
export const itemKindsFor: (s: { key: string; type: HomepageSectionType }) => HomepageItemKind[];
export const normalizeTitle: (raw: unknown) => string | null;
export function normalizeSections(
  raw: unknown, opts: { storagePrefix: string },
): { ok: true; sections: HomepageSectionRow[] } | { ok: false; error: string };
```

`normalizeSections` rules: drop duplicate keys; a `builtin` row must carry a builtin key, a block row a block key and a known type (else error naming it); config validated per type (errors: `"<title or key>: <reason>"`); missing builtins appended visible; `hero` forced first; positions renumbered; more than `MAX_BLOCKS` blocks = error; builtin config forced to `{}`.

- [ ] **Step 1: migration**

```sql
-- Homepage free blocks - 2026-09-18. Spec: docs/superpowers/specs/2026-09-18-homepage-blocks-design.md
alter table public.homepage_sections add column if not exists page text;
update public.homepage_sections set page = 'home' where page is null;
alter table public.homepage_sections alter column page set default 'home';
alter table public.homepage_sections alter column page set not null;

alter table public.homepage_sections add column if not exists type text;
update public.homepage_sections set type = 'builtin' where type is null;
alter table public.homepage_sections alter column type set default 'builtin';
alter table public.homepage_sections alter column type set not null;

alter table public.homepage_sections add column if not exists title text;

alter table public.homepage_sections add column if not exists config jsonb;
update public.homepage_sections set config = '{}'::jsonb where config is null;
alter table public.homepage_sections alter column config set default '{}'::jsonb;
alter table public.homepage_sections alter column config set not null;

create index if not exists homepage_sections_page_position_idx
  on public.homepage_sections (page, position);
```

- [ ] **Step 2: selftest first** (`scripts/homepage-blocks-selftest.ts`, plain asserts, exits 1 on failure). Cases: title trim / 60 cap / empty→null; key regex; `itemKindsFor` (builtin newest → event, event_slider → event, banner → none); hero forced first; missing builtins appended; duplicate key dropped; unknown type rejected; block row with builtin key rejected; banner with foreign image host rejected; banner `link_url` `//evil` and `javascript:` rejected, `/c/x` and `https://x` accepted, `""`→null; 0 and 4 banners rejected; `category_id` `"5"`→5, `0`/`-1`/`1.5` rejected, null ok; 13 blocks rejected; builtin config forced `{}`.
- [ ] **Step 3:** run `npx tsx scripts/homepage-blocks-selftest.ts` → fails (module missing).
- [ ] **Step 4:** types + `lib/homepage/blocks.ts` → selftest passes.
- [ ] **Step 5:** commit `feat(homepage): schema and rules for editable titles and free blocks`.

### Task 2: Read + save (backoffice actions)

**Consumes:** Task 1. **Produces:** `getHomepageLayout(): Promise<HomepageLayout>` (new fields), `saveHomepageLayout(input: SaveHomepageLayoutInput)` unchanged signature, `input.sections` rows now carry `type/title/config`.

- [ ] Read: select `key,position,is_visible,page,type,title,config`; on undefined column (`42703` / `PGRST204` / message `column … does not exist`) retry `key,position,is_visible`, `blocksReady = false`. Keep rows with `page === 'home'` (or no page) that are builtin-with-known-key or known-block-type. Categories: `categories` `id,name,slug,parent_id` where `is_active` and not deleted → `path` via the slug chain (reuse `lib/taxonomy-tree.ts`); failure = empty list, logged.
- [ ] Save: `normalizeSections(input.sections, { storagePrefix })`; error → `{ ok:false }` before any write. Items: section must be a saved key, kind ∈ `itemKindsFor`. An upsert that fails on an undefined column returns "run the migration first". Upsert explicit columns. Delete `homepage_sections` where `page='home'` and `type<>'builtin'` and key not in saved. Items delete: `.in("section", [...previousKeys ∪ savedKeys])`. Audit: titles + block types.
- [ ] `tsc --noEmit` clean for the touched files; commit `feat(homepage): board read and save carry titles and blocks`.

### Task 3: Board UI (backoffice)

**Consumes:** Tasks 1-2.

- [ ] `homepage-blocks.tsx`: `AddBlockButton({ onAdd(type), disabled })` (Popover with the two types), `SliderSettings({ config, categories, onChange })` (shadcn `Select`, value `"none"` | id), `BannerEditor({ config, onChange })` (rows of `ImageFilePicker bucketName="templates"` + two `Input`s, add/remove, max 3).
- [ ] Board: `items` state keyed by `string`; title pencil → `Input` (placeholder `SECTION_META.siteTitle` / "כותרת (לא חובה)"), hidden for hero and when `!blocksReady`; `AddBlockButton` rendered after every section; block header shows type badge + trash; body by type (`ItemStrip` with `kinds=["event"]` + `SliderSettings`, or `BannerEditor`). `ItemStrip` takes `label: string` instead of reading `SECTION_META` by key.
- [ ] Guide (`homepage` section, EN + HE) and `CLAUDE.md` homepage block.
- [ ] `tsc --noEmit`; commit `feat(homepage): rename sections and add slider / banner blocks on the board`.

### Task 4: Main app

**Produces:**

```ts
// lib/homepageLayout.ts
export type HomepageSection = { key: string; type: HomepageSectionType; title: string | null; visible: boolean; config: HomepageSectionConfig };
export type HomepageLayout = { sections: HomepageSection[]; pins: Record<string, HomepagePin[]> };
export type HomepageClientLayout = {
  sections: HomepageSection[];
  pinnedEventIds: { most_wanted: number[]; newest: number[] };
  /** Per event_slider block: pinned ids (board order) + category ids (soonest first). */
  blockEvents: Record<string, { pinned: number[]; auto: number[] }>;
};
export async function resolveBlockEvents(layout: HomepageLayout, events: { id: number; date: string }[]): Promise<HomepageClientLayout["blockEvents"]>;
export function toClientLayout(layout: HomepageLayout, blockEvents: HomepageClientLayout["blockEvents"]): HomepageClientLayout;
```

- [ ] `getHomepageLayout`: new select, old-select retry, filtering as in the spec; `pins` keyed by string (builtin keys pre-seeded empty so existing reads stay total).
- [ ] `app/page.tsx`: `resolveBlockEvents` (one `getEventIdsByCategories` for all slider categories, wrapped - a failure yields pins only).
- [ ] `ClientSideHomepage`: loop over section objects; builtin switch uses `s.title ?? "<coded>"`; `event_slider` = pinned via `pickPinned` + `filterEventsFromArtistsWithPages(auto)` to `ROW_MAX`, same `<section>` markup and `UniversalCarousel variant="row"`; `banner` = optional `SectionHeading` + `ArtistBanners`; unknown → null. `GoogleReviews` accepts optional `title`.
- [ ] `tsc --noEmit`; `CLAUDE.md`; commit `feat(homepage): section titles and free blocks from the backoffice board`.

### Task 5: Verify

- [ ] Selftest green, `tsc` both repos, local dev of the board against prod DB shows the pre-migration fallback (no pencil, no add, order intact), main homepage unchanged locally.
- [ ] Report: commits are local; backoffice must be pushed before main; post-push prod checklist from the spec.
