// scripts/hotel-rate-terms-selftest.ts - `npx tsx scripts/hotel-rate-terms-selftest.ts`
// The pure rules behind the "Cancellation" / "Payment type" lines on the reservation page
// (lib/reservations/hotel-rate-terms.ts), against the rate shapes RateHawk really stored on
// reservations 2127 (refundable) and 2169 (non-refundable). The page itself is checked in the browser.
import {
  cancellationLabel,
  formatHotelTime,
  hotelRateTerms,
  paymentTypeLabel,
} from "../lib/reservations/hotel-rate-terms";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const rate = (pt: Record<string, unknown>) => ({
  meal: "breakfast",
  meal_data: { value: "breakfast", has_breakfast: true },
  room_name: "Original Double room (full double bed)",
  payment_options: { payment_types: [pt] },
});

// --- reservation 2169, The Midland: one policy, the whole price, no free window --------------
const nonRefundable = rate({
  type: "deposit",
  amount: "574.00",
  show_amount: "574.00",
  cancellation_penalties: {
    policies: [{ start_at: null, end_at: null, amount_charge: "574.00", amount_show: "574.00" }],
    free_cancellation_before: null,
  },
});
const t1 = hotelRateTerms(nonRefundable);
check("2169: known", t1.known, true);
check("2169: not refundable", t1.refundable, false);
check("2169: no free window", t1.freeUntil, null);
check("2169: the one penalty is the full price", t1.penalties, [{ from: null, to: null, amountUsd: 574 }]);
check("2169: pay later", t1.paymentType, "deposit");
check("2169: label", cancellationLabel(t1), "Non-refundable");
check("2169: payment label is the extranet's word", paymentTypeLabel(t1.paymentType), "Pay later");

// --- reservation 2127, 9Hotel Republique: $0 until 11.10 07:00, then the whole price ---------
const refundable = rate({
  type: "deposit",
  show_amount: "1082",
  cancellation_penalties: {
    policies: [
      { start_at: null, end_at: "2026-10-11T07:00:00", amount_charge: "0.00", amount_show: "0.00" },
      { start_at: "2026-10-11T07:00:00", end_at: null, amount_charge: "1082.00", amount_show: "1082.00" },
    ],
    free_cancellation_before: "2026-10-11T07:00:00",
  },
});
const t2 = hotelRateTerms(refundable);
check("2127: refundable", t2.refundable, true);
check("2127: free until", t2.freeUntil, "2026-10-11T07:00:00");
check("2127: the paid window", t2.penalties, [{ from: "2026-10-11T07:00:00", to: null, amountUsd: 1082 }]);
check("2127: label names the deadline and what follows", cancellationLabel(t2), "Free until 11/10/2026 07:00, then $1,082");

// --- staged penalties: free, then half, then all --------------------------------------------
const staged = rate({
  type: "now",
  cancellation_penalties: {
    policies: [
      { start_at: null, end_at: "2027-06-15T23:00:00", amount_show: "0.00" },
      { start_at: "2027-06-15T23:00:00", end_at: "2027-06-22T23:00:00", amount_show: "288.00" },
      { start_at: "2027-06-22T23:00:00", end_at: null, amount_show: "575.00" },
    ],
    free_cancellation_before: "2027-06-15T23:00:00",
  },
});
const t3 = hotelRateTerms(staged);
check("staged: two paid windows in order", t3.penalties.map((p) => p.amountUsd), [288, 575]);
check("staged: label walks the windows", cancellationLabel(t3), "Free until 15/06/2027 23:00, then $288, from 22/06/2027 23:00 $575");
check("staged: pay now", paymentTypeLabel(t3.paymentType), "Pay now");

// --- a free window with no deadline field (older supplier rows) -----------------------------
const freeNoField = rate({ type: "hotel", cancellation_penalties: { policies: [{ start_at: null, end_at: null, amount_show: "0.00" }] } });
const t4 = hotelRateTerms(freeNoField);
check("free window, no deadline field: refundable", t4.refundable, true);
check("free window, no deadline field: label", cancellationLabel(t4), "Free cancellation");
check("pay at the hotel", paymentTypeLabel(t4.paymentType), "Pay at the hotel");

// --- rates with nothing to read ---------------------------------------------------------------
check("offline inventory rate (no payment options)", hotelRateTerms({ meal: "nomeal", meal_data: { value: "nomeal", has_breakfast: false } }).known, false);
check("null", hotelRateTerms(null).known, false);
check("a string", hotelRateTerms("rate").known, false);
check("empty payment types", hotelRateTerms({ payment_options: { payment_types: [] } }).known, false);
check("unknown rate prints nothing", cancellationLabel(hotelRateTerms(null)), "");
check("unknown payment type prints nothing", paymentTypeLabel(null), "");
check("a payment type we do not know is null, not a guess", hotelRateTerms(rate({ type: "card_later", cancellation_penalties: { policies: [] } })).paymentType, null);
check("a penalty with a bad amount is not a free window", hotelRateTerms(rate({ type: "now", cancellation_penalties: { policies: [{ amount_show: "abc" }] } })).refundable, false);

// --- the hotel's own clock: printed literally, never shifted through a time zone -------------
check("date + time", formatHotelTime("2027-06-22T23:00:00"), "22/06/2027 23:00");
check("date only", formatHotelTime("2027-06-22"), "22/06/2027");
check("space separator", formatHotelTime("2027-06-22 09:30:00"), "22/06/2027 09:30");
check("not a date comes back as is", formatHotelTime("soon"), "soon");

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
