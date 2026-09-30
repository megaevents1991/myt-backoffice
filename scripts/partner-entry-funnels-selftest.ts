// Run: npx tsx scripts/partner-entry-funnels-selftest.ts
import assert from "node:assert/strict";
import {
  buildEntryFunnels,
  classifyEntry,
  entryCountsFromRows,
} from "../lib/partner-entry-funnels";

// Homepage.
assert.equal(classifyEntry("VISIT", "/"), "home");
assert.equal(classifyEntry("VISIT", null), "home");
assert.equal(classifyEntry("VISIT", ""), "home");

// Artist / team pages - the legacy routes AND their /c/ twins, which is where
// every partner link to an artist or a team has pointed since 2026-09-11.
assert.equal(classifyEntry("VISIT", "/artists/1NwKqRVxf5qFLqvGGgxz4H"), "artist");
assert.equal(classifyEntry("VISIT", "/football/real-madrid"), "artist");
assert.equal(classifyEntry("VISIT", "/c/music/artists/celine-dion"), "artist");
assert.equal(classifyEntry("VISIT", "/c/football/teams/liverpool"), "artist");
assert.equal(classifyEntry("VISIT", "/c/music/artists/oasis/"), "artist", "trailing slash");

// Category pages stay "other": the hubs themselves, genres, leagues, destinations.
assert.equal(classifyEntry("VISIT", "/c/music"), "other");
assert.equal(classifyEntry("VISIT", "/c/music/artists"), "other", "the artists hub is a list, not an artist");
assert.equal(classifyEntry("VISIT", "/c/football/teams"), "other");
assert.equal(classifyEntry("VISIT", "/c/music/genres/pop"), "other");
assert.equal(classifyEntry("VISIT", "/c/football/leagues/premier-league"), "other");
assert.equal(classifyEntry("VISIT", "/c/destinations/london"), "other");
assert.equal(classifyEntry("VISIT", "/blog/some-post"), "other");

// Order flow.
assert.equal(classifyEntry("VISIT", "/order/618"), "event");
assert.equal(classifyEntry("EVENT_SELECTED", "/c/music/artists/oasis"), "event", "a first row that is not a VISIT surfaced inside the flow");
assert.equal(classifyEntry(null, null), "event");

// The cards must add up: every user lands in exactly one entry.
const counts = entryCountsFromRows(
  [
    { user_id: "a", stage: "VISIT", path: "/" },
    { user_id: "b", stage: "VISIT", path: "/c/music/artists/oasis" },
    { user_id: "b", stage: "EVENT_SELECTED", path: null },
    { user_id: "c", stage: "VISIT", path: "/c/football/teams/liverpool" },
    { user_id: "d", stage: "VISIT", path: "/order/12" },
    { user_id: "e", stage: "VISIT", path: "/c/destinations/london" },
    { user_id: "b", stage: "VISIT", path: "/" },
  ],
  new Set(["b"]),
);
const funnels = buildEntryFunnels(counts, false);
assert.equal(funnels.home.totalVisitors, 1);
assert.equal(funnels.artist.totalVisitors, 2);
assert.equal(funnels.event.totalVisitors, 1);
assert.equal(funnels.otherVisitors, 1);
assert.equal(funnels.paidByEntry.artist, 1);
assert.equal(
  funnels.home.totalVisitors + funnels.artist.totalVisitors + funnels.event.totalVisitors + funnels.otherVisitors,
  5,
  "entries partition the users",
);
assert.equal(
  funnels.artist.byStage.find((s) => s.stage === "EVENT_SELECTED")?.visitors,
  1,
);

console.log("partner-entry-funnels selftest OK");
