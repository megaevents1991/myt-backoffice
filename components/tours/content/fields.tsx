"use client";

/**
 * The list and image controls of the site-content editors: ordered lists of
 * texts, images and gallery items, and a picture served by the company's site.
 * Field, Section and Chip come from components/tours/ui.tsx.
 *
 * An image field takes an address (`/media/...` on the site, or a full URL) or
 * an uploaded file: the file goes to the company's public media bucket
 * (lib/actions/tours-media-actions.ts) and the field gets its public URL. The
 * `folder` prop says where in the bucket the editor's uploads are filed.
 */
import { useCallback, useEffect, useId, useRef, useState, type DragEvent as ReactDragEvent, type HTMLAttributes, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, ImageOff, Loader2, Plus, Trash2, TriangleAlert, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { createTourMediaUpload } from "@/lib/actions/tours-media-actions";
import { supabase } from "@/lib/supabase-client";
import { plainFail, type ActionResult } from "@/lib/tours/action-kit";
import {
  TOUR_MEDIA_ACCEPT,
  TOUR_MEDIA_MAX_BYTES,
  TOUR_MEDIA_TYPES_LABEL,
  isTourMediaType,
  siteImageWarning,
  type TourMediaFolder,
} from "@/lib/tours/media";
import { sniffImageType } from "@/lib/upload-helper";
import { cn } from "@/lib/utils";
import { EmptyLine, Field } from "@/components/tours/ui";
import { MediaPickerButton } from "@/components/tours/content/media-picker";
import { siteAssetUrl, type GalleryItem } from "@/components/tours/content/shared";

/** Move an item of a list one place up or down. */
export function moved<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Move an item of a list to another place; the items between shift by one. */
export function movedTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Drag a row by its grip onto another row to move it there (Alon, 07.10.2026);
 * the arrows stay for the keyboard. Spread `row(index)` on the row and put a
 * <DragGrip {...grip(index)} /> in it; `mark(index)` says on which side of a
 * row the dragged one will land.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const end = () => {
    setDrag(null);
    setOver(null);
  };
  return {
    dragging: drag,
    grip: (index: number) => ({
      draggable: true,
      onDragStart: (event: ReactDragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = "move";
        // Firefox starts a drag only when it carries data
        event.dataTransfer.setData("text/plain", String(index));
        const row = event.currentTarget.closest("[data-drag-row]");
        if (row) event.dataTransfer.setDragImage(row, 16, 16);
        setDrag(index);
      },
      onDragEnd: end,
    }),
    row: (index: number) => ({
      "data-drag-row": true,
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        if (drag === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (over !== index) setOver(index);
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        if (drag === null) return;
        event.preventDefault();
        if (drag !== index) onMove(drag, index);
        end();
      },
    }),
    mark: (index: number): "before" | "after" | null =>
      drag === null || over !== index || drag === index ? null : drag < index ? "after" : "before",
  };
}

/** The grip a row is dragged by. */
export function DragGrip(props: HTMLAttributes<HTMLSpanElement> & { draggable: boolean }) {
  return (
    <span
      {...props}
      aria-hidden
      title="Drag to move"
      className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );
}

/** The line that shows where a dragged row will land. */
export const dropMarkClass = (mark: "before" | "after" | null): string =>
  mark === "before" ? "shadow-[0_-2px_0_0_hsl(var(--primary))]" : mark === "after" ? "shadow-[0_2px_0_0_hsl(var(--primary))]" : "";

/** Up / down / remove - the controls on every row of an ordered list. */
export function RowControls({
  index,
  count,
  onMove,
  onRemove,
  removeLabel = "Remove",
}: {
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  removeLabel?: string;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label="Move up"
        title="Move up"
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label="Move down"
        title="Move down"
      >
        <ArrowDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** A picture served by the company's site (`/media/...`), or a placeholder when it cannot load. */
export function SiteImage({
  siteUrl,
  path,
  className,
  alt = "",
}: {
  siteUrl: string | null | undefined;
  path: string | null | undefined;
  className?: string;
  alt?: string;
}) {
  const src = siteAssetUrl(siteUrl, path);
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div
        className={cn("flex items-center justify-center rounded bg-muted text-muted-foreground", className)}
        title={src ? "The image did not load from the site" : "No image"}
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the customer site, not by this app
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("rounded bg-muted object-cover", className)}
    />
  );
}

// ---------------------------------------------------------------- upload
const MAX_MB = TOUR_MEDIA_MAX_BYTES / 1024 / 1024;

/** Host of this project's Storage: an uploaded picture's URL starts with it. */
const STORAGE_HOST = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
  } catch {
    return null;
  }
})();

/** Upload one picture to the active company's media bucket; answers its public URL. */
async function uploadSiteImage(file: File, folder: TourMediaFolder): Promise<ActionResult<string>> {
  try {
    if (file.size > TOUR_MEDIA_MAX_BYTES) return plainFail(`The file is larger than ${MAX_MB} MB`);
    // The bytes decide the type, not the name: a WebP saved as .jpg is stored as WebP (lib/upload-helper.ts).
    const sniffed = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    const contentType = sniffed?.mime ?? file.type;
    if (!isTourMediaType(contentType)) return plainFail(`Only ${TOUR_MEDIA_TYPES_LABEL} images can be uploaded`);

    const grant = await createTourMediaUpload({ folder, fileName: file.name, contentType, size: file.size });
    if (!grant.success) return grant;
    // Straight to Storage with the one-time token; the path is unique, so the file never changes.
    const { error } = await supabase.storage
      .from(grant.data.bucket)
      .uploadToSignedUrl(grant.data.path, grant.data.token, file, { contentType, cacheControl: "31536000" });
    if (error) return plainFail(`The upload failed: ${error.message}`);
    return { success: true, data: grant.data.publicUrl };
  } catch (e) {
    return plainFail(`The upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Uploads files one by one, with progress, and reports the outcome in one toast. `savedNote` is the toast's second line. */
function useSiteImageUpload(folder: TourMediaFolder, savedNote = "Save the page to keep it.") {
  const { toast } = useToast();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const upload = useCallback(
    async (files: File[]): Promise<string[]> => {
      const urls: string[] = [];
      const failures: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress({ done: i, total: files.length });
        const answer = await uploadSiteImage(files[i], folder);
        if (answer.success) urls.push(answer.data);
        else failures.push(files.length > 1 ? `${files[i].name}: ${answer.error}` : answer.error);
      }
      setProgress(null);
      if (failures.length > 0) {
        toast({
          variant: "destructive",
          title: files.length > 1 ? `${failures.length} of ${files.length} images were not uploaded` : "The image was not uploaded",
          description: failures.join(" · "),
        });
      } else if (urls.length > 0) {
        toast({
          title: urls.length > 1 ? `${urls.length} images uploaded` : "Image uploaded",
          description: savedNote,
        });
      }
      return urls;
    },
    [folder, toast, savedNote],
  );
  return { progress, upload };
}

/** The latest value of a prop, for a callback that finishes after later renders (an upload). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Pick picture file(s) and upload them; `onUploaded` gets their public URLs. */
export function UploadButton({
  folder,
  onUploaded,
  multiple = false,
  label = "Upload",
  compact = false,
  savedNote,
}: {
  folder: TourMediaFolder;
  onUploaded: (urls: string[]) => void;
  multiple?: boolean;
  label?: string;
  /** Icon only, for a list row. */
  compact?: boolean;
  /** The second line of the "uploaded" toast, where there is no page to save (the media library). */
  savedNote?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { progress, upload } = useSiteImageUpload(folder, savedNote);
  const busy = progress !== null;
  const busyLabel = progress && progress.total > 1 ? `Uploading ${progress.done + 1}/${progress.total}…` : "Uploading…";
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={TOUR_MEDIA_ACCEPT}
        multiple={multiple}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ""; // the same file can be picked again
          if (files.length === 0) return;
          void upload(files).then((urls) => {
            if (urls.length > 0) onUploaded(urls);
          });
        }}
      />
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={compact ? "h-8 w-8 shrink-0" : "shrink-0"}
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? busyLabel : label}
        title={busy ? busyLabel : `${label} (${TOUR_MEDIA_TYPES_LABEL}, up to ${MAX_MB} MB)`}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {!compact && (busy ? busyLabel : label)}
      </Button>
    </>
  );
}

/** A line under an image address the site will not show (siteImageWarning). */
function HostWarning({ value, className }: { value: string; className?: string }) {
  const warning = siteImageWarning(value, STORAGE_HOST);
  if (!warning) return null;
  return (
    <p className={cn("flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400", className)}>
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {warning}
    </p>
  );
}

// ---------------------------------------------------------------- image fields
/** One image address with its thumbnail, or an uploaded file. */
export function ImageUrlField({
  label,
  value,
  onChange,
  siteUrl,
  hint,
  folder = "general",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  siteUrl: string | null | undefined;
  hint?: ReactNode;
  /** Where this editor's uploads are filed in the bucket. */
  folder?: TourMediaFolder;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex items-start gap-3">
        <SiteImage siteUrl={siteUrl} path={value} className="h-20 w-32 shrink-0" alt={label} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              id={id}
              dir="ltr"
              placeholder="/media/2026/07/picture.jpg"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className="font-mono text-xs"
            />
            <UploadButton folder={folder} onUploaded={([url]) => onChange(url)} />
            <MediaPickerButton onPick={onChange} />
          </div>
          <HostWarning value={value} />
        </div>
      </div>
    </Field>
  );
}

/** An ordered list of image addresses with thumbnails: reorder, remove, add by address or upload. */
export function ImageListEditor({
  label,
  value,
  onChange,
  siteUrl,
  hint,
  addLabel = "Add Image",
  folder = "general",
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  siteUrl: string | null | undefined;
  hint?: ReactNode;
  addLabel?: string;
  /** Where this editor's uploads are filed in the bucket. */
  folder?: TourMediaFolder;
}) {
  const latest = useLatest(value);
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      {value.length === 0 && <EmptyLine>No images</EmptyLine>}
      <ul className="space-y-2">
        {value.map((path, index) => (
          <li key={index} className="rounded-md border bg-background p-2">
            <div className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
              <SiteImage siteUrl={siteUrl} path={path} className="h-12 w-20 shrink-0" />
              <Input
                dir="ltr"
                aria-label={`${label} ${index + 1}`}
                placeholder="/media/2026/07/picture.jpg"
                value={path}
                onChange={(event) => onChange(value.map((v, i) => (i === index ? event.target.value : v)))}
                className="font-mono text-xs"
              />
              <UploadButton
                compact
                folder={folder}
                label="Upload a file for this image"
                onUploaded={([url]) => onChange(latest.current.map((v, i) => (i === index ? url : v)))}
              />
              <RowControls
                index={index}
                count={value.length}
                onMove={(delta) => onChange(moved(value, index, delta))}
                onRemove={() => onChange(value.filter((_, i) => i !== index))}
              />
            </div>
            <HostWarning value={path} className="mt-1.5 ps-8" />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
          <Plus />
          {addLabel}
        </Button>
        <UploadButton
          multiple
          folder={folder}
          label="Upload Images"
          onUploaded={(urls) => onChange([...latest.current, ...urls])}
        />
        <MediaPickerButton onPick={(url) => onChange([...latest.current, url])} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** An instructor gallery: address (or upload), title and caption per picture. */
export function GalleryItemsEditor({
  label,
  value,
  onChange,
  siteUrl,
  folder = "general",
}: {
  label: string;
  value: GalleryItem[];
  onChange: (value: GalleryItem[]) => void;
  siteUrl: string | null | undefined;
  /** Where this editor's uploads are filed in the bucket. */
  folder?: TourMediaFolder;
}) {
  const latest = useLatest(value);
  const patch = (index: number, change: Partial<GalleryItem>) =>
    onChange(value.map((item, i) => (i === index ? { ...item, ...change } : item)));
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      {value.length === 0 && <EmptyLine>No images</EmptyLine>}
      <ul className="space-y-2">
        {value.map((item, index) => (
          <li key={index} className="flex items-start gap-3 rounded-md border bg-background p-2">
            <SiteImage siteUrl={siteUrl} path={item.src} className="h-16 w-24 shrink-0" alt={item.title} />
            <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
              <div className="flex items-center gap-2 md:col-span-2">
                <Input
                  dir="ltr"
                  aria-label="Image URL"
                  placeholder="/media/2026/01/picture.webp"
                  value={item.src}
                  onChange={(event) => patch(index, { src: event.target.value })}
                  className="font-mono text-xs"
                />
                <UploadButton
                  compact
                  folder={folder}
                  label="Upload a file for this image"
                  onUploaded={([url]) =>
                    onChange(latest.current.map((current, i) => (i === index ? { ...current, src: url } : current)))
                  }
                />
              </div>
              <HostWarning value={item.src} className="md:col-span-2" />
              <Input
                dir="auto"
                aria-label="Title"
                placeholder="Title"
                value={item.title}
                onChange={(event) => patch(index, { title: event.target.value })}
              />
              <Input
                dir="auto"
                aria-label="Caption"
                placeholder="Caption"
                value={item.caption}
                onChange={(event) => patch(index, { caption: event.target.value })}
              />
            </div>
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { src: "", title: "", caption: "" }])}
        >
          <Plus />
          Add Image
        </Button>
        <UploadButton
          multiple
          folder={folder}
          label="Upload Images"
          onUploaded={(urls) => onChange([...latest.current, ...urls.map((src) => ({ src, title: "", caption: "" }))])}
        />
      </div>
    </div>
  );
}

/** An ordered list of short texts (attractions, what is included, amenities). */
export function StringListEditor({
  label,
  value,
  onChange,
  placeholder,
  addLabel = "Add Item",
  hint,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  hint?: ReactNode;
}) {
  const drag = useDragReorder((from, to) => onChange(movedTo(value, from, to)));
  return (
    <div className="space-y-2">
      <Label>
        {label} <span className="font-normal text-muted-foreground">({value.length})</span>
      </Label>
      <ul className="space-y-1.5">
        {value.map((item, index) => (
          <li
            key={index}
            {...drag.row(index)}
            className={cn("flex items-center gap-2 rounded-md", drag.dragging === index && "opacity-50", dropMarkClass(drag.mark(index)))}
          >
            {value.length > 1 && <DragGrip {...drag.grip(index)} />}
            <Input
              dir="auto"
              aria-label={`${label} ${index + 1}`}
              placeholder={placeholder}
              value={item}
              onChange={(event) => onChange(value.map((v, i) => (i === index ? event.target.value : v)))}
            />
            <RowControls
              index={index}
              count={value.length}
              onMove={(delta) => onChange(moved(value, index, delta))}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
        <Plus />
        {addLabel}
      </Button>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The note every image editor carries. */
export const IMAGE_FIELDS_NOTE = `Upload a picture (${TOUR_MEDIA_TYPES_LABEL}, up to ${MAX_MB} MB), or enter its address: a path on the site (/media/...) or a full https:// URL. A new picture reaches the site when the page is saved and published.`;

/** @deprecated The old name of IMAGE_FIELDS_NOTE, kept while package-editor.tsx imports it. */
export const NO_UPLOAD_NOTE = IMAGE_FIELDS_NOTE;
