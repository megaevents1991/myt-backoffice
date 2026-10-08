// Run: npx tsx scripts/marketing-alerts-selftest.ts
import assert from "node:assert/strict";
import { alertMailHtml, budgetBleedAlerts, planAlerts, readAll, rowsOrThrow, viralPostAlerts, windowStart, type AlertCandidate } from "../lib/services/marketing-alerts";

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

// A failed read throws (never "no rows"): it would read as "no candidates" and resolve every open alert.
assert.throws(() => rowsOrThrow("ad_spend_daily", { data: null, error: { message: "relation does not exist" } }), /alerts read ad_spend_daily: relation does not exist/);
assert.deepEqual(rowsOrThrow("ig_media", { data: null, error: null }), [], "a null body with no error is an empty list");
assert.deepEqual(rowsOrThrow("ig_media", { data: [{ id: "x" }], error: null }), [{ id: "x" }]);

// planAlerts: fresh are mailed, an open alert whose mail failed (last_mailed_at null) is mailed again, a mailed one is not, a gone one is resolved.
const cand = (kind: AlertCandidate["kind"], key: string): AlertCandidate => ({ kind, key, title: `${kind} ${key}`, payload: {} });
const plan = planAlerts(
  [cand("budget_bleed", "new"), cand("budget_bleed", "unmailed"), cand("budget_bleed", "mailed"), cand("viral_post", "unmailed")],
  [
    { kind: "budget_bleed", key: "unmailed", last_mailed_at: null },
    { kind: "budget_bleed", key: "mailed", last_mailed_at: "2026-10-07T05:00:00Z" },
    { kind: "viral_post", key: "gone", last_mailed_at: null },
    { kind: "viral_post", key: "gone-mailed", last_mailed_at: "2026-10-06T05:00:00Z" },
  ],
);
assert.deepEqual(plan.fresh.map((c) => `${c.kind}:${c.key}`), ["budget_bleed:new", "viral_post:unmailed"], "only what is not open yet is fresh (newAlerts)");
assert.deepEqual(plan.toMail.map((c) => `${c.kind}:${c.key}`), ["budget_bleed:new", "viral_post:unmailed", "budget_bleed:unmailed"], "fresh + the open alert whose mail never went out; the mailed one stays out");
assert.deepEqual(plan.toResolve.sort(), ["viral_post:gone", "viral_post:gone-mailed"], "open alerts no candidate asks for any more are resolved - an unmailed one that vanished is never mailed");
assert.deepEqual(planAlerts([cand("viral_post", "a"), cand("viral_post", "a")], []).toMail.length, 1, "deduped by kind:key");
assert.equal(planAlerts([], [{ kind: "viral_post", key: "a", last_mailed_at: null }]).toMail.length, 0, "nothing live = nothing to mail");

// The mail body escapes everything typed by someone else (a campaign name from Ads Manager) and the origin in the href.
const evil = budgetBleedAlerts({ spend: [{ ...spend("c1", "2026-10-07", 9000), name: `<a href="x">evil</a> & 'co'` }], purchasesByCampaign: new Map(), settings: { budget_bleed_ils: 1500, budget_bleed_days: 3 }, now });
const html = alertMailHtml(evil, "https://app.example");
assert.ok(!html.includes('<a href="x">'), "an injected tag must not survive");
assert.ok(html.includes("&lt;a href=&quot;x&quot;&gt;evil&lt;/a&gt; &amp; &#39;co&#39;"), "the name comes out escaped");
assert.ok(html.includes('<a href="https://app.example/marketing?tab=alerts">'), "the real link is intact");
assert.ok(alertMailHtml([], 'https://x.example/"><script>').includes("&quot;&gt;&lt;script&gt;"), "the origin is escaped too");
assert.ok(alertMailHtml(evil, "https://app.example").includes("<b>שריפת תקציב</b>") && alertMailHtml(viral, "https://app.example").includes("<b>ויראליות</b>"), "the kind labels are intact");

// windowStart is the rule's `since` and the runner's spend read: 3 days ending 2026-10-08 starts on the 6th.
assert.equal(windowStart(now, 3), "2026-10-06");
assert.equal(windowStart(now, 1), "2026-10-08");

async function pagingTests() {
  // readAll pages by 1,000 until a short page, throws on an error and past `max`.
  const fake = (total: number, calls: [number, number][], failAt = -1) => () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      if (from === failAt) return { data: null, error: { message: "boom" } };
      return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i), error: null };
    },
  });
  const calls: [number, number][] = [];
  const all = await readAll<number>("t", fake(2500, calls));
  assert.equal(all.length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]], "three pages, the short one stops the loop");
  assert.equal((await readAll<number>("t", fake(1000, []))).length, 1000, "an exactly full last page is followed by an empty one");
  await assert.rejects(() => readAll("ad_spend_daily", fake(5000, [], 1000)), /alerts read ad_spend_daily: boom/);
  await assert.rejects(() => readAll("t", fake(5000, []), 2000), /alerts read t: more than 2000 rows/);
}

pagingTests().then(() => console.log("marketing-alerts selftest OK"), (e) => { console.error(e); process.exit(1); });
