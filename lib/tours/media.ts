/**
 * Site media of a tours company: the rules of an uploaded image, shared by the
 * upload action (lib/actions/tours-media-actions.ts) and the image fields of
 * the content editors (components/tours/content/fields.tsx).
 *
 * Pure - no server or browser imports - so both sides read the same limits.
 * The bucket enforces the same size and types itself
 * (migration 20261002110000_tours_media_bucket.sql).
 */

/** Where an upload is filed inside the company's bucket: one folder per editor. */
export const TOUR_MEDIA_FOLDERS = ["packages", "itinerary", "hotels", "terms", "instructors", "pages", "general"] as const;
export type TourMediaFolder = (typeof TOUR_MEDIA_FOLDERS)[number];

/** 10 MB - the bucket's file_size_limit. */
export const TOUR_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** The image types the bucket accepts, with the extension the stored file gets. No SVG: it can carry script. */
export const TOUR_MEDIA_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;
export type TourMediaType = keyof typeof TOUR_MEDIA_TYPES;

export const isTourMediaType = (value: string): value is TourMediaType =>
  Object.prototype.hasOwnProperty.call(TOUR_MEDIA_TYPES, value);

/** The `accept` attribute of the file pickers. */
export const TOUR_MEDIA_ACCEPT = Object.keys(TOUR_MEDIA_TYPES).join(",");

export const TOUR_MEDIA_TYPES_LABEL = "JPG, PNG, WebP, GIF or AVIF";

/** The company's public media bucket (integration plan: one bucket per company, media-<slug>). */
export const tourMediaBucket = (companySlug: string): string => `media-${companySlug}`;

/** What the upload action answers: where to send the bytes, and the address the site loads them from. */
export interface TourMediaUpload {
  bucket: string;
  path: string;
  token: string;
  publicUrl: string;
}

/**
 * The file name part of a stored object: ASCII letters and digits only, so
 * the URL needs no escaping (Hebrew names and spaces fall away). Never empty.
 * A WordPress size suffix ("-1024x683") is dropped: the site strips one from
 * page images (mediaOriginal) and would ask for a file that does not exist.
 */
export function mediaFileStem(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "");
  const ascii = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-\d{2,4}x\d{2,4}$/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return ascii || "image";
}

/**
 * `<folder>/<yyyy>/<mm>/<random>-<name>.<ext>` - the extension follows the
 * checked content type, never the name the file came with.
 */
export function tourMediaPath(input: {
  folder: TourMediaFolder;
  fileName: string;
  contentType: TourMediaType;
  now: Date;
  random: string;
}): string {
  const yyyy = String(input.now.getUTCFullYear());
  const mm = String(input.now.getUTCMonth() + 1).padStart(2, "0");
  const ext = TOUR_MEDIA_TYPES[input.contentType];
  return `${input.folder}/${yyyy}/${mm}/${input.random}-${mediaFileStem(input.fileName)}.${ext}`;
}

/** The old WordPress host: the site still serves its `/wp-content/...` pictures. */
export const LEGACY_SITE_IMAGE_HOST = "newsite.megatr.co.il";

/**
 * A hint for a full image URL the company's site will not show. The site loads
 * full URLs from public Storage of this Supabase project and from the old
 * WordPress host only (its next.config remotePatterns). Paths (`/media/...`)
 * and empty values are fine. A hint only - the save does not check hosts.
 */
export function siteImageWarning(value: string, storageHost: string | null): string | null {
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return "This is not a valid address.";
  }
  if (url.hostname === LEGACY_SITE_IMAGE_HOST) return null;
  if (storageHost && url.host === storageHost) {
    return url.pathname.startsWith("/storage/v1/object/public/")
      ? null
      : "Only a public Storage link shows on the site. This one is private or expires.";
  }
  return "This host will not show on the site. Upload the file instead, or use a /media/... path.";
}
