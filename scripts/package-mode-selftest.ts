// Run: npx tsx scripts/package-mode-selftest.ts
import assert from "node:assert/strict";
import { isTicketOnlyEvent, ticketOnlyProblems } from "../lib/package-mode";

assert.equal(isTicketOnlyEvent({ package_mode: "ticket_only" }), true);
assert.equal(isTicketOnlyEvent({ package_mode: "package" }), false);
assert.equal(isTicketOnlyEvent({}), false, "missing column (older row) = package");
assert.equal(isTicketOnlyEvent({ package_mode: null }), false);
assert.equal(isTicketOnlyEvent({ package_mode: "no_hotel" }), false, "unknown future mode is not ticket-only");

assert.deepEqual(ticketOnlyProblems({ package_mode: "package", ticket_only_markup: null }), []);
assert.deepEqual(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: 0 }), [], "0 markup is valid");
assert.deepEqual(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: 45 }), []);
assert.equal(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: null }).length, 1);
assert.equal(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: -1 }).length, 1);
assert.equal(ticketOnlyProblems({ package_mode: "ticket_only", ticket_only_markup: Number.NaN }).length, 1);

console.log("package-mode selftest OK");
