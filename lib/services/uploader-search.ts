/**
 * Tour uploader (agent #3) - the DB reads that feed the pure show rules (lib/uploader/shows.ts).
 * Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 8.1-8.4.
 *
 * Who the run is about (`resolveSubject`), which supplier rows are its shows (`findShows`) and
 * what is already on `events` (`readExistingEvents` / `existingForShow`). What earlier runs
 * settled and the venue templates live in lib/services/uploader-prior.ts.
 *
 * Every read is NARROW and PAGED: the supplier tables are filtered by the plan's window first
 * (`tixstock_events` is indexed on `(show_date, event_id)`) and then by the subject's name words,
 * and anything that can pass PostgREST's 1,000-row cap is read through `fetchPaged`. Every failed
 * read THROWS - an empty catalog must never read as "nothing sells it", and an empty `events`
 * read must never read as "not built yet".
 *
 * Session-free (no guard): the server actions that call it own the session check (Task 8). It
 * never writes.
 */
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { clubKey, clubNamesMatch, normalizeName } from "@/lib/on-tour";
import { findCategoryTwin, namesMatch, TWIN_HUB_SLUG, type TwinPerson } from "@/lib/services/category-twins";
import { hasLibraryCrest } from "@/lib/services/creative-gaps";
import { planWindowCap, planWindowStart } from "@/lib/uploader/plan";
import {
  calendarDay,
  fixtureSidesOf,
  groupRows,
  showKey,
  type ExistingEvent,
  type Grouped,
  type LiveRow,
  type Subject,
  type TixRow,
} from "@/lib/uploader/shows";
import type { SubjectRows } from "@/lib/uploader/warnings";
import type { RawLiveTicketsCategory } from "@/lib/services/livetickets-offers";
import type { Json } from "@/types/database.types";
import type { ShowIdentity, UploaderPlan } from "@/types/uploader.types";

// `events.is_hidden` and the two uploader tables are newer than types/database.types.ts (regenerate
// with `npm run db:types` once migration 20261021115818 is applied) - one boundary cast for them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const DAY_MS = 86_400_000;
/** The most rows one search read may page through; past it the read THROWS rather than return a part. */
const SEARCH_ROWS_MAX = 20_000;
/** Name patterns per `.or()` filter (each pattern opens several columns). */
const OR_PATTERNS_MAX = 30;
/**
 * `tixstock_events` is read in date slices of this many days: a name filter is checked row by row
 * after the `(show_date, event_id)` index range, and on a cold cache one open-ended read of every
 * future row (~90,000) outlasted the statement timeout (21.10: 7.3 s cold, 0.6 s warm). A slice
 * keeps each statement small.
 */
const TIX_SLICE_DAYS = 120;
/** Slices read side by side. */
const TIX_SLICES_AT_ONCE = 3;
/**
 * The most slices one read is cut into - a hard ceiling under the plan's own window rule
 * (OPEN_WINDOW_MONTHS = 7 slices): a stored plan from before that rule, or any other unbounded
 * window, can never fan one search out into thousands of statements (security review, 21.10).
 */
export const TIX_SLICES_MAX = 12;

/** Postgres "canceling statement due to statement timeout". */
const STATEMENT_TIMEOUT = "57014";

/** `fetchPaged`, once more when the database cancelled the statement on its timeout (a cold read warms the cache). */
async function pagedOnceMore<T extends { id: number | string }>(
  makeQuery: Parameters<typeof fetchPaged<T>>[0],
  max: number,
): ReturnType<typeof fetchPaged<T>> {
  const first = await fetchPaged<T>(makeQuery, max);
  const code = first.error && "code" in first.error ? (first.error as { code?: unknown }).code : null;
  return code === STATEMENT_TIMEOUT ? fetchPaged<T>(makeQuery, max) : first;
}

// ---- window --------------------------------------------------------------------------------------

/** A `[from, to)` window of calendar days (`to` exclusive). */
export type SearchWindow = { from: string; to: string };

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The SQL bounds of a plan's window: `groupRows`' own floor (`date_from`, never before today +
 * SHOW_WINDOW_DAYS - `planWindowStart`) up to `date_to`, ONE DAY WIDER on each side - SQL compares
 * instants while the rules compare the day a supplier PRINTS ("2027-05-20T23:30:00-05:00" is the
 * 20th), so the edge rows are fetched and `groupRows` decides (listing them `out_of_scope` when they
 * are). `to` is exclusive. An open-ended plan (`date_to` null) ends OPEN_WINDOW_MONTHS after the
 * window's START (a `date_from` years ahead still gets a full window, never an empty one), and a
 * `date_to` past that is held to it (`parsePlanInput` already cuts it; a stored plan may predate that).
 */
export function searchWindow(scope: UploaderPlan["scope"], now: Date = new Date()): SearchWindow {
  const start = planWindowStart(scope.date_from, now);
  const cap = planWindowCap(start);
  if (scope.date_to !== null) return { from: addDays(start, -1), to: addDays(scope.date_to < cap ? scope.date_to : cap, 2) };
  return { from: addDays(start, -1), to: cap };
}

// ---- name patterns -------------------------------------------------------------------------------

const isLatin = (name: string): boolean => /\p{Script=Latin}/u.test(name);

/** A Hebrew geresh / gershayim between two Hebrew letters (צ'לסי, צ׳לסי, ארה"ב). */
const HEBREW_GERESH = /(?<=\p{Script=Hebrew})['\u05F3\u2019`"\u05F4](?=\p{Script=Hebrew})/gu;
/** Stands in for a kept geresh while the name is split (a control character no name carries). */
const GERESH_MARK = "\u0001";

/**
 * A name as the fragments a PostgREST `.or()` ilike value may carry: split on every run that is not
 * a letter or a digit, so "Jay-Z" is `jay` + `z`, "AC/DC" `ac` + `dc`, "P!nk" `p` + `nk` - and no
 * comma, parenthesis, quote, `%` or `*` ever reaches the filter string. Latin fragments keep ASCII
 * letters and digits and turn any other letter into `_` (one character - "Atlético" also finds
 * "Atletico"). A Hebrew geresh inside a word stays in place as `_` (PostgREST takes a raw `'`, but
 * the catalogs spell it `'` or `׳`, and `_` matches both): "צ'לסי" -> `צ_לסי`.
 */
export function nameFragments(name: string): string[] {
  return name
    .replace(HEBREW_GERESH, GERESH_MARK)
    .split(/[^\p{L}\p{N}\u0001]+/u)
    .map((fragment) =>
      isLatin(fragment)
        ? [...fragment].map((c) => (/[A-Za-z0-9]/.test(c) ? c : /\p{L}/u.test(c) ? "_" : "")).join("")
        : fragment.split(GERESH_MARK).join("_"),
    )
    .filter((fragment) => fragment.replace(/_/g, "") !== "");
}

/** "%eric%clapton%": every fragment of the name, in order. null when the name has none. */
function likePattern(name: string): string | null {
  const fragments = nameFragments(name);
  return fragments.length === 0 ? null : `%${fragments.join("%")}%`;
}

/**
 * The patterns a subject is searched by, Latin and Hebrew apart (a Hebrew pattern only means
 * something on a Hebrew column). A team or a competition searches by its club tokens (`clubKey`
 * drops "FC", "AC", ...), so a qualifier never widens a read to every football row; an artist by
 * its whole name. One rule for every read: the show search, the competition lookup, duplicates.
 */
export function subjectPatterns(subject: Subject, extraNames: (string | null)[] = []): { latin: string[]; hebrew: string[] } {
  const names = [subject.name_en, subject.name_he, ...subject.aliases, ...extraNames].filter((n): n is string => !!n?.trim());
  const latin = new Set<string>();
  const hebrew = new Set<string>();
  for (const name of names) {
    if (isLatin(name)) {
      const key = subject.kind === "artist" ? name : clubKey(name) || name;
      const p = likePattern(key);
      if (p) latin.add(p.toLowerCase());
    } else {
      const p = likePattern(name);
      if (p) hebrew.add(p);
    }
  }
  return { latin: [...latin], hebrew: [...hebrew] };
}

/** `col.ilike.<p>` for every column x pattern, joined for `.or()`. */
const orIlike = (columns: string[], patterns: string[]): string =>
  patterns.flatMap((p) => columns.map((c) => `${c}.ilike.${p}`)).join(",");

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// ---- jsonb narrowing -----------------------------------------------------------------------------

type JsonObject = { [key: string]: Json | undefined };
const isObject = (v: Json | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: Json | undefined): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** `performers` jsonb -> `{ name, hebName? }[]` (entries without a name dropped). */
function performersOf(v: Json | null): { name: string; hebName?: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { name: string; hebName?: string }[] = [];
  for (const p of v) {
    if (!isObject(p)) continue;
    const name = text(p.name);
    const heb = text(p.hebName);
    if (name) out.push(heb ? { name, hebName: heb } : { name });
  }
  return out;
}

/** TixStock's `sub_categories`: an object `{ name }` (every row seen 21.10) or a list of them. */
function subCategoryName(v: Json | null): string | null {
  if (isObject(v)) return text(v.name);
  if (Array.isArray(v)) {
    const first = v.find(isObject);
    return first ? text(first.name) : null;
  }
  return null;
}

function eidsOf(tickets: Json | null): string[] {
  if (!Array.isArray(tickets)) return [];
  const eids = new Set<string>();
  for (const t of tickets) {
    if (!isObject(t)) continue;
    const eid = t.eid;
    if (typeof eid === "string" && eid.trim()) eids.add(eid.trim());
    else if (typeof eid === "number" && Number.isFinite(eid)) eids.add(String(eid));
  }
  return [...eids];
}

// ---- subject -------------------------------------------------------------------------------------

type PersonRow = {
  id: number;
  name: string;
  name_english: string | null;
  image_url: string | null;
  art_image_url: string | null;
  bio: Json | null;
};
type ArtistRow = PersonRow & { event_gallery: Json };
type TeamRow = PersonRow & { logo_url: string | null; is_active: boolean; is_deleted: boolean };
type CategoryRow = { id: number; slug: string; parent_id: number | null; name: string; name_english: string | null };

function fail(what: string, error: { message: string } | null): never {
  console.error(`uploader-search: ${what} failed`, JSON.stringify(error));
  throw new Error(`${what} failed: ${error?.message ?? "unknown error"}`);
}

/** The `teams` / `artists` hub and its active leaves - what `findCategoryTwin` needs. */
async function twinCategories(hub: "team" | "artist"): Promise<{ hubId: number | undefined; leaves: CategoryRow[] }> {
  const hubs = await supabaseTyped
    .from("categories")
    .select("id,slug,parent_id,name,name_english")
    .eq("is_deleted", false)
    .eq("slug", TWIN_HUB_SLUG[hub]);
  if (hubs.error) fail("twin hub read", hubs.error);
  const hubId = hubs.data?.[0]?.id;
  if (hubId === undefined) return { hubId, leaves: [] };
  const { rows, truncated, error } = await fetchPaged<CategoryRow>(
    () =>
      supabaseTyped
        .from("categories")
        .select("id,slug,parent_id,name,name_english")
        .eq("parent_id", hubId)
        .eq("is_active", true)
        .eq("is_deleted", false)
        .order("id"),
    SEARCH_ROWS_MAX,
  );
  if (error || truncated) fail("twin categories read", error ?? { message: "too many rows" });
  return { hubId, leaves: rows };
}

/** The first roster row named like the brief (main's roster order: by name). A team also matches by club tokens. */
function pickRow<R extends TwinPerson>(roster: R[], plan: UploaderPlan, club: boolean): R | null {
  const wanted = { name: plan.subject.name_he ?? "", name_english: plan.subject.name_en };
  return (
    roster.find((r) => namesMatch(wanted, r)) ??
    (club ? roster.find((r) => !!r.name_english && clubNamesMatch(r.name_english, plan.subject.name_en)) : undefined) ??
    null
  );
}

/**
 * Who the run is about, and the subject's own pages (spec 8.1):
 * - artist: the `artists` row by `namesMatch` (the category-twins rule) - active, not deleted, the
 *   first in main's roster order; its `/c/` twin by `findCategoryTwin`.
 * - team: the `football_teams` row the same way, or by club tokens (`clubNamesMatch` - "Liverpool
 *   FC" is "Liverpool"); its crest = `logo_url` or a crest-library row (`hasLibraryCrest`).
 * - competition: the TixStock `category_name` that names it (`competitionName`; null = none).
 * `teamsHe` = every `football_teams` Hebrew name keyed by `normalizeName(name_english)` - the
 * opponents of a fixture too, which is why it is the whole table.
 */
export async function resolveSubject(plan: UploaderPlan): Promise<{
  subject: Subject;
  rows: SubjectRows;
  teamsHe: Record<string, string>;
  competitionName: string | null;
}> {
  const kind = plan.subject.kind;
  const teamsRead = await fetchPaged<TeamRow>(
    () =>
      supabaseTyped
        .from("football_teams")
        .select("id,name,name_english,logo_url,image_url,art_image_url,bio,is_active,is_deleted")
        .order("name")
        .order("id"),
    SEARCH_ROWS_MAX,
  );
  if (teamsRead.error || teamsRead.truncated) fail("football_teams read", teamsRead.error ?? { message: "too many rows" });
  const teamsHe: Record<string, string> = {};
  for (const t of teamsRead.rows) {
    const key = normalizeName(t.name_english);
    if (key !== "" && t.name.trim() !== "" && !t.is_deleted) teamsHe[key] = t.name.trim();
  }

  const rows: SubjectRows = { artist: null, team: null };
  let found: { name: string; name_english: string | null } | null = null;
  let competitionName: string | null = null;

  if (kind === "artist") {
    const roster = await fetchPaged<ArtistRow>(
      () =>
        supabaseTyped
          .from("artists")
          .select("id,name,name_english,image_url,art_image_url,event_gallery,bio")
          .eq("is_active", true)
          .eq("is_deleted", false)
          .order("name")
          .order("id"),
      SEARCH_ROWS_MAX,
    );
    if (roster.error || roster.truncated) fail("artists read", roster.error ?? { message: "too many rows" });
    const row = pickRow(roster.rows, plan, false);
    if (row) {
      const twins = await twinCategories("artist");
      found = row;
      rows.artist = {
        id: row.id,
        name: row.name,
        image_url: row.image_url,
        art_image_url: row.art_image_url,
        event_gallery: Array.isArray(row.event_gallery) ? row.event_gallery : [],
        bio: row.bio,
        hasTwin: findCategoryTwin(row, twins.hubId, twins.leaves, roster.rows) !== null,
      };
    }
  } else if (kind === "team") {
    const roster = teamsRead.rows.filter((t) => t.is_active && !t.is_deleted);
    const row = pickRow(roster, plan, true);
    if (row) {
      const [twins, logos] = await Promise.all([
        twinCategories("team"),
        supabaseTyped.from("football_logos").select("name_english,name_hebrew"),
      ]);
      if (logos.error) fail("football_logos read", logos.error);
      found = row;
      rows.team = {
        id: row.id,
        name: (row.name_english ?? "").trim() || row.name,
        logo_url: row.logo_url,
        crestInLibrary: hasLibraryCrest(row, logos.data ?? []),
        image_url: row.image_url,
        art_image_url: row.art_image_url,
        bio: row.bio,
        hasTwin: findCategoryTwin(row, twins.hubId, twins.leaves, roster) !== null,
      };
    }
  } else {
    competitionName = await resolveCompetition(plan);
  }

  const subject: Subject = {
    kind,
    name_en: plan.subject.name_en,
    // The row's Hebrew name first: it is the site's own spelling (spec 9.6).
    name_he: found?.name.trim() || plan.subject.name_he,
    aliases: [found?.name_english ?? null, found?.name ?? null, competitionName].filter((n): n is string => !!n?.trim()),
  };
  return { subject, rows, teamsHe, competitionName };
}

/**
 * The TixStock category that names a competition: among active future rows whose category or
 * sub-category contains the name (normalized containment, the `categoryIsCompetition` direction),
 * the category most rows carry. null = TixStock has no such competition.
 */
async function resolveCompetition(plan: UploaderPlan): Promise<string | null> {
  const probe: Subject = { kind: "competition", name_en: plan.subject.name_en, name_he: plan.subject.name_he, aliases: [] };
  const wanted = [plan.subject.name_en, plan.subject.name_he].map((n) => normalizeName(n)).filter((n) => n !== "");
  const rows = await readTixRows<{ id: string; category_name: string | null; sub_categories: Json | null }>(
    "id:event_id,category_name,sub_categories",
    ["category_name", "sub_categories->>name"],
    subjectPatterns(probe).latin,
    searchWindow(plan.scope),
    "competition read",
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const fields = [r.category_name, subCategoryName(r.sub_categories)];
    const named = fields.some((f) => wanted.some((w) => normalizeName(f).includes(w)));
    const category = r.category_name?.trim();
    if (named && category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [category, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = category;
  return best;
}

// ---- supplier rows -------------------------------------------------------------------------------

type TixDb = {
  id: string;
  event_id: string;
  event_name: string;
  show_date: string;
  venue_name: string | null;
  city_name: string | null;
  country_code: string | null;
  performers: Json | null;
  category_name: string | null;
  sub_categories: Json | null;
  ticket_count: number | null;
  venue_map_url: string | null;
  venue_data: Json | null;
};
const TIX_COLUMNS =
  "id:event_id,event_id,event_name,show_date,venue_name,city_name,country_code,performers,category_name,sub_categories,ticket_count,venue_map_url,venue_data";

function toTixRow(r: TixDb): TixRow {
  const venue = isObject(r.venue_data) ? r.venue_data : null;
  return {
    event_id: r.event_id,
    event_name: r.event_name,
    show_date: r.show_date,
    venue_name: r.venue_name,
    city_name: r.city_name,
    country_code: r.country_code,
    performers: performersOf(r.performers).map((p) => ({ name: p.name })),
    category_name: r.category_name,
    sub_category_name: subCategoryName(r.sub_categories),
    ticket_count: r.ticket_count,
    venue_map_url: r.venue_map_url,
    lat: venue ? num(venue.latitude) : null,
    lon: venue ? num(venue.longitude) : null,
  };
}

/**
 * TixStock rows that may be the subject's: active, inside the window (by `show_date` first - the
 * table's index), then by name - the event name and the first performers for an artist or a team,
 * the category / sub-category for a competition. `tixMatchesSubject` (inside `groupRows`) decides.
 */
async function searchTixRows(subject: Subject, window: SearchWindow): Promise<TixRow[]> {
  const columns =
    subject.kind === "competition"
      ? ["category_name", "sub_categories->>name"]
      : ["event_name", "performers->0->>name", "performers->1->>name", "performers->2->>name"];
  const rows = await readTixRows<TixDb>(TIX_COLUMNS, columns, subjectPatterns(subject).latin, window, "tixstock_events read");
  return rows.map(toTixRow);
}

/** The window as `TIX_SLICE_DAYS` slices, each `[from, to)`, in order - at most TIX_SLICES_MAX (the rest is never read). Pure. */
export function tixSlices(window: SearchWindow): SearchWindow[] {
  const slices: SearchWindow[] = [];
  for (let from = window.from; from < window.to && slices.length < TIX_SLICES_MAX; from = addDays(from, TIX_SLICE_DAYS)) {
    const to = addDays(from, TIX_SLICE_DAYS);
    slices.push({ from, to: to < window.to ? to : window.to });
  }
  return slices;
}

/**
 * Active `tixstock_events` rows inside the window whose `filterColumns` match one of `patterns` -
 * the ONE TixStock read of the uploader (shows and the competition lookup): by `show_date` first
 * (the table's index), slice by slice, TIX_SLICES_AT_ONCE slices side by side, each statement
 * retried once on a timeout, paged, deduped by event id. THROWS on a failed read.
 */
async function readTixRows<T extends { id: string }>(
  select: string,
  filterColumns: string[],
  patterns: string[],
  window: SearchWindow,
  what: string,
): Promise<T[]> {
  if (patterns.length === 0) return [];
  const out = new Map<string, T>();
  const readSlice = async (slice: SearchWindow): Promise<void> => {
    for (const part of chunks(patterns, OR_PATTERNS_MAX)) {
      const { rows, truncated, error } = await pagedOnceMore<T>(
        () =>
          supabaseTyped
            .from("tixstock_events")
            .select(select)
            .eq("is_active", true)
            .gte("show_date", slice.from)
            .lt("show_date", slice.to)
            .or(orIlike(filterColumns, part))
            .order("show_date")
            .order("event_id"),
        SEARCH_ROWS_MAX,
      );
      if (error || truncated) fail(what, error ?? { message: "too many rows - narrow the plan's dates" });
      for (const r of rows) out.set(r.id, r);
    }
  };
  for (const group of chunks(tixSlices(window), TIX_SLICES_AT_ONCE)) await Promise.all(group.map(readSlice));
  return [...out.values()];
}

type LiveDb = {
  id: number;
  event_id: number;
  event_name: string;
  event_name_heb: string | null;
  show_date: string;
  city_name: string | null;
  country_name: string | null;
  performers: Json | null;
  event_type: string;
  ticket_categories: Json | null;
};
const LIVE_COLUMNS = "id:event_id,event_id,event_name,event_name_heb,show_date,city_name,country_name,performers,event_type,ticket_categories";

/**
 * LiveTickets rows that may be the subject's: active, inside the window, by the English names (event
 * name, first performers) and the Hebrew ones (Hebrew event name, performers' `hebName`).
 * `sellable` = the categories `toLiveTicketsCategory` would sell, counted on the stored snapshot.
 * A competition run reads none: `groupRows` never joins a LiveTickets row to one (shows.ts).
 */
async function searchLiveRows(subject: Subject, window: SearchWindow): Promise<LiveRow[]> {
  if (subject.kind === "competition") return [];
  const { latin, hebrew } = subjectPatterns(subject);
  const terms = [
    ...latin.map((p) => ({ p, columns: ["event_name", "performers->0->>name", "performers->1->>name", "performers->2->>name"] })),
    ...hebrew.map((p) => ({ p, columns: ["event_name_heb", "performers->0->>hebName", "performers->1->>hebName"] })),
  ];
  if (terms.length === 0) return [];
  // livetickets-offers loads the exchange-rate service, which needs the supplier env at load: imported here, not at the top.
  const { toLiveTicketsCategory } = await import("@/lib/services/livetickets-offers");
  const out = new Map<number, LiveRow>();
  for (const part of chunks(terms, OR_PATTERNS_MAX)) {
    const filter = part.map(({ p, columns }) => orIlike(columns, [p])).join(",");
    const { rows, truncated, error } = await pagedOnceMore<LiveDb>(() => {
      let q = supabaseTyped.from("live_events").select(LIVE_COLUMNS).eq("is_active", true).gte("show_date", window.from);
      q = q.lt("show_date", window.to);
      return q.or(filter).order("show_date").order("event_id");
    }, SEARCH_ROWS_MAX);
    if (error || truncated) fail("live_events read", error ?? { message: "too many rows - narrow the plan's dates" });
    for (const r of rows) {
      const categories = Array.isArray(r.ticket_categories) ? r.ticket_categories.filter(isObject) : [];
      out.set(r.event_id, {
        event_id: r.event_id,
        event_name: r.event_name,
        event_name_heb: r.event_name_heb,
        show_date: r.show_date,
        city_name: r.city_name,
        country_name: r.country_name,
        performers: performersOf(r.performers),
        event_type: r.event_type,
        // The snapshot is LiveTickets' own category shape (RawLiveTicketsCategory) - a jsonb boundary.
        sellable: categories.filter((c) => toLiveTicketsCategory(c as unknown as RawLiveTicketsCategory).sellable).length,
      });
    }
  }
  return [...out.values()];
}

// ---- existing events -----------------------------------------------------------------------------

type EventDb = {
  id: number;
  name: string | null;
  name_english: string | null;
  date: string;
  location: Json | null;
  tickets_and_rates: Json | null;
  is_hidden: boolean | null;
};

function toExisting(r: EventDb): ExistingEvent {
  const location = isObject(r.location) ? r.location : null;
  return {
    id: r.id,
    name_english: r.name_english,
    date: r.date,
    city_iata: location ? text(location.city_iata) : null,
    eids: eidsOf(r.tickets_and_rates),
    is_hidden: r.is_hidden === true,
  };
}

/**
 * Events already on `events` that a show of this run could be - LIVE AND HIDDEN (a hidden one an
 * earlier run built is a duplicate too), not deleted. QA test events count only for a TEST run
 * (`includeTest`): a rehearsal must not duplicate its own test events, and a lingering test event
 * must not block a real build. NARROW: only names that carry one of the subject's patterns (English
 * on `name_english`, Hebrew on `name`, plus `extraNames` - a competition's fixtures are named by
 * their clubs, never by the competition) inside the window, with their tickets for the `eid`s.
 * Never the whole table: one read of every event's tickets is what killed a cron on 14.10.
 */
export async function readExistingEvents(
  subject: Subject,
  window: SearchWindow,
  extraNames: (string | null)[],
  includeTest: boolean,
): Promise<ExistingEvent[]> {
  const { latin, hebrew } = subjectPatterns(subject, extraNames);
  const terms = [...latin.map((p) => `name_english.ilike.${p}`), ...hebrew.map((p) => `name.ilike.${p}`)];
  if (terms.length === 0) return [];
  const out = new Map<number, ExistingEvent>();
  for (const part of chunks(terms, OR_PATTERNS_MAX)) {
    const { rows, truncated, error } = await pagedOnceMore<EventDb>(() => {
      let q = db
        .from("events")
        .select("id,name,name_english,date,location,tickets_and_rates,is_hidden")
        .is("is_deleted", null)
        .gte("date", window.from)
        .lt("date", window.to);
      if (!includeTest) q = q.not("is_test", "is", true);
      return q.or(part.join(",")).order("id");
    }, SEARCH_ROWS_MAX);
    if (error || truncated) fail("events (duplicates) read", error ?? { message: "too many rows" });
    for (const r of rows) out.set(r.id, toExisting(r));
  }
  return [...out.values()];
}

/** The existing events one show could be (its day ± 1, the subject's names and the show's own clubs) - the build's re-check. */
export async function existingForShow(show: ShowIdentity, subject: Subject, includeTest: boolean): Promise<ExistingEvent[]> {
  return readExistingEvents(subject, { from: addDays(show.date, -1), to: addDays(show.date, 2) }, [show.home_team, show.away_team], includeTest);
}

// ---- fallback (XS2Event / P1, information only) ---------------------------------------------------

type FallbackRow = { source: "xs2event" | "p1"; title: string; date: string; city: string | null; country: string | null; home: string | null; away: string | null; competition: string | null };

/** Is a fallback row about the subject: the same "who" rules as the main catalogs, loosely (it is information only). */
function fallbackIsSubject(row: FallbackRow, subject: Subject, scope: UploaderPlan["scope"]): boolean {
  const names = [subject.name_en, subject.name_he, ...subject.aliases].map((n) => normalizeName(n)).filter((n) => n !== "");
  switch (subject.kind) {
    case "artist":
      return names.some((n) => normalizeName(row.title).includes(n));
    case "team": {
      const isTeam = (side: string | null): boolean => !!side && [subject.name_en, ...subject.aliases].some((a) => clubNamesMatch(side, a));
      return isTeam(row.home) || (!scope.home_only && isTeam(row.away));
    }
    case "competition":
      return names.some((n) => normalizeName(row.competition).includes(n));
  }
}

/**
 * XS2Event / P1 rows of the subject inside the window, keyed like the run's shows: a row lands on
 * a found show's key when one sits on its city and home side within a day (`date ± 1`), else on a
 * key of its own (a show only those two list). Never a ticket - "נמצא ב-XS2Event / P1 (מידע בלבד)".
 */
async function findFallback(
  subject: Subject,
  plan: UploaderPlan,
  window: SearchWindow,
  shows: ShowIdentity[],
): Promise<Map<string, ("xs2event" | "p1")[]>> {
  const { latin } = subjectPatterns(subject);
  const out = new Map<string, ("xs2event" | "p1")[]>();
  if (latin.length === 0) return out;

  const xsColumns = subject.kind === "competition" ? ["tournament_name"] : ["event_name", "hometeam_name", "visiting_name"];
  const p1Columns = subject.kind === "competition" ? ["category", "series_name"] : ["title_english"];
  const rows: FallbackRow[] = [];
  for (const part of chunks(latin, OR_PATTERNS_MAX)) {
    const [xs, p1] = await Promise.all([
      pagedOnceMore<{ id: string; event_name: string; date_start: string; city: string | null; iso_country: string | null; hometeam_name: string | null; visiting_name: string | null; tournament_name: string }>(() => {
        let q = supabaseTyped
          .from("xs2e_events")
          .select("id:event_id,event_name,date_start,city,iso_country,hometeam_name,visiting_name,tournament_name")
          .gte("date_start", window.from);
        q = q.lt("date_start", window.to);
        return q.or(orIlike(xsColumns, part)).order("date_start").order("event_id");
      }, SEARCH_ROWS_MAX),
      pagedOnceMore<{ id: string; title_english: string; date_start: string; venue_city: string; venue_country_code: string | null; category: string; series_name: string | null }>(() => {
        let q = supabaseTyped
          .from("p1_events")
          .select("id:event_id,title_english,date_start,venue_city,venue_country_code,category,series_name")
          .eq("is_active", true)
          .gte("date_start", window.from);
        q = q.lt("date_start", window.to);
        return q.or(orIlike(p1Columns, part)).order("date_start").order("event_id");
      }, SEARCH_ROWS_MAX),
    ]);
    if (xs.error || xs.truncated) fail("xs2e_events read", xs.error ?? { message: "too many rows" });
    if (p1.error || p1.truncated) fail("p1_events read", p1.error ?? { message: "too many rows" });
    for (const r of xs.rows) {
      rows.push({ source: "xs2event", title: r.event_name, date: r.date_start, city: r.city, country: r.iso_country, home: r.hometeam_name, away: r.visiting_name, competition: r.tournament_name });
    }
    for (const r of p1.rows) {
      const sides = fixtureSidesOf(r.title_english);
      rows.push({
        source: "p1",
        title: r.title_english,
        date: r.date_start,
        city: r.venue_city,
        country: r.venue_country_code,
        home: sides?.[0]?.trim() ?? null,
        away: sides?.[1]?.trim() ?? null,
        competition: [r.category, r.series_name].filter(Boolean).join(" "),
      });
    }
  }

  const football = subject.kind !== "artist";
  const foundKeys = new Set(shows.map((s) => showKey(s.country_code, s.city, s.date, s.home_team)));
  for (const row of rows) {
    if (!fallbackIsSubject(row, subject, plan.scope)) continue;
    const day = calendarDay(row.date);
    const home = football ? row.home : null;
    const near = [day, addDays(day, -1), addDays(day, 1)].map((d) => showKey(row.country, row.city, d, home)).find((k) => foundKeys.has(k));
    const key = near ?? showKey(row.country, row.city, day, home);
    const sources = out.get(key) ?? [];
    if (!sources.includes(row.source)) out.set(key, [...sources, row.source]);
  }
  return out;
}

// ---- find the shows ------------------------------------------------------------------------------

/** A supplier row named for the "לא נכלל" list: `<row>:<id>` -> its name, printed day and city. */
export type ExcludedInfo = Record<string, { name: string; date: string; city: string }>;

export type Candidates = Grouped & {
  fallback: Map<string, ("xs2event" | "p1")[]>;
  excludedInfo: ExcludedInfo;
  /** The SQL window the reads used (`searchWindow`). */
  window: SearchWindow;
  /** The clubs of a competition's fixtures - the names its existing events are found by ([] otherwise). */
  clubs: (string | null)[];
};

/**
 * The supplier side of `findShows`: the subject's rows inside the plan's window grouped by
 * `groupRows`, XS2Event / P1 information per show key (`fallback`), and the name of every row
 * `groupRows` left out (`excludedInfo`), so the board can print "Journeyman - A Tribute to Eric
 * Clapton (tribute)" rather than an id. Reads no `events`.
 */
export async function findCandidates(plan: UploaderPlan, subject: Subject, now: Date = new Date()): Promise<Candidates> {
  const window = searchWindow(plan.scope, now);
  const [tix, live] = await Promise.all([searchTixRows(subject, window), searchLiveRows(subject, window)]);
  const grouped = groupRows(tix, live, subject, plan, now);

  const allShows = [...grouped.shows, ...grouped.questions.map((q) => q.show)];
  // A competition's fixtures are named by their clubs: those names find its existing events.
  const clubs = subject.kind === "competition" ? [...new Set(allShows.flatMap((s) => [s.home_team, s.away_team]))] : [];
  const fallback = await findFallback(subject, plan, window, allShows);

  const excludedInfo: ExcludedInfo = {};
  const tixById = new Map(tix.map((r) => [r.event_id, r]));
  const liveById = new Map(live.map((r) => [String(r.event_id), r]));
  for (const e of grouped.excluded) {
    const r = e.row === "tixstock" ? tixById.get(e.id) : liveById.get(e.id);
    if (r) excludedInfo[`${e.row}:${e.id}`] = { name: r.event_name, date: calendarDay(r.show_date), city: (r.city_name ?? "").trim() };
  }
  return { ...grouped, fallback, excludedInfo, window, clubs };
}

/**
 * The run's shows (spec 8.2-8.3): `findCandidates`, plus the events already on the site that a
 * show could be (`existing`, live and hidden - `existingEventFor` decides per show). Pass
 * `includeTest: run.is_test` - a test run's duplicates include test events, a real run's do not.
 */
export async function findShows(
  plan: UploaderPlan,
  subject: Subject,
  opts: { includeTest?: boolean; now?: Date } = {},
): Promise<Grouped & { existing: ExistingEvent[]; fallback: Map<string, ("xs2event" | "p1")[]>; excludedInfo: ExcludedInfo }> {
  const found = await findCandidates(plan, subject, opts.now ?? new Date());
  const existing = await readExistingEvents(subject, found.window, found.clubs, opts.includeTest === true);
  return { shows: found.shows, questions: found.questions, excluded: found.excluded, existing, fallback: found.fallback, excludedInfo: found.excludedInfo };
}
