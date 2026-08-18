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

export interface CategoryPageContent {
  /** Heading above the marketing text. */
  seo_title?: string;
  /** Long-form marketing/SEO text. Blank line = new paragraph. */
  seo_text?: string;
  /** Gallery image URLs. */
  gallery?: string[];
  stadiums?: CategoryStadium[];
  faq?: CategoryFaqItem[];
}

/** True when nothing was filled in - stored as NULL rather than an empty object. */
export function isEmptyPageContent(c: CategoryPageContent): boolean {
  return (
    !c.seo_title?.trim() &&
    !c.seo_text?.trim() &&
    !c.gallery?.length &&
    !c.stadiums?.length &&
    !c.faq?.length
  );
}
