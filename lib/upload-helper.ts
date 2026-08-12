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
export async function uploadToBucket(
  bucket: string,
  path: string,
  file: File,
): Promise<string> {
  const filePath = path ? `${path}/${file.name}` : file.name;

  // 1) Mint a one-time signed upload URL on the server (service role).
  const { token, path: signedPath } = await getUploadUrl(bucket, filePath);

  // 2) Stream the bytes client-side, directly to Supabase Storage.
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(signedPath, token, file);

  if (error) throw error;
  return signedPath;
}
