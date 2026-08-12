# Cross-Bucket Image Picker + Template Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins browse/search images across every Supabase Storage bucket, multi-select them into template galleries (artists + football), and pick any stored image as a hero / art-blob-cut source - not just one bucket.

**Architecture:** One new server action (`listAllBucketImages`) enumerates images across all buckets. One new focused client component (`StorageImageBrowser`) renders the browse+search+select dialog (single or multi). `ImageFilePicker` gains an `allBuckets` flag that delegates its browse dialog to `StorageImageBrowser` (single-select). A new `GalleryField` uses `StorageImageBrowser` in multi-select mode and replaces the paste-URL textarea in `PersonForm`. Event card/map pickers and `ArtBlobPicker` opt in via the `allBuckets` flag.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, shadcn/ui (Radix), Tailwind, Supabase Storage (service-role server client).

## Global Constraints

- **No test suite exists.** The type gate is `npx tsc --noEmit` (build ignores TS/ESLint errors per `next.config.mjs`). Each task's verification = `tsc --noEmit` clean + a manual browser check.
- **Server-only Supabase:** storage actions live in `lib/actions/storage-actions.ts` (`"use server"`, service-role client). Never call `createClient()` inline; never expose the service key to the client.
- **Supabase error handling:** check `if (error)`, `console.error(JSON.stringify(error))`, never swallow silently. A failed bucket must not fail the whole enumeration.
- **Soft-delete / cross-project:** no DB schema change. `gallery` stays a `string[]` of URLs (JSONB) exactly as main reads it → zero cross-project impact, no `/sync-types`.
- **Commits:** per Dor's workflow - do NOT auto-commit. Branch off `master` first (`feat/cross-bucket-image-picker`), stage changes, and pause for Dor (he runs `/commit-push`). The "Commit" step in each task means _prepare the commit and hand off_, unless Dor has said to commit.
- **shadcn only** - reuse `components/ui/*`; no new UI libs.

---

### Task 1: `listAllBucketImages` server action + `StorageImage` type

**Files:**

- Modify: `lib/actions/storage-actions.ts` (append new type + two functions after the existing `getFiles`)

**Interfaces:**

- Consumes: existing module-level `supabase` (service-role client) already imported at top of the file.
- Produces:
  - `export type StorageImage = { bucket: string; path: string; name: string; url: string; size: number | null; updatedAt: string | null }`
  - `export async function listAllBucketImages(): Promise<StorageImage[]>`

- [ ] **Step 1: Add the type and helper + action**

Append to `lib/actions/storage-actions.ts`:

```ts
export type StorageImage = {
  bucket: string;
  path: string;
  name: string;
  url: string;
  size: number | null;
  updatedAt: string | null;
};

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg)$/i;

// List image files in one bucket, recursing into virtual folders (cap depth ~2).
// A failed listing logs and returns [] so one bad bucket never fails the sweep.
async function listImagesInBucket(
  bucket: string,
  isPublic: boolean,
  prefix = "",
  depth = 0,
): Promise<StorageImage[]> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error) {
    console.error(JSON.stringify(error));
    return [];
  }

  const out: StorageImage[] = [];
  for (const item of data ?? []) {
    if (item.name === ".folder") continue;
    const path = prefix ? `${prefix}/${item.name}` : item.name;

    // Supabase Storage returns folders as rows with a null `id`/`metadata`.
    const isFolder = item.id === null;
    if (isFolder) {
      if (depth < 2) {
        out.push(
          ...(await listImagesInBucket(bucket, isPublic, path, depth + 1)),
        );
      }
      continue;
    }

    if (!IMAGE_EXT_RE.test(item.name)) continue;

    let url: string;
    if (isPublic) {
      url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    } else {
      const signed = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);
      if (signed.error) {
        console.error(JSON.stringify(signed.error));
        continue;
      }
      url = signed.data.signedUrl;
    }

    out.push({
      bucket,
      path,
      name: item.name,
      url,
      size: item.metadata?.size ?? null,
      updatedAt: item.updated_at ?? null,
    });
  }
  return out;
}

// Enumerate image files across every bucket, in parallel, merged flat.
export async function listAllBucketImages(): Promise<StorageImage[]> {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error(JSON.stringify(error));
    return [];
  }
  const perBucket = await Promise.all(
    (buckets ?? []).map((b) => listImagesInBucket(b.name, b.public)),
  );
  return perBucket.flat();
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `storage-actions.ts`.

- [ ] **Step 3: Manual smoke (optional, fast)**

Temporarily add to any server component or a scratch route:
`console.log((await listAllBucketImages()).length)` → run `npm run dev`, hit the page, confirm a non-zero count logs and no unhandled error. Remove the temp log.

- [ ] **Step 4: Commit (hand off per Global Constraints)**

```bash
git add lib/actions/storage-actions.ts
git commit -m "feat(storage): add listAllBucketImages cross-bucket image enumeration"
```

---

### Task 2: `StorageImageBrowser` component (browse + search + select, single/multi)

**Files:**

- Create: `components/storage-image-browser.tsx`

**Interfaces:**

- Consumes: `listAllBucketImages`, `StorageImage` (Task 1); `FileUploadZone` (`{ bucket, path, onUploadComplete }`); shadcn `Dialog`, `Tabs`, `Select`, `ScrollArea`, `Button`, `Input`; `useToast`.
- Produces:

  ```ts
  export function StorageImageBrowser(props: {
    trigger: React.ReactNode;
    multiple?: boolean; // default false
    uploadBucket?: string; // default "templates"
    uploadFolder?: string; // default ""
    onConfirm: (urls: string[]) => void;
  }): JSX.Element;
  ```

  Single mode → `onConfirm([url])`. Multi mode → `onConfirm(urls)`.

- [ ] **Step 1: Create the component**

Create `components/storage-image-browser.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileUploadZone } from "@/components/file-upload-zone";
import {
  listAllBucketImages,
  type StorageImage,
} from "@/lib/actions/storage-actions";
import { Check, ImageIcon, RefreshCw, Search, Upload } from "lucide-react";

const ALL = "__all__";

export function StorageImageBrowser({
  trigger,
  multiple = false,
  uploadBucket = "templates",
  uploadFolder = "",
  onConfirm,
}: {
  trigger: React.ReactNode;
  multiple?: boolean;
  uploadBucket?: string;
  uploadFolder?: string;
  onConfirm: (urls: string[]) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<StorageImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState("select");

  const load = async () => {
    setLoading(true);
    try {
      setImages(await listAllBucketImages());
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load images from storage",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setTab("select");
      setSelected(new Set());
      setSearch("");
      setBucket(ALL);
      load();
    }
  }, [open]);

  const buckets = useMemo(
    () => Array.from(new Set(images.map((i) => i.bucket))).sort(),
    [images],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter(
      (i) =>
        (bucket === ALL || i.bucket === bucket) &&
        (!q ||
          i.name.toLowerCase().includes(q) ||
          i.path.toLowerCase().includes(q)),
    );
  }, [images, bucket, search]);

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (multiple) {
        if (next.has(url)) next.delete(url);
        else next.add(url);
      } else {
        next.clear();
        next.add(url);
      }
      return next;
    });
  };

  const confirm = () => {
    if (selected.size === 0) return;
    onConfirm(Array.from(selected));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-4xl h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Select image{multiple ? "s" : ""} from storage
          </DialogTitle>
          <DialogDescription>
            Browse and search across all storage buckets, or upload a new file.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="select" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Select File
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload New
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="select"
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <div className="flex flex-col h-full min-h-0">
              <div className="flex flex-wrap items-center gap-2 mb-3 flex-shrink-0">
                <Select value={bucket} onValueChange={setBucket}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All storages</SelectItem>
                    {buckets.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[12rem]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search filename across all buckets…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={load}
                  disabled={loading}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="pr-4">
                  {loading ? (
                    <div className="flex items-center justify-center h-32">
                      <RefreshCw className="h-6 w-6 animate-spin" />
                    </div>
                  ) : visible.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {visible.map((img) => {
                        const isSel = selected.has(img.url);
                        return (
                          <button
                            key={`${img.bucket}::${img.path}`}
                            type="button"
                            onClick={() => toggle(img.url)}
                            className={`relative text-left rounded-md border overflow-hidden transition-all hover:shadow-md ${
                              isSel ? "ring-2 ring-primary" : ""
                            }`}
                          >
                            <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.url}
                                alt={img.name}
                                className="max-w-full max-h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.visibility = "hidden";
                                }}
                              />
                            </div>
                            <div className="p-2">
                              <p className="text-xs font-medium truncate">
                                {img.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {img.bucket}
                              </p>
                            </div>
                            {isSel && (
                              <span className="absolute top-1 right-1 rounded-full bg-primary text-primary-foreground p-1">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <ImageIcon className="h-12 w-12 mb-2" />
                      <p>No image files found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="flex-1">
            <FileUploadZone
              bucket={uploadBucket}
              path={uploadFolder}
              onUploadComplete={() => {
                setTab("select");
                load();
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Uploads go to the <code>{uploadBucket}</code> bucket. Supported:
              JPG, PNG, GIF, WebP, SVG.
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-shrink-0">
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {multiple ? `${selected.size} selected` : ""}
          </span>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={selected.size === 0}>
            {multiple ? "Add selected" : "Use selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `components/ui/select.tsx` is missing, add it via `npx shadcn@latest add select` - but it already exists in this repo.)

- [ ] **Step 3: Commit (hand off)**

```bash
git add components/storage-image-browser.tsx
git commit -m "feat(storage): add StorageImageBrowser cross-bucket picker dialog"
```

---

### Task 3: Add `allBuckets` to `ImageFilePicker` (single-select from all buckets)

**Files:**

- Modify: `components/image-file-picker.tsx`

**Interfaces:**

- Consumes: `StorageImageBrowser` (Task 2).
- Produces: `ImageFilePicker` gains `allBuckets?: boolean` (default false). When true, the browse button opens `StorageImageBrowser` (single-select, `uploadBucket = bucketName`); when false, the existing single-bucket dialog is unchanged. `value`/`onChange` stay `string`.

- [ ] **Step 1: Import StorageImageBrowser**

At the top of `components/image-file-picker.tsx`, add after the existing imports:

```tsx
import { StorageImageBrowser } from "@/components/storage-image-browser";
```

- [ ] **Step 2: Add the prop**

Change the props interface + destructure:

```tsx
interface ImageFilePickerProps {
  value: string;
  onChange: (url: string) => void;
  label: string;
  bucketName?: string;
  folder?: string;
  allBuckets?: boolean;
}

export function ImageFilePicker({
  value,
  onChange,
  label,
  bucketName = "card-images",
  folder = "",
  allBuckets = false,
}: ImageFilePickerProps) {
```

- [ ] **Step 3: Swap the browse control when `allBuckets`**

In the returned JSX, replace the existing `<Dialog open={isOpen} …> … </Dialog>` block (the browse dialog, starting `<Dialog open={isOpen}` and ending at its closing `</Dialog>`) with a conditional. Keep everything else (the URL `<Input>`, the external-link `<Button>`, and the preview block below) untouched:

```tsx
{
  allBuckets ? (
    <StorageImageBrowser
      multiple={false}
      uploadBucket={bucketName}
      uploadFolder={folder}
      onConfirm={(urls) => {
        if (urls[0]) onChange(urls[0]);
      }}
      trigger={
        <Button variant="outline" size="icon" type="button">
          <FolderOpen className="h-4 w-4" />
        </Button>
      }
    />
  ) : (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {/* …existing legacy dialog JSX, unchanged… */}
    </Dialog>
  );
}
```

Leave the legacy state/handlers (`isOpen`, `files`, `loadFiles`, etc.) in place - they are still used by the `else` branch. Do not delete them.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Existing callers (no `allBuckets`) still compile and behave exactly as before.

- [ ] **Step 5: Commit (hand off)**

```bash
git add components/image-file-picker.tsx
git commit -m "feat(storage): ImageFilePicker can browse all buckets via allBuckets flag"
```

---

### Task 4: `GalleryField` component + wire into `PersonForm` (artists + football)

**Files:**

- Create: `components/templates/gallery-field.tsx`
- Modify: `components/templates/PersonForm.tsx`

**Interfaces:**

- Consumes: `StorageImageBrowser` (Task 2).
- Produces: `export function GalleryField(props: { value: string[]; onChange: (urls: string[]) => void }): JSX.Element`.

- [ ] **Step 1: Create `GalleryField`**

Create `components/templates/gallery-field.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ImagePlus, Link as LinkIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StorageImageBrowser } from "@/components/storage-image-browser";

export function GalleryField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");

  const add = (urls: string[]) => {
    const merged = [...value];
    for (const u of urls) {
      const t = u.trim();
      if (t && !merged.includes(t)) merged.push(t);
    }
    onChange(merged);
  };
  const remove = (u: string) => onChange(value.filter((x) => x !== u));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StorageImageBrowser
          multiple
          uploadBucket="templates"
          onConfirm={add}
          trigger={
            <Button type="button" variant="outline" size="sm">
              <ImagePlus className="h-4 w-4 mr-2" />
              Add from storage
            </Button>
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowUrl((s) => !s)}
        >
          <LinkIcon className="h-4 w-4 mr-2" />
          Add by URL
        </Button>
      </div>

      {showUrl && (
        <div className="flex gap-2">
          <Input
            placeholder="https://…/photo.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              add([url]);
              setUrl("");
            }}
            disabled={!url.trim()}
          >
            Add
          </Button>
        </div>
      )}

      {value.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {value.map((u) => (
            <div
              key={u}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(u)}
                aria-label="Remove image"
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No gallery images yet. Add from storage or by URL.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Import GalleryField in PersonForm**

In `components/templates/PersonForm.tsx`, add near the other component imports (after the `ArtBlobPicker` import):

```tsx
import { GalleryField } from "@/components/templates/gallery-field";
```

- [ ] **Step 3: Move `gallery` out of RHF into local state**

In `PersonForm`:

a) Remove `gallery: z.string().optional(),` from the `schema` `z.object({ … })`.

b) Delete the `galleryText` helper (lines ~58) - it is no longer used. (Leave `videosText`/`bannersText`.)

c) Remove `gallery: galleryText(initial?.gallery),` from `defaultValues`.

d) Add local state alongside the other non-RHF state (near `artShapeIndex`):

```tsx
const [gallery, setGallery] = useState<string[]>(initial?.gallery ?? []);
```

- [ ] **Step 4: Add `gallery` to dirty tracking + reset**

Replace the `initialExtras` / `isDirty` / `resetExtras` block with:

```tsx
const initialExtras = JSON.stringify({
  imageUrl: initial?.image_url ?? "",
  artImageUrl: initial?.art_image_url ?? "",
  artColorIndex: initial?.art_color_index ?? 0,
  artShapeIndex: initial?.art_shape_index ?? 0,
  gallery: initial?.gallery ?? [],
});
const isDirty =
  form.formState.isDirty ||
  JSON.stringify({
    imageUrl,
    artImageUrl,
    artColorIndex,
    artShapeIndex,
    gallery,
  }) !== initialExtras;

const resetExtras = () => {
  setImageUrl(initial?.image_url ?? "");
  setArtImageUrl(initial?.art_image_url ?? "");
  setArtColorIndex(initial?.art_color_index ?? 0);
  setArtShapeIndex(initial?.art_shape_index ?? 0);
  setGallery(initial?.gallery ?? []);
};
```

- [ ] **Step 5: Use the state array in the submit payload**

In `onSubmit`'s `payload`, replace `gallery: lines(values.gallery),` with:

```tsx
gallery,
```

- [ ] **Step 6: Replace the gallery textarea field with `GalleryField`**

Replace the entire gallery `FormField` block (the one rendering `name="gallery"` with the `<Textarea rows={4} …>`) with:

```tsx
<div className="space-y-2">
  <label className="text-sm font-medium">Gallery images</label>
  <GalleryField value={gallery} onChange={setGallery} />
  <p className="text-xs text-muted-foreground">
    Pick multiple from any storage bucket, or paste an external URL.
  </p>
</div>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `lines` becomes unused, it is still used by `parseVideos`/`parseBanners` - leave it. Confirm no dangling reference to `galleryText` or `values.gallery` remains.

- [ ] **Step 8: Manual verify**

Run `npm run dev`. Open `/templates/artists/<id>/edit` (and a football team):

- "Add from storage" opens the browser, switch bucket to "All storages", search a filename, multi-select 2+ images from different buckets, "Add selected" → thumbnails appear.
- "Add by URL" adds an external URL.
- Remove (×) one thumbnail.
- Save → reload → gallery persists identically.

- [ ] **Step 9: Commit (hand off)**

```bash
git add components/templates/gallery-field.tsx components/templates/PersonForm.tsx
git commit -m "feat(templates): multi-select cross-bucket gallery picker for artists & football"
```

---

### Task 5: Opt event card/map pickers + `ArtBlobPicker` into `allBuckets`

**Files:**

- Modify: `app/(dashboard)/events/[id]/page.tsx` (the two `ImageFilePicker` instances, ~lines 1871 and 1887)
- Modify: `components/art-blob-picker.tsx` (the internal `ImageFilePicker`, ~lines 137-142)

**Interfaces:**

- Consumes: `allBuckets` flag on `ImageFilePicker` (Task 3).
- Produces: no new exports - behavioral change only.

- [ ] **Step 1: Event card image picker**

In `app/(dashboard)/events/[id]/page.tsx`, add `allBuckets` to the Card Image `ImageFilePicker` (keep `bucketName="card_images"` as the upload destination):

```tsx
<ImageFilePicker
  label="Card Image"
  value={event.card_image_url}
  onChange={(url) =>
    setEvent((prev) => (prev ? { ...prev, card_image_url: url } : prev))
  }
  bucketName="card_images"
  folder=""
  allBuckets
/>
```

- [ ] **Step 2: Event map image picker**

Add `allBuckets` to the Map Image `ImageFilePicker` (keep `bucketName="map_images"`, `folder="maps"`):

```tsx
<ImageFilePicker
  label="Map Image"
  value={event.map_image_url}
  onChange={(url) =>
    setEvent((prev) => (prev ? { ...prev, map_image_url: url } : prev))
  }
  bucketName="map_images"
  folder="maps"
  allBuckets
/>
```

(The `process.env.NODE_ENV === "development" ? "card_images" : "card_images"` ternaries collapse to the plain bucket string - both branches were identical.)

- [ ] **Step 3: ArtBlobPicker cut-out source**

In `components/art-blob-picker.tsx`, add `allBuckets` to the internal `ImageFilePicker` so the cut can start from any stored image (uploads still land in `art_blobs`):

```tsx
<ImageFilePicker
  value={imageUrl ?? ""}
  onChange={onImage}
  label="Cut-out image"
  bucketName="art_blobs"
  allBuckets
/>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify**

Run `npm run dev`:

- Event edit page → Card Image / Map Image folder button now opens the all-buckets browser with "All storages" + search; selecting an image from another bucket sets the URL.
- Art blob "Cut-out image" folder button browses all buckets; pick an image from e.g. `card_images`, then "Upload + cut out" still works on a fresh file.

- [ ] **Step 6: Commit (hand off)**

```bash
git add "app/(dashboard)/events/[id]/page.tsx" components/art-blob-picker.tsx
git commit -m "feat(events): hero/card/map/art pickers browse all storage buckets"
```

---

## Self-Review

**Spec coverage:**

- Cross-bucket enumeration (spec §1) → Task 1. ✅
- Bucket dropdown + cross-bucket search, cached client-side (spec §2) → Task 2 (`buckets`/`visible` memos filter one cached `listAllBucketImages` load). ✅
- Multi-select for gallery (spec §2, §3) → Task 2 `multiple` + Task 4 `GalleryField`. ✅
- Gallery wiring in PersonForm, thumbnail strip + remove + add-by-URL, drop `lines()` split (spec §3) → Task 4. ✅
- Hero / event / art-blob "cut" from all buckets (spec §4) → Task 3 (`allBuckets`) + Task 5. ✅
- `StorageImage` internal type, no shared-type/DB change (spec §5) → Task 1; gallery stays `string[]`. ✅
- Error handling: per-bucket skip + log, loading/empty states, broken-image fallback, private→signed (spec §6) → Task 1 (`console.error`, `return []`, signed URL) + Task 2 (loading spinner, empty state, `onError`). ✅
- Verification via `tsc --noEmit` + manual (spec §7) → every task. ✅
- Out of scope (external providers, drag-reorder, delete-in-picker) → not built. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps - every code step shows full code. ✅

**Type consistency:** `StorageImage` fields (`bucket, path, name, url, size, updatedAt`) defined in Task 1 and consumed identically in Task 2. `listAllBucketImages(): Promise<StorageImage[]>` used in Task 2. `StorageImageBrowser` `onConfirm: (urls: string[]) => void` consumed by Task 3 (`urls[0]`) and Task 4 (`add(urls)`). `GalleryField` `{ value: string[]; onChange: (urls: string[]) => void }` matches PersonForm `gallery`/`setGallery` state. `ImageFilePicker` `allBuckets?: boolean` defined in Task 3, used in Task 5. ✅
