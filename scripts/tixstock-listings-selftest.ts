// Self-test for the listing rules the TixStock price sync shares with main
// (lib/tixstock-listings.ts). No DB, no network.
//   npx tsx scripts/tixstock-listings-selftest.ts
import assert from "node:assert/strict";
import {
  categoryMatchesMapId,
  hasObstructedViewRestriction,
  isExcludedSection,
  listingCanSatisfyQuantity,
  listingsTheSiteSells,
  PRICED_PARTY,
  type TixStockListingRuleFields,
} from "../lib/tixstock-listings";
import { UNLABELED_SECTION_MARK } from "../lib/tixstock-map";

const mk = (
  available: number,
  split_type: string,
  split_quantity = 0,
): TixStockListingRuleFields => ({
  ticket: { split_type },
  number_of_tickets_for_sale: { quantity_available: available, split_quantity },
});

/* 1. the seller's split rules - the cases of main lib/__tests__/tixstock-quantity.test.ts */

// Event 1095 real shapes: split_quantity 0 everywhere
assert.equal(listingCanSatisfyQuantity(mk(6, "No Preferences"), 1), true);
assert.equal(listingCanSatisfyQuantity(mk(2, "No Preferences"), 1), true);
assert.equal(listingCanSatisfyQuantity(mk(6, "Avoid Leaving One Ticket"), 1), true);
assert.equal(listingCanSatisfyQuantity(mk(2, "Avoid Leaving One Ticket"), 1), false);
assert.equal(listingCanSatisfyQuantity(mk(3, "Avoid Leaving One Ticket"), 2), false);
assert.equal(listingCanSatisfyQuantity(mk(4, "Avoid Leaving One Ticket"), 2), true);
// availability floor
assert.equal(listingCanSatisfyQuantity(mk(1, "No Preferences"), 2), false);
assert.equal(listingCanSatisfyQuantity(mk(0, "No Preferences"), 1), false);
// all-or-nothing
assert.equal(listingCanSatisfyQuantity(mk(4, "Sell Together"), 4), true);
assert.equal(listingCanSatisfyQuantity(mk(4, "Sell Together"), 2), false);
assert.equal(listingCanSatisfyQuantity(mk(2, "All Together"), 2), true);
// multiples
assert.equal(listingCanSatisfyQuantity(mk(8, "Multiples", 2), 1), false);
assert.equal(listingCanSatisfyQuantity(mk(8, "Multiples", 2), 4), true);
assert.equal(listingCanSatisfyQuantity(mk(9, "Multiples", 3), 2), false);
// bad qty, and a listing that says nothing about itself
assert.equal(listingCanSatisfyQuantity(mk(8, "No Preferences"), 0), false);
assert.equal(listingCanSatisfyQuantity({}, 2), false);
// what the sync asked until 2026-10-07 - "2 or more seats" - is not enough:
assert.equal(listingCanSatisfyQuantity(mk(3, "Avoid Leaving One Ticket"), PRICED_PARTY), false);
assert.equal(listingCanSatisfyQuantity(mk(6, "Sell Together"), PRICED_PARTY), false);
assert.equal(PRICED_PARTY, 2);

/* 2. restricted view */

const view = (
  restrictions_benefits: TixStockListingRuleFields["restrictions_benefits"],
): TixStockListingRuleFields => ({ ...mk(4, "No Preferences"), restrictions_benefits });

assert.equal(hasObstructedViewRestriction(mk(4, "No Preferences")), false);
assert.equal(hasObstructedViewRestriction(view(null)), false);
assert.equal(hasObstructedViewRestriction(view({ other: "Restricted view" })), true);
assert.equal(hasObstructedViewRestriction(view({ options: ["Limited View"] })), true);
assert.equal(hasObstructedViewRestriction(view({ options: [{ name: "Side view", value: "" }] })), true);
assert.equal(
  hasObstructedViewRestriction(view({ options: [{ name: "Restriction", value: "Partial view of the stage" }] })),
  true,
);
assert.equal(
  hasObstructedViewRestriction(view({ options: ["Alcohol free area", { name: "Home fans only" }] })),
  false,
);
// "side" with no "view" is a place, not a restriction
assert.equal(hasObstructedViewRestriction(view({ other: "Side of stage" })), false);
// options that are not a list, or hold no text, say nothing
assert.equal(hasObstructedViewRestriction(view({ options: "Restricted view" })), false);
assert.equal(hasObstructedViewRestriction(view({ options: [null, 7] })), false);

/* 3. sections staff excluded on the map */

assert.equal(categoryMatchesMapId("Longside Lower Tier", "longside-lower-tier"), true);
// the Bernabéu: the drawing says "categoría-1", the listing "CATEGORÍA 1 (CAT1)"
assert.equal(categoryMatchesMapId("CATEGORÍA 1 (CAT1)", "categoría-1"), true);
assert.equal(categoryMatchesMapId("Category 1", "category-2"), false);
assert.equal(categoryMatchesMapId("", "x"), false);
assert.equal(categoryMatchesMapId("(CAT1)", ""), false);

const seat = (category: string, section: string): TixStockListingRuleFields => ({
  ...mk(4, "No Preferences"),
  seat_details: { category, section },
});

assert.equal(isExcludedSection(seat("Longside Lower Tier", "101"), []), false);
assert.equal(isExcludedSection(seat("Longside Lower Tier", "101"), ["longside-lower-tier_101"]), true);
assert.equal(isExcludedSection(seat("Longside Lower Tier", "102"), ["longside-lower-tier_101"]), false);
assert.equal(isExcludedSection(seat("Shortside Lower Tier", "101"), ["longside-lower-tier_101"]), false);
assert.equal(isExcludedSection(seat("Longside Lower Tier", " A1 "), ["longside-lower-tier_a1"]), true);
assert.equal(isExcludedSection(seat("CATEGORÍA 1 (CAT1)", "305"), ["categoría-1_305"]), true);
// an id with no underscore names nothing
assert.equal(isExcludedSection(seat("Longside Lower Tier", "101"), ["101"]), false);
// a listing that names only its category goes with a concrete excluded section of it...
const categoryOnly = seat("Longside Lower Tier", "Longside Lower Tier");
assert.equal(isExcludedSection(categoryOnly, ["longside-lower-tier_101"]), true);
assert.equal(isExcludedSection(categoryOnly, ["shortside-lower-tier_101"]), false);
// ...but not with an unlabeled wedge or the legacy empty id - those hold no tickets
assert.equal(
  isExcludedSection(categoryOnly, [`longside-lower-tier_${UNLABELED_SECTION_MARK}3`]),
  false,
);
assert.equal(isExcludedSection(categoryOnly, ["longside-lower-tier_"]), false);

/* all three at once - what may set a ticket's price */

const feed = [
  { id: "ok", ...seat("Lower Tier", "101") },
  { id: "would leave one", ...seat("Lower Tier", "102"), ...mk(3, "Avoid Leaving One Ticket") },
  { id: "restricted view", ...seat("Lower Tier", "103"), restrictions_benefits: { other: "Restricted view" } },
  { id: "excluded section", ...seat("Lower Tier", "104") },
  { id: "block of four", ...seat("Lower Tier", "105"), ...mk(4, "All Together") },
  { id: "single", ...seat("Lower Tier", "106"), ...mk(1, "No Preferences") },
];
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

assert.deepEqual(ids(listingsTheSiteSells(feed, ["lower-tier_104"])), ["ok"]);
assert.deepEqual(ids(listingsTheSiteSells(feed, [])), ["ok", "excluded section"]);
assert.deepEqual(ids(listingsTheSiteSells(feed, ["lower-tier_104"], 4)), ["ok", "block of four"]);
assert.deepEqual(ids(listingsTheSiteSells(feed, ["lower-tier_104"], 1)), ["ok", "would leave one", "single"]);
assert.deepEqual(listingsTheSiteSells([], ["lower-tier_104"]), []);

console.log("tixstock-listings: all assertions passed");
process.exit(0);
