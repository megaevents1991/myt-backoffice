// The bookings sweep: what the cron (app/api/cron/tixstockBookings, every 10 minutes) does to a TixStock booking
// that nobody finished. It closes, it approves and it reads - it NEVER adds an order (plan call 11): a paid site
// order that was never ordered is marked `failed` for staff, because an orders/add we did not watch answer could
// be a second order.
//
//   holding       over 5 min                        -> failed (`hold_never_answered`); the action that placed it died
//   on_hold       site, 15 min, reservation unpaid  -> released, then the hold is released at TixStock
//   on_hold       site, 20 min, reservation PAID    -> failed (`paid_not_ordered`) + alert; the hold is released
//   on_hold       office, 15 min                    -> released, then the hold is released at TixStock
//   ordering      attempt started over 5 min ago    -> uncertain; TixStock may hold that order, so no call at all
//   sale_on_hold  5 min, reservation Paid           -> orders/update Approved; a site booking gets its link email
//   sale_on_hold  90 min and still not approved     -> alert (TixStock's limit is 2 hours)
//   approved / commissionable with no ticket stored -> orders/get an hour after the booking was made and then once
//                                                      a day, when the event is within 14 days or the booking is a
//                                                      sandbox one (the test event is months away)
//
// Every status change is a compare-and-set on the status the row was read with: a lost race is skipped, never
// retried. A hold is released only AFTER our row moved, so a payment that claimed the row meanwhile keeps its hold.
// All I/O goes through `SweepDeps`; the real ones are in tixstock-booking-store.ts.
// Test: scripts/tixstock-booking-sweep-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.4, 7.5, 7.8.
import type { TixstockClient } from "../tixstock-booking/client";
import { canMoveTo, statusFromTixstock, ticketLinkEmail, ticketPageUrl, type BookingEnv, type BookingStatus } from "../tixstock-booking/rules";
import { applyOrderUpdate, readOrderPayload, type ApplyDeps, type BookingRow } from "./tixstock-order-apply";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Rows per run and per kind (open rows, rows due a refresh). */
export const SWEEP_BATCH = 25;
/** TixStock drops a hold after about 10 minutes; the summary's own clock is 15. */
export const ABANDONED_HOLD_MS = 15 * MINUTE;
/** A Paid reservation whose booking is still `on_hold` this long after the pay click was never ordered. */
export const PAID_NOT_ORDERED_MS = 20 * MINUTE;
export const HOLDING_STUCK_MS = 5 * MINUTE;
export const ORDER_ATTEMPT_DEAD_MS = 5 * MINUTE;
/** The app that placed the order approves it within seconds; after this the sweep does. */
export const APPROVE_AFTER_MS = 5 * MINUTE;
/** TixStock wants Sale on Hold settled within 2 hours. */
export const SALE_ON_HOLD_OVERDUE_MS = 90 * MINUTE;
export const REFRESH_EVERY_MS = DAY;
/** No read of an order in its first hour: its tickets come by webhook, and a read then spends the day's look. */
export const REFRESH_FIRST_AFTER_MS = 60 * MINUTE;
export const REFRESH_WINDOW_DAYS = 14;
/** The sender of the site's confirmation email (myt-main sendUserEmail.ts). */
export const TICKET_LINK_FROM = '"MegaEvents Reservations" <reservations@mega-events.co.il>';

/** The slice of a `ticket_bookings` row the sweep reads. */
export type SweepRow = BookingRow & {
  hold_id: string | null;
  updated_at: string;
  attempt_started_at: string | null;
  last_refresh_at: string | null;
  link_email_sent_at: string | null;
  customer_token: string | null;
};

/** What the sweep needs of a booking's reservation and its event. `paid` = status "Paid" and not deleted. */
export type SweepReservation = { paid: boolean; email: string | null; eventName: string | null; eventDate: string | null };

export type SweepDeps = ApplyDeps & {
  /** Rows in a passing status (holding / on_hold / ordering / sale_on_hold), oldest first. */
  listOpen(limit: number): Promise<SweepRow[]>;
  /**
   * approved / commissionable rows with an order id and no stored file, created before `createdBeforeIso` and not
   * looked at since `staleBeforeIso`; the longest-waiting first.
   */
  listRefreshDue(cutoffs: { createdBeforeIso: string; staleBeforeIso: string }, limit: number): Promise<SweepRow[]>;
  loadReservation(id: number): Promise<SweepReservation | null>;
  /** `setStatus` that also records why. Compare-and-set; false when the row has moved meanwhile. */
  setStatusWithError(id: string, from: BookingStatus, to: BookingStatus, atIso: string, lastError: string): Promise<boolean>;
  /** Stamps `last_refresh_at` (and nothing else): the row was looked at, whatever came of it. */
  markRefreshChecked(id: string, atIso: string): Promise<void>;
  /** Takes the one link email of a booking (`link_email_sent_at` null -> atIso); false when it is taken. */
  claimLinkEmail(id: string, atIso: string): Promise<boolean>;
  /** Gives the claim back after a failed send, so a later run sends it. */
  unclaimLinkEmail(id: string, atIso: string): Promise<void>;
  /** null when that environment has no token here (or production booking is closed). */
  clientFor(env: BookingEnv): TixstockClient | null;
  sendMail(mail: { to: string; subject: string; html: string; text?: string; from?: string }): Promise<void>;
};

export type SweepResult = { released: number; approved: number; overdue: number; refreshed: number; failed: number; uncertain: number };

export type SweepOptions = {
  /** Counts what a real run would do; no TixStock call, no write, no mail. */
  dryRun?: boolean;
  limit?: number;
  /** Asked before each row; true = stop here and leave the rest to the next run. */
  outOfTime?: () => boolean;
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function sweepTixstockBookings(now: Date, deps: SweepDeps, opts: SweepOptions = {}): Promise<SweepResult> {
  const dryRun = opts.dryRun === true;
  const limit = opts.limit ?? SWEEP_BATCH;
  const outOfTime = opts.outOfTime ?? (() => false);
  const atIso = now.toISOString();
  const result: SweepResult = { released: 0, approved: 0, overdue: 0, refreshed: 0, failed: 0, uncertain: 0 };

  const age = (iso: string): number => now.getTime() - new Date(iso).getTime();

  const reservations = new Map<number, SweepReservation | null>();
  const reservationOf = async (id: number): Promise<SweepReservation | null> => {
    if (!reservations.has(id)) reservations.set(id, await deps.loadReservation(id));
    return reservations.get(id) ?? null;
  };

  /** Moves an `on_hold` row out, and only then lets go of the hold. False when someone else moved the row first. */
  const closeHold = async (row: SweepRow, to: "released" | "failed", lastError?: string): Promise<boolean> => {
    if (!dryRun) {
      const moved = lastError
        ? await deps.setStatusWithError(row.id, "on_hold", to, atIso, lastError)
        : await deps.setStatus(row.id, "on_hold", to, atIso);
      if (!moved) return false;
    }
    if (to === "released") result.released++;
    else result.failed++;
    if (dryRun || !row.hold_id) return true;
    const client = deps.clientFor(row.env);
    if (!client) return true;
    const released = await client.release(row.hold_id, row.quantity);
    // Not an alert: TixStock drops a hold by itself after about 10 minutes, and this one is older.
    if (!released.ok) console.warn("[tixstock-sweep] release not confirmed", JSON.stringify({ booking: row.id, kind: released.kind }));
    return true;
  };

  /** The link email of a site booking: one sender at a time (the claim), and a failed send gives the claim back. */
  const sendLinkOnce = async (row: SweepRow, reservation: SweepReservation): Promise<void> => {
    if (row.source !== "site" || row.link_email_sent_at !== null) return;
    if (!row.customer_token || !reservation.email) return;
    if (!(await deps.claimLinkEmail(row.id, atIso))) return;
    try {
      const mail = ticketLinkEmail(reservation.eventName ?? "", ticketPageUrl(row.customer_token));
      await deps.sendMail({ to: reservation.email, from: TICKET_LINK_FROM, ...mail });
    } catch (e) {
      await deps.unclaimLinkEmail(row.id, atIso);
      console.error("[tixstock-sweep] link email failed", JSON.stringify({ booking: row.id, error: messageOf(e) }));
    }
  };

  const sweepSaleOnHold = async (row: SweepRow): Promise<void> => {
    const rowAge = age(row.created_at);
    if (rowAge < APPROVE_AFTER_MS) return;
    const reservation = await reservationOf(row.reservation_id);
    let settled = false;
    if (reservation?.paid && row.tixstock_order_id) {
      if (dryRun) {
        result.approved++;
        return;
      }
      const client = deps.clientFor(row.env);
      const answer = client ? await client.updateOrder(row.tixstock_order_id, { order_status: "Approved" }) : null;
      if (answer?.ok) {
        // TixStock took the update; a status it does not name is the one we asked for.
        const next = statusFromTixstock(answer.data.status) ?? "approved";
        if (next !== "sale_on_hold" && canMoveTo("sale_on_hold", next)) {
          settled = true;
          const moved = await deps.setStatus(row.id, "sale_on_hold", next, atIso);
          if (next !== "cancelled") {
            if (moved) result.approved++;
            await sendLinkOnce(row, reservation);
          }
        }
      } else if (answer) {
        console.warn("[tixstock-sweep] approve not done", JSON.stringify({ booking: row.id, kind: answer.kind }));
      }
    }
    if (!settled && rowAge >= SALE_ON_HOLD_OVERDUE_MS) {
      result.overdue++;
      if (!dryRun) {
        console.error(
          "tixstock_sale_on_hold_over_90m",
          JSON.stringify({ booking: row.id, reservation: row.reservation_id, order: row.tixstock_order_id, minutes: Math.floor(rowAge / MINUTE) }),
        );
      }
    }
  };

  const sweepOpen = async (row: SweepRow): Promise<void> => {
    if (row.status === "holding") {
      if (age(row.created_at) < HOLDING_STUCK_MS) return;
      // A hold, if one was placed, runs out by itself; we never learned its id.
      if (dryRun || (await deps.setStatusWithError(row.id, "holding", "failed", atIso, "hold_never_answered"))) result.failed++;
      return;
    }

    if (row.status === "on_hold") {
      const rowAge = age(row.created_at);
      if (rowAge < ABANDONED_HOLD_MS) return;
      if (row.source === "office") {
        await closeHold(row, "released");
        return;
      }
      const reservation = await reservationOf(row.reservation_id);
      if (!reservation?.paid) {
        await closeHold(row, "released");
        return;
      }
      if (rowAge < PAID_NOT_ORDERED_MS) return;
      // The customer paid and the site's step after payment never ran. Staff book it from the button.
      const closed = await closeHold(row, "failed", "paid_not_ordered");
      if (closed && !dryRun) {
        console.error("tixstock_paid_site_booking_not_ordered", JSON.stringify({ booking: row.id, reservation: row.reservation_id }));
      }
      return;
    }

    if (row.status === "ordering") {
      if (age(row.attempt_started_at ?? row.updated_at ?? row.created_at) < ORDER_ATTEMPT_DEAD_MS) return;
      // The process died inside orders/add. The order may exist at TixStock: no call, staff read the Request Logs.
      if (dryRun || (await deps.setStatusWithError(row.id, "ordering", "uncertain", atIso, "order_attempt_never_answered"))) {
        result.uncertain++;
      }
      return;
    }

    if (row.status === "sale_on_hold") await sweepSaleOnHold(row);
  };

  const refresh = async (row: SweepRow): Promise<void> => {
    if (!row.tixstock_order_id) return;
    let due = row.env === "sandbox";
    if (!due) {
      const eventDate = (await reservationOf(row.reservation_id))?.eventDate;
      const daysAway = eventDate ? (new Date(eventDate).getTime() - now.getTime()) / DAY : NaN;
      due = daysAway >= -1 && daysAway <= REFRESH_WINDOW_DAYS;
    }
    if (dryRun) {
      if (due) result.refreshed++;
      return;
    }
    // Stamped whatever comes next: one look a day per row, so a row that is not due never holds the queue.
    await deps.markRefreshChecked(row.id, atIso);
    if (!due) return;
    const client = deps.clientFor(row.env);
    if (!client) return;
    const order = await client.getOrder(row.tixstock_order_id);
    if (!order.ok) {
      console.warn("[tixstock-sweep] refresh not done", JSON.stringify({ booking: row.id, kind: order.kind }));
      return;
    }
    await applyOrderUpdate(row.id, readOrderPayload("orders.get", order.data), deps);
    result.refreshed++;
  };

  const each = async (rows: SweepRow[], step: (row: SweepRow) => Promise<void>): Promise<void> => {
    for (const row of rows) {
      if (outOfTime()) return;
      try {
        await step(row);
      } catch (e) {
        // One row's failure never stops the run; the next run meets the row again.
        console.error("[tixstock-sweep] booking failed", JSON.stringify({ booking: row.id, status: row.status, error: messageOf(e) }));
      }
    }
  };

  await each(await deps.listOpen(limit), sweepOpen);
  const cutoffs = {
    createdBeforeIso: new Date(now.getTime() - REFRESH_FIRST_AFTER_MS).toISOString(),
    staleBeforeIso: new Date(now.getTime() - REFRESH_EVERY_MS).toISOString(),
  };
  await each(await deps.listRefreshDue(cutoffs, limit), refresh);
  return result;
}
