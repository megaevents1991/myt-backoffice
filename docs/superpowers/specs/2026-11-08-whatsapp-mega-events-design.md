# WhatsApp for Mega Events - design

Date: 2026-11-08. Sources:

- Alon's answers to the questionnaire "וואטסאפ של מגה איבנטס" (artifact
  https://claude.ai/artifact/9A72VTXGWtEc2eFs69eyVS, 55 of 55, 08.11). 50 answers are in the page's db collection
  `answers`. The six sub-answers (C-5א/ב/ג, C-7א, C-8א, C-10א) exist only in Alon's WhatsApp export to Dor: their
  ids hold a Hebrew letter, which a db document id refuses.
- Dor's seven rulings on the open points, 08.11 (section 15).

**Status (08.11):** Dor approved phases E1-E3 for building ("בוא נעשה הכול חוץ מ-4"). The plan is
`docs/superpowers/plans/2026-11-08-whatsapp-mega-events.md`. Phase E4 (marketing) is not built this round; section 12
keeps its rules.

It builds on `docs/superpowers/specs/2026-10-21-whatsapp-cloud-api-design.md` (the tours design, "the tours spec"
below) and its phase 1 code, which is on prod. Coexistence, the Meta app "Mega Messaging", the webhook, the provider
adapter, tokens in env and the template cache are all decided there and are not re-argued here.

## 1. Intent

Mega Events' customer number **054-200-2722** lives in the WhatsApp Business app on Nir Azulay's phone. Nir and Yaniv
answer from linked computers, and more than 100 customer messages come in a day. The system sees none of it. The most
common complaint after payment is "we did not get the travel material" (S-1).

Alon wants three things:

1. Every conversation inside the backoffice: on a WhatsApp screen and on the order it belongs to. The whole Mega Events
   team sees it, and anyone can answer, from the app or from the system.
2. Update messages about the customer's own order, sent from the same number: payment received, payment failed, phone
   order received, materials sent, order cancelled. Each goes out in addition to the mail sent today.
3. Messages by date: 3 days before the flight, the morning of the event, and a day after the return.

Marketing (the reminder to a customer who did not finish an order, and possibly "how was it") comes last. It waits for
a lawyer.

## 2. What exists, and the hazard

Phase 1 of the tours spec is live and per company. `wa_accounts` routes a webhook by `phone_number_id` to a company.
`wa_messages` stores every message (customer, app echo, api, history) and is keyed by `company_id + phone_key`.
`sendTemplate` / `sendText` record before they call Meta. `RateGate(5)` caps sending, and `wa_templates` caches
templates. The `wa-media` bucket holds media. All of this is reused as is.

What is wired to tours:

- `handleMessage` in `lib/services/whatsapp-inbound.ts` finds a `customers` row and inserts a `leads` row.
- The settings actions guard with `requireCompany("tours")`.
- The thread component and its actions are under `components/tours/cases`.
- Unseen messages are counted on `leads.wa_seen_at`.
- `wa_messages.reservation_id` exists, but no code reads or writes it and it has no index.

**The hazard: connecting 054-200-2722 on today's code would open tours `customers` and `leads` rows under the Mega
Events company id for every message.** `leads_fill` has no product check. **Phase E1 must be deployed before connect
day.**

Two smaller defects found while mapping:

- The `message_template_status_update` webhook calls `upsertTemplate` with `category`, `body` and `paramCount` set to
  null, which wipes a synced template's body and parameter count. Fixed in E1: a status update writes the status alone.
- Main's `/agent/reservations` derives "materials sent" from `confirmation_email_sent`. This is not touched here; it is
  a follow-up for myt-main.

## 3. Goals, non-goals, anti-goals

Goals, in order. Each phase ships alone.

1. E1 - **The wire and the inbox:**
   - an Events branch of the inbound flow (no `leads` / `customers`);
   - conversations (`wa_chats`) with seen, answered and opt-out state;
   - the WhatsApp screen;
   - the thread on the reservation page, with a reply box;
   - the "new message" mark on the reservations list;
   - the unanswered alert;
   - the per-order "no WhatsApp" switch;
   - the connect card for Mega Events.
2. E2 - **Order updates:** five utility templates fired by a database trigger on `reservations`, so they catch every
   path (myt-main's checkout, the backoffice, bulk, SQL). A first week of trial sends to Alon's phone.
3. E3 - **Messages by date:** the flight reminder and "the event is today" from an hourly schedule. "How was it" is
   built, but stays off until Alon's wording is in and approved.
4. E4 - **Marketing, after the lawyer:** the on-demand cart reminder button, the terms sentence on myt-main, and the
   marketing gate.

Non-goals (this round):

- Per-rep assignment of conversations (B-7: everyone sees everything; Nir may want it later).
- A lead board for Mega Events. A message from someone with no order is a "new" conversation on the WhatsApp screen,
  and that IS the lead (B-4).
- An out-of-hours auto-reply. The app's own away message stays (Dor, ruling 5).
- The 24-hour hold message (C-9: no) and "tickets on the way" (C-6: later).
- Euro Trip orders (`itinerary_group` set): no date messages this round. The site's switch is off and only the first
  leg carries the flight. **My call.**
- Broadcasts.
- English templates (T-3: Hebrew only).
- Any change to myt-main before E4.

Anti-goals (a failure even if it works):

- **A booking that fails because of us.** The trigger on `reservations` runs inside myt-main's checkout write. It must
  never raise.
- A marketing message to someone the law does not let us write to.
- Two copies of the same update to the same order.
- A message to a customer about an order that changed after the message was queued: payment failed but now Paid, an
  order cancelled before its flight reminder.
- A tours row created by an Events message, or an Events conversation on a tours screen (or the reverse).
- A slow or throwing webhook (as in the tours spec).

## 4. Phases

| Phase | What | Blocked by |
| --- | --- | --- |
| E1 | Inbound branch, `wa_chats`, WhatsApp screen, thread + reply box on the order, list mark, unanswered alert, off switch, connect card, template-webhook fix | nothing - build now; **live before connect day** |
| E2 | `wa_outbox` + trigger + drain cron, templates `payment_received`, `payment_failed`, `phone_order`, `materials_sent`, `order_cancelled`, trial mode, kill switch | connect day (templates need the WABA), Alon + Tom approve the wording (T-2), Meta approves |
| E3 | Schedule cron: `flight_reminder`, `event_today`, `after_trip` (off) | E2; `after_trip` waits for Alon's wording |
| E4 | `cart_reminder` button, terms sentence on myt-main, marketing gate, opt-out applied to marketing | a lawyer's opinion (M-2), Dor |

The real connect waits on Meta's App Review (submitted 08.11) and on Mega Family connecting first. The code does not
wait.

## 5. Data model (one migration for E1, one for E2; `public`, RLS on with no policies, service role only)

### `wa_chats` (E1) - one row per company + phone

For Mega Events this is what `customers.wa_*` is for tours.

| column | type | note |
| --- | --- | --- |
| `id` | uuid pk | |
| `company_id` | uuid | unique with `phone_key` |
| `phone` | text | digits, international (`972541234567`) |
| `phone_key` | text | last 9 digits (`phoneKey`) |
| `profile_name` | text | WhatsApp's name for the sender, filled when empty |
| `last_in_at` | timestamptz | newest LIVE inbound message (never a history row); the 24-hour window |
| `last_out_at` | timestamptz | newest outbound message (app echo, api, automation) |
| `answered_at` | timestamptz | newest app echo or api reply. An automation does not count as an answer |
| `seen_at`, `seen_by` | timestamptz, uuid | the order's or the chat's thread was opened, or someone answered |
| `linked_reservation_id` | bigint -> `reservations`, null | R-3: a companion's phone attached by a rep |
| `linked_by`, `linked_at` | uuid, timestamptz | |
| `opted_out_at`, `opted_out_source` | timestamptz, text | "הסר" (`reply`) or staff (`staff:<id>`); Mega Events only (M-3) |
| `alerted_at` | timestamptz | the unanswered alert for the current `last_in_at` was sent |
| `created_at`, `updated_at` | | |

Index on `(company_id, last_in_at desc)`. Unseen = `last_in_at > coalesce(seen_at, '-infinity')`. Unanswered =
`last_in_at > coalesce(answered_at, '-infinity')`.

### `wa_app_auto_texts` (E1) - the app's own automatic messages

The Business app sends a greeting to a first-time sender and an away message after hours (A-8; ruling 5 keeps them).
If Meta echoes them, they arrive as app echoes, and section 7 would read each one as a rep's answer. Every first-time
and after-hours message would then be marked seen and answered within seconds, which are the very messages the mark and
the alert exist for. So:

- Columns: `company_id`, `text_norm` (trimmed, spaces collapsed), `text`, `source` (`history` / `staff`), `created_at`.
  Unique on `(company_id, text_norm)`.
- After the history sync, any echo text the app sent identically to 5 or more different chats is suggested here as
  `history`.
- The settings tab lists the texts. An admin can add one (paste) or remove one.
- An echo whose `text_norm` is on the list is stored and shown in the thread, but it is not an answer and not a
  sighting.

### `reservations` gains (E1)

- `main_contact_phone_key` text, kept by a BEFORE INSERT/UPDATE trigger: the last 9 digits of
  `main_contact_phone_number`. The migration backfills it and indexes it.
  - It is not a generated column on purpose. `updateReservation` spreads the edit form's whole row back into the
    update, and a generated column in that row would fail the save. A trigger simply overwrites whatever the row
    carries.
- `whatsapp_off_at` timestamptz and `whatsapp_off_by` uuid (D-6). Both are added to the list that `updateReservation`
  strips, so the edit page's stale copy never undoes a switch flipped meanwhile.
- myt-main never reads any of these. Adding nullable columns breaks no insert of myt-main's.

### `wa_messages` (E1)

An index on `reservation_id`. The column is filled for OUTBOUND rows about an order: automations, plus a reply sent from
a reservation's page. An inbound row stays null, because the thread is per phone (section 7).

### `wa_outbox` (E2)

This is how a change to an order reaches the sender. It is also usable by tours phase 2 later, so `case_id` is there
and stays null here.

| column | type | note |
| --- | --- | --- |
| `id` | uuid pk | |
| `company_id` | uuid | |
| `reservation_id` | bigint, null | |
| `case_id` | uuid, null | reserved for tours |
| `kind` | text | `payment_received` / `payment_failed` / `phone_order` / `materials_sent` / `order_cancelled` / `flight_reminder` / `event_today` / `after_trip` / `cart_reminder` (no CHECK) |
| `dedupe_key` | text, unique | `payment_received:4821`, `payment_failed:4821:2026-11-08`, `flight_reminder:4821:2026-11-12`, ... |
| `due_at` | timestamptz | now for order events; the slot for date kinds |
| `status` | text | `pending` / `sent` / `skipped` / `failed` |
| `reason` | text | why it was skipped or failed, in a sentence (shown on the order) |
| `wa_message_id` | uuid -> `wa_messages`, null | |
| `sent_to` | text | the phone it went to: the customer's, or the trial phone |
| `requested_by` | uuid, null | staff, for `cart_reminder` |
| `from_status` | text, null | the order's status before the change that queued it (`order_cancelled` reads it) |
| `attempts` | smallint default 0 | |
| `created_at`, `finished_at` | | |

Index on `(status, due_at)`. The `reason` text answers "why did nothing go out" on the order page.

## 6. Connect and settings (E1)

- For Mega Events, `finishWhatsappSignup` does NOT request the phone-book (contacts) sync. Nothing in this design reads
  `wa_contacts`, and the phone book on Nir's phone may hold personal contacts. The tours path keeps requesting it.
  **My call.**
- The connect card (`whatsapp-card.tsx` and `finishWhatsappSignup`) is generic. Only its guard changes:
  - `manager()` becomes "a staff member of the active company with a manager or admin role, the company selling
    `tours` or `events`";
  - `phoneOwner` keeps refusing a number that belongs to another company.
- Where it lives: the WhatsApp screen's "הגדרות" tab, for Mega Events admins (`ADMIN_ROLES`). The tours copy stays on
  `/tours/settings`.
- Templates list, "Sync templates" and "Send a test" are the same actions, scoped by the active company.
- The connected panel also shows:
  - the trial phone when one is set: "מצב ניסיון: כל ההודעות האוטומטיות הולכות ל-…";
  - the kill switch state.

## 7. Inbound for Mega Events (E1)

`handleMessage` dispatches on the account's company:

- a company selling `events` -> `handleEventsMessage` (new, deps injected like today);
- otherwise -> today's tours path, unchanged.

The dispatch is a pure function, selftested both ways.

`handleEventsMessage`, for a LIVE customer message:

1. Store the `wa_messages` row (`origin: customer`), media as today.
2. Upsert `wa_chats` on `(company_id, phone_key)`. Set `last_in_at`, and `profile_name` when it is empty.
   - A **reaction** or a **sticker** is stored and shown, but it does not move `last_in_at`. So it raises no "new" mark,
     no unanswered timer and no R-2 move: a 👍 to "the payment was received" asks nothing.
3. Opt-out: for Mega Events the word must be the **whole message** (trimmed, punctuation dropped): "הסר", "להסרה",
   "הסירו אותי", "stop", "unsubscribe". In an inbox about orders, "הסר את המלון מההזמנה" is a request, not an
   opt-out. **My call.** An opt-out sets `opted_out_at` with source `reply` and sends one free service reply (the
   existing text). It stops marketing only. Order updates continue (C-13).
4. **A new conversation** = the chat's previous live inbound message is older than 24 hours, or there is none (the
   existing `shouldOpenInquiry` gap). On a new conversation only:
   - Look only at the phone's reservations (by `main_contact_phone_key`, plus the chat's linked reservation) whose
     event date is today or later. Old orders never move.
   - If none of those is live, and at least one is `Lost`: the newest such `Lost` one moves to `Follow-up`, with
     `follow_up_date` = today in Israel (R-2).
     - Live = `Paid` or `Follow-up`; or `Pending` / `24Save` created in the last 7 days. An abandoned checkout stays
       `Pending` for good, and a hold stays `24Save` for good: paying inserts a new row. So older ones must not block.
       **My call.**
     - The write goes through a service function with explicit columns. It is audited as `reservation.status` with
       metadata `{ via: "whatsapp", chat_id }` and no actor.
     - A rep who moves it back to Lost is not overruled until the next new conversation.
5. Nothing else: no `leads`, no `customers`, no task, no mail.

An app ECHO (a rep wrote from the app) is stored as `direction: out`, `origin: app`. It sets `last_out_at`,
`answered_at` and `seen_at` = now, unless its text is one of the app's own automatic texts (`wa_app_auto_texts`,
section 5). A reply means someone saw it: we cannot know when a rep read a chat in the app, so "opened" = opened in the
system OR answered anywhere (Alon's note on B-3).

HISTORY (the 6-month sync on connect day) fills `wa_messages` with `origin: history`. A history chat is created once
per phone per batch and stamps nothing: no `last_in_at`, no `seen_at`, no `answered_at`. With no `last_in_at` a chat is
never unseen or unanswered, so connect day raises no mark and no alert. Stamping "now" would hide a LIVE message that
arrived meanwhile (review, 08.11). No Follow-up moves come from history. The phone book (`smb_app_state_sync`) is never
stored for Mega Events.

STATUSES, contacts and template status are as today. A template status update writes the status alone (section 2).

### Which order a conversation belongs to

This rule is pure, `lib/whatsapp/events/chat-orders.ts`, selftested.

- A conversation SHOWS on every live (not soft-deleted) reservation whose `main_contact_phone_key` is the chat's
  `phone_key`, and on the chat's `linked_reservation_id` (R-1, R-3).
- The "new message" MARK sits on ONE of them, `markedReservation(reservations, linkedId, today)`, in this order:
  1. the linked reservation;
  2. else the nearest `Paid` reservation whose event date is today or later;
  3. else the newest by `created_at`.
- A chat with no reservation at all is a "new" conversation, shown only on the WhatsApp screen (B-4).

## 8. Screens (E1)

### WhatsApp screen

`/whatsapp`, Mega Events nav. Every Mega Events staff member (B-2), guard `requireCompany("events")`. A tours sales
agent never reaches it.

- Tab "שיחות":
  - The list: newest live inbound message first, paged (`fetchPaged`; there are thousands of chats after the history
    sync). Each row shows:
    - the name (the order's contact name, else `profile_name`, else the phone);
    - the phone;
    - the last message (text or "[תמונה]");
    - the time;
    - chips of the phone's orders (`#4821 Paid`);
    - an unseen dot;
    - a red "לא נענתה 1:20" while unanswered.
  - Filters, in the URL (`useUrlState`): הכול / חדשות / לא נענו / בלי הזמנה.
  - A click opens the thread beside the list:
    - newest last, with the origin tag and delivery ticks as on the tours thread;
    - the reply box;
    - "פתח בוואטסאפ" (the existing app link);
    - "הצמד להזמנה" (R-3): search by order number, name or phone, which sets `linked_reservation_id` (audited); and
      "בטל הצמדה".
    - "טופל": closes a chat that needs no reply (a "תודה", a sticker before 24 hours passed). It sets `answered_at`
      and `seen_at` without sending anything, and is audited. The same button is on the order's fold.
  - Opening a chat stamps `seen_at` / `seen_by`. Never while impersonating.
- Tab "הגדרות": section 6.

### Reservation page

`/reservations/[id]` gets a WhatsApp fold. It loads in the page's existing single read, or ONE new action, never
several on mount. It holds:

- the thread of the order's phone and of any chat linked to it;
- the reply box;
- "פתח בוואטסאפ";
- the switch "לא לשלוח וואטסאפ להזמנה הזו" (D-6, audited);
- the order's automatic messages: each `wa_outbox` row with its kind, time and `sent` / `skipped: <reason>` /
  `failed: <reason>`, plus "נשלח לטלפון הניסיון" in trial.

Opening the fold stamps `seen_at` of the chats shown.

### Reservations list

- The marked reservation shows "💬" in the status cell. The data comes from a side read in the existing best-effort
  pattern: unseen chats, resolved to their marked reservation.
- A view "הודעות חדשות (N)" at `/reservations?wa=new`, beside the Follow-up view.

### The reply box (B-5)

Shared component, `components/whatsapp/reply-box.tsx`.

- It sends `sendText` while the chat's `last_in_at` is within 24 hours (`canSendText`):
  - `origin: api`, `sent_by` = the staff member;
  - `reservation_id` = the page's order, when sent from a reservation page;
  - it sets `answered_at`, `last_out_at` and `seen_at`.
- Past 24 hours it is disabled with "הלקוח כתב לפני יותר מ-24 שעות - עונים מהאפליקציה". The app can always write
  (Alon's note on B-5).
- Text only; no media from the backoffice.
- Cost: a service reply is free up to 1,000 a month per number, then $0.0053. At over 100 conversations a day that is
  about $10 a month if every reply came from the system.
- It also gives a fifth seat beyond the app's four linked devices.

### Unanswered alert (B-6)

Pure rule `unansweredFor(lastInAt, answeredAt, now)`, selftested.

- A chat is unanswered once **60 working minutes** have passed since `last_in_at` with no answer.
  - Working minutes count only Sunday-Thursday 09:00-17:00 Israel (Alon's hours, C-12). A message at 16:30 alerts at
    09:30 the next working morning.
  - Friday is not counted. **My call** - he gave hours, not days.
- Where it shows:
  - the red timer on the list;
  - a count on the WhatsApp nav item;
  - a dashboard banner `WhatsAppUnansweredAlert`, beside `FollowUpAlert`, only while the count is above 0.
- Mail: the cron `waEventsAlerts` (every 15 minutes in working hours) mails `NEXT_SECRET_WA_EVENTS_ALERT_TO`
  (comma-separated; unset = Alon's Mega mailbox, `DEFAULT_FROM`) ONE digest of the chats that BECAME unanswered since
  its last run (`alerted_at` is the dedupe). No unanswered chat = no mail.
  - **My call:** Alon gave the when, not the how. A mail per message would flood at 100 a day.

### Guide

`/guide` gets the WhatsApp screen and the fold (the rule: a flow change updates `guide-content.ts` in the same PR;
`scripts/guide-selftest.ts` fails on a menu screen with no section).

## 9. The outbox (E2)

### The trigger

`public.reservations_wa_outbox()`, AFTER INSERT OR UPDATE OF `status`, `payment_info`, `confirmation_email_sent`,
`travel_materials_sent_at` ON `reservations`, FOR EACH ROW.

- It inserts only while Mega Events has an active `wa_accounts` row (one indexed EXISTS). Nothing piles up before
  connect day.
- Its whole body is inside `begin ... exception when others then raise warning ...; end;` and it returns null. **A
  failure inside it can never fail myt-main's checkout or a staff save.** The PGlite test proves it: break the outbox
  table and the reservation write still succeeds. `lock_timeout` 500 ms: a lock on the queue (a migration) never holds a
  checkout. A cleared payment result (null / `{}`) is no failure. The phone-key BEFORE trigger writes its rule out
  instead of calling `public.phone_key` (whose EXECUTE is revoked from the public roles), so it can never fail a write
  either.
- `insert ... on conflict (dedupe_key) do nothing`.

| kind | fires when (old -> new) | dedupe |
| --- | --- | --- |
| `payment_received` | `status` becomes `Paid` from anything else, or a row is inserted as `Paid` (card payment through `validateAndRecordPayment`, staff edit, bulk) | once per order |
| `payment_failed` | `payment_info` changes to a non-null, non-empty value and `status` is not `Paid`. myt-main writes the gateway result and `Paid` in ONE update on success, so a result without `Paid` is a failure. `due_at` = now + 15 minutes (see the send decision) | once per order per Israel day |
| `phone_order` | `confirmation_email_sent` false/null -> true while `status = 'Pending'`, `payment_info is null` and `partner_settlement_method is null` (myt-main's `phoneOrder` mail just went out; an agent voucher order gets its own mail and no message - **my call**) | once per order |
| `materials_sent` | `travel_materials_sent_at` null -> set (staff "סמן שחומר נשלח ללקוח") | once per order |
| `order_cancelled` | `status` becomes `Cancelled`; `from_status` records the old status | once per order |

### Draining

Two paths:

- The cron `waEventsOutbox`, every 2 minutes, `maxDuration` 60, 45 s budget, 5 a second. It takes `pending` rows with
  `due_at <= now`, oldest first. myt-main's events are therefore sent within about 2 minutes.
- The backoffice paths that cause a kind call `drainOutboxFor(reservationId)` right after their write, so a staff
  action's message leaves at once. Those paths are:
  - `updateReservation`, `updateReservationsStatus`, `cancelReservation`, `setTravelMaterialsSent`;
  - the inbound Lost-to-Follow-up move causes nothing.

### The send decision

Each row passes the pure `outboxDecision(row, reservation, chat, env, now)` (`lib/whatsapp/events/outbox.ts`,
selftested). The answer is send, skip with a reason, or wait. It checks, in order:

1. Kill switch: `EVENTS_WHATSAPP_AUTO=off` -> skip, "הופסק ידנית".
2. The order is soft-deleted -> skip. The order's `whatsapp_off_at` is set -> skip, "כבוי להזמנה הזו". The order is
   part of a Euro Trip (`itinerary_group` set) -> skip, "טיול יורו - לא בסבב הזה". A trip is one row per event, so
   every update would go out once per row. **My call.**
3. The phone: `whatsappPhone(main_contact_phone_number)` gives nothing usable -> skip, "אין טלפון תקין".
4. The template is not APPROVED in `wa_templates` -> skip, "התבנית לא אושרה". Unlike `sendTemplate`'s
   unknown-is-tried rule, an automatic send needs the cache to say APPROVED.
5. The order no longer matches its kind:
   - `payment_failed` but now `Paid`;
   - `phone_order` but now `Paid` or `Cancelled`;
   - any date kind and not `Paid`.

   -> skip, "ההזמנה השתנתה".
6. `payment_received` for an order whose event date has passed (a bulk clean-up of old orders) -> skip, "האירוע
   עבר". **My call.**
7. `payment_failed`: the row waits 15 minutes. If by then the same phone has a `Paid` order for the same event created
   after this one -> skip, "שולם בהזמנה חדשה". A retry, through the resume link or a fresh order, always inserts a NEW
   reservation, so "this order is now Paid" never catches it. Without this check, a customer who just paid on the second
   try would be told the payment failed.
8. `order_cancelled`: sent only when the order was paid, i.e. `from_status` is `Paid` or the order has a sent
   `payment_received`. Otherwise skip, "ההזמנה לא שולמה". A never-paid order, a duplicate or a test order being
   cancelled must not tell a customer "your order was cancelled". **My call.**
9. A date kind whose day has passed (the cron was down) -> skip, "עבר הזמן". No late reminders.
10. Marketing kinds only (section 12): consent, opt-out and the sending window (D-1).

Then the send:

- **A row is claimed before it is sent** (`pending -> sending`, `claimed_at`, only while still pending), so two drains at
  once never send it twice. It is finished only from `sending`. A row left `sending` for 10 minutes (a crash mid-send) is
  closed `failed` with "נקטע באמצע שליחה - ייתכן שנשלח", never re-sent. One row's failure never stops the rows behind it.
- `payment_failed` is dropped when the order was paid (`from_status` Paid, or its `payment_received` went out - myt-main
  may write Pending over a Paid row). It is also dropped when ANY newer order of the same phone for the same event
  exists: paid, or still being paid, the newest attempt speaks for all.
- A trial phone that is set but unusable fails closed ("טלפון הניסיון לא תקין"), never to the customer.
- `sendTemplate` with `origin: automation` and `reservation_id`.
- **Trial (D-7):** while `NEXT_SECRET_WA_EVENTS_TRIAL_PHONE` is set, the message goes to THAT phone, with the
  customer's parameters, and `sent_to` records it. The customer gets nothing.
  - The first week runs this way, to Alon's phone.
  - Dor unsets it to go live.
  - The reply box and "Send a test" are not affected.
- `sendTemplate` writes `wa_messages`, and the row ends `sent` with its `wa_message_id`, or `failed` with Meta's
  error. A failed row is retried twice, then left `failed`.
- An Events automation is audited `whatsapp.sent` (existing).

## 10. The messages

These are drafts. Alon approves the final wording before it goes to Meta (T-2: Alon, plus Tom for marketing), and Meta
approves the template.

- All are Hebrew (T-3), signed "צוות מגה איבנטס" (D-5), sent from 054-200-2722 (T-1), in addition to today's mails
  (D-4).
- The same rules apply to orders made through an agent (D-2). One partner, `alaad`, has the same phone on 3 orders and
  may have typed their own phone; the trial week shows it.
- A parameter never holds a newline. The first name goes out only as a word of letters (`NAME_ALLOWED`), else "שלום".

| template (category) | when | draft |
| --- | --- | --- |
| `payment_received` (utility) - C-1 | section 9 | היי {{1}}, התשלום על הזמנה {{2}} ל{{3}} התקבל. ביום העסקים הבא נשלח לכם במייל את {{4}}. כרטיסי הכניסה לאירוע מגיעים בין 14 יום ל-24 שעות לפני האירוע. שאלות? אפשר לענות כאן. צוות מגה איבנטס |
| `payment_failed` (utility) - C-2 + Alon's line | section 9 | היי {{1}}, התשלום על ההזמנה ל{{2}} לא עבר, וההזמנה עוד לא סגורה. אפשר לנסות שוב באתר: {{3}}, או להמתין שנציג שלנו יחזור אליכם ביום העסקים הבא. צוות מגה איבנטס |
| `phone_order` (utility) - C-3 | section 9 | היי {{1}}, קיבלנו את ההזמנה ל{{2}}. נציג שלנו יחזור אליכם ביום העסקים הקרוב כדי להשלים את התשלום. אפשר גם לכתוב לנו כאן. צוות מגה איבנטס |
| `materials_sent` (utility) - C-4 | section 9 | היי {{1}}, ההזמנה ל{{2}} אושרה. שלחנו לכם במייל את {{3}}. לא מוצאים? בדקו גם בספאם, או כתבו לנו כאן. צוות מגה איבנטס |
| `order_cancelled` (utility) - C-11 | section 9 | היי {{1}}, ההזמנה ל{{2}} (מספר {{3}}) בוטלה. לכל שאלה אנחנו כאן. צוות מגה איבנטס |
| `flight_reminder` (utility) - C-5 | section 11 | היי {{1}}, עוד 3 ימים טסים ל{{2}}! טיסה {{3}} יוצאת ב-{{4}} בשעה {{5}} מ{{6}}. כדאי להגיע לשדה 3 שעות לפני, עם דרכון בתוקף. חברות התעופה משנות לפעמים שעות, אז שווה לבדוק גם באפליקציה שלהן. נסיעה טובה! צוות מגה איבנטס |
| `event_today` (utility) - C-7 | section 11 | היי {{1}}, היום זה קורה: {{2}} ב{{3}}! תהנו. אם משהו לא מסתדר, כתבו לנו כאן. צוות מגה איבנטס |
| `after_trip` (category per Meta) - C-8 | section 11 | Alon's own wording - open (ruling 4). Built switched off (`EVENTS_WA_AFTER_TRIP=on` to start) |
| `cart_reminder` (marketing) - C-10 | section 12 | היי {{1}}, ראינו שההזמנה ל{{2}} לא הושלמה. אפשר להמשיך מכאן: {{3}}. צריכים עזרה? כתבו לנו כאן. להסרה השיבו: הסר |

Changes from the questionnaire's drafts:

- `payment_received` / `materials_sent`: the documents are one parameter, built by the order's shape (`documentsOf`,
  pure). The drafts promised flight tickets and a hotel voucher to every order, and ticket-only orders, or orders that
  skipped the flight or the hotel (`flight_order_info` / `hotel_order_info` = `{}`), have neither:
  - flight + hotel = "אישור ההזמנה, כרטיסי הטיסה ושובר המלון";
  - hotel only = "אישור ההזמנה ושובר המלון";
  - flight only = "אישור ההזמנה וכרטיסי הטיסה";
  - neither = "אישור ההזמנה".

  One template per kind, not one per shape. **My call.**
- `payment_failed`: Alon's line added. The link is myt-main's resume link `/order/{eventId}?orderId={id}` while it works
  (`/api/find-order` allows 25 hours from `created_at` and checks no status), else the event page `/order/{eventId}`.
  Paying always inserts a fresh order; the send decision's 15-minute wait covers that.
- `order_cancelled`: dropped "הפרטים נשלחו אליכם במייל". **A staff cancellation sends no mail today**, so the sentence
  would be false.
- `flight_reminder`: as written (ruling 2). Alon said the flight in the order is "not always" updated when an airline
  moves it; the "check the airline's app" line is the answer.
- `event_today`: Dor's ruling 3 - built from the data we have. `events` holds a date with no time and a city, not a
  venue. So `{{3}}` is "<venue>, <city>" when the order's ticket comes from TixStock (`tixstock_events.venue_name`) or
  LiveTickets (`live_events.venues[0].name`), else the city alone (`event_location` else `location`, short place). No
  hour: TixStock's `show_date` loses the venue's offset. An AI-written per-event text is later.

Parameters per template are listed in `lib/whatsapp/events/params.ts` (pure, selftested on real-shaped rows).

- The order's event label = the Hebrew event name plus the city ("אוואסיס במנצ׳סטר"), from `event_order_info`
  normalized with `normalizeReservationEventOrderInfo`. A multi-event order takes its first event.
- `{{2}}` of `payment_received` is the order id.

## 11. Messages by date (E3)

The cron `waEventsSchedule` runs hourly at :05 (`maxDuration` 60). It enqueues the date kinds whose slot falls in the
current Israel hour (dedupe keys as in section 5). The 2-minute drain sends them. `?dry_run=1` lists what it would
enqueue, with order ids and reasons, and writes nothing. The rules are pure, in `lib/whatsapp/events/schedule.ts`,
selftested.

### `flight_reminder`

- The outbound departure:
  - an offline order (`offline_flight_id` set, the `flights` row not deleted or cancelled) reads
    `flights.outbound_departure_time`, `outbound_flight_number` and `outbound_departure_airport`;
  - otherwise, `flight_order_info.outbound.departureTime` / `departureAirport`;
  - the flight number is `offer.itineraries[0].segments[0].carrierCode + number` when the offer has it (the stored
    `flightNumber` uses the validating carrier, which is wrong on a codeshare), else `outbound.flightNumber`;
  - no readable departure (`{}`, ticket-only, a missing time) = no reminder.
- The slot is 09:00 Israel, 3 days before the departure's local date (C-5א). The departure is Israel's own clock (TLV).
- **Late bookings (C-5ג):** an order created after its slot gets no reminder. Alon's "maybe a day before" is a later
  switch, not built.
- Params:
  - destination = the FLIGHT's city: `events.location` (short place), not the event city. On a two-city event the flight
    lands in London while the show is in Manchester;
  - date = DD.MM;
  - hour = HH:MM, read off the string with `formatHm` (no `Date` shift);
  - airport = "נתב״ג" for TLV, else the IATA code.
- It applies to orders paid before launch too (D-3).

### `event_today`

- The slot is 10:00 Israel on `events.date` (C-7א). `Paid` orders only.
- It applies to orders paid before launch (D-3).

### `after_trip`

- The slot is 11:00 Israel on the day after the return (C-8א):
  - the return = the offline row's `inbound_arrival_time`, else `flight_order_info.inbound.arrivalTime`;
  - with no flight, the day after `events.date`.
- If Meta classes the template as marketing (T-4: try to word it as an order update first), the marketing gate of
  section 12 applies, including the sending window. A Saturday slot then moves to Sunday 11:00.
- Orders paid before launch get no `after_trip`. D-3 named the reminders only. **My call.**
- Off until Alon's wording is approved.

D-1's sending window (Sunday-Thursday 09:00-20:00, Friday 09:00-13:00, never Shabbat) applies to **marketing only**
(Alon's note on D-1). Order updates go out at any hour: a payment at 01:00 gets its message at 01:00. The date kinds
have fixed morning slots of their own, and a flight reminder may go out on a Saturday morning.

## 12. Marketing and opt-out (E4 - not built this round)

### The law, as researched 08.11.2026 (not legal advice)

Sources: the statute (§30A of the Communications Law, Amendment 40), Supreme Court rulings, and the Privacy Protection
Authority's consent opinion of 25.02.2026. Every claim was checked against a source.

**What the law requires:**

- **It covers WhatsApp.** A WhatsApp message is an "הודעה אלקטרונית"; small-claims courts in 2025 ruled on WhatsApp ads
  (Chen v. Rosental, Kornfeld v. Matarot).
- **Ad or service: the test is the message's purpose.** A service message is free to send (Supreme Court, 2019, the
  Bezeq ruling). A service message that also carries a promotion, an upsell or a link to a marketing page tends to be
  held an ad.
  - So the E2 / E3 templates must stay purely about the customer's own order.
  - Meta's rules say the same: one promotional line makes a template marketing, and Meta re-categorizes automatically.
- **Consent must be explicit, prior and in writing.** A checkbox, a form, a WhatsApp message from the customer ("כן,
  שלחו לי מבצעים") or a recorded call all count. Unrecorded oral consent does not.
  - Once a customer denies having consented, **the sender must prove it.** In Kornfeld the company lost because it
    showed no sign-up record.
  - A pre-ticked box, or consent bundled into the terms, is treated as invalid in practice (the Authority's opinion;
    no Supreme Court holding).
- **The existing-customer exception (§30A(c)).** All four conditions must hold:
  1. the details were given during a purchase or a negotiation to purchase;
  2. the customer was told they would be used for ads;
  3. they were given a chance to refuse, and did not;
  4. the ad is for a similar product or service.

  The notice may come after the details, as long as it comes before the first ad (Lapid v. Cellcom, 2019). This is the
  only legal footing for Alon's "a sentence in the terms" (M-1). It also needs the chance to refuse on the same screen,
  and it reaches only similar trips of the same brand.
- **Asking a private person for consent by WhatsApp is not allowed.** The one-time request is allowed only to a
  business.
- **Every ad must carry:**
  - "פרסומת" at the start (WhatsApp has no subject line, so it is the first word);
  - the sender's name and contact details;
  - the right to refuse, how to do it, and a valid web address for refusals.

  A "הסר" reply counts as a refusal and must be honored at once. After a refusal there is no defense for any later ad.
- **Penalties:** up to ₪1,000 per message without proof of damage, and class actions are expressly allowed. Small
  claims in 2025 awarded ₪200-250 per WhatsApp message. Bots sending ads everywhere say nothing about what is legal.
- **Meta:** opt-in must name the business and say what the person agrees to receive. Meta advises a separate opt-in
  per category. **An abandoned-cart reminder is marketing "even if requested by users."** Each WhatsApp user may
  receive only a limited number of marketing templates, counted across all businesses.

**What is unsettled (the lawyer's part):**

- whether an abandoned checkout counts as a "negotiation to purchase";
- how past buyers who were never told can be brought under the exception (in the Lapid-based ruling, the notice came on
  an invoice email);
- whether Mega Events and Mega Family are "similar".

### Rules E4 will enforce in code

- **Consent per brand and per channel**, in a new `wa_consents` table: phone (E.164), brand (company), basis
  (`explicit` / `existing_customer`), scope, `at`, source (form URL and version / checkout order id / inbound
  `wa_message_id` / staff id), the exact wording shown (text + version + hash), unticked by default, IP / user agent,
  and, for `existing_customer`, the order id and the notice's wording and date.
- Every refusal is recorded too: time, channel, scope, raw text, and when suppression took effect.
- Every marketing send records the consent row it relied on.
- Keep these records 7 years (the civil limitation period).
- **Recommended capture (stronger than M-1's terms sentence):**
  - a separate, unticked checkbox at checkout: "אני מאשר/ת לקבל ממגה איבנטס עדכונים ומבצעים בוואטסאפ ובמייל";
  - a newsletter form with the same wording;
  - both write `explicit` rows.
  - A customer who writes "yes, send me offers" in a chat they started is also `explicit`, marked by staff from the
    message.
  - **Dor decides, when E4 starts: checkbox, or Alon's terms sentence plus a refusal option on the checkout screen**
    (`existing_customer`, similar trips only).
- **`canSendEventsMarketing(phone, brand)`** (pure) = an `explicit` row, or an `existing_customer` row with its four
  conditions recorded, and no later refusal.
  - No WhatsApp ever asks a private person for consent.
  - Past buyers stay out until the lawyer says how to notify them.
- **Every marketing template** starts with "פרסומת", names "מגה איבנטס" with a phone and web address, and ends with
  "להסרה השיבו: הסר או בקרו ב-<url>".

### The cart reminder (C-10, Dor's ruling 1: on demand, not automatic)

- A button "שלח תזכורת להשלמת ההזמנה" on the page of a `Pending` (unpaid), `Lost` or `24Save` order inserts a
  `cart_reminder` outbox row with `requested_by`. One per order per 7 days. **My call.**
- The link is myt-main's resume link `/order/{eventId}?orderId={id}` while it works (25 hours from `created_at`), else
  the event page.
- It is marketing under both the law and Meta, so it passes the same gate.
- Inside 24 hours of the customer writing to us, the rep can simply answer in free text from the reply box (a service
  message, no gate).

### Opt-out

"הסר" sets `wa_chats.opted_out_at` and writes a refusal row.

- It stops marketing on Mega Events only (M-3, C-13). Order updates continue.
- A staff member can mark or clear it from the thread with a note, audited `whatsapp.consent`.

## 13. Connect day (Alon + Nir, before 09:00 - K-1, K-2, ruling 7)

Before the day:

- E1 is deployed (section 2).
- Meta's App Review is approved and Mega Messaging is published.
- Find out how Scalla uses the number (ruling 6):
  - a linked device (QR) unlinks on connect day and re-links after;
  - an API connection on the same number may make Meta refuse ours, and must be released first.
- The WhatsApp Business app is 2.24.17 or newer.
- A payment method is on the Events WABA.
- `NEXT_SECRET_WA_EVENTS_TRIAL_PHONE` = Alon's phone is set in Vercel.
- myt-main's privacy page names WhatsApp: commit 2d99157, local, waiting for a push.

On the day:

- Nir's phone, with Alon and Nir present.
- An admin of the portfolio מגה תיירות presses "Connect" on the WhatsApp screen's settings tab and picks that portfolio.
- Share the 6-month history (A-9).
- The companion devices (Nir's and Yaniv's computers) re-link, four at most. The Windows WhatsApp app is not supported
  (web.whatsapp.com).
- Right after: the phone id goes to Vercel when the DB row is not enough, and the system-user token is set.
- The E2 templates are submitted, once Alon and Tom have approved the wording.

## 14. Cross-project impact

- E1-E3 change nothing in myt-main. The trigger catches myt-main's writes in the database.
- The new `reservations` columns are nullable and kept by a trigger. myt-main never reads them.
- `types/app.types.ts` is untouched; the reservation type is not in the shared list.
- E4 changes myt-main's terms page and the checkout line next to the terms checkbox.

## 15. Decisions

### Alon's answers (08.11; the recommended option unless noted)

- **The number (A):**
  - A-1 Nir holds the phone; A-4 Nir's and Yaniv's devices are linked.
  - A-2 the app type was unknown, later "Business" (ruling 6).
  - A-3 Scalla unknown. A-5 no private chats. A-6 no broadcast lists. A-7 more than 100 a day.
  - A-8 the app has greeting and away messages. A-9 share the history.
- **Seeing and answering (B):** B-1 a screen plus the order. B-2 all staff. B-3 the "new" mark. B-4 "new" on the
  screen. B-5 reply from the system too. B-6 alert after 1 hour in working hours. B-7 no assignment (ask Nir).
- **Which order (R):** R-1 phone, mark on the nearest Paid. R-2 Lost -> Follow-up today. R-3 attach by hand.
- **The messages (C):**
  - C-1 yes.
  - C-2 with his line.
  - C-3 yes.
  - C-4 yes, the team marks "materials sent".
  - C-5 yes, 3 days; the flight is "not always" updated; late bookings get none ("maybe a day before").
  - C-6 later.
  - C-7 the morning of the event, 10:00, per-event information.
  - C-8 his wording, the day after the return.
  - C-9 no.
  - C-10 yes, 2 hours.
  - C-11 yes.
  - C-12 hours 09:00-17:00.
  - C-13 marketing only.
- **Number and wording (T):** T-1 the main number. T-2 Alon, plus Tom on marketing. T-3 Hebrew. T-4 reword as an update.
- **Marketing (M):** M-1 a terms sentence, no checkbox. M-2 a lawyer. M-3 Mega Events only.
- **General rules (D):**
  - D-1 the Family hours, marketing only.
  - D-2 agent orders like any order.
  - D-3 reminders to orders paid before launch.
  - D-4 in addition to the mails.
  - D-5 "צוות מגה איבנטס".
  - D-6 the off switch.
  - D-7 a trial week to Alon.
- **Connect day (K):** K-1 Alon, plus Nir (ruling 7). K-2 before 09:00.
- E-1 "סומך על דור".

### Dor's rulings (08.11)

1. The cart reminder is not automatic. It is sent on demand.
2. The flight reminder follows Alon's answers as written.
3. "The event is today" is built from the data we have. An AI writer comes later.
4. "How was it" wording stays open.
5. No out-of-hours auto-reply. The app's away message stays.
6. The number is on WhatsApp Business. Scalla is a separate paid system and should not interfere; check how it connects.
7. Nir and Alon are both there on connect day.

### My calls (check these)

- Friday is outside the alert's working hours.
- The alert goes by an on-screen count, the nav, the dashboard, and a mail digest at most every 15 minutes.
- An agent voucher order gets no `phone_order`.
- No `payment_received` once the event date has passed.
- Euro Trip orders get no automatic messages at all this round.
- No `after_trip` for orders paid before launch.
- One cart reminder per order per 7 days.
- `event_today` has no hour.
- R-2 looks only at orders whose event is ahead. Paid / Follow-up block it, and Pending / 24Save block it only when
  less than 7 days old.
- `payment_failed` waits 15 minutes and is dropped when the customer paid on a new order.
- `order_cancelled` only for an order that was paid.
- One template per kind; the documents line follows the order's shape.
- The flight reminder names the flight's city.
- The app's greeting and away messages never count as an answer: a list seeded from the history, editable.
- Reactions and stickers do not open, mark or alert. "טופל" closes a chat that needs no reply.
- For Mega Events, "הסר" counts only as the whole message.
- No phone-book sync for Mega Events.

## 16. Left to the builder

- The working-minutes arithmetic (`unansweredFor`) and its edge cases around 17:00 and weekends.
- The thread component: lift `whatsapp-thread.tsx`'s pure parts into `components/whatsapp/` and leave the tours
  wrappers (`WhatsAppButton`, `Notice`) behind it, without changing what the tours pages show.
- Paging and search on the WhatsApp list, and how many messages a thread loads first (the tours thread loads 50 with
  "more").
- The exact Meta template parameter rules: no variable at the start or end of a body, no newlines in a parameter.
  Shape the drafts to fit.
- Where `drainOutboxFor` is awaited versus fired after the response, as long as a staff action never fails because a
  send failed.
- The CLAUDE.md block for this feature (the repo's convention), and the env names in its env section:
  `EVENTS_WHATSAPP_AUTO`, `NEXT_SECRET_WA_EVENTS_TRIAL_PHONE`, `NEXT_SECRET_WA_EVENTS_ALERT_TO`, `EVENTS_WA_AFTER_TRIP`,
  `EVENTS_MARKETING_TERMS_FROM`.
