/**
 * Football-logo upload rules, shared by the client widgets and the server
 * action. One copy on purpose: the client checks the same limits before the
 * file leaves the browser (instant, exact message), the server re-checks them
 * because a server action is a public endpoint.
 */
import type { FootballLogo } from "@/types/football-logo.types";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB - logos are small assets

/** MIME type → file extension. The allow-list IS this map's keys. */
export const ALLOWED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/** `accept` attribute for the file inputs - same list, one source. */
export const LOGO_ACCEPT = Object.keys(ALLOWED_LOGO_TYPES).join(",");

/** Just the file part of a picked logo - the client passes a File, so does the server. */
type PickedFile = { size: number; type: string };

/**
 * Hebrew reason the file can't be uploaded, or null when it's fine.
 * Names the actual size/type so the operator knows what to fix.
 */
export function validateLogoFile(file: PickedFile): string | null {
  if (!file.size) return "הקובץ ריק (0 בייט) - בחר קובץ אחר.";
  if (file.size > MAX_LOGO_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `הקובץ שוקל ${mb}MB, המקסימום הוא 2MB - כווץ אותו או בחר גרסה קטנה יותר.`;
  }
  if (!ALLOWED_LOGO_TYPES[file.type]) {
    const shown = file.type || "לא מזוהה";
    return `סוג הקובץ (${shown}) לא נתמך - מותר PNG, SVG, WebP או JPG בלבד.`;
  }
  return null;
}

/**
 * The library row that already holds this english name, if any.
 * Case-insensitive to match the DB's `unique (lower(name_english))` index -
 * catching it here turns a masked 23505 into a sentence before anything uploads.
 */
export function findDuplicateLogo(
  logos: FootballLogo[],
  nameEnglish: string,
): FootballLogo | undefined {
  const name = nameEnglish.trim().toLowerCase();
  if (!name) return undefined;
  return logos.find((l) => l.name_english.trim().toLowerCase() === name);
}

/** The one duplicate-name sentence, shared by the client pre-flight and the server. */
export function duplicateLogoMessage(nameEnglish: string): string {
  return `כבר קיים לוגו בשם "${nameEnglish}" בספרייה - ערוך או מחק את הקיים במקום להעלות שוב.`;
}
