# ETG certification - our answers (draft, 2026-11-09)

What ETG asked for (ticket APIR-59328, 03.11.2026) and what we answer. English below is ready to paste into
the copy of ETG's checklist and into the email. Items marked **[after build]** are filled once the backoffice
booking (design: `docs/superpowers/specs/2026-11-09-ratehawk-hotel-booking-design.md`) runs the test bookings.
Items marked **[risk]** are where ETG may push back.

## 0. What goes to ETG, in what order

| # | Item | When | Status |
|---|---|---|---|
| A | Email 1: our questions (section 3) | **now** - answers shape the build, ETG's review takes 14-30 days | draft below |
| B | Test bookings T1 + T2 on hid 8473727, cancelled, `partner_order_id`s | after build | [after build] |
| C | Video: search -> booking -> voucher -> cancellation in our booking tool | after build | [after build] |
| D | Pre-Certification Checklist (our copy of their Google Doc) | after build (answers below) | draft below |
| E | Email 2: B + C + D | after build | - |

Send to apisupport@ratehawk.com with Inna in copy (ETG's instruction).

---

## 1. Checklist answers

### General

**Map hid 10004834 (and 8819557 for prebook price change).**
> These are sandbox hotels. We work on a test API key, so our certification bookings use the test hotel
> hid 8473727, which is mapped in our system. (Question sent - see email 1, Q2.)

**Product type for certification.**
> Website / internal booking tool. Our operations team books hotels for paid customer orders from our back-office
> system (ETG active as provider). Access cannot be granted: the system holds our customers' personal data.
> **A video recording of the full flow (search -> booking -> cancellation) is attached.**

**Test bookings** - specify `partner_order_id` per scenario:

| Scenario (checklist) | Our answer |
|---|---|
| Multiroom, mixed adults and children (sandbox hid 10004834) | Supported (same room type, one rate). Run on the test key as T2: room 1 = 2 adults + child 5, room 2 = 2 adults. `partner_order_id`: **[after build]** |
| Citizenship Uzbekistan (sandbox) | Supported - our booking dialog has a citizenship field (default Israel). Run on the test key as T1 with residency `uz`. `partner_order_id`: **[after build]** |
| Children, citizenship Monaco, children 0 and 17 (sandbox) | Supported (ages 0-17 per room). Covered by T1 (child 5). Sandbox case not runnable on a test key. |
| Prebook price increase 10% (hid 8819557, sandbox) | We send `price_increase_percent = 10`; any change is shown to our agent, who must confirm before booking. Sandbox hotel not reachable on a test key. |
| `unknown` -> success / `unknown` -> `soldout` / `unknown` -> `book_limit` | Implemented as in the error tables below (finish is never retried; status is polled until a final answer or the cut-off). The `unknown_*` suffixes are sandbox-only, so not runnable on our test key. **[risk]** ETG may still want them -> then we need a sandbox key. |

### Workflow - ETG v3 call sequence

| Step | What the user does | ETG endpoint |
|---|---|---|
| 1. Hotel search (website) | A customer builds an event package on mega-events.co.il; the hotel step lists hotels near the event venue | `/api/b2b/v3/search/serp/geo/` |
| 2. Hotel content (website) | Shown on the hotel card; hotels not yet in our database are fetched once and stored | `/api/b2b/v3/hotel/info/` (+ hotel reviews) |
| 3. Order + payment (website) | The customer picks a hotel and rate and pays us (our own payment gateway) | - |
| 4. Re-check the rate (back office) | An agent opens the paid order and clicks "Book hotel"; we search the same hotel, dates, rooms and citizenship and find the rate the customer chose | `/api/b2b/v3/search/hp/` |
| 5. Prebook | The agent confirms the rate; if the price changed, the agent sees old vs new and must confirm | `/api/b2b/v3/hotel/prebook/` (`price_increase_percent` 10) |
| 6. Guests | The agent enters guest names per room | - |
| 7. Create booking | The agent clicks "Book" | `/api/b2b/v3/hotel/order/booking/form/` |
| 8. Start booking | automatic | `/api/b2b/v3/hotel/order/booking/finish/` (`payment_type` deposit) |
| 9. Booking status | automatic: every 5 s while the screen is open, and a server job every minute | `/api/b2b/v3/hotel/order/booking/finish/status/` |
| 10. Booking details | automatic: 2+ minutes after confirmation, then daily until the hotel confirmation number arrives (max 96 h) | `/api/b2b/v3/hotel/order/info/` |
| 11. Voucher | The agent clicks "Voucher" | `/api/b2b/v3/hotel/order/document/voucher/download/` |
| 12. Cancellation | The agent clicks "Cancel", sees the current penalty and confirms | `/api/b2b/v3/hotel/order/cancel/` |

### IP whitelisting
> Our services run on a cloud platform with dynamic outbound IPs. We do not have static IPs at this stage.
> (Question sent - email 1, Q4.) **[risk]** the checklist calls a static IP mandatory. If ETG insists: a small
> fixed-IP proxy (a few dollars a month) or Vercel Static IPs ($100/month per project). Dor's call when it comes.

### Payment types
> `deposit`.

### RPM limits (expected requests per minute)
| Endpoint | Expected RPM |
|---|---|
| `/serp/hotels` | 0 (not used) |
| `/serp/region` | 0 (not used) |
| `/serp/geo` | 10 average; peaks of 20-30 when a campaign lands (today's limit 10 causes waits) - **we ask for 30** |
| `/search/hp` | up to 3 |
| `/hotel/prebook` | up to 3 |
| `/serp/prebook` | 0 (not used) |

(Measured: about 1,200 hotel searches a day on the website; ~2 paid orders a day.)

### Static data
> We use `/hotel/info/` to get the static data: a hotel is fetched the first time it appears in our results and
> stored in our database; later displays read our database. We don't use the dumps. Update: a hotel's record is
> refreshed when re-fetched (no fixed schedule). **[risk]** ETG's requirements say the Content API should not be
> called during live user searches; see email 1, Q8. Moving to the dumps would be a website change - after the
> production switch, per Dor's rule.

> We do not use `/serp/region` (we search by coordinates of the event venue).

**Hotel and region mapping:** Yes. Hotels: **109,799** in our database (09.11.2026). Regions: 0.

**Room static data:** No, we do not show room images and amenities.

### Search step
- **match_hash:** Yes. We store the `match_hash` of the rate the customer chose and use it only at booking time,
  to find the same rate in the `/search/hp/` answer (fallback: same room name, meal, cancellation terms and
  payment type).
- **Prebook:** `price_increase_percent` = **10%**. A changed price is always shown to our agent, who must
  confirm it before the booking form is created. **Prebook is implemented according to ETG timeout limitation
  (60 s): Yes.**
- **Multiroom:** Yes, we support only multiroom booking of the **same room types** (one rate for all rooms).
- **Dynamic search timeouts:** No.
- **Expected search timeout:** 10 s. **Maximum search timeout:** 30 s.
- **Final price:** `show_amount` on the website (equal to `amount` on our contract); at booking, the `amount` of
  the `deposit` payment type returned by the booking form.
- **Commission:** on the partner's end.
- **Rate name:** `room_name` from the hotel search step. We display ETG room names as they are.

### Booking step
- **Final booking status:** Status OK in "Check booking process" (`/order/booking/finish/status/`).
- **Webhook:** No (we poll).
- **Booking cut-off:** Expected booking timeout: 1-2 minutes. Maximum booking timeout: **10 minutes**.

**Errors and statuses - `/hotel/order/booking/finish/`**

| ETG API | Shown to the agent | How we process it |
|---|---|---|
| Status `ok` | In progress | Start polling `/finish/status/` every 5 s |
| 5xx | In progress | Do not retry finish; poll `/finish/status/` |
| Error `timeout` | In progress | Do not retry finish; poll `/finish/status/` |
| Error `unknown` | In progress | Do not retry finish; poll `/finish/status/` |
| Error `booking_form_expired` | Failed | Stop; the agent may start a new booking (new search, new `partner_order_id`) |
| Error `rate_not_found` | Failed | Stop; the agent may start a new booking |
| Error `return_path_required` | Failed | Stop (not expected: we use `deposit`) |

**Errors and statuses - `/hotel/order/booking/finish/status/`**

| ETG API | Shown to the agent | How we process it |
|---|---|---|
| Status `ok` | Confirmed | Stop polling. First `/order/info/` 2+ minutes later |
| Status `processing` | In progress | Keep polling every 5 s until the cut-off; one last call just before it |
| Error `timeout` | In progress | Keep polling (same) |
| Error `unknown` | In progress | Keep polling (same) |
| 5xx | In progress | Keep polling (same) |
| Error `block` | Failed | Stop polling |
| Error `charge` | Failed | Stop polling |
| Error `3ds` | Failed | Stop polling (not expected: no card payments) |
| Error `soldout` | Failed | Stop polling |
| Error `provider` | Failed | Stop polling |
| Error `book_limit` | Failed | Stop polling |
| Error `not_allowed` | Failed | Stop polling; contact ETG support with the order details |
| Error `booking_finish_did_not_succeed` | Failed | Stop polling |

Also: one booking is polled by one process at a time (a database lock), so we never send two status requests
for the same `partner_order_id` at once. If the cut-off passes with no final answer, or a status call answers
`lock` / 429, the booking is held as "uncertain" - it blocks any second booking of the same hotel - and we
keep checking `/finish/status/` and `/order/info/` until it is settled.

- **Confirmation e-mails (`user.email`):** We send our corporate email address: **office@megatr.co.il**.

### Post-booking
- **Retrieve bookings (`/order/info`):** Yes.
- **Purpose:** To allow users (our agents) to get the booking details - mainly the hotel confirmation number.
  Not to confirm the booking status.
- **Step:** After the booking flow.
- **Time gap:** Yes - the first call 2+ minutes after confirmation, then once every 24 h until the hotel
  confirmation number arrives (at most 96 h, never after check-in).

---

## 2. Things to settle on our side before email 2

1. Build + run T1 and T2 on the test key, **cancel both** (they are real bookings at giveaway prices).
2. Record the video (Dor, or Claude drives the browser pane while Dor records).
3. Copy ETG's Google Doc and paste section 1 into it (Dor makes the copy, or approves Claude making it).
4. Fill the `partner_order_id`s.

---

## 3. Email 1 - questions (short version, Dor sends)

**To:** apisupport@ratehawk.com  **Cc:** Inna  **Subject:** APIR-59328 - Mega Tourism - 6 questions before certification

> Hello,
>
> Before we submit our certification materials, please answer the following:
>
> 1. Is our current API key a test key, so that certification = the two test-key bookings on hotel 8473727
>    (not the sandbox cases in the checklist)?
> 2. Can you issue a separate test key for our booking tool, so certification does not affect the key our
>    website uses?
> 3. Is a static IP required? We use dynamic cloud IPs. Please do not enable IP whitelisting on our current key.
> 4. Booking cut-off: we propose 10 minutes. Is that OK?
> 5. We book from an internal tool used by our operations team. Is a video of the full flow (search, booking,
>    cancellation) accepted instead of access?
> 6. Can the /serp/geo limit be raised from 10 to 30 requests per minute after certification?
>
> Thank you,
> Dor Azouri
> CTO, Mega Tourism (Mega Events)

Dropped from the short version (ask later only if they come up): children's names optional in
`/booking/finish/`; `/hotel/info/` on cache misses vs dumps; `supplier_data` required; `api.worldota.net` sunset.
