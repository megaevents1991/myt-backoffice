// Run: npx tsx scripts/tixstock-booking-sweep-selftest.ts
// The bookings sweep (lib/services/tixstock-booking-sweep.ts): what the cron does to a booking nobody finished.
// Every DB, TixStock and mail call is a stub: no network. What matters most here: the sweep NEVER adds an order,
// a hold is released only after the row was moved (so a payment that claimed it meanwhile keeps its hold), an
// order attempt that died is `uncertain`, and a dry run touches nothing.
// Spec: docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md 7.4, 7.5, 7.8.
import assert from "node:assert/strict";
import { sweepTixstockBookings, type SweepDeps, type SweepReservation, type SweepRow } from "../lib/services/tixstock-booking-sweep";
import type { FileToSave } from "../lib/services/tixstock-order-apply";
import type { TixstockCall, TixstockClient } from "../lib/tixstock-booking/client";
import { ourOrderId } from "../lib/tixstock-booking/rules";

const NOW = new Date("2026-11-10T12:00:00Z");
const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();
const daysAhead = (d: number): string => new Date(NOW.getTime() + d * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from("%PDF-1.4 a ticket").toString("base64");
// TixStock, 11.11: orders/update and orders/get take the order_id WE sent ({external_order_id}), never the id
// orders/add returned ("O1" in these rows). The default row is booking "b1" of reservation 1.
const OUR = ourOrderId(1, "b1");
assert.notEqual(OUR, "O1");

const row = (over: Partial<SweepRow>): SweepRow => ({
  id: "b1",
  reservation_id: 1,
  env: "sandbox",
  source: "site",
  status: "on_hold",
  listing_id: "L1",
  quantity: 2,
  hold_id: "H1",
  tixstock_order_id: null,
  released_to_customer_at: null,
  created_at: minutesAgo(16),
  updated_at: minutesAgo(16),
  attempt_started_at: null,
  last_refresh_at: null,
  link_email_sent_at: null,
  customer_token: "tok-1",
  ...over,
});

const reservation = (over: Partial<SweepReservation> = {}): SweepReservation => ({
  paid: false,
  email: "buyer@example.com",
  eventName: "Juventus FC vs Como",
  eventDate: daysAhead(120),
  ...over,
});

type Mail = { to: string; subject: string; html: string; text?: string; from?: string };

const world = (rows: SweepRow[], reservations: Record<number, SweepReservation | null> = { 1: reservation() }) => {
  const lastError: Record<string, string> = {};
  const files: (FileToSave & { bookingId: string })[] = [];
  const mails: Mail[] = [];
  const log: string[] = [];
  const state = {
    writes: 0,
    hasClient: true,
    failMail: false,
    updateOrder: { ok: true, data: { status: "Approved" } } as TixstockCall<{ status: string }>,
    getOrder: { ok: true, data: { id: "O1", status: "Approved" } } as TixstockCall<Record<string, unknown>>,
    /** Runs right after the sweep read its rows - a payment or a webhook that got there first. */
    afterList: null as null | (() => void),
  };
  const find = (id: string) => rows.find((r) => r.id === id);
  const never = (name: string) => async (): Promise<never> => {
    throw new Error(`the sweep must never call ${name}`);
  };
  const client: TixstockClient = {
    listings: never("listings"),
    eventVenueCountry: never("eventVenueCountry"),
    hold: never("hold"),
    addOrder: never("addOrder"),
    release: async (holdId, qty) => {
      log.push(`release:${holdId}:${qty}`);
      return { ok: true, data: true };
    },
    updateOrder: async (orderId, body) => {
      log.push(`updateOrder:${orderId}:${JSON.stringify(body)}`);
      return state.updateOrder;
    },
    getOrder: async (orderId) => {
      log.push(`getOrder:${orderId}`);
      return state.getOrder;
    },
  };
  const move = (id: string, from: string, to: SweepRow["status"], at: string, error?: string): boolean => {
    const r = find(id);
    if (!r || r.status !== from) return false;
    state.writes++;
    r.status = to;
    r.updated_at = at;
    if (error) lastError[id] = error;
    log.push(`status:${id}:${to}`);
    return true;
  };
  const deps: SweepDeps = {
    now: () => NOW,
    loadBooking: async (id) => find(id) ?? null,
    fileExists: async (key) => files.some((f) => f.dedupeKey === key),
    saveFile: async (bookingId, file) => {
      if (files.some((f) => f.dedupeKey === file.dedupeKey)) return "exists";
      state.writes++;
      files.push({ ...file, bookingId });
      return "saved";
    },
    setStatus: async (id, from, to, at) => move(id, from, to, at),
    markReleased: async (id, at) => {
      const r = find(id);
      if (r && !r.released_to_customer_at) {
        state.writes++;
        r.released_to_customer_at = at;
      }
    },
    listOpen: async (limit) => {
      const open = rows
        .filter((r) => ["holding", "on_hold", "ordering", "sale_on_hold"].includes(r.status))
        .slice(0, limit)
        .map((r) => ({ ...r }));
      state.afterList?.();
      return open;
    },
    listRefreshDue: async ({ createdBeforeIso, staleBeforeIso }, limit) =>
      rows
        .filter(
          (r) =>
            (r.status === "approved" || r.status === "commissionable") &&
            r.tixstock_order_id !== null &&
            r.created_at < createdBeforeIso &&
            (r.last_refresh_at === null || r.last_refresh_at < staleBeforeIso) &&
            !files.some((f) => f.bookingId === r.id),
        )
        .slice(0, limit)
        .map((r) => ({ ...r })),
    loadReservation: async (id) => reservations[id] ?? null,
    setStatusWithError: async (id, from, to, at, error) => move(id, from, to, at, error),
    markRefreshChecked: async (id, at) => {
      const r = find(id);
      if (r) {
        state.writes++;
        r.last_refresh_at = at;
      }
    },
    claimLinkEmail: async (id, at) => {
      const r = find(id);
      if (!r || r.link_email_sent_at !== null) return false;
      state.writes++;
      r.link_email_sent_at = at;
      return true;
    },
    unclaimLinkEmail: async (id, at) => {
      const r = find(id);
      if (r && r.link_email_sent_at === at) {
        state.writes++;
        r.link_email_sent_at = null;
      }
    },
    clientFor: () => (state.hasClient ? client : null),
    sendMail: async (mail) => {
      if (state.failMail) throw new Error("smtp refused");
      mails.push(mail);
    },
  };
  return { deps, rows, files, mails, log, lastError, state, find };
};

/** console.error is how the sweep raises its two alerts; the test reads what it was called with. */
const withErrors = async <T>(fn: () => Promise<T>): Promise<{ value: T; errors: string[] }> => {
  const errors: string[] = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  // A warning is the sweep's note of a call TixStock did not do - expected in these cases, kept off the output.
  console.warn = () => {};
  try {
    return { value: await fn(), errors };
  } finally {
    console.error = original.error;
    console.warn = original.warn;
  }
};

const run = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    console.error(`FAILED: ${name}`);
    throw e;
  }
};

const main = async () => {
  await run("abandoned hold released", async () => {
    const w = world([row({})]);
    const result = await sweepTixstockBookings(NOW, w.deps);
    assert.equal(w.find("b1")?.status, "released");
    assert.deepEqual(w.log, ["status:b1:released", "release:H1:2"], "the row moves FIRST, then the hold is released, once");
    assert.equal(result.released, 1);

    // a payment claimed the row between the sweep's read and its update: the hold is the payment's now
    const claimed = world([row({})]);
    claimed.state.afterList = () => {
      const r = claimed.find("b1");
      if (r) r.status = "ordering";
    };
    const none = await sweepTixstockBookings(NOW, claimed.deps);
    assert.equal(claimed.find("b1")?.status, "ordering");
    assert.deepEqual(claimed.log, [], "no release when the update matched no row");
    assert.equal(none.released, 0);

    // 14 minutes: the customer may still be on the payment page
    const young = world([row({ created_at: minutesAgo(14) })]);
    await sweepTixstockBookings(NOW, young.deps);
    assert.equal(young.find("b1")?.status, "on_hold");
    assert.deepEqual(young.log, []);

    // no sandbox token on this deployment: our row is still closed, TixStock's hold runs out by itself
    const noClient = world([row({})]);
    noClient.state.hasClient = false;
    await sweepTixstockBookings(NOW, noClient.deps);
    assert.equal(noClient.find("b1")?.status, "released");
    assert.deepEqual(noClient.log, ["status:b1:released"]);
  });

  await run("paid but never ordered", async () => {
    const w = world([row({ created_at: minutesAgo(20) })], { 1: reservation({ paid: true }) });
    const { value, errors } = await withErrors(() => sweepTixstockBookings(NOW, w.deps));
    assert.equal(w.find("b1")?.status, "failed");
    assert.equal(w.lastError.b1, "paid_not_ordered");
    assert.deepEqual(w.log, ["status:b1:failed", "release:H1:2"], "released once, and no orders/add from the sweep");
    assert.equal(errors.filter((e) => e.includes("tixstock_paid_site_booking_not_ordered")).length, 1);
    assert.equal(value.failed, 1);
    assert.equal(value.released, 0);

    // paid 16 minutes after the pay click: the site's own step may still be running
    const soon = world([row({ created_at: minutesAgo(16) })], { 1: reservation({ paid: true }) });
    await sweepTixstockBookings(NOW, soon.deps);
    assert.equal(soon.find("b1")?.status, "on_hold");
    assert.deepEqual(soon.log, []);
  });

  await run("dead order attempt is uncertain", async () => {
    const w = world([row({ status: "ordering", attempt_started_at: minutesAgo(6) })], { 1: reservation({ paid: true }) });
    const result = await sweepTixstockBookings(NOW, w.deps);
    assert.equal(w.find("b1")?.status, "uncertain");
    assert.deepEqual(w.log, ["status:b1:uncertain"], "no TixStock call: the order may exist there");
    assert.equal(result.uncertain, 1);

    const live = world([row({ status: "ordering", attempt_started_at: minutesAgo(4) })]);
    await sweepTixstockBookings(NOW, live.deps);
    assert.equal(live.find("b1")?.status, "ordering");

    // a claim with no start time is judged by the row's last change, never left `ordering` for ever
    const bare = world([row({ status: "ordering", attempt_started_at: null, updated_at: minutesAgo(7) })]);
    await sweepTixstockBookings(NOW, bare.deps);
    assert.equal(bare.find("b1")?.status, "uncertain");
  });

  await run("stuck office rows", async () => {
    const w = world([
      row({ id: "h", source: "office", status: "holding", hold_id: null, created_at: minutesAgo(6) }),
      row({ id: "o", source: "office", status: "on_hold", hold_id: "H9", quantity: 3, created_at: minutesAgo(16) }),
      row({ id: "fresh", source: "office", status: "holding", hold_id: null, created_at: minutesAgo(2) }),
    ]);
    const result = await sweepTixstockBookings(NOW, w.deps);
    assert.equal(w.find("h")?.status, "failed");
    assert.equal(w.lastError.h, "hold_never_answered");
    assert.equal(w.find("o")?.status, "released");
    assert.equal(w.find("fresh")?.status, "holding");
    assert.deepEqual(w.log, ["status:h:failed", "status:o:released", "release:H9:3"]);
    assert.equal(result.failed, 1);
    assert.equal(result.released, 1);
  });

  await run("stuck sale on hold approved", async () => {
    const paid = { 1: reservation({ paid: true }) };
    const w = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(6) })], paid);
    const result = await sweepTixstockBookings(NOW, w.deps);
    assert.equal(w.find("b1")?.status, "approved");
    assert.deepEqual(w.log, [`updateOrder:${OUR}:{"order_status":"Approved"}`, "status:b1:approved"]);
    assert.equal(result.approved, 1);
    assert.equal(w.mails.length, 1, "a site booking gets its link email from the sweep that approved it");
    assert.equal(w.mails[0].to, "buyer@example.com");
    assert.equal(w.mails[0].from, '"MegaEvents Reservations" <reservations@mega-events.co.il>');
    assert.equal(w.mails[0].subject, "הקישור לכרטיסים שלכם");
    assert.ok(w.mails[0].html.includes("https://www.mega-events.co.il/ticket/tok-1"));
    assert.ok(w.mails[0].html.includes("Juventus FC vs Como"));
    assert.equal(w.find("b1")?.link_email_sent_at, NOW.toISOString());
    await sweepTixstockBookings(NOW, w.deps);
    assert.equal(w.mails.length, 1, "a second run sends nothing");

    // the site already sent the link: no second email
    const sent = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(6), link_email_sent_at: minutesAgo(5) })], paid);
    await sweepTixstockBookings(NOW, sent.deps);
    assert.equal(sent.find("b1")?.status, "approved");
    assert.equal(sent.mails.length, 0);

    // an office booking: staff send the tickets from the card, the sweep sends nothing
    const office = world([row({ source: "office", status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(6) })], paid);
    await sweepTixstockBookings(NOW, office.deps);
    assert.equal(office.find("b1")?.status, "approved");
    assert.equal(office.mails.length, 0);

    // the mail server refused: the claim is given back, so a later run can send it
    const smtp = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(6) })], paid);
    smtp.state.failMail = true;
    const { errors } = await withErrors(() => sweepTixstockBookings(NOW, smtp.deps));
    assert.equal(smtp.find("b1")?.status, "approved");
    assert.equal(smtp.find("b1")?.link_email_sent_at, null);
    assert.equal(errors.length, 1);

    // 4 minutes: the app that placed the order approves it itself
    const young = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(4) })], paid);
    await sweepTixstockBookings(NOW, young.deps);
    assert.deepEqual(young.log, []);

    // not paid (or the reservation is gone): never approved by the sweep
    const unpaid = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(6) })]);
    await sweepTixstockBookings(NOW, unpaid.deps);
    assert.equal(unpaid.find("b1")?.status, "sale_on_hold");
    assert.deepEqual(unpaid.log, []);
  });

  await run("overdue logged", async () => {
    const w = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(91) })], { 1: reservation({ paid: true }) });
    w.state.updateOrder = { ok: false, kind: "refused", status: 422, message: "nope" };
    const { value, errors } = await withErrors(() => sweepTixstockBookings(NOW, w.deps));
    assert.equal(w.find("b1")?.status, "sale_on_hold");
    assert.equal(value.overdue, 1);
    assert.equal(value.approved, 0);
    assert.equal(errors.filter((e) => e.includes("tixstock_sale_on_hold_over_90m")).length, 1);

    // approved on this run: not overdue any more
    const late = world([row({ status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(91) })], { 1: reservation({ paid: true }) });
    const { value: ok, errors: none } = await withErrors(() => sweepTixstockBookings(NOW, late.deps));
    assert.equal(ok.overdue, 0);
    assert.equal(ok.approved, 1);
    assert.equal(none.length, 0);
  });

  await run("daily refresh", async () => {
    // the sandbox test event is months away: its rows are refreshed whatever the date
    const w = world([row({ status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(3000) })], { 1: reservation({ paid: true }) });
    w.state.getOrder = { ok: true, data: { id: "O1", status: "Commissionable", items: [{ row: "A", seat: "12", file: PDF }] } };
    const result = await sweepTixstockBookings(NOW, w.deps);
    assert.deepEqual(w.log.filter((l) => l.startsWith("getOrder")), [`getOrder:${OUR}`]);
    assert.equal(w.files.length, 1, "the order's ticket is stored");
    assert.equal(w.find("b1")?.status, "commissionable");
    assert.equal(w.find("b1")?.last_refresh_at, NOW.toISOString());
    assert.equal(result.refreshed, 1);
    await sweepTixstockBookings(NOW, w.deps);
    assert.equal(w.log.filter((l) => l.startsWith("getOrder")).length, 1, "it has its ticket now: no second read");

    // a production booking is read only when its event is within 14 days
    const far = world(
      [row({ env: "production", status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(3000) })],
      { 1: reservation({ paid: true, eventDate: daysAhead(30) }) },
    );
    const farResult = await sweepTixstockBookings(NOW, far.deps);
    assert.deepEqual(far.log, []);
    assert.equal(farResult.refreshed, 0);
    assert.equal(far.find("b1")?.last_refresh_at, NOW.toISOString(), "looked at today, so it does not hold the queue");

    const near = world(
      [row({ env: "production", status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(3000) })],
      { 1: reservation({ paid: true, eventDate: daysAhead(10) }) },
    );
    await sweepTixstockBookings(NOW, near.deps);
    assert.deepEqual(near.log, [`getOrder:${OUR}`]);

    // read two hours ago: not again today
    const recent = world([row({ status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(3000), last_refresh_at: minutesAgo(120) })]);
    await sweepTixstockBookings(NOW, recent.deps);
    assert.deepEqual(recent.log, []);

    // booked half an hour ago: its tickets come by webhook, the first read waits for the hour
    const fresh = world([row({ status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(30) })]);
    await sweepTixstockBookings(NOW, fresh.deps);
    assert.deepEqual(fresh.log, []);
    assert.equal(fresh.find("b1")?.last_refresh_at, null);
    const hourOld = world([row({ status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(61) })]);
    await sweepTixstockBookings(NOW, hourOld.deps);
    assert.deepEqual(hourOld.log, [`getOrder:${OUR}`]);

    // TixStock did not answer: one try a day, the row is left as it was
    const down = world([row({ status: "approved", tixstock_order_id: "O1", created_at: minutesAgo(3000) })]);
    down.state.getOrder = { ok: false, kind: "no_answer", detail: "timeout" };
    const { value: downResult } = await withErrors(() => sweepTixstockBookings(NOW, down.deps));
    assert.equal(downResult.refreshed, 0);
    assert.equal(down.find("b1")?.status, "approved");
    assert.equal(down.find("b1")?.last_refresh_at, NOW.toISOString());
  });

  await run("dry run", async () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "s", status: "sale_on_hold", tixstock_order_id: "O1", created_at: minutesAgo(6), reservation_id: 2 }),
      row({ id: "o", status: "ordering", attempt_started_at: minutesAgo(9) }),
      row({ id: "r", status: "approved", tixstock_order_id: "O2", reservation_id: 2, created_at: minutesAgo(3000) }),
    ];
    const w = world(rows, { 1: reservation(), 2: reservation({ paid: true }) });
    const before = JSON.stringify(w.rows);
    const result = await sweepTixstockBookings(NOW, w.deps, { dryRun: true });
    assert.equal(JSON.stringify(w.rows), before, "no row changed");
    assert.equal(w.state.writes, 0);
    assert.deepEqual(w.log, [], "no TixStock call");
    assert.equal(w.mails.length, 0);
    assert.deepEqual(result, { released: 1, approved: 1, overdue: 0, refreshed: 1, failed: 0, uncertain: 1 }, "what a real run would do");
  });

  await run("one bad row does not stop the run", async () => {
    const w = world([row({ id: "bad", reservation_id: 9 }), row({ id: "good" })], { 1: reservation() });
    const original = w.deps.loadReservation;
    w.deps.loadReservation = async (id) => {
      if (id === 9) throw new Error("reservations read failed");
      return original(id);
    };
    const { value, errors } = await withErrors(() => sweepTixstockBookings(NOW, w.deps));
    assert.equal(w.find("bad")?.status, "on_hold");
    assert.equal(w.find("good")?.status, "released");
    assert.equal(value.released, 1);
    assert.equal(errors.length, 1);
  });

  await run("out of time", async () => {
    const w = world([row({ id: "a" }), row({ id: "b", hold_id: "H2" })]);
    let asked = 0;
    const result = await sweepTixstockBookings(NOW, w.deps, { outOfTime: () => ++asked > 1 });
    assert.equal(result.released, 1, "the second row waits for the next run");
    assert.equal(w.find("b")?.status, "on_hold");
  });
};

main()
  .then(() => console.log("tixstock-booking-sweep-selftest: all passed"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
