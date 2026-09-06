# Pricing Rule (always-on) - myt-backoffice

The backoffice sets the BASE of a price chain that the main app finishes. Get it wrong and
every customer price is wrong.

- Backoffice sets `base_flight_price`, `base_hotel_price`, and ticket prices on events.
- **Base prices come from ONE rule - `lib/services/price-quote.ts`** (2026-09-02): flight =
  cheapest direct +$100, or the cheapest connection +$100 when the direct beats it by more
  than $300; hotel = cheapest 3-star +$120; rounded to whole tens. Form buttons, wizard
  auto-fill, the nightly `base-price-sync` cron and the factory ALL quote through it - never
  compute a base price anywhere else, never change a margin outside that file's constants.
- **Nightly sync thresholds:** deviation ≥ $150 per component rewrites the base (both
  directions); a change > $400 is frozen as `needs_review` (`/price-changes`), never applied
  silently. `?dry_run=1` = full report, zero writes.
- **Per-currency markups applied here:** USD +$40, EUR +€40, GBP +£35, ILS +₪150.
- The **main app** then adds the final `NEXT_PUBLIC_MARKUP` (175 ILS) and converts USD→ILS.
  Do NOT add that 175 here, and do NOT convert currencies that the main app will convert.
- **Sports ticket prices are in cents** in storage - the main app divides by 100. Store
  consistently; don't pre-divide.
- Exchange rates come from the rate service - never hardcode. Changing markup logic here
  changes what customers pay → reconcile with main. See [[cross-project]].
