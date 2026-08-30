"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";
import {
  ALLOWED_LOGO_TYPES,
  duplicateLogoMessage,
  validateLogoFile,
} from "@/lib/football-logo-upload";
import type {
  CreateFootballLogoResult,
  FootballLogo,
  UpdateFootballLogoData,
} from "@/types/football-logo.types";

const BUCKET = "football-logos";
// Assets page hosts the library UI; creative-generator serves the picker list.
const REVALIDATE_PATHS = ["/assets", "/creative-generator"];

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

/**
 * Upload a crest into the library.
 *
 * Returns its failures - never throws them. Next masks the message of any error
 * thrown out of a server action in a production build ("An error occurred in
 * the Server Components render..."), which turned every refusal - duplicate
 * name, oversized file, wrong type, expired session - into the same unreadable
 * wall of text. `kind` tells the caller whose problem it is: only "server" is a
 * bug on our side.
 */
export async function createFootballLogo(
  formData: FormData,
): Promise<CreateFootballLogoResult> {
  try {
    try {
      await requireStaff();
    } catch {
      return {
        ok: false,
        kind: "auth",
        message: "ההרשאה פגה - רענן את הדף, התחבר מחדש ונסה שוב.",
      };
    }

    const entry = formData.get("file");
    const file = entry instanceof File ? entry : null;
    const nameEnglish = String(formData.get("name_english") ?? "").trim();
    const nameHebrewRaw = String(formData.get("name_hebrew") ?? "").trim();

    if (!file) {
      return { ok: false, kind: "invalid", message: "לא נבחר קובץ לוגו." };
    }
    if (!nameEnglish) {
      return { ok: false, kind: "invalid", message: "חובה למלא שם באנגלית." };
    }
    const fileError = validateLogoFile(file);
    if (fileError) return { ok: false, kind: "invalid", message: fileError };

    // Unique path per logo - random suffix avoids collisions and stale CDN
    // caches when a logo is re-uploaded under the same name.
    const ext = ALLOWED_LOGO_TYPES[file.type];
    const path = `${slugify(nameEnglish) || "logo"}-${crypto
      .randomUUID()
      .slice(0, 8)}.${ext}`;

    const buffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error("football logo storage upload failed:", JSON.stringify(uploadError));
      return {
        ok: false,
        kind: "server",
        message: "ההעלאה לאחסון (Supabase Storage) נכשלה.",
        detail: uploadError.message,
      };
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
      console.error("football logo insert failed:", JSON.stringify(error));
      if (error.code === "23505") {
        return {
          ok: false,
          kind: "conflict",
          message: duplicateLogoMessage(nameEnglish),
        };
      }
      return {
        ok: false,
        kind: "server",
        message: "שמירת הלוגו בטבלה נכשלה.",
        detail: error.message,
      };
    }

    await logAudit({
      action: "create",
      entityType: "football_logo",
      entityId: (data as FootballLogo).id,
      changes: { name_english: nameEnglish, name_hebrew: nameHebrewRaw || null },
    });
    REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
    await revalidateMain(); // site reads the library at render - refresh its ISR too
    return { ok: true, logo: data as FootballLogo };
  } catch (e) {
    // Anything unforeseen still reaches the screen as a named bug instead of
    // Next's masked digest.
    console.error("createFootballLogo crashed:", e);
    return {
      ok: false,
      kind: "server",
      message: "שגיאה לא צפויה בשרת בזמן ההעלאה.",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
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
