// scripts/tours-payment-links-selftest.ts - `npx tsx scripts/tours-payment-links-selftest.ts`
// Pure only: an order's card payment links (lib/tours/payment-links.ts) - the default amount, what a link may
// hold, the state it shows, its address and message. No DB, no network. The SQL side is
// scripts/tours-payment-links-sql-pglite-test.mjs.
import assert from "node:assert/strict";
import {
  checkLinkInput,
  defaultLinkAmount,
  firstNameOf,
  isLiveLink,
  linkBlockedBy,
  linkState,
  moneyText,
  openLinksTotal,
  payLinkMessage,
  payLinkUrl,
  type LinkOrder,
} from "@/lib/tours/payment-links";

const order: LinkOrder = { status: "pending_payment", currency: "USD", travelers: 2, due: 3000 };

// ---------------------------------------------------------------- default amount (Dor 28.10: $200 per traveler)
assert.equal(defaultLinkAmount("deposit", order), 400);
assert.equal(defaultLinkAmount("deposit", { ...order, travelers: 5 }), 1000);
assert.equal(defaultLinkAmount("deposit", { ...order, due: 250 }), 250, "never above what is owed");
assert.equal(defaultLinkAmount("deposit", { ...order, currency: "EUR" }), null, "another currency opens empty");
assert.equal(defaultLinkAmount("balance", { ...order, due: 1234.567 }), 1234.57);
assert.equal(defaultLinkAmount("other", order), null);
assert.equal(defaultLinkAmount("balance", { ...order, due: 0 }), null);

// ---------------------------------------------------------------- what a link may hold
assert.equal(checkLinkInput({ kind: "deposit", amount: 400 }, order), null);
assert.equal(checkLinkInput({ kind: "balance", amount: 3000, payments: 6, days: 14 }, order), null);
assert.ok(checkLinkInput({ kind: "tip", amount: 10 }, order), "unknown kind");
assert.ok(checkLinkInput({ kind: "other", amount: 0 }, order), "zero");
assert.ok(checkLinkInput({ kind: "other", amount: -1 }, order), "negative");
assert.ok(checkLinkInput({ kind: "other", amount: Number.NaN }, order), "not a number");
assert.ok(checkLinkInput({ kind: "other", amount: 10.555 }, order), "three decimals");
assert.match(checkLinkInput({ kind: "balance", amount: 3000.01 }, order) ?? "", /more than the order still owes/);
assert.ok(checkLinkInput({ kind: "deposit", amount: 400, payments: 2 }, order), "a deposit is one payment");
assert.ok(checkLinkInput({ kind: "balance", amount: 100, payments: 13 }, order), "12 payments at most");
assert.ok(checkLinkInput({ kind: "balance", amount: 100, days: 0 }, order), "a day at least");
assert.ok(checkLinkInput({ kind: "balance", amount: 100, days: 31 }, order), "30 days at most");
assert.ok(checkLinkInput({ kind: "balance", amount: 100 }, { ...order, status: "cancelled" }), "a cancelled order");
assert.equal(linkBlockedBy({ ...order, due: 0 }), "Nothing is left to pay on this order.");
assert.equal(linkBlockedBy(order), null);

// ---------------------------------------------------------------- the state it shows
const now = Date.parse("2026-10-28T10:00:00Z");
assert.equal(linkState("open", "2026-11-04T10:00:00Z", now), "open");
assert.equal(linkState("started", "2026-11-04T10:00:00Z", now), "started");
assert.equal(linkState("open", "2026-10-28T09:00:00Z", now), "expired");
assert.equal(linkState("started", "2026-10-28T09:00:00Z", now), "expired");
assert.equal(linkState("paid", "2026-10-28T09:00:00Z", now), "paid", "a paid link stays paid after its day");
assert.equal(linkState("review", "2026-10-28T09:00:00Z", now), "review");
assert.equal(linkState("cancelled", "2026-11-04T10:00:00Z", now), "cancelled");
assert.equal(isLiveLink("open"), true);
assert.equal(isLiveLink("started"), true);
assert.equal(isLiveLink("expired"), false);
// open links count as asked for already: two links never ask together for more than is owed
assert.equal(
  openLinksTotal(
    [
      { state: "open", amount: 400, currency: "USD" },
      { state: "started", amount: 100.5, currency: "USD" },
      { state: "expired", amount: 999, currency: "USD" },
      { state: "paid", amount: 999, currency: "USD" },
      { state: "open", amount: 50, currency: "EUR" },
    ],
    "USD",
  ),
  500.5,
);

// ---------------------------------------------------------------- the address and the message
const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
assert.equal(payLinkUrl("https://megafamily.co.il/", token), `https://megafamily.co.il/pay/${token}/`);
assert.equal(payLinkUrl(null, token), null);
assert.equal(payLinkUrl("https://megafamily.co.il", "short"), null);
assert.equal(payLinkUrl("https://megafamily.co.il", "bad token with spaces and more!"), null);
assert.equal(moneyText(400, "USD"), "$400");
assert.equal(moneyText(1480.5, "ILS"), "₪1,480.50");
assert.equal(moneyText(10, "CHF"), "10 CHF");
assert.equal(firstNameOf("  Dana Levi "), "Dana");
assert.equal(firstNameOf(""), null);
const msg = payLinkMessage({ firstName: "דנה", kind: "deposit", amount: 400, currency: "USD", ref: "T1001", url: "https://x/pay/t/", expiresAt: "2026-11-04T10:00:00Z" });
assert.match(msg, /^היי דנה,/);
assert.match(msg, /מקדמה של הזמנה T1001 \(\$400\)/);
assert.match(msg, /https:\/\/x\/pay\/t\//);
assert.match(msg, /בתוקף עד 04\.11/);
assert.match(payLinkMessage({ firstName: null, kind: "balance", amount: 1, currency: "USD", ref: "T1", url: "u", expiresAt: "2026-11-04T10:00:00Z" }), /^היי, מצרפים קישור ליתרת תשלום/);

console.log("tours payment links: all checks pass");
