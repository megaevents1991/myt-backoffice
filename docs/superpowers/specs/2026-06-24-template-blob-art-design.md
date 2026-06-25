# Template Blob Card-Art — Design

**Date:** 2026-06-24
**Branch:** `redesign` (both repos)
**Repos:** `myt-backoffice` (editor) + `myt-main` (renderer)

## Goal

Give all four backoffice CMS templates — **artists, football teams, categories, blog** — the
same "blob card-art" option that events already have: upload a photo, auto-remove its
background, place the transparent cut-out over a neon brand blob (selectable colour + shape).
Reuse the existing global components on both sides; render the result on the customer site.

## Key insight — the global components already exist

Nothing new to invent. Two components already do the work:

- **Editor (backoffice):** [`components/art-blob-picker.tsx`](../../../components/art-blob-picker.tsx)
  `ArtBlobPicker` — standalone, reusable. Takes `imageUrl/colorIndex/shapeIndex` + 3 callbacks,
  removes background in-browser (`@imgly/background-removal`, isnet), uploads cut-out to the
  public `art_blobs` bucket. Already used by the events page
  (`app/(dashboard)/events/[id]/page.tsx`).
- **Renderer (myt-main):** [`components/ui/EventArt.tsx`](../../../../myt-main/components/ui/EventArt.tsx)
  `EventArt` — already accepts `colorIndex`/`shapeIndex` overrides and renders the blob behind
  the cut-out. Currently used only by event cards.

So "use a global blob component in all template options" is satisfied by **importing** these two
— the work is data plumbing (columns, types, readers) + dropping the components into the
template forms and cards.

## Approach

Match the **events** convention exactly: three separate nullable columns per table.

- `art_image_url` — text (the cut-out URL in `art_blobs`)
- `art_color_index` — int (index into the 6-colour neon palette)
- `art_shape_index` — int (index into the 6 blob shapes)

Rejected alternatives:
- **Single jsonb `art` column** — breaks parity with events (3 columns there); harder to query.
- **Extract shared shape/colour constants into one module** (today triplicated:
  backoffice `art-blob-picker.tsx`, myt-main `lib/eventArt.ts` + `EventArt.tsx`) — a real
  cleanup but out of scope; the duplicated constants already agree. Not blocking.

Columns are additive + nullable → myt-main reads stay safe; the existing plain "Hero/Banner
image" field on every form stays (blob is optional/additive, not a replacement).

## Backoffice (editor) changes

1. **Migration** — add `art_image_url text`, `art_color_index int`, `art_shape_index int`
   (all nullable) to `artists`, `football_teams`, `categories`, and the blog table.
   New SQL file under the existing migrations folder
   (convention: `…/migrations/2026-06-24-add-template-blob-art.sql`).
2. **Types** — add the 3 fields to `types/person.types.ts` (`Person`, covers artists + football),
   `types/category.types.ts`, `types/blog.types.ts`.
3. **Server actions** — include the 3 fields in create/update payloads in
   `lib/actions/artist-actions`, `football-actions`, `category-actions`, `blog-actions`
   (map explicitly — Supabase rule: no spread of the whole object).
4. **Forms** — drop `<ArtBlobPicker>` into:
   - `components/templates/PersonForm.tsx` (artists + football)
   - `components/templates/BlogForm.tsx`
   - categories new + edit forms (`app/(dashboard)/templates/categories/new` + `[id]/edit`)

   Wire to local state exactly like the events page:
   `art_image_url/art_color_index/art_shape_index` held in component state, fed to the picker's
   `imageUrl/colorIndex/shapeIndex`, updated via `onImage/onColor/onShape`, sent in the submit
   payload. Place it near the existing image field.
5. **`ArtBlobPicker` tweak** — add an optional `label?: string` prop (defaults to the current
   `"Card art — cut-out + blob"`) so e.g. blog can read "Post art". One line, zero risk.

## myt-main (renderer) changes

6. **Types** — add `art_image_url: string | null`, `art_color_index: number | null`,
   `art_shape_index: number | null` to `TemplateBase` in `lib/app.types.ts`, and carry them into
   the runtime `Artist` / `FootballTeam` / `Category` / `BlogPost` shapes (these are
   Contentful-mirror `sys/fields` shapes populated by the readers).
7. **Readers** — map the new columns from the Supabase row in `lib/cms/people.ts` (artists +
   teams), `lib/blog.ts`, and the categories reader.
8. **Cards** — where a template card currently renders a plain `<Image>` (CategoryCard, the
   artist/team catalog cards, blog cards), render
   `<EventArt variant="blob" imageUrl={art_image_url} colorIndex={art_color_index}
   shapeIndex={art_shape_index} />` **when `art_image_url` is set**, else fall back to the
   current image render. `EventArt` already handles the deterministic default, but here we only
   switch to blob art when the editor explicitly set a cut-out.

## Cross-project notes

- Additive nullable columns → no breaking change to existing reads/writes.
- `lib/app.types.ts` (myt-main) ↔ backoffice template types must stay in sync — run `/sync-types`
  after the type edits.
- `art_blobs` bucket already exists and is public — reused for all four templates, no new bucket.

## Out of scope

- Extracting the triplicated shape/colour constants into one shared module.
- Changing the events blob behaviour.
- Any new bucket or storage policy.

## Success criteria

- Each of the 4 template edit forms shows the blob picker; uploading removes the background and
  previews the cut-out on the chosen colour + shape.
- Saving persists the 3 `art_*` values; reloading the form restores them.
- On myt-main, a template whose `art_image_url` is set renders the blob card-art; one without it
  renders exactly as today.
- No regression to events blob art, and no break to existing template reads.
