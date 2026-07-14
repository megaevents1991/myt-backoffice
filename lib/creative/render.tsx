import { ImageResponse } from "next/og";
import { supabase } from "@/lib/supabase-server";
import { MatchTemplate, type CreativeInput } from "@/components/creative/MatchTemplate";

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
      `Brand font missing — upload a TTF to creatives/${ASSETS.font} (status ${res.status})`,
    );
  }
  fontCache = await res.arrayBuffer();
  return fontCache;
}

export function getBackgroundUrl(): string {
  const { data } = supabase.storage.from("creatives").getPublicUrl(ASSETS.bg);
  return data.publicUrl;
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
