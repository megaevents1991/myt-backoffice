/**
 * Tour uploader (agent #3) - the rules the server actions (lib/actions/uploader-actions.ts) act on,
 * kept pure so the selftest can run them on made-up rows: what a person may type, what an answer
 * does to a show, which items a new run starts with, and how a run's counts and status follow its
 * items. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 10-11.
 *
 * Pure - no DB, no network, no clock except the timestamps a caller hands in. Selftest:
 * scripts/tour-uploader-selftest.ts ("Task 8").
 */
import { decision } from "@/lib/uploader/decisions";
import {
  existingEventFor,
  priorAnswerFor,
  priorRejectionFor,
  showKey,
  type ExistingEvent,
  type PriorItem,
} from "@/lib/uploader/shows";
import {
  ITEM_STATUSES,
  type Decision,
  type ItemStatus,
  type RunStatus,
  type ShowIdentity,
  type SubjectKind,
  type UploaderQuestion,
} from "@/types/uploader.types";

// ---- input limits ---------------------------------------------------------------------------------

/** The longest brief the parser is handed (characters). */
export const BRIEF_MAX = 4000;
/** An answer's option key and free text (characters, after trimming). */
export const ANSWER_KEY_MAX = 80;
export const ANSWER_TEXT_MAX = 500;
/** A rejection reason (characters, after trimming); the floor is REJECT_REASON_MIN (constants.ts). */
export const REJECT_REASON_MAX = 500;
/** The skip reason of a show a person (or an earlier run's answer) said to skip - the build writes the same one. */
export const SKIPPED_BY_ANSWER = "skipped_by_answer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A row id of `uploader_runs` / `uploader_items` (and a user id). */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** A `locations` id: a positive whole number. */
export function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

// ---- answers --------------------------------------------------------------------------------------

export type AnswerInput = { key: string | null; text: string | null };

/** One optional text field of an answer: absent / null / blank = null; not a string or too long = invalid. */
function answerField(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t === "" ? null : t;
}

/**
 * The shape check of what the board sends: `{ key, text }`, each null or text (key up to
 * ANSWER_KEY_MAX, text up to ANSWER_TEXT_MAX, trimmed), at least one of them given. Anything else
 * -> null (the action answers `bad_input` before reading a row).
 */
export function cleanAnswerInput(raw: unknown): AnswerInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const key = answerField(r.key, ANSWER_KEY_MAX);
  const text = answerField(r.text, ANSWER_TEXT_MAX);
  if (key === undefined || text === undefined) return null;
  if (key === null && text === null) return null;
  return { key, text };
}

/**
 * Does the answer fit the stored question: a key must be one of the question's own options (they
 * were written by the system, so membership is the whole rule - `<tix id>` / `live:<id>` / `both` /
 * `skip` for pick_show, `tix:<day>` / `live:<day>` / `both` / `skip` for pick_date, a locations id
 * or `skip` for pick_location, `yes` / `skip` for confirm_subject); no key = free text, only where
 * the question allows it. `label` = the chosen option's label (for the task note).
 */
export function checkAnswer(q: UploaderQuestion, a: AnswerInput): { ok: true; label: string | null } | { ok: false } {
  if (a.key !== null) {
    const option = q.options.find((o) => o.key === a.key);
    return option ? { ok: true, label: option.label } : { ok: false };
  }
  return q.free_text && a.text !== null && a.text.trim() !== "" ? { ok: true, label: null } : { ok: false };
}

export type StoredAnswer = NonNullable<UploaderQuestion["answer"]>;

/** A show the "both" answer adds as an item of its own, with the question it was split from (already answered). */
export type SplitShow = { show: ShowIdentity; question: UploaderQuestion };

/**
 * What an answer does to the item (spec 10):
 * - `skip`: the show is skipped (SKIPPED_BY_ANSWER).
 * - `both` on `pick_show`: every listing becomes its own item. The item keeps the listing its show
 *   already holds; each other listing is a new item whose question copies this one, answered with
 *   that listing's key (the build's `applyShowAnswer` re-reads the listing), and which carries ONLY
 *   that site's listing - the other supplier's partner stays with the first item, never on two
 *   events. The copy's question key gets a `#both:<n>` suffix so a later run's `priorAnswerFor`
 *   only ever sees the "both" of the first item.
 * - `both` on `pick_date`: two shows - TixStock's on its day (the item), LiveTickets' on its day (a
 *   new item, answered `live:<day>`).
 * - `tix:<day>` / `live:<day>` on `pick_date`: the item's show moves to that day.
 * - anything else (a listing id, a location, `yes`, free text): the show is unchanged here and the
 *   build applies the answer from `question.answer` (it re-reads the chosen listing / location).
 */
export type AnswerEffect =
  | { kind: "skip" }
  | { kind: "requeue"; show: ShowIdentity }
  | { kind: "split"; show: ShowIdentity; extra: SplitShow[] };

const DAY_KEY = /^(tix|live):(\d{4}-\d{2}-\d{2})$/;

/** The listing key a show already holds for one site: the TixStock id, or `live:<id>`. */
function heldListing(show: ShowIdentity, live: boolean): string | null {
  if (live) return show.suppliers.livetickets ? `live:${show.suppliers.livetickets.event_id}` : null;
  return show.suppliers.tixstock?.event_id ?? null;
}

export function answerEffect(q: UploaderQuestion, show: ShowIdentity, answer: StoredAnswer): AnswerEffect {
  const key = answer.key;
  if (key === "skip") return { kind: "skip" };
  const copyQuestion = (n: number, optionKey: string): UploaderQuestion => ({
    ...q,
    key: `${q.key}#both:${n}`,
    task_id: null,
    answer: { ...answer, key: optionKey },
  });

  if (key === "both" && q.kind === "pick_show") {
    const listings = q.options.filter((o) => o.key !== "both" && o.key !== "skip");
    const live = listings.length > 0 && listings.every((o) => o.key.startsWith("live:"));
    const held = heldListing(show, live);
    const keepIndex = Math.max(0, listings.findIndex((o) => o.key === held));
    const others = listings.filter((_, i) => i !== keepIndex);
    const siteOnly: ShowIdentity = live
      ? { ...show, suppliers: { tixstock: null, livetickets: show.suppliers.livetickets } }
      : { ...show, suppliers: { tixstock: show.suppliers.tixstock, livetickets: null } };
    return {
      kind: "split",
      show,
      extra: others.map((o, i) => ({ show: { ...siteOnly, fallback: [...siteOnly.fallback] }, question: copyQuestion(i + 2, o.key) })),
    };
  }

  if (key === "both" && q.kind === "pick_date") {
    const days = q.options.map((o) => DAY_KEY.exec(o.key)).filter((m): m is RegExpExecArray => m !== null);
    const tixDay = days.find((m) => m[1] === "tix")?.[2] ?? show.date;
    const liveDay = days.find((m) => m[1] === "live")?.[2] ?? show.date;
    return {
      kind: "split",
      show: { ...show, date: tixDay, suppliers: { tixstock: show.suppliers.tixstock, livetickets: null } },
      extra: [
        {
          show: { ...show, date: liveDay, fallback: [...show.fallback], suppliers: { tixstock: null, livetickets: show.suppliers.livetickets } },
          question: copyQuestion(2, `live:${liveDay}`),
        },
      ],
    };
  }

  if (q.kind === "pick_date" && key !== null) {
    const day = DAY_KEY.exec(key)?.[2];
    if (day) return { kind: "requeue", show: { ...show, date: day } };
  }
  return { kind: "requeue", show };
}

// ---- a new run's items ----------------------------------------------------------------------------

/** One row a new run inserts into `uploader_items`. `ask` = a question still waiting for a person (the action opens its task). */
export type ItemDraft = {
  position: number;
  show: ShowIdentity;
  status: Extract<ItemStatus, "found" | "question" | "skipped">;
  skip_reason: string | null;
  decisions: Decision[];
  question: UploaderQuestion | null;
  ask: boolean;
};

type Entry = { show: ShowIdentity; question: UploaderQuestion | null };

const byShow = (a: Entry, b: Entry): number =>
  a.show.date.localeCompare(b.show.date) || a.show.city.localeCompare(b.show.city) || a.show.name_english.localeCompare(b.show.name_english);

/**
 * The items a run starts with (spec 8.3-8.4, 10), soonest show first (`position` 0, 1, ...):
 * 1. a show already on `events` (live or hidden, `existingEventFor`) -> skipped `exists`, decision `duplicate_dropped`;
 * 2. a show an earlier run rejected for good (`priorRejectionFor`) -> skipped `rejected_before`;
 * 3. a grouping question an earlier run answered (`priorAnswerFor`, and the answer still fits this
 *    question's options) -> applied exactly as `answerQuestion` applies it (`answerEffect`), decision
 *    `prior_answer`, no task; a "both" adds its extra items right after;
 * 4. any other question -> `question`, waiting for a person (`ask`);
 * 5. the rest -> `found`.
 * Every show carries its XS2Event / P1 sightings (`fallback`, by `showKey`).
 */
export function planRunItems(input: {
  shows: ShowIdentity[];
  questions: { show: ShowIdentity; question: UploaderQuestion }[];
  existing: ExistingEvent[];
  priors: PriorItem[];
  fallback: Map<string, ("xs2event" | "p1")[]>;
  subject_en: string;
  /** ISO time stamped on an answer applied from an earlier run. */
  at: string;
}): ItemDraft[] {
  const withFallback = (show: ShowIdentity): ShowIdentity => ({
    ...show,
    fallback: [...(input.fallback.get(showKey(show.country_code, show.city, show.date, show.home_team)) ?? [])],
  });
  const entries: Entry[] = [
    ...input.shows.map((show) => ({ show: withFallback(show), question: null })),
    ...input.questions.map((q) => ({ show: withFallback(q.show), question: q.question })),
  ].sort(byShow);

  const out: ItemDraft[] = [];
  const push = (d: Omit<ItemDraft, "position">): void => {
    out.push({ ...d, position: out.length });
  };

  for (const { show, question } of entries) {
    const dup = existingEventFor(show, input.existing);
    if (dup) {
      push({
        show,
        status: "skipped",
        skip_reason: "exists",
        decisions: [decision("duplicate_dropped", { name: dup.name_english ?? show.name_english, event_id: dup.id })],
        question: null, // nothing left to ask about a show that is not built
        ask: false,
      });
      continue;
    }
    const rejected = priorRejectionFor(show, input.subject_en, input.priors);
    if (rejected) {
      push({
        show,
        status: "skipped",
        skip_reason: "rejected_before",
        decisions: [decision("rejected_before", { run: rejected.run_no, by: rejected.by, reason: rejected.reason ?? "" })],
        question: null,
        ask: false,
      });
      continue;
    }
    if (!question) {
      push({ show, status: "found", skip_reason: null, decisions: [], question: null, ask: false });
      continue;
    }
    const prior = priorAnswerFor({ subject_en: input.subject_en, kind: question.kind, key: question.key }, input.priors);
    const fits = prior?.answer ? checkAnswer(question, prior.answer).ok : false;
    if (!prior?.answer || !fits) {
      push({ show, status: "question", skip_reason: null, decisions: [], question, ask: true });
      continue;
    }
    const answer: StoredAnswer = { key: prior.answer.key, text: prior.answer.text, by: prior.by, at: input.at };
    const answered: UploaderQuestion = { ...question, answer };
    const decisions = [decision("prior_answer", { name: prior.by, run: prior.run_no })];
    const effect = answerEffect(question, show, answer);
    if (effect.kind === "skip") {
      push({ show, status: "skipped", skip_reason: SKIPPED_BY_ANSWER, decisions, question: answered, ask: false });
      continue;
    }
    push({ show: effect.show, status: "found", skip_reason: null, decisions, question: answered, ask: false });
    if (effect.kind === "split") {
      for (const extra of effect.extra) {
        push({ show: extra.show, status: "found", skip_reason: null, decisions: [...decisions], question: extra.question, ask: false });
      }
    }
  }
  return out;
}

// ---- the plan card's preview ----------------------------------------------------------------------

/** What a plan would find before anything is built (the "מה הבנתי" card). */
export type PlanPreview = {
  /** Shows ready to build (questions not counted). */
  shows: number;
  /** Shows waiting on a question. */
  questions: number;
  /** Of `shows`, how many are already on the site (live or hidden). */
  existing: number;
  /** Every city a show or a question is in, soonest first, once each. */
  cities: string[];
};

/** The preview of nothing (no subject yet - the manual form before it is filled). */
export const EMPTY_PREVIEW: PlanPreview = { shows: 0, questions: 0, existing: 0, cities: [] };

/** `findShows`' answer as the plan card counts it. */
export function planPreview(found: {
  shows: ShowIdentity[];
  questions: { show: ShowIdentity }[];
  existing: ExistingEvent[];
}): PlanPreview {
  const existing = found.shows.filter((s) => existingEventFor(s, found.existing) !== null).length;
  const all = [...found.shows, ...found.questions.map((q) => q.show)].sort((a, b) => a.date.localeCompare(b.date));
  const cities: string[] = [];
  for (const s of all) {
    const city = s.city.trim();
    if (city !== "" && !cities.includes(city)) cities.push(city);
  }
  return { shows: found.shows.length, questions: found.questions.length, existing, cities };
}

// ---- the edit diff's read -------------------------------------------------------------------------

/**
 * The `events` columns `editDiff` compares (EDIT_WHITELIST; `tickets_count` is read off
 * `tickets_and_rates`), plus the id - one explicit select for the board's "נערך" tag and approve.
 * The selftest checks it names every whitelisted field.
 */
export const EDIT_EVENT_COLUMNS =
  "id,name,name_english,date,def_date_depart,def_date_return,base_flight_price,base_hotel_price,event_additional_markup,ticket_only_markup,package_mode,location,event_location,lodging_mode,lodging_default,split_default_nights,tickets_and_rates" as const;

// ---- a run's counts and status --------------------------------------------------------------------

/** Items per status (every status, zeros included) plus `total` - what `uploader_runs.counts` holds. */
export function runCounts(statuses: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0]));
  for (const s of statuses) if (s in counts) counts[s] += 1;
  counts.total = statuses.length;
  return counts;
}

/**
 * The run's status from its items: `building` while anything is still to build (found / building),
 * then `waiting` while a question is open, then `review` while a built event waits for approval,
 * else `done`. `stopped` (a person stopped it) and `error` stay as they are - only a person moves a
 * run out of them.
 */
export function nextRunStatus(current: string, counts: Record<string, number>): RunStatus {
  if (current === "stopped" || current === "error") return current;
  const n = (k: string): number => counts[k] ?? 0;
  if (n("found") + n("building") > 0) return "building";
  if (n("question") > 0) return "waiting";
  if (n("ready") > 0) return "review";
  return "done";
}

/** The statuses `nextRunStatus` may overwrite (the sticky ones are not in it). */
export const RECOMPUTED_RUN_STATUSES: RunStatus[] = ["planned", "building", "waiting", "review", "done"];

/**
 * May "המשך" put the run back to building (spec 9: a run is resumable from any point): a stopped
 * run always (its items are as it left them); a run in a non-terminal status only when an item is
 * still waiting to be built (`found`). `done` and `error` are terminal.
 */
export function canResume(status: string, foundLeft: number): boolean {
  if (status === "stopped") return true;
  return (["planned", "building", "waiting", "review"] as string[]).includes(status) && foundLeft > 0;
}

// ---- the subject's picture, two-city choice -------------------------------------------------------

export type SubjectArt = { kind: "artist" | "team"; name_english: string; image_url: string | null } | null;

const nonBlank = (v: string | null | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** The picture columns of an `artists` / `football_teams` row (`logo_url` is a team's only). */
export type SubjectArtRow = {
  name_english: string | null;
  image_url: string | null;
  art_image_url: string | null;
  logo_url?: string | null;
};

/**
 * The subject's own picture for the board's header (`personArtFor` is the board's business): an
 * artist's cut-out, else its photo; a team's crest, else its photo. null = no row (a competition,
 * or a name the roster does not know). The name is the row's English name, else the run's.
 */
export function subjectArtOf(kind: SubjectKind, row: SubjectArtRow | null, subjectNameEn: string): SubjectArt {
  if (row === null || kind === "competition") return null;
  const name_english = nonBlank(row.name_english) ?? subjectNameEn;
  if (kind === "artist") return { kind, name_english, image_url: nonBlank(row.art_image_url) ?? nonBlank(row.image_url) };
  return { kind, name_english, image_url: nonBlank(row.logo_url) ?? nonBlank(row.image_url) };
}

/**
 * A name as an exact, case-insensitive `ilike` pattern: Postgres' wildcards (`%`, `_`) and the
 * escape character itself are escaped. null when the name holds a `*` (PostgREST reads it as `%`
 * and it cannot be escaped there) or is blank - the caller then does not search by it.
 */
export function ilikeExact(name: string | null | undefined): string | null {
  const t = (name ?? "").trim();
  if (t === "" || t.includes("*")) return null;
  return t.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The two-city choice staff made on a card ("בנה כחבילה דרך <city>"): stored on the item's show as
 * `two_city: { flight_city_id }` - the build reads it only from its context, so `buildNextItem`
 * hands it over from here. Anything malformed = no choice.
 */
export function twoCityOf(show: unknown): { flightCityId: number } | null {
  if (typeof show !== "object" || show === null) return null;
  const choice = (show as Record<string, unknown>).two_city;
  if (typeof choice !== "object" || choice === null) return null;
  const id = (choice as Record<string, unknown>).flight_city_id;
  return isPositiveInt(id) ? { flightCityId: id } : null;
}

/** The show with the two-city choice on it (a copy). */
export function withTwoCity(show: ShowIdentity, flightCityId: number): ShowIdentity & { two_city: { flight_city_id: number } } {
  return { ...show, two_city: { flight_city_id: flightCityId } };
}
