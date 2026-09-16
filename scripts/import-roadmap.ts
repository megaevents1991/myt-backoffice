/**
 * One-time, idempotent import of the old roadmap board (a separate app that kept its
 * tasks only in a browser's localStorage) into the `tasks` table.
 *
 *   npx tsx scripts/import-roadmap.ts <path.json> --people dor=a@x.com,alon=b@y.com,tom=c@z.com [--dry-run]
 *
 * Export the source file from the old app's console first - see
 * docs/superpowers/roadmap-export-snippet.md. A synthetic fixture for a dry run without
 * Dor's real export lives at scripts/fixtures/roadmap-sample.json.
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
 *   4. Every mapped email actually has a `user_profiles` row.
 *
 * Existing `source = 'roadmap'` tasks are loaded in ONE query and diffed in memory against
 * the freshly-mapped rows (keyed on `source_ref.kind` + `source_ref.row_id`) - never one
 * query per input row. An update only writes when a mapped field actually differs, so a
 * second real run reports `update 0`.
 */
import { readFileSync } from "node:fs";
import { supabase } from "@/lib/supabase-server";
import { MKT_CHANNELS } from "@/types/task.types";
import {
  mapDevTask,
  mapMktTask,
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

// ---- CLI args ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const peopleIdx = argv.indexOf("--people");
  const peopleArg = peopleIdx >= 0 ? argv[peopleIdx + 1] : undefined;
  const filePath = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--people");

  if (!filePath) fatal("usage: import-roadmap.ts <path.json> --people key=email[,key=email...] [--dry-run]");
  if (!peopleArg) fatal("missing --people key=email[,key=email...]");

  const peopleByKey = new Map<string, string>();
  for (const pair of peopleArg.split(",")) {
    const [key, email] = pair.split("=").map((s) => s.trim());
    if (!key || !email) fatal(`bad --people entry: "${pair}" (want key=email)`);
    peopleByKey.set(key, email);
  }

  return { filePath, dryRun, peopleByKey };
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

// ---- existing roadmap rows, one query -----------------------------------------------------

interface ExistingRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_id: string | null;
  source_ref: { kind: string; row_id: string | number } | null;
  board: string | null;
  phase: number | null;
  channel: string | null;
  progress: number | null;
}

const FULL_COLUMNS = "id,title,description,status,priority,assignee_id,source_ref,board,phase,channel,progress";
const BASE_COLUMNS = "id,title,description,status,priority,assignee_id,source_ref";

/** hasNewColumns is false when board/phase/channel/progress aren't migrated yet - only
 *  possible in --dry-run (a real run refuses before getting here, see refuseIfBoardMissing). */
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

// ---- diffing --------------------------------------------------------------------------

type Plan = { kind: "create" | "update" | "unchanged"; insert: RoadmapInsert; existingId?: string };

function existingKey(ref: { kind: string; row_id: string | number } | null | undefined): string | null {
  if (!ref) return null;
  return `${ref.kind}:${ref.row_id}`;
}

function differs(insert: RoadmapInsert, existing: ExistingRow, hasNewColumns: boolean): boolean {
  if (insert.title !== existing.title) return true;
  if (insert.description !== existing.description) return true;
  if (insert.status !== existing.status) return true;
  if (insert.priority !== existing.priority) return true;
  if (insert.assignee_id !== existing.assignee_id) return true;
  if (!hasNewColumns) return false; // can't compare fields the DB doesn't have yet
  if (insert.board !== existing.board) return true;
  if (insert.phase !== existing.phase) return true;
  if (insert.channel !== existing.channel) return true;
  if (insert.progress !== existing.progress) return true;
  return false;
}

function buildPlan(inserts: RoadmapInsert[], existing: ExistingRow[], hasNewColumns: boolean): Plan[] {
  const byKey = new Map<string, ExistingRow>();
  for (const row of existing) {
    const key = existingKey(row.source_ref);
    if (key) byKey.set(key, row);
  }
  return inserts.map((insert) => {
    const key = existingKey(insert.source_ref);
    const match = key ? byKey.get(key) : undefined;
    if (!match) return { kind: "create", insert };
    return { kind: differs(insert, match, hasNewColumns) ? "update" : "unchanged", insert, existingId: match.id };
  });
}

// ---- reporting --------------------------------------------------------------------------

function printSummary(plan: Plan[], userIdByKey: Map<string, string>) {
  const groups = {
    create: plan.filter((p) => p.kind === "create"),
    update: plan.filter((p) => p.kind === "update"),
    unchanged: plan.filter((p) => p.kind === "unchanged"),
  };
  console.log(`create ${groups.create.length} / update ${groups.update.length} / unchanged ${groups.unchanged.length}`);
  for (const name of ["create", "update", "unchanged"] as const) {
    const rows = groups[name];
    if (!rows.length) continue;
    console.log(`\n${name} (first ${Math.min(5, rows.length)} of ${rows.length}):`);
    for (const p of rows.slice(0, 5)) console.log(`  - ${p.insert.title}`);
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
  const { filePath, dryRun, peopleByKey } = parseArgs(process.argv.slice(2));
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

  // 3. every mapped email must resolve to a real user_profiles row.
  const emails = [...new Set(peopleByKey.values())];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: profiles, error: profilesError } = await db
    .from("user_profiles")
    .select("id,email")
    .in("email", emails);
  if (profilesError) fatal(`failed to look up user_profiles: ${JSON.stringify(profilesError)}`);

  const idByEmail = new Map<string, string>();
  for (const p of (profiles ?? []) as { id: string; email: string }[]) idByEmail.set(p.email, p.id);
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
  const plan = buildPlan(inserts, existing, hasNewColumns);

  if (dryRun) {
    printSummary(plan, userIdByKey);
    return;
  }

  // 5. write: creates in one batch insert, updates one at a time (only when they differ).
  const creates = plan.filter((p) => p.kind === "create").map((p) => p.insert);
  if (creates.length) {
    const { error } = await db.from("tasks").insert(creates).select("id");
    if (error) fatal(`insert failed: ${JSON.stringify(error)}`);
  }
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
