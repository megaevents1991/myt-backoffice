"use client";

import { useState } from "react";
import { removeBackground } from "@imgly/background-removal";
import { ArrowLeftRight, ImagePlus, Link as LinkIcon, Loader2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { StorageImageBrowser } from "@/components/storage-image-browser";
import { trimTransparent } from "@/components/art-blob-picker";
import { getPublicUrl } from "@/lib/actions/storage-actions";
import { uploadToBucket } from "@/lib/upload-helper";
import {
  addToPool,
  moveToPool,
  removeFromPools,
  type GalleryPools,
  type GalleryUse,
} from "@/lib/person-gallery";

const POOL_TEXT: Record<GalleryUse, { title: string; hint: string; moveLabel: string; moveTitle: string }> = {
  page: {
    title: "Mood gallery (גלריית אווירה)",
    hint: "Shown on the page only - never on an event card or in an ad.",
    moveLabel: "To events",
    moveTitle: "Use this picture for event variety instead (event cards + Meta feed)",
  },
  events: {
    title: "Event variety (גיוון אירועים)",
    hint: "The site's event cards and the Meta feed creatives rotate through these, one per event. Cut-outs only - a plain photo looks wrong there.",
    moveLabel: "To mood",
    moveTitle: "Use this picture in the page's mood gallery instead",
  },
};

/**
 * A person's pictures in their two pools (lib/person-gallery.ts): the page's
 * mood gallery and - `withEvents`, artists only - the pictures event cards and
 * ads rotate through. A plain upload lands in the mood gallery, a cut-out in
 * the event pool; the button on each picture moves it to the other one.
 */
export function GalleryField({
  value,
  onChange,
  withEvents = false,
}: {
  value: GalleryPools;
  onChange: (pools: GalleryPools) => void;
  /** Offer the event pool. Off for teams: their events wear the crest. */
  withEvents?: boolean;
}) {
  const { toast } = useToast();
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [cutBusy, setCutBusy] = useState(false);

  const add = (use: GalleryUse, urls: string[]) => onChange(addToPool(value, use, urls));
  const total = value.page.length + value.events.length;

  // Same pipeline as ArtBlobPicker's "Upload + cut out": strip the background
  // in-browser, trim the transparent margin, upload to `templates` (never the
  // frozen legacy art_blobs bucket). Uploads that finished before a failure
  // are still added to the gallery.
  const handleCutFiles = async (files: File[]) => {
    const urls: string[] = [];
    // A cut-out is event art; where there is no event pool it joins the page.
    const target: GalleryUse = withEvents ? "events" : "page";
    setCutBusy(true);
    try {
      for (const file of files) {
        const blob = await removeBackground(file, {
          model: "isnet",
          output: { format: "image/png", quality: 1 },
        });
        const { blob: tight } = await trimTransparent(blob);
        const base = file.name.replace(/\.[^.]+$/, "");
        const out = new File([tight], `${base}-cutout-${Date.now()}.png`, {
          type: "image/png",
        });
        const storedPath = await uploadToBucket("templates", "", out);
        urls.push(await getPublicUrl("templates", storedPath));
      }
      toast({
        title: "Background removed",
        description: `${urls.length} cut-out${urls.length > 1 ? "s" : ""} added to ${
          target === "events" ? "event variety" : "the gallery"
        }.`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Couldn't process image",
        description: String((e as Error)?.message || e),
      });
    } finally {
      if (urls.length) add(target, urls);
      setCutBusy(false);
    }
  };

  const pool = (use: GalleryUse) => (
    <div className="space-y-2">
      {withEvents && (
        <div>
          <p className="text-sm font-medium">
            {POOL_TEXT[use].title}{" "}
            <span className="font-normal text-muted-foreground">· {value[use].length}</span>
          </p>
          <p className="text-xs text-muted-foreground">{POOL_TEXT[use].hint}</p>
        </div>
      )}
      {value[use].length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {value[use].map((u, i) => (
            <div
              key={u}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              <a href={u} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-full w-full object-cover" />
              </a>
              <span className="absolute left-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                #{i + 1}
              </span>
              {withEvents && (
                <button
                  type="button"
                  onClick={() => onChange(moveToPool(value, u, use === "page" ? "events" : "page"))}
                  title={POOL_TEXT[use].moveTitle}
                  className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white transition hover:bg-primary hover:text-primary-foreground"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  {POOL_TEXT[use].moveLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange(removeFromPools(value, u))}
                aria-label="Remove image"
                title="Remove from gallery"
                className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1.5 text-white opacity-80 transition hover:bg-red-600 hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        withEvents && <p className="text-xs text-muted-foreground">No pictures here yet.</p>
      )}
    </div>
  );

  return (
    <div id="fix-gallery" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StorageImageBrowser
          multiple
          uploadBucket="templates"
          onConfirm={(urls) => add("page", urls)}
          trigger={
            <Button type="button" variant="outline" size="sm">
              <ImagePlus className="h-4 w-4 mr-2" />
              Add from storage
            </Button>
          }
        />
        <Button asChild variant="outline" size="sm" disabled={cutBusy} type="button">
          <label className="cursor-pointer">
            {cutBusy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            {cutBusy ? "Processing…" : "Upload + cut out"}
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={cutBusy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) handleCutFiles(files);
              }}
            />
          </label>
        </Button>
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
              add("page", [url]);
              setUrl("");
            }}
            disabled={!url.trim()}
          >
            Add
          </Button>
        </div>
      )}

      {withEvents ? (
        <>
          <p className="text-xs text-muted-foreground">
            A new picture joins the mood gallery; &quot;Upload + cut out&quot; joins event variety.
            The button on a picture moves it to the other group. Click a photo to open it full
            size; × removes it. Saved on the next Save.
          </p>
          {pool("page")}
          {pool("events")}
        </>
      ) : total > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            {total} image{total > 1 ? "s" : ""} in the gallery - shown on the page. Click a photo
            to open it full size; × removes it (saved on the next Save).
          </p>
          {pool("page")}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No gallery images yet. Add from storage, by URL, or upload + cut out.
        </p>
      )}
    </div>
  );
}
