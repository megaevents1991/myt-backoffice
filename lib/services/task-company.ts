/**
 * What the task board of a company holds. Pure (no server imports), so the
 * server actions and the screens read the same answer.
 *
 *   - A company that sells events (Mega Events): the board as it always was -
 *     the four team boards (dev / marketing / ops / pricing), sourced tasks
 *     (creative gaps, price light, price changes, recurring rules), the
 *     Roadmap and Marketing maps, the gaps and pricing tabs, the task rules.
 *   - Any other company (Mega Family): one plain board. Tasks are typed in by
 *     a person (source "manual") and live on "ops" - the board the column
 *     defaults to and the one the flight-deadline tasks of the tours module
 *     already use. No board switcher, no phase, no channel, no rules.
 *
 * The company comes from the server (requireTaskBoard in lib/tasks-scope.ts,
 * or the page); never decide it from client input.
 */
import { TASK_BOARDS, type TaskBoard } from "@/types/task.types";

type ProductTypes = { productTypes: readonly string[] };

/** The single board of a company that sells no events. */
export const PLAIN_TASK_BOARD: TaskBoard = "ops";

const PLAIN_TASK_BOARDS: readonly TaskBoard[] = [PLAIN_TASK_BOARD];

/** Rules, pricing, gaps, roadmap, marketing and sourced tasks exist only here. */
export const hasEventsTaskBoard = (company: ProductTypes): boolean =>
  company.productTypes.includes("events");

/** The boards a task of this company may sit on. */
export const taskBoardsOf = (company: ProductTypes): readonly TaskBoard[] =>
  hasEventsTaskBoard(company) ? TASK_BOARDS : PLAIN_TASK_BOARDS;
