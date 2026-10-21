"use server";

/**
 * Tour uploader (agent #3) - the ONE server-action module of the feature, and its security
 * boundary. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 10-11.
 *
 * A staff member types a brief, the agent parses it (`parseBrief`), the plan is confirmed
 * (`createRun` - the shows are found and become items), the board builds one item per call
 * (`buildNextItem`), a person answers what the builder could not decide (`answerQuestion`) and
 * approves or rejects each hidden event (`approveItem` / `approveAll` / `rejectItem`).
 *
 * Rules every action keeps:
 * - `await requireAdmin()` first, then every input is validated BEFORE any read (`bad_input`).
 * - Nothing price-bearing is taken from the client: the plan is re-checked by `parsePlanInput`
 *   (markups are whole dollars 0..MARKUP_MAX), every event is built by the build service through
 *   the one pricing rule, and approve only flips `events.is_hidden`.
 * - Errors are RETURNED (`{ ok: false, kind }`), never thrown - Next masks a thrown action error
 *   in production.
 * - Staff text (brief, answers, reasons) is stored and audited as data; it is never part of a
 *   query string (`.eq` / `.in` values only).
 * - Every audit row carries `metadata.agent: "tour-uploader"` (what the agent learns from).
 *
 * The pure rules these actions apply live in lib/uploader/run-rules.ts (selftested); the result
 * shapes in lib/uploader/action-types.ts.
 */
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { newBudget, TOUR_UPLOADER_AGENT } from "@/lib/agents";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { revalidateMain } from "@/lib/revalidate-main";
import { distanceKm, loadLocations } from "@/lib/services/nearest-location";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { taskPeopleOf } from "@/lib/services/task-people";
import { parseBriefWithAgent } from "@/lib/services/tour-uploader-parse";
import { buildItem } from "@/lib/services/uploader-build";
import { closeQuestionTask, countOpenQuestions, openQuestionTask } from "@/lib/services/uploader-questions";
import { findShows, loadPriorItems, priorMarkups, resolveSubject } from "@/lib/services/uploader-search";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { REJECT_REASON_MIN } from "@/lib/uploader/constants";
import { editDiff } from "@/lib/uploader/decisions";
import { applyPriorDefaults, emptyPlan, parsePlanInput, planDiff } from "@/lib/uploader/plan";
import {
  answerEffect,
  BRIEF_MAX,
  canResume,
  checkAnswer,
  cleanAnswerInput,
  EDIT_EVENT_COLUMNS,
  EMPTY_PREVIEW,
  ilikeExact,
  isPositiveInt,
  isUuid,
  nextRunStatus,
  planPreview,
  planRunItems,
  RECOMPUTED_RUN_STATUSES,
  REJECT_REASON_MAX,
  runCounts,
  SKIPPED_BY_ANSWER,
  subjectArtOf,
  twoCityOf,
  withTwoCity,
  type SplitShow,
  type StoredAnswer,
  type SubjectArtRow,
} from "@/lib/uploader/run-rules";
import type {
  ApproveAllResult,
  ApproveResult,
  BuildStep,
  CreateRunInput,
  CreateRunResult,
  LocationOption,
  Ok,
  OpenQuestions,
  ParseBriefResult,
  PlanPreview,
  PreviewResult,
  RunView,
} from "@/lib/uploader/action-types";
import type { PriorItem } from "@/lib/uploader/shows";
import type { ItemStatus, UploaderItem, UploaderPlan, UploaderQuestion, UploaderRun } from "@/types/uploader.types";

// `uploader_runs` / `uploader_items` and `events.is_hidden` are newer than types/database.types.ts
// (regenerate with `npm run db:types` once migration 20261021115818 is applied) - one boundary cast for them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const AGENT = "tour-uploader";

const RUN_COLUMNS = "id,created_by,asker_id,brief,plan,plan_ai,status,counts,ai_cost_usd,is_test,error,created_at,updated_at";
const ITEM_COLUMNS =
  "id,run_id,position,show,status,mode,location,decisions,warnings,blockers,question,event_id,payload,skip_reason,error,approved_by,approved_at,rejected_reason,rejected_final,created_at,updated_at";

/** The most items one run may hold - past it a read reports `truncated` rather than return a part. */
const ITEMS_MAX = 5_000;
/** Ids per `.in()` filter - keeps the request line well inside URL limits. */
const IN_CHUNK = 200;
/** How many times `buildNextItem` re-reads after another caller claimed the item it picked. */
const CLAIM_ATTEMPTS = 3;
/**
 * An item left `building` longer than this was cut off (the board's page gives an action 60 s), so
 * it becomes an `error` the board shows instead of holding the run in "building" for ever.
 */
const STALE_BUILD_MS = 3 * 60_000;
const STALE_BUILD_ERROR = "הבנייה נקטעה באמצע (חרגה מזמן הבקשה) - בדקו באירועים אם נוצר אירוע מוסתר לפני שבונים את ההופעה שוב";
/** `approveAll`: stop approving after this, and leave the price sync the rest of the page's 60 s. */
const APPROVE_ALL_BUDGET_MS = 50_000;
const APPROVE_ALL_DEADLINE_MS = 55_000;
const APPROVE_ONE_SYNC_MS = 20_000;
const APPROVE_ALL_SYNC_MAX_MS = 40_000;
const APPROVE_ALL_SYNC_MIN_MS = 5_000;
/** Newest runs the list shows. */
const RUNS_LIST_MAX = 50;
/** Characters of the brief quoted beside a plan edit (the lesson's "on a brief like ..."). */
const BRIEF_EXCERPT = 160;

const REJECTABLE: ItemStatus[] = ["ready", "question", "found", "error"];
const REBUILDABLE: ItemStatus[] = ["ready", "skipped"];

type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T | null; error: DbError };

const nowIso = (): string => new Date().toISOString();
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function logDb(what: string, error: unknown): void {
  console.error(`uploader-actions: ${what} failed`, JSON.stringify(error));
}

const badInput = { ok: false as const, kind: "bad_input" };
const dbError = { ok: false as const, kind: "db_error" };
const notFound = { ok: false as const, kind: "not_found" };

// ---- shared reads and writes ------------------------------------------------------------------------

async function readRun(id: string): Promise<{ run: UploaderRun | null; failed: boolean }> {
  const { data, error } = (await db.from("uploader_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle()) as DbResult<UploaderRun>;
  if (error) {
    logDb("run read", error);
    return { run: null, failed: true };
  }
  return { run: data, failed: false };
}

async function readItem(id: string): Promise<{ item: UploaderItem | null; failed: boolean }> {
  const { data, error } = (await db.from("uploader_items").select(ITEM_COLUMNS).eq("id", id).maybeSingle()) as DbResult<UploaderItem>;
  if (error) {
    logDb("item read", error);
    return { item: null, failed: true };
  }
  return { item: data, failed: false };
}

/** The item and its run, or the `kind` that stops the action. */
async function readItemAndRun(itemId: string): Promise<{ item: UploaderItem; run: UploaderRun } | { kind: string }> {
  const { item, failed } = await readItem(itemId);
  if (failed) return { kind: "db_error" };
  if (!item) return { kind: "not_found" };
  const read = await readRun(item.run_id);
  if (read.failed) return { kind: "db_error" };
  if (!read.run) return { kind: "not_found" };
  return { item, run: read.run };
}

/**
 * The run's counts and status from its items (`runCounts` / `nextRunStatus`). The status is
 * written only out of a non-sticky one (`stopped` / `error` stay), and the condition sits in the
 * UPDATE itself, so a run stopped meanwhile is never pushed back to "building". Never throws.
 */
async function recomputeRun(runId: string): Promise<void> {
  const { rows, truncated, error } = await fetchPaged<{ id: string; status: string }>(
    () => db.from("uploader_items").select("id,status").eq("run_id", runId).order("id"),
    ITEMS_MAX,
  );
  if (error || truncated) {
    logDb("run counts read", error ?? { message: "too many items" });
    return;
  }
  const counts = runCounts(rows.map((r) => r.status));
  const current = (await db.from("uploader_runs").select("status").eq("id", runId).maybeSingle()) as DbResult<{ status: string }>;
  if (current.error || !current.data) {
    logDb("run status read", current.error ?? { message: "run missing" });
    return;
  }
  const status = nextRunStatus(current.data.status, counts);
  const updated = (await db
    .from("uploader_runs")
    .update({ counts, status, updated_at: nowIso() })
    .eq("id", runId)
    .in("status", RECOMPUTED_RUN_STATUSES)
    .select("id")) as DbResult<{ id: string }[]>;
  if (updated.error) {
    logDb("run status write", updated.error);
    return;
  }
  if ((updated.data ?? []).length > 0) return;
  // A sticky status (stopped / error): the counts still follow the items.
  const counted = (await db.from("uploader_runs").update({ counts, updated_at: nowIso() }).eq("id", runId)) as DbResult<null>;
  if (counted.error) logDb("run counts write", counted.error);
}

/** The build's `Partial<UploaderItem>` as explicit columns - nothing outside this list is written. */
function itemPatch(p: Partial<UploaderItem>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.status !== undefined) out.status = p.status;
  if (p.show !== undefined) out.show = p.show;
  if (p.mode !== undefined) out.mode = p.mode;
  if (p.location !== undefined) out.location = p.location;
  if (p.decisions !== undefined) out.decisions = p.decisions;
  if (p.warnings !== undefined) out.warnings = p.warnings;
  if (p.blockers !== undefined) out.blockers = p.blockers;
  if (p.question !== undefined) out.question = p.question;
  if (p.event_id !== undefined) out.event_id = p.event_id;
  if (p.payload !== undefined) out.payload = p.payload;
  if (p.skip_reason !== undefined) out.skip_reason = p.skip_reason;
  if (p.error !== undefined) out.error = p.error;
  return out;
}

/** Raise a question as the asker's task; the task id, or null (logged - the item still shows the question). */
async function raiseQuestion(run: UploaderRun, item: UploaderItem, q: UploaderQuestion): Promise<string | null> {
  try {
    return await openQuestionTask(run, item, q);
  } catch (e) {
    console.error(`uploader-actions: question task for item ${item.id} failed`, errorText(e));
    return null;
  }
}

/** Soft delete the item's hidden event (the same soft delete every path uses). Logged, never fatal. */
async function softDeleteBuiltEvent(eventId: number): Promise<void> {
  try {
    const { softDeleteEvent } = await import("@/lib/actions/event-actions");
    await softDeleteEvent(eventId);
  } catch (e) {
    console.error(`uploader-actions: soft delete of event ${eventId} failed`, errorText(e));
  }
}

/** The availability re-check of freshly listed events (the TixStock price sync, those ids only). Logged, never fatal. */
async function recheckAvailability(eventIds: number[], timeBudgetMs: number): Promise<void> {
  if (eventIds.length === 0) return;
  try {
    // Imported in the call: the sync's exchange-rate service needs the supplier env at load.
    const { syncTixStockPrices } = await import("@/lib/services/tixstock-price-sync");
    const result = await syncTixStockPrices({ eventIds, timeBudgetMs });
    if (result.errors.length > 0) console.warn("uploader-actions: availability re-check reported", JSON.stringify(result.errors.slice(0, 5)));
  } catch (e) {
    console.error("uploader-actions: availability re-check failed", errorText(e));
  }
}

// ---- the plan ----------------------------------------------------------------------------------------

/** What the plan would find (the plan card). An empty subject (the manual form before it is filled) finds nothing. */
async function previewOf(plan: UploaderPlan): Promise<{ ok: true; preview: PlanPreview } | { ok: false; kind: string }> {
  if (plan.subject.name_en.trim() === "") return { ok: true, preview: { ...EMPTY_PREVIEW, cities: [] } };
  let subject;
  try {
    subject = (await resolveSubject(plan)).subject;
  } catch (e) {
    // resolveSubject only throws when a roster read fails (an unknown name is a subject with no rows).
    console.error("uploader-actions: subject resolution failed", errorText(e));
    return { ok: false, kind: "roster_read_failed" };
  }
  try {
    return { ok: true, preview: planPreview(await findShows(plan, subject)) };
  } catch (e) {
    console.error("uploader-actions: show search failed", errorText(e));
    return { ok: false, kind: "search_failed" };
  }
}

/**
 * The brief -> a plan to confirm. The agent parses it when it is on (its own run budget); off, or a
 * failed call, opens the manual form (`emptyPlan`, or what could be salvaged). The last real run's
 * markups fill the ones the brief left empty (`fromPrior`), then the plan is previewed.
 */
export async function parseBrief(brief: string): Promise<ParseBriefResult> {
  await requireAdmin();
  if (typeof brief !== "string" || brief.trim() === "") return badInput;
  if (brief.length > BRIEF_MAX) return { ok: false, kind: "brief_too_long" };

  let base: UploaderPlan;
  let planAi: UploaderPlan | null = null;
  let agent: "on" | "off" | "failed";
  let problems: string[] = [];
  try {
    const outcome = await parseBriefWithAgent(brief, newBudget(TOUR_UPLOADER_AGENT));
    if (outcome.ok) {
      base = outcome.plan;
      planAi = outcome.plan;
      agent = "on";
    } else if (outcome.reason === "off") {
      base = emptyPlan();
      agent = "off";
    } else {
      base = outcome.plan ?? emptyPlan();
      planAi = outcome.plan;
      agent = "failed";
      problems = outcome.problems;
    }
  } catch (e) {
    // parseBriefWithAgent never throws; this is the belt to its braces.
    console.error("uploader-actions: brief parse failed", errorText(e));
    base = emptyPlan();
    agent = "failed";
    problems = [errorText(e)];
  }

  let prior: Awaited<ReturnType<typeof priorMarkups>> = null;
  try {
    prior = await priorMarkups(base.subject.kind);
  } catch (e) {
    // A convenience: without it the markups stay as the brief left them.
    console.error("uploader-actions: prior markups read failed", errorText(e));
  }
  const { plan, fromPrior } = applyPriorDefaults(base, prior);

  const preview = await previewOf(plan);
  if (!preview.ok) return { ok: false, kind: preview.kind };
  return { ok: true, plan, planAi, fromPrior, preview: preview.preview, agent, problems };
}

/** The plan card after an edit (or the manual form): the plan is checked again first. */
export async function previewPlan(plan: UploaderPlan): Promise<PreviewResult> {
  await requireAdmin();
  const parsed = parsePlanInput(plan);
  if (!parsed.ok) return { ok: false, kind: "bad_plan", problems: parsed.problems };
  return previewOf(parsed.plan);
}

// ---- the run -----------------------------------------------------------------------------------------

/**
 * Confirm the plan: the run (status building) and one item per show (`planRunItems` - found /
 * question / skipped exists | rejected_before | by an earlier answer), each open question raised as
 * the asker's task. The asker is the session's user, never the client's value.
 */
export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  const session = await requireAdmin();
  if (typeof input !== "object" || input === null) return badInput;
  const { brief, is_test } = input;
  if (typeof brief !== "string" || typeof is_test !== "boolean") return badInput;
  if (brief.length > BRIEF_MAX) return { ok: false, kind: "brief_too_long" };
  const parsed = parsePlanInput(input.plan);
  if (!parsed.ok) return { ok: false, kind: "bad_plan", problems: parsed.problems };
  const plan = parsed.plan;
  // The model's own plan is kept for the lesson (what staff changed), salvaged like any plan; a
  // value that is no object at all is no plan (diffing it would teach a dozen false corrections).
  const rawAi: unknown = input.plan_ai;
  const planAi = typeof rawAi === "object" && rawAi !== null && !Array.isArray(rawAi) ? parsePlanInput(rawAi).plan : null;
  const askerId = isUuid(session.sub) ? session.sub : isUuid(input.asker_id) ? input.asker_id : null;
  if (askerId === null) return badInput;

  // Search first: a failed search leaves no half-made run behind.
  let subject;
  try {
    subject = (await resolveSubject(plan)).subject;
  } catch (e) {
    console.error("uploader-actions: subject resolution failed", errorText(e));
    return { ok: false, kind: "roster_read_failed" };
  }
  let found: Awaited<ReturnType<typeof findShows>>;
  let priors: PriorItem[];
  try {
    found = await findShows(plan, subject);
    // Fails closed: without the priors a show rejected for good would be built again.
    priors = await loadPriorItems(plan.subject.name_en);
  } catch (e) {
    console.error("uploader-actions: show search failed", errorText(e));
    return { ok: false, kind: "search_failed" };
  }

  const at = nowIso();
  const drafts = planRunItems({
    shows: found.shows,
    questions: found.questions,
    existing: found.existing,
    priors,
    fallback: found.fallback,
    subject_en: plan.subject.name_en,
    at,
  });

  const inserted = (await db
    .from("uploader_runs")
    .insert({
      created_by: askerId,
      asker_id: askerId,
      brief,
      plan,
      plan_ai: planAi,
      status: "building",
      counts: runCounts(drafts.map((d) => d.status)),
      is_test,
      updated_at: at,
    })
    .select(RUN_COLUMNS)
    .single()) as DbResult<UploaderRun>;
  if (inserted.error || !inserted.data) {
    logDb("run insert", inserted.error);
    return dbError;
  }
  const run = inserted.data;

  let items: UploaderItem[] = [];
  if (drafts.length > 0) {
    const rows = (await db
      .from("uploader_items")
      .insert(
        drafts.map((d) => ({
          run_id: run.id,
          position: d.position,
          show: d.show,
          status: d.status,
          skip_reason: d.skip_reason,
          decisions: d.decisions,
          question: d.question,
          updated_at: at,
        })),
      )
      .select(ITEM_COLUMNS)) as DbResult<UploaderItem[]>;
    if (rows.error) {
      logDb("items insert", rows.error);
      const failed = (await db
        .from("uploader_runs")
        .update({ status: "error", error: `items insert failed: ${rows.error.message}`, updated_at: nowIso() })
        .eq("id", run.id)) as DbResult<null>;
      if (failed.error) logDb("run error write", failed.error);
      return dbError;
    }
    items = rows.data ?? [];
  }

  // Every question nobody answered before becomes the asker's task.
  const byPosition = new Map(items.map((i) => [i.position, i]));
  for (const draft of drafts) {
    if (!draft.ask) continue;
    const item = byPosition.get(draft.position);
    if (!item?.question) continue;
    const taskId = await raiseQuestion(run, item, item.question);
    if (taskId === null) continue;
    const stored = (await db
      .from("uploader_items")
      .update({ question: { ...item.question, task_id: taskId }, updated_at: nowIso() })
      .eq("id", item.id)) as DbResult<null>;
    if (stored.error) logDb("question task id write", stored.error);
  }

  if (planAi !== null) {
    for (const change of planDiff(planAi, plan)) {
      await logAudit({
        action: "uploader.plan_edited",
        entityType: "uploader_run",
        entityId: run.id,
        metadata: { agent: AGENT, run_id: run.id, field: change.field, from: change.from, to: change.to, brief_excerpt: brief.slice(0, BRIEF_EXCERPT) },
      });
    }
  }
  await logAudit({
    action: "uploader.run_created",
    entityType: "uploader_run",
    entityId: run.id,
    metadata: {
      agent: AGENT,
      run_id: run.id,
      subject: plan.subject.name_en,
      shows: drafts.filter((d) => d.status === "found").length,
      questions: drafts.filter((d) => d.status === "question").length,
      skipped: drafts.filter((d) => d.status === "skipped").length,
      is_test,
    },
  });
  await recomputeRun(run.id);
  return { ok: true, runId: run.id };
}

/** An item left `building` past STALE_BUILD_MS is an error, so the run can settle. Never throws. */
async function settleStaleBuilds(runId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_BUILD_MS).toISOString();
  const { error } = (await db
    .from("uploader_items")
    .update({ status: "error", error: STALE_BUILD_ERROR, updated_at: nowIso() })
    .eq("run_id", runId)
    .eq("status", "building")
    .lt("updated_at", cutoff)) as DbResult<null>;
  if (error) logDb("stale build settle", error);
}

/**
 * Build the run's next item - one per call; the board calls again until `done`. The claim is an
 * optimistic conditional update (`found` -> `building` only while it is still `found`), so two
 * boards on one run never build the same show twice. A stopped run builds nothing.
 */
export async function buildNextItem(runId: string): Promise<BuildStep> {
  await requireAdmin();
  if (!isUuid(runId)) return { done: true, kind: "bad_input" };
  const { run, failed } = await readRun(runId);
  if (failed) return { done: true, kind: "db_error" };
  if (!run) return { done: true, kind: "not_found" };
  if (run.status === "stopped") return { done: true, kind: "stopped" };

  let item: UploaderItem | null = null;
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS && item === null; attempt++) {
    const next = (await db
      .from("uploader_items")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "found")
      .order("position")
      .order("created_at")
      .limit(1)) as DbResult<{ id: string }[]>;
    if (next.error) {
      logDb("next item read", next.error);
      return { done: true, kind: "db_error" };
    }
    const id = next.data?.[0]?.id;
    if (!id) {
      await settleStaleBuilds(runId);
      await recomputeRun(runId);
      return { done: true };
    }
    const claimed = (await db
      .from("uploader_items")
      .update({ status: "building", updated_at: nowIso() })
      .eq("id", id)
      .eq("status", "found")
      .select(ITEM_COLUMNS)) as DbResult<UploaderItem[]>;
    if (claimed.error) {
      logDb("item claim", claimed.error);
      return { done: true, kind: "db_error" };
    }
    item = claimed.data?.[0] ?? null; // none = another caller claimed it first - read again
  }
  if (item === null) return { done: false };

  let status: ItemStatus;
  let patch: Record<string, unknown>;
  try {
    // Fresh every call: the subject's pages may have been fixed since the last item.
    const { subject, rows, teamsHe } = await resolveSubject(run.plan);
    const twoCity = twoCityOf(item.show);
    const result = await buildItem(run, item, { subject, rows, teamsHe, ...(twoCity ? { twoCity } : {}) });
    status = result.status;
    patch = { ...itemPatch(result.item), status };
    if (result.status === "question" && result.item.question) {
      const asked: UploaderItem = { ...item, ...result.item, status: "question" };
      const taskId = await raiseQuestion(run, asked, result.item.question);
      patch.question = { ...result.item.question, task_id: taskId };
    }
  } catch (e) {
    console.error(`uploader-actions: build of item ${item.id} failed`, errorText(e));
    status = "error";
    patch = { status, error: errorText(e) };
  }

  const written = (await db
    .from("uploader_items")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", item.id)
    .eq("status", "building")
    .select("id")) as DbResult<{ id: string }[]>;
  if (written.error || (written.data ?? []).length === 0) {
    // The build may have created a hidden event the item does not point at - name it in the log.
    logDb(`item ${item.id} result write (event ${String(patch.event_id ?? "none")})`, written.error ?? { message: "item no longer building" });
    await recomputeRun(runId);
    return { done: false, itemId: item.id, status: "error", kind: "db_error" };
  }
  await recomputeRun(runId);
  return { done: false, itemId: item.id, status };
}

/** Stop a run that is building or waiting; its items stay as they are. */
export async function stopRun(runId: string): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(runId)) return badInput;
  const stopped = (await db
    .from("uploader_runs")
    .update({ status: "stopped", updated_at: nowIso() })
    .eq("id", runId)
    .in("status", ["building", "waiting"])
    .select("id")) as DbResult<{ id: string }[]>;
  if (stopped.error) {
    logDb("run stop", stopped.error);
    return dbError;
  }
  if ((stopped.data ?? []).length > 0) return { ok: true };
  const { run, failed } = await readRun(runId);
  if (failed) return dbError;
  return run ? { ok: false, kind: "not_running" } : notFound;
}

/**
 * "המשך": a stopped run - or a run in a non-terminal status that still has items to build - goes
 * back to building (`canResume`); its items are untouched. The board then calls `buildNextItem`
 * again. The status settles by its items right after (`recomputeRun`).
 */
export async function resumeRun(runId: string): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(runId)) return badInput;
  const { run, failed } = await readRun(runId);
  if (failed) return dbError;
  if (!run) return notFound;
  const found = (await db
    .from("uploader_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "found")) as DbResult<null> & { count: number | null };
  if (found.error) {
    logDb("found items count", found.error);
    return dbError;
  }
  if (!canResume(run.status, found.count ?? 0)) return { ok: false, kind: "not_resumable" };
  const resumed = (await db
    .from("uploader_runs")
    .update({ status: "building", updated_at: nowIso() })
    .eq("id", runId)
    .eq("status", run.status)
    .select("id")) as DbResult<{ id: string }[]>;
  if (resumed.error) {
    logDb("run resume", resumed.error);
    return dbError;
  }
  if ((resumed.data ?? []).length === 0) return { ok: false, kind: "not_resumable" }; // its status moved meanwhile
  await logAudit({
    action: "uploader.run_resumed",
    entityType: "uploader_run",
    entityId: runId,
    metadata: { agent: AGENT, run_id: runId, from: run.status },
  });
  await recomputeRun(runId);
  return { ok: true };
}

/**
 * "נסה שוב": an `error` item goes back to `found` (error cleared) for the build loop to pick up.
 * Its `event_id` is kept as it is - an errored build never wrote one, and the build re-checks
 * duplicates by supplier id anyway.
 */
export async function retryItem(itemId: string): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(itemId)) return badInput;
  const read = await readItemAndRun(itemId);
  if ("kind" in read) return { ok: false, kind: read.kind };
  const { item, run } = read;
  if (item.status !== "error") return { ok: false, kind: "not_retryable" };
  const written = (await db
    .from("uploader_items")
    .update({ status: "found", error: null, updated_at: nowIso() })
    .eq("id", item.id)
    .eq("status", "error")
    .select("id")) as DbResult<{ id: string }[]>;
  if (written.error) {
    logDb("item retry", written.error);
    return dbError;
  }
  if ((written.data ?? []).length === 0) return { ok: false, kind: "not_retryable" };
  await logAudit({
    action: "uploader.item_retried",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: { agent: AGENT, run_id: run.id, item_id: item.id, event_id: item.event_id, error: item.error },
  });
  await recomputeRun(run.id);
  return { ok: true };
}

/** The newest runs, newest first. */
export async function listRuns(): Promise<UploaderRun[]> {
  await requireAdmin();
  const { data, error } = (await db
    .from("uploader_runs")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(RUNS_LIST_MAX)) as DbResult<UploaderRun[]>;
  if (error) {
    logDb("runs list", error);
    return [];
  }
  return data ?? [];
}

/**
 * The board: the run, its items (soonest first), which built events staff already edited (one
 * `events` read per 200 ids), the people an answer can name, and the subject's own picture.
 * null = no such run.
 */
export async function getRun(runId: string): Promise<RunView | null> {
  await requireAdmin();
  if (!isUuid(runId)) return null;
  const { run, failed } = await readRun(runId);
  if (failed || !run) return null;

  const itemsRead = await fetchPaged<UploaderItem>(
    () => db.from("uploader_items").select(ITEM_COLUMNS).eq("run_id", runId).order("position").order("created_at").order("id"),
    ITEMS_MAX,
  );
  if (itemsRead.error) {
    logDb("run items read", itemsRead.error);
    return null;
  }
  if (itemsRead.truncated) console.error(`uploader-actions: run ${runId} has more than ${ITEMS_MAX} items - the board shows the first ones`);
  const items = itemsRead.rows;

  const edited: Record<string, boolean> = {};
  const built = items.filter((i) => i.status === "ready" && i.event_id !== null);
  const ids = [...new Set(built.map((i) => i.event_id as number))];
  const rows = new Map<number, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabaseTyped.from("events").select(EDIT_EVENT_COLUMNS).in("id", ids.slice(i, i + IN_CHUNK));
    if (error) {
      logDb("events (edited) read", error);
      break;
    }
    for (const row of data ?? []) rows.set(row.id, row as unknown as Record<string, unknown>);
  }
  for (const item of built) {
    edited[item.id] = editDiff(item.payload, rows.get(item.event_id as number) ?? null).length > 0;
  }

  const staff = await taskPeopleOf({ id: MEGA_EVENTS_COMPANY_ID });
  const people = (staff ?? []).map((p) => ({ id: p.id, name: p.display_name?.trim() || p.email }));

  const subjectArt = subjectArtOf(run.plan.subject.kind, await readSubjectArtRow(run.plan), run.plan.subject.name_en);
  return { run, items, edited, people, subjectArt };
}

/**
 * The subject's own row for the board's picture - ONE light read per try (the board polls
 * `getRun`, so never the whole roster `resolveSubject` reads): the active row whose English name
 * is the plan's (case-insensitive, exact), else whose `name` is the plan's Hebrew name (or its
 * English one). A competition has no row. A failed read logs and draws no picture.
 */
async function readSubjectArtRow(plan: UploaderPlan): Promise<SubjectArtRow | null> {
  const kind = plan.subject.kind;
  if (kind === "competition") return null;
  const tries: { column: "name_english" | "name"; pattern: string | null }[] = [
    { column: "name_english", pattern: ilikeExact(plan.subject.name_en) },
    { column: "name", pattern: ilikeExact(plan.subject.name_he ?? plan.subject.name_en) },
  ];
  for (const { column, pattern } of tries) {
    if (pattern === null) continue;
    const read =
      kind === "artist"
        ? await supabaseTyped
            .from("artists")
            .select("id,name_english,image_url,art_image_url")
            .eq("is_active", true)
            .eq("is_deleted", false)
            .ilike(column, pattern)
            .order("name")
            .order("id")
            .limit(1)
        : await supabaseTyped
            .from("football_teams")
            .select("id,name_english,image_url,art_image_url,logo_url")
            .eq("is_active", true)
            .eq("is_deleted", false)
            .ilike(column, pattern)
            .order("name")
            .order("id")
            .limit(1);
    if (read.error) {
      logDb("subject art read", read.error);
      return null;
    }
    const row = read.data?.[0];
    if (row) return row;
  }
  return null;
}

// ---- questions ---------------------------------------------------------------------------------------

/**
 * New items right after `item` (the "both" answer): every later item moves down to make room, then
 * the new ones take the places after it. false = something failed (logged).
 */
async function insertAfter(item: UploaderItem, extra: SplitShow[]): Promise<boolean> {
  if (extra.length === 0) return true;
  const later = await fetchPaged<{ id: string; position: number }>(
    () => db.from("uploader_items").select("id,position").eq("run_id", item.run_id).gt("position", item.position).order("id"),
    ITEMS_MAX,
  );
  if (later.error || later.truncated) {
    logDb("later items read", later.error ?? { message: "too many items" });
    return false;
  }
  const moved = (await Promise.all(
    later.rows.map((r) => db.from("uploader_items").update({ position: r.position + extra.length }).eq("id", r.id)),
  )) as DbResult<null>[];
  const moveError = moved.find((m) => m.error)?.error;
  if (moveError) {
    logDb("item positions shift", moveError);
    return false;
  }
  const at = nowIso();
  const inserted = (await db.from("uploader_items").insert(
    extra.map((e, i) => ({
      run_id: item.run_id,
      position: item.position + 1 + i,
      show: e.show,
      status: "found",
      decisions: [],
      question: e.question,
      updated_at: at,
    })),
  )) as DbResult<null>;
  if (inserted.error) {
    logDb("split items insert", inserted.error);
    return false;
  }
  return true;
}

/**
 * A person answers an open question: the answer is recorded on the item (who / when), the item is
 * re-queued for the build (`found`) - or skipped on "skip", or split into one item per show on
 * "both" - the task closes, and the answer is audited (`uploader.answered`, what the agent learns).
 */
export async function answerQuestion(itemId: string, answer: { key: string | null; text: string | null }): Promise<Ok> {
  const session = await requireAdmin();
  if (!isUuid(itemId)) return badInput;
  const clean = cleanAnswerInput(answer);
  if (clean === null) return badInput;

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return { ok: false, kind: read.kind };
  const { item, run } = read;
  const q = item.question;
  if (item.status !== "question" || q === null) return { ok: false, kind: "not_question" };
  const fit = checkAnswer(q, clean);
  if (!fit.ok) return { ok: false, kind: "bad_answer" };

  const stored: StoredAnswer = { key: clean.key, text: clean.text, by: session.sub, at: nowIso() };
  const answered: UploaderQuestion = { ...q, answer: stored };
  const effect = answerEffect(q, item.show, stored);
  const patch =
    effect.kind === "skip"
      ? { status: "skipped", skip_reason: SKIPPED_BY_ANSWER, question: answered, updated_at: nowIso() }
      : { status: "found", show: effect.show, question: answered, skip_reason: null, error: null, updated_at: nowIso() };
  const written = (await db
    .from("uploader_items")
    .update(patch)
    .eq("id", item.id)
    .eq("status", "question")
    .select("id")) as DbResult<{ id: string }[]>;
  if (written.error) {
    logDb("answer write", written.error);
    return dbError;
  }
  if ((written.data ?? []).length === 0) return { ok: false, kind: "not_question" }; // answered meanwhile

  const split = effect.kind === "split" ? await insertAfter(item, effect.extra) : true;

  let taskClosed = true;
  if (q.task_id) {
    try {
      await closeQuestionTask(q.task_id, clean.text ?? fit.label ?? clean.key ?? "");
    } catch (e) {
      taskClosed = false;
      console.error(`uploader-actions: closing task ${q.task_id} failed`, errorText(e));
    }
  }

  await logAudit({
    action: "uploader.answered",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: {
      agent: AGENT,
      run_id: run.id,
      item_id: item.id,
      kind: q.kind,
      key: clean.key,
      question: q.text,
      answer: clean.key ?? clean.text,
      label: fit.label,
      text: clean.text,
      subject: run.plan.subject.name_en,
      city: item.show.city,
      date: item.show.date,
    },
  });
  await recomputeRun(run.id);
  // The answer is saved either way; these say what did not follow it.
  if (!split) return { ok: false, kind: "split_failed" };
  if (!taskClosed) return { ok: false, kind: "task_not_closed" };
  return { ok: true };
}

/** The asker's open uploader questions (the toast and the menu badge). */
export async function countOpenQuestionsFor(): Promise<OpenQuestions> {
  const session = await requireAdmin();
  try {
    return await countOpenQuestions(session.sub);
  } catch (e) {
    console.error("uploader-actions: open questions count failed", errorText(e));
    return { count: 0, newest: null, failed: true };
  }
}

/** Every `locations` row, for the "which location" answer and the two-city picker. */
export async function listLocationOptions(): Promise<LocationOption[]> {
  await requireAdmin();
  try {
    return (await loadLocations()).map((r) => ({ id: r.id, name: r.name, city_iata: r.city_iata }));
  } catch (e) {
    console.error("uploader-actions: locations read failed", errorText(e));
    return [];
  }
}

// ---- approve / reject ----------------------------------------------------------------------------------

type ApproveKind = Extract<ApproveResult, { ok: false }>["kind"];
type Unhidden = { ok: true; eventId: number; before: Record<string, unknown> } | { ok: false; kind: ApproveKind };

/**
 * List the item's hidden event: a direct update of `events.is_hidden` alone (never through
 * `updateEvent`), only while the event is not deleted. `before` = the row as staff left it, read
 * BEFORE the un-hide, for the edit diff.
 */
async function unhide(item: UploaderItem): Promise<Unhidden> {
  if (item.status !== "ready") return { ok: false, kind: "not_ready" };
  if ((item.blockers ?? []).length > 0) return { ok: false, kind: "blocked" };
  if (item.event_id === null) return { ok: false, kind: "event_gone" };
  const before = await supabaseTyped.from("events").select(EDIT_EVENT_COLUMNS).eq("id", item.event_id).is("is_deleted", null).maybeSingle();
  if (before.error) {
    logDb("event (before approve) read", before.error);
    return { ok: false, kind: "db_error" };
  }
  if (!before.data) return { ok: false, kind: "event_gone" };
  // `events.is_hidden` is newer than the generated types - the module's one boundary cast.
  const listed = (await db
    .from("events")
    .update({ is_hidden: false })
    .eq("id", item.event_id)
    .is("is_deleted", null)
    .select("id")) as DbResult<{ id: number }[]>;
  if (listed.error) {
    logDb("event un-hide", listed.error);
    return { ok: false, kind: "db_error" };
  }
  if ((listed.data ?? []).length === 0) return { ok: false, kind: "event_gone" };
  return { ok: true, eventId: item.event_id, before: before.data as unknown as Record<string, unknown> };
}

/**
 * The item is approved (who / when) - only while it is still `ready` - and the approval audited:
 * `uploader.edited` when staff changed the event before approving (the edit diff over
 * EDIT_WHITELIST), `uploader.approved` always. Returns whether it was edited, or the refusal.
 */
async function markApproved(
  session: { sub: string },
  run: UploaderRun,
  item: UploaderItem,
  listed: { eventId: number; before: Record<string, unknown> },
): Promise<{ ok: true; edited: boolean } | { ok: false; kind: ApproveKind }> {
  const at = nowIso();
  const written = (await db
    .from("uploader_items")
    .update({ status: "approved", approved_by: session.sub, approved_at: at, updated_at: at })
    .eq("id", item.id)
    .eq("status", "ready")
    .select("id")) as DbResult<{ id: string }[]>;
  if (written.error) {
    logDb(`item ${item.id} approve write (event ${listed.eventId} is listed)`, written.error);
    return { ok: false, kind: "db_error" };
  }
  if ((written.data ?? []).length === 0) return { ok: false, kind: "not_ready" }; // approved / rejected meanwhile

  const fields = editDiff(item.payload, listed.before).map((d) => d.field);
  const edited = fields.length > 0;
  if (edited) {
    await logAudit({
      action: "uploader.edited",
      entityType: "uploader_item",
      entityId: item.id,
      metadata: {
        agent: AGENT,
        run_id: run.id,
        item_id: item.id,
        event_id: listed.eventId,
        subject: run.plan.subject.name_en,
        city: item.show.city,
        date: item.show.date,
        fields,
      },
    });
  }
  await logAudit({
    action: "uploader.approved",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: { agent: AGENT, run_id: run.id, item_id: item.id, event_id: listed.eventId, edited },
  });
  return { ok: true, edited };
}

/**
 * Approve one built event: listed (un-hidden) -> availability re-checked -> the site refreshed ->
 * the price light's list refreshed -> the item approved and audited.
 */
export async function approveItem(itemId: string): Promise<ApproveResult> {
  const session = await requireAdmin();
  if (!isUuid(itemId)) return { ok: false, kind: "bad_input" };
  const read = await readItemAndRun(itemId);
  if ("kind" in read) return { ok: false, kind: read.kind === "not_found" ? "not_found" : "db_error" };
  const { item, run } = read;

  const listed = await unhide(item);
  if (!listed.ok) return listed;
  await recheckAvailability([listed.eventId], APPROVE_ONE_SYNC_MS);
  await revalidateMain();
  invalidatePriceLight("rows");
  const approved = await markApproved(session, run, item, listed);
  await recomputeRun(run.id);
  return approved;
}

/**
 * Approve every `ready` item with no blocker, soonest first, through the same path - one
 * availability re-check and one site refresh for all of them at the end. Past
 * APPROVE_ALL_BUDGET_MS the rest are reported `time_budget` (approve them again).
 */
export async function approveAll(runId: string): Promise<ApproveAllResult> {
  const session = await requireAdmin();
  const started = Date.now();
  if (!isUuid(runId)) return { approved: 0, failed: [], kind: "bad_input" };
  const { run, failed: runFailed } = await readRun(runId);
  if (runFailed) return { approved: 0, failed: [], kind: "db_error" };
  if (!run) return { approved: 0, failed: [], kind: "not_found" };

  const ready = await fetchPaged<UploaderItem>(
    () => db.from("uploader_items").select(ITEM_COLUMNS).eq("run_id", runId).eq("status", "ready").order("position").order("created_at").order("id"),
    ITEMS_MAX,
  );
  if (ready.error || ready.truncated) {
    logDb("ready items read", ready.error ?? { message: "too many items" });
    return { approved: 0, failed: [], kind: "db_error" };
  }

  const failed: { itemId: string; kind: string }[] = [];
  /** Every event listed by this call - re-checked even when its item write then failed (it is live either way). */
  const eventIds: number[] = [];
  let approved = 0;
  for (const item of ready.rows.filter((i) => (i.blockers ?? []).length === 0)) {
    if (Date.now() - started > APPROVE_ALL_BUDGET_MS) {
      failed.push({ itemId: item.id, kind: "time_budget" });
      continue;
    }
    const listed = await unhide(item);
    if (!listed.ok) {
      failed.push({ itemId: item.id, kind: listed.kind });
      continue;
    }
    eventIds.push(listed.eventId);
    const marked = await markApproved(session, run, item, listed);
    if (marked.ok) approved += 1;
    else failed.push({ itemId: item.id, kind: marked.kind });
  }

  if (eventIds.length > 0) {
    const left = APPROVE_ALL_DEADLINE_MS - (Date.now() - started);
    await recheckAvailability(eventIds, Math.max(APPROVE_ALL_SYNC_MIN_MS, Math.min(APPROVE_ALL_SYNC_MAX_MS, left)));
    await revalidateMain();
    invalidatePriceLight("rows");
  }
  await recomputeRun(runId);
  return { approved, failed };
}

/**
 * Reject a show: the item first (only from ready / question / found / error - the condition is in
 * the UPDATE, so a show being built or approved meanwhile is refused), then its hidden event soft
 * deleted, its open question task closed, and the rejection audited (reason = the lesson). `final`
 * = never offer this show again (a later run skips it, `rejected_before`).
 */
export async function rejectItem(itemId: string, reason: string, final: boolean): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(itemId) || typeof reason !== "string" || typeof final !== "boolean") return badInput;
  const why = reason.trim();
  if (why.length < REJECT_REASON_MIN || why.length > REJECT_REASON_MAX) return badInput;

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return { ok: false, kind: read.kind };
  const { item, run } = read;
  if (!REJECTABLE.includes(item.status)) return { ok: false, kind: "not_rejectable" };

  const written = (await db
    .from("uploader_items")
    .update({ status: "rejected", rejected_reason: why, rejected_final: final, updated_at: nowIso() })
    .eq("id", item.id)
    .in("status", REJECTABLE)
    .select("id")) as DbResult<{ id: string }[]>;
  if (written.error) {
    logDb("reject write", written.error);
    return dbError;
  }
  if ((written.data ?? []).length === 0) return { ok: false, kind: "not_rejectable" }; // building / approved meanwhile

  if (item.event_id !== null) await softDeleteBuiltEvent(item.event_id);
  if (item.status === "question" && item.question?.task_id && !item.question.answer) {
    try {
      await closeQuestionTask(item.question.task_id, "נדחה");
    } catch (e) {
      console.error(`uploader-actions: closing task ${item.question.task_id} failed`, errorText(e));
    }
  }
  await logAudit({
    action: "uploader.rejected",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: {
      agent: AGENT,
      run_id: run.id,
      item_id: item.id,
      event_id: item.event_id,
      subject: run.plan.subject.name_en,
      city: item.show.city,
      date: item.show.date,
      reason: why,
      final,
    },
  });
  await recomputeRun(run.id);
  return { ok: true };
}

/**
 * The far-venue offer ("בנה כחבילה דרך <city>"): the show is built again as a two-city package
 * flying to `flightCityId`, lodging split with the venue city. The ticket-only event it replaces is
 * soft deleted; the choice rides on the item's show (`two_city`) to the next build.
 */
export async function rebuildTwoCity(itemId: string, flightCityId: number): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(itemId) || !isPositiveInt(flightCityId)) return badInput;

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return { ok: false, kind: read.kind };
  const { item, run } = read;
  if (!REBUILDABLE.includes(item.status)) return { ok: false, kind: "not_rebuildable" };
  const { lat, lon } = item.show;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, kind: "no_coordinates" };
  }

  const loc = await supabaseTyped.from("locations").select("id,name,city_iata,latitude,longitude").eq("id", flightCityId).maybeSingle();
  if (loc.error) {
    logDb("location read", loc.error);
    return dbError;
  }
  if (!loc.data) return { ok: false, kind: "location_not_found" };
  if (!loc.data.city_iata?.trim()) return { ok: false, kind: "location_no_iata" };
  const km = Math.round(distanceKm(lat, lon, loc.data.latitude, loc.data.longitude));

  const written = (await db
    .from("uploader_items")
    .update({
      status: "found",
      show: withTwoCity(item.show, flightCityId),
      event_id: null,
      payload: null,
      blockers: [],
      warnings: [],
      mode: null,
      location: null,
      skip_reason: null,
      error: null,
      updated_at: nowIso(),
    })
    .eq("id", item.id)
    .in("status", REBUILDABLE)
    .select("id")) as DbResult<{ id: string }[]>;
  if (written.error) {
    logDb("two-city requeue", written.error);
    return dbError;
  }
  if ((written.data ?? []).length === 0) return { ok: false, kind: "not_rebuildable" };

  if (item.event_id !== null) await softDeleteBuiltEvent(item.event_id);
  await logAudit({
    action: "uploader.two_city_chosen",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: {
      agent: AGENT,
      run_id: run.id,
      item_id: item.id,
      subject: run.plan.subject.name_en,
      venue: item.show.venue ?? item.show.city,
      city: item.show.city,
      date: item.show.date,
      flight_city: loc.data.name,
      flight_city_id: flightCityId,
      km,
    },
  });
  await recomputeRun(run.id);
  return { ok: true };
}
