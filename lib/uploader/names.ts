/**
 * The names a built event carries (tour uploader, build step 6). Pure - no DB, no network.
 *
 * `name_english` follows the site's convention: music = the performer's English name ("Eric Clapton",
 * the site adds the city), football = TixStock's own event name ("Liverpool FC vs Crystal Palace FC").
 * `name` is the Hebrew one: music = the artist row's Hebrew name, else LiveTickets' `hebName`;
 * football = "<home he> - <away he>" from `football_teams` when BOTH sides are known, else the English
 * name. `hebrew` says whether a Hebrew name was found - the builder turns `false` into the
 * `no_hebrew_name` warning.
 *
 * Selftest: scripts/tour-uploader-selftest.ts. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md (9.6).
 */
import { normalizeName } from "@/lib/on-tour";
import type { ShowIdentity, SubjectKind } from "@/types/uploader.types";

/** The trimmed text, or null when there is none. */
function text(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

/**
 * @param teamsHe `football_teams` Hebrew names keyed by `normalizeName(name_english)`.
 * @param liveHeb LiveTickets' Hebrew name for the show (music only).
 */
export function eventNames(
  kind: SubjectKind,
  show: ShowIdentity,
  subject: { name_en: string; name_he: string | null },
  teamsHe: Record<string, string>,
  liveHeb: string | null,
): { name: string; name_english: string; hebrew: boolean } {
  if (kind === "artist") {
    const he = text(subject.name_he) ?? text(liveHeb);
    return { name: he ?? subject.name_en, name_english: subject.name_en, hebrew: he !== null };
  }

  // A team or a competition run builds fixtures: both sides in Hebrew, or the supplier's English name.
  const side = (team: string | null): string | null => (team === null ? null : text(teamsHe[normalizeName(team)]));
  const home = side(show.home_team);
  const away = side(show.away_team);
  if (home !== null && away !== null) return { name: `${home} - ${away}`, name_english: show.name_english, hebrew: true };
  return { name: show.name_english, name_english: show.name_english, hebrew: false };
}
