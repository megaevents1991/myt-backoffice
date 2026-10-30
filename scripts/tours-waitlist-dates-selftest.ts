// scripts/tours-waitlist-dates-selftest.ts - `npx tsx scripts/tours-waitlist-dates-selftest.ts`
// Pure only: a date opens on a tour a card waits for (Alon 30.10) - what counts as open, which card it answers, when a
// message may go out, and one tick over fake reads and writes (lib/tours/waitlist-dates.ts). No DB, no network, and no
// WhatsApp: `send` is a fake that records its calls. The SQL side is scripts/tours-date-opened-sql-pglite-test.mjs.
import assert from "node:assert/strict";
import {
  DATE_OPENED_STATUS,
  MAX_CARDS_PER_TICK,
  OPEN_SETTLE_MS,
  dateOpenedMessage,
  dateOpenedParams,
  hasOtherOpenCard,
  isMorningTick,
  isOpenDate,
  isSendWindow,
  openedDateFor,
  parseDateOpened,
  OPTED_OUT_WHY,
  runWaitlistTick,
  siteDateOf,
  approvedTemplateBlock,
  watchPlan,
  whatsappBlock,
  type SiteDate,
  type TickDeps,
  type WaitingCard,
} from "../lib/tours/waitlist-dates";

const TODAY = "2026-11-02";
const date = (over: Partial<SiteDate> = {}): SiteDate => ({
  id: "d1",
  code: "BBC-703",
  packageId: "tour-a",
  startDate: "2027-04-10",
  saleStatus: "open",
  listOpen: false,
  priced: true,
  productId: 7031,
  tourName: "טיול ברלין",
  packagePath: "/package/berlin/",
  ...over,
});

// ---------------------------------------------------------------- what counts as open: the site's own rule
assert.equal(isOpenDate(date(), TODAY), true);
assert.equal(isOpenDate(date({ saleStatus: "last_places" }), TODAY), true, "last places are on sale");
assert.equal(isOpenDate(date({ saleStatus: "sold_out" }), TODAY), false);
assert.equal(isOpenDate(date({ saleStatus: "closed" }), TODAY), false);
assert.equal(isOpenDate(date({ listOpen: true }), TODAY), false, "a date staff fill through its own list is not sold online");
assert.equal(isOpenDate(date({ priced: false }), TODAY), false, "no price: the site does not sell it");
assert.equal(isOpenDate(date({ startDate: "2026-11-01" }), TODAY), false, "already left");
assert.equal(isOpenDate(date({ startDate: TODAY }), TODAY), true, "leaves today: the site still shows it");
assert.equal(isOpenDate(date({ productId: null }), TODAY), false, "no product id: no link can name it");

// ---------------------------------------------------------------- a date row as the site would read it
{
  const pkg = { name: "טיול ברלין", slug: "berlin", is_active: true, is_deleted: null, path: null, stub: null };
  const row = { id: "d1", code: "BBC-703", package_id: "tour-a", start_date: "2027-04-10", sale_status: "open", legacy_product_id: 7031, site_id: 9, waitlist: null, price_offer: null, price_regular: null, packages: pkg };
  const seats = { allocated: 0, remaining: 0 };
  const open = (d: SiteDate) => isOpenDate(d, TODAY);
  assert.equal(open(siteDateOf(row, { doublePriced: true, seats })), true);
  assert.equal(siteDateOf(row, { doublePriced: true, seats }).productId, 7031, "the legacy product id first, as the site's links");
  assert.equal(siteDateOf(row, { doublePriced: true, seats }).packagePath, "/package/berlin/");
  assert.equal(siteDateOf({ ...row, packages: { ...pkg, path: "/trip/berlin/" } }, { doublePriced: true, seats }).packagePath, "/trip/berlin/");
  // the site's own rules
  assert.equal(open(siteDateOf({ ...row, packages: { ...pkg, is_active: false } }, { doublePriced: true, seats })), false, "a tour staff switched off: the site does not sell it");
  assert.equal(open(siteDateOf({ ...row, packages: { ...pkg, is_deleted: "2026-10-30" } }, { doublePriced: true, seats })), false, "a deleted tour");
  assert.equal(open(siteDateOf({ ...row, packages: { ...pkg, stub: true } }, { doublePriced: true, seats })), false, "a tour with no page of its own");
  assert.equal(open(siteDateOf({ ...row, packages: null }, { doublePriced: true, seats })), false, "no tour at all");
  assert.equal(open(siteDateOf({ ...row, waitlist: true }, { doublePriced: true, seats })), false, "a date filled through its own list");
  assert.equal(open(siteDateOf(row, { doublePriced: false, seats })), false, "no price anywhere");
  assert.equal(open(siteDateOf({ ...row, price_offer: 3900 }, { doublePriced: false, seats })), true, "priced on the date itself (an imported date): the site counts it");
  assert.equal(open(siteDateOf({ ...row, price_regular: 4200 }, { doublePriced: false, seats })), true);
  assert.equal(open(siteDateOf(row, { doublePriced: true, seats: { allocated: 40, remaining: 0 } })), false, "seats ran out: sold out, as the site's view says");
  assert.equal(open(siteDateOf({ ...row, sale_status: "sold_out" }, { doublePriced: true, seats: { allocated: 40, remaining: 9 } })), false);
}

// ---------------------------------------------------------------- the watch: when each date was first seen open
assert.deepEqual(watchPlan(["d1", "d2"], new Map([["d2", "x"], ["d3", "y"]])), { stamp: ["d1"], clear: ["d3"] });
assert.deepEqual(watchPlan([], new Map()), { stamp: [], clear: [] });

// ---------------------------------------------------------------- which card a date answers
const NOW = new Date("2026-11-02T10:00:00Z");
const longAgo = "2026-11-02T08:00:00Z";
const justNow = "2026-11-02T09:30:00Z";
const waiting = (over: Partial<WaitingCard> = {}): WaitingCard => ({
  id: "c1",
  caseNo: 1001,
  packageId: "tour-a",
  departureId: null,
  waitlistSince: "2026-10-20T08:00:00Z",
  firstName: "דנה",
  phone: "054-111-2222",
  customerId: "cust-1",
  consent: "form",
  customerPhoneKeys: ["541112222"],
  otherCardOnTour: false,
  linkToken: null,
  ...over,
});
{
  const open = [date({ id: "late", startDate: "2027-06-01" }), date({ id: "soon", startDate: "2027-04-01" })];
  const seen = new Map([["late", longAgo], ["soon", longAgo]]);
  assert.equal(openedDateFor(waiting(), open, seen, NOW)?.id, "soon", "a card of a tour: its soonest open date");
  assert.equal(openedDateFor(waiting({ departureId: "late" }), open, seen, NOW)?.id, "late", "a card of a date waits for that date alone");
  assert.equal(openedDateFor(waiting({ departureId: "other" }), open, seen, NOW), null, "its date is still closed - another date of the tour is no answer");
  assert.equal(openedDateFor(waiting({ packageId: "tour-b" }), open, seen, NOW), null, "another tour's date");
  assert.equal(openedDateFor(waiting({ packageId: null }), open, seen, NOW), null, "a notify card with no tour stays with the reps");
  assert.equal(openedDateFor(waiting({ packageId: null, departureId: "late" }), open, seen, NOW)?.id, "late", "a card that names a date needs no tour");
  // a named date that is off the site (past, deleted, unpublished): a promise to tell them about the tour still stands
  const live = new Set(["late", "soon", "closed-now"]);
  assert.equal(openedDateFor(waiting({ departureId: "gone" }), open, seen, NOW, { liveIds: live })?.id, "soon", "its date is gone: the tour's soonest open date");
  assert.equal(openedDateFor(waiting({ departureId: "closed-now" }), open, seen, NOW, { liveIds: live }), null, "its date is still on the site, just full: it keeps waiting for that date");
  assert.equal(openedDateFor(waiting({ departureId: "gone", packageId: null }), open, seen, NOW, { liveIds: live }), null, "its date is gone and it names no tour");
  // a date that leaves before the rep's call is no opening for this card
  assert.equal(openedDateFor(waiting(), open, seen, NOW, { leavesAfter: "2027-04-01" })?.id, "late", "the soonest leaves on the follow-up day: too late");
  assert.equal(openedDateFor(waiting(), open, seen, NOW, { leavesAfter: "2027-06-01" }), null);
  // the hour: a publish undone at once sends nothing
  assert.equal(openedDateFor(waiting(), [date({ id: "soon" })], new Map([["soon", justNow]]), NOW), null, "open for under the hour");
  const exactlyAnHour = new Date(NOW.getTime() - OPEN_SETTLE_MS).toISOString();
  assert.equal(openedDateFor(waiting(), [date({ id: "soon" })], new Map([["soon", exactlyAnHour]]), NOW)?.id, "soon", "open for the full hour");
  assert.equal(openedDateFor(waiting(), [date({ id: "soon" })], new Map(), NOW), null, "not seen before: this tick only starts its clock");
  // it must open AFTER the card started waiting: a rep moving a card to the list sends nothing for a date already open
  assert.equal(openedDateFor(waiting({ waitlistSince: "2026-11-02T09:00:00Z" }), [date({ id: "soon" })], new Map([["soon", longAgo]]), NOW), null, "already open when the card started waiting");
  assert.equal(openedDateFor(waiting({ waitlistSince: longAgo }), [date({ id: "soon" })], new Map([["soon", longAgo]]), NOW), null, "the migration stamps both at one instant: not after");
  assert.equal(openedDateFor(waiting({ waitlistSince: null }), [date({ id: "soon" })], new Map([["soon", longAgo]]), NOW), null, "no start of waiting: never guessed");
}

// ---------------------------------------------------------------- when a message may go out (Israel time)
// 2026-11-02 is a Monday; Israel is UTC+2 in November
assert.equal(isSendWindow(new Date("2026-11-02T07:00:00Z")), true, "Monday 09:00");
assert.equal(isSendWindow(new Date("2026-11-02T06:59:00Z")), false, "Monday 08:59");
assert.equal(isSendWindow(new Date("2026-11-02T17:59:00Z")), true, "Monday 19:59");
assert.equal(isSendWindow(new Date("2026-11-02T18:00:00Z")), false, "Monday 20:00");
assert.equal(isSendWindow(new Date("2026-11-06T10:59:00Z")), true, "Friday 12:59");
assert.equal(isSendWindow(new Date("2026-11-06T11:00:00Z")), false, "Friday 13:00");
assert.equal(isSendWindow(new Date("2026-11-07T10:00:00Z")), false, "Shabbat");
assert.equal(isSendWindow(new Date("2026-11-08T10:00:00Z")), true, "Sunday");
// summer: UTC+3
assert.equal(isSendWindow(new Date("2026-07-06T06:00:00Z")), true, "Monday 09:00 in summer");

assert.equal(isMorningTick(new Date("2026-11-02T07:35:00Z")), true, "09:35 in Israel: the one tick a failure mail goes out");
assert.equal(isMorningTick(new Date("2026-11-02T08:35:00Z")), false);
assert.equal(isMorningTick(new Date("2026-11-07T07:35:00Z")), false, "not on Shabbat");

// ---------------------------------------------------------------- what may stop the WhatsApp
const blockFacts = { consent: "form", phone: "054-111-2222", customerPhoneKeys: ["541112222"], otherCardOnTour: false };
assert.equal(whatsappBlock(blockFacts), null);
assert.equal(whatsappBlock({ ...blockFacts, consent: "none" }), null, "everyone on the list (Dor 30.10)");
assert.equal(whatsappBlock({ ...blockFacts, consent: "opted_out" }), OPTED_OUT_WHY);
assert.match(whatsappBlock({ ...blockFacts, phone: "12" }) ?? "", /phone/);
assert.match(whatsappBlock({ ...blockFacts, phone: null }) ?? "", /phone/);
assert.match(whatsappBlock({ ...blockFacts, customerPhoneKeys: ["529999999"] }) ?? "", /no longer/, "a rep corrected the customer's phone: the card keeps the typo, a stranger would get it");
assert.equal(whatsappBlock({ ...blockFacts, customerPhoneKeys: null }), null, "a card with no customer row has nothing to compare");
assert.match(whatsappBlock({ ...blockFacts, otherCardOnTour: true }) ?? "", /another card/, "a customer already dealing on this tour is not told what they waited for");
assert.equal(whatsappBlock({ ...blockFacts, consent: "opted_out", otherCardOnTour: true }), OPTED_OUT_WHY, "an opt-out names itself first: the rep's button goes by it");
{
  const statuses = [{ key: "new", label: "new", color: "blue", isClosed: false, isSystem: true, isActive: true }, { key: "paid", label: "paid", color: "green", isClosed: false, isSystem: true, isActive: true }, { key: "spam", label: "spam", color: "gray", isClosed: true, isSystem: true, isActive: true }] as Parameters<typeof hasOtherOpenCard>[2];
  const other = { id: "o", packageId: "tour-a", status: "new", toFile: false, departureStart: null, createdAt: "2026-10-01T00:00:00Z" };
  const me = waiting();
  assert.equal(hasOtherOpenCard(me, [other], statuses, TODAY), true);
  assert.equal(hasOtherOpenCard(me, [{ ...other, id: me.id }], statuses, TODAY), false, "itself is no other card");
  assert.equal(hasOtherOpenCard(me, [{ ...other, packageId: "tour-b" }], statuses, TODAY), false, "another tour");
  assert.equal(hasOtherOpenCard(me, [{ ...other, status: "spam" }], statuses, TODAY), false, "closed");
  assert.equal(hasOtherOpenCard(me, [{ ...other, toFile: true }], statuses, TODAY), false, "waiting to be filed");
  assert.equal(hasOtherOpenCard(me, [{ ...other, status: "paid", departureStart: "2026-12-01" }], statuses, TODAY), true, "paid on a trip still ahead");
  assert.equal(hasOtherOpenCard(me, [{ ...other, status: "paid", departureStart: "2025-05-01" }], statuses, TODAY), false, "travelled last year, waiting for next season");
}
assert.equal(approvedTemplateBlock([{ name: "waitlist_date_open", language: "he", status: "APPROVED" }], "waitlist_date_open"), null);
assert.match(approvedTemplateBlock([{ name: "waitlist_date_open", language: "en", status: "APPROVED" }], "waitlist_date_open") ?? "", /not approved/, "an English template cannot carry this message");
assert.match(approvedTemplateBlock([{ name: "waitlist_date_open", language: "he", status: "PENDING" }], "waitlist_date_open") ?? "", /PENDING/);
assert.match(approvedTemplateBlock([], "waitlist_date_open") ?? "", /not approved/, "no template in the cache: nothing goes out");

// ---------------------------------------------------------------- the words
assert.deepEqual(dateOpenedParams("דנה", "טיול ברלין", "https://x/y"), ["דנה", "טיול ברלין", "https://x/y"]);
assert.equal(dateOpenedParams(null, "טיול", "u")[0], "חברים", "Meta refuses an empty variable");
assert.equal(dateOpenedParams("  ", "טיול", "u")[0], "חברים");
// a visitor typed the name, and it goes out from our verified number to a phone they typed: letters only, or nothing
assert.equal(dateOpenedParams("דנה\n\nקנו עכשיו", "טיול", "u")[0], "דנה", "one word: a form never writes a sentence into our message");
for (const junk of ["bit.ly/3xYz", "https://evil.co/pay", "שלמו:bit.ly/3xYz", "קנו\u200Bעכשיו\u200Bבחינם", "*דחוף*", "\u202Eabc", "www.x.co", "0541112222", "א".repeat(80)]) {
  assert.equal(dateOpenedParams(junk, "טיול", "u")[0], "חברים", `a name that is not a name: ${junk}`);
}
for (const name of ["Dana", "O'Brien", "אבי-גיל", "ג׳ון", "José"]) assert.equal(dateOpenedParams(name, "טיול", "u")[0], name);
assert.equal(dateOpenedParams("דנה", "טיול\nברלין  קלאסי", "u")[1], "טיול ברלין קלאסי", "Meta refuses a line break inside a variable");
assert.equal(dateOpenedParams("דנה", "  ", "u")[1], "הטיול");
assert.equal(
  dateOpenedMessage("דנה", "טיול ברלין", "https://x/y"),
  "היי דנה, מה שחיכיתם לו עלה!\nנפתח תאריך לטיול ברלין.\nאפשר להציץ כאן: https://x/y\nנציג שלנו יחזור אליכם בקרוב.",
);

// ---------------------------------------------------------------- the note on the card
{
  const note = { departureId: "d1", code: "BBC-703", startDate: "2027-04-10", tourName: "טיול", url: "https://x", at: "2026-11-02T10:00:00Z", whatsapp: "skipped", why: "no number" };
  assert.deepEqual(parseDateOpened(note), note);
  assert.equal(parseDateOpened(null), null);
  assert.equal(parseDateOpened("x"), null);
  assert.equal(parseDateOpened({ ...note, url: "" }), null);
  assert.equal(parseDateOpened({ ...note, whatsapp: "junk" })?.whatsapp, "pending", "an unknown state reads as not sent");
}

// ---------------------------------------------------------------- one tick, over fakes
type Log = { sends: { to: string; params: string[]; caseId: string }[]; claims: string[]; records: { id: string; whatsapp: string; why: string | null }[]; stamped: string[]; cleared: string[]; audits: string[] };
function fakes(over: Partial<TickDeps> = {}, cards: WaitingCard[] = [waiting()], dates: SiteDate[] = [date()], seen: [string, string][] = [["d1", longAgo]]) {
  const log: Log = { sends: [], claims: [], records: [], stamped: [], cleared: [], audits: [] };
  const deps: TickDeps = {
    readDates: async () => dates,
    readWatch: async () => new Map(seen),
    stamp: async (ids) => void log.stamped.push(...ids),
    clear: async (ids) => void log.cleared.push(...ids),
    readCards: async () => cards,
    hasStatus: async () => true,
    movedLastHour: async () => 0,
    senderProblem: async () => null,
    templateProblem: async () => null,
    newToken: () => "tok-new-tok-new-tok-new",
    claim: async (card) => {
      log.claims.push(card.id);
      return true;
    },
    send: async (card, params) => {
      log.sends.push({ to: card.phone ?? "", params, caseId: card.id });
      return { ok: true };
    },
    record: async (card, note) => void log.records.push({ id: card.id, whatsapp: note.whatsapp, why: note.why }),
    audit: async (card) => void log.audits.push(card.id),
    ...over,
  };
  return { deps, log };
}
const OPTS = { now: NOW, today: TODAY, siteUrl: "https://site.example", dryRun: false, deadline: Number.POSITIVE_INFINITY };
const run = async () => {
  {
    const { deps, log } = fakes();
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 1);
    assert.equal(r.sent, 1);
    assert.deepEqual(log.claims, ["c1"]);
    assert.equal(log.sends.length, 1);
    assert.deepEqual(log.sends[0].params, ["דנה", "טיול ברלין", "https://site.example/package/berlin/?product_id=7031&lr=tok-new-tok-new-tok-new"]);
    assert.deepEqual(log.records, [{ id: "c1", whatsapp: "sent", why: null }]);
    assert.deepEqual(log.audits, ["c1"]);
  }
  {
    // the next working day: Monday -> Tuesday, Thursday -> Sunday, and the link's token and the note go with the move
    const claimed: { token: string; followUpDate: string; whatsapp: string }[] = [];
    const { deps } = fakes({
      claim: async (_card, move) => {
        claimed.push({ token: move.token, followUpDate: move.followUpDate, whatsapp: move.note.whatsapp });
        return true;
      },
    });
    await runWaitlistTick(deps, OPTS);
    assert.deepEqual(claimed, [{ token: "tok-new-tok-new-tok-new", followUpDate: "2026-11-03", whatsapp: "pending" }]);
    claimed.length = 0;
    await runWaitlistTick(deps, { ...OPTS, now: new Date("2026-11-05T10:00:00Z"), today: "2026-11-05" });
    assert.equal(claimed[0].followUpDate, "2026-11-08", "Thursday: Sunday is the next working day");
  }
  {
    // a link already minted stays the customer's link
    const { deps, log } = fakes({}, [waiting({ linkToken: "kept-token-kept-token" })]);
    await runWaitlistTick(deps, OPTS);
    assert.match(log.sends[0].params[2], /lr=kept-token-kept-token/);
  }
  {
    // a rep got there first: nothing goes out
    const { deps, log } = fakes({ claim: async () => false });
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 0);
    assert.equal(log.sends.length, 0);
    assert.equal(log.records.length, 0);
  }
  {
    // the card moves first, so a crash can never send twice; a failed send is on the card
    const { deps, log } = fakes({ send: async () => ({ ok: false, error: "Meta said no" }) });
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 1);
    assert.equal(r.sent, 0);
    assert.deepEqual(log.records, [{ id: "c1", whatsapp: "failed", why: "Meta said no" }]);
  }
  {
    // a send that throws is still a card a rep can act on, and the next card still runs
    const a = waiting({ id: "a", waitlistSince: "2026-10-01T08:00:00Z" });
    const b = waiting({ id: "b", waitlistSince: "2026-10-02T08:00:00Z" });
    let first = true;
    const { deps, log } = fakes(
      {
        send: async (card) => {
          if (first) {
            first = false;
            throw new Error("boom");
          }
          log.sends.push({ to: "", params: [], caseId: card.id });
          return { ok: true };
        },
      },
      [a, b],
    );
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 2);
    assert.deepEqual(log.records, [
      { id: "a", whatsapp: "failed", why: "boom" },
      { id: "b", whatsapp: "sent", why: null },
    ]);
  }
  {
    // WhatsApp is not connected (today's state): the card still moves, nothing is sent, the rep is told why
    const { deps, log } = fakes({ senderProblem: async () => "The company's WhatsApp number is not connected yet." });
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 1);
    assert.equal(r.sent, 0);
    assert.equal(log.sends.length, 0);
    assert.deepEqual(log.records, [{ id: "c1", whatsapp: "skipped", why: "The company's WhatsApp number is not connected yet." }]);
  }
  {
    const { deps, log } = fakes({ templateProblem: async () => "not approved" });
    await runWaitlistTick(deps, OPTS);
    assert.equal(log.sends.length, 0);
    assert.deepEqual(log.records, [{ id: "c1", whatsapp: "skipped", why: "not approved" }]);
  }
  {
    // opted out: never messaged, the card still reaches a rep
    const { deps, log } = fakes({}, [waiting({ consent: "opted_out" })]);
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 1);
    assert.equal(log.sends.length, 0);
    assert.equal(log.records[0].why, OPTED_OUT_WHY);
  }
  {
    // dry run: the full answer, no write and no send
    const { deps, log } = fakes({}, [waiting()], [date(), date({ id: "d2" })], [["d1", longAgo], ["gone", longAgo]]);
    const r = await runWaitlistTick(deps, { ...OPTS, dryRun: true });
    assert.deepEqual(r.wouldMove, [{ caseNo: 1001, code: "BBC-703" }]);
    assert.deepEqual(log, { sends: [], claims: [], records: [], stamped: [], cleared: [], audits: [] });
    assert.equal(r.moved, 0);
  }
  {
    // at night the clock still runs, and nothing moves
    const { deps, log } = fakes({}, [waiting()], [date(), date({ id: "d2" })], [["d1", longAgo], ["gone", longAgo]]);
    const r = await runWaitlistTick(deps, { ...OPTS, now: new Date("2026-11-02T23:00:00Z") });
    assert.deepEqual(log.stamped, ["d2"]);
    assert.deepEqual(log.cleared, ["gone"]);
    assert.equal(log.claims.length, 0);
    assert.equal(r.outsideHours, true);
  }
  {
    // first in line first; everyone waiting is told; past the ceiling the rest are next tick's
    const many = Array.from({ length: MAX_CARDS_PER_TICK + 3 }, (_, i) => waiting({ id: `c${i}`, caseNo: 2000 + i, phone: `05${String(10000000 + i)}`, customerPhoneKeys: null, waitlistSince: `2026-10-${String(28 - (i % 28)).padStart(2, "0")}T08:00:00Z` }));
    const { deps, log } = fakes({}, many);
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(log.claims.length, MAX_CARDS_PER_TICK);
    assert.equal(r.remaining, 3);
    const since = (id: string) => many.find((c) => c.id === id)?.waitlistSince ?? "";
    assert.ok(since(log.claims[0]) <= since(log.claims[1]), "the oldest wait first");
  }
  {
    // out of time: the rest wait for the next tick
    const { deps, log } = fakes({}, [waiting({ id: "a" }), waiting({ id: "b" })]);
    const r = await runWaitlistTick(deps, { ...OPTS, deadline: 0 });
    assert.equal(log.claims.length, 0);
    assert.equal(r.remaining, 2);
  }
  {
    // a closed date in the tick: nothing moves, however long it was watched
    const { deps, log } = fakes({}, [waiting()], [date({ saleStatus: "sold_out" })]);
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.open, 0);
    assert.equal(log.claims.length, 0);
    assert.deepEqual(log.cleared, ["d1"], "and its clock stops");
  }
  {
    // a date seen for the first time in this tick starts its clock and moves nothing yet
    const { deps, log } = fakes({}, [waiting()], [date()], []);
    await runWaitlistTick(deps, OPTS);
    assert.deepEqual(log.stamped, ["d1"]);
    assert.equal(log.claims.length, 0);
  }
  {
    // a date leaving before the rep's follow-up day is passed over; the card keeps waiting
    const { deps, log } = fakes({}, [waiting()], [date({ startDate: "2026-11-03" })]);
    await runWaitlistTick(deps, OPTS);
    assert.equal(log.claims.length, 0);
  }
  {
    // a card whose named date is off the site takes the tour's open date
    const { deps, log } = fakes({}, [waiting({ departureId: "gone" })]);
    await runWaitlistTick(deps, OPTS);
    assert.deepEqual(log.claims, ["c1"]);
  }
  {
    // a card whose named date is still on the site, full, keeps waiting while another date of the tour opens
    const { deps, log } = fakes({}, [waiting({ departureId: "full" })], [date(), date({ id: "full", saleStatus: "sold_out" })]);
    await runWaitlistTick(deps, OPTS);
    assert.equal(log.claims.length, 0);
  }
  {
    // every move is audited, sent or not
    const { deps, log } = fakes({ senderProblem: async () => "not connected" });
    await runWaitlistTick(deps, OPTS);
    assert.deepEqual(log.audits, ["c1"]);
  }
  {
    // a failed read of the WhatsApp setup never holds a card back: the card moves and says why
    const a = fakes({ senderProblem: async () => { throw new Error("wa_accounts down"); } });
    const ra = await runWaitlistTick(a.deps, OPTS);
    assert.equal(ra.moved, 1);
    assert.equal(a.log.sends.length, 0);
    assert.match(a.log.records[0].why ?? "", /wa_accounts down/);
    const b = fakes({ templateProblem: async () => { throw new Error("wa_templates down"); } });
    await runWaitlistTick(b.deps, OPTS);
    assert.equal(b.log.sends.length, 0);
    assert.match(b.log.records[0].why ?? "", /wa_templates down/);
  }
  {
    // two cards of one phone on one tour: one message; both cards reach a rep
    const a = waiting({ id: "a", waitlistSince: "2026-10-01T08:00:00Z" });
    const b = waiting({ id: "b", waitlistSince: "2026-10-02T08:00:00Z" });
    const c = waiting({ id: "c", waitlistSince: "2026-10-03T08:00:00Z", phone: "052-333-4444", customerPhoneKeys: ["523334444"] });
    const { deps, log } = fakes({}, [a, b, c]);
    const r = await runWaitlistTick(deps, OPTS);
    assert.equal(r.moved, 3);
    assert.equal(r.sent, 2);
    assert.deepEqual(log.sends.map((x) => x.caseId), ["a", "c"]);
    assert.match(log.records.find((x) => x.id === "b")?.why ?? "", /already/);
  }
  {
    // the ceiling is per hour, counted in the database: a second run an hour's budget in moves nothing more
    const a = fakes({ movedLastHour: async () => MAX_CARDS_PER_TICK });
    const ra = await runWaitlistTick(a.deps, OPTS);
    assert.equal(a.log.claims.length, 0);
    assert.equal(ra.remaining, 1);
    const many = [waiting({ id: "x" }), waiting({ id: "y", phone: "052-333-4444", customerPhoneKeys: ["523334444"] })];
    const b = fakes({ movedLastHour: async () => MAX_CARDS_PER_TICK - 1 }, many);
    const rb = await runWaitlistTick(b.deps, OPTS);
    assert.equal(b.log.claims.length, 1);
    assert.equal(rb.remaining, 1);
  }
  {
    // a list without the status (before the migration) and a company with no site move nothing
    const a = fakes({ hasStatus: async () => false });
    const ra = await runWaitlistTick(a.deps, OPTS);
    assert.equal(a.log.claims.length, 0);
    assert.match(ra.problem ?? "", new RegExp(DATE_OPENED_STATUS));
    const b = fakes();
    const rb = await runWaitlistTick(b.deps, { ...OPTS, siteUrl: null });
    assert.equal(b.log.claims.length, 0);
    assert.match(rb.problem ?? "", /site/);
  }
  console.log("tours-waitlist-dates selftest: ok");
};
void run().catch((e) => {
  console.error(e);
  process.exit(1);
});
