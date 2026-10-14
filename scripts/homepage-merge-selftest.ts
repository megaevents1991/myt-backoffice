// scripts/homepage-merge-selftest.ts - `npx tsx scripts/homepage-merge-selftest.ts`
// The homepage row merge (lib/homepage/merge.ts) - the same file, byte for byte,
// as myt-main lib/homepage/merge.ts, where vitest covers it too
// (lib/__tests__/homepageMerge.test.ts). Pure: synthetic refs, no DB.
import {
  defaultPinnable,
  defaultShowable,
  mergeRow,
  planHomepage,
  rowDefaultMax,
} from "../lib/homepage/merge";
import { insertInOrder, moveInOrder, pinsForOrder } from "../lib/homepage/row-edit";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const ev = (n: number) => `event:${n}`;
const refs = (row: { cards: { ref: string }[] }) => row.cards.map((c) => c.ref);

check("no pins = the pool under max", refs(mergeRow([ev(1), ev(2), ev(3)], [], { max: 2 })), [ev(1), ev(2)]);
check(
  "a pin keeps its place, the rule fills around it",
  refs(mergeRow([ev(1), ev(2), ev(3), ev(4)], [{ ref: ev(9), slot: 2 }], { max: 5 })),
  [ev(1), ev(2), ev(9), ev(3), ev(4)],
);
check(
  "an auto card that is pinned leaves the auto part",
  refs(mergeRow([ev(1), ev(2), ev(3)], [{ ref: ev(3), slot: 0 }], {})),
  [ev(3), ev(1), ev(2)],
);
check(
  "pins close up when the pool runs out",
  refs(mergeRow([ev(1)], [{ ref: ev(7), slot: 5 }, { ref: ev(8), slot: 9 }], {})),
  [ev(1), ev(7), ev(8)],
);
{
  const row = mergeRow([ev(1), ev(2), ev(3)], [{ ref: ev(5), slot: 0 }, { ref: ev(9), slot: 2 }], {
    showable: (r) => r !== ev(5),
  });
  check("a dead pin is reported and the pins after it close up", [refs(row), row.deadPins], [
    [ev(1), ev(9), ev(2), ev(3)],
    [ev(5)],
  ]);
}
{
  const row = mergeRow(["artist:a", "artist:b", "artist:c"], [{ ref: "artist:c", slot: 0 }], {
    pinnable: (r) => r !== "artist:c",
  });
  check("not pinnable but showable falls back to the rule's place", [refs(row), row.deadPins], [
    ["artist:a", "artist:b", "artist:c"],
    ["artist:c"],
  ]);
}
check(
  "lanes interleave after pins and hidden are out",
  refs(
    mergeRow(
      { lanes: [["artist:a1", "artist:a2", "artist:a3"], ["team:t1", "team:t2"]] },
      [{ ref: "artist:a1", slot: 0 }],
      { hidden: ["team:t1"] },
    ),
  ),
  ["artist:a1", "artist:a2", "team:t2", "artist:a3"],
);
check("hidden drops an auto card", refs(mergeRow([ev(1), ev(2), ev(3)], [], { hidden: [ev(2)] })), [ev(1), ev(3)]);
check(
  "a pin beats hidden",
  refs(mergeRow([ev(1), ev(2)], [{ ref: ev(2), slot: 0 }], { hidden: [ev(2)] })),
  [ev(2), ev(1)],
);
{
  const row = mergeRow([ev(1), ev(2), ev(3)], [{ ref: ev(9), slot: 7 }], { max: 2 });
  check("a pin past max is off range", [refs(row), row.offRange], [[ev(1), ev(2)], [ev(9)]]);
}
{
  const plan = planHomepage(
    [
      { key: "most_wanted", pins: [{ ref: ev(9), slot: 0 }], hidden: [], max: 2 },
      { key: "newest", pins: [], hidden: [], max: 2 },
      { key: "more_events", pins: [], hidden: [], max: null },
    ],
    {
      most_wanted: [ev(1), ev(2), ev(3)],
      newest: [ev(1), ev(9), ev(4), ev(5)],
      more_events: [ev(1), ev(4), ev(6)],
    },
  );
  check("plan: newest skips most wanted, more events skips both", [
    refs(plan.most_wanted),
    refs(plan.newest),
    refs(plan.more_events),
  ], [[ev(9), ev(1)], [ev(4), ev(5)], [ev(6)]]);
}
check("default max: event rows 12, sliders 12, the rest all", [
  rowDefaultMax("newest"),
  rowDefaultMax("blk_12345678"),
  rowDefaultMax("football"),
], [12, 12, null]);
check("showable: a sold-out event no", defaultShowable({ soldOut: true }, "newest", ev(1)), false);
check("showable: an artist off sale shows in its row, not in the hero", [
  defaultShowable({ available: false }, "artists", "artist:a"),
  defaultShowable({ available: false }, "hero", "artist:a"),
], [true, false]);
check("pinnable: an artist off sale may not hold a place", defaultPinnable({ available: false }, "artists", "artist:a"), false);

// --- the board's promise: the row after a move IS the row the site shows ---

{
  const pool = [ev(1), ev(2), ev(3), ev(4), ev(5), ev(6)];
  const asPins = (rows: { kind: string; ref_id: string; position: number }[]) =>
    rows.map((r) => ({ ref: `${r.kind}:${r.ref_id}`, slot: r.position }));
  const roundTrip = (
    pins: { ref: string; slot: number }[],
    move: (order: string[]) => { order: string[]; moved: string },
    opts: { max?: number | null; showable?: (r: string) => boolean } = {},
  ) => {
    const before = mergeRow(pool, pins, opts);
    const shown = before.cards.map((c) => c.ref);
    const { order, moved } = move(shown);
    const pinned = new Set([...before.cards.filter((c) => c.pinned).map((c) => c.ref), moved]);
    const next = pinsForOrder("most_wanted", order, pinned, [...before.deadPins, ...before.offRange]);
    return { want: order, got: refs(mergeRow(pool, asPins(next), opts)) };
  };

  const a = roundTrip([], (o) => ({ order: moveInOrder(o, 4, 1), moved: o[4] }));
  check("move an auto card earlier: the site shows the dragged row", a.got, a.want);

  const b = roundTrip([{ ref: ev(3), slot: 0 }], (o) => ({ order: moveInOrder(o, 1, 3), moved: o[1] }));
  check("move with an existing pin: the site shows the dragged row", b.got, b.want);

  const c = roundTrip([{ ref: ev(2), slot: 4 }], (o) => ({ order: moveInOrder(o, 4, 0), moved: o[4] }));
  check("move a pinned card to the front", c.got, c.want);

  const d = roundTrip([], (o) => ({ order: insertInOrder(o, ev(9), 2), moved: ev(9) }), { max: 4 });
  check("add a new card at place 3 of a 4-card row", d.got, d.want.slice(0, 4));

  const e = roundTrip(
    [{ ref: ev(7), slot: 0 }, { ref: ev(4), slot: 3 }],
    (o) => ({ order: moveInOrder(o, 0, 2), moved: o[0] }),
    { showable: (r) => r !== ev(7) },
  );
  check("a dead pin kept after the row never shifts a shown pin", e.got, e.want);
}
check("moveInOrder clamps", moveInOrder(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
check("insertInOrder takes the card out first", insertInOrder(["a", "b", "c"], "c", 0), ["c", "a", "b"]);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
