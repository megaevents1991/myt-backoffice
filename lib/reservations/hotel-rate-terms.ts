// lib/reservations/hotel-rate-terms.ts - what a booked hotel rate COSTS to cancel and how it is paid,
// read off the WorldOTA (RateHawk) rate object main stored on the reservation (`hotel_order_info.rate`,
// every `hotel_segments[].rate`). Pure: no DB, no Date.now(). Selftest: scripts/hotel-rate-terms-selftest.ts.
//
// Why (2026-10-13, reservation 2169): ops looked the Manchester segment up in RateHawk's extranet,
// found a refundable two-night rate at $1,230, took the site's $574 for a mistake and booked another
// hotel - the customer had bought ONE night, non-refundable, and that rate was still bookable at $575.
// The reservation page named the hotel, room, meal and price, but not the terms; these labels are the
// extranet's own columns ("Cancellation", "Payment type"), so the same product can be found there.
//
// RateHawk's shape (b2b v3 search / prebook):
//   rate.payment_options.payment_types[0] = {
//     type: "deposit" | "now" | "hotel",          // "deposit" is the extranet's "Pay later"
//     cancellation_penalties: {
//       free_cancellation_before: "2027-06-22T23:00:00" | null,   // HOTEL local time, no zone
//       policies: [{ start_at, end_at, amount_show, amount_charge }],  // windows; null = open end
//     },
//   }
// A rate with no `payment_options` (our offline inventory, rows written before the feature) has no
// terms to show - `known: false`, never a guess.

export type HotelPaymentType = "deposit" | "now" | "hotel";

export type HotelPenaltyWindow = {
  /** ISO, hotel local time; null = from the moment of booking. */
  from: string | null;
  /** ISO, hotel local time; null = until check-in. */
  to: string | null;
  /** What cancelling inside the window costs, in the rate's shown currency (USD on our searches). */
  amountUsd: number;
};

export type HotelRateTerms = {
  /** false when the stored rate carries no payment options (offline inventory, older rows). */
  known: boolean;
  /** true when the rate has a window that cancels for $0. */
  refundable: boolean;
  /** End of the free-cancellation window (ISO, hotel local time), null when there is none. */
  freeUntil: string | null;
  /** Every window that costs something, in the rate's order. */
  penalties: HotelPenaltyWindow[];
  paymentType: HotelPaymentType | null;
};

const UNKNOWN: HotelRateTerms = {
  known: false,
  refundable: false,
  freeUntil: null,
  penalties: [],
  paymentType: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A decimal string or number; null when it cannot be read - never 0, which would read as "free". */
const amountOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null;

const paymentTypeOf = (v: unknown): HotelPaymentType | null =>
  v === "deposit" || v === "now" || v === "hotel" ? v : null;

/** The terms of a stored rate. Tolerates any shape: a rate it cannot read is `known: false`. */
export function hotelRateTerms(rate: unknown): HotelRateTerms {
  if (!isRecord(rate)) return UNKNOWN;
  const options = rate.payment_options;
  if (!isRecord(options) || !Array.isArray(options.payment_types)) return UNKNOWN;
  // Our searches read payment_types[0] everywhere (main's hotel step, the package builder) -
  // the terms shown are the terms of the price shown.
  const pt = options.payment_types[0];
  if (!isRecord(pt)) return UNKNOWN;

  const cp = isRecord(pt.cancellation_penalties) ? pt.cancellation_penalties : {};
  const freeUntil = isoOrNull(cp.free_cancellation_before);
  const policies = Array.isArray(cp.policies) ? cp.policies : [];
  const penalties: HotelPenaltyWindow[] = [];
  let hasFreeWindow = false;
  for (const p of policies) {
    if (!isRecord(p)) continue;
    const amount = amountOf(p.amount_show ?? p.amount_charge);
    if (amount == null) continue;
    if (amount <= 0) {
      hasFreeWindow = true;
      continue;
    }
    penalties.push({ from: isoOrNull(p.start_at), to: isoOrNull(p.end_at), amountUsd: amount });
  }

  return {
    known: true,
    refundable: freeUntil != null || hasFreeWindow,
    freeUntil,
    penalties,
    paymentType: paymentTypeOf(pt.type),
  };
}

/**
 * "2027-06-22T23:00:00" -> "22/06/2027 23:00". The supplier's timestamps carry no zone and mean the
 * HOTEL's local time, so the literal fields are printed - never converted through a zone, which would
 * move a Manchester deadline by two hours on an Israeli screen.
 */
export function formatHotelTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  return h != null && mi != null ? `${d}/${mo}/${y} ${h}:${mi}` : `${d}/${mo}/${y}`;
}

/** The extranet's own words for the "Payment type" column. */
export function paymentTypeLabel(type: HotelPaymentType | null): string {
  switch (type) {
    case "deposit":
      return "Pay later";
    case "now":
      return "Pay now";
    case "hotel":
      return "Pay at the hotel";
    default:
      return "";
  }
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * One line for the "Cancellation" column: "Non-refundable", "Free until 22/06/2027 23:00",
 * or the free window followed by what each later window costs ("Free until …, then $288, then $575").
 * Empty when the rate carries no terms.
 */
export function cancellationLabel(terms: HotelRateTerms): string {
  if (!terms.known) return "";
  if (!terms.refundable) return "Non-refundable";
  const parts: string[] = [];
  if (terms.freeUntil) parts.push(`Free until ${formatHotelTime(terms.freeUntil)}`);
  else parts.push("Free cancellation");
  for (const p of terms.penalties) {
    parts.push(
      p.from && p.from !== terms.freeUntil
        ? `from ${formatHotelTime(p.from)} ${usd(p.amountUsd)}`
        : `then ${usd(p.amountUsd)}`,
    );
  }
  return parts.join(", ");
}
