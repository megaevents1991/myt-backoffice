// Self-test for the pure parts of multi-supplier events. No DB, no network.
//   npx tsx --env-file=.env.local scripts/multi-supplier-selftest.ts
import assert from "node:assert/strict";
import {
  normalizeSupplierCategory,
  supplierEventId,
  supplierPriceUsd,
  ticketSupplier,
} from "../lib/suppliers";
import {
  listSectionIds,
  newZoneId,
  sectionCategory,
  stampZones,
  zonesFromCategories,
} from "../lib/venue-maps/svg-zones";
import {
  sectionNumber,
  sectorRange,
  suggestZone,
  suggestZoneTiered,
} from "../lib/venue-maps/zone-suggest";
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

/* a freshly adopted drawing: one zone per TixStock category, tickets linked */
const tixSvg =
  '<svg><g data-category="categoría-1-(cat1)"><g data-section="categoría-1-(cat1)_101"/>' +
  '<g data-section="categoría-1-(cat1)_102"/></g>' +
  '<g data-category="field-disabled"><g data-section="field-disabled_1"/></g>' +
  '<g data-section="categoria-2-fondo_201"/></svg>';
const auto = zonesFromCategories(tixSvg, (key) =>
  key === "categoria 1" ? "לאורך המגרש" : undefined,
);
assert.deepEqual(
  auto.zones.map((z) => [z.id, z.label, z.sections.length]),
  [
    ["categoria-1", "לאורך המגרש", 2],
    ["categoria-2-fondo", "categoria 2 fondo", 1],
  ],
);
// the venue template a TixStock ticket is linked through - no disabled stand
assert.deepEqual(auto.categoryToZone, {
  "categoria 1": "categoria-1",
  "categoria 2 fondo": "categoria-2-fondo",
});
assert.equal(sectionCategory("upper-tier_a_12"), "upper-tier_a");
assert.equal(sectionCategory("standing"), "standing");

/* which LiveTickets categories we sell */
const raw = { id: 1, title: "Category 2", cost: 331.2, maxTicketAmount: 6, seatingMethodId: 4, apiImmediatePurchase: true };
assert.equal(toLiveTicketsCategory(raw).sellable, true);
assert.equal(toLiveTicketsCategory({ ...raw, apiImmediatePurchase: false }).blockedReason, "Not instant-confirm");
assert.equal(toLiveTicketsCategory({ ...raw, seatingMethodId: 2 }).sellable, false);
// one per order is sellable (main shows it to a party of one only); none per order is not
assert.equal(toLiveTicketsCategory({ ...raw, maxTicketAmount: 1 }).sellable, true);
assert.equal(toLiveTicketsCategory({ ...raw, maxTicketAmount: 0 }).sellable, false);
// blocked by instant confirm ALONE is recognisable; a hard blocker beside it is not
assert.equal(toLiveTicketsCategory({ ...raw, apiImmediatePurchase: false }).nonInstantOnly, true);
assert.equal(
  toLiveTicketsCategory({ ...raw, apiImmediatePurchase: false, seatingMethodId: 2 }).nonInstantOnly,
  false,
);
assert.equal(toLiveTicketsCategory(raw).nonInstantOnly, false);
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
// ...unless the operator attached it AS non-instant: it stays on sale, flagged
const flagged = { ...lt, nonInstant: true };
const keptFlagged = applyLiveTicketsStock(
  [tx, flagged],
  "tx_event",
  { currency: "EUR", categories: [category(171442, { apiImmediatePurchase: false })] },
  () => 431,
);
assert.equal(keptFlagged.tickets[1].available, true);
assert.equal(keptFlagged.tickets[1].nonInstant, true);
assert.equal(keptFlagged.tickets[1].price, 431);
// it turned instant-confirm: the warning goes
const nowInstant = applyLiveTicketsStock(
  [tx, flagged],
  "tx_event",
  { currency: "EUR", categories: [category(171442)] },
  () => 431,
);
assert.equal(nowInstant.tickets[1].available, true);
assert.equal(nowInstant.tickets[1].nonInstant, undefined);
// a flagged ticket whose category hits a HARD blocker still goes off sale
const hard = applyLiveTicketsStock(
  [tx, flagged],
  "tx_event",
  { currency: "EUR", categories: [category(171442, { apiImmediatePurchase: false, seatingMethodId: 2 })] },
  () => 431,
);
assert.equal(hard.tickets[1].available, false);
const soldOut = applyLiveTicketsStock([tx, lt], "tx_event", "SOLD_OUT", () => 0);
assert.deepEqual(soldOut.tickets[0], tx);
assert.equal(soldOut.tickets[1].available, false);

/* zone suggestion - zones of the pilot Bernabéu map (event 1130), sections trimmed */
const bz = (id: string, label: string, numbers: number[]) => ({
  id,
  label,
  sections: numbers.map((n) => `categoria_${n}`),
});
const bernabeu = [
  bz("long-center", "לאורך המגרש - מרכז, קומות 1-2", [101, 106, 129, 134, 201, 206, 229, 234, 301, 306, 331, 336, 401, 406, 437, 444]),
  bz("long-center-l2", "לאורך המגרש - מרכז, קומה 2", [301, 306, 331, 336, 401, 406, 437, 444]),
  bz("long-l1", "לאורך המגרש - קומה 1", [107, 108, 127, 128, 207, 208, 227, 228]),
  bz("long-l2", "לאורך המגרש - קומה 2", [307, 310, 325, 330, 407, 410, 433, 436]),
  bz("long-l3", "לאורך המגרש - קומה 3", [501, 512, 535, 544]),
  bz("long-upper", "לאורך המגרש - קומה 4 (עליונה)", [601, 610, 635, 646, 701, 710]),
  bz("short-lower", "מאחורי השער - קומות 1-2", [109, 128, 207, 228, 309, 326, 409, 434]),
  bz("short-upper", "מאחורי השער - קומות 3-4", [513, 534, 611, 634, 663]),
];
assert.deepEqual(sectorRange("קומה 3 (סקטורים 500-600)"), [500, 699]);
assert.deepEqual(sectorRange("(סקטור 700)"), [700, 799]);
assert.equal(sectorRange("מאחורי השער"), null);
assert.equal(sectionNumber("categoría-1_511"), 511);
assert.equal(sectionNumber("vip-box_vip-box-gol-norte"), null);
const suggested = (text: string) => suggestZone(text, bernabeu)?.zoneId ?? null;
// every LiveTickets category of the pilot lands where the operator put it by hand
assert.equal(suggested("מאחורי השער קומות 3-4 (סקטורים 500-600)"), "short-upper");
assert.equal(suggested("לאורך המגרש קומה 4 (סקטורים 600-700)"), "long-upper");
assert.equal(suggested("מאחורי השער קומות 1-2 (סקטורים 100-400)"), "short-lower");
assert.equal(suggested("לאורך המגרש קומה 3 (סקטורים 500-600)"), "long-l3");
assert.equal(suggested("לאורך המגרש קומה 2 (סקטורים 300-400)"), "long-l2");
assert.equal(suggested("לאורך המגרש קומה 1 (סקטורים 100-200)"), "long-l1");
assert.equal(suggested("לאורך המגרש קומה 2 מרכזי (סקטורים 300-400)"), "long-center-l2");
// a wide range must not hand the win to a small zone inside it
assert.equal(suggested("לאורך המגרש קומות 1-2 מרכזי (סקטורים 100-300)"), "long-center");
// two words and no range is a guess - say nothing
assert.equal(suggested("מאחורי השער"), null);
assert.equal(suggested("Category 1"), null);
assert.equal(suggestZone("לאורך המגרש קומה 3", []), null);
// strong answers stay strong in the tiered form
assert.equal(suggestZoneTiered("לאורך המגרש קומה 1 (סקטורים 100-200)", bernabeu)?.strong, true);
// a map sliced coarser than LiveTickets (the older Madrid drawing): no strong
// match exists, the nearest zone is still offered - as a guess
const coarse = [
  bz("premium", "לאורך המגרש במרכז יציעים 100-400", [129, 134, 229, 234, 301, 306, 401, 406]),
  bz("cat1", "לאורך המגרש יציע 500-600", [501, 512]),
  bz("fondo", "מאחורי השער אזור 100-500", [115, 126, 215, 226, 315, 326, 415, 426]),
  bz("lateral", "לאורך המגרש אזור 700", [601, 610, 701, 710]),
];
const weak = suggestZoneTiered("מאחורי השער קומות 1-2 (סקטורים 100-400)", coarse);
assert.equal(weak?.zoneId, "fondo");
assert.equal(suggestZoneTiered("Category 1", coarse), null);

console.log("multi-supplier selftest: all assertions passed");
process.exit(0);
