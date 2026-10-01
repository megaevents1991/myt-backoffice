/**
 * The company-scoped door to `public.tasks` (server only).
 *
 * The table is shared by every company: the Mega Events team board and the
 * Mega Family board live side by side, told apart by `company_id`. The
 * service-role client bypasses RLS, so the company filter is a code gate - and
 * this file is where it lives. Code that queries the table itself must carry
 * `.eq("company_id", ...)` in the same statement.
 * scripts/tasks-company-scope-selftest.ts scans lib/, app/ and components/ and
 * fails on any tasks access that does neither.
 *
 * Two scopes, nothing else:
 *   - `megaEventsTasks()`  the automations: the recurring task rules and their
 *     cron, price-light and price-changes tasks, the pricing gaps. They exist
 *     only for Mega Events, whatever company the operator is working in.
 *   - `tasksOf(company)`   the task board and anything a person does on it: the
 *     ACTIVE company, taken from `requireTaskBoard()` / `requireCompany()` on
 *     the server. Never build the company from client input.
 *
 * What a scope gives you:
 *   - `select()`  already filtered by company; chain `.eq("id", ...)` and the
 *     rest as usual. An id of another company finds nothing.
 *   - `insert()`  stamps `company_id` on every row, over whatever the row says.
 *   - `update()`  filtered by company and never moves a row to another company.
 *   - `owns()` / `ownedIds()`  whether task ids belong to the scope.
 * There is no delete (tasks are soft-deleted through `update`) and no upsert.
 *
 * The child tables - `task_comments`, `task_reads` - and the `task-attachments`
 * bucket carry no company column: they are keyed by a task id. Before touching
 * them, resolve the parent task inside a scope (`owns`, or a scoped select /
 * update that returned the row). A task id of another company then behaves
 * exactly like an id that does not exist.
 */
import { supabase } from "@/lib/supabase-server";
import { worksInMegaEvents } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";
import { MEGA_EVENTS_COMPANY_ID, listCompaniesFor, requireCompany, type Company } from "@/lib/company";
import { hasEventsTaskBoard } from "@/lib/services/task-company";

export type TaskScope = Pick<Company, "id">;

/** A row a scope writes: the columns of `public.tasks`. `company_id` is the scope's, never the row's. */
export type TaskWrite = Record<string, unknown>;

/** The error a scoped statement can answer with (PostgREST's shape, narrowed to what callers read). */
export type TaskDbError = { message: string; code?: string };

/**
 * What a scoped statement resolves to, once the call site names the rows it selected:
 *   const { data, error } = (await tasks.select("id,title").eq("id", id).maybeSingle()) as TaskResult<{ id: string; title: string }>;
 * The scope hands back untyped builders (see `table` below), so each call site states the
 * narrow shape it reads - never the generated Database type.
 */
export type TaskResult<T> = { data: T | null; error: TaskDbError | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Task ids per `in (...)` filter - keeps the request line well inside URL limits. */
const OWNED_IDS_CHUNK = 200;

// The one place the raw table is named, and the one cast of this file. `supabase` is the
// untyped client (its rows resolve to `never`), so it is cast at this boundary - the pattern
// of lib/flights-scope.ts. NOT the typed client: a scope built on `supabaseTyped` carried the
// generated Database type and the select-string parser through `TasksScope` into every chained
// call of every call site, and `tsc` ran out of memory on lib/actions/task-actions.ts. Call
// sites cast the rows they read to their own narrow shape (`TaskResult<...>`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => (supabase as any).from("tasks");

export function tasksOf(company: TaskScope) {
  const companyId = company?.id;
  // Fail closed: an empty or malformed id must never turn into "no filter".
  if (typeof companyId !== "string" || !UUID.test(companyId)) {
    throw new Error("tasksOf: a company id is required to read or write tasks");
  }
  const stamp = (row: TaskWrite): TaskWrite => ({ ...row, company_id: companyId });

  /** The ids among `taskIds` that belong to this company (soft-deleted tasks included). */
  const ownedIds = async (taskIds: string[]): Promise<Set<string>> => {
    const owned = new Set<string>();
    // A malformed id can only be "not found" - and must not fail the whole lookup.
    const unique = [...new Set(taskIds)].filter((id) => typeof id === "string" && UUID.test(id));
    for (let i = 0; i < unique.length; i += OWNED_IDS_CHUNK) {
      const { data, error } = (await table()
        .select("id")
        .eq("company_id", companyId)
        .in("id", unique.slice(i, i + OWNED_IDS_CHUNK))) as TaskResult<{ id: string }[]>;
      if (error) {
        // Fail closed: an id that could not be confirmed is not owned.
        console.error("tasks-scope: ownership lookup failed", JSON.stringify(error));
        continue;
      }
      for (const row of data ?? []) owned.add(row.id);
    }
    return owned;
  };

  return {
    companyId,

    select: (columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) =>
      table().select(columns, options).eq("company_id", companyId),

    insert: (rows: TaskWrite | TaskWrite[]) =>
      table().insert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows)),

    update: (patch: TaskWrite) => {
      const { company_id: _never, ...rest } = patch;
      void _never;
      return table().update(rest).eq("company_id", companyId);
    },

    ownedIds,

    /** Whether this task belongs to the company - the gate of its comments, reads and files. */
    owns: async (taskId: string): Promise<boolean> => (await ownedIds([taskId])).has(taskId),
  };
}

export type TasksScope = ReturnType<typeof tasksOf>;

/** Constant scope of every automation (rules, cron, price light, pricing gaps). */
export const megaEventsTasks = () => tasksOf({ id: MEGA_EVENTS_COMPANY_ID });

/**
 * Guard of every task-board action: a staff session, the active company, and
 * that company's scope.
 *
 * `requireCompany()` admits staff of any company and falls back to Mega Events
 * whenever the caller's companies cannot be resolved. The Mega Events board
 * keeps the gate it had as `requireStaff()`: someone who was added to other
 * companies only (worksInMegaEvents) is refused even when the fallback lands
 * them here - a member of an inactive company, a failed read.
 *
 * `eventsBoard` = the active company has the Mega Events features of the board
 * (lib/services/task-company.ts).
 */
export async function requireTaskBoard(): Promise<{
  session: SessionPayload;
  company: Company;
  tasks: TasksScope;
  eventsBoard: boolean;
}> {
  const { session, company } = await requireCompany();
  if (!(await mayOpenBoard(session, company))) throw new Error("Unauthorized");
  return { session, company, tasks: tasksOf(company), eventsBoard: hasEventsTaskBoard(company) };
}

/** The Mega Events gate of `requireTaskBoard`; every other company came from the caller's memberships. */
async function mayOpenBoard(session: SessionPayload, company: TaskScope): Promise<boolean> {
  return company.id !== MEGA_EVENTS_COMPANY_ID || (await worksInMegaEvents(session));
}

/**
 * A task link ("/tasks?task=<id>" in a mail) opened while working in another company: which
 * of the caller's OWN other companies holds that task, so the screen can offer to switch.
 * Only boards the caller may open are looked at (their memberships; every company for a
 * superadmin) - a task anywhere else stays "not found".
 */
export async function otherCompanyOfTask(
  session: SessionPayload,
  active: TaskScope,
  taskId: string,
): Promise<Company | null> {
  for (const company of await listCompaniesFor(session)) {
    if (company.id === active.id || !(await mayOpenBoard(session, company))) continue;
    if (await tasksOf(company).owns(taskId)) return company;
  }
  return null;
}
