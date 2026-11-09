# Book ticket on the reservation page: TixStock booking (+ the site checkout TixStock tests) - design

Date: 2026-11-09. Author: Claude with Dor. Status: draft for Dor's approval.
Sources: TixStock's Partner Integration Guide (https://dropbox.tixstock.com/p/partner-integration-guide-aba084,
read 09.11, including its Integration Checklist / validation criteria) and its swagger; TixStock's answers in the
WhatsApp group on 09.11 (quoted in 5). Builds on the RateHawk design of the same day
(`2026-11-09-ratehawk-hotel-booking-design.md`): its fulfilment panel (7.1), manual marks and visibility gate
(7.7). **This design replaces that document's ticket row** ("no API yet, manual mark only") for TixStock tickets.

## 1. Intent

Today, once a customer has paid, ops buy the ticket by hand on TX Trade and send it to the customer (mostly by
email, sometimes WhatsApp as well). Dor wants the last row of the fulfilment panel, **Book ticket**, to run
TixStock's API flow from the backoffice: live listings -> hold -> order -> fulfilment webhook -> a staff member
checks the ticket -> "שלח ללקוח". Phase 1 is mainly to see that the whole flow runs smoothly; later the site books
the ticket by itself for every paid order.

TixStock issues a production token only after a health check that runs on **a working website checkout**
(answer 09.11: "No, We will need a working checkout to perform testing our side as well, before going live").
So phase 1 also builds the site checkout they test - on a **hidden test event on the production site, wired to
TixStock's sandbox**. After TixStock approves, real orders are booked from the backoffice button. The site's own
booking stays on the test event until Dor turns it on for real orders (a later design).

The ticket is still last in the panel: an Approved TixStock order is final and cannot be cancelled through the API.

## 2. Goals

1. **Book ticket** in the backoffice for a TixStock reservation: re-find live listings, pick one, see the gap
   against the cost the site sold at, hold -> order as Approved, release the hold on any failure.
2. A **ticket booking card**: status, TixStock order id, the listing as booked, cost vs sold, buyer and attendees
   as sent, and the tickets / links / proof as they arrive; "שלח ללקוח" (email), a copy for WhatsApp, update
   attendees, refresh.
3. A **webhook receiver** in the backoffice that stores what TixStock sends and answers the way TixStock requires.
4. **The site checkout TixStock tests**, on the hidden sandbox event: hold at checkout and release, Italian
   attendee details, order after payment (Sale on Hold -> Approved), confirmation page with benefits &
   restrictions, delivery date and ticket type, and a ticket page that shows the tickets after fulfilment.
5. Everything TixStock's health check needs: the test event with listings of every ticket type and split type,
   the Juventus FC vs Como mapping, and our answers with screenshots for their validation document.

## 3. Non-goals

- The site booking real orders (later: a switch plus its own small design - see 7.12).
- Other ticket suppliers (LiveTickets, XS2Event, P1, own stock): the ticket row keeps the "טופל ידנית" mark.
- Refunds to the customer's card: there is no CreditGuard refund call; Dor refunds test charges by hand.
- Paper tickets and season cards on the site's test event (not in TixStock's ticket-type checklist).
- Sending WhatsApp from the backoffice: the card copies a ready text, staff send it themselves.
- Changing how the site shows or prices TixStock tickets for real events. The one-card-per-zone view stays
  (TixStock 09.11: "Showing the listings based upon the best price available etc could be your business
  decision, That is okay with us").
- Cancelling an Approved order through the API (TixStock: through their CS team only).
- Build Your Euro Trip rows: manual mark only, as in the RateHawk design.
- IP whitelisting / static IPs (TixStock agreed to waive it on 09.11).

## 4. Anti-goals - failure even if it "works"

- **A ticket bought twice**: double click, two tabs, a retry after a timeout, or the site and the button on the
  same reservation. Real money, and Approved is final.
- **A real customer's reservation booked on the sandbox** (the customer paid, no ticket exists), or a **test
  reservation booked on production** (real money).
- A ticket bought from the button before the flight and the hotel steps are done (except through the manual marks).
- **A TixStock order created before payment is confirmed** (site flow).
- **A ticket file readable by anyone who guesses an order id.** Today the confirmation page reads the order by its
  sequential id (`/api/confirm-order/{orderId}`, an open security TODO).
- A customer getting a ticket that staff have not checked (button flow). The exception is an external transfer,
  where the supplier sends the ticket directly.
- **Real events on the live site behaving differently in this work.** Everything new on the site runs only on
  `tixstock_booking` test events (7.8). That includes the ticket step, the listing rules and the Italian form.
- Passport numbers anywhere the partner portal or the flight-pax export read (`more_pax_info`).
- The sandbox test event broken by backoffice crons that assume production TixStock ids (the price sync
  auto-deactivates events whose categories it cannot match; the purge cron).
- A Sale on Hold order left more than 2 hours.
- Any user seeing the button before Dor opens it.

## 5. Constraints

### From TixStock (guide + answers 09.11)

- **Hosts:** sandbox `https://sandbox-pf.tixstock.com/v1`, production `https://pf.tixstock.com/v1`. Bearer token.
  The sandbox token was posted in the WhatsApp group; **Dor puts it in `.env.local` himself** (Claude never types
  tokens). Reseller Admin (tokens, webhooks, logs): `https://sandbox-resellers.tixstock.com`. Seller Portal
  (create our own test listings, fulfil our own test orders): `https://sandbox-new.tixstock.com`. The sandbox feed
  returns only our own seller's listings; "In sandbox, no one fulfils for you".
- **IP whitelisting:** waived for our account (09.11: "Yes, We can help with this", DB to assist).
- **Endpoints:** `GET /tickets/feed?event_id=&target_currency=USD` (listings with split type, quantity,
  `display_quantity`, `instant_download`, `restrictions_benefits`, `delivery.type`,
  `delivery.shipped_date_or_date_in_hand`); `POST /tickets/hold {listing_id, quantity}` -> `meta.hold_id`
  (auto-release after ~10 min); `POST /tickets/release/{hold_id}/{quantity}`;
  `POST /orders/add/{hold_id}/{quantity_sold}`; `POST /orders/update/{order_id}`; `GET /orders/get/{order_id}`.
  Errors: 100/101/401 token, 102/103 IP, 106 quantity, 108 hold exceeds availability, 109 release exceeds on-hold,
  110/111 authorisation, 429 rate limit.
- **orders/add body:** `order_status`, `datetime` (ISO-8601 like `2026-05-23T20:45:00+0000`; a wrong format
  answers 200 with `[]`), one `customer` (the buyer: `first_name`, `last_name`, `email_address`,
  `contact_number`, addresses), `items[]` **one per ticket** (`general_admission`, `row`, `seat`, `price`,
  `customer` = the attendee). orders/add carries no id of ours: `orders/update` / `orders/get` take the order id
  TixStock returns. **A lost orders/add answer cannot be looked up by an id of ours** (7.4).
- **orders/update** accepts `order_status`, `ticket_type`, `customer`, `shipping_address`, `items` - attendee
  changes after the sale go through it.
- **Statuses.**
  - **Sale on Hold:** 09.11: "You can start the order flow with sending sale on hold, But fraud check is basically
    on your end, That we expect to be completed within 2 hours, and the order to be moved to approved status".
    Past 2 hours it is not cancelled, but it raises a flag on TixStock's side.
  - **Cancel from Sale on Hold:** allowed, "though it happens one off / rarely".
  - **Approved:** final ("Tixstock considers all approved sales as final, And expects to be paid for the order").
    Cancelling one goes through TixStock's CS team.
  - **Commissionable:** set automatically when the seller fulfils, and the fulfilment webhook carries the new
    status. We do not set it.
- **Customer details.** 09.11: "as thumb rule, we'll be needing email, phone number and the name of the buyer".
  "Each attendee details are required only for italian events, You can use country filter". The signal is
  `venue.country_code` = `IT`. Italian attendee details, per attendee (09.11): full name, passport number (complete,
  as on the ID), nationality, place of birth (if Italian), date of birth. TixStock tells us when other
  events/leagues change their requirements.
- **External transfers** (e.g. EPL): "our suppliers would be sending / transferring tickets to the end customer
  directly ... we would be requiring you to send name, email and phone number of the customer", with proof of
  delivery via the API. So the buyer we send is **the real customer**, never the office mailbox.
- **Currency:** we pull listings with `target_currency=USD`; payouts follow the currency the sale was made in
  (base currency USD, told to TixStock 09.11).
- **Every listing in the partner feed is bookable** (some are hidden from TX Trade by TixStock's own decision).
- **Ticket types we must handle:** E-Ticket (PDF), Mobile Link (URL), External Transfer (proof only), Mobile
  Screenshot (PDF).
- **Split types** (exact strings): None, Single Seats, Sell in Multiples (`split_quantity`), Avoid Leaving One,
  All Together. Plus `display_quantity`.
- **Webhooks:** registered in the Reseller Admin Area per environment, versioned (`Tixstock-Version`), signed
  (`X-Tixstock-Signature`; the guide does not say how to verify it - question 10.1).
  - **Types:** `ticket.hold`, `ticket.release`, `order.update` (we answer with the order status),
    `ticket.fullfillment` (listing level), `order.eticket_fulfilment` (base64 PDF `file`),
    `order.mobile_ticket_fulfilment`, `order.mobile_link_ticket_fulfilment` (`mobile_links[{seat, link}]`),
    `order.paper_ticket_fulfilment`.
  - **Common fields:** `order_id`, `id` (listing), `row`, `seat`, `file`, `proof_file_url[]`, `additional_file`
    (instruction letter).
  - **Required answer:** `{external_id, order_status, message, success}`.
  - **Count:** an e-ticket order of quantity n fires n webhooks (the last one carries Commissionable); a mobile
    order fires one.
- **TixStock does not email e-tickets to the buyer** ("you deliver those to your customer"); external transfers
  are the exception.
- **The health check** (their validation board) runs on our site:
  - **Listings:** all ticket types; instant download; quantities; split types; max display quantity; benefits &
    restrictions on the listing; delivery date; force release at checkout; accurate listing details.
  - **Fulfilment:** customer details for all ticket types; attendee updates after the sale reach TixStock;
    ticket/proof loads on the site after fulfilment; status flow; benefits & restrictions on the confirmation;
    the sale matches the listing; the Serie A attendee flow on **Juventus FC vs Como, 11.06.2027, sandbox id
    `01kja2n8zk31zyv0z7zxkzf8vd`**.
  - **Mapping:** category & section; map highlight; filter.
  - **Customer service:** instruction documents.
  
  They test on "a live production site ... or sandbox if you have one". Production onboarding may pause in peak
  periods.

### From MYT

- **Backoffice conventions:** Next 15 Server Actions, shadcn/ui, `lib/auth/guards.ts` on every action,
  `logAudit`, `{ok:false, kind}` instead of throwing, crons in `vercel.json`.
- **The RateHawk design's fulfilment panel is not built yet** (master has no panel today). This ticket row is
  built with it or after it, and uses its `reservations.fulfilment` marks and its gate.
- **The reservation's ticket:**
  - **`event_order_info`:** `category`, `number_of_ticket`, `supplier`, `supplier_event_id` (the TixStock event
    id), `supplier_category`, `seating_choice`, `vendor`.
  - **The cost snapshot:** `reservations.ticket_cost_usd` / `ticket_cost_source`, written at confirm-order by
    `lib/ticket-cost.ts` from the cheapest matching live listing.
  - **The listing id is not stored**, so the dialog re-finds it.
  - **Rows typed in by hand** (`vendor: TXTRADE`) may have no `supplier_event_id`.
- **The site's travellers' form:**
  - **Every traveller:** first + last name.
  - **The lead contact only:** phone + email.
  - **Columns:** `main_contact_*` and `more_pax_info[{first_name, last_name}]`.
  - **Not collected:** date of birth, nationality, passport.
  - **Who reads `more_pax_info`:** the partner portal (`lib/actions/portal-actions.ts`) and the flight-pax export.
- **The ticket step for TixStock (`app/order/TicketSelection.tsx`):**
  - **One card per category**, priced from its cheapest live listing (`cheapestTixstockListing`,
    `lib/supplier-offers.ts`). The customer never picks a listing.
  - **Not shown to customers:** benefits & restrictions (they appear only in the `?debug` panel), ticket type,
    split type, delivery date, instant download.
  - **`display_quantity` is not applied.** The quantity rule `listingCanSatisfyQuantity` is mirrored by the
    backoffice price sync.
- **Order read by sequential id:** `/api/confirm-order/{orderId}` (`app/api/confirm-order/[id]/route.ts`). The
  CreditGuard check in `validateAndRecordPayment` asks about the txId alone, so the txId on the confirmation URL
  is no real gate.
- **Payment:** CreditGuard. `validateAndRecordPayment` (`app/api/payment/validateAndRecord.ts`) writes Paid
  first, then the email. Two callers: `app/api/payment/[id]/[txId]/[promoCode]` and
  `app/api/confirmation/[orderId]/[promoCode]/[result]`.
- **Confirmation page:** `app/confirmation/[...params]` (client), reads the order through
  `/api/confirm-order/{orderId}`.
- **TixStock env today** (both apps, production feed): `NEXT_SECRET_TIXSTOCK_API_URL` / `NEXT_SECRET_TIXSTOCK_TOKEN`.
- **Backoffice TixStock crons:** `lib/services/tixstock-sync.ts` (the price sync, which auto-deactivates on
  category mismatch) and `app/api/cron/purgeTixstockEvents`. Both act on every TixStock event.
- **Shared DB:** shared types `lib/app.types.ts` <-> `types/app.types.ts`. `is_test` events exist (1130) and are
  kept off the catalog.
- **Git:** shared checkouts, commit by explicit path, no `git merge`, push only when Dor says so.

## 6. Decided by Dor (09.11.2026)

1. The backoffice button runs TixStock's full flow once the customer has paid and the flight and the hotel are
   done. Phase 1 is mainly to check that everything runs smoothly; later the site books automatically for every
   paid order.
2. Delivery: **a staff member checks the ticket, then clicks "שלח ללקוח"**. Email is the usual channel, sometimes
   WhatsApp as well.
3. **Price drift:** when the live listing is dearer than what was sold, staff still buy, with a warning that shows
   the gap. No threshold ("today we work like this and it's fine").
4. TixStock's test runs on **a hidden event on the production site wired to the sandbox**.
5. TixStock's testers **pay a small real amount** on it and Dor refunds them. No payment bypass on production.
6. After TixStock approves, the backoffice side books real orders.
7. The Italian attendee signal is `venue.country_code` = `IT`.
8. Base currency USD (told to TixStock).

## 7. The design

### 7.1 The ticket row in the fulfilment panel

- Enabled when the hotel step is done (the RateHawk design's rules, 7.1 there).
- **Book ticket** shows when the reservation's ticket is TixStock (`supplier = 'tixstock'`, or implied by
  `event.type = 'tx_event'`) and the reservation is Paid. Other suppliers get only the manual mark.
- The step is **done** when a TixStock booking reaches Approved or Commissionable, or by the manual mark
  ("טופל ידנית", supplier + reference, as in the RateHawk design).
- **Reservations from before the panel opens** take the same tick "בדקתי - עוד לא הוזמן ידנית" before Book is
  enabled: a TX Trade purchase leaves nothing on the reservation.
- **No TixStock event id on the reservation** (hand-typed rows): the dialog's first step asks staff to pick the
  TixStock event from the backoffice `tixstock_events` table (search by name/date). The choice is stored on the
  booking row, not on the reservation.

### 7.2 Book ticket - the dialog

1. **Listings:** `GET /tickets/feed?event_id=<id>&target_currency=USD` on the reservation's environment (7.9),
   loaded fresh each time the dialog opens. Filtered with the site's listing rules for this quantity, as the
   backoffice already mirrors them in `lib/tixstock-listings.ts`:
   - quantity / split for `number_of_ticket`;
   - restricted view and excluded sections dropped;
   - together only when `seating_choice` is together.
   
   Ranked: listings of the sold category first, cheapest first. Then the other categories, collapsed under
   "קטגוריות אחרות".
2. **Each listing shows:** category / section, row, ticket type, split type, price per ticket x quantity,
   benefits & restrictions, delivery date, instant download. Beside it, the cost sold (`ticket_cost_usd`) and the
   gap in $ and %, with an amber warning when it is dearer (Dor: buy anyway, no threshold).
3. **Buyer:** the lead contact (`main_contact_*`), i.e. the real customer.
   **Attendees:** one per ticket, the travellers' names (lead first, then `more_pax_info`). When there are fewer
   travellers than tickets, staff type the missing names.
   **Italian event** (the TixStock event's `venue.country_code` = `IT`, read from the feed /
   `tixstock_events.country_code`; or the staff tick "האירוע דורש פרטי זיהוי" in the dialog - 8.6): every
   attendee needs full name, passport number, nationality, date of birth, and place of birth when the nationality
   is Italian. On a test event they come prefilled from the site's checkout (7.8). On a real reservation staff
   type them, as they gather them today for TX Trade. They are validated before the button enables and stored
   only on the booking row (`attendees`).
4. **Paper listing:** the shipping address is prefilled from the reservation's hotel (name, address, check-in
   date) and is editable.
5. **Confirm:** a red line "רכישה סופית - הזמנה מאושרת ב-TixStock לא מתבטלת" plus a tick, then **הזמן כרטיס**.
   The server action:
   - takes the lock (inserts the booking row as `holding`; the partial unique index of 7.3 refuses a second
     one) and audits;
   - `POST /tickets/hold` for exactly `number_of_ticket`, then the row goes `on_hold` with `hold_id`;
   - `POST /orders/add/{hold_id}/{qty}` with `order_status = Approved` (the fraud check is long done: the
     customer paid before the flight and hotel were booked). The row goes `approved`, with TixStock's order id.
   
   Hold and order run in one action, seconds apart, well inside the 10-minute hold.
6. **Failures:**
   - hold refused (gone, 108) -> `failed` with the reason; the dialog reloads the listings;
   - orders/add refused with a clear error -> release the hold, `failed`;
   - **orders/add with no answer** (timeout, 5xx, network) -> `uncertain` (7.4); never call orders/add again.

### 7.3 Data (our call)

**`ticket_bookings`**, one row per attempt:
- `id`, `reservation_id` (FK), `env` (`sandbox` | `production`), `source` (`office` | `site`).
- `tixstock_event_id`, `listing_id`, `hold_id`, `tixstock_order_id`, `quantity`.
- `status`: `holding` | `on_hold` | `sale_on_hold` | `approved` | `commissionable` | `failed` | `released` |
  `uncertain` | `cancelled`.
- **The listing as booked:** category, section, row, ticket type, split type, benefits & restrictions, delivery
  date, instant download.
- **Money:** price per ticket + currency (USD), total, `cost_sold_usd` (from the reservation), `gap_accepted_by`.
- **Sent to TixStock:** `buyer`, `attendees` (jsonb).
- `last_error`, `created_by`, `created_at`, `approved_at`, `commissionable_at`.
- **Delivery:** `checked_by/at`, `sent_to_customer_at/by`, `sent_channels`, `released_to_customer_at`.
- `customer_token`: random, 32+ bytes, for the ticket page (7.7).

**Partial unique index** on `reservation_id` where status in (`holding`, `on_hold`, `sale_on_hold`, `approved`,
`commissionable`, `uncertain`). It covers the site and the button alike: one live booking per reservation.

**`ticket_booking_files`:** one row per ticket / link / proof / instruction file:
- `booking_id`, `kind` (`pdf` | `mobile_link` | `proof` | `additional`);
- `row`, `seat`, `storage_path` or `url`;
- `received_at`, `webhook_event_id`.

Files are stored in a **private** Supabase Storage bucket (never `public_resources`).

**`tixstock_webhook_events`:** a raw log (type, env, signature valid, payload without the base64 bodies,
received_at, handled result), for replay and debugging.

Additive DB changes. The site never writes the new tables, except the booking rows of its own test flow (7.8).

### 7.4 `uncertain` - an order TixStock may have created

orders/add with no answer may still have created the order, and there is no id of ours to look it up by.
An `uncertain` row blocks any new booking for the reservation. It is resolved by:
- **an order webhook** for that listing and quantity soon after (`order.update` / fulfilment carry `order_id`
  and the listing id) -> `approved` with that id;
- **TixStock's answer to question 10.2** (a lookup by `hold_id`, if it exists) - the builder adds it then;
- **staff**, after checking TixStock / TX Trade: "בדקתי - נוצרה הזמנה <id>" or "בדקתי - לא נוצרה", with a
  note, audited.

The card shows it in amber: "לא ודאי - לא להזמין שוב עד שיתברר".

### 7.5 The webhook receiver (backoffice)

`POST /api/tixstock/webhook/[env]`. It is public, because TixStock calls it.
- **Signature:** `X-Tixstock-Signature` is verified with that environment's secret (10.1). A bad or missing
  signature answers 401 and is logged.
- **Idempotent** on (order id, type, listing, row, seat): a repeat stores nothing new and answers the same.
- **Fulfilment types:** the file goes to the private bucket, or the link / proof URL is stored, and the
  instruction letter goes in as `additional`. The booking takes the status the payload carries (Approved /
  Commissionable). The answer is `{external_id: <TixStock order id>, order_status: <the status we now hold>,
  message, success: true}`.
- **`order.update`:** answers with our row's status.
- **`ticket.hold` / `ticket.release`:** logged only.
- **An unknown order id** is logged and answered `success: false`.
- **Staff see** "כרטיסים התקבלו - לבדוק ולשלוח" on the card, and a reservations-list filter for "התקבלו ולא
  נשלחו" (builder: reuse the list's existing filters).
- **Refresh** on the card: `GET /orders/get/{id}`, handled the same way. The builder adds a daily cron to refresh
  approved orders whose event is near and that still have no tickets.

### 7.6 Check and send (backoffice card)

- **The card lists each ticket:** PDF (open / download through a signed URL), mobile link, proof files, the
  instruction file.
- **Sending:** staff tick "בדקתי את הכרטיסים", then **שלח ללקוח**. This sends an email to the lead contact from the
  backoffice mailer, in Hebrew, RTL, with:
  - event, date, seats, delivery notes, benefits & restrictions, and the ticket page link (7.7);
  - for e-tickets / screenshots, the PDFs attached as well (builder: fall back to the link alone above the
    mailer's size limit);
  - for a mobile link, the link(s);
  - for an external transfer, "הכרטיסים מועברים אליך ישירות על ידי הספק - בדקו את תיבת המייל". The proof is not
    sent: it is our cover in a dispute.
  
  It records `sent_to_customer_*` and `released_to_customer_at`.
- **WhatsApp:** **העתק לוואטסאפ** copies a ready Hebrew text with the ticket page link. Staff paste it and send it
  themselves, then mark "נשלח בוואטסאפ" (adds to `sent_channels`).
- **Update attendees:** staff edit the details, then `POST /orders/update/{id}` with the items. The change is
  audited, and TixStock's checklist requires it.
- **Test bookings** (`env = sandbox`) carry a badge "בדיקה - סנדבוקס".

### 7.7 The customer's ticket page (myt-main)

- `/ticket/[token]`. The token is the booking's `customer_token`, never derived from the order id; the page is
  `noindex`.
- **It shows:** event, date, category / section / row, ticket type, quantity, delivery date, benefits &
  restrictions.
- **Once the tickets are released:** each PDF (through a site route that checks the token and streams the file
  from the private bucket), mobile links, and the "transferred directly by the seller" note.
- **Before release:** "הכרטיסים יישלחו אליכם עד <delivery date>".
- This is the "ticket loads on the partner website" item of TixStock's check. For real orders it is the link
  inside the "שלח ללקוח" email.

### 7.8 The site checkout on the sandbox test event (myt-main)

**Wiring:**
- A new nullable column, `events.tixstock_booking`:
  - `sandbox_site`: listings from the sandbox feed; the site books after payment. This is TixStock's test.
  - `sandbox_office`: listings from the sandbox feed; the site does not book, and the backoffice button does. Its
    purpose is to rehearse the button before approval.
- **Honoured only when `is_test` is true.** On any other event it is ignored and logged.
- Added to the shared `Event` type (both repos, `/sync-types`).
- **Kept out of the backoffice price sync and purge crons**, and out of every feed and catalog list the builder
  finds still reading `is_test` events.

**The flow (`sandbox_site`):**
1. **Ticket step** - a branch for `tixstock_booking` events only; real events keep today's code and rules:
   - **Listings:** the site's TixStock route reads them from the sandbox host / token for this event.
   - **The cards stay one per category** (TixStock agreed, 09.11). Each card is priced by ONE listing, the
     cheapest that fits, and shows **that listing's** details: ticket type, split type (Single Seats carries
     "ייתכן שהמושבים לא יהיו צמודים" on the card and again in the summary), benefits & restrictions, delivery
     date, instant download, and the quantity available. The quantity honours `display_quantity`, in this
     branch only, so the backoffice price sync's mirror of `listingCanSatisfyQuantity` is untouched.
   - **The order carries the listing id** of the card the customer picked, from the ticket step to
     `confirm-order` (request field, stored only on the booking row).
2. **Summary, travellers' form:** when the TixStock event's venue is in Italy (`venue.country_code` from the
   sandbox feed), every traveller adds passport number, nationality and date of birth, plus place of birth when
   the nationality is Italian. Names already exist. The fields are required and validated, and sent with the pay
   click. They are stored **only on the booking row** (`attendees`), never in `more_pax_info` or another
   reservation column, so no shared type changes for them.
3. **Pay click (`confirm-order`):**
   - **Hold exactly the listing the card carried**, after checking it belongs to the event, fits the quantity
     and split rules, and is not priced above what the customer is paying for it (the `validateLiveTicketsOffer`
     pattern);
   - store the booking row `on_hold` (`source = site`) with `hold_id`, the listing snapshot and the attendees;
   - if that listing is gone or dearer, answer `TICKET_UNAVAILABLE`, and the summary sends the customer back to
     the ticket step (the `HOTEL_NOT_REFUNDABLE` pattern) to see the fresh cards;
   - if the reservation insert fails after a hold, release it.
4. **Payment fails or is cancelled** -> release the hold -> `released`. If the customer abandons on CreditGuard's
   page, TixStock's 10-minute auto-release handles it, and a sweep marks our row `released`.
5. **Paid:** right after `validateAndRecordPayment` has written Paid:
   - `orders/add` with `Sale on Hold` -> `sale_on_hold`;
   - then our fraud check, the CreditGuard verification that function already does -> `orders/update` Approved
     -> `approved`, seconds later.
   
   If the hold expired (the customer took over 10 minutes on the payment page), the site holds the same listing
   again and adds the order. If that listing is gone, the row goes `failed` with an alert to ops: the customer
   paid, so ops handle it as today.
   
   This step is non-fatal for the payment record, like the email. It is idempotent: two callers reach
   `validateAndRecordPayment`, and the row's status is changed by compare-and-swap.
6. **Confirmation page:** for such orders it adds benefits & restrictions, delivery date and ticket type, and
   says "קישור לכרטיסים נשלח אליכם במייל". **The ticket page link is never returned by the order-read route**
   (`/api/confirm-order/{orderId}` is keyed by the sequential id, and the txId gate is not real - 5). It goes
   **only in the confirmation email**: the booking row and its token exist from the pay click, before the email.
   The open order-read issue itself is not fixed in this work.
7. **Webhook** -> files (7.5). For `sandbox_site` bookings the tickets are released to the ticket page as they
   arrive (that is what TixStock tests), with no staff step.

Where the code lives:
- **myt-main:** a small TixStock booking client (hold, release, add, update) for the test flow.
- **Both repos:** the rules that build the request (buyer, one item per ticket, attendees, the Italian fields,
  the `datetime` format) are a **pure module, byte-identical in both repos** (precedent:
  `lib/homepage/merge.ts`, `lib/currencyApi.ts`), with unit tests.
- **Backoffice only:** the webhook and the card.

**The Italian form on real events is not in this work.** For real Serie A orders, staff type the attendees in the
dialog (7.2). The form comes to real events with the site's own booking (7.12), when its signal (TixStock events
only, or also LiveTickets / own stock in Italy) and its effect on conversion get decided.

### 7.9 Environments and keys

**Backoffice:**
- `NEXT_SECRET_TIXSTOCK_SANDBOX_URL` (`https://sandbox-pf.tixstock.com/v1`) and
  `NEXT_SECRET_TIXSTOCK_SANDBOX_TOKEN`, which Dor pastes in.
- `NEXT_SECRET_TIXSTOCK_BOOKING_TOKEN`: production booking, empty until TixStock issues it (10.4). A separate name
  even if it turns out to be the feed token.
- `NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING=true` opens production booking. Unset, Book on a real reservation refuses
  with "TixStock - הזמנה בפרודקשן עוד לא נפתחה".
- Webhook secrets per environment (names follow 10.1).

**myt-main:** `NEXT_SECRET_TIXSTOCK_SANDBOX_URL` / `_TOKEN`, server-only, used only for `tixstock_booking` events.

**The existing `NEXT_SECRET_TIXSTOCK_API_URL` / `_TOKEN`** (feed, sync, the site's ticket step) stay untouched in
both apps.

**The environment is decided by the event, never by a global switch:**
- `is_test` + `tixstock_booking` set -> sandbox;
- not `is_test` -> production;
- `is_test` without `tixstock_booking` -> refused (a test reservation never books on production).

**A booking never falls back** to the other environment.

### 7.10 Visibility gate

The RateHawk design's rule (7.7 there): `NEXT_SECRET_FULFILMENT_OPEN` not `true` -> superadmin only; `true` ->
admin + superadmin. It is checked in the page and in every ticket action and route (except the public webhook,
which is signed). The site's sandbox flow needs no gate: it exists only on the hidden event.

### 7.11 The health-check package (what goes to TixStock)

1. **The test event:** a new `is_test` event, ticket-only mode, `tixstock_booking = sandbox_site`, mapped to
   Juventus FC vs Como (sandbox `01kja2n8zk31zyv0z7zxkzf8vd`, venue IT -> the Italian flow). The builder may add a
   second, non-Italian sandbox event for the plain flow if the sandbox feed has one.
2. **Listings we create in the Seller Portal:** each ticket type (e-ticket, mobile link, external transfer,
   mobile screenshot); each split type; one with `display_quantity` below its quantity; one instant-download;
   benefits & restrictions values; categories / sections that match our venue map (`data-zones`, set in the
   event editor).
3. **Price:** a low listing price and a low `ticket_only_markup`, so a test costs a few shekels. The builder
   checks `confirm-order`'s price-floor guard. Test reservations stay out of every dashboard / partner /
   marketing number (the same builder item as the RateHawk design).
4. **A second event with `sandbox_office`,** to rehearse the button end to end before approval.
5. **Our answers:** a copy of TixStock's validation document with a screenshot per item. Claude drafts, Dor sends.
6. **Dor refunds** the testers' charges in CreditGuard.

### 7.12 Later: the site books real orders (not in this work)

The switch generalises `sandbox_site` to real events. Sale on Hold gives a 2-hour window, so the site can catch
the ticket at payment and approve after the flight and the hotel are confirmed. It works only if they are nearly
always confirmed within 2 hours, and cancelling from Sale on Hold stays rare (TixStock 09.11). That needs the
Amadeus and RateHawk bookings automatic first. It gets its own design.

## 8. Calls Claude made (for Dor to check)

1. Three new tables (`ticket_bookings`, `ticket_booking_files`, `tixstock_webhook_events`) and a private storage
   bucket, rather than JSON on the reservation.
2. One live booking per reservation, enforced by a partial unique index that covers the site and the button.
3. `uncertain` for a lost orders/add answer, blocking any re-booking until a webhook, TixStock or staff settle it.
4. The button orders as **Approved** directly. The site's test flow orders as **Sale on Hold** and approves
   seconds later, after CreditGuard's verification.
5. The webhook lives in the backoffice (one receiver for both sources), one URL per environment.
6. Italian details: the TixStock event's `venue.country_code` = `IT`, plus a staff tick in the dialog as the
   override (the guide recommends one; TixStock said they will tell us when other leagues change). No new
   `events` column for it.
7. Italian attendee details: on the test event the customer types them in the checkout. On real reservations
   staff type them in the dialog. Stored only on the booking row, never in `more_pax_info`.
8. Non-Italian attendees: names only. The buyer is the lead contact, with phone and email.
9. Paper listings: the shipping address is prefilled from the reservation's hotel. Not offered on the site's test
   event.
10. "שלח ללקוח" emails PDFs + the ticket page link. WhatsApp is a copied text that staff send themselves.
11. The customer's ticket page, behind an unguessable token. The proof of transfer is never shown to the customer.
12. Tickets of the `sandbox_site` test flow are released to the customer page as they arrive (what TixStock
    tests). Real bookings only after "שלח ללקוח".
13. `events.tixstock_booking` (`sandbox_site` | `sandbox_office`), honoured only with `is_test`. The environment
    is decided by the event, never by a global switch.
14. A separate env name for the production booking token, plus `NEXT_SECRET_TIXSTOCK_PRODUCTION_BOOKING`. The
    feed's env stays untouched.
15. The hold at the site is placed at the pay click (`confirm-order`), not on entering the summary. The summary
    has a 15-minute timer and TixStock releases holds after about 10.
16. No Italian form on real events in this work (it comes with the site's own booking, 7.12).
17. Hand-typed reservations with no TixStock event id: staff pick the event in the dialog, stored on the booking.
18. A ticket counts as done at Approved (bought), not at delivery. Delivery is the card's own state.
19. The request-building rules are one pure module, byte-identical in both repos.
20. On the test event the cards stay one per category, each priced by one listing, and show that listing's
    details. The customer's card carries that listing id to the pay click, and exactly that listing is held (no
    re-pick of the cheapest). `display_quantity` is honoured in that branch only.
21. The ticket page link goes only in the confirmation email, never through the order-read route. The open
    sequential-id issue stays open.
22. Real events: nothing on the site changes in this work.

## 9. Left to the builder

- Module layout, names, file split; the dialog's and card's UI and copy (Hebrew, RTL, shadcn).
- Exact column types, migration files (backoffice migrations workflow), the bucket's name and policies.
- The shared-type update for `events.tixstock_booking`, and the request field that carries the listing id from
  the ticket step to `confirm-order`.
- The sweep for abandoned holds and the daily refresh cron (auth like the existing crons).
- Which feeds, catalog lists and crons must skip `tixstock_booking` events, found by reading them.
- How test reservations stay out of the numbers, and how the test events are created.
- The mailer, its attachment limit, and the email's template.
- Unit tests for the pure parts: request building, Italian validation, listing ranking, status mapping, webhook
  idempotency, the environment rule.
- Whether to start before the fulfilment panel is built (the webhook, the tables and the site test flow do not
  depend on it).

## 10. Questions for TixStock (for the CS alignment call; answers change details, not the shape)

1. How do we verify `X-Tixstock-Signature`: which algorithm, and which secret?
2. If orders/add gets no answer (timeout), how do we find whether the order was created? Can an order be looked up
   by `hold_id`, and is orders/add safe to repeat for the same hold?
3. Please confirm that in production we may place orders from our back office after the flight and the hotel are
   confirmed, sometimes days after the customer paid (as with TX Trade today).
4. Will the production booking token be our current feed token with booking enabled, or a new one?
5. Is the webhook URL registered once per environment (sandbox / production)?
6. Paper tickets: is shipping to the customer's hotel acceptable?

## 11. Builder check (09.11)

A reviewer read this as the builder and found three points. Claude settled them, and they are listed for Dor to
check (8.20-8.22):
1. The site does not show listing details today (benefits & restrictions are in the `?debug` panel only), and
   the customer never picks a listing. Settled in 7.8.1 and 7.8.3: one card per category, priced by one listing,
   showing its details and carrying its id to the hold.
2. The ticket page link must not travel through the order-read route keyed by the sequential id. Settled in
   7.8.6: email only.
3. The Italian form on real events had no clear signal and a conversion cost. Settled: it is out of this work.
   Staff type the details in the dialog, and passports never go into `more_pax_info`.
