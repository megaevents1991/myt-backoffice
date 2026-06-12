"use client";

import { useState } from "react";
import { removeBackground } from "@imgly/background-removal";
import { Loader2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getPublicUrl } from "@/lib/actions/storage-actions";

// Mirror of the main app's EventArt palette + blob shapes so the preview here
// matches what customers see (myt-main: lib/eventArt.ts + components/ui/EventArt.tsx).
const COLORS = ["#5BFF95", "#45E2FF", "#BBA1FF", "#FF4F61", "#FACC15", "#FF9D4D"];
const BASE_SHAPES: { d: string; w: number; h: number }[] = [
  {
    d: "M376.567 312.293L311.733 247.245L360.413 239.179C395.964 233.277 409.983 189.739 384.522 164.305L331.689 111.226L370.84 104.771C398.3 100.259 409.156 66.545 389.487 46.8578L338.009 -4.75832C316.883 -25.942 286.807 -35.6261 257.394 -30.7155L185.469 -18.8338C158.009 -14.3216 147.154 19.3922 166.822 39.0795L194.851 67.1655L120.973 79.4455C85.4226 85.3477 71.4037 128.886 96.8645 154.319L133.914 191.587L46.4259 206.105C1.962 213.474 -15.5866 267.975 16.2236 299.904L99.5124 383.449C133.647 417.724 182.326 433.398 230.047 425.48L346.435 406.228C390.829 398.722 408.377 344.222 376.567 312.293Z",
    w: 400,
    h: 358,
  },
  {
    d: "M311.49 43.3357C307.568 14.9081 259.771 22.7798 196.776 58.596C179.306 -13.6957 151.603 -55.2606 127.922 -38.2394C104.241 -21.2181 91.9314 49.1704 95.8559 131.198C35.6311 184.076 -5.24942 239.816 -1.34339 268.128C2.57858 296.556 50.3756 288.684 113.371 252.868C130.86 321.145 157.627 359.699 180.55 343.223C203.473 326.746 215.732 260.141 212.981 181.334C273.956 128.235 315.428 71.8789 311.49 43.3357Z",
    w: 311,
    h: 311,
  },
  {
    d: "M414.973 186.331C410.064 153.061 341.982 130.658 251.657 128.637C228.526 39.1825 190.141 -23.6711 156.104 -20.5852C122.066 -17.4994 102.938 50.637 106.6 141.856C19.8136 160.072 -39.5599 193.893 -34.6713 227.028C-29.7628 260.298 38.3197 282.701 128.644 284.723C151.896 369.849 189.021 428.842 221.97 425.855C254.918 422.868 273.886 358.789 271.815 271.811C359.673 253.841 419.901 219.737 414.973 186.331Z",
    w: 315,
    h: 315,
  },
];
// 0-2 = originals, 3-5 = mirrored
const SHAPES = [
  ...BASE_SHAPES.map((s) => ({ ...s, mirror: false })),
  ...BASE_SHAPES.map((s) => ({ ...s, mirror: true })),
];
const BG = "#0A1A14"; // deep-forest-black, matches surface-inverse

const Blob = ({ shape, color }: { shape: number; color: string }) => {
  const s = SHAPES[shape % SHAPES.length];
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${s.w} ${s.h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <path
        d={s.d}
        fill={color}
        transform={s.mirror ? `translate(${s.w},0) scale(-1,1)` : undefined}
      />
    </svg>
  );
};

/**
 * Card-art editor: upload any photo → background is removed in-browser
 * (@imgly/background-removal) → the transparent cut-out is uploaded to the
 * `art_blobs` bucket and previewed on the chosen neon blob colour + shape.
 */
export function ArtBlobPicker({
  imageUrl,
  colorIndex,
  shapeIndex,
  onImage,
  onColor,
  onShape,
}: {
  imageUrl?: string | null;
  colorIndex?: number | null;
  shapeIndex?: number | null;
  onImage: (url: string) => void;
  onColor: (i: number) => void;
  onShape: (i: number) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const ci = colorIndex ?? 0;
  const si = shapeIndex ?? 0;

  const handleFile = async (file: File) => {
    try {
      setBusy(true);
      // Strip the background (runs in the browser via WASM).
      // Full-precision isnet: slower first run, noticeably cleaner alpha edges.
      const blob = await removeBackground(file, {
        model: "isnet",
        output: { format: "image/png", quality: 1 },
      });
      const base = file.name.replace(/\.[^.]+$/, "");
      const out = new File([blob], `${base}-cutout-${Date.now()}.png`, {
        type: "image/png",
      });

      const fd = new FormData();
      fd.append("bucket", "art_blobs");
      fd.append("path", "");
      fd.append("file", out);
      const res = await fetch("/api/storage/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");

      const url = await getPublicUrl("art_blobs", json.path);
      onImage(url);
      toast({ title: "Background removed", description: "Cut-out uploaded." });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Couldn't process image",
        description: String(e?.message || e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label>Card art — cut-out + blob</Label>

      {/* Live preview (what the customer sees) */}
      <div
        className="relative h-44 w-72 overflow-hidden rounded-xl border"
        style={{ background: BG }}
      >
        <Blob shape={si} color={COLORS[ci]} />
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Card art preview"
            className="absolute inset-0 h-full w-full object-contain object-bottom"
          />
        ) : null}
      </div>

      {/* URL + upload (with auto background removal) */}
      <div className="flex gap-2">
        <Input
          value={imageUrl ?? ""}
          onChange={(e) => onImage(e.target.value)}
          placeholder="Cut-out image URL (or upload to auto-remove background)"
          className="flex-1"
        />
        <Button asChild variant="outline" disabled={busy} type="button">
          <label className="cursor-pointer">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            <span className="ml-2">{busy ? "Processing…" : "Upload + cut out"}</span>
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(e) =>
                e.target.files?.[0] && handleFile(e.target.files[0])
              }
            />
          </label>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload a photo — the background is removed automatically, then the artist
        sits on the neon blob. Leave empty to show the full card image instead.
      </p>

      {/* Colour + shape pickers */}
      <div className="flex flex-wrap gap-6">
        <div>
          <Label className="text-xs">Blob colour</Label>
          <div className="mt-1 flex gap-1.5">
            {COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${i + 1}`}
                onClick={() => onColor(i)}
                className={`h-7 w-7 rounded-full border-2 ${
                  ci === i ? "border-foreground" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <Label className="text-xs">Blob shape</Label>
          <div className="mt-1 flex gap-1.5">
            {SHAPES.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Shape ${i + 1}`}
                onClick={() => onShape(i)}
                className={`relative h-7 w-11 overflow-hidden rounded border-2 ${
                  si === i ? "border-foreground" : "border-muted"
                }`}
                style={{ background: BG }}
              >
                <Blob shape={i} color={COLORS[ci]} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
