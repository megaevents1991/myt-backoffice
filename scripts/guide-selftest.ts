// Run: npx tsx scripts/guide-selftest.ts
// The guide (/guide) follows the sidebar: every menu screen has a section, every
// section belongs to a menu screen, every text exists in both languages, and every
// link - buttons and [label](/path) inside the text - lands on a real route.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NAV_GROUPS } from "../lib/nav";
import { GUIDE_SECTIONS } from "../app/(dashboard)/guide/guide-content";
import {
  allTexts,
  anchorFor,
  buildGuide,
  NO_SECTION_NEEDED,
  parseInline,
  sectionHrefs,
  START,
} from "../app/(dashboard)/guide/guide-model";

const APP = path.join(__dirname, "..", "app");
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error("FAIL", msg);
};

// --- parseInline ----------------------------------------------------------
assert.deepEqual(parseInline("Open [Events](/events) now"), [
  { text: "Open " },
  { text: "Events", href: "/events" },
  { text: " now" },
]);
assert.deepEqual(parseInline("no links"), [{ text: "no links" }]);
assert.deepEqual(parseInline("[a](/x?tab=y#z)"), [{ text: "a", href: "/x?tab=y#z" }]);
// Only site paths and https - never javascript: or a bare word.
assert.deepEqual(parseInline("[x](javascript:alert(1))"), [{ text: "[x](javascript:alert(1))" }]);

// --- every menu screen has a section, every section has a screen ------------
const topHrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
const navs = new Set([START, ...topHrefs]);
for (const s of GUIDE_SECTIONS) {
  if (!navs.has(s.nav)) fail(`section "${s.id}" names nav "${s.nav}", which is not a sidebar screen`);
}
for (const group of buildGuide(GUIDE_SECTIONS, true)) {
  for (const item of group.items) {
    if (item.sections.length === 0 && !NO_SECTION_NEEDED.has(item.href)) {
      fail(`sidebar screen ${item.href} has no guide section`);
    }
  }
}

// --- ids are unique and never collide with a screen's anchor ----------------
const ids = GUIDE_SECTIONS.map((s) => s.id);
for (const id of new Set(ids)) {
  if (ids.indexOf(id) !== ids.lastIndexOf(id)) fail(`duplicate section id "${id}"`);
}
const anchors = new Set([START, ...topHrefs].map(anchorFor));
for (const id of ids) if (anchors.has(id)) fail(`section id "${id}" collides with a screen anchor`);

// --- both languages everywhere --------------------------------------------
for (const s of GUIDE_SECTIONS) {
  for (const v of allTexts(s)) {
    if (!v.en.trim() || !v.he.trim()) {
      fail(`section "${s.id}" has an empty ${v.en.trim() ? "he" : "en"} text: ${v.en || v.he}`);
    }
  }
  for (const h of s.howTo ?? []) {
    if (h.steps.length === 0) fail(`section "${s.id}" recipe "${h.title.en}" has no steps`);
  }
}

// --- every link lands on a route -------------------------------------------
/** app/<route>/page.tsx, through route groups "(x)" and dynamic "[x]" folders. */
function routeExists(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (rest.length === 0) {
      if (fs.existsSync(path.join(dir, "page.tsx")) || fs.existsSync(path.join(dir, "page.ts"))) return true;
      return entries.some((e) => /^\(.*\)$/.test(e.name) && walk(path.join(dir, e.name), rest));
    }
    const [head, ...tail] = rest;
    return entries.some((e) => {
      if (e.name === head) return walk(path.join(dir, e.name), tail);
      if (/^\(.*\)$/.test(e.name)) return walk(path.join(dir, e.name), rest);
      if (/^\[\[?\.\.\./.test(e.name)) return true; // catch-all
      if (/^\[.*\]$/.test(e.name)) return walk(path.join(dir, e.name), tail);
      return false;
    });
  };
  return walk(APP, segments);
}

for (const s of GUIDE_SECTIONS) {
  for (const href of sectionHrefs(s)) {
    if (href.startsWith("https://")) continue;
    const pathname = href.split(/[?#]/)[0];
    if (!routeExists(pathname)) fail(`section "${s.id}" links to ${href} - no such route`);
  }
}

const recipes = GUIDE_SECTIONS.reduce((n, s) => n + (s.howTo?.length ?? 0), 0);
const links = GUIDE_SECTIONS.reduce((n, s) => n + sectionHrefs(s).length, 0);
if (failures) {
  console.error(`\n${failures} problem(s)`);
  process.exit(1);
}
console.log(
  `guide ok - ${GUIDE_SECTIONS.length} sections, ${recipes} recipes, ${links} links, every sidebar screen covered`,
);
