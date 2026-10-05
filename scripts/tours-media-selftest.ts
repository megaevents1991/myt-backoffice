// scripts/tours-media-selftest.ts - `npx tsx scripts/tours-media-selftest.ts`
// Pure only: the rules of a tours site-media upload (lib/tours/media.ts) - the
// stored path, the accepted types and the "will not show on the site" hint.
// No DB, no network.
import {
  TOUR_MEDIA_ACCEPT,
  isTourMediaType,
  mediaFileStem,
  siteImageWarning,
  tourMediaBucket,
  tourMediaPath,
  walkTourMedia,
  type MediaListEntry,
} from "../lib/tours/media";

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

// ---- bucket + types
check("bucket per company", tourMediaBucket("mega-family"), "media-mega-family");
check("jpeg accepted", isTourMediaType("image/jpeg"), true);
check("avif accepted", isTourMediaType("image/avif"), true);
check("svg refused (can carry script)", isTourMediaType("image/svg+xml"), false);
check("pdf refused", isTourMediaType("application/pdf"), false);
check("no prototype keys", isTourMediaType("constructor"), false);
check("accept attribute lists the five types", TOUR_MEDIA_ACCEPT.split(",").length, 5);

// ---- file names
check("ascii name kept, lowercased", mediaFileStem("Hotel Lobby.JPG"), "hotel-lobby");
check("hebrew name falls back", mediaFileStem("תמונה של המלון.jpg"), "image");
check("mixed name keeps the ascii part", mediaFileStem("מלון Riu 2026.png"), "riu-2026");
check("accents folded", mediaFileStem("Café Crème.webp"), "cafe-creme");
check("path characters stripped", mediaFileStem("../../etc/passwd.png"), "etc-passwd");
check("no extension", mediaFileStem("photo"), "photo");
check("WordPress size suffix dropped (the site strips it)", mediaFileStem("Lobby-1024x683.jpg"), "lobby");
check("a size alone keeps a name", mediaFileStem("1024x683.jpg"), "1024x683");
check("dot file", mediaFileStem(".png"), "image");
check("long name capped at 60", mediaFileStem(`${"a".repeat(80)}.jpg`).length, 60);
check("cap never ends on a dash", mediaFileStem(`${"a".repeat(59)} b.jpg`), "a".repeat(59));

// ---- paths
const now = new Date("2026-10-02T09:30:00Z");
check(
  "folder/yyyy/mm/random-name.ext",
  tourMediaPath({ folder: "hotels", fileName: "Lobby.jpeg", contentType: "image/jpeg", now, random: "a1b2c3d4" }),
  "hotels/2026/10/a1b2c3d4-lobby.jpg",
);
check(
  "extension follows the checked type, not the name",
  tourMediaPath({ folder: "packages", fileName: "hero.png", contentType: "image/webp", now, random: "00ff00ff" }),
  "packages/2026/10/00ff00ff-hero.webp",
);
check(
  "month is padded, in UTC",
  tourMediaPath({ folder: "general", fileName: "x.gif", contentType: "image/gif", now: new Date("2027-01-31T23:59:00Z"), random: "deadbeef" }),
  "general/2027/01/deadbeef-x.gif",
);

// ---- site hint
const HOST = "proj.supabase.co";
check("empty value: no hint", siteImageWarning("", HOST), null);
check("site path: no hint", siteImageWarning("/media/2026/07/a.jpg", HOST), null);
check("public storage: no hint", siteImageWarning(`https://${HOST}/storage/v1/object/public/media-mega-family/a.jpg`, HOST), null);
check(
  "signed storage link: hint",
  siteImageWarning(`https://${HOST}/storage/v1/object/sign/media-mega-family/a.jpg?token=x`, HOST),
  "Only a public Storage link shows on the site. This one is private or expires.",
);
check("old WordPress host: no hint", siteImageWarning("https://newsite.megatr.co.il/wp-content/uploads/a.jpg", HOST), null);
check(
  "other host: hint",
  siteImageWarning("https://images.example.com/a.jpg", HOST),
  "This host will not show on the site. Upload the file instead, or use a /media/... path.",
);
check(
  "another Supabase project: hint",
  siteImageWarning("https://other.supabase.co/storage/v1/object/public/x/a.jpg", HOST),
  "This host will not show on the site. Upload the file instead, or use a /media/... path.",
);
check("unknown storage host still hints", siteImageWarning(`https://${HOST}/storage/v1/object/public/a.jpg`, null) !== null, true);
check("broken URL", siteImageWarning("https://", HOST), "This is not a valid address.");

// ---- the media library walk: <folder>/<yyyy>/<mm>/<file>, one level per listing
const dir = (name: string): MediaListEntry => ({ name, id: null });
const file = (name: string, created: string, size: number): MediaListEntry => ({ name, id: `id-${name}`, created_at: created, metadata: { size } });
const TREE: Record<string, MediaListEntry[]> = {
  packages: [dir("2026")],
  "packages/2026": [dir("10"), dir("09"), file("stray.png", "2026-10-01T00:00:00Z", 1)],
  "packages/2026/10": [file("aa-new.jpg", "2026-10-05T10:00:00Z", 2048), file("bb-same-time.jpg", "2026-10-05T10:00:00Z", 10)],
  "packages/2026/09": [file("cc-old.webp", "2026-09-01T08:00:00Z", 500)],
  general: [dir("2026")],
  "general/2026": [dir("10")],
  "general/2026/10": [file("dd-newest.png", "2026-10-05T12:00:00Z", 77), dir(".emptyFolderPlaceholder")],
};
const listed: string[] = [];
const fakeList = async (prefix: string) => {
  listed.push(prefix);
  return TREE[prefix] ?? [];
};

void (async () => {
  const walked = await walkTourMedia(fakeList, (path) => `https://cdn.test/${path}`);
  check("walk: every picture, newest first, a tie broken by path", walked.map((f) => f.path), [
    "general/2026/10/dd-newest.png",
    "packages/2026/10/bb-same-time.jpg",
    "packages/2026/10/aa-new.jpg",
    "packages/2026/09/cc-old.webp",
  ]);
  check("walk: a file outside the year / month layout is left out", walked.some((f) => f.name === "stray.png"), false);
  check("walk: the address, the folder and the size of a picture", walked[0], {
    path: "general/2026/10/dd-newest.png",
    url: "https://cdn.test/general/2026/10/dd-newest.png",
    name: "dd-newest.png",
    folder: "general",
    size: 77,
    createdAt: "2026-10-05T12:00:00Z",
  });
  check("walk: an empty folder costs one listing and nothing else", listed.filter((p) => p.startsWith("hotels")), ["hotels"]);
  check("walk: an empty bucket answers an empty list", await walkTourMedia(async () => [], (path) => path), []);

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\nall passed");
})();
