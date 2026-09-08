/**
 * The two clubs of a fixture name, in either naming convention the DB holds:
 * - TixStock / English: "Home vs Away - Competition [season]" (competition tail dropped)
 * - Backoffice / Hebrew: "Competition: Home - Away" (en/em dashes too)
 * A leading "Competition:" prefix is always dropped. null for anything that
 * isn't exactly two sides (artists, "A - B - C").
 *
 * Mirror of `fixturePair` in myt-main `lib/eventNameMatch.ts` - the site's
 * "logo VS logo" card art and this creative generator must split names the
 * same way, or the feed shows two crests where the site shows one.
 */
const VS_SPLIT = /\s+vs\.?\s+/i;
const DASH_SPLIT = /\s+[-–—]\s+/;
const COMPETITION_TAIL = /\s+[-–—]\s+.*$/;

export function fixturePair(source?: string | null): [string, string] | null {
  const noPrefix = (source ?? "").replace(/^[^:]+:\s*/, "").trim();
  if (!noPrefix) return null;
  const parts = (
    VS_SPLIT.test(noPrefix)
      ? noPrefix
          .split(VS_SPLIT)
          .map((p, i, all) =>
            i === all.length - 1 ? p.replace(COMPETITION_TAIL, "") : p,
          )
      : noPrefix.split(DASH_SPLIT)
  )
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}
