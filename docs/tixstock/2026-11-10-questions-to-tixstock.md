# TixStock - questions and answers (10.11.2026)

Design: `docs/superpowers/specs/2026-11-09-tixstock-ticket-booking-design.md`.
Plan: `docs/superpowers/plans/2026-11-09-tixstock-ticket-booking.md`.

Dor sends every message himself (the WhatsApp group with TixStock). Claude drafts; Dor approves the wording.

## 1. Answered on 10.11

Five questions went out after the plan review. TixStock's answers, as they wrote them, and what each one changed.

### 1.1 How do we verify `X-Tixstock-Signature`?

> Tixstock API authenticates all it's webhook requests by sending a X-TIXSTOCK-SIGNATURE signature. The signature
> is hashed using sha256 and the data set (for the signature) is the payload of the webhook JSON encoded, which we
> send to your endpoint. The key is set to your Bearer Token provided by Tixstock.

- Read as HMAC-SHA256 of the raw request body, keyed with that environment's API token.
- There is no separate webhook secret: two env names left the plan.
- Hex or base64 was not said. The receiver accepts both; the first sandbox webhook is the proof.

### 1.2 Is `external_id` the id orders/add returns, or an id of ours?

> The external_id should be your own internal order ID, not the Tixstock order ID.

- Every webhook answer carries our reservation id.
- Not answered: where that id is sent in orders/add. The guide's body has no field for it (question 1 below).

### 1.3 orders/add timed out - was the order created? May we repeat it? What does an expired hold answer?

> Order Creation Check: Once an order is successfully added, you will receive a response from the orders/add API.
> You can also verify whether the order was created successfully by checking the API response in the Request Logs.
> Retrying orders/add: Retrying the same order is not safe, as it may result in duplicate orders. Before retrying,
> please verify in the Request Logs and also check on Tixstock whether the order has already been created
> successfully. Expired Hold: If the hold has expired, you will receive a Resource Not Found error. In that case,
> you will need to place a new hold on the listing before proceeding with order creation.

- No lookup by API. An unanswered orders/add is `uncertain`, and staff settle it from the Request Logs.
- A new hold is placed only on "Resource Not Found", and only on the row's first orders/add.

### 1.4 `items[].price` - the listing's proceed price, and in which currency?

> The price received from Tixstock will already include the Tixstock fee. You can add your own fees or markup on
> top of that

- The currency was not answered (question 2 below).
- Measured on the live feed the same day (57 listings, 3 events): one price field, `proceed_price`, and no
  `display_price`. Seller's currency by default; USD at TixStock's rate with `target_currency=USD`.
- So `proceed_price` is our full cost, and it is the amount sent as `items[].price`.

### 1.5 Is an attendee's passport number sent in `national_id`?

> For Italian customers, attendee details are: first name, last name, email, citizenship(country code), dob,
> gender, Place Of birth, National id

- New against the design: gender; place of birth for every attendee; an e-mail per attendee (we send the
  buyer's).
- `gender` is not in the guide's `Attendee` schema, and the guide's `nationality` example is "British"
  (question 5 below).
- "Italian customers" here, "italian events" on 09.11 (question 4 below). 58 of our 438 TixStock products on sale
  are at an Italian venue.

## 2. One consolidated message (drafted 10.11; questions 1-9 sent, answered the same day - section 4)

Dor asked that everything open goes in one message, so TixStock answers once. Questions 10-13 are the ones the
design kept for the CS call; they were NOT sent in this round.

```
Thanks, very clear. To close everything in one round, here are all our open questions:

Orders
1. Our own order id: orders/add has no field for it in the guide (only customer.id). Where do we send it? And do /orders/get and /orders/update take our id, or the id that orders/add returns?
2. We pull the feed with target_currency=USD. Is the order then registered in USD, with items[].price = the listing's proceed_price in USD?
3. What does requires_lead_booker = true on a listing require from us?

Attendee details
4. Are full attendee details required by the event's country (venue in Italy), or by the customer's nationality? Our customers are Israeli, and we sell Serie A matches.
5. Field details: "gender" is not in the Attendee schema - what is the field name and the values? Is nationality an ISO code ("IL") or a word ("British", as in the guide)? For a non-Italian attendee, is national_id the passport number?
6. Real Serie A orders will be placed from our back office, where our staff enter these details. Can the Serie A attendee item of the health check be shown from the back office instead of the website checkout?

Webhooks
7. Signature: is the digest hex or base64, and is it computed over the exact request body you send?
8. ticket.hold / ticket.release webhooks carry no order. Which response do you expect for them?
9. Our platform accepts requests up to 4.5 MB. Can a fulfilment webhook with PDF files be larger? Does orders/get return the same files, so we can fetch them instead?
10. Is the webhook URL registered once per environment (sandbox / production)?

Production
11. Will the production booking token be our current feed token with booking enabled, or a new one?
12. We place orders from our back office after the flight and hotel are confirmed, sometimes days after the customer paid (as we do in TX Trade today). Please confirm this is fine.
13. Paper tickets: is shipping to the customer's hotel acceptable?
```

## 3. Where each question stands, and what the code does

State after TixStock's round 2 (section 4). "Closed" = answered and the code matches.

| Question | State | What the code does | Where an answer changes it |
|---|---|---|---|
| 1 - our order id in orders/add | Closed | Sends `order_id` = our reservation id as a string (`ourOrderId`) - the same value the webhook answers as `external_id` | `buildOrderRequest` (`lib/tixstock-booking/rules.ts`) |
| 1b - which id `orders/get` / `orders/update` take | Open | They take the id orders/add returned | the client's callers |
| 2 - the order's currency | Closed ("YES") | Sends the feed's USD amount; stores the answer's `currency` / `grand_total`; warns on a difference | - |
| 3 - `requires_lead_booker` | Open (no answer) | No card for such a listing on the sandbox step; a warning in the office dialog | `sandbox-cards.ts`, `rank.ts` |
| 4 - by event or by customer | Closed | By the event's country (`venue.country_code = IT`), every attendee | - |
| 5 - `gender` / `nationality` | Closed | `gender` goes out as `Male` / `Female` (our forms keep `M` / `F`); a country code in `nationality`; passport in `national_id` | `buildOrderRequest` only |
| 6 - Serie A item from the back office | Waiting (TixStock's Abdullah) | The form is built on the test event as designed (Dor, 10.11) | nothing to change |
| 7 - hex or base64 | Closed for us | Accepts both, over the raw body ("the exact JSON payload": confirmed) | `verifyTixstockSignature` |
| 8 - hold / release webhooks | Closed | Logged, answered exactly `{ "ok": true }` | `handleTixstockWebhook` |
| 9 - webhooks over 4.5 MB | Open (only the file types were answered) | Vercel refuses them before our code; the refresh (`orders/get`) is the fallback | the sweep and the card's Refresh |
| 10 - webhook URL per environment | Answered by the Reseller Admin itself | Each environment has its own Webhooks tab, one row per type; the sandbox's ten rows are registered (section 5) | - |
| 11-13 - production token, late orders, paper to a hotel | In the follow-up of 11.11 (section 5, questions 11-13) | - | - |

The sandbox itself answers some of these in the first end-to-end run (plan Task 17, Stage 5): which id
`orders/get` takes, what a 10-minute-old hold answers, hex or base64, and whether a webhook's `order_id` is
still TixStock's own id now that we send ours.

## 4. Answered on 10.11, round 2 (questions 1-9)

As TixStock wrote them. They numbered inside each heading, so "Orders 3" (`requires_lead_booker`) has no answer.

> **Orders**
> 1. In the orders/add request body, you will find a field called order_id You should pass your own internal
>    order ID in this field. For example: "order_id": "454104g8195"
> 2. YES
>
> **Attendee details**
> 1. For events in Italy, attendee details are required regardless of the customer's nationality. For Italian
>    events, the following attendee details must be provided for each ticket: First name, Last name, Email
>    address, Gender, Date of birth, Place of birth, Nationality, National Id
> 2. For the gender field, the accepted values are Male or Female. For nationality, please provide the country
>    code (e.g., IT for Italian nationality). Regarding national_id, you can provide the attendee's
>    identification document number, which serves as proof of their identity, such as their national ID or
>    passport number.
> 3. @Abdullah A.G Could you please assist here
>
> **Webhooks**
> 1. Tixstock authenticates all webhook requests using the X-TIXSTOCK-SIGNATURE header. The signature is
>    generated using SHA-256, with the webhook's JSON payload as the data and your Tixstock-provided Bearer Token
>    as the key. The signature is calculated using the exact JSON payload sent to your endpoint.
> 2. For both ticket.hold and ticket.release webhooks, please return the following response: `{ "ok": true }`
> 3. For fulfilment, the file format depends on the ticket type: E-tickets: PDF files will be shared. Mobile
>    links: The ticket links will be shared. External transfer proof: The proof of transfer can be in PNG, JPEG,
>    or PDF format.

What changed in the code the same day (backoffice `ac944190`, `1ae39bef`; myt-main `e2c0f71`):

- **`order_id`.** `buildOrderRequest` takes the reservation id and sends it as `order_id`; without a real
  reservation id no body is built. `ourOrderId` is the one function that spells the id, for the order body and
  for the webhook's `external_id`.
- **Gender.** `M` / `F` go out as `Male` / `Female`.
- **Hold / release.** Answered exactly `{ "ok": true }`. `ticket.fullfillment` was not named: it is answered with
  `ok: true` beside the four fields of an order answer.

Decided on our side, and what it costs if wrong:

- **One `order_id` per reservation.** A reservation that is booked a second time (after a cancelled or failed
  attempt) sends the same `order_id` again. If TixStock refuses a repeat, that second booking fails loudly (the
  row is `failed` with their error) and `ourOrderId` gets an attempt suffix. If they do refuse repeats, a lost
  orders/add answer becomes safe to repeat - which 1.3 says it is not today.
- **A webhook's `order_id`.** The receiver finds a booking by the id orders/add RETURNED. If TixStock's webhooks
  start carrying OUR `order_id` instead, they are answered "unknown order" and the files arrive only through the
  refresh. Every webhook is logged with its payload, so the first sandbox webhook shows which id it carries.

## 5. Follow-up (final text of 11.11; Dor sends it)

What joined the round-2 leftovers:

- **The Seller Portal user.** Dor has no user on `sandbox-new.tixstock.com`, so the seven test listings
  (`2026-11-09-sandbox-listings-checklist-he.md`) cannot be created yet. The only point that blocks work today.
- **What the sandbox showed once the webhooks were registered (10.11 evening).** The Reseller Admin takes one
  webhook row per type; ten rows now point at `https://backoffice-app-six.vercel.app/api/tixstock/webhook/sandbox`
  (`ticket.hold`, `ticket.release`, `order.update`, `order.eticket_fulfilment`, `order.mobile_ticket_fulfilment`,
  `order.mobile_link_ticket_fulfilment`, `order.paper_ticket_fulfilment`, `ticket.fulfillment`,
  `order.season_cards_ticket_fulfilment`, `order.local_delivery_ticket_fulfilment` - their spellings). A hold and
  a release placed by our client (both 200, listed in their Request Log) sent us no webhook: their Webhook Log
  stayed empty. So TixStock's real signature is proven only by the first order webhook.
- **The production questions** kept for the CS call (11-13 of section 2), sent now so one round closes everything.

One question per line: in round 2 the second half of a two-part question went unanswered twice.

```
Good morning,

Thanks, this was very clear. To close the remaining points in one round:

Sandbox
1. We have no user on the sandbox Seller Portal (sandbox-new.tixstock.com). Could you open one for us, so we can create the test listings for the health check and fulfil them ourselves? Or should we use the listings already in the sandbox, and you fulfil the test orders?

Orders
2. Do /orders/get and /orders/update take our order_id, or the id that orders/add returns?
3. Is order_id unique on your side? Would a second orders/add with the same order_id be rejected?
4. What does requires_lead_booker = true on a listing require from us?

Webhooks
5. We registered all ten webhook types in the sandbox Reseller Admin. A hold and a release we placed through the API sent us no ticket.hold / ticket.release webhook (the Webhook Log is empty). Is that expected?
6. In order webhooks, is order_id your order id or ours?
7. Fulfilment: do the PDF files arrive inside the webhook JSON, or as links?
8. Our platform accepts requests up to 4.5 MB. Does /orders/get return the same files, so we can fetch them if a webhook is larger?
9. ticket.fulfillment: is the expected response also { "ok": true }?

Health check
10. @Abdullah - real Serie A orders are placed from our back office, where our staff enter the attendee details. Can that step of the health check be shown from the back office instead of the website checkout?

Production
11. Will the production booking token be our current feed token with booking enabled, or a new one?
12. We place orders from our back office after the flight and hotel are confirmed, sometimes days after the customer paid (as we do in TX Trade today). Please confirm this is fine.
13. Paper tickets: is shipping to the customer's hotel acceptable?
```

What each answer changes on our side:

| # | If the answer is... | Then |
|---|---|---|
| 1 | a user is opened | Dor signs in, the seven listings are created; until then the test events use the sandbox's own listings |
| 2 | our `order_id` | the client's `getOrder` / `updateOrder` callers pass `ourOrderId(reservationId)` instead of the returned id |
| 3 | a repeat is rejected | a re-booked reservation needs an attempt suffix in `ourOrderId`; a lost orders/add answer becomes safe to repeat |
| 5 | not expected | they look at their side; nothing changes in our code |
| 6 | ours | the receiver also matches a booking by reservation id + listing id (today: by the id orders/add returned) |
| 7-8 | inside the JSON, over 4.5 MB possible | the refresh (`orders/get`) stays the way those files arrive |
| 9 | another shape | one line in `handleTixstockWebhook` |
