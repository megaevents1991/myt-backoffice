# XS2Event as a third ticket supplier - plan

**Status:** plan only (Dor, 2026-09-28). Nothing built.
**Asked by:** Alon, doc tab "שתי ספקים חבילה אחת" item 2 - "check how to connect more
suppliers like AXS, which we already have in the system".

## "AXS" = XS2Event

Neither repo mentions AXS anywhere. The supplier "we already have in the system" is
**XS2Event** - the "Sports events" provider (`xs2e_events`, `/sports-events`,
`sports_event_dynamic`). If Alon meant the real AXS (the ticketing company), that is a
new API partnership and starts with getting access, not with code.

## Why XS2Event is worth it (measured 2026-09-28, prod, read-only)

- 3,357 future XS2Event fixtures in `xs2e_events`, synced daily already.
- **209 of our 425 live TixStock events are the same fixture at XS2Event** (same day,
  2+ shared name words); **173 of them have stock** (`number_of_tickets` / a min price).
  Examples: Arsenal-Tottenham, Chelsea-Liverpool, Napoli-Brugge, Milan-Fiorentina.
- Their API already answers per ticket what an attached supplier needs:
  `ticket_id`, `category_id`, `category_name`, `net_rate` + `currency_code` (what we pay),
  `stock`, `min_order`, `ticket_status`, `type_ticket` (e-ticket / app / paper / collection),
  `ticket_targetgroup` (regular / youth / retired / disabled).
  Read today by `app/api/sports-events/live-tickets/route.ts` and
  `ticket-price-sync.ts` `processXS2ETicket`.
- The price advisor already quotes XS2Event as "מידע בלבד" (`price-alternatives.ts`) -
  it becomes an attachable supplier the moment this lands.

## What "adding a supplier" means here

`lib/suppliers.ts` (both repos) says it: add it to `SUPPLIERS`, write its adapter,
nothing else names suppliers. LiveTickets (attached 2026-09-18) is the template.

### Backoffice (~1 day)
1. `SUPPLIERS` + label: `"xs2event"`.
2. Candidates: `findXs2Candidates(nameEnglish, date)` over `xs2e_events` (±3 days, name
   words, `date_confirmed` shown) - same shape as `findLiveTicketsCandidates`.
3. Drafts: `buildXs2Drafts(eventId)` - live tickets of that event -> `EventTicket`
   (`id` = their `ticket_id`, `eid` = their `event_id`, `supplier: "xs2event"`,
   `supplierCategory` = `category_name`, price = `supplierPriceUsd(net_rate, currency)`).
4. Suppliers & zones: a 4th board column, the same zone picker / venue template /
   `zone-suggest` (their `category_name` is the matching key).
5. Price sync: `syncAttachedXs2()` next to `syncAttachedLiveTickets()` - refresh price +
   `available` of attached tickets only, report new categories, never publish them.
6. `carriesToAnotherFixture` already says no for XS2Event ids - batch / memory are safe.

### Main (~1 day)
1. `SUPPLIERS` / `LIVE_SUPPLIERS` + `GET /api/xs2event/tickets?eid=` (short server cache,
   like `lib/livetickets.ts`).
2. `supplier-offers.ts`: `priceXs2Ticket` - by `ticket_id`, `stock >= qty`,
   `qty >= min_order`, buffered DB price when down, dropped while loading.
3. `confirm-order`: `validateXs2Offer` - still on sale, stock, price floor (copy of
   `validateLiveTicketsOffer`).
4. Ops mail + reservation page: "BUY FROM: XS2EVENT" with their ticket / category id.

### QA (~half a day) on a test event, like 1130.

## Decisions for Dor before building

1. **Price:** `net_rate` + EUR €40 markup + 3.5% card fee (`supplierPriceUsd`, same as
   LiveTickets / TixStock)? Their `face_value` is informational only.
2. **Buying:** ops buy by hand from the order mail (as with LiveTickets today), or book
   through their API (`net_rate` is "required for purchasing") - a later phase?
3. **Which tickets qualify:** only `ticket_status: available`, `ticket_targetgroup:
   regular`, and e-ticket / app tickets? (`paper-ticket` / `collection-stadium` mean
   delivery work.)
4. **Seating:** XS2Event carries no "sit together" promise in these fields - sell with no
   seating line, or only a party of 1-2?
5. **Same ticket at two suppliers:** the zone rule already shows only the cheaper one
   (`cheapestSupplierPerZone`) - keep?

## Suggested order

Build XS2Event as the adapter TEMPLATE (a small `SupplierAdapter` shape per repo:
candidates / drafts / sync / live price / confirm check) so supplier #4 is a new file,
not another copy of the LiveTickets path.
