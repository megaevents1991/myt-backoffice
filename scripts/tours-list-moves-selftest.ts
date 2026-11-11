// scripts/tours-list-moves-selftest.ts - `npx tsx scripts/tours-list-moves-selftest.ts`
// Pure only: moving several lines of an editor together (lib/tours/list-moves.ts) and copying a date's content to
// other dates (lib/tours/departure-content.ts). No DB, no network.
//
// What it guards: Liz 11.11 (road map tab "הערות ליז" notes 3 + 4) - picked attractions keep their order and land
// where they were dropped, two lines with the same words are told apart by place, and a copy replaces only the
// ticked fields of a date.
import { movedBlock } from "../lib/tours/list-moves";
import { EMPTY_DEPARTURE_CONTENT, ownFields, withCopiedFields } from "../lib/tours/departure-content";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
}

const L = ["a", "b", "c", "d", "e", "f"];
eq("two picked lines dragged up land before the row they were dropped on", movedBlock(L, [3, 4], 1, false), { list: ["a", "d", "e", "b", "c", "f"], at: [1, 2] });
eq("dragged down they land after it", movedBlock(L, [0, 1], 4, true), { list: ["c", "d", "e", "a", "b", "f"], at: [3, 4] });
eq("picked out of order, they keep the list's order", movedBlock(L, [4, 1], 0, false), { list: ["b", "e", "a", "c", "d", "f"], at: [0, 1] });
eq("lines apart close up around them", movedBlock(L, [0, 5], 2, true), { list: ["b", "c", "a", "f", "d", "e"], at: [2, 3] });
eq("dropped on one of the picked: nothing moves", movedBlock(L, [2, 3], 3, true), { list: L, at: [2, 3] });
eq("the same words twice are told apart by place", movedBlock(["x", "", "y", ""], [3], 0, false), { list: ["", "x", "", "y"], at: [0] });
eq("to the very end", movedBlock(L, [0], 5, true), { list: ["b", "c", "d", "e", "f", "a"], at: [5] });

const source = { ...EMPTY_DEPARTURE_CONTENT, attractions: ["פריז", "דיסנילנד"], heroImage: "/media/x.jpg" };
const target = { ...EMPTY_DEPARTURE_CONTENT, attractions: ["לונדון"], included: ["טיסות"] };
eq("a copy replaces the ticked field", withCopiedFields(target, source, ["attractions"]).attractions, ["פריז", "דיסנילנד"]);
eq("...and leaves the date's other fields its own", withCopiedFields(target, source, ["attractions"]).included, ["טיסות"]);
eq("a ticked field empty at the source goes back to the season's / the tour's", withCopiedFields(target, source, ["included"]).included, []);
eq("the copy is not the source's own array", withCopiedFields(target, source, ["attractions"]).attractions === source.attractions, false);
eq("the fields a date fills", ownFields(source), ["attractions", "heroImage"]);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
