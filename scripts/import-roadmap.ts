/**
 * One-time, idempotent import of the old roadmap board (a separate app that kept its
 * tasks only in a browser's localStorage) into the `tasks` table.
 *
 *   npx tsx scripts/import-roadmap.ts <path.json> --people dor=a@x.com,alon=b@y.com,tom=c@z.com [--dry-run] [--update-existing]
 *
 * Export the source file from the old app's console first - see
 * docs/superpowers/roadmap-export-snippet.md. A synthetic fixture for a dry run without
 * Dor's real export lives at scripts/fixtures/roadmap-sample.json.
 *
 * **Default is create-only.** Once a row is imported, people edit it in /tasks (status,
 * assignee, ...); re-running the old export must never silently revert that. A live match
 * is reported as `existing (left as is)` and never written. Pass `--update-existing` to
 * actually push mapped-field changes onto rows that already exist - see `planRow` in
 * lib/roadmap-import.ts for the full classification (create / skipped_deleted / existing /
 * update / unchanged).
 *
 * Order of checks, all before any write:
 *   1. The JSON shape (`{ tasks: [], mkt: [] }`) and every row's fields/enums - a bad row
 *      is rejected by its id rather than silently defaulted (the pure mappers in
 *      lib/roadmap-import.ts keep their defaults for the self-test's sake; this script's
 *      validation is what actually refuses bad input).
 *   2. Every `as` key used in the data has a `--people` mapping.
 *   3. REAL runs only: a cheap probe select refuses outright if `tasks.board` is missing
 *      (production hasn't run migration 20260916120000_tasks_hub yet) - checked before the
 *      people/user_profiles round trip so the refusal doesn't depend on which emails were
 *      passed. --dry-run skips this and reports anyway.
 *   4. Every mapped email actually has a `user_profiles` row - matched case-insensitively
 *      and trimmed in memory (never relying on the DB's collation).
 *
 * Existing `source = 'roadmap'` tasks (including soft-deleted ones - a deleted row must
 * still be recognised so it's never recreated as a duplicate) are loaded in ONE query and
 * diffed in memory against the freshly-mapped rows (keyed on `source_ref.kind` +
 * `source_ref.row_id`) - never one query per input row. With `--update-existing`, an update
 * only writes when a mapped field actually differs, so a second real run reports `update 0`.
 */
import { readFileSync } from "node:fs";
import { supabase } from "@/lib/supabase-server";
import { MKT_CHANNELS } from "@/types/task.types";
import {
  mapDevTask,
  mapMktTask,
  planRow,
  sourceRefKey,
  type ExistingTaskForPlan,
  type PlannedRow,
  type RoadmapDevRow,
  type RoadmapInsert,
  type RoadmapMktRow,
} from "@/lib/roadmap-import";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Already loaded some other way (or none present) - the Supabase calls below will just
  // fail loudly with "Missing Supabase environment variables" if that's the case.
}

const DEV_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const DEV_STATUSES = new Set(["todo", "inprogress", "done"]);
const MKT_PRIORITIES = DEV_PRIORITIES;
const MKT_STATUSES = new Set(["planning", "active", "done", "paused"]);
const MKT_CHANNEL_SET = new Set<string>(MKT_CHANNELS);

/** Throws rather than calling process.exit() directly - exiting mid-request while
 *  supabase-js's fetch/undici sockets are still open crashes Node on Windows
 *  (a libuv "UV_HANDLE_CLOSING" assertion). main().catch() below turns this into a
 *  clean `process.exitCode = 1` once the event loop has actually settled. */
class FatalError extends Error {}
function fatal(message: string): never {
  throw new FatalError(message);
}

function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---- CLI args ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const updateExisting = argv.includes("--update-existing");
  const peopleIdx = argv.indexOf("--people");
  const peopleArg = peopleIdx >= 0 ? argv[peopleIdx + 1] : undefined;
  const filePath = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--people");

  if (!filePath) {
    fatal(
      "usage: import-roadmap.ts <path.json> --people key=email[,key=email...] [--dry-run] [--update-existing]\n" +
        "  (no --update-existing: create-only - existing live rows are left as is)",
    );
  }
  if (!peopleArg) fatal("missing --people key=email[,key=email...]");

  // Emails are matched case-insensitively and trimmed - normalize once here so every later
  // comparison (both against the --people map and against user_profiles.email) agrees.
  const peopleByKey = new Map<string, string>();
  for (const pair of peopleArg.split(",")) {
    const [key, rawEmail] = pair.split("=").map((s) => s.trim());
    if (!key || !rawEmail) fatal(`bad --people entry: "${pair}" (want key=email)`);
    peopleByKey.set(key, normalizeEmail(rawEmail));
  }

  return { filePath, dryRun, updateExisting, peopleByKey };
}

// ---- input validation (before any DB touch) ----------------------------------------------

interface RoadmapFile {
  tasks: RoadmapDevRow[];
  mkt: RoadmapMktRow[];
}

function readAndValidate(filePath: string): RoadmapFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    fatal(`could not read/parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof raw !== "object" || raw === null) fatal("input must be a JSON object { tasks: [], mkt: [] }");
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tasks)) fatal('input.tasks must be an array (use [] if there are none)');
  if (!Array.isArray(obj.mkt)) fatal('input.mkt must be an array (use [] if there are none)');

  const errors: string[] = [];

  const devRows = obj.tasks as unknown[];
  devRows.forEach((r, i) => {
    const row = r as Partial<RoadmapDevRow>;
    const id = row.id ?? `#${i}`;
    if (typeof row.id !== "number") errors.push(`dev row ${id}: id must be a number`);
    if (typeof row.title !== "string" || !row.title.trim()) errors.push(`dev row ${id}: title must be a non-empty string`);
    if (typeof row.desc !== "string") errors.push(`dev row ${id}: desc must be a string`);
    if (typeof row.ph !== "number") errors.push(`dev row ${id}: ph must be a number`);
    if (row.as !== null && typeof row.as !== "string") errors.push(`dev row ${id}: as must be a string or null`);
    if (typeof row.pri !== "string" || !DEV_PRIORITIES.has(row.pri)) {
      errors.push(`dev row ${id}: unknown pri "${String(row.pri)}" (want one of ${[...DEV_PRIORITIES].join("/")})`);
    }
    if (typeof row.st !== "string" || !DEV_STATUSES.has(row.st)) {
      errors.push(`dev row ${id}: unknown st "${String(row.st)}" (want one of ${[...DEV_STATUSES].join("/")})`);
    }
  });

  const mktRows = obj.mkt as unknown[];
  mktRows.forEach((r, i) => {
    const row = r as Partial<RoadmapMktRow>;
    const id = row.id ?? `#${i}`;
    if (typeof row.id !== "string") errors.push(`mkt row ${id}: id must be a string`);
    if (typeof row.title !== "string" || !row.title.trim()) errors.push(`mkt row ${id}: title must be a non-empty string`);
    if (typeof row.desc !== "string") errors.push(`mkt row ${id}: desc must be a string`);
    if (typeof row.prog !== "number") errors.push(`mkt row ${id}: prog must be a number`);
    if (row.as !== null && typeof row.as !== "string") errors.push(`mkt row ${id}: as must be a string or null`);
    if (typeof row.pri !== "string" || !MKT_PRIORITIES.has(row.pri)) {
      errors.push(`mkt row ${id}: unknown pri "${String(row.pri)}" (want one of ${[...MKT_PRIORITIES].join("/")})`);
    }
    if (typeof row.st !== "string" || !MKT_STATUSES.has(row.st)) {
      errors.push(`mkt row ${id}: unknown st "${String(row.st)}" (want one of ${[...MKT_STATUSES].join("/")})`);
    }
    if (typeof row.ch !== "string" || !MKT_CHANNEL_SET.has(row.ch)) {
      errors.push(`mkt row ${id}: unknown ch "${String(row.ch)}" (want one of ${[...MKT_CHANNEL_SET].join("/")})`);
    }
  });

  if (errors.length) {
    fatal(`${errors.length} invalid row(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  return { tasks: devRows as RoadmapDevRow[], mkt: mktRows as RoadmapMktRow[] };
}

// ---- existing roadmap rows (including soft-deleted ones), one query ----------------------

const FULL_COLUMNS =
  "id,title,description,status,priority,assignee_id,source_ref,board,phase,channel,progress,deleted_at,created_at,updated_at";
const BASE_COLUMNS = "id,title,description,status,priority,assignee_id,source_ref,deleted_at,created_at,updated_at";

interface ExistingRow extends ExistingTaskForPlan {
  source_ref: { kind: string; row_id: string | number } | null;
}

/** hasNewColumns is false when board/phase/channel/progress aren't migrated yet - only
 *  possible in --dry-run (a real run refuses before getting here, see refuseIfBoardMissing).
 *  Deliberately NOT filtered on deleted_at: a soft-deleted roadmap task must still be
 *  recognised by planRow so it's classified `skipped_deleted` instead of being recreated. */
async function loadExistingRoadmapTasks(): Promise<{ rows: ExistingRow[]; hasNewColumns: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const full = await db.from("tasks").select(FULL_COLUMNS).eq("source", "roadmap");
  if (!full.error) return { rows: (full.data ?? []) as ExistingRow[], hasNewColumns: true };
  if (!isMissingColumnError(full.error)) {
    fatal(`failed to load existing roadmap tasks: ${JSON.stringify(full.error)}`);
  }
  const base = await db.from("tasks").select(BASE_COLUMNS).eq("source", "roadmap");
  if (base.error) fatal(`failed to load existing roadmap tasks: ${JSON.stringify(base.error)}`);
  const rows = ((base.data ?? []) as Omit<ExistingRow, "board" | "phase" | "channel" | "progress">[]).map((r) => ({
    ...r,
    board: null,
    phase: null,
    channel: null,
    progress: null,
  }));
  return { rows, hasNewColumns: false };
}

async function refuseIfBoardMissing(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const probe = await db.from("tasks").select("board").limit(1);
  if (probe.error && isMissingColumnError(probe.error)) {
    fatal(
      "Refusing real import: tasks.board column does not exist yet - apply migration 20260916120000_tasks_hub first.",
    );
  }
  if (probe.error) fatal(`failed to probe tasks.board: ${JSON.stringify(probe.error)}`);
}

// ---- diffing (thin wrapper over the pure planRow in lib/roadmap-import.ts) ----------------

function buildPlan(
  inserts: RoadmapInsert[],
  existing: ExistingRow[],
  updateExisting: boolean,
  hasNewColumns: boolean,
): PlannedRow[] {
  const byKey = new Map<string, ExistingRow>();
  for (const row of existing) {
    const key = sourceRefKey(row.source_ref);
    if (key) byKey.set(key, row);
  }
  return inserts.map((insert) => {
    const key = sourceRefKey(insert.source_ref);
    const match = key ? byKey.get(key) : undefined;
    return planRow(insert, match, updateExisting, hasNewColumns);
  });
}

// ---- reporting --------------------------------------------------------------------------

const GROUP_LABELS: Record<PlannedRow["kind"], string> = {
  create: "create",
  update: "update",
  unchanged: "unchanged",
  existing: "existing (left as is)",
  skipped_deleted: "skipped (deleted in /tasks)",
};

function printSummary(plan: PlannedRow[], userIdByKey: Map<string, string>) {
  const groups = {
    create: plan.filter((p) => p.kind === "create"),
    update: plan.filter((p) => p.kind === "update"),
    unchanged: plan.filter((p) => p.kind === "unchanged"),
    existing: plan.filter((p) => p.kind === "existing"),
    skipped_deleted: plan.filter((p) => p.kind === "skipped_deleted"),
  };
  console.log(
    `create ${groups.create.length} / update ${groups.update.length} / unchanged ${groups.unchanged.length} / ` +
      `existing (left as is) ${groups.existing.length} / skipped (deleted in /tasks) ${groups.skipped_deleted.length}`,
  );
  for (const kind of ["create", "update", "unchanged", "existing", "skipped_deleted"] as const) {
    const rows = groups[kind];
    if (!rows.length) continue;
    console.log(`\n${GROUP_LABELS[kind]} (first ${Math.min(5, rows.length)} of ${rows.length}):`);
    for (const p of rows.slice(0, 5)) {
      const warn = p.kind === "update" && p.editedSinceImport ? " ⚠ edited in /tasks since import" : "";
      console.log(`  - ${p.insert.title}${warn}`);
    }
  }

  const idToKey = new Map<string, string>();
  for (const [key, id] of userIdByKey) idToKey.set(id, key);
  const counts = new Map<string, number>();
  for (const key of userIdByKey.keys()) counts.set(key, 0);
  counts.set("unassigned", 0);
  for (const p of plan) {
    const key = p.insert.assignee_id ? idToKey.get(p.insert.assignee_id) : undefined;
    const bucket = key ?? "unassigned";
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  console.log("\nassignments:");
  for (const [key, count] of counts) console.log(`  ${key}: ${count}`);
}

// ---- main -----------------------------------------------------------------------------

async function main() {
  const { filePath, dryRun, updateExisting, peopleByKey } = parseArgs(process.argv.slice(2));
  const file = readAndValidate(filePath);

  // 1. every `as` key used in the data must have a --people mapping.
  const keysInData = new Set<string>();
  for (const row of file.tasks) if (row.as) keysInData.add(row.as);
  for (const row of file.mkt) if (row.as) keysInData.add(row.as);
  const unmappedKeys = [...keysInData].filter((k) => !peopleByKey.has(k));
  if (unmappedKeys.length) {
    fatal(`no --people mapping for: ${unmappedKeys.join(", ")}`);
  }

  // 2. REAL runs only: refuse before touching user_profiles if the migration hasn't landed.
  if (!dryRun) await refuseIfBoardMissing();

  // 3. every mapped email must resolve to a real user_profiles row - matched
  // case-insensitively and trimmed (peopleByKey values are already normalized by
  // parseArgs). `.ilike` without wildcard characters is an exact case-insensitive
  // match, so this doesn't depend on the DB's collation the way `.in()` would.
  const emails = [...new Set(peopleByKey.values())];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const emailFilter = emails.map((e) => `email.ilike.${e.replace(/[%_]/g, "\\$&")}`).join(",");
  const { data: profiles, error: profilesError } = await db
    .from("user_profiles")
    .select("id,email")
    .or(emailFilter);
  if (profilesError) fatal(`failed to look up user_profiles: ${JSON.stringify(profilesError)}`);

  const idByEmail = new Map<string, string>();
  for (const p of (profiles ?? []) as { id: string; email: string }[]) idByEmail.set(normalizeEmail(p.email), p.id);
  const unmatchedEmails = emails.filter((e) => !idByEmail.has(e));
  if (unmatchedEmails.length) {
    fatal(`no user_profiles row for: ${unmatchedEmails.join(", ")}`);
  }

  const userIdByKey = new Map<string, string>();
  for (const [key, email] of peopleByKey) {
    const id = idByEmail.get(email);
    if (!id) fatal(`internal: no id resolved for ${email}`); // unreachable - checked above
    userIdByKey.set(key, id);
  }

  // 4. map + diff.
  const inserts: RoadmapInsert[] = [
    ...file.tasks.map((row) => mapDevTask(row, userIdByKey)),
    ...file.mkt.map((row) => mapMktTask(row, userIdByKey)),
  ];
  const { rows: existing, hasNewColumns } = await loadExistingRoadmapTasks();
  const plan = buildPlan(inserts, existing, updateExisting, hasNewColumns);

  if (dryRun) {
    printSummary(plan, userIdByKey);
    return;
  }

  // 5. write: creates in one batch insert; updates (only with --update-existing, and only
  // rows that actually differ - skipped_deleted/existing are never written).
  const creates = plan.filter((p) => p.kind === "create").map((p) => p.insert);
  if (creates.length) {
    const { error } = await db.from("tasks").insert(creates).select("id");
    if (error) fatal(`insert failed: ${JSON.stringify(error)}`);
  }

  // Updates are per-row and NOT transactional: a failure mid-way leaves the earlier rows
  // written, and a re-run reports the true remainder (already-updated rows come back
  // `unchanged`, so nothing is double-applied).
  for (const p of plan) {
    if (p.kind !== "update" || !p.existingId) continue;
    const { insert } = p;
    const { error } = await db
      .from("tasks")
      .update({
        title: insert.title,
        description: insert.description,
        status: insert.status,
        priority: insert.priority,
        assignee_id: insert.assignee_id,
        board: insert.board,
        phase: insert.phase,
        channel: insert.channel,
        progress: insert.progress,
        // Refresh the label in source_ref too (kind/table/row_id/url are stable identity,
        // only the label can go stale when the roadmap's title changed).
        source_ref: insert.source_ref,
      })
      .eq("id", p.existingId);
    if (error) fatal(`update failed for ${p.existingId}: ${JSON.stringify(error)}`);
  }

  printSummary(plan, userIdByKey);
}

main().catch((err) => {
  if (err instanceof FatalError) {
    console.error(err.message);
  } else {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  }
  process.exitCode = 1;
});
