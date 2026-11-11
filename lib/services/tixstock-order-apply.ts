// What TixStock tells us about an order - a webhook, or the order read back with orders/get - turned into one
// shape (`readOrderPayload`) and written to our booking (`applyOrderUpdate`). Shared by the webhook receiver
// (tixstock-webhook.ts), the card's Refresh and the sweep, so a ticket is stored once whichever way it arrives.
//
// Rules that hold here:
//   - a file is stored once per dedupe key (OUR booking + kind + row + seat + index). Neither the webhook type nor
//     the order id a payload names is in it: TixStock knows an order by its own id and by the `order_id` we sent;
//   - a status only moves along `canMoveTo` - a late "Approved" never pulls a Commissionable order back;
//   - a SITE booking (the hidden sandbox checkout) is released to the customer's page by its first file; an
//     OFFICE booking is released by staff after they checked the tickets.
// All I/O goes through `ApplyDeps`; the real ones are in tixstock-booking-store.ts.
// Test: scripts/tixstock-webhook-selftest.ts. Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.5.
import { createHash } from "node:crypto";
import { canMoveTo, statusFromTixstock, type BookingEnv, type BookingStatus } from "../tixstock-booking/rules";

export type TicketFileKind = "pdf" | "mobile_link" | "proof" | "additional";

/** One file or link of an order. `base64` = bytes to store in the private bucket; `url` = a link kept as it is. */
export type FileToSave = {
  kind: TicketFileKind;
  row: string | null;
  seat: string | null;
  base64?: string;
  url?: string;
  dedupeKey: string;
};

export type OrderUpdate = { status: BookingStatus | null; files: FileToSave[] };

/** The slice of a `ticket_bookings` row the webhook, the refresh and the sweep work with. */
export type BookingRow = {
  id: string;
  reservation_id: number;
  env: BookingEnv;
  source: "office" | "site";
  status: BookingStatus;
  listing_id: string;
  quantity: number;
  tixstock_order_id: string | null;
  released_to_customer_at: string | null;
  created_at: string;
};

export type ApplyDeps = {
  now(): Date;
  loadBooking(id: string): Promise<BookingRow | null>;
  fileExists(dedupeKey: string): Promise<boolean>;
  /** Uploads the bytes (over any earlier object) and inserts the row; "exists" when the row was already there. */
  saveFile(bookingId: string, file: FileToSave, webhookEventId?: string | null): Promise<"saved" | "exists">;
  /** Compare-and-set on the status it was read with; false when the row has moved meanwhile. */
  setStatus(id: string, from: BookingStatus, to: BookingStatus, atIso: string): Promise<boolean>;
  markReleased(id: string, atIso: string): Promise<void>;
};

const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/** The order id a WEBHOOK names: its `order_id` (a webhook's `id` is the LISTING). TixStock's own id, or ours. */
export function orderIdOf(data: Record<string, unknown>): string | null {
  return str(data.order_id);
}

/** Bytes or a link, from a field TixStock fills with base64 (sometimes as a data: URL) or with a URL. */
const bodyOrLink = (value: string): { base64?: string; url?: string } =>
  isUrl(value) ? { url: value } : { base64: value.replace(/^data:[^;,]*;base64,/i, "") };

const filesOfPart = (keyBase: string, part: Record<string, unknown>, fallback: { row: string | null; seat: string | null }): FileToSave[] => {
  const row = str(part.row) ?? fallback.row;
  const seat = str(part.seat) ?? fallback.seat;
  const key = (kind: TicketFileKind, seatOfKey: string | null, index: number): string =>
    `${keyBase}:${kind}:${row ?? ""}:${seatOfKey ?? ""}:${index}`;
  const out: FileToSave[] = [];

  list(part.file).forEach((value, index) => {
    const body = str(value);
    if (body) out.push({ kind: "pdf", row, seat, ...bodyOrLink(body), dedupeKey: key("pdf", seat, index) });
  });
  list(part.additional_file).forEach((value, index) => {
    const body = str(value);
    if (body) out.push({ kind: "additional", row, seat, ...bodyOrLink(body), dedupeKey: key("additional", seat, index) });
  });
  list(part.proof_file_url).forEach((value, index) => {
    const url = str(value);
    if (url) out.push({ kind: "proof", row, seat, url, dedupeKey: key("proof", seat, index) });
  });
  list(part.mobile_links).forEach((value, index) => {
    const entry = rec(value);
    const url = str(entry?.link);
    const linkSeat = str(entry?.seat) ?? seat;
    if (url) out.push({ kind: "mobile_link", row, seat: linkSeat, url, dedupeKey: key("mobile_link", linkSeat, index) });
  });
  return out;
};

/**
 * One reader for both sources. A webhook carries one ticket at the top level (`row`, `seat`, `file`, ...); an
 * order read back with orders/get is expected to carry them per item - that part is provisional until the first
 * sandbox refresh shows the real shape (plan Task 17, Stage 5). The key is the same either way: `bookingId` is the
 * `ticket_bookings` row the caller already found, so a ticket has one key whichever id the payload names.
 */
export function readOrderPayload(data: Record<string, unknown>, bookingId: string): OrderUpdate {
  const status = statusFromTixstock(data.order_status ?? data.status);
  const top = { row: str(data.row), seat: str(data.seat) };
  const files = filesOfPart(bookingId, data, top);
  for (const item of list(data.items)) {
    const part = rec(item);
    if (part) files.push(...filesOfPart(bookingId, part, { row: null, seat: null }));
  }
  const seen = new Set<string>();
  return { status, files: files.filter((f) => (seen.has(f.dedupeKey) ? false : (seen.add(f.dedupeKey), true))) };
}

/** Our status as TixStock spells it, for the webhook's answer; null for a state TixStock has no word for. */
export function statusToTixstock(status: BookingStatus): string | null {
  if (status === "sale_on_hold") return "Sale on Hold";
  if (status === "approved") return "Approved";
  if (status === "commissionable") return "Commissionable";
  if (status === "cancelled") return "Cancelled";
  return null;
}

/**
 * Where a file's bytes live inside the private `ticket-files` bucket (the bucket's name is not part of the path).
 * Row and seat are a seller's free text, so the key is hashed and never used as a path.
 */
export function ticketFileStoragePath(bookingId: string, dedupeKey: string): string {
  return `${bookingId}/${createHash("sha256").update(dedupeKey, "utf8").digest("hex").slice(0, 32)}`;
}

const BODY_KEYS = new Set(["file", "additional_file"]);
const LONG_STRING = 2000;

/** A payload fit for the log: every file body (and any very long string) becomes `{ bytes: n }`. */
export function stripBodies(value: unknown, underBodyKey = false): unknown {
  if (typeof value === "string") {
    return (underBodyKey && !isUrl(value)) || value.length > LONG_STRING ? { bytes: value.length } : value;
  }
  if (Array.isArray(value)) return value.map((v) => stripBodies(v, underBodyKey));
  const obj = rec(value);
  if (!obj) return value;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, stripBodies(v, BODY_KEYS.has(k))]));
}

/**
 * Writes an update to a booking: new files first, then the status. Files first, so a failure half way leaves the
 * status where it was and the same payload can simply be applied again.
 */
export async function applyOrderUpdate(
  bookingId: string,
  update: OrderUpdate,
  deps: ApplyDeps,
  webhookEventId?: string | null,
): Promise<{ status: BookingStatus; newFiles: number }> {
  const booking = await deps.loadBooking(bookingId);
  if (!booking) throw new Error(`ticket booking ${bookingId} not found`);

  let newFiles = 0;
  for (const file of update.files) {
    if (await deps.fileExists(file.dedupeKey)) continue;
    if ((await deps.saveFile(bookingId, file, webhookEventId)) === "saved") newFiles++;
  }

  const atIso = deps.now().toISOString();
  let status = booking.status;
  if (update.status && update.status !== status && canMoveTo(status, update.status)) {
    if (await deps.setStatus(bookingId, status, update.status, atIso)) status = update.status;
    else status = (await deps.loadBooking(bookingId))?.status ?? status;
  }

  if (booking.source === "site" && newFiles > 0 && !booking.released_to_customer_at) {
    await deps.markReleased(bookingId, atIso);
  }
  return { status, newFiles };
}
