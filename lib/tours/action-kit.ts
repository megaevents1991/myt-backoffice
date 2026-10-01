/**
 * Plumbing shared by the tours server actions: the result shape every tours
 * screen reads, an error the operator can act on, and one wording for the
 * guard refusals. Not a "use server" module - it exports a class and helpers.
 */
import { COMPANY_UNASSIGNED_NOTICE } from "@/lib/auth/tours-agent";

/** Every tours action answers with this. Expected failures never throw. */
export type ActionResult<T = undefined> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string };

/** A failure the operator can act on; its message is shown as is. */
export class UserError extends Error {}

export const actionOk = <T>(data: T, warning?: string): ActionResult<T> =>
  warning ? { success: true, data, warning } : { success: true, data };

/** An expected failure with its message as is. */
export const plainFail = (error: string): { success: false; error: string } => ({ success: false, error });

/** The message shown when a database call fails and the details are only for the log. */
export const GENERIC_FAILURE = "The action failed. Try again, and if it happens again, contact support.";

/** A database call failed: log where, show the generic message. */
export function dbFail(scope: string, where: string, error: unknown): { success: false; error: string } {
  console.error(`${scope}: ${where} failed`, error instanceof Error ? error.message : JSON.stringify(error));
  return plainFail(GENERIC_FAILURE);
}

/**
 * The failure an action returns. A UserError keeps its message; a guard
 * refusal becomes one sentence; anything else is logged under `scope` and
 * shown as `fallback` when one is given, else with its raw message.
 */
export function actionFail(e: unknown, scope: string, fallback?: string): { success: false; error: string } {
  if (e instanceof UserError) return { success: false, error: e.message };
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith("Forbidden")) {
    return {
      success: false,
      error: "This screen is available only when the active company sells tours. Switch company in the top bar.",
    };
  }
  if (message.startsWith("Unauthorized")) return { success: false, error: "You don't have permission for this action." };
  if (message.startsWith("Unassigned")) {
    return {
      success: false,
      error: `${COMPANY_UNASSIGNED_NOTICE}. A company admin needs to assign the account to a company.`,
    };
  }
  console.error(`${scope}:`, e);
  return { success: false, error: fallback ?? `Action failed: ${message}` };
}

/** Splits ids into URL-sized batches for `.in(...)` filters. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The data of a query, or throw its error. */
export const must = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

/** The one row a query must return, or throw. */
export const mustRow = <T>(result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error("no row returned");
  return result.data;
};

/** PostgREST caps a response at 1000 rows - page through everything that can grow past that. */
export const TOURS_PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** PostgREST answers at most 1000 rows - walk the pages until a short one. */
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += TOURS_PAGE_SIZE) {
    const { data, error } = await page(from, from + TOURS_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < TOURS_PAGE_SIZE) return out;
  }
}
