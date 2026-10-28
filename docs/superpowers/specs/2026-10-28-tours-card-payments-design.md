# Tours: card payment links from the order (design)

Date: 2026-10-28. Source: Alon's note "סליקה אשראי לחבר" (ROAD MAP MEGATR, tab `t.kw44n12anc02`, 28.10);
Dor's answers in the 28.10 session. Status: Dor said "בוא נסיים פה ... ונעלה לאוויר" - build it.

## Why

A Mega Family rep closes a deal on the phone or on WhatsApp and needs the customer's card money: a
deposit to hold the seats, later the balance. Today the only card payment is the site's own checkout,
and it can charge one thing only - the WHOLE order, once (`tours.booking_start_payment` computes
`ceil(total x rate)` and refuses any other amount). So a deposit or a balance is taken outside the
system and typed into the payments log by hand.

## What Dor decided

1. **The terminal is the one the site already uses** - Mega Events' CreditGuard terminal, same company,
   for the Mega Family site AND for these links. When Mega Family gets its own terminal, it replaces the
   site's `CG_*` env and nothing else changes.
2. **The rep types the amount; it stays editable.** The deposit's default is **$200 per traveler**
   (adults + children of the order).

## What gets built

A **payment link**: a rep opens an order on the card, presses "Payment link", picks what it is for
(deposit / balance / other) and the amount, and gets a link to send. The customer opens it on the
**Mega Family site** (`{siteUrl}/pay/<token>/`), sees the tour, the order number and the amount, presses
Pay, types the card on **CreditGuard's own page**, and comes back to a thank-you page. The payment lands
in the order's payments log by itself.

### Use cases

- **Deposit over WhatsApp / e-mail** - kind `deposit`, default 200 x travelers (in the order's currency
  when it is USD; for another currency the box opens empty).
- **Balance** - kind `balance`, default = what the order still owes (`orderBalance(...).due`).
- **Over the phone** - the rep opens the same link on their own screen and types the card with the
  customer on the line. No new mechanism. A 3-D Secure challenge (if the bank asks) goes to the
  customer's phone - the rep asks them for the code.
- **Other** - any amount up to the balance (also how Dor tests with a small charge).

### Rules (pure, `lib/tours/payment-links.ts`, selftest `scripts/tours-payment-links-selftest.ts`)

- Amount > 0, at most the order's balance (`due`), at most `PAYMENT_AMOUNT_MAX`; two decimals.
- A link lives `LINK_DAYS_DEFAULT` 7 days (the rep may pick 1-30), is used for ONE payment, and can be
  cancelled by the rep any time before it is paid.
- Payments (installments): the rep picks 1-12, default 1. A deposit is always 1.
- No link on a cancelled or failed order, or one with nothing left to pay.
- The charge is in shekels at the rate of the moment the customer presses Pay: the company's typed rate
  of today (`public.company_exchange_rates`), else the site's automatic rate + margin - the same rule and
  the same bounds as the site's checkout. What was charged in shekels is stored with the payment.

### Money landing (database, migration `20261028.._tours_payment_links.sql`)

Table **`tours.payment_links`** (backoffice-only: RLS on, no policies, service role; the site reaches it
only through `tours.site_booking`): `company_id`, `booking_id`, `kind` (deposit / balance / other),
`amount` + `currency` (the order's), `payments`, `token` (24 random bytes, base64url), `expires_at`,
`status` (open / started / paid / review / cancelled), the charge (`rate`, `rate_source`, `amount_ils`,
`cg_uniqueid`, `cg_tx_id`, `cg_auth_number`, `cg_card_last4`, `cg_result`), `payment_id` (the log row),
`attempts`, `last_error`, `created_by`, `sent_at`, `paid_at`, `cancelled_at`.

Three new actions on the site's one entry point (`tours.site_booking` is re-created with them; the
`c_<slug>.site_booking` wrapper is unchanged, so `provision_company` is untouched). All three need the
site key (`tours.booking_key_ok`), like start/finish payment:

- `pay_link {key, token}` - what the page shows: tour name, departure date, order ref, the customer's
  first name, kind, amount, currency, payments, the state (open / paid / expired / cancelled). No phone,
  no e-mail, no price breakdown.
- `start_link_payment {key, token, uniqueid, rate}` - only an open, unexpired link (a `started` one may
  start again: the customer closed the card page); fixes the shekel amount and the uniqueid.
- `finish_link_payment {key, uniqueid, ok, amount_agorot, currency, tx_id, ...}` - the site's server asked
  CreditGuard (inquireTransactions) first, never the browser. Then:
  - **succeeded with exactly `amount_ils` in ILS, and the transaction paid nothing else** (no booking, no
    other link, no payments row holds it): one `tours.booking_payments` row - kind = the link's kind,
    status paid, amount in the order's currency, `amount_ils`, method `site` (so the log already treats
    it as a gateway payment: only the invoice number / note can change, never removed - a refund is its
    own row), `cg_tx_id`, note "Payment link ...". The link becomes `paid`. The card's follow-up day moves
    to today (unless it is already today or earlier), so the rep sees it on TODAY. **The card's status is
    not moved** - Nir's rule stands: a gateway payment never closes a deal by itself; the rep sets
    Deposit paid / Paid (the round-3 dialogs ask for the next follow-up).
  - **failed or cancelled**: no payment row; the link goes back to `open` (the customer may try again
    until it expires), `attempts` + 1, `last_error`.
  - **succeeded but the amount, currency or transaction does not match**: the link becomes `review`, no
    payment row, the follow-up moves to today; the rep checks CreditGuard and records it by hand.
  - A second finish of a paid link answers "already" and writes nothing.
- **Invoice number** stays typed by hand on the payment row (no invoicing system is connected).

### Security

- The card is typed on CreditGuard's page only. Our servers see the last 4 digits, the authorization
  number and the transaction id - never the card number or expiry (the site's `KEEP` list).
- The link is a 192-bit random token: unguessable, usable once, expires, cancellable. The amount is
  fixed in the database - nothing price-bearing comes from the browser.
- The site's server calls the database with the site role + `BOOKING_SITE_KEY`; the page shows the
  customer's first name and the tour only.
- Backoffice actions: `requireCompanyRep("tours")` + `assertCardVisible` (a rep links their own and
  unassigned cards only), every write audited (`tours_payment_link`).

### Screens

- **Backoffice, the order's payments** (`components/tours/cases/order-money.tsx`): a "Payment link"
  button beside "Record a payment" opens a dialog (for: deposit / balance / other; amount prefilled;
  payments; valid for N days). After creating: the link with Copy / WhatsApp (the rep's app,
  `whatsappAppLink`) / E-mail (mailto) - a click on WhatsApp or e-mail stamps `sent_at`. Under the
  payments: the order's links with their state (open until dd.mm / paid / expired / cancelled / needs
  checking), Send again and Cancel.
- **Site (mega-family)**: `app/pay/[token]/page.tsx` (summary + Pay), `app/api/pay/[token]/route.ts`
  (start + doDeal), `app/api/pay/return/[uid]/[result]/route.ts` (inquire + finish), `app/pay/done/page.tsx`
  (thank you / not charged / being checked). `noindex`. Off (a clear message) when `CG_*` or
  `BOOKING_SITE_KEY` are missing.

## Not built (later)

- A link on a card that has no order row (a reservation typed by hand holds seats only - no booking, so
  no payments log). Today: send the booking link first, or record the payment by hand.
- Saved cards (tokens), J5 holds, refunds through the API, automatic invoices / receipts, sending the link
  from the company's WhatsApp number (Cloud API template - waits on Tom's Meta setup) or company mail
  (waits on the ZeptoMail domain).

## Calls I made (Dor did not decide these)

- The page lives on the Mega Family site, not the backoffice (the customer sees the company's own domain).
- 7 days default validity; one payment per link; the rep picks installments (deposit = 1).
- Amount capped at the order's balance.
- Method `site` on the payment row (reuses the log's gateway protection).
- A paid link moves the card's follow-up to today and leaves the status to the rep.
- Default $200 per traveler applies when the order is in USD; another currency opens empty.

## Deploy order

1. Backoffice push to master (the migration rides it) - the new `site_booking` actions exist.
2. mega-family push (the pages). Its env already holds `CG_*` and `BOOKING_SITE_KEY`.
3. Dor's check: an "Other" link of a few shekels on a real order, pay it, see the row land, refund it in
   CreditGuard and record the refund.
