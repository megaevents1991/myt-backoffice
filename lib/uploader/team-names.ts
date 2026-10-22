/**
 * Team names for the tour uploader's names dialog (round "אלון 1") - the rules behind "which Hebrew
 * names does this run still need", the model's proposal checked, and the dialog's rows. Pure: no DB,
 * no network, no `server-only`; the actions read the rows and hand them in, this module decides.
 *
 *  - `missingSides`, `missingHebrewNames`: what the run is missing. `missingSides` = the teams (or the
 *    artist) the dialog lists; `missingHebrewNames` = the ones whose shows end up with an English name
 *    after the `eventNames` rule (ours, then LiveTickets', else English) - what the run's task asks for.
 *  - `cleanClubName`, `parseTeamNames`, `teamRowsFor`: the English name of a club, the model's proposal
 *    checked, and the dialog's rows (create / existing / manual).
 *  - `cleanTeamRows`: the dialog's answer, checked on the server. `slugFor`: the new row's slug.
 *
 * Selftest: scripts/tour-uploader-selftest.ts (section "Round אלון 1, Task 3").
 * Spec: docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md (5.3, 6.4, 7.1).
 */
import { clubNamesMatch, normalizeName } from "@/lib/on-tour";
import { eventNames, withSupplierSpellings } from "@/lib/uploader/names";
import type { SubjectKind, UploaderItem } from "@/types/uploader.types";

/** The longest English / Hebrew name a team row may get (the names dialog's boxes). */
export const TEAM_NAME_EN_MAX = 80;
export const TEAM_NAME_HE_MAX = 60;

const HEBREW_LETTER = /[א-ת]/;
/** The warnings that say the subject has no page of its own yet. */
const NO_PAGE_CODES = new Set(["no_team_page", "no_artist_page"]);
/** Club qualifiers a supplier adds around the name ("Newcastle United FC", "AFC Bournemouth"). */
const QUALIFIER = "FC|CF|AFC|SC|AC|SSC|BC";
const LEADING_QUALIFIERS = new RegExp(`^(?:(?:${QUALIFIER})\\s+)+`, "i");
const TRAILING_QUALIFIERS = new RegExp(`(?:\\s+(?:${QUALIFIER}))+$`, "i");
const ONLY_A_QUALIFIER = new RegExp(`^(?:${QUALIFIER})$`, "i");

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

/**
 * The club's English name without the qualifiers a supplier adds: `FC`, `CF`, `AFC`, `SC`, `AC`, `SSC`,
 * `BC` as whole words at either end ("Newcastle United FC" -> "Newcastle United", "AFC Bournemouth" ->
 * "Bournemouth"), spaces collapsed. A name that is only qualifiers is left as it is.
 */
export function cleanClubName(name: string): string {
  const spaced = name.replace(/\s+/g, " ").trim();
  const stripped = spaced.replace(LEADING_QUALIFIERS, "").replace(TRAILING_QUALIFIERS, "").trim();
  return stripped === "" || ONLY_A_QUALIFIER.test(stripped) ? spaced : stripped;
}

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

/** Every fixture side of the run, once each by `normalizeName` (first spelling wins), blanks left out. */
function distinctSides(items: Pick<UploaderItem, "show">[]): string[] {
  const seen = new Set<string>();
  const sides: string[] = [];
  for (const { show } of items) {
    for (const raw of [show.home_team, show.away_team]) {
      const side = text(raw);
      const key = normalizeName(side);
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
 * subject only. Distinct by `normalizeName`.
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
    const key = normalizeName(name);
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

/** One confirmed row: `existing_id` is the `football_teams` row to use (nothing is created), null = create the team. */
export type ConfirmedTeamRow = { supplier_name: string; name_en: string; name_he: string; existing_id: number | null };

/** What `teamRowsFor` says will happen to a row: a team is created, an existing one is used, or a person fills it in. */
export type TeamRowStatus = "create" | "existing" | "manual";
export type TeamRow = ConfirmedTeamRow & { status: TeamRowStatus };

/**
 * The dialog's answer, checked on the server. `null` when anything is wrong: not a list or longer than
 * the names offered, a row that is not an object or has a wrongly typed field, a supplier name that was
 * not offered (`allowed`, compared by `normalizeName`) or named twice, a Hebrew name with no Hebrew
 * letter or over 60, a blank English name or one over 80, or an `existing_id` that is neither null nor a
 * positive integer.
 */
export function cleanTeamRows(raw: unknown, allowed: Set<string>): ConfirmedTeamRow[] | null {
  if (!Array.isArray(raw) || raw.length > allowed.size) return null;
  const offered = new Set([...allowed].map((name) => normalizeName(name)));
  const seen = new Set<string>();
  const rows: ConfirmedTeamRow[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const { supplier_name, name_en, name_he, existing_id } = item;
    if (typeof supplier_name !== "string" || typeof name_en !== "string" || typeof name_he !== "string") return null;
    if (existing_id !== null && !(typeof existing_id === "number" && Number.isInteger(existing_id) && existing_id > 0)) return null;
    const supplier = supplier_name.trim();
    const key = normalizeName(supplier);
    if (key === "" || !offered.has(key) || seen.has(key)) return null;
    const en = name_en.trim();
    const he = name_he.trim();
    if (en === "" || en.length > TEAM_NAME_EN_MAX || he.length > TEAM_NAME_HE_MAX || !HEBREW_LETTER.test(he)) return null;
    seen.add(key);
    rows.push({ supplier_name: supplier, name_en: en, name_he: he, existing_id });
  }
  return rows;
}

/** The first team row whose English name is the same club as one of the candidates (`clubNamesMatch`). */
function findTeam<T extends { name_english: string | null }>(teams: T[], candidates: (string | undefined)[]): T | undefined {
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
