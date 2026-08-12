# Pricing Rule (always-on) - myt-backoffice

The backoffice sets the BASE of a price chain that the main app finishes. Get it wrong and
every customer price is wrong.

- Backoffice sets `base_flight_price`, `base_hotel_price`, and ticket prices on events.
- **Per-currency markups applied here:** USD +$40, EUR +€40, GBP +£35, ILS +₪150.
- The **main app** then adds the final `NEXT_PUBLIC_MARKUP` (175 ILS) and converts USD→ILS.
  Do NOT add that 175 here, and do NOT convert currencies that the main app will convert.
- **Sports ticket prices are in cents** in storage - the main app divides by 100. Store
  consistently; don't pre-divide.
- Exchange rates come from the rate service - never hardcode. Changing markup logic here
  changes what customers pay → reconcile with main. See [[cross-project]].
