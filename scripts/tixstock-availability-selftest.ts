// Self-test for the rules that take an unsellable TixStock ticket / event off the
// site and put it back. No DB, no network.
//   npx tsx scripts/tixstock-availability-selftest.ts
import assert from "node:assert/strict";
import {
  autoOffCategories,
  deactivationText,
  nextDeactivation,
  planTixstockAvailability,
  type TixstockSupply,
} from "../lib/services/tixstock-availability";
import type { EventTicket } from "../types/app.types";

const ticket = (over: Partial<EventTicket>): EventTicket => ({
  id: "t",
  category: "Lower Tier",
  price: 100,
  description: "",
  colorOnTheMap: "",
  available: true,
  eid: "tx-1",
  ...over,
});

const ZIGGO = ["Floor Standing", "VIP", "Lower Tier", "Upper Tier"];
const supply = (listed: string[], categories: string[] | null = ZIGGO): TixstockSupply => ({
  categories,
  listed,
});
const plan = (tickets: EventTicket[], s: TixstockSupply) =>
  planTixstockAvailability(tickets, "tx_event", s);

// 1. Event 1100 (04.10.2026): a copy of the Berlin show kept Berlin's category.
// TixStock sells this show, and has no such category - it can never sell.
let p = plan([ticket({ id: "berlin", category: "Unterrang" })], supply(["Floor Standing", "VIP"]));
assert.deepEqual(
  p.tickets.map((t) => [t.id, t.available, t.autoOff]),
  [["berlin", false, "no_category"]],
);
assert.deepEqual([p.missing, p.soldOut, p.sellable, p.changed], [["Unterrang"], [], false, true]);
assert.deepEqual([p.turnedOff, p.turnedOn], [["berlin"], []]);
assert.equal(nextDeactivation(null, p), "tx_no_category");

// 2. One category sold out, another still sells: the category goes off the site,
// the event stays.
const lower = ticket({ id: "lower" });
const floor = ticket({ id: "floor", category: "Floor Standing" });
p = plan([lower, floor], supply(["Floor Standing"]));
assert.deepEqual(
  p.tickets.map((t) => [t.id, t.available, t.autoOff]),
  [["lower", false, "sold_out"], ["floor", true, undefined]],
);
assert.deepEqual([p.missing, p.soldOut, p.sellable], [[], ["Lower Tier"], true]);
assert.equal(nextDeactivation(null, p), null);

// 3. Listings came back: the ticket WE took off returns, and so does the event.
p = plan([ticket({ id: "lower", available: false, autoOff: "sold_out" })], supply(["Lower Tier"]));
assert.deepEqual(p.tickets, [ticket({ id: "lower", available: true })]);
assert.ok(!("autoOff" in p.tickets[0]));
assert.deepEqual([p.turnedOn, p.sellable, p.changed], [["lower"], true, true]);
assert.equal(nextDeactivation("tx_sold_out", p), null);

// 4. A ticket staff switched off by hand is theirs: never touched, never
// reported, and an event that is off only by hand is not ours to deactivate.
const byHand = ticket({ id: "hand", available: false });
p = plan([byHand], supply(["Lower Tier"]));
assert.deepEqual([p.tickets, p.changed, p.sellable], [[byHand], false, false]);
assert.equal(nextDeactivation(null, p), null);
p = plan([byHand], supply(["Floor Standing"]));
assert.deepEqual([p.tickets, p.changed, p.soldOut], [[byHand], false, []]);

// 5. The whole show has nothing on sale. TixStock still names its categories →
// sold out for real. A feed with no listings AND no category list could be a
// hiccup: nothing is switched off on it.
p = plan([lower, floor], supply([]));
assert.deepEqual(p.tickets.map((t) => t.autoOff), ["sold_out", "sold_out"]);
assert.equal(nextDeactivation(null, p), "tx_sold_out");
p = plan([lower, floor], supply([], null));
assert.deepEqual([p.tickets, p.changed, p.sellable], [[lower, floor], false, true]);
assert.equal(nextDeactivation(null, p), null);
p = plan([lower, floor], supply([], []));
assert.equal(p.changed, false);
// listings without a category list still prove a category has nothing on sale
p = plan([lower, floor], supply(["Floor Standing"], null));
assert.deepEqual(p.tickets.map((t) => t.autoOff), ["sold_out", undefined]);

// 6. Another supplier's ticket is never judged by TixStock's feed - even with
// the same category name - and it keeps the event on the site.
const liveTickets = ticket({ id: "163265", supplier: "livetickets", category: "Unterrang", eid: "2324650" });
p = plan([ticket({ id: "berlin", category: "Unterrang" }), liveTickets], supply(["Floor Standing"]));
assert.deepEqual(p.tickets.map((t) => [t.id, t.available]), [["berlin", false], ["163265", true]]);
assert.deepEqual([p.missing, p.sellable], [["Unterrang"], true]);
assert.equal(nextDeactivation(null, p), null);

// 7. TixStock restyles names over time - the comparison is the rename-proof one.
p = plan(
  [ticket({ category: "CATEGORÍA 2 (CAT2) - FONDO" })],
  supply(["Categoría 2 Fondo"], ["Categoría 2 Fondo"]),
);
assert.deepEqual([p.changed, p.sellable], [false, true]);

// 8. A reason somebody else wrote on the event is not ours to change, either way.
p = plan([floor], supply(["Floor Standing"]));
assert.equal(nextDeactivation("manual", p), "manual");
p = plan([ticket({ id: "berlin", category: "Unterrang" })], supply(["Floor Standing"]));
assert.equal(nextDeactivation("manual", p), "manual");
// ours follows the cause: fixed categories that are merely sold out
p = plan([ticket({ id: "lower", available: false, autoOff: "no_category" })], supply(["Floor Standing"]));
assert.deepEqual(p.tickets.map((t) => t.autoOff), ["sold_out"]);
assert.equal(nextDeactivation("tx_no_category", p), "tx_sold_out");

// 9. Running the plan on its own result changes nothing.
p = plan([ticket({ id: "berlin", category: "Unterrang" }), lower, floor], supply(["Floor Standing"]));
const again = plan(p.tickets, supply(["Floor Standing"]));
assert.deepEqual([again.changed, again.turnedOff, again.turnedOn], [false, [], []]);
assert.deepEqual(again.tickets, p.tickets);
assert.deepEqual([again.missing, again.soldOut], [["Unterrang"], ["Lower Tier"]]);

// 10. What staff read: the categories the sync took off, by cause - a ticket a
// person switched off is not in it - and one line per reason.
assert.deepEqual(
  autoOffCategories([
    ticket({ category: "Unterrang", available: false, autoOff: "no_category" }),
    ticket({ category: "Lower Tier", available: false, autoOff: "sold_out" }),
    ticket({ category: "Upper Tier", available: false, autoOff: "sold_out" }),
    ticket({ category: "VIP", available: false }),
    floor,
  ]),
  { missing: ["Unterrang"], soldOut: ["Lower Tier", "Upper Tier"] },
);
assert.deepEqual(autoOffCategories([floor]), { missing: [], soldOut: [] });
assert.ok(deactivationText("tx_no_category").includes("TixStock"));
assert.ok(deactivationText("tx_sold_out").includes("אין"));
// a reason this sync did not write still gets a line - the raw value, never a blank
assert.ok(deactivationText("manual").includes("manual"));

console.log("tixstock-availability: all assertions passed");
