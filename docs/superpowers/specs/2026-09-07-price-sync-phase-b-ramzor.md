# Base-price sync - Phase B (date window) + Phase C (ramzor hook)

**Status:** parked (Dor, 2026-09-07) - to be folded into the ramzor (price light)
build, not shipped on its own. Phase A (units, $20 band, `flights` table, full
logging, rotation, arithmetic on `/price-changes`) shipped 2026-09-07.

## What Phase A leaves open

- The sync quotes ONE date pair per event: `def_date_depart` → `def_date_return`.
  A one-day shift often flips a connection into a direct at the same fare
  (Dor's example: Barcelona - City, 7-10 connection only, 6-10 direct at about
  the same price) - the customer never sees that package.
- Amadeus has no direct offer at all on some pairs (TLV→LON/AMS 14-16.9 during
  the holidays returned zero nonstop). Today the rule falls to the cheapest
  connection + $100, which is right, but the fix is often one day away.
- Coverage: ~10s per event → ~27 events per 270s run → a full rotation over the
  ~440 live events takes ~16 nights. Near-window events (45 days) go first, so
  the tail is the far-off events. Options when it matters: 2 cron slots a night,
  or quoting 3 events concurrently (Amadeus prod allows ~10 tx/s; verify).

## Phase B - date-window search

Per event, quote a small window that still contains the event:

| variant | depart | return | nights |
| ------- | ------ | ------ | ------ |
| current | D      | R      | n      |
| early   | D-1    | R      | n+1    |
| late    | D      | R+1    | n+1    |
| wide    | D-1    | R+1    | n+2    |

Rules:
- Every variant must satisfy `depart <= event.date < return` and keep the
  existing Fri/Sat avoidance the auto-dates already apply (`def_date_*`).
- Score = flight quote + hotel quote (both already margined and rounded).
  Hotel is re-quoted per variant - an extra night is real money.
- Prefer a **direct** variant when its total is within `DIRECT_GAP_USD` ($300)
  of the cheapest total, same spirit as `pickFlightPrice`.
- **Recommend, never move dates automatically.** A better variant lands in
  `base_price_sync_log` as `status = 'suggest_dates'` with the variant's dates
  and both totals in `note` (needs a new status value - the column has no CHECK
  constraint, but the screen's filters do). `/price-changes` shows an
  "אשר תאריכים" button that writes `def_date_depart/return` **and** both bases
  in one action, plus an audit row. Changing dates changes the package every
  customer sees - Dor decides per event.
- Cost: 4 variants × 3 calls = 12 calls per event instead of 3 → ~4× slower.
  Run Phase B only for events whose Phase A quote is a **connection** (no
  direct found or direct over the gap) - that is where a day matters. Direct
  events keep the single quote.

Open decisions before building:
1. Window size - ±1 day (above) or also ±2? Suggest ±1 first.
2. Does a suggested variant also require the hotel to stay the same 3★? (No -
   it is re-quoted; the rule is the rule.)
3. Should the suggestion e-mail separately or ride the daily summary? Daily.

## Phase C - ramzor re-check hook

After the ramzor exists (memory `price-light-ramzor-plan`: plan only, 7 open
decisions, no spec/code yet):
- Every `applied` log row (base changed) and every approved `suggest_dates`
  row triggers a ramzor comparison for that event (ticket-only price + full
  package vs competitors).
- Green (alone / cheaper) → nothing. Orange → keep, mark. Red → open a task in
  `/tasks` (`kind: price_review`) with the sync row and the competitor row
  linked, assignee = whoever owns pricing.
- The trigger is a queue, not inline in the cron: the sync writes the log row,
  a separate ramzor pass reads rows since its last run. Keeps the 270s budget
  for quoting.

## Where the code goes when built

- `lib/services/price-quote.ts` - `quoteWindow(event)` returning the variant
  table; keep `quoteFlight`/`quoteHotel` as the primitives.
- `lib/services/base-price-sync.ts` - call `quoteWindow` only on connection
  results; write `suggest_dates`.
- `lib/actions/base-price-log-actions.ts` - `approveDatesRow(id)`.
- `app/(dashboard)/price-changes/price-changes-client.tsx` - the new status +
  button; `/guide` pricing section - one bullet.
