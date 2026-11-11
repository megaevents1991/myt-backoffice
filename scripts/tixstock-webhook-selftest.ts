// Run: npx tsx scripts/tixstock-webhook-selftest.ts
// TixStock's webhook receiver (lib/services/tixstock-webhook.ts) and the order reader / applier it shares with the
// refresh and the sweep (lib/services/tixstock-order-apply.ts). Every DB and storage call is a stub: no network.
// What matters most here: a bad signature stores nothing, a file is stored once however often it arrives, a
// status never moves back, hold / release webhooks are answered `{ ok: true }` (TixStock, 10.11), a fulfilment is
// answered by how much of the order is in hand, and a booking is found by TixStock's order id or by ours (11.11).
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.5.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readOrderPayload, stripBodies, ticketFileStoragePath, type BookingRow, type FileToSave } from "../lib/services/tixstock-order-apply";
import { handleTixstockWebhook, verifyTixstockSignature, type OrderAnswerBody, type WebhookAnswer, type WebhookDeps } from "../lib/services/tixstock-webhook";
import { ourOrderId, type BookingStatus } from "../lib/tixstock-booking/rules";

const TOKEN = "sandbox-token";
const NOW = new Date("2026-11-10T12:00:00Z");
/** A ticket's own PDF: two tickets never share their bytes (each carries its own barcode). */
const pdfFor = (seat: string): string => Buffer.from(`%PDF-1.4 a ticket for seat ${seat}`).toString("base64");
const PDF = pdfFor("12");
/** The default booking row, and the order id it goes to TixStock under (`ourOrderId`). */
const B1 = "9f3a1c2e-1111-4222-8333-444455556666";
const OUR = "2233-9f3a1c2e";
const FULFILLED = "Listing has been fulfilled for the order.";
const sign = (raw: string, token = TOKEN): string => createHmac("sha256", token).update(raw, "utf8").digest("hex");

type LoggedEvent = { env: string; type: string | null; signatureValid: boolean; orderId: string | null; payload: unknown; result: unknown };
type StoredFile = FileToSave & { bookingId: string };

const world = (bookings: BookingRow[]) => {
  const files: StoredFile[] = [];
  const events: LoggedEvent[] = [];
  const state = { saveCalls: 0, failSaves: 0 };
  const deps: WebhookDeps = {
    now: () => NOW,
    logEvent: async (e) => {
      events.push({ ...e, result: null });
      return String(events.length - 1);
    },
    finishEvent: async (id, result) => {
      if (id !== null) events[Number(id)].result = result;
    },
    findBookingByOrder: async (env, orderId) => bookings.find((b) => b.env === env && b.tixstock_order_id === orderId) ?? null,
    findBookingByOurId: async (env, reservationId, bookingPrefix) => {
      const found = bookings.filter((b) => b.env === env && b.reservation_id === reservationId && b.id.toLowerCase().startsWith(bookingPrefix));
      return found.length === 1 ? found[0] : null;
    },
    countTicketFiles: async (bookingId) => ({
      pdf: files.filter((f) => f.bookingId === bookingId && f.kind === "pdf").length,
      mobileLink: files.filter((f) => f.bookingId === bookingId && f.kind === "mobile_link").length,
    }),
    findUncertain: async (env, listingId, sinceIso) =>
      bookings.filter((b) => b.env === env && b.status === "uncertain" && b.listing_id === listingId && b.created_at >= sinceIso),
    attachOrder: async (bookingId, orderId) => {
      const b = bookings.find((x) => x.id === bookingId);
      if (b) b.tixstock_order_id = orderId;
    },
    loadBooking: async (id) => bookings.find((b) => b.id === id) ?? null,
    fileExists: async (dedupeKey) => files.some((f) => f.dedupeKey === dedupeKey),
    saveFile: async (bookingId, file) => {
      state.saveCalls++;
      if (state.failSaves > 0) {
        state.failSaves--;
        throw new Error("the file row insert failed");
      }
      if (files.some((f) => f.dedupeKey === file.dedupeKey)) return "exists";
      files.push({ ...file, bookingId });
      return "saved";
    },
    setStatus: async (id, from, to) => {
      const b = bookings.find((x) => x.id === id);
      if (!b || b.status !== from) return false;
      b.status = to;
      return true;
    },
    markReleased: async (id, at) => {
      const b = bookings.find((x) => x.id === id);
      if (b && !b.released_to_customer_at) b.released_to_customer_at = at;
    },
  };
  return { deps, files, events, state, bookings };
};

const booking = (over: Partial<BookingRow> = {}): BookingRow => ({
  id: B1, reservation_id: 2233, env: "sandbox", source: "office", status: "sale_on_hold", listing_id: "L1", quantity: 2,
  tixstock_order_id: "O1", released_to_customer_at: null, created_at: "2026-11-10T11:30:00.000Z", ...over,
});

const send = (w: ReturnType<typeof world>, payload: unknown, opts: { signature?: string | null; apiToken?: string; env?: "sandbox" | "production" } = {}) => {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  return handleTixstockWebhook(
    {
      env: opts.env ?? "sandbox",
      rawBody,
      signature: opts.signature === undefined ? sign(rawBody) : opts.signature,
      apiToken: "apiToken" in opts ? opts.apiToken : TOKEN,
    },
    w.deps,
  );
};

/** The four fields of an order answer. A bare `{ ok: true }` (hold / release) has none of them and fails here. */
const fields = (r: WebhookAnswer): OrderAnswerBody => {
  if (!("success" in r.body)) throw new Error(`not an order answer: ${JSON.stringify(r.body)}`);
  return r.body;
};

const eticket = (over: Record<string, unknown> = {}) => ({
  meta: { type: "order.eticket_fulfilment" },
  data: { order_id: "O1", id: "L1", row: "A", seat: "12", order_status: "Approved", file: pdfFor(typeof over.seat === "string" ? over.seat : "12"), ...over },
});

/** Runs with the console's warnings held back (a refused request says so in the log). */
const silenced = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { warn } = console;
  console.warn = () => undefined;
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
  await fn();
  console.log("ok -", name);
};

// tsx compiles these scripts to CommonJS, where a top-level await is not allowed: the cases run inside main().
// prettier-ignore
const main = async (): Promise<void> => {
await run("bad signature 401", async () => {
  const w = world([booking()]);
  const r = await send(w, eticket(), { signature: sign("something else") });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { external_id: null, order_status: null, message: "bad signature", success: false });
  assert.equal(w.files.length, 0, "nothing is stored");
  assert.equal(w.state.saveCalls, 0);
  assert.equal(w.bookings[0].status, "sale_on_hold", "the booking is untouched");
  assert.equal(w.events.length, 1);
  assert.equal(w.events[0].signatureValid, false);
  assert.equal(JSON.stringify(w.events[0].payload).includes(PDF), false, "an unsigned body is not kept");
});

await run("a request with no signature is refused and leaves no row", async () => {
  // The URL is public: anyone can post to it. Only a request that at least claims a signature is worth a row
  // (it is what a real TixStock webhook with a key or encoding problem looks like); anything else must not be
  // able to fill the table.
  const w = world([booking()]);
  const r = await silenced(() => send(w, eticket(), { signature: null }));
  assert.equal(r.status, 401, "no signature at all");
  assert.deepEqual(r.body, { external_id: null, order_status: null, message: "bad signature", success: false });
  assert.equal(w.events.length, 0, "no row for an unsigned request");
  assert.equal(w.files.length, 0);
});

await run("the signature is over the bytes that arrived", async () => {
  // A body that starts with a byte-order mark: decoding it to text drops the mark, so a digest of the TEXT is not
  // the digest TixStock made. The route hands the raw bytes on, and those are what is verified.
  const json = JSON.stringify(eticket());
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, "utf8")]);
  const digest = createHmac("sha256", TOKEN).update(bytes).digest("hex");
  assert.equal(verifyTixstockSignature(bytes, digest, TOKEN), true);
  assert.equal(verifyTixstockSignature(json, digest, TOKEN), false, "the decoded text is another input");
  const w = world([booking()]);
  const r = await handleTixstockWebhook({ env: "sandbox", rawBody: json, rawBytes: bytes, signature: digest, apiToken: TOKEN }, w.deps);
  assert.equal(r.status, 200);
  assert.equal(w.files.length, 1);
});

await run("missing token 401", async () => {
  const w = world([booking()]);
  const r = await send(w, eticket(), { apiToken: undefined });
  assert.equal(r.status, 401, "with no token configured every webhook is refused");
  assert.equal(w.files.length, 0);
  assert.equal((await send(w, eticket(), { apiToken: "" })).status, 401);
  assert.equal(w.events.length, 0, "with no token there is nothing to check a signature against, so nothing to log either");
});

await run("signature encodings", async () => {
  const raw = JSON.stringify({ meta: { type: "order.update" }, data: { order_id: "O1" } });
  const digest = createHmac("sha256", TOKEN).update(raw, "utf8").digest();
  assert.equal(verifyTixstockSignature(raw, digest.toString("hex"), TOKEN), true, "lower-case hex");
  assert.equal(verifyTixstockSignature(raw, digest.toString("hex").toUpperCase(), TOKEN), true, "upper-case hex");
  assert.equal(verifyTixstockSignature(raw, `sha256=${digest.toString("hex")}`, TOKEN), true, "sha256=<hex>");
  assert.equal(verifyTixstockSignature(raw, digest.toString("base64"), TOKEN), true, "base64");
  const reordered = JSON.stringify({ data: { order_id: "O1" }, meta: { type: "order.update" } });
  assert.equal(verifyTixstockSignature(reordered, digest.toString("hex"), TOKEN), false, "the same JSON re-serialised");
  assert.equal(verifyTixstockSignature(raw, digest.toString("hex"), "another-token"), false);
  assert.equal(verifyTixstockSignature(raw, "", TOKEN), false);
  assert.equal(verifyTixstockSignature(raw, "not-a-digest", TOKEN), false);
  assert.equal(verifyTixstockSignature(raw, digest.toString("hex"), undefined), false);
});

await run("eticket stores and answers", async () => {
  const w = world([booking()]);
  const r = await send(w, eticket());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { external_id: OUR, order_status: "Completed", message: FULFILLED, success: true }, "one ticket of two is in hand");
  assert.equal(w.state.saveCalls, 1);
  assert.equal(w.files.length, 1);
  assert.equal(w.files[0].kind, "pdf");
  assert.equal(w.files[0].row, "A");
  assert.equal(w.files[0].seat, "12");
  assert.equal(w.files[0].base64, PDF);
  assert.match(w.files[0].dedupeKey, new RegExp(`^${B1}:pdf:[0-9a-f]{40}$`), "keyed by OUR booking and the file's own content - not by the order id, the seat or its place in the payload");
  assert.equal(w.bookings[0].status, "approved");
  assert.equal(w.bookings[0].released_to_customer_at, null, "an office booking is released by staff, not by the webhook");
  assert.equal(w.events[0].signatureValid, true);
  assert.equal(w.events[0].type, "order.eticket_fulfilment");
  assert.equal(w.events[0].orderId, "O1");
  assert.equal(JSON.stringify(w.events[0].payload).includes(PDF), false, "the log keeps no file body");
});

await run("a site booking's ticket is released as it arrives", async () => {
  const w = world([booking({ source: "site" })]);
  await send(w, eticket());
  assert.equal(w.bookings[0].released_to_customer_at, NOW.toISOString());
});

await run("repeat is idempotent", async () => {
  const w = world([booking()]);
  const first = await send(w, eticket());
  const second = await send(w, eticket());
  assert.equal(w.state.saveCalls, 1, "the file is saved once in total");
  assert.equal(w.files.length, 1);
  assert.deepEqual(second, first, "the two answers are equal");
});

await run("two tickets with the same row and no seat are two tickets", async () => {
  // General admission, or a seller who gives no seat numbers: every fulfilment webhook carries ONE file, so its
  // place in the payload is always the first. Each ticket must still be kept.
  const w = world([booking()]);
  const first = await send(w, eticket({ order_status: undefined, row: undefined, seat: undefined, file: pdfFor("first") }));
  const second = await send(w, eticket({ order_status: undefined, row: undefined, seat: undefined, file: pdfFor("second") }));
  assert.equal(w.files.length, 2, "the second ticket is not dropped as a repeat of the first");
  assert.deepEqual([fields(first).order_status, fields(second).order_status], ["Completed", "Commissionable"]);
  const again = await send(w, eticket({ order_status: undefined, row: undefined, seat: undefined, file: pdfFor("second") }));
  assert.equal(w.files.length, 2, "the same ticket sent again is still stored once");
  assert.equal(fields(again).order_status, "Commissionable");
});

await run("no status regression", async () => {
  const w = world([booking()]);
  await send(w, eticket({ order_status: "Commissionable", seat: "13" }));
  assert.equal(w.bookings[0].status, "commissionable");
  const late = await send(w, eticket({ order_status: "Approved", seat: "12" }));
  assert.equal(w.bookings[0].status, "commissionable", "a late Approved does not move it back");
  assert.equal(fields(late).order_status, "Commissionable");
  assert.equal(w.files.length, 2, "the late ticket is still stored");
});

await run("mobile link", async () => {
  const w = world([booking({ status: "approved" })]);
  await send(w, { meta: { type: "order.mobile_link_ticket_fulfilment" }, data: { order_id: "O1", id: "L1", row: "A", mobile_links: [{ seat: "12", link: "https://x" }] } });
  assert.equal(w.files.length, 1);
  assert.equal(w.files[0].kind, "mobile_link");
  assert.equal(w.files[0].url, "https://x");
  assert.equal(w.files[0].seat, "12");
  assert.equal(w.files[0].base64, undefined);
});

await run("proof only", async () => {
  const w = world([booking({ status: "approved" })]);
  await send(w, { meta: { type: "order.mobile_ticket_fulfilment" }, data: { order_id: "O1", id: "L1", proof_file_url: ["https://p"] } });
  assert.equal(w.files.length, 1);
  assert.equal(w.files[0].kind, "proof");
  assert.equal(w.files[0].url, "https://p");
});

await run("instruction letter", async () => {
  const w = world([booking({ status: "approved" })]);
  await send(w, eticket({ additional_file: PDF }));
  assert.deepEqual(w.files.map((f) => f.kind).sort(), ["additional", "pdf"]);
  const url = world([booking({ status: "approved" })]);
  await send(url, eticket({ file: undefined, additional_file: "https://letters.example/a.pdf" }));
  assert.equal(url.files[0].kind, "additional");
  assert.equal(url.files[0].url, "https://letters.example/a.pdf");
});

await run("retry after a half-stored file", async () => {
  const w = world([booking()]);
  w.state.failSaves = 1;
  const first = await send(w, eticket());
  assert.equal(first.status, 500, "a failure of ours is not answered as done");
  assert.equal(fields(first).success, false);
  assert.equal(w.files.length, 0);
  const again = await send(w, eticket());
  assert.equal(again.status, 200);
  assert.equal(w.files.length, 1, "one row in the end");
  assert.equal(w.state.saveCalls, 2);
});

await run("uncertain is matched", async () => {
  const w = world([booking({ status: "uncertain", tixstock_order_id: null })]);
  const r = await send(w, eticket({ order_id: "O9", quantity: 2 }));
  assert.equal(fields(r).success, true);
  assert.equal(w.bookings[0].tixstock_order_id, "O9");
  assert.equal(w.bookings[0].status, "approved");
  assert.equal(fields(r).external_id, OUR);

  const two = world([
    booking({ id: "b1", status: "uncertain", tixstock_order_id: null }),
    booking({ id: "b2", reservation_id: 2234, status: "uncertain", tixstock_order_id: null }),
  ]);
  const none = await send(two, eticket({ order_id: "O9", quantity: 2 }));
  assert.equal(fields(none).success, false, "two candidates: nothing is guessed");
  assert.equal(two.bookings.every((b) => b.tixstock_order_id === null), true);
  assert.equal(two.files.length, 0);

  const old = world([booking({ status: "uncertain", tixstock_order_id: null, created_at: "2026-11-10T10:30:00.000Z" })]);
  assert.equal(fields(await send(old, eticket({ order_id: "O9" }))).success, false, "older than 60 minutes");
  const otherQty = world([booking({ status: "uncertain", tixstock_order_id: null, quantity: 4 })]);
  assert.equal(fields(await send(otherQty, eticket({ order_id: "O9", quantity: 2 }))).success, false, "another quantity");
  const otherEnv = world([booking({ status: "uncertain", tixstock_order_id: null })]);
  assert.equal(fields(await send(otherEnv, eticket({ order_id: "O9" }), { env: "production" })).success, false, "another environment");
});

await run("an e-ticket order answers Completed until its last ticket, then Commissionable", async () => {
  // TixStock, 11.11: quantity 2 - the first fulfilment is answered "Completed", the final one "Commissionable".
  const w = world([booking({ status: "approved" })]);
  const first = await send(w, eticket({ order_status: undefined }));
  assert.deepEqual(first.body, { external_id: OUR, order_status: "Completed", message: FULFILLED, success: true }, "one of two");
  assert.equal(w.bookings[0].status, "approved", "our row waits for the last ticket");
  const again = await send(w, eticket({ order_status: undefined }));
  assert.equal(fields(again).order_status, "Completed", "the same ticket sent twice is still one ticket");
  const last = await send(w, eticket({ order_status: undefined, seat: "13" }));
  assert.deepEqual(last.body, { external_id: OUR, order_status: "Commissionable", message: FULFILLED, success: true }, "two of two");
  assert.equal(w.bookings[0].status, "commissionable", "with the last ticket the order is Commissionable on our side too");

  const single = world([booking({ status: "approved", quantity: 1 })]);
  assert.equal(fields(await send(single, eticket({ order_status: undefined }))).order_status, "Commissionable", "an order of one is whole at once");
  assert.equal(single.bookings[0].status, "commissionable");
});

await run("a mobile fulfilment answers Commissionable", async () => {
  const link = (seat: string) => ({ meta: { type: "order.mobile_link_ticket_fulfilment" }, data: { order_id: "O1", id: "L1", row: "A", mobile_links: [{ seat, link: `https://x/${seat}` }] } });
  const w = world([booking({ status: "approved" })]);
  const first = await send(w, link("12"));
  assert.deepEqual(first.body, { external_id: OUR, order_status: "Commissionable", message: FULFILLED, success: true }, "TixStock, 11.11: mobile is Commissionable whatever the count");
  assert.equal(w.bookings[0].status, "approved", "our own row still waits for the second link");
  await send(w, link("13"));
  assert.equal(w.bookings[0].status, "commissionable");

  const proof = world([booking({ status: "approved" })]);
  const r = await send(proof, { meta: { type: "order.mobile_ticket_fulfilment" }, data: { order_id: "O1", id: "L1", proof_file_url: ["https://p"] } });
  assert.equal(fields(r).order_status, "Commissionable");
  assert.equal(proof.bookings[0].status, "approved", "a proof of transfer is not a ticket in hand: TixStock's own status moves that row");
});

await run("a cancelled order is never made Commissionable by a late ticket", async () => {
  const w = world([booking({ status: "cancelled", quantity: 1 })]);
  await send(w, eticket({ order_status: undefined }));
  assert.equal(w.bookings[0].status, "cancelled");
});

await run("a webhook that names OUR order id finds its booking", async () => {
  const w = world([booking({ status: "approved" })]);
  const r = await send(w, eticket({ order_id: OUR, order_status: undefined }));
  assert.equal(fields(r).success, true);
  assert.equal(fields(r).external_id, OUR);
  assert.equal(w.files.length, 1);
  assert.equal(w.bookings[0].tixstock_order_id, "O1", "TixStock's own id is left as it was");

  const lost = world([booking({ status: "uncertain", tixstock_order_id: null })]);
  const found = await send(lost, eticket({ order_id: OUR }));
  assert.equal(fields(found).success, true, "an order whose answer we lost is found by the id we sent");
  assert.equal(lost.bookings[0].status, "approved");
  assert.equal(lost.bookings[0].tixstock_order_id, null, "our own id is never stored as TixStock's");

  const otherEnv = world([booking()]);
  assert.equal(fields(await send(otherEnv, eticket({ order_id: OUR }), { env: "production" })).success, false, "another environment");
  const otherReservation = world([booking()]);
  assert.equal(fields(await send(otherReservation, eticket({ order_id: "2234-9f3a1c2e" }))).success, false, "another reservation");
  const otherBooking = world([booking()]);
  assert.equal(fields(await send(otherBooking, eticket({ order_id: "2233-0b7d44aa" }))).success, false, "another booking of the reservation");
});

await run("a ticket is stored once whichever id the payload names", async () => {
  const w = world([booking({ status: "approved" })]);
  await send(w, eticket());
  await send(w, eticket({ order_id: OUR }));
  assert.equal(w.files.length, 1, "the key is the booking, not the id in the payload");
  assert.equal(w.state.saveCalls, 1);
});

await run("unknown order", async () => {
  const w = world([booking()]);
  const r = await send(w, eticket({ order_id: "nobody" }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { external_id: null, order_status: null, message: "unknown order", success: false });
  assert.equal(w.files.length, 0);
  assert.equal(w.events.length, 1, "it is logged");
});

await run("hold and release are answered ok", async () => {
  for (const type of ["ticket.hold", "ticket.release"]) {
    const w = world([booking()]);
    const r = await send(w, { meta: { type }, data: { id: "L1", quantity: 2 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true }, `${type}: exactly what TixStock asked for on 10.11, nothing beside it`);
    assert.equal(w.events.length, 1, "it is logged");
    assert.equal(w.events[0].type, type);
    assert.deepEqual(w.events[0].result, { status: 200, ok: true }, "the log keeps what was answered");
    assert.equal(w.state.saveCalls, 0);
    assert.equal(w.bookings[0].status, "sale_on_hold");
  }
});

await run("another order-less type is logged, and answered for a reader of either shape", async () => {
  // TixStock named hold and release only. ticket.fullfillment (listing level) carries no order either.
  for (const type of ["ticket.fullfillment", "listing.something_new"]) {
    const w = world([booking()]);
    const r = await send(w, { meta: { type }, data: { id: "L1", quantity: 2 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, external_id: null, order_status: null, message: "logged", success: true }, type);
    assert.equal(w.events.length, 1);
    assert.equal(w.events[0].type, type);
    assert.equal(w.state.saveCalls, 0);
    assert.equal(w.bookings[0].status, "sale_on_hold");
  }
});

await run("an order answer carries our own order id and no ok", async () => {
  const w = world([booking()]);
  const r = await send(w, { meta: { type: "order.update" }, data: { order_id: "O1" } });
  assert.equal(fields(r).external_id, ourOrderId(2233, B1), "the id orders/add sent as order_id");
  assert.equal(fields(r).external_id, OUR);
  assert.equal("ok" in r.body, false);
});

await run("order.update answers our status", async () => {
  const w = world([booking({ status: "approved" })]);
  const r = await send(w, { meta: { type: "order.update" }, data: { order_id: "O1" } });
  assert.deepEqual(r.body, { external_id: OUR, order_status: "Approved", message: "ok", success: true });
  const moved = await send(w, { meta: { type: "order.update" }, data: { order_id: "O1", order_status: "Cancelled" } });
  assert.equal(w.bookings[0].status, "cancelled", "TixStock reports a cancellation");
  assert.equal(fields(moved).order_status, "Cancelled");
});

await run("a signed body that is not our kind of JSON is refused, not crashed on", async () => {
  const w = world([booking()]);
  assert.equal((await send(w, "not json")).status, 400);
  assert.equal((await send(w, "[1,2]")).status, 400);
  assert.equal(w.events.length, 2);
});

await run("reading an order", async () => {
  const statuses: Array<[unknown, BookingStatus | null]> = [["Approved", "approved"], ["Commissionable", "commissionable"], [undefined, null]];
  for (const [given, expected] of statuses) {
    assert.equal(readOrderPayload({ order_id: "O1", order_status: given }, B1).status, expected);
  }
  assert.equal(readOrderPayload({ order_id: "O1", status: "Sale on Hold" }, B1).status, "sale_on_hold", "status is read when order_status is absent");
  const many = readOrderPayload({ order_id: "O1", row: "A", seat: "12", file: [PDF, pdfFor("13")], proof_file_url: ["https://p1", "https://p2"] }, B1);
  assert.deepEqual(many.files.map((f) => f.kind), ["pdf", "pdf", "proof", "proof"]);
  assert.equal(new Set(many.files.map((f) => f.dedupeKey)).size, 4, "two different files and two different links: four keys");
  const twice = readOrderPayload({ order_id: "O1", row: "A", seat: "12", file: [PDF, PDF], proof_file_url: ["https://p1", "https://p1"] }, B1);
  assert.deepEqual(twice.files.map((f) => f.kind), ["pdf", "proof"], "the same bytes, or the same link, twice in one payload is one file");
  const dataUrl = readOrderPayload({ order_id: "O1", file: `data:application/pdf;base64,${PDF}` }, B1);
  assert.equal(dataUrl.files[0].base64, PDF, "a data: prefix is dropped");
  // a refresh (orders/get) carries the same files per item, and the type is not in the key
  const refreshed = readOrderPayload({ id: "O1", order_id: OUR, status: "Approved", items: [{ row: "A", seat: "12", file: PDF }] }, B1);
  assert.equal(refreshed.status, "approved");
  const fromWebhook = readOrderPayload({ order_id: "O1", row: "A", seat: "12", file: PDF }, B1).files[0].dedupeKey;
  assert.deepEqual(refreshed.files.map((f) => f.dedupeKey), [fromWebhook], "the same key the webhook gave that ticket, whichever id the order read back names");
  assert.equal(readOrderPayload({ file: `data:application/pdf;base64,${PDF}` }, B1).files[0].dedupeKey, fromWebhook, "the same file with no row, no seat and a data: prefix is still that file");
  assert.notEqual(readOrderPayload({ row: "A", seat: "12", file: PDF }, "0b7d44aa-1111-4222-8333-444455556666").files[0].dedupeKey, fromWebhook, "another booking's file is another key");
  assert.equal(readOrderPayload({ row: "A", seat: "12", file: PDF }, B1).files.length, 1, "the booking is known by then: a payload needs no order id to carry a file");
});

await run("storage path and the log's payload", async () => {
  const path = ticketFileStoragePath("b1", "O1:pdf:../../etc:12:0");
  assert.match(path, /^b1\/[0-9a-f]{32}$/, "the booking id and a hash - no bucket name, no seller text");
  assert.notEqual(path, ticketFileStoragePath("b1", "O1:pdf:A:13:0"));
  const big = "x".repeat(5000);
  assert.deepEqual(stripBodies({ data: { file: big, row: "A", list: [big, "short"] } }), {
    data: { file: { bytes: 5000 }, row: "A", list: [{ bytes: 5000 }, "short"] },
  });
});
};

main()
  .then(() => console.log("tixstock-webhook-selftest: all passed"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
