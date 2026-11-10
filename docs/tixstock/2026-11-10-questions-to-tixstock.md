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

## 2. One consolidated message (drafted 10.11, waiting for an answer)

Dor asked that everything open goes in one message, so TixStock answers once. Questions 10-13 are the ones the
design kept for the CS call.

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

## 3. What we build until they answer

| Open question | What the code does meanwhile | Where one answer changes it |
|---|---|---|
| 1 - our order id in orders/add | Sends no id of ours; `orders/get` / `orders/update` take TixStock's `data.id` | `buildOrderRequest` (`lib/tixstock-booking/rules.ts`) and the client's callers |
| 2 - the order's currency | Sends the feed's USD amount; stores the answer's `currency` / `grand_total`; warns on a difference | `buildOrderRequest` |
| 3 - `requires_lead_booker` | No card for such a listing on the sandbox step; a warning in the office dialog | `sandbox-cards.ts`, `rank.ts` |
| 4 - by event or by customer | By the event's country (`venue.country_code = IT`) | `openTicketBooking`, the sandbox ticket step |
| 5 - `gender` / `nationality` | Field `gender` with `M` / `F`; ISO alpha-2 in `nationality`; passport in `national_id` | `buildOrderRequest` only |
| 6 - Serie A item from the back office | The form is built on the test event as designed (Dor, 10.11) | nothing to change |
| 7 - hex or base64 | Accepts both, over the raw body | `verifyTixstockSignature` |
| 8 - hold / release webhooks | Logged, answered `success: true` | `handleTixstockWebhook` |
| 9 - webhooks over 4.5 MB | Vercel refuses them before our code; the refresh (`orders/get`) is the fallback | the sweep and the card's Refresh |

The sandbox itself answers three of these in the first end-to-end run (plan Task 17, Stage 5): which id
`orders/get` takes, the currency an order is registered in, and what a 10-minute-old hold answers.
