/**
 * "On tour" = the site currently sells a package for this artist / team.
 *
 * Mirrors myt-main's catalog rule (`lib/tourStatus.ts` + `lib/eventNameMatch.ts`):
 * an event counts when it is not deleted, is at least AVAILABILITY_WINDOW_DAYS
 * out, and its name_english contains the person's English name (accent- and
 * punctuation-insensitive), with a fixture-aware refinement so "Inter Milan vs
 * Juventus" does not put Milan on tour. Everything else falls to the site's
 * Wishlist. Keep the two copies in step - the gaps radar uses this to put
 * artists and teams that are selling NOW ahead of the wishlist ones.
 */

/** Same cutoff main uses for the catalog (`AVAILABILITY_WINDOW_DAYS`). */
export const AVAILABILITY_WINDOW_DAYS = 3;

export function futureDateISO(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

// League/corporate qualifier tokens that don't identify a club on their own.
const GENERIC_TOKENS = new Set([
  "fc", "afc", "cf", "cfc", "sc", "ac", "as", "ss", "ssc", "us", "ud", "ca",
  "rc", "rcd", "sl", "bc", "de", "del", "calcio", "club", "balompie",
]);

/** Case-, accent- and whitespace-insensitive canonical form for substring matching. */
export function normalizeName(s?: string | null): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’`´"“”,.׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeToken(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function significantTokens(name: string): string[] {
  return name
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t && !GENERIC_TOKENS.has(t) && !/^\d{4}$/.test(t));
}

function tokensEqual(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((t, i) => t === b[i]);
}

function sideIsTeam(side: string, team: string): boolean {
  return tokensEqual(significantTokens(side), significantTokens(team));
}

const VS_SPLIT = /\s+vs\.?\s+/i;
const COMPETITION_TAIL = /\s+[-–—]\s+.*$/;

function fixtureSides(eventName: string): string[] | null {
  const noPrefix = eventName.replace(/^[^:]+:\s*/, "");
  const parts = noPrefix.split(VS_SPLIT);
  if (parts.length < 2) return null;
  parts[parts.length - 1] = parts[parts.length - 1].replace(COMPETITION_TAIL, "");
  return parts;
}

/** Every fixture the team plays in (home and away), hub-prefix events, and non-fixtures. */
export function eventRelatesToTeam(eventName: string, teamName: string): boolean {
  if (!eventName || !teamName) return true;
  const prefixMatch = eventName.match(/^([^:]+):\s*/);
  if (
    prefixMatch &&
    tokensEqual(significantTokens(prefixMatch[1]), significantTokens(teamName))
  ) {
    return true;
  }
  const sides = fixtureSides(eventName);
  if (!sides) return true;
  return sides.some((side) => sideIsTeam(side, teamName));
}

export interface OnTourEvent {
  name_english: string | null;
  date: string;
  is_deleted?: string | null;
}

/**
 * Builds `(nameEnglish) => number of live packages` from one events fetch, so
 * a whole gaps list costs a single query. Pass rows already restricted to
 * `is_deleted IS NULL`; the date window is re-applied here.
 */
export function buildLiveEventCounter(
  events: OnTourEvent[],
): (nameEnglish?: string | null) => number {
  const cutoff = futureDateISO(AVAILABILITY_WINDOW_DAYS);
  const live = events
    .filter((e) => !e.is_deleted && e.name_english && e.date >= cutoff)
    .map((e) => {
      const raw = e.name_english as string;
      return { raw, norm: normalizeName(raw) };
    });

  return (nameEnglish) => {
    const needle = nameEnglish?.trim();
    if (!needle) return 0;
    const low = normalizeName(needle);
    let count = 0;
    for (const n of live) {
      if (n.norm.includes(low) && eventRelatesToTeam(n.raw, needle)) count++;
    }
    return count;
  };
}
