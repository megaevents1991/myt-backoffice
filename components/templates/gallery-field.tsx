"use client";

import { useState } from "react";
import { removeBackground } from "@imgly/background-removal";
import { ImagePlus, Link as LinkIcon, Loader2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { StorageImageBrowser } from "@/components/storage-image-browser";
import { trimTransparent } from "@/components/art-blob-picker";
import { getPublicUrl } from "@/lib/actions/storage-actions";
import { uploadToBucket } from "@/lib/upload-helper";

export function GalleryField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  const { toast } = useToast();
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [cutBusy, setCutBusy] = useState(false);

  const add = (urls: string[]) => {
    const merged = [...value];
    for (const u of urls) {
      const t = u.trim();
      if (t && !merged.includes(t)) merged.push(t);
    }
    onChange(merged);
  };
  const remove = (u: string) => onChange(value.filter((x) => x !== u));

  // Same pipeline as ArtBlobPicker's "Upload + cut out": strip the background
  // in-browser, trim the transparent margin, upload to `templates` (never the
  // frozen legacy art_blobs bucket). Uploads that finished before a failure
  // are still added to the gallery.
  const handleCutFiles = async (files: File[]) => {
    const urls: string[] = [];
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
        description: `${urls.length} cut-out${urls.length > 1 ? "s" : ""} added to the gallery.`,
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Couldn't process image",
        description: String((e as Error)?.message || e),
      });
    } finally {
      if (urls.length) add(urls);
      setCutBusy(false);
    }
  };

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
          No gallery images yet. Add from storage, by URL, or upload + cut out.
        </p>
      )}
    </div>
  );
}
