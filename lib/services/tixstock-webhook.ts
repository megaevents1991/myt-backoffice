// TixStock's webhook, behind POST /api/tixstock/webhook/[env] (one URL per environment). The route only reads the
// request and writes the answer; everything else is here and runs over `WebhookDeps` (real ones:
// tixstock-booking-store.ts; test: scripts/tixstock-webhook-selftest.ts).
//
// The route is public - TixStock calls it - so the signature is the only guard:
//   TixStock, 10.11.2026: "The signature is hashed using sha256 and the data set is the payload of the webhook JSON
//   encoded ... The key is set to your Bearer Token." Read as HMAC-SHA256 of the RAW body keyed with that
//   environment's API token. There is no separate webhook secret. Hex or base64 was not said: both are accepted.
// With no token configured, or a signature that does not match, the answer is 401 and nothing is stored.
//
// An ORDER webhook is answered `{ external_id, order_status, message, success }`. `external_id` is OUR order id
// (their answer of 10.11): the value orders/add sent as `order_id` for that booking (`ourOrderId`).
// A FULFILMENT webhook is answered by how much of the order is in hand (their answer of 11.11): an e-ticket order
// is "Completed" until its last ticket and "Commissionable" with it; a mobile order is "Commissionable".
// ticket.hold / ticket.release carry no order and are answered `{ "ok": true }` (10.11, round 2); they fire when
// ANOTHER marketplace holds a listing - a hold of ours sends nothing (11.11).
// Whose id a webhook's `order_id` is was not said: a booking is looked for by TixStock's order id, then by ours.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.5.
import { createHmac, timingSafeEqual } from "node:crypto";
import { canMoveTo, ourOrderId, parseOurOrderId, type BookingEnv } from "../tixstock-booking/rules";
import {
  applyOrderUpdate,
  orderIdOf,
  readOrderPayload,
  statusToTixstock,
  stripBodies,
  type ApplyDeps,
  type BookingRow,
} from "./tixstock-order-apply";

/** What an order webhook is answered with. */
export type OrderAnswerBody = { external_id: string | null; order_status: string | null; message: string; success: boolean };
/** What ticket.hold / ticket.release are answered with - exactly this (TixStock, 10.11.2026). */
export type AckBody = { ok: true };

export type WebhookAnswer = {
  status: number;
  body: OrderAnswerBody | AckBody | (OrderAnswerBody & AckBody);
};

export type WebhookDeps = ApplyDeps & {
  /** Writes the raw log row first; returns its id, or null when even the log failed. Never throws. */
  logEvent(e: {
    env: BookingEnv;
    type: string | null;
    signatureValid: boolean;
    orderId: string | null;
    payload: unknown;
  }): Promise<string | null>;
  /** Adds what we answered to the log row. Never throws. */
  finishEvent(id: string | null, result: unknown): Promise<void>;
  findBookingByOrder(env: BookingEnv, orderId: string): Promise<BookingRow | null>;
  /** The booking an order id of OURS names (`ourOrderId`): that reservation's one row whose id starts with the prefix. */
  findBookingByOurId(env: BookingEnv, reservationId: number, bookingPrefix: string): Promise<BookingRow | null>;
  /** The tickets in hand for a booking: its stored PDF files and its mobile links. */
  countTicketFiles(bookingId: string): Promise<{ pdf: number; mobileLink: number }>;
  /** `uncertain` bookings of that environment on that listing, created at or after `sinceIso`. */
  findUncertain(env: BookingEnv, listingId: string, sinceIso: string): Promise<BookingRow[]>;
  attachOrder(bookingId: string, orderId: string): Promise<void>;
};

/** An order whose orders/add got no answer may show up here within this long; later it is staff's to settle. */
const UNCERTAIN_MATCH_MINUTES = 60;

/** order.eticket_fulfilment, order.mobile_ticket_fulfilment, ... - the Reseller Admin's own spellings. */
const isFulfilment = (type: string): boolean => /^order\..*fulfil+ment$/.test(type);
/** The message of TixStock's own example answer to a fulfilment (11.11.2026). */
const FULFILLED_MESSAGE = "Listing has been fulfilled for the order.";

const HEX_DIGEST = /^[0-9a-fA-F]{64}$/;
const BASE64_DIGEST = /^[A-Za-z0-9+/_-]{43}=?$/;

const digestOf = (header: string): Buffer | null => {
  const given = header.trim().replace(/^sha256=/i, "");
  if (HEX_DIGEST.test(given)) return Buffer.from(given, "hex");
  if (BASE64_DIGEST.test(given)) return Buffer.from(given.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return null;
};

/** HMAC-SHA256 of the raw body keyed with the environment's API token; hex (either case), `sha256=<hex>` or base64. */
export function verifyTixstockSignature(rawBody: string, header: string | null, apiToken: string | undefined): boolean {
  if (!apiToken || typeof header !== "string") return false;
  const given = digestOf(header);
  if (!given) return false;
  const expected = createHmac("sha256", apiToken).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What kind of signature arrived, for the log - never the value. It tells a wrong key from a wrong encoding. */
const describeSignature = (header: string | null): string => {
  if (header === null) return "missing";
  const given = header.trim().replace(/^sha256=/i, "");
  return HEX_DIGEST.test(given) ? "hex" : BASE64_DIGEST.test(given) ? "base64" : `other (${given.length} chars)`;
};

const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const nothing = (message: string, success: boolean): OrderAnswerBody => ({
  external_id: null,
  order_status: null,
  message,
  success,
});

/**
 * A webhook for an order id we do not know, when exactly ONE booking of this environment is `uncertain` on that
 * listing (and quantity, when the payload names it) and young enough: that is the order whose answer we lost.
 * With two candidates nothing is guessed - staff settle both from TixStock's Request Logs.
 */
const matchUncertain = async (
  env: BookingEnv,
  orderId: string,
  data: Record<string, unknown>,
  deps: WebhookDeps,
): Promise<BookingRow | null> => {
  const listingId = str(data.id);
  if (!listingId) return null;
  const sinceIso = new Date(deps.now().getTime() - UNCERTAIN_MATCH_MINUTES * 60_000).toISOString();
  const quantity = num(data.quantity ?? data.quantity_sold);
  const candidates = (await deps.findUncertain(env, listingId, sinceIso)).filter(
    (b) => b.tixstock_order_id === null && (quantity === null || b.quantity === quantity),
  );
  if (candidates.length !== 1) return null;
  await deps.attachOrder(candidates[0].id, orderId);
  return { ...candidates[0], tixstock_order_id: orderId };
};

export async function handleTixstockWebhook(
  input: { env: BookingEnv; rawBody: string; signature: string | null; apiToken: string | undefined },
  deps: WebhookDeps,
): Promise<WebhookAnswer> {
  const { env, rawBody } = input;

  if (!verifyTixstockSignature(rawBody, input.signature, input.apiToken)) {
    // An unsigned body is not ours to keep: the log gets its size and the kind of signature, nothing else.
    const id = await deps.logEvent({ env, type: null, signatureValid: false, orderId: null, payload: { bytes: rawBody.length } });
    await deps.finishEvent(id, { status: 401, signature: describeSignature(input.signature), token_configured: Boolean(input.apiToken) });
    return { status: 401, body: nothing("bad signature", false) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    parsed = undefined;
  }
  const payload = rec(parsed);
  const type = str(rec(payload?.meta)?.type);
  const data = rec(payload?.data);
  const orderId = type && data ? orderIdOf(data) : null;

  const eventId = await deps.logEvent({
    env,
    type,
    signatureValid: true,
    orderId,
    payload: payload ? stripBodies(payload) : { bytes: rawBody.length },
  });
  const done = async (status: number, body: WebhookAnswer["body"]): Promise<WebhookAnswer> => {
    await deps.finishEvent(eventId, { status, ...body });
    return { status, body };
  };

  if (!payload || !type) return done(400, nothing("invalid payload", false));
  // A type that carries no order is logged and nothing else. TixStock fires hold / release for every hold we place
  // ourselves, and asked for exactly `{ "ok": true }` back (10.11.2026).
  if (type === "ticket.hold" || type === "ticket.release") return done(200, { ok: true });
  // ticket.fullfillment (listing level) and a type we do not know: TixStock did not say which answer they read, so
  // this one reads as received in both shapes.
  if (!type.startsWith("order.")) return done(200, { ok: true, ...nothing("logged", true) });
  if (!data) return done(400, nothing("invalid payload", false));

  try {
    let booking = orderId ? await deps.findBookingByOrder(env, orderId) : null;
    const ours = booking ? null : parseOurOrderId(orderId);
    if (ours) booking = await deps.findBookingByOurId(env, ours.reservationId, ours.bookingPrefix);
    // An id of our own shape that names no booking is never handed to another booking as TixStock's order id.
    if (!booking && orderId && !ours) booking = await matchUncertain(env, orderId, data, deps);
    if (!booking) return done(200, nothing("unknown order", false));

    const result = await applyOrderUpdate(booking.id, readOrderPayload(data, booking.id), deps, eventId);
    const externalId = ourOrderId(booking.reservation_id, booking.id);
    if (!isFulfilment(type)) {
      return done(200, { external_id: externalId, order_status: statusToTixstock(result.status), message: "ok", success: true });
    }

    // With the last ticket in hand the order is Commissionable at TixStock, so our row follows - by the tickets we
    // hold, not by this answer: a mobile order is answered Commissionable from its first link.
    const inHand = await deps.countTicketFiles(booking.id);
    if (inHand.pdf + inHand.mobileLink >= booking.quantity && canMoveTo(result.status, "commissionable")) {
      await deps.setStatus(booking.id, result.status, "commissionable", deps.now().toISOString());
    }
    const whole = type !== "order.eticket_fulfilment" || inHand.pdf >= booking.quantity;
    return done(200, {
      external_id: externalId,
      order_status: whole ? "Commissionable" : "Completed",
      message: FULFILLED_MESSAGE,
      success: true,
    });
  } catch (e) {
    // A failure of ours is not answered as done; the refresh (orders/get) and the sweep can still bring the files.
    console.error("[tixstock-webhook]", e instanceof Error ? e.message : String(e));
    return done(500, nothing("internal", false));
  }
}
