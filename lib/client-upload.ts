"use client"

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"

// This is a client-side helper for uploading files directly to Supabase Storage
export async function uploadFileToSupabase(bucket: string, path: string, file: File) {
  const supabase = createClientComponentClient()

  const filePath = path ? `${path}/${file.name}` : file.name

  const { data, error } = await supabase.storage.from(bucket).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
  })

  if (error) throw error
  return data
}

