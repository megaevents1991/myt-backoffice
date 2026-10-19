# Tours: one customer, deal cards under it (2026-10-19)

Source: a sitting with Nir Azulay (the end user) on 19.10, his answers to nine questions, and the clickable mockup
Dor approved: https://claude.ai/artifact/6CXvKBuoCd3np4RiD9GPG1. Builds on
`2026-10-14-tours-unified-reservations-design.md` - a case (a row of `public.leads`) is now a **card**, and cards
hang on a **customer**.

## The model

- **Customer** (`public.customers`, new): one per phone. `customer_no` (shown `C-1041`, sequence from 1001), names,
  `phones[]` (first = main) with `phone_keys[]` (last 9 digits, kept by a trigger), e-mail, national id, ACC NUM,
  `not_same[]` (customers staff said are other people), `merged_into`, soft delete.
- **Card** = a deal: a row of `public.leads` with `customer_id`. A lead that becomes an order stays the same card
  (lead -> offer -> order -> paid). Another tour = another card.
- **Order number** = a `T` number for every order: site bookings already have one (`tours.bookings.ref`); a staff-typed
  order (a seat row of a case, positive pax, not an online booking's row) now gets one too
  (`departure_sales_entries.ref`, trigger, same sequence `tours.booking_ref_seq`).

## Who is who (database, `public.leads_fill` BEFORE INSERT)

1. `customer_id` given (the backoffice's "+ New card") -> kept. Else the phone's key finds the company's customer. Else a
   new customer is made from the row (names, phone, e-mail). A visitor's form never writes over a known customer.
2. No rep on the row -> the rep of the customer's newest card (a known customer goes back to whoever handled them).
3. A **site form** (not a booking, not staff-typed):
   - names a tour the customer has an OPEN card for -> it **joins** that card: the new row is stored soft-deleted with
     `payload.joined_into`; the card gets `payload.inquiries[]`, follow-up today, and `חזר` when it was `אין מענה`,
     `הצעה נשלחה` or `ליד עתידי`;
   - names no tour while the customer has open cards -> `to_file = true`: "Inquiry to file", the rep picks the card or
     opens a new one;
   - anything else -> a new card.
   Bookings (`tours.booking_create`) keep their own matching (the link's token, then an open lead) and are untouched.
4. E-mail alone never joins: the customer page shows "maybe the same customer" (same e-mail, no shared phone) with
   Merge / Not the same.

## Statuses (one per card, no TASK)

`חדש · אין מענה · חזר · הצעה נשלחה · ליד עתידי · ממתין לתשלום · שולם מקדמה · שולם · לא רלוונטי · בוטל` (+ spam).
Retired and switched off (nothing deleted): בטיפול, פולו אפ, נסגר, תשלום נכשל, בדיקת תשלום. Existing cases move
(done -> paid; payment_failed / payment_review -> pending_payment; in_progress / follow_up -> offer_sent when an offer
exists, else no_answer). Follow-up is a DATE, not a status. `ליד עתידי` needs a tour and a season
(`leads.season`, e.g. "פסח 2027", from the tour's departures and seasons). `שולם מקדמה` counts as paid (seats held).
**A site payment never sets a card paid:** the gateway's answer moves it to `ממתין לתשלום` and the booking shows
the result; the rep confirms (`Confirm -> שולם`). A payment staff checked (`review -> paid` on the booking) does set it.

## Screens

`/tours/reservations` = **TODAY | RESERVATIONS | LEADS | ALL**.
- TODAY: every card waiting for a rep, with the reason, in this order: came back · site payment to confirm ·
  inquiry to file · new · follow-up late · follow-up today · confirmation to send.
- RESERVATIONS: one row per order (site booking or staff order); Live / Past / Cancelled.
- LEADS: cards with no order; Open / Closed.
- ALL: the previous table (bulk, export).
`/tours/customers/[id]` (and `/tours/reservations/[cardId]`, which opens the card's customer with that card open):
the customer header (fields, phones, merge, suggestion), the inquiries to file, open cards, then History (closed cards
and past trips). An open card is the old case page without its customer block.

## Rules - pure, `lib/tours/cases.ts`, `scripts/tours-cases-selftest.ts`

`todayReason`, `cardGroup`, `routeInquiry` (TS twin of the SQL routing), `knownFrom`, `sameEmailSuggestion`,
`seasonOptions`, `checkFuture`, the new status list and `SYSTEM_STATUS_KEYS`, `statusAfterLink` / `seatGap` with
`deposit_paid`.

## Build order

1. Migration `20261019180000_tours_customers.sql` (+ dry run on prod inside a rolled-back transaction).
2. Pure rules + selftest.
3. Shared reads move to `lib/tours/case-reads.ts`; actions `lib/actions/tours-customers-actions.ts`.
4. UI: board, customer page, embedded card, dialogs (future lead, move card, merge customers).
5. Types, guide, CLAUDE.md, typecheck, selftests, commit; push on Dor's word; migration green; check on prod.
