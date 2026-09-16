// scripts/category-twins-selftest.ts - `npx tsx scripts/category-twins-selftest.ts`
// Pure only: the team/artist <-> category name-matching rule, fed synthetic rows.
import { findTwin, findCategoryTwin, namesMatch } from "../lib/services/category-twins";

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

const hubs = [
  { id: 1, slug: "teams" },
  { id: 2, slug: "artists" },
];
const teams = [{ id: 10, name: "ליברפול", name_english: "Liverpool" }];
const artists = [{ id: 20, name: "קולדפליי", name_english: "Coldplay" }];

// --- findTwin (category -> person) ---

check(
  "team twin by English name",
  findTwin({ id: 100, parent_id: 1, name: "ליברפול", name_english: "Liverpool" }, hubs, teams, artists),
  { kind: "team", id: 10, name: "ליברפול" },
);

check(
  "artist twin by Hebrew name",
  findTwin({ id: 101, parent_id: 2, name: "קולדפליי", name_english: null }, hubs, teams, artists),
  { kind: "artist", id: 20, name: "קולדפליי" },
);

check(
  "case and whitespace insensitive",
  findTwin({ id: 102, parent_id: 1, name: "  ", name_english: "  LIVERPOOL  " }, hubs, teams, artists),
  { kind: "team", id: 10, name: "ליברפול" },
);

check(
  "wrong parent -> null (a Barcelona category under the wrong hub)",
  findTwin({ id: 103, parent_id: 2, name: "ליברפול", name_english: "Liverpool" }, hubs, teams, artists),
  null,
);

check(
  "no match -> null",
  findTwin({ id: 104, parent_id: 1, name: "ארסנל", name_english: "Arsenal" }, hubs, teams, artists),
  null,
);

check("null parent -> null", findTwin({ id: 105, parent_id: null, name: "ליברפול", name_english: "Liverpool" }, hubs, teams, artists), null);

check(
  "missing hub -> null",
  findTwin({ id: 106, parent_id: 1, name: "ליברפול", name_english: "Liverpool" }, [], teams, artists),
  null,
);

// --- fix round 1 (2026-09-16): a matched person with no English name is NOT
// a twin - main's render gate (app/c/[...slug]/page.tsx) needs BOTH name AND
// nameDBenglish non-empty to show TeamCmsPage/ArtistCmsPage; short of that it
// falls back to the generic category page. ---

const teamsNoEnglish = [{ id: 11, name: "צ'לסי", name_english: "" }];
const teamsNullEnglish = [{ id: 12, name: "פולהאם", name_english: null }];

check(
  "matched by Hebrew name but person has empty English name -> null",
  findTwin({ id: 107, parent_id: 1, name: "צ'לסי", name_english: null }, hubs, teamsNoEnglish, artists),
  null,
);

check(
  "matched by Hebrew name but person has null English name -> null",
  findTwin({ id: 108, parent_id: 1, name: "פולהאם", name_english: null }, hubs, teamsNullEnglish, artists),
  null,
);

// --- findCategoryTwin (person -> category), the direction portal-site-pages-actions.ts uses ---

const categories = [
  { id: 100, parent_id: 1, name: "ליברפול", name_english: "Liverpool" },
  { id: 101, parent_id: 2, name: "קולדפליי", name_english: null },
];

check(
  "person -> category twin",
  findCategoryTwin({ id: 10, name: "ליברפול", name_english: "Liverpool" }, 1, categories),
  categories[0],
);

check(
  "person -> category, undefined hub -> null",
  findCategoryTwin({ id: 10, name: "ליברפול", name_english: "Liverpool" }, undefined, categories),
  null,
);

check(
  "person -> category, person has no English name -> null (render gate)",
  findCategoryTwin({ id: 10, name: "ליברפול", name_english: null }, 1, categories),
  null,
);

// --- namesMatch, the shared primitive ---

check("namesMatch symmetric English", namesMatch({ name: "x", name_english: "Coldplay" }, { name: "קולדפליי", name_english: "Coldplay" }), true);
check("namesMatch no match", namesMatch({ name: "x", name_english: "y" }, { name: "z", name_english: "w" }), false);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
