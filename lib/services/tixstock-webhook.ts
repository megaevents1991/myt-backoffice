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
// TixStock expects `{ external_id, order_status, message, success }` back. `external_id` is OUR order id (their
// answer of 10.11): the reservation id of the booking the webhook belongs to.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.5.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BookingEnv } from "../tixstock-booking/rules";
import {
  applyOrderUpdate,
  orderIdOf,
  readOrderPayload,
  statusToTixstock,
  stripBodies,
  type ApplyDeps,
  type BookingRow,
} from "./tixstock-order-apply";

export type WebhookAnswer = {
  status: number;
  body: { external_id: string | null; order_status: string | null; message: string; success: boolean };
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
  /** `uncertain` bookings of that environment on that listing, created at or after `sinceIso`. */
  findUncertain(env: BookingEnv, listingId: string, sinceIso: string): Promise<BookingRow[]>;
  attachOrder(bookingId: string, orderId: string): Promise<void>;
};

/** An order whose orders/add got no answer may show up here within this long; later it is staff's to settle. */
const UNCERTAIN_MATCH_MINUTES = 60;

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

const nothing = (message: string, success: boolean): WebhookAnswer["body"] => ({
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
  const orderId = type && data ? orderIdOf(type, data) : null;

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
  // ticket.hold / ticket.release / ticket.fullfillment carry no order, and TixStock fires them for every hold we
  // place ourselves: logged, and answered as received.
  if (!type.startsWith("order.")) return done(200, nothing("logged", true));
  if (!data) return done(400, nothing("invalid payload", false));

  try {
    let booking = orderId ? await deps.findBookingByOrder(env, orderId) : null;
    if (!booking && orderId) booking = await matchUncertain(env, orderId, data, deps);
    if (!booking) return done(200, nothing("unknown order", false));

    const result = await applyOrderUpdate(booking.id, readOrderPayload(type, data), deps, eventId);
    return done(200, {
      external_id: String(booking.reservation_id),
      order_status: statusToTixstock(result.status),
      message: "ok",
      success: true,
    });
  } catch (e) {
    // A failure of ours is not answered as done; the refresh (orders/get) and the sweep can still bring the files.
    console.error("[tixstock-webhook]", e instanceof Error ? e.message : String(e));
    return done(500, nothing("internal", false));
  }
}
