/**
 * Rules of the flight block lifecycle (functional spec 4.1, 4.2, 4.5 and rules 8-10).
 *
 * Pure functions, no I/O. The server actions (lib/actions/tours-flight-actions.ts)
 * call them to ENFORCE a rule; the block panel calls the same functions to decide
 * which buttons to show, so the screen never offers what the server will refuse.
 */
import {
  BLOCK_STATUSES,
  BLOCK_STATUS_LABELS,
  BLOCK_STATUS_TRANSITIONS,
  type BlockEventKind,
  type BlockStatus,
} from "@/types/tours.types";

/** A block's place in the lifecycle. `draft` = a planning row with no status yet. */
export type BlockStage = BlockStatus | "draft";

export const DRAFT_LABEL = "Draft";

export function stageOf(status: string | null | undefined): BlockStage {
  return status && (BLOCK_STATUSES as readonly string[]).includes(status) ? (status as BlockStatus) : "draft";
}

export function stageLabel(status: string | null | undefined): string {
  const stage = stageOf(status);
  return stage === "draft" ? DRAFT_LABEL : BLOCK_STATUS_LABELS[stage];
}

/** The steps a block may take from where it stands. */
export function nextStages(status: string | null | undefined): BlockStatus[] {
  return BLOCK_STATUS_TRANSITIONS[stageOf(status)];
}

/** What the button of each step says (an action, where the status label is a state). */
export const TRANSITION_ACTION_LABELS: Record<BlockStatus, string> = {
  approved: "Approve to Book",
  requested: "Request Sent to Airline",
  declined: "Declined",
  option: "Option",
  confirmed: "Confirmed by Airline",
  operational: "Hand to Operations",
  ticketed: "Ticketed",
  cancelled: "Cancel Flight Block",
};

/**
 * The timeline event each step writes. The events vocabulary has no kind for
 * "declined" (nor for "option"), so those are written as a note that says so.
 */
export const TRANSITION_EVENT_KIND: Record<BlockStatus, BlockEventKind> = {
  approved: "approved",
  requested: "requested",
  declined: "note",
  option: "note",
  confirmed: "confirmed",
  operational: "handed_over",
  ticketed: "ticketed",
  cancelled: "cancelled",
};

/** Once the airline confirmed a block, only a manager may cancel it. */
export const MANAGER_ONLY_CANCEL_FROM: readonly BlockStage[] = ["confirmed", "operational", "ticketed"];

/** Company manager: the owner (`admin`) or the MYT team (`superadmin`). */
export function isManagerRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export const CANCELLED_BY = ["airline", "us"] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];
export const CANCELLED_BY_LABELS: Record<CancelledBy, string> = {
  airline: "Airline",
  us: "Us",
};

/** What a step may carry. Dates are `yyyy-mm-dd`. */
export interface TransitionInput {
  /** When it happened; today when omitted. */
  date?: string | null;
  /** Free text. Required for `declined` and `cancelled` (the reason). */
  note?: string | null;
  /** `cancelled` only: who cancelled. */
  cancelledBy?: CancelledBy | null;
  /** `cancelled` only: the fee that was paid, if any. */
  fee?: number | null;
  /** `confirmed` only: the PNR, when the block has none yet. */
  pnr?: string | null;
}

/** The fields of a block the rules look at. */
export interface RuleBlock {
  block_status: string | null;
  pnr: string | null;
  initial_quantity: number;
  cost_price: number | null;
  cost_currency: string | null;
  contract_id: string | null;
}

export type RuleCheck = { ok: true } | { ok: false; error: string };

const fail = (error: string): RuleCheck => ({ ok: false, error });

/** What is still missing before the airline's confirmation can be recorded (rule 10). */
export function missingForConfirmed(block: RuleBlock, input: TransitionInput = {}): string[] {
  const missing: string[] = [];
  if (!(block.pnr?.trim() || input.pnr?.trim())) missing.push("PNR");
  if (!(block.initial_quantity > 0)) missing.push("Seat count");
  if (block.cost_price === null || block.cost_price === undefined) missing.push("Adult cost");
  if (!block.cost_currency) missing.push("Cost currency");
  if (!block.contract_id) missing.push("Contract");
  return missing;
}

/** May this role move this block to `to`, with this input? A refusal carries the reason shown to the operator. */
export function checkTransition(
  block: RuleBlock,
  to: BlockStatus,
  role: string | null | undefined,
  input: TransitionInput = {},
): RuleCheck {
  const from = stageOf(block.block_status);
  if (!BLOCK_STATUS_TRANSITIONS[from].includes(to)) {
    return fail(`Can't move from "${stageLabel(block.block_status)}" to "${BLOCK_STATUS_LABELS[to]}"`);
  }
  switch (to) {
    case "approved":
      if (!isManagerRole(role)) return fail("Only the company manager approves dates to book");
      if (!(block.initial_quantity > 0)) return fail("A flight block with no seats can't be approved to book");
      return { ok: true };
    case "declined":
      if (!input.note?.trim()) return fail("Declining needs a reason");
      return { ok: true };
    case "confirmed": {
      const missing = missingForConfirmed(block, input);
      if (missing.length) return fail(`Missing for "Confirmed by airline": ${missing.join(", ")}`);
      return { ok: true };
    }
    case "cancelled":
      if (MANAGER_ONLY_CANCEL_FROM.includes(from) && !isManagerRole(role)) {
        return fail("Only the company manager can cancel a flight block the airline already confirmed");
      }
      if (!input.cancelledBy || !(CANCELLED_BY as readonly string[]).includes(input.cancelledBy)) {
        return fail("Say who cancelled: the airline or us");
      }
      if (!input.note?.trim()) return fail("A cancellation needs a reason");
      if (input.fee !== null && input.fee !== undefined && !(Number.isFinite(input.fee) && input.fee >= 0)) {
        return fail("The cancellation fee must be a positive number");
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

export type AllocationLegs = "both" | "outbound" | "inbound";
export const ALLOCATION_LEGS: readonly AllocationLegs[] = ["both", "outbound", "inbound"];
export const ALLOCATION_LEGS_LABELS: Record<AllocationLegs, string> = {
  both: "Round trip",
  outbound: "Outbound only",
  inbound: "Return only",
};

/**
 * Seats of a block that are spoken for. A departure may take only one direction
 * of a block, so the two directions are counted apart and the fuller one decides:
 * 40 seats out to one departure and 40 seats back to another fill a 40-seat block
 * exactly, they do not overbook it.
 */
export function allocatedSeats(allocations: readonly { seats: number; legs: string }[]): number {
  let outbound = 0;
  let inbound = 0;
  for (const a of allocations) {
    const seats = Number(a.seats) || 0;
    if (a.legs !== "inbound") outbound += seats;
    if (a.legs !== "outbound") inbound += seats;
  }
  return Math.max(outbound, inbound);
}

/** How far a departure may sit from the block's flight date and still be offered for allocation. */
export const ALLOCATION_MAX_DAY_GAP = 2;
