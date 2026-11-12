// Feed videos - the pure rules (lib/feed-video/). No DB, no network, no browser.
//   npx tsx scripts/feed-video-selftest.ts
import assert from "node:assert/strict";
import { creativeTagline } from "@/components/creative/MatchTemplate";
import {
  drawStyle, holdProblems, isSystemVideoUrl, keepOrDrawStyle, lineProblem, stylesFor, videoFileName, videoHash,
  type PrintedVideo,
} from "@/lib/feed-video/rules";

const S = "https://fandqafngybfdyslofmr.supabase.co/storage/v1/object/public";
let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`); };

t("stylesFor: A needs a cut-out, B a cut-out + 3 photos, C a photo - always A, B, C order", () => {
  assert.deepEqual(stylesFor({ cutout: "x", photos: ["1", "2", "3"] }), ["A", "B", "C"]);
  assert.deepEqual(stylesFor({ cutout: "x", photos: ["1"] }), ["A", "C"]);
  assert.deepEqual(stylesFor({ cutout: "x", photos: [] }), ["A"]);
  assert.deepEqual(stylesFor({ cutout: null, photos: ["1", "2", "3"] }), ["C"]);
  assert.deepEqual(stylesFor({ cutout: null, photos: [] }), []);
});

t("drawStyle: the hand tool's draw of 11.11 (1175 drew C, U2's only style is A)", () => {
  assert.equal(drawStyle(1175, ["A", "B", "C"]), "C");
  assert.equal(drawStyle(1313, ["A"]), "A");
});

t("keepOrDrawStyle: a stored style stays while carried, else the event draws again", () => {
  assert.equal(keepOrDrawStyle("A", 1175, ["A", "B", "C"]), "A");
  assert.equal(keepOrDrawStyle("B", 1175, ["A", "C"]), drawStyle(1175, ["A", "C"]));
  assert.equal(keepOrDrawStyle(null, 1175, ["A", "B", "C"]), "C");
});

t("videoHash: 1175's live video (12.11) keeps its file name", () => {
  const printed: PrintedVideo = {
    style: "C",
    name: "אואזיס",
    place: "מנצ'סטר",
    date: "06.06.2027",
    priceText: "ממוצע לנוסע $1,935",
    tagline: creativeTagline(false),
    cta: "טיסה + מלון + כרטיס",
    cutout: `${S}/templates/shutterstock_2841971393-cutout-1790028812333.png`,
    photos: [`${S}/card_images/oasis%202.jpeg`, `${S}/card_images/oasis%201.jpeg`, `${S}/templates/oasis.jpg`],
    cutoutInC: true,
  };
  const hash = videoHash(printed, "גשם בחוץ, אש בפנים");
  assert.equal(hash, "e51c3b6a45");
  assert.equal(videoFileName(1175, "C", hash), "event-1175-C-e51c3b6a45.mp4");
  assert.notEqual(videoHash({ ...printed, priceText: "ממוצע לנוסע $1,936" }, "גשם בחוץ, אש בפנים"), hash);
});

t("isSystemVideoUrl: ours only - a hand-uploaded video is never ours", () => {
  assert.equal(isSystemVideoUrl(`${S}/public_resources/creatives/video/event-1-A-x.mp4`), true);
  assert.equal(isSystemVideoUrl(`${S}/campaign_videos/1700000000-promo.mp4`), false);
  assert.equal(isSystemVideoUrl(null), false);
  assert.equal(isSystemVideoUrl("not a url"), false);
});

t("holdProblems: price drift from the feed, a travel-note place, no place, another artist", () => {
  const ok = { expectedName: "אואזיס", eventArtistName: "אואזיס", kind: "artist", sitePrice: 1935, feedPrice: 1935, place: "מנצ'סטר" };
  assert.deepEqual(holdProblems(ok), []);
  assert.equal(holdProblems({ ...ok, sitePrice: 1936 }).length, 1);
  assert.equal(holdProblems({ ...ok, sitePrice: null }).length, 1);
  assert.equal(holdProblems({ ...ok, place: "נבוורת טיסה ללונדון . בריטניה" }).length, 1);
  assert.equal(holdProblems({ ...ok, place: "" }).length, 1);
  assert.equal(holdProblems({ ...ok, eventArtistName: "יו 2" }).length, 1);
  assert.equal(holdProblems({ ...ok, kind: "match" }).length, 1);
});

t("lineProblem: the line rules", () => {
  assert.equal(lineProblem("גשם בחוץ, אש בפנים", []), null);
  assert.equal(lineProblem("מנצ'סטר מרעידה את האדמה", []), null); // a geresh is part of the city
  assert.notEqual(lineProblem("2 לילות בפריז הקסומה", []), null);
  assert.notEqual(lineProblem("בירה קרה מול הבמה", []), null);
  assert.notEqual(lineProblem("אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע", []), null);
  assert.notEqual(lineProblem("שרים \"יחד\" עד הסוף", []), null);
  assert.notEqual(lineProblem("גשם בחוץ, אש בפנים", ["גשם בחוץ, אש בפנים"]), null);
  assert.notEqual(lineProblem("only english words here", []), null);
});

console.log(`\n${n} passed`);
