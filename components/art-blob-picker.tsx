"use client";

import { useState } from "react";
import { removeBackground } from "@imgly/background-removal";
import { Loader2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { ImageFilePicker } from "@/components/image-file-picker";
import { getPublicUrl } from "@/lib/actions/storage-actions";
import { uploadToBucket } from "@/lib/upload-helper";

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
// Photo backgrounds — shape indices 6-8 (after the 6 blobs). Additive: the same
// cut-out sits on a photo instead of a neon blob. Files duplicated in
// myt-main public/art-backgrounds (same convention as the blob constants).
const BACKGROUNDS = [
  { src: "/art-backgrounds/cars.jpg", label: "Cars" },
  { src: "/art-backgrounds/tennis.jpg", label: "Tennis" },
  { src: "/art-backgrounds/football.jpg", label: "Football" },
];
const BG = "#0A1A14"; // deep-forest-black, matches surface-inverse

const Blob = ({
  shape,
  color,
  scale = 1,
}: {
  shape: number;
  color: string;
  scale?: number;
}) => {
  const s = SHAPES[shape % SHAPES.length];
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${s.w} ${s.h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
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
 * Crops the fully-transparent margin off a cut-out and caps its long edge.
 *
 * `removeBackground` erases the background but KEEPS the source photo's
 * canvas, so a press shot with headroom yields a cut-out where the subject
 * fills only part of the frame. The site contain-fits the whole canvas, empty
 * pixels included, so that padding renders as a small artist floating in the
 * card — the Backstreet Boys / Deep Purple / Noah Kahan bug. Trimming here
 * means a padded cut-out can't reach the site in the first place.
 *
 * Returns the original blob unchanged on any failure or when there is nothing
 * to trim — never blocks an upload.
 */
// Matting leaves a veil of near-invisible pixels far outside the subject, so a
// plain "alpha > 0" bounding box can span the whole canvas and trim nothing
// (Jay-Z: subject covered 52% of the width, the alpha veil covered 100%). Only
// solidly opaque pixels define the subject, and a row/column needs more than a
// speck of them to count.
const ALPHA_SOLID = 200;
const MIN_RUN = 0.002; // ≥0.2% of the row/column must be solid
const MAX_EDGE = 2400; // long-edge cap — keeps cut-outs off the multi-MB range
const WASTED_LIMIT = 0.1; // ≥10% empty canvas is worth a re-crop

async function trimTransparent(blob: Blob): Promise<{ blob: Blob; trimmed: boolean }> {
  const unchanged = { blob, trimmed: false };
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return unchanged;
    ctx.drawImage(bitmap, 0, 0);

    const { data } = ctx.getImageData(0, 0, width, height);
    const rowHits = new Uint32Array(height);
    const colHits = new Uint32Array(width);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < ALPHA_SOLID) continue;
        rowHits[y]++;
        colHits[x]++;
      }
    }
    const firstLast = (hits: Uint32Array, span: number) => {
      const min = Math.max(1, Math.floor(span * MIN_RUN));
      let a = -1;
      let b = -1;
      for (let i = 0; i < hits.length; i++)
        if (hits[i] >= min) {
          if (a < 0) a = i;
          b = i;
        }
      return [a, b] as const;
    };
    const [top, bottom] = firstLast(rowHits, width);
    const [left, right] = firstLast(colHits, height);
    if (right < 0 || bottom < 0) return unchanged; // nothing solid — leave it alone

    const cropW = right - left + 1;
    const cropH = bottom - top + 1;
    // A press photo can be 5000px wide / ~9 MB; cards never render above ~800.
    const shrink = Math.min(1, MAX_EDGE / Math.max(cropW, cropH));
    // A hair of margin is not worth a re-upload; the site contain-fits fine.
    const wasted = 1 - (cropW / width) * (cropH / height);
    if (wasted < WASTED_LIMIT && shrink === 1) return unchanged;

    const out = document.createElement("canvas");
    out.width = Math.round(cropW * shrink);
    out.height = Math.round(cropH * shrink);
    const outCtx = out.getContext("2d");
    if (!outCtx) return unchanged;
    outCtx.drawImage(canvas, left, top, cropW, cropH, 0, 0, out.width, out.height);
    const trimmedBlob = await new Promise<Blob>((resolve) =>
      out.toBlob((b) => resolve(b ?? blob), "image/png")
    );
    return { blob: trimmedBlob, trimmed: trimmedBlob !== blob };
  } catch {
    return unchanged;
  }
}

/**
 * Card-art editor: upload any photo → background is removed in-browser
 * (@imgly/background-removal) → the transparent cut-out is uploaded to the
 * `templates` bucket and previewed on the chosen neon blob colour + shape.
 *
 * IMPORTANT: never upload NEW files into `art_blobs`. The main app treats
 * that bucket as the frozen legacy padded-cutout set (custom sizing, dial
 * ignored); everything else gets the uniform crest standard. A new image
 * landing in art_blobs rendered full-bleed on the site — this broke Inter,
 * Bayern/Roma, then PSG. Browsing/reusing EXISTING art_blobs cutouts is fine.
 */
export function ArtBlobPicker({
  imageUrl,
  colorIndex,
  shapeIndex,
  imageScale,
  bgScale,
  imageOffsetX,
  imageOffsetY,
  label = "Card art — cut-out + blob",
  autoTrim = true,
  onImage,
  onColor,
  onShape,
  onImageScale,
  onBgScale,
  onImageOffsetX,
  onImageOffsetY,
}: {
  imageUrl?: string | null;
  colorIndex?: number | null;
  shapeIndex?: number | null;
  /** Cut-out zoom, 1 = 100%. */
  imageScale?: number | null;
  /** Background (blob/photo) zoom, 1 = 100%. */
  bgScale?: number | null;
  /** Cut-out position, % of frame (0 = default). X+ = right, Y+ = down. */
  imageOffsetX?: number | null;
  imageOffsetY?: number | null;
  label?: string;
  /**
   * Crop empty margin off any image assigned here (default). Turn OFF for
   * football CRESTS: their margin is deliberate — myt-main sizes them with
   * FOOTBALL_CREST_ART on the stadium background, and tightening a crest is
   * what broke Inter, Bayern/Roma and PSG.
   */
  autoTrim?: boolean;
  onImage: (url: string) => void;
  onColor: (i: number) => void;
  onShape: (i: number) => void;
  onImageScale?: (s: number) => void;
  onBgScale?: (s: number) => void;
  onImageOffsetX?: (v: number) => void;
  onImageOffsetY?: (v: number) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const ci = colorIndex ?? 0;
  const si = shapeIndex ?? 0;
  const imgScale = imageScale ?? 1;
  const backScale = bgScale ?? 1;
  const offX = imageOffsetX ?? 0;
  const offY = imageOffsetY ?? 0;

  /**
   * Every path that sets the cut-out URL funnels through here — the file
   * upload above already trims, this covers the OTHER two: pasting a URL and
   * browsing storage. Without it a padded PNG dropped straight into a bucket
   * sailed past the trim and rendered as a small subject floating in the card.
   * Padded art is re-cropped, uploaded to `templates`, and the field gets the
   * new URL; anything already tight is passed through untouched (no duplicate
   * upload when reusing an existing cut-out).
   */
  const handlePickedUrl = async (url: string) => {
    // A photo background (shapeIndex ≥ 6) IS the crest card configuration, so
    // treat that image as a crest wherever this picker is used — the events
    // form has no artist/team flag to pass.
    const crestCard = si >= SHAPES.length;
    if (!autoTrim || crestCard || !/^https?:\/\//i.test(url)) {
      onImage(url);
      return;
    }
    onImage(url); // show it immediately; normalize behind the scenes
    try {
      setBusy(true);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const { blob, trimmed } = await trimTransparent(await res.blob());
      if (!trimmed) return;
      const base = (url.split("/").pop() ?? "art").replace(/\.[^.]+$/, "").slice(0, 60);
      const file = new File([blob], `${decodeURIComponent(base)}-tight-${Date.now()}.png`, {
        type: "image/png",
      });
      const storedPath = await uploadToBucket("templates", "", file);
      onImage(await getPublicUrl("templates", storedPath));
      toast({
        title: "Cut-out trimmed",
        description: "Empty margin cropped so the artist fills the card.",
      });
    } catch (e: unknown) {
      // Never block the pick — a cross-origin image just can't be measured.
      toast({
        title: "Couldn't check this image",
        description:
          "Using it as-is. If it has empty space around the subject it will render small — re-upload it with \"Upload + cut out\".",
      });
      console.error("art trim check failed:", e);
    } finally {
      setBusy(false);
    }
  };

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
      const { blob: tight } = await trimTransparent(blob);
      const out = new File([tight], `${base}-cutout-${Date.now()}.png`, {
        type: "image/png",
      });

      const storedPath = await uploadToBucket("templates", "", out);

      const url = await getPublicUrl("templates", storedPath);
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
      <Label>{label}</Label>

      {/* Live preview (what the customer sees) */}
      <div
        className="relative h-44 w-72 overflow-hidden rounded-xl border"
        style={{ background: BG }}
      >
        {si >= SHAPES.length ? (
          // object-contain: the whole photo stays visible while zooming — no
          // corner ever cropped until the user zooms past the frame on purpose.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={BACKGROUNDS[(si - SHAPES.length) % BACKGROUNDS.length].src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-contain"
            style={{ transform: `scale(${backScale})`, transformOrigin: "center" }}
          />
        ) : (
          <Blob shape={si} color={COLORS[ci]} scale={backScale} />
        )}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Card art preview"
            className="absolute inset-0 h-full w-full object-contain object-bottom"
            style={{
              transform: `translate(${offX}%, ${offY}%) scale(${imgScale})`,
              transformOrigin: "bottom center",
            }}
          />
        ) : null}
      </div>

      {/* URL + browse (same storage dialog as the regular image fields).
          Default bucket is templates so manual uploads NEVER land in the
          legacy art_blobs bucket; existing art_blobs cut-outs stay reachable
          via allBuckets. */}
      <ImageFilePicker
        value={imageUrl ?? ""}
        onChange={handlePickedUrl}
        label="Cut-out image"
        bucketName="templates"
        allBuckets
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
      <p className="text-xs text-muted-foreground">
        &quot;Upload + cut out&quot; removes the background automatically; the folder
        button browses cut-outs already in art_blobs (reuse for artists with
        multiple events). Leave empty to show the full card image instead.
      </p>

      {/* Colour + shape pickers */}
      <div className="flex flex-wrap gap-6">
        {si < SHAPES.length && (
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
        )}
        <div>
          <Label className="text-xs">Background — blob / photo</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
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
            {BACKGROUNDS.map((b, i) => {
              const idx = SHAPES.length + i;
              return (
                <button
                  key={b.src}
                  type="button"
                  aria-label={`${b.label} background`}
                  title={b.label}
                  onClick={() => onShape(idx)}
                  className={`relative h-7 w-11 overflow-hidden rounded border-2 ${
                    si === idx ? "border-foreground" : "border-muted"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.src}
                    alt={b.label}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zoom + position sliders (only when the parent persists the values) */}
      {(onImageScale || onBgScale || onImageOffsetX || onImageOffsetY) && (
        <div className="flex max-w-72 flex-col gap-3">
          {onImageScale && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Cut-out zoom</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(imgScale * 100)}%
                </span>
              </div>
              <Slider
                className="mt-1"
                min={50}
                max={200}
                step={5}
                value={[Math.round(imgScale * 100)]}
                onValueChange={([v]) => onImageScale(v / 100)}
              />
            </div>
          )}
          {onImageOffsetX && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Cut-out position ↔</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(offX)}%
                </span>
              </div>
              <Slider
                className="mt-1"
                min={-50}
                max={50}
                step={1}
                value={[Math.round(offX)]}
                onValueChange={([v]) => onImageOffsetX(v)}
              />
            </div>
          )}
          {onImageOffsetY && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Cut-out position ↕</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(offY)}%
                </span>
              </div>
              <Slider
                className="mt-1"
                min={-50}
                max={50}
                step={1}
                value={[Math.round(offY)]}
                onValueChange={([v]) => onImageOffsetY(v)}
              />
            </div>
          )}
          {onBgScale && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Background zoom</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(backScale * 100)}%
                </span>
              </div>
              <Slider
                className="mt-1"
                min={50}
                max={200}
                step={5}
                value={[Math.round(backScale * 100)]}
                onValueChange={([v]) => onBgScale(v / 100)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
