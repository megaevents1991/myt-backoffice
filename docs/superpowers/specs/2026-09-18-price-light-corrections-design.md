# Price light - staff corrections in the detailed comparison

**Date:** 2026-09-18 · **Owner:** Dor · **Status:** built on master (commit `1914496` + follow-ups), migration `20260918100000`.

## The ask

Dor, after the 17.09 check of `/price-light`: *"אפשר להוסיף גם בהשוואה מפורטת עריכה של כל מיני שדות
שיש שם, ה-AI ידע ללמוד. למשל מחיר שדוגם היה נמוך מוגזם, ושאני אוכל לערוך וה-AI ילמד מזה. גם טיסות,
מלון וסוג כרטיס - אני אוכל לערוך עם הערה ל-AI."*

Two decisions he made (18.09):

1. A correction **changes the light immediately** - it is not just feedback.
2. A price / contents correction belongs to the **listing** (every event matched to it);
   "this is not our event" belongs to the **(event, listing) pair** only.

## What "the AI learns" means here - and what it does not

The judge (agent #1) is not trained. Its memory is a block of recorded staff decisions quoted into
its prompt: ten lessons, 200 characters each, round-robin across its sources
(`lib/agents/memory.ts`). Most wrong values in the comparison are not the AI's at all - they come
from a site's **parser**, which is plain code. So one correction does three separate jobs:

| Job | Mechanism |
| --- | --- |
| Fix this row, now | overlay row -> `matchEvent` re-runs -> `recomputeEventLights` |
| Teach the agent | audit `price_light.corrected` -> a lesson **only** when the value was the agent's own (`source: "ai"`) or the field is `not_same_event` (its other job) |
| Expose parser bugs | count per competitor + field, last 30 days, on the competitors strip ("✎ N", breakdown in the tooltip) |

An AI-sourced correction also counts as a `reviewedBad` in the agent's maturity (`lib/agents/maturity.ts`).

## Data

`competitor_listing_corrections` (backoffice-only, RLS on, no policies):
`listing_id` (FK, cascade) · `event_id` (only for `not_same_event`) · `competitor` · `field` ·
`original` jsonb · `value` jsonb · `reason` · `note` · `source` · `created_by/at` · `revoked_at/by`.
Partial unique index: one un-revoked row per (listing, field, event).

**Never a write to `competitor_listings`** - the next crawl overwrites that row.

Fields: `price` (`{amount, currency}`), `not_same_event`, the six `ExtractedAttrs`
(`nights, hotel_stars, breakfast, bag_included, direct_flight, transfers`; `null` = "unknown",
which takes the adjustment out of the comparison), and three display texts
(`airline, hotel_name, ticket`).

Reasons (structured, because a label can be counted and a free sentence cannot):
`wrong_listing · partial_price · parser_misread · outdated · ai_wrong · other`. The note is mandatory (3-400).

## Rules (`lib/services/price-light-corrections.ts`, pure, selftested)

- **Precedence per field: staff > page > AI.**
- **Live** = not revoked AND the crawled value still equals `original`. When the source changes,
  the market moved and the correction is stale (same idea as the override's `OVERRIDE_DRIFT_USD`).
  Should the old value return (a parser that keeps misreading the page) it is live again.
  Liveness is computed on read - nothing writes an expiry.
- `original` for an attribute is the **page's** value (`listing.attrs`), never the AI's: staleness is
  about the source page. `source` separately records who produced what staff saw.
- `correctCandidates` runs in `matchEvent` **before anything is decided**: a `not_same_event`
  listing is no candidate for that event (and still one for every other event); a corrected price is
  the price the rule, the judge and `normalize` see - so a quote-only listing can be given the
  price staff got by phone. Attribute fixes are applied after the page/AI merge.
- A cache hit now reuses `ai_verdict.attrs`, not the row's merged `attrs` - otherwise a revoked
  correction would live on inside "the AI's answer" whenever the page has no value of its own.
- Saving a field back to what the crawl says **revokes** the correction instead of stacking one.

## Flow

`saveListingCorrections({ eventId, listingId, changes, reason, note })` (admin):
validate -> work out `original` / `source` / `from` server-side (the client sends only new values)
-> one overlay row + one audit row per changed field -> re-match this event rule-only (`judge: null`;
staff just supplied the answer) and up to 5 other events resting on the same listing, the rest at
the nightly -> invalidate `rows` + `runs` -> return the fresh comparison and the fresh table row,
which the screen patches in place. `revokeListingCorrection` is the mirror image.

UI: a pencil on every competitor row of the sheet -> `correction-dialog.tsx` (RTL). The dialog
opens on the **effective** values, sends only what changed, lists the live corrections with
"בטל". A corrected row carries "✎ תוקן ידנית · <fields>". A `not_same_event` mark is loaded by
event (`loadPairCorrections`) because its listing is no longer matched - without that it could
never be undone. **Our own side is not editable**: it is the pricing rule's answer
("פרט את שלנו עכשיו" refreshes it). Nothing here writes one of our prices.

## Operational notes

- The store reads the whole un-revoked table once per 20 s per instance (`matchEvent` asks ~2,000
  times a nightly pass; the table is a handful of rows). A write drops the cache in its own process.
- A missing table (code deployed before the migration applied) reads as "no corrections" and is
  logged once; any other read failure **throws** - matching without corrections would flip a fixed
  light back and rewrite the match row with the wrong value.
- `price_light.*` audit rows are exempt from the 30-day audit purge and kept 180 days.

## Not built (deliberately)

- No notification when a correction goes stale - the crawled value simply shows again.
- No correction of our own side, and no price write of any kind.
- Text corrections do not feed the light (they are display only); the attributes beside them do.
- Note 6 of the staff doc ("AI suggests moving the event's days / another ticket supplier") is the
  price advisor's territory (agent #2), not this feature.
