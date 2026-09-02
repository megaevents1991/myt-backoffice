/** Creative-gaps panel: everything on the site missing a visual asset. */

export const GAP_KINDS = [
  "event_creative",
  "event_card_image",
  "team_logo",
  "team_hero",
  "artist_hero",
  "team_gallery",
  "artist_gallery",
  "category_image",
  "blog_hero",
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export interface GapMeta {
  kind: GapKind;
  /** Hebrew label shown on the panel card. */
  label: string;
  /** Compact label for the "Type" column of the unified list. */
  short: string;
  /** Severity drives the card colour: crit = blocks ads/feed, warn = page quality. */
  severity: "crit" | "warn";
  /** Where clicking the card takes you. */
  href: string;
}

export const GAP_META: Record<GapKind, GapMeta> = {
  event_creative: {
    kind: "event_creative",
    label: "אירועי פיד בלי קריאייטיב",
    short: "קריאייטיב",
    severity: "crit",
    href: "/creative-generator",
  },
  event_card_image: {
    kind: "event_card_image",
    label: "אירועים בלי תמונת כרטיס",
    short: "תמונת כרטיס",
    severity: "crit",
    href: "/events",
  },
  team_logo: {
    kind: "team_logo",
    label: "קבוצות בלי סמל",
    short: "סמל קבוצה",
    severity: "crit",
    href: "/templates/football",
  },
  team_hero: {
    kind: "team_hero",
    label: "קבוצות בלי תמונה ראשית",
    short: "תמונת קבוצה",
    severity: "warn",
    href: "/templates/football",
  },
  artist_hero: {
    kind: "artist_hero",
    label: "אמנים בלי תמונה ראשית",
    short: "תמונת אמן",
    severity: "warn",
    href: "/templates/artists",
  },
  team_gallery: {
    kind: "team_gallery",
    label: "קבוצות בלי גלריית אווירה",
    short: "גלריית קבוצה",
    severity: "warn",
    href: "/templates/football",
  },
  artist_gallery: {
    kind: "artist_gallery",
    label: "אמנים בלי גלריית אווירה",
    short: "גלריית אמן",
    severity: "warn",
    href: "/templates/artists",
  },
  category_image: {
    kind: "category_image",
    label: "קטגוריות בלי תמונה",
    short: "תמונת קטגוריה",
    severity: "warn",
    href: "/templates/categories",
  },
  blog_hero: {
    kind: "blog_hero",
    label: "פוסטים בלי תמונה ראשית",
    short: "תמונת פוסט",
    severity: "warn",
    href: "/templates/blog",
  },
};

export interface GapCounts {
  counts: Record<GapKind, number>;
  total: number;
}

/** One concrete missing asset, listed on the gaps tab. */
export interface GapItem {
  kind: GapKind;
  table: string;
  row_id: string | number;
  label: string;
  /** Edit URL for the specific entity. */
  url: string;
  /**
   * Deep link onto the control that actually fixes this gap - the logo field,
   * the gallery picker, the creative generator with the event preselected.
   * Powers the "Do" button; the anchors live in the forms as id="fix-*".
   */
  fixUrl: string;
  /** Extra context (event date, skip reason). */
  detail?: string;
}

/**
 * Stable identity of a gap. The kind is part of it because one team can be
 * missing its crest AND its gallery, and those are two separate jobs - keying
 * on the row alone would let a task about one silently claim the other.
 *
 * Lives here rather than in the actions file: a "use server" module may only
 * export async functions.
 */
export function gapKey(
  kind: string,
  table: string,
  rowId: string | number,
): string {
  return `${kind}:${table}:${rowId}`;
}
