import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase-server";
import {
  MatchTemplate,
  BLOB_HEX,
  BLOB_SHAPES,
  type CreativeInput,
} from "@/components/creative/MatchTemplate";

export const SIZES = {
  square: { width: 1080, height: 1080 },
  banner: { width: 1200, height: 628 },
} as const;
export type CreativeSize = keyof typeof SIZES;

const ASSETS = {
  font: "assets/font.ttf",
  bg: "assets/bg-default.png",
} as const;

let fontCache: ArrayBuffer | null = null;

async function loadBrandFont(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache;
  const { data } = supabase.storage.from("creatives").getPublicUrl(ASSETS.font);
  const res = await fetch(data.publicUrl);
  if (!res.ok) {
    throw new Error(
      `Brand font missing - upload a TTF to creatives/${ASSETS.font} (status ${res.status})`,
    );
  }
  fontCache = await res.arrayBuffer();
  return fontCache;
}

export function getBackgroundUrl(): string {
  const { data } = supabase.storage.from("creatives").getPublicUrl(ASSETS.bg);
  return data.publicUrl;
}

// Standalone brand blob on a transparent canvas - a design asset for events
// that don't have a cut-out image yet. Deterministic color/shape from `seed`
// (same hash the site uses for card art), no font needed.
export async function renderBlobPng(
  seed: number,
  size: CreativeSize,
): Promise<ArrayBuffer> {
  const { width, height } = SIZES[size];
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const color = BLOB_HEX[h % BLOB_HEX.length];
  // Unsigned shift - h can exceed 2^31-1 (still a valid uint32 from >>>0
  // above); a signed `>>` would ToInt32 that into a negative number and
  // produce a negative array index (undefined.w crash).
  const shape = BLOB_SHAPES[(h >>> 3) % BLOB_SHAPES.length];
  const scale = Math.min(width / shape.w, height / shape.h) * 0.85;
  const bw = Math.round(shape.w * scale);
  const bh = Math.round(shape.h * scale);
  const image = new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "transparent",
        }}
      >
        <svg width={bw} height={bh} viewBox={`0 0 ${shape.w} ${shape.h}`}>
          <path d={shape.d} fill={color} />
        </svg>
      </div>
    ),
    { width, height },
  );
  return image.arrayBuffer();
}

export async function renderCreativePng(
  input: CreativeInput,
  size: CreativeSize,
): Promise<ArrayBuffer> {
  const { width, height } = SIZES[size];
  const font = await loadBrandFont();
  const image = new ImageResponse(
    <MatchTemplate {...input} width={width} height={height} bgUrl={getBackgroundUrl()} />,
    {
      width,
      height,
      fonts: [{ name: "brand", data: font, style: "normal", weight: 700 }],
    },
  );
  return image.arrayBuffer();
}
