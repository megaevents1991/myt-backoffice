"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

// Get all buckets
export async function getBuckets() {
  await requireStaff();
  const { data, error } = await supabase.storage.listBuckets();

  if (error) throw error;
  return data;
}

// Create a new bucket
export async function createBucket(name: string, isPublic = false) {
  await requireStaff();
  const { data, error } = await supabase.storage.createBucket(name, {
    public: isPublic,
  });

  if (error) throw error;
  await logAudit({
    action: "create",
    entityType: "storage",
    entityId: name,
    metadata: { public: isPublic },
  });
  revalidatePath("/storage");
  return data;
}

// Delete a bucket
export async function deleteBucket(name: string) {
  await requireStaff();
  const { error } = await supabase.storage.deleteBucket(name);

  if (error) throw error;
  await logAudit({ action: "delete", entityType: "storage", entityId: name });
  revalidatePath("/storage");
  return true;
}

// Get files in a bucket
export async function getFiles(bucket: string, path = "") {
  await requireStaff();
  const { data, error } = await supabase.storage.from(bucket).list(path, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) throw error;
  return data;
}

// Delete a file
export async function deleteFile(bucket: string, path: string) {
  await requireStaff();
  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) throw error;
  await logAudit({
    action: "delete",
    entityType: "storage",
    entityId: `${bucket}/${path}`,
  });
  revalidatePath("/storage");
  return true;
}

// Get public URL for a file
export async function getPublicUrl(bucket: string, path: string) {
  await requireStaff();
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// Create a signed URL for a file (for private buckets)
export async function createSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 60,
) {
  await requireStaff();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

// Create a folder (by uploading an empty file with a special name)
export async function createFolder(bucket: string, path: string) {
  await requireStaff();
  // In Supabase Storage, folders are virtual and created when files are uploaded
  // We'll create an empty file with a .folder extension to simulate a folder
  const folderPath = path.endsWith("/") ? `${path}.folder` : `${path}/.folder`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(folderPath, new Uint8Array(0), {
      contentType: "application/x-directory",
    });

  if (error) throw error;
  await logAudit({
    action: "create",
    entityType: "storage",
    entityId: `${bucket}/${folderPath}`,
  });
  revalidatePath("/storage");
  return true;
}

// Generate a signed upload URL for client-side uploads
export async function getUploadUrl(bucket: string, path: string) {
  await requireStaff();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return data;
}

// Server-side file upload (for small files)
export async function uploadFile(formData: FormData) {
  await requireStaff();
  const bucket = formData.get("bucket") as string;
  const path = formData.get("path") as string;
  const file = formData.get("file") as File;

  if (!bucket || !file) {
    throw new Error("Missing required parameters");
  }

  const filePath = path ? `${path}/${file.name}` : file.name;

  const buffer = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, { contentType: file.type, upsert: false });

  if (error) throw error;
  await logAudit({
    action: "create",
    entityType: "storage",
    entityId: `${bucket}/${filePath}`,
  });
  revalidatePath("/storage");
  return { success: true, path: filePath };
}

export async function uploadImageFromUrl(
  imageUrl: string,
  bucket: string,
  fileName: string,
) {
  await requireStaff();
  try {
    const response = await fetch(imageUrl);
    if (!response.ok)
      throw new Error(`Failed to fetch image: ${response.statusText}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: response.headers.get("content-type") || "image/svg+xml",
        upsert: true,
      });

    if (error) throw error;

    await logAudit({
      action: "create",
      entityType: "storage",
      entityId: `${bucket}/${fileName}`,
      metadata: { source: "url" },
    });

    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Error uploading image from URL:", error);
    return null;
  }
}

export type StorageImage = {
  bucket: string;
  path: string;
  name: string;
  url: string;
  size: number | null;
  updatedAt: string | null;
};

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg)$/i;

// List image files in one PUBLIC bucket, recursing into virtual folders (cap depth ~2).
// Only public buckets are browsed on purpose: the picked URL is persisted verbatim
// (gallery / card_image_url / map_image_url / art_image_url, all read by the main app
// as plain URLs), so it must be a permanent public URL - never an expiring signed URL.
// A failed listing logs and returns [] so one bad bucket never fails the sweep.
async function listImagesInBucket(
  bucket: string,
  prefix = "",
  depth = 0,
): Promise<StorageImage[]> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error) {
    console.error(JSON.stringify(error));
    return [];
  }

  const out: StorageImage[] = [];
  for (const item of data ?? []) {
    if (item.name === ".folder") continue;
    const path = prefix ? `${prefix}/${item.name}` : item.name;

    // Supabase Storage returns folders as rows with a null `id`/`metadata`.
    const isFolder = item.id === null;
    if (isFolder) {
      if (depth < 2) {
        out.push(...(await listImagesInBucket(bucket, path, depth + 1)));
      }
      continue;
    }

    if (!IMAGE_EXT_RE.test(item.name)) continue;

    out.push({
      bucket,
      path,
      name: item.name,
      url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
      size: item.metadata?.size ?? null,
      updatedAt: item.updated_at ?? null,
    });
  }
  return out;
}

// Enumerate image files across every PUBLIC bucket, in parallel, merged flat.
// Private buckets are skipped - their signed URLs expire and would rot once persisted.
export async function listAllBucketImages(): Promise<StorageImage[]> {
  await requireStaff();
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error(JSON.stringify(error));
    return [];
  }
  const perBucket = await Promise.all(
    (buckets ?? [])
      .filter((b) => b.public)
      .map((b) => listImagesInBucket(b.name)),
  );
  return perBucket.flat();
}
