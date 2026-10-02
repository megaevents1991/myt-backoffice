// Run: npx tsx scripts/guide-selftest.ts
// The guide (/guide) follows the sidebar of the active company's product types
// (Mega Events = events, Mega Family = tours). For EACH product type: every menu
// screen has a section, every section it reads belongs to one of its menu
// screens, every link - buttons and [label](/path) inside the text - lands on a
// real route that the company's menu covers, and the top bar's "Guide" button
// lands on a rendered screen. Plus: every text exists in both languages and
// section ids are unique.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PRODUCT_TYPES, NAV_GROUPS, navFor } from "../lib/nav";
import { guideLinkFor } from "../lib/guide-link";
import type { ProductType } from "../lib/company";
import { GUIDE_SECTIONS } from "../app/(dashboard)/guide/guide-content";
import {
  allTexts,
  anchorFor,
  buildGuide,
  NO_SECTION_NEEDED,
  parseInline,
  sectionHrefs,
  sectionsFor,
  START,
} from "../app/(dashboard)/guide/guide-model";

const APP = path.join(__dirname, "..", "app");
const PRODUCT_TYPES: ProductType[] = ["events", "tours"];
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

// --- the Mega Events guide is the one it always was ---------------------------
// Its menu is NAV_GROUPS, and "not known yet" means Mega Events.
assert.deepEqual(navFor(["events"]), NAV_GROUPS);
assert.deepEqual(navFor(), NAV_GROUPS);
assert.deepEqual(buildGuide(GUIDE_SECTIONS), buildGuide(GUIDE_SECTIONS, DEFAULT_PRODUCT_TYPES));

/** A menu's screens: top items with their sub-screens. */
const menuHrefs = (pt: ProductType) =>
  navFor([pt]).flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.items ?? []).map((s) => s.href)]));
const covers = (href: string, pathname: string) => pathname === href || pathname.startsWith(`${href}/`);
/** Real routes outside the dashboard menu that a company's guide may still link to. */
const OFF_MENU: Record<ProductType, string[]> = {
  events: ["/portal"], // the partner portal, explained on Partners
  tours: [],
};

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

const summary: string[] = [];
for (const pt of PRODUCT_TYPES) {
  const groups = navFor([pt]);
  const topHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const navs = new Set([START, ...topHrefs]);
  const screens = menuHrefs(pt);
  const read = sectionsFor(GUIDE_SECTIONS, [pt]);

  // --- every section this company reads belongs to one of its screens --------
  for (const s of read) {
    if (!navs.has(s.nav)) fail(`[${pt}] section "${s.id}" names nav "${s.nav}", which is not a sidebar screen of ${pt}`);
  }

  // --- every menu screen has a section, and so does "Start here" ------------
  for (const group of buildGuide(GUIDE_SECTIONS, [pt], true)) {
    for (const item of group.items) {
      if (item.sections.length === 0 && !NO_SECTION_NEEDED.has(item.href)) {
        fail(`[${pt}] sidebar screen ${item.href} has no guide section`);
      }
    }
  }
  if (!read.some((s) => s.nav === START)) fail(`[${pt}] the guide has no "Start here" section`);

  // --- section ids never collide with a screen's anchor ---------------------
  const anchors = new Set([START, ...topHrefs].map(anchorFor));
  for (const s of read) if (anchors.has(s.id)) fail(`[${pt}] section id "${s.id}" collides with a screen anchor`);

  // --- the top bar's "Guide" button lands on a rendered screen ----------------
  const rendered = new Set(buildGuide(GUIDE_SECTIONS, [pt]).flatMap((g) => g.items.map((i) => i.anchor)));
  for (const href of screens) {
    if (NO_SECTION_NEEDED.has(href)) continue;
    const link = guideLinkFor(href, [pt]);
    const anchor = link.split("#")[1];
    if (!anchor || !rendered.has(anchor)) fail(`[${pt}] Guide button on ${href} -> ${link}, which the guide does not render`);
  }

  // --- every link lands on a route this company's menu covers -----------------
  // A tours section must not send a Mega Family reader to /events (and a shared
  // section must hold in every company).
  let links = 0;
  for (const s of read) {
    for (const href of sectionHrefs(s)) {
      links++;
      if (href.startsWith("https://")) continue;
      const pathname = href.split(/[?#]/)[0];
      if (!routeExists(pathname)) fail(`[${pt}] section "${s.id}" links to ${href} - no such route`);
      else if (![...screens, ...OFF_MENU[pt]].some((screen) => covers(screen, pathname))) {
        fail(`[${pt}] section "${s.id}" links to ${href}, which is not under any ${pt} menu screen`);
      }
    }
  }

  const recipes = read.reduce((n, s) => n + (s.howTo?.length ?? 0), 0);
  summary.push(`${pt}: ${read.length} sections, ${recipes} recipes, ${links} links, ${screens.length} menu screens covered`);
}

// --- the Guide button, both companies -------------------------------------------
assert.equal(guideLinkFor("/events/123", ["events"]), "/guide#nav-events");
assert.equal(guideLinkFor("/events/123"), "/guide#nav-events"); // unknown company = Mega Events
assert.equal(guideLinkFor("/templates/categories/4/edit", ["events"]), "/guide#nav-templates-categories");
assert.equal(guideLinkFor("/templates/artists", ["events"]), "/guide#nav-templates");
assert.equal(guideLinkFor("/live-events", ["events"]), "/guide#nav-sports-events");
assert.equal(guideLinkFor("/eventsX", ["events"]), "/guide");
assert.equal(guideLinkFor("/", ["events"]), "/guide");
assert.equal(guideLinkFor("/tours/packages", ["events"]), "/guide");
assert.equal(guideLinkFor("/tours", ["tours"]), "/guide#nav-tours");
assert.equal(guideLinkFor("/tours/packages/new", ["tours"]), "/guide#nav-tours-packages");
assert.equal(guideLinkFor("/tours/packages/abc-123", ["tours"]), "/guide#nav-tours-packages");
assert.equal(guideLinkFor("/tours/series", ["tours"]), "/guide#nav-tours"); // off-menu tours screen -> its dashboard
assert.equal(guideLinkFor("/offline-flights/42", ["tours"]), "/guide#nav-offline-flights");
assert.equal(guideLinkFor("/tasks", ["tours"]), "/guide#nav-tasks");
assert.equal(guideLinkFor("/events/123", ["tours"]), "/guide");

// --- ids are unique across every company ------------------------------------
const ids = GUIDE_SECTIONS.map((s) => s.id);
for (const id of new Set(ids)) {
  if (ids.indexOf(id) !== ids.lastIndexOf(id)) fail(`duplicate section id "${id}"`);
}

// --- every section is for a known product type (or shared) -------------------
for (const s of GUIDE_SECTIONS) {
  if (s.productType && !PRODUCT_TYPES.includes(s.productType)) fail(`section "${s.id}" has unknown productType "${s.productType}"`);
}

// --- Mega Family starts with how to create a tour ----------------------------
const toursStart = sectionsFor(GUIDE_SECTIONS, ["tours"]).filter((s) => s.nav === START);
if (toursStart[0]?.id !== "create-tour") fail(`the tours guide must start with "create-tour", not "${toursStart[0]?.id}"`);

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

if (failures) {
  console.error(`\n${failures} problem(s)`);
  process.exit(1);
}
console.log(`guide ok - ${GUIDE_SECTIONS.length} sections; ${summary.join("; ")}; every sidebar screen covered`);
