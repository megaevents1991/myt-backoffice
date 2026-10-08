// Run: npx tsx scripts/marketing-settings-selftest.ts
import assert from "node:assert/strict";
import { ALERT_EMAILS_MAX, validateSettingsPatch } from "../lib/marketing/settings";

const ok = (patch: unknown) => {
  const r = validateSettingsPatch(patch);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.rows;
};
const bad = (patch: unknown, re: RegExp, why: string) => {
  const r = validateSettingsPatch(patch);
  assert.equal(r.ok, false, why);
  if (!r.ok) assert.match(r.error, re, why);
};

// A full, sane patch passes and keeps the order of the keys.
assert.deepEqual(
  ok({ processing_fee_pct: 2.5, monthly_profit_target_usd: 50_000, budget_bleed_ils: 1500, budget_bleed_days: 3, viral_pct: 200, alert_emails: ["a@x.co"] }),
  [
    { key: "processing_fee_pct", value: 2.5 },
    { key: "monthly_profit_target_usd", value: 50_000 },
    { key: "budget_bleed_ils", value: 1500 },
    { key: "budget_bleed_days", value: 3 },
    { key: "viral_pct", value: 200 },
    { key: "alert_emails", value: ["a@x.co"] },
  ],
);
assert.deepEqual(ok({}), [], "an empty patch changes nothing");
assert.deepEqual(ok({ nonsense: 5 }), [], "an unknown key is ignored");

// Bounds.
bad({ budget_bleed_days: 0.5 }, /budget_bleed_days must be a whole number from 1 to 60/, "half a day is not a window");
bad({ budget_bleed_days: 10_000 }, /budget_bleed_days/, "10,000 days is past 60");
bad({ budget_bleed_days: 0 }, /budget_bleed_days/, "a zero-day window would never alert");
bad({ processing_fee_pct: 150 }, /processing_fee_pct must be a number from 0 to 100/, "a fee above 100% is not a fee");
bad({ viral_pct: 49 }, /viral_pct/, "below 50% every post is viral");
assert.deepEqual(ok({ viral_pct: 50 }), [{ key: "viral_pct", value: 50 }], "50% is the floor, inclusive");
bad({ budget_bleed_ils: 2_000_000 }, /budget_bleed_ils/, "past ₪1,000,000");
bad({ monthly_profit_target_usd: -1 }, /monthly_profit_target_usd/, "a negative target");
bad({ processing_fee_pct: "2" }, /processing_fee_pct/, "a string is not a number");
bad({ processing_fee_pct: Number.NaN }, /processing_fee_pct/, "NaN is not a number");
bad({ viral_pct: 200, budget_bleed_days: 0.5 }, /budget_bleed_days/, "one bad value refuses the whole patch");

// Emails: trimmed, blanks dropped, deduped (case-insensitive, first spelling kept), validated, capped.
assert.deepEqual(ok({ alert_emails: ["  a@x.co ", "A@X.co", "", "b@y.org"] }), [{ key: "alert_emails", value: ["a@x.co", "b@y.org"] }]);
bad({ alert_emails: ["a@x.co", "not-an-email"] }, /"not-an-email" is not an email address/, "a bad email");
bad({ alert_emails: "a@x.co" }, /alert_emails must be a list/, "a string is not a list");
bad({ alert_emails: Array.from({ length: ALERT_EMAILS_MAX + 1 }, (_, i) => `u${i}@x.co`) }, /at most 10 addresses/, "eleven addresses");
assert.equal((ok({ alert_emails: [...Array.from({ length: ALERT_EMAILS_MAX }, (_, i) => `u${i}@x.co`), "U0@x.co"] })[0].value as string[]).length, 10, "a duplicate does not count toward the cap");
assert.deepEqual(ok({ alert_emails: [] }), [{ key: "alert_emails", value: [] }], "an empty list = the system's default address");

bad(null, /settings must be an object/, "null");
bad([1, 2], /settings must be an object/, "an array");

console.log("marketing-settings selftest OK");
