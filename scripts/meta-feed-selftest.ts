// Self-test for the Meta feed's pure helpers. No DB writes, no network.
//   npx tsx --env-file=.env.local scripts/meta-feed-selftest.ts
import assert from "node:assert/strict";
import { firstNeverRendered } from "../lib/creative/auto";
import { activityIdsOf } from "../lib/feed/publish-meta-feed";

/* creatives: an event that never got one goes before every re-render, date order kept */
const order = firstNeverRendered([
  { id: 1, campaign_image_url: "a.png" }, // soonest, price moved - re-render
  { id: 2, campaign_image_url: null }, // new, far out
  { id: 3, campaign_image_url: "c.png" },
  { id: 4 }, // new, never checked
]).map((e) => e.id);
assert.deepEqual(order, [2, 4, 1, 3]);

/* feed file: the ids Meta will list */
const csv = 'id,image_link,title\r\n1154,https://x/a.png,"אואזיס, מדריד"\r\n"717",https://x/b.png,ריאל\r\n';
assert.deepEqual(activityIdsOf(csv), [1154, 717]);
assert.deepEqual(activityIdsOf("id,image_link\r\n"), []);

console.log("meta-feed selftest: all assertions passed");
process.exit(0);
