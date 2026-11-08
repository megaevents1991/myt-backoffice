/**
 * Meta ACTIVITIES catalog CSV - the file shape Meta accepted for Mega Events' catalog.
 *
 * Port of myt-main `lib/feed/activitiesCatalog.ts` (`toActivitiesCsv` / `csvCell` / the header), which builds Mega
 * Events' own file on the site. The tours companies' file is built here instead (lib/feed/tours-feed.ts), from their
 * site's tours report, so the two serializers must stay byte-compatible: the same columns in the same order, no BOM,
 * CRLF rows, UTF-8. Do not add, drop or reorder columns without re-verifying an upload in Commerce Manager - and
 * change both copies together. Pure.
 */

export type ActivityRow = {
  id: string;
  image_link: string;
  brand: string;
  description: string;
  title: string;
  /** "938.70 EUR" */
  price: string;
  link: string;
  rating_count: number;
  user_rating: number;
  activity_category: string;
  performers: string;
  location_names: string;
  activity_sub_categories: string;
  /** YYYY-MM-DD */
  activity_date: string;
  custom_label_0: string;
  custom_label_1: string;
  custom_label_2: string;
  custom_label_3: string;
  custom_label_4: string;
};

/** The verified column set, in the verified order (myt-main CSV_HEADERS). */
export const ACTIVITIES_HEADERS = [
  "id",
  "image_link",
  "brand",
  "description",
  "title",
  "price",
  "link",
  "rating_count",
  "user_rating",
  "activity_category",
  "performers",
  "location_names",
  "activity_sub_categories",
  "activity_date",
  "custom_label_0",
  "custom_label_1",
  "custom_label_2",
  "custom_label_3",
  "custom_label_4",
] as const;

export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV in the verified-working byte format: no BOM, CRLF rows, UTF-8. */
export function toActivitiesCsv(rows: ActivityRow[]): string {
  const lines = rows.map((r) => ACTIVITIES_HEADERS.map((h) => csvCell(r[h])).join(","));
  return [ACTIVITIES_HEADERS.join(","), ...lines].join("\r\n") + "\r\n";
}
