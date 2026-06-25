# Template Blob Card-Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 4 backoffice CMS templates (artists, football teams, categories, blog) the same blob card-art option events have, and render it on myt-main.

**Architecture:** Reuse the two existing global components — `ArtBlobPicker` (backoffice editor) and `EventArt` (myt-main renderer). Add 3 nullable `art_*` columns per template table, plumb them through types → server actions → forms (backoffice) and types → readers → cards (myt-main). Blob is additive: when `art_image_url` is unset, every surface falls back to its current plain-image render (the rollback path).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service-role), Tailwind, shadcn/ui, react-hook-form + zod (backoffice forms).

## Global Constraints

- **No test runner exists.** The type gate is `npx tsc --noEmit` per repo (build ignores TS errors; don't rely on `yarn build`). Each task's "verify" step runs `tsc`.
- **Two repos.** Backoffice: `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-backoffice`. Main: `…\myt-main`.
- **Columns are additive + nullable** — never required; existing reads/writes must keep working.
- **3 columns, exact names:** `art_image_url` (text), `art_color_index` (int), `art_shape_index` (int). Match events parity. No jsonb.
- **Shared types kept in sync:** backoffice template types ↔ myt-main `lib/app.types.ts`. Run `/sync-types` mentally after type edits.
- **Supabase rule:** map insert/update columns explicitly — never spread a whole request object.
- **Tables:** `artists`, `football_teams`, `categories`, `blog_posts`. Public bucket `art_blobs` already exists — reuse, no new bucket.
- **Commits:** Dor reviews then commits. Each task ends with a commit step as a checkpoint; the executor stages but pauses for Dor per the no-auto-commit rule.
- **Rollback / fallback (explicit per Dor):** every myt-main render switches to blob art ONLY when `art_image_url` is set; otherwise it renders exactly as today.

---

## Task 1: Migration — add art_* columns to the 4 template tables

**Files:**
- Create: `db/migrations/2026-06-24-add-template-blob-art.sql` (backoffice)

**Interfaces:**
- Produces: columns `art_image_url text`, `art_color_index int`, `art_shape_index int` on `artists`, `football_teams`, `categories`, `blog_posts` (all nullable).

- [ ] **Step 1: Write the migration SQL**

```sql
-- 2026-06-24 — Blob card-art for CMS templates (artists, football_teams,
-- categories, blog_posts). Mirrors the events art_* columns. All nullable:
-- when art_image_url is null the site falls back to the plain image_url.
alter table public.artists
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

alter table public.football_teams
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

alter table public.categories
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;

alter table public.blog_posts
  add column if not exists art_image_url   text,
  add column if not exists art_color_index integer,
  add column if not exists art_shape_index integer;
```

- [ ] **Step 2: Apply the migration**

Run it against Supabase (SQL editor or the project's usual migration path — same as `db/migrations/2026-06-17-add-artist-team-extras.sql` was applied).
Expected: 4 `ALTER TABLE` succeed; re-running is a no-op (`if not exists`).

- [ ] **Step 3: Verify columns exist**

In the Supabase SQL editor:
```sql
select table_name, column_name
from information_schema.columns
where column_name in ('art_image_url','art_color_index','art_shape_index')
order by table_name;
```
Expected: 12 rows (3 columns × 4 tables).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-06-24-add-template-blob-art.sql
git commit -m "feat(templates): add art_* blob columns to template tables"
```

---

## Task 2: Backoffice types — add art_* to the template types

**Files:**
- Modify: `types/template.types.ts` (backoffice) — adds fields to `TemplateBase` (covers `Category`)
- Modify: `types/person.types.ts` — `Person` (artists + football_teams)
- Modify: `types/blog.types.ts` — `BlogPost`

**Interfaces:**
- Produces: `art_image_url: string | null`, `art_color_index: number | null`, `art_shape_index: number | null` on `Category` (via `TemplateBase`), `Person`, `BlogPost`. `CreatePersonData`/`CreateBlogData`/`CreateCategoryData` pick them up automatically (they `Omit` only server-managed columns).

- [ ] **Step 1: Add fields to `TemplateBase`**

In `types/template.types.ts`, inside `interface TemplateBase`, after `image_url: string | null;`:
```ts
  // Blob card-art (optional). When art_image_url is set the site shows the
  // cut-out over a neon blob; otherwise it falls back to image_url.
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
```

- [ ] **Step 2: Add fields to `Person`**

In `types/person.types.ts`, inside `interface Person`, after `image_height: number | null;`:
```ts
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
```

- [ ] **Step 3: Add fields to `BlogPost`**

In `types/blog.types.ts`, inside `interface BlogPost`, after `image_height: number | null;`:
```ts
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
```

- [ ] **Step 4: Verify types compile**

Run (backoffice root): `npx tsc --noEmit`
Expected: no NEW errors referencing these files. (Server actions still compile — extra optional columns don't break existing `.insert`/`.update` maps yet.)

- [ ] **Step 5: Commit**

```bash
git add types/template.types.ts types/person.types.ts types/blog.types.ts
git commit -m "feat(templates): art_* fields on template types"
```

---

## Task 3: ArtBlobPicker — optional label prop

**Files:**
- Modify: `components/art-blob-picker.tsx` (backoffice)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ArtBlobPicker` now accepts optional `label?: string` (default `"Card art — cut-out + blob"`). All existing call sites (events page) keep working unchanged.

- [ ] **Step 1: Add the prop**

In the `ArtBlobPicker` props destructure + type (around line 63), add `label`:
```ts
export function ArtBlobPicker({
  imageUrl,
  colorIndex,
  shapeIndex,
  label = "Card art — cut-out + blob",
  onImage,
  onColor,
  onShape,
}: {
  imageUrl?: string | null;
  colorIndex?: number | null;
  shapeIndex?: number | null;
  label?: string;
  onImage: (url: string) => void;
  onColor: (i: number) => void;
  onShape: (i: number) => void;
}) {
```

- [ ] **Step 2: Use it in the first Label**

Replace the hardcoded `<Label>Card art — cut-out + blob</Label>` (line ~121) with:
```tsx
      <Label>{label}</Label>
```

- [ ] **Step 3: Verify**

Run (backoffice): `npx tsc --noEmit`
Expected: no new errors; events page unaffected (uses default).

- [ ] **Step 4: Commit**

```bash
git add components/art-blob-picker.tsx
git commit -m "feat(art-blob-picker): optional label prop for reuse"
```

---

## Task 4: PersonForm — blob picker for artists + football, persisted via actions

**Files:**
- Modify: `components/templates/PersonForm.tsx` (backoffice)

**Interfaces:**
- Consumes: `ArtBlobPicker` (Task 3), `Person` art fields (Task 2).
- Produces: PersonForm renders the picker and includes `art_image_url/art_color_index/art_shape_index` in the create/update payload. Works for both `kind` values (artists, football_teams) since both go through `a.create`/`a.update` which take the same payload shape.

- [ ] **Step 1: Import the picker**

At the top of `PersonForm.tsx`, with the other component imports:
```ts
import { ArtBlobPicker } from "@/components/art-blob-picker";
```

- [ ] **Step 2: Add local state for the 3 art values**

Below `const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");`:
```ts
  const [artImageUrl, setArtImageUrl] = useState(initial?.art_image_url ?? "");
  const [artColorIndex, setArtColorIndex] = useState(initial?.art_color_index ?? 0);
  const [artShapeIndex, setArtShapeIndex] = useState(initial?.art_shape_index ?? 0);
```

- [ ] **Step 3: Render the picker after the Hero image block**

After the closing `</div>` of the `Hero image` block (the `<div className="space-y-2">` ending ~line 236), insert:
```tsx
        <div className="rounded-lg border p-4">
          <ArtBlobPicker
            label="Card art — cut-out + blob (optional)"
            imageUrl={artImageUrl}
            colorIndex={artColorIndex}
            shapeIndex={artShapeIndex}
            onImage={setArtImageUrl}
            onColor={setArtColorIndex}
            onShape={setArtShapeIndex}
          />
        </div>
```

- [ ] **Step 4: Add the 3 fields to the submit payload**

In `onSubmit`, inside the `payload` object, after `image_height: initial?.image_height ?? null,`:
```ts
          art_image_url: artImageUrl || null,
          art_color_index: artImageUrl ? artColorIndex : null,
          art_shape_index: artImageUrl ? artShapeIndex : null,
```

- [ ] **Step 5: Confirm the actions pass these through**

Open `lib/actions/artist-actions.ts` and `lib/actions/football-actions.ts`. Confirm `createArtist`/`updateArtist` (and football equivalents) build their Supabase `.insert(...)`/`.update(...)` from an explicit column map. If they map columns explicitly (not spread), add the 3 columns to each map:
```ts
    art_image_url: data.art_image_url ?? null,
    art_color_index: data.art_color_index ?? null,
    art_shape_index: data.art_shape_index ?? null,
```
If they already spread the typed `CreatePersonData`/`UpdatePersonData` (which now includes the fields from Task 2), no action change is needed — note which case applies in the commit message.

- [ ] **Step 6: Verify types**

Run (backoffice): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual smoke test**

`yarn dev` → open `/templates/artists/<id>/edit` → "Upload + cut out" an image → pick a colour + shape → Save → reopen the page. Expected: preview shows cut-out on the blob; values persist on reload. Repeat once on `/templates/football/<id>/edit`.

- [ ] **Step 8: Commit**

```bash
git add components/templates/PersonForm.tsx lib/actions/artist-actions.ts lib/actions/football-actions.ts
git commit -m "feat(templates): blob card-art picker for artists + teams"
```

---

## Task 5: BlogForm — blob picker, persisted via blog actions

**Files:**
- Modify: `components/templates/BlogForm.tsx` (backoffice)

**Interfaces:**
- Consumes: `ArtBlobPicker` (Task 3), `BlogPost` art fields (Task 2).
- Produces: BlogForm renders the picker and includes the 3 art fields in its payload.

- [ ] **Step 1: Import the picker**

```ts
import { ArtBlobPicker } from "@/components/art-blob-picker";
```

- [ ] **Step 2: Add state**

Below `const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");`:
```ts
  const [artImageUrl, setArtImageUrl] = useState(initial?.art_image_url ?? "");
  const [artColorIndex, setArtColorIndex] = useState(initial?.art_color_index ?? 0);
  const [artShapeIndex, setArtShapeIndex] = useState(initial?.art_shape_index ?? 0);
```

- [ ] **Step 3: Render after the Hero image block (~line 169)**

```tsx
        <div className="rounded-lg border p-4">
          <ArtBlobPicker
            label="Post art — cut-out + blob (optional)"
            imageUrl={artImageUrl}
            colorIndex={artColorIndex}
            shapeIndex={artShapeIndex}
            onImage={setArtImageUrl}
            onColor={setArtColorIndex}
            onShape={setArtShapeIndex}
          />
        </div>
```

- [ ] **Step 4: Add to payload (after `image_height:` line)**

```ts
          art_image_url: artImageUrl || null,
          art_color_index: artImageUrl ? artColorIndex : null,
          art_shape_index: artImageUrl ? artShapeIndex : null,
```

- [ ] **Step 5: Confirm `lib/actions/blog-actions.ts` passes them**

Same check as Task 4 Step 5 — explicit map → add the 3 columns; typed spread → no change.

- [ ] **Step 6: Verify**

Run (backoffice): `npx tsc --noEmit`. Then `yarn dev` → `/templates/blog/<id>/edit` → upload + cut out → save → reload → persists.

- [ ] **Step 7: Commit**

```bash
git add components/templates/BlogForm.tsx lib/actions/blog-actions.ts
git commit -m "feat(templates): blob card-art picker for blog posts"
```

---

## Task 6: Categories forms — blob picker (new + edit), persisted via category actions

**Files:**
- Modify: `app/(dashboard)/templates/categories/[id]/edit/page.tsx` (backoffice)
- Modify: `app/(dashboard)/templates/categories/new/page.tsx` (backoffice)

**Interfaces:**
- Consumes: `ArtBlobPicker` (Task 3), `Category` art fields (Task 2 via `TemplateBase`).
- Produces: both category forms render the picker and pass the 3 art fields to `updateCategory`/`createCategory`.

- [ ] **Step 1: Edit page — import + state**

In `…/categories/[id]/edit/page.tsx`, add import:
```ts
import { ArtBlobPicker } from "@/components/art-blob-picker";
```
Add state below `const [imageUrl, setImageUrl] = useState("");`:
```ts
  const [artImageUrl, setArtImageUrl] = useState("");
  const [artColorIndex, setArtColorIndex] = useState(0);
  const [artShapeIndex, setArtShapeIndex] = useState(0);
```

- [ ] **Step 2: Edit page — hydrate from the loaded category**

In the `getCategory(...).then((c) => { … })` block, after `setImageUrl(c.image_url ?? "");`:
```ts
        setArtImageUrl(c.art_image_url ?? "");
        setArtColorIndex(c.art_color_index ?? 0);
        setArtShapeIndex(c.art_shape_index ?? 0);
```

- [ ] **Step 3: Edit page — render after the Banner image block (~line 217)**

```tsx
          <div className="rounded-lg border p-4">
            <ArtBlobPicker
              label="Card art — cut-out + blob (optional)"
              imageUrl={artImageUrl}
              colorIndex={artColorIndex}
              shapeIndex={artShapeIndex}
              onImage={setArtImageUrl}
              onColor={setArtColorIndex}
              onShape={setArtShapeIndex}
            />
          </div>
```

- [ ] **Step 4: Edit page — add to `updateCategory` payload**

In `onSubmit`, inside the `updateCategory(templateId, { … })` object, after `image_url: imageUrl || null,`:
```ts
          art_image_url: artImageUrl || null,
          art_color_index: artImageUrl ? artColorIndex : null,
          art_shape_index: artImageUrl ? artShapeIndex : null,
```

- [ ] **Step 5: New page — same wiring**

Apply Steps 1, 3, 4 to `…/categories/new/page.tsx` (no hydrate step — new starts empty; state defaults `""`/`0`/`0`). Insert the picker after its banner-image block and add the 3 fields to its `createCategory({ … })` payload after `image_url`.

- [ ] **Step 6: Confirm `lib/actions/category-actions.ts` passes them**

Same check as Task 4 Step 5 — explicit column map → add the 3 columns; typed spread of `CreateCategoryData`/`UpdateCategoryData` → no change.

- [ ] **Step 7: Verify**

Run (backoffice): `npx tsc --noEmit`. Then `yarn dev` → create a category with blob art + edit an existing one → save → reload → persists.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/templates/categories/[id]/edit/page.tsx" "app/(dashboard)/templates/categories/new/page.tsx" lib/actions/category-actions.ts
git commit -m "feat(templates): blob card-art picker for categories"
```

---

## Task 7: myt-main types — carry art_* into the runtime shapes

**Files:**
- Modify: `lib/app.types.ts` (myt-main) — `TemplateBase` (covers `Category`), and the `fields` of `Artist` + `FootballTeam`
- Modify: `lib/blog.ts` (myt-main) — `BlogPost.fields`

**Interfaces:**
- Produces:
  - `TemplateBase` gains `art_image_url: string | null; art_color_index: number | null; art_shape_index: number | null;` → `Category` rows carry them (read via `select('*')`).
  - `Artist["fields"]` and `FootballTeam["fields"]` gain optional `artImageUrl?: string; artColorIndex?: number; artShapeIndex?: number;`.
  - `BlogPost["fields"]` gains the same three optional camelCase fields.
- Consumes: nothing.

- [ ] **Step 1: `TemplateBase` (myt-main `lib/app.types.ts`, ~line 389)**

After `image_url: string | null;`:
```ts
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
```

- [ ] **Step 2: `Artist["fields"]` and `FootballTeam["fields"]`**

In both `Artist` and `FootballTeam` (lib/app.types.ts ~line 490 and ~535), inside `fields`, after `metaTags?: string;`:
```ts
    // Blob card-art (Supabase art_* columns; absent on Contentful-fallback rows).
    artImageUrl?: string;
    artColorIndex?: number;
    artShapeIndex?: number;
```

- [ ] **Step 3: `BlogPost["fields"]` (myt-main `lib/blog.ts`, ~line 24)**

After `metaTags?: string;`:
```ts
    artImageUrl?: string;
    artColorIndex?: number;
    artShapeIndex?: number;
```

- [ ] **Step 4: Verify**

Run (myt-main root): `npx tsc --noEmit`
Expected: no new errors (fields optional / additive).

- [ ] **Step 5: Commit**

```bash
git add lib/app.types.ts lib/blog.ts
git commit -m "feat(templates): art_* fields on myt-main runtime types"
```

---

## Task 8: myt-main readers — map the art_* columns

**Files:**
- Modify: `lib/cms/people.ts` (myt-main) — `PersonRow` + `toPerson`
- Modify: `lib/blog.ts` (myt-main) — `BlogRow` + its row→post mapper
- Modify: `lib/categories.ts` (myt-main) — no mapper (returns raw rows), but confirm `select('*')` already brings the columns

**Interfaces:**
- Consumes: types from Task 7.
- Produces: readers populate `artImageUrl/artColorIndex/artShapeIndex` (people, blog) so cards can read them. Categories already carry snake_case `art_*` on the raw `Category` row.

- [ ] **Step 1: `PersonRow` (lib/cms/people.ts ~line 16) — add raw columns**

After `featured_order: number | null;`:
```ts
  art_image_url?: string | null;
  art_color_index?: number | null;
  art_shape_index?: number | null;
```

- [ ] **Step 2: `toPerson` mapper (~line 44) — map into `fields`**

After `videos: r.videos?.length ? r.videos : undefined,`:
```ts
    artImageUrl: r.art_image_url ?? undefined,
    artColorIndex: r.art_color_index ?? undefined,
    artShapeIndex: r.art_shape_index ?? undefined,
```
(The Contentful fallback `cfToPerson` leaves these undefined — correct; CF rows have no blob art.)

- [ ] **Step 3: `BlogRow` + blog mapper (lib/blog.ts)**

Add to `BlogRow` (after `image_height`):
```ts
  art_image_url: string | null;
  art_color_index: number | null;
  art_shape_index: number | null;
```
In the row→`BlogPost` mapper (the `toBlog`/`rowToPost` function that builds `{ sys, fields }`), add to `fields` after `metaTags`:
```ts
    artImageUrl: r.art_image_url ?? undefined,
    artColorIndex: r.art_color_index ?? undefined,
    artShapeIndex: r.art_shape_index ?? undefined,
```

- [ ] **Step 4: Categories — confirm only**

`lib/categories.ts` uses `.select("*")` and casts to `Category`. No change needed; the new columns arrive automatically and `Category` (Task 7) types them.

- [ ] **Step 5: Verify**

Run (myt-main): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/cms/people.ts lib/blog.ts
git commit -m "feat(templates): readers map art_* blob columns"
```

---

## Task 9: myt-main cards — render EventArt when blob art is set (else fall back)

**Files:**
- Modify: `components/CatalogPageTemplate.tsx` (`CatalogItem` + card render) — artists/football catalog
- Modify: `app/artists/page.tsx` + `app/football/page.tsx` — pass art fields into `CatalogItem`
- Modify: `components/CategoryCard.tsx` + `components/CategorySection.tsx` (`HomeCategory`) + `app/page.tsx` (`getCategories` mapper) — homepage category cards
- Modify: `app/blog/page.tsx` — blog list card

**Interfaces:**
- Consumes: `EventArt` from `@/components/ui/EventArt`; art fields from Tasks 7–8.
- Produces: each card shows `<EventArt variant="blob">` when its `art_image_url` is set, otherwise the existing `<Image>`/placeholder (the fallback path).

- [ ] **Step 1: `CatalogItem` gains art fields (CatalogPageTemplate.tsx ~line 6)**

```ts
export type CatalogItem = {
  id: string;
  name: string;
  imageUrl?: string;
  previewText?: string;
  artImageUrl?: string;
  artColorIndex?: number;
  artShapeIndex?: number;
};
```

- [ ] **Step 2: Render EventArt in the catalog card**

Add import at top: `import { EventArt } from "@/components/ui/EventArt";`
Replace the `{item.imageUrl && ( <div className="relative aspect-square …"> <Image …/> </div> )}` block (~lines 67-77) with:
```tsx
              {item.artImageUrl ? (
                <EventArt
                  id={item.id}
                  imageUrl={item.artImageUrl}
                  alt={`${imageAltPrefix} ${item.name}`}
                  colorIndex={item.artColorIndex}
                  shapeIndex={item.artShapeIndex}
                  className="aspect-square"
                />
              ) : item.imageUrl ? (
                <div className="relative aspect-square overflow-hidden">
                  <Image
                    src={item.imageUrl}
                    alt={`${imageAltPrefix} ${item.name}`}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
              ) : null}
```

- [ ] **Step 3: artists + football pages pass the art fields**

In `app/artists/page.tsx` and `app/football/page.tsx`, in the `.map(...)` that builds `CatalogItem`, add after `imageUrl: …,`:
```ts
      artImageUrl: artist.fields.artImageUrl,
      artColorIndex: artist.fields.artColorIndex,
      artShapeIndex: artist.fields.artShapeIndex,
```
(Use the loop variable name in each file — `artist` in artists page, the team variable in football page.)

- [ ] **Step 4: `CategoryCard` gains art props + renders EventArt**

In `components/CategoryCard.tsx`, add `artImageUrl?: string; artColorIndex?: number; artShapeIndex?: number;` to the props type, add `import { EventArt } from "@/components/ui/EventArt";`, and replace the image `<div className="relative h-40 sm:h-44"> … </div>` inner image conditional so that when `artImageUrl` is set it renders:
```tsx
      {artImageUrl ? (
        <EventArt
          id={slug}
          imageUrl={artImageUrl}
          alt={name}
          colorIndex={artColorIndex}
          shapeIndex={artShapeIndex}
          className="h-full w-full"
        />
      ) : imageUrl ? (
        <Image
          src={imageUrl}
          alt={name}
          fill
          sizes="(max-width: 640px) 90vw, 480px"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="h-full w-full bg-main" />
      )}
```
(Keep the gradient overlay `<div>` after it.)

- [ ] **Step 5: `HomeCategory` + CategorySection + homepage mapper carry art**

In `components/CategorySection.tsx`, add to `HomeCategory`: `artImageUrl?: string; artColorIndex?: number; artShapeIndex?: number;`, and pass them into `<CategoryCard … artImageUrl={c.artImageUrl} artColorIndex={c.artColorIndex} artShapeIndex={c.artShapeIndex} />`.
In `app/page.tsx`, in the `getCategories(): Promise<HomeCategory[]>` mapper (~line 41), add for each row:
```ts
      artImageUrl: c.art_image_url ?? undefined,
      artColorIndex: c.art_color_index ?? undefined,
      artShapeIndex: c.art_shape_index ?? undefined,
```
(`c` is the raw `Category` row — snake_case.)

- [ ] **Step 6: Blog list card (app/blog/page.tsx)**

Add `import { EventArt } from "@/components/ui/EventArt";`. Replace the hero `<div className="relative w-full aspect-[16/9] …">` image conditional so that when `post.fields.artImageUrl` is set it renders EventArt, else the current `<Image>`, else the ✍ placeholder:
```tsx
                <div className="relative w-full aspect-[16/9] bg-gradient-to-br from-[#05203C] to-[#178189]">
                  {post.fields.artImageUrl ? (
                    <EventArt
                      id={post.sys.id}
                      imageUrl={post.fields.artImageUrl}
                      alt={`תמונה לבלוג ${String(post.fields.title)}`}
                      colorIndex={post.fields.artColorIndex}
                      shapeIndex={post.fields.artShapeIndex}
                      className="h-full w-full"
                    />
                  ) : post.fields.heroBanner?.fields?.file?.url ? (
                    <Image
                      src={"https:" + post.fields.heroBanner.fields.file.url}
                      alt={`תמונה לבלוג ${String(post.fields.title)}`}
                      priority={true}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      style={{ objectPosition: 'center top' }}
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-white/80 text-5xl font-bold">
                      ✍
                    </div>
                  )}
                </div>
```

- [ ] **Step 7: Verify types**

Run (myt-main): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Manual smoke test**

`yarn dev` (myt-main). With a blob set in the backoffice for one artist, one category, one blog post:
- `/artists` — that artist shows blob art; others show plain image (fallback intact).
- homepage — that category card shows blob art; others plain.
- `/blog` — that post shows blob art; others plain.

- [ ] **Step 9: Commit**

```bash
git add components/CatalogPageTemplate.tsx app/artists/page.tsx app/football/page.tsx components/CategoryCard.tsx components/CategorySection.tsx app/page.tsx app/blog/page.tsx
git commit -m "feat(templates): render blob card-art on catalog/category/blog cards"
```

---

## Out of scope (deliberate — not silently dropped)

- **Detail-page heroes** (`/artists/[id]`, `/football/[id]`, `/blog/[slug]`) and the homepage **HeroCarousel** featured cards keep their current image render. The data now flows to them (readers populate the fields), so wiring `EventArt` there later is a small follow-up — not done in this plan to keep scope to the primary card surfaces.

## Self-review notes

- **Spec coverage:** migration (T1) ✓, backoffice types (T2) ✓, picker reuse + label (T3) ✓, all 4 forms (T4 artists+football, T5 blog, T6 categories) ✓, server actions (T4–T6 step 5/6) ✓, myt-main types (T7) ✓, readers (T8) ✓, card render + fallback (T9) ✓, cross-project sync noted ✓.
- **Fallback/rollback:** every T9 render is `artImageUrl ? EventArt : existing` — explicit per Dor.
- **Type consistency:** snake_case on rows/DB (`art_image_url`), camelCase on `fields`/card props (`artImageUrl`); `EventArt` colorIndex/shapeIndex are `number | undefined` — readers map `?? undefined`, matching.
