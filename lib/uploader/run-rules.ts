/**
 * Tour uploader (agent #3) - the rules the server actions (lib/actions/uploader-actions.ts) act on,
 * kept pure so the selftest can run them on made-up rows: what a person may type, what an answer
 * does to a show, which items a new run starts with, and how a run's counts and status follow its
 * items. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 10-11.
 *
 * Pure - no DB, no network, no clock except the timestamps a caller hands in. Selftest:
 * scripts/tour-uploader-selftest.ts ("Task 8").
 */
import { clubKey, normalizeName } from "@/lib/on-tour";
import { MAX_QUESTION_TASKS_PER_RUN } from "@/lib/uploader/constants";
import { decision } from "@/lib/uploader/decisions";
import { applyPriorDefaults, planDiff } from "@/lib/uploader/plan";
import { WARNING_TEXT, type SubjectRows } from "@/lib/uploader/warnings";
import {
  existingEventFor,
  priorAnswerFor,
  priorRejectionFor,
  showKey,
  type ExistingEvent,
  type PriorItem,
  type Subject,
} from "@/lib/uploader/shows";
import {
  ITEM_STATUSES,
  type Decision,
  type ItemStatus,
  type RunStatus,
  type ShowIdentity,
  type SubjectKind,
  type UploaderItem,
  type UploaderPlan,
  type UploaderQuestion,
  type Warning,
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
 * 4. any other question -> `question`, waiting for a person (`ask`) - the first `maxQuestionTasks`
 *    (MAX_QUESTION_TASKS_PER_RUN, soonest first) become tasks; past that a question waits on the
 *    board WITHOUT a task (and its mail), with the `question_untasked` decision line;
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
  /** How many questions may become tasks (default MAX_QUESTION_TASKS_PER_RUN). */
  maxQuestionTasks?: number;
}): ItemDraft[] {
  const maxTasks = input.maxQuestionTasks ?? MAX_QUESTION_TASKS_PER_RUN;
  let tasked = 0;
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
      const ask = tasked < maxTasks;
      if (ask) tasked += 1;
      push({ show, status: "question", skip_reason: null, decisions: ask ? [] : [decision("question_untasked", { max: maxTasks })], question, ask });
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
  /** The subject's own page on the site (`subjectHasPage`): true / false; null or absent = not a person (a competition) or not known. */
  hasPage?: boolean | null;
};

/** The preview of nothing (no subject yet - the manual form before it is filled). */
export const EMPTY_PREVIEW: PlanPreview = { shows: 0, questions: 0, existing: 0, cities: [] };

/**
 * Does the subject have its own page on the site - the row the build warns about when it is missing
 * (`no_artist_page` / `no_team_page`): an artist -> an `artists` row, a team -> a `football_teams`
 * row (`resolveSubject` found them). A competition has no page of its own -> null (no chip).
 */
export function subjectHasPage(kind: SubjectKind, rows: { artist: unknown; team: unknown }): boolean | null {
  if (kind === "artist") return rows.artist !== null;
  if (kind === "team") return rows.team !== null;
  return null;
}

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
  "id,name,name_english,date,def_date_depart,def_date_return,base_flight_price,base_hotel_price,event_additional_markup,ticket_only_markup,package_mode,location,event_location,lodging_mode,lodging_default,split_default_nights,tickets_and_rates,map_image_url" as const;

// ---- what staff changed on the plan card ----------------------------------------------------------

type PriorMarkups = { ticket_only: number | null; additional: number | null } | null;

/**
 * The `uploader.plan_edited` lessons of a run: what staff changed on the plan card, measured from
 * what the card SHOWED them - the model's plan with the last run's markups filled in exactly as
 * `parseBrief` did it (`applyPriorDefaults`) - not from the model's bare plan, or a markup the
 * server filled ("מהפעם הקודמת") and nobody touched would read as a staff correction (null -> 75),
 * a false lesson for the parser. No model plan (the manual form) = no lessons.
 * `prior` = the last run's markups, or "unknown" when that read failed: then a markup the model
 * left empty may have been filled by the server or typed by staff - it cannot be told, so it
 * teaches nothing (a lost lesson rather than a false one).
 */
export function planEdits(
  planAi: UploaderPlan | null,
  plan: UploaderPlan,
  prior: PriorMarkups | "unknown",
): { field: string; from: unknown; to: unknown }[] {
  if (planAi === null) return [];
  if (prior === "unknown") {
    return planDiff(planAi, plan).filter((c) => !(c.field.startsWith("markups.") && c.from === null));
  }
  return planDiff(applyPriorDefaults(planAi, prior).plan, plan);
}

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
 * then `waiting` while a question is open, then `review` while a built event waits for approval OR
 * an item failed (an error is retried or rejected by a person - a run holding one is not done),
 * else `done`. `stopped` (a person stopped it) and `error` stay as they are - only a person moves a
 * run out of them, never a recompute.
 */
export function nextRunStatus(current: string, counts: Record<string, number>): RunStatus {
  if (current === "stopped" || current === "error") return current;
  const n = (k: string): number => counts[k] ?? 0;
  if (n("found") + n("building") > 0) return "building";
  if (n("question") > 0) return "waiting";
  if (n("ready") + n("error") > 0) return "review";
  return "done";
}

/** The statuses `nextRunStatus` may overwrite (the sticky ones are not in it). */
export const RECOMPUTED_RUN_STATUSES: RunStatus[] = ["planned", "building", "waiting", "review", "done"];

/** Two plans are about the same subject: the same kind and the same English name once normalized (`createRun`'s one-run-at-a-time rule). */
export function sameSubject(a: UploaderPlan["subject"], b: UploaderPlan["subject"]): boolean {
  const name = normalizeName(a.name_en);
  return a.kind === b.kind && name !== "" && name === normalizeName(b.name_en);
}

/**
 * An item left `building` longer than this was cut off (the board's page gives an action 60 s): the
 * run settles it to `error` (retryable) instead of reading "building" for ever.
 */
export const STALE_BUILD_MS = 3 * 60_000;

/** Is a `building` item's last write older than STALE_BUILD_MS at `nowMs`? An unreadable time is not stale. */
export function isStaleBuild(updatedAt: string | null | undefined, nowMs: number): boolean {
  const at = Date.parse(updatedAt ?? "");
  return Number.isFinite(at) && nowMs - at > STALE_BUILD_MS;
}

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

/** The columns of an `artists` / `football_teams` row the picture read takes (`logo_url` is a team's only). */
export type SubjectArtRow = {
  name: string | null;
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

/** A LIKE value with Postgres' wildcards (`%`, `_`) and the escape character escaped. */
const likeEscape = (t: string): string => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The ONE candidate read's `ilike` pattern for the subject's picture: `%<token>%` over
 * `name_english`, the token being a team's first club token (`clubKey` - "Liverpool FC" ->
 * "liverpool", the qualifiers dropped) or an artist's LONGEST word (the first one on a tie) - "The
 * Rolling Stones" searches "Rolling", not "The" (ten rows of "The ..." would crowd the subject out
 * of the ART_CANDIDATES read), escaped. null = nothing to search by (a competition, a blank name, or
 * a token holding `*` - PostgREST reads it as `%`).
 */
export function artSearchPattern(kind: SubjectKind, nameEn: string): string | null {
  if (kind === "competition") return null;
  const longest = (words: string[]): string => words.reduce((best, w) => (w.length > best.length ? w : best), "");
  const token = kind === "team" ? (clubKey(nameEn).split(" ")[0] ?? "") : longest(nameEn.trim().split(/\s+/));
  if (token === "" || token.includes("*")) return null;
  return `%${likeEscape(token)}%`;
}

/**
 * The candidate that IS the subject: a team whose `clubKey` equals the plan's ("Liverpool" for
 * "Liverpool FC"); an artist whose English name equals the plan's once normalized, else whose
 * Hebrew `name` equals the plan's Hebrew (or English) name. The first such row in read order.
 */
export function pickArtRow(
  kind: SubjectKind,
  rows: SubjectArtRow[],
  subject: { name_en: string; name_he: string | null },
): SubjectArtRow | null {
  if (kind === "competition") return null;
  if (kind === "team") {
    const key = clubKey(subject.name_en);
    if (key === "") return null;
    return rows.find((r) => clubKey(r.name_english ?? "") === key) ?? null;
  }
  const en = normalizeName(subject.name_en);
  const he = normalizeName(subject.name_he ?? subject.name_en);
  return (
    rows.find((r) => en !== "" && normalizeName(r.name_english) === en) ??
    rows.find((r) => he !== "" && normalizeName(r.name) === he) ??
    null
  );
}

// ---- approval -------------------------------------------------------------------------------------

/** The `events` columns a blocker is re-judged on (a row of EDIT_EVENT_COLUMNS carries all four). */
export type BlockerRow = {
  id?: number;
  package_mode?: string | null;
  base_flight_price?: number | null;
  base_hotel_price?: number | null;
  ticket_only_markup?: number | null;
};

const positive = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * The item's blockers as they stand NOW (approve time), judged by the event row's CURRENT
 * `package_mode` - not the mode the build gave it, since staff may have switched it in the editor
 * (a package is any `package_mode` but "ticket_only", main's `isTicketOnlyEvent`):
 * - a ticket-only row: `no_base_price` (both variants) clears; `no_ticket_only_markup` applies iff
 *   the row has no ticket-only markup (0 is a markup) - added when the stored list lacks it;
 * - a package row: `no_ticket_only_markup` clears; `no_base_price` applies per base that is not
 *   above 0 (the flight variant, the hotel variant) - added when the stored list lacks it.
 * A stored blocker is kept as it was (its text and link); an added one takes the stored price
 * blockers' link, else `/events/<id>#fix-price`. Any other code stays as stored, ahead of these.
 */
export function liveBlockers(stored: Warning[] | null | undefined, row: BlockerRow): Warning[] {
  const list = stored ?? [];
  const priced = (b: Warning): boolean => b.code === "no_base_price" || b.code === "no_ticket_only_markup";
  const fixUrl = list.find((b) => priced(b) && !!b.fix_url)?.fix_url ?? (typeof row.id === "number" ? `/events/${row.id}#fix-price` : undefined);
  const blocker = (code: "no_base_price" | "no_ticket_only_markup", text: string): Warning =>
    list.find((b) => b.code === code && b.text === text) ?? (fixUrl ? { code, text, fix_url: fixUrl } : { code, text });

  const out = list.filter((b) => !priced(b));
  if (row.package_mode === "ticket_only") {
    const markup = row.ticket_only_markup;
    if (!(typeof markup === "number" && Number.isFinite(markup))) out.push(blocker("no_ticket_only_markup", WARNING_TEXT.no_ticket_only_markup));
    return out;
  }
  if (!positive(row.base_flight_price)) out.push(blocker("no_base_price", WARNING_TEXT.no_base_price));
  if (!positive(row.base_hotel_price)) out.push(blocker("no_base_price", WARNING_TEXT.no_base_price_hotel));
  return out;
}

/** A `ready` item that points at its built (hidden) event - the board's edit diff and live blockers read those events. */
export function hasBuiltEvent(item: UploaderItem): item is UploaderItem & { event_id: number } {
  return item.status === "ready" && typeof item.event_id === "number";
}

/**
 * Does a build's result point the item at NO event: the build removed (or found gone) the item's
 * earlier event and created none - a rebuild that ended skipped / question / error before
 * `createEvent`. A `ready` result carries its new event; an error AFTER `createEvent` keeps the new
 * event's id (written at once - the next retry cleans that one).
 */
export function clearsOwnEvent(status: ItemStatus, trace: { cleaned: boolean; created: boolean }): boolean {
  return status !== "ready" && trace.cleaned && !trace.created;
}

/** The statuses a person may reject from (a show being built, or already approved / rejected / skipped, is not one). */
export const REJECTABLE_STATUSES: ItemStatus[] = ["ready", "question", "found", "error"];

/**
 * The far-venue offer ("בנה כחבילה דרך <city>") rebuilds only a show that has no package: a built
 * ticket-only event (`ready`, mode ticket_only), or a show skipped for having no location
 * (`skip_reason` no_location). Never an `exists` / `no_tickets` / `rejected_before` /
 * `skipped_by_answer` skip - rebuilding those would undo a decision.
 */
export function canRebuildTwoCity(item: Pick<UploaderItem, "status" | "mode" | "skip_reason">): boolean {
  if (item.status === "ready") return item.mode === "ticket_only";
  return item.status === "skipped" && item.skip_reason === "no_location";
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

// ---- the parse's rate cap -------------------------------------------------------------------------

/**
 * Is this person over the parse cap: `recent` = their `agent.call` rows in the window (null = the
 * count could not be read - let through, the cap is a brake on spend, not the gate), `max` = the cap.
 * At `max` calls already made the next one is refused.
 */
export function parseRateLimited(recent: number | null, max: number): boolean {
  return recent !== null && recent >= max;
}

// ---- the run's resolved subject, cached on the run row ----------------------------------------------

/** How long `uploader_runs.subject_cache` stands before `buildNextItem` resolves the subject again. */
export const SUBJECT_CACHE_MS = 60 * 60_000;

/** What `resolveSubject` answers, as `uploader_runs.subject_cache` stores it (`at` = when it was resolved). */
export type SubjectCache = {
  at: string;
  subject: Subject;
  rows: SubjectRows;
  teamsHe: Record<string, string>;
  competitionName: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The stored subject cache when it is whole and younger than SUBJECT_CACHE_MS at `nowMs`, else null
 * (= resolve again): a missing column or row, a malformed value, an unreadable or future time. A
 * competition run used to resolve per ITEM - the whole sliced TixStock read plus `football_teams` per
 * fixture; one resolve per run (refreshed hourly, so a page fixed mid-run still shows up) is enough.
 */
export function freshSubjectCache(raw: unknown, nowMs: number): SubjectCache | null {
  if (!isRecord(raw) || typeof raw.at !== "string") return null;
  const at = Date.parse(raw.at);
  if (!Number.isFinite(at) || at > nowMs || nowMs - at > SUBJECT_CACHE_MS) return null;
  const { subject, rows, teamsHe } = raw;
  if (!isRecord(subject) || typeof subject.name_en !== "string" || !Array.isArray(subject.aliases)) return null;
  const kind = subject.kind;
  if (kind !== "artist" && kind !== "team" && kind !== "competition") return null;
  const rowOk = (v: unknown): boolean => v === null || isRecord(v);
  if (!isRecord(rows) || !rowOk(rows.artist) || !rowOk(rows.team)) return null;
  if (!isRecord(teamsHe)) return null;
  return {
    at: raw.at,
    subject: {
      kind,
      name_en: subject.name_en,
      name_he: typeof subject.name_he === "string" ? subject.name_he : null,
      aliases: subject.aliases.filter((a): a is string => typeof a === "string"),
    },
    // The rows are what `resolveSubject` wrote whole - one cast at the jsonb boundary (each is null or an object, checked above).
    rows: rows as unknown as SubjectRows,
    teamsHe: Object.fromEntries(Object.entries(teamsHe).filter((e): e is [string, string] => typeof e[1] === "string")),
    competitionName: typeof raw.competitionName === "string" ? raw.competitionName : null,
  };
}
