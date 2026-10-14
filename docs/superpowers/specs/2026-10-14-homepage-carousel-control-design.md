# Homepage carousel control - every row, every card, in place

Date: 2026-10-14. Asked by Dor: "full control over every carousel of the Mega Events homepage,
even what comes in automatically - decide the order, faster and easier; see everything the site
shows and edit each carousel". Most important to him: **moving events inside a carousel.**

Builds on `2026-09-16-homepage-layout-design.md` (sections + pins) and
`2026-09-18-homepage-blocks-design.md` (titles + blocks).

## What was wrong

- The `/homepage` board showed the site's automatic cards for two rows only ("המבוקשים",
  "החדשים") and even there as an approximation: the site collapses several dates of one artist /
  home team into one card, fills "המבוקשים" past the Prioritized events, drops sold-out and VIP
  events. Hero, football, artists and event sliders showed a line of text instead of their cards.
- "אירועים נוספים" and "לקוחות משתפים" had no item control at all (position + hide the section).
- The only way to move an automatic card was Pin, and Pin threw it to the FRONT of the row.
- "Remove from this row" existed in "החדשים" only.
- Drag was native HTML5: no touch, no keyboard, jumpy.

Dor's pains, all four: cannot see what is on the site, adding is awkward, dragging is awkward,
not sure what Save will do.

## Decisions (Dor, 14.10)

1. **Pin in place.** Any card - automatic or pinned - can be dragged to any position and stays
   there. The automatic rule fills every other position around it; a new event still enters by
   itself.
2. **Per row:** pin in place, hide from this row, how many items the row shows. No change to the
   automatic rules themselves.
3. **"אירועים נוספים" and "לקוחות משתפים" get the same control.**
4. **Hybrid source of truth (approach C):** the SITE computes each row's automatic pool (in its own
   order, with its own grouping and filters) and serves it; the MERGE of pins / hidden / count /
   cross-row exclusion is one pure function, the same file verbatim in both repos. Dragging on the
   board is instant and shows exactly what the site will show.

## 1. The rule

**Stored (no new table):**

- `homepage_items.position` = the item's **absolute slot** in its row (0 = first). Pins saved so
  far are 0..n-1, so nothing changes on the site when this ships.
- `homepage_items.kind` gains `review` (ref_id = `google_reviews.review_key`). Migration widens the
  CHECK; main never writes this table, so the CHECK stays.
- `homepage_sections.config` of every builtin and every event slider may carry:
  - `hidden`: `"<kind>:<ref_id>"` strings - cards removed from THIS row (e.g. `"event:812"`,
    `"team:liverpool"`, `"review:ChZD..."`). A pin beats it (pinning un-hides).
  - `max_items`: how many cards the row shows. Absent = the row's default (event rows and
    sliders 12; hero, football, artists, reviews, "אירועים נוספים" all).
  - the old `newest.hidden_event_ids` is read as `hidden` too (main reads both); the migration
    copies it into `hidden`, the board writes only `hidden`.

**Merge** (`lib/homepage/merge.ts`, byte-identical in both repos, pure, tested on both sides):

```
mergeRow(pool, pins, { hidden, max, exclude, showable }) ->
  1. auto = pool minus pinned refs, hidden refs, refs excluded by the row above
  2. live pins = pins whose card can be shown (exists, not sold out, ...), by slot
  3. walk positions 0..max-1: a live pin whose slot <= the position takes it,
     otherwise the next auto card; when auto runs out the remaining pins close up
  -> [{ ref, pinned, slot? }] + the dead pins (pinned but not showable) for the board
```

`planHomepage(layout, pools, showable)` runs every row in the site's dependency order:
"המבוקשים" -> "החדשים" (minus what "המבוקשים" shows) -> "אירועים נוספים" (minus both). Sliders,
hero, football, artists and reviews stand alone - exactly today's dependencies.

**Behaviour changes, accepted:**

- Grouping (one card per artist / home team) happens on the POOL, before pins and the row above
  are taken out. So a pinned "Bon Jovi London" no longer has "Bon Jovi Paris" beside it, and an
  artist "המבוקשים" shows does not reappear in "החדשים" under another date.
- Hero: the auto ring interleaves artist / team over ALL available entries, then the pins are
  placed - the auto order after a pin may shift by one compared with before.
- Football / artists: a pinned entry takes its slot even if it is not on sale (before: pins only
  ordered inside the "available" and "not available" groups).

## 2. Site side (myt-main)

- `lib/homepage/grouping.ts`: `artistIdForEvent`, `findEventHomeTeam`, `wholeWordMatch`,
  `collapseByPage` - moved verbatim out of `ClientSideHomepage` (EventCard still uses them).
- `lib/homepage/rows.ts` (server-safe, pure): `buildPools(...)` = today's rules, one list of refs
  per row in the site's order, plus `cardsFor(...)` = what the board draws for a ref.
- `lib/homepage/merge.ts`: the shared merge.
- `app/page.tsx` builds the pools and runs `planHomepage` on the server; `ClientSideHomepage`
  receives ids per row (`rows`) and maps them to the events it already has - its row logic goes.
  Hero / football / artists / reviews arrive already ordered.
- `lib/homepageLayout.ts`: sections carry `hidden` + `maxItems`, pins carry their `slot`, kind
  `review` is accepted.
- `GET /api/homepage-pools?categories=1,2` - header `x-hotel-secret` =
  `NEXT_SECRET_REVALIDATION_SECRET` (same as `/api/hotels-warm`): `{ pools, sliderPools, cards }`
  from the same cached loaders the homepage uses. A card carries the image the SITE draws (the
  fallback-enriched art / crest), name, date + place, sold-out / available flags.

## 3. The board (`/homepage`)

- Every row is drawn from the merge: numbered cards, pinned ones with a pin badge, automatic ones
  plain - what you see is what the site will show, live as you edit (cross-row exclusion too).
- **Move:** drag any card to any position (`@dnd-kit`, mouse + touch + keyboard), or the arrows on
  the card, or click its number and type a new one. A moved card becomes pinned at its new
  position and every pinned card keeps its visible position - so the row after a drop is exactly
  the row you dropped.
- **Unpin** (back to the rule), **Hide from this row** (chips under the row restore), "המבוקשים"
  keeps "remove Prioritized" (immediate, as before).
- **Add:** a search box over every candidate (events, artists, teams, reviews), with pictures; the
  pick is pinned at the chosen position (default 1).
- **How many:** a number per row.
- **Unsaved changes:** a "changed" tag per row, Save bar counts them, Discard restores. After Save:
  "saved - the site refreshes now" + a link to the site.
- If the site's pools cannot be read: a red banner, the rows show the pinned cards only, Save still
  works.

## 4. Order of release

1. **myt-main** (reads old + new, serves the API) - deploy and check the homepage is unchanged
   apart from the accepted changes above.
2. **myt-backoffice**: migration (`review` kind + `hidden` copy) + the new board.

## 5. Tests

- `merge` cases (pins in place, dead pins, run-out close-up, hidden vs pin, max, exclusion chain)
  in main's vitest and the backoffice selftest (`scripts/homepage-merge-selftest.ts`); the two
  files are diffed before commit.
- `normalizeSections` / item slots / builtin configs in `scripts/homepage-blocks-selftest.ts`.
- Rendered check: prod homepage HTML (old) vs the new code locally against the same database -
  card ids per row equal except the accepted changes.
