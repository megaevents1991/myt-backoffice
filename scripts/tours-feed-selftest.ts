// Self-test for the tours companies' Meta feed (lib/feed/activities-csv.ts, lib/feed/tours-feed.ts, lib/creative/tours.ts,
// lib/creative/worlds.ts + components/creative/WorldCoverTemplate.tsx).
// Pure helpers only: no DB, no Storage, no network.
//   npx tsx scripts/tours-feed-selftest.ts
import assert from "node:assert/strict";
import { ACTIVITIES_HEADERS, csvCell, toActivitiesCsv } from "../lib/feed/activities-csv";
import { parseToursReport, toursActivityRows, type ToursReport, type ToursReportItem } from "../lib/feed/tours-feed";
import { tourCreativeFile, tourCreativeHash, tourCreativeInput } from "../lib/creative/tours";
import { worldCoverFile, worldCoverHash, worldCoverInput, worldCoverStablePath, worldFileKey } from "../lib/creative/worlds";
import { FOCUS_X, PORTRAIT_FILL, coverBox, toursLine } from "../components/creative/WorldCoverTemplate";
import { fitBox, isPrivateAddress, logoSize } from "../lib/creative/logo";

const item = (over: Partial<ToursReportItem> = {}): ToursReportItem => ({
  id: "mf-115",
  title: "פאטה מורגנה | 5 ימים",
  description: 'דובאי, אבו דאבי "עם קפיצה"\nומלון',
  price: "1555.00 USD",
  priceValue: 1555,
  currency: "USD",
  priceRegularValue: 1595,
  link: "https://mega-family.vercel.app/package/%D7%A4/",
  image: "https://mega-family.vercel.app/media/a.png",
  gallery: ["https://mega-family.vercel.app/media/a.png", "https://mega-family.vercel.app/media/b.png"],
  activity_category: "Other",
  performers: "",
  location_names: "איחוד האמירויות",
  activity_sub_categories: "משפחות קלאסי",
  activity_date: "2026-12-07",
  labels: ["family", "איחוד-האמירויות", "משפחות-קלאסי", "חנוכה", "sale"],
  slug: "פאטה-מורגנה",
  name: "פאטה מורגנה",
  places: "דובאי עם קפיצה לאבו דאבי",
  dateText: "7.12 - 11.12",
  datesCount: 1,
  priceText: "1,555$",
  priceRegularText: "1,595$",
  priceNote: "לפי זוג + ילד",
  includesText: "מלווה ישראלי · אטרקציות · טיסה ומלון",
  color: "#0059AA",
  colorDeep: "#ED1C24",
  world: "מגה פמילי",
  onSale: true,
  ...over,
});
const report = (items: ToursReportItem[], skipped: ToursReport["skipped"] = []): ToursReport => ({
  generatedAt: "2026-11-08T12:00:00.000Z",
  siteBuiltAt: null,
  live: true,
  origin: "https://mega-family.vercel.app",
  logo: "https://mega-family.vercel.app/media/2025/12/megatr-logo.png",
  items,
  skipped,
  worlds: [],
});

/* the CSV: Mega Events' verified bytes - header, column order, CRLF, no BOM */
const csv = toActivitiesCsv(toursActivityRows(report([item()]), "מגה תיירות", () => null));
assert.ok(!csv.startsWith("﻿"), "no BOM");
assert.equal(csv.split("\r\n")[0], ACTIVITIES_HEADERS.join(","));
assert.equal(
  ACTIVITIES_HEADERS.join(","),
  "id,image_link,brand,description,title,price,link,rating_count,user_rating,activity_category,performers,location_names,activity_sub_categories,activity_date,custom_label_0,custom_label_1,custom_label_2,custom_label_3,custom_label_4",
);
assert.ok(csv.endsWith("\r\n"), "ends with CRLF");
/* a description with a comma, quotes and a new line stays one cell */
assert.equal(csvCell('a, "b"\nc'), '"a, ""b""\nc"');
assert.ok(csv.includes('"דובאי, אבו דאבי ""עם קפיצה""\nומלון"'));
/* ratings are zeros, never invented */
const [row] = toursActivityRows(report([item()]), "מגה תיירות", () => null);
assert.equal(row.rating_count, 0);
assert.equal(row.user_rating, 0);
assert.equal(row.brand, "מגה תיירות");
assert.equal(row.custom_label_4, "sale");

/* the picture: the branded one when drawn, the tour's photo while it is not */
assert.equal(row.image_link, "https://mega-family.vercel.app/media/a.png");
const [branded] = toursActivityRows(report([item()]), "מגה תיירות", () => ({ square: "https://x/sq.png", banner: "https://x/bn.png" }));
assert.equal(branded.image_link, "https://x/sq.png");

/* a broken report never becomes a file */
assert.throws(() => parseToursReport(null));
assert.throws(() => parseToursReport({ items: "x", skipped: [] }));
assert.throws(() => parseToursReport(report([])), /no tour at all/);
assert.throws(() => parseToursReport(report([item({ id: "115" })])), /without id/);
/* every tour left out never empties the catalog: the previous file stays */
assert.throws(() => parseToursReport(report([], [{ id: "mf-1", name: "x", slug: "x", reason: "no-price", why: { missing: "", fix: "", actionable: true } }])), /previous feed stays/);

/* the picture's hash: what it draws, nothing else */
const logo = "https://mega-family.vercel.app/media/2025/12/megatr-logo.png";
const h = (it: ToursReportItem) => tourCreativeHash(tourCreativeInput(it, logo));
const base = h(item());
assert.notEqual(h(item({ priceText: "1,500$" })), base, "price");
assert.notEqual(h(item({ dateText: "8.12 - 12.12" })), base, "date");
assert.notEqual(h(item({ name: "פאטה מורגנה 2" })), base, "name");
assert.notEqual(h(item({ image: "https://mega-family.vercel.app/media/c.png" })), base, "photo");
assert.notEqual(h(item({ priceNote: "לפי זוג בחדר כפול" })), base, "price note");
assert.equal(h(item({ gallery: [] })), base, "the gallery is not drawn");
assert.equal(h(item({ description: "אחר" })), base, "the description is not drawn");
assert.equal(h(item({ link: "https://elsewhere/" })), base, "the link is not drawn");
assert.match(base, /^[0-9a-f]{12}$/);
assert.equal(tourCreativeFile("mf-115", base, "square"), `tour-mf-115-${base}-square.png`);

/* a world's logo: measured from its bytes (PNG, JPEG, SVG), drawn into a box with its proportions */
const png = new Uint8Array(33);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200, 0, 0, 0, 55]);
assert.deepEqual(logoSize(png), { format: "png", width: 200, height: 55 });
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 173, 1, 53, 3, 0, 0, 0, 0]);
assert.deepEqual(logoSize(jpeg), { format: "jpeg", width: 309, height: 173 });
const svg = (root: string) => new TextEncoder().encode(`<?xml version="1.0"?>${root}<path d="M0 0"/></svg>`);
assert.deepEqual(logoSize(svg('<svg width="297" height="43" viewBox="0 0 297 43" xmlns="http://www.w3.org/2000/svg">')), { format: "svg", width: 297, height: 43 });
assert.deepEqual(logoSize(svg('<svg viewBox="0 0 174 25" fill="none">')), { format: "svg", width: 174, height: 25 });
assert.equal(logoSize(new TextEncoder().encode("RIFF....WEBPVP8 ")), null, "a WebP is not drawn");
assert.deepEqual(fitBox({ width: 309, height: 173 }, 440, 190), { width: 339, height: 190 });
assert.deepEqual(fitBox({ width: 297, height: 43 }, 440, 190), { width: 440, height: 64 });
/* the world's logo is part of what a picture draws */
assert.notEqual(h(item({ worldLogo: "https://mega-family.vercel.app/brand/mega-family-logo.jpg" })), base, "world logo");

/* the worlds (Dor 09.11.2026): a report without them still parses; a world without a key or an https picture is dropped */
const withWorlds = parseToursReport({
  ...report([item()]),
  worlds: [
    { key: "family", name: "משפחות", brandName: "מגה פמילי", image: "https://x.supabase.co/terms/a.jpg", logo: "https://x/l.jpg", color: "#0059AA", colorDeep: "#0059AA", link: "https://s/a/", tours: 17 },
    { key: "", name: "x", image: "https://x/a.jpg" },
    { key: "ladies", name: "נשים", brandName: "מגה ליידיס", image: "/media/l.jpg", tours: 0 },
    { key: "concept", name: "קונספט", brandName: "מגה קונספט", image: "https://x/c.jpg", tours: "3" },
  ],
});
assert.deepEqual(withWorlds.worlds.map((w) => w.key), ["family", "concept"]);
assert.equal(withWorlds.worlds[1].tours, 0, "a count that is not a number is 0");
const { worlds: _none, ...older } = report([item()]);
assert.deepEqual(parseToursReport(older).worlds, [], "a site that does not list worlds");
/* a tour with its world's picture says so; the CSV takes it like any photo */
const [fromWorld] = toursActivityRows(report([item({ imageFrom: "world", image: "https://x.supabase.co/terms/a.jpg" })]), "מגה תיירות", () => null);
assert.equal(fromWorld.image_link, "https://x.supabase.co/terms/a.jpg");

/* a world's cover: its hash follows what it draws, its files carry a safe key */
const family = withWorlds.worlds[0];
const ch = (over: Partial<typeof family> = {}) => worldCoverHash(worldCoverInput({ ...family, ...over }, logo));
const cbase = ch();
assert.notEqual(ch({ image: "https://x.supabase.co/terms/b.jpg" }), cbase, "a new hero picture draws a new cover");
assert.notEqual(ch({ tours: 18 }), cbase, "the count of tours is drawn");
assert.notEqual(ch({ name: "משפחות!" }), cbase, "the name is drawn");
assert.equal(ch({ link: "https://elsewhere/" }), cbase, "the link is not drawn");
assert.equal(worldCoverFile("family", cbase, "banner"), `world-family-${cbase}-banner.png`);
assert.equal(worldFileKey("Mega Ladies/../x"), "mega-ladies-x");
assert.equal(worldFileKey("משפחות"), "world", "a key with no latin letters still makes a file name");
assert.equal(worldCoverStablePath("mega-family", "events", "square"), "feeds/mega-family/world-events-square.png");
/* the crop keeps the people in the left third: a 16:9 picture in a 4:5 frame is centred at FOCUS_X, never past an edge */
const box = coverBox({ width: 1600, height: 900 }, 1080, 1350);
assert.deepEqual([box.width, box.height, box.top], [2400, 1350, 0]);
assert.equal(box.left, Math.round(540 - 2400 * FOCUS_X));
assert.ok(box.left <= 0 && box.left + box.width >= 1080);
/* the 4:5 cover's picture fills the top 90%: half the width of a 16:9 picture shows - a family of four spanning
   7%-53% of it (the families world, 09.11) stays whole */
const tall = coverBox({ width: 1600, height: 900 }, 1080, 1350, PORTRAIT_FILL);
assert.deepEqual([tall.width, tall.height, tall.top], [2160, 1215, 0]);
const shown = [-tall.left / tall.width, (1080 - tall.left) / tall.width];
assert.ok(shown[0] <= 0.07 && shown[1] >= 0.53, `shows ${shown.map((x) => x.toFixed(3)).join("-")}`);
assert.equal(coverBox({ width: 1600, height: 900 }, 1200, 628).left, 0, "a wide frame keeps the picture's left edge");
assert.equal(coverBox({ width: 100, height: 1000 }, 1080, 1350).left, 0);
assert.equal(toursLine(17), "17 טיולים");
assert.equal(toursLine(1), "טיול אחד");
assert.equal(toursLine(0), "");

/* a logo is never fetched from an internal address */
for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
for (const ip of ["76.76.21.21", "172.15.0.1", "172.32.0.1", "8.8.8.8", "2606:4700::6810:84e5"]) assert.ok(!isPrivateAddress(ip), ip);
console.log("tours-feed selftest passed");
