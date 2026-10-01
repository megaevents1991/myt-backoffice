/**
 * Selftest for the pure rules of the Google-reviews mirror
 * (lib/services/google-reviews-sync.ts). No DB, no network:
 *   npx tsx scripts/google-reviews-selftest.ts
 */
import assert from "node:assert/strict";
import {
  FEED_QUIET_DAYS,
  MANUAL_MATCH_DAYS,
  STALE_FEED_MARK,
  adoptsManualRow,
  feedQuietWarning,
  mirrorSummary,
} from "../lib/services/google-reviews-sync";

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks += 1;
  console.log(`ok - ${name}`);
};

const fives = (n: number) => Array.from({ length: n }, () => 5);

check("the count is the mirror's rows when nothing higher is stored", () => {
  assert.deepEqual(mirrorSummary(fives(71), null), { rating: 5, reviewCount: 71 });
  assert.deepEqual(mirrorSummary(fives(71), 60), { rating: 5, reviewCount: 71 });
});

check("a stored count checked against Google is never lowered by a stale feed", () => {
  // 2026-10-01: 76 rows mirrored, Google's own page said 84.
  assert.equal(mirrorSummary(fives(76), 84).reviewCount, 84);
});

check("the rating is the mirror's average, one decimal", () => {
  assert.equal(mirrorSummary([...fives(75), 4], 84).rating, 5);
  assert.equal(mirrorSummary([5, 5, 4, 4], null).rating, 4.5);
  assert.equal(mirrorSummary([5, 4, 4], null).rating, 4.3);
});

check("an empty mirror knows nothing - the stored summary is left alone", () => {
  assert.deepEqual(mirrorSummary([], null), { rating: null, reviewCount: null });
  assert.deepEqual(mirrorSummary([], 84), { rating: null, reviewCount: 84 });
  assert.deepEqual(mirrorSummary([Number.NaN], null), { rating: null, reviewCount: null });
});

const now = new Date("2026-10-01T04:00:00Z");

check("a feed with a recent review is fresh", () => {
  assert.equal(feedQuietWarning("2026-09-28T10:00:00Z", now), null);
  const edge = new Date(now.getTime() - (FEED_QUIET_DAYS - 1) * 864e5).toISOString();
  assert.equal(feedQuietWarning(edge, now), null);
});

check("a feed whose newest review is weeks old is called out, with the date", () => {
  const warning = feedQuietWarning("2026-09-04T03:38:47Z", now);
  assert.ok(warning?.includes(STALE_FEED_MARK));
  assert.ok(warning?.includes("2026-09-04"));
  assert.ok(warning?.includes("27 days"));
});

check("no reviews at all, or an unreadable date, is not a staleness claim", () => {
  assert.equal(feedQuietWarning(null, now), null);
  assert.equal(feedQuietWarning("not a date", now), null);
});

// A hand-entered row (2026-10-01) and the same review arriving later with Google's id.
const manual = {
  review_key: "manual:0123456789abcdef",
  author_name: "Liron Altman",
  rating: 5,
  published_at: "2026-09-24T12:00:00Z", // "לפני שבוע"
};
const fromSource = { author_name: "Liron Altman", rating: 5, published_at: "2026-09-21T08:14:03Z" };

check("a source's review adopts the hand-entered row of the same author and rating", () => {
  assert.equal(adoptsManualRow(fromSource, manual), true);
  assert.equal(adoptsManualRow({ ...fromSource, author_name: " Liron Altman " }, manual), true);
});

check("another author, another rating or a date too far apart is another review", () => {
  assert.equal(adoptsManualRow({ ...fromSource, author_name: "Liron A." }, manual), false);
  assert.equal(adoptsManualRow({ ...fromSource, rating: 4 }, manual), false);
  const far = new Date(Date.parse(manual.published_at) + (MANUAL_MATCH_DAYS + 1) * 864e5).toISOString();
  assert.equal(adoptsManualRow({ ...fromSource, published_at: far }, manual), false);
});

check("only a manual: row is ever matched this loosely", () => {
  assert.equal(adoptsManualRow(fromSource, { ...manual, review_key: "Ci9DQUlRQUNvZENodHlj" }), false);
});

console.log(`\ngoogle-reviews selftest: ${checks} checks passed`);
