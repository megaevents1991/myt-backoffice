/**
 * Company scoping of `public.tasks` - the safety net of the per-company task board.
 *
 *   npx tsx --env-file=.env.development.local scripts/tasks-company-scope-selftest.ts [--static-only]
 *
 * `tasks` is shared by the Mega Events team board and by the board of every other
 * company (Mega Family). The service-role client bypasses RLS, so the only thing
 * that keeps a Mega Family task off the Mega Events board, out of its automations
 * and out of reach of its people - and the other way round - is the company filter
 * in code. This script fails (exit 1) when that filter is missing anywhere.
 *
 * Part 1 - static. Scans lib/, app/, components/, hooks/ and contexts/ for every
 * way of reaching the table and fails on any that is not scoped:
 *   A. a direct `.from("tasks")` is allowed only inside lib/tasks-scope.ts, or when
 *      the SAME statement carries `.eq("company_id", ...)` (reads, updates) or a
 *      `company_id` in its payload (inserts). One file is allow-listed by name:
 *      the overdue cron, which reads every company on purpose;
 *   B. the table name handed to a generic table helper: "tasks" as the first
 *      argument of a call, or anywhere in a file that has a dynamic
 *      `.from(<variable>)`;
 *   C. a PostgREST embed of the relation (`select("..., tasks(...)")`) needs
 *      `.eq("tasks.company_id", ...)` in the same statement;
 *   D. the child tables keyed by a task id (`task_comments`, `task_reads`) and the
 *      `task-attachments` bucket may be used only by files that resolve the parent
 *      task through a scope; `recordActivity` only from such files;
 *   E. `tasksOf(...)` takes the server-resolved company, nothing else;
 *   F. no rpc touches tasks;
 *   G. every action of the task board starts with `requireTaskBoard()`;
 *   H. a mailed task link is built by `taskUrl()` (it carries the task's company).
 *
 * Part 2 - data, against the LOCAL database only (refuses any other URL). Works
 * on throw-away tasks it creates in a second company and removes at the end;
 * existing rows are only read, or "updated" to the value they already hold.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { supabase } from "@/lib/supabase-server";
import { fetchPaged } from "@/lib/supabase-paged";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { megaEventsTasks, tasksOf, type TaskResult } from "@/lib/tasks-scope";
import { PLAIN_TASK_BOARD, hasEventsTaskBoard, taskBoardsOf } from "@/lib/services/task-company";
import { pickTaskPeople, taskPeopleOf } from "@/lib/services/task-people";
import { taskUrl } from "@/lib/services/task-site-url";
import { runOverdueAlerts } from "@/lib/services/task-overdue-alerts";
import { STAFF_ROLES } from "@/types/auth.types";
import { OPEN_TASK_STATUSES, TASK_BOARDS } from "@/types/task.types";

const STATIC_ONLY = process.argv.includes("--static-only");
const ROOT = process.cwd();

let failed = 0;
function ok(name: string) {
  console.log(`ok   ${name}`);
}
function fail(name: string, detail: string) {
  failed++;
  console.error(`FAIL ${name}: ${detail}`);
}
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) ok(name);
  else fail(name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function truthy(name: string, value: unknown, detail = "expected a truthy value") {
  if (value) ok(name);
  else fail(name, detail);
}

// ============================================================ part 1: static
const SCAN_DIRS = ["lib", "app", "components", "hooks", "contexts"];
const SCOPE_FILE = "lib/tasks-scope.ts";

/**
 * Files that read `tasks` with NO company filter, on purpose, as "file" ->
 * { how many such statements, why }. The count is pinned: one more unscoped
 * statement in the file fails the scan.
 */
const DIRECT_ALLOW: Record<string, { statements: number; reason: string }> = {
  "lib/services/task-overdue-alerts.ts": {
    statements: 1,
    reason:
      "the daily overdue cron mails each late task's opener whatever company the task is in; it reads " +
      "company_id with every row and each mailed link names its task's own company (taskUrl)",
  },
};

/**
 * Files that touch the child tables / the bucket, or call recordActivity, without
 * holding a scope themselves, as "file" -> reason.
 */
const CHILD_ALLOW: Record<string, string> = {
  "lib/services/task-activity.ts":
    "recordActivity writes the activity row of a task id its CALLER resolved - callers are checked by rule D",
  "lib/services/task-overdue-alerts.ts":
    "the cross-company overdue cron (see DIRECT_ALLOW) reads the threads of the tasks it just read",
};

/** Calls that may take "tasks" as their first argument, as "file#callee" -> reason. Empty on purpose. */
const CALL_ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** A line that is nothing but a comment. Trailing comments stay "code" on purpose (fail closed). */
function isCommentLine(source: string, index: number): boolean {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  const line = source.slice(start, end === -1 ? source.length : end).trim();
  return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || line.startsWith("{/*");
}

/**
 * The rest of the statement that starts at `index` (a position inside code):
 * up to the `;`, `,`, `:` or closing bracket that ends the expression. Strings
 * and comments are skipped, so a filter mentioned in a comment does not count.
 */
function statementFrom(source: string, index: number): string {
  let depth = 0;
  let out = "";
  for (let i = index; i < source.length && i < index + 6000; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", i);
      i = eol === -1 ? source.length : eol - 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) break;
    } else if (depth === 0 && (ch === ";" || ch === "," || ch === ":")) break;
    else if (depth === 0 && ch === "?" && next !== ".") break;
    out += ch;
  }
  return out;
}

/** Every string literal of a source file (comments skipped), with where it starts. */
function stringLiterals(source: string): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", i);
      i = eol === -1 ? source.length : eol;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close === -1 ? source.length : close + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
      out.push({ index: i, text: source.slice(i + 1, j) });
      i = j;
    }
  }
  return out;
}

const COMPANY_EQ = /\.eq\(\s*["'`]company_id["'`]\s*,/;
const DIRECT = /\.from\(\s*(["'`])tasks\1\s*\)/g;
const LITERAL = /(["'`])tasks\1/g;
const CALL_WITH_TABLE = /\b([A-Za-z_$][\w$]*)\(\s*(["'`])tasks\2\s*[,)]/g;
/** `tasks(...)` / `alias:tasks!fk(...)` inside a select column list. */
const EMBED_IN_STRING = /(^|[,\s(])(?:\w+\s*:\s*)?tasks\s*(?:!\w+\s*)?\(/;
const DYNAMIC_FROM = /(?<!Array|Buffer|Object|String|Uint8Array|storage)\.from\(\s*[A-Za-z_$][\w$.]*\s*\)/g;
const TASK_KEYED = /\.from\(\s*["'`](task_comments|task_reads|task-attachments)["'`]\s*\)/g;
const HOLDS_SCOPE = /\b(requireTaskBoard|megaEventsTasks|tasksOf)\(/;
const TASKS_OF = /\btasksOf\(\s*([^)]*)\)/g;
const RPC = /\.rpc\(\s*["'`]([^"'`]*task[^"'`]*)["'`]/gi;
const RAW_TASK_LINK = /\/tasks\?task=/g;

/** The files whose every export is an action of the task board. */
const BOARD_ACTION_FILES = ["lib/actions/task-actions.ts", "lib/actions/task-comment-actions.ts"];

type Site = { where: string; how: string };
const sites: Site[] = [];

function staticScan() {
  const files = SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
  truthy("static: source files found", files.length > 500, `only ${files.length} files under ${SCAN_DIRS.join(", ")}`);

  let unscoped = 0;
  const allowedDirect = new Map<string, number>();
  for (const file of files) {
    const name = rel(file);
    const source = readFileSync(file, "utf8");
    if (name === SCOPE_FILE) continue;

    // ---- A. direct access
    const directAt = new Set<number>();
    for (const match of source.matchAll(DIRECT)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      directAt.add(source.indexOf("tasks", index));
      const where = `${name}:${lineOf(source, index)}`;
      const statement = statementFrom(source, index);
      const writesRows = /\.(insert|upsert)\(/.test(statement);
      const scoped = writesRows ? /\bcompany_id\b/.test(statement) : COMPANY_EQ.test(statement);
      if (scoped) {
        sites.push({ where, how: writesRows ? "direct insert with company_id" : 'direct, .eq("company_id")' });
      } else if (DIRECT_ALLOW[name]) {
        allowedDirect.set(name, (allowedDirect.get(name) ?? 0) + 1);
        sites.push({ where, how: `ALLOW-LISTED: ${DIRECT_ALLOW[name].reason}` });
        // An allow-listed read must still be a read, and must know each row's company.
        if (/\.(insert|upsert|update|delete)\(/.test(statement)) {
          unscoped++;
          fail(`static: ${where}`, "an allow-listed cross-company statement may only read");
        } else if (!/\bcompany_id\b/.test(statement)) {
          unscoped++;
          fail(`static: ${where}`, "an allow-listed cross-company read must select company_id");
        }
      } else {
        unscoped++;
        fail(`static: ${where}`, `.from("tasks") with no company filter in the same statement - use tasksOf(company) / megaEventsTasks()`);
      }
    }

    // ---- B. the table name handed to a generic table helper
    const dynamic = [...source.matchAll(DYNAMIC_FROM)].filter((m) => !isCommentLine(source, m.index ?? 0));
    if (dynamic.length > 0) {
      for (const match of source.matchAll(LITERAL)) {
        const index = match.index ?? 0;
        if (isCommentLine(source, index) || directAt.has(index + 1)) continue;
        unscoped++;
        fail(
          `static: ${name}:${lineOf(source, index)}`,
          `the string "tasks" in a file with a dynamic .from(<variable>) (line ${lineOf(source, dynamic[0].index ?? 0)}) - the company scope cannot be checked`,
        );
      }
    }
    for (const match of source.matchAll(CALL_WITH_TABLE)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const callee = match[1];
      if (callee === "from") continue; // rule A
      const where = `${name}:${lineOf(source, index)}`;
      const reason = CALL_ALLOW[`${name}#${callee}`];
      if (reason && dynamic.length === 0) {
        sites.push({ where, how: `${callee}("tasks") ALLOW-LISTED: ${reason}` });
      } else {
        unscoped++;
        fail(`static: ${where}`, `${callee}("tasks", ...) hands the table name to a helper - the company scope is bypassed`);
      }
    }

    // ---- C. embeds of the relation from another table (only inside a query's column list)
    for (const literal of stringLiterals(source)) {
      if (!EMBED_IN_STRING.test(literal.text)) continue;
      const before = source.slice(Math.max(0, literal.index - 12), literal.index);
      if (!/\.select\(\s*$/.test(before)) continue;
      const lineStart = source.lastIndexOf("\n", literal.index) + 1;
      const statement = statementFrom(source, lineStart);
      const where = `${name}:${lineOf(source, literal.index)}`;
      if (/\.eq\(\s*["'`]tasks\.company_id["'`]\s*,/.test(statement)) {
        sites.push({ where, how: 'embed, .eq("tasks.company_id")' });
      } else {
        unscoped++;
        fail(`static: ${where}`, 'embeds the tasks relation with no .eq("tasks.company_id", ...)');
      }
    }

    // ---- D. the child tables, the bucket and recordActivity
    const holdsScope = HOLDS_SCOPE.test(source);
    for (const match of source.matchAll(TASK_KEYED)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const where = `${name}:${lineOf(source, index)}`;
      if (holdsScope) {
        sites.push({ where, how: `${match[1]} (parent task resolved through a scope in this file)` });
      } else if (CHILD_ALLOW[name]) {
        sites.push({ where, how: `${match[1]} ALLOW-LISTED: ${CHILD_ALLOW[name]}` });
      } else {
        unscoped++;
        fail(`static: ${where}`, `${match[1]} is keyed by a task id - resolve the task through tasksOf(company) / megaEventsTasks() in this file`);
      }
    }
    for (const match of source.matchAll(/\brecordActivity\(/g)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      if (/export async function recordActivity\($/.test(source.slice(Math.max(0, index - 22), index + 15))) continue;
      const where = `${name}:${lineOf(source, index)}`;
      if (holdsScope) sites.push({ where, how: "recordActivity (task resolved through a scope in this file)" });
      else if (CHILD_ALLOW[name]) sites.push({ where, how: `recordActivity ALLOW-LISTED: ${CHILD_ALLOW[name]}` });
      else {
        unscoped++;
        fail(`static: ${where}`, "recordActivity writes a thread row by task id - the file must resolve the task through a scope");
      }
    }

    // ---- E. the helper takes the server-resolved company
    for (const match of source.matchAll(TASKS_OF)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      const where = `${name}:${lineOf(source, index)}`;
      const arg = match[1].trim();
      const resolved = /\b(requireCompany|getActiveCompany)\(/.test(source);
      if (arg === "company" && resolved) {
        sites.push({ where, how: "tasksOf(company) - active company" });
      } else {
        unscoped++;
        fail(`static: ${where}`, `tasksOf(${arg}) - pass the company from requireCompany()/getActiveCompany(), named "company"`);
      }
    }
    for (const match of source.matchAll(/\bmegaEventsTasks\(\)/g)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      sites.push({ where: `${name}:${lineOf(source, index)}`, how: "megaEventsTasks() - constant scope" });
    }
    for (const match of source.matchAll(/\bawait requireTaskBoard\(\)/g)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      sites.push({ where: `${name}:${lineOf(source, index)}`, how: "requireTaskBoard() - active company's scope" });
    }

    // ---- F. rpc
    for (const match of source.matchAll(RPC)) {
      const index = match.index ?? 0;
      if (isCommentLine(source, index)) continue;
      unscoped++;
      fail(`static: ${name}:${lineOf(source, index)}`, `rpc "${match[1]}" touches tasks - an rpc cannot be checked for a company filter here`);
    }

    // ---- H. a mailed task link carries the company: built by taskUrl() only
    if (name.startsWith("lib/") && name !== "lib/services/task-site-url.ts") {
      for (const match of source.matchAll(RAW_TASK_LINK)) {
        const index = match.index ?? 0;
        if (isCommentLine(source, index)) continue;
        unscoped++;
        fail(`static: ${name}:${lineOf(source, index)}`, 'a task link built by hand - use taskUrl(taskId, companyId) so it carries "company="');
      }
    }
  }

  // ---- A (cont.) the allow-listed files hold exactly the statements they were allowed
  for (const [file, allowed] of Object.entries(DIRECT_ALLOW)) {
    check(`static: ${file} holds exactly ${allowed.statements} cross-company read(s)`, allowedDirect.get(file) ?? 0, allowed.statements);
  }

  // ---- G. every export of the board's action files starts with requireTaskBoard()
  for (const name of BOARD_ACTION_FILES) {
    const source = readFileSync(path.join(ROOT, name), "utf8").replace(/\r\n/g, "\n");
    truthy(`static: ${name} is a "use server" file`, /^"use server";/.test(source), 'expected "use server" on the first line');
    truthy(`static: ${name} no longer calls requireStaff()`, !/\brequireStaff\(/.test(source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")), "requireStaff() is the Mega Events gate - the board uses requireTaskBoard()");
    const exports = [...source.matchAll(/export async function (\w+)\(/g)];
    // A floor that proves the pattern above found the exports at all (the thread file holds 7
    // since the comments, the read stamp and the people load as ONE action - loadTaskThread).
    truthy(`static: ${name} exports actions`, exports.length >= 7, `only ${exports.length} exported functions found`);
    const unguarded: string[] = [];
    for (const match of exports) {
      // The body starts at the first "{" that follows the closing of the signature.
      const bodyStart = source.indexOf("{\n", source.indexOf("Promise<", match.index ?? 0));
      const firstStatement = source.slice(bodyStart + 1, bodyStart + 400).trim().split("\n")[0] ?? "";
      if (!/await requireTaskBoard\(\);$/.test(firstStatement.trim())) unguarded.push(match[1]);
    }
    check(`static: every export of ${name} starts with requireTaskBoard()`, unguarded, []);
  }

  // The scope file is the one place the raw table is named: exactly once.
  const scope = readFileSync(path.join(ROOT, SCOPE_FILE), "utf8");
  const raw = [...scope.matchAll(DIRECT)].filter((m) => !isCommentLine(scope, m.index ?? 0));
  check("static: lib/tasks-scope.ts names the table exactly once", raw.length, 1);
  truthy(
    "static: lib/tasks-scope.ts filters every select, update and ownership lookup by company_id",
    (scope.match(/\.eq\("company_id", companyId\)/g) ?? []).length === 3 && /company_id: companyId/.test(scope),
    'expected .eq("company_id", companyId) on select, update and ownedIds, and the stamp on insert',
  );
  truthy("static: the scope offers no delete and no upsert", !/\.(delete|upsert)\(/.test(scope), "lib/tasks-scope.ts must not delete or upsert");

  const scopedSites = sites.filter((s) => !s.how.includes("ALLOW-LISTED"));
  truthy("static: tasks call sites found", scopedSites.length >= 30, `only ${scopedSites.length} - the scanner lost its targets`);
  if (unscoped === 0) ok(`static: ${scopedSites.length} tasks call sites, all scoped (${sites.length - scopedSites.length} allow-listed)`);

  console.log("\n  tasks call sites");
  for (const site of sites) console.log(`    ${site.where.padEnd(52)} ${site.how}`);
  console.log("");
}

// ============================================================ pure rules
const OTHER_COMPANY = "b4e2d3c5-6c7f-4a81-9ba2-c3d4e5f6a702";

function pureChecks() {
  const throws = (fn: () => unknown) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  check(
    "scope: an empty or malformed company id is refused",
    [throws(() => tasksOf({ id: "" })), throws(() => tasksOf({ id: undefined as unknown as string })), throws(() => tasksOf({ id: "1 or 1=1" }))],
    [true, true, true],
  );

  // What the board of each kind of company holds.
  check("board: a company that sells events keeps the four boards", taskBoardsOf({ productTypes: ["events"] }), [...TASK_BOARDS]);
  check("board: a tours company has the one plain board", taskBoardsOf({ productTypes: ["tours"] }), [PLAIN_TASK_BOARD]);
  check("board: the plain board is ops (the column default, and what the deadline tasks use)", PLAIN_TASK_BOARD, "ops");
  check(
    "board: the Mega Events features follow the product type",
    [hasEventsTaskBoard({ productTypes: ["events"] }), hasEventsTaskBoard({ productTypes: ["tours"] }), hasEventsTaskBoard({ productTypes: ["events", "tours"] })],
    [true, false, true],
  );

  // Who a task may go to (lib/services/task-people.ts) - on made-up rows.
  const person = (id: string, role: string) => ({ id, role, display_name: id, email: `${id}@example.test` });
  const staff = [person("root", "superadmin"), person("me-admin", "admin"), person("floating", "editor"), person("mf-editor", "editor"), person("both", "editor")];
  const memberships = [
    { user_id: "me-admin", company_id: MEGA_EVENTS_COMPANY_ID },
    { user_id: "mf-editor", company_id: OTHER_COMPANY },
    { user_id: "both", company_id: MEGA_EVENTS_COMPANY_ID },
    { user_id: "both", company_id: OTHER_COMPANY },
  ];
  const ids = (people: { id: string }[]) => people.map((p) => p.id);
  check(
    "people: Mega Events = its staff, accounts with no company, superadmins - not a member of other companies only",
    ids(pickTaskPeople(staff, memberships, MEGA_EVENTS_COMPANY_ID)),
    ["root", "me-admin", "floating", "both"],
  );
  check("people: another company = its members and the superadmins", ids(pickTaskPeople(staff, memberships, OTHER_COMPANY)), ["root", "mf-editor", "both"]);
  check("people: with no memberships at all Mega Events is the whole staff list", ids(pickTaskPeople(staff, [], MEGA_EVENTS_COMPANY_ID)), ids(staff));
  check("people: with no memberships another company has superadmins only", ids(pickTaskPeople(staff, [], OTHER_COMPANY)), ["root"]);
  check("people: unreadable memberships keep the Mega Events list whole", ids(pickTaskPeople(staff, null, MEGA_EVENTS_COMPANY_ID)), ids(staff));
  check("people: unreadable memberships give another company superadmins only", ids(pickTaskPeople(staff, null, OTHER_COMPANY)), ["root"]);
  check("people: only id, name and email travel", Object.keys(pickTaskPeople(staff, memberships, OTHER_COMPANY)[0] ?? {}).sort(), ["display_name", "email", "id"]);
}

// ============================================================ part 2: data
type Row = { id: string; company_id: string; title: string; status: string; board: string; deleted_at: string | null };

// The script's own, deliberately UNSCOPED view of the tables: the ground truth
// the scoped helpers are compared against. Never copy this into app code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawTasks = () => (supabase as any).from("tasks");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawTable = (name: string) => (supabase as any).from(name);

const MARKER = "tasks-company-scope-selftest (safe to delete)";

async function all<T extends { id: string }>(makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
  const { rows, error, truncated } = await fetchPaged<T>(makeQuery, 100_000);
  if (error) throw new Error(error.message);
  if (truncated) throw new Error("more than 100000 rows");
  return rows;
}

const companiesOf = (rows: { company_id?: string }[]) => [...new Set(rows.map((r) => r.company_id))].sort();

async function dataChecks() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
    fail("data: local database only", `NEXT_PUBLIC_SUPABASE_URL is "${url || "(unset)"}" - run with --env-file=.env.development.local (or --static-only)`);
    return;
  }
  ok("data: running against the local database");

  const { data: companies, error: companiesError } = await rawTable("companies").select("id,slug,product_types");
  if (companiesError) throw new Error(companiesError.message);
  const other = ((companies ?? []) as { id: string; slug: string; product_types: string[] }[]).find((c) => c.id !== MEGA_EVENTS_COMPANY_ID);
  truthy("data: a second company exists (isolation can be proven)", other, "only Mega Events in public.companies");
  if (!other) return;
  const OTHER = { id: other.id };
  const meSlug = ((companies ?? []) as { id: string; slug: string }[]).find((c) => c.id === MEGA_EVENTS_COMPANY_ID)?.slug;

  const COLUMNS = "id, company_id, title, status, board, deleted_at";
  const truth = await all<Row>(() => rawTasks().select(COLUMNS).order("id", { ascending: true }));
  const meTruth = truth.filter((r) => r.company_id === MEGA_EVENTS_COMPANY_ID);
  const otherBefore = truth.filter((r) => r.company_id === other.id);
  truthy("data: Mega Events tasks exist", meTruth.length > 0, "no Mega Events task in this database");
  if (meTruth.length === 0) return;
  console.log(`     ${meTruth.length} Mega Events tasks, ${truth.length - meTruth.length} of other companies (${otherBefore.length} in ${other.slug})`);

  const createdIds: string[] = [];
  let commentId: string | null = null;
  try {
    // ---- insert: the scope stamps the company, whatever the payload says
    const { data: created, error: createError } = (await tasksOf(OTHER)
      .insert({
        company_id: MEGA_EVENTS_COMPANY_ID, // what a forged payload would send - must be overwritten
        title: MARKER,
        priority: "low",
        source: "manual",
        board: PLAIN_TASK_BOARD,
        source_ref: { kind: "flight_deadline:names_deadline", table: "flights", row_id: 999000111, label: "selftest", url: "/tours/flights/999000111" },
      })
      .select("id, company_id")) as TaskResult<{ id: string; company_id: string }[]>;
    if (createError) throw new Error(createError.message);
    const mine = created?.[0];
    if (!mine) throw new Error("the throw-away task was not created");
    createdIds.push(mine.id);
    check("insert: company_id comes from the scope, not from the payload", mine.company_id, other.id);

    const { data: batch, error: batchError } = (await tasksOf(OTHER)
      .insert([
        { title: MARKER, priority: "low", company_id: MEGA_EVENTS_COMPANY_ID },
        { title: MARKER, priority: "low" },
      ])
      .select("id, company_id")) as TaskResult<{ id: string; company_id: string }[]>;
    if (batchError) throw new Error(batchError.message);
    createdIds.push(...(batch ?? []).map((r) => r.id));
    check("insert: every row of a batch is stamped", (batch ?? []).map((r) => r.company_id), [other.id, other.id]);

    // ---- lists (listTasks in each company, and every automation's read)
    const meList = await all<Row>(() => megaEventsTasks().select("id, company_id").order("id", { ascending: true }));
    check("list: Mega Events scope returns Mega Events rows only", companiesOf(meList), [MEGA_EVENTS_COMPANY_ID]);
    check("list: Mega Events scope returns every Mega Events row", meList.length, meTruth.length);
    const meBoard = await all<Row>(() => megaEventsTasks().select("id, company_id").is("deleted_at", null).order("created_at", { ascending: false }).order("id", { ascending: true }));
    check("list: the Mega Events board (live rows) is exactly what it was before companies", meBoard.length, meTruth.filter((r) => !r.deleted_at).length);
    const otherList = await all<Row>(() => tasksOf(OTHER).select("id, company_id").order("id", { ascending: true }));
    check("list: the other company's scope returns its rows only", companiesOf(otherList), [other.id]);
    check("list: and every one of them", otherList.length, otherBefore.length + createdIds.length);
    const openKeys = await all<Row>(() => megaEventsTasks().select("id, company_id, source_ref").is("deleted_at", null).in("status", OPEN_TASK_STATUSES).order("id", { ascending: true }));
    check("automations: the open-task dedupe set (rules, price light, pricing gaps) is Mega Events only", companiesOf(openKeys), [MEGA_EVENTS_COMPANY_ID]);

    // ---- lookups by id
    const { data: seenByMe } = await megaEventsTasks().select("id").eq("id", mine.id).maybeSingle();
    check("by id: a task of another company is not found in the Mega Events scope", seenByMe, null);
    const { data: seenIn } = await megaEventsTasks().select("id").in("id", createdIds);
    check("by ids: .in() over another company's ids finds nothing (bulk bar)", (seenIn ?? []).length, 0);
    const { data: own } = await tasksOf(OTHER).select("id, company_id").eq("id", mine.id).maybeSingle();
    check("by id: the task is found in its own scope", own?.id, mine.id);
    const meRow = meTruth[0];
    const { data: meFromOther } = await tasksOf(OTHER).select("id").eq("id", meRow.id).maybeSingle();
    check("by id: a Mega Events task is not found from the other company", meFromOther, null);

    // ---- ownership (the gate of comments, read marks and attachments)
    check(
      "owns: each scope owns its own task and not the other's",
      [await tasksOf(OTHER).owns(mine.id), await megaEventsTasks().owns(mine.id), await megaEventsTasks().owns(meRow.id), await tasksOf(OTHER).owns(meRow.id)],
      [true, false, true, false],
    );
    check("owns: an id that is not a uuid is simply not owned", [await megaEventsTasks().owns("not-a-uuid"), await megaEventsTasks().owns("")], [false, false]);
    check("ownedIds: only the scope's ids come back from a mixed list", [...(await megaEventsTasks().ownedIds([mine.id, meRow.id, ...createdIds]))], [meRow.id]);

    // A thread row on the other company's task: the Mega Events side must not get past the gate.
    const { data: comment, error: commentError } = await rawTable("task_comments")
      .insert({ task_id: mine.id, author_id: null, kind: "comment", body: MARKER, attachments: [], mentions: [] })
      .select("id, task_id")
      .single();
    if (commentError) throw new Error(commentError.message);
    commentId = comment.id as string;
    check("thread: a comment's task of another company is not owned by the Mega Events scope (list / edit / delete are refused)", await megaEventsTasks().owns(comment.task_id), false);

    // ---- the flight-deadline lookup of the tours module (lib/actions/tours-reports-actions.ts)
    const deadlineLookup = (scope: ReturnType<typeof tasksOf>) =>
      scope.select("source_ref").eq("source_ref->>table", "flights").like("source_ref->>kind", "flight_deadline:%").in("source_ref->>row_id", ["999000111"]);
    const { data: takenOther, error: takenError } = await deadlineLookup(tasksOf(OTHER));
    if (takenError) throw new Error(takenError.message);
    check("deadline tasks: the existing-task lookup finds the company's own task", (takenOther ?? []).length, 1);
    const { data: takenMe } = await deadlineLookup(megaEventsTasks());
    check("deadline tasks: and it is invisible from Mega Events", (takenMe ?? []).length, 0);

    // ---- writes. On existing rows each one sets a column to the value it already
    //      has, so even a broken scope changes nothing; what is asserted is "no row matched".
    const { data: w1, error: e1 } = await megaEventsTasks().update({ title: MARKER }).eq("id", mine.id).select("id");
    if (e1) throw new Error(e1.message);
    check("write: an update by id from the Mega Events scope does not reach another company's task", (w1 ?? []).length, 0);
    const { data: w2, error: e2 } = await megaEventsTasks().update({ status: "done", completed_at: new Date().toISOString() }).in("id", createdIds).select("id");
    if (e2) throw new Error(e2.message);
    check("write: a bulk update / auto-close over another company's ids changes nothing", (w2 ?? []).length, 0);
    const { data: w3, error: e3 } = await megaEventsTasks().update({ deleted_at: new Date().toISOString() }).eq("id", mine.id).select("id");
    if (e3) throw new Error(e3.message);
    check("delete: a soft delete from the Mega Events scope does not reach it", (w3 ?? []).length, 0);
    const { data: w4, error: e4 } = await tasksOf(OTHER).update({ title: meRow.title }).eq("id", meRow.id).select("id");
    if (e4) throw new Error(e4.message);
    check("write: the other company cannot update a Mega Events task", (w4 ?? []).length, 0);
    const { data: w5, error: e5 } = (await megaEventsTasks().update({ title: meRow.title }).eq("id", meRow.id).select("id")) as TaskResult<{ id: string }[]>;
    if (e5) throw new Error(e5.message);
    check("write: a Mega Events task is still writable in its own scope", (w5 ?? []).map((r) => r.id), [meRow.id]);
    const { data: moved, error: moveError } = (await tasksOf(OTHER).update({ company_id: MEGA_EVENTS_COMPANY_ID, title: MARKER }).eq("id", mine.id).select("id, company_id")) as TaskResult<{ id: string; company_id: string }[]>;
    if (moveError) throw new Error(moveError.message);
    check("update: a row cannot be moved to another company", (moved ?? []).map((r) => r.company_id), [other.id]);
    const { data: still } = await rawTasks().select("id, company_id, status, deleted_at").eq("id", mine.id).maybeSingle();
    check("write: the throw-away task is untouched by every cross-company write", [still?.company_id, still?.status, still?.deleted_at], [other.id, "todo", null]);

    // ---- people (the assignee / reviewer / @mention pickers)
    const { data: staffRows, error: staffError } = await rawTable("user_profiles").select("id, role, created_at, display_name").in("role", STAFF_ROLES).eq("is_active", true);
    if (staffError) throw new Error(staffError.message);
    const staff = (staffRows ?? []) as { id: string; role: string; created_at: string; display_name: string | null }[];
    const { data: memberRows } = await rawTable("company_members").select("user_id, company_id");
    const members = (memberRows ?? []) as { user_id: string; company_id: string }[];
    const foreignOnly = staff.filter((p) => p.role !== "superadmin" && members.some((m) => m.user_id === p.id) && !members.some((m) => m.user_id === p.id && m.company_id === MEGA_EVENTS_COMPANY_ID)).map((p) => p.id);
    // The lists the pickers showed before companies: listUsers() order for the assignee, display_name for reviewers.
    const { data: byNewest } = await rawTable("user_profiles").select("id").in("role", STAFF_ROLES).eq("is_active", true).order("created_at", { ascending: false });
    const { data: byName } = await rawTable("user_profiles").select("id").in("role", STAFF_ROLES).eq("is_active", true).order("display_name", { ascending: true });
    const without = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id).filter((id) => !foreignOnly.includes(id));
    const meNewest = await taskPeopleOf({ id: MEGA_EVENTS_COMPANY_ID }, "newest");
    const meByName = await taskPeopleOf({ id: MEGA_EVENTS_COMPANY_ID });
    check("people: the Mega Events assignee picker is the staff list it always was, same order", (meNewest ?? []).map((p) => p.id), without(byNewest));
    check("people: the Mega Events reviewer / mention picker likewise", (meByName ?? []).map((p) => p.id), without(byName));
    console.log(`     Mega Events people: ${(meNewest ?? []).length} of ${staff.length} active staff (${foreignOnly.length} work in other companies only)`);
    const otherPeople = (await taskPeopleOf(OTHER)) ?? [];
    const superadmins = staff.filter((p) => p.role === "superadmin").map((p) => p.id);
    const otherMembers = members.filter((m) => m.company_id === other.id).map((m) => m.user_id);
    check("people: the other company offers its members and the superadmins, nobody else", otherPeople.map((p) => p.id).filter((id) => !superadmins.includes(id) && !otherMembers.includes(id)), []);
    check("people: every superadmin is offered in the other company", superadmins.filter((id) => !otherPeople.some((p) => p.id === id)), []);

    // ---- mailed links carry the task's company
    const origin = (await taskUrl(null, null)).replace(/\/tasks$/, "");
    check("link: a task of the other company names that company", await taskUrl(mine.id, other.id), `${origin}/tasks?task=${mine.id}&company=${other.slug}`);
    check("link: a Mega Events task names Mega Events too", await taskUrl(meRow.id, MEGA_EVENTS_COMPANY_ID), `${origin}/tasks?task=${meRow.id}&company=${meSlug}`);
    check("link: the board of a company", await taskUrl(null, other.id), `${origin}/tasks?company=${other.slug}`);
    check("link: an unknown company falls back to the plain link", await taskUrl(mine.id, "00000000-0000-4000-8000-000000000000"), `${origin}/tasks?task=${mine.id}`);

    // ---- the overdue cron reads every company on purpose (dry run: nothing mailed, nothing written)
    const assignee = superadmins[0];
    const opener = superadmins[1] ?? superadmins[0];
    if (assignee) {
      const { error: lateError } = await tasksOf(OTHER).update({ assignee_id: assignee, created_by: opener, due_date: "2020-01-01" }).eq("id", mine.id).select("id");
      if (lateError) throw new Error(lateError.message);
      const today = new Date().toISOString().slice(0, 10);
      const { count: overdueTruth } = await rawTasks()
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("status", ["todo", "in_progress", "paused"])
        .not("assignee_id", "is", null)
        .lt("due_date", today);
      const { count: overdueMe } = await megaEventsTasks()
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("status", ["todo", "in_progress", "paused"])
        .not("assignee_id", "is", null)
        .lt("due_date", today);
      const summary = await runOverdueAlerts({ dryRun: true });
      check("overdue cron: the dry run reports no error", summary.errors, []);
      // Compared loosely on the day boundary: the cron counts in Israel time, this script in UTC.
      truthy(
        "overdue cron: it sees the late task of the other company as well as Mega Events' (it mails each task's opener)",
        summary.overdue > (overdueMe ?? 0) && Math.abs(summary.overdue - (overdueTruth ?? 0)) <= 1,
        `cron saw ${summary.overdue}, the table holds ${overdueTruth} (${overdueMe} in Mega Events)`,
      );
      const { count: alertRows } = await rawTable("task_comments").select("id", { count: "exact", head: true }).eq("task_id", mine.id).eq("kind", "activity");
      check("overdue cron: a dry run writes no thread row", alertRows, 0);
    } else {
      fail("overdue cron", "no superadmin to assign the throw-away task to");
    }
  } finally {
    // The throw-away rows only: by id AND by their marker, in the local database.
    if (commentId) {
      const { error } = await rawTable("task_comments").delete().eq("id", commentId).eq("body", MARKER);
      if (error) fail("cleanup: remove the throw-away comment", error.message);
    }
    if (createdIds.length) {
      const { error: threadError } = await rawTable("task_comments").delete().in("task_id", createdIds);
      if (threadError) fail("cleanup: remove the throw-away thread rows", threadError.message);
      const { error } = await rawTasks().delete().in("id", createdIds).eq("title", MARKER);
      if (error) fail("cleanup: remove the throw-away tasks", error.message);
    }
  }

  // ---- nothing moved. Only what this script could have touched is compared - other
  //      people may be working in the same local database at the same time.
  const { data: meAfter } = await rawTasks().select(COLUMNS).eq("id", meTruth[0].id).maybeSingle();
  check("data: the Mega Events row the script wrote to is exactly as it was", meAfter, meTruth[0]);
  const { data: leftovers } = await rawTasks().select("id").eq("title", MARKER);
  check("data: the throw-away tasks are gone", (leftovers ?? []).length, 0);
  const { data: leftoverComments } = await rawTable("task_comments").select("id").eq("body", MARKER);
  check("data: the throw-away comment is gone", (leftoverComments ?? []).length, 0);
}

async function main() {
  staticScan();
  pureChecks();
  if (STATIC_ONLY) console.log("     --static-only: data part skipped");
  else await dataChecks();
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("FAIL selftest crashed:", error);
  process.exit(1);
});
