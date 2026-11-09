# Fulfilment buttons on the reservation page: RateHawk hotel booking (+ flight, ticket) - design

Date: 2026-11-09. Author: Claude with Dor. Status: draft for Dor's approval.
Research this rests on: `docs/ratehawk/2026-11-09-etg-certification-requirements.md` (ETG API v3 docs read 09.11,
every rule below is quoted there with its source) and `docs/ratehawk/2026-11-09-etg-precert-checklist.txt`
(ETG's Pre-Certification Checklist, the Google Doc ETG sent).

## 1. Intent

Ops fulfil a paid reservation by hand today: the hotel is booked in RateHawk's extranet, the flight through
Amadeus by phone/GDS, the ticket at the supplier. Dor wants **ops to fulfil everything from the backoffice
reservation page with buttons**: Book flight, Book hotel, Book ticket, in that order.

**The order is the point.** Flight first (it must be "caught" first), then the hotel, the ticket last: a
match/concert ticket is the only piece that cannot be cancelled if another piece fails. A flight PNR and a
refundable hotel can be undone.

At the same time the hotel booking must follow ETG's API v3 rules, because ETG will only issue a **production
key** after a certification (ticket APIR-59328, Valentin Trofimov to Inna, 03.11.2026). The contract with ETG is
already signed. Once the production key exists, myt-main only swaps to it (its searches get more accurate data).

A similar flow on the customer site (book automatically when an order is Paid) comes later and is not part of
this work.

## 2. Goals

1. **Book hotel** from the reservation page: one dialog that re-finds the sold rate, prebooks it, collects the
   guests per room and books it through ETG's sequence with ETG's error rules. Works for a single hotel and for
   each segment of a split stay.
2. A hotel booking card shows the state, ETG's order id, the hotel confirmation number, the price booked; it
   downloads the voucher and cancels the booking.
3. The fulfilment order flight -> hotel -> ticket is enforced, with a "טופל ידנית" (handled manually) mark that
   unlocks the next step.
4. The Amadeus "Book flight" work (local branch `feat/amadeus-booking`) comes to master and sits in the same
   panel.
5. Everything ETG needs for certification: the two test-key bookings, a video, the checklist answers, the email.

## 3. Non-goals

- Booking from the customer site on Paid (later, its own design).
- A ticket supplier API (TixStock / LiveTickets have none we can call yet). The ticket step is a manual mark.
- Offline / own-stock hotels (`hotel.offline`): no ETG booking; the hotel step takes the manual mark.
- ETG's booking-status webhook (ETG requires polling OR the webhook; we poll).
- Static IPs / a fixed-IP proxy (Dor, 09.11: not now).
- An ETG sandbox key and ETG's seven sandbox scenarios (Dor, 09.11: not needed).
- Refunds to the customer's card (CreditGuard) - there is no refund call today and this does not add one.
- Changing how the site searches, picks or prices hotels.

## 4. Anti-goals - failure even if it "works"

- **A hotel booked twice** (double click, two tabs, retrying `booking/finish`, two status pollers). Real money.
- **A booking shown as confirmed that is not.** Only `finish/status` = `ok` confirms.
- **A test booking attached to a real customer's reservation**, or counted in any dashboard / partner /
  marketing number.
- **A test booking left uncancelled** (on the test key every booking of the test hotel is real money).
- **Any user seeing a fulfilment button before Dor opens it.**
- A hotel booked before the flight step is done (except through the manual mark).
- **Anything on the live customer site changing before ETG's production key exists and the booking flow works**
  (Dor, 09.11: "the most important thing"). That includes its ETG hosts, keys, quotas and the reservation
  writes the site makes.

## 5. Constraints

### From ETG (all sourced in the research doc)
- **Keys.** Our current key is ETG's **test key** (ETG: "to obtain a production API key..."; Dor calls it the
  sandbox key). On a test key only hid **8473727** can be booked; those bookings are **real with financial
  responsibility** (giveaway prices) and **must all be cancelled**; any other hotel answers
  `sandbox_restriction`. The production key comes after certification + the partnership step.
- **Host:** `https://api.ratehawk.com` (`api.worldota.net` is deprecated). HTTP Basic `KEY_ID:API_KEY`. Every
  answer is `{data, debug, status, error}`; read the HTTP code AND `status`/`error`.
- **Sequence:** `search/hp` (by `hid`) -> `hotel/prebook` -> `hotel/order/booking/form` ->
  `hotel/order/booking/finish` -> poll `hotel/order/booking/finish/status` -> later `hotel/order/info`,
  `hotel/order/cancel`, voucher. Caching HP or prebook answers is prohibited.
- **search/hp:** `hid`, `checkin`, `checkout`, `residency` (the guests' passport country, same for all guests),
  `language`, `currency`, `guests[]` one entry per room `{adults, children:[ages 0-17]}`, `timeout` (30 s
  recommended). Our key: 10 calls a minute.
- **Prebook:** body `{hash: <HP book_hash h-...>, price_increase_percent}`; ~60 s timeout on ETG's side (min 30
  s, we cannot set it). Returns a new `book_hash` (`p-...`, lives 6 h) and possibly a new price. **If the price
  changed, the user must see it and explicitly agree** before booking.
- **booking/form:** `{partner_order_id, book_hash, language, user_ip}`. On 5xx / `timeout` / `unknown`: retry
  with a **new `partner_order_id`**, at most 10 times, then start over from the search. `double_booking_form`,
  `duplicate_reservation`: new id and retry. `contract_mismatch`, `insufficient_b2b_balance`,
  `reservation_is_not_allowed`, `rate_not_found`, `sandbox_restriction`: stop, failed. The form lives 60 min and
  returns `payment_types[]` and `is_gender_specification_required`.
- **booking/finish:** `partner.partner_order_id`, `payment_type` = the form's `deposit` entry (type, amount,
  currency_code), `rooms[].guests[]` (`first_name`, `last_name`; children `is_child: true` + `age`), `user.email`
  = **one fixed corporate mailbox**, `user.phone`, `language`. On 5xx / `timeout` / `unknown`: **never retry
  finish** - go to status polling. Other errors: failed.
- **finish/status:** `{partner_order_id}`. `ok` = confirmed. `processing` / `timeout` / `unknown` / 5xx = keep
  polling, every 3-5 s (limit ~30 a minute), until the **booking cut-off** ETG configures for us; always one last
  call just before the cut-off; past it = failed. Final failures include `soldout`, `book_limit`, `provider`,
  `block`, `charge`, `not_allowed`, `booking_finish_did_not_succeed` and also `lock` (the same request twice
  within a short time) and `endpoint_exceeded_limit` (429) - **so never two pollers for one booking**.
- **Guests:** at least one named adult per room; names 1-50 letters, spaces and `'-,.`, no digits; **never
  invent guests** - send only the ones we have. ETG's docs: test bookings use `Ratehawk` as the last name.
- **order/info:** never decides the booking status; wait 1-2 min after confirmation before the first call. The
  hotel confirmation number (HCN, hotel's `order_id`) usually appears within 48 h: re-poll every 24-48 h, up to
  96 h after booking. A missing HCN is not an error.
- **Cancel:** `{partner_order_id}`; answers `amount_payable` (penalty), `amount_refunded`; on `timeout` retry
  once; `order_not_cancellable` = too late / not permitted.
- **Voucher:** `GET .../hotel/order/document/voucher/download/?data={"partner_order_id","language"}` -> PDF.
- **Rate limits** (example values, ours may differ): form / finish / status / cancel / order info about 30 a
  minute each.

### From MYT
- Backoffice conventions: Next 15 Server Actions, shadcn/ui, role guards (`lib/auth/guards.ts`) on every
  action, `logAudit` (`lib/audit`), actions return `{ok:false, kind}` instead of throwing, crons in `vercel.json`.
- The ETG keys live only in myt-main today (`EMERGING_TRAVEL_API_KEY` / `_SECRET`); the backoffice has none.
- The reservation stores the hotel as `OrderHotel` (`hotel_order_info`, `hotel_segments` for a split stay):
  hotel slug `id` (not `hid`), dates, `guests` per room, the whole serp `rate` (incl. `match_hash`, room,
  meal, `payment_options`), `price` = the customer's hotel price (with VAT we add). Lead contact +
  `more_pax_info[{first_name,last_name}]`; no guest-to-room split; residency was always `il`. The `hid` is
  found through the `hotels` table (slug -> `hid`).
- Shared checkout: other sessions work in the same folder. Commit by explicit path; never `git merge`; branches
  reach master through a PR Dor merges.

## 6. Decided by Dor (09.11.2026)

1. Backoffice only, for ops convenience; the site flow comes later.
2. Fulfilment order flight -> hotel -> ticket, **enforced, with a "טופל ידנית" mark** that unlocks the next step
   (offline flight, flight booked by hand, etc.).
3. Bring `feat/amadeus-booking` to master first (rebase + PR) so the three buttons live together - **but keep
   every fulfilment button hidden from users** until everything works.
4. Who may book / cancel a hotel: **admin + superadmin**.
5. ETG `user.email`: **office@megatr.co.il**.
6. No Static IPs now; no sandbox key; certify on the current (test) key.
7. myt-main: only swap to the production key when ETG issues it. **Until then the live site must not be
   touched at all.** The swap is surgical: the production key goes in under **separate env var names**, and the
   site moves to it only once everything works (so going back is removing/turning off env, not a code revert).
8. Today's (test) key stays as the fallback for every non-booking use; a booking never falls back.
9. Reservations from before the panel opens: Book needs an explicit "not booked by hand yet" tick.
10. Fix the backoffice's existing cancellation-deadline display to ETG's UTC (backoffice only).

## 7. The design

### 7.1 The fulfilment panel

A panel near the top of the reservation page with three rows in order: **Flight**, **Hotel**, **Ticket**. Each
row shows its state and its button(s). A row's button is enabled only when the row above it is **done**.

When is a step done (one pure function, unit-tested, e.g. `lib/fulfilment/steps.ts`):
- **Flight:** the Amadeus booking is booked or later (PNR exists: `booked` / `issuing` / `ticketed`) **and it is
  a real booking** - its env is `production`, or the hotel side is itself in `test` (so the whole chain can be
  rehearsed end to end before anything is live; an Amadeus sandbox PNR never unlocks a production hotel
  booking), **or** the step is marked "טופל ידנית", **or** the order has no flight. Careful: a skipped flight
  is stored as `{}` (truthy) - check an inner field, not the object.
- **Hotel:** the hotel is made of **parts** - the single hotel is part 0, a split stay has one part per
  segment. Each part is done when it has a confirmed ETG booking **or** its own "טופל ידנית" mark. An own-stock
  (offline) part has no Book button and is done only by its mark (someone still has to send the hotel the
  names). The step is done when every part is done, or the order has no hotel.
- **Ticket:** marked "טופל ידנית" (with supplier + reference). No API yet.

The manual mark: a button "טופל ידנית" on each row (on each hotel part), a short note (and for the ticket:
supplier + reference number), who and when. It can be removed by the same roles. Every mark and unmark is
audited. Stored in a new `reservations.fulfilment jsonb` column:
`{ flight?: Mark, hotel?: { parts: { [part: string]: Mark } }, ticket?: Mark & { supplier, reference } }`,
`Mark = { manual: true, note, by, at }`. Stripped by `updateReservation` like `flight_booking` so the edit form
cannot overwrite it.

**Build Your Euro Trip rows** (`itinerary_group`: the trip's flight sits on the first event's row, each stay's
hotel on its own row): out of scope for the Book buttons in this work. On such a row the panel shows only the
manual marks, with "טיול רב־אירועים - כירטוס ידני בשלב זה". A follow-up can read the group's first-row flight.

**Reservations from before the panel opens** (Dor, 09.11): nothing on them records that ops already booked the
hotel / flight by hand, so on a reservation created before the panel opens (`created_at` earlier than the open
date - a constant or env value set when `NEXT_SECRET_FULFILMENT_OPEN` goes on), Book hotel / Book flight are
enabled only after the agent ticks "בדקתי - עוד לא הוזמן ידנית". The tick is audited. Reservations created
after the open date are unaffected.

The flight row is the existing Amadeus card from `feat/amadeus-booking`, unchanged apart from the visibility
gate (7.7) and its position in the panel.

### 7.2 Book hotel - the dialog

One dialog per hotel (per segment in a split stay). Steps:

**a. Open** (server action, admin/superadmin, visibility gate). Refuses when: the hotel is offline; the flight
step is not done; there is already an active booking for this hotel (7.3). Warns (does not refuse) when the
reservation is not `Paid` - like the flight dialog. Resolves `hid` from the `hotels` table; no `hid` = a clear
error. In the **test** environment, any `hid` other than 8473727 is refused by our code before calling ETG, with
"test key: only the ETG test hotel can be booked".

**b. Re-find the rate.** `search/hp` with the reservation's `hid`, dates, `guests` per room, residency (default
`il`; a **citizenship** field in the dialog, changing it searches again), currency USD, language en, timeout 30
s. Find the sold rate: first by `match_hash` (ETG allows it to confirm "the same rate between two steps"), else
by the same room + meal + cancellation class + payment type (the backoffice already has rate-term rules,
`lib/reservations/hotel-rate-terms.ts`, and myt-main has `sameRateTerms`). Only rates with a `deposit` payment
type are offered. The dialog shows the matched rate preselected, the hotel's other rates below it (closest
first), and for the selected one: room name in full, meal, cancellation policy (ETG times are UTC - print
Israel time and say so), taxes payable at the hotel (shown separately, never added), price now vs the price
the customer was sold. If the sold rate is gone, nothing is preselected and staff pick one.

**c. Prebook** the selected rate with `price_increase_percent = 10`. The answer replaces what the dialog shows.
**Any price change** (up or down, vs the HP price) shows old -> new and needs a tick "אני מאשר/ת את המחיר
החדש" before Book is enabled. `no_available_rates` / `rate_not_found`: say so and go back to the rate list.

**d. Guests.** One block per room with that room's adults and children (from the reservation's `guests`).
Adults: first + last name, prefilled from the lead contact and `more_pax_info` in order across the rooms, staff
can edit. Children: age fixed from the search, name optional. Validation: at least one named adult per room;
Latin letters, spaces and `'-,.` only (our call: the hotel abroad must read it; ETG would accept Hebrew).
Children without a name are not sent (ETG: never invent guests). Optional comment to the hotel
(`user.comment`). `partner.comment` = `MYT reservation #<id>`.

**e. Book.** One server action, in this order:
1. Insert the booking row (7.3) with status `booking` and a fresh `partner_order_id`. The DB's partial unique
   index refuses a second active booking for the same hotel - that is the double-click / two-tabs guard.
2. Audit row first (like the flight booking: the audit is the record even if our own write fails later).
3. `booking/form`, retrying per ETG's rule (new id each time, at most 10, the row keeps the current id and the
   list of tried ids). Pick the `deposit` payment type from the answer; none = failed ("no deposit payment for
   this rate"). If `is_gender_specification_required`, the dialog asks for each guest's gender and continues
   with the same form (it lives 60 min).
4. `booking/finish` with `user.email = office@megatr.co.il`, `user.phone` = the office number (our call:
   +972-3-768-4828, Dor to confirm), the guests, the deposit amount/currency, `language: en`. `ok` / `unknown`
   / `timeout` / 5xx -> status stays `booking`, `cutoff_at` = now + the cut-off (7.4). Any other error ->
   `failed` with ETG's code.
5. The dialog switches to "בתהליך" and starts checking the status (7.4).

Function `maxDuration`: prebook needs >= 60 s on ETG's side; give these actions 120 s.

### 7.3 Data - a `hotel_bookings` table (our call)

A table, not a JSON column like `flight_booking`, because one reservation can hold several hotel bookings (split
stay segments, a failed attempt followed by a new one) and each needs its own lock and history.

One row per booking attempt. Minimum columns:
- `id`, `reservation_id` (FK, not null), `segment` (0 for the single hotel, else the index in `hotel_segments`)
- `env` (`test` | `production`), `partner_order_id` (unique), `tried_partner_order_ids`
- `status`: `booking` | `uncertain` | `confirmed` | `failed` | `cancelling` | `cancelled`
  (`uncertain` = we stopped knowing, ETG may still have booked it - see 7.4)
- ETG ids: `etg_order_id`, `item_id`; `hid`, hotel name, `checkin`, `checkout`, `residency`
- `rooms` (guests as sent), the rate as booked (room name, meal, cancellation policy, taxes, `book_hash`)
- money: `price_sold` (from the reservation), `price_booked` + currency (the deposit amount ETG takes),
  `price_change_confirmed_by` when a change was accepted
- status tracking: `last_etg_status`, `last_error`, `status_checks`, `last_checked_at`, `cutoff_at`,
  `confirmed_at`
- post-booking: `hotel_confirmation_number`, `order_info` (last answer), `order_info_at`
- cancel: `cancel_result` (`amount_payable`, `amount_refunded`), `cancelled_at`, `cancelled_by`
- `created_by`, `created_at`

**Partial unique index** on (`reservation_id`, `segment`) where
`status in ('booking','uncertain','confirmed','cancelling')` - an `uncertain` booking blocks a new attempt.

### 7.4 Status checking - one poller at a time

One server function `checkHotelBooking(id)` does: claim the row by compare-and-swap on `last_checked_at`
(skip if it was checked less than 4 s ago - this is what keeps two callers from both hitting ETG, which ETG
would answer with `lock`), call `finish/status`, apply the result:
- `ok` -> `confirmed`.
- `processing` / `timeout` / `unknown` / 5xx -> stay `booking`.
- a final ETG error (`soldout`, `book_limit`, `provider`, `block`, `charge`, `not_allowed`,
  `booking_finish_did_not_succeed`, ...) -> `failed` with the code.
- **`lock` or 429 `endpoint_exceeded_limit`** (ETG lists them as final, but they say nothing about whether the
  hotel was booked) -> `uncertain`.
- past our `cutoff_at` with no final ETG answer -> one last call; still no answer -> `uncertain`, not
  `failed` (ETG's own cut-off may be longer than ours).

**`uncertain` never allows a second booking of the same hotel** (the partial unique index keeps it active). It
is resolved by:
- the cron, which keeps calling `finish/status` for it every 5 minutes for 24 h (ETG fails a booking itself
  once its cut-off passes, so a final answer comes);
- `order/info` by `partner_order_id` (from 2 min after finish): `completed` -> `confirmed`;
  `failed` / `rejected` -> `failed`;
- or staff: "בדקתי - לא הוזמן" / "בדקתי - הוזמן" after looking in the extranet, with a note, audited.
The card shows it in amber: "לא ודאי - לא להזמין שוב עד שיתברר".

Callers:
- The open dialog / card calls it every 5 s.
- A backoffice cron every minute calls it for each row still in `booking` (the tab may be closed).
- A "רענון" button calls it once.

**Cut-off:** we ask ETG for 10 minutes (our call; it goes in the checklist as "expected about 1-2 min,
maximum 10 min"). Until ETG confirms the value, `cutoff_at` = finish time + 10 min.

### 7.5 After confirmation

- **Card:** ETG order id, `partner_order_id`, the hotel confirmation number when known, price booked vs sold,
  cancellation terms (Israel time), the guests as sent, and an env badge.
- **order/info:** the cron calls it once 2+ minutes after `confirmed_at`, then once a day until the HCN
  appears or 96 h have passed (and not after check-in). The card's "רענון" may call it too, never earlier than
  2 minutes after confirmation.
- **Voucher:** a button downloads the PDF through a backoffice route (admin/superadmin) that calls ETG's
  voucher endpoint. `pending` / `voucher_is_not_downloadable` = "try again later".
- **Cancel:** a button opens a confirm dialog that prints what cancelling costs now (from the booked rate's
  cancellation policy: free until X, else Y). On confirm: status `cancelling`, `order/cancel`, retry once on
  `timeout`, store the result, status `cancelled`. `order_not_cancellable` -> back to `confirmed` with the
  reason.
- **Failed:** the card shows ETG's reason in plain Hebrew and a "נסה שוב" button that opens the dialog again
  (a new row).
- **Test env:** every confirmed booking shows a red banner "הזמנת בדיקה - יש לבטל" until it is cancelled.

### 7.6 Environments and keys

- Backoffice env (local `.env.local` and Vercel), **separate names per key** like the Amadeus booking's
  sandbox / production pairs:
  - `NEXT_SECRET_RATEHAWK_TEST_KEY_ID` / `NEXT_SECRET_RATEHAWK_TEST_API_KEY` - today's test key (the same one
    myt-main searches with).
  - `NEXT_SECRET_RATEHAWK_PROD_KEY_ID` / `NEXT_SECRET_RATEHAWK_PROD_API_KEY` - empty until ETG issues it.
  - `NEXT_SECRET_RATEHAWK_ENV` = `test` (default, also when unset or misspelled) | `production`. `production`
    with the PROD pair missing = every hotel booking action refuses with a clear error (never falls back to the
    test key).
  Host `https://api.ratehawk.com` for both. The backoffice calls ETG directly (no proxy through myt-main).
  One small module maps env -> {host, key pair}, so a third environment (ETG's sandbox,
  `api-sandbox.ratehawk.com`) could be added as config if ETG insists on the sandbox checklist cases.
- **Booking never falls back** to another key (Dor, 09.11: the test key cannot book, so there is nothing to
  fall back to).
- **A separate test key for the backoffice** (our call): we ask ETG for one, so that whatever ETG sets on a key
  during certification (cut-off, IP whitelist, a stop-list after test names) never lands on the key the live site
  searches with. Until it arrives the backoffice uses today's key; the booking endpoints do not share the site's
  quotas.
- **The booking flow never calls a SERP endpoint** (`serp/geo`, `serp/hotels`, `serp/region`): it uses
  `search/hp`, `prebook`, the booking endpoints, order info, cancel and voucher, each with its own per-endpoint
  limit. So it does not spend the 10-a-minute `serp/geo` quota the site's customers share. (ETG limits are per
  endpoint per key; the site never calls `search/hp`.)
- When ETG issues the production key: fill the PROD pair and set `NEXT_SECRET_RATEHAWK_ENV=production` in the
  backoffice; myt-main per 7.9.
- `myt-backoffice/.env.development.local` points local dev at a local Supabase; the ETG keys there are the
  test key too.

### 7.7 Visibility gate (our call on the mechanism)

Dor: no user sees any fulfilment button yet. One rule, checked in the page AND in every fulfilment server
action / route (not only hidden in the UI):
- `NEXT_SECRET_FULFILMENT_OPEN` unset or not `true` -> the panel (flight, hotel, ticket) exists only for
  **superadmin** (so Dor can test and record the video).
- `true` -> admin + superadmin.
The Amadeus card is put behind the same rule when it comes to master.

### 7.8 Bringing the Amadeus branch to master

Rebase `feat/amadeus-booking` onto current master (no merge commits), resolve conflicts in the reservation page,
add the visibility gate, open a PR for Dor to merge. Its migration (`reservations.flight_booking`) runs with it.
Its own behaviour is unchanged: sandbox unless `NEXT_SECRET_AMADEUS_BOOKING_ENV=production`.

### 7.9 myt-main - untouched until the production key (Dor, 09.11)

**This work changes nothing in myt-main.** No code, no env, no host. The site keeps `api.worldota.net`, its
current key (`EMERGING_TRAVEL_API_KEY` / `_SECRET`) and its current behaviour.

The DB changes are additive and the site does not see them: a new table (`hotel_bookings`) and a new nullable
column (`reservations.fulfilment`) that the site never writes and `confirm-order`'s insert does not name.

**The switch, later (its own small change, only after the production key exists and the backoffice booking
works on it):**
- New env names on the site: `RATEHAWK_PROD_KEY_ID` / `RATEHAWK_PROD_API_KEY` (server-only) and a switch
  `RATEHAWK_USE_PROD=true`. The old `EMERGING_TRAVEL_API_KEY` / `_SECRET` stay in place untouched.
- One small resolver in `app/api/keys.ts` picks key + host: switch on AND the PROD pair present -> production
  key on `https://api.ratehawk.com`; anything else -> exactly today's key and host. The four ETG callers
  (`app/api/hotels/route.ts`, `app/api/hotels-warm/route.ts`, `app/api/hotels-info/route.ts`,
  `app/api/hotels-info/reviews.ts`) take key + host from it.
- **Today's key stays as the fallback for every non-booking use** (Dor, 09.11: "like a fallback to the sandbox
  key on our side ... in the backoffice there is no booking on the sandbox key so no fallback there; in every
  other use, yes"): with the switch on, a call on the production key that fails for an
  account reason - HTTP 401 / 402 / 403, or ETG error `incorrect_credentials`, `invalid_auth_header`,
  `no_auth_header`, `not_allowed_host` (IP not whitelisted), `endpoint_not_active`, `overdue_debt` - is sent
  once more on today's key and host, and logged, so customers keep seeing hotels. NOT on 429, timeouts, 5xx,
  or an empty answer (that would double the traffic or hide a real supplier problem). Search, hotel info and
  reviews only - **a booking never falls back** (the test key cannot book a real hotel).
- Rollback = unset `RATEHAWK_USE_PROD` (plus a redeploy for env to apply), no code revert.
- Fetch timeouts for those callers ride along with the switch, not before.

### 7.10 Certification package (what goes to ETG)

1. **Test reservations.** Two reservations on the hidden test event (1130, `is_test`), hotel = ETG test hotel
   **8473727**, dates 30+ days ahead, on a refundable rate:
   - **T1:** 1 room, 2 adults + 1 child aged 5, citizenship **Uzbekistan** (set in the dialog).
   - **T2:** room 1 = 2 adults + 1 child aged 5, room 2 = 2 adults.
   They must not count in any dashboard / partner / marketing number (builder: find how test reservations are
   kept out today, or add the narrowest way).
2. Book both through the real dialog; confirmed; order info fetched (HCN may be empty); voucher downloaded;
   **both cancelled**. Record each `partner_order_id`.
3. **Video** of the whole flow in the backoffice (open reservation -> Book hotel -> rate -> prebook -> guests ->
   booked -> voucher -> cancel). Dor records it (or Claude drives the browser pane while Dor records).
4. **Checklist answers** drafted by Claude into a copy of ETG's Google Doc (Dor makes the copy, or approves Claude
   making it), including the workflow table and the finish / finish-status error tables as built.
5. **Email** to apisupport@ratehawk.com with Inna in copy: the two `partner_order_id`s, the video, the checklist,
   and the open questions (section 10). Claude drafts; Dor sends.

## 8. Calls Claude made (for Dor to check)

1. A `hotel_bookings` table, not a JSON column (split stays + retries + a DB lock).
2. Polling (dialog every 5 s + a 1-minute cron + a refresh button) instead of ETG's webhook.
3. Booking cut-off proposed to ETG: 10 minutes.
4. `price_increase_percent = 10` at prebook; any change needs staff's explicit tick.
5. Guest names in Latin letters only; unnamed children are not sent.
6. `user.phone` = the office landline +972-3-768-4828.
7. The visibility gate: superadmin only until `NEXT_SECRET_FULFILMENT_OPEN=true`, then admin + superadmin.
8. A flight counts as done once the PNR exists (`booked`), not only after tickets are issued.
9. "No flight in the order" counts as flight done without a manual mark (same for no hotel).
10. The backoffice gets its own ETG env vars (separate TEST / PROD pairs) and calls ETG directly.
11. ETG times shown in Israel time (labelled).
12. In the test env our code refuses any hotel but 8473727 before calling ETG.
13. The site's later switch: `RATEHAWK_PROD_KEY_ID` / `RATEHAWK_PROD_API_KEY` + `RATEHAWK_USE_PROD`, with the
    host moving to `api.ratehawk.com` only together with the production key.
14. The site's runtime fallback to today's key covers account errors only (list in 7.9), never rate limits,
    timeouts or empty answers, and never a booking.
15. An `uncertain` status (lock / 429 / our cut-off without ETG's final answer) that blocks a second booking until
    ETG, `order/info` or staff settle it.
16. An Amadeus sandbox PNR never unlocks a production hotel booking.
17. Hotel manual marks are per hotel part; own-stock parts need their mark.
18. Euro Trip rows: manual marks only in this work.
19. Ask ETG for a separate test key for the backoffice.
20. Build for test + production only; the env module can take ETG's sandbox later as config.

## 9. Left to the builder

- Module layout (ETG client, pure rules, actions, components), names, file split.
- The dialog's exact UI and copy (Hebrew, RTL, shadcn), as long as section 7.2's steps and checks are there.
- How the "sold price" is read for the comparison (the stored rate's `amount` vs `show_amount` with our VAT).
- How test reservations stay out of the numbers (7.10.1) and how they are created (script or UI).
- The cron route's auth (copy the existing crons), its batch size, and how it respects ETG's 30/min limits.
- Unit tests / selftest scripts for the pure parts (step rules, rate matching, status mapping, guest
  validation), in the style of the Amadeus selftests.
- Whether the hotel work starts after the Amadeus PR is merged or on top of it.

## 10. Questions for ETG (go in the email; answers may change details, not the shape)

1. Please confirm our current key is a **test key** and that certification runs on the two test-key cases
   (8473727) only.
2. Which **booking cut-off** will you configure? We propose 10 minutes.
3. **IP whitelisting:** we call from dynamic cloud IPs for now. Is a static IP required for certification or only
   for the production key?
4. May **children's names** be omitted in `booking/finish` without `incorrect_children_data`?
5. Is **`supplier_data`** required on our contract?
6. Our product for certification is an **internal staff booking tool** (bookings made by our operations team for
   paid customer orders). Is a video accepted in place of access?
7. Our customers are Israeli residents: is a default residency `il` with a staff override acceptable?
8. Multi-room with **different room types** for one party: separate bookings?
9. Is `api.worldota.net` still served for production, and until when?
10. Please issue a **separate test key** for our booking tool, and do not enable IP whitelisting on our current
    key while our website searches with it.
11. The checklist you sent is the sandbox variant (hids 10004834 / 8819557, `unknown_*` scenarios). On a test
    key, may we answer those scenarios with our logic only, and run the two test-key cases instead?
12. We call `/hotel/info/` for hotels missing from our database and store the result. Acceptable, or must we
    move to the dumps?

The answers drafted for the checklist and this email: `docs/ratehawk/2026-11-09-etg-answers-draft.md`.

## 11. Settled by Dor after the builder check (09.11)

1. Reservations from before the panel opens: Book needs the tick "בדקתי - עוד לא הוזמן ידנית" (7.1).
2. **Cancellation deadlines are UTC** (ETG: "we send the cancellation policies via API in the UTC+0 timezone").
   The reservation page's existing terms block (`lib/reservations/hotel-rate-terms.ts`, single hotel and split
   stay rows) printed them as hotel local time - **fix it in this work**: read UTC, print Israel time, labelled,
   the same as the new card; update its selftest (`scripts/hotel-rate-terms-selftest.ts`) and the guide /
   CLAUDE.md lines that say "hotel local time". Backoffice only - myt-main's `lib/hotelRateTerms.ts` (the
   7-day non-refundable window, off by a few hours at most) stays as it is until the production switch.
