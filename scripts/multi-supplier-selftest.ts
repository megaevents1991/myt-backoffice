// Self-test for the pure parts of multi-supplier events. No DB, no network.
//   npx tsx --env-file=.env.local scripts/multi-supplier-selftest.ts
import assert from "node:assert/strict";
import {
  normalizeSupplierCategory,
  supplierEventId,
  supplierPriceUsd,
  ticketSupplier,
} from "../lib/suppliers";
import { listSectionIds, newZoneId, stampZones } from "../lib/venue-maps/svg-zones";
import { toLiveTicketsCategory } from "../lib/services/livetickets-offers";
import { applyLiveTicketsStock } from "../lib/services/attached-suppliers-sync";
import type { EventTicket } from "../types/app.types";

const ticket = (over: Partial<EventTicket>): EventTicket => ({
  id: "t",
  category: "Category 1",
  price: 100,
  description: "",
  colorOnTheMap: "",
  ...over,
});

/* suppliers */
const tx = ticket({ id: "tx1", eid: "01kv" });
const lt = ticket({ id: "171442", supplier: "livetickets", eid: "2326006", price: 400 });
assert.equal(ticketSupplier(tx, "tx_event"), "tixstock");
assert.equal(ticketSupplier(lt, "tx_event"), "livetickets");
assert.equal(ticketSupplier(tx, "sports_live_event_dynamic"), "livetickets");
assert.equal(ticketSupplier(tx, "sports_event"), "static");
// the LiveTickets ticket may come FIRST - the old `[0].eid` read would be wrong
assert.equal(supplierEventId([lt, tx], "tixstock", "tx_event"), "01kv");
assert.equal(supplierEventId([lt, tx], "livetickets", "tx_event"), "2326006");
assert.equal(supplierEventId([tx], "livetickets", "tx_event"), null);

assert.equal(normalizeSupplierCategory("CATEGORÍA 2 (CAT2) - FONDO"), "categoria 2 fondo");
assert.equal(normalizeSupplierCategory("Categoría 2 Fondo"), "categoria 2 fondo");

// (239.2 + 40) EUR at 1.15 → 321.08 → +3.5% → 332.3 → 333
assert.equal(supplierPriceUsd(239.2, "EUR", (amount) => amount * 1.15), 333);
assert.equal(supplierPriceUsd(100, "USD", (amount) => amount), 145);

/* zones on the drawing */
const svg =
  '<svg><g data-category="a"><g data-section="a_101" style="x"><path class="block" d="M0 0"/></g>' +
  '<g data-section="a_102" data-zones="old"><path d="M1 1"/></g></g><g id="pitch"><rect/></g></svg>';
assert.deepEqual(listSectionIds(svg), ["a_101", "a_102"]);
const stamped = stampZones(svg, [
  { id: "long", label: "אורך", sections: ["a_101"] },
  { id: "center", label: "מרכז", sections: ["a_101", "ghost"] },
]);
assert.ok(stamped.includes('<g data-section="a_101" style="x" data-zones="long center">'));
// unzoned sections still get the (empty) attribute - it marks the map as ours
assert.ok(stamped.includes('<g data-section="a_102" data-zones="">'));
assert.ok(!stamped.includes("old"));
assert.ok(stamped.includes('<g id="pitch"><rect/></g>'));
assert.equal(stampZones(stamped, []).match(/data-zones=""/g)?.length, 2);
assert.equal(newZoneId("Long Side L3", []), "long-side-l3");
assert.equal(newZoneId("אורך", [{ id: "zone", label: "", sections: [] }]), "zone-2");

/* which LiveTickets categories we sell */
const raw = { id: 1, title: "Category 2", cost: 331.2, maxTicketAmount: 6, seatingMethodId: 4, apiImmediatePurchase: true };
assert.equal(toLiveTicketsCategory(raw).sellable, true);
assert.equal(toLiveTicketsCategory({ ...raw, apiImmediatePurchase: false }).blockedReason, "Not instant-confirm");
assert.equal(toLiveTicketsCategory({ ...raw, seatingMethodId: 2 }).sellable, false);
assert.equal(toLiveTicketsCategory({ ...raw, maxTicketAmount: 1 }).sellable, false);
assert.equal(
  toLiveTicketsCategory({ ...raw, hebComments: "אדום במפה, לאורך המגרש קומה 3" }).description,
  "לאורך המגרש קומה 3",
);

/* attached sync: only LiveTickets tickets move, only what was attached */
const category = (id: number, over = {}) => toLiveTicketsCategory({ ...raw, id, ...over });
const applied = applyLiveTicketsStock(
  [tx, lt],
  "tx_event",
  { currency: "EUR", categories: [category(171442), category(999, { title: "New one" })] },
  () => 431,
);
assert.deepEqual(applied.tickets[0], tx);
assert.equal(applied.tickets[1].price, 431);
assert.equal(applied.tickets[1].available, true);
assert.equal(applied.updated, 1);
assert.deepEqual(applied.unattached, ["New one"]); // reported, never published
assert.equal(applied.tickets.length, 2);

const gone = applyLiveTicketsStock([tx, lt], "tx_event", { currency: "EUR", categories: [] }, () => 0);
assert.equal(gone.tickets[1].available, false);
assert.equal(gone.tickets[1].price, 400);
const notInstant = applyLiveTicketsStock(
  [tx, lt],
  "tx_event",
  { currency: "EUR", categories: [category(171442, { apiImmediatePurchase: false })] },
  () => 431,
);
assert.equal(notInstant.tickets[1].available, false);
const soldOut = applyLiveTicketsStock([tx, lt], "tx_event", "SOLD_OUT", () => 0);
assert.deepEqual(soldOut.tickets[0], tx);
assert.equal(soldOut.tickets[1].available, false);

console.log("multi-supplier selftest: all assertions passed");
process.exit(0);
