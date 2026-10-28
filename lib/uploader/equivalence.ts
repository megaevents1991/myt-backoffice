/**
 * Tour uploader (agent #3) - ONE rule for "the same city" and "the same team". Alon's round 2, spec
 * docs/superpowers/specs/2026-10-28-uploader-alon-round-2-design.md section 3.2. On prod (28.10) a Lazio run split
 * every home game in two: TixStock prints "Roma", LiveTickets "Rome" (and Lisboa / Lisbon, Wien / Vienna, a broken
 * "K�ln" from LiveTickets). `groupRows` (lib/uploader/shows.ts) keys its buckets with this rule so the two catalogs
 * pair; the keys earlier answers and rejections are STORED under (`showKey` / `questionKey`) do not use it and never
 * change.
 *
 *  - `cityKey`: the normalized name (`normalizeName`); a `�` / `?` in it first resolved against the pool of city
 *    names in play (the ONE pool name it fits with that character as any one letter, else left as it is); then the
 *    city's group: every `locations` row's short name (`shortPlace`, "רומא, איטליה" -> "רומא") plus its `aliases`
 *    is one group, and every confirmed city alias (`uploader_aliases`) joins its two names (union-find). A group's
 *    key is its smallest member, so it is the same whichever spelling asks. A name in no group is its own key.
 *  - `teamKey`: `team:<id>` for a spelling a person linked to a `football_teams` row (both names of a confirmed team
 *    alias, by exact name or by the club rule), else the club rule (`clubKey` over `cleanClubName`), else
 *    `normalizeName` (a Hebrew name). An alias never splits two names the club rule joins.
 *  - `cleanClubName`: a club's English name without a supplier's qualifiers. It lived in team-names.ts (which
 *    re-exports it); the names dialog and this rule must strip exactly the same words.
 *
 * Pure - no DB, no network: the caller reads the rows and hands them in (type imports only, so the selftest loads
 * this file with no server code). Selftest: scripts/tour-uploader-selftest.ts (section "Alon round 2, Task 2").
 */
import { shortPlace } from "@/lib/lodging";
import { clubKey, normalizeName } from "@/lib/on-tour";
import type { LocationRow } from "@/lib/services/nearest-location";
import type { UploaderAlias } from "@/lib/services/uploader-aliases";

// ---- Club names -------------------------------------------------------------------------------------

/** Club qualifiers a supplier adds around the name ("Newcastle United FC", "SS Lazio", "ACF Fiorentina", "SV Werder Bremen"). */
const QUALIFIER = "FC|CF|AFC|SC|AC|SSC|BC|ACF|SS|US|AS|CFC|SV|FK|SK|CD|UD|RC|RCD|SL|CA";
const LEADING_QUALIFIERS = new RegExp(`^(?:(?:${QUALIFIER})\\s+)+`, "i");
/** At the end a qualifier, a "Calcio" ("Cagliari Calcio") or a founding year ("Bologna FC 1909") goes too. */
const TRAILING_QUALIFIERS = new RegExp(`(?:\\s+(?:${QUALIFIER}|Calcio|\\d{4}))+$`, "i");
const ONLY_A_QUALIFIER = new RegExp(`^(?:${QUALIFIER}|Calcio|\\d{4})$`, "i");

/**
 * The club's English name without the qualifiers a supplier adds: `FC`, `CF`, `AFC`, `SC`, `AC`, `SSC`, `BC`, `ACF`,
 * `SS`, `US`, `AS`, `CFC`, `SV`, `FK`, `SK`, `CD`, `UD`, `RC`, `RCD`, `SL`, `CA` as whole words at either end, plus a
 * trailing `Calcio` or 4-digit year ("Newcastle United FC" -> "Newcastle United", "US Sassuolo Calcio" -> "Sassuolo",
 * "Bologna FC 1909" -> "Bologna"), spaces collapsed. A name that is only qualifiers is left as it is.
 */
export function cleanClubName(name: string): string {
  const spaced = name.replace(/\s+/g, " ").trim();
  const stripped = spaced.replace(LEADING_QUALIFIERS, "").replace(TRAILING_QUALIFIERS, "").trim();
  return stripped === "" || ONLY_A_QUALIFIER.test(stripped) ? spaced : stripped;
}

// ---- The rule ---------------------------------------------------------------------------------------

/** The two keys `groupRows` buckets by. `pool` = the city names in play, for a name holding a broken character. */
export type Equivalence = {
  cityKey(name: string | null, pool?: readonly string[]): string;
  teamKey(name: string | null): string;
};

/** LiveTickets' broken character (U+FFFD) and the "?" some feeds print in its place. */
const WILDCARD = /[\uFFFD?]/;
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|]/g;

/** The club rule's form of a name: its club tokens, or "" for a name with none (a Hebrew name). */
const clubForm = (name: string): string => clubKey(cleanClubName(name));

/**
 * A normalized name holding a wildcard -> the one normalized pool name it fits, each wildcard standing for any one
 * letter; no fit or two fits -> the name unchanged. A pool name holding a wildcard itself is no candidate.
 */
function resolveWildcard(name: string, pool: readonly string[]): string {
  if (!WILDCARD.test(name) || pool.length === 0) return name;
  const pattern = new RegExp(`^${[...name].map((ch) => (WILDCARD.test(ch) ? "\\p{L}" : ch.replace(REGEX_SYNTAX, "\\$&"))).join("")}$`, "u");
  const fits = new Set(pool.map((p) => normalizeName(p)).filter((p) => p !== "" && !WILDCARD.test(p) && pattern.test(p)));
  return fits.size === 1 ? [...fits][0] : name;
}

/**
 * The rule over the rows a person keeps: `locations` (its short name + `aliases`) and the confirmed `uploader_aliases`
 * (city aliases join two city names; team aliases with a `team_id` key every spelling of that team `team:<id>`; a
 * team alias without an id keys nothing). The first alias that claims a spelling for a team wins.
 */
export function buildEquivalence(
  locations: Pick<LocationRow, "name" | "aliases">[],
  aliases: Pick<UploaderAlias, "kind" | "from_key" | "to_key" | "team_id">[],
): Equivalence {
  // Union-find over normalized city names; a root is always the smallest member of its group.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) return x;
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    for (let at = x; at !== root; ) {
      const next = parent.get(at) ?? root;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  const add = (x: string): void => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string): void => {
    if (a === "" || b === "") return;
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (const location of locations) {
    const members = [shortPlace(location.name), ...(location.aliases ?? [])].map((n) => normalizeName(n)).filter((n) => n !== "");
    for (const member of members) union(members[0], member);
  }

  const teamByName = new Map<string, number>();
  const teamByClub = new Map<string, number>();
  for (const alias of aliases) {
    if (alias.kind === "city") {
      union(normalizeName(alias.from_key), normalizeName(alias.to_key));
    } else if (alias.kind === "team" && typeof alias.team_id === "number") {
      for (const key of [alias.from_key, alias.to_key]) {
        const name = normalizeName(key);
        if (name === "") continue;
        if (!teamByName.has(name)) teamByName.set(name, alias.team_id);
        const club = clubForm(name);
        if (club !== "" && !teamByClub.has(club)) teamByClub.set(club, alias.team_id);
      }
    }
  }

  return {
    cityKey(name, pool = []) {
      const n = resolveWildcard(normalizeName(name), pool);
      if (n === "") return "";
      return parent.has(n) ? find(n) : n;
    },
    teamKey(name) {
      if (name === null) return "";
      const n = normalizeName(name);
      if (n === "") return "";
      const club = clubForm(name);
      const id = teamByName.get(n) ?? (club !== "" ? teamByClub.get(club) : undefined);
      return id !== undefined ? `team:${id}` : club || n;
    },
  };
}

/** The rule with no rows: city = the normalized name (a wildcard resolved against the pool), team = the club rule. */
export const NO_EQUIVALENCE: Equivalence = buildEquivalence([], []);
