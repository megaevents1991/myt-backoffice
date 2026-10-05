"use client";

/**
 * The company's media library as a grid of pictures, and the "Library" button
 * of the image fields that opens it in a dialog to pick one. The pictures are
 * the files of the company's own bucket (lib/actions/tours-media-actions.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Images, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { listTourMedia } from "@/lib/actions/tours-media-actions";
import { TOUR_MEDIA_FOLDERS, type TourMediaFile } from "@/lib/tours/media";
import { cn } from "@/lib/utils";
import { selectClass } from "@/components/tours/ui";

/** The folders of the bucket, as people read them. */
export const MEDIA_FOLDER_LABELS: Record<string, string> = {
  packages: "Tours",
  itinerary: "Itinerary",
  hotels: "Hotels",
  terms: "Categories & Tags",
  instructors: "Group Leaders",
  pages: "Content Pages",
  general: "Homepage & general",
};

const PAGE = 48;
const kb = (bytes: number | null): string => (bytes === null ? "" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const day = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : "");

/**
 * The pictures as tiles, with a search by file name and a folder filter. With
 * `onPick` a click on a tile picks it; without it each tile offers "Copy address".
 */
export function MediaGrid({ files, onPick }: { files: TourMediaFile[]; onPick?: (file: TourMediaFile) => void }) {
  const { toast } = useToast();
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [copied, setCopied] = useState<string | null>(null);

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return files.filter((file) => (!folder || file.folder === folder) && (!needle || file.name.toLowerCase().includes(needle)));
  }, [files, folder, q]);
  const page = found.slice(0, shown);

  const copy = async (file: TourMediaFile) => {
    try {
      await navigator.clipboard.writeText(file.url);
      setCopied(file.path);
      toast({ title: "Address copied" });
    } catch {
      toast({ variant: "destructive", title: "Could not copy", description: file.url });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search pictures by file name"
          placeholder="Search by file name"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setShown(PAGE);
          }}
          className="h-9 w-56"
        />
        <select
          aria-label="Folder"
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value);
            setShown(PAGE);
          }}
          className={selectClass}
        >
          <option value="">All folders</option>
          {TOUR_MEDIA_FOLDERS.map((name) => (
            <option key={name} value={name}>
              {MEDIA_FOLDER_LABELS[name] ?? name}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {found.length} {found.length === 1 ? "picture" : "pictures"}
        </span>
      </div>

      {found.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {files.length === 0 ? "No pictures were uploaded yet. Upload one here, or from any image field." : "No picture matches the search."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {page.map((file) => (
            <li key={file.path} className="overflow-hidden rounded-md border bg-card">
              <button
                type="button"
                onClick={() => (onPick ? onPick(file) : void copy(file))}
                title={onPick ? "Use this picture" : "Copy the picture's address"}
                className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by Storage, not by this app */}
                <img src={file.url} alt={file.name} loading="lazy" className="aspect-[4/3] w-full bg-muted object-cover" />
              </button>
              <div className="space-y-1 p-2">
                <p dir="ltr" className="truncate text-xs" title={file.name}>
                  {file.name}
                </p>
                <p className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{MEDIA_FOLDER_LABELS[file.folder] ?? file.folder}</span>
                  <span className="shrink-0">{[day(file.createdAt), kb(file.size)].filter(Boolean).join(" · ")}</span>
                </p>
                {!onPick && (
                  <Button type="button" variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => void copy(file)}>
                    {copied === file.path ? <Check /> : <Copy />}
                    {copied === file.path ? "Copied" : "Copy Address"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {found.length > shown && (
        <div className="text-center">
          <Button type="button" variant="outline" size="sm" onClick={() => setShown(shown + PAGE)}>
            Show More ({found.length - shown} left)
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Library" next to an image field: pick a picture that was already uploaded. */
export function MediaPickerButton({ onPick, compact = false }: { onPick: (url: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon" : "sm"}
        className={compact ? "h-8 w-8 shrink-0" : "shrink-0"}
        onClick={() => setOpen(true)}
        aria-label="Choose a picture from the media library"
        title="Choose a picture that was already uploaded"
      >
        <Images />
        {!compact && "Library"}
      </Button>
      {open && (
        <MediaPickerDialog
          onClose={() => setOpen(false)}
          onPick={(file) => {
            onPick(file.url);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function MediaPickerDialog({ onClose, onPick }: { onClose: () => void; onPick: (file: TourMediaFile) => void }) {
  const [files, setFiles] = useState<TourMediaFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listTourMedia().then((result) => {
      if (!alive) return;
      if (result.success) setFiles(result.data.files);
      else setError(result.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader className="pt-4 text-start sm:text-start">
          <DialogTitle>Media library</DialogTitle>
          <DialogDescription>Click a picture to use it. The newest uploads come first.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : files === null ? (
          <p className={cn("flex items-center gap-2 py-10 text-sm text-muted-foreground")}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the pictures…
          </p>
        ) : (
          <MediaGrid files={files} onPick={onPick} />
        )}
      </DialogContent>
    </Dialog>
  );
}
