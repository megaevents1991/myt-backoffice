// Run: npx tsx scripts/club-selftest.ts
// The members club's pure rules (spec docs/superpowers/specs/2026-11-09-members-club-design.md §10): settings bounds,
// the overview numbers, the member rows of the table, the CSV export.
import assert from "node:assert/strict";
import { validateClubSettings } from "../lib/club/settings";
import { clubOverview, clubWindow, memberViews } from "../lib/club/stats";
import { exportableMembers, membersCsv } from "../lib/club/csv";
import type { ClubMemberRow, ClubOrderRow } from "../lib/club/types";

// ---- settings
const ok = (v: unknown) => validateClubSettings(v).ok;
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 50, popup_delay_seconds: 22 }), true);
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 0, popup_delay_seconds: 22 }), false, "$0 is refused (coupons CHECK > 0)");
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 500, popup_delay_seconds: 22 }), true, "$500 is the top");
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 501, popup_delay_seconds: 22 }), false);
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 12.5, popup_delay_seconds: 22 }), false, "whole dollars only");
assert.equal(ok({ enabled: true, discount_per_traveler_usd: "50", popup_delay_seconds: 22 }), false, "a string is not a number");
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 50, popup_delay_seconds: 4 }), false, "delay 5..120");
assert.equal(ok({ enabled: true, discount_per_traveler_usd: 50, popup_delay_seconds: 121 }), false);
assert.equal(ok({ enabled: "yes", discount_per_traveler_usd: 50, popup_delay_seconds: 22 }), false, "enabled is a boolean");
assert.equal(ok(null), false);
const parsed = validateClubSettings({ enabled: false, discount_per_traveler_usd: 60, popup_delay_seconds: 30, extra: 1 });
assert.deepEqual(parsed, { ok: true, value: { enabled: false, discount_per_traveler_usd: 60, popup_delay_seconds: 30 } }, "unknown keys dropped");

// ---- fixtures
const member = (over: Partial<ClubMemberRow>): ClubMemberRow => ({
  id: "m1",
  member_no: 1001,
  email: "dana@x.com",
  phone: "0501234567",
  first_name: "דנה",
  last_name: "לוי",
  coupon_code: "MEGAAAAAA1",
  status: "active",
  marketing: "subscribed",
  unsubscribed_at: null,
  source: "checkout_popup",
  event_id: 812,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  welcome_sent_at: "2026-11-03T08:00:00Z",
  welcome_error: null,
  created_at: "2026-11-03T08:00:00Z",
  ...over,
});
const order = (over: Partial<ClubOrderRow>): ClubOrderRow => ({
  coupon_code: "MEGAAAAAA1",
  status: "Paid",
  created_at: "2026-11-03T09:00:00Z",
  user_shown_price: 2380,
  coupon_discount_usd: 100,
  ...over,
});

// ---- window
const NOW = new Date("2026-11-09T10:00:00Z");
assert.deepEqual(clubWindow("7d", NOW, null), { range: "7d", since: "2026-11-03", until: "2026-11-09" });
assert.deepEqual(clubWindow("all", NOW, "2026-11-01"), { range: "all", since: "2026-11-01", until: "2026-11-09" });
assert.deepEqual(clubWindow("all", NOW, null), { range: "all", since: "2026-11-09", until: "2026-11-09" }, "no members yet");
assert.equal(clubWindow("nonsense", NOW, null).range, "30d", "unknown range -> 30 days");

// ---- overview
const win = { since: "2026-11-03", until: "2026-11-09" };
const prev = { since: "2026-10-27", until: "2026-11-02" };
const members = [
  member({}),
  // 23:30 UTC on the 2nd is the 3rd in Israel
  member({ id: "m2", member_no: 1002, email: "b@x.com", coupon_code: "MEGAAAAAA2", created_at: "2026-11-02T23:30:00Z", event_id: 812 }),
  member({ id: "m3", member_no: 1003, email: "c@x.com", coupon_code: "MEGAAAAAA3", created_at: "2026-10-30T10:00:00Z", event_id: 900, marketing: "unsubscribed" }),
  member({ id: "m4", member_no: 1004, email: "d@x.com", coupon_code: "MEGAAAAAA4", created_at: "2026-11-05T10:00:00Z", event_id: 901, welcome_sent_at: null, welcome_error: "smtp 550", status: "removed" }),
];
const orders = [
  order({}),
  order({ status: "Pending", coupon_discount_usd: 100, user_shown_price: 2000 }),
  order({ coupon_code: "MEGAAAAAA2", created_at: "2026-10-28T10:00:00Z" }), // previous period - not counted
];
const ov = clubOverview(members, orders, win, prev);
assert.equal(ov.members.total, 3, "active members only");
assert.equal(ov.members.inWindow, 3, "joined in the window, removed included");
assert.equal(ov.members.prevWindow, 1);
assert.equal(ov.joinsByDay.length, 7, "every day of the window");
assert.deepEqual(ov.joinsByDay.find((d) => d.day === "2026-11-03"), { day: "2026-11-03", count: 2 }, "the 23:30 UTC join lands on the Israel day");
assert.equal(ov.orders.all, 2);
assert.equal(ov.orders.paid, 1);
assert.equal(ov.discountGivenUsd, 100, "Paid orders only");
assert.equal(ov.paidRevenueUsd, 2380);
assert.equal(ov.unsubscribed, 1);
assert.equal(ov.welcomeFailed, 1);
assert.deepEqual(ov.topEvents[0], { eventId: 812, members: 2 });

// ---- member rows
const views = memberViews([members[0]], orders, new Map([[812, "Coldplay"]]));
assert.equal(views[0].ordersAll, 2);
assert.equal(views[0].ordersPaid, 1);
assert.equal(views[0].paidRevenueUsd, 2380, "revenue of the Paid order only");
assert.equal(views[0].eventName, "Coldplay");
assert.equal(memberViews([members[2]], orders, new Map())[0].eventName, null);

// ---- CSV
const csv = membersCsv([member({ last_name: 'Levi, "Dana"', created_at: "2026-11-02T23:30:00Z" })]);
assert.ok(csv.startsWith("﻿"), "BOM for Excel's Hebrew");
const lines = csv.slice(1).split("\r\n");
assert.equal(lines[0], "member_no,first_name,last_name,email,phone,joined_at,source,marketing,status,utm_source,utm_medium,utm_campaign,code");
assert.ok(lines[1].includes('"Levi, ""Dana"""'), "quotes doubled, comma field quoted");
assert.ok(lines[1].includes("2026-11-03 01:30"), "joined_at in Israel time");
// a value typed on the public form must not run as a formula when the file opens in Excel
const evil = membersCsv([member({ first_name: '=HYPERLINK("http://x","y")', utm_source: "+cmd", last_name: "@sum", utm_medium: "-1" })]);
const evilRow = evil.slice(1).split("\r\n")[1];
assert.ok(evilRow.startsWith("1001,\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\""), "a leading = is neutralized and quoted");
assert.ok(evilRow.includes(",'@sum,"), "a leading @ is neutralized");
assert.ok(evilRow.includes(",'+cmd,") && evilRow.includes(",'-1,"), "leading + and - are neutralized");
assert.ok(membersCsv([member({})]).slice(1).split("\r\n")[1].startsWith("1001,"), "member_no is left as a number");

// the export is the file Zoho Campaigns will import: only members who may be mailed (subscribed, not removed)
const exportable = exportableMembers(members);
assert.deepEqual(exportable.map((m) => m.member_no), [1001, 1002], "unsubscribed (1003) and removed (1004) never reach the file");
assert.deepEqual(exportableMembers([]), []);

console.log("club-selftest: all assertions passed");
