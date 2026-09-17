// Run: node scripts/base-price-rotation-selftest.ts  (pure - no env, no DB)
import assert from "node:assert/strict";
import { orderForRotation } from "../lib/services/base-price-rotation.ts";

const NEAR_END = "2026-11-01";
const ev = (id: number, date: string) => ({ id, date });
const near = [ev(1, "2026-10-01"), ev(2, "2026-10-02"), ev(3, "2026-10-03")];
const far = [ev(10, "2027-01-01"), ev(11, "2027-02-01"), ev(12, "2027-03-01"), ev(13, "2027-04-01")];

// nobody visited yet: queues alternate, each by date
assert.deepEqual(orderForRotation([...far, ...near], new Map(), NEAR_END).map((e) => e.id), [1, 10, 2, 11, 3, 12, 13]);

// the bug this replaced: every near event visited, no far one ever - far events must still get slots tonight
const visited = new Map<number, string>([[1, "2026-09-16T01:30:00Z"], [2, "2026-09-15T01:30:00Z"], [3, "2026-09-14T01:30:00Z"]]);
const order = orderForRotation([...near, ...far], visited, NEAR_END).map((e) => e.id);
assert.deepEqual(order, [3, 10, 2, 11, 1, 12, 13]); // least recently visited first inside each queue
assert.ok(order.slice(0, 4).filter((id) => id >= 10).length === 2); // half of the first visits go far

// a never-visited event beats a visited one in its own queue
const farVisited = new Map<number, string>([[10, "2026-09-16T01:30:00Z"]]);
assert.deepEqual(orderForRotation(far, farVisited, NEAR_END).map((e) => e.id), [11, 12, 13, 10]);

// one empty queue = the other runs straight through; nothing is dropped or duplicated
assert.deepEqual(orderForRotation(near, new Map(), NEAR_END).map((e) => e.id), [1, 2, 3]);
assert.equal(new Set(order).size, near.length + far.length);

console.log("base-price rotation selftest: all assertions passed");
