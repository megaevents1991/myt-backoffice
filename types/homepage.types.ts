/**
 * Homepage layout (עמוד הבית) - the order of the myt-main homepage sections,
 * the items inside each carousel, staff titles and the blocks staff add
 * themselves. Written by the /homepage board here, read by myt-main
 * `lib/homepageLayout.ts`. Keep the KEYS, the block types and the config shapes
 * in sync with main.
 */

/** The page every row belongs to today. The column exists so another page can follow. */
export const HOMEPAGE_PAGE = "home";

/** The sections coded in myt-main ("builtin"). */
export const HOMEPAGE_SECTION_KEYS = [
  "hero",
  "most_wanted",
  "newest",
  "football",
  "artists",
  "reviews",
  "more_events",
] as const;
export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

/** Blocks staff add from the board. Text / destinations / gallery are phase 2. */
export const HOMEPAGE_BLOCK_TYPES = ["event_slider", "banner"] as const;
export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];
export type HomepageSectionType = "builtin" | HomepageBlockType;

export const HOMEPAGE_ITEM_KINDS = ["event", "artist", "team"] as const;
export type HomepageItemKind = (typeof HOMEPAGE_ITEM_KINDS)[number];

/** Which kinds a builtin section's strip accepts; empty = no manual items (order/visibility only). */
export const SECTION_ITEM_KINDS: Record<HomepageSectionKey, HomepageItemKind[]> = {
  hero: ["artist", "team"],
  most_wanted: ["event"],
  newest: ["event"],
  football: ["team"],
  artists: ["artist"],
  reviews: [],
  more_events: [],
};

export const SECTION_META: Record<
  HomepageSectionKey,
  {
    /** The board's own label for the section. */
    title: string;
    titleEn: string;
    /** The heading myt-main shows when staff set no title. null = the site shows none. */
    siteTitle: string | null;
    rule: string;
  }
> = {
  hero: {
    title: "הירו - קרוסלת אמנים וקבוצות",
    titleEn: "Hero ring",
    siteTitle: null,
    rule: "תמיד ראשון. הפריטים שכאן מוצגים לפי הסדר; אחריהם כל אמן/קבוצה עם אירוע זמין, אמן-קבוצה לסירוגין.",
  },
  most_wanted: {
    title: "המבוקשים ביותר",
    titleEn: "Most wanted",
    siteTitle: "המבוקשים ביותר",
    rule: "שורה אחת (עד 12). הפריטים שכאן ראשונים; אחריהם אירועים מסומנים Prioritized ואז השלמה אוטומטית.",
  },
  newest: {
    title: "החדשים ביותר",
    titleEn: "Newest",
    siteTitle: "החדשים ביותר",
    rule: "שורה אחת (עד 12). הפריטים שכאן ראשונים; אחריהם האירועים שנוצרו לאחרונה (לא כאלה שכבר במבוקשים).",
  },
  football: {
    title: "כדורגל",
    titleEn: "Football",
    siteTitle: "כדורגל",
    rule: "כל הקבוצות הפעילות. זמינות באתר תמיד קופצות קדימה; בתוך כל קבוצה - הסדר שכאן, השאר לפי שם.",
  },
  artists: {
    title: "אמנים מובילים",
    titleEn: "Artists",
    siteTitle: "אמנים מובילים",
    rule: "כל האמנים הפעילים. זמינים באתר תמיד קופצים קדימה; בתוך כל קבוצה - הסדר שכאן, השאר לפי שם.",
  },
  reviews: {
    title: "לקוחות משתפים (Google)",
    titleEn: "Google reviews",
    siteTitle: "לקוחות משתפים",
    rule: "ביקורות מהמראה של גוגל. רק מיקום והסתרה.",
  },
  more_events: {
    title: "אירועים נוספים",
    titleEn: "More events",
    siteTitle: "אירועים נוספים",
    rule: "כל אירועי המוזיקה שלא הופיעו למעלה, בגריד. רק מיקום והסתרה.",
  },
};

export const BLOCK_META: Record<HomepageBlockType, { label: string; labelEn: string; rule: string }> = {
  event_slider: {
    label: "סליידר אירועים",
    labelEn: "Event slider",
    rule: "שורה אחת (עד 12). האירועים שכאן ראשונים; אם נבחרה קטגוריה - אחריהם האירועים שלה, הקרוב ביותר קודם. בלי פריטים ובלי קטגוריה הבלוק לא מוצג.",
  },
  banner: {
    label: "באנרים",
    labelEn: "Banners",
    rule: "עד 3 באנרים: תמונה, קישור וכותרת. הכותרת מוצגת על התמונה ומשמשת גם כטקסט חלופי.",
  },
};

/* ---------- block configs (jsonb - `type` aliases, assignable to Json) ---------- */

/** category_id = the category whose events fill the row after the pinned ones; null = pinned only. */
export type EventSliderConfig = { category_id: number | null };
export type BannerItem = { image_url: string; link_url: string | null; title: string | null };
export type BannerConfig = { banners: BannerItem[] };
export type HomepageSectionConfig = EventSliderConfig | BannerConfig | Record<string, never>;

export interface HomepageSectionRow {
  /** A builtin key, or `blk_` + 8 hex chars for a block. */
  key: string;
  type: HomepageSectionType;
  /** Staff title; null = the default in code (builtin) / no heading (block). */
  title: string | null;
  config: HomepageSectionConfig;
  position: number;
  is_visible: boolean;
}

export interface HomepageItemRow {
  section: string;
  kind: HomepageItemKind;
  ref_id: string;
  position: number;
}

/** A pickable / listed thing on the board - enough to draw a mini card. */
export interface HomepageCandidate {
  kind: HomepageItemKind;
  ref_id: string;
  name: string;
  subtitle: string | null;
  image_url: string | null;
  /** Events only: is_prioritized flag, shown as a hint on the card. */
  prioritized?: boolean;
  /** Events only: ISO date the row was created (the "newest" auto rule). */
  created_at?: string | null;
}

/** A category an event slider can fill itself from. */
export interface HomepageCategoryOption {
  id: number;
  name: string;
  /** Its /c/ path on the site, for telling two same-named categories apart. */
  path: string;
}

export interface HomepageLayout {
  sections: HomepageSectionRow[];
  items: HomepageItemRow[];
  candidates: HomepageCandidate[];
  categories: HomepageCategoryOption[];
  /** false = the blocks migration has not run yet: titles and blocks cannot be saved. */
  blocksReady: boolean;
}

export interface SaveHomepageLayoutInput {
  sections: HomepageSectionRow[];
  items: HomepageItemRow[];
}
