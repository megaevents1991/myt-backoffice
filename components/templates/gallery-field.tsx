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
