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
  /** Severity drives the card colour: crit = blocks ads/feed, warn = page quality. */
  severity: "crit" | "warn";
  /** Where clicking the card takes you. */
  href: string;
}

export const GAP_META: Record<GapKind, GapMeta> = {
  event_creative: {
    kind: "event_creative",
    label: "אירועי פיד בלי קריאייטיב",
    severity: "crit",
    href: "/creative-generator",
  },
  event_card_image: {
    kind: "event_card_image",
    label: "אירועים בלי תמונת כרטיס",
    severity: "crit",
    href: "/events",
  },
  team_logo: {
    kind: "team_logo",
    label: "קבוצות בלי סמל",
    severity: "crit",
    href: "/templates/football",
  },
  team_hero: {
    kind: "team_hero",
    label: "קבוצות בלי תמונה ראשית",
    severity: "warn",
    href: "/templates/football",
  },
  artist_hero: {
    kind: "artist_hero",
    label: "אמנים בלי תמונה ראשית",
    severity: "warn",
    href: "/templates/artists",
  },
  team_gallery: {
    kind: "team_gallery",
    label: "קבוצות בלי גלריית אווירה",
    severity: "warn",
    href: "/templates/football",
  },
  artist_gallery: {
    kind: "artist_gallery",
    label: "אמנים בלי גלריית אווירה",
    severity: "warn",
    href: "/templates/artists",
  },
  category_image: {
    kind: "category_image",
    label: "קטגוריות בלי תמונה",
    severity: "warn",
    href: "/templates/categories",
  },
  blog_hero: {
    kind: "blog_hero",
    label: "פוסטים בלי תמונה ראשית",
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
  /** Extra context (event date, skip reason). */
  detail?: string;
}
