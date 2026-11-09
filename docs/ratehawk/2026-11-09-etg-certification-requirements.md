# ETG / RateHawk API v3 - booking integration and certification requirements

Source: docs.emergingtravel.com, downloaded 2026-11-09 with curl (64 pages, B2B API only, not Affiliate), plus the public
OpenAPI spec the docs link to (`https://api.ratehawk.com/openapi.json`, swagger 2.0, unauthenticated). I made no
ETG API calls. Raw text: `/private/tmp/claude-501/-Users-dor--claude-spares-spare-uWOlkl/4ae2991c-0488-484c-836f-6045cf88e66b/scratchpad/etg-tools/txt/`.
I also checked ETG's Pre-Certification Checklist (`.../scratchpad/etg_checklist.txt`) against the docs.

Labels used below:
- **[doc]**: I read it on the page named.
- **[inferred]**: my own conclusion; no page states it.
- **[conflict]**: two ETG pages disagree.

MYT is on the **B2B API** (it calls `/api/b2b/v3/...`), so the payment type is **`deposit`**: MYT charges the customer through
CreditGuard and ETG takes the amount from MYT's deposit or credit line. The `now` card-token flow, 3DS and `return_path` are
Affiliate concerns. Most of them do not apply to MYT.

---

## 1. Key types and which certification path applies

| Key type | Host | What it can book | Money | Certification test cases |
|---|---|---|---|---|
| `sandbox` | `https://api-sandbox.ratehawk.com` | Only sandbox properties (the feature table plus about 2,000 unlisted demo hotels) [doc: Sandbox]. Integration Requirements says "Only a limited set of special demo hotels" can be booked [conflict, minor]. | None. No real bookings, charges or penalties. Cancel is optional. | **Sandbox set** (below), on hids **`10004834`** and **`8819557`** |
| `test` | `https://api.ratehawk.com` (same host as production) | **Only hid `8473727`**. A real hotel returns `sandbox_restriction` [doc: Authorization, Integration Requirements 1.5]. | **REAL bookings with full financial responsibility.** Rates carry "giveaway prices". **Every test booking must be cancelled** [doc: Create booking process]. Book refundable rates only: the docs give `free_cancellation_before: "2024-12-05T20:00:00"` as the policy to pick (a stale date). Other rates may return `insufficient_b2b_balance`. | **Test-key set** (below), on hid **`8473727`** |
| `production` | `https://api.ratehawk.com` | Real inventory. Booking `8473727` with this key returns `sandbox_restriction` [doc: Start booking process]. | Real | None. Issued **after** certification **and** after the "API partnership formalisation process" [doc: Certification step 6]. |

**How to tell which key you hold.** No API field returns the key type. `debug.key_id` and `debug.api_key_id` are only IDs.
- [doc] Keys are listed in the account under contract settings > API, visible only to a **Master** account.
- [doc] Sandbox keys and data work only against the sandbox host. The docs warn several times: never mix environments.
- [inferred] A practical test:
  - The key authenticates on `api-sandbox.ratehawk.com`: it is a sandbox key.
  - It authenticates on `api.ratehawk.com` and `/hotel/order/booking/form/` on any hotel other than `8473727` returns `sandbox_restriction`: it is a test key.
  - Otherwise it is production. Safer: ask the account manager. The sandbox error table calls a sandbox key "`is_production=false`", which suggests an internal flag but not one you can read.
- [inferred] MYT's current production RateHawk key (used for search today) is presumably production. Building and testing booking with it would make real bookings. Ask ETG for a sandbox key and/or a test key.

**Sandbox test cases** [doc: Certification + Sandbox "Test cases"; checklist]. These must be executed, and you submit each `partner_order_id`:

| # | Scenario | Exact recipe | Mandatory for |
|---|---|---|---|
| S1 | Multiroom, mixed adults and children | hid `10004834`, 2 rooms. Room 1: 2 adults + child age 3. Room 2: 2 adults + children ages 1, 5, 17. | Partners supporting multiroom |
| S2 | Booking with children | hid `10004834`, 1 room, 2 adults + 2 children ages **0 and 17**. The checklist adds "Citizenship: Monaco" (`mc`). | All |
| S3 | Uzbekistan citizenship | hid `10004834`, residency **Uzbekistan (`uz`)**, 1 room, 2 adults. Checks that the **search** requests (SERP + HP) are built right. | All |
| S4 | Prebook price increase | hid `8819557` (10% prebook increase), 1 room. Checks `price_increase_percent` and `book_hash` handling. | Partners allowing a price change at prebook |
| S5 | Success after `unknown` | any hotel, `partner_order_id` ending **`unknown_success`** | All |
| S6 | `soldout` after `unknown` | any hotel, `partner_order_id` ending **`unknown_soldout`** | All |
| S7 | `book_limit` after `unknown` | any hotel, `partner_order_id` ending **`unknown_book_limit`**. "System correctly identifies the book_limit error and fails the booking due to timeout expiry". | All |

**Test-key test cases** [doc: Certification], on hid `8473727`:
- T1: one room, 2 adults + 1 child (age 5), citizenship Uzbekistan.
- T2: multiroom, if supported. Room 1: 2 adults + child age 5. Room 2: 2 adults.
- If multiroom or children are not supported, the partner must **explicitly confirm the limitation**.

**Other certification steps** [doc: Certification, Integration Guide, checklist]:
- Give ETG access to the website with ETG active as a provider, **or** a video of the full flow (**search -> booking -> cancellation**).
- Fill in the Pre-Certification Checklist. Get it from API support; submitting it is mandatory to start.
- Provide a **workflow diagram** with the ETG endpoints marked.
- Map the test hotels so ETG's QA can find them in a normal test search on the site.
- The review is written, by email, and takes **14 to 30 days**.
- Each product (website, API) is certified separately.
- Rate limits are raised only after certification.

---

## 2. Call sequence and request fields

Recommended flow [doc: Integration Guide, Integration Requirements 3.1]:
SERP (one of `serp/hotels`, `serp/region`, `serp/geo`) -> **`/search/hp/`** -> **`/hotel/prebook/`** -> `/hotel/order/booking/form/` -> `/hotel/order/booking/finish/` -> poll `/hotel/order/booking/finish/status/` and/or the webhook -> later `/hotel/order/info/`, `/hotel/order/cancel/`, voucher.

All calls:
- `POST`, JSON body, HTTP Basic auth `KEY_ID:API_KEY` [doc: Authorization].
- Every response has the shape `{data, debug, status, error}`. `status` is `"ok"` or `"error"` (finish/status also returns `processing` and `3ds`), and `error` holds the code. Read **both** the HTTP code and the body.

### 2.1 SERP (`/api/b2b/v3/search/serp/hotels|region|geo/`)
- Fields: `checkin`, `checkout`, **`residency`** (ISO 3166-1 alpha-2, lowercase in the examples: `"gb"`, `"uz"`, `"il"`), `language`, `guests[]`, `currency`, `timeout` (float, max `100`).
  - `serp/hotels` adds `hids[]` (max **300** per request, and ETG advises sending 300).
  - `serp/geo` adds `latitude`, `longitude`, `radius` (max `70000` m) and `hotels_limit`.
- `residency is required` is a validation error [doc]. Docs say: "We expect the `residency` parameter to be sent in the Search by and Retrieve hotelpage requests", where residency means the **passport country** and must be the same for every guest [doc: IR 3.8].
- `guests` holds one object per room: `{ "adults": 1..6, "children": [ages 0..17] }`. Max 4 children and 10 guests per room, max **9 rooms**, max **30 nights**, check-in at most **730 days** ahead [doc: HP request, IR 3.3].
- On SERP, show only 1 or 2 of the lowest rates per hotel. Do not let users pick a SERP rate, because it may not match HP [doc: Integration Guide 2.1].
- SERP `search_hash` (`sr-...`) lifetime: **38 minutes** [doc: SERP]. The serp/prebook page says "within 6 hours" for the same hash [conflict].
- Caching SERP is acceptable if HP refreshes the prices [doc: IR 3.2].
- Recommended timeout for SERP and HP: **30 s** [doc: IR 3.6]. If `timeout` is not sent, the key's configured timeout applies.

### 2.2 Hotel page `/api/b2b/v3/search/hp/`
- Fields: `checkin`, `checkout`, `residency`, `language`, `currency`, `timeout`, **`hid`** (int; `id` is deprecated), `guests[]`.
  - Optional `filter`: `star_rating`, `kind`, `meal_type`, `price_from`, `price_to`, `has_transfer`.
  - Optional `upsells`.
  - `match_hash` in the request is deprecated and analytics-only.
- Call HP **only for the hotel the user opened**, never for every SERP hotel [doc].
- Rate lifetime:
  - Recommended **30 minutes** [doc: HP page]. The Integration Guide says "up to 1 hour" [conflict].
  - The HP `book_hash` (`h-...`) lives **24 hours** and goes into the prebook `hash` field.
- **Caching HP or prebook responses is prohibited** [doc: IR 3.2].
- Children's ages go in brackets, for example `[15]` [doc: IR 3.3].
- Multiroom: send one `guests[]` entry per room, 2 to 9 rooms. ETG advises equal pax per room; with different pax, it advises a separate request per room [doc: HP guests]. One rate covers up to 9 rooms of the **same** room type. Different room types at one rate are not supported [doc: IR 3.4]. [inferred] Different room types therefore mean separate bookings, each with its own `partner_order_id`.

### 2.3 Prebook `/api/b2b/v3/hotel/prebook/` (from HP)
- Body: `{ "hash": "h-...", "price_increase_percent": 0..100 }`. If `price_increase_percent` is omitted, prebook tries the same price only.
- Response:
  - `data.changes.price_changed` (bool).
  - `data.hotels[].rates[]` with a **new `book_hash` (`p-...`)**. Its lifetime is **6 hours**.
  - The new `payment_options`; the price may be higher.
- When the original rate is gone, prebook looks only for the **same room type and the same board**. It may switch refundable and non-refundable within the percentage limit. New `book_hash` and `match_hash` values come back [doc: Prebook].
- **Timeout: recommended 60 s, minimum 30 s.** You cannot pass a timeout; only ETG can adjust it [doc: IR 3.1]. [inferred] The HTTP client and the Vercel function `maxDuration` must allow at least 60 s for this call.
- **If you send `price_increase_percent` > 0 you MUST show the user the new price and ask whether to continue** [doc: IR 3.1, Integration Guide diagram].
- Errors:
  - `no_available_rates`: tell the user the rate cannot be booked.
  - `rate_not_found`: the hash is expired or wrong; search again.
  - `invalid_params`, `unknown`.
  - `prebook_disabled`: a contract setting.
  - `contract_mismatch`.
- `match_hash` is deprecated (2026-09-29). Use it only to confirm "the exact same rate between two steps" [doc].
- [doc] Prebook "must be excluded from the booking flow". [inferred] This means prebook runs when the rate is chosen, before the booking form. It is not part of form/finish.
- Alternative: **`/api/b2b/v3/serp/prebook/`** with `hash: "sr-..."`. It is **available only on request**: send API support a workflow diagram, the use case, the expected traffic and the calling strategy. Errors include `prebook_from_serp_disabled` [doc]. If MYT wants to skip HP, it needs this approval.

### 2.4 Create booking process `/api/b2b/v3/hotel/order/booking/form/`
- Body, all fields **required**:
  - `partner_order_id`: string, 3 to 256 chars. Described as "UUID format" and unique per contract. The sandbox magic values append text (`...unknown_success`), so it is not validated as a strict UUID [inferred].
  - `book_hash`: the `p-...` hash from prebook.
  - `language`: `he` is supported.
  - `user_ip`: the end user's IP.
- Response `data`:
  - `order_id` (ETG int), `partner_order_id`, `item_id`.
  - **`payment_types[]`**: `{amount, currency_code, type: "deposit"|"hotel"|"now", is_need_credit_card_data, is_need_cvc, recommended_price}`. `recommended_price` is "under development, ignore".
  - **`is_gender_specification_required`**.
  - `upsell_data[]`.
- **The booking form lives 60 minutes.**
- In the sandbox, every `currency_code` is `EUR` and `language` is forced to `en`.
- Rate limit in the example: 30 per 60 s.

### 2.5 Start booking process `/api/b2b/v3/hotel/order/booking/finish/`
Body (the OpenAPI spec and the docs agree):
```json
{
  "language": "en",                         // required
  "arrival_datetime": "2027-06-14T14:30:00", // optional
  "partner": {                               // required
    "partner_order_id": "<same as form>",    // required
    "comment": "internal, max 256",          // optional, NOT sent to the hotel
    "amount_sell_b2b2c": "520.00"            // optional resale price, contract currency, min 1
  },
  "payment_type": {                          // required; must equal one entry of form.payment_types
    "type": "deposit", "amount": "412.50", "currency_code": "EUR"
  },
  "rooms": [ { "guests": [                   // required; one item per room, same order as the search guests[] [inferred]
     { "first_name": "Martin", "last_name": "Smith" },
     { "first_name": "Eliot", "last_name": "Smith", "is_child": true, "age": 11 }
  ] } ],
  "user": {                                  // required
    "email": "<fixed corporate email on MYT's domain for B2B>", // required, valid
    "phone": "<5-35 chars>",                 // required, valid
    "comment": "sent to the hotel, max 256"  // optional
  },
  "supplier_data": {                         // "required or optional": ask the account manager
    "first_name_original": "...", "last_name_original": "...", "email": "...", "phone": "..."
  },                                          // contact of the person who initiated the booking; NOT sent to the hotel
  "upsell_data": [],                         // optional; at most one early_checkin + one late_checkout
  "return_path": "https://..."               // only for type "now" (card flow); not needed for deposit
}
```
Guest rules [doc: Start booking, IR 3.3/3.4]:
- `first_name` / `last_name`:
  - Required for at least one guest per room. 1 to 50 chars.
  - Unicode letters only (Hebrew is allowed), spaces and `'-,.’`. **No digits.**
  - The docs say: "For test purposes use the `Ratehawk` value" as `last_name`.
- A guest counts as an **adult unless `is_child: true`**, whatever its `age`. `age` is 0 to 17. When you send a child's name, both `is_child` and `age` are required.
- **Never send fake or placeholder guests** ("Child One", random ages, nulls). If you lack real data, send only the guests you have. The minimum is one real adult per room, and you may omit children.
  - [conflict] `incorrect_children_data` / `incorrect_guests_number` fire when the counts do not match the search. It is unclear whether omitting children trips them. Ask ETG.
- `gender` (`male` / `female` / `unknown`) is required when `is_gender_specification_required` is true.
- `user.email`: B2B "we expect to receive **one fixed corporate email** for B2B API with your domain". For Affiliate it is the end user's email [doc: IR 5.7].
- "If invalid user data is used, the data may be added to the stop list" [doc].
- The OpenAPI spec also lists an undocumented `book_timeout` (integer) in this body. The HTML docs say "the ETG v3 API doesn't support dynamic booking timeouts" [conflict]. Do not use it without asking.

### 2.6 Check booking process `/api/b2b/v3/hotel/order/booking/finish/status/`
- Body: `{ "partner_order_id": "..." }`.
- `status` values: `ok` (confirmed), `processing`, `3ds` (card flow only), `error` with an `error` code. `data.percent` is deprecated.
- **Polling interval** [conflict]:
  - The "Result interpretation" section says "every second".
  - The "Retry logic" section says "any time you like. The recommended time is **once per 5 seconds**".
  - The Integration Guide diagrams say "Every second" (HP flow) and "Every 3s" (SERP flow).
  - Rate limit in the examples: **30 per 60 s** for this endpoint.
  - [inferred] Poll every 3 to 5 s. One-second polling would exceed 30 per minute.
- **Total duration:** poll until the **booking cut-off (booking timeout)**. ETG sets it by hand per partner, agreed during certification; there is no default in the docs [doc: IR 5.2].
  - "**Always send a final status request at the last second before the booking timeout**" [doc].
  - When the cut-off passes without `ok`, treat the booking as failed. ETG also marks it failed automatically [doc: IR 5.2].
- [inferred] A Vercel request cannot hold a poll loop that long. A durable poller (cron, queue or webhook) is needed, and the UI shows "in progress" meanwhile.

### 2.7 Retrieve bookings, cancel, documents
See section 6.

---

## 3. Errors and statuses: what ETG prescribes

Front-end states [doc: IR 5.3/5.6]:
- **In progress**: `processing`, `timeout`, `unknown`, 5xx.
- **Success**: `ok`.
- **Failed**: any final error.
- Show "confirmed" **only** on status `ok` from check booking, or the webhook's success status.

### `/hotel/order/booking/form/`
| Response | FE | BE (ETG's prescribed behaviour) |
|---|---|---|
| `ok` | In progress | Go to `/booking/finish/` |
| 5xx / `timeout` / `unknown` | In progress | Retry `/booking/form/` with a **new `partner_order_id`** [doc: Create booking page and diagram]. **Max 10 retries.** After 10 failures, **restart the search**. 10 in a row "probably" means your contract settings changed: contact the account manager. (The IR table says "call until ok" without naming a new id. The endpoint page and the diagram say new id.) |
| `double_booking_form` | In progress | Change `partner_order_id` and retry |
| `duplicate_reservation` | In progress | Change `partner_order_id` and retry |
| `contract_mismatch` | Failed | Stop, show failure |
| `insufficient_b2b_balance` | Failed | Stop. Credit limit too low: account manager. |
| `reservation_is_not_allowed` | Failed | Stop. Contract permission. |
| `rate_not_found` | Failed | Stop. Hash expired: search again. |
| `sandbox_restriction` | Failed | Stop. Wrong environment for this hotel. |

### `/hotel/order/booking/finish/`
| Response | FE | BE |
|---|---|---|
| `ok` | In progress | Start polling `/finish/status/` |
| 5xx / `timeout` / `unknown` | In progress | **Do NOT retry finish.** Go to `/finish/status/` polling. "It doesn't necessarily mean the booking isn't created." With the webhook only: wait for the webhook until the cut-off, and treat no webhook as failed. |
| `booking_form_expired` | Failed | Stop. New form with a new `partner_order_id`. |
| `rate_not_found` | Failed | Stop |
| `return_path_required` | Failed | Stop (card flow only) |
| Others: `book_hash_not_found`, `chosen_payment_type_was_not_available_on_booking_form`, `incorrect_chosen_payment_type`, `incorrect_guests_number`, `incorrect_children_data`, `incorrect_rooms_number`, `email`, `insufficient_b2b_balance`, `order_not_found`, `unauthorized_group_booking` (>9 rooms), `arrival_date_differs_from_checkin_date`, `supplier_data_required`, `no_pricing_data`, `invalid_upsell_*`, `double_booking_finish`, `sandbox_restriction`, `credit_card_required` / `card_type_not_supported` / `not_enough_credit_card_data` / `incorrect_*_uuid_format` | Failed | Diagram: "other error, show error and stop". `double_booking_finish` = finish already called for this id while the first attempt is not an error, so keep polling the first [inferred]. |

### `/hotel/order/booking/finish/status/`
| Response | FE | BE |
|---|---|---|
| `ok` | Success | Stop polling; booking confirmed |
| `processing` / `timeout` / `unknown` / 5xx | In progress | Keep polling "at regular intervals within the booking timeout"; a final call at the last second |
| `block`, `charge`, `3ds` (error), `soldout`, `provider`, `book_limit`, `not_allowed`, `booking_finish_did_not_succeed` | Failed | Stop polling, show failure |
| Also final failures [doc: Check booking page and IR 5.6] | Failed | `decoding_json`, `endpoint_exceeded_limit`, `endpoint_not_active`, `endpoint_not_found`, `incorrect_credentials`, `invalid_auth_header`, `invalid_params`, `lock`, `no_auth_header`, `not_allowed_host`, `order_not_found`, `overdue_debt`, `unexpected_method` |

Notes:
- **Two errors on that list are self-inflicted.** `endpoint_exceeded_limit` (429) and `lock` both count as final failures. `lock` = the same request with the same `partner_order_id` "sent twice within a short amount of time".
  - [inferred] Never run two pollers for one booking, for example the webhook handler plus a cron plus a client retry. Respect the rate limit.
  - [inferred] Debatable: a 429 on a status poll means "we don't know", not "failed". Ask ETG whether a 429 really ends the booking.
- `book_limit` = "The cut-off logic limit for the booking finishing is reached".
- `provider` = a supplier technical error.
- `soldout` = the rooms are sold out.
- `not_allowed` = contract permission. Contact support with the hotel, `order_id`, `user` and `rooms`.
- In the sandbox, `block`, `charge`, `3ds` and `not_allowed` are not supported, and neither is the cut-off logic.

### Webhook path
- Payload `status`: `completed` = success, `failed` = failure. No reason is given; call check booking for it.
- IR 5.6 calls the success value "Confirmed". The checklist says "Status Completed" [conflict]. Accept both.

### Cancel
- On `timeout`, call cancel **once more** [doc: IR 6.2].
- `lock` if two cancels run at the same time. Cancel the bookings of one order group one at a time [doc: Cancel].

### Generic 5xx
- Retry, and limit identical repeated requests [doc: Errors].
- SERP/HP `core_search_error` (500): limit recurrent identical requests.
- "Recurring unauthorized requests over a considerable period" can get the IP banned.

---

## 4. How to trigger each test scenario (sandbox key)

All of these are from the Sandbox page, section "Errors reproducing".

**Rule for the magic suffixes:** put the **suffix at the end of `partner_order_id`** when you call **`/booking/form/`** ("on Booking Form stage"), then reuse that id through finish and status. Example: `9f1c...0b13-unknown_soldout` [inferred format].

| Scenario | How |
|---|---|
| finish and status return `unknown`, later `ok` | suffix `unknown_success` |
| `unknown`, later `provider` | suffix `unknown_provider` |
| `unknown`, later `soldout` | suffix `unknown_soldout` |
| `unknown`, later `book_limit` | suffix `unknown_book_limit` |
| Note | "Any `unknown_*` case from Booking Finish Status will return `unknown` on Booking Finish request". So finish itself answers `unknown`, and your code must move on to polling. How long `unknown` lasts before the final status is not documented ("after some time"). |
| status `soldout` | suffix `soldout` |
| status `book_limit` | suffix `book_limit` |
| status `provider` | suffix `provider` |
| finish `booking_form_expired` | suffix `booking_form_expired` |
| finish `email` | suffix `email` |
| finish `insufficient_b2b_balance` | suffix `insufficient_b2b_balance` |
| cancel `order_not_cancellable` | suffix `order_not_cancellable` |
| form `double_booking_form` | same `partner_order_id` on form several times |
| finish `double_booking_finish` | call finish twice for the same id |
| status `booking_finish_did_not_succeed` | call status after a finish that returned an error |
| `order_not_found` (finish, status, cancel) | a non-existent `partner_order_id` |
| prebook / form `contract_mismatch` | hash `h-00000000-0000-0000-0000-000000000000` |
| prebook `rate_not_found` / form `rate_not_found` | a non-existent hash / a random hash in a valid format |
| form `hotel_not_found` | an HP `book_hash` starting `e0000001` (for example `h-e0000001-8beb-43c4-b2d9-7e698efac087`). The changelog of 2026-10-23 removed `hotel_not_found` from Create booking, so this may be stale. |
| finish `chosen_payment_type_was_not_available_on_booking_form` | a `payment_type` not in the form's `payment_types` |
| finish `incorrect_chosen_payment_type` | an invalid `currency_code` |
| finish `incorrect_guests_number` / `incorrect_children_data` / `incorrect_rooms_number` | guests, children or rooms that do not match the search |
| finish `unauthorized_group_booking` | more than 9 rooms |
| finish `arrival_date_differs_from_checkin_date` | an invalid `arrival_date` |
| finish `supplier_data_required` | `supplier_data: {}` |
| finish / form `sandbox_restriction` | book a non-test hotel with a sandbox key |
| `prebook_disabled`, `reservation_is_not_allowed` | key or contract settings |
| dump `dump_not_ready` | any language except `en` |
| Not reproducible in sandbox | SERP/HP/prebook 5xx and `unknown`; prebook `no_available_rates`; `insufficient_b2b_balance` on form; `book_hash_not_found`; `rate_not_found` on finish; all card / 3DS errors |

Sandbox properties for display and logic tests:

| hid | What it is for |
|---|---|
| `10004834` | Conrad LA: taxes and VAT, all meals, room groups, metapolicy |
| `6362880`, `6682380` | `metapolicy_struct` / `metapolicy_extra_info` |
| `10595223`, `10654204` | `tax_data` |
| `10678836` | `vat_data` |
| `8819557` | +10% at prebook |
| `9744270` | +20% at prebook |
| `10047711` | all meals |
| `10050577` | no availability for residency `hn` |
| `10076665` | double price for residency `hn` |
| `8608790`, `10724071` | `match_hash` differs between SERP and HP |

Sandbox limits:
- `language` is always `en`.
- Currency is USD on search and EUR on booking.
- At most 5 rates per hotel.
- `beds` is absent.
- No 3DS or cards, no upsells, no early check-in / late check-out.

---

## 5. UI display requirements the QA checks

From Integration Requirements, the checklist and the field docs; all [doc] unless marked.

1. **Price change at prebook.** When `price_changed` is true or the price rose, show the new price and get the user's explicit yes/no before the booking form.
2. **Residency.** Send the guest's **passport country** in SERP and HP. It must be the same for every guest. Test S3/T1 requires `uz`, so a real citizenship input is needed.
   - [inferred] MYT hardcodes `residency: "il"` in `app/api/hotels/route.ts` today. Two certification cases need Uzbekistan, and the checklist's children case uses Monaco.
   - `any_residency: true` on a rate = bookable by any residency.
3. **Children.** Collect each child's age (0 to 17) and send the ages in search. In booking send `is_child: true` + `age`.
4. **Taxes.**
   - Taxes with `tax_data.taxes[].included_by_supplier: false` are paid **at the hotel**, in that tax's own `currency_code`. **Do not add them to the final price; display them separately.**
   - `included_by_supplier: true` is already inside `amount` / `show_amount`.
   - Tax `name` values are translated through `/hotel/static/` `taxes`.
   - `vat_data`: `included` / `applied` / `amount`.
   - If local law requires all-inclusive prices, ask API support how to show them. [inferred] Israeli consumer law likely requires all-inclusive prices, so ask.
5. **Cancellation policy.**
   - Parse `payment_options.payment_types[].cancellation_penalties.policies[]`. Each entry has `start_at`, `end_at`, `amount_charge`, `amount_show`, `commission_info` and can be one of three layers: free, partial, full.
   - `free_cancellation_before`: null = no free cancellation (penalty from the moment of booking).
   - **All times are UTC+0.** [inferred] Label or convert them in the UI.
   - Take the policy from the latest step that returned it (SERP, HP, prebook).
6. **Meals.** Display `meal_data.value` (`meal` is deprecated). Use `has_breakfast` / `no_child_meal`. **Never show a better meal than the one sent.** If your system has no equivalent, create one or map down. The full list is `/hotel/static/` `meals`.
7. **Room name.** Show `rates.room_name` in full, **including `misc_room_type`**. Alternatively build it from `room_data_trans` (`main_room_type` / `main_name` + `bathroom` + `bedding_type` / `beds` + `misc_room_type` / `amenities_data`), or from static `room_groups.name` + rate details.
8. **Room static data.** Match all `rg_ext` fields between search and static to get room images. **Never display individual `rg_ext` values.**
9. **Amenities.** Merge static `room_groups.room_amenities` with the rate's `rates.amenities_data`, remove duplicates, and resolve conflicts by priority:
   - `no-window` > `window`
   - `shared-bathroom` > `external-private-bathroom` > `private-bathroom`
   - `non-smoking` > `smoking`
10. **Hotel rules.** Parse and **display `metapolicy_struct` and `metapolicy_extra_info`**: deposits, fees, ID requirements and the like. There is a how-to with string templates.
11. **`is_package: true` rates.** "should be sold as a part of package, and the price for the hotel should not be shown separately". [inferred] This touches MYT's hotel step, which prints a hotel price. Ask ETG how they see MYT's bundle.
12. **`sell_price_limits` (MSP).** If enabled (by request plus an addendum), sell between `min_price` and `max_price` in the search currency. If it is not enabled, ETG may raise the price itself. Violations are "incidents".
13. **Gender** field when `is_gender_specification_required`.
14. **Booking status UI:** "in progress" until a final status. Success only on `ok` / webhook success. Clear failure.
15. **Indexing.** No full hotel descriptions or photo galleries on search-engine-indexable pages (unless microdata names ETG as the source). Public facts are fine: name, address, amenities, policies. No mass download from the CDN or API without real user interaction [doc: Glossary].
16. **Static content.** Keep it current, ideally daily, through the Content API with `updated_since`. **Never call the Content API during live user searches** [doc: IR 2.1/2.2].
    - `/hotel/info/` is for hotels missing from your dump, or for a pre-booking check. It is limited to 30 per 60 s and needs a custom `User-Agent` (`PartnerName/ClientVersion (details)`).
    - [inferred] Review MYT's `app/api/hotels-info` and `reviews.ts`, which call `/hotel/info/` and `content/v1/hotel_reviews_by_ids` on cache misses.
17. **Upsells (if used).** At most one `early_checkin` and one `late_checkout`, only when the user asks. They are not cancelled with the booking (email support), and they inherit `free_cancellation_before`.
18. Further fields to consider showing:
    - `no_show` (amount, `from_time` in hotel local time)
    - `deposit` (for `hotel` payment)
    - `legal_info.provider`: non-null only where the law requires it
    - `daily_prices`
    - hotel check-in times from static content

---

## 6. Post-booking and webhooks

### Retrieve bookings `/api/b2b/v3/hotel/order/info/`
- Body:
  - `ordering {ordering_type: asc|desc, ordering_by: created_at|checkin_at|...}`: required.
  - `pagination {page_size <= 50, page_number >= 1}`: required.
  - `search {partner_order_ids[], order_ids[], status, created_at{from_date,to_date}, ...}`, `language`.
- Status values: `cancelled`, `completed`, `failed`, `noshow`, `rejected`.
- **Never use it to decide the booking's status.**
- **Time gap:** wait **1 to 2 minutes** after the confirmation before the first call. The data syncs asynchronously, and an early call may come back empty [doc]. The checklist asks "Have you implemented the time gap?".
- **Hotel confirmation number (HCN)** is in the hotel data's `order_id` field:
  - It is usually ready within 48 h of confirmation, sometimes later.
  - Re-poll every 24 to 48 h, for up to 96 h after booking and up to 96 h before check-in.
  - A missing HCN is not an error; do not block on it.
- "We don't change the rate details during the booking process", so you do not need to re-confirm.

### Cancel `/api/b2b/v3/hotel/order/cancel/`
- Body: `{ "partner_order_id": "..." }`. The spec also lists an optional `amount_commission`.
- Works only on confirmed orders.
- Response: `amount_payable` (the penalty), `amount_refunded`, `amount_sell`.
- Errors:
  - `order_not_found`
  - `order_not_cancellable`: the stay has started, or there is no permission to cancel non-refundable bookings
  - `sandbox_restriction`
  - `lock`
  - `unknown`
  - `timeout`: retry once
- Penalties on non-refundable bookings are real (not in the sandbox).
- Required for test-key bookings.
- Bookings in one order group (same `invoice_id`) must be cancelled one at a time.

### Documents
All are GET with `?data={json}` and return PDF.

| Document | Endpoint | Query | Errors |
|---|---|---|---|
| Voucher | `/api/b2b/v3/hotel/order/document/voucher/download/` | `{"partner_order_id", "language"}` | `pending`, `failed_to_generate_document`: retry later. `voucher_is_not_downloadable`: the order is still processing or unpaid. `order_not_found`. |
| Order invoice | `/hotel/order/document/info_invoice/download/` | `{"partner_order_id"}` | `invoice_not_available` |
| Order-group invoice | `/ordergroup/document/invoice/download/` | `{"invoice_id"}` | |
| Single act | `/hotel/order/document/single_act/download/` | `partner_order_id`, `show_b2b2c_price`, `add_commission`, `seal` | |
| Closing documents | `/general/document/closing_documents/download/` | `package_id` | |

### Booking status webhook (B2B)
- **Registration:** send the callback URL to **API support**, who configure it. There is no self-service endpoint.
- **Body:**
  ```json
  {"data":{"partner_order_id":"...","status":"completed"|"failed"},
   "signature":{"signature":"<hex>","timestamp":1574146939,"token":"<string>"}}
  ```
  - The docs describe `token` as a "randomly generated string with the length of 50 characters", but the example is a 36-char UUID.
- **Signature:** `hex(HMAC_SHA256(key = API key token (the API_KEY secret), msg = str(timestamp) + token))`, compared with `signature.signature`.
  - Optional: reject reused tokens (replay) and check that the timestamp is fresh. The PHP sample allows 15 s.
- **Reply 200** to acknowledge. **Any code > 299 triggers a retry** after 30 s, 60 s, 90 s, 120 s, 150 s, 300 s, 1 h, 12 h, then every 12 h, up to **21 attempts**.
- The webhook gives no failure reason; call check booking for it.
- You may run both the webhook and polling for redundancy. **At least one is mandatory.**
- The Midoffice "booking changes" webhook (`type`: `created` / `updated` / `cancelled`, with `agreement_number`) is documented for midoffices that work with an agency or TMC. Its retries total 14 over 7 days. [inferred] It is probably not offered to a plain B2B partner. Ask, because it would catch hotel-side cancellations.

---

## 7. Infrastructure

**Hosts** [doc: Authorization, changelog]:
- Production and test: **`https://api.ratehawk.com`**. Sandbox: **`https://api-sandbox.ratehawk.com`**.
- `api.worldota.net` and `api-sandbox.worldota.net` are **deprecated**. The sandbox host `api-sandbox.worldota.net` "will stop working on June 30, 2026" (already past). No sunset date is published for the production `api.worldota.net`.
- [inferred] MYT still calls `https://api.worldota.net` in `app/api/hotels/route.ts`, `app/api/hotels-warm/route.ts`, `app/api/hotels-info/route.ts` and `app/api/hotels-info/reviews.ts`. Move them as part of this work.

**IP whitelisting:**
- Integration Requirements 1.4: partners "are required to provide their IP addresses for whitelisting". ETG can also send its own IPs if you need to whitelist them (for webhooks) [doc].
- The checklist: "If you are using the dynamic IP addresses, please proxy them via static IP. **This is mandatory.**"
- Calling from a non-whitelisted IP returns `not_allowed_host`.
- [inferred] Vercel functions use dynamic egress. MYT needs Vercel Static IPs or a fixed-IP proxy for every ETG call, search included, before production. Apparently the current key is not IP-restricted, since search works from Vercel today.

**Rate limits** [doc: Request limits, Retrieve endpoints]:
- Limits are per endpoint and per key.
- Read them with `GET /api/b2b/v3/overview/` (itself limited to 5 per 60 s) and from the response headers `X-RateLimit-SecondsNumber`, `X-RateLimit-RequestsNumber`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (UTC, `YYYY-MM-DDTHH:MM:SS`), mirrored in `debug.api_endpoint`.
- Exceeding a limit returns HTTP 429 `endpoint_exceeded_limit`.
- Example values in the docs (yours may differ):

  | Endpoint | Example limit |
  |---|---|
  | `booking/form`, `booking/finish`, `finish/status`, `order/cancel`, `contract/data/info`, `hotel/info` | 30 per 60 s each |
  | `serp/hotels` | 1000 per 60 s |
  | `overview` | 5 per 60 s |

- MYT's own notes measured `serp/geo` at 10 per clock minute on the current account.
- The checklist asks for **expected RPM** for `serp/hotels`, `serp/region`, `serp/geo`, `search/hp`, `hotel/prebook` and `serp/prebook`.
- Limits are raised **only after certification**, depending on sales volume.

**Timeouts:**
- SERP/HP: `timeout` up to 100 s, 30 s recommended.
- Prebook: 60 s recommended, 30 s minimum.
- Booking cut-off: agreed during certification, configured by ETG. The checklist asks for your "expected" and "maximum" booking timeout.

**Other:**
- HTTPS only. GET for reads, POST for writes. The body must be a JSON object (otherwise `body_must_be_json_object`).
- A 402 `overdue_debt` blocks everything.

---

## 8. Open questions the docs do not answer

1. **Booking cut-off:** what default do new keys get, and what does ETG accept? Is the `book_timeout` field in the OpenAPI booking/finish body supported (the docs say dynamic timeouts are not)?
2. **Polling cadence vs rate limit:** 1 s, 3 s or 5 s? The example limit for `finish/status` is 30 per 60 s per key, which also caps how many bookings can be in flight at once.
3. Is a **429 `endpoint_exceeded_limit` or a `lock`** during status polling really final? The docs list both as final failures, but ETG may still confirm the booking.
4. How long do the sandbox `unknown_*` cases stay `unknown` before the final status? This decides whether a short poll loop passes S5 to S7.
5. **Webhook success value:** `completed` (payload doc) or `confirmed` (IR 5.6)? Is any 2xx accepted, or only 200? Is the HMAC key the secret of the key that made the booking? Can the test environment send webhooks?
6. **Key types:** how can a partner tell sandbox from test from production other than by host and behaviour? The test-key refundable policy example `"2024-12-05T20:00:00"` is stale. Which `free_cancellation_before` should test bookings on `8473727` use now?
7. **`sandbox_restriction` semantics:** IR says "a real hotel with a test key", while Start booking says "test hotel with a production key". It is probably both; confirm.
8. **IP whitelist:** is it enforced for the existing production key? Which static-egress setup does ETG accept for Vercel? Does ETG publish source IPs for webhooks?
9. When does **`api.worldota.net` (production)** stop working?
10. Is **`supplier_data`** required for MYT's contract? If so, MYT's contact or the customer's?
11. **`user.email` for B2B:** must it be a fixed MYT mailbox? Does ETG email that address, and does any email reach the traveller?
12. **Taxes:** Israeli law may require all-inclusive prices. How does ETG want "pay at hotel" taxes presented then?
13. **`is_package` rates:** may MYT sell them, given MYT bundles hotel + flight + ticket? Must the hotel step then hide the hotel price?
14. **Omitting children's names:** is it allowed without triggering `incorrect_children_data`?
15. **Different room types for one party:** separate bookings? How do they relate on ETG's side (order groups)?
16. **Prebook from SERP:** does MYT's flow (no hotel page; ready packages built in the backoffice) need `/serp/prebook/` approval? Or must MYT add `/search/hp/`, given that caching HP results is prohibited and packages store a hotel rate?
17. **Content API / `/hotel/info/` calls on cache misses during user sessions:** acceptable, or must everything come from offline sync?
18. Is the **Midoffice booking-changes webhook** available to B2B partners, so MYT learns of hotel-side cancellations and modifications?
19. **Test-key scope:** do the magic `partner_order_id` suffixes exist only in the sandbox? (They are documented only there.) Can certification run entirely in the sandbox, or does ETG also require the test-key cases?
20. Which **Pre-Certification Checklist** variant applies to a B2B website (B2C reseller)? The copy at hand is the generic one.
