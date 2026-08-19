/**
 * Rich hub-page content for a category (`categories.page_content`, jsonb).
 *
 * Powers the myt-main vertical hub pages (/c/football, /c/music …) and the
 * league/genre pages under them. Every field is optional: a missing field
 * simply hides its section on the site, so a half-filled form is safe.
 *
 * SHARED SHAPE - keep in sync with myt-main `lib/taxonomy.types.ts`
 * (`CategoryPageContent`, `CategoryStadium`).
 */

/** A recommended venue card (אצטדיונים מומלצים) on a hub page. */
export interface CategoryStadium {
  name: string;
  city: string;
  /** Free text, e.g. "כ-74,000 מקומות". */
  capacity?: string;
  /** Home team(s) - free text. */
  teams?: string;
  description: string;
  image_url?: string | null;
}

export interface CategoryFaqItem {
  question: string;
  answer: string;
}

/** Generic title+text card - league/genre facts, destination tips, matchday info. */
export interface CategoryFactCard {
  title: string;
  text: string;
}

export interface CategoryPageContent {
  /** Cover lede - league/genre/destination pages ("טקסט על הבאנר"). */
  intro?: string;
  /** Heading above the marketing text. */
  seo_title?: string;
  /** Long-form marketing/SEO text. Blank line = new paragraph. */
  seo_text?: string;
  /** Gallery image URLs. */
  gallery?: string[];
  stadiums?: CategoryStadium[];
  /** "מידע מעניין" (leagues/genres) / "טוב לדעת" (destinations) cards. */
  facts?: CategoryFactCard[];
  faq?: CategoryFaqItem[];
  /** Team-category extras (עמוד קבוצה). */
  city_info?: CategoryFactCard;
  matchday?: CategoryFactCard[];
  honours?: string[];
}

/** True when nothing was filled in - stored as NULL rather than an empty object. */
export function isEmptyPageContent(c: CategoryPageContent): boolean {
  return (
    !c.intro?.trim() &&
    !c.seo_title?.trim() &&
    !c.seo_text?.trim() &&
    !c.gallery?.length &&
    !c.stadiums?.length &&
    !c.facts?.length &&
    !c.faq?.length &&
    !c.city_info &&
    !c.matchday?.length &&
    !c.honours?.length
  );
}
