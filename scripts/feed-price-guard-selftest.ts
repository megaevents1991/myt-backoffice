// The feed's abnormal-price guard - the pure rules (lib/feed/price-guard.ts) and the price-drop
// tag's reference pick that shares them (lib/services/price-light.ts). No DB, no network.
//   npx tsx scripts/feed-price-guard-selftest.ts
import assert from "node:assert/strict";
import {
  FEED_PRICE_CEILING_USD, FEED_PRICE_HOLD_PREFIX, feedPriceVerdict, holdReasonText, isSpikeSnapshot, needsAlert,
  nextGuard, parseFeedPriceGuard, priceBaseline, storedGuard, type FeedPriceGuard,
} from "@/lib/feed/price-guard";
import { pickDropReference } from "@/lib/services/price-light";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`ok  ${name}`); };
const EMPTY: FeedPriceGuard = { hold: null, approved: null };
const NOW = "2026-11-14T14:00:00.000Z";
/** Event 918's cheapest ticket, 15.10-12.11 (the snapshots of 14.11). */
const DYLAN = [513, 517, 517, 517, 517, 517, 517, 517, 517, 517, 517, 517, 517, 517, 517, 513, 517, 517, 517, 517, 520, 520, 520, 520, 520, 517, 517, 517, 679, 674];

t("priceBaseline: the lower quarter of the days, never a guess on fewer than 3", () => {
  assert.equal(priceBaseline([]), null);
  assert.equal(priceBaseline([500, 600]), null);
  assert.equal(priceBaseline([500, 600, 700]), 500);
  assert.equal(priceBaseline([100, 200, 300, 400, 500, 600, 700, 800]), 200);
  assert.equal(priceBaseline([0, -5, Number.NaN, 400, 410, 420]), 400);
  assert.equal(priceBaseline(DYLAN), 517);
});

t("918 (13.11): $19,907 a traveller is over the ceiling - held", () => {
  const v = feedPriceVerdict({ cardUsd: 19907, ticketUsd: 18672, ticketDriven: true, history: DYLAN, guard: EMPTY });
  assert.deepEqual(v, { abnormal: true, reason: "ceiling", baselineUsd: 517 });
});

t("a jump under the ceiling: 2.5x AND $1,000 over the normal ticket", () => {
  const flat = Array(20).fill(520);
  assert.equal(feedPriceVerdict({ cardUsd: 4300, ticketUsd: 3000, ticketDriven: true, history: flat, guard: EMPTY }).abnormal, true);
  // 3x but only +$600: an ordinary concert moving up - not held
  assert.equal(feedPriceVerdict({ cardUsd: 2200, ticketUsd: 900, ticketDriven: true, history: Array(20).fill(300), guard: EMPTY }).abnormal, false);
  // +$2,500 but 2.25x: a dear event getting dearer - not held
  assert.equal(feedPriceVerdict({ cardUsd: 5800, ticketUsd: 4500, ticketDriven: true, history: Array(20).fill(2000), guard: EMPTY }).abnormal, false);
});

t("no history (a new event) = the ceiling alone", () => {
  assert.equal(feedPriceVerdict({ cardUsd: 4200, ticketUsd: 3000, ticketDriven: true, history: [600, 610], guard: EMPTY }).abnormal, false);
  assert.equal(feedPriceVerdict({ cardUsd: 6001, ticketUsd: 4800, ticketDriven: true, history: [], guard: EMPTY }).abnormal, true);
  assert.equal(feedPriceVerdict({ cardUsd: FEED_PRICE_CEILING_USD, ticketUsd: 4800, ticketDriven: true, history: [], guard: EMPTY }).abnormal, false);
});

t("a ready package's price does not follow the cheapest ticket - the ceiling alone", () => {
  const flat = Array(20).fill(520);
  assert.equal(feedPriceVerdict({ cardUsd: 2400, ticketUsd: 3000, ticketDriven: false, history: flat, guard: EMPTY }).abnormal, false);
  assert.equal(feedPriceVerdict({ cardUsd: 7000, ticketUsd: 3000, ticketDriven: false, history: flat, guard: EMPTY }).abnormal, true);
});

t("no price = nothing to hold (the feed leaves a priceless event out anyway)", () => {
  assert.equal(feedPriceVerdict({ cardUsd: null, ticketUsd: null, ticketDriven: true, history: DYLAN, guard: EMPTY }).abnormal, false);
});

t("'the price is right' lets the price through while it moves less than 10%", () => {
  const guard: FeedPriceGuard = { hold: null, approved: { card_usd: 19907, by: "alon", at: NOW } };
  assert.equal(feedPriceVerdict({ cardUsd: 21000, ticketUsd: 19700, ticketDriven: true, history: DYLAN, guard }).abnormal, false);
  assert.equal(feedPriceVerdict({ cardUsd: 23000, ticketUsd: 21700, ticketDriven: true, history: DYLAN, guard }).abnormal, true);
});

t("a held event keeps the baseline it was held against - it never learns the spike", () => {
  const held = nextGuard(EMPTY, { abnormal: true, reason: "jump", baselineUsd: 520 }, { now: NOW, cardUsd: 4300, ticketUsd: 3000 }).next;
  const allSpike = Array(30).fill(3000);
  const v = feedPriceVerdict({ cardUsd: 4300, ticketUsd: 3000, ticketDriven: true, history: allSpike, guard: held });
  assert.deepEqual(v, { abnormal: true, reason: "jump", baselineUsd: 520 });
});

t("flicker: 8 spike days, one normal day, the spike again under the ceiling - held again", () => {
  const history = [...Array(21).fill(520), ...Array(8).fill(3000), 520];
  const v = feedPriceVerdict({ cardUsd: 4300, ticketUsd: 3000, ticketDriven: true, history, guard: EMPTY });
  assert.equal(v.abnormal, true);
  // even with most of the month spiked, the lower quarter is still the normal price
  const mostly = [...Array(8).fill(520), ...Array(22).fill(3000)];
  assert.equal(feedPriceVerdict({ cardUsd: 4300, ticketUsd: 3000, ticketDriven: true, history: mostly, guard: EMPTY }).abnormal, true);
});

t("nextGuard: hold -> keep (since, baseline, alert kept) -> release keeps the approval", () => {
  const hold = nextGuard(EMPTY, { abnormal: true, reason: "ceiling", baselineUsd: 517 }, { now: NOW, cardUsd: 19907, ticketUsd: 18672 });
  assert.equal(hold.change, "hold");
  assert.deepEqual(hold.next.hold, { since: NOW, reason: "ceiling", card_usd: 19907, ticket_usd: 18672, baseline_usd: 517, alerted_at: null });
  const alerted: FeedPriceGuard = { ...hold.next, hold: { ...hold.next.hold!, alerted_at: NOW } };
  const keep = nextGuard(alerted, { abnormal: true, reason: "ceiling", baselineUsd: 517 }, { now: "2026-11-15T10:00:00.000Z", cardUsd: 19950, ticketUsd: 18700 });
  assert.equal(keep.change, "keep");
  assert.equal(keep.next.hold?.since, NOW);
  assert.equal(keep.next.hold?.alerted_at, NOW);
  assert.equal(keep.next.hold?.card_usd, 19950);
  const approved: FeedPriceGuard = { hold: keep.next.hold, approved: { card_usd: 2000, by: "x", at: NOW } };
  const release = nextGuard(approved, { abnormal: false }, { now: NOW, cardUsd: 1909, ticketUsd: 674 });
  assert.equal(release.change, "release");
  assert.deepEqual(release.next, { hold: null, approved: approved.approved });
  assert.equal(nextGuard(EMPTY, { abnormal: false }, { now: NOW, cardUsd: 1909, ticketUsd: 674 }).change, "none");
});

t("a stale approval is dropped when the price is held again", () => {
  const guard: FeedPriceGuard = { hold: null, approved: { card_usd: 7000, by: "x", at: NOW } };
  const step = nextGuard(guard, { abnormal: true, reason: "ceiling", baselineUsd: null }, { now: NOW, cardUsd: 9000, ticketUsd: 8000 });
  assert.equal(step.change, "hold");
  assert.equal(step.next.approved, null);
});

t("the alert follows the state: held, on sale and not yet told", () => {
  const hold = { since: NOW, reason: "ceiling" as const, card_usd: 19907, ticket_usd: 18672, baseline_usd: 517, alerted_at: null };
  assert.equal(needsAlert({ hold, approved: null }, false), true);
  assert.equal(needsAlert({ hold, approved: null }, true), false); // Sold - nobody has to act
  assert.equal(needsAlert({ hold: { ...hold, alerted_at: NOW }, approved: null }, false), false);
  assert.equal(needsAlert(EMPTY, false), false);
});

t("parseFeedPriceGuard is lenient; storedGuard writes null when there is nothing to keep", () => {
  assert.deepEqual(parseFeedPriceGuard(null), EMPTY);
  assert.deepEqual(parseFeedPriceGuard("x"), EMPTY);
  assert.deepEqual(parseFeedPriceGuard({ hold: { since: NOW, reason: "nope", card_usd: "x" } }), EMPTY);
  const ok = { hold: { since: NOW, reason: "jump", card_usd: 4300, ticket_usd: 3000, baseline_usd: 520, alerted_at: null }, approved: null };
  assert.deepEqual(parseFeedPriceGuard(ok), ok);
  assert.equal(storedGuard(EMPTY), null);
  assert.deepEqual(storedGuard(ok as FeedPriceGuard), ok);
});

t("holdReasonText: starts with the prefix the creative-gap list skips, names the numbers", () => {
  const ceiling = holdReasonText({ since: NOW, reason: "ceiling", card_usd: 19907, ticket_usd: 18672, baseline_usd: 517, alerted_at: null });
  assert.ok(ceiling.startsWith(FEED_PRICE_HOLD_PREFIX));
  assert.ok(ceiling.includes("$19,907") && ceiling.includes("$6,000"));
  const jump = holdReasonText({ since: NOW, reason: "jump", card_usd: 4300, ticket_usd: 3000, baseline_usd: 520, alerted_at: null });
  assert.ok(jump.includes("$3,000") && jump.includes("$520"));
  assert.ok(jump.length <= 300);
});

t("isSpikeSnapshot: over the ceiling, or a jump against the days before it", () => {
  assert.equal(isSpikeSnapshot({ package_usd: 19907, min_ticket: 18672 }, []), true);
  assert.equal(isSpikeSnapshot({ package_usd: 4300, min_ticket: 3000 }, Array(20).fill(520)), true);
  assert.equal(isSpikeSnapshot({ package_usd: 1909, min_ticket: 674 }, DYLAN), false);
  assert.equal(isSpikeSnapshot({ package_usd: 4300, min_ticket: 3000 }, Array(20).fill(3000)), false);
});

t("pickDropReference: a spike day is never the 'before' of a price drop; a real drop still is", () => {
  const today = "2026-11-27";
  const rows: { day: string; package_usd: number | null; min_ticket: number | null }[] = [];
  for (let d = 1; d <= 60; d++) {
    const day = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10); // 02.10 ..
    const spike = day >= "2026-11-13" && day <= "2026-11-14";
    rows.push({ day, package_usd: spike ? 19907 : 1909, min_ticket: spike ? 18672 : 520 });
  }
  const before = rows.filter((r) => r.day < today);
  const ref = pickDropReference(before, today);
  assert.ok(ref);
  assert.notEqual(ref!.package_usd, 19907);
  assert.ok(ref!.day !== "2026-11-13" && ref!.day !== "2026-11-14");
  // a dear event that really got cheaper (flat $3,000 for weeks) keeps its reference
  const flat = before.map((r) => ({ ...r, package_usd: 4300, min_ticket: 3000 }));
  assert.equal(pickDropReference(flat, today)?.package_usd, 4300);
  // the old rule: the row nearest 14 days back, ties to the older one
  assert.equal(pickDropReference(flat, today)?.day, "2026-11-13");
  assert.equal(pickDropReference([], today), null);
});

console.log(`\n${n} tests passed`);
