/**
 * Tour uploader (agent #3) - the plan a brief becomes, and every rule about trusting one.
 *
 * `UploaderPlan` (types/uploader.types.ts) is what staff confirm before anything is built. The
 * model fills it through one forced tool call (`PLAN_TOOL_SCHEMA`); `parsePlanInput` checks that
 * answer field by field. A bad field never throws and never hides the rest: it is named in
 * `problems` and replaced by the empty plan's value, so the manual form opens with everything
 * that could be salvaged. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md
 * section 7.
 *
 * Pure - no DB, no network. Selftest: scripts/tour-uploader-selftest.ts.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { LIST_MAX, MARKUP_MAX, NAME_MAX, NOTE_MAX, OPEN_WINDOW_MONTHS, SHOW_WINDOW_DAYS } from "@/lib/uploader/constants";
import type { SubjectKind, UploaderPlan } from "@/types/uploader.types";

const SUBJECT_KINDS = ["artist", "team", "competition"] as const satisfies readonly SubjectKind[];
const WITHOUT_LOCATION = ["ticket_only", "skip"] as const;
const SUPPLIERS = ["tixstock", "livetickets"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The plan before the brief says anything: an artist, no window, packages where a location
 * exists and no event where none does, no markups chosen. A fresh object on every call -
 * callers push into its arrays.
 */
export function emptyPlan(): UploaderPlan {
  return {
    subject: { kind: "artist", name_he: null, name_en: "" },
    scope: { date_from: null, date_to: null, home_only: true, round: null, exclude_cities: [], include_cities: [] },
    rules: { with_location: "package", without_location: "skip" },
    markups: { ticket_only: null, additional: null },
    suppliers: ["tixstock", "livetickets"],
    notes: [],
  };
}

/**
 * The tool schema the model must answer with (a forced tool call). It mirrors `UploaderPlan`
 * key for key - the selftest compares the two, so a field added to the type cannot be forgotten
 * here. Used as a forced, non-strict tool call - the min/max/pattern fields are hints to the
 * model; `parsePlanInput` enforces them.
 */
export const PLAN_TOOL_SCHEMA: Anthropic.Tool["input_schema"] = {
  type: "object",
  properties: {
    subject: {
      type: "object",
      description: "Who the brief is about. One subject per brief.",
      properties: {
        kind: {
          type: "string",
          enum: [...SUBJECT_KINDS],
          description: "artist = a performer or band; team = a football club; competition = a league or cup.",
        },
        name_he: { type: ["string", "null"], maxLength: NAME_MAX, description: "The Hebrew name when the brief gives one, else null." },
        name_en: {
          type: "string",
          minLength: 1,
          maxLength: NAME_MAX,
          description: 'The English name as a ticket supplier prints it ("Eric Clapton", "Liverpool FC").',
        },
      },
      required: ["kind", "name_he", "name_en"],
      additionalProperties: false,
    },
    scope: {
      type: "object",
      description: "Which shows to look for.",
      properties: {
        date_from: { type: ["string", "null"], pattern: DATE_RE.source, description: "First day, YYYY-MM-DD, or null for no limit." },
        date_to: { type: ["string", "null"], pattern: DATE_RE.source, description: "Last day, YYYY-MM-DD, or null for no limit." },
        home_only: {
          type: "boolean",
          description: "Football: true = only the team's home games (the default) unless the brief says all games or away games.",
        },
        round: { type: ["string", "null"], maxLength: NAME_MAX, description: 'A competition round ("Round of 16"), or null.' },
        exclude_cities: {
          type: "array",
          items: { type: "string", maxLength: NAME_MAX },
          maxItems: LIST_MAX,
          description: "Cities the brief says to leave out.",
        },
        include_cities: {
          type: "array",
          items: { type: "string", maxLength: NAME_MAX },
          maxItems: LIST_MAX,
          description: "Only these cities, when the brief names them. Empty = every city.",
        },
      },
      required: ["date_from", "date_to", "home_only", "round", "exclude_cities", "include_cities"],
      additionalProperties: false,
    },
    rules: {
      type: "object",
      description: "How to treat a show by whether a flight-and-hotel location exists near it.",
      properties: {
        with_location: { type: "string", enum: ["package"], description: "Always package: flight + hotel + ticket." },
        without_location: {
          type: "string",
          enum: [...WITHOUT_LOCATION],
          description: "ticket_only = sell the ticket alone; skip = do not build the show. skip unless the brief asks for ticket-only.",
        },
      },
      required: ["with_location", "without_location"],
      additionalProperties: false,
    },
    markups: {
      type: "object",
      description: "Whole dollars the brief asks to add, never a price. null = the brief says nothing.",
      properties: {
        ticket_only: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: MARKUP_MAX,
          description: "Added to a ticket-only event's ticket (ticket_only_markup).",
        },
        additional: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: MARKUP_MAX,
          description: "Added on top of a package's price (event_additional_markup).",
        },
      },
      required: ["ticket_only", "additional"],
      additionalProperties: false,
    },
    suppliers: {
      type: "array",
      items: { type: "string", enum: [...SUPPLIERS] },
      minItems: SUPPLIERS.length,
      maxItems: SUPPLIERS.length,
      description: "Always exactly [tixstock, livetickets]. Shown to the person, never chosen.",
    },
    notes: {
      type: "array",
      items: { type: "string", maxLength: NOTE_MAX },
      maxItems: LIST_MAX,
      description: "Anything in the brief that fits no field above, so the person can read it. [] when nothing is left over.",
    },
  },
  required: ["subject", "scope", "rules", "markups", "suppliers", "notes"],
  additionalProperties: false,
};

/**
 * `problems` is always there: empty when the plan is fine, one `"<dotted field>: <why>"` line per
 * bad field otherwise. `plan` is the salvaged plan in both cases and is always whole.
 */
export type PlanParse =
  | { ok: true; plan: UploaderPlan; problems: [] }
  | { ok: false; plan: UploaderPlan; problems: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A nested block of the answer. Absent = empty (its fields take their defaults); present but not an object = a problem. */
function block(raw: Obj, key: string, problems: string[]): Obj {
  const v = raw[key];
  if (v === undefined) return {};
  if (isObj(v)) return v;
  problems.push(`${key}: must be an object`);
  return {};
}

/** Free text, trimmed. Absent / blank = null. Not a string, or over NAME_MAX = a problem and null. */
function optionalText(v: unknown, field: string, problems: string[]): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") {
    problems.push(`${field}: must be text or null`);
    return null;
  }
  const text = v.trim();
  if (text.length > NAME_MAX) {
    problems.push(`${field}: longer than ${NAME_MAX} characters`);
    return null;
  }
  return text === "" ? null : text;
}

/** The English name: like optionalText but required, so a blank is a problem too. */
function requiredName(v: unknown, field: string, problems: string[]): string {
  if (typeof v !== "string" || v.trim() === "") {
    problems.push(`${field}: required`);
    return "";
  }
  const text = v.trim();
  if (text.length > NAME_MAX) {
    problems.push(`${field}: longer than ${NAME_MAX} characters`);
    return "";
  }
  return text;
}

function readKind(v: unknown, problems: string[]): SubjectKind {
  const kind = SUBJECT_KINDS.find((k) => k === v);
  if (kind) return kind;
  problems.push(`subject.kind: must be one of ${SUBJECT_KINDS.join(", ")}`);
  return emptyPlan().subject.kind;
}

/** A real calendar day in YYYY-MM-DD: "2027-02-30" has the shape and is no day. */
function isCalendarDay(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  const t = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === text;
}

function readDate(v: unknown, field: string, problems: string[]): string | null {
  if (v === undefined || v === null) return null;
  const text = typeof v === "string" ? v.trim() : "";
  if (isCalendarDay(text)) return text;
  problems.push(`${field}: must be a real date (YYYY-MM-DD) or null`);
  return null;
}

const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The first day a plan searches: its `date_from`, never before today + SHOW_WINDOW_DAYS (the site
 * stops selling a show that close). The search's window (`searchWindow`) starts here too.
 */
export function planWindowStart(dateFrom: string | null, now: Date = new Date()): string {
  const floor = addDays(now.toISOString().slice(0, 10), SHOW_WINDOW_DAYS);
  return dateFrom !== null && dateFrom > floor ? dateFrom : floor;
}

/** The last day a plan may search: OPEN_WINDOW_MONTHS after its start (`planWindowStart`). */
export function planWindowCap(start: string): string {
  const cap = new Date(`${start}T00:00:00Z`);
  cap.setUTCMonth(cap.getUTCMonth() + OPEN_WINDOW_MONTHS);
  return cap.toISOString().slice(0, 10);
}

/**
 * `date_to` held to the window: before `date_from` = no end (dropped, with a problem line); past
 * `planWindowCap` = cut to it (with a problem line). Every search, preview and run reads a bounded
 * window - an unbounded end fanned one search out into thousands of 120-day slices.
 */
function boundDateTo(dateFrom: string | null, dateTo: string | null, now: Date, problems: string[]): string | null {
  if (dateTo === null) return null;
  if (dateFrom !== null && dateFrom > dateTo) {
    problems.push("scope.date_to: before scope.date_from - dropped");
    return null;
  }
  const cap = planWindowCap(planWindowStart(dateFrom, now));
  if (dateTo > cap) {
    problems.push(`scope.date_to: more than ${OPEN_WINDOW_MONTHS} months after the start - cut to ${cap}`);
    return cap;
  }
  return dateTo;
}

/** Absent = `fallback` (a plain omission); present but not a boolean = a problem and `fallback`. */
function readBool(v: unknown, field: string, fallback: boolean, problems: string[]): boolean {
  if (v === undefined) return fallback;
  if (typeof v === "boolean") return v;
  problems.push(`${field}: must be true or false`);
  return fallback;
}

/** The one test for a markup value: a whole number of dollars from 0 to MARKUP_MAX. Shared by the parser and the prior defaults. */
const isMarkup = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MARKUP_MAX;

/** A markup is a whole number of dollars, 0..MARKUP_MAX, or null (= the brief says nothing). */
function readMarkup(v: unknown, field: string, problems: string[]): number | null {
  if (v === undefined || v === null) return null;
  if (isMarkup(v)) return v || 0; // `|| 0` turns a JSON "-0" into 0
  problems.push(`${field}: must be a whole number from 0 to ${MARKUP_MAX}, or null`);
  return null;
}

/**
 * A list of trimmed non-blank strings. Non-strings are dropped quietly (a stray number in a
 * city list is noise); more than LIST_MAX entries or a non-array is a problem and an empty list.
 * An entry longer than `itemMax` characters is dropped with a problem line (the rest are kept).
 */
function readList(v: unknown, field: string, itemMax: number, problems: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    problems.push(`${field}: must be a list of text`);
    return [];
  }
  const items = v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x !== "");
  if (items.length > LIST_MAX) {
    problems.push(`${field}: more than ${LIST_MAX} entries`);
    return [];
  }
  const kept = items.filter((x) => x.length <= itemMax);
  const cut = items.length - kept.length;
  if (cut > 0) problems.push(`${field}: ${cut === 1 ? "an entry" : `${cut} entries`} longer than ${itemMax} characters dropped`);
  return kept;
}

function readPlan(raw: unknown, problems: string[], now: Date): UploaderPlan {
  if (!isObj(raw)) {
    problems.push("plan: must be an object");
    return emptyPlan();
  }
  const subject = block(raw, "subject", problems);
  const scope = block(raw, "scope", problems);
  const rules = block(raw, "rules", problems);
  const markups = block(raw, "markups", problems);

  const withoutLocation =
    rules.without_location === undefined
      ? emptyPlan().rules.without_location
      : (WITHOUT_LOCATION.find((m) => m === rules.without_location) ?? null);
  if (withoutLocation === null) problems.push(`rules.without_location: must be one of ${WITHOUT_LOCATION.join(", ")}`);

  const dateFrom = readDate(scope.date_from, "scope.date_from", problems);
  const dateTo = boundDateTo(dateFrom, readDate(scope.date_to, "scope.date_to", problems), now, problems);

  return {
    subject: {
      kind: readKind(subject.kind, problems),
      name_he: optionalText(subject.name_he, "subject.name_he", problems),
      name_en: requiredName(subject.name_en, "subject.name_en", problems),
    },
    scope: {
      date_from: dateFrom,
      date_to: dateTo,
      home_only: readBool(scope.home_only, "scope.home_only", true, problems),
      round: optionalText(scope.round, "scope.round", problems),
      exclude_cities: readList(scope.exclude_cities, "scope.exclude_cities", NAME_MAX, problems),
      include_cities: readList(scope.include_cities, "scope.include_cities", NAME_MAX, problems),
    },
    // Not the model's choices: a location always means a package, and the suppliers are fixed.
    rules: { with_location: "package", without_location: withoutLocation ?? emptyPlan().rules.without_location },
    markups: {
      ticket_only: readMarkup(markups.ticket_only, "markups.ticket_only", problems),
      additional: readMarkup(markups.additional, "markups.additional", problems),
    },
    suppliers: ["tixstock", "livetickets"],
    notes: readList(raw.notes, "notes", NOTE_MAX, problems),
  };
}

/**
 * Check the model's tool answer (or a form's payload). Never throws - see the file header. `now`
 * anchors the window rule (`boundDateTo`: today + SHOW_WINDOW_DAYS is the earliest start).
 */
export function parsePlanInput(raw: unknown, now: Date = new Date()): PlanParse {
  const problems: string[] = [];
  try {
    const plan = readPlan(raw, problems, now);
    return problems.length === 0 ? { ok: true, plan, problems: [] } : { ok: false, plan, problems };
  } catch (e) {
    // An object whose property reads throw (a hostile getter / Proxy) - nothing here is trustworthy.
    return { ok: false, plan: emptyPlan(), problems: [`plan: unreadable (${e instanceof Error ? e.message : String(e)})`] };
  }
}

/** Every leaf of the plan the diff compares, in the order the plan card and the lesson print them. `suppliers` is fixed, so it is not one. */
const DIFF_LEAVES: { field: string; get: (p: UploaderPlan) => unknown }[] = [
  { field: "subject.kind", get: (p) => p.subject.kind },
  { field: "subject.name_he", get: (p) => p.subject.name_he },
  { field: "subject.name_en", get: (p) => p.subject.name_en },
  { field: "scope.date_from", get: (p) => p.scope.date_from },
  { field: "scope.date_to", get: (p) => p.scope.date_to },
  { field: "scope.home_only", get: (p) => p.scope.home_only },
  { field: "scope.round", get: (p) => p.scope.round },
  { field: "scope.exclude_cities", get: (p) => p.scope.exclude_cities },
  { field: "scope.include_cities", get: (p) => p.scope.include_cities },
  { field: "rules.with_location", get: (p) => p.rules.with_location },
  { field: "rules.without_location", get: (p) => p.rules.without_location },
  { field: "markups.ticket_only", get: (p) => p.markups.ticket_only },
  { field: "markups.additional", get: (p) => p.markups.additional },
  { field: "notes", get: (p) => p.notes },
];

/**
 * What staff changed between the plan the model proposed and the one they confirmed - the
 * correction the agent learns from. One entry per changed leaf, dotted field names, arrays
 * compared (and reported) whole by value.
 */
export function planDiff(before: UploaderPlan, after: UploaderPlan): { field: string; from: unknown; to: unknown }[] {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const { field, get } of DIFF_LEAVES) {
    const from = get(before);
    const to = get(after);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Fill the markups the brief left empty from the last confirmed run's. Only a null markup is
 * filled (a 0 is a choice), and only from a prior value that is itself a valid markup (the same
 * whole number 0..MARKUP_MAX test as the parser) - `prior` comes out of a jsonb row, so a missing
 * key, a string or an out-of-range number fills nothing and is not reported. `fromPrior` names
 * what was filled so the card can say where each number came from. Returns a copy; the input is
 * untouched.
 */
export function applyPriorDefaults(
  plan: UploaderPlan,
  prior: { ticket_only: number | null; additional: number | null } | null,
): { plan: UploaderPlan; fromPrior: ("ticket_only" | "additional")[] } {
  const out = structuredClone(plan);
  const fromPrior: ("ticket_only" | "additional")[] = [];
  if (!prior) return { plan: out, fromPrior };
  for (const key of ["ticket_only", "additional"] as const) {
    const value: unknown = prior[key];
    if (out.markups[key] === null && isMarkup(value)) {
      out.markups[key] = value || 0;
      fromPrior.push(key);
    }
  }
  return { plan: out, fromPrior };
}
