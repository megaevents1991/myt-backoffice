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

/** Blocks staff add from the board. Phase 1: slider + banner; phase 2 (2026-09-19): text, destinations, gallery. */
export const HOMEPAGE_BLOCK_TYPES = ["event_slider", "banner", "text", "destinations", "gallery"] as const;
export type HomepageBlockType = (typeof HOMEPAGE_BLOCK_TYPES)[number];
export type HomepageSectionType = "builtin" | HomepageBlockType;

export const HOMEPAGE_ITEM_KINDS = ["event", "artist", "team", "review"] as const;
export type HomepageItemKind = (typeof HOMEPAGE_ITEM_KINDS)[number];

/** Which kinds a builtin section's row accepts (every builtin has cards since 2026-10-14). */
export const SECTION_ITEM_KINDS: Record<HomepageSectionKey, HomepageItemKind[]> = {
  hero: ["artist", "team"],
  most_wanted: ["event"],
  newest: ["event"],
  football: ["team"],
  artists: ["artist"],
  reviews: ["review"],
  more_events: ["event"],
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
    rule: "תמיד ראשון. כל אמן/קבוצה עם אירוע זמין, אמן-קבוצה לסירוגין. נעוץ נשאר במקום שלו.",
  },
  most_wanted: {
    title: "המבוקשים ביותר",
    titleEn: "Most wanted",
    siteTitle: "המבוקשים ביותר",
    rule: "שורה אחת (12 אם לא נקבע אחרת). אירועים מסומנים Prioritized, ואז השלמה אוטומטית. נעוץ נשאר במקום שלו.",
  },
  newest: {
    title: "החדשים ביותר",
    titleEn: "Newest",
    siteTitle: "החדשים ביותר",
    rule: "שורה אחת (12 אם לא נקבע אחרת). האירועים שנוצרו לאחרונה, בלי מה שכבר במבוקשים. נעוץ נשאר במקום שלו.",
  },
  football: {
    title: "כדורגל",
    titleEn: "Football",
    siteTitle: "כדורגל",
    rule: "כל הקבוצות הפעילות, הזמינות באתר קודם (לפי שם). אפשר לנעוץ רק קבוצה זמינה.",
  },
  artists: {
    title: "אמנים מובילים",
    titleEn: "Artists",
    siteTitle: "אמנים מובילים",
    rule: "כל האמנים הפעילים, הזמינים באתר קודם (לפי שם). אפשר לנעוץ רק אמן זמין.",
  },
  reviews: {
    title: "לקוחות משתפים (Google)",
    titleEn: "Google reviews",
    siteTitle: "לקוחות משתפים",
    rule: "ביקורות 5 כוכבים עם טקסט מגוגל, החדשה קודם.",
  },
  more_events: {
    title: "אירועים נוספים",
    titleEn: "More events",
    siteTitle: "אירועים נוספים",
    rule: "כל אירועי המוזיקה שלא הופיעו בשתי השורות של האירועים, בגריד (בטלפון 5 ראשונים, במחשב 20, ואז 'הצג עוד').",
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
  text: {
    label: "טקסט",
    labelEn: "Text",
    rule: "כותרת (לא חובה) ופסקאות טקסט. שורה ריקה מפרידה בין פסקאות. בלי טקסט הבלוק לא נשמר.",
  },
  destinations: {
    label: "סליידר יעדים",
    labelEn: "Destinations slider",
    rule: "שורת אריחים של קטגוריות (יעדים, ליגות...). הקטגוריות שנבחרו ראשונות; אם נבחרה קטגוריית אב - אחריהן כל הילדים הפעילים שלה. כל אריח מוביל לעמוד הקטגוריה.",
  },
  gallery: {
    label: "גלריית תמונות",
    labelEn: "Image gallery",
    rule: "עד 12 תמונות בשורה נגללת. לכל תמונה תיאור קצר (לא חובה) שמשמש גם כטקסט חלופי.",
  },
};

/* ---------- block configs (jsonb - `type` aliases, assignable to Json) ---------- */

/**
 * A row's own settings (2026-10-14) - every builtin and every event slider:
 * `hidden` = cards removed from THIS row ("event:812", "team:liverpool",
 * "review:<key>"; a pin beats it), `max_items` = how many cards it shows
 * (absent = the row's default, lib/homepage/merge rowDefaultMax).
 */
export type RowSettings = { hidden?: string[]; max_items?: number };
/** category_id = the category whose events fill the row around the pinned ones; null = pinned only. */
export type EventSliderConfig = { category_id: number | null } & RowSettings;
export type BannerItem = { image_url: string; link_url: string | null; title: string | null };
export type BannerConfig = { banners: BannerItem[] };
/** body = plain text; a blank line separates paragraphs. */
export type TextConfig = { body: string };
/** category_ids = the tiles staff placed (board order); parent_id = its active children follow them. */
export type DestinationsConfig = { category_ids: number[]; parent_id: number | null };
export type GalleryImage = { image_url: string; alt: string | null };
export type GalleryConfig = { images: GalleryImage[] };
/** A builtin's config is its row settings (before 2026-10-14 only "החדשים" had one). */
export type BuiltinConfig = RowSettings;
export type HomepageSectionConfig =
  | EventSliderConfig
  | BannerConfig
  | TextConfig
  | DestinationsConfig
  | GalleryConfig
  | BuiltinConfig;

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
  /** The site's rows as it builds them now; failure = the board shows the pinned cards only. */
  pools: HomepagePoolsResult;
}

export interface SaveHomepageLayoutInput {
  sections: HomepageSectionRow[];
  items: HomepageItemRow[];
}

/**
 * One card the board draws - what myt-main's `/api/homepage-pools` sends
 * (`HomepageCard` in main's lib/homepage/rows.ts): the picture the site's card
 * shows, and the flags that decide whether it can be shown / pinned.
 */
export type HomepageCard = {
  ref: string;
  name: string;
  sub: string | null;
  image: string | null;
  image2: string | null;
  soldOut?: boolean;
  available?: boolean;
  prioritized?: boolean;
  vip?: boolean;
  date?: string;
  createdAt?: string | null;
  rating?: number;
};

/** A row's automatic pool (same shape as RowPool in lib/homepage/merge.ts). */
export type HomepagePool = string[] | { lanes: string[][] };

/** What the site's rows are made of right now (myt-main `/api/homepage-pools`). */
export type HomepagePools = {
  generatedAt: string;
  /** Builtin rows' automatic pools, in the site's order. */
  pools: Record<string, HomepagePool>;
  /** An event slider's pool per category id. */
  sliderPools: Record<string, string[]>;
  cards: HomepageCard[];
};

export type HomepagePoolsResult =
  | { ok: true; data: HomepagePools }
  | { ok: false; error: string };
