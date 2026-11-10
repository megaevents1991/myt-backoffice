/**
 * A date's own content (Alon 10.11, road map tab "בק אופיס לידים והזמנות" note 5: "לסאב טור אנחנו רוצים אופצייה לשנות את
 * האלמנטים שיש מהדסקריפשן הכללי של העמוד. ההיררכיה: אם שינינו לטיול ספציפי זה מה שמוצג - ואז אם אין את זה אז לפי העונה
 * שמשוייך - ואם לא משוייך לעונה אז מהכללי").
 *
 * The same fields a season says instead of the tour page (description, attractions, included / not included, top
 * picture, gallery), field by field: the date's own, else its season's, else the tour's. The day-by-day plan is not
 * here: the date already picks its itinerary version (General > Itinerary version).
 *
 * Stored in tours.departures.data.ownContent - no column, no migration: the site spreads a date's `data` into its
 * departure (mega-family lib/data/departures.mjs), and its `contentOf` lays the fields over the season's. Only filled
 * fields are kept; none = the key removed. The site's copy of this shape: mega-family lib/types.ts `DepartureContent`.
 * Pure - shared by the actions and the Content tab.
 */

export interface DepartureContentForm {
  descriptionHtml: string;
  attractions: string[];
  included: string[];
  notIncluded: string[];
  heroImage: string;
  gallery: string[];
}

export const EMPTY_DEPARTURE_CONTENT: DepartureContentForm = {
  descriptionHtml: "",
  attractions: [],
  included: [],
  notIncluded: [],
  heroImage: "",
  gallery: [],
};

export const CONTENT_FIELDS = ["descriptionHtml", "attractions", "included", "notIncluded", "heroImage", "gallery"] as const;
export type ContentField = (typeof CONTENT_FIELDS)[number];

/** What the Content tab shows: the date's own, and what it falls back to - its season's, then the tour's. */
export interface DepartureContentData {
  departureId: string;
  code: string;
  own: DepartureContentForm;
  /** The date's season and what it says instead of the tour page (an empty field = the tour's); null = no season. */
  season: { name: string; content: DepartureContentForm } | null;
  tour: DepartureContentForm;
  siteUrl: string | null;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : [];
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** "<p>&nbsp;</p>" is no description. */
export const hasHtmlText = (html: string): boolean => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;

/** `data.ownContent` as the form reads it - anything missing or broken is empty. */
export function readOwnContent(value: unknown): DepartureContentForm {
  const o = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    descriptionHtml: text(o.descriptionHtml),
    attractions: strings(o.attractions),
    included: strings(o.included),
    notIncluded: strings(o.notIncluded),
    heroImage: text(o.heroImage).trim(),
    gallery: strings(o.gallery),
  };
}

/** What is stored: the filled fields only; nothing filled = null (the key leaves `data`). */
export function storedOwnContent(form: DepartureContentForm): Record<string, string | string[]> | null {
  const out: Record<string, string | string[]> = {};
  if (hasHtmlText(form.descriptionHtml)) out.descriptionHtml = form.descriptionHtml;
  for (const key of ["attractions", "included", "notIncluded", "gallery"] as const) {
    const list = form[key].map((s) => s.trim()).filter(Boolean);
    if (list.length) out[key] = list;
  }
  if (form.heroImage.trim()) out.heroImage = form.heroImage.trim();
  return Object.keys(out).length ? out : null;
}

/** Is the field filled (what the site would show instead of the next level)? */
export const filled = (form: DepartureContentForm, key: ContentField): boolean =>
  key === "descriptionHtml" ? hasHtmlText(form.descriptionHtml) : key === "heroImage" ? !!form.heroImage.trim() : form[key].length > 0;

/** Where a field the date leaves empty comes from, and its value: the season's when it fills it, else the tour's. */
export function inheritedField<K extends ContentField>(data: Pick<DepartureContentData, "season" | "tour">, key: K): { from: "season" | "tour"; value: DepartureContentForm[K] } {
  if (data.season && filled(data.season.content, key)) return { from: "season", value: data.season.content[key] };
  return { from: "tour", value: data.tour[key] };
}
