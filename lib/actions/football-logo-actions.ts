"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";
import type {
  FootballLogo,
  UpdateFootballLogoData,
} from "@/types/football-logo.types";

const BUCKET = "football-logos";
// Assets page hosts the library UI; creative-generator serves the picker list.
const REVALIDATE_PATHS = ["/assets", "/creative-generator"];
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB - logos are small assets
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

// Tables aren't in Supabase generated types yet - cast like template-crud.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logos = () => (supabase as any).from("football_logos");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getFootballLogos(): Promise<FootballLogo[]> {
  await requireStaff();
  const { data, error } = await logos()
    .select("id,name_english,name_hebrew,logo_url,created_at")
    .order("name_english", { ascending: true });
  if (error) {
    // Don't take the whole creative-generator page down (e.g. migration not
    // applied yet) - log and behave like an empty library.
    console.error(JSON.stringify(error));
    return [];
  }
  return (data ?? []) as FootballLogo[];
}

export async function createFootballLogo(
  formData: FormData,
): Promise<FootballLogo> {
  await requireStaff();
  const file = formData.get("file") as File | null;
  const nameEnglish = String(formData.get("name_english") ?? "").trim();
  const nameHebrewRaw = String(formData.get("name_hebrew") ?? "").trim();

  if (!file || file.size === 0) throw new Error("Logo file is required");
  if (!nameEnglish) throw new Error("English name is required");
  if (file.size > MAX_FILE_BYTES) throw new Error("File too large (max 2MB)");
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new Error("Only PNG, SVG, WebP or JPG files are allowed");

  // Unique path per logo - random suffix avoids collisions and stale CDN
  // caches when a logo is re-uploaded under the same name.
  const path = `${slugify(nameEnglish) || "logo"}-${crypto
    .randomUUID()
    .slice(0, 8)}.${ext}`;

  const buffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error(JSON.stringify(uploadError));
    throw new Error("Logo upload failed");
  }

  const logoUrl = supabase.storage.from(BUCKET).getPublicUrl(path)
    .data.publicUrl;

  const { data, error } = await logos()
    .insert({
      name_english: nameEnglish,
      name_hebrew: nameHebrewRaw || null,
      logo_url: logoUrl,
    })
    .select()
    .single();
  if (error) {
    // Roll the orphan file back so the bucket doesn't collect strays.
    await supabase.storage.from(BUCKET).remove([path]);
    console.error(JSON.stringify(error));
    if (error.code === "23505") {
      throw new Error(`A logo named "${nameEnglish}" already exists`);
    }
    throw new Error("Failed to save logo");
  }

  await logAudit({
    action: "create",
    entityType: "football_logo",
    entityId: (data as FootballLogo).id,
    changes: { name_english: nameEnglish, name_hebrew: nameHebrewRaw || null },
  });
  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  await revalidateMain(); // site reads the library at render - refresh its ISR too
  return data as FootballLogo;
}

export async function updateFootballLogo(
  id: number,
  update: UpdateFootballLogoData,
): Promise<FootballLogo> {
  await requireStaff();
  const nameEnglish = update.name_english?.trim();
  if (nameEnglish !== undefined && !nameEnglish) {
    throw new Error("English name cannot be empty");
  }
  const mapped: Record<string, string | null> = {};
  if (nameEnglish !== undefined) mapped.name_english = nameEnglish;
  if (update.name_hebrew !== undefined) {
    mapped.name_hebrew = update.name_hebrew?.trim() || null;
  }
  const { data, error } = await logos()
    .update(mapped)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error(JSON.stringify(error));
    if (error.code === "23505") {
      throw new Error(`A logo named "${nameEnglish}" already exists`);
    }
    throw new Error("Failed to update logo");
  }
  await logAudit({
    action: "update",
    entityType: "football_logo",
    entityId: id,
    changes: mapped,
  });
  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  await revalidateMain(); // site reads the library at render - refresh its ISR too
  return data as FootballLogo;
}

export async function deleteFootballLogo(id: number): Promise<void> {
  await requireStaff();
  const { data, error } = await logos()
    .select("id,logo_url")
    .eq("id", id)
    .single();
  if (error) {
    console.error(JSON.stringify(error));
    throw new Error("Logo not found");
  }

  const { error: delError } = await logos().delete().eq("id", id);
  if (delError) {
    console.error(JSON.stringify(delError));
    throw new Error("Failed to delete logo");
  }

  // Best-effort storage cleanup - the row is the source of truth.
  const url: string = (data as FootballLogo).logo_url;
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    const path = decodeURIComponent(url.slice(idx + marker.length));
    const { error: rmError } = await supabase.storage
      .from(BUCKET)
      .remove([path]);
    if (rmError) console.error(JSON.stringify(rmError));
  }

  await logAudit({
    action: "delete",
    entityType: "football_logo",
    entityId: id,
  });
  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  await revalidateMain(); // site reads the library at render - refresh its ISR too
}
