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
 * Round "אלון 1" (docs/superpowers/specs/2026-10-22-uploader-alon-round-1-design.md): the run panel's
 * dialogs - a venue's tickets classified (`proposeVenueClassification` / `classifyVenue`) or learned from
 * one event a person arranged (`learnPreview` / `learnFromEvent`), the Hebrew names
 * (`proposeTeamNames` / `createTeamsAndRename`), and one answer applied to the run's similar questions
 * (`answerQuestion(..., { applyToSimilar })`).
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
import { agentEnabled, newBudget, TOUR_UPLOADER_AGENT } from "@/lib/agents";
import { createArtistInactive } from "@/lib/actions/artist-actions";
import { createFootballTeamInactive } from "@/lib/actions/football-actions";
import { adoptVenueMap, getVenueMapDrawing, rememberSupplierCategories, saveVenueZones } from "@/lib/actions/venue-map-actions";
import { normalizeName } from "@/lib/on-tour";
import { revalidateMain } from "@/lib/revalidate-main";
import { distanceKm } from "@/lib/services/nearest-location";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { classifyVenueWithAgent, nameTeamsWithAgent } from "@/lib/services/tour-uploader-classify";
import { parseBriefWithAgent } from "@/lib/services/tour-uploader-parse";
import { buildItem } from "@/lib/services/uploader-build";
import { closeNamesTask, countOpenQuestions, openNamesTask } from "@/lib/services/uploader-questions";
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
  countRecentParses,
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
  planTokenKey,
  previewOf,
  raiseQuestion,
  readEditRows,
  readEventTickets,
  readItem,
  readItemAndRun,
  readLocation,
  readPersonNames,
  readRun,
  readRunItems,
  readStyleLabels,
  readSubjectArt,
  readSubjectCache,
  readVenueTemplate,
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
  writeDroppedCategories,
  writeEventClassification,
  writeEventName,
  writeNamesTaskId,
  writeSubjectCache,
  type EventTicketsRow,
  type VenueTemplateRow,
} from "@/lib/services/uploader-store";
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import {
  applyClassification,
  classificationDiff,
  cleanConfirmedRows,
  drawingCategories,
  dropRule,
  forgetUnconfirmed,
  proposalRows,
  templateFromEvent,
  templateFromRows,
  ticketsFixedByHand,
  ZONE_LABEL_MAX,
  type CategoryInput,
  type DrawingCategory,
  type DroppedCategories,
  type ProposedRow,
  type TemplateLike,
  type TemplateUpdate,
} from "@/lib/uploader/classify";
import { FAR_VENUE_KM, MAX_QUESTION_TASKS_PER_RUN, PARSE_RATE_MAX, PARSE_RATE_WINDOW_MS, REJECT_REASON_MIN } from "@/lib/uploader/constants";
import { decision, editDiff } from "@/lib/uploader/decisions";
import { eventNames, withSupplierSpellings } from "@/lib/uploader/names";
import { applyPriorDefaults, emptyPlan, parsePlanInput } from "@/lib/uploader/plan";
import { planTokenFor, verifyPlanToken } from "@/lib/uploader/plan-token";
import {
  answerEffect,
  applyRuleTo,
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
  parseRateLimited,
  planEdits,
  planRunItems,
  REJECT_REASON_MAX,
  REJECTABLE_STATUSES,
  runCounts,
  runRuleOf,
  SKIPPED_BY_ANSWER,
  STALE_BUILD_MS,
  twoCityOf,
  withTwoCity,
  type AnswerInput,
  type StoredAnswer,
  type SubjectCache,
} from "@/lib/uploader/run-rules";
import type {
  ApproveAllResult,
  ApproveResult,
  BuildStep,
  ClassifyResult,
  CreateRunInput,
  CreateRunResult,
  LearnPreview,
  NamesProposeResult,
  Ok,
  OpenQuestions,
  ParseBriefResult,
  PreviewResult,
  ProposeResult,
  RunView,
  TeamsResult,
} from "@/lib/uploader/action-types";
import type { PriorItem } from "@/lib/uploader/shows";
import {
  cleanTeamRows,
  missingHebrewNames,
  missingSides,
  slugFor,
  teamRowsFor,
  type ConfirmedTeamRow,
  type MissingSide,
  type ProposedName,
} from "@/lib/uploader/team-names";
import { warning } from "@/lib/uploader/warnings";
import { cleanZoneDescription, type SupplierCategoryMap, type VenueZone } from "@/lib/venue-maps/svg-zones";
import { fetchSupplierSvg, isAdoptableHost } from "@/lib/venue-maps/supplier-svg";
import type { EventTicket } from "@/types/app.types";
import type { CreatePersonData } from "@/types/person.types";
import type { ItemStatus, UploaderItem, UploaderPlan, UploaderQuestion, UploaderRun, Warning } from "@/types/uploader.types";

// ---- the plan ----------------------------------------------------------------------------------------

/**
 * The brief -> a plan to confirm. The agent parses it when it is on (its own run budget); off, or a
 * failed call, opens the manual form (`emptyPlan`, or what could be salvaged). The last real run's
 * markups fill the ones the brief left empty (`fromPrior`), then the plan is previewed - a failed
 * preview read still hands back the (paid) parse, with `preview: null` and `previewKind`.
 */
export async function parseBrief(brief: string): Promise<ParseBriefResult> {
  const session = await requireAdmin();
  if (typeof brief !== "string" || brief.trim() === "") return fail("bad_input");
  if (brief.length > BRIEF_MAX) return fail("brief_too_long");

  // A paid call: at most PARSE_RATE_MAX per person per PARSE_RATE_WINDOW_MS (`agent.call` rows). A
  // count that cannot be read lets the parse through (logged) - the cap is a brake, not the gate.
  if (agentEnabled(TOUR_UPLOADER_AGENT) && isUuid(session.sub)) {
    const recent = await countRecentParses(session.sub, PARSE_RATE_WINDOW_MS);
    if (parseRateLimited(recent, PARSE_RATE_MAX)) return fail("rate_limited");
  }

  let base: UploaderPlan;
  let planAi: UploaderPlan | null = null;
  let agent: "on" | "off" | "failed";
  let problems: string[] = [];
  try {
    const outcome = await parseBriefWithAgent(brief, newBudget(TOUR_UPLOADER_AGENT), { userId: session.sub });
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
  // The model's plan is signed with its brief: createRun trusts `plan_ai` (the edit lessons) only with it.
  const key = planTokenKey();
  const signed = planAi !== null && key !== null ? { planToken: await planTokenFor(planAi, brief, key) } : {};

  const preview = await previewOf(plan, false);
  if (!preview.ok) return { ok: true, plan, planAi, ...signed, fromPrior, preview: null, previewKind: preview.kind, agent, problems };
  return { ok: true, plan, planAi, ...signed, fromPrior, preview: preview.preview, agent, problems };
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
 * the asker's task, then ONE more task when Hebrew team / artist names are missing. The asker is
 * ALWAYS the session's user (`input.asker_id` is ignored). One run per subject at a time: a run of
 * the same subject still building or waiting -> `run_in_progress`.
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
  // It travelled through the browser: it is used only when `planToken` signs exactly it and this
  // brief (`verifyPlanToken`) - anything else is no model plan (no lessons; the run is still made).
  const rawAi: unknown = input.plan_ai;
  const claimedAi = typeof rawAi === "object" && rawAi !== null && !Array.isArray(rawAi) ? parsePlanInput(rawAi).plan : null;
  const planAi = claimedAi !== null && (await verifyPlanToken(input.planToken, claimedAi, brief, planTokenKey())) ? claimedAi : null;
  if (claimedAi !== null && planAi === null) console.warn("uploader-actions: plan_ai came without a valid signature - kept as no model plan");

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
  let questionTasks = 0;
  for (const draft of drafts) {
    if (!draft.ask) continue;
    const item = byPosition.get(draft.position);
    if (!item?.question) continue;
    const taskId = await raiseQuestion(run, item, item.question);
    if (taskId === null) continue;
    questionTasks += 1;
    if (!(await setQuestion(item.id, { ...item.question, task_id: taskId }))) {
      console.error(`uploader-actions: task ${taskId} of item ${item.id} could not be stored - closing it`);
      await closeTask(taskId, "נכשל");
    }
  }

  // The Hebrew names the run lacks become ONE task (spec 7.1), counted with the question tasks - past
  // the cap the board's run panel is the ask. The build goes on regardless: a failure here is logged and
  // never fails the run (`names_task_id` stays null). Judged on the RESOLVED subject, the one the build
  // names events with (the artist row's Hebrew name wins over the plan's). A task whose id cannot be
  // stored on the run is closed again at once, like a question's.
  if (questionTasks < MAX_QUESTION_TASKS_PER_RUN) {
    try {
      // A skipped show (exists / rejected_before / skipped by an earlier answer) is never built; a question one may be.
      const missing = missingHebrewNames(
        items.filter((i) => i.status !== "skipped"),
        subject,
        resolved.teamsHe,
      );
      if (missing.length > 0) {
        const namesTaskId = await openNamesTask(run, missing);
        if (namesTaskId !== null && !(await writeNamesTaskId(run.id, namesTaskId))) {
          console.error(`uploader-actions: names task ${namesTaskId} of run ${run.id} could not be stored - closing it`);
          await closeTask(namesTaskId, "נכשל");
        }
      }
    } catch (e) {
      console.error(`uploader-actions: names task of run ${run.id} failed`, errorText(e));
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
  // One run per subject at a time - the rule createRun keeps, kept on resume too (a stopped run is
  // not "in progress", so another run of its subject may have started meanwhile).
  const busy = await runInProgressFor(run.plan, run.id);
  if (busy === null) return fail("db_error");
  if (busy) return fail("run_in_progress");
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

/** The board's blocker on a ready item whose event was soft deleted (or is gone) - never stored. */
const EVENT_GONE_BLOCKER = { code: "event_gone", text: "האירוע נמחק" } as const;

/**
 * The board: the run, its items (soonest first; a ready item's blockers re-judged against its live
 * event row - a deleted event blocks it, "האירוע נמחק"), which built events staff already edited
 * (unknown when that read failed - `editedUnknown`), the people an answer can name (skipped with
 * `{ people: false }` - `peopleOmitted`), and the subject's own picture (one light read).
 * null = no such run; `{ run: null, kind: "db_error" }` = a read failed.
 */
export async function getRun(runId: string, opts?: { people?: boolean }): Promise<RunView | null> {
  await requireAdmin();
  if (!isUuid(runId)) return null;
  // The board's polls pass `{ people: false }`: the staff list is read once per board, not per poll.
  const withPeople = !(typeof opts === "object" && opts !== null && opts.people === false);
  const { run, failed } = await readRun(runId);
  if (failed) return { run: null, kind: "db_error" };
  if (!run) return null;
  const stored = await readRunItems(runId);
  if (stored === null) return { run: null, kind: "db_error" };

  const rows = await readEditRows([...new Set(stored.filter(hasBuiltEvent).map((i) => i.event_id))]);
  const edited: Record<string, boolean> = {};
  // A person arranged this show's TixStock tickets in the editor (zones / descriptions / categories): the panel offers "learn from it".
  const fixedByHand: Record<string, boolean> = {};
  const items = stored.map((item) => {
    if (rows === null || !hasBuiltEvent(item)) return item;
    const row = rows.get(item.event_id) ?? null;
    edited[item.id] = editDiff(item.payload, row).length > 0;
    fixedByHand[item.id] = ticketsFixedByHand(item.payload, row);
    // Deleted (or gone) meanwhile: not approvable - approve would answer `event_gone` anyway.
    if (!row) return { ...item, blockers: [...(item.blockers ?? []), EVENT_GONE_BLOCKER] };
    return { ...item, blockers: liveBlockers(item.blockers, row) };
  });
  const [people, subjectArt, missingNames] = await Promise.all([
    withPeople ? loadPeople() : Promise.resolve([]),
    readSubjectArt(run.plan),
    missingNamesOf(run, stored),
  ]);
  return { run, items, edited, editedUnknown: rows === null, people, ...(withPeople ? {} : { peopleOmitted: true as const }), subjectArt, fixedByHand, missingNames };
}

/**
 * The Hebrew names the run still lacks - the panel's names row (spec 5.1, ruling R2) - judged on the run's
 * CACHED subject: the board polls, so never a fresh resolve, and a cache of any age will do for a list on
 * screen (it is judged as of when it was written). A skipped show is never built, so its sides are not
 * asked about. [] when there is no readable cache - the board never fails for it.
 */
async function missingNamesOf(run: UploaderRun, items: UploaderItem[]): Promise<string[]> {
  try {
    const raw = await readSubjectCache(run.id);
    const writtenAt = isRecord(raw) && typeof raw.at === "string" ? Date.parse(raw.at) : NaN;
    if (!Number.isFinite(writtenAt)) return [];
    const cache = freshSubjectCache(raw, writtenAt);
    if (!cache) return [];
    const subject = { kind: run.plan.subject.kind, name_en: run.plan.subject.name_en, name_he: cache.subject.name_he };
    return missingHebrewNames(
      items.filter((i) => i.status !== "skipped"),
      subject,
      cache.teamsHe,
    );
  } catch (e) {
    console.error(`uploader-actions: missing names of run ${run.id} failed`, errorText(e));
    return [];
  }
}

// ---- questions ---------------------------------------------------------------------------------------

/**
 * A person answers an open question: the answer is recorded on the item (who / when), the item is
 * re-queued for the build (`found`) - or skipped on "skip", or split into one item per show on
 * "both" - the task closes, and the answer is audited (`uploader.answered`, what the agent learns).
 * A "both" inserts its extra items FIRST; if that fails nothing is saved (`split_failed`, the item
 * still asks), and if the answer cannot be saved after it, the extra items are taken back.
 *
 * `applyToSimilar` ("החל גם על N השאלות הדומות בריצה", spec 5.4 / 7): after this item's own answer, the
 * rule it makes (`runRuleOf`) answers every other open question of the run that `applyRuleTo` fits, in
 * board order, through the same per-item path (each audited with `rule_applied: true`), stopping at the
 * first database failure - what was answered stays answered. This item's own audit row is written last
 * and carries `rule_applied: true, applied: n` when the rule answered any. `applied` = how many more.
 */
export async function answerQuestion(
  itemId: string,
  answer: { key: string | null; text: string | null },
  opts?: { applyToSimilar?: boolean },
): Promise<Ok & { applied?: number }> {
  const session = await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  const clean = cleanAnswerInput(answer);
  if (clean === null) return fail("bad_input");
  if (opts !== undefined && !isRecord(opts)) return fail("bad_input");
  const toSimilar = opts?.applyToSimilar === true;

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  const own = await answerOne(item, run, clean, session.sub);
  if (!own.ok) return own;

  const rule = toSimilar && item.question ? runRuleOf(item.question, item, clean) : null;
  let applied = 0;
  if (rule) {
    const open = await readRunItems(run.id, "question");
    if (open === null) console.error(`uploader-actions: open questions of run ${run.id} not read - the rule answered no other question`);
    for (const other of open ?? []) {
      if (other.id === item.id) continue;
      const key = applyRuleTo(rule, other);
      if (key === null) continue;
      const done = await answerOne(other, run, { key, text: null }, session.sub);
      if (!done.ok) {
        // A database failure stops the rule (what was answered stays answered); a question answered meanwhile is passed by.
        if (done.kind === "db_error" || done.kind === "split_failed") break;
        continue;
      }
      await logAnswered(done.audit, { rule_applied: true });
      applied += 1;
    }
  }
  await logAnswered(own.audit, applied > 0 ? { rule_applied: true, applied } : {});
  await recomputeRun(run.id);
  const reach = toSimilar ? { applied } : {};
  // The answer is saved either way; `task_not_closed` says this item's task did not close with it.
  return own.taskClosed ? { ok: true, ...reach } : { ...fail("task_not_closed"), ...reach };
}

/** An answer written: whether its task closed, and the `uploader.answered` row to audit (the caller adds the rule fields). */
type Answered = { ok: true; taskClosed: boolean; audit: { itemId: string; metadata: Record<string, unknown> } };

/**
 * One question answered - the per-item path `answerQuestion` runs for its own item and for every question
 * a rule for the run answers: the answer checked against the stored question, written (re-queue / skip /
 * split), the task closed. Writes no audit row (returned, so the first item's row can carry the rule's reach).
 */
async function answerOne(item: UploaderItem, run: UploaderRun, clean: AnswerInput, actorId: string): Promise<Answered | { ok: false; kind: string }> {
  const q = item.question;
  if (item.status !== "question" || q === null) return fail("not_question");
  const fit = checkAnswer(q, clean);
  if (!fit.ok) return fail("bad_answer");

  const stored: StoredAnswer = { key: clean.key, text: clean.text, by: actorId, at: nowIso() };
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
  return {
    ok: true,
    taskClosed,
    audit: {
      itemId: item.id,
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
    },
  };
}

async function logAnswered(audit: Answered["audit"], rule: { rule_applied?: true; applied?: number }): Promise<void> {
  await logAudit({ action: "uploader.answered", entityType: "uploader_item", entityId: audit.itemId, metadata: { ...audit.metadata, ...rule } });
}

/**
 * "נסה שוב": an `error` item - or a build cut off mid-way (`building` past STALE_BUILD_MS) - goes
 * back to `found` (error cleared) for the build loop. Its `event_id` is kept as it is: a build cut
 * off (or failed) after `createEvent` left that hidden event, and the rebuild soft-deletes it first
 * (`cleanOwnEvent`, audit `uploader.orphan_cleaned`) before it builds again - never a second event.
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
  const marked = await markApproved(session.sub, run, item, listed);
  // The event is listed whatever the record said - it is re-checked and the site refreshed either way.
  await boundedRecheck([listed.eventId], APPROVE_SYNC_MS);
  await revalidateMain();
  invalidatePriceLight("rows");
  await recomputeRun(run.id);
  // `not_ready` AFTER a successful un-hide = the item moved meanwhile (another click approved it):
  // the event IS listed, so this is no failure - say so instead of a red "not approved".
  if (!marked.ok && marked.kind === "not_ready") return { ok: true, edited: editDiff(item.payload, listed.before).length > 0, note: "moved" };
  return marked;
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

  let recheck: Awaited<ReturnType<typeof boundedRecheck>> = "done";
  if (eventIds.length > 0) {
    recheck = await boundedRecheck(eventIds, Math.min(APPROVE_SYNC_MS, APPROVE_ALL_DEADLINE_MS - (Date.now() - started)));
    await revalidateMain();
    invalidatePriceLight("rows");
  }
  await recomputeRun(runId);
  // Every approval stands; only the re-check found no time left (logged) - the next price sync does it.
  return recheck === "skipped" ? { approved, failed, kind: "recheck_skipped" } : { approved, failed };
}

/**
 * The item's built event soft deleted before a reject / rebuild changes the item: null = done (or
 * nothing to delete); `event_live` = the event is LISTED (approved meanwhile) and was not touched;
 * `event_not_deleted` = the delete failed. Either refusal changes nothing.
 */
async function removeBuiltEvent(eventId: number | null): Promise<{ ok: false; kind: string } | null> {
  if (eventId === null) return null;
  const outcome = await softDeleteBuiltEvent(eventId);
  if (outcome === "event_live") return fail("event_live");
  if (outcome === "failed") return fail("event_not_deleted");
  return null;
}

/**
 * Reject a show: its hidden event is soft deleted FIRST, and only while it is still hidden (a failure
 * answers `event_not_deleted`, a LISTED event `event_live` - both change nothing; a surviving hidden
 * event would block the next run as `exists`), then the item
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
  // Read again right before the delete: an approve (or a build) that landed since the first read
  // must stop the reject here, not after its event is gone.
  const fresh = await readItem(item.id);
  if (fresh.failed) return fail("db_error");
  if (!fresh.item || !REJECTABLE_STATUSES.includes(fresh.item.status)) return fail("not_rejectable");
  const removed = await removeBuiltEvent(fresh.item.event_id);
  if (removed) return removed;

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
 * with the venue city - and never through a city farther than FAR_VENUE_KM from the venue (`too_far`).
 * The ticket-only event is soft deleted FIRST, only while still hidden (failure -> `event_not_deleted`,
 * a listed event -> `event_live`, nothing changed); then the item is re-queued with the choice on its
 * show (`two_city`).
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
  // The offer names the item's nearest location within FAR_VENUE_KM; a hand-picked id must not fly a
  // package to a city on another continent from this venue.
  if (km > FAR_VENUE_KM) return fail("too_far");

  // Read again right before the delete (an approve may have landed since the first read).
  const fresh = await readItem(item.id);
  if (fresh.failed) return fail("db_error");
  if (!fresh.item || fresh.item.status !== item.status || !canRebuildTwoCity(fresh.item)) return fail("not_rebuildable");
  const removed = await removeBuiltEvent(fresh.item.event_id);
  if (removed) return removed;
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

// ---- round "אלון 1": a venue's tickets classified, or learned from one event -------------------------
//
// Spec 5.2 / 5.5 / 6.3 / 6.5. The rules are pure in lib/uploader/classify.ts; the template is written
// through the venue-map actions (`saveVenueZones`, `rememberSupplierCategories`, `adoptVenueMap`), the
// events and items through lib/services/uploader-store.ts. Order of writes, always: the template, then
// the events, then the items (their payload follows the event, so approve never reads the classification
// as a staff edit), then the audit rows, then one site refresh. Nothing here writes a price.

/** A drawing url longer than this is no TixStock S3 url. */
const SOURCE_URL_MAX = 2_000;
/** Most rows a classification / names confirm may carry (a big stadium has 40-80 categories). */
const CONFIRM_ROWS_MAX = 300;
/**
 * A classification (or a learn) stops STARTING event rewrites this long after the action began (the board
 * page's maxDuration is 60 s): the rest are `reached < total`, and a second confirm finishes them.
 */
const REWRITE_BUDGET_MS = 40_000;
/** What reaches the model is capped: a category name, a stored zone label, a show-title hint, a supplier name. */
const AI_CATEGORY_MAX = 80;
const AI_LABEL_MAX = 40;
const AI_HINT_MAX = 120;
const AI_NAME_MAX = 80;
/** Hebrew zone labels of other venues the classification call sees, for its voice. */
const STYLE_EXAMPLES_MAX = 6;
/** What a classification / rename rewrites: built shows, hidden or approved. */
const REWRITTEN_STATUSES: ItemStatus[] = ["ready", "approved"];
/** The venue warnings a classification decides afresh. */
const VENUE_WARNINGS = new Set(["new_venue", "unzoned_tickets", "unzoned_review", "all_dropped"]);
/** The warnings that say the subject has no page of its own. */
const NO_PAGE_WARNINGS = new Set(["no_team_page", "no_artist_page"]);
const HEBREW_LETTER = /[א-ת]/;
const EMPTY_DROPPED: DroppedCategories = { dropped: [], kept: [] };

type Refusal = { ok: false; kind: string; message?: string };
type BuiltItem = UploaderItem & { event_id: number };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const cutText = (s: string, max: number): string => s.trim().slice(0, max).trim();
const uniqueTexts = (xs: string[]): string[] => [...new Set(xs)];

/** The show's TixStock drawing url, or null (a LiveTickets-only show, or TixStock without a seat map). */
function drawingUrlOf(item: UploaderItem): string | null {
  const url = item.show.suppliers.tixstock?.venue_map_url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
}

/** A show a classification or a rename rewrites: ready or approved, pointing at its event. */
function isRewritable(item: UploaderItem): item is BuiltItem {
  return REWRITTEN_STATUSES.includes(item.status) && typeof item.event_id === "number";
}

/** A supplier drawing url the board may name: text, not absurdly long, on the host a drawing is read from. */
function isDrawingUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= SOURCE_URL_MAX && isAdoptableHost(v);
}

/**
 * The per-person cap on the agent's paid calls (`PARSE_RATE_MAX` per `PARSE_RATE_WINDOW_MS`, shared with
 * the parse), checked BEFORE anything else an AI dialog does. A dialog never fails for the AI's sake (spec
 * 5.2, ruling R13): a reason here means "skip the model call, open the rows for a manual fill" -
 * `rate_limited` = over the cap; `error` = the count could not be read (spending fails closed). null = the
 * call may be made. Not checked while the agent is off - no call is made then.
 */
async function aiSkipReason(userId: string): Promise<"rate_limited" | "error" | null> {
  if (!agentEnabled(TOUR_UPLOADER_AGENT)) return null;
  const recent = await countRecentParses(userId, PARSE_RATE_WINDOW_MS);
  if (recent === null) return "error";
  return recent >= PARSE_RATE_MAX ? "rate_limited" : null;
}

/** A thrown database error's message (a PostgREST error is a plain object, not an `Error`). */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return String(e);
}

const templateLikeOf = (row: VenueTemplateRow | null): TemplateLike | null =>
  row ? { zones: row.zones, supplier_categories: row.supplier_categories } : null;

/** The label the stored template already gives a key, when its mapping points at a zone that exists. */
function storedLabel(template: TemplateLike | null, key: string): string | null {
  const zoneId = template?.supplier_categories.tixstock?.[key];
  const zone = zoneId ? template?.zones.find((z) => z.id === zoneId) : undefined;
  return zone?.label?.trim() || null;
}

/** The TixStock tickets' category key -> name ("longside lower tier" -> "Longside Lower Tier"), first spelling wins. */
function tixstockCategoryNames(tickets: EventTicket[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const t of tickets) {
    if (ticketSupplier(t, "tx_event") !== "tixstock") continue;
    const name = (t.supplierCategory || t.category || "").trim();
    const key = normalizeSupplierCategory(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  return names;
}

/** A stored `payload.tickets_and_rates` (what the build wrote) as tickets; anything unreadable is none. */
function payloadTickets(payload: Record<string, unknown> | null): EventTicket[] {
  const raw = payload?.tickets_and_rates;
  return Array.isArray(raw) ? raw.filter((t): t is EventTicket => isRecord(t) && typeof t.category === "string") : [];
}

/** The venue's drawing: our own copy when it has a template (`getVenueMapDrawing`), else - or when ours cannot be read - the supplier's. */
async function venueSvg(sourceUrl: string | null, template: VenueTemplateRow | null): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  if (template) {
    const ours = await getVenueMapDrawing(template.id);
    if (ours.ok) return { ok: true, svg: ours.data.svg };
    console.error(`uploader-actions: venue map ${template.id} drawing not read (${ours.error}) - trying the supplier's`);
  }
  if (sourceUrl && isAdoptableHost(sourceUrl)) return fetchSupplierSvg(sourceUrl);
  return { ok: false, error: "The venue drawing could not be read" };
}

/**
 * The dialog's categories = the union of the drawing's (document order) and the TixStock categories on the
 * venue's built events (`shows` = on how many of them), each once by key. A drawing category takes the
 * supplier's own spelling when a ticket carries it ("Longside Lower Tier", not "longside lower tier").
 */
function venueCategories(drawing: DrawingCategory[], targets: BuiltItem[], events: Map<number, EventTicketsRow>): CategoryInput[] {
  const shows = new Map<string, number>();
  const names = new Map<string, string>();
  for (const item of targets) {
    const row = events.get(item.event_id);
    if (!row) continue;
    for (const [key, name] of tixstockCategoryNames(row.tickets_and_rates)) {
      shows.set(key, (shows.get(key) ?? 0) + 1);
      if (!names.has(key)) names.set(key, name);
    }
  }
  const onMap = new Set(drawing.map((d) => d.key));
  return [
    ...drawing.map((d) => ({ category: names.get(d.key) ?? d.category, key: d.key, sections: [...d.sections], shows: shows.get(d.key) ?? 0 })),
    ...[...names].filter(([key]) => !onMap.has(key)).map(([key, name]) => ({ category: name, key, sections: [], shows: shows.get(key) ?? 0 })),
  ];
}

/** One venue of a run, as the classification dialog and its confirm read it. */
type VenueContext = {
  run: UploaderRun;
  name: string;
  city: string | null;
  /** What a confirm rewrites: the venue's ready / approved shows whose event is still there, board order. */
  targets: BuiltItem[];
  events: Map<number, EventTicketsRow>;
  template: VenueTemplateRow | null;
  drawing: DrawingCategory[];
  categories: CategoryInput[];
};

/**
 * The run, its shows at this drawing (the url must be one of THIS run's drawings - the board names the
 * venue, the run's own items vouch for it, else `not_found`), the venue's template, its drawing (`svg_failed`
 * when it cannot be read) and the built events' tickets. Read-only.
 */
async function readVenueContext(runId: string, sourceUrl: string): Promise<VenueContext | Refusal> {
  const { run, failed } = await readRun(runId);
  if (failed) return fail("db_error");
  if (!run) return fail("not_found");
  const items = await readRunItems(runId);
  if (items === null) return fail("db_error");
  const atVenue = items.filter((i) => drawingUrlOf(i) === sourceUrl);
  if (atVenue.length === 0) return fail("not_found");

  const template = await readVenueTemplate(sourceUrl);
  if (template.failed) return fail("db_error");
  const svg = await venueSvg(sourceUrl, template.row);
  if (!svg.ok) return { ok: false, kind: "svg_failed", message: svg.error };

  const built = atVenue.filter(isRewritable);
  const events = await readEventTickets(built.map((i) => i.event_id));
  if (events === null) return fail("db_error");
  const targets = built.filter((i) => events.has(i.event_id));
  const drawing = drawingCategories(svg.svg);
  return {
    run,
    name: atVenue.map((i) => i.show.venue?.trim()).find((v): v is string => !!v) ?? atVenue[0].show.city,
    city: atVenue[0].show.city?.trim() || null,
    targets,
    events,
    template: template.row,
    drawing,
    categories: venueCategories(drawing, targets, events),
  };
}

/**
 * The rows the dialog SHOWED (`proposalRows`' output keyed by key, as the confirm hands them back - rulings
 * R5 / R6), checked field by field: a key outside the venue's is ignored, text is cut to the caps, a drop
 * keeps its reason only when it is one of ours. null = the dialog carried none; undefined = not a record.
 */
function shownRows(raw: unknown, allowed: Set<string>): Map<string, ProposedRow> | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return undefined;
  const out = new Map<string, ProposedRow>();
  for (const [name, entry] of Object.entries(raw)) {
    const key = normalizeSupplierCategory(name);
    if (!allowed.has(key) || out.has(key) || !isRecord(entry)) continue;
    const drop = entry.drop === true;
    const reason = entry.drop_reason === "away" || entry.drop_reason === "other" ? entry.drop_reason : null;
    out.set(key, {
      label_he: typeof entry.label_he === "string" ? cutText(entry.label_he, ZONE_LABEL_MAX) : "",
      description_he: cleanZoneDescription(entry.description_he) ?? "",
      drop,
      drop_reason: drop ? reason : null,
      unsure: entry.unsure === true,
    });
  }
  return out;
}

/** The template as written: what the rewrite zones and drops by, and the map url every rewritten event points at. */
type AppliedTemplate = { id: string; svgUrl: string; zones: VenueZone[]; supplier_categories: SupplierCategoryMap; dropped: DroppedCategories };

/**
 * Spec 6.3 step 1 over an existing row: the zone list REPLACED (`saveVenueZones` - unsure / dropped
 * categories lose their zone, the drawing is republished), the TixStock mapping merged with the forgotten
 * keys mapped to "" (`rememberSupplierCategories`), then `dropped_categories` replaced. The first failure
 * stops it - nothing of the events has been touched yet.
 */
async function writeTemplate(id: string, update: TemplateUpdate): Promise<{ ok: true; template: AppliedTemplate } | Refusal> {
  const saved = await saveVenueZones(id, update.zones);
  if (!saved.ok) return { ok: false, kind: "db_error", message: saved.error };
  const mapping = { ...update.categoryToZone, ...Object.fromEntries(update.forget.map((key) => [key, ""])) };
  const remembered = await rememberSupplierCategories(id, "tixstock", mapping);
  if (!remembered.ok) return { ok: false, kind: "db_error", message: remembered.error };
  if (!(await writeDroppedCategories(id, update.dropped, update.kept))) return fail("db_error");
  const svgUrl = saved.data.svg_url;
  if (!svgUrl) return { ok: false, kind: "db_error", message: "The venue map has no published drawing" };
  return {
    ok: true,
    template: { id, svgUrl, zones: saved.data.zones, supplier_categories: remembered.data, dropped: { dropped: update.dropped, kept: update.kept } },
  };
}

/**
 * A show's warnings once its tickets were classified (ruling R9): the venue warnings decided afresh - none
 * when every ticket has a zone, else `unzoned_review` naming the categories still without one.
 */
function classifiedWarnings(prior: Warning[], unzoned: string[], total: number): Warning[] {
  const kept = prior.filter((w) => !VENUE_WARNINGS.has(w.code));
  if (unzoned.length === 0) return kept;
  const categories = uniqueTexts(unzoned.map((c) => c.trim()).filter((c) => c !== ""));
  return [...kept, warning("unzoned_review", { count: unzoned.length, total, categories: categories.join(", ") }, undefined, { categories })];
}

type Rewrite = { eventIds: number[]; reached: number; live: boolean; itemsFailed: number };

/**
 * Spec 6.3 steps 2-3 over the venue's shows, in board order. Step 2: each event's tickets dropped and zoned
 * by the template (`applyClassification`) and written with the template's map - one UPDATE of those two
 * columns; a show whose tickets would ALL be dropped is not written (its card gets `all_dropped`, ruling
 * R12). It stops at the first failed event write, or past REWRITE_BUDGET_MS: `reached` = how many shows it
 * got through. Step 3: each item reached follows its event - venue warnings, the `classified` decision and
 * `payload.tickets_and_rates` / `payload.map_image_url` = what was written - so approve's edit diff never
 * reads the classification as a staff edit. An item write that fails is counted (`itemsFailed`).
 */
async function rewriteVenueItems(targets: BuiltItem[], events: Map<number, EventTicketsRow>, template: AppliedTemplate, started: number): Promise<Rewrite> {
  const tpl: TemplateLike = { zones: template.zones, supplier_categories: template.supplier_categories };
  const patches: { item: BuiltItem; patch: Record<string, unknown> }[] = [];
  const eventIds: number[] = [];
  let reached = 0;
  let live = false;

  for (const item of targets) {
    if (Date.now() - started > REWRITE_BUDGET_MS) break;
    const row = events.get(item.event_id);
    if (!row) {
      reached += 1;
      continue;
    }
    const applied = applyClassification(row.tickets_and_rates, tpl, template.dropped);
    if (applied.tickets.length === 0) {
      // The event is NOT rewritten, so its venue warnings stand as they are: `all_dropped` is only added (once).
      patches.push({ item, patch: { warnings: [...item.warnings.filter((w) => w.code !== "all_dropped"), warning("all_dropped")] } });
      reached += 1;
      continue;
    }
    if (!(await writeEventClassification(item.event_id, applied.tickets, template.svgUrl))) break;
    reached += 1;
    eventIds.push(item.event_id);
    if (item.status === "approved" || !row.is_hidden) live = true;
    const zones = new Set(applied.tickets.map((t) => t.zoneId).filter((z): z is string => !!z)).size;
    patches.push({
      item,
      patch: {
        warnings: classifiedWarnings(item.warnings, applied.unzoned, applied.tickets.length),
        decisions: [
          ...item.decisions.filter((d) => d.code !== "classified"),
          decision("classified", { zones, dropped: applied.dropped.length, unsure: uniqueTexts(applied.unzoned).length }),
        ],
        ...(item.payload ? { payload: { ...item.payload, tickets_and_rates: applied.tickets, map_image_url: template.svgUrl } } : {}),
      },
    });
  }

  let itemsFailed = 0;
  for (const { item, patch } of patches) {
    const written = await transitionItem(item.id, REWRITTEN_STATUSES, patch);
    if (written === "db_error") itemsFailed += 1;
    else if (written === "moved") console.warn(`uploader-actions: item ${item.id} left ready / approved meanwhile - its classification was not recorded on it`);
  }
  return { eventIds, reached, live, itemsFailed };
}

/**
 * `uploader.classify_changed`, one row per change - the classification call's lessons. A drop row (a drop or
 * an un-drop) carries `reason` = the ORIGINAL drop reason (ruling R10): the shown row's `drop_reason`, else
 * "away" when the code rule drops the key, else "other".
 */
async function logClassifyChanges(
  run: UploaderRun,
  venue: string,
  changes: { category: string; field: string; from: unknown; to: unknown }[],
  shown: Map<string, ProposedRow> | null = null,
): Promise<void> {
  for (const change of changes) {
    const key = normalizeSupplierCategory(change.category);
    const original = shown?.get(key)?.drop_reason ?? (dropRule(key).drop ? "away" : "other");
    const reason = change.field === "drop" ? { reason: original } : {};
    await logAudit({
      action: "uploader.classify_changed",
      entityType: "uploader_run",
      entityId: run.id,
      metadata: { agent: AGENT, run_id: run.id, venue, category: change.category, field: change.field, from: change.from, to: change.to, ...reason },
    });
  }
}

/** Spec 6.3 step 5: the site once when a live event changed, the price light's list when any event did. */
async function refreshAfterRewrite(rewrite: { eventIds: number[]; live: boolean }): Promise<void> {
  if (rewrite.live) await revalidateMain();
  if (rewrite.eventIds.length > 0) invalidatePriceLight("rows");
}

/** The confirm's answer: an item that could not be recorded makes it a `db_error` (a second confirm is a no-op merge that records it). */
function rewriteResult(rewrite: Rewrite, total: number, counts: { zones: number; dropped: number; unsure: number }): ClassifyResult {
  if (rewrite.itemsFailed > 0) {
    return { ok: false, kind: "db_error", message: `${rewrite.eventIds.length} events were rewritten, but ${rewrite.itemsFailed} show(s) could not be saved - confirm again` };
  }
  return { ok: true, events: rewrite.eventIds.length, reached: rewrite.reached, total, ...counts };
}

/**
 * The classification dialog opens: the venue's categories (the drawing's and the built events' tickets),
 * the stored template's labels, the code rule's drops, and - when a category the venue does not drop is
 * not labelled by the template yet - the agent's proposal (`classify_venue`; the labelled ones ride along
 * as `existingLabel`, the dropped ones are never asked about). The per-person AI cap is checked first; the
 * dialog never fails for the AI's sake (spec 5.2, ruling R13): AI off, the cap, an unreadable count, a
 * timeout or a bad answer = the rows open empty (`ai.reason`), the rule's drops applied. `proposed` = the
 * model's raw proposal; the confirm sends back the rows as SHOWN (`rows`).
 */
export async function proposeVenueClassification(runId: string, sourceUrl: string): Promise<ProposeResult> {
  const session = await requireAdmin();
  if (!isUuid(runId) || !isDrawingUrl(sourceUrl)) return { ok: false, kind: "bad_input" };
  const skip = await aiSkipReason(session.sub);

  const ctx = await readVenueContext(runId, sourceUrl);
  if ("kind" in ctx) {
    const kind = ctx.kind === "svg_failed" || ctx.kind === "not_found" ? ctx.kind : "db_error";
    return { ok: false, kind, ...(ctx.message ? { message: ctx.message } : {}) };
  }
  const template = templateLikeOf(ctx.template);
  const dropped = ctx.template?.dropped ?? EMPTY_DROPPED;
  // What the venue drops - its own list and the code rule, minus what a person kept - is decided: never asked again.
  const kept = new Set(dropped.kept);
  const venueDrops = (key: string): boolean => !kept.has(key) && (dropped.dropped.includes(key) || dropRule(key).drop);
  const askable = ctx.categories.filter((c) => !venueDrops(c.key));

  let proposed: Map<string, ProposedRow> | null = null;
  let ai: { used: boolean; reason: string | null; problems: string[] } = { used: false, reason: "not_needed", problems: [] };
  const needsProposal = askable.some((c) => storedLabel(template, c.key) === null);
  if (needsProposal && skip) {
    ai = { used: false, reason: skip, problems: [] };
  } else if (needsProposal) {
    // A key too long to hand over whole is not asked about (its row opens for review): a cut name would not map back to it.
    const asked = askable.filter((c) => c.key.length <= AI_CATEGORY_MAX);
    const styleExamples = (await readStyleLabels(sourceUrl, STYLE_EXAMPLES_MAX)).slice(0, STYLE_EXAMPLES_MAX).map((l) => cutText(l, AI_LABEL_MAX));
    const label = (key: string): string | null => {
      const stored = storedLabel(template, key);
      return stored ? cutText(stored, AI_LABEL_MAX) : null;
    };
    const outcome = await classifyVenueWithAgent(
      {
        venue: cutText(ctx.name, AI_CATEGORY_MAX),
        city: ctx.city ? cutText(ctx.city, AI_CATEGORY_MAX) : null,
        subject: cutText(ctx.run.plan.subject.name_en, AI_NAME_MAX),
        kind: ctx.run.plan.subject.kind,
        categories: asked.map((c) => ({
          category: c.category.length <= AI_CATEGORY_MAX ? c.category : c.key,
          key: c.key,
          sections: c.sections,
          shows: c.shows,
          existingLabel: label(c.key),
        })),
        styleExamples,
      },
      newBudget(TOUR_UPLOADER_AGENT),
      { userId: session.sub },
    );
    if (outcome.ok) {
      proposed = outcome.rows;
      ai = { used: true, reason: null, problems: outcome.problems };
    } else {
      ai = { used: false, reason: outcome.kind, problems: outcome.problems };
    }
  }

  return {
    ok: true,
    venue: { name: ctx.name, sourceUrl, templateId: ctx.template?.id ?? null },
    rows: proposalRows(ctx.categories, proposed, template, dropped),
    proposed: proposed ? Object.fromEntries(proposed) : null,
    shows: ctx.targets.length,
    ai,
  };
}

/**
 * The classification dialog's confirm (spec 6.3). `input = { rows, proposed, ai }`: `rows` = the confirmed
 * rows (`cleanConfirmedRows` against the venue's categories, re-read here - nothing about the venue is taken
 * from the client), `proposed` = the rows as the dialog SHOWED them (null = it carried none), `ai` = whether
 * the dialog opened with the agent's proposal (recorded on `uploader.classified`, ruling R14). A venue
 * category the rows leave out is UNSURE (ruling R16): forgotten unless the template already labels it in
 * Hebrew. In order:
 * 1. the template - adopted first when the venue has none (`adopt_failed` stops here, nothing written),
 *    then its zones, mapping and dropped list written;
 * 2-3. the venue's events rewritten and their items following (`rewriteVenueItems`);
 * 4. `uploader.classified` (the record) and one `uploader.classify_changed` per change (the lessons);
 * 5. the site refreshed once when a live event changed, the price light's list when any did.
 * `reached < total` = the time budget or a failed event write stopped it - a second confirm finishes it.
 */
export async function classifyVenue(runId: string, sourceUrl: string, input: unknown): Promise<ClassifyResult> {
  const started = Date.now();
  await requireAdmin();
  if (!isUuid(runId) || !isDrawingUrl(sourceUrl)) return fail("bad_input");
  if (!isRecord(input) || !Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > CONFIRM_ROWS_MAX) return fail("bad_input");
  if (input.proposed !== undefined && input.proposed !== null && !isRecord(input.proposed)) return fail("bad_input");
  if (typeof input.ai !== "boolean") return fail("bad_input");
  const aiShown = input.ai;

  const ctx = await readVenueContext(runId, sourceUrl);
  if ("kind" in ctx) return ctx;
  const allowed = new Set(ctx.categories.map((c) => c.key));
  const confirmed = cleanConfirmedRows(input.rows, allowed);
  if (confirmed === null || confirmed.length === 0) return fail("bad_input");
  const shown = shownRows(input.proposed, allowed);
  if (shown === undefined) return fail("bad_input");

  // 1. The template.
  let base: TemplateLike & { id: string; dropped: DroppedCategories };
  if (ctx.template) {
    base = { id: ctx.template.id, zones: ctx.template.zones, supplier_categories: ctx.template.supplier_categories, dropped: ctx.template.dropped };
  } else {
    const categoryLabels = Object.fromEntries(
      confirmed.filter((r) => !r.drop && !r.unsure && r.label_he !== "").map((r) => [normalizeSupplierCategory(r.category), r.label_he]),
    );
    const adopted = await adoptVenueMap(sourceUrl, ctx.name, { categoryLabels });
    if (!adopted.ok) return { ok: false, kind: "adopt_failed", message: adopted.error };
    base = { id: adopted.data.id, zones: adopted.data.zones, supplier_categories: adopted.data.supplier_categories, dropped: EMPTY_DROPPED };
  }
  const fromRows = templateFromRows(confirmed, ctx.drawing, base, base.dropped);
  // A category the rows left out is unsure: the slug zone a fresh adopt gave it (or any entry without a Hebrew label) goes.
  const update = forgetUnconfirmed(fromRows, base, [...allowed], confirmed);
  const written = await writeTemplate(base.id, update);
  if (!written.ok) return written;

  // 2-3. The events, then their items.
  const rewrite = await rewriteVenueItems(ctx.targets, ctx.events, written.template, started);

  // 4. The record and the lessons.
  const droppedRows = confirmed.filter((r) => r.drop);
  const nameOf = new Map(ctx.categories.map((c) => [c.key, c.category]));
  const unsure = [
    ...confirmed.filter((r) => !r.drop && r.unsure).map((r) => r.category),
    ...update.forget.filter((key) => !fromRows.forget.includes(key)).map((key) => nameOf.get(key) ?? key),
  ];
  await logAudit({
    action: "uploader.classified",
    entityType: "uploader_run",
    entityId: ctx.run.id,
    metadata: {
      agent: AGENT,
      run_id: ctx.run.id,
      venue: ctx.name,
      source_url: sourceUrl,
      categories: allowed.size,
      proposed: shown ? shown.size : null,
      confirmed: confirmed.length,
      dropped: droppedRows.map((r) => r.category),
      kept: update.kept,
      unsure,
      event_ids: rewrite.eventIds,
      ai: aiShown,
    },
  });
  await logClassifyChanges(ctx.run, ctx.name, classificationDiff(shown, confirmed), shown);

  // 5. The site.
  await refreshAfterRewrite(rewrite);
  return rewriteResult(rewrite, ctx.targets.length, { zones: written.template.zones.length, dropped: droppedRows.length, unsure: unsure.length });
}

/** One show a person arranged in the editor, as "learn from this event" reads it. */
type LearnContext = {
  item: BuiltItem;
  run: UploaderRun;
  row: EventTicketsRow;
  template: VenueTemplateRow;
  venueUrl: string;
  venueName: string;
  update: ReturnType<typeof templateFromEvent>;
  /** The venue's OTHER ready / approved shows of the run, board order. */
  siblings: BuiltItem[];
};

/**
 * Spec 6.5 steps 1-2, read-only: the item, its run and its live event row; the venue template by the show's
 * drawing url, else by the event's `map_image_url` (the editor's board adopted the drawing - our `svg_url`);
 * none = `no_template`. The template the event teaches (`templateFromEvent` over the event's tickets, the
 * payload's and the drawing) and the venue's other shows.
 */
async function readLearnContext(itemId: string): Promise<LearnContext | Refusal> {
  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  if (!isRewritable(item)) return fail("not_ready");
  const rows = await readEventTickets([item.event_id]);
  if (rows === null) return fail("db_error");
  const row = rows.get(item.event_id);
  if (!row) return fail("event_gone");

  const drawingUrl = drawingUrlOf(item);
  let template: VenueTemplateRow | null = null;
  for (const url of uniqueTexts([drawingUrl ?? "", row.map_image_url ?? ""]).filter((u) => u.trim() !== "")) {
    const found = await readVenueTemplate(url);
    if (found.failed) return fail("db_error");
    if (found.row) {
      template = found.row;
      break;
    }
  }
  const venueUrl = drawingUrl ?? template?.source_url ?? null;
  if (!template || !venueUrl) return fail("no_template");

  const svg = await venueSvg(venueUrl, template);
  if (!svg.ok) return { ok: false, kind: "svg_failed", message: svg.error };
  const update = templateFromEvent(row.tickets_and_rates, payloadTickets(item.payload), templateLikeOf(template), drawingCategories(svg.svg), template.dropped);

  const items = await readRunItems(run.id);
  if (items === null) return fail("db_error");
  const siblings = items.filter((i): i is BuiltItem => i.id !== item.id && drawingUrlOf(i) === venueUrl && isRewritable(i));
  return { item, run, row, template, venueUrl, venueName: item.show.venue?.trim() || item.show.city, update, siblings };
}

/** "למד מהאירוע הזה" - what the confirm lists before it applies: zones (new ones), dropped categories, descriptions, and how many other shows it rewrites. */
export async function learnPreview(itemId: string): Promise<LearnPreview> {
  await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  const ctx = await readLearnContext(itemId);
  if ("kind" in ctx) return { ok: false, kind: ctx.kind };
  return { ok: true, learned: ctx.update.learned, siblings: ctx.siblings.length };
}

type TaughtChange = { category: string; field: string; from: null; to: string | boolean };

/**
 * What the event taught, as `uploader.classify_changed` rows (`from: null` = by hand): a Hebrew label and a
 * description per zone it touched (once per zone), and each category it dropped. A latin label is not a lesson.
 */
function taughtChanges(before: VenueTemplateRow, update: LearnContext["update"], eventTickets: EventTicket[]): TaughtChange[] {
  const names = tixstockCategoryNames(eventTickets);
  const out: TaughtChange[] = [];
  const seen = new Set<string>();
  for (const [key, zoneId] of Object.entries(update.categoryToZone)) {
    const zone = update.zones.find((z) => z.id === zoneId);
    if (!zone || seen.has(zoneId)) continue;
    seen.add(zoneId);
    const prev = before.zones.find((z) => z.id === zoneId);
    const category = names.get(key) ?? key;
    if (zone.label !== prev?.label && HEBREW_LETTER.test(zone.label)) out.push({ category, field: "label", from: null, to: zone.label });
    if (zone.description && zone.description !== prev?.description) out.push({ category, field: "description", from: null, to: zone.description });
  }
  for (const category of update.learned.dropped) out.push({ category, field: "drop", from: null, to: true });
  return out;
}

/**
 * "למד מהאירוע הזה והחל" (spec 6.5): the venue template updated from the one event a person arranged in the
 * editor (no AI, nothing asked), then spec 6.3 steps 2-5 for the venue's OTHER shows of the run. The source
 * event is not rewritten; its item gets `taught_venue` and its venue warnings decided from its own tickets
 * (so the panel's row goes once nothing is left to classify). Audited `uploader.classified` with
 * `source: "event"` and a `uploader.classify_changed` row per thing it taught. Same answer as `classifyVenue`
 * (`unsure` is always 0 - an event teaches no "for review" rows).
 */
export async function learnFromEvent(itemId: string): Promise<ClassifyResult> {
  const started = Date.now();
  await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  const ctx = await readLearnContext(itemId);
  if ("kind" in ctx) return ctx;
  const events = await readEventTickets(ctx.siblings.map((i) => i.event_id));
  if (events === null) return fail("db_error");
  const targets = ctx.siblings.filter((i) => events.has(i.event_id));

  // 1. The template.
  const written = await writeTemplate(ctx.template.id, ctx.update);
  if (!written.ok) return written;

  // 2-3. The other shows' events, then their items; then the source's item (its event is the source - untouched).
  const rewrite = await rewriteVenueItems(targets, events, written.template, started);
  const own = ctx.row.tickets_and_rates;
  const marked = await transitionItem(ctx.item.id, REWRITTEN_STATUSES, {
    // TixStock tickets only, as `applyClassification` counts them (ruling R17: LiveTickets zoning is the editor's board).
    warnings: classifiedWarnings(
      ctx.item.warnings,
      own.filter((t) => ticketSupplier(t, "tx_event") === "tixstock" && !t.zoneId).map((t) => t.category),
      own.length,
    ),
    decisions: [...ctx.item.decisions.filter((d) => d.code !== "taught_venue"), decision("taught_venue")],
  });
  if (marked === "db_error") rewrite.itemsFailed += 1;

  // 4. The record and the lessons.
  const { learned } = ctx.update;
  await logAudit({
    action: "uploader.classified",
    entityType: "uploader_run",
    entityId: ctx.run.id,
    metadata: {
      agent: AGENT,
      run_id: ctx.run.id,
      venue: ctx.venueName,
      source_url: ctx.venueUrl,
      source: "event",
      event_id: ctx.item.event_id,
      item_id: ctx.item.id,
      zones: learned.zones,
      new_zones: learned.newZones,
      dropped: learned.dropped,
      kept: ctx.update.kept,
      descriptions: learned.descriptions,
      event_ids: rewrite.eventIds,
      ai: false,
    },
  });
  await logClassifyChanges(ctx.run, ctx.venueName, taughtChanges(ctx.template, ctx.update, own));

  // 5. The site.
  await refreshAfterRewrite(rewrite);
  return rewriteResult(rewrite, targets.length, { zones: written.template.zones.length, dropped: learned.dropped.length, unsure: 0 });
}

// ---- round "אלון 1": the Hebrew names ----------------------------------------------------------------
//
// Spec 5.3 / 6.4 / 7.1. Teams (or the artist) are created INACTIVE - no crest, no picture, no taxonomy
// until staff activate them in Templates (decision 2). The rules are pure in lib/uploader/team-names.ts and
// lib/uploader/names.ts.

/** The run, its items, its subject (the cache, resolved and cached when stale), the names it lacks and the rows they are matched against. */
type NamesContext = {
  run: UploaderRun;
  items: UploaderItem[];
  cache: SubjectCache;
  sides: MissingSide[];
  teams: { id: number; name: string; name_english: string | null }[];
  personKind: "team" | "artist";
};

async function readNamesContext(runId: string): Promise<NamesContext | Refusal> {
  const { run, failed } = await readRun(runId);
  if (failed) return fail("db_error");
  if (!run) return fail("not_found");
  const items = await readRunItems(runId);
  if (items === null) return fail("db_error");
  let cache: SubjectCache;
  try {
    cache = await resolvedSubjectOf(run);
  } catch (e) {
    console.error(`uploader-actions: subject of run ${run.id} not resolved`, errorText(e));
    return fail("roster_read_failed");
  }
  const kind = run.plan.subject.kind === "artist" ? "artist" : "team";
  const teams = await readPersonNames(kind === "artist" ? "artists" : "football_teams");
  if (teams === null) return fail("db_error");
  // A skipped show is never built (exists / rejected before / skipped by an answer): its sides are not asked about.
  const sides = missingSides(
    items.filter((i) => i.status !== "skipped"),
    cache.subject,
    cache.teamsHe,
  );
  return { run, items, cache, sides, teams, personKind: kind };
}

/** A supplier name as the model is handed it (capped). */
const aiName = (name: string): string => cutText(name, AI_NAME_MAX);

/** LiveTickets' Hebrew show title for a name - a fixture of that side (any show for the subject / an artist) - capped: the model's spelling hint. */
function namesHints(sides: MissingSide[], items: UploaderItem[], kind: "team" | "artist"): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const side of sides) {
    const key = normalizeName(side.supplier_name);
    const show = items.find((i) => {
      if (!i.show.suppliers.livetickets?.name_heb?.trim()) return false;
      return side.isSubject || kind === "artist" || normalizeName(i.show.home_team) === key || normalizeName(i.show.away_team) === key;
    });
    const heb = show?.show.suppliers.livetickets?.name_heb?.trim();
    if (heb) hints[aiName(side.supplier_name)] = cutText(heb, AI_HINT_MAX);
  }
  return hints;
}

/**
 * The names dialog opens (spec 5.3): every side of the run's shows `teamsHe` does not know (and the subject
 * when it has no page), one `name_teams` call for all of them, the rows (`teamRowsFor`: create / existing /
 * manual), and how many built shows take their Hebrew name from LiveTickets (`liveNamed` - the stored name is
 * English, `eventNames` now answers LiveTickets'). The per-person AI cap is checked first; the dialog never
 * fails for the AI's sake (ruling R13): AI off, the cap, an unreadable count or a failed call = the rows open
 * for a manual fill (`ai.reason`).
 */
export async function proposeTeamNames(runId: string): Promise<NamesProposeResult> {
  const session = await requireAdmin();
  if (!isUuid(runId)) return fail("bad_input");
  const skip = await aiSkipReason(session.sub);
  const ctx = await readNamesContext(runId);
  if ("kind" in ctx) return ctx;
  const { cache, sides, items, personKind: kind } = ctx;

  let proposed: Map<string, ProposedName> | null = null;
  let ai: { used: boolean; reason: string | null; problems: string[] } = { used: false, reason: "not_needed", problems: [] };
  if (sides.length > 0 && skip) {
    ai = { used: false, reason: skip, problems: [] };
  } else if (sides.length > 0) {
    const outcome = await nameTeamsWithAgent(
      { names: uniqueTexts(sides.map((s) => aiName(s.supplier_name))), kind: cache.subject.kind, hints: namesHints(sides, items, kind) },
      newBudget(TOUR_UPLOADER_AGENT),
      { userId: session.sub },
    );
    if (outcome.ok) {
      // Keyed back by the supplier's own spelling - the key `teamRowsFor` reads.
      const byName = new Map<string, ProposedName>();
      for (const side of sides) {
        const row = outcome.rows.get(aiName(side.supplier_name));
        if (row) byName.set(side.supplier_name, row);
      }
      proposed = byName;
      ai = { used: true, reason: null, problems: outcome.problems };
    } else {
      ai = { used: false, reason: outcome.kind, problems: outcome.problems };
    }
  }

  const subject = { name_en: cache.subject.name_en, name_he: cache.subject.name_he };
  const liveNamed = items.filter(isRewritable).filter((i) => {
    const sideNames = withSupplierSpellings(cache.teamsHe, [i.show.home_team, i.show.away_team]);
    const names = eventNames(cache.subject.kind, i.show, subject, sideNames, i.show.suppliers.livetickets?.name_heb ?? null);
    const stored = typeof i.payload?.name === "string" ? i.payload.name : "";
    return names.source === "livetickets" && !HEBREW_LETTER.test(stored);
  }).length;

  return { ok: true, rows: teamRowsFor(sides, proposed, ctx.teams), liveNamed, ai };
}

/** A Postgres unique violation (a taken slug). */
const isUniqueViolation = (e: unknown): boolean => isRecord(e) && e.code === "23505";

/** A new person row as the Templates form leaves an empty one: the two names and the slug, inactive, nothing else. */
function newPersonData(kind: "team" | "artist", row: ConfirmedTeamRow, slug: string): CreatePersonData {
  return {
    slug,
    name: row.name_he,
    name_english: row.name_en,
    preview_text: null,
    image_url: null,
    image_width: null,
    image_height: null,
    art_image_url: null,
    art_color_index: null,
    art_shape_index: null,
    art_image_scale: null,
    art_bg_scale: null,
    art_image_offset_x: null,
    art_image_offset_y: null,
    // `artists` has no logo_url column.
    ...(kind === "team" ? { logo_url: null } : {}),
    bio: null,
    seo_title: null,
    meta_description: null,
    meta_tags: null,
    hero_video_url: null,
    banners: [],
    gallery: [],
    event_gallery: [],
    videos: [],
    is_active: false,
  };
}

/** Create the row inactive (`createFootballTeamInactive` / `createArtistInactive`); a taken slug is tried once more with "-2". */
async function createPersonInactive(kind: "team" | "artist", row: ConfirmedTeamRow): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const create = kind === "artist" ? createArtistInactive : createFootballTeamInactive;
  const slug = slugFor(row.name_en, row.name_he);
  for (const attempt of [slug, `${slug}-2`]) {
    try {
      const created = await create(newPersonData(kind, row, attempt));
      return { ok: true, id: created.id };
    } catch (e) {
      if (attempt === slug && isUniqueViolation(e)) continue;
      console.error(`uploader-actions: ${kind} "${row.name_en}" not created`, messageOf(e));
      return { ok: false, message: messageOf(e) };
    }
  }
  return { ok: false, message: "the slug is taken" };
}

/**
 * The names dialog's confirm (spec 6.4). `rows` are checked against the names the run lacks, re-derived
 * here (`cleanTeamRows` - the shape; then each `existing_id` must be the one `teamRowsFor` itself offers for
 * that name, else `bad_input`). In order:
 * 1. every row not matched to an existing team is created INACTIVE (audit `uploader.team_created` each) -
 *    a row `teamRowsFor` matches to an existing team after all uses it rather than creating a duplicate;
 * 2. the run's subject cache refreshed (`resolveSubject` - which finds an inactive subject row too, ruling
 *    R15), the confirmed teams under the supplier's own spellings too (an existing team by its stored
 *    Hebrew name);
 * 3. every ready / approved show renamed by `eventNames` where it now has a Hebrew name and the stored one is
 *    not a person's own Hebrew edit (`events.name`, `payload.name`, `no_hebrew_name` dropped, decision
 *    `named_he` / `name_from_livetickets`); once the subject has a row, `no_team_page` / `no_artist_page`
 *    leave EVERY item of the run that carries them;
 * 4. the run's names task closed, `uploader.renamed`, the site refreshed once when a live event was renamed.
 */
export async function createTeamsAndRename(runId: string, rows: unknown): Promise<TeamsResult> {
  await requireAdmin();
  if (!isUuid(runId) || !Array.isArray(rows) || rows.length > CONFIRM_ROWS_MAX) return fail("bad_input");
  const ctx = await readNamesContext(runId);
  if ("kind" in ctx) return ctx;
  const { run, items, cache, sides, personKind: kind } = ctx;
  const confirmed = cleanTeamRows(rows, new Set(sides.map((s) => s.supplier_name)));
  if (confirmed === null) return fail("bad_input");

  // Each confirmed row against the name it answers and the row `teamRowsFor` offers for it (normalizeName on both sides).
  const sideByKey = new Map(sides.map((s) => [normalizeName(s.supplier_name), s]));
  const pairs: { row: ConfirmedTeamRow; side: MissingSide }[] = [];
  const asConfirmed = new Map<string, ProposedName>();
  for (const row of confirmed) {
    const side = sideByKey.get(normalizeName(row.supplier_name));
    if (!side) return fail("bad_input");
    pairs.push({ row, side });
    asConfirmed.set(side.supplier_name, { name_en: row.name_en, name_he: row.name_he });
  }
  const offered = new Map(teamRowsFor(pairs.map((p) => p.side), asConfirmed, ctx.teams).map((r) => [normalizeName(r.supplier_name), r]));
  for (const { row } of pairs) {
    const offer = offered.get(normalizeName(row.supplier_name));
    if (row.existing_id !== null && (offer?.status !== "existing" || offer.existing_id !== row.existing_id)) return fail("bad_input");
  }

  // 1. The rows - created inactive, or the existing one used.
  let created = 0;
  for (const { row, side } of pairs) {
    const offer = offered.get(normalizeName(row.supplier_name));
    if (offer?.status === "existing" && offer.existing_id !== null) continue;
    const made = await createPersonInactive(kind, row);
    if (!made.ok) {
      // What was created stays (a second confirm finds it as an existing team); nothing is renamed yet.
      return { ok: false, kind: "db_error", message: `${created} created, then "${row.name_en}" failed: ${made.message}` };
    }
    created += 1;
    await logAudit({
      action: "uploader.team_created",
      entityType: "uploader_run",
      entityId: run.id,
      metadata: { agent: AGENT, run_id: run.id, team_id: made.id, kind, name_he: row.name_he, name_en: row.name_en, from_supplier_name: side.supplier_name },
    });
  }

  // 2. The subject cache refreshed: `resolveSubject` picks the subject among every row that is not deleted
  //    (an inactive one included - ruling R15), so the run's later builds see the new rows and raise no
  //    `no_team_page` / `no_artist_page` again. Each confirmed team also under the supplier's own spelling -
  //    the club rule may not bridge a name a person typed: an existing team by ITS stored Hebrew name, a new
  //    one by the name just given it.
  let fresh: SubjectCache = cache;
  try {
    fresh = { at: nowIso(), ...(await resolveSubject(run.plan)) };
  } catch (e) {
    console.error(`uploader-actions: subject of run ${run.id} not re-resolved - renaming with the cached one`, errorText(e));
  }
  const teamsHe = { ...fresh.teamsHe };
  if (kind !== "artist") {
    for (const { row, side } of pairs) {
      const offer = offered.get(normalizeName(row.supplier_name));
      teamsHe[normalizeName(side.supplier_name)] = offer?.status === "existing" ? offer.name_he : row.name_he;
    }
  }
  const subject = fresh.subject;
  await writeSubjectCache(run.id, { ...fresh, teamsHe });
  const subjectHasRow = pairs.some((p) => p.side.isSubject) || (kind === "artist" ? fresh.rows.artist !== null : fresh.rows.team !== null);

  // 3. The shows renamed.
  const targets = items.filter(isRewritable);
  const current = await readEventTickets(targets.map((i) => i.event_id));
  if (current === null) return { ok: false, kind: "db_error", message: `${created} created; the events were not read - confirm again to rename them` };
  const renamedIds: number[] = [];
  /** The items this loop wrote - the no-page pass below covers every other one. */
  const handled = new Set<string>();
  let live = false;
  let failures = 0;
  for (const item of targets) {
    const row = current.get(item.event_id);
    if (!row) continue;
    const sideNames = withSupplierSpellings(teamsHe, [item.show.home_team, item.show.away_team]);
    const names = eventNames(cache.subject.kind, item.show, subject, sideNames, item.show.suppliers.livetickets?.name_heb ?? null);
    const built = typeof item.payload?.name === "string" ? item.payload.name : null;
    // A Hebrew name a person typed in the editor is theirs: only the built name, or a latin one, is replaced.
    const rename = names.hebrew && names.name !== row.name && (row.name === built || !HEBREW_LETTER.test(row.name));
    let warnings = item.warnings;
    let decisions = item.decisions;
    let payload = item.payload;
    let changed = false;
    if (rename) {
      if (!(await writeEventName(item.event_id, names.name))) {
        failures += 1;
        continue;
      }
      renamedIds.push(item.event_id);
      if (item.status === "approved" || !row.is_hidden) live = true;
      payload = payload ? { ...payload, name: names.name } : payload;
      decisions = [
        ...decisions.filter((d) => d.code !== "named_he" && d.code !== "name_from_livetickets"),
        names.source === "livetickets" ? decision("name_from_livetickets", { name: names.name }) : decision("named_he", { name: names.name }),
      ];
      changed = true;
    }
    if ((rename || HEBREW_LETTER.test(row.name)) && warnings.some((w) => w.code === "no_hebrew_name")) {
      warnings = warnings.filter((w) => w.code !== "no_hebrew_name");
      changed = true;
    }
    if (subjectHasRow && warnings.some((w) => NO_PAGE_WARNINGS.has(w.code))) {
      warnings = warnings.filter((w) => !NO_PAGE_WARNINGS.has(w.code));
      changed = true;
    }
    if (!changed) continue;
    const written = await transitionItem(item.id, REWRITTEN_STATUSES, { warnings, decisions, payload });
    if (written === "db_error") failures += 1;
    else if (written === "ok") handled.add(item.id);
  }
  // The subject's row exists: `no_team_page` / `no_artist_page` leave EVERY item that carries them, whatever
  // its status (the condition is the status it was read in, so a move meanwhile is not overwritten).
  if (subjectHasRow) {
    for (const item of items) {
      if (handled.has(item.id) || !item.warnings.some((w) => NO_PAGE_WARNINGS.has(w.code))) continue;
      const written = await transitionItem(item.id, [item.status], { warnings: item.warnings.filter((w) => !NO_PAGE_WARNINGS.has(w.code)) });
      if (written === "db_error") failures += 1;
    }
  }

  // 4. The run's names task closed (the Tasks board refuses to close it by hand), the record, the site.
  if (failures === 0 && run.names_task_id) {
    try {
      await closeNamesTask(run.names_task_id, `${created} נוצרו · ${renamedIds.length} אירועים קיבלו שם בעברית`);
      if (!(await writeNamesTaskId(run.id, null))) console.error(`uploader-actions: names task ${run.names_task_id} closed but still on run ${run.id}`);
    } catch (e) {
      console.error(`uploader-actions: names task ${run.names_task_id} of run ${run.id} not closed`, errorText(e));
    }
  }
  await logAudit({
    action: "uploader.renamed",
    entityType: "uploader_run",
    entityId: run.id,
    metadata: { agent: AGENT, run_id: run.id, event_ids: renamedIds, teams_created: created },
  });
  if (live) await revalidateMain();
  if (renamedIds.length > 0) invalidatePriceLight("rows");
  if (failures > 0) return { ok: false, kind: "db_error", message: `${created} created, ${renamedIds.length} renamed, ${failures} show(s) not saved - confirm again` };
  return { ok: true, created, renamed: renamedIds.length };
}
