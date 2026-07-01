# Cross-Bucket Image Picker + Template Gallery — Design

**Date:** 2026-07-01
**Project:** myt-backoffice
**Status:** Approved design, pending implementation plan

## Problem

Two related gaps in image management:

1. **Gallery (artist + football templates).** The gallery field in `PersonForm` is a plain
   `Textarea` where the admin pastes image URLs one per line. There is no picker, no browse,
   no search. To get a URL the admin must first upload via the Hero field, copy the resulting
   URL, then paste it in.
2. **Hero / event upload-and-cut.** The shared `ImageFilePicker` "Select File" tab is locked to
   a single Supabase bucket (`bucketName` prop). When adding a hero image or running the
   background-removal "cut" (`ArtBlobPicker`), the admin can only browse that one bucket — not
   the other storages where usable images already live.

Both reduce to one missing capability: **browse and search images across all Supabase Storage
buckets, and (for the gallery) select many at once.**

## Scope (confirmed)

- **"All storages" = all existing Supabase Storage buckets** (`card-images`, `map_images`,
  `art_blobs`, `templates`, and any user-created buckets). NOT new external providers
  (no S3 / GCS / Azure). No new infra.
- **Search = cross-bucket.** One search box filters filenames across every bucket at once.

## Approach

Extend the existing shared `ImageFilePicker` (rather than fork a new component), backed by one
new server action that enumerates images across all buckets. Load all buckets once when the
picker opens, cache client-side, then filter by bucket + search in the browser — so cross-bucket
search costs zero per-keystroke server round-trips. This keeps every existing caller working and
matches repo conventions (Server-Actions-first, shadcn, reuse-don't-reinvent).

## Design

### 1. Server layer — `lib/actions/storage-actions.ts`

New action:

```ts
export type StorageImage = {
  bucket: string;
  path: string;        // path within the bucket
  name: string;        // file name only
  url: string;         // public or signed URL
  size: number | null;
  updatedAt: string | null;
};

export async function listAllBucketImages(): Promise<StorageImage[]>
```

Behavior:

- `listBuckets()` → for each bucket, `getFiles(bucket, "")`, then BFS-recurse into folders
  (depth cap ~2) to catch nested files (e.g. `map_images/maps/*`).
- Filter to image extensions (`.jpg .jpeg .png .gif .webp .svg`).
- Map each hit → `StorageImage`. URL resolution: public bucket → `getPublicUrl`; private bucket
  → `createSignedUrl` (long expiry).
- Run per-bucket listings in parallel (`Promise.all`).
- **Resilient:** a failed bucket does not fail the whole call — `console.error(JSON.stringify(error))`,
  skip that bucket, continue. Return the merged flat array.

This action is server-only (uses the service-role client already imported in the file).

### 2. Component — upgrade `components/image-file-picker.tsx`

New props, **backward compatible** (existing callers pass neither and behave exactly as today):

```ts
multiple?: boolean      // default false — multi-select for gallery
allBuckets?: boolean    // default false — enable the "All storages" browse mode
value?: string | string[]
onChange: (value: string | string[]) => void
```

**Select File tab** additions (only when `allBuckets`):

- **Bucket dropdown** (shadcn `Select`): `All storages` + one entry per bucket. Default `All storages`.
- **Search input** (shadcn `Input`): live filename filter.
- **Data source:** on open, call `listAllBucketImages()` **once**, cache in component state. The
  dropdown and search filter the cached merged list **client-side**. No per-keystroke server calls.

When `allBuckets` is off, the existing single-bucket `getFiles(bucketName, folder)` path is
unchanged.

**Multiple mode** (`multiple`):

- Grid tiles toggle selection with a checkmark overlay.
- Footer shows `N selected` + an `Add` button that returns the `string[]`.
- Single mode keeps today's click-to-select-and-confirm behavior.

**Refactor:** extract the results grid into an `<ImageGrid>` subcomponent so the file stays
focused (single vs multi + all-buckets logic would otherwise bloat one file).

**Upload New tab:** unchanged. Uploads land in the `bucketName` prop (destination bucket); the
uploaded file becomes immediately selectable.

### 3. Gallery wiring — `components/templates/PersonForm.tsx` (artists + football)

- Replace the gallery `Textarea` (currently ~lines 296–303) with:

  ```tsx
  <ImageFilePicker
    multiple
    allBuckets
    bucketName="templates"          // upload destination for new files
    value={galleryArray}
    onChange={setGalleryArray}
    label="Gallery images"
  />
  ```

- Below the picker: a thumbnail strip of the selected gallery images, each with a remove (×) button.
- Keep a small **collapsed "add by URL" input** as an escape hatch for external URLs — the old
  flow was manual URLs and existing rows already hold external links; don't lose that.
- Form submission: `gallery` is already `string[]` in the DB (JSONB). Drop the `lines()` textarea
  split; pass the array through directly.
- **Drag-reorder is out of scope for v1** (YAGNI). Order = selection order.

### 4. Hero / event upload-and-cut wiring

- **Event card/map pickers** (`app/(dashboard)/events/[id]/page.tsx`): pass `allBuckets` so the
  "All storages" option appears. Upload still defaults to `card_images` / `map_images`.
- **Hero + `ArtBlobPicker`** (`components/art-blob-picker.tsx`, used by PersonForm/BlogForm/events):
  thread `allBuckets` through the wrapped `ImageFilePicker` so the "select from storage" step can
  pull from any bucket, then the existing background-removal "cut" runs on the chosen image. Cut
  can now start from any stored image, not only a fresh upload.

### 5. Types & cross-project impact

- New internal type `StorageImage` lives in `types/storage.types.ts` (or beside the action). It is
  **not** a shared type → no `/sync-types`, no change to main's `lib/app.types.ts`.
- Gallery stays a `string[]` of URLs, exactly as the main app reads it today → **zero cross-project
  impact**. No DB schema change (columns already exist as JSONB).

### 6. Error handling & edge cases

- Per-bucket list failure → skip + `console.error`, never fail the whole enumeration.
- Grid: loading skeleton while `listAllBucketImages()` resolves; empty state when no images match.
- Broken image URL → placeholder tile.
- Private buckets → signed URL (public buckets → public URL).
- Large bucket counts: `getFiles` already paginates to 1000/level; folder recursion capped at ~2
  deep to avoid runaway.

### 7. Testing / verification

No automated test suite exists in this repo; `tsc --noEmit` is the real type gate (build ignores
TS/ESLint errors per `next.config.mjs`). Manual verification checklist:

- Gallery: add multiple images from 2+ different buckets in one open; remove one; save; reload and
  confirm persistence.
- Search: a filename present in a non-default bucket appears in results while `All storages` is
  selected.
- Hero / art-blob: pick an existing image from a bucket other than the default, run the cut, save.
- Event card image: `All storages` option appears and selecting from another bucket works.
- `add by URL` escape hatch still adds an external URL to the gallery.

## Out of scope

- External storage providers (S3/GCS/Azure).
- Drag-reorder of gallery images.
- Deleting/renaming files from within the picker (that lives in the `/storage` admin UI).
- Any change to the main app.

## Affected files (anticipated)

- `lib/actions/storage-actions.ts` — new `listAllBucketImages` action + `StorageImage` type (or in `types/`).
- `components/image-file-picker.tsx` — new props, bucket dropdown, search, multi-select, `<ImageGrid>` extraction.
- `components/templates/PersonForm.tsx` — gallery picker + thumbnail strip + add-by-URL.
- `components/art-blob-picker.tsx` — thread `allBuckets` through.
- `app/(dashboard)/events/[id]/page.tsx` — pass `allBuckets` to card/map pickers.
- `types/storage.types.ts` — new (optional home for `StorageImage`).
