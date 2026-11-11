// "Book ticket" on a reservation: hold the live listing staff picked and place the order at TixStock as Approved.
// An order at TixStock is FINAL - it is never cancelled from here - so the order of things is the whole point:
//
//   1. staff's three ticks, before anything is read or called;
//   2. the listing is read again (it must still be offered to this party) and a dearer one needs an explicit yes;
//   3. the booking row is inserted as `holding` - the table's unique index is the lock: a reservation with a live
//      booking cannot get a second one, whoever presses;
//   4. the attempt is audited BEFORE TixStock is called;
//   5. hold -> `on_hold` -> `ordering` (compare-and-set) -> orders/add as Approved -> `approved`.
//
// An orders/add nobody answered is `uncertain`: no release, no retry - TixStock may have created the order, and a
// second orders/add can create a second one. A refusal releases the hold once and the row is `failed`; an expired
// hold is a refusal like any other - there is no automatic re-hold here, staff press the button again.
//
// Every DB, TixStock and audit call goes through `OfficeDeps`. Never throws.
// Selftest: scripts/tixstock-office-booking-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.1-7.4.
import type { TixstockCall } from "./client";
import type { RankedListing } from "./rank";
import {
  attendeeIssues,
  buildOrderRequest,
  type AttendeeInput,
  type BookingEnv,
  type BookingStatus,
  type Buyer,
  type ListingSnapshot,
} from "./rules";

const LOG = "[tixstock-office-booking]";

export type OfficeBookingInput = {
  reservationId: number;
  tixstockEventId: string;
  listingId: string;
  buyer: Buyer;
  attendees: AttendeeInput[];
  /**
   * Staff ticked "האירוע דורש פרטי זיהוי". It can only ADD the identity details: when the venue is in Italy they are
   * required whatever this says - the venue is read again on the server at the click (`OfficeContext.italian`).
   */
  italian: boolean;
  /** Required for a paper ticket: where it is shipped. */
  shippingAddress?: Record<string, string>;
  /** Staff saw that the listing costs more than the order was sold with, and said yes. */
  acceptGap: boolean;
  /** The three ticks of the dialog - all required, on every reservation. */
  acks: { flightHotelDone: boolean; notBoughtByHand: boolean; finalPurchase: boolean };
};

export type OfficeBookingResult =
  | { ok: true; status: "approved"; orderId: string }
  | {
      ok: false;
      kind:
        | "hidden"
        | "acks"
        | "attendees"
        | "shipping"
        | "gap_not_accepted"
        | "locked"
        | "gone"
        | "refused"
        | "uncertain"
        | "production_closed"
        | "not_configured"
        | "db";
      message?: string;
    };

export type OfficeContext =
  | {
      ok: true;
      env: BookingEnv;
      /** The order's party. */
      quantity: number;
      /** The listing staff picked, as it is offered to this party right now; null when it no longer is. */
      listing: RankedListing | null;
      costSoldTotalUsd: number | null;
      /** The TixStock event's venue is in Italy, as the server read it at the click. */
      italian: boolean;
    }
  | { ok: false; kind: "production_closed" | "not_configured" | "db" | "gone" };

export type OfficeDeps = {
  now(): Date;
  /** The booking row's id (a uuid). Made here, so the order id can name the row before TixStock is called. */
  newId(): string;
  /** The customer's ticket-page token: 32 random bytes, base64url. */
  newToken(): string;
  loadContext(reservationId: number, tixstockEventId: string, listingId: string): Promise<OfficeContext>;
  /** Inserts the row as `holding`. `locked` = the reservation already has a live booking (the unique index). */
  insertBooking(row: Record<string, unknown> & { id: string }): Promise<{ ok: true } | { ok: false; kind: "locked" | "db" }>;
  /** Compare-and-set in ONE statement; `patch` rides with the move. False = the row was not in `from`. */
  moveStatus(id: string, from: BookingStatus, to: BookingStatus, atIso: string, patch?: Record<string, unknown>): Promise<boolean>;
  hold(env: BookingEnv, listingId: string, qty: number): Promise<TixstockCall<{ holdId: string }>>;
  release(env: BookingEnv, holdId: string, qty: number): Promise<TixstockCall<true>>;
  addOrder(
    env: BookingEnv,
    holdId: string,
    qty: number,
    body: Record<string, unknown>,
  ): Promise<TixstockCall<{ orderId: string; status: string; currency: string | null; total: number | null }>>;
  audit(action: string, reservationId: number, metadata: Record<string, unknown>): Promise<void>;
};

const why = (r: TixstockCall<unknown>): string =>
  r.ok ? "" : r.kind === "refused" ? `refused ${r.status}: ${r.message}`.slice(0, 300) : "no answer";

/** TixStock's "the listing is not available" on a hold. */
const listingGone = (r: TixstockCall<unknown>): boolean => !r.ok && r.kind === "refused" && String(r.code ?? "") === "108";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const cleanAddress = (address: Record<string, string> | undefined): Record<string, string> | null => {
  const entries = Object.entries(address ?? {})
    .map(([key, value]): [string, string] => [key, typeof value === "string" ? value.trim() : ""])
    .filter(([, value]) => value !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

export async function runOfficeBooking(input: OfficeBookingInput, actor: string, deps: OfficeDeps): Promise<OfficeBookingResult> {
  // Staff's three ticks come before anything is read or called.
  if (!(input.acks.flightHotelDone && input.acks.notBoughtByHand && input.acks.finalPurchase)) return { ok: false, kind: "acks" };

  try {
    const context = await deps.loadContext(input.reservationId, input.tixstockEventId, input.listingId);
    if (!context.ok) return { ok: false, kind: context.kind };
    const listing = context.listing;
    if (!listing) return { ok: false, kind: "gone" };
    const { env, quantity } = context;
    // The venue decides; staff's tick can only add. What the dialog sent is never a reason to leave the details out.
    const italian = context.italian || input.italian;

    if (input.attendees.length !== quantity || input.attendees.some((a) => attendeeIssues(a, italian).length > 0)) {
      return { ok: false, kind: "attendees" };
    }
    const shippingAddress = cleanAddress(input.shippingAddress);
    if (listing.paper && !shippingAddress) return { ok: false, kind: "shipping" };
    if (listing.dearer && !input.acceptGap) return { ok: false, kind: "gap_not_accepted" };

    const at = deps.now();
    const atIso = at.toISOString();
    const id = deps.newId();
    const request = buildOrderRequest({
      status: "Approved",
      at,
      reservationId: input.reservationId,
      bookingId: id,
      buyer: input.buyer,
      attendees: input.attendees,
      quantity,
      italian,
      listing: { generalAdmission: listing.generalAdmission, row: listing.row ?? "", pricePerTicket: listing.pricePerTicketUsd },
      ...(listing.paper && shippingAddress ? { shippingAddress } : {}),
    });
    if (!request.ok) return { ok: false, kind: "attendees" };

    const snapshot: ListingSnapshot = {
      category: listing.category,
      section: listing.section,
      row: listing.row,
      generalAdmission: listing.generalAdmission,
      ticketType: listing.ticketType,
      splitType: listing.splitType,
      restrictions: listing.restrictions,
      deliveryDate: listing.deliveryDate,
      deliveryType: listing.deliveryType,
      instantDownload: listing.instantDownload,
      italian,
    };
    const inserted = await deps.insertBooking({
      id,
      reservation_id: input.reservationId,
      env,
      source: "office",
      status: "holding",
      tixstock_event_id: input.tixstockEventId,
      listing_id: input.listingId,
      quantity,
      listing: snapshot,
      // The feed's amount, never rounded: it is what orders/add states.
      price_per_ticket: listing.pricePerTicketUsd,
      currency: "USD",
      total: listing.totalUsd,
      cost_sold_usd: context.costSoldTotalUsd,
      gap_accepted_by: listing.dearer ? actor : null,
      buyer: input.buyer,
      attendees: input.attendees,
      shipping_address: listing.paper ? shippingAddress : null,
      prerequisites_ack: { ...input.acks, by: actor, at: atIso },
      created_by: actor,
      customer_token: deps.newToken(),
    });
    if (!inserted.ok) return { ok: false, kind: inserted.kind };

    // On record before TixStock hears of it: whatever happens next, the attempt can be traced.
    await deps.audit("tixstock_ticket_booking_started", input.reservationId, {
      booking: id,
      env,
      listing: input.listingId,
      quantity,
      total_usd: listing.totalUsd,
      gap_usd: listing.gapUsd,
    });

    const hold = await deps.hold(env, input.listingId, quantity);
    if (!hold.ok) {
      // No hold id came back, so there is nothing to release: a hold TixStock did place runs out in ten minutes.
      const lastError = hold.kind === "no_answer" ? "hold: no answer" : `hold: ${why(hold)}`;
      console.error(`${LOG} hold not placed`, JSON.stringify({ booking: id, reservation: input.reservationId, lastError }));
      await deps.moveStatus(id, "holding", "failed", deps.now().toISOString(), { last_error: lastError });
      return listingGone(hold) ? { ok: false, kind: "gone" } : { ok: false, kind: "refused", message: lastError };
    }
    const holdId = hold.data.holdId;
    await deps.moveStatus(id, "holding", "on_hold", deps.now().toISOString(), { hold_id: holdId });

    const claimedAt = deps.now().toISOString();
    if (!(await deps.moveStatus(id, "on_hold", "ordering", claimedAt, { attempt_started_at: claimedAt }))) {
      // Someone moved the row between our two writes (the sweep closing a hold): nothing is ordered.
      return { ok: false, kind: "locked" };
    }

    const answer = await deps.addOrder(env, holdId, quantity, request.body);
    if (!answer.ok && answer.kind === "no_answer") {
      console.error(`${LOG} orders/add was not answered - uncertain`, JSON.stringify({ booking: id, reservation: input.reservationId }));
      await deps.moveStatus(id, "ordering", "uncertain", deps.now().toISOString(), { last_error: "orders/add: no answer" });
      return { ok: false, kind: "uncertain" };
    }
    if (!answer.ok) {
      const lastError = `orders/add: ${why(answer)}`;
      console.error(`${LOG} order refused`, JSON.stringify({ booking: id, reservation: input.reservationId, lastError }));
      await deps.moveStatus(id, "ordering", "failed", deps.now().toISOString(), { last_error: lastError });
      const released = await deps.release(env, holdId, quantity);
      if (!released.ok) console.error(`${LOG} release not confirmed`, JSON.stringify({ booking: id }));
      return { ok: false, kind: "refused", message: lastError };
    }

    const { orderId, currency, total } = answer.data;
    if ((currency ?? "USD").toUpperCase() !== "USD" || (total !== null && Math.abs(total - round2(listing.pricePerTicketUsd * quantity)) > 0.01)) {
      console.warn("tixstock_order_total_mismatch", JSON.stringify({ booking: id, reservation: input.reservationId, expected: listing.totalUsd, currency, total }));
    }
    await deps.moveStatus(id, "ordering", "approved", deps.now().toISOString(), {
      tixstock_order_id: orderId,
      order_currency: currency,
      order_total: total,
    });
    await deps.audit("tixstock_ticket_booked", input.reservationId, { booking: id, env, order: orderId, listing: input.listingId, quantity, total_usd: listing.totalUsd });
    return { ok: true, status: "approved", orderId };
  } catch (e) {
    // The row keeps the status of its last successful write; an `ordering` row nobody finishes is turned into
    // `uncertain` by the sweep, which is the true state after a crash around orders/add.
    console.error(`${LOG} failed:`, e instanceof Error ? e.message : String(e));
    return { ok: false, kind: "db", message: e instanceof Error ? e.message : String(e) };
  }
}
