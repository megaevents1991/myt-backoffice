/**
 * Pure helpers of the tours catalog (categories and tags, catalog hotels,
 * group leaders): the slug and code a new row gets, and when two names are the
 * same. Plain module - no "use server", no database - so the create actions
 * (lib/actions/tours-catalog-actions.ts) and any screen can share it.
 */

/** Longest slug a new row gets; a uniqueness suffix may follow it. */
const SLUG_MAX = 100;

/**
 * The slug of a new row, worded like the slugs the site was imported with
 * (WordPress `sanitize_title`): Hebrew stays Hebrew, Latin is lower case
 * without accents, spaces become "-", and punctuation is dropped -
 * `ארה"ב (מזרח)` -> `ארהב-מזרח`, `K+K Hotel Opera` -> `kk-hotel-opera`.
 * Never contains / ? # % or quotes. Empty when the name has no letter or digit.
 */
export function catalogSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // accents, Hebrew vowel points
    .toLowerCase()
    .replace(/[\s_./\\–—]+/g, "-") // separators become a hyphen
    .replace(/[^\p{L}\p{N}-]+/gu, "") // every other mark: ' " ( ) , + ? # % ״ ...
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** `base`, else `base-2`, `base-3`... - the first one not in `taken` (compared in lower case). */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (s) => s.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** A short random tail for a code: 6 lower-case letters and digits. */
const randomTail = (): string => globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 6);

/**
 * The code of a new catalog hotel - what a departure's hotel option points at.
 * The imported codes are the hotel's slug (`le-marceau-bastille`); a new one is
 * the ASCII part of its slug, or `hotel-` + a short random tail when the name
 * has too little Latin in it (a Hebrew name). Unique in `taken`.
 */
export function hotelCode(slug: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (s) => s.toLowerCase()));
  const ascii = slug
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 3 && /[a-z]/.test(ascii)) return uniqueSlug(ascii, used);
  for (;;) {
    const candidate = `hotel-${randomTail()}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Two names are the same when they match ignoring case and extra spaces. */
export const nameKey = (name: string): string => name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

/** The position after the last one (0 for the first row). */
export const nextPosition = (rows: readonly { position: number }[]): number =>
  rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
