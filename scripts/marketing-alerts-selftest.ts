// Run: npx tsx scripts/marketing-alerts-selftest.ts
import assert from "node:assert/strict";
import { viralPostIds } from "../lib/marketing/engagement";
import { readAll } from "../lib/services/marketing-db";
import { alertMailHtml, budgetBleedAlerts, planAlerts, rowsOrThrow, VIRAL_MAX_AGE_DAYS, viralPostAlerts, windowStart, type AlertCandidate } from "../lib/services/marketing-alerts";

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

// viralPostIds IS the rule the alert is built from (and the grid's badge reads): same ids, the editable threshold, the guards.
const grid = [...history, post("new", "2026-10-07T10:00:00Z", 250), post("fresh", "2026-10-08T11:30:00Z", 900), post("meh", "2026-10-07T09:00:00Z", 150)];
assert.deepEqual([...viralPostIds(grid, 200, now)], ["new"], "same answer as the alert at 200%: 'fresh' is under 24h, 'meh' is 150%");
assert.deepEqual([...viralPostIds(grid, 200, now)].sort(), viralPostAlerts({ media: grid, settings: { viral_pct: 200 }, now }).map((a) => a.key).sort(), "the badge and the alert never disagree");
assert.deepEqual([...viralPostIds(grid, 120, now)].sort(), ["meh", "new"], "viral_pct is the threshold: 150% beats 120%; 'fresh' is still under 24h");
assert.equal(viralPostIds(grid, 120, new Date("2026-10-09T12:00:00Z")).has("fresh"), true, "a day later 'fresh' counts");
const zeros = Array.from({ length: 30 }, (_, i) => post(`z${i}`, `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`, 0));
assert.equal(viralPostIds([...zeros, post("spike", "2026-10-07T10:00:00Z", 50)], 200, now).size, 0, "a zero baseline returns an empty set (nothing to be a multiple of)");
assert.equal(viralPostIds([...history, { ...post("story", "2026-10-07T10:00:00Z", 900), media_product_type: "STORY" as const }], 200, now).size, 0, "stories are never viral");
assert.equal(viralPostIds([...history, { ...post("nodate", "2026-10-07T10:00:00Z", 900), posted_at: null }], 200, now).size, 0, "no posted_at, no verdict");

// The age cap: a post 30 days old that beats the bar wears the badge (a display) but raises no alert (older than VIRAL_MAX_AGE_DAYS).
assert.equal(VIRAL_MAX_AGE_DAYS, 7);
const aged = [...history, post("old", "2026-09-08T12:00:00Z", 900)];
assert.equal(viralPostIds(aged, 200, now).has("old"), true, "the badge is not capped");
assert.deepEqual(viralPostAlerts({ media: aged, settings: { viral_pct: 200 }, now }).map((a) => a.key), [], "a 30-day-old viral post does not fire");

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
assert.ok(alertMailHtml(evil, "https://app.example").includes("<b>דימום תקציב</b>") && alertMailHtml(viral, "https://app.example").includes("<b>פוסט ויראלי</b>"), "the kind labels are the tab's words, intact");

// windowStart is the rule's `since` and the runner's spend read: 3 days ending 2026-10-08 starts on the 6th.
assert.equal(windowStart(now, 3), "2026-10-06");
assert.equal(windowStart(now, 1), "2026-10-08");

async function pagingTests() {
  // The shared readAll (lib/services/marketing-db.ts) pages by 1,000 until a short page, throws on an error and past
  // `max`, and dedupes by the order columns. The fake is a client: from(table).select(cols) -> .order() -> .range().
  // `shift` serves every page from one row earlier (a row inserted ahead between two reads) - the overlap must dedupe.
  const fake = (total: number, calls: [number, number][], failAt = -1, shift = 0) => ({
    from: () => ({
      select: () => {
        const q = {
          order: () => q,
          range: async (from: number, to: number) => {
            calls.push([from, to]);
            if (from === failAt) return { data: null, error: { message: "boom" } };
            const start = Math.max(0, from - (from > 0 ? shift : 0));
            return { data: Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => ({ id: start + i })), error: null };
          },
        };
        return q;
      },
    }),
  });
  const read = (total: number, calls: [number, number][], opts: { failAt?: number; max?: number; table?: string; shift?: number } = {}) =>
    readAll<{ id: number }>(opts.table ?? "t", "id", ["id"], opts.max ?? 50_000, "alerts", (q) => q, fake(total, calls, opts.failAt, opts.shift));
  const calls: [number, number][] = [];
  const all = await read(2500, calls);
  assert.equal(all.length, 2500);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]], "three pages, the short one stops the loop");
  assert.equal((await read(1000, [])).length, 1000, "an exactly full last page is followed by an empty one");
  await assert.rejects(() => read(5000, [], { failAt: 1000, table: "ad_spend_daily" }), /alerts read ad_spend_daily: boom/);
  await assert.rejects(() => read(5000, [], { max: 2000 }), /alerts read t: more than 2000 rows/);
  const shifted = await read(2500, [], { shift: 1 });
  assert.equal(new Set(shifted.map((r) => r.id)).size, shifted.length, "a row served twice across pages is kept once (composite-key dedupe)");
  await assert.rejects(
    () => readAll("t", "id", ["id", "day"], 50_000, "alerts", (q) => q, fake(10, [])),
    /order column "day" is not selected/,
    "an order column missing from the select would dedupe distinct rows together - refused",
  );
}

pagingTests().then(() => console.log("marketing-alerts selftest OK"), (e) => { console.error(e); process.exit(1); });
