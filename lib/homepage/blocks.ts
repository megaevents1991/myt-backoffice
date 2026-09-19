/**
 * The rules every /homepage save goes through - staff titles, block keys, and
 * the config of each block type. Pure (no DB, no fetch, no Next): it runs under
 * plain `npx tsx scripts/homepage-blocks-selftest.ts`, and the board imports the
 * same constants the server enforces.
 *
 * Spec: docs/superpowers/specs/2026-09-18-homepage-blocks-design.md
 * Relative imports on purpose - the selftest runs without the `@/` alias.
 */

import {
  BLOCK_META,
  HOMEPAGE_BLOCK_TYPES,
  HOMEPAGE_SECTION_KEYS,
  SECTION_ITEM_KINDS,
  type BannerConfig,
  type BannerItem,
  type DestinationsConfig,
  type EventSliderConfig,
  type GalleryConfig,
  type GalleryImage,
  type HomepageBlockType,
  type HomepageItemKind,
  type HomepageSectionConfig,
  type HomepageSectionKey,
  type HomepageSectionRow,
  type HomepageSectionType,
  type TextConfig,
} from "../../types/homepage.types";

/** Staff-added blocks per page. The homepage is ISR'd and image-heavy - a ceiling, not a target. */
export const MAX_BLOCKS = 12;
export const MAX_BANNERS = 3;
export const TITLE_MAX = 60;
export const TEXT_MAX = 1200;
export const MAX_GALLERY = 12;
/** Tiles staff place by hand; a parent category's children follow without a cap here. */
export const MAX_DESTINATIONS = 20;
/** Events removed from the automatic part of "החדשים ביותר". */
export const MAX_HIDDEN_EVENTS = 100;
const LINK_MAX = 300;

const BLOCK_KEY_RE = /^blk_[0-9a-f]{8}$/;

export const isBuiltinKey = (k: string): k is HomepageSectionKey =>
  (HOMEPAGE_SECTION_KEYS as readonly string[]).includes(k);

export const isBlockKey = (k: string): boolean => BLOCK_KEY_RE.test(k);

export const isBlockType = (t: unknown): t is HomepageBlockType =>
  typeof t === "string" && (HOMEPAGE_BLOCK_TYPES as readonly string[]).includes(t);

/** `blk_` + 8 hex chars. Minted by the board; the server only checks the shape. */
export const newBlockKey = (): string => {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return `blk_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
};

/** Which item kinds a section's strip accepts; empty = no manual items. */
export const itemKindsFor = (s: {
  key: string;
  type: HomepageSectionType;
}): HomepageItemKind[] => {
  if (s.type === "event_slider") return ["event"];
  if (s.type === "builtin" && isBuiltinKey(s.key)) return SECTION_ITEM_KINDS[s.key];
  return [];
};

export const normalizeTitle = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, TITLE_MAX).trim();
  return t || null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const parseSlider = (raw: unknown): Parsed<EventSliderConfig> => {
  const v = isRecord(raw) ? raw.category_id : null;
  if (v === null || v === undefined || v === "") return { ok: true, value: { category_id: null } };
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "קטגוריה לא תקינה" };
  return { ok: true, value: { category_id: n } };
};

/** `/path` (never `//host`) or an https URL. Empty = no link. */
const parseLink = (raw: unknown): Parsed<string | null> => {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "קישור לא תקין" };
  const link = raw.trim();
  if (!link) return { ok: true, value: null };
  if (link.length > LINK_MAX) return { ok: false, error: "קישור ארוך מדי" };
  const relative = link.startsWith("/") && !link.startsWith("//");
  if (!relative && !link.startsWith("https://")) {
    return { ok: false, error: `קישור חייב להתחיל ב- / או ב- https:// (${link})` };
  }
  return { ok: true, value: link };
};

const parseBanners = (raw: unknown, storagePrefix: string): Parsed<BannerConfig> => {
  const list = isRecord(raw) ? raw.banners : null;
  if (!Array.isArray(list)) return { ok: false, error: "חסרה רשימת באנרים" };
  if (list.length === 0) return { ok: false, error: "צריך לפחות באנר אחד עם תמונה" };
  if (list.length > MAX_BANNERS) return { ok: false, error: `עד ${MAX_BANNERS} באנרים בבלוק` };
  const banners: BannerItem[] = [];
  for (const [i, b] of list.entries()) {
    if (!isRecord(b)) return { ok: false, error: `באנר ${i + 1} לא תקין` };
    const image = typeof b.image_url === "string" ? b.image_url.trim() : "";
    if (!image) return { ok: false, error: `באנר ${i + 1}: חסרה תמונה` };
    // Our own public Storage only - it is also the only host main's next/image
    // allows. An unset prefix must reject, never accept everything.
    if (!storagePrefix || !image.startsWith(storagePrefix)) {
      return { ok: false, error: `באנר ${i + 1}: התמונה חייבת לעלות דרך המערכת` };
    }
    const link = parseLink(b.link_url);
    if (!link.ok) return { ok: false, error: `באנר ${i + 1}: ${link.error}` };
    banners.push({ image_url: image, link_url: link.value, title: normalizeTitle(b.title) });
  }
  return { ok: true, value: { banners } };
};

/** Plain text only - main prints it as paragraphs, never as HTML. */
const parseText = (raw: unknown): Parsed<TextConfig> => {
  const v = isRecord(raw) ? raw.body : null;
  if (typeof v !== "string") return { ok: false, error: "חסר טקסט" };
  // Windows line ends, trailing spaces, and more than one blank line in a row.
  const body = v
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return { ok: false, error: "חסר טקסט" };
  if (body.length > TEXT_MAX) return { ok: false, error: `טקסט ארוך מדי (עד ${TEXT_MAX} תווים)` };
  return { ok: true, value: { body } };
};

const toId = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;

/** Positive integer ids, first occurrence wins, order kept. null = not a list of ids. */
const idList = (raw: unknown): number[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) {
    const n = toId(v);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

const parseDestinations = (raw: unknown): Parsed<DestinationsConfig> => {
  const rec = isRecord(raw) ? raw : {};
  const ids = idList(rec.category_ids ?? []);
  if (!ids) return { ok: false, error: "קטגוריה לא תקינה" };
  if (ids.length > MAX_DESTINATIONS) {
    return { ok: false, error: `עד ${MAX_DESTINATIONS} קטגוריות בבלוק` };
  }
  const parent = parseSlider({ category_id: rec.parent_id });
  if (!parent.ok) return parent;
  const parent_id = parent.value.category_id;
  if (!ids.length && parent_id === null) {
    return { ok: false, error: "צריך לבחור קטגוריה אחת לפחות, או קטגוריית אב" };
  }
  return { ok: true, value: { category_ids: ids, parent_id } };
};

const parseGallery = (raw: unknown, storagePrefix: string): Parsed<GalleryConfig> => {
  const list = isRecord(raw) ? raw.images : null;
  if (!Array.isArray(list)) return { ok: false, error: "חסרה רשימת תמונות" };
  if (list.length === 0) return { ok: false, error: "צריך לפחות תמונה אחת" };
  if (list.length > MAX_GALLERY) return { ok: false, error: `עד ${MAX_GALLERY} תמונות בגלריה` };
  const images: GalleryImage[] = [];
  for (const [i, g] of list.entries()) {
    if (!isRecord(g)) return { ok: false, error: `תמונה ${i + 1} לא תקינה` };
    const image = typeof g.image_url === "string" ? g.image_url.trim() : "";
    if (!image) return { ok: false, error: `תמונה ${i + 1}: חסרה תמונה` };
    // Same rule as a banner: our own public Storage, and an unset prefix rejects.
    if (!storagePrefix || !image.startsWith(storagePrefix)) {
      return { ok: false, error: `תמונה ${i + 1}: התמונה חייבת לעלות דרך המערכת` };
    }
    images.push({ image_url: image, alt: normalizeTitle(g.alt) });
  }
  return { ok: true, value: { images } };
};

const parseConfig = (
  type: HomepageBlockType,
  raw: unknown,
  storagePrefix: string,
): Parsed<HomepageSectionConfig> => {
  switch (type) {
    case "event_slider":
      return parseSlider(raw);
    case "banner":
      return parseBanners(raw, storagePrefix);
    case "text":
      return parseText(raw);
    case "destinations":
      return parseDestinations(raw);
    case "gallery":
      return parseGallery(raw, storagePrefix);
  }
};

/**
 * The config of a BUILTIN section. Only "החדשים ביותר" has one - the events
 * staff removed from its automatic part. Lenient on purpose: a builtin can
 * never fail a save, so junk is dropped instead of reported. Over the cap the
 * OLDEST removals go first - the row has long moved past them.
 */
export const parseBuiltinConfig = (
  key: HomepageSectionKey,
  raw: unknown,
): HomepageSectionConfig => {
  if (key !== "newest") return {};
  const list = isRecord(raw) && Array.isArray(raw.hidden_event_ids) ? raw.hidden_event_ids : [];
  const ids: number[] = [];
  for (const v of list) {
    const n = toId(v);
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n);
  }
  return ids.length ? { hidden_event_ids: ids.slice(-MAX_HIDDEN_EVENTS) } : {};
};

/** The ids a "החדשים ביותר" config hides; any other config hides none. */
export const hiddenEventIds = (config: HomepageSectionConfig | null | undefined): number[] =>
  config && "hidden_event_ids" in config && Array.isArray(config.hidden_event_ids)
    ? config.hidden_event_ids
    : [];

export type NormalizedSections =
  | { ok: true; sections: HomepageSectionRow[] }
  | { ok: false; error: string };

/**
 * The client's sections → the rows that get written. Anything the client sent
 * beyond the known fields is dropped; nothing is spread into a write.
 *
 *  - a `builtin` row must carry a builtin key, a block row a block key + a known type
 *  - duplicate keys: the first wins
 *  - builtins the payload lacks are appended visible (they can never be deleted)
 *  - `hero` first, the rest in the order sent, positions 0..n
 *  - a block whose config does not validate fails the WHOLE save, named by its title
 *  - a builtin keeps a config only where it has one (`newest`: the hidden events)
 */
export function normalizeSections(
  raw: unknown,
  opts: { storagePrefix: string },
): NormalizedSections {
  if (!Array.isArray(raw)) return { ok: false, error: "Invalid layout" };

  const seen = new Set<string>();
  const out: HomepageSectionRow[] = [];
  let blocks = 0;

  for (const row of raw) {
    if (!isRecord(row)) return { ok: false, error: "Invalid section" };
    const key = typeof row.key === "string" ? row.key : "";
    if (!key || seen.has(key)) continue;
    const title = normalizeTitle(row.title);
    const is_visible = row.is_visible !== false;
    const type = row.type ?? "builtin";

    if (type === "builtin") {
      if (!isBuiltinKey(key)) return { ok: false, error: `Unknown section "${key}"` };
      seen.add(key);
      out.push({
        key,
        type: "builtin",
        title,
        config: parseBuiltinConfig(key, row.config),
        position: 0,
        is_visible,
      });
      continue;
    }

    if (!isBlockType(type)) return { ok: false, error: `Unknown block type "${String(type)}"` };
    if (!isBlockKey(key)) return { ok: false, error: `Invalid block key "${key}"` };
    const config = parseConfig(type, row.config, opts.storagePrefix);
    // Named the way staff see it on the board - its title, else its type -
    // never by the internal blk_ key.
    if (!config.ok) {
      return { ok: false, error: `${title ?? BLOCK_META[type].label}: ${config.error}` };
    }
    blocks++;
    if (blocks > MAX_BLOCKS) return { ok: false, error: `עד ${MAX_BLOCKS} בלוקים בעמוד` };
    seen.add(key);
    out.push({ key, type, title, config: config.value, position: 0, is_visible });
  }

  for (const key of HOMEPAGE_SECTION_KEYS) {
    if (!seen.has(key)) {
      out.push({ key, type: "builtin", title: null, config: {}, position: 0, is_visible: true });
    }
  }

  const sections = [...out.filter((s) => s.key === "hero"), ...out.filter((s) => s.key !== "hero")];
  sections.forEach((s, i) => (s.position = i));
  return { ok: true, sections };
}
