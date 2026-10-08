// Run: npx tsx scripts/reservation-pnl-selftest.ts
import assert from "node:assert/strict";
import { revenueUsd, cogsUsd, netUsd, type PnlReservation } from "../lib/services/reservation-pnl";

const base: PnlReservation = {
  status: "Paid",
  user_shown_price: 1000,
  exchange_rate_usd_ils_100: 370,
  agent_card_discount_ils: null,
  partner_settlement_method: null,
  flight_order_info: { price: 500, isOffline: false, offer: { price: { grandTotal: "420.50" } }, added_bags: { total_usd: 30, cabin: { total_usd: 0 } } },
  hotel_order_info: { price: "300", isOffline: false },
  hotel_segments: null,
  offline_flight_cost: null,
  offline_hotel_cost: null,
  ticket_cost_usd: 150,
  ticket_cost_source: "live",
  actual_cost_usd: null,
  event_order_info: { number_of_ticket: 2, price_per_ticket: 120, total_tickets_price: 240 },
};

assert.equal(revenueUsd(base), 1000);
assert.equal(revenueUsd({ ...base, status: "Lost" }), null, "only Paid has revenue");
assert.equal(revenueUsd({ ...base, status: "paid" }), null, "exact casing, like the commission engine");
assert.equal(
  revenueUsd({ ...base, partner_settlement_method: "agent_card", agent_card_discount_ils: 370 }),
  900,
  "agent card: the ILS discount comes off at the reservation's own rate",
);

const c = cogsUsd(base);
assert.equal(c.flight, 450.5, "Amadeus grandTotal + bags, never the customer price");
assert.equal(c.hotel, 300);
assert.equal(c.ticket, 150);
assert.equal(c.total, 900.5);
assert.equal(c.source, "computed");
assert.equal(c.estimated, false);

const offline = cogsUsd({ ...base, flight_order_info: { price: 600, isOffline: true, offlineRawPrice: 250 }, offline_flight_cost: 500, hotel_order_info: { price: "999", isOffline: true }, offline_hotel_cost: 280 });
assert.equal(offline.flight, 500, "offline flight cost is already the booking total");
assert.equal(offline.hotel, 280);

const split = cogsUsd({ ...base, hotel_segments: [{ price: "300" }, { price: "120" }] });
assert.equal(split.hotel, 420, "a split stay sums every segment; hotel_order_info is segment 0");

const noOffer = cogsUsd({ ...base, flight_order_info: { price: 500 } });
assert.equal(noOffer.flight, 500);
assert.equal(noOffer.estimated, true, "customer price as cost = estimated, never silent");

const noTicket = cogsUsd({ ...base, ticket_cost_usd: null, ticket_cost_source: null });
assert.equal(noTicket.ticket, 240, "no snapshot: the sale price, flagged");
assert.equal(noTicket.estimated, true);

const est = cogsUsd({ ...base, ticket_cost_source: "estimated" });
assert.equal(est.estimated, true);

const actual = cogsUsd({ ...base, actual_cost_usd: 777 });
assert.equal(actual.total, 777);
assert.equal(actual.source, "actual");
assert.equal(actual.estimated, false, "ops typed the real number");

assert.equal(netUsd(base, 2), 1000 - 900.5 - 20);
assert.equal(netUsd({ ...base, status: "Pending" }, 2), null);

const skipped = cogsUsd({ ...base, flight_order_info: {}, hotel_order_info: {} });
assert.equal(skipped.flight, 0, "a skipped flight costs nothing");
assert.equal(skipped.hotel, 0);

console.log("reservation-pnl selftest OK");
