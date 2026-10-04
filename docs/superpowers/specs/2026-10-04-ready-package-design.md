# Ready package ("חבילה מוכנה") - design

Date: 2026-10-04. Approved by Dor in chat the same day (internal name: "חבילת קהל מבוגר").

## What it is

Some events are sold to an older audience that should not be asked to choose. For
those events staff prepare ONE package (ticket + flight + hotel). A click on the
event card lands the customer straight on the order summary, drawn as three visual
cards (flight / hotel / ticket), with a traveller-count picker and a quiet "החלפה"
link per card. Everything below it (traveller details, payment) is the existing
summary, untouched.

It is the prepared-package link feature (`prepared_packages`, `?pkg=`) with three
additions: a package that belongs to the house instead of a partner, an event-level
switch that makes it the card's landing, and a nightly refresh that keeps it priced.

## Decisions (Dor, 04.10)

1. **B - built by hand per event**, from online offers or our inventory. No rule profiles.
2. **Traveller picker on the screen** (1..max), same flight, same hotel, same ticket category.
3. **Nightly refresh + checks at booking**, not a live search on every page open
   (hotel search is limited to 10/min; a campaign would break it).
4. **Only a package we built and marked as such.** Nothing changes for any other event,
   for partner links, or for the regular flow.
5. A package can exist **hidden from customers** (preview) for our own testing.

## Data (migration, backoffice)

`prepared_packages`:

| column | meaning |
|---|---|
| `kind` text, default `partner` | `house` = a ready package. Partner rows are untouched. |
| `partner_tracking_code` | NOT NULL dropped - a house package has no partner and earns no commission. |
| `spec` jsonb | The IDENTITY of each piece (ticket id + category, flight numbers + times or offline id, hotel id + room + meal + dates, or "none"). What a refresh looks for. |
| `variants` jsonb | `{ "<travellers>": { event_order_info, flight_order_info, flight_skipped, hotel_order_info, hotel_skipped } }` - one priced composition per party size, in the shapes main already round-trips. |
| `max_travelers` int | Top of the picker. |
| `refreshed_at`, `refresh_status` (`ok` / `partial` / `broken`), `refresh_note` | Last refresh and what it found. |

`events`: `ready_package_token` (the house row's `share_token`), `ready_package_mode`
(`off` default / `preview` / `live`, no CHECK), `ready_package_price_usd` (per person at
the default party - what the event card shows in `live`). Main reads events with
`select("*")`, so the columns arrive by themselves. `updateEvent` strips all three (the
form's stale copy must never write them back - same trap as the light columns).

The existing top-level `event_order_info` / `flight_order_info` / `hotel_order_info` /
`num_travelers` columns hold the default party's variant, so every old reader of the
row keeps working.

## Backoffice

- **Building.** The package is built in the portal wizard, as today (staff impersonate a
  partner or use a partner login). The event editor's new card **"Ready package"**
  (`section-ready-package`) lists the prepared packages that exist for this event and
  **adopts** one: it copies the composition into a NEW `kind = house` row (the partner's
  own row and link are not touched), extracts `spec`, stores the source's composition as
  the first variant, and the card then builds the other party sizes one call per size
  (a size = one flight search + one hotel search through main's own APIs - the same
  calls the wizard makes, so every offer is exactly what a customer would be offered).
- **Matching** (pure, `lib/ready-package.ts`, selftest): an offline flight by
  `offlineId`; a live flight by both flight numbers and both departure times; a live
  hotel by hotel id, then the same room name and meal, else the cheapest rate with the
  same meal (noted). A size with no match is left out of the picker and reported.
  An offline hotel is rebuilt for another size only when every room comes from one
  inventory row; otherwise it keeps its built size only.
- **Card controls:** mode (off / preview / live), max travellers (default 4, up to 6),
  "customer may swap pieces" (`allow_edit`), preview link, refresh now, remove. Turning
  `live` on is refused while the default size has no valid variant.
- **Cron `ready-package-refresh`** (nightly, time-budgeted, least recently refreshed
  first, `?dry_run=1`): rebuilds every variant of every house package attached to an
  event in `preview` or `live`, rewrites `ready_package_price_usd`, sets the status.
  A `live` package that turned `broken` mails `NEXT_SECRET_ADMIN_EMAIL` (no task is opened in
  v1 - the card's status badge and the mail are the signal).
- A test package is composed without the wizard by
  `scripts/ready-package-create.ts <eventId>` (`--apply` to write): cheapest available
  ticket, cheapest direct flight with a checked bag, cheapest 4-star with breakfast.
  It lands in `preview`.
- Everything is `requireStaff`, audited (`ready_package.*`) and revalidates main.

## Main

- `lib/events/readyPackage.ts` (pure, tested): which token, if any, this page load
  opens. `?orderId` / `?pkg` win and mean "not a ready package". `?ready=<token>` opens
  it when it equals the event's token and the mode is `preview` or `live`. With no
  parameter, mode `live` opens it. `?build=1` forces the regular flow.
- `/api/package/[id]`: for a `house` row it answers only while the event still points
  at it and the mode is not `off`; takes `?pax=N`, serves that variant through the same
  re-validation as today, and adds `house`, `pax_options`, `allow_edit`. A partner row
  takes the exact path it takes today.
- `useHandlePreparedPackage` loads the token from `?pkg` or from the rule above and, for
  a house answer, sets `readyPackage` in `OrderContext`. The order draft treats a
  ready-package load like a `?pkg` load (nothing restored over it, nothing recorded).
- `ReadyPackageShowcase` (new file) is drawn by `OrderReview` in place of `<Review>`
  when `readyPackage` is set - one condition. Price summary, coupon, traveller details,
  payment and `confirm-order` are not touched. No upsell rows in v1.
- The picker fetches `?pax=N` and applies it the way the first load does.
- A package that cannot be served (410, or a piece that needs a re-pick) falls back to
  what a partner link does today: the regular flow, on the step that needs a choice.
- In `live`, the event card's price is `ready_package_price_usd`, so the card and the
  landing agree.

## Isolation

Every event starts `off`. No main code path changes unless `readyPackage` is set, and
that is set only by a `house` answer. Partner links keep `kind = partner` and their
route branch. New UI lives in new files.

## Not in v1

Several packages per event, rule profiles, priced extras, split stays inside a
package, a staff wizard inside the dashboard, a live re-search at the moment of booking
(the nightly refresh, main's existing step-4 flight pricing call and `confirm-order`'s
price floor are what stand there today).

## Rollout

Backoffice first (migration), then main. Everything `off`. One `preview` package for
QA, then a QA form for Alon.
