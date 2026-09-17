# Price light gaps + AI Factory - design

Date: 2026-09-16. Owner: Dor. Status: approved in brainstorming, awaiting spec review.

Source: Google Doc "באגים / תיקונים - אלון תום ודור", tab "רמזור אפיון" (site/feed
implications + 14 numbered notes). Builds on `2026-09-09-price-light-design.md` and the
`lib/agents/` layer.

## 0. Decisions taken (brainstorming, 2026-09-16)

| # | Question | Decision |
|---|----------|----------|
| D1 | Red light and the product feed | **Now: red only opens a task.** Auto-removal from the feed comes later, once the agent is mature (maturity metric in the AI Factory). Decision 6 of the 09-09 design stands for now. |
| D2 | "Our price without the +100 / +120" (note 7) | **The light alone compares our margin-free "from" price.** The site keeps the rule's +$100 / +$120 (Dor, 2026-09-17: the site is an average-per-traveller price and the margin lets a customer see a minus when picking another flight/hotel). Net flight/hotel come from `light_detail.ours`, fallback `base − margin`. |
| D3 | Nightly rotation starvation (~315 events never re-quoted) | **Separate decision.** Fixing it raises their site "from" price by ~$100; needs its own dry run and Dor's OK. Not part of P0. |
| D4 | (retired) | Overnight 2026-09-16 the margins were removed from the rule itself on a misreading; reverted 2026-09-17. |
| D5 | AI Factory architecture | Agents stay **declared in code** (`lib/agents/`); the page renders them. Switches stay in env (fail-closed); the UI can never turn spending on. One new table for taught rules. |
| D6 | AI Factory v1 contents | Identity/role, memory + teaching, decision log with ✓/✗ review, maturity metric. |
| D7 | Price suggestions (note 9) | **Agent #2 "יועץ מחיר"**, red only, writes into the auto-opened task. Deterministic numbers first, AI only phrases/ranks. |
| D8 | Auto task for red | Unassigned, opened by the nightly run, one open per (event, scope). Daily summary mail counts them. |
| D9 | Note 10 "הוזל" | Inline popover editing ONE markup field with live preview. Package → `event_additional_markup`, ticket → `ticket_only_markup`. |
| D10 | Note 1 | Fixed column per competitor (5). Header click filters by that competitor (covers note 3). |
| D11 | Note 2 | Visual only: spacing between number and label in tiles/views. |
| D12 | Note 11 | Quick action: set `events.tags = "Sold"` (take off sale without removing) + optional manual "price dropped" mark. |
| D13 | Note 4 | Spike per site (ISSTA XHR, LiveTickets product page), then decide. Coverage metric per competitor. |
| D14 | Site priority for green (rule A) | In main, **after P0** lands. |
| D15 | Taught rules (`agent_instructions`) | Admin-only input, fed to the model **as staff instructions** (not fenced as data). Override notes / audit lessons stay fenced as data, as today. |

## 1. Why P0 comes first - measured 2026-09-16 (read-only)

- 444 live events carry `light_detail.ours` (the rule's chosen offer, net).
- **Flight:** of 435 comparable events, 187 have a base within $50 of the net fare (no margin -
  created May-August, before the rule's +$100 went live on 2026-09-02, and never re-quoted
  since), 151 carry the margin (+$50..+$150), 56 sit more than $150 above and 41 below.
- **The nightly sync covers ~23 events per night** (≈46 log rows, 2 components), not the
  documented ~50, and in 10 nights visited only **131 distinct events** - `orderForRotation` puts
  every near-window event (visited or not) ahead of every far one, so ~315 events were never
  visited. Fixing it is a SEPARATE decision (D2b): it would re-quote those events under the
  current rule and raise their site "from" price by ~$100.
- **What main actually charges** (`myt-main/app/order/hooks.tsx:243`, `OrderForm.tsx:205`):
  flight component = `base + (live/adults − base)` = the live net price; the hotel works the
  same way. The margins shape what the customer SEES (a minus when picking a different flight or
  hotel), which is exactly why Dor keeps them.

Hence D2: the light - and only the light - compares our margin-free "from" price. Site prices,
the pricing rule and event creation do not change.

## 2. Phases

| Phase | Content | Depends on |
|-------|---------|------------|
| **P0** | Price light compares our margin-free "from" price (site untouched) - DONE 2026-09-17 | - |
| **P1** | Price-light UI: notes 1, 2, 3, 8, 10, 11, 12, 14 | - |
| **P2** | AI Factory + price-advisor agent + auto red task: notes 6, 9, rule C | P0 |
| **P3** | Scraper spikes: note 4 | - |
| **P4** | myt-main: green/alone priority on artist/team/category pages, "price dropped" badge (rule A) | P0 |
| Separate | Nightly rotation fix (D2b) - changes site "from" prices, needs its own dry run + Dor's OK | - |
| Deferred | Red leaves the feed automatically (rule B) | P2 maturity above a threshold Dor sets |

Each phase gets its own implementation plan.

## 3. P0 - the light compares our "from" price (built 2026-09-17)

### 3.1 What changed

- `lib/services/price-margins.ts` (new, pure): `FLIGHT_MARGIN_USD 100`, `HOTEL_MARGIN_USD 120`.
  `price-quote.ts` imports and re-exports them - its behaviour is byte-for-byte the same.
- `lib/services/price-light.ts`: `ourNetFlightUsd` / `ourNetHotelUsd` take the net from
  `light_detail.ours` (the offer the rule would buy today; offline inventory first) and fall back
  to `base − margin`; a base at or below the margin is a hand-typed number and is kept whole.
  `ourFromUsd` = net flight + net hotel + cheapest ticket + `totalMarkupUsd`, same null rules as
  `ourPackageUsd`. `ourOfferLines` has four lines (טיסה / מלון / כרטיס / עמלות לקוח) that sum to
  it and name the net's source. `ourNightRateUsd` uses the net hotel.
- `ourPackageUsd` is unchanged and stays the SITE card price: the daily snapshot and the
  "ירידת מחיר" tag keep using it (switching them would record a fake ~$220 drop).
- The light uses `ourFromUsd`: `price-light-store.ts` (scope detail), `price-light-match.ts`,
  the comparison sheet and `our_usd_now`. `PriceLightScopeCell.site_usd` carries the site price.
- UI: the column reads "החל מ- (שלנו)" with `באתר $X` beneath; the events-table tooltip says
  "החל מ- (שלנו): $X"; the comparison sheet shows the four lines.
- The price-light agent's house rules say decisions before 2026-09-17 recorded our price WITH
  the margins.

### 3.2 First run after deploy - expected effects

- Every package match row is rewritten once (our number changed), lights move ~$220 greener,
  and `recomputeEventLights` auto-closes red tasks / lifts mutes whose light settles. Run the
  nightly with `?dry_run=1` first and report the counts to Dor.
- A one-night gap now prices ~$40 lower, so a manual override on such a scope may be dropped by
  `OVERRIDE_DRIFT_USD` the first night. Accept or re-stamp overrides after Dor's OK.
- Until the first run, package cells show the old site-based number struck through.

### 3.3 Not changed (binding)

The pricing rule, `base-price-sync`, event creation, the feed, main - none of it. The hotel-skip
fee threshold stays 550.

## 4. P1 - price-light UI (`app/(dashboard)/price-light/*`)

### 4.1 Table (notes 1, 3)

- Columns: אירוע | המחיר שלנו (price + breakdown) | LiveEvents | ISSTA | Golasso | OnTour |
  LiveTickets | החלטות. Competitor columns come from the competitor registry, not hard-coded.
- Competitor cell: package price + gap pill (top), ticket price + gap pill (bottom), each
  following the scope lens. States: grey = not selling; "לא מכוסה" = `skipped` / `covers()`
  false; "הצעת מחיר" = `quote_only`; "לא ודאי" = `unsure`. A dot marks the deciding competitor.
- Header click toggles a competitor filter (rows where that competitor is `found` or
  `quote_only` for the active scope); a second click sorts by the gap against it. The filter
  lives in the URL (`?comp=golasso`) next to `?scope=`.
- A column empty for every visible row collapses to a narrow header.
- Data is already in `PriceLightRow` (`CompetitorAnswer[]` per scope) - no payload change
  beyond indexing by competitor key.

### 4.2 Filters (note 2)

Tiles and view chips: gap between the count and the label (`gap-1.5`), tabular numbers.

### 4.3 Row actions

- **הוזל חבילה / הוזל כרטיס (note 10).** Popover with one numeric field:
  package → `event_additional_markup`, ticket → `ticket_only_markup`. Live preview computed
  client-side with the pure functions from `price-light.ts` (`ourPackageUsd` / `ourTicketUsd`
  and the thresholds): "מחיר ← X · פער ← Y · אור ← Z".
  Save = new server action `setEventMarkupFromLight(eventId, scope, value)`:
  `requireAdmin`, finite number ≥ 0 (or null to clear, ticket only), writes **only that
  column** (not through `updateEvent`, which spreads whole objects), `recomputeEventLights`,
  `invalidatePriceLight`, main revalidate, and `logAudit("price_light.repriced")` with the
  decision snapshot plus `{ column, before, after }`. Returns `{ ok, kind }`, never throws
  (server-action error masking).
- **סולד אאוט (note 11).** Confirm dialog → `setEventSoldOut(eventId, on)`: sets
  `tags = "Sold"` (the previous tag is kept in the audit row to restore on undo), main
  revalidate, audit `price_light.sold_out` / `price_light.sold_out_cleared`. Main already
  honours `tags === "Sold"` (`isEventSoldOut`): card shows sold out, not bookable, dropped from
  search, `out of stock` in the feed. It is a learning source for the agent (a human took the
  event off sale).
- **המחיר ירד (manual).** After a reprice, a checkbox in the same popover sets
  `price_drop_usd / price_drop_from / price_drop_until` (+14 days) from the before/after
  prices - the same columns the nightly drop tag writes. Shown on the site in P4.
- **לאתר (note 12).** Icon link to `${PUBLIC_SITE_URL}/order/{id}` (`lib/site.ts`), new tab.
- **בדוק עכשיו (note 14).** Refreshes only its row (the action returns the fresh
  `PriceLightRow`; the client patches it in place instead of reloading the list). Row shows
  "נבדק לפני X" from `checked_at`. When `light_detail.ours.at` is older than
  `OUR_OFFER_REFRESH_DAYS`, the action first re-describes our offer (5-8 s, spinner text
  "מפרט את החבילה שלנו…").

## 5. P2 - AI Factory

### 5.1 Agent declaration additions (`lib/agents/types.ts`)

```ts
role: string;            // one paragraph, Hebrew
decides: string[];       // what the agent decides on its own
neverDoes: string[];     // hard limits ("never writes a price", "never sets a light")
humanDecides: string[];  // decisions that stay with staff
maturity?: (since: Date) => Promise<AgentMaturity>;
```

`AgentMaturity = { agreed: number; disagreed: number; reviewedOk: number; reviewedBad: number; rate: number | null }`.

### 5.2 Pages (`app/(dashboard)/ai-factory/`)

- `/ai-factory` - one card per agent: switch state (on / off / key missing - read from
  `switch.ts`, never writable), cost this month, maturity rate, open items.
- `/ai-factory/[key]` - four tabs:
  1. **זהות** - role, decides / neverDoes / humanDecides, model, calls per run, confidence
     minimum, token prices, env switch names and how to turn it on.
  2. **זיכרון ולימוד** - generated house rules; the lessons exactly as the prompt receives
     them (same builder as `memory.ts`); taught rules list + "למד אותו" input
     (add / deactivate).
  3. **יומן** - AI calls, newest first, paged: question summary, verdict, confidence, cost,
     cached flag, link to the event. ✓ / ✗ + optional note → `logAudit("agent.feedback",
     { agent, match_id, verdict_ok, note })`. Price-light source:
     `competitor_matches.ai_verdict`; each agent declares its own log reader.
  4. **בשלות** - 30-day agreement and review rates, weekly trend chart, and a read-only
     "auto-remove from feed threshold" line (not active - D1).
- Nav: new group "AI" → "AI Factory", `ADMIN_ROLES` only; breadcrumbs + palette keywords in
  `lib/nav.ts`. `/guide` gets an AI Factory section.

### 5.3 Taught rules

Migration `agent_instructions`: `id`, `agent_key text`, `text text` (≤ 500 chars),
`active bool default true`, `created_by`, `created_at`, `deactivated_at`. RLS on, no policies
(service role). Actions `addAgentInstruction` / `deactivateAgentInstruction` (`requireAdmin`,
audited). `memory.ts` adds a **"כללי צוות"** block from active rows (capped, newest first),
placed with the house rules - instructions, not the fenced data block (D15).
`agent.feedback` rows become a new `learnsFrom` source (fenced as data, like overrides).

### 5.4 Maturity - price-light agent

Over the last 30 days, per red decision on an event where the AI took part in the match:
agreed = `repriced`, `removed`, `sold_out`; disagreed = `override` to a non-red light,
`silenced`. Plus ✓/✗ from the log. `rate = agreed / (agreed + disagreed)`, null below 10
decisions.

### 5.5 Agent #2 - price advisor (`lib/agents/price-advisor.agent.ts`)

- Trigger: the nightly pass, for each scope that turned red this run, is not silenced and has
  no open price-light task. Runs after lights are recomputed.
- Deterministic facts first (`lib/services/price-advice.ts`, pure where possible):
  - markup cut needed to reach orange / green, and whether the markup stays ≥ 0;
  - a cheaper ticket source for the same fixture across TixStock / P1 / LiveTickets / XS2E
    (already-ingested tables, matched by the existing provider identity);
  - ±1 night: hotel per-night rate vs the competitor's nights (reuses `ourNightRateUsd`).
- AI (switch `PRICE_ADVISOR_AI=on`, own budget, same fail-closed rules): turns the facts into
  1-3 ranked Hebrew suggestions. Never states a number that is not in the facts; never writes
  a price.
- Output goes into the task description. Switch off → the task gets the deterministic facts
  as a bullet list.

### 5.6 Auto task for red (rule C)

`openPriceLightTask` called from the nightly for every new red scope (not silenced),
unassigned, deduped per (event, scope). The daily summary mail adds "N משימות נפתחו". The
existing auto-close on a settled light stays.

## 6. P3 - scraper spikes (note 4)

Throwaway investigations, one report each: ISSTA detail XHR (local probe - ISSTA is
local-only) and the LiveTickets product page for flight/hotel/ticket fields. LiveEvents sports
stays quote-only (no detail page exists). Coverage metric added to the competitors panel and
the AI Factory: % of `found` listings with a flight / hotel / ticket line. The UI prints
"לא מפורסם אצלם" where the source has none. Decision after the spikes.

## 7. P4 - myt-main (DEFERRED by Dor, 2026-09-17)

> Dor: "זה שלב אחרי שרמזור יעבוד טוב - אנחנו נממש את זה באתר הרישמי". Do NOT build until the
> backoffice light has run well in production for a while and Dor reopens it. Proposal on file for
> that day: the category browser already has a user sort, so add a default sort "מומלצים"
> (green / alone first, then date) rather than a silent reorder, plus a "ירידת מחיר" badge on
> `EventCard` from `price_drop_*`.


Order green/alone first on artist, team and category pages (`light_package` only - no ticket
light on the site), and a "ירידת מחיר" badge from `price_drop_*`. Separate spec in main.

## 8. Errors, security, testing

- All new actions: `requireAdmin`, explicit column writes, `{ ok, kind }` results, audit rows.
- Agent switches are never writable from the UI; taught rules are admin-only and length-capped.
- `scripts/price-light-selftest.ts`: margin-free quote cases, `roundUp10`, change-cap
  accounting, breakdown sums to price, maturity arithmetic.
- `scripts/agents-selftest.ts`: new declaration fields, taught-rules block, feedback lesson.
- P0 verification: dry-run report reviewed by Dor before the first real night; after night 1,
  applied events ≤ 30.
- UI verified in the browser pane against prod data (read-only).

## 9. Doc note → section map

| Doc item | Section |
|----------|---------|
| Site impact (A) | P4 §7 |
| Feed impact (B) | Deferred (D1), maturity §5.4 |
| Red → task (C) | §5.6 |
| 1, 3 | §4.1 |
| 2 | §4.2 |
| 4 | §6 |
| 5 | already done (comparison sheet) |
| 6 | §5.2-5.4 |
| 7 | §3 |
| 8 | §3.3 |
| 9 | §5.5 |
| 10, 11, 12, 14 | §4.3 |
| 13 | already done (ISSTA button hidden + server refusal; catalog kept 14 days) |
