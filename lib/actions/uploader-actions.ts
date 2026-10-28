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
 * Round 2 (docs/superpowers/specs/2026-10-28-uploader-alon-round-2-design.md): a show with no location asks to
 * create one - `proposeLocation` fills the form, `createLocationAndAnswer` writes the `locations` row a person
 * confirmed and answers the question (and the run's other questions of the same city) with it.
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
 * Besides the exported actions this file holds, for now, their private orchestration helpers (the venue
 * rewrite, the names context, the template write - none of them exported, so none is an endpoint); a move
 * of those into a service module may follow. The reads and writes live in lib/services/uploader-store.ts
 * (not "use server"), the pure rules in lib/uploader/run-rules.ts, classify.ts, team-names.ts (selftested),
 * the result shapes in lib/uploader/action-types.ts.
 */
import { requireAdmin } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { agentEnabled, newBudget, TOUR_UPLOADER_AGENT } from "@/lib/agents";
import { createArtistInactive } from "@/lib/actions/artist-actions";
import { createFootballTeamInactive } from "@/lib/actions/football-actions";
import { adoptVenueMap, getVenueMapDrawing, rememberSupplierCategories, saveVenueZones } from "@/lib/actions/venue-map-actions";
import { normalizeName } from "@/lib/on-tour";
import { revalidateMain } from "@/lib/revalidate-main";
import { distanceKm, loadLocations, type LocationRow } from "@/lib/services/nearest-location";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { classifyVenueWithAgent, nameTeamsWithAgent } from "@/lib/services/tour-uploader-classify";
import { LOCATION_EXAMPLES_MAX, proposeLocationWithAgent } from "@/lib/services/tour-uploader-location";
import { parseBriefWithAgent } from "@/lib/services/tour-uploader-parse";
import { loadEquivalence, recordAlias } from "@/lib/services/uploader-aliases";
import { buildItem } from "@/lib/services/uploader-build";
import {
  readDescriptionTemplate,
  readLeagueHebrew,
  rewriteRunDescriptions,
  sampleDescriptionValues,
  writeDescriptionTemplate,
  type DescriptionRewrite,
} from "@/lib/services/uploader-description";
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
  insertLocation,
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
  readLinkTeams,
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
  writeVenueNameHe,
  type EventTicketsRow,
  type VenueTemplateRow,
} from "@/lib/services/uploader-store";
import { normalizeSupplierCategory, ticketSupplier } from "@/lib/suppliers";
import {
  applyClassification,
  classificationDiff,
  classifyResultOf,
  cleanConfirmedRows,
  drawingCategories,
  dropRule,
  FIRST_CONFIRM_NEEDS_NAME,
  forgetUnconfirmed,
  isAppliedState,
  isFixedByHand,
  parseVenueHeInput,
  proposalRows,
  readyToConfirm,
  templateFromEvent,
  templateFromRows,
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
import {
  aiProposedFlags,
  isLocationQuestion,
  locationFallback,
  parseLocationProposal,
  sameCityItems,
  validateLocationInput,
  withLocationOption,
  type LocationInput,
} from "@/lib/uploader/location";
import { cleanTemplate, DESCRIPTION_TOKENS, familyOf, usesCompetition } from "@/lib/uploader/description";
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
  cityAliasOfAnswer,
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
import { subjectRowId as subjectRowIdOf } from "@/lib/uploader/run-panel";
import type {
  ApproveAllResult,
  ApproveResult,
  BuildStep,
  ClassifyResult,
  CreateRunInput,
  CreateRunResult,
  DescriptionSaveResult,
  DescriptionTemplateView,
  LearnPreview,
  LocationCreateResult,
  LocationProposeResult,
  NamesProposeResult,
  Ok,
  OpenQuestions,
  ParseBriefResult,
  PreviewResult,
  ProposeResult,
  RunView,
  TeamSearchResult,
  TeamsResult,
} from "@/lib/uploader/action-types";
import type { PriorItem } from "@/lib/uploader/shows";
import {
  cleanTeamRows,
  findLinkTeams,
  linkQueryOf,
  missingHebrewNames,
  missingSides,
  planTeamRows,
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
import type { ItemStatus, SubjectKind, UploaderItem, UploaderPlan, UploaderQuestion, UploaderRun, Warning } from "@/types/uploader.types";

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
 * The family's standing description template for a build, with the league names `{מפעל}` reads; null =
 * none saved (or not readable - a build never fails over its description; it keeps the English default).
 */
async function descriptionContextFor(kind: SubjectKind): Promise<{ template: string; leagueHe: Record<string, string> } | null> {
  const read = await readDescriptionTemplate(familyOf(kind));
  if (!read.ok || read.template === null) return null;
  return { template: read.template, leagueHe: usesCompetition(read.template) ? await readLeagueHebrew() : {} };
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
    const description = await descriptionContextFor(subject.kind);
    const result = await buildItem(run, item, { subject, rows, teamsHe, ...(twoCity ? { twoCity } : {}), ...(description ? { description } : {}) });
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
  // A person arranged this show's TixStock tickets in the editor (zones / descriptions / categories): the panel
  // offers "learn from it" - until the show has taught the venue (`taught_venue`, ruling R20).
  const fixedByHand: Record<string, boolean> = {};
  const items = stored.map((item) => {
    if (rows === null || !hasBuiltEvent(item)) return item;
    const row = rows.get(item.event_id) ?? null;
    edited[item.id] = editDiff(item.payload, row).length > 0;
    fixedByHand[item.id] = isFixedByHand(item, row);
    // Deleted (or gone) meanwhile: not approvable - approve would answer `event_gone` anyway.
    if (!row) return { ...item, blockers: [...(item.blockers ?? []), EVENT_GONE_BLOCKER] };
    return { ...item, blockers: liveBlockers(item.blockers, row) };
  });
  const [people, subjectArt, { missingNames, subjectRowId }] = await Promise.all([
    withPeople ? loadPeople() : Promise.resolve([]),
    readSubjectArt(run.plan),
    subjectFactsOf(run, stored),
  ]);
  return { run, items, edited, editedUnknown: rows === null, people, ...(withPeople ? {} : { peopleOmitted: true as const }), subjectArt, fixedByHand, missingNames, subjectRowId };
}

/**
 * What the panel reads off the run's CACHED subject: the Hebrew names the run still lacks (the names row,
 * spec 5.1, ruling R2) and the id of the subject's page row (the "פתח משימה" button names its task by it,
 * round "אלון 2" spec 5). Judged on the cache of any age: the board polls, so never a fresh resolve, and a
 * list on screen is judged as of when it was written. A skipped show is never built, so its sides are not
 * asked about. No readable cache = `{ missingNames: [], subjectRowId: null }` - the board never fails for it.
 */
async function subjectFactsOf(run: UploaderRun, items: UploaderItem[]): Promise<{ missingNames: string[]; subjectRowId: number | null }> {
  const none = { missingNames: [], subjectRowId: null };
  try {
    const raw = await readSubjectCache(run.id);
    const writtenAt = isRecord(raw) && typeof raw.at === "string" ? Date.parse(raw.at) : NaN;
    if (!Number.isFinite(writtenAt)) return none;
    const cache = freshSubjectCache(raw, writtenAt);
    if (!cache) return none;
    const subject = { kind: run.plan.subject.kind, name_en: run.plan.subject.name_en, name_he: cache.subject.name_he };
    return {
      missingNames: missingHebrewNames(
        items.filter((i) => i.status !== "skipped"),
        subject,
        cache.teamsHe,
      ),
      subjectRowId: subjectRowIdOf(run.plan.subject.kind, cache.rows),
    };
  } catch (e) {
    console.error(`uploader-actions: subject facts of run ${run.id} failed`, errorText(e));
    return none;
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
 * board order, through the same per-item path (each audited with `rule_applied: true, rule_child: true` - a
 * record the agent does not learn from, M4), stopping at the
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
      // `rule_child`: the record of this answer, never a lesson of its own (M4) - this item's row carries the rule.
      await logAnswered(done.audit, { rule_applied: true, rule_child: true });
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
  // The learned city alias (spec 3.3) - every answered item records its OWN pair, whether a person answered it or
  // a rule for the run did; a failed write is only a lesson not learned, never a failed answer.
  const alias = await recordSameCity(q, clean.key, actorId);
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
        ...(alias === null ? {} : { alias_recorded: alias }),
      },
    },
  };
}

/**
 * Records what a `same_show` answer teaches (`cityAliasOfAnswer`: LiveTickets' city is TixStock's, so the next run
 * pairs the two silently). Null = the answer teaches nothing here; true / false = whether the alias was written.
 * Never throws and never fails the answer: a lesson that could not be saved costs one more question on a later
 * run, nothing else.
 */
async function recordSameCity(q: UploaderQuestion, key: string | null, actorId: string): Promise<boolean | null> {
  const alias = cityAliasOfAnswer(q, key);
  if (alias === null) return null;
  try {
    return await recordAlias({ kind: "city", ...alias, created_by: isUuid(actorId) ? actorId : null });
  } catch (e) {
    console.error("uploader-actions: city alias not recorded", errorText(e));
    return false;
  }
}

async function logAnswered(audit: Answered["audit"], rule: { rule_applied?: true; applied?: number; rule_child?: true }): Promise<void> {
  await logAudit({ action: "uploader.answered", entityType: "uploader_item", entityId: audit.itemId, metadata: { ...audit.metadata, ...rule } });
}

// ---- create a location from a question (round 2, spec 4.2) ---------------------------------------------------------

/** What a location question's dialog starts from when the model proposes nothing (the show's own values). */
const NO_PROPOSAL: LocationInput = { name_he: "", iata: "", latitude: 0, longitude: 0, country_code: null, aliases: [] };

/**
 * The create-location form's starting values: the show's own coordinates, country and city spelling, filled over
 * by ONE `propose_location` call (the city's Hebrew name, IATA, centre and spellings) when the agent is on, the
 * per-person cap allows and it answers. Anything else - off, capped, a failed or unusable answer, a show with no
 * city - opens the same form with what the show knows (`ai` says why). Nothing is written.
 */
export async function proposeLocation(itemId: string): Promise<LocationProposeResult> {
  const session = await requireAdmin();
  if (!isUuid(itemId)) return fail("bad_input");
  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  if (!isLocationQuestion(item)) return fail("not_question");

  const fallback = locationFallback(item.show);
  if (!agentEnabled(TOUR_UPLOADER_AGENT)) return { ok: true, proposal: fallback, ai: "off" };
  const skip = await aiSkipReason(session.sub);
  if (skip) return { ok: true, proposal: fallback, ai: skip === "rate_limited" ? "rate_limited" : "no_answer" };

  // A few of our own names, so the model writes "<city>, <country>" the way the table does. A failed read
  // costs the examples, never the proposal.
  let exampleNames: string[] = [];
  try {
    exampleNames = (await loadLocations())
      .map((l) => l.name)
      .filter((name) => name.includes(",") && /[א-ת]/.test(name))
      .slice(0, LOCATION_EXAMPLES_MAX);
  } catch (e) {
    console.error("uploader-actions: example locations not read - proposing without them", errorText(e));
  }
  const outcome = await proposeLocationWithAgent(
    {
      city: item.show.city,
      countryCode: item.show.country_code,
      venue: item.show.venue,
      latitude: item.show.lat,
      longitude: item.show.lon,
      subject: run.plan.subject.name_en,
      kind: run.plan.subject.kind,
      exampleNames,
    },
    fallback,
    newBudget(TOUR_UPLOADER_AGENT),
    { userId: session.sub },
  );
  if (outcome.ok) return { ok: true, proposal: outcome.proposal, ai: "ok" };
  return { ok: true, proposal: fallback, ai: outcome.kind === "off" ? "off" : "no_answer" };
}

/**
 * The run's one rule for "the same city" as a plain function, read AFTER the new location exists (its short name and
 * aliases join the city's group). `cities` = the city names in play, for a supplier's broken character. A failed read
 * of the rule falls back to the normalized name alone - the cities of the same spelling still match.
 */
async function cityKeyOf(cities: string[]): Promise<(city: string) => string> {
  try {
    const equivalence = await loadEquivalence();
    return (city) => equivalence.cityKey(city, cities);
  } catch (e) {
    console.error("uploader-actions: the city rule was not read - matching shows by their normalized name", errorText(e));
    return (city) => normalizeName(city);
  }
}

/**
 * "צור מיקום ובנה": the form a person confirmed becomes a `locations` row, and the question it came from is
 * answered with it (`answerOne`, the path every answer takes - the task closes, the item is re-queued as `found`,
 * `uploader.answered` is audited). Every OTHER open `create_location` / `pick_location` question of the run whose
 * show is in the same city (`sameCityItems`, the run's city rule) is answered with the same location, each audited
 * as a rule's child so the agent learns once. The shape is checked before any read; the duplicate check (the same
 * IATA AND the same city) after the `locations` read. `input.proposed` (optional) = the AI's proposal as the
 * dialog showed it - only for the audit row's `ai_proposed` flags and what the agent learns, never for a value.
 *
 * A refusal is returned with a `problem` in the dialog's words. Once the row is written it stays whatever
 * happens next: if this question then cannot be answered (answered meanwhile, a database failure) the result
 * says the location exists, and a second attempt is refused as a duplicate.
 */
export async function createLocationAndAnswer(itemId: string, input: unknown): Promise<LocationCreateResult> {
  const session = await requireAdmin();
  if (!isUuid(itemId) || !isRecord(input)) return fail("bad_input");
  const shape = validateLocationInput(input, []);
  if (!shape.ok) return { ...fail("invalid"), problem: shape.problem };

  const read = await readItemAndRun(itemId);
  if ("kind" in read) return fail(read.kind);
  const { item, run } = read;
  if (item.question === null || !isLocationQuestion(item)) return fail("not_question");

  let rows: LocationRow[];
  try {
    rows = await loadLocations();
  } catch (e) {
    console.error("uploader-actions: locations not read - nothing created", errorText(e));
    return fail("db_error");
  }
  const checked = validateLocationInput(input, rows);
  if (!checked.ok) return { ...fail("invalid"), problem: checked.problem };
  const value = checked.value;

  const created = await insertLocation(value);
  if (!created.ok) return fail("db_error");
  const key = String(created.id);
  const proposed = isRecord(input.proposed) ? parseLocationProposal(input.proposed, NO_PROPOSAL) : null;
  await logAudit({
    action: "uploader.location_created",
    entityType: "location",
    entityId: created.id,
    metadata: {
      agent: AGENT,
      run_id: run.id,
      item_id: item.id,
      location_id: created.id,
      name_he: value.name_he,
      iata: value.iata,
      city: item.show.city,
      country_code: value.country_code,
      aliases: value.aliases,
      aliases_saved: created.aliasesSaved,
      ai_proposed: aiProposedFlags(proposed, value),
      ...(proposed && proposed.name_he !== "" ? { proposed_name_he: proposed.name_he } : {}),
      ...(proposed && proposed.iata !== "" ? { proposed_iata: proposed.iata } : {}),
    },
  });

  const own = await answerOne({ ...item, question: withLocationOption(item.question, key, value.name_he) }, run, { key, text: null }, session.sub);
  if (!own.ok) {
    console.error(`uploader-actions: location ${created.id} created but item ${item.id} was not answered (${own.kind})`);
    return { ...fail(own.kind), problem: `המיקום נוצר (#${created.id}) אבל התשובה להופעה לא נשמרה - רעננו את הלוח ובדקו את ההופעה` };
  }

  let applied = 0;
  const open = await readRunItems(run.id, "question");
  if (open === null) console.error(`uploader-actions: open questions of run ${run.id} not read - location ${created.id} answered no other question`);
  const others = (open ?? []).filter((other) => other.id !== item.id);
  if (others.length > 0) {
    const cityKey = await cityKeyOf([item.show.city, ...others.map((other) => other.show.city)]);
    for (const other of sameCityItems(item, others, cityKey)) {
      if (other.question === null) continue;
      const done = await answerOne({ ...other, question: withLocationOption(other.question, key, value.name_he) }, run, { key, text: null }, session.sub);
      if (!done.ok) {
        // A database failure stops it (what was answered stays answered); a question answered meanwhile is passed by.
        if (done.kind === "db_error" || done.kind === "split_failed") break;
        continue;
      }
      await logAnswered(done.audit, { rule_applied: true, rule_child: true });
      applied += 1;
    }
  }
  await logAnswered(own.audit, applied > 0 ? { rule_applied: true, applied } : {});
  await recomputeRun(run.id);
  return { ok: true, location_id: created.id, applied, task_closed: own.taskClosed };
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
// events and items through lib/services/uploader-store.ts. Order of writes, always: the template, then each
// event followed at once by its item (the payload follows the event, so approve never reads the
// classification as a staff edit - ruling R27), then the audit rows, then one site refresh. Nothing here
// writes a price.

/** A drawing url longer than this is no TixStock S3 url. */
const SOURCE_URL_MAX = 2_000;
/** Most rows a classification / names confirm may carry (a big stadium has 40-80 categories). */
const CONFIRM_ROWS_MAX = 300;
/**
 * A classification (or a learn) stops STARTING event rewrites this long after the action began (the board
 * page's maxDuration is 60 s): the rest are `reached < total`. A second confirm finishes them - the rewrite
 * skips an event already in the applied state (`isAppliedState`) and every item is written right after its
 * event (ruling R27), so a cut-off run leaves nothing half-recorded behind it.
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
/** A description rewrite that had nothing to do (no template saved, or no hall name to print). */
const NO_REWRITE: DescriptionRewrite = { eventIds: [], live: false, editedByHand: 0, english: 0, failed: 0 };

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

/**
 * The HEBREW label the stored template already gives a key (its mapping points at a zone that exists, and the
 * zone's label has a Hebrew letter); null otherwise - an English label (the slug a drawing adoption gives) is
 * no label (ruling R26), so the key is asked about.
 */
function hebrewStoredLabel(template: TemplateLike | null, key: string): string | null {
  const zoneId = template?.supplier_categories.tixstock?.[key];
  const zone = zoneId ? template?.zones.find((z) => z.id === zoneId) : undefined;
  const label = zone?.label?.trim() ?? "";
  return HEBREW_LETTER.test(label) ? label : null;
}

/** How many TixStock tickets a list holds - `unzoned_review`'s total, like its count (M6). */
const tixstockCount = (tickets: EventTicket[]): number => tickets.filter((t) => ticketSupplier(t, "tx_event") === "tixstock").length;

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
 * when every ticket has a zone, else `unzoned_review` naming the categories still without one. `unzoned` and
 * `total` both count TixStock tickets only (M6, ruling R17): "N מתוך M" compares like with like.
 */
function classifiedWarnings(prior: Warning[], unzoned: string[], total: number): Warning[] {
  const kept = prior.filter((w) => !VENUE_WARNINGS.has(w.code));
  if (unzoned.length === 0) return kept;
  const categories = uniqueTexts(unzoned.map((c) => c.trim()).filter((c) => c !== ""));
  return [...kept, warning("unzoned_review", { count: unzoned.length, total, categories: categories.join(", ") }, undefined, { categories })];
}

type Rewrite = { eventIds: number[]; reached: number; live: boolean; itemsFailed: number };

/**
 * Spec 6.3 steps 2-3 over the venue's shows, in board order, one show at a time (ruling R27). Step 2: the
 * event's tickets dropped and zoned by the template (`applyClassification`, `previous` = the template before
 * this write, so zoned tickets follow a relabel - ruling R21) and written with the template's map - one
 * UPDATE of those two columns, skipped when the event is already in that state (`isAppliedState`: a second
 * confirm goes on where a cut-off one stopped); a show whose tickets would ALL be dropped is not written (its
 * card gets `all_dropped`, ruling R12). Step 3, right after its event: the item follows it - venue warnings,
 * the `classified` decision and `payload.tickets_and_rates` / `payload.map_image_url` = what the event now
 * holds - so approve's edit diff never reads the classification as a staff edit, and a run cut off between
 * shows leaves no rewritten event whose item looks hand-fixed. It stops at the first failed event write, or
 * past REWRITE_BUDGET_MS: `reached` = how many shows it got through. An item write that fails is counted.
 */
async function rewriteVenueItems(
  targets: BuiltItem[],
  events: Map<number, EventTicketsRow>,
  template: AppliedTemplate,
  previous: TemplateLike | null,
  started: number,
): Promise<Rewrite> {
  const tpl: TemplateLike = { zones: template.zones, supplier_categories: template.supplier_categories };
  const eventIds: number[] = [];
  let reached = 0;
  let live = false;
  let itemsFailed = 0;
  const record = async (item: BuiltItem, patch: Record<string, unknown>): Promise<void> => {
    const written = await transitionItem(item.id, REWRITTEN_STATUSES, patch);
    if (written === "db_error") itemsFailed += 1;
    else if (written === "moved") console.warn(`uploader-actions: item ${item.id} left ready / approved meanwhile - its classification was not recorded on it`);
  };

  for (const item of targets) {
    if (Date.now() - started > REWRITE_BUDGET_MS) break;
    const row = events.get(item.event_id);
    if (!row) {
      reached += 1;
      continue;
    }
    const applied = applyClassification(row.tickets_and_rates, tpl, template.dropped, previous);
    if (applied.tickets.length === 0) {
      // The event is NOT rewritten, so its venue warnings stand as they are: `all_dropped` is only added (once).
      await record(item, { warnings: [...item.warnings.filter((w) => w.code !== "all_dropped"), warning("all_dropped")] });
      reached += 1;
      continue;
    }
    if (!isAppliedState(row, applied.tickets, template.svgUrl)) {
      if (!(await writeEventClassification(item.event_id, applied.tickets, template.svgUrl))) break;
      eventIds.push(item.event_id);
      if (item.status === "approved" || !row.is_hidden) live = true;
    }
    reached += 1;
    const zones = new Set(applied.tickets.map((t) => t.zoneId).filter((z): z is string => !!z)).size;
    await record(item, {
      warnings: classifiedWarnings(item.warnings, applied.unzoned, tixstockCount(applied.tickets)),
      decisions: [
        ...item.decisions.filter((d) => d.code !== "classified"),
        decision("classified", { zones, dropped: applied.dropped.length, unsure: uniqueTexts(applied.unzoned).length }),
      ],
      ...(item.payload ? { payload: { ...item.payload, tickets_and_rates: applied.tickets, map_image_url: template.svgUrl } } : {}),
    });
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

/**
 * The classification dialog opens: the venue's categories (the drawing's and the built events' tickets),
 * the stored template's labels, the code rule's drops, and - when a category the venue does not drop has no
 * HEBREW label in the template yet - the agent's proposal (`classify_venue`). The ask set (ruling R26) = the
 * categories without a Hebrew label, minus the venue's drops: a Hebrew-labelled one is shown as stored and
 * not asked about, an English label counts as none (and is never handed over as an existing label for the
 * model to keep). The per-person AI cap is checked first; the
 * dialog never fails for the AI's sake (spec 5.2, ruling R13): AI off, the cap, an unreadable count, a
 * timeout or a bad answer = the rows open empty (`ai.reason`), the rule's drops applied. `proposed` = the
 * model's raw proposal; the confirm sends back the rows as SHOWN (`rows`).
 * The hall's Hebrew name (round 2, D3) rides the same call: asked for while the template has none - even
 * when every category is labelled already - and handed back as `venue_he` (the stored name wins over the
 * proposal; `venue_he_ai` says which it is). No zone description is proposed or shown any more (D4).
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
  // The ask set: what the venue does not drop and the template has no Hebrew label for.
  const unlabelled = ctx.categories.filter((c) => !venueDrops(c.key) && hebrewStoredLabel(template, c.key) === null);
  // The hall's Hebrew name is asked for while none is stored (a hall with no categories has no dialog rows to carry it).
  const storedHe = ctx.template?.name_he ?? null;
  const askName = storedHe === null && ctx.categories.length > 0;
  const needsAi = unlabelled.length > 0 || askName;

  let proposed: Map<string, ProposedRow> | null = null;
  let proposedHe: string | null = null;
  let ai: { used: boolean; reason: string | null; problems: string[] } = { used: false, reason: "not_needed", problems: [] };
  if (needsAi && skip) {
    ai = { used: false, reason: skip, problems: [] };
  } else if (needsAi) {
    // A key too long to hand over whole is not asked about (its row opens for review): a cut name would not map back to it.
    const asked = unlabelled.filter((c) => c.key.length <= AI_CATEGORY_MAX);
    // Style examples only teach the voice of the labels - a call that asks for the hall's name alone needs none.
    const styleExamples =
      asked.length === 0 ? [] : (await readStyleLabels(sourceUrl, STYLE_EXAMPLES_MAX)).slice(0, STYLE_EXAMPLES_MAX).map((l) => cutText(l, AI_LABEL_MAX));
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
          // Every asked key is one with no Hebrew label: there is none to keep (an English one must not be kept).
          existingLabel: null,
        })),
        styleExamples,
        askVenueName: askName,
      },
      newBudget(TOUR_UPLOADER_AGENT),
      { userId: session.sub },
    );
    if (outcome.ok) {
      proposed = outcome.rows;
      proposedHe = outcome.venueHe;
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
    venue_he: storedHe ?? proposedHe,
    venue_he_ai: storedHe === null && proposedHe !== null,
    shows: ctx.targets.length,
    ai,
  };
}

/**
 * The classification dialog's confirm (spec 6.3). `input = { rows, proposed, ai, venueHe? }`: `rows` = the confirmed
 * rows (`cleanConfirmedRows` against the venue's categories, re-read here - nothing about the venue is taken
 * from the client), `proposed` = the rows as the dialog SHOWED them (null = it carried none), `ai` = whether
 * the dialog opened with the agent's proposal (recorded on `uploader.classified`, ruling R14), `venueHe` = the
 * hall's Hebrew name from the dialog's top box (round 2, D3; `parseVenueHeInput`: absent = the stored name stays,
 * empty = cleared, a Hebrew name = set, anything else `bad_input`). Round 2's other option, `excludedSections`,
 * joins `venueHe` in this record. A venue
 * category the rows leave out is UNSURE (ruling R16): forgotten unless the template already labels it in
 * Hebrew. A venue with no template needs one NAMED row (ruling R25 - `readyToConfirm`), else `bad_input`
 * with FIRST_CONFIRM_NEEDS_NAME and nothing is written. In order:
 * 1. the template - adopted first when the venue has none (`adopt_failed` stops here, nothing written),
 *    then its zones, mapping and dropped list written, and the hall's Hebrew name (`venue_maps.name_he`) when
 *    it changed;
 * 2-3. the venue's events rewritten, each item following right after its event (`rewriteVenueItems`), then
 *    their descriptions - the ones the uploader wrote itself - filled again, for `{אולם}` prints the hall's
 *    Hebrew name (`rewriteRunDescriptions`; none when no template is saved or the hall has no name at all;
 *    a failure there is only flagged - `describeFailed` on the OK answer - never a failed classification);
 * 4. `uploader.classified` (the record) and one `uploader.classify_changed` per change (the lessons);
 * 5. the site refreshed once when a live event changed, the price light's list when any did.
 * `reached < total` = the time budget or a failed event write stopped it - a second confirm finishes it (the
 * events already rewritten are skipped, ruling R27).
 */
export async function classifyVenue(runId: string, sourceUrl: string, input: unknown): Promise<ClassifyResult> {
  const started = Date.now();
  await requireAdmin();
  if (!isUuid(runId) || !isDrawingUrl(sourceUrl)) return fail("bad_input");
  if (!isRecord(input) || !Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > CONFIRM_ROWS_MAX) return fail("bad_input");
  if (input.proposed !== undefined && input.proposed !== null && !isRecord(input.proposed)) return fail("bad_input");
  if (typeof input.ai !== "boolean") return fail("bad_input");
  const aiShown = input.ai;
  const venueHeInput = parseVenueHeInput(input.venueHe);
  if (!venueHeInput.ok) return fail("bad_input");

  const ctx = await readVenueContext(runId, sourceUrl);
  if ("kind" in ctx) return ctx;
  const allowed = new Set(ctx.categories.map((c) => c.key));
  const confirmed = cleanConfirmedRows(input.rows, allowed);
  if (confirmed === null || confirmed.length === 0) return fail("bad_input");
  const shown = shownRows(input.proposed, allowed);
  if (shown === undefined) return fail("bad_input");
  // A first confirm adopts the drawing and moves every event onto our copy: with no zone named, nothing would light (ruling R25).
  if (!ctx.template && !readyToConfirm(confirmed, false)) return { ok: false, kind: "bad_input", message: FIRST_CONFIRM_NEEDS_NAME };

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
  // The hall's Hebrew name (round 2, D3): not sent = the stored one stays; a column the migration has not added yet saves nothing and the confirm goes on.
  const storedHe = ctx.template?.name_he ?? null;
  const venueHe = venueHeInput.value === undefined ? storedHe : venueHeInput.value;
  if (venueHe !== storedHe) {
    const named = await writeVenueNameHe(base.id, venueHe);
    if (named === "db_error") return { ok: false, kind: "db_error", message: "the hall's Hebrew name could not be saved - confirm again" };
  }

  // 2-3. Each event, then its item (zoned tickets follow the template as it stood before this write - `base`).
  const rewrite = await rewriteVenueItems(ctx.targets, ctx.events, written.template, base, started);
  // ... then their descriptions, read fresh (the rewrite above just changed the items): `{אולם}` prints the hall's name.
  // Not when the rewrite stopped early (its budget, a failed write): the second confirm that finishes it describes too.
  const hallNamed = venueHe !== null || storedHe !== null;
  const described = hallNamed && rewrite.reached >= ctx.targets.length ? await describeHall(ctx.run, sourceUrl) : NO_REWRITE;

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
      venue_he: venueHe,
    },
  });
  await logClassifyChanges(ctx.run, ctx.name, classificationDiff(shown, confirmed), shown);

  if (described === "db_error") console.error(`uploader-actions: the descriptions of run ${ctx.run.id}'s shows at ${ctx.name} were not all rewritten - the classification itself is saved`);

  // 5. The site (a description that failed half-way may still have changed a live event - ask anyway).
  await refreshAfterRewrite({ eventIds: rewrite.eventIds, live: rewrite.live || described === "db_error" || described.live });
  return classifyResultOf(rewrite, ctx.targets.length, { zones: written.template.zones.length, dropped: droppedRows.length, unsure: unsure.length }, described === "db_error");
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

  // 2-3. Each other show's event, then its item; then the source's item (its event is the source - untouched).
  const rewrite = await rewriteVenueItems(targets, events, written.template, templateLikeOf(ctx.template), started);
  const own = ctx.row.tickets_and_rates;
  const marked = await transitionItem(ctx.item.id, REWRITTEN_STATUSES, {
    // TixStock tickets only, as `applyClassification` counts them (ruling R17: LiveTickets zoning is the editor's board).
    warnings: classifiedWarnings(
      ctx.item.warnings,
      own.filter((t) => ticketSupplier(t, "tx_event") === "tixstock" && !t.zoneId).map((t) => t.category),
      tixstockCount(own),
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
  return classifyResultOf(rewrite, targets.length, { zones: written.template.zones.length, dropped: learned.dropped.length, unsure: 0 });
}

// ---- Alon 25.10: the description template --------------------------------------------------------------

/**
 * The family's standing description template over the run's built events, read fresh (items and events).
 * No template saved = nothing to do. "db_error" = the template, the items or the events could not be read,
 * or an event / item could not be written.
 */
async function describeAgain(
  run: UploaderRun,
  subject: { name_he: string | null; name_en: string },
  teamsHe: Record<string, string>,
  via: "board" | "names" | "classify",
  /** Only the shows at this TixStock drawing (a classification confirm rewrites its own hall); absent = the whole run. */
  drawingUrl?: string,
): Promise<DescriptionRewrite | "db_error"> {
  const family = familyOf(run.plan.subject.kind);
  const read = await readDescriptionTemplate(family);
  if (!read.ok) return "db_error";
  if (read.template === null) return NO_REWRITE;
  const all = await readRunItems(run.id);
  if (all === null) return "db_error";
  const items = drawingUrl === undefined ? all : all.filter((i) => drawingUrlOf(i) === drawingUrl);
  const leagueHe = usesCompetition(read.template) ? await readLeagueHebrew() : {};
  const done = await rewriteRunDescriptions({ runId: run.id, items, family, template: read.template, teamsHe, leagueHe, subject, via });
  if (done === null || done.failed > 0) return "db_error";
  return done;
}

/**
 * A classification confirm's description step: the hall's shows in the run get the family's template filled
 * again (`describeAgain`, scoped to the drawing), now that `{אולם}` has a Hebrew name to print. No template
 * saved = nothing to do, and the subject is then not even resolved. "db_error" = the subject, the template,
 * the items or an event could not be read or written.
 */
async function describeHall(run: UploaderRun, drawingUrl: string): Promise<DescriptionRewrite | "db_error"> {
  const read = await readDescriptionTemplate(familyOf(run.plan.subject.kind));
  if (!read.ok) return "db_error";
  if (read.template === null) return NO_REWRITE;
  let cache: SubjectCache;
  try {
    cache = await resolvedSubjectOf(run);
  } catch (e) {
    console.error(`uploader-actions: subject of run ${run.id} not resolved - the hall's descriptions were not rewritten`, errorText(e));
    return "db_error";
  }
  return describeAgain(run, cache.subject, cache.teamsHe, "classify", drawingUrl);
}

/** The template editor opens on a run: the run's family's template, its tokens, and the first built show's values for the live preview. */
export async function getDescriptionTemplate(runId: string): Promise<DescriptionTemplateView> {
  await requireAdmin();
  if (!isUuid(runId)) return fail("bad_input");
  const { run, failed } = await readRun(runId);
  if (failed) return fail("db_error");
  if (!run) return fail("not_found");
  const family = familyOf(run.plan.subject.kind);
  const [read, items] = await Promise.all([readDescriptionTemplate(family), readRunItems(run.id)]);
  if (!read.ok || items === null) return fail("db_error");
  const built = items.filter(isRewritable);
  let sample: Awaited<ReturnType<typeof sampleDescriptionValues>> = null;
  if (built.length > 0) {
    try {
      // a preview only: a subject or league read that fails leaves the editor without it, never closed
      const cache = await resolvedSubjectOf(run);
      const drawing = drawingUrlOf(built[0]);
      const hall = drawing ? await readVenueTemplate(drawing) : null;
      sample = await sampleDescriptionValues(built[0], {
        teamsHe: cache.teamsHe,
        leagueHe: await readLeagueHebrew(),
        subject: cache.subject,
        venueHe: hall?.row?.name_he ?? null,
      });
    } catch (e) {
      console.error(`uploader-actions: description preview of run ${run.id} not read`, errorText(e));
    }
  }
  return {
    ok: true,
    family,
    template: read.template,
    ready: read.ready,
    tokens: [...DESCRIPTION_TOKENS[family]],
    sample,
    sampleName: built[0] ? (typeof built[0].payload?.name === "string" ? built[0].payload.name : built[0].show.name_english) : null,
    targets: built.length,
  };
}

/**
 * Save the run's family's standing template (null / empty clears it) - every later build of that family
 * fills it - and, with `apply`, rewrite this run's built events now (`describeAgain`: a description a
 * person typed is left alone). Audited `uploader.description_template`.
 */
export async function saveDescriptionTemplate(runId: string, template: unknown, apply: boolean): Promise<DescriptionSaveResult> {
  const session = await requireAdmin();
  if (!isUuid(runId) || typeof apply !== "boolean") return fail("bad_input");
  const { run, failed } = await readRun(runId);
  if (failed) return fail("db_error");
  if (!run) return fail("not_found");
  const family = familyOf(run.plan.subject.kind);
  const clean = cleanTemplate(template, family);
  if (!clean.ok) return { ok: false, kind: "bad_template", problem: clean.problem };
  const saved = await writeDescriptionTemplate(family, clean.template, session.sub);
  if (saved === "missing_table") return fail("not_ready");
  if (saved === "db_error") return fail("db_error");
  await logAudit({
    action: "uploader.description_template",
    entityType: "uploader_run",
    entityId: run.id,
    metadata: { agent: AGENT, run_id: run.id, family, template: clean.template },
  });
  if (!apply || clean.template === null) return { ok: true, applied: null };

  let cache: SubjectCache;
  try {
    cache = await resolvedSubjectOf(run);
  } catch (e) {
    console.error(`uploader-actions: subject of run ${run.id} not resolved - template saved, not applied`, errorText(e));
    return fail("roster_read_failed");
  }
  const done = await describeAgain(run, cache.subject, cache.teamsHe, "board");
  if (done === "db_error") return { ok: false, kind: "db_error", problem: "התבנית נשמרה, אבל לא כל האירועים עודכנו - החילו שוב" };
  if (done.live) await revalidateMain();
  return { ok: true, applied: { events: done.eventIds.length, editedByHand: done.editedByHand, english: done.english } };
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
 * manual), how many built shows a confirm renames with no row to fill (`renamable`, ruling R24: a ready /
 * approved show whose stored name has no Hebrew letter while `eventNames` now has a Hebrew one - from our
 * teams, a team added in Templates meanwhile, or LiveTickets), and whether the run's names task is still open
 * (`namesTask`) - either one lets the dialog send a `[]` confirm, which renames, clears `no_hebrew_name` and
 * closes the task. The per-person AI cap is checked first; the dialog never fails for the AI's sake (ruling
 * R13): AI off, the cap, an unreadable count or a failed call = the rows open for a manual fill (`ai.reason`).
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
  const renamable = items.filter(isRewritable).filter((i) => {
    const sideNames = withSupplierSpellings(cache.teamsHe, [i.show.home_team, i.show.away_team]);
    const names = eventNames(cache.subject.kind, i.show, subject, sideNames, i.show.suppliers.livetickets?.name_heb ?? null);
    const stored = typeof i.payload?.name === "string" ? i.payload.name : "";
    return names.hebrew && !HEBREW_LETTER.test(stored);
  }).length;

  return {
    ok: true,
    rows: teamRowsFor(sides, proposed, ctx.teams),
    subjectName: sides.find((s) => s.isSubject)?.supplier_name ?? null,
    renamable,
    namesTask: !!ctx.run.names_task_id,
    ai,
  };
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
 * The pages the names dialog's "זה עמוד קיים" can link a name to (round 2, spec 5): `football_teams` rows that are
 * not deleted - live or inactive - whose Hebrew or English name matches `query` (`findLinkTeams`: words in any order,
 * accents ignored, live pages first, at most 20). The query is 2..60 characters after trimming (`bad_input`).
 */
export async function searchTeamsForLink(query: string): Promise<TeamSearchResult> {
  await requireAdmin();
  const q = linkQueryOf(query);
  if (q === null) return fail("bad_input");
  const teams = await readLinkTeams();
  if (teams === null) return fail("db_error");
  return { ok: true, teams: findLinkTeams(teams, q) };
}

/** One supplier spelling and the page it ends up under: a person's pick, the club rule's match, or a page this confirm made. */
type TeamResolution = {
  spelling: string;
  team: { id: number; name: string; name_english: string | null };
  how: "picked" | "matched" | "created";
};

/**
 * The names dialog's confirm (spec 6.4, round 2 spec 5). `rows` are checked against the names the run lacks, re-derived
 * here (`cleanTeamRows` - the shape; then each `existing_id` must be the one `teamRowsFor` itself offers for that name,
 * else `bad_input`; a `link_team_id` - the page a person picked with "זה עמוד קיים" - must be a `football_teams` row that
 * is not deleted and has a Hebrew name, else `team_not_found`, and is for a fixture side of a team run only). In order:
 * 1. each row ends up under ONE page: a picked link, an `existing_id`, or - for the rows left to create
 *    (`collapseCreateRows`: the same club typed twice, by the club rule on the English name or by the Hebrew name, is
 *    ONE team carrying every supplier spelling it answers) - a team `football_teams` already holds by the club rule
 *    (read just now, inactive ones included: a duplicate is never made), else a new one created INACTIVE (audit
 *    `uploader.team_created` once per team). A page used rather than created gets the supplier's spelling recorded as
 *    an alias of it (`recordAlias`, with the page's id) and an audit `uploader.team_linked` (`picked`: a person's pick or
 *    the club rule's match); the extra spellings of a team just created get the alias too;
 * 2. the run's subject cache refreshed (`resolveSubject` - which finds an inactive subject row too, ruling R15, and
 *    knows every aliased spelling), each spelling of a row under the Hebrew name of ITS page;
 * 3. every ready / approved show renamed by `eventNames` where it now has a Hebrew name and the stored one is
 *    not a person's own Hebrew edit (`events.name`, `payload.name`, `no_hebrew_name` dropped, decision
 *    `named_he` / `name_from_livetickets`); once the subject has a row, `no_team_page` / `no_artist_page`
 *    leave EVERY item of the run that carries them;
 * 4. the run's names task closed, `uploader.renamed`, the site refreshed once when a live event was renamed.
 * An empty `rows` is a valid confirm (ruling R24 - every side known by other means, or a partial confirm
 * that already created the teams): nothing is created, steps 2-4 rename what they can, clear
 * `no_hebrew_name` where it is resolved and close the task.
 */
export async function createTeamsAndRename(runId: string, rows: unknown): Promise<TeamsResult> {
  const session = await requireAdmin();
  if (!isUuid(runId) || !Array.isArray(rows) || rows.length > CONFIRM_ROWS_MAX) return fail("bad_input");
  const ctx = await readNamesContext(runId);
  if ("kind" in ctx) return ctx;
  const { run, items, cache, sides, personKind: kind } = ctx;
  const confirmed = cleanTeamRows(rows, new Set(sides.map((s) => s.supplier_name)));
  if (confirmed === null) return fail("bad_input");

  // Each confirmed row against the name it answers (normalizeName on both sides).
  const sideByKey = new Map(sides.map((s) => [normalizeName(s.supplier_name), s]));
  const pairs: { row: ConfirmedTeamRow; side: MissingSide }[] = [];
  for (const row of confirmed) {
    const side = sideByKey.get(normalizeName(row.supplier_name));
    if (!side) return fail("bad_input");
    pairs.push({ row, side });
  }
  // A link is a person's pick for a fixture side of a team run: an artist is never linked, and the subject's own row
  // is not either (its page is found by name - a link would leave the run asking for it again).
  const plainPairs = pairs.filter((p) => (p.row.link_team_id ?? null) === null);
  if (pairs.some((p) => (p.row.link_team_id ?? null) !== null && (kind === "artist" || p.side.isSubject))) return fail("bad_input");
  // Each `existing_id` must be the row `teamRowsFor` offers for that name (the typed names are what it matches by).
  const offered = new Map(
    teamRowsFor(
      plainPairs.map((p) => p.side),
      new Map(plainPairs.map(({ row, side }) => [side.supplier_name, { name_en: row.name_en, name_he: row.name_he }] as const)),
      ctx.teams,
    ).map((r) => [normalizeName(r.supplier_name), r]),
  );
  for (const { row } of plainPairs) {
    const offer = offered.get(normalizeName(row.supplier_name));
    if (row.existing_id !== null && (offer?.status !== "existing" || offer.existing_id !== row.existing_id)) return fail("bad_input");
  }
  // What each row comes to, from the pages read just now (inactive ones too): a picked page must still be there and
  // have a Hebrew name to give the events.
  const plan = planTeamRows(confirmed, ctx.teams);
  if (plan.missing !== null) return fail("team_not_found");
  if (plan.resolved.some((r) => r.how === "picked" && r.team.name.trim() === "")) return fail("team_not_found");

  // 1. Every row under one page: the ones already settled, then one team per group left to create (inactive).
  const resolutions: TeamResolution[] = [...plan.resolved];
  let created = 0;
  for (const group of plan.create) {
    const made = await createPersonInactive(kind, { supplier_name: group.supplier_names[0], name_en: group.name_en, name_he: group.name_he, existing_id: null });
    if (!made.ok) {
      // What was created stays (a second confirm finds it as an existing team); nothing is renamed yet.
      return { ok: false, kind: "db_error", message: `${created} created, then "${group.name_en}" failed: ${made.message}` };
    }
    created += 1;
    const team = { id: made.id, name: group.name_he, name_english: group.name_en };
    for (const spelling of group.supplier_names) resolutions.push({ spelling, team, how: "created" });
    await logAudit({
      action: "uploader.team_created",
      entityType: "uploader_run",
      entityId: run.id,
      metadata: {
        agent: AGENT,
        run_id: run.id,
        team_id: made.id,
        kind,
        name_he: group.name_he,
        name_en: group.name_en,
        from_supplier_name: group.supplier_names[0],
        supplier_names: group.supplier_names,
      },
    });
  }
  // The spelling a supplier used becomes an alias of its page, so a later run knows it (a team alias exists for teams
  // only - `team_id` is a `football_teams` id). A failed alias write is logged, never a failed confirm.
  let linked = 0;
  if (kind !== "artist") {
    for (const { spelling, team, how } of resolutions) {
      if (how !== "created") linked += 1;
      const toName = team.name_english?.trim() || team.name;
      // A spelling that IS the page's English name is no alias (`recordAlias` refuses it) and nothing for the agent to learn.
      if (normalizeName(spelling) === normalizeName(toName)) continue;
      await recordAlias({ kind: "team", from_name: spelling, to_name: toName, team_id: team.id, created_by: session.sub });
      if (how === "created") continue;
      await logAudit({
        action: "uploader.team_linked",
        entityType: "uploader_run",
        entityId: run.id,
        metadata: { agent: AGENT, run_id: run.id, team_id: team.id, from_supplier_name: spelling, to_name: toName, picked: how === "picked" },
      });
    }
  }

  // 2. The subject cache refreshed: `resolveSubject` picks the subject among every row that is not deleted
  //    (an inactive one included - ruling R15), so the run's later builds see the new rows and raise no
  //    `no_team_page` / `no_artist_page` again. Each confirmed spelling also under ITS page's Hebrew name - the
  //    club rule may not bridge a name a person typed or picked: a page that already existed by its stored Hebrew
  //    name, a new one by the name just given it.
  let fresh: SubjectCache = cache;
  try {
    fresh = { at: nowIso(), ...(await resolveSubject(run.plan)) };
  } catch (e) {
    console.error(`uploader-actions: subject of run ${run.id} not re-resolved - renaming with the cached one`, errorText(e));
  }
  const teamsHe = { ...fresh.teamsHe };
  if (kind !== "artist") {
    for (const { spelling, team } of resolutions) teamsHe[normalizeName(spelling)] = team.name.trim();
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

  // 3b. The description template again, now that the teams have Hebrew names (Alon 25.10) - over the items
  //     as this pass left them (their decisions just changed), never over a description a person typed.
  //     A description that could not be rewritten never holds the names task open: the board's "apply" redoes it.
  const described = await describeAgain(run, subject, teamsHe, "names");
  if (described === "db_error") console.error(`uploader-actions: descriptions of run ${run.id} not rewritten after the rename`);
  else if (described.live) live = true;

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
    metadata: { agent: AGENT, run_id: run.id, event_ids: renamedIds, teams_created: created, teams_linked: linked },
  });
  if (live) await revalidateMain();
  if (renamedIds.length > 0) invalidatePriceLight("rows");
  if (failures > 0) return { ok: false, kind: "db_error", message: `${created} created, ${renamedIds.length} renamed, ${failures} show(s) not saved - confirm again` };
  return { ok: true, created, linked, renamed: renamedIds.length };
}
