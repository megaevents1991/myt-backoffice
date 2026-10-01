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

/**
 * The failure an action returns. A UserError keeps its message; a guard
 * refusal becomes one sentence; anything else is logged under `scope` and
 * shown with its raw message.
 */
export function actionFail(e: unknown, scope: string): { success: false; error: string } {
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
  return { success: false, error: `Action failed: ${message}` };
}

/** Splits ids into URL-sized batches for `.in(...)` filters. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
