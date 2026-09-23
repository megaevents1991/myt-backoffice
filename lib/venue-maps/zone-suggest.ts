/**
 * Which of OUR zones a supplier's category most likely is - a suggestion the
 * operator confirms, never a decision. Pure (no DB, no DOM); selftested in
 * scripts/multi-supplier-selftest.ts.
 *
 * Two signals, both read off what the supplier already publishes:
 *  1. The sector range in the category text - LiveTickets writes
 *     "לאורך המגרש קומה 3 (סקטורים 500-600)". Our zones hold the drawing's
 *     section ids, which end in the section number ("categoría-1_511"), so the
 *     share of a zone's sections inside that range is measurable.
 *  2. The words of the text against the zone's label ("מאחורי השער" vs
 *     "לאורך המגרש", "קומה 3", "מרכז") - the range alone cannot tell the long
 *     side from the goal end, both run through the 500s.
 */
import type { VenueZone } from "@/lib/venue-maps/svg-zones";

const SECTOR_RANGE =
  /\(?\s*(?:סקטורים|סקטור|sectors?|secciones|sectores)\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\s*\)?/iu;

/** Weight of the sector signal; the words carry the rest. */
const RANGE_WEIGHT = 0.5;
/** Below this the best zone is no better than a guess - suggest nothing. */
export const SUGGEST_MIN_SCORE = 0.6;
/** The winner must beat the runner-up by this much, or it is a coin toss. */
export const SUGGEST_MIN_MARGIN = 0.05;

/** Words that say nothing about WHERE a seat is. */
const STOP = new Set(["ה", "ו", "של", "עם", "the", "and", "de", "del", "la", "el"]);

/**
 * The sector range a category text names, as [low, high] inclusive.
 * Hundreds mean whole rings: "500-600" = 500..699, "700" = 700..799.
 */
export function sectorRange(text: string): [number, number] | null {
  const match = SECTOR_RANGE.exec(text);
  if (!match) return null;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const [a, b] = low <= high ? [low, high] : [high, low];
  return [a, b % 100 === 0 ? b + 99 : b];
}

/** The number at the end of a section id ("categoría-1_511" → 511), or null. */
export function sectionNumber(sectionId: string): number | null {
  const tail = sectionId.slice(sectionId.lastIndexOf("_") + 1);
  return /^\d{1,4}$/.test(tail) ? Number(tail) : null;
}

const tokens = (text: string): Set<string> =>
  new Set(
    text
      .replace(SECTOR_RANGE, " ")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      // "קומות"/"קומה" and "מרכזי"/"מרכז" are the same word to a reader.
      .map((word) =>
        word === "קומות" ? "קומה" : word === "מרכזי" ? "מרכז" : word,
      )
      .filter((word) => word && !STOP.has(word)),
  );

/**
 * How well the zone and the range cover each other; null = nothing to measure.
 * Both ways on purpose: a small zone sitting inside a wide range ("100-300")
 * must not beat the zone that actually spans it.
 */
function rangeScore(zone: VenueZone, range: [number, number]): number | null {
  const numbers = zone.sections
    .map(sectionNumber)
    .filter((n): n is number => n !== null);
  if (numbers.length === 0) return null;
  const inside = numbers.filter((n) => n >= range[0] && n <= range[1]).length;
  const rings = new Set<number>();
  for (let n = range[0]; n <= range[1]; n += 100) rings.add(Math.floor(n / 100));
  const zoneRings = new Set(numbers.map((n) => Math.floor(n / 100)));
  const covered = [...rings].filter((ring) => zoneRings.has(ring)).length;
  return (inside / numbers.length) * (covered / rings.size);
}

/** Dice overlap of the two texts' words. */
function wordScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Which stand the text speaks of. The two sides run through the same section
 * numbers, so a text on one side and a zone on the other is a contradiction,
 * not a partial match.
 */
const LONG_SIDE = /לאורך|lateral|tribuna|longside|long side/iu;
const GOAL_END = /מאחורי|השער|fondo|\bgol\b|behind|goal|end stand/iu;
type Side = "long" | "goal" | null;
const sideOf = (text: string): Side => {
  const long = LONG_SIDE.test(text);
  const goal = GOAL_END.test(text);
  return long === goal ? null : long ? "long" : "goal";
};
/** What is left of a score when the text and the zone name opposite stands. */
const OPPOSITE_SIDE_FACTOR = 0.3;

export type ZoneSuggestion = { zoneId: string; score: number };

/**
 * The zone this category text most likely belongs to, or null when no zone
 * wins clearly. `text` is the supplier's description of the category - its
 * bare title ("Category 1") carries numbers that are not floors, so pass it
 * only when there is no description.
 */
export function suggestZone(
  text: string,
  zones: VenueZone[],
): ZoneSuggestion | null {
  const scored = rankZones(text, zones);
  const [best, second] = scored;
  if (!best || best.score < SUGGEST_MIN_SCORE) return null;
  if (second && best.score - second.score < SUGGEST_MIN_MARGIN) return null;
  return { zoneId: best.zoneId, score: Math.round(best.score * 100) / 100 };
}

/**
 * A zone map sliced coarser than the supplier (TixStock's "Categoría 1" vs
 * LiveTickets' floors) never scores "strong", yet the operator still wants
 * the nearest zone offered (QA 23.09). Weak = pre-filled but labelled as a
 * guess; below `WEAK_MIN_SCORE`, or a tie, nothing is offered.
 */
export const WEAK_MIN_SCORE = 0.35;

export type TieredSuggestion = ZoneSuggestion & { strong: boolean };

export function suggestZoneTiered(
  text: string,
  zones: VenueZone[],
): TieredSuggestion | null {
  const [best, second] = rankZones(text, zones);
  if (!best || best.score < WEAK_MIN_SCORE) return null;
  if (second && best.score - second.score < SUGGEST_MIN_MARGIN) return null;
  return {
    zoneId: best.zoneId,
    score: Math.round(best.score * 100) / 100,
    strong: best.score >= SUGGEST_MIN_SCORE,
  };
}

/** Every zone scored for this text, best first. */
export function rankZones(text: string, zones: VenueZone[]): ZoneSuggestion[] {
  const range = sectorRange(text);
  const words = tokens(text);
  const side = sideOf(text);
  const scored = zones
    .map((zone) => {
      const byWords = wordScore(words, tokens(zone.label));
      const byRange = range ? rangeScore(zone, range) : null;
      const raw =
        byRange === null
          ? byWords * (range ? 1 - RANGE_WEIGHT : 1)
          : RANGE_WEIGHT * byRange + (1 - RANGE_WEIGHT) * byWords;
      const zoneSide = sideOf(zone.label);
      const score =
        side && zoneSide && side !== zoneSide ? raw * OPPOSITE_SIDE_FACTOR : raw;
      return { zoneId: zone.id, score };
    })
    .sort((x, y) => y.score - x.score);
  return scored;
}
