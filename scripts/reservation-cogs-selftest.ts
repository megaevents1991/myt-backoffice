// Run: npx tsx scripts/reservation-cogs-selftest.ts
import assert from "node:assert/strict";
import { estimateTicketCostUsd } from "../lib/services/reservation-cogs-fill";

assert.deepEqual(
  estimateTicketCostUsd({ supplier: "livetickets", quantity: 2, salePerTicketUsd: 180, liveCategoryCost: 100, liveCurrency: "GBP", toUsd: (a, c) => (c === "GBP" ? a * 1.3 : a) }),
  { usd: 260, how: "live_events category cost" },
);
assert.deepEqual(
  estimateTicketCostUsd({ supplier: "xs2event", quantity: 1, salePerTicketUsd: 150, xs2NetRateEurCents: 9000, toUsd: (a, c) => (c === "EUR" ? a * 1.1 : a) }),
  { usd: 99, how: "xs2 net rate" },
);
const inv = estimateTicketCostUsd({ supplier: "static", quantity: 2, salePerTicketUsd: 143.5, toUsd: (a) => a });
assert.equal(inv.how, "inverted markup");
assert.equal(inv.usd, Math.round((143.5 / 1.035 - 40) * 2 * 100) / 100);
assert.equal(estimateTicketCostUsd({ supplier: "static", quantity: 1, salePerTicketUsd: 20, toUsd: (a) => a }).usd, 0, "a sale below the markup floors at 0");
assert.equal(estimateTicketCostUsd({ supplier: "livetickets", quantity: 1, salePerTicketUsd: 100, toUsd: (a) => a }).how, "inverted markup", "no category cost known -> inverted");

console.log("reservation-cogs selftest OK");
