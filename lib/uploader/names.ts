/**
 * The names a built event carries (tour uploader, build step 6). Pure - no DB, no network.
 *
 * `name_english` follows the site's convention: music = the performer's English name ("Eric Clapton",
 * the site adds the city), football = TixStock's own event name ("Liverpool FC vs Crystal Palace FC").
 * `name` is the Hebrew one, by one rule - ours, then LiveTickets', else English:
 *  - football (a team or a competition run): "<home he> - <away he>" from `football_teams` when BOTH
 *    sides are known (`source: "teams"`); else LiveTickets' own Hebrew name for the show
 *    (`source: "livetickets"`); else the English name (`source: "english"`);
 *  - music: the artist row's Hebrew name (`source: "artist"`), else LiveTickets' (`"livetickets"`),
 *    else the English name (`"english"`).
 * LiveTickets' name counts only when it is trimmed, cut to `LIVE_NAME_MAX` and still holds a Hebrew
 * letter - a Latin one is no Hebrew name. `hebrew` says whether a Hebrew name was found - the builder
 * turns `false` into the `no_hebrew_name` warning (and the run asks for it, `team-names.ts`).
 *
 * Selftest: scripts/tour-uploader-selftest.ts. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md (9.6),
 * docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (7.1).
 */
import { clubNamesMatch, normalizeName } from "@/lib/on-tour";
import type { ShowIdentity, SubjectKind } from "@/types/uploader.types";

/** The longest LiveTickets name an event takes (a longer one is cut). */
export const LIVE_NAME_MAX = 120;

const HEBREW_LETTER = /[א-ת]/;

/** Where a built event's name came from. */
export type EventNameSource = "teams" | "livetickets" | "artist" | "english";

/** The trimmed text, or null when there is none. */
function text(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

/** LiveTickets' Hebrew name for the show as it would be stored: trimmed, cut, and only when it has a Hebrew letter. */
function liveName(liveHeb: string | null): string | null {
  const name = text(liveHeb)?.slice(0, LIVE_NAME_MAX).trim() ?? "";
  return HEBREW_LETTER.test(name) ? name : null;
}

/**
 * @param teamsHe `football_teams` Hebrew names keyed by `normalizeName(name_english)`.
 * @param liveHeb LiveTickets' Hebrew name for the show.
 */
export function eventNames(
  kind: SubjectKind,
  show: ShowIdentity,
  subject: { name_en: string; name_he: string | null },
  teamsHe: Record<string, string>,
  liveHeb: string | null,
): { name: string; name_english: string; hebrew: boolean; source: EventNameSource } {
  const live = liveName(liveHeb);

  if (kind === "artist") {
    const row = text(subject.name_he);
    if (row !== null) return { name: row, name_english: subject.name_en, hebrew: true, source: "artist" };
    if (live !== null) return { name: live, name_english: subject.name_en, hebrew: true, source: "livetickets" };
    return { name: subject.name_en, name_english: subject.name_en, hebrew: false, source: "english" };
  }

  // A team or a competition run builds fixtures: both sides in Hebrew, else LiveTickets' name, else the supplier's English name.
  const side = (team: string | null): string | null => (team === null ? null : text(teamsHe[normalizeName(team)]));
  const home = side(show.home_team);
  const away = side(show.away_team);
  if (home !== null && away !== null) return { name: `${home} - ${away}`, name_english: show.name_english, hebrew: true, source: "teams" };
  if (live !== null) return { name: live, name_english: show.name_english, hebrew: true, source: "livetickets" };
  return { name: show.name_english, name_english: show.name_english, hebrew: false, source: "english" };
}

/**
 * `teamsHe` is keyed by `normalizeName(name_english)` ("liverpool"), which misses a supplier's
 * spelling of the same club ("Liverpool FC"). Each fixture side that is not a key gets the Hebrew
 * name of the team it is by the club rule (`clubNamesMatch`), so `eventNames` finds it. Returns a
 * copy; the keying is unchanged.
 */
export function withSupplierSpellings(teamsHe: Record<string, string>, sides: (string | null)[]): Record<string, string> {
  const out = { ...teamsHe };
  for (const side of sides) {
    const key = normalizeName(side);
    if (!side || key === "" || out[key]) continue;
    const match = Object.keys(teamsHe).find((k) => clubNamesMatch(k, side));
    if (match) out[key] = teamsHe[match];
  }
  return out;
}
