// Run: npx tsx scripts/tixstock-webhook-selftest.ts
// TixStock's webhook receiver (lib/services/tixstock-webhook.ts) and the order reader / applier it shares with the
// refresh and the sweep (lib/services/tixstock-order-apply.ts). Every DB and storage call is a stub: no network.
// What matters most here: a bad signature stores nothing, a file is stored once however often it arrives, a
// status never moves back, and hold / release webhooks of our own holds are answered success:true.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.5.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readOrderPayload, stripBodies, ticketFileStoragePath, type BookingRow, type FileToSave } from "../lib/services/tixstock-order-apply";
import { handleTixstockWebhook, verifyTixstockSignature, type WebhookDeps } from "../lib/services/tixstock-webhook";
import type { BookingStatus } from "../lib/tixstock-booking/rules";

const TOKEN = "sandbox-token";
const NOW = new Date("2026-11-10T12:00:00Z");
const PDF = Buffer.from("%PDF-1.4 a ticket").toString("base64");
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
  id: "b1", reservation_id: 2233, env: "sandbox", source: "office", status: "sale_on_hold", listing_id: "L1", quantity: 2,
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

const eticket = (over: Record<string, unknown> = {}) => ({
  meta: { type: "order.eticket_fulfilment" },
  data: { order_id: "O1", id: "L1", row: "A", seat: "12", order_status: "Approved", file: PDF, ...over },
});

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
  assert.equal((await send(w, eticket(), { signature: null })).status, 401, "no signature at all");
});

await run("missing token 401", async () => {
  const w = world([booking()]);
  const r = await send(w, eticket(), { apiToken: undefined });
  assert.equal(r.status, 401, "with no token configured every webhook is refused");
  assert.equal(w.files.length, 0);
  assert.equal((await send(w, eticket(), { apiToken: "" })).status, 401);
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
  assert.deepEqual(r.body, { external_id: "2233", order_status: "Approved", message: "ok", success: true });
  assert.equal(w.state.saveCalls, 1);
  assert.equal(w.files.length, 1);
  assert.equal(w.files[0].kind, "pdf");
  assert.equal(w.files[0].row, "A");
  assert.equal(w.files[0].seat, "12");
  assert.equal(w.files[0].base64, PDF);
  assert.equal(w.files[0].dedupeKey, "O1:pdf:A:12:0");
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

await run("no status regression", async () => {
  const w = world([booking()]);
  await send(w, eticket({ order_status: "Commissionable", seat: "13" }));
  assert.equal(w.bookings[0].status, "commissionable");
  const late = await send(w, eticket({ order_status: "Approved", seat: "12" }));
  assert.equal(w.bookings[0].status, "commissionable", "a late Approved does not move it back");
  assert.equal(late.body.order_status, "Commissionable");
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
  assert.equal(first.body.success, false);
  assert.equal(w.files.length, 0);
  const again = await send(w, eticket());
  assert.equal(again.status, 200);
  assert.equal(w.files.length, 1, "one row in the end");
  assert.equal(w.state.saveCalls, 2);
});

await run("uncertain is matched", async () => {
  const w = world([booking({ status: "uncertain", tixstock_order_id: null })]);
  const r = await send(w, eticket({ order_id: "O9", quantity: 2 }));
  assert.equal(r.body.success, true);
  assert.equal(w.bookings[0].tixstock_order_id, "O9");
  assert.equal(w.bookings[0].status, "approved");
  assert.equal(r.body.external_id, "2233");

  const two = world([
    booking({ id: "b1", status: "uncertain", tixstock_order_id: null }),
    booking({ id: "b2", reservation_id: 2234, status: "uncertain", tixstock_order_id: null }),
  ]);
  const none = await send(two, eticket({ order_id: "O9", quantity: 2 }));
  assert.equal(none.body.success, false, "two candidates: nothing is guessed");
  assert.equal(two.bookings.every((b) => b.tixstock_order_id === null), true);
  assert.equal(two.files.length, 0);

  const old = world([booking({ status: "uncertain", tixstock_order_id: null, created_at: "2026-11-10T10:30:00.000Z" })]);
  assert.equal((await send(old, eticket({ order_id: "O9" }))).body.success, false, "older than 60 minutes");
  const otherQty = world([booking({ status: "uncertain", tixstock_order_id: null, quantity: 4 })]);
  assert.equal((await send(otherQty, eticket({ order_id: "O9", quantity: 2 }))).body.success, false, "another quantity");
  const otherEnv = world([booking({ status: "uncertain", tixstock_order_id: null })]);
  assert.equal((await send(otherEnv, eticket({ order_id: "O9" }), { env: "production" })).body.success, false, "another environment");
});

await run("unknown order", async () => {
  const w = world([booking()]);
  const r = await send(w, eticket({ order_id: "nobody" }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { external_id: null, order_status: null, message: "unknown order", success: false });
  assert.equal(w.files.length, 0);
  assert.equal(w.events.length, 1, "it is logged");
});

await run("hold, release and listing fulfilment are logged only", async () => {
  for (const type of ["ticket.hold", "ticket.release", "ticket.fullfillment"]) {
    const w = world([booking()]);
    const r = await send(w, { meta: { type }, data: { id: "L1", quantity: 2 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { external_id: null, order_status: null, message: "logged", success: true }, type);
    assert.equal(w.events.length, 1);
    assert.equal(w.events[0].type, type);
    assert.equal(w.state.saveCalls, 0);
    assert.equal(w.bookings[0].status, "sale_on_hold");
  }
});

await run("order.update answers our status", async () => {
  const w = world([booking({ status: "approved" })]);
  const r = await send(w, { meta: { type: "order.update" }, data: { order_id: "O1" } });
  assert.deepEqual(r.body, { external_id: "2233", order_status: "Approved", message: "ok", success: true });
  const moved = await send(w, { meta: { type: "order.update" }, data: { order_id: "O1", order_status: "Cancelled" } });
  assert.equal(w.bookings[0].status, "cancelled", "TixStock reports a cancellation");
  assert.equal(moved.body.order_status, "Cancelled");
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
    assert.equal(readOrderPayload("order.update", { order_id: "O1", order_status: given }).status, expected);
  }
  assert.equal(readOrderPayload("order.update", { order_id: "O1", status: "Sale on Hold" }).status, "sale_on_hold", "status is read when order_status is absent");
  const many = readOrderPayload("order.eticket_fulfilment", { order_id: "O1", row: "A", seat: "12", file: [PDF, PDF], proof_file_url: ["https://p1", "https://p2"] });
  assert.deepEqual(many.files.map((f) => f.dedupeKey), ["O1:pdf:A:12:0", "O1:pdf:A:12:1", "O1:proof:A:12:0", "O1:proof:A:12:1"]);
  const dataUrl = readOrderPayload("order.eticket_fulfilment", { order_id: "O1", file: `data:application/pdf;base64,${PDF}` });
  assert.equal(dataUrl.files[0].base64, PDF, "a data: prefix is dropped");
  // a refresh (orders/get) carries the same files per item, and the type is not in the key
  const refreshed = readOrderPayload("orders.get", { id: "O1", status: "Approved", items: [{ row: "A", seat: "12", file: PDF }] });
  assert.equal(refreshed.status, "approved");
  assert.deepEqual(refreshed.files.map((f) => f.dedupeKey), ["O1:pdf:A:12:0"], "the same key the webhook gave that ticket");
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
