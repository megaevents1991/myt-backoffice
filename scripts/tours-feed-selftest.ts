// Self-test for the tours companies' Meta feed (lib/feed/activities-csv.ts, lib/feed/tours-feed.ts, lib/creative/tours.ts).
// Pure helpers only: no DB, no Storage, no network.
//   npx tsx scripts/tours-feed-selftest.ts
import assert from "node:assert/strict";
import { ACTIVITIES_HEADERS, csvCell, toActivitiesCsv } from "../lib/feed/activities-csv";
import { parseToursReport, toursActivityRows, type ToursReport, type ToursReportItem } from "../lib/feed/tours-feed";
import { tourCreativeFile, tourCreativeHash, tourCreativeInput } from "../lib/creative/tours";
import { fitBox, logoSize } from "../lib/creative/logo";

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

console.log("tours-feed selftest passed");
