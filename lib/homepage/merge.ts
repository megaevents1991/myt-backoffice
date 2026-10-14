/**
 * Homepage rows - the merge (2026-10-14).
 *
 * Every carousel of the homepage is "the cards staff pinned, each in its own
 * place, and the row's automatic pool filling every other place". This file is
 * that rule and nothing else: pure, no imports, no DB. It is kept BYTE-IDENTICAL
 * in myt-main `lib/homepage/merge.ts` (the site renders with it) and
 * myt-backoffice `lib/homepage/merge.ts` (the /homepage board draws with it), so
 * the board shows exactly what the site will show. Change one, copy it to the
 * other. Spec: myt-backoffice docs/superpowers/specs/2026-10-14-homepage-carousel-control-design.md
 *
 * A card is a ref, "<kind>:<id>": "event:812", "artist:oasis", "team:liverpool",
 * "review:<google review key>".
 */

export type RowRef = string;
/** A pinned card and the place it holds (0 = first). */
export type RowPin = { ref: RowRef; slot: number };
export type RowCard = { ref: RowRef; pinned: boolean };
export type MergedRow = {
  cards: RowCard[];
  /**
   * Pinned but not placed: sold out / gone (not shown at all), or - artists and
   * teams - not on sale (shown where the rule puts them). The pins after a dead
   * one close up, the way the site always treated a pinned list.
   */
  deadPins: RowRef[];
  /** Pinned past the row's length - not shown. */
  offRange: RowRef[];
};

/**
 * A row's automatic pool, in the site's order. `lanes` = several lists the row
 * takes turns from (the hero: artists / teams), interleaved AFTER the pinned,
 * hidden and excluded cards are taken out of each.
 */
export type RowPool = readonly RowRef[] | { lanes: readonly (readonly RowRef[])[] };

/** What a row's settings say about it. `max` null = the row's default (see rowDefaultMax). */
export type RowLayout = { key: string; pins: RowPin[]; hidden: RowRef[]; max: number | null };

/** Whether a card may appear / may hold a pinned place, in a row. */
export type RowRule = (ref: RowRef, rowKey: string) => boolean;

/** The flags a card carries that decide whether it can be shown. */
export type ShowFlags = { soldOut?: boolean; available?: boolean };

/** Event rows (and staff event sliders) show one row of this many. */
export const EVENT_ROW_MAX = 12;
/** The most a staff setting may ask any row to show. */
export const ROW_MAX_LIMIT = 200;

/** Rows that show one row of events by default; every other builtin shows all its pool. */
const EVENT_ROWS = new Set(["most_wanted", "newest"]);
const ALL_ROWS = new Set(["hero", "football", "artists", "reviews", "more_events"]);

/**
 * The rows a row must not repeat, in the order the site builds them:
 * "החדשים" skips what "המבוקשים" shows, "אירועים נוספים" skips both.
 */
export const ROW_EXCLUDES: Record<string, string[]> = {
  newest: ["most_wanted"],
  more_events: ["most_wanted", "newest"],
};
const BUILD_ORDER = ["most_wanted", "newest", "more_events"];

export const refKind = (ref: RowRef): string => ref.slice(0, Math.max(0, ref.indexOf(":")));
export const refId = (ref: RowRef): string => ref.slice(ref.indexOf(":") + 1);
export const toRef = (kind: string, id: string | number): RowRef => `${kind}:${id}`;

/** How many cards a row shows when staff set nothing: 12 for event rows and sliders, else all. */
export function rowDefaultMax(key: string): number | null {
  if (EVENT_ROWS.has(key)) return EVENT_ROW_MAX;
  if (ALL_ROWS.has(key)) return null;
  return EVENT_ROW_MAX; // a staff block (event slider)
}

/**
 * The site's rule for "can this card appear in this row": an event unless it is
 * sold out; an artist / team anywhere, but in the hero only while it has an
 * event on sale; a review always. No flags = nothing known about it = no.
 */
export function defaultShowable(flags: ShowFlags | undefined, rowKey: string, ref: RowRef): boolean {
  if (!flags) return false;
  const kind = refKind(ref);
  if (kind === "event") return flags.soldOut !== true;
  if (kind === "artist" || kind === "team") return rowKey === "hero" ? flags.available === true : true;
  return true;
}

/**
 * The site's rule for "can this card hold a pinned place": an event unless it is
 * sold out; an artist / team only while it has an event on sale (the rows put
 * the ones on sale first - a pin never jumps an artist with nothing to sell
 * ahead of them); a review always.
 */
export function defaultPinnable(flags: ShowFlags | undefined, rowKey: string, ref: RowRef): boolean {
  if (!flags) return false;
  const kind = refKind(ref);
  if (kind === "event") return flags.soldOut !== true;
  if (kind === "artist" || kind === "team") return flags.available === true;
  return true;
}

/**
 * One row. Pins take their own place; the pool, minus what is pinned, hidden or
 * excluded, fills every other place in its own order, up to `max`. A pin that
 * cannot be placed is reported, and the pins after it close up by one. When the
 * pool runs out before a pin's place, the pins close up behind the last card.
 * A pin beats `hidden` (pinning a card un-hides it) and `exclude` (a pin in
 * "החדשים" shows even when "המבוקשים" shows it too - as the site always did).
 */
export function mergeRow(
  pool: RowPool,
  pins: readonly RowPin[],
  opts: {
    hidden?: Iterable<RowRef>;
    max?: number | null;
    exclude?: ReadonlySet<RowRef>;
    showable?: (ref: RowRef) => boolean;
    pinnable?: (ref: RowRef) => boolean;
  },
): MergedRow {
  const showable = opts.showable ?? (() => true);
  const pinnable = opts.pinnable ?? (() => true);
  const seen = new Set<RowRef>();
  const placed = new Set<RowRef>();
  // Live pins with the place they take once the dead pins before them are gone.
  const live: RowPin[] = [];
  const deadPins: RowRef[] = [];
  const ordered = pins
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.slot - b.p.slot || a.i - b.i)
    .map((x) => x.p);
  for (const p of ordered) {
    if (seen.has(p.ref)) continue;
    seen.add(p.ref);
    if (showable(p.ref) && pinnable(p.ref)) {
      placed.add(p.ref);
      live.push({ ref: p.ref, slot: Math.max(0, p.slot - deadPins.length) });
    } else {
      deadPins.push(p.ref);
    }
  }

  const hidden = new Set(opts.hidden ?? []);
  const exclude = opts.exclude ?? new Set<RowRef>();
  const taken = new Set<RowRef>();
  const keep = (ref: RowRef) => {
    if (placed.has(ref) || hidden.has(ref) || exclude.has(ref) || taken.has(ref)) return false;
    if (!showable(ref)) return false;
    taken.add(ref);
    return true;
  };
  let auto: RowRef[];
  if (Array.isArray(pool)) {
    auto = (pool as readonly RowRef[]).filter(keep);
  } else {
    const lanes = (pool as { lanes: readonly (readonly RowRef[])[] }).lanes.map((l) => l.filter(keep));
    auto = [];
    const longest = Math.max(0, ...lanes.map((l) => l.length));
    for (let i = 0; i < longest; i++) for (const l of lanes) if (l[i] !== undefined) auto.push(l[i]);
  }

  const limit = opts.max == null ? Infinity : Math.max(0, Math.floor(opts.max));
  const cards: RowCard[] = [];
  let a = 0;
  let p = 0;
  while (cards.length < limit) {
    const place = cards.length;
    if (p < live.length && live[p].slot <= place) cards.push({ ref: live[p++].ref, pinned: true });
    else if (a < auto.length) cards.push({ ref: auto[a++], pinned: false });
    else if (p < live.length) cards.push({ ref: live[p++].ref, pinned: true });
    else break;
  }
  return { cards, deadPins, offRange: live.slice(p).map((x) => x.ref) };
}

/**
 * Every row of the page. Rows are built in the site's order so each one knows
 * what the rows it must not repeat already show; a row with no settings still
 * gets its pool under its default length. `showable` / `pinnable` default to "yes".
 */
export function planHomepage(
  rows: readonly RowLayout[],
  pools: Readonly<Record<string, RowPool>>,
  showable: RowRule = () => true,
  pinnable: RowRule = () => true,
): Record<string, MergedRow> {
  const layoutOf = new Map(rows.map((r) => [r.key, r]));
  const keys = [...new Set([...Object.keys(pools), ...rows.map((r) => r.key)])];
  keys.sort((x, y) => {
    const ix = BUILD_ORDER.indexOf(x);
    const iy = BUILD_ORDER.indexOf(y);
    return (ix < 0 ? BUILD_ORDER.length : ix) - (iy < 0 ? BUILD_ORDER.length : iy);
  });

  const out: Record<string, MergedRow> = {};
  for (const key of keys) {
    const layout = layoutOf.get(key);
    const exclude = new Set<RowRef>();
    for (const above of ROW_EXCLUDES[key] ?? []) {
      for (const c of out[above]?.cards ?? []) exclude.add(c.ref);
    }
    out[key] = mergeRow(pools[key] ?? [], layout?.pins ?? [], {
      hidden: layout?.hidden ?? [],
      max: layout?.max ?? rowDefaultMax(key),
      exclude,
      showable: (ref) => showable(ref, key),
      pinnable: (ref) => pinnable(ref, key),
    });
  }
  return out;
}
