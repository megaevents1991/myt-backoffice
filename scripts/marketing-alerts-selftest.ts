// Run: npx tsx scripts/marketing-alerts-selftest.ts
import assert from "node:assert/strict";
import { budgetBleedAlerts, viralPostAlerts } from "../lib/services/marketing-alerts";

const now = new Date("2026-10-08T12:00:00Z");
const spend = (campaign_id: string, day: string, spend: number) => ({ campaign_id, day, spend, brand: "mega_events" as const, name: `camp ${campaign_id}` });
const bleed = budgetBleedAlerts({
  spend: [spend("c1", "2026-10-06", 600), spend("c1", "2026-10-07", 600), spend("c1", "2026-10-08", 600), spend("c2", "2026-10-07", 5000), spend("c3", "2026-10-07", 100)],
  purchasesByCampaign: new Map([["c2", 1]]),
  settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 },
  now,
});
assert.deepEqual(bleed.map((a) => a.key), ["c1"], "c1 bled 1800 with no purchase; c2 bought; c3 is under the bar");
assert.equal(bleed[0].kind, "budget_bleed");
assert.equal(bleed[0].payload.spend_ils, 1800);
assert.equal(budgetBleedAlerts({ spend: [spend("c1", "2026-10-01", 9000)], purchasesByCampaign: new Map(), settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 }, now }).length, 0, "outside the window");
assert.equal(budgetBleedAlerts({ spend: [{ ...spend("c9", "2026-10-07", 9000), brand: "other" }], purchasesByCampaign: new Map(), settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 }, now }).length, 0, "other brands never alert");

const post = (id: string, posted_at: string, eng: number) => ({ id, posted_at, like_count: eng, comments_count: 0, saved: 0, shares: 0, media_product_type: "FEED" as const });
const history = Array.from({ length: 30 }, (_, i) => post(`h${i}`, `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`, 100));
const viral = viralPostAlerts({ media: [...history, post("new", "2026-10-07T10:00:00Z", 250), post("fresh", "2026-10-08T11:30:00Z", 900), post("meh", "2026-10-07T09:00:00Z", 150)], settings: { viral_pct: 200 }, now });
assert.deepEqual(viral.map((a) => a.key), ["new"], "250 > 200% of 100; 'fresh' is under 24h; 'meh' is 150%");
assert.equal(viral[0].payload.engagement, 250);
assert.equal(viralPostAlerts({ media: [post("only", "2026-10-07T10:00:00Z", 999)], settings: { viral_pct: 200 }, now }).length, 0, "no history = no baseline");

console.log("marketing-alerts selftest OK");
