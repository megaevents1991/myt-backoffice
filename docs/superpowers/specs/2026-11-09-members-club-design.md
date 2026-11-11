# Members club at checkout - design

**Date:** 09.11.2026 · **Owner:** Dor · **Repos:** myt-main (branch), myt-backoffice (master)
**Replaces:** `2026-11-08-newsletter-zoho-design.md` (no outside sender in this round; Zoho Campaigns comes later)
**Mockups:** https://claude.ai/artifact/HRfERvHTyQM8DCMmtxVMVG

## 1. Intent

Today the order summary opens a popup after 22 idle seconds and gives $50 per traveler to whoever waits. The discount
is computed only in the browser, nobody is recorded, and nothing comes back to us. Dor's new direction (09.11): spend
the same money on a **members club**. The customer leaves an email and a phone with a consent tick, joins, and only then
sees the discount. We get a list we own, with recorded consent, that later feeds a newsletter (Zoho Campaigns) once it
is large enough to justify one.

The club is a feeling, not just a form: "be our friend", members hear first, members get special deals and a member
price on every order. It should look and read like something a person is glad to join.

## 2. Decisions (Dor's)

| # | Decision |
|---|---|
| D1 | The club lives on the order summary of mega-events.co.il, **in place of** today's inactivity discount popup. |
| D2 | Join = email + phone + an unticked consent box. The amount is **not shown before joining**, only after. |
| D3 | The amount is the same as today's popup: **$50 per traveler** (event ticket). |
| D4 | The member price applies on **every order** of a member, not once. |
| D5 | "Already a member?" = the email alone. No mail code (D4 makes a stronger check protect nothing: anyone can join). |
| D6 | On joining, a welcome mail goes out. No newsletter sending in this round. Zoho Campaigns comes once there are enough members. |
| D7 | **Full support in our backoffice**: see the members, the numbers, change the amount, export. |
| D8 | Site side in **myt-main on a branch** (new development, not a hotfix); backoffice changes on **master**. |
| D9 | **One consent for mail, SMS and WhatsApp.** Any withdrawal (the mail link, or "הסר" on the Mega Events WhatsApp number) stops all marketing to that member; the member price stays. (09.11, §13 Q1) |
| D10 | The privacy page's "double opt-in" line is replaced by the recorded single opt-in (§11). (09.11, Q2) |
| D11 | Name and look: version **C, "MEGA CLUB"** (Dor 09.11, after reopening the default): a mint-to-teal member card like a credit card - "MEGA CLUB" wordmark, chip, member number, name, "מאז 11/26". |
| D12 | **No club on ticket-only orders**, as today's popup. (09.11, Q4) |

## 3. Goals, non-goals, anti-goals

**Goals**
- A visitor on the summary can join in under 20 seconds and sees the member price applied at once.
- A returning member gets the member price with no friction (recognized on the same device, or by email).
- Every join is recorded with what was agreed to, when, from where (IP, user agent, page, UTM).
- Staff see the club's size, growth, orders and money in the backoffice, and can export the list.
- The discount is checked on the server like any coupon. The browser never decides the price.

**Non-goals (this round)**
- Sending newsletters or campaigns. Zoho Campaigns is phase 2.
- A signup form outside the order summary (footer, homepage). Phase 2.
- WhatsApp or SMS marketing. The phone and the consent are stored for later; nothing is sent.
- Meta CAPI / Google enhanced conversions. Phase 2 (GA4 + Mixpanel events only now).
- Member accounts, login or passwords.

**Anti-goals (would make this a failure even if it works)**
- The club spends more discount than today's popup without anyone seeing it. The backoffice must show the money.
- A join that silently fails: the customer believes they are in, there is no row, or no price.
- Consent that cannot be proven later (no wording, no time, no IP).
- Breaking checkout. A club bug must never block an order. Every club call fails open to "no club", never to an error page.
- Partner (agent / influencer) traffic getting both a partner discount and a member price.

## 4. Who sees what

Eligibility is one pure function in main (`lib/club/eligibility.ts`) over what the summary already knows:

| Visit | What shows |
|---|---|
| Agent mode (`isAgentVisitor`) | Nothing. As today. |
| Partner-link visit (`arrivedViaPartner`: agent / affiliate / cookie partner) | **Today's popup, unchanged.** Coupons and partner terms do not mix (confirm-order already rejects a coupon on such a visit). |
| Ticket-only order (`flightSkipped`) | Nothing. Today's popup never showed there either (a flat $50 on a ticket alone is a far larger cut). |
| A partner with a percentage discount | Nothing (as today). |
| Event in the special-offer blocklist (`isSpecialOfferAllowed`) | Nothing (as today). |
| Everyone else | **The club.** |
| Club switched off in the backoffice | Today's popup, exactly as now: no club popup, no row, no cookie auto-apply; join and lookup answer `off`. A member code typed into the coupon field keeps working. This is the instant rollback with no deploy. |

## 5. The customer's path (site, myt-main)

Look: version **C, "MEGA CLUB"**, from the mockup page (D11). Every word lives in one file, `lib/club/copy.ts`.

1. **The popup.** Today's trigger, kept exactly (`OrderReview.tsx:1196-1250`): a one-shot timer of
   `popup_delay_seconds` (22, from settings) that starts when the first "almost there" modal closes, and that the first
   click / keydown / input / focus cancels for the whole page load. So the popup reaches the same visitors as today
   (idle ones) and the discount exposure through it does not grow; active visitors reach the club through the row (2).
   A club modal of its own on Mantine's `Modal`, with a close X and a form; the shared `components/ui/Modal.tsx`
   (no close button, no form slot) stays as it is. Content: the visual, title, one line, three perks ("ראשונים לשמוע
   על אירועים חדשים", "מבצעים לחברים בלבד", "מחיר חבר על ההזמנה הזאת ועל כל הזמנה הבאה"), email, phone, the consent
   box (unticked, the button stays disabled until it is ticked), the join button, a "כבר חברים?" link.
   - Email and phone are prefilled from the lead passenger's fields when already typed (this mostly helps the row path,
     since typing cancels the popup); the first and last name are taken from there too (they are not asked).
2. **The permanent row** under the coupon field (`couponRow`), shown whenever the club is eligible: "MEGA CLUB ·
   חברים מקבלים מחיר חבר" with "הצטרפות" and "כבר חברים" buttons that open the popup in that state. A returning
   member must never depend on idling 22 seconds.
3. **Joining** calls `POST /api/club/join`. On success the popup turns into the member card (number, name, "מאז"),
   "מחיר חבר הופעל: $X פחות על ההזמנה הזאת", "$50 לכל נוסע, ככה בכל הזמנה שלכם", "שלחנו ל-<email> מייל עם קוד
   החבר", and a "חזרה להזמנה" button. The member code is applied through the existing coupon path (`appliedCoupon`),
   so the price summary, the no-stacking rule and confirm-order all work unchanged.
4. **"כבר חברים?"** = email only → `POST /api/club/lookup` → the card with "ברוכים השבים" and the member number,
   **no name** (whoever types an email must not learn whose it is). An unknown email answers "לא מצאנו את המייל הזה
   במועדון" with a "הצטרפו עכשיו" link (no hint beyond that).
5. **Remembered on this device:** after a join or lookup the site sets cookie `myt_club` (member code, member number,
   and the first name only when it came from this device's own passenger form at join; 365 days; no email, no phone).
   On the next order the summary applies the code by itself and the row reads "מחיר חבר הופעל" (with the name when the
   cookie has one). No popup for a recognized member. The code is applied **only when the coupon slot is empty**: the
   summary holds one coupon and compares it only with the affiliate discount (`OrderReview.tsx:858-861`), so when
   another code is already applied the row offers "להחליף למחיר חבר" instead of replacing it silently.
6. **Errors:** a failed join or lookup shows "משהו השתבש, נסו שוב" in the popup; the order page keeps working. A member
   code that confirm-order rejects is handled by the existing `COUPON_INVALID` path (the client drops it and re-prices).
7. **Analytics** (no personal data in either): `dataLayer.push({ event: "club_join", club_method: "popup" | "row",
   returning: false })`, `club_member_applied` (`method: "lookup" | "cookie"`); Mixpanel `Club_Join` /
   `Club_Member_Applied` through `trackEvent`. GTM tags are Tom's.

## 6. How the member price works (reuse the coupon path)

Each member gets **one personal coupon row**. This reuses everything main already does with coupons: the validate
route, confirm-order's DB re-check, the partner-link rejection, no stacking with an affiliate discount, and
`reservations.coupon_code` / `coupon_discount_usd`, which already feed the backoffice reports.

- `coupons` row: `code` = `MEGA` + 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (not guessable: the club's point is the
  recorded consent, a sequential code would let anyone skip it), `discount_type` fixed, `discount_value` = the
  settings amount, `per_person` **true**, `event_id` null, `valid_until` null, `max_uses` null (D4), `is_active` true,
  **`source` = `'club'`** (new column).
- **Quantity = event tickets, on both sides.** confirm-order multiplies a per-person coupon by `number_of_ticket`
  (`route.ts:240-251`), but the summary multiplies by `numberOfPersons` = max(flight travellers, tickets)
  (`app/order/hooks.tsx:219-229`, used at `OrderReview.tsx:853`). For a club code the summary multiplies by
  `numberOfEventTickets`, the quantity today's popup uses, so the price shown, the price charged and the recorded
  `coupon_discount_usd` agree. The same mismatch exists today for influencer per-person coupons; it is a separate bug
  and this round does not touch it.
- **The amount lives in settings and is pushed to the rows.** Saving a new amount in the backoffice updates
  `discount_value` of every `source = 'club'` coupon in one statement (audited). A member who joined at $50 pays the new
  amount after a change. That is the meaning of "member price". The amount is $1 to $500 (`coupons` has
  `CHECK (discount_value > 0)`, baseline migration line 281); "no price" is the off switch, not $0.
- **Ticket-only, both sides.** `/api/coupons/validate` returns `source` too; the summary refuses a club code when the
  flight is skipped ("מחיר חבר תקף בהזמנת חבילה עם טיסה") and never applies it from the cookie there. confirm-order
  rejects a `source = 'club'` coupon when the order has **no outbound leg** (`flight_order_info` is always present - a
  ticket-only order sends `{}` - so the test is `flight_order_info?.outbound`), as `COUPON_INVALID`.
  `findValidCoupon` selects `source`, and tolerates the column missing (42703 / PGRST204) like the other optional reads.
- **Removed member:** the backoffice sets the coupon `is_active = false`; `findValidCoupon` already refuses it.
- The member code is also a normal code: a member can type it in the coupon field on another device.

## 7. Data (backoffice migration, master)

All new tables: RLS on, no policies, `anon` / `authenticated` revoked (service role only, both apps). **No CHECK
constraints on columns main writes** (repo rule): values are validated in code.

**`club_members`**: one row per email.
- `id` uuid pk; `member_no` integer unique, from sequence `club_member_no_seq` starting 1001 (display only: the card's number).
- `email` text not null; unique index on `lower(btrim(email))`.
- `phone` text; `phone_key` text = last 9 digits (indexed; the future WhatsApp / customer link).
- `first_name`, `last_name` text null (from the lead passenger when typed).
- `coupon_id` bigint references `coupons(id)`; `coupon_code` text unique.
- `status` text default `'active'` (`active` | `removed`); `removed_at`.
- `marketing` text default `'subscribed'` (`subscribed` | `unsubscribed`); `unsubscribed_at`; `unsubscribe_source`
  (`link` | `whatsapp` | `backoffice`); `unsubscribe_token` text unique (32 random hex chars).
- `source` text (`checkout_popup` | `checkout_row`; staff cannot add members, consent must be the customer's own);
  `source_path` text; `event_id` bigint (the event of the order where they joined; no FK).
- `utm` jsonb (the `myt_utm` cookie's primary touch `p`), plus flat `utm_source`, `utm_medium`, `utm_campaign`.
- `consent_text` text, `consent_version` text (first join).
- `welcome_sent_at` timestamptz; `welcome_error` text.
- `created_at`, `updated_at`.

**`club_log`**: append-only, the consent proof and the rate-limit source.
- `id` bigserial; `member_id` uuid null; `action` (`join` | `rejoin` | `lookup` | `lookup_miss` | `unsubscribe` |
  `removed` | `restored`); `consent_text`, `consent_version` (on join); `ip`
  (first `x-forwarded-for` entry, else `x-real-ip`); `user_agent` (≤ 300 chars); `source`; `at` timestamptz.
- Index on (`ip`, `at`).

**`club_settings`**: key / value.
- Key `program` = `{ enabled: true, discount_per_traveler_usd: 50, popup_delay_seconds: 22 }`, plus `updated_at`,
  `updated_by`. Seeded by the migration with today's numbers.

**`coupons.source`** text null (null = a normal coupon; `'club'` = a member code). Nothing else on `coupons` changes.

`reservations` gets nothing: a member order is a reservation whose `coupon_code` is a member's `coupon_code`.

`consent_version` = `club-2026-11-09-v1`; the exact consent text is a constant in `lib/club/copy.ts` and is stored on
every row that records consent.

## 8. Site APIs (myt-main)

Both routes: service client, explicit columns, `{ ok: false, kind }` answers (never a thrown error to the client),
**rate limit 5 per IP per hour per route, counted in `club_log`** (the `lib/partner-auth/rate-limit.ts` pattern: a DB
count, because serverless instances share no memory), a honeypot field, a 3-second deadline on every DB call. A missing
IP is never refused.

**`POST /api/club/join`** `{ email, phone, consent: true, firstName?, lastName?, eventId, method, hp }`
1. Validate: email shape, phone = 9 to 15 digits after cleaning, `consent === true`, honeypot empty.
2. Club enabled? Else `{ ok: false, kind: "off" }`.
3. Existing row for the email:
   - active → return its code and number (`returning: true`, **no name**), log `rejoin`. **Never change** its names,
     phone or mail status: a join can come from anyone who knows the email, so it must not undo someone's
     unsubscribe (the consent proof would be a stranger's IP).
   - removed → `{ ok: false, kind: "removed" }` (the popup shows the generic error; staff removed them on purpose).
4. New: insert the coupon (with the current amount), then the member (retry the code on a unique clash, at most 3 times),
   then log `join` with the consent. If the member insert fails, delete the coupon just made.
5. Send the welcome mail (§9) with a 4-second deadline. A failure writes `welcome_error`, never fails the join.
6. Answer `{ ok: true, code, memberNo, firstName (new joins only), discountType, discountValue, perPerson, returning }`.

**`POST /api/club/lookup`** `{ email, eventId, hp }` → the same answer shape, without a name, for an active member (log `lookup`),
`{ ok: false, kind: "not_found" }` otherwise (log `lookup_miss`, no member id).

**`/club/unsubscribe?t=<token>`**: a page with the masked email and one button ("הסרה מהעדכונים") that POSTs the token.
Done = "הוסרת מהעדכונים. מחיר החבר נשאר שלך." The mail also carries `List-Unsubscribe` +
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` pointing at the same endpoint (Gmail's one-click). Unsubscribing
stops all marketing to the member on every channel (§13 Q1 default); **the member price stays**.

## 9. The welcome mail

- Sent from main through the existing ZeptoMail transport (`EMAIL_SERVER_*`), From `"מגה איבנטס" <news@mega-events.co.il>`
  (the domain is verified in ZeptoMail with no sender restriction), Reply-To `SALES_REP_EMAIL`.
- Hebrew, RTL, table layout like the site's other mails: the MEGA CLUB member card (name, "מס׳ חבר <member_no>"), the
  member code in large type, "the member price applies by itself on this device, or type the code at checkout", a link
  to the site, the company address line, and the unsubscribe link.
- It is a signup confirmation the customer asked for, and it stays one: ~~no perks list~~ (since D18 it introduces the
  club in Tom's words), **no deals, no prices, no events.** ZeptoMail is transactional-only and the same account sends
  every order confirmation (08.11 ruling: no marketing over ZeptoMail); mail with offers waits for Zoho Campaigns.

## 10. Backoffice (master): full support

New screen **Marketing → Members club**, `/marketing/club`, `ADMIN_ROLES`, every action `requireAdmin()`, one loading
action per tab (repo rule). Tabs on `UrlTabs` (`?tab=`):

- **Overview** (default): cards against the previous period of the same length (the marketing dashboard's
  `previousWindow` / `trendOf`, Israel days, a 7d / 30d / 90d / all switch):
  members (total and new), joined at checkout per day (chart), member orders (all and Paid), Paid revenue from members,
  **discount given** (sum of `coupon_discount_usd` on Paid member orders), unsubscribed, welcome mails that failed.
  A small table: the events where most members joined.
- **Members**: `DataTable` (stateKey, search via `matchesSearch`): no., name, email, phone, joined (Israel time),
  source, event joined at (site link), orders (Paid / all), Paid revenue, mail status (subscribed / unsubscribed),
  welcome mail (sent / failed / pending), status. Row actions (the "⋯" pinned `actions` column): resend welcome mail,
  unsubscribe, remove (= deactivate the code, `status = removed`), restore, show the log (consent wording, IP, times).
  **CSV export** of the filtered rows (the file Zoho Campaigns will import in phase 2).
- **Settings**: the switch (club on / off: off = today's popup comes back and every club surface on the site goes away;
  codes typed into the coupon field keep working), $ per traveler (1 to 500), popup delay in seconds (5 to 120). Save = settings row + one `update coupons set discount_value = …
  where source = 'club'`, audited `club.settings` with before / after.

Also:
- **/coupons** hides `source = 'club'` rows by default (a "show member codes" toggle), so a few thousand member codes do
  not bury the real coupons.
- **Reservation page**: a chip "חבר מועדון #1041" when the order's `coupon_code` is a member code.
- **WhatsApp "הסר"** (with the Q1 default): where `handleEventsMessage` (`lib/services/whatsapp-events-inbound.ts`)
  already stops marketing on Mega Events for a whole-message "הסר", it also sets the member with that `phone_key` to
  `unsubscribed` (`unsubscribe_source` = `whatsapp`) and logs it. Nothing is sent to members on WhatsApp this round.
- **Guide**: a section for the screen (`guide-content.ts`, both languages; `scripts/guide-selftest.ts`).
- Pure rules in `lib/club/` (backoffice) with a selftest `scripts/club-selftest.ts`: the stats maths, CSV rows, the
  settings validation. Main's pure rules (eligibility, code format, phone / email cleaning) get a vitest file.

## 11. Privacy page (myt-main)

`app/privacy/page.tsx:138` promises "double opt-in". This round records a single, explicit opt-in (an unticked box, the
exact wording, time and IP), which is what Israeli law (Communications Law 30A) requires, but not what the page says.
The line changes to: marketing only with prior consent, given by ticking a box, recorded, and withdrawable at any time
from the link in every message. (See §13 Q2.)

## 12. Deploy order

1. Backoffice on master: the migration (+ seed of `club_settings`) rides the push; "Apply DB Migrations" green;
   `npm run db:types`; the `/marketing/club` screen and the `/coupons` filter.
2. myt-main branch `feat/members-club` (worktree `~/work/myt-main-club`, so the shared checkout is not switched): a
   Vercel preview against the shared DB; a test join with a test email; check the mail, the price, confirm-order, the
   backoffice row; then a test member removed from the backoffice.
3. Merge to main. The club starts on. The switch in the backoffice turns it off.

## 13. Questions - decided 09.11 (Dor took every default; now D9-D12)

- **Q1 What the consent covers.** The mockup's box names mail, SMS and WhatsApp. Default: **one consent for all three
  channels; any withdrawal (the mail link, or "הסר" on the Mega Events WhatsApp number) stops all marketing to that
  member; the member price stays.** The alternative is one consent per channel (three boxes or three columns).
  `consent_version` v1 is stamped on every join from day one and members cannot be asked again, so this is settled
  before the first join. Final Hebrew text of the box comes with the answer.
- **Q2 Privacy line:** replace the "double opt-in" promise with the recorded single opt-in (§11), yes / no.
- **Q3 Name / look:** C "MEGA CLUB" (Dor picked it after the default A was reopened).
- **Q4 Ticket-only orders:** no club, as today's popup (default), or the club with the member price there too.

## 13b. Decided 09.11 afternoon, after the live test (D13-D15)

- **D13 Leaving the club is its own choice.** The unsubscribe page offers first, and prominently, "הסרה מהעדכונים"
  (stay a member, keep the price - D9 stands); under it, low-key and behind one confirmation, "עזיבת המועדון", which
  stops the updates AND switches the member code off (`club_members.status = 'left'`, coupon `is_active = false`,
  log `left`, source `link`). A member who left and joins again is a member again (status active, code back on) but
  the join never changes the mail status (§8.3): their updates stay off. Lookup of a member who left answers
  "not found". Staff "Remove" stays `removed` and a join stays refused for it.
- **D14 (REPLACED by D16) The popup comes at the end of the order (Dor: "עכשיו מילאתי הזמנה ולא נתקלתי בפופ אפ", then "לקפיץ את זה בסוף
  ההזמנה לפני שעוברים לפיצול הזמנה או תשלום מאובטח").** The old trigger (idle only, cancelled by the first touch)
  never reached a visitor who fills the form. Now: when a visitor who is not a member yet clicks on to secure payment or
  to "לפצל תשלום / דברו עם נציג" (not the 24 h hold), and the form is valid, the popup opens instead - once per order
  (this tab, this event). The click is kept: "פעם הבאה" carries it straight on, and so does the card's button after a
  join or a lookup (with the member price on). A clear X at the top right only closes. Not for a known member, not with
  a member price on, not on ticket-only / agent / partner. `popup_delay_seconds` stays stored and drives nothing; the
  backoffice no longer shows it. Today's discount popup (partner link, club off) keeps its old idle trigger.
- **D16 One tick in the summary, no popup (Dor 09.11: "אני הולך עם השינויים שלך"; replaces D14).** The business case
  (6 months, package orders): ~52 Paid a month, 2.13 tickets and $4,403 per order, 468 Lost against 313 Paid, 6 of 306
  customers bought twice. A popup at the payment click delays the most decided buyer at the leakiest step and gives $107
  per order to people who were paying anyway; the club's value is the recorded consent, not the next-order discount.
  So: no club popup at all. A MEGA CLUB card inside the summary, above the payment button (where the coupon field is):
  "הצטרפו בחינם וחסכו $X בהזמנה הזאת" (X = the amount x the order's tickets - **the amount is shown before joining
  now**, reversing §5's "only after joining"), one box with the consent text (v1, unchanged), and "כבר חברים?" (the
  lookup popup with the X). Ticking it joins with the first passenger's email and phone - at once when they are valid,
  else as soon as they are (no extra field, no extra click); the price drops in place and nothing ever blocks the
  payment button. If the payment button is clicked while a join is still running, the click stops once and says the
  price changed. `club_members.source = 'checkout_inline'`. The amount stays $50 a ticket (Dor did not change it).
  The /club page, leaving (D13) and the remembered member are unchanged. Today's discount popup (partner link, club
  off) keeps its idle trigger.
- **D17 The card comes back in the order and after it (Dor 09.11, from the mockups: "1 + 2").** D16 dropped the popup
  and with it the member card. (1) **Summary:** when the tick joins, the box turns into the member card itself (number,
  name, "מאז MM/YY") with one sheen across it, "מחיר חבר הופעל: $X פחות על ההזמנה הזאת" under it and the mail line;
  still nothing in the way of the payment button. A remembered member keeps the plain line. (2) **Confirmation page**
  (paid or sent to a rep; never on a 24 h hold or a failed payment): a visitor who joined in this order gets "ברוכים
  הבאים ל-MEGA CLUB" with the full card and what the price saved (a returning email: "ברוכים השבים"); a remembered
  member whose price went in gets the card with what it saved; a visitor the club was offered to who did not join gets
  a calm offer under the order's details - "בהזמנה הבאה: מחיר חבר", the same consent tick (v1) and "הצטרפות בחינם", joining
  with the first passenger's email and phone (`club_members.source = 'checkout_confirmation'`, no discount on this
  order). Not for agents, partner-link visits, ticket-only orders or anyone the summary did not show the club to. The
  confirmation page knows only what this tab carried over the payment page (`sessionStorage`, keyed by the order id):
  the order read (`/api/confirm-order/[id]`) still returns no contact details, so the offer never shows on another
  device or after the tab closed, and the stored details are dropped once the visitor joins.
- **D15 A door in the main menu.** "הצטרפות למועדון" after "אודות" (desktop and phone) opens `/club`: the same join
  and "כבר חברים" forms outside an order (`source = 'site_page'`, no event). Joining there sets the device cookie, so
  the next order applies the price by itself. The amount is still shown only after joining.

## 13c. Tom's notes 11.11 (doc tab "תיקונים מגה קלאב", `t.5owywl49ps9b`; D18-D19)

- **D18 The welcome mail in Tom's words (Dor 11.11: approved, with the wishlist line softened).** Subject "ברוכים הבאים
  ל-MEGA CLUB" (the member number left the subject), preview text "הצטרפתם בהצלחה! קוד הקופון עם ההנחה מחכה לכם
  בפנים...", then "המועדון האקסקלוסיבי של מגה איבנטס", "מעכשיו אתם תהיו הראשונים לדעת על כל הופעה, מבצע ומשחק חדש שעולים
  לאתר", "כרטיס החבר שלכם מוכן:" and the card as Tom drew it: "מס׳ חבר N" in the corner, MEGA CLUB, the member's e-mail,
  "קוד קופון ממבר:" and the code. Under it: the price goes in by itself on the device they joined from; on another, type
  the code or sign in with the e-mail; "תודה שבחרתם ב-MEGA EVENTS". **This replaces §9's "no perks list"**: Dor took
  the risk call - ZeptoMail lists welcome mail that introduces the service as transactional, the mail is one per
  sign-up the visitor asked for, and it still names no price, no amount, no event and links only to the site and the
  unsubscribe page (`lib/__tests__/clubMail.test.ts` pins that). If ZeptoMail ever objects, the fallback is the old plain
  wording until Zoho Campaigns. **Softened:** Tom's "תוכלו להירשם ל-WISHLIST של כל אמן ... ותקבלו הודעה" became "- גם של
  האמנים שאתם הכי מחכים להם!", because the site has no sign-up to an artist's wishlist ("Wishlist" is only a heading on
  the artists page). Typos fixed: אוטומטית, האקסקלוסיבי, "ל-MEGA", "לפי מכשיר זה" -> "במכשיר שממנו הצטרפתם" (the mail is
  read on another device). Words: `CLUB_MAIL_COPY` in main `lib/club/mail.ts`.
- **D19 A sign-up form in the site footer (Tom: "להוסיף בפוטר באתר אופציה להרשמה לממבר קלאב"; Dor chose the form over
  a link to /club).** E-mail, phone, the same consent box (v1) and "הצטרפות בחינם", in the club's mint card at the top
  of the footer (`components/order/club/ClubFooterSignup.tsx`), recorded as `club_members.source = 'site_footer'` with
  the page in `source_path`, no event. It wakes only when the footer comes near the screen (no club request for a
  visitor who never scrolls there) and shows only by `footerClubShows`: the club on, no member cookie on this device, no
  partner's link in `myt_utm`, and not on `/order`, `/club`, `/confirmation`, `/agent`, `/partner` (the club or a partner
  already has those pages). An agent signed in is not looked up there (that read re-checks the backoffice login on every
  page; the order page keeps the club from an agent anyway). Joining sets the device cookie and answers "ברוכים הבאים
  ל-MEGA CLUB! מס׳ חבר N. קוד החבר מחכה לכם במייל."; "כבר חברי MEGA CLUB?" leads to /club. The homepage block and the
  scroll bar Tom asked about on 09.11 are still not built.

## 14. My calls (Dor to check)

Coupon per member reusing the coupon path (§6) · code format `MEGA` + 6 · club codes count event tickets on both sides
· the amount pushed to all member codes on a change, $1 to $500 · partner-link visits keep today's popup · today's
popup trigger kept exactly (idle visitors only), the row is the door for everyone else · the switch off removes every
club surface and brings today's popup back; typed codes keep working · auto-apply only into an empty coupon slot ·
lookup and rejoin never return a name and never change mail status · staff cannot add members · `myt_club` cookie with
no email · rate limit 5 per IP per hour counted in `club_log` · the welcome mail is a plain confirmation (no perks),
from news@ with Reply-To the sales rep · `/coupons` hides member codes · the club screen is admin-only like the
marketing dashboard.

## 15. Phase 2 (not now)

Zoho Campaigns: lists, sync by API, the newsletter (the CSV export is the bridge until then) · a homepage signup block
(the footer form is built - D19) · WhatsApp marketing consent into `wa_consents` · Meta CAPI + Google
enhanced conversions · member-only early access as a site feature.
