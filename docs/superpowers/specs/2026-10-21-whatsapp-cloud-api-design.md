# WhatsApp Cloud API for the tours companies - design

Date: 2026-10-21. Source: Alon's road-map tab (doc "ROAD MAP MEGATR", tab `t.s1l26rpicsj0`, item 1)
and Dor's direction the same day: the API for templates, the WhatsApp app for day-to-day chat
opened from our system, "an interface that connects to us", free where Meta offers it free, a
paid service only where it does not.

Items 2 (reps' mailboxes + order confirmation mail) and 3 (the payment terminal) of the same tab
are not WhatsApp and are not in this document.

## 1. Intent

Mega Family's business number **054-227-2554** is a WhatsApp Business APP number: the reps chat
with customers on it from their phones and computers. Alon wants the system on that number:

- status automations (a message when a case moves - offer sent, paid, "the tour is live");
- newsletters / broadcasts on WhatsApp;
- each rep works their own conversations;
- the conversations recorded in the system;
- an incoming message turned into a lead / task ("complex").

Today the backoffice only opens the rep's own WhatsApp on the customer's chat (`whatsapp://` from
the card - `WhatsAppButton`, `whatsappAppLink`) and can send ONE approved template from a company
number through `lib/services/whatsapp-cloud.ts` (the booking link) - and that is off, because no
WhatsApp env is set. Nothing comes back: no webhook, no log, no consent record.

## 2. The decision: Coexistence, straight to Meta, our own app

**Coexistence** is Meta's name for exactly what Dor described: the WhatsApp Business app and the
Cloud API on the SAME number. The reps keep the app for live chat (free), the API sends templates,
automations and broadcasts, and Meta mirrors EVERY message - the customer's and what a rep writes
in the app - to our webhook, so the system sees the whole conversation without an inbox of its own.

Facts from Meta's doc ("Onboard WhatsApp Business app users", read 21.10.2026):

- Requirements: the business's WhatsApp Business app **2.24.17 or newer**; the integrator "must
  already be a Solution Partner or **Tech Provider**"; "must use Embedded Signup with session
  logging"; a webhook that accepts and digests webhooks. Embedded Signup **v2 and v3 were
  deprecated on 2026-10-15** - we build on v4 / v5 (on v5 app-number onboarding is on by default).
- What syncs on onboarding: all contacts with a WhatsApp number; the last **6 months** of 1:1 chats
  (groups never); media only from the last 14 days. We have **24 hours** after onboarding to request
  the sync, or the business must offboard and connect again. The share-history choice cannot be
  changed later.
- Throughput: **20 messages/second** on a shared number (plenty).
- The app after onboarding: still sends and receives, free, and app messages never open or affect
  API pricing windows. Lost in the app: **broadcast lists** (existing ones become read-only),
  disappearing / view-once / live-location messages. **Companion devices are unlinked** and must be
  re-linked; **WhatsApp for Windows is not supported** - a rep on the Windows app moves to
  `web.whatsapp.com` in the browser (the phone itself is unchanged).
- Not on the API side: groups, calls, catalog, quick replies, labels, the business profile.
- Country support: the official page lists no restriction. Vendor lists name EU / UK / Turkey /
  Australia / Japan / Nigeria / South Africa / Russia / Korea / Philippines as unsupported; Israel
  appears on no such list. Verified for real only at the moment of onboarding (an error names it).

Pricing (Meta rate card effective 2026-10-01, per DELIVERED message, recipient Israel, vendor
mirror of the card - confirm on Meta's rate card before budgeting): marketing **$0.0353**,
utility / authentication / service **$0.0053**. Every number gets **1,000 service messages a
month free** (a non-template reply inside the 24-hour window after the customer wrote); messages
sent from the app are free. A 5,000-contact newsletter is about $176.

Why not the alternatives:

- **API only** (move the number off the app): the app dies the day the number is registered, so a
  complete inbox must exist before the cut-over - a much bigger first step, for no gain Alon asked
  for. Rejected for now; nothing in this design prevents it later (the API side is the same).
- **A paid provider with its own inbox** (Glassix, Commbox, Wati, respond.io, 360dialog; not Zoho -
  Dor 21.10: the Zoho subscription is mail only): fastest
  to "reps answer in a shared inbox", but a monthly fee, a per-message markup, and a second system
  - what Alon's "one place" round was against. Kept as the **fallback** if Meta's Tech Provider
  approval drags: the sending service is written behind a provider adapter (section 7) so a BSP
  is a switch, not a rewrite, and a BSP forwards the same webhooks to our URL.

What Coexistence costs us: Meta bureaucracy, not money - our Meta app must become a Tech Provider
(section 10), which includes an App Review. One to three weeks of waiting, in parallel with the
build.

## 3. Goals, non-goals, anti-goals

Goals (in order - each phase ships alone):

1. Every WhatsApp message with a customer, in or out, on the customer's card - including what a
   rep writes from the app.
2. A message from a number with no open card opens a case for a rep; a message from a customer
   with an open card lands on it as an inquiry (the existing rule, section 6).
3. Templates / automations: a case status change sends an approved template from the company
   number; "the tour is live" to the potentials of a tour.
4. Broadcast: a chosen audience, an approved marketing template, paced sending, results - only to
   people who may legally receive it (section 9).
5. Every company its own number: Mega Family first, Mega Events ("איבנט") the same way when its
   number is ready.

Non-goals (this round):

- A reply box on the card that sends through the API (the rep answers in the app; the box is a
  later, small addition once the thread exists - section 11).
- A per-rep inbox / routing of app chats: in the app every rep sees every chat (4 companion
  devices + the phone); "each rep on their own conversations" is the CARD's rep in our system.
- Groups, calls, catalog, media sending from the backoffice (media is stored when received).
- Mega Events' number in this round (the design is per company; only the onboarding is left).

Anti-goals (a failure even if it works):

- A marketing message to a person who did not agree to it (the spam law: up to ₪202,000 a
  claim, plus Meta's own opt-in rule and quality rating).
- A duplicated case per message (one customer who writes ten lines gets ONE inquiry).
- A token typed by Claude anywhere, or a token in the database in clear text.
- A webhook that answers slowly or throws: Meta retries and then disables it.

## 4. Phases

| Phase | What | Needs |
| --- | --- | --- |
| 0 | Meta side (section 10): portfolio, app, Tech Provider, WABA, webhook, templates, Alon's phone ready. No code except the connect page. | Dor + the admin of the Meta portfolio that owns app "Mega Tours Reporting" |
| 1 | The wire: webhook route, `wa_messages`, thread on the customer card, inbound -> inquiry / case, echoes from the app, history sync, consent columns, opt-out keyword, connect page | Phase 0 done for ONE number |
| 2 | Automations: a template per status transition (+ "tour is live"), the Statuses screen editor, template cache + sync | Phase 1 |
| 3 | Broadcast: audience builder, campaign queue cron, results, delivered / read / replied / booked | Phase 2 |

Phase 0 and the code of phase 1 run in parallel: the App Review screencast needs the connect
page to exist (on a preview deployment).

## 5. Data model (migration, all `public`, RLS on with no policies - service role only)

`wa_accounts` - one row per company number:

| column | type | note |
| --- | --- | --- |
| `id` | uuid pk | |
| `company_id` | uuid -> `companies` | unique with `phone_number_id` |
| `waba_id` | text | the WhatsApp Business Account |
| `phone_number_id` | text, unique | what the webhook keys on |
| `display_phone` | text | `+972 54-227-2554` as Meta prints it |
| `verified_name` | text | |
| `mode` | text | `coexistence` / `api_only` (no CHECK) |
| `provider` | text | `meta` (default) / `bsp:<name>` |
| `quality_rating` | text | from `phone_number_quality_update` |
| `messaging_limit` | text | tier from `account_update` |
| `history_requested_at` / `history_synced_at` | timestamptz | the 24-hour deadline (section 10 step 7) |
| `connected_at`, `is_active`, `created_at`, `updated_at` | | |

**Tokens stay in env, never in the table, never on a screen.** In Embedded Signup the WABA lands
in the portfolio the person pressing the button picks in the popup, so the rule is: **the
onboarder is logged in to, and picks, the portfolio that owns our Meta app** ("Mega Tours
Reporting"'s portfolio - section 10). Then a system user of that portfolio with
`whatsapp_business_messaging` + `whatsapp_business_management` assigned to the WABA gives the
permanent token, and the existing convention holds: `NEXT_SECRET_WHATSAPP_TOKEN` (shared) with an
optional per-company override `NEXT_SECRET_WHATSAPP_TOKEN_<SLUG>` read first (`configOf`), phone id
per slug. The business token the signup's code exchange returns is used ONCE, inside
`finishWhatsappSignup`, for `subscribed_apps` + the history-sync request, and discarded - it is
never stored and never displayed. Should a WABA ever land in another portfolio, the fix is a
system user THERE and the per-slug env, not a token in the database. `wa_accounts` makes the phone
id a DB fact the webhook routes on; `whatsappApiReady` may read the phone id from the row when the
env var is missing, never the token.

`wa_messages` - every message, both directions:

| column | type | note |
| --- | --- | --- |
| `id` | uuid pk | |
| `company_id` | uuid | |
| `wa_message_id` | text, unique | Meta's id (`wamid...`) - the idempotency key |
| `phone` | text | customer, digits in international form (`972541234567`) |
| `phone_key` | text | last 9 digits (`phoneKey`), indexed with company |
| `customer_id` | uuid -> `customers`, null | TOURS: resolved by `phone_key` at insert; backfilled when a customer appears |
| `case_id` | uuid -> `leads`, null | TOURS: the case this message belongs to (the card it joined, never a soft-deleted inquiry row) |
| `reservation_id` | bigint -> `reservations`, null | MEGA EVENTS (its own round, section 11): `customers` / `leads` are tours-only tables, so the column exists from day one and stays null for Mega Family |
| `direction` | text | `in` / `out` |
| `origin` | text | `customer` / `app` (a rep in the WhatsApp app - echo) / `api` / `automation` / `broadcast` / `history` |
| `type` | text | `text` / `image` / `document` / `audio` / `video` / `sticker` / `location` / `contacts` / `template` / `reaction` / `unsupported` |
| `text` | text | body / caption |
| `media` | jsonb | `{ "id": "...", "mime": "image/jpeg", "sha256": "...", "storage_path": "wa/<company>/<id>.jpg" }` - downloaded to a private bucket `wa-media` when received (Meta keeps media 30 days) |
| `template` | jsonb | `{ "name": "offer_sent", "language": "he", "params": ["...", "..."] }` |
| `status` | text | `received` for inbound; `accepted` / `sent` / `delivered` / `read` / `failed` for outbound |
| `status_at` | timestamptz | |
| `error` | text | Meta's error in a sentence (`explain`) |
| `sent_by` | uuid -> `user_profiles`, null | staff who pressed send (api); null for app / automation |
| `automation_id`, `campaign_id` | uuid, null | |
| `sent_at` | timestamptz | Meta's timestamp |
| `inserted_at` | timestamptz default now() | |

Indexes: `(company_id, phone_key, sent_at desc)`, `(customer_id, sent_at desc)`, `(campaign_id)`.

`customers` gains: `wa_consent` text (`none` default / `opted_in` / `customer` / `opted_out`),
`wa_consent_source` text (`site_form` / `reply` / `booking_terms` / `staff:<user id>`),
`wa_consent_at` timestamptz, `wa_last_in_at` timestamptz (the 24-hour window, maintained by the
webhook), `wa_profile_name` text (the name WhatsApp gives).

`leads` gains: `wa_seen_at` timestamptz - when the card's rep last opened its thread; "N new" =
inbound messages after it.

`wa_templates` - a cache of the company's approved templates (name, language, category, status,
body, parameter count, `synced_at`), filled by "Sync templates" (Graph `/{waba}/message_templates`)
and kept by the `message_template_status_update` webhook. A send refuses a template the cache does
not hold as `APPROVED`.

`wa_automations` - phase 2: `company_id`, `trigger` (`status:<key>` or `tour_live`), `template`
(name), `params` jsonb (which case / tour fields fill `{{1}}..{{n}}`: `first_name`, `tour`,
`booking_link`, `departure_date`, `amount`...), `enabled`, `created_at`. One trigger may hold one
automation per company. `status:offer_sent` is never offered: the booking-link template
`prepareOffer` already sends IS that message.

`wa_outbox` - phase 2, how a status change reaches the sender whatever wrote it. A case's status
is written from six places (reps' `updateCase` / bulk, `fileInquiry`, `prepareOffer` /
`markOfferSent`, and SQL alone: `tours.bookings_status_to_case` -> `pending_payment` / `paid`,
`leads_fill` -> `returned`, `booking_create`), so the hook is a **trigger on `public.leads`**
(`after update of status`): it inserts `{ company_id, case_id, trigger: 'status:<to>', from_status,
to_status, created_at }` when the company has an enabled automation for that trigger. Dedupe =
unique `(case_id, trigger, day)` - one message per case per status per day. The TS paths call
`drainWaOutbox(caseId)` right after their write (the message leaves at once); the cron
`waOutboxSender` (every 5 minutes, `maxDuration` 60) sends what SQL-only transitions left. Every
row ends `sent` / `skipped` (no phone, no consent where needed, template not approved) / `failed`
with the reason, so "why did nothing go out" is answerable; `?dry_run=1` lists without sending.

`wa_campaigns` (phase 3): `company_id`, `name`, `template`, `params` (fixed or per-recipient keys),
`audience` jsonb (the filter as typed - section 8), `status` (`draft` / `queued` / `sending` /
`done` / `cancelled`), counts (`total`, `sent`, `delivered`, `read`, `replied`, `failed`),
`created_by`, `started_at`, `finished_at`. `wa_campaign_recipients`: `campaign_id`, `customer_id`,
`phone`, `status`, `wa_message_id`, `error`, `sent_at`. Unique `(campaign_id, phone_key)`.

## 6. The webhook (phase 1)

`app/api/whatsapp/webhook/route.ts` - `middleware.ts` skips `/api`, so the route guards itself:

- `GET`: Meta's verification handshake - `hub.mode=subscribe`, `hub.verify_token` equal to
  `NEXT_SECRET_WHATSAPP_VERIFY_TOKEN`, answer `hub.challenge` as plain text, else 403.
- `POST`: read the RAW body, check `X-Hub-Signature-256` = HMAC-SHA256 of the body with
  `NEXT_SECRET_WHATSAPP_APP_SECRET` (constant-time compare; a bad signature = 401, logged once);
  then handle every entry and answer **200 within the request** (Vercel; `maxDuration` 30). A
  failure inside one message is logged and never fails the batch - Meta re-delivers an un-acked
  batch for up to 7 days, and a duplicate is harmless because `wa_message_id` is unique (insert
  `on conflict do nothing`).
- Subscribed fields: `messages` (inbound + outbound statuses), `smb_message_echoes` (what a rep
  sent from the app), `smb_app_state_sync` (contacts), `history` (the 6-month sync),
  `message_template_status_update`, `account_update`, `phone_number_quality_update`.
- Routing: `metadata.phone_number_id` -> `wa_accounts` -> company. An unknown phone id is logged
  and acked (never 500: Meta would back off every number).

What an INBOUND customer message does, in order (`lib/services/whatsapp-inbound.ts`):

1. Store the `wa_messages` row (media downloaded to `wa-media` by Meta media id; a download that
   fails leaves `media.storage_path` null and is retried by the next webhook of the same chat).
2. Find the customer by `phone_key` (`customers.phone_keys`, live rows, newest); set
   `wa_last_in_at`, `wa_profile_name` when empty.
3. **Opt-out keyword** (`isOptOut(text)`: "הסר", "להסרה", "הסירו אותי", "stop", "unsubscribe",
   alone or as the first word) -> `wa_consent = opted_out`, source `reply`, and ONE free service
   reply "הוסרת מרשימת התפוצה שלנו. לכל שאלה אנחנו כאן." - never a marketing message again. No
   "yes" parsing: a reply is never read as consent in this round (section 9).
4. **One inquiry per conversation, not per message** - `shouldOpenInquiry(lastInboundBefore, now)`
   (pure): true when the customer's previous inbound message is older than
   `WA_INQUIRY_GAP_HOURS` (24) or none. When true, insert a `public.leads` row: `company_id`,
   `kind: 'whatsapp'`, `source: 'whatsapp'`, `name` = the WhatsApp profile name, `phone`,
   `message` = the text (or "[תמונה]" / "[קובץ]"), `payload: { wa_message_id }`. `leads_fill`
   finds the customer by phone and routes it - with ONE new branch (migration, plus the TS twin
   `routeInquiry` and its selftest): **a `whatsapp` row never goes "to file"** - a message is the
   continuation of a conversation, not a form about a tour, so with open cards it joins the
   customer's NEWEST open card (`updated_at`; the existing join mechanics: the row is kept
   soft-deleted with `payload.joined_into`, the card gets `payload.inquiries[]`, follow-up today,
   `returned` from `no_answer` / `offer_sent` / `future`); with none it opens a new `lead` case on
   the rep of the customer's newest card (or unassigned). Today's rule would have filed EVERY
   WhatsApp message of a customer with an open card, because the join needs a named tour.
   `LEAD_KIND_LABELS` gains `whatsapp: "WhatsApp"`; `leads_fill`'s TYPE rule gives `whatsapp` the
   type `lead`.
5. Link the message to the case: `wa_messages.case_id` = the card the row LANDED on - read back
   `payload.joined_into` after the insert (the joined target), else the new case's id - never the
   soft-deleted inquiry row. Messages inside the gap take the `case_id` of the previous inbound.
   The echo rule below uses the same answer (the customer's newest open card), so both halves of a
   conversation hang on one row.
6. The card's TODAY reason gains `whatsapp` ("הודעה חדשה בוואטסאפ") while unseen inbound exists
   (`todayReason`, pure, selftested) - the rep sees it on the board like `returned`.

An ECHO (`smb_message_echoes`, a rep wrote from the app) is stored `direction: out`, `origin: app`,
`case_id` = the customer's newest open case, and marks the thread seen (someone answered).

A STATUS (`statuses[]` in `messages`) updates `status` / `status_at` / `error` of the matching
`wa_message_id` row.

HISTORY (`history` field after the sync request) fills `wa_messages` with `origin: history` for
both directions - no inquiry is opened from history, no automation fires, consent is untouched.

## 7. Sending (`lib/services/whatsapp-cloud.ts` grows, same file)

- A provider adapter: `interface WaProvider { sendTemplate(...); sendText(...); downloadMedia(...);
  listTemplates(...) }` with `meta` (Graph `v26.0`, what exists today) as the only implementation
  this round; `wa_accounts.provider` picks it. A BSP implementation is a later file, never a change
  to callers.
- `sendTemplate(company, { to, template, params, language })` - exists; now refuses a template the
  cache does not hold as approved, and writes the `wa_messages` row (`origin` from the caller)
  BEFORE the HTTP call (status `accepted`), updating it with Meta's id or the error.
- `sendText(company, { to, text })` - only inside the window: `canSendText(waLastInAt, now)` (pure,
  24 h) else `{ ok: false, error: "More than 24 hours since the customer wrote - send a template." }`.
  Used by the opt-out confirmation now, by the card's reply box later.
- Rate: a `pLimit`-style queue of 5 sends a second per company inside one process (the broadcast
  cron is the only caller that ever sends in bulk).
- Every send is audited `whatsapp.sent` with the message id (never the text of a customer message
  in the audit row).

## 8. Screens

**Company settings -> "WhatsApp" card** (`components/tours/content/whatsapp-card.tsx`, actions
`lib/actions/whatsapp-settings-actions.ts`, `requireAdmin`):

- Not connected: a "Connect the company's WhatsApp" button = Meta's Embedded Signup (the FB JS SDK
  with `NEXT_PUBLIC_WHATSAPP_APP_ID` + the configuration id; v5; session logging = the page listens
  to the popup's `WA_EMBEDDED_SIGNUP` messages and posts `{ phone_number_id, waba_id, event }` to
  `finishWhatsappSignup`, which exchanges the returned code server-side, subscribes the app to the
  WABA, writes `wa_accounts`, and requests the history sync at once (`history_requested_at`)).
  The page tells Alon, before he presses: app 2.24.17+, broadcast lists will stop, computers
  re-link, Windows app not supported, the history choice is final.
- Connected: number, verified name, quality rating, messaging tier, `history_synced_at`, the
  template list with status + "Sync templates", a "Send a test" to a STAFF phone (template only),
  and the env hint when the token is missing ("the number is connected; the sending token is not
  set in Vercel").

**Customer card -> "WhatsApp" fold** (`CustomerPage` and `CasePage embedded`): the customer's
thread newest-last (both directions; origin as a small tag - "מהאפליקציה", "אוטומציה", "דיוור",
"היסטוריה"; delivery ticks; a template as its rendered body), "פתח בוואטסאפ" (the existing app
link), the consent state with "סמן הסכמה" (staff, a note required, source `staff:<id>`) and
"הוסר" for the record, and a line when the 24-hour window is open ("הלקוח כתב לפני 3 שעות").
Opening the fold stamps `leads.wa_seen_at`. Loading rides the case's one action (`getCase`
returns the thread's newest 50 with a "more" action) - no second read on mount.

**Board / ALL**: a "💬 N" chip on a card with unseen inbound; TODAY reason `whatsapp`.

**Statuses screen** (phase 2): per status a row "שלח תבנית כשהכרטיס עובר לסטטוס זה" - template
picker (approved only), the parameter mapping, enabled switch - the `wa_automations` editor
(`offer_sent` has no row - the booking link is its message). It fires on EVERY path that moves
the status, reps and SQL alike, through `wa_outbox` (section 5). Plus
"הטיול עלה לאוויר" per tour (the tour editor): sends the `tour_live` automation to the tour's
potentials (`notify` / `waitlist` cases, `wa_consent` allowing - section 9), once per customer per
tour, recorded as a campaign so the counts show.

**Marketing -> "דיוור בוואטסאפ"** (phase 3, tours nav, admins): audience = filters over customers
(travelled with us: series / tour / year; status: potentials of a tour; season; last contact
before X; exclude contacted in the last N days), the count that MAY receive (consent rule) beside
the raw count, template + parameters, a preview on one customer, "Send" -> `queued`; the cron
`waCampaignSender` (every 5 minutes, `maxDuration` 60, 5 sends/second, budget 50 s, resumes where
it stopped) sends and the results page shows delivered / read / replied (an inbound within 72 h) /
booked (a booking of that customer after the send). An opt-out reply during a campaign stops that
recipient's later campaigns, never the running one's already-sent messages (they are sent).

## 9. Consent - one pure module, `lib/whatsapp/consent.ts` (selftest `scripts/whatsapp-selftest.ts`)

Israel's spam law (§30A of the Communications Law) forbids an advertising message without the
recipient's explicit prior consent, and gives the recipient a claim without proof of damage.
Meta requires opt-in as well and pauses templates whose quality drops. Rules:

- `canSendMarketing(customer)`: `opted_in`, or `customer` (bought from us - the law's transaction
  exception: a customer who LEFT THEIR DETAILS while buying, was told marketing may follow and
  could refuse - Dor 21.10: "only if they left details"; **the booking terms must say so**: a
  cross-repo item, mega-family's funnel terms step and `PackageFunnel` / `TourFunnel` get the
  sentence + the `marketing_consent` checkbox) and not `opted_out`. `customer` is stamped only on a
  booking made AFTER the terms carry the sentence (`wa_consent_at` >= the terms' date), never
  backfilled onto older bookers - they are `none` until they opt in. A lead / potential who only
  asked is `none` = NO.
- Utility templates about the customer's own case (offer sent, payment received, trip details)
  are not advertising: allowed on `none` too. Meta category `UTILITY`. "The tour is live" to a
  waiting list IS what they asked for (`notify` / `waitlist` = they asked to be told) - allowed on
  `none` for that tour only, category per Meta's review (likely `MARKETING`, paid as such).
- Consent capture on the site (mega-family, same round): the contact form's checkbox "אני
  מאשר/ת קבלת מבצעים והטבות" reads "...במייל ובוואטסאפ" and travels as `payload.marketing_consent:
  true`; the footer newsletter form = consent by its nature (`kind: newsletter`); `leads_fill`
  copies `payload.marketing_consent` to `customers.wa_consent = opted_in` (source `site_form`) when
  the customer's consent is `none` - never over `opted_out`.
- Consent comes from FOUR sources only: the site form checkbox, the newsletter form, the booking
  terms (`customer`), and a staff mark with a note. **A reply is never consent in this round**: a
  "כן" to "do you want the 3-night option" must not become marketing consent, and the law allows
  no consent-request blast to private persons. A `consent_prompt` template with a reply tie (the
  newest outbound to that number is that template, within 72 h) is a phase-3 option, decided
  then.
- Every marketing template ends with the opt-out line "להסרה השיבו: הסר". Opt-out is final until a
  human re-marks it with a note.
- A dry run of every campaign lists who was excluded and why (`none`, `opted_out`, no phone,
  contacted lately).

## 10. Phase 0 - the Meta side (Dor; no code except the connect page)

Found 21.10: the marketing tokens belong to app **"Mega Tours Reporting"** (app id
`2120853392154473`), system users "Insights Reader" / "Campaign Toggle". Dor's personal Facebook
login does not administer that app (it sees only the "ZA Surf" portfolio and a dead app "dor"),
so the steps below need the portfolio's admin.

1. In that portfolio (Dor 21.10: **Tom administers it**; the API app already exists): business
   verification must be complete (WhatsApp production needs it).
2. App "Mega Tours Reporting" (the existing one - no new app): add the **WhatsApp** product; add
   **Facebook Login for Business**; set the app to **Live**.
3. **Tech Provider**: App Dashboard -> WhatsApp -> "Become a Tech Provider" (Meta's checklist:
   verified business, Facebook Login for Business, an Embedded Signup configuration - note its
   configuration id - and advanced access to `whatsapp_business_management` +
   `whatsapp_business_messaging` through **App Review**, which asks for a screencast of the connect
   flow: record it on a preview deployment of the connect page, phase 1).
4. **Webhook**: callback `https://<backoffice host>/api/whatsapp/webhook`, verify token = the env
   value; subscribe the fields of section 6.
5. **Payment method** on the WABA (Meta billing; the first messages fail otherwise).
6. Env in Vercel (and documented in CLAUDE.md): `NEXT_PUBLIC_WHATSAPP_APP_ID`,
   `NEXT_SECRET_WHATSAPP_APP_SECRET`, `NEXT_SECRET_WHATSAPP_CONFIG_ID`,
   `NEXT_SECRET_WHATSAPP_VERIFY_TOKEN`; after onboarding `NEXT_SECRET_WHATSAPP_TOKEN` (a system
   user with the WABA assigned) and `NEXT_SECRET_WHATSAPP_PHONE_ID_MEGA_FAMILY` (the existing
   names).
7. **Alon's phone, the day before**: WhatsApp Business app 2.24.17+, the number live on it for 7+
   days, export / abandon broadcast lists, tell the reps their computers re-link (WhatsApp Web, not
   the Windows app). **Onboarding day**: whoever presses "Connect" is logged in to Facebook as an
   admin of the portfolio that owns the app and PICKS THAT PORTFOLIO in the popup (section 5 -
   the token model depends on it) -> share history and contacts -> the sync request goes out at
   once; `history_synced_at` must be stamped within 24 hours or the number is offboarded and
   connected again. Then the system-user token + phone id go to Vercel (step 6).
8. **Templates** in WhatsApp Manager, Hebrew, body variables only: `booking_link` (the code's
   default already), `offer_sent`, `payment_received`, `trip_details`, `tour_live` (marketing),
   `newsletter` (marketing, `{{1}}` first name, `{{2}}` the text, `{{3}}` a link) - each with the
   opt-out line where marketing. Approval: minutes to a day.

Fallback if step 3 stalls past the build: a BSP that is already a Tech Provider and supports
coexistence (360dialog is the cheapest; Zoho if the subscription covers it) performs the Embedded
Signup; we point its webhook at our route and add the `bsp:<name>` provider (base URL + auth
header). Everything in sections 5-9 is unchanged.

## 11. Later (named so nobody re-designs)

- Reply from the card through the API (`sendText` inside the window; outside it a template
  picker) - small once the thread exists; 1,000 free a month, then $0.0053.
- Per-rep assignment of app chats (needs the reply box; the card's rep becomes the chat's owner).
- Mega Events' number: its own round, not free. `wa_accounts` and the webhook are per company
  already and `wa_messages.reservation_id` is reserved, but Mega Events has no customer cards -
  its people are `reservations` written by main - so the thread, the lead rule and the screens
  need their own design there (section 5 keeps the table ready for it).
- Marketing reports beyond a campaign's counts (the marketing dashboard's attribution).
- Staff notifications on WhatsApp (task assignment) - a different audience, a different consent.

## 12. Left to the builder

- Media storage layout, size caps, signed URLs on the thread (the task-attachments pattern).
- The exact Graph calls of the signup finish (code exchange, `subscribed_apps`, the history sync
  request) - per Meta's current doc; keep them in one file with the version pinned.
- The TODAY reason's rank among the existing ones (`returned` first is the precedent).
- Template parameter rendering in the thread (the cache's body with `{{n}}` filled).
- Which "contacted lately" default the audience builder starts on (7 days is my guess).

## 13. Answered by Dor (21.10.2026)

1. The Meta portfolio that owns "Mega Tours Reporting": **Tom** administers it, and the API app
   already exists - phase 0 adds WhatsApp to it. Tom (or an admin of that portfolio) presses
   "Connect" on onboarding day, picking that portfolio.
2. Zoho: **mail only** - no Zoho fallback; a BSP fallback means 360dialog or similar.
3. Phase order (wire + thread + lead -> automations -> broadcast) and the reply box as "later":
   **yes**.
4. Past bookers as `customer` consent: **yes, only when they left their details** - the booking
   terms carry the sentence first; a lawyer's yes before the first broadcast to them.
