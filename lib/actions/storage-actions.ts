"use server";

import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

// Get all buckets
export async function getBuckets() {
  const { data, error } = await supabase.storage.listBuckets();

  if (error) throw error;
  return data;
}

// Create a new bucket
export async function createBucket(name: string, isPublic = false) {
  const { data, error } = await supabase.storage.createBucket(name, {
    public: isPublic,
  });

  if (error) throw error;
  revalidatePath("/storage");
  return data;
}

// Delete a bucket
export async function deleteBucket(name: string) {
  const { error } = await supabase.storage.deleteBucket(name);

  if (error) throw error;
  revalidatePath("/storage");
  return true;
}

// Get files in a bucket
export async function getFiles(bucket: string, path = "") {
  const { data, error } = await supabase.storage.from(bucket).list(path, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });

  if (error) throw error;
  return data;
}

// Delete a file
export async function deleteFile(bucket: string, path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) throw error;
  revalidatePath("/storage");
  return true;
}

// Get public URL for a file
export async function getPublicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// Create a signed URL for a file (for private buckets)
export async function createSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 60,
) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

// Create a folder (by uploading an empty file with a special name)
export async function createFolder(bucket: string, path: string) {
  // In Supabase Storage, folders are virtual and created when files are uploaded
  // We'll create an empty file with a .folder extension to simulate a folder
  const folderPath = path.endsWith("/") ? `${path}.folder` : `${path}/.folder`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(folderPath, new Uint8Array(0), {
      contentType: "application/x-directory",
    });

  if (error) throw error;
  revalidatePath("/storage");
  return true;
}

// Generate a signed upload URL for client-side uploads
export async function getUploadUrl(bucket: string, path: string) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) throw error;
  return data;
}

// Server-side file upload (for small files)
export async function uploadFile(formData: FormData) {
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
  revalidatePath("/storage");
  return { success: true, path: filePath };
}

export async function uploadImageFromUrl(
  imageUrl: string,
  bucket: string,
  fileName: string,
) {
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

    const { data: publicUrlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error("Error uploading image from URL:", error);
    return null;
  }
}
