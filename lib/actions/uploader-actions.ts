"use server";

/**
 * Tour uploader (agent #3) - the ONE server-action module of the feature, and its security
 * boundary. Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 9-11.
 *
 * A staff member types a brief, the agent parses it (`parseBrief`), the plan is confirmed
 * (`createRun` - the shows are found and become items), the board builds one item per call
 * (`buildNextItem`; `stopRun` / `resumeRun`), a person answers what the builder could not decide
 * (`answerQuestion`), retries a failed show (`retryItem`) and approves or rejects each hidden event
 * (`approveItem` / `approveAll` / `rejectItem`, `rebuildTwoCity` for the far-venue offer).
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
 * This file holds ONLY the exported actions. Their reads and writes live in
 * lib/services/uploader-store.ts (not "use server"), the pure rules in lib/uploader/run-rules.ts
 * (selftested), the result shapes in lib/uploader/action-types.ts.
 */
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { newBudget, TOUR_UPLOADER_AGENT } from "@/lib/agents";
import { revalidateMain } from "@/lib/revalidate-main";
import { distanceKm, loadLocations } from "@/lib/services/nearest-location";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { parseBriefWithAgent } from "@/lib/services/tour-uploader-parse";
import { buildItem } from "@/lib/services/uploader-build";
import { countOpenQuestions } from "@/lib/services/uploader-questions";
import { findShows, resolveSubject } from "@/lib/services/uploader-search";
import { loadPriorItems, priorMarkups } from "@/lib/services/uploader-prior";
import {
  AGENT,
  APPROVE_ALL_BUDGET_MS,
  APPROVE_ALL_DEADLINE_MS,
  APPROVE_SYNC_MS,
  boundedRecheck,
  BRIEF_EXCERPT,
  claimNextItem,
  closeTask,
  countFoundItems,
  errorText,
  fail,
  insertDraftItems,
  insertRun,
  insertSplitItems,
  itemPatch,
  listRunRows,
  loadPeople,
  markApproved,
  nowIso,
  previewOf,
  raiseQuestion,
  readEditRows,
  readItemAndRun,
  readLocation,
  readRun,
  readRunItems,
  readSubjectArt,
  readSubjectCache,
  recomputeRun,
  removeUnbuiltItems,
  RUNS_LIST_MAX,
  runInProgressFor,
  setQuestion,
  settleStaleBuilds,
  softDeleteBuiltEvent,
  transitionItem,
  transitionRun,
  unhide,
  writeSubjectCache,
} from "@/lib/services/uploader-store";
import { REJECT_REASON_MIN } from "@/lib/uploader/constants";
import { editDiff } from "@/lib/uploader/decisions";
import { applyPriorDefaults, emptyPlan, parsePlanInput } from "@/lib/uploader/plan";
import {
  answerEffect,
  BRIEF_MAX,
  canRebuildTwoCity,
  canResume,
  checkAnswer,
  cleanAnswerInput,
  freshSubjectCache,
  hasBuiltEvent,
  isPositiveInt,
  isStaleBuild,
  isUuid,
  liveBlockers,
  planEdits,
  planRunItems,
  REJECT_REASON_MAX,
  REJECTABLE_STATUSES,
  runCounts,
  SKIPPED_BY_ANSWER,
  STALE_BUILD_MS,
  twoCityOf,
  withTwoCity,
  type StoredAnswer,
  type SubjectCache,
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
  PreviewResult,
  RunView,
} from "@/lib/uploader/action-types";
import type { PriorItem } from "@/lib/uploader/shows";
import type { ItemStatus, UploaderPlan, UploaderQuestion, UploaderRun } from "@/types/uploader.types";

// ---- the plan ----------------------------------------------------------------------------------------

/**
 * The brief -> a plan to confirm. The agent parses it when it is on (its own run budget); off, or a
 * failed call, opens the manual form (`emptyPlan`, or what could be salvaged). The last real run's
 * markups fill the ones the brief left empty (`fromPrior`), then the plan is previewed - a failed
 * preview read still hands back the (paid) parse, with `preview: null` and `previewKind`.
 */
export async function parseBrief(brief: string): Promise<ParseBriefResult> {
  await requireAdmin();
  if (typeof brief !== "string" || brief.trim() === "") return fail("bad_input");
  if (brief.length > BRIEF_MAX) return fail("brief_too_long");

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

  const preview = await previewOf(plan, false);
  if (!preview.ok) return { ok: true, plan, planAi, fromPrior, preview: null, previewKind: preview.kind, agent, problems };
  return { ok: true, plan, planAi, fromPrior, preview: preview.preview, agent, problems };
}

/** The plan card after an edit (or the manual form): the plan is checked again first. `isTest` = the card's test switch. */
export async function previewPlan(plan: UploaderPlan, opts?: { isTest?: boolean }): Promise<PreviewResult> {
  await requireAdmin();
  const parsed = parsePlanInput(plan);
  if (!parsed.ok) return { ok: false, kind: "bad_plan", problems: parsed.problems };
  const includeTest = typeof opts === "object" && opts !== null && opts.isTest === true;
  return previewOf(parsed.plan, includeTest);
}

// ---- the run -----------------------------------------------------------------------------------------

/**
 * Confirm the plan: the run (status building) and one item per show (`planRunItems` - found /
 * question / skipped exists | rejected_before | by an earlier answer), each open question raised as
 * the asker's task. The asker is ALWAYS the session's user (`input.asker_id` is ignored). One run
 * per subject at a time: a run of the same subject still building or waiting -> `run_in_progress`.
 */
export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  const session = await requireAdmin();
  if (typeof input !== "object" || input === null) return fail("bad_input");
  const { brief, is_test } = input;
  if (typeof brief !== "string" || typeof is_test !== "boolean") return fail("bad_input");
  if (brief.length > BRIEF_MAX) return fail("brief_too_long");
  if (!isUuid(session.sub)) return fail("bad_input");
  const askerId = session.sub;
  const parsed = parsePlanInput(input.plan);
  if (!parsed.ok) return { ok: false, kind: "bad_plan", problems: parsed.problems };
  const plan = parsed.plan;
  // The model's own plan is kept for the lesson (what staff changed), salvaged like any plan; a
  // value that is no object at all is no plan (diffing it would teach a dozen false corrections).
  const rawAi: unknown = input.plan_ai;
  const planAi = typeof rawAi === "object" && rawAi !== null && !Array.isArray(rawAi) ? parsePlanInput(rawAi).plan : null;

  const busy = await runInProgressFor(plan);
  if (busy === null) return fail("db_error");
  if (busy) return fail("run_in_progress");

  // The card showed the model's plan WITH the last run's markups (parseBrief's applyPriorDefaults):
  // the edit lessons are measured from that, read again here - nothing about it comes from the client.
  let lastMarkups: Awaited<ReturnType<typeof priorMarkups>> | "unknown" = null;
  if (planAi !== null) {
    try {
      lastMarkups = await priorMarkups(planAi.subject.kind);
    } catch (e) {
      console.error("uploader-actions: prior markups read failed", errorText(e));
      lastMarkups = "unknown";
    }
  }

  // Search first: a failed search leaves no half-made run behind.
  let resolved: Awaited<ReturnType<typeof resolveSubject>>;
  try {
    resolved = await resolveSubject(plan);
  } catch (e) {
    console.error("uploader-actions: subject resolution failed", errorText(e));
    return fail("roster_read_failed");
  }
  const subject = resolved.subject;
  let found: Awaited<ReturnType<typeof findShows>>;
  let priors: PriorItem[];
  try {
    found = await findShows(plan, subject, { includeTest: is_test });
    // Fails closed: without the priors a show rejected for good would be built again.
    // A real run learns only from real runs (a test run's rejections never skip a real show).
    priors = await loadPriorItems(plan.subject.name_en, { includeTest: is_test });
  } catch (e) {
    console.error("uploader-actions: show search failed", errorText(e));
    return fail("search_failed");
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
  const run = await insertRun({
    created_by: askerId,
    asker_id: askerId,
    brief,
    plan,
    plan_ai: planAi,
    counts: runCounts(drafts.map((d) => d.status)),
    is_test,
    at,
  });
  if (!run) return fail("db_error");
  await writeSubjectCache(run.id, { at, ...resolved });
  const items = await insertDraftItems(run.id, drafts, at);
  if (!items) return fail("db_error");

  // Every question nobody answered before becomes the asker's task. A task whose id cannot be
  // stored on its item is closed again at once - never a task nothing points back to.
  const byPosition = new Map(items.map((i) => [i.position, i]));
  for (const draft of drafts) {
    if (!draft.ask) continue;
    const item = byPosition.get(draft.position);
    if (!item?.question) continue;
    const taskId = await raiseQuestion(run, item, item.question);
    if (taskId === null) continue;
    if (!(await setQuestion(item.id, { ...item.question, task_id: taskId }))) {
      console.error(`uploader-actions: task ${taskId} of item ${item.id} could not be stored - closing it`);
      await closeTask(taskId, "נכשל");
    }
  }

  for (const change of planEdits(planAi, plan, lastMarkups)) {
    await logAudit({
      action: "uploader.plan_edited",
      entityType: "uploader_run",
      entityId: run.id,
      metadata: { agent: AGENT, run_id: run.id, field: change.field, from: change.from, to: change.to, brief_excerpt: brief.slice(0, BRIEF_EXCERPT) },
    });
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

/** The run's subject: the cached resolve when it is fresh (`freshSubjectCache`), else resolved now and cached. THROWS like `resolveSubject`. */
async function resolvedSubjectOf(run: UploaderRun): Promise<SubjectCache> {
  const cached = freshSubjectCache(await readSubjectCache(run.id), Date.now());
  if (cached) return cached;
  const fresh: SubjectCache = { at: nowIso(), ...(await resolveSubject(run.plan)) };
  await writeSubjectCache(run.id, fresh);
  return fresh;
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

  const claim = await claimNextItem(runId);
  if ("failed" in claim) return { done: true, kind: "db_error" };
  if ("lost" in claim) return { done: false };
  if ("none" in claim) {
    await settleStaleBuilds(runId);
    await recomputeRun(runId);
    return { done: true };
  }
  const item = claim.item;

  let status: ItemStatus;
  let patch: Record<string, unknown>;
  let raisedTask: string | null = null;
  try {
    // Resolved once per run and cached on the run row for SUBJECT_CACHE_MS (a page fixed mid-run
    // shows up within the hour): a competition's resolve is the whole sliced TixStock read.
    const { subject, rows, teamsHe } = await resolvedSubjectOf(run);
    const twoCity = twoCityOf(item.show);
    const result = await buildItem(run, item, { subject, rows, teamsHe, ...(twoCity ? { twoCity } : {}) });
    status = result.status;
    patch = { ...itemPatch(result.item), status };
    if (result.status === "question" && result.item.question) {
      raisedTask = await raiseQuestion(run, { ...item, ...result.item, status: "question" }, result.item.question);
      patch.question = { ...result.item.question, task_id: raisedTask };
    }
  } catch (e) {
    console.error(`uploader-actions: build of item ${item.id} failed`, errorText(e));
    status = "error";
    patch = { status, error: errorText(e) };
  }

  const written = await transitionItem(item.id, ["building"], patch);
  if (written !== "ok") {
    // The build may have created a hidden event the item does not point at - name it in the log;
    // a question task raised for an item that never became a question is closed again.
    console.error(`uploader-actions: item ${item.id} result not written (${written}); event ${String(patch.event_id ?? "none")}`);
    if (raisedTask) await closeTask(raisedTask, "נכשל");
    await recomputeRun(runId);
    return { done: false, itemId: item.id, status: "error", kind: "db_error" };
  }
  await recomputeRun(runId);
  return { done: false, itemId: item.id, status };
}

/** Stop a run that is building or waiting; its items stay as they are (`resumeRun` goes on). */
export async function stopRun(runId: string): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(runId)) return fail("bad_input");
  const stopped = await transitionRun(runId, ["building", "waiting"], { status: "stopped" });
  if (stopped === "db_error") return fail("db_error");
  if (stopped === "ok") return { ok: true };
  const { run, failed } = await readRun(runId);
  if (failed) return fail("db_error");
  return fail(run ? "not_running" : "not_found");
}

/**
 * "המשך": a stopped run - or a run in a non-terminal status that still has items to build - goes
 * back to building (`canResume`); its items are untouched, except a build cut off mid-way, which
 * becomes a retryable `error` first. The board then calls `buildNextItem` again; the status
 * settles by the items right after (`recomputeRun`).
 */
export async function resumeRun(runId: string): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(runId)) return fail("bad_input");
  const { run, failed } = await readRun(runId);
  if (failed) return fail("db_error");
  if (!run) return fail("not_found");
  await settleStaleBuilds(runId);
  const found = await countFoundItems(runId);
  if (found === null) return fail("db_error");
  if (!canResume(run.status, found)) return fail("not_resumable");
  const resumed = await transitionRun(runId, [run.status], { status: "building" });
  if (resumed === "db_error") return fail("db_error");
  if (resumed === "moved") return fail("not_resumable"); // its status moved meanwhile
  await logAudit({
    action: "uploader.run_resumed",
    entityType: "uploader_run",
    entityId: runId,
    metadata: { agent: AGENT, run_id: runId, from: run.status },
  });
  await recomputeRun(runId);
  return { ok: true };
}

/** The newest runs, newest first ([] when the read fails - logged). */
export async function listRuns(): Promise<UploaderRun[]> {
  await requireAdmin();
  return (await listRunRows(RUNS_LIST_MAX)) ?? [];
}

/**
 * The board: the run, its items (soonest first; a ready item's blockers re-judged against its live
 * event row), which built events staff already edited (unknown when that read failed -
 * `editedUnknown`), the people an answer can name, and the subject's own picture (one light read).
 * null = no such run; `{ run: null, kind: "db_error" }` = a read failed.
 */
export async function getRun(runId: string): Promise<RunView | null> {
  await requireAdmin();
  if (!isUuid(runId)) return null;
  const { run, failed } = await readRun(runId);
  if (failed) return { run: null, kind: "db_error" };
  if (!run) return null;
  const stored = await readRunItems(runId);
  if (stored === null) return { run: null, kind: "db_error" };

  const rows = await readEditRows([...new Set(stored.filter(hasBuiltEvent).map((i) => i.event_id))]);
  const edited: Record<string, boolean> = {};
  const items = stored.map((item) => {
    if (rows === null || !hasBuiltEvent(item)) return item;
    const row = rows.get(item.event_id) ?? null;
    edited[item.id] = editDiff(item.payload, row).length > 0;
    return row ? { ...item, blockers: liveBlockers(item.blockers, row) } : item;
  });
  const [people, subjectArt] = await Promise.all([loadPeople(), readSubjectArt(run.plan)]);
  return { run, items, edited, editedUnknown: rows === null, people, subjectArt };
}

// ---- questions ---------------------------------------------------------------------------------------

/**
 * A person answers an open question: the answer is recorded on the item (who / when), the item is
 * re-queued for the build (`found`) - or skipped on "skip", or split into one item per show on
 * "both" - the task closes, and the answer is audited (`uploader.answered`, what the agent learns).
 * A "both" inserts its extra items FIRST; if that fails nothing is saved (`split_failed`, the item
 * still asks), and if the answer cannot be saved after it, the extra items are taken back.
 */
export async function answerQuestion(itemId: string, answer: { key: string | null; text: string | null }): Promise<Ok> {
  const session = await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  const clean = cleanAnswerInput(answer);
  if (clean === null) return fail("bad_input");

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  const q = item.question;
  if (item.status !== "question" || q === null) return fail("not_question");
  const fit = checkAnswer(q, clean);
  if (!fit.ok) return fail("bad_answer");

  const stored: StoredAnswer = { key: clean.key, text: clean.text, by: session.sub, at: nowIso() };
  const answered: UploaderQuestion = { ...q, answer: stored };
  const effect = answerEffect(q, item.show, stored);

  let splitIds: string[] = [];
  if (effect.kind === "split") {
    const ids = await insertSplitItems(item, effect.extra);
    if (ids === null) return fail("split_failed");
    splitIds = ids;
  }
  const patch =
    effect.kind === "skip"
      ? { status: "skipped", skip_reason: SKIPPED_BY_ANSWER, question: answered }
      : { status: "found", show: effect.show, question: answered, skip_reason: null, error: null };
  const written = await transitionItem(item.id, ["question"], patch);
  if (written !== "ok") {
    await removeUnbuiltItems(splitIds);
    return fail(written === "moved" ? "not_question" : "db_error"); // "moved" = answered meanwhile
  }

  const taskClosed = q.task_id ? await closeTask(q.task_id, clean.text ?? fit.label ?? clean.key ?? "") : true;
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
  // The answer is saved either way; this says the task did not close with it.
  return taskClosed ? { ok: true } : fail("task_not_closed");
}

/**
 * "נסה שוב": an `error` item - or a build cut off mid-way (`building` past STALE_BUILD_MS) - goes
 * back to `found` (error cleared) for the build loop. Its `event_id` is kept as it is: an errored
 * build never wrote one, and the build re-checks duplicates by supplier id anyway.
 */
export async function retryItem(itemId: string): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  const now = Date.now();
  const stale = item.status === "building" && isStaleBuild(item.updated_at, now);
  if (item.status !== "error" && !stale) return fail("not_retryable");
  const retried = stale
    ? await transitionItem(item.id, ["building"], { status: "found", error: null }, { updatedBefore: new Date(now - STALE_BUILD_MS).toISOString() })
    : await transitionItem(item.id, ["error"], { status: "found", error: null });
  if (retried === "db_error") return fail("db_error");
  if (retried === "moved") return fail("not_retryable");
  await logAudit({
    action: "uploader.item_retried",
    entityType: "uploader_item",
    entityId: item.id,
    metadata: { agent: AGENT, run_id: run.id, item_id: item.id, event_id: item.event_id, from: item.status, error: item.error },
  });
  await recomputeRun(run.id);
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

/**
 * Approve one built event: listed (un-hidden, its blockers re-judged against the live row) -> the
 * approval recorded and audited -> availability re-checked (awaited at most APPROVE_SYNC_MS) ->
 * the site refreshed -> the price light's list refreshed. The record comes before the re-check, so
 * a hung supplier can never leave a live event with no approval on file.
 */
export async function approveItem(itemId: string): Promise<ApproveResult> {
  const session = await requireAdmin();
  if (!isUuid(itemId)) return { ok: false, kind: "bad_input" };
  const read = await readItemAndRun(itemId);
  if ("kind" in read) return { ok: false, kind: read.kind };
  const { item, run } = read;

  const listed = await unhide(item);
  if (!listed.ok) return listed;
  const approved = await markApproved(session.sub, run, item, listed);
  // The event is listed whatever the record said - it is re-checked and the site refreshed either way.
  await boundedRecheck([listed.eventId], APPROVE_SYNC_MS);
  await revalidateMain();
  invalidatePriceLight("rows");
  await recomputeRun(run.id);
  return approved;
}

/**
 * Approve every `ready` item, soonest first, through the same path (un-hide, record, audit); an
 * item still blocked (live blockers) is reported `blocked`. ONE availability re-check (awaited at
 * most APPROVE_SYNC_MS, or what is left of APPROVE_ALL_DEADLINE_MS) and one site refresh at the end.
 * Past APPROVE_ALL_BUDGET_MS the rest are reported `time_budget` (approve them again).
 */
export async function approveAll(runId: string): Promise<ApproveAllResult> {
  const session = await requireAdmin();
  const started = Date.now();
  if (!isUuid(runId)) return { approved: 0, failed: [], kind: "bad_input" };
  const { run, failed: runFailed } = await readRun(runId);
  if (runFailed) return { approved: 0, failed: [], kind: "db_error" };
  if (!run) return { approved: 0, failed: [], kind: "not_found" };
  const ready = await readRunItems(runId, "ready");
  if (ready === null) return { approved: 0, failed: [], kind: "db_error" };

  const failed: { itemId: string; kind: string }[] = [];
  /** Every event listed by this call - re-checked even when its record then failed (it is live either way). */
  const eventIds: number[] = [];
  let approved = 0;
  for (const item of ready) {
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
    const marked = await markApproved(session.sub, run, item, listed);
    if (marked.ok) approved += 1;
    else failed.push({ itemId: item.id, kind: marked.kind });
  }

  if (eventIds.length > 0) {
    await boundedRecheck(eventIds, Math.min(APPROVE_SYNC_MS, APPROVE_ALL_DEADLINE_MS - (Date.now() - started)));
    await revalidateMain();
    invalidatePriceLight("rows");
  }
  await recomputeRun(runId);
  return { approved, failed };
}

/**
 * Reject a show: its hidden event is soft deleted FIRST (a failure answers `event_not_deleted` and
 * changes nothing - a surviving hidden event would block the next run as `exists`), then the item
 * (only from ready / question / found / error, the condition in the UPDATE), its open question task
 * closed, and the rejection audited (the reason is the lesson). `final` = never offer this show
 * again (a later run skips it, `rejected_before`).
 */
export async function rejectItem(itemId: string, reason: string, final: boolean): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(itemId) || typeof reason !== "string" || typeof final !== "boolean") return fail("bad_input");
  const why = reason.trim();
  if (why.length < REJECT_REASON_MIN || why.length > REJECT_REASON_MAX) return fail("bad_input");

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  if (!REJECTABLE_STATUSES.includes(item.status)) return fail("not_rejectable");
  if (item.event_id !== null && !(await softDeleteBuiltEvent(item.event_id))) return fail("event_not_deleted");

  const written = await transitionItem(item.id, REJECTABLE_STATUSES, { status: "rejected", rejected_reason: why, rejected_final: final });
  if (written === "db_error") return fail("db_error");
  if (written === "moved") return fail("not_rejectable"); // building / approved meanwhile

  if (item.status === "question" && item.question?.task_id && !item.question.answer) await closeTask(item.question.task_id, "נדחה");
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
 * The far-venue offer ("בנה כחבילה דרך <city>"): a built ticket-only show, or one skipped for having
 * no location (`canRebuildTwoCity`), is built again as a two-city package flying to
 * `flightCityId` - by default the item's own nearest location (`item.location.id`) - lodging split
 * with the venue city. The ticket-only event is soft deleted FIRST (failure -> `event_not_deleted`,
 * nothing changed); then the item is re-queued with the choice on its show (`two_city`).
 */
export async function rebuildTwoCity(itemId: string, flightCityId?: number | null): Promise<Ok> {
  await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  if (flightCityId !== undefined && flightCityId !== null && !isPositiveInt(flightCityId)) return fail("bad_input");

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  if (!canRebuildTwoCity(item)) return fail("not_rebuildable");
  const { lat, lon } = item.show;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return fail("no_coordinates");
  const cityId = flightCityId ?? item.location?.id ?? null;
  if (!isPositiveInt(cityId)) return fail("bad_input");

  const loc = await readLocation(cityId);
  if (loc.failed) return fail("db_error");
  if (!loc.row) return fail("location_not_found");
  if (!loc.row.city_iata?.trim()) return fail("location_no_iata");
  const km = Math.round(distanceKm(lat, lon, loc.row.latitude, loc.row.longitude));

  if (item.event_id !== null && !(await softDeleteBuiltEvent(item.event_id))) return fail("event_not_deleted");
  const requeued = await transitionItem(item.id, [item.status], {
    status: "found",
    show: withTwoCity(item.show, cityId),
    event_id: null,
    payload: null,
    blockers: [],
    warnings: [],
    mode: null,
    location: null,
    skip_reason: null,
    error: null,
  });
  if (requeued === "db_error") return fail("db_error");
  if (requeued === "moved") return fail("not_rebuildable");

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
      flight_city: loc.row.name,
      flight_city_id: cityId,
      km,
    },
  });
  await recomputeRun(run.id);
  return { ok: true };
}
