/**
 * Tour uploader (agent #3) - every read and write the server actions (lib/actions/uploader-actions.ts)
 * share: the run / item rows, the guarded status transitions, the run's counts and status, the
 * approve steps (un-hide, record, bounded availability re-check), the preview, the board's picture.
 * Spec: docs/superpowers/specs/2026-10-21-tour-uploader-agent-design.md sections 9-11.
 *
 * NOT a "use server" module: nothing here is callable from the client, and nothing here checks a
 * session - every caller is an action that ran `requireAdmin()` and validated its input first.
 * Nothing here throws to its caller: a failed read or write is logged and comes back as a value
 * (`null`, `false`, `"db_error"`), because the actions return their errors (Next masks a thrown
 * action error in production). The rules these steps apply are pure in lib/uploader/run-rules.ts.
 */
// Never in a client bundle (Next resolves "server-only" itself; no tsx script imports this module).
import "server-only";
import { logAudit } from "@/lib/audit";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { invalidatePriceLight } from "@/lib/services/price-light-cache";
import { taskPeopleOf } from "@/lib/services/task-people";
import { supplierCategoriesOf, zonesOfTemplate } from "@/lib/services/uploader-prior";
import { closeQuestionTask, openQuestionTask } from "@/lib/services/uploader-questions";
import { findShows, resolveSubject } from "@/lib/services/uploader-search";
import { urlSpellings } from "@/lib/services/venue-memory";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { parseDroppedCategories, type DroppedCategories } from "@/lib/uploader/classify";
import { editDiff } from "@/lib/uploader/decisions";
import {
  artSearchPattern,
  EDIT_EVENT_COLUMNS,
  EMPTY_PREVIEW,
  liveBlockers,
  nextRunStatus,
  pickArtRow,
  planPreview,
  RECOMPUTED_RUN_STATUSES,
  runCounts,
  sameSubject,
  STALE_BUILD_MS,
  subjectArtOf,
  subjectHasPage,
  type ItemDraft,
  type PlanPreview,
  type SplitShow,
  type SubjectArt,
  type SubjectArtRow,
  type SubjectCache,
} from "@/lib/uploader/run-rules";
import type { SupplierCategoryMap, VenueZone } from "@/lib/venue-maps/svg-zones";
import type { EventTicket } from "@/types/app.types";
import type { Json } from "@/types/database.types";
import type { ItemStatus, RunStatus, UploaderItem, UploaderPlan, UploaderQuestion, UploaderRun } from "@/types/uploader.types";

// `uploader_runs` / `uploader_items` and `events.is_hidden` are newer than types/database.types.ts
// (regenerate with `npm run db:types` once migration 20261021115818 is applied) - one boundary cast for them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** `metadata.agent` of every audit row the uploader writes (what the agent learns from). */
export const AGENT = "tour-uploader";

const RUN_COLUMNS = "id,created_by,asker_id,brief,plan,plan_ai,status,counts,ai_cost_usd,is_test,error,names_task_id,created_at,updated_at";
const ITEM_COLUMNS =
  "id,run_id,position,show,status,mode,location,decisions,warnings,blockers,question,event_id,payload,skip_reason,error,approved_by,approved_at,rejected_reason,rejected_final,created_at,updated_at";

/** The most items one run may hold - past it a read reports `truncated` rather than return a part. */
const ITEMS_MAX = 5_000;
/** Ids per `.in()` filter - keeps the request line well inside URL limits. */
const IN_CHUNK = 200;
/** How many times `claimNextItem` re-reads after another caller claimed the item it picked. */
const CLAIM_ATTEMPTS = 3;
/** Rows the board's picture read looks at (`artSearchPattern` candidates). */
const ART_CANDIDATES = 10;
const STALE_BUILD_ERROR = "הבנייה נקטעה באמצע (חרגה מזמן הבקשה) - בדקו באירועים אם נוצר אירוע מוסתר לפני שמנסים שוב";

/**
 * The key `plan_ai` is signed with (lib/uploader/plan-token.ts) - the session's signing secret, as
 * lib/auth/session.ts picks it. null = none set: nothing is signed, so no `plan_ai` is trusted.
 */
export function planTokenKey(): string | null {
  return process.env.NEXT_SECRET_SESSION_SECRET || process.env.NEXT_SECRET_ADMIN_PASSWORD || null;
}

/**
 * This person's `agent.call` rows of the tour uploader inside the last `windowMs` (the parse writes
 * `metadata.user_id`) - `parseBrief`'s rate cap. null = the count could not be read (logged).
 */
export async function countRecentParses(userId: string, windowMs: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { error, count } = (await db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "agent.call")
    .eq("metadata->>agent", AGENT)
    .eq("metadata->>user_id", userId)
    .gte("created_at", since)) as DbResult<null> & { count: number | null };
  if (error) {
    logDb("recent parses count", error);
    return null;
  }
  return count ?? 0;
}

/** Newest runs the list shows. */
export const RUNS_LIST_MAX = 50;
/** Characters of the brief quoted beside a plan edit (the lesson's "on a brief like ..."). */
export const BRIEF_EXCERPT = 160;
/** The availability re-check after an approve is awaited at most this long (it may go on running). */
export const APPROVE_SYNC_MS = 20_000;
/**
 * `approveAll`: stop approving after APPROVE_ALL_BUDGET_MS; the re-check gets what is left of
 * APPROVE_ALL_DEADLINE_MS (at most APPROVE_SYNC_MS), so re-check + `revalidateMain` (5 s) + the
 * recompute still end inside the page's 60 s.
 */
export const APPROVE_ALL_BUDGET_MS = 35_000;
export const APPROVE_ALL_DEADLINE_MS = 45_000;

type DbError = { message: string; code?: string } | null;
type DbResult<T> = { data: T | null; error: DbError };

/** A guarded write: done, refused because the row is no longer in a `from` status, or a database failure. */
export type WriteOutcome = "ok" | "moved" | "db_error";

export const nowIso = (): string => new Date().toISOString();
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** An action's refusal. */
export const fail = (kind: string): { ok: false; kind: string } => ({ ok: false, kind });

export function logDb(what: string, error: unknown): void {
  console.error(`uploader: ${what} failed`, JSON.stringify(error));
}

// ---- rows -------------------------------------------------------------------------------------------

export async function readRun(id: string): Promise<{ run: UploaderRun | null; failed: boolean }> {
  const { data, error } = (await db.from("uploader_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle()) as DbResult<UploaderRun>;
  if (error) {
    logDb("run read", error);
    return { run: null, failed: true };
  }
  return { run: data, failed: false };
}

export async function readItem(id: string): Promise<{ item: UploaderItem | null; failed: boolean }> {
  const { data, error } = (await db.from("uploader_items").select(ITEM_COLUMNS).eq("id", id).maybeSingle()) as DbResult<UploaderItem>;
  if (error) {
    logDb("item read", error);
    return { item: null, failed: true };
  }
  return { item: data, failed: false };
}

/** The item and its run, or the `kind` that stops the action (`db_error` / `not_found`). */
export async function readItemAndRun(itemId: string): Promise<{ item: UploaderItem; run: UploaderRun } | { kind: "db_error" | "not_found" }> {
  const { item, failed } = await readItem(itemId);
  if (failed) return { kind: "db_error" };
  if (!item) return { kind: "not_found" };
  const read = await readRun(item.run_id);
  if (read.failed) return { kind: "db_error" };
  if (!read.run) return { kind: "not_found" };
  return { item, run: read.run };
}

/** The newest runs, newest first; null = the read failed. */
export async function listRunRows(limit: number): Promise<UploaderRun[] | null> {
  const { data, error } = (await db
    .from("uploader_runs")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit)) as DbResult<UploaderRun[]>;
  if (error) {
    logDb("runs list", error);
    return null;
  }
  return data ?? [];
}

/** A run's items in board order (position, then creation - split items share their item's position); null = the read failed. */
export async function readRunItems(runId: string, status?: ItemStatus): Promise<UploaderItem[] | null> {
  const read = await fetchPaged<UploaderItem>(() => {
    const q = db.from("uploader_items").select(ITEM_COLUMNS).eq("run_id", runId);
    return (status ? q.eq("status", status) : q).order("position").order("created_at").order("id");
  }, ITEMS_MAX);
  if (read.error) {
    logDb("run items read", read.error);
    return null;
  }
  if (read.truncated) console.error(`uploader: run ${runId} has more than ${ITEMS_MAX} items - only the first ones are read`);
  return read.rows;
}

/** How many of the run's items wait to be built; null = the read failed. */
export async function countFoundItems(runId: string): Promise<number | null> {
  const { error, count } = (await db
    .from("uploader_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "found")) as DbResult<null> & { count: number | null };
  if (error) {
    logDb("found items count", error);
    return null;
  }
  return count ?? 0;
}

/**
 * Is a run about the same subject (`sameSubject`) building or waiting right now - other than
 * `exceptRunId` (the run asking, on resume)? null = the read failed.
 */
export async function runInProgressFor(plan: UploaderPlan, exceptRunId?: string): Promise<boolean | null> {
  const { data, error } = (await db
    .from("uploader_runs")
    .select("id,plan")
    .in("status", ["building", "waiting"])
    .eq("plan->subject->>kind", plan.subject.kind)) as DbResult<{ id: string; plan: UploaderPlan | null }[]>;
  if (error) {
    logDb("open runs read", error);
    return null;
  }
  return (data ?? []).some((r) => r.id !== exceptRunId && !!r.plan?.subject && sameSubject(r.plan.subject, plan.subject));
}

export async function insertRun(row: {
  created_by: string;
  asker_id: string;
  brief: string;
  plan: UploaderPlan;
  plan_ai: UploaderPlan | null;
  counts: Record<string, number>;
  is_test: boolean;
  at: string;
}): Promise<UploaderRun | null> {
  const { data, error } = (await db
    .from("uploader_runs")
    .insert({
      created_by: row.created_by,
      asker_id: row.asker_id,
      brief: row.brief,
      plan: row.plan,
      plan_ai: row.plan_ai,
      status: "building",
      counts: row.counts,
      is_test: row.is_test,
      // The names task needs the run's id, so a run is born without one; `writeNamesTaskId` sets it.
      names_task_id: null,
      updated_at: row.at,
    })
    .select(RUN_COLUMNS)
    .single()) as DbResult<UploaderRun>;
  if (error || !data) {
    logDb("run insert", error);
    return null;
  }
  return data;
}

/** The run's names task (`openNamesTask`) on the run row; false = the write failed (logged). */
export async function writeNamesTaskId(runId: string, taskId: string | null): Promise<boolean> {
  const { error } = (await db.from("uploader_runs").update({ names_task_id: taskId }).eq("id", runId)) as DbResult<null>;
  if (error) {
    logDb("names task id write", error);
    return false;
  }
  return true;
}

/** A new run's items (`planRunItems`), all in one insert; null = it failed (the run is marked `error`). */
export async function insertDraftItems(runId: string, drafts: ItemDraft[], at: string): Promise<UploaderItem[] | null> {
  if (drafts.length === 0) return [];
  const { data, error } = (await db
    .from("uploader_items")
    .insert(
      drafts.map((d) => ({
        run_id: runId,
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
  if (error) {
    logDb("items insert", error);
    const marked = (await db
      .from("uploader_runs")
      .update({ status: "error", error: `items insert failed: ${error.message}`, updated_at: nowIso() })
      .eq("id", runId)) as DbResult<null>;
    if (marked.error) logDb("run error write", marked.error);
    return null;
  }
  return data ?? [];
}

/** Postgres "undefined column" / PostgREST "column not in the schema cache": a migration not applied yet. */
const isMissingColumn = (error: DbError): boolean => error?.code === "42703" || error?.code === "PGRST204";
let subjectCacheWarned = false;

/**
 * The run's stored `subject_cache` (raw - `freshSubjectCache` judges it), or null: none yet, or the
 * column is not there yet (migration `tour_uploader_grants` not applied - logged once, the build then
 * resolves per item exactly as before), or the read failed (logged). Never throws.
 */
export async function readSubjectCache(runId: string): Promise<unknown> {
  const { data, error } = (await db.from("uploader_runs").select("subject_cache").eq("id", runId).maybeSingle()) as DbResult<{
    subject_cache: unknown;
  }>;
  if (error) {
    if (!isMissingColumn(error)) logDb("subject cache read", error);
    else if (!subjectCacheWarned) {
      subjectCacheWarned = true;
      console.warn("uploader: uploader_runs.subject_cache is not there yet - resolving the subject per item");
    }
    return null;
  }
  return data?.subject_cache ?? null;
}

/** Store the run's resolved subject (`SubjectCache`). A failure (or the column not there yet) is logged only - the cache is a speed-up. */
export async function writeSubjectCache(runId: string, cache: SubjectCache): Promise<void> {
  const { error } = (await db.from("uploader_runs").update({ subject_cache: cache }).eq("id", runId)) as DbResult<null>;
  if (error && !isMissingColumn(error)) logDb("subject cache write", error);
}

/** Store the question (with its task id) on the item; false = the write failed. */
export async function setQuestion(itemId: string, question: UploaderQuestion): Promise<boolean> {
  const { error } = (await db.from("uploader_items").update({ question, updated_at: nowIso() }).eq("id", itemId)) as DbResult<null>;
  if (error) {
    logDb("question write", error);
    return false;
  }
  return true;
}

// ---- guarded transitions ----------------------------------------------------------------------------

/**
 * The one conditional write every status move goes through: the patch lands only while the item is
 * still in one of `from` (and, with `updatedBefore`, last written before that time) - the condition
 * sits in the UPDATE, so two people (or a person and the build loop) never both move one item.
 */
export async function transitionItem(
  id: string,
  from: ItemStatus[],
  patch: Record<string, unknown>,
  opts: { updatedBefore?: string } = {},
): Promise<WriteOutcome> {
  let q = db.from("uploader_items").update({ ...patch, updated_at: nowIso() }).eq("id", id).in("status", from);
  if (opts.updatedBefore) q = q.lt("updated_at", opts.updatedBefore);
  const { data, error } = (await q.select("id")) as DbResult<{ id: string }[]>;
  if (error) {
    logDb(`item ${id} transition`, error);
    return "db_error";
  }
  return (data ?? []).length > 0 ? "ok" : "moved";
}

/** `transitionItem` for a run. */
export async function transitionRun(id: string, from: RunStatus[], patch: Record<string, unknown>): Promise<WriteOutcome> {
  const { data, error } = (await db
    .from("uploader_runs")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", id)
    .in("status", from)
    .select("id")) as DbResult<{ id: string }[]>;
  if (error) {
    logDb(`run ${id} transition`, error);
    return "db_error";
  }
  return (data ?? []).length > 0 ? "ok" : "moved";
}

/** The build's `Partial<UploaderItem>` as explicit columns - nothing outside this list is written. */
export function itemPatch(p: Partial<UploaderItem>): Record<string, unknown> {
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

/**
 * Claim the run's next `found` item for a build: pick it (position, then creation), then move it
 * to `building` only while it is still `found`; another caller won it = read again (CLAIM_ATTEMPTS).
 */
export async function claimNextItem(
  runId: string,
): Promise<{ item: UploaderItem } | { none: true } | { lost: true } | { failed: true }> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    const next = (await db
      .from("uploader_items")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "found")
      .order("position")
      .order("created_at")
      .order("id")
      .limit(1)) as DbResult<{ id: string }[]>;
    if (next.error) {
      logDb("next item read", next.error);
      return { failed: true };
    }
    const id = next.data?.[0]?.id;
    if (!id) return { none: true };
    const claimed = (await db
      .from("uploader_items")
      .update({ status: "building", updated_at: nowIso() })
      .eq("id", id)
      .eq("status", "found")
      .select(ITEM_COLUMNS)) as DbResult<UploaderItem[]>;
    if (claimed.error) {
      logDb("item claim", claimed.error);
      return { failed: true };
    }
    const item = claimed.data?.[0];
    if (item) return { item };
  }
  return { lost: true };
}

/** An item left `building` past STALE_BUILD_MS (cut off mid-build) becomes a retryable `error`. Never throws. */
export async function settleStaleBuilds(runId: string): Promise<void> {
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
 * The run's counts and status from its items (`runCounts` / `nextRunStatus`). A status is written
 * only when the recompute produced a non-sticky one, and then only over a non-sticky one (the
 * condition is in the UPDATE): a recompute never writes `stopped` / `error`, never moves a run out
 * of them, and never writes `stopped` back over a run resumed meanwhile. Counts are always written.
 * Never throws.
 */
export async function recomputeRun(runId: string): Promise<void> {
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
  if (RECOMPUTED_RUN_STATUSES.includes(status)) {
    const moved = await transitionRun(runId, RECOMPUTED_RUN_STATUSES, { counts, status });
    if (moved !== "moved") return; // written, or a failure already logged
  }
  // A sticky status (as read, or set meanwhile): only the counts follow the items.
  const counted = (await db.from("uploader_runs").update({ counts, updated_at: nowIso() }).eq("id", runId)) as DbResult<null>;
  if (counted.error) logDb("run counts write", counted.error);
}

// ---- questions --------------------------------------------------------------------------------------

/**
 * The "both" answer's extra items, inserted one by one (so their creation order is the option
 * order) at the answered item's OWN position: the board orders by position, then creation, so they
 * sit right after it, and no other row has to move (two splits at once can never collide). A failed
 * insert removes the ones already made and answers null.
 */
export async function insertSplitItems(item: UploaderItem, extra: SplitShow[]): Promise<string[] | null> {
  const ids: string[] = [];
  for (const e of extra) {
    const { data, error } = (await db
      .from("uploader_items")
      .insert({
        run_id: item.run_id,
        position: item.position,
        show: e.show,
        status: "found",
        decisions: [],
        question: e.question,
        updated_at: nowIso(),
      })
      .select("id")
      .single()) as DbResult<{ id: string }>;
    if (error || !data) {
      logDb("split item insert", error);
      await removeUnbuiltItems(ids);
      return null;
    }
    ids.push(data.id);
  }
  return ids;
}

/**
 * Take back split items that were never answered for (the answer write failed): only while still
 * `found` - one the build loop already claimed is left to finish. Work-queue rows, never events.
 */
export async function removeUnbuiltItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = (await db.from("uploader_items").delete().in("id", ids).eq("status", "found")) as DbResult<null>;
  if (error) logDb("split items rollback", error);
}

/** Raise a question as the asker's task; the task id, or null (logged - the item still shows the question). */
export async function raiseQuestion(run: UploaderRun, item: UploaderItem, q: UploaderQuestion): Promise<string | null> {
  try {
    return await openQuestionTask(run, item, q);
  } catch (e) {
    console.error(`uploader: question task for item ${item.id} failed`, errorText(e));
    return null;
  }
}

/** Close a question task; false = it stayed open (logged). */
export async function closeTask(taskId: string, note: string): Promise<boolean> {
  try {
    await closeQuestionTask(taskId, note);
    return true;
  } catch (e) {
    console.error(`uploader: closing task ${taskId} failed`, errorText(e));
    return false;
  }
}

// ---- events -----------------------------------------------------------------------------------------

/**
 * What a built event's soft delete did: `deleted`; `gone` (already deleted, or no such row - nothing
 * to do); `event_live` (it is LISTED - approved meanwhile - and is never deleted here); `failed`.
 */
export type DeleteOutcome = "deleted" | "gone" | "event_live" | "failed";

/** Today as `events.is_deleted` stores it ("MM-DD-YYYY", the soft-delete stamp every path writes). */
function deletedStamp(d: Date = new Date()): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
}

/**
 * Soft delete a built event ONLY while it is still hidden and not deleted - the condition sits in the
 * UPDATE (`is_hidden = true`, `is_deleted is null`), so an approve that lands between a reject's read
 * and its delete can never take a LIVE event off the site. Nothing written = read why (`gone` /
 * `event_live`). Audited like `softDeleteEvent` (`delete`, entity `event`). Never throws.
 */
export async function softDeleteBuiltEvent(eventId: number): Promise<DeleteOutcome> {
  const stamp = deletedStamp();
  const { data, error } = (await db
    .from("events")
    .update({ is_deleted: stamp })
    .eq("id", eventId)
    .eq("is_hidden", true)
    .is("is_deleted", null)
    .select("id")) as DbResult<{ id: number }[]>;
  if (error) {
    logDb(`event ${eventId} soft delete`, error);
    return "failed";
  }
  if ((data ?? []).length === 0) {
    const row = (await db.from("events").select("id,is_hidden,is_deleted").eq("id", eventId).maybeSingle()) as DbResult<{
      id: number;
      is_hidden: boolean | null;
      is_deleted: string | null;
    }>;
    if (row.error) {
      logDb(`event ${eventId} (after a refused delete) read`, row.error);
      return "failed";
    }
    if (row.data === null || (row.data.is_deleted ?? "").trim() !== "") return "gone";
    if (row.data.is_hidden !== true) return "event_live";
    console.error(`uploader: event ${eventId} is hidden and not deleted, yet the soft delete wrote nothing`);
    return "failed";
  }
  await logAudit({ action: "delete", entityType: "event", entityId: eventId, changes: { is_deleted: stamp }, metadata: { agent: AGENT } });
  invalidatePriceLight("rows");
  return "deleted";
}

/**
 * The availability re-check of freshly listed events (the TixStock price sync, those ids only),
 * awaited at most `ms`: the sync's own `timeBudgetMs` only stops it from STARTING more events, and a
 * supplier call inside it has no timeout of its own, so the wait is a race. A lost race is logged
 * and the sync is left to finish on its own; a failure is logged. Never throws.
 */
export async function boundedRecheck(eventIds: number[], ms: number): Promise<"done" | "failed" | "timeout" | "skipped"> {
  if (eventIds.length === 0) return "done";
  if (ms <= 0) {
    // No time left (approveAll past its deadline): logged - the next scheduled price sync re-checks them.
    console.warn(`uploader: availability re-check of ${eventIds.length} event(s) skipped - no time left in this request`);
    return "skipped";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = (async (): Promise<"done" | "failed"> => {
    // Imported in the call: the sync's exchange-rate service needs the supplier env at load.
    const { syncTixStockPrices } = await import("@/lib/services/tixstock-price-sync");
    const result = await syncTixStockPrices({ eventIds, timeBudgetMs: ms });
    if (result.errors.length > 0) console.warn("uploader: availability re-check reported", JSON.stringify(result.errors.slice(0, 5)));
    return "done";
  })().catch((e: unknown) => {
    console.error("uploader: availability re-check failed", errorText(e));
    return "failed" as const;
  });
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const outcome = await Promise.race([sync, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === "timeout") {
    console.warn(`uploader: availability re-check of ${eventIds.length} event(s) still running after ${ms} ms - not waited for`);
  }
  return outcome;
}

async function selectEditRows(ids: number[]) {
  // A soft-deleted event is no row here: the board then shows its ready item as not approvable.
  return supabaseTyped.from("events").select(EDIT_EVENT_COLUMNS).in("id", ids).is("is_deleted", null);
}
/** An `events` row as EDIT_EVENT_COLUMNS reads it (the edit diff's and the live blockers' input). */
export type EditRow = NonNullable<Awaited<ReturnType<typeof selectEditRows>>["data"]>[number];

/** The rows of these events (in chunks of IN_CHUNK); null = a read failed. */
export async function readEditRows(ids: number[]): Promise<Map<number, EditRow> | null> {
  const rows = new Map<number, EditRow>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await selectEditRows(ids.slice(i, i + IN_CHUNK));
    if (error) {
      logDb("events (edit rows) read", error);
      return null;
    }
    for (const row of data ?? []) rows.set(row.id, row);
  }
  return rows;
}

/** A `locations` row; `failed` = the read failed. */
export async function readLocation(
  id: number,
): Promise<{ row: { id: number; name: string; city_iata: string | null; latitude: number; longitude: number } | null; failed: boolean }> {
  const { data, error } = await supabaseTyped.from("locations").select("id,name,city_iata,latitude,longitude").eq("id", id).maybeSingle();
  if (error) {
    logDb("location read", error);
    return { row: null, failed: true };
  }
  return { row: data, failed: false };
}

// ---- approve ----------------------------------------------------------------------------------------

export type ApproveKind = "not_ready" | "blocked" | "event_gone" | "db_error";
export type Unhidden = { ok: true; eventId: number; before: EditRow } | { ok: false; kind: ApproveKind };

/**
 * List the item's hidden event. The item must be `ready`; its blockers are re-judged against the
 * LIVE row (`liveBlockers` - a base price fixed in the editor clears its blocker); then a direct
 * update of `events.is_hidden` alone (never through `updateEvent`), only while the event is not
 * deleted. `before` = the row as staff left it, read before the un-hide (the edit diff).
 */
export async function unhide(item: UploaderItem): Promise<Unhidden> {
  if (item.status !== "ready") return { ok: false, kind: "not_ready" };
  if (item.event_id === null) return { ok: false, kind: "event_gone" };
  const before = await supabaseTyped.from("events").select(EDIT_EVENT_COLUMNS).eq("id", item.event_id).is("is_deleted", null).maybeSingle();
  if (before.error) {
    logDb("event (before approve) read", before.error);
    return { ok: false, kind: "db_error" };
  }
  if (!before.data) return { ok: false, kind: "event_gone" };
  if (liveBlockers(item.blockers, before.data).length > 0) return { ok: false, kind: "blocked" };
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
  return { ok: true, eventId: item.event_id, before: before.data };
}

/**
 * Record the approval (who / when) while the item is still `ready`, and audit it:
 * `uploader.edited` with the fields AND the values staff changed before approving (`editDiff` over
 * EDIT_WHITELIST - "base_hotel_price 290 -> 340"), `uploader.approved` always.
 */
export async function markApproved(
  actorId: string,
  run: UploaderRun,
  item: UploaderItem,
  listed: { eventId: number; before: EditRow },
): Promise<{ ok: true; edited: boolean } | { ok: false; kind: ApproveKind }> {
  const at = nowIso();
  const written = await transitionItem(item.id, ["ready"], { status: "approved", approved_by: actorId, approved_at: at });
  if (written === "db_error") {
    console.error(`uploader: item ${item.id} not marked approved - event ${listed.eventId} is listed`);
    return { ok: false, kind: "db_error" };
  }
  if (written === "moved") return { ok: false, kind: "not_ready" }; // approved / rejected meanwhile

  const changes = editDiff(item.payload, listed.before);
  const edited = changes.length > 0;
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
        fields: changes.map((c) => c.field),
        changes,
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

// ---- the plan card, the board -----------------------------------------------------------------------

/**
 * What the plan would find (the plan card). An empty subject (the manual form before it is filled)
 * finds nothing. `includeTest`: a test run's duplicates include test events.
 */
export async function previewOf(plan: UploaderPlan, includeTest: boolean): Promise<{ ok: true; preview: PlanPreview } | { ok: false; kind: string }> {
  if (plan.subject.name_en.trim() === "") return { ok: true, preview: { ...EMPTY_PREVIEW, cities: [] } };
  let resolved: Awaited<ReturnType<typeof resolveSubject>>;
  try {
    resolved = await resolveSubject(plan);
  } catch (e) {
    // resolveSubject only throws when a roster read fails (an unknown name is a subject with no rows).
    console.error("uploader: subject resolution failed", errorText(e));
    return { ok: false, kind: "roster_read_failed" };
  }
  try {
    const preview = planPreview(await findShows(plan, resolved.subject, { includeTest }));
    return { ok: true, preview: { ...preview, hasPage: subjectHasPage(plan.subject.kind, resolved.rows) } };
  } catch (e) {
    console.error("uploader: show search failed", errorText(e));
    return { ok: false, kind: "search_failed" };
  }
}

/**
 * The subject's own picture for the board - ONE light read (the board polls `getRun`, so never the
 * whole roster `resolveSubject` reads): up to ART_CANDIDATES active rows whose English name contains
 * the subject's first (club) token, the subject picked among them by `pickArtRow`. A failure logs
 * and draws no picture.
 */
export async function readSubjectArt(plan: UploaderPlan): Promise<SubjectArt> {
  const kind = plan.subject.kind;
  const pattern = artSearchPattern(kind, plan.subject.name_en);
  if (pattern === null) return null;
  const read =
    kind === "artist"
      ? await supabaseTyped
          .from("artists")
          .select("id,name,name_english,image_url,art_image_url")
          .eq("is_active", true)
          .eq("is_deleted", false)
          .ilike("name_english", pattern)
          .order("name")
          .order("id")
          .limit(ART_CANDIDATES)
      : await supabaseTyped
          .from("football_teams")
          .select("id,name,name_english,image_url,art_image_url,logo_url")
          .eq("is_active", true)
          .eq("is_deleted", false)
          .ilike("name_english", pattern)
          .order("name")
          .order("id")
          .limit(ART_CANDIDATES);
  if (read.error) {
    logDb("subject art read", read.error);
    return null;
  }
  const rows: SubjectArtRow[] = read.data ?? [];
  return subjectArtOf(kind, pickArtRow(kind, rows, plan.subject), plan.subject.name_en);
}

/** The people an answer can name (the tasks screen's own loader); [] when the list cannot be read. */
export async function loadPeople(): Promise<{ id: string; name: string }[]> {
  const staff = await taskPeopleOf({ id: MEGA_EVENTS_COMPANY_ID });
  return (staff ?? []).map((p) => ({ id: p.id, name: p.display_name?.trim() || p.email }));
}

// ---- round "אלון 1": venue templates, the events a classification rewrites, team rows ----------------

/** A `venue_maps` row as the classification actions read it (`dropped` = `dropped_categories` as keys). */
export type VenueTemplateRow = {
  id: string;
  name: string;
  source_url: string | null;
  svg_url: string | null;
  zones: VenueZone[];
  supplier_categories: SupplierCategoryMap;
  dropped: DroppedCategories;
};

// `dropped_categories` is newer than types/database.types.ts (migration 20261022170000) - read through `db`.
const VENUE_TEMPLATE_COLUMNS = "id,name,source_url,svg_url,zones,supplier_categories,dropped_categories";

type VenueTemplateDbRow = {
  id: string;
  name: string | null;
  source_url: string | null;
  svg_url: string | null;
  zones: Json;
  supplier_categories: Json;
  dropped_categories: Json;
};

function venueTemplateOf(row: VenueTemplateDbRow): VenueTemplateRow {
  return {
    id: row.id,
    name: row.name ?? "",
    source_url: row.source_url ?? null,
    svg_url: row.svg_url ?? null,
    zones: zonesOfTemplate(row.zones),
    supplier_categories: supplierCategoriesOf(row.supplier_categories),
    dropped: parseDroppedCategories(row.dropped_categories),
  };
}

/**
 * The venue template of a drawing: by `source_url` in any spelling the url is stored under
 * (`urlSpellings`), else - an event the editor's board adopted carries OUR copy - by `svg_url`
 * exactly; the newest `updated_at` wins. `row: null` = no template; `failed` = a read failed (logged).
 */
export async function readVenueTemplate(url: string): Promise<{ row: VenueTemplateRow | null; failed: boolean }> {
  const clean = url.trim();
  if (clean === "") return { row: null, failed: false };
  // A spelling holding `"` would break out of PostgREST's quoted `in.(...)` list - a supplier URL never has one.
  const spellings = urlSpellings(clean).filter((u) => !u.includes('"'));
  if (spellings.length > 0) {
    const bySource = (await db
      .from("venue_maps")
      .select(VENUE_TEMPLATE_COLUMNS)
      .in("source_url", spellings)
      .order("updated_at", { ascending: false })
      .limit(1)) as DbResult<VenueTemplateDbRow[]>;
    if (bySource.error) {
      logDb("venue template (source url) read", bySource.error);
      return { row: null, failed: true };
    }
    const found = bySource.data?.[0];
    if (found) return { row: venueTemplateOf(found), failed: false };
  }
  const bySvg = (await db
    .from("venue_maps")
    .select(VENUE_TEMPLATE_COLUMNS)
    .eq("svg_url", clean)
    .order("updated_at", { ascending: false })
    .limit(1)) as DbResult<VenueTemplateDbRow[]>;
  if (bySvg.error) {
    logDb("venue template (svg url) read", bySvg.error);
    return { row: null, failed: true };
  }
  const found = bySvg.data?.[0];
  return { row: found ? venueTemplateOf(found) : null, failed: false };
}

/** `venue_maps.dropped_categories` replaced: the keys the venue never sells and the rule-drops a person kept. false = the write failed (logged). */
export async function writeDroppedCategories(id: string, dropped: string[], kept: string[]): Promise<boolean> {
  const { error } = (await db
    .from("venue_maps")
    .update({ dropped_categories: { tixstock: dropped, tixstock_kept: kept }, updated_at: nowIso() })
    .eq("id", id)) as DbResult<null>;
  if (error) {
    logDb(`venue map ${id} dropped categories write`, error);
    return false;
  }
  return true;
}

/** An event row as a classification / rename reads it. */
export type EventTicketsRow = { tickets_and_rates: EventTicket[]; map_image_url: string | null; is_hidden: boolean; name: string };

const isTicket = (v: unknown): v is EventTicket =>
  typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { category?: unknown }).category === "string";

/**
 * The tickets, map, hidden flag and name of these events - soft-deleted ones are no row (a deleted show
 * is never rewritten). In chunks of IN_CHUNK; null = a read failed (logged). `events.is_hidden` is newer
 * than the generated types - read through `db`.
 */
export async function readEventTickets(ids: number[]): Promise<Map<number, EventTicketsRow> | null> {
  const rows = new Map<number, EventTicketsRow>();
  const wanted = [...new Set(ids)];
  for (let i = 0; i < wanted.length; i += IN_CHUNK) {
    const { data, error } = (await db
      .from("events")
      .select("id,name,tickets_and_rates,map_image_url,is_hidden")
      .in("id", wanted.slice(i, i + IN_CHUNK))
      .is("is_deleted", null)) as DbResult<{ id: number; name: string | null; tickets_and_rates: unknown; map_image_url: string | null; is_hidden: boolean | null }[]>;
    if (error) {
      logDb("events (tickets) read", error);
      return null;
    }
    for (const row of data ?? []) {
      rows.set(row.id, {
        tickets_and_rates: Array.isArray(row.tickets_and_rates) ? row.tickets_and_rates.filter(isTicket) : [],
        map_image_url: row.map_image_url ?? null,
        is_hidden: row.is_hidden === true,
        name: row.name ?? "",
      });
    }
  }
  return rows;
}

/**
 * A classified event: `tickets_and_rates` and `map_image_url` - those two columns only, never through
 * `updateEvent` (approve's direct-column discipline), only while the event is not deleted. Audited as an
 * `update` of the event. false = the write failed or the event is gone (logged).
 */
export async function writeEventClassification(eventId: number, tickets: EventTicket[], mapUrl: string): Promise<boolean> {
  const { data, error } = (await db
    .from("events")
    .update({ tickets_and_rates: tickets, map_image_url: mapUrl })
    .eq("id", eventId)
    .is("is_deleted", null)
    .select("id")) as DbResult<{ id: number }[]>;
  if (error) {
    logDb(`event ${eventId} classification write`, error);
    return false;
  }
  if ((data ?? []).length === 0) {
    console.error(`uploader: event ${eventId} was not classified - deleted meanwhile`);
    return false;
  }
  await logAudit({
    action: "update",
    entityType: "event",
    entityId: eventId,
    changes: { map_image_url: mapUrl, tickets_count: tickets.length },
    metadata: { agent: AGENT, via: "uploader.classify" },
  });
  return true;
}

/** An event's Hebrew name (`events.name` only, only while not deleted), audited as an `update` of the event. false = failed or gone (logged). */
export async function writeEventName(eventId: number, name: string): Promise<boolean> {
  const { data, error } = (await db.from("events").update({ name }).eq("id", eventId).is("is_deleted", null).select("id")) as DbResult<
    { id: number }[]
  >;
  if (error) {
    logDb(`event ${eventId} name write`, error);
    return false;
  }
  if ((data ?? []).length === 0) {
    console.error(`uploader: event ${eventId} was not renamed - deleted meanwhile`);
    return false;
  }
  await logAudit({ action: "update", entityType: "event", entityId: eventId, changes: { name }, metadata: { agent: AGENT, via: "uploader.renamed" } });
  return true;
}

/** Venue templates the style read looks through (newest first) - the table holds a few dozen. */
const STYLE_TEMPLATES_READ = 50;
const HEBREW_LETTER = /[א-ת]/;

/**
 * Up to `max` Hebrew zone labels of OTHER venues (newest templates first, each label once) - the
 * classification call's style examples. A failed read is logged and gives none: they are a nicety.
 */
export async function readStyleLabels(exceptSourceUrl: string, max: number): Promise<string[]> {
  const except = new Set(urlSpellings(exceptSourceUrl.trim()));
  const { data, error } = (await db
    .from("venue_maps")
    .select("source_url,zones")
    .order("updated_at", { ascending: false })
    .limit(STYLE_TEMPLATES_READ)) as DbResult<{ source_url: string | null; zones: Json }[]>;
  if (error) {
    logDb("venue templates (style labels) read", error);
    return [];
  }
  const out: string[] = [];
  for (const row of data ?? []) {
    if (row.source_url && except.has(row.source_url)) continue;
    for (const zone of zonesOfTemplate(row.zones)) {
      const label = zone.label.trim();
      if (out.length >= max) return out;
      if (HEBREW_LETTER.test(label) && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

/** The person rows a names dialog matches against (`teamRowsFor`): every row of the table that is not deleted, active or not. null = the read failed (logged). */
export async function readPersonNames(table: "football_teams" | "artists"): Promise<{ id: number; name: string; name_english: string | null }[] | null> {
  const read = await fetchPaged<{ id: number; name: string; name_english: string | null }>(
    () => db.from(table).select("id,name,name_english").eq("is_deleted", false).order("id"),
    ITEMS_MAX,
  );
  if (read.error || read.truncated) {
    logDb(`${table} (names) read`, read.error ?? { message: "too many rows" });
    return null;
  }
  return read.rows;
}
