"use client";

import { supabase } from "@/lib/supabase-client";
import { getUploadUrl } from "@/lib/actions/storage-actions";

export async function uploadFile(bucket: string, path: string, file: File) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;
  return data;
}

/**
 * Upload a file straight from the browser to Supabase Storage via a
 * service-role-signed upload URL. The bytes never pass through a Vercel
 * function, so this bypasses the 4.5 MB serverless body limit that made large
 * images fail at the edge with "Request Entity Too Large" - which the old
 * `/api/storage/upload` caller then mis-reported as
 * `Unexpected token 'R', "Request En"... is not valid JSON`.
 *
 * `path` is an optional folder prefix; the file keeps its own name.
 * Returns the stored object path (use with `getPublicUrl`).
 */
/**
 * What the image bytes actually are, regardless of the file's extension.
 *
 * Images saved off the web are routinely WebP/AVIF wearing a `.png`/`.jpg`
 * name. Supabase serves by the stored content type WITH `nosniff`, so a
 * mislabelled image never renders - the browser shows a broken (black) tile.
 * Trusting magic bytes over the filename fixes the upload once, at the door.
 */
function sniffImageType(head: Uint8Array): { ext: string; mime: string } | null {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...head.subarray(start, start + length));

  if (head[0] === 0x89 && ascii(1, 3) === "PNG") return { ext: "png", mime: "image/png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return { ext: "jpg", mime: "image/jpeg" };
  if (ascii(0, 4) === "GIF8") return { ext: "gif", mime: "image/gif" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP")
    return { ext: "webp", mime: "image/webp" };
  if (ascii(4, 8) === "ftypavif") return { ext: "avif", mime: "image/avif" };
  return null;
}

export async function uploadToBucket(
  bucket: string,
  path: string,
  file: File,
): Promise<string> {
  // Correct a mislabelled image before it hits storage: real type from the
  // bytes, extension to match, content type stored explicitly.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  let name = file.name;
  let contentType = file.type || undefined;
  if (sniffed) {
    contentType = sniffed.mime;
    const dot = name.lastIndexOf(".");
    const currentExt = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
    const extAliases: Record<string, string> = { jpeg: "jpg" };
    if ((extAliases[currentExt] ?? currentExt) !== sniffed.ext) {
      name = `${dot >= 0 ? name.slice(0, dot) : name}.${sniffed.ext}`;
    }
  }

  const filePath = path ? `${path}/${name}` : name;

  // 1) Mint a one-time signed upload URL on the server (service role).
  const { token, path: signedPath } = await getUploadUrl(bucket, filePath);

  // 2) Stream the bytes client-side, directly to Supabase Storage.
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(signedPath, token, file, { contentType });

  if (error) throw error;
  return signedPath;
}
