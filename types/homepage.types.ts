/**
 * Homepage layout (עמוד הבית) - the order of the myt-main homepage sections
 * and of the items inside each carousel. Written by the /homepage board here,
 * read by myt-main `lib/homepageLayout.ts`. Keep the KEYS in sync with main.
 */

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

export const HOMEPAGE_ITEM_KINDS = ["event", "artist", "team"] as const;
export type HomepageItemKind = (typeof HOMEPAGE_ITEM_KINDS)[number];

/** Which kinds a section's strip accepts; empty = no manual items (order/visibility only). */
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
  { title: string; titleEn: string; rule: string }
> = {
  hero: {
    title: "הירו - קרוסלת אמנים וקבוצות",
    titleEn: "Hero ring",
    rule: "תמיד ראשון. הפריטים שכאן מוצגים לפי הסדר; אחריהם כל אמן/קבוצה עם אירוע זמין, אמן-קבוצה לסירוגין.",
  },
  most_wanted: {
    title: "המבוקשים ביותר",
    titleEn: "Most wanted",
    rule: "שורה אחת (עד 12). הפריטים שכאן ראשונים; אחריהם אירועים מסומנים Prioritized ואז השלמה אוטומטית.",
  },
  newest: {
    title: "החדשים ביותר",
    titleEn: "Newest",
    rule: "שורה אחת (עד 12). הפריטים שכאן ראשונים; אחריהם האירועים שנוצרו לאחרונה (לא כאלה שכבר במבוקשים).",
  },
  football: {
    title: "כדורגל",
    titleEn: "Football",
    rule: "כל הקבוצות הפעילות. זמינות באתר תמיד קופצות קדימה; בתוך כל קבוצה - הסדר שכאן, השאר לפי שם.",
  },
  artists: {
    title: "אמנים מובילים",
    titleEn: "Artists",
    rule: "כל האמנים הפעילים. זמינים באתר תמיד קופצים קדימה; בתוך כל קבוצה - הסדר שכאן, השאר לפי שם.",
  },
  reviews: {
    title: "לקוחות משתפים (Google)",
    titleEn: "Google reviews",
    rule: "ביקורות מהמראה של גוגל. רק מיקום והסתרה.",
  },
  more_events: {
    title: "אירועים נוספים",
    titleEn: "More events",
    rule: "כל אירועי המוזיקה שלא הופיעו למעלה, בגריד. רק מיקום והסתרה.",
  },
};

export interface HomepageSectionRow {
  key: HomepageSectionKey;
  position: number;
  is_visible: boolean;
}

export interface HomepageItemRow {
  section: HomepageSectionKey;
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

export interface HomepageLayout {
  sections: HomepageSectionRow[];
  items: HomepageItemRow[];
  candidates: HomepageCandidate[];
}

export interface SaveHomepageLayoutInput {
  sections: HomepageSectionRow[];
  items: HomepageItemRow[];
}
