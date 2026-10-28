/**
 * Team names for the tour uploader's names dialog (round "אלון 1") - the rules behind "which Hebrew
 * names does this run still need", the model's proposal checked, and the dialog's rows. Pure: no DB,
 * no network, no `server-only`; the actions read the rows and hand them in, this module decides.
 *
 *  - `missingSides`, `missingHebrewNames`: what the run is missing. `missingSides` = the teams (or the
 *    artist) the dialog lists; `missingHebrewNames` = the ones whose shows end up with an English name
 *    after the `eventNames` rule (ours, then LiveTickets', else English) - what the run's task asks for.
 *  - `cleanClubName` (lives in lib/uploader/equivalence.ts since round 2, re-exported here), `parseTeamNames`,
 *    `teamRowsFor`: the English name of a club, the model's proposal checked, and the dialog's rows
 *    (create / existing / manual).
 *  - `cleanTeamRows`: the dialog's answer, checked on the server. `slugFor`: the new row's slug.
 *  - Round 2 (Alon, 28.10; spec 2026-10-28-uploader-alon-round-2-design.md section 5): the dialog lists a CLUB once
 *    however many spellings the shows carry (`missingSides` / `missingHebrewNames` key by the uploader's `teamKey`,
 *    the first spelling kept); a row may carry `link_team_id` ("זה עמוד קיים" - the page a person picked, nothing is
 *    created); `collapseCreateRows` makes the rows left to create ONE team per club (the same typed English name by the
 *    club rule, or the same Hebrew name) with every supplier spelling it answers; `linkQueryOf` / `findLinkTeams` are
 *    the picker's search; `teamsHeWithAliases` makes a linked spelling known to every later run.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (sections "Round אלון 1, Task 3", "Alon round 2, Task 7").
 * Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (5.3, 6.4, 7.1).
 */
import { clubNamesMatch, normalizeName } from "@/lib/on-tour";
import { matchesSearch } from "@/lib/search";
import type { UploaderAlias } from "@/lib/services/uploader-aliases";
import { cleanClubName, NO_EQUIVALENCE } from "@/lib/uploader/equivalence";
import { eventNames, withSupplierSpellings } from "@/lib/uploader/names";
import type { SubjectKind, UploaderItem } from "@/types/uploader.types";

/** The longest English / Hebrew name a team row may get (the names dialog's boxes). */
export const TEAM_NAME_EN_MAX = 80;
export const TEAM_NAME_HE_MAX = 60;

const HEBREW_LETTER = /[א-ת]/;
/** The warnings that say the subject has no page of its own yet. */
const NO_PAGE_CODES = new Set(["no_team_page", "no_artist_page"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The trimmed text, or null when there is none. */
function text(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

/** A model's text field: spaces collapsed, trimmed, cut to `max`; "" for anything that is not a string. */
function tidy(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}

// ---- Club names -------------------------------------------------------------------------------------

/** The club's English name without a supplier's qualifiers - one rule with the uploader's team key (lib/uploader/equivalence.ts). */
export { cleanClubName };

/** The `new football_teams` row's slug - the Templates form's `autoSlug`: a latin slug of the English name, else of the Hebrew one, else a random id. */
export function slugFor(name_en: string, name_he: string): string {
  for (const part of [name_en, name_he]) {
    const slug = part
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) return slug;
  }
  return `item-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
}

// ---- What the run is missing -------------------------------------------------------------------------

/** One name the dialog lists: the supplier's spelling, and whether it is the run's subject (its page is the one missing). */
export type MissingSide = { supplier_name: string; isSubject: boolean };

/**
 * Every fixture side of the run, once each CLUB (`teamKey`, the uploader's one rule for "the same team": the club
 * rule over `cleanClubName`, else the normalized name - so "Cagliari Calcio" and "Cagliari" are one), the first
 * spelling kept, blanks left out. Keyed without the confirmed aliases: a side an alias already names is not missing.
 */
function distinctSides(items: Pick<UploaderItem, "show">[]): string[] {
  const seen = new Set<string>();
  const sides: string[] = [];
  for (const { show } of items) {
    for (const raw of [show.home_team, show.away_team]) {
      const side = text(raw);
      const key = NO_EQUIVALENCE.teamKey(side);
      if (side === null || key === "" || seen.has(key)) continue;
      seen.add(key);
      sides.push(side);
    }
  }
  return sides;
}

/**
 * The names the dialog lists: the subject first when any item says it has no page (`no_team_page` /
 * `no_artist_page` - a fixture side that is the subject club is folded into it), then every fixture side
 * that `teamsHe` does not know, even by the club rule (`withSupplierSpellings`). An artist run lists the
 * subject only. One row per club (`distinctSides`).
 */
export function missingSides(
  items: Pick<UploaderItem, "show" | "warnings">[],
  subject: { kind: SubjectKind; name_en: string },
  teamsHe: Record<string, string>,
): MissingSide[] {
  const subjectName = text(subject.name_en);
  const wantsPage = subjectName !== null && items.some((item) => item.warnings.some((w) => NO_PAGE_CODES.has(w.code)));
  const out: MissingSide[] = wantsPage ? [{ supplier_name: subjectName, isSubject: true }] : [];
  if (subject.kind === "artist") return out;

  const sides = distinctSides(items);
  const known = withSupplierSpellings(teamsHe, sides);
  for (const side of sides) {
    if (text(known[normalizeName(side)]) !== null) continue;
    if (wantsPage && clubNamesMatch(side, subject.name_en)) continue;
    out.push({ supplier_name: side, isSubject: false });
  }
  return out;
}

/**
 * The names a run still needs in Hebrew: for every show whose Hebrew name the `eventNames` rule does not
 * find (so a show LiveTickets names in Hebrew asks for nothing), the sides `teamsHe` does not know - or,
 * on an artist run, the artist. Once each, in the order the shows come.
 */
export function missingHebrewNames(
  items: Pick<UploaderItem, "show">[],
  subject: { kind: SubjectKind; name_en: string; name_he: string | null },
  teamsHe: Record<string, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    const key = NO_EQUIVALENCE.teamKey(name);
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  for (const { show } of items) {
    const sides = [show.home_team, show.away_team];
    const known = withSupplierSpellings(teamsHe, sides);
    if (eventNames(subject.kind, show, subject, known, show.suppliers.livetickets?.name_heb ?? null).hebrew) continue;
    if (subject.kind === "artist") {
      add(subject.name_en);
      continue;
    }
    for (const raw of sides) {
      const side = text(raw);
      if (side !== null && text(known[normalizeName(side)]) === null) add(side);
    }
  }
  return out;
}

// ---- The model's proposal ----------------------------------------------------------------------------

/** What the model (or a person) says a team is called: the English name of its page and the Hebrew one. */
export type ProposedName = { name_en: string; name_he: string };

/**
 * The model's tool output (`{ teams: [{ supplier_name, name_en, name_he }] }`) checked against the names
 * asked. Each answer is matched to an asked name by `normalizeName(supplier_name)`; `rows` is keyed by
 * the asked name, in asked order. An answer with no Hebrew letter in `name_he` is dropped, a name nobody
 * asked about or answered twice is ignored, a name the answer skipped has no row - each is a problem line.
 * Text is trimmed and cut to 80 / 60; a blank English name falls back to the clean supplier name.
 */
export function parseTeamNames(answer: unknown, names: string[]): { rows: Map<string, ProposedName>; problems: string[] } {
  const asked = new Map<string, string>();
  for (const name of names) {
    const key = normalizeName(name);
    if (key !== "" && !asked.has(key)) asked.set(key, name);
  }

  const problems: string[] = [];
  const answered = new Map<string, ProposedName>();
  const seen = new Set<string>();
  const entries = isObject(answer) && Array.isArray(answer.teams) ? answer.teams : null;
  if (!entries) problems.push("the answer has no teams list");

  for (const entry of entries ?? []) {
    if (!isObject(entry) || typeof entry.supplier_name !== "string") {
      problems.push("an entry without a team name was ignored");
      continue;
    }
    const key = normalizeName(entry.supplier_name);
    const name = asked.get(key);
    if (name === undefined) {
      problems.push(`unknown team "${tidy(entry.supplier_name, TEAM_NAME_EN_MAX)}" was ignored`);
    } else if (seen.has(key)) {
      problems.push(`team "${name}" was answered twice - the second answer was ignored`);
    } else {
      seen.add(key);
      const name_he = tidy(entry.name_he, TEAM_NAME_HE_MAX);
      if (HEBREW_LETTER.test(name_he)) {
        const name_en = tidy(entry.name_en, TEAM_NAME_EN_MAX) || cleanClubName(name).slice(0, TEAM_NAME_EN_MAX).trim();
        answered.set(name, { name_en, name_he });
      } else {
        problems.push(`team "${name}" came back with no Hebrew name - left for review`);
      }
    }
  }

  const rows = new Map<string, ProposedName>();
  for (const [key, name] of asked) {
    const row = answered.get(name);
    if (row) rows.set(name, row);
    else if (entries && !seen.has(key)) problems.push(`no answer for "${name}" - left for review`);
  }
  return { rows, problems };
}

// ---- The dialog's rows -------------------------------------------------------------------------------

/**
 * One confirmed row. `existing_id` = the `football_teams` row `teamRowsFor` itself offered for the name (nothing is
 * created); `link_team_id` = the page a person picked with "זה עמוד קיים" (nothing is created, the supplier's spelling
 * becomes an alias of it, and ITS Hebrew name names the events - the names and the id the server reads are the page's
 * own, whatever the box said); both null = create the team. A plain row has no `link_team_id` key at all.
 */
export type ConfirmedTeamRow = { supplier_name: string; name_en: string; name_he: string; existing_id: number | null; link_team_id?: number | null };

/** What `teamRowsFor` says will happen to a row: a team is created, an existing one is used, or a person fills it in. */
export type TeamRowStatus = "create" | "existing" | "manual";
export type TeamRow = ConfirmedTeamRow & { status: TeamRowStatus };

/** A row id: a positive integer. */
const isId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * The dialog's answer, checked on the server. `null` when anything is wrong: not a list or longer than
 * the names offered, a row that is not an object or has a wrongly typed field, a supplier name that was
 * not offered (`allowed`, compared by `normalizeName`) or named twice, a Hebrew name with no Hebrew
 * letter or over 60, a blank English name or one over 80, or an `existing_id` that is neither null nor a
 * positive integer. A `link_team_id` (absent / null = none) must be a positive integer, never beside an
 * `existing_id`; a link row's names are only the page's echo (the server uses the page's own), so they may be
 * blank or latin - just not over the caps.
 */
export function cleanTeamRows(raw: unknown, allowed: Set<string>): ConfirmedTeamRow[] | null {
  if (!Array.isArray(raw) || raw.length > allowed.size) return null;
  const offered = new Set([...allowed].map((name) => normalizeName(name)));
  const seen = new Set<string>();
  const rows: ConfirmedTeamRow[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const { supplier_name, name_en, name_he, existing_id, link_team_id } = item;
    if (typeof supplier_name !== "string" || typeof name_en !== "string" || typeof name_he !== "string") return null;
    if (existing_id !== null && !isId(existing_id)) return null;
    if (link_team_id !== undefined && link_team_id !== null && !isId(link_team_id)) return null;
    const link = typeof link_team_id === "number" ? link_team_id : null;
    if (link !== null && existing_id !== null) return null;
    const supplier = supplier_name.trim();
    const key = normalizeName(supplier);
    if (key === "" || !offered.has(key) || seen.has(key)) return null;
    const en = name_en.trim();
    const he = name_he.trim();
    if (en.length > TEAM_NAME_EN_MAX || he.length > TEAM_NAME_HE_MAX) return null;
    if (link === null && (en === "" || !HEBREW_LETTER.test(he))) return null;
    seen.add(key);
    rows.push({ supplier_name: supplier, name_en: en, name_he: he, existing_id, ...(link !== null ? { link_team_id: link } : {}) });
  }
  return rows;
}

/** The first team row whose English name is the same club as one of the candidates (`clubNamesMatch`); blank candidates are skipped. */
export function findTeam<T extends { name_english: string | null }>(teams: T[], candidates: (string | undefined)[]): T | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const found = teams.find((team) => team.name_english !== null && clubNamesMatch(team.name_english, candidate));
    if (found) return found;
  }
  return undefined;
}

/**
 * The rows the dialog opens with, one per name. A club `football_teams` already has - found by the club
 * rule under the model's English name or the clean supplier name - is `existing` (its own Hebrew name,
 * nothing is created); otherwise the model's proposal is a `create` row; with no proposal for the name (no
 * AI, or it skipped the name) the row is `manual`: the clean English name and an empty Hebrew box.
 */
export function teamRowsFor(
  names: MissingSide[],
  proposed: Map<string, ProposedName> | null,
  teams: { id: number; name: string; name_english: string | null }[],
): TeamRow[] {
  return names.map(({ supplier_name }) => {
    const clean = cleanClubName(supplier_name);
    const guess = proposed?.get(supplier_name);
    const existing = findTeam(teams, [guess?.name_en, clean]);
    if (existing) {
      return { supplier_name, name_en: existing.name_english ?? clean, name_he: existing.name, existing_id: existing.id, status: "existing" as const };
    }
    if (guess) return { supplier_name, name_en: guess.name_en, name_he: guess.name_he, existing_id: null, status: "create" as const };
    return { supplier_name, name_en: clean, name_he: "", existing_id: null, status: "manual" as const };
  });
}

// ---- One team per club, and a link to an existing page (round 2, spec 5) -------------------------------

/** The team the confirm makes for one or more create rows: the first row's typed names, and every supplier spelling it answers. */
export type CreateGroup = { name_en: string; name_he: string; supplier_names: string[] };

/**
 * The rows left to CREATE (no `existing_id`, no `link_team_id`) as one team per club: two rows join when their typed
 * English names are the same club (`teamKey`) or their Hebrew names are the same (`normalizeName`), and a row that is
 * one group's English name and another's Hebrew one joins both into one. A group takes the first row's names; its
 * supplier names are in row order. Groups come in the order of their first row. Existing and link rows are no teams to
 * make and are left out. Prod 28.10: "Cagliari Calcio" and "Cagliari" both cleaned to "Cagliari" and made two.
 */
export function collapseCreateRows(rows: ConfirmedTeamRow[]): CreateGroup[] {
  type Bucket = CreateGroup & { en: Set<string>; he: Set<string> };
  const buckets: Bucket[] = [];
  for (const row of rows) {
    if (row.existing_id !== null || (row.link_team_id ?? null) !== null) continue;
    const en = NO_EQUIVALENCE.teamKey(row.name_en);
    const he = normalizeName(row.name_he);
    const hits = buckets.filter((b) => (en !== "" && b.en.has(en)) || (he !== "" && b.he.has(he)));
    if (hits.length === 0) {
      buckets.push({ name_en: row.name_en, name_he: row.name_he, supplier_names: [row.supplier_name], en: new Set([en]), he: new Set([he]) });
      continue;
    }
    const [first, ...rest] = hits;
    for (const other of rest) {
      first.supplier_names.push(...other.supplier_names);
      other.en.forEach((k) => first.en.add(k));
      other.he.forEach((k) => first.he.add(k));
      buckets.splice(buckets.indexOf(other), 1);
    }
    first.supplier_names.push(row.supplier_name);
    first.en.add(en);
    first.he.add(he);
  }
  const order = new Map(rows.map((r, i) => [r.supplier_name, i]));
  return buckets.map(({ name_en, name_he, supplier_names }) => ({
    name_en,
    name_he,
    supplier_names: supplier_names.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
  }));
}

/** One supplier spelling and the page it was settled on: a person's pick (`link_team_id`), or a match (`existing_id`, or the club rule over the names typed). */
export type PlannedLink<T> = { spelling: string; team: T; how: "picked" | "matched" };

/**
 * What a confirm does with its rows, before anything is written (round 2, spec 5): `resolved` = the spellings that end up
 * under a page that already exists - a picked link, an `existing_id`, and every spelling of a group of create rows (below)
 * whose typed English name or supplier name is the same club (`findTeam`) as a row of `teams`; `create` = the groups left to
 * create, one team each (`collapseCreateRows`). `missing` = the first `link_team_id` / `existing_id` that no row of `teams`
 * holds (null = none) - the caller refuses the confirm, nothing is planned past it. `teams` = the rows read just now.
 */
export function planTeamRows<T extends { id: number; name_english: string | null }>(
  rows: ConfirmedTeamRow[],
  teams: T[],
): { missing: number | null; resolved: PlannedLink<T>[]; create: CreateGroup[] } {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const resolved: PlannedLink<T>[] = [];
  for (const row of rows) {
    const link = row.link_team_id ?? null;
    const id = link ?? row.existing_id;
    if (id === null) continue;
    const team = byId.get(id);
    if (!team) return { missing: id, resolved: [], create: [] };
    resolved.push({ spelling: row.supplier_name, team, how: link !== null ? "picked" : "matched" });
  }
  const typed = new Map(rows.map((r) => [r.supplier_name, r.name_en]));
  const create: CreateGroup[] = [];
  for (const group of collapseCreateRows(rows)) {
    // The same club under any name the group was typed or supplied with: that page, never a second one.
    const existing = findTeam(teams, [group.name_en, ...group.supplier_names.flatMap((n) => [typed.get(n), cleanClubName(n)])]);
    if (!existing) create.push(group);
    else for (const spelling of group.supplier_names) resolved.push({ spelling, team: existing, how: "matched" });
  }
  return { missing: null, resolved, create };
}

/** The picker's query length (after trimming) and how many pages it lists. */
export const LINK_QUERY_MIN = 2;
export const LINK_QUERY_MAX = 60;
export const LINK_RESULTS_MAX = 20;

/** A page the picker lists: `football_teams`' Hebrew name, English name (null = none) and whether it is live on the site. */
export type LinkTeam = { id: number; name: string; name_english: string | null; is_active: boolean };

/** The query as the search takes it - trimmed, 2..60 characters - or null for anything else (not text, too short, too long). */
export function linkQueryOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = raw.trim();
  return query.length >= LINK_QUERY_MIN && query.length <= LINK_QUERY_MAX ? query : null;
}

/**
 * The pages a query finds: `matchesSearch` (words in any order, accents and case ignored, a word may start another)
 * over the Hebrew and the English name; live pages first, then the inactive ones (the names dialog makes those), each in
 * the order read; at most 20. The caller hands in the rows that are not deleted.
 */
export function findLinkTeams<T extends LinkTeam>(teams: T[], query: string): T[] {
  return teams
    .filter((team) => matchesSearch(query, team.name, team.name_english))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active))
    .slice(0, LINK_RESULTS_MAX);
}

/**
 * `teamsHe` (the Hebrew names keyed by `normalizeName(name_english)`) plus every confirmed team alias: its `from_key` ->
 * the Hebrew name of the page it points at. A person's alias beats a page that is merely named alike. An alias whose
 * page is deleted, gone or has no Hebrew name adds nothing; nor does a city alias or a team alias with no page. A copy.
 */
export function teamsHeWithAliases(
  teamsHe: Record<string, string>,
  aliases: Pick<UploaderAlias, "kind" | "from_key" | "team_id">[],
  teams: { id: number; name: string; is_deleted?: boolean | null }[],
): Record<string, string> {
  const hebrewById = new Map<number, string>();
  for (const team of teams) {
    const name = team.name.trim();
    if (!team.is_deleted && name !== "") hebrewById.set(team.id, name);
  }
  const out = { ...teamsHe };
  for (const alias of aliases) {
    if (alias.kind !== "team" || alias.team_id === null || alias.from_key === "") continue;
    const hebrew = hebrewById.get(alias.team_id);
    if (hebrew !== undefined) out[alias.from_key] = hebrew;
  }
  return out;
}
