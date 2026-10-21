/**
 * Tour uploader (agent #3) - which supplier rows are the tour's shows. Spec:
 * docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 8.2-8.4.
 *
 * Five jobs, in the order a run needs them:
 *   1. FIND   - is a TixStock / LiveTickets row about the subject at all (`tixMatchesSubject`,
 *               `liveMatchesSubject`), and if it only looks like it, why not (tribute act, away game).
 *   2. GROUP  - which rows are one show: the same city on the same printed day (`showKey`).
 *   3. ASK    - when the rows cannot say it alone (two listings of one show, two dates for one
 *               show), a question with closed options instead of a guess (`groupRows`).
 *   4. DEDUPE - is the show already on `events` (`existingEventFor`).
 *   5. REMEMBER - did a person already answer this exact question, or reject this exact show,
 *               on an earlier run (`priorAnswerFor`, `priorRejectionFor`).
 *
 * Names are compared with the repo's own normalizer (`normalizeName`, lib/on-tour.ts) and club
 * rule (`clubNamesMatch`); a home game is `isHomeGame` (lib/tixstock-home.ts) - the same rules the
 * gaps radar and the TixStock batch wizard use, so the uploader never disagrees with them.
 *
 * Pure - no DB, no network, no clock except the `now` a caller hands in. Selftest:
 * scripts/tour-uploader-selftest.ts.
 */
import { clubKey, clubNamesMatch, fixtureSides, normalizeName } from "@/lib/on-tour";
import { isHomeGame } from "@/lib/tixstock-home";
import { SHOW_WINDOW_DAYS } from "@/lib/uploader/constants";
import type { QuestionKind, ShowIdentity, SubjectKind, UploaderPlan, UploaderQuestion } from "@/types/uploader.types";

/** A `tixstock_events` row, reduced to what finding and grouping read. `lat` / `lon` = the venue. */
export interface TixRow {
  event_id: string;
  event_name: string;
  show_date: string;
  venue_name: string | null;
  city_name: string | null;
  country_code: string | null;
  performers: { name: string }[];
  category_name: string | null;
  sub_category_name: string | null;
  ticket_count: number | null;
  venue_map_url: string | null;
  lat: number | null;
  lon: number | null;
}

/** A `live_events` row, reduced the same way. LiveTickets prints a country NAME, never a code. */
export interface LiveRow {
  event_id: number;
  event_name: string;
  event_name_heb: string | null;
  show_date: string;
  city_name: string | null;
  country_name: string | null;
  performers: { name: string; hebName?: string }[];
  event_type: string;
  sellable: number;
}

/** Who the run is about. `aliases` = the names of the matching artist / team row (English and Hebrew). */
export interface Subject {
  kind: SubjectKind;
  name_en: string;
  name_he: string | null;
  aliases: string[];
}

type Verdict = "match" | "tribute" | "away" | "no";
/** `test_row` = a LiveTickets test listing ("liverpool test 3": a "test" word and no " vs "). */
type ExcludedReason = "tribute" | "away" | "out_of_scope" | "zero_tickets_twin" | "test_row";

export type Grouped = {
  shows: ShowIdentity[];
  questions: { show: ShowIdentity; question: UploaderQuestion }[];
  excluded: { row: "tixstock" | "livetickets"; id: string; reason: ExcludedReason }[];
};

/** An event already on `events` (live or hidden, not deleted), with every ticket `eid` it carries. */
export interface ExistingEvent {
  id: number;
  name_english: string | null;
  date: string;
  city_iata: string | null;
  eids: string[];
  is_hidden: boolean;
}

/** An item of an earlier run: an answered question, or a show rejected for good (`kind: "rejected"`). */
export interface PriorItem {
  subject_en: string;
  kind: QuestionKind | "rejected";
  key: string;
  answer: { key: string | null; text: string | null } | null;
  run_no: number;
  by: string;
  reason?: string | null;
}

const DAY_MS = 86_400_000;
const SKIP_OPTION = { key: "skip", label: "דלג על ההופעה" } as const;

// ---- names --------------------------------------------------------------------------------------

const VS = /\s+vs\.?\s+/i;
const DASH_SPLIT = /\s+[-–—]\s+/;

/**
 * A name's fixture sides (`fixtureSides`), read from the " - " segment that holds " vs ": TixStock
 * prefixes some fixtures with their competition ("UEFA Champions League - Liverpool FC vs FC Porto"),
 * and that prefix is not the home side. A name with no such segment is read whole, exactly as
 * before (a "League: " prefix and a " - Competition" tail are `fixtureSides`' own job). Local to the
 * uploader on purpose: lib/on-tour.ts mirrors main's catalog rule and stays in step with it.
 */
export function fixtureSidesOf(name: string): string[] | null {
  const segments = name.split(DASH_SPLIT);
  const fixture = segments.length > 1 ? segments.find((segment) => VS.test(segment)) : undefined;
  return fixtureSides(fixture ?? name);
}

/** A LiveTickets test listing: a whole-word "test" in the name and no " vs " ("liverpool test 3"). */
const isTestRow = (name: string): boolean => /\btest\b/i.test(name) && !VS.test(name);

/** Every name the subject goes by, normalized, blanks dropped: English, Hebrew, and the row's own names. */
function subjectNames(s: Subject): string[] {
  const names = [s.name_en, s.name_he, ...s.aliases].map((n) => normalizeName(n)).filter((n) => n !== "");
  return [...new Set(names)];
}

/**
 * A performer (or a whole event name) IS the subject: equal to one of its names once normalized
 * (case, accents, punctuation, spacing - the category-twins equality, made accent-proof). A team
 * also matches by `clubNamesMatch`, so TixStock's "Liverpool FC" is the team "Liverpool".
 * Hebrew names only ever match exactly (`clubNamesMatch` reads Latin tokens alone).
 */
function nameIsSubject(name: string | null | undefined, s: Subject): boolean {
  const n = normalizeName(name);
  if (n === "") return false;
  if (subjectNames(s).includes(n)) return true;
  return s.kind === "team" && [s.name_en, ...s.aliases].some((alias) => clubNamesMatch(n, alias));
}

/** A title that CONTAINS one of the subject's names - the tribute-act tell when no performer is the subject. */
function titleNamesSubject(title: string | null | undefined, s: Subject): boolean {
  const t = normalizeName(title);
  return t !== "" && subjectNames(s).some((n) => t.includes(n));
}

/**
 * Does `name` open the fixture (= the home side)? When the event name parses as "A vs B"
 * (`fixtureSidesOf`: a "League: " or "<competition> - " prefix dropped) the A side decides - by `isHomeGame` or
 * the club rule ("Arsenal" opens "Arsenal FC vs ..."); a name that is no fixture must simply
 * start with it (`isHomeGame`).
 */
function opensFixture(eventName: string, name: string): boolean {
  const sides = fixtureSidesOf(eventName);
  if (!sides) return isHomeGame(eventName, name);
  return isHomeGame(sides[0], name) || clubNamesMatch(sides[0], name);
}

/**
 * A home game: the team opens the fixture, tried with the supplier's own spelling of the
 * performer first, then with every name of the subject.
 */
function isHomeFixture(eventName: string, performerName: string, s: Subject): boolean {
  return [performerName, s.name_en, ...s.aliases].some((name) => opensFixture(eventName, name));
}

/**
 * A fixture's sides, `homeTeamOf`-style: home = the performer that opens the event name; failing
 * that, the A side of a name that parses as "A vs B" (the name decides, never performer order);
 * only for a name that is no fixture, the first performer. Away = the other one.
 */
function fixtureTeams(eventName: string, performers: { name: string }[]): { home: string | null; away: string | null } {
  const sides = fixtureSidesOf(eventName);
  const opener = performers.find((p) => opensFixture(eventName, p.name));
  if (opener) return { home: opener.name, away: performers.find((p) => p !== opener)?.name ?? sides?.[1]?.trim() ?? null };
  if (sides) return { home: sides[0].trim(), away: sides[1]?.trim() ?? null };
  return { home: performers[0]?.name ?? null, away: performers[1]?.name ?? null };
}

/**
 * The round, when the plan names one. A row WITH a sub-category must be that round exactly
 * (normalized equality) - containment would let "Final" take the "Semi Final" and the "Quarter
 * Final". A row without one (every LiveTickets row) falls back to the round text inside the
 * title. No round = every round.
 */
function roundMatches(title: string, subCategory: string | null, round: string | null): boolean {
  const r = normalizeName(round);
  if (r === "") return true;
  const sub = normalizeName(subCategory);
  return sub !== "" ? sub === r : normalizeName(title).includes(r);
}

/**
 * The supplier's category (or sub-category) contains the competition's name - "UEFA Champions
 * League" contains "Champions League". One direction only: the supplier adds qualifiers ("UEFA",
 * "English"), the subject never needs to.
 */
function categoryIsCompetition(row: TixRow, s: Subject): boolean {
  const fields = [row.category_name, row.sub_category_name].map((f) => normalizeName(f)).filter((f) => f !== "");
  return fields.some((f) => subjectNames(s).some((n) => f.includes(n)));
}

// ---- find ---------------------------------------------------------------------------------------

/**
 * Is a TixStock row about the subject?
 * - artist: a performer IS the subject -> "match". The name only in the TITLE with another
 *   performer -> "tribute" ("Journeyman - A Tribute to Eric Clapton"): excluded, but listed, so a
 *   person sees what was left out and why. An artist rule only (spec 8.2) - for a team the
 *   title test would flag every concert in a city that shares the club's name.
 * - team: a performer is the team (and the row is the plan's round, when it names one - see
 *   `roundMatches`); with `home_only`, a fixture the team does not open -> "away".
 * - competition: the category or sub-category names it, and the row is the plan's round.
 * Anything else -> "no": not about the subject, dropped without a word (it is search noise).
 */
export function tixMatchesSubject(row: TixRow, s: Subject, scope: UploaderPlan["scope"]): Verdict {
  switch (s.kind) {
    case "artist":
      if (row.performers.some((p) => nameIsSubject(p.name, s))) return "match";
      return titleNamesSubject(row.event_name, s) ? "tribute" : "no";
    case "team": {
      const team = row.performers.find((p) => nameIsSubject(p.name, s));
      if (!team || !roundMatches(row.event_name, row.sub_category_name, scope.round)) return "no";
      return scope.home_only && !isHomeFixture(row.event_name, team.name, s) ? "away" : "match";
    }
    case "competition":
      return categoryIsCompetition(row, s) && roundMatches(row.event_name, row.sub_category_name, scope.round) ? "match" : "no";
  }
}

/**
 * The LiveTickets twin of `tixMatchesSubject`, with the verdict kept so `groupRows` can list a Live
 * tribute or away row too.
 * - artist: a performer's `name` or `hebName` is the subject, or the event's English / Hebrew name
 *   IS the subject -> "match"; a title that only contains it -> "tribute".
 * - team: a performer is the team. Home = the team opens the event name when the name parses as
 *   "A vs B" - the name decides, because LiveTickets does not list the home side first
 *   ("Arsenal vs Liverpool" with performers [Liverpool, Arsenal]); performer order (first = home)
 *   is only the fallback for a name that is no fixture. (`groupRows` also excludes a Live row on
 *   the day and city of a TixStock row it excluded as away.)
 * - competition: always "no" - a LiveRow carries no category to judge by, so a competition run is
 *   TixStock-led (spec 8.2).
 */
function liveVerdict(row: LiveRow, s: Subject, scope: UploaderPlan["scope"]): Verdict {
  switch (s.kind) {
    case "artist": {
      const performer = row.performers.some((p) => nameIsSubject(p.name, s) || nameIsSubject(p.hebName, s));
      if (performer || nameIsSubject(row.event_name, s) || nameIsSubject(row.event_name_heb, s)) return "match";
      return titleNamesSubject(row.event_name, s) || titleNamesSubject(row.event_name_heb, s) ? "tribute" : "no";
    }
    case "team": {
      const index = row.performers.findIndex((p) => nameIsSubject(p.name, s) || nameIsSubject(p.hebName, s));
      if (index === -1 || !roundMatches(row.event_name, null, scope.round)) return "no";
      const home = fixtureSidesOf(row.event_name) ? isHomeFixture(row.event_name, row.performers[index].name, s) : index === 0;
      return scope.home_only && !home ? "away" : "match";
    }
    case "competition":
      return "no";
  }
}

/** Is a LiveTickets row one of the subject's shows (see `liveVerdict` for the rules). */
export function liveMatchesSubject(row: LiveRow, s: Subject, scope: UploaderPlan["scope"]): boolean {
  return liveVerdict(row, s, scope) === "match";
}

// ---- scope --------------------------------------------------------------------------------------

/**
 * The day a supplier PRINTS for a show: the first ten characters of its ISO string. No timezone
 * arithmetic - "2027-05-20T23:30:00-05:00" is the 20th, as on the supplier's own page (the same
 * reason as `dayIndex` in lib/actions/supplier-attach-actions.ts).
 */
export function calendarDay(iso: string): string {
  return iso.trim().slice(0, 10);
}

const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** "2027-05-20" -> "20.05.2027", the way staff write a date in a question. */
const dayLabel = (day: string): string => day.split("-").reverse().join(".");

/**
 * The first day a show may be on: `date_from`, but never before today + SHOW_WINDOW_DAYS - the site
 * hides a show that close (main's AVAILABILITY_WINDOW_DAYS), so building one would be pointless.
 * "Today" is the UTC day of `now`.
 */
function windowStart(scope: UploaderPlan["scope"], now: Date): string {
  const floor = addDays(now.toISOString().slice(0, 10), SHOW_WINDOW_DAYS);
  return scope.date_from !== null && scope.date_from > floor ? scope.date_from : floor;
}

function inWindow(day: string, scope: UploaderPlan["scope"], now: Date): boolean {
  return day >= windowStart(scope, now) && (scope.date_to === null || day <= scope.date_to);
}

/**
 * A city and a plan's city entry are the same place when either contains the other once
 * normalized ("London" / "london", "London" / "Greater London"). A blank side never matches.
 */
function cityMatches(city: string | null, entry: string): boolean {
  const c = normalizeName(city);
  const e = normalizeName(entry);
  return c !== "" && e !== "" && (c.includes(e) || e.includes(c));
}

/** `include_cities` (when any) must name the city - a row with no city is not confirmed; `exclude_cities` must not. */
function cityAllowed(city: string | null, scope: UploaderPlan["scope"]): boolean {
  if (scope.include_cities.length > 0 && !scope.include_cities.some((e) => cityMatches(city, e))) return false;
  return !scope.exclude_cities.some((e) => cityMatches(city, e));
}

const inScope = (showDate: string, city: string | null, scope: UploaderPlan["scope"], now: Date): boolean =>
  inWindow(calendarDay(showDate), scope, now) && cityAllowed(city, scope);

// ---- group --------------------------------------------------------------------------------------

/**
 * One show = one city on one printed day: `<normalized city>|<YYYY-MM-DD>` ("london|2027-05-20").
 * A football show (team / competition subject) adds its HOME side: `london|2027-05-08|arsenal` -
 * one city holds several fixtures on a Saturday, and they are different shows, not a question.
 * The home side is keyed by `clubKey` (the `clubNamesMatch` rule), so TixStock's "Arsenal FC" and
 * LiveTickets' "Arsenal" share the key; a name with no Latin token falls back to `normalizeName`.
 *
 * The country is deliberately NOT in the key, although it is taken: TixStock prints a code ("GB")
 * and LiveTickets a name ("United Kingdom"), so a key holding the country would never pair the two
 * catalogs. It is only a tie-breaker where both sides carry a code - two TixStock rows on one key
 * in two countries (Birmingham GB / Birmingham US) are two shows, not a question (`groupRows`) -
 * and the ShowIdentity keeps the code from whichever side has one.
 */
export function showKey(countryCode: string | null, city: string | null, dateISO: string, homeTeam?: string | null): string {
  void countryCode; // part of the identity callers hold, not of the key - see above
  const base = `${normalizeName(city)}|${calendarDay(dateISO)}`;
  const home = homeTeam ? clubKey(homeTeam) || normalizeName(homeTeam) : "";
  return home === "" ? base : `${base}|${home}`;
}

/**
 * The key a question (and a rejection) is remembered under across runs: `<subject>|<showKey>` -
 * with the home side for a football show (its `home_team`; null for an artist's show).
 */
export function questionKey(show: ShowIdentity, subject_en: string): string {
  return `${normalizeName(subject_en)}|${showKey(show.country_code, show.city, show.date, show.home_team)}`;
}

const tixRef = (row: TixRow): NonNullable<ShowIdentity["suppliers"]["tixstock"]> => ({
  event_id: row.event_id,
  name: row.event_name,
  ticket_count: row.ticket_count,
  venue_map_url: row.venue_map_url,
});

const liveRef = (row: LiveRow): NonNullable<ShowIdentity["suppliers"]["livetickets"]> => ({
  event_id: row.event_id,
  name_heb: row.event_name_heb,
  sellable: row.sellable,
});

/**
 * A show as TixStock lists it, with its LiveTickets twin when there is one. TixStock's identity
 * wins (venue, coordinates, country code - LiveTickets has none of them). Football shows name
 * their sides by `fixtureTeams` - the same home side the show key uses.
 */
function tixShow(row: TixRow, live: LiveRow | null, s: Subject): ShowIdentity {
  const football = s.kind !== "artist";
  const sides = football ? fixtureTeams(row.event_name, row.performers) : { home: null, away: null };
  return {
    name_english: row.event_name,
    city: (row.city_name ?? "").trim(),
    country_code: row.country_code,
    venue: row.venue_name,
    date: calendarDay(row.show_date),
    lat: row.lat,
    lon: row.lon,
    suppliers: { tixstock: tixRef(row), livetickets: live ? liveRef(live) : null },
    competition: football ? row.category_name : null,
    home_team: sides.home,
    away_team: sides.away,
    fallback: [],
  };
}

/** A show only LiveTickets sells: no venue, no coordinates, no country code - the build resolves a location later. */
function liveShow(row: LiveRow, s: Subject): ShowIdentity {
  const football = s.kind !== "artist";
  const sides = football ? fixtureTeams(row.event_name, row.performers) : { home: null, away: null };
  return {
    name_english: row.event_name,
    city: (row.city_name ?? "").trim(),
    country_code: null,
    venue: null,
    date: calendarDay(row.show_date),
    lat: null,
    lon: null,
    suppliers: { tixstock: null, livetickets: liveRef(row) },
    competition: null,
    home_team: sides.home,
    away_team: sides.away,
    fallback: [],
  };
}

/** Rows of one supplier on one key, settled: a single row, or the rows a person must choose between. */
type Settled<R> = { kind: "one"; row: R } | { kind: "ask"; rows: R[] };

/**
 * Two or more listings on one key. One that sells nothing (`isEmpty`) beside exactly one that
 * does is a dead twin: dropped, named `zero_tickets_twin`, no question. Two that sell = a question
 * between the selling ones (the dead ones still dropped). All dead = nothing to choose between -
 * the first is kept (it decides nothing: the build skips an empty listing unless the other
 * supplier sells the show) and the rest dropped. Rows arrive best-first.
 */
function settle<R>(rows: R[], isEmpty: (r: R) => boolean, drop: (r: R) => void): Settled<R> {
  if (rows.length === 1) return { kind: "one", row: rows[0] };
  const selling = rows.filter((r) => !isEmpty(r));
  const dead = rows.filter((r) => isEmpty(r));
  if (selling.length === 0) {
    dead.slice(1).forEach(drop);
    return { kind: "one", row: dead[0] };
  }
  dead.forEach(drop);
  return selling.length === 1 ? { kind: "one", row: selling[0] } : { kind: "ask", rows: selling };
}

/** Bigger listing first (unknown counts after known ones), then by id - the first option is the likeliest. */
const byTicketsThenId = (a: TixRow, b: TixRow): number =>
  (b.ticket_count ?? -1) - (a.ticket_count ?? -1) || a.event_id.localeCompare(b.event_id);
const bySellableThenId = (a: LiveRow, b: LiveRow): number => b.sellable - a.sellable || a.event_id - b.event_id;

/**
 * The tie-breaker: TixStock rows on one key in two or more different countries are separate
 * sites (each its own show). Rows without a code stay together with the rest when at most one
 * country is present.
 */
function countrySites(rows: TixRow[]): TixRow[][] {
  if (rows.length === 0) return [];
  const codes = new Set(rows.map((r) => r.country_code?.trim().toUpperCase()).filter((c): c is string => !!c));
  if (codes.size <= 1) return [rows];
  const sites = new Map<string, TixRow[]>();
  for (const row of rows) {
    const code = row.country_code?.trim().toUpperCase() ?? "";
    sites.set(code, [...(sites.get(code) ?? []), row]);
  }
  return [...sites.values()];
}

function bucket<R>(rows: R[], keyOf: (r: R) => string): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const row of rows) out.set(keyOf(row), [...(out.get(keyOf(row)) ?? []), row]);
  return out;
}

function question(kind: QuestionKind, show: ShowIdentity, s: Subject, text: string, options: UploaderQuestion["options"], now: Date): UploaderQuestion {
  return { kind, key: questionKey(show, s.name_en), text, options, free_text: false, asked_at: now.toISOString(), task_id: null };
}

const howMany = (n: number): string => (n === 2 ? "שתי" : String(n));

/** The HH:MM a supplier prints in its ISO string ("2027-05-20T14:00:00+00:00" -> "14:00"), or "" for a bare day. */
const timeOf = (iso: string): string => {
  const hhmm = iso.trim().slice(11, 16);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : "";
};
/** "20.05.2027 14:00" - the day and the time, so a matinee and an evening show tell apart. */
const whenLabel = (iso: string): string => `${dayLabel(calendarDay(iso))} ${timeOf(iso)}`.trim();

/**
 * "Keep them all": two listings on one key can be two real shows (a matinee and an evening show),
 * not a duplicate - the person keeps every listing as its own event.
 */
const keepAllOption = (n: number): UploaderQuestion["options"][number] => ({
  key: "both",
  label: n === 2 ? "שתיהן - שני אירועים" : `כולן - ${n} אירועים`,
});

/**
 * "TixStock lists two shows in London on 20.05.2027: A / B - which one is the tour's?" One option
 * per listing (keyed by its TixStock id, labelled with venue, day and time), then `both` (keep
 * every listing as its own event), then `skip`.
 */
function pickShowTix(show: ShowIdentity, rows: TixRow[], s: Subject, now: Date): UploaderQuestion {
  const text = `TixStock מציג ${howMany(rows.length)} הופעות ב-${show.city} ב-${dayLabel(show.date)}: ${rows.map((r) => r.event_name).join(" / ")} - איזו שייכת לטור?`;
  const options = rows.map((r) => ({
    key: r.event_id,
    label: [r.event_name, r.venue_name, whenLabel(r.show_date)].filter((part) => !!part).join(" · "),
  }));
  return question("pick_show", show, s, text, [...options, keepAllOption(rows.length), SKIP_OPTION], now);
}

/** The same question about LiveTickets rows; options are keyed `live:<event_id>` and labelled with the id (Live names repeat). */
function pickShowLive(show: ShowIdentity, rows: LiveRow[], s: Subject, now: Date): UploaderQuestion {
  const text = `LiveTickets מציג ${howMany(rows.length)} הופעות ב-${show.city} ב-${dayLabel(show.date)}: ${rows.map((r) => r.event_name).join(" / ")} - איזו שייכת לטור?`;
  const options = rows.map((r) => ({
    key: `live:${r.event_id}`,
    label: `${r.event_name} · ${whenLabel(r.show_date)} · LiveTickets #${r.event_id}`,
  }));
  return question("pick_show", show, s, text, [...options, keepAllOption(rows.length), SKIP_OPTION], now);
}

/** TixStock and LiveTickets disagree by a day: TixStock's day, LiveTickets' day, two shows, or skip. Keyed on the Tix day. */
function pickDate(tix: TixRow, live: LiveRow, s: Subject, now: Date): { show: ShowIdentity; question: UploaderQuestion } {
  const show = tixShow(tix, live, s);
  const tixDay = calendarDay(tix.show_date);
  const liveDay = calendarDay(live.show_date);
  const text = `ב-${show.city}: TixStock אומר ${dayLabel(tixDay)}, LiveTickets ${dayLabel(liveDay)} - איזה תאריך נכון?`;
  const options = [
    { key: `tix:${tixDay}`, label: `תאריך TixStock ${dayLabel(tixDay)}` },
    { key: `live:${liveDay}`, label: `תאריך LiveTickets ${dayLabel(liveDay)}` },
    { key: "both", label: "שתי הופעות" },
    SKIP_OPTION,
  ];
  return { show, question: question("pick_date", show, s, text, options, now) };
}

const sameCity = (a: string | null, b: string | null): boolean => normalizeName(a) !== "" && normalizeName(a) === normalizeName(b);
const oneDayApart = (a: string, b: string): boolean => Math.abs(dayNumber(calendarDay(a)) - dayNumber(calendarDay(b))) === 1;

/**
 * Supplier rows -> the run's shows, the questions that stop a show, and what was left out.
 *
 * 1. Every row is judged (`tixMatchesSubject` / `liveVerdict`): "no" is dropped silently,
 *    "tribute" / "away" are listed in `excluded` (a LiveTickets test listing about the subject -
 *    "liverpool test 3" - as `test_row`, whatever its verdict); a matching row outside the window
 *    (`date_from` ?? today + SHOW_WINDOW_DAYS, never earlier than that floor, up to `date_to`) or
 *    the plan's cities is listed `out_of_scope`. Who first, then when and where - a tribute act
 *    in an excluded city is still named a tribute. A Live row on the city and day of a TixStock
 *    row excluded as `away` is excluded `away` too: on a team run that day's fixture is the away
 *    game, whatever order LiveTickets lists the performers in.
 * 2. Rows are keyed by `showKey` - with the home side for a football subject, so two fixtures in
 *    one city on one day are two shows. Per key, TixStock rows split by country (the tie-breaker)
 *    and each site settles to one row or a `pick_show` question (`settle`: an empty twin is
 *    dropped as `zero_tickets_twin`); LiveTickets rows settle the same way (`sellable === 0` =
 *    empty).
 * 3. A settled Tix row and a settled Live row on the same key (one country only) are ONE show.
 *    When a key holds TixStock rows in two countries, its Live row cannot tell which it is and
 *    stays a show of its own.
 * 4. A Live-only row one day off a Tix-only row of the same city -> `pick_date`, but only when the
 *    pairing is unique BOTH ways (that Tix row is the only one-day neighbour of that Live row and
 *    vice versa). A Tix row that already has its exact-day Live pair is no neighbour - which is
 *    why Clapton London 21.05 (Live) beside London 20.05 (both) is a show of its own, not a
 *    question. Several neighbours = no single question fits: each row stays its own show and the
 *    board shows them side by side.
 * 5. Where TixStock AND LiveTickets both need a pick on one key, only TixStock is asked and the
 *    asked show carries NO Live row - attaching a guessed Live listing could put the wrong
 *    supplier on the event; without one, LiveTickets is attached by hand (or on a later run).
 *
 * Shows and questions come back by day, then city. `now` fixes "today" (tests); default = the clock.
 */
export function groupRows(tix: TixRow[], live: LiveRow[], s: Subject, plan: UploaderPlan, now: Date = new Date()): Grouped {
  const excluded: Grouped["excluded"] = [];
  const shows: ShowIdentity[] = [];
  const questions: Grouped["questions"] = [];

  const keptTix: TixRow[] = [];
  const awayDays = new Set<string>(); // city|day of every TixStock fixture excluded as away
  for (const row of tix) {
    const verdict = tixMatchesSubject(row, s, plan.scope);
    if (verdict === "no") continue;
    if (verdict === "away") awayDays.add(showKey(row.country_code, row.city_name, row.show_date));
    if (verdict !== "match") excluded.push({ row: "tixstock", id: row.event_id, reason: verdict });
    else if (!inScope(row.show_date, row.city_name, plan.scope, now)) excluded.push({ row: "tixstock", id: row.event_id, reason: "out_of_scope" });
    else keptTix.push(row);
  }
  const keptLive: LiveRow[] = [];
  for (const row of live) {
    const judged = liveVerdict(row, s, plan.scope);
    const verdict = judged === "match" && awayDays.has(showKey(null, row.city_name, row.show_date)) ? "away" : judged;
    if (verdict === "no") continue;
    const id = String(row.event_id);
    if (isTestRow(row.event_name)) excluded.push({ row: "livetickets", id, reason: "test_row" });
    else if (verdict !== "match") excluded.push({ row: "livetickets", id, reason: verdict });
    else if (!inScope(row.show_date, row.city_name, plan.scope, now)) excluded.push({ row: "livetickets", id, reason: "out_of_scope" });
    else keptLive.push(row);
  }

  const football = s.kind !== "artist";
  const homeOf = (row: { event_name: string; performers: { name: string }[] }): string | null =>
    football ? fixtureTeams(row.event_name, row.performers).home : null;
  const tixByKey = bucket(keptTix, (r) => showKey(r.country_code, r.city_name, r.show_date, homeOf(r)));
  const liveByKey = bucket(keptLive, (r) => showKey(null, r.city_name, r.show_date, homeOf(r)));
  const dropTix = (r: TixRow) => excluded.push({ row: "tixstock", id: r.event_id, reason: "zero_tickets_twin" });
  const dropLive = (r: LiveRow) => excluded.push({ row: "livetickets", id: String(r.event_id), reason: "zero_tickets_twin" });

  const tixOnly: TixRow[] = [];
  const liveOnly: LiveRow[] = [];
  for (const key of new Set([...tixByKey.keys(), ...liveByKey.keys()])) {
    const sites = countrySites(tixByKey.get(key) ?? []).map((rows) => settle([...rows].sort(byTicketsThenId), (r) => r.ticket_count === 0, dropTix));
    const liveRows = liveByKey.get(key);
    const liveSettled = liveRows ? settle([...liveRows].sort(bySellableThenId), (r) => r.sellable === 0, dropLive) : null;
    const pairs = sites.length === 1 ? liveSettled : null; // two countries on one key: the Live row cannot tell which

    for (const site of sites) {
      if (site.kind === "ask") {
        const partner = pairs?.kind === "one" ? pairs.row : null;
        const show = tixShow(site.rows[0], partner, s);
        questions.push({ show, question: pickShowTix(show, site.rows, s, now) });
      } else if (pairs?.kind === "ask") {
        const show = tixShow(site.row, pairs.rows[0], s);
        questions.push({ show, question: pickShowLive(show, pairs.rows, s, now) });
      } else if (pairs?.kind === "one") {
        shows.push(tixShow(site.row, pairs.row, s));
      } else {
        tixOnly.push(site.row);
      }
    }
    if (liveSettled && !pairs) {
      if (liveSettled.kind === "ask") {
        const show = liveShow(liveSettled.rows[0], s);
        questions.push({ show, question: pickShowLive(show, liveSettled.rows, s, now) });
      } else {
        liveOnly.push(liveSettled.row);
      }
    }
  }

  const neighbours = (l: LiveRow) => tixOnly.filter((t) => sameCity(t.city_name, l.city_name) && oneDayApart(t.show_date, l.show_date));
  const asked = new Set<TixRow>();
  for (const l of liveOnly) {
    const near = neighbours(l);
    const t = near.length === 1 ? near[0] : null;
    const unique = t !== null && liveOnly.filter((other) => neighbours(other).includes(t)).length === 1;
    if (t && unique) {
      questions.push(pickDate(t, l, s, now));
      asked.add(t);
    } else {
      shows.push(liveShow(l, s));
    }
  }
  for (const t of tixOnly) if (!asked.has(t)) shows.push(tixShow(t, null, s));

  const order = (a: ShowIdentity, b: ShowIdentity): number =>
    a.date.localeCompare(b.date) || a.city.localeCompare(b.city) || a.name_english.localeCompare(b.name_english);
  shows.sort(order);
  questions.sort((a, b) => order(a.show, b.show));
  return { shows, questions, excluded };
}

// ---- dedupe -------------------------------------------------------------------------------------

/** The ticket eids a show would carry: the TixStock event id, and the LiveTickets id as text (how `eid` stores it). */
const showEids = (show: ShowIdentity): string[] =>
  [show.suppliers.tixstock?.event_id, show.suppliers.livetickets ? String(show.suppliers.livetickets.event_id) : undefined].filter(
    (id): id is string => !!id,
  );

/**
 * The event already on `events` for this show (live OR hidden - the caller reads both), or null.
 * A ticket carrying one of the show's supplier ids beats everything. Otherwise the same
 * `name_english` (normalized) on the same printed day - and, when the caller knows the show's
 * location IATA, the same IATA wherever the existing event has one. A ShowIdentity carries no IATA
 * until its build finds a location, so the search-time check (no `iata`) is name + day; the build
 * passes its location's IATA, and an existing event at another IATA is then another event.
 */
export function existingEventFor(show: ShowIdentity, existing: ExistingEvent[], iata?: string | null): ExistingEvent | null {
  const eids = showEids(show);
  const byEid = existing.find((e) => e.eids.some((id) => eids.includes(id)));
  if (byEid) return byEid;
  const name = normalizeName(show.name_english);
  if (name === "") return null;
  const ours = (iata ?? "").trim().toUpperCase();
  return (
    existing.find((e) => {
      const theirs = (e.city_iata ?? "").trim().toUpperCase();
      return normalizeName(e.name_english) === name && calendarDay(e.date) === show.date && (ours === "" || theirs === "" || ours === theirs);
    }) ?? null
  );
}

/**
 * A retried item still points at the event an earlier build created (`item.event_id`): when that
 * event is still HIDDEN and not deleted, nobody approved it - the rebuild removes it first (soft
 * delete), or the retry would leave it hidden with nothing pointing at it. A live (approved) or
 * already deleted event, or none at all, is left alone.
 */
export function ownEventToClean(row: { is_hidden: boolean | null; is_deleted: string | null } | null): boolean {
  return row !== null && row.is_hidden === true && (row.is_deleted ?? "").trim() === "";
}

// ---- remember -----------------------------------------------------------------------------------

/** The item of the newest run among `items` (the first one listed when two share a run). */
function newest(items: PriorItem[]): PriorItem | null {
  return items.reduce<PriorItem | null>((best, item) => (best === null || item.run_no > best.run_no ? item : best), null);
}

/**
 * An earlier ANSWER to this exact question: same subject (normalized), same kind, same key - an
 * item that was asked but never answered is no answer. The newest run wins, so a later correction
 * replaces an earlier answer. A hit is applied without asking again (spec 8.4).
 */
export function priorAnswerFor(q: { subject_en: string; kind: QuestionKind; key: string }, priors: PriorItem[]): PriorItem | null {
  const subject = normalizeName(q.subject_en);
  return newest(priors.filter((p) => p.kind === q.kind && p.key === q.key && p.answer !== null && normalizeName(p.subject_en) === subject));
}

/** A final rejection of this show on an earlier run (same subject, same `questionKey`): the show is skipped, not rebuilt. Newest run wins. */
export function priorRejectionFor(show: ShowIdentity, subject_en: string, priors: PriorItem[]): PriorItem | null {
  const subject = normalizeName(subject_en);
  const key = questionKey(show, subject_en);
  return newest(priors.filter((p) => p.kind === "rejected" && p.key === key && normalizeName(p.subject_en) === subject));
}
