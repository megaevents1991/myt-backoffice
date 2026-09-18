// scripts/homepage-blocks-selftest.ts - `npx tsx scripts/homepage-blocks-selftest.ts`
// Pure only: the rules every /homepage save goes through (titles, block keys,
// banner / slider config), fed synthetic rows. No DB, no network.
import {
  MAX_BLOCKS,
  TITLE_MAX,
  isBlockKey,
  itemKindsFor,
  newBlockKey,
  normalizeSections,
  normalizeTitle,
} from "../lib/homepage/blocks";
import { buildArtIndex, personArtFor } from "../lib/homepage/event-art";

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

const STORAGE = "https://proj.supabase.co/storage/v1/object/public/";
const opts = { storagePrefix: STORAGE };
const IMG = `${STORAGE}templates/banner.jpg`;

const builtin = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  type: "builtin",
  title: null,
  config: {},
  position: 0,
  is_visible: true,
  ...extra,
});
const slider = (key: string, config: unknown = { category_id: null }, extra: Record<string, unknown> = {}) => ({
  key,
  type: "event_slider",
  title: null,
  config,
  position: 0,
  is_visible: true,
  ...extra,
});
const banner = (key: string, banners: unknown, extra: Record<string, unknown> = {}) => ({
  key,
  type: "banner",
  title: null,
  config: { banners },
  position: 0,
  is_visible: true,
  ...extra,
});

const keysOf = (r: ReturnType<typeof normalizeSections>) =>
  r.ok ? r.sections.map((s) => s.key) : r.error;
const errorOf = (r: ReturnType<typeof normalizeSections>) => (r.ok ? null : r.error);

// --- titles ---

check("title is trimmed", normalizeTitle("  חם עכשיו  "), "חם עכשיו");
check("empty title is null", normalizeTitle("   "), null);
check("non-string title is null", normalizeTitle(42), null);
check("title is capped", normalizeTitle("x".repeat(TITLE_MAX + 20))?.length, TITLE_MAX);

// --- keys ---

check("a minted key is a block key", isBlockKey(newBlockKey()), true);
check("two minted keys differ", newBlockKey() === newBlockKey(), false);
check("a builtin key is not a block key", isBlockKey("newest"), false);
check("a long hex is not a block key", isBlockKey("blk_0123456789"), false);

// --- item kinds ---

check("builtin newest takes events", itemKindsFor({ key: "newest", type: "builtin" }), ["event"]);
check("builtin reviews takes nothing", itemKindsFor({ key: "reviews", type: "builtin" }), []);
check("an event slider takes events", itemKindsFor({ key: "blk_00000001", type: "event_slider" }), ["event"]);
check("a banner takes nothing", itemKindsFor({ key: "blk_00000001", type: "banner" }), []);

// --- order ---

check(
  "hero is forced first and missing builtins are appended",
  keysOf(normalizeSections([builtin("newest"), builtin("hero")], opts)),
  ["hero", "newest", "most_wanted", "football", "artists", "reviews", "more_events"],
);

check(
  "a block keeps the place the board gave it",
  keysOf(
    normalizeSections(
      [builtin("hero"), slider("blk_0000000a"), builtin("most_wanted")],
      opts,
    ),
  ).slice(0, 3),
  ["hero", "blk_0000000a", "most_wanted"],
);

check(
  "a duplicate key is dropped",
  (keysOf(normalizeSections([builtin("hero"), builtin("newest"), builtin("newest")], opts)) as string[]).filter(
    (k) => k === "newest",
  ).length,
  1,
);

{
  const r = normalizeSections([builtin("hero"), builtin("newest"), slider("blk_0000000a")], opts);
  check("positions are renumbered 0..n", r.ok ? r.sections.map((s) => s.position) : null, [0, 1, 2, 3, 4, 5, 6, 7]);
}

// --- rejected rows ---

check(
  "an unknown block type is rejected",
  errorOf(normalizeSections([builtin("hero"), { ...slider("blk_0000000a"), type: "iframe" }], opts)) !== null,
  true,
);
check(
  "a block wearing a builtin key is rejected",
  errorOf(normalizeSections([builtin("hero"), slider("newest")], opts)) !== null,
  true,
);
check(
  "a builtin type with an unknown key is rejected",
  errorOf(normalizeSections([builtin("hero"), builtin("blk_0000000a")], opts)) !== null,
  true,
);
check("a non-array payload is rejected", errorOf(normalizeSections("nope", opts)) !== null, true);

{
  const many = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) =>
    slider(`blk_${i.toString(16).padStart(8, "0")}`),
  );
  check("more than MAX_BLOCKS blocks is rejected", errorOf(normalizeSections(many, opts)) !== null, true);
  check(
    "exactly MAX_BLOCKS blocks is accepted",
    normalizeSections(many.slice(0, MAX_BLOCKS), opts).ok,
    true,
  );
}

// --- builtin rows ---

{
  const r = normalizeSections(
    [builtin("hero"), builtin("newest", { title: "  טרי מהתנור ", config: { category_id: 9 } })],
    opts,
  );
  const newest = r.ok ? r.sections.find((s) => s.key === "newest") : null;
  check("a builtin keeps its staff title", newest?.title, "טרי מהתנור");
  check("a builtin config is forced empty", newest?.config, {});
}

// --- event slider ---

const sliderConfig = (config: unknown) => {
  const r = normalizeSections([builtin("hero"), slider("blk_0000000a", config)], opts);
  return r.ok ? r.sections.find((s) => s.key === "blk_0000000a")?.config : r.error;
};
check("slider: null category", sliderConfig({ category_id: null }), { category_id: null });
check("slider: missing category reads as null", sliderConfig({}), { category_id: null });
check("slider: numeric string is coerced", sliderConfig({ category_id: "5" }), { category_id: 5 });
check("slider: extra keys are dropped", sliderConfig({ category_id: 7, evil: true }), { category_id: 7 });
for (const bad of [0, -1, 1.5, "abc"]) {
  check(
    `slider: category ${JSON.stringify(bad)} is rejected`,
    typeof sliderConfig({ category_id: bad }),
    "string",
  );
}

// --- banner ---

const bannerConfig = (banners: unknown) => {
  const r = normalizeSections([builtin("hero"), banner("blk_0000000b", banners)], opts);
  return r.ok ? r.sections.find((s) => s.key === "blk_0000000b")?.config : r.error;
};
check(
  "banner: a full row survives, trimmed",
  bannerConfig([{ image_url: IMG, link_url: " /c/music ", title: " קיץ 2027 " }]),
  { banners: [{ image_url: IMG, link_url: "/c/music", title: "קיץ 2027" }] },
);
check(
  "banner: empty link and title become null",
  bannerConfig([{ image_url: IMG, link_url: "", title: "" }]),
  { banners: [{ image_url: IMG, link_url: null, title: null }] },
);
check(
  "banner: https link is accepted",
  bannerConfig([{ image_url: IMG, link_url: "https://www.mega-events.co.il/c/x", title: null }]),
  { banners: [{ image_url: IMG, link_url: "https://www.mega-events.co.il/c/x", title: null }] },
);
for (const link of ["//evil.example", "javascript:alert(1)", "http://plain.example", "c/music"]) {
  check(
    `banner: link ${link} is rejected`,
    typeof bannerConfig([{ image_url: IMG, link_url: link, title: null }]),
    "string",
  );
}
check(
  "banner: an image from another host is rejected",
  typeof bannerConfig([{ image_url: "https://evil.example/x.jpg", link_url: null, title: null }]),
  "string",
);
check(
  "banner: a lookalike storage host is rejected",
  typeof bannerConfig([
    { image_url: "https://proj.supabase.co.evil.example/storage/v1/object/public/x.jpg", link_url: null, title: null },
  ]),
  "string",
);
check("banner: no banners is rejected", typeof bannerConfig([]), "string");
check(
  "banner: four banners is rejected",
  typeof bannerConfig(Array.from({ length: 4 }, () => ({ image_url: IMG, link_url: null, title: null }))),
  "string",
);
check("banner: banners must be a list", typeof bannerConfig("x"), "string");

{
  const r = normalizeSections(
    [builtin("hero"), banner("blk_0000000b", [], { title: "מבצעי הקיץ" })],
    opts,
  );
  check("an error names the block by its title", errorOf(r)?.includes("מבצעי הקיץ"), true);
}

{
  const r = normalizeSections([builtin("hero")], { storagePrefix: "" });
  check("no storage prefix configured still orders builtins", r.ok, true);
  const b = normalizeSections(
    [builtin("hero"), banner("blk_0000000b", [{ image_url: IMG, link_url: null, title: null }])],
    { storagePrefix: "" },
  );
  check("no storage prefix configured rejects every banner image", b.ok, false);
}

{
  const r = normalizeSections([builtin("hero"), banner("blk_0000000b", [])], opts);
  check("an untitled block is named by its type, not its key", errorOf(r)?.startsWith("באנרים:"), true);
  check("the internal key never reaches the message", errorOf(r)?.includes("blk_"), false);
}

// --- event art: an event with no image borrows its artist's / team's ---

const artIndex = buildArtIndex([
  { kind: "artist", name_english: "Sia", image_url: "sia.png" },
  { kind: "artist", name_english: "Celine Dion", image_url: "celine.png" },
  { kind: "artist", name_english: "No Picture", image_url: null },
  { kind: "artist", name_english: null, image_url: "nameless.png" },
  { kind: "team", name_english: "AC Milan", image_url: "milan.png" },
  { kind: "team", name_english: "Inter Milan", image_url: "inter.png" },
  { kind: "team", name_english: "Atletico Madrid", image_url: "atleti.png" },
  { kind: "team", name_english: "FC Barcelona", image_url: "barca.png" },
  { kind: "team", name_english: "Real Madrid CF", image_url: "real.png" },
]);

check("people without a name or a picture are left out", artIndex.length, 7);
check("an artist's event takes the artist's picture", personArtFor("Celine Dion Paris", artIndex), "celine.png");
check("matching ignores case and accents", personArtFor("CÉLINE DION - Paris", artIndex), "celine.png");
// The site's rule is a plain substring, longest name first - so "Sia" loses an
// "Asia" event only to a longer name that also matches. Same here, on purpose.
check(
  "the longest matching name wins",
  personArtFor(
    "Asia World Tour",
    buildArtIndex([
      { kind: "artist", name_english: "Sia", image_url: "sia.png" },
      { kind: "artist", name_english: "Asia", image_url: "asia.png" },
    ]),
  ),
  "asia.png",
);
check("nobody matches", personArtFor("Some Unknown Act", artIndex), null);
check("no name, no picture", personArtFor(null, artIndex), null);
check("a fixture takes the HOME team's picture", personArtFor("FC Barcelona vs Real Madrid CF", artIndex), "barca.png");
check("... whichever club has the longer name", personArtFor("Real Madrid CF vs FC Barcelona", artIndex), "real.png");
check("Inter Milan's game is not AC Milan's", personArtFor("Inter Milan vs Juventus", artIndex), "inter.png");
check(
  "a side spelled differently still finds its team",
  personArtFor("Atlético de Madrid vs Getafe", artIndex),
  "atleti.png",
);
check(
  "a competition prefix does not hide the home side",
  personArtFor("Champions League: AC Milan vs Liverpool", artIndex),
  "milan.png",
);
check(
  "an away team the index knows still yields the home team first",
  personArtFor("Getafe vs FC Barcelona", artIndex),
  "barca.png",
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
