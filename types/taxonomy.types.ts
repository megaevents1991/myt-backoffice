/**
 * ONE category table: `categories` - the Templates card the team builds, which
 * also carries the tree (`parent_id`) and the tags that compose it
 * (`category_tags`). The old parallel `event_categories` node is gone; see the
 * one_category_table migration.
 *
 * Mirrored in main as lib/taxonomy.types.ts - keep both in sync.
 */
export type EventCategory = {
  id: number;
  parent_id: number | null;
  slug: string;
  name: string;
  name_english: string | null;
  image_url: string | null;
  /** Card strapline, doubles as the category page's meta description. */
  subtitle: string | null;
  display_order: number;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

// Built in memory from a flat EventCategory[] for tree UI + traversal.
export type EventCategoryNode = EventCategory & {
  children: EventCategoryNode[];
};

/**
 * Tag kind - drives the feed's custom_label mapping (vertical→0,
 * league|genre→1, team|artist→2, city→3), nav grouping and facet groups.
 */
export const TAG_TYPES = [
  "vertical",
  "league",
  "team",
  "artist",
  "genre",
  "city",
  "other",
] as const;
export type TagType = (typeof TAG_TYPES)[number];

export type EventTag = {
  id: number;
  slug: string;
  name: string;
  name_english: string | null;
  type: TagType;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Auto-tagger rule: events matching `pattern` get `tag_id` (additive only).
 * field "name" = case-insensitive contains vs name + name_english;
 * field "city" = case-insensitive equality vs location->>'city_iata'.
 * Backoffice-only - not mirrored to main.
 */
export type TagRuleField = "name" | "city";

export type TagRule = {
  id: number;
  tag_id: number;
  field: TagRuleField;
  pattern: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AssignMode = "add" | "replace" | "remove";
