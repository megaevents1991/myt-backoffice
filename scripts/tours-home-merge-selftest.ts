// scripts/tours-home-merge-selftest.ts - `npx tsx scripts/tours-home-merge-selftest.ts`
// Pure only: the three-way merge of a document (lib/doc-merge.ts) and its home page wording
// (lib/tours/home-merge.ts). No DB, no network.
//
// What it guards: two people editing the home page at once (Liz + Alon, 12.11.2026 - Liz saved ten
// times in 18 minutes and Alon's save, opened before her last one, was refused and his changes
// lost). A merge keeps every change of both sides that does not collide, keeps MINE where both
// changed the same thing, never drops a change because the other side removed its item, and
// answers a document the home schema still accepts.
//
// HOME_FIXTURE=<path to a stored home document as JSON> runs the identity checks and a two-tile
// edit over a real document too.
import { readFileSync } from "node:fs";

import { deepEqual, mergeDocs } from "../lib/doc-merge";
import { collisionLine, mergeHomeDocs } from "../lib/tours/home-merge";
import { homeSchema, readSiteDoc, type HomeDoc, type HomeSection } from "../lib/tours/site-content";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
const truthy = (name: string, value: boolean) => check(name, value, true);

const clone = <T>(v: T): T => structuredClone(v);
type Tabbed = Extract<HomeSection, { type: "tours" }>;
const finder = (doc: HomeDoc) => doc.sections.find((s) => s.type === "tours") as Tabbed;
const tab = (doc: HomeDoc, key: string) => finder(doc).tabs.find((t) => t.key === key)!;
const ids = (doc: HomeDoc) => doc.sections.map((s) => s.id);

// ---------------------------------------------------------------- a home page like Mega Family's
const storedTab = (key: string, label: string, rows: unknown[] = []) => ({
  key,
  label,
  icon: "",
  show: "world",
  world: key,
  allLabel: "",
  color: "",
  search: "filters",
  rows,
});
/** A tile as the editor holds it (the schema's defaults filled in). */
const parsedTab = (key: string, label: string) =>
  finder(readSiteDoc("home", { sections: [{ id: "t", visible: true, type: "tours", gridTitle: "", tabs: [storedTab(key, label)] }] })).tabs[0];
const BASE: HomeDoc = readSiteDoc("home", {
  sections: [
    { id: "hero", visible: true, type: "hero", titleBold: "", titleRest: "", text: "", slides: [] },
    {
      id: "tours",
      visible: true,
      type: "tours",
      gridTitle: "",
      salePills: [],
      tabs: [
        storedTab("all", "כל המבחר"),
        storedTab("family", "מאורגנים למשפחות", [
          { id: "row_a", title: "מקומות אחרונים", source: "world", term: "משפחות", tours: ["a", "b"], limit: 12 },
          { id: "row_b", title: "פסח 2027", source: "manual", term: "", tours: [], limit: 8 },
        ]),
        storedTab("events", "ספורט ומוזיקה"),
      ],
    },
    { id: "lead", visible: true, type: "lead_form", title: "הנציגים שלנו מחכים לכם" },
    { id: "reasons", visible: true, type: "reasons", title: "כל הסיבות", items: [] },
    { id: "text1", visible: true, type: "text", title: "שלום", html: "" },
  ],
});
truthy("the fixture parses", homeSchema.safeParse(BASE).success);
truthy("the fixture has its sections", ids(BASE).length === 5);

// ---------------------------------------------------------------- identities
{
  const mine = clone(BASE);
  tab(mine, "family").moreLabel = "לכל הטיולים";
  const theirs = clone(BASE);
  finder(theirs).gridTitle = "הכי חמים";

  const a = mergeHomeDocs(BASE, mine, BASE);
  check("merge(b, m, b) = m", deepEqual(a.value, mine), true);
  check("merge(b, m, b) has no collisions", a.collisions, []);
  const b = mergeHomeDocs(BASE, BASE, theirs);
  check("merge(b, b, t) = t", deepEqual(b.value, theirs), true);
  check("merge(b, b, t) has no collisions", b.collisions, []);
  const c = mergeHomeDocs(BASE, mine, clone(mine));
  check("merge(b, x, x) = x", deepEqual(c.value, mine), true);
  check("merge(b, x, x) has no collisions", c.collisions, []);
}

// ---------------------------------------------------------------- this morning: two tiles of the one Tour finder
{
  const liz = clone(BASE);
  tab(liz, "events").gridTitle = "חם עכשיו באיבנטס";
  tab(liz, "events").moreLabel = "לכולם";
  const alon = clone(BASE);
  tab(alon, "family").showGrid = false;
  tab(alon, "family").rows[1].title = "פסח 2027 - מבצע";

  const merged = mergeHomeDocs(BASE, alon, liz);
  check("two tiles: no collisions", merged.collisions, []);
  check("two tiles: Liz's grid title", tab(merged.value, "events").gridTitle, "חם עכשיו באיבנטס");
  check("two tiles: Liz's more text", tab(merged.value, "events").moreLabel, "לכולם");
  check("two tiles: Alon's switch", tab(merged.value, "family").showGrid, false);
  check("two tiles: Alon's row", tab(merged.value, "family").rows[1].title, "פסח 2027 - מבצע");
  truthy("two tiles: the home schema accepts it", homeSchema.safeParse(merged.value).success);
}

// ---------------------------------------------------------------- the same field: mine stays, said where
{
  const mine = clone(BASE);
  tab(mine, "family").moreLabel = "של אלון";
  const theirs = clone(BASE);
  tab(theirs, "family").moreLabel = "של ליז";
  tab(theirs, "events").label = "ספורט ומוזיקה!";

  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("same field: mine kept", tab(merged.value, "family").moreLabel, "של אלון");
  check("same field: their other change in", tab(merged.value, "events").label, "ספורט ומוזיקה!");
  check("same field: reported where", merged.collisions, [
    { kind: "both_changed", path: ["Tour finder", 'Tile "מאורגנים למשפחות"', 'Text of the "more" link'], theirs: "של ליז" },
  ]);
  check(
    "same field: the line",
    collisionLine(merged.collisions[0], "liz@x"),
    'Tour finder › Tile "מאורגנים למשפחות" › Text of the "more" link - you both changed it: yours is kept. liz@x had: "של ליז".',
  );
}
{
  // how their plain value prints: a switch as on / off, an emptied text as "(empty)"
  const line = collisionLine({ kind: "both_changed", path: ["X"], theirs: false }, "liz");
  check("a switch: on / off", line, "X - you both changed it: yours is kept. liz had: off.");
  check("an emptied text", collisionLine({ kind: "both_changed", path: ["X"], theirs: "" }, "liz"), "X - you both changed it: yours is kept. liz had: (empty).");
}

// ---------------------------------------------------------------- a section added there, sections moved here
{
  const theirs = clone(BASE);
  const copy = { ...clone(theirs.sections[3]), id: "reasons_x1", onlyTabs: ["family"] } as HomeSection;
  theirs.sections.splice(4, 0, copy); // after "reasons"
  const mine = clone(BASE);
  const [reasons] = mine.sections.splice(3, 1);
  mine.sections.splice(1, 0, reasons); // reasons moved up under the hero

  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("add + move: no collisions", merged.collisions, []);
  check("add + move: my order, their section after the one it follows", ids(merged.value), ["hero", "reasons", "reasons_x1", "tours", "lead", "text1"]);
}

// ---------------------------------------------------------------- they moved, I edited: their order
{
  const theirs = clone(BASE);
  theirs.sections.reverse();
  const mine = clone(BASE);
  (mine.sections[2] as Extract<HomeSection, { type: "lead_form" }>).title = "דברו איתנו";
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("their order: no collisions", merged.collisions, []);
  check("their order: kept", ids(merged.value), ["text1", "reasons", "lead", "tours", "hero"]);
  check("their order: my edit in", (merged.value.sections[2] as Extract<HomeSection, { type: "lead_form" }>).title, "דברו איתנו");
}

// ---------------------------------------------------------------- both moved differently: my order, said so
{
  const mine = clone(BASE);
  mine.sections.reverse();
  const theirs = clone(BASE);
  theirs.sections.push(theirs.sections.shift()!);
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("both moved: my order", ids(merged.value), ids(mine));
  check("both moved: reported", merged.collisions, [{ kind: "order", path: [] }]);
  check("both moved: the line", collisionLine(merged.collisions[0], "liz"), "The order of the sections - you both moved things: your order is kept.");
}

// ---------------------------------------------------------------- removed on one side
{
  // I removed a section they changed: it comes back, said so
  const mine = clone(BASE);
  mine.sections = mine.sections.filter((s) => s.id !== "lead");
  const theirs = clone(BASE);
  (theirs.sections[2] as Extract<HomeSection, { type: "lead_form" }>).title = "חדש";
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("I removed, they changed: kept", ids(merged.value), ids(BASE));
  check("I removed, they changed: their change", (merged.value.sections[2] as Extract<HomeSection, { type: "lead_form" }>).title, "חדש");
  check("I removed, they changed: reported", merged.collisions, [{ kind: "you_removed", path: ['Lead form "חדש"'] }]);
}
{
  // they removed a section I did not touch: gone, nothing to say
  const theirs = clone(BASE);
  theirs.sections = theirs.sections.filter((s) => s.id !== "text1");
  const mine = clone(BASE);
  tab(mine, "all").label = "הכל";
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("they removed, untouched: gone", ids(merged.value), ["hero", "tours", "lead", "reasons"]);
  check("they removed, untouched: silent", merged.collisions, []);
}
{
  // they removed a row I changed: mine stays
  const theirs = clone(BASE);
  tab(theirs, "family").rows = tab(theirs, "family").rows.slice(0, 1);
  const mine = clone(BASE);
  tab(mine, "family").rows[1].limit = 4;
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("they removed my row: kept", tab(merged.value, "family").rows.map((r) => r.id), ["row_a", "row_b"]);
  check("they removed my row: reported", merged.collisions, [{ kind: "they_removed", path: ["Tour finder", 'Tile "מאורגנים למשפחות"', 'Row "פסח 2027"'] }]);
}

// ---------------------------------------------------------------- tiles and rows added on both sides
{
  const mine = clone(BASE);
  finder(mine).tabs.push(parsedTab("tab_mine", "נשים"));
  tab(mine, "family").rows.push({ id: "row_m", title: "שלי", source: "manual", term: "", tours: [], limit: 8 });
  const theirs = clone(BASE);
  tab(theirs, "family").rows.unshift({ id: "row_t", title: "שלה", source: "manual", term: "", tours: [], limit: 8 });
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("added both sides: no collisions", merged.collisions, []);
  check("added both sides: tiles", finder(merged.value).tabs.map((t) => t.key), ["all", "family", "events", "tab_mine"]);
  check("added both sides: rows", tab(merged.value, "family").rows.map((r) => r.id), ["row_t", "row_a", "row_b", "row_m"]);
}

// ---------------------------------------------------------------- a list without ids is one value
{
  const mine = clone(BASE);
  tab(mine, "family").rows[0].tours = ["a", "b", "c"];
  const theirs = clone(BASE);
  tab(theirs, "family").rows[0].tours = ["b"];
  const merged = mergeHomeDocs(BASE, mine, theirs);
  check("slugs: mine kept whole", tab(merged.value, "family").rows[0].tours, ["a", "b", "c"]);
  check("slugs: reported", merged.collisions, [{ kind: "both_changed", path: ["Tour finder", 'Tile "מאורגנים למשפחות"', 'Row "מקומות אחרונים"', "Tours"] }]);
}

// ---------------------------------------------------------------- the generic rules
check("deepEqual ignores key order", deepEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }), true);
check("deepEqual: list order counts", deepEqual([1, 2], [2, 1]), false);
check("deepEqual: missing = undefined", deepEqual({ a: 1 }, { a: 1, b: undefined }), true);
check("a key both added differently: mine", mergeDocs({}, { a: 1 }, { a: 2 }).value, { a: 1 });
check("a key they removed, untouched here: gone", mergeDocs({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 }).value, { a: 1 });
check(
  "duplicate ids = one value",
  mergeDocs({ l: [{ id: "x", v: 1 }, { id: "x", v: 2 }] }, { l: [{ id: "x", v: 3 }] }, { l: [{ id: "y", v: 1 }] }).collisions,
  [{ kind: "both_changed", path: ["l"] }],
);

// ---------------------------------------------------------------- a real document
const fixture = process.env.HOME_FIXTURE;
if (fixture) {
  const real = readSiteDoc("home", JSON.parse(readFileSync(fixture, "utf8")));
  truthy("real: parses", homeSchema.safeParse(real).success);
  const realFinder = finder(real);
  if (realFinder && realFinder.tabs.length >= 2) {
    const [first, second] = realFinder.tabs.map((t) => t.key);
    const mine = clone(real);
    tab(mine, first).moreLabel = "mine";
    const theirs = clone(real);
    tab(theirs, second).gridTitle = "theirs";
    theirs.sections.push(theirs.sections.shift()!);
    check("real: merge(b, m, b) = m", deepEqual(mergeHomeDocs(real, mine, real).value, mine), true);
    check("real: merge(b, b, t) = t", deepEqual(mergeHomeDocs(real, real, theirs).value, theirs), true);
    const merged = mergeHomeDocs(real, mine, theirs);
    check("real: two tiles, no collisions", merged.collisions, []);
    check("real: both edits in", [tab(merged.value, first).moreLabel, tab(merged.value, second).gridTitle], ["mine", "theirs"]);
    check("real: their order", ids(merged.value), ids(theirs));
    truthy("real: the home schema accepts it", homeSchema.safeParse(merged.value).success);
  }
  console.log(`checked the real document too (${real.sections.length} sections)`);
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("tours-home-merge selftest: all checks passed");
