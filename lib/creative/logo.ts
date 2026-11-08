/**
 * A world's logo for the branded tour pictures (components/creative/TourTemplate.tsx): fetched once, measured, and
 * handed to Satori as a data URI - Satori needs an image's size up front, and draws an SVG logo (Mega Events'
 * wordmark) only from data. PNG, JPEG and SVG; anything else (WebP) is not drawn, and the picture keeps the group's
 * logo alone. Pure parsing here; `loadLogo` is the one network call.
 */

export type LogoImage = { src: string; width: number; height: number; format: "png" | "jpeg" | "svg" };

/** The size and format of an image's bytes, or null when it is not a PNG, a JPEG or an SVG with a size. */
export function logoSize(bytes: Uint8Array): Omit<LogoImage, "src"> | null {
  // PNG: the IHDR chunk right after the signature
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: the first start-of-frame marker
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: "jpeg", height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      }
      i += 2 + view.getUint16(i + 2);
    }
    return null;
  }
  // SVG: width / height on the root, else its viewBox
  const head = new TextDecoder().decode(bytes.subarray(0, 4000));
  const root = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!root) return null;
  const num = (name: string) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, "i").exec(root);
    return m ? Number(m[1]) : NaN;
  };
  let width = num("width");
  let height = num("height");
  if (!(width > 0 && height > 0)) {
    const box = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(root);
    width = box ? Number(box[1]) : NaN;
    height = box ? Number(box[2]) : NaN;
  }
  return width > 0 && height > 0 ? { format: "svg", width, height } : null;
}

const MIME = { png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml" } as const;

/** The logo at `url`, ready for Satori, or null (no logo, not an image Satori draws, a site that does not answer). */
export async function loadLogo(url: string): Promise<LogoImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const size = logoSize(bytes);
    if (!size) return null;
    return { ...size, src: `data:${MIME[size.format]};base64,${Buffer.from(bytes).toString("base64")}` };
  } catch (e) {
    console.error("[tour-creatives] logo failed:", url, e instanceof Error ? e.message : e);
    return null;
  }
}

/** A box of at most `maxW` x `maxH` with the logo's proportions. Pure. */
export function fitBox(logo: { width: number; height: number }, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(maxW / logo.width, maxH / logo.height);
  return { width: Math.round(logo.width * scale), height: Math.round(logo.height * scale) };
}
