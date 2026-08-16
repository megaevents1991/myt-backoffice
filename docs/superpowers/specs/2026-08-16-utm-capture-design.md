# UTM Capture — Design Spec

**Date:** 2026-08-16
**Scope:** cross-project — capture in `myt-main`, schema + display in `myt-backoffice`
**Status:** approved by Dor (brainstorming session 2026-08-16)

## Purpose

On page load in the main app, capture campaign UTM parameters from the URL into a
first-party cookie so attribution survives the session and later visits (90 days).
Influencer (partner) attribution is protected from being overwritten by paid-campaign
UTMs. Keep a short history of attribution touches. At checkout, persist the whole
picture onto the reservation so the backoffice can display it and analysts can query it.

## Background — current state

- `app/hooks/Affiliate.tsx` (main) reads `utm_source`/`aff` from the URL and stores
  `{userId, affiliateId}` in **localStorage** (`mytData`). No expiry, no history,
  server cannot read it.
- **Known bug this design fixes:** `Affiliate.tsx` adopts ANY new `utm_source`, so a
  customer sent by an influencer who later clicks a Google ad (`utm_source=google`)
  gets their `affiliateId` overwritten — the reservation's
  `aff_partner_tracking_code` becomes `"google"` and the influencer loses credit.
- Reservations carry only `aff_partner_tracking_code` (single string). No campaign
  UTMs are stored anywhere.
- "Influencer" = a `partners` row with `type` in (`agent`, `affiliate`) and a
  `partner_tracking_code`. Partner links today are `?utm_source={code}`.

## Decisions made (with reasons)

| Decision | Choice | Why |
|---|---|---|
| Capture mechanism | **Next.js middleware, server-set cookie** | Safari/iOS ITP caps JS-set cookies at ~7 days; server-set HTTP cookies get the full 90. Also fires before render, no JS needed, no race with checkout. |
| Params captured | 5 UTMs + `gclid` + `fbclid` | Click IDs are required later for Google/Meta conversion feedback — free to store now. |
| History | In-cookie, capped at last 5 touches | Fits the 4KB cookie limit; no extra infra; whole list attaches to the reservation at checkout. |
| DB storage | Normalized `utm_touches` table (not jsonb) | Next step is campaign/affiliate analytics — rows per touch make `group by` trivial. |
| Influencer identification | **Both**: link marker `utm_medium=influencer` (fast path) + partners-table lookup fallback | Marker needs no lookup but old links in the wild lack it; lookup covers those. |
| Old localStorage mechanism | **Surgical fix** | Keep the stage-events mechanism; at checkout derive `aff_partner_tracking_code` from the cookie's influencer-protected primary. Small blast radius, kills the credit-stealing bug. |
| Campaign touch while influencer protected | Recorded in **history**, primary unchanged | Attribution stays with the influencer; analysts still see the assisting campaign. |
| Influencer vs influencer | **New influencer wins** (old one → history) | Standard last-touch between peers. |

## 1. Cookie — `myt_utm`

One first-party cookie, JSON value, short keys to respect the 4KB budget:

```json
{
  "v": 1,
  "p": { "s": "dani_promo", "m": "influencer", "c": null, "t": null, "ct": null,
          "g": null, "f": null, "inf": true, "at": "2026-08-16T10:00:00Z" },
  "h": [ { "s": "google", "m": "cpc", "c": "summer_f1", "t": null, "ct": null,
           "g": "abc123", "f": null, "inf": false, "at": "2026-08-10T09:00:00Z" } ]
}
```

- `p` = primary touch (current attribution), `h` = history, newest first, **cap 5**.
- Key map: `s/m/c/t/ct` = utm_source/medium/campaign/term/content; `g` = gclid;
  `f` = fbclid; `inf` = influencer flag; `at` = ISO timestamp of the touch.
- Attributes: `Max-Age` = 90 days (rolling — refreshed on every capture write),
  `Path=/`, `SameSite=Lax`, `Secure`, `httpOnly: false` (client JS may read it for
  stage events).
- Malformed/unparseable cookie → treat as absent, write fresh.
- Serialized value too large → drop oldest history entries until it fits.

## 2. Capture flow (middleware in `myt-main`)

`middleware.ts` already runs on every page request. New logic, in order:

1. Parse `utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid`
   from the request URL. A touch "exists" if at least one of the seven is present —
   a bare `gclid`/`fbclid` with no `utm_*` (Google auto-tagging) still counts and
   creates a touch with `s: null`.
2. **No touch in URL → do nothing.** Cookie untouched (matches the flowchart: both
   "keep the cookie" and "keep it empty" are no-ops).
3. Touch present:
   - **Identical param set to current primary** → refresh cookie expiry only. No
     history entry (prevents spam while the user navigates with UTMs still in the URL).
   - **No cookie** → classify → new touch becomes primary.
   - **Current primary has `inf: true` AND new touch is not influencer** → primary
     unchanged; new touch is prepended to history.
   - **Otherwise** (incl. new influencer over old influencer) → current primary is
     prepended to history; new touch becomes primary.
4. Set the cookie on the response with refreshed 90-day Max-Age.

**Classification** (`inf` flag), evaluated when a new touch arrives:

1. Fast path: `utm_medium=influencer` → `inf: true`, no lookup.
2. Fallback: Supabase lookup `partners.partner_tracking_code = utm_source` with
   `type` in (`agent`, `affiliate`) → `inf: true`. Indexed single-row read; runs
   only for new sources without the marker (landing clicks, not every page).
3. Lookup failure → fall back to the marker check alone, log the error, never block
   or delay the page beyond the failed call.

**Pure core:** the decision logic lives in `lib/utm.ts` as
`applyUtmCapture(existingCookie, params, classify)` returning the next cookie value
(or "no write"). Middleware is a thin adapter. Pure function = unit-testable.

Static assets / `_next` / API routes are already excluded by the middleware matcher;
capture applies to page routes only.

## 3. Checkout attach (`myt-main`, confirm-order)

- The confirm-order server route reads `myt_utm` directly from request cookies
  (server-set, server-read — the client payload doesn't change).
- Inserts one `utm_touches` row per touch: primary at `position 0`, history at 1..n.
- **Surgical fix:** `aff_partner_tracking_code` on the reservation =
  - cookie primary's `s` when primary has `inf: true`;
  - otherwise the legacy client-sent value (unchanged behavior).
- No cookie → zero touch rows; reservation insert proceeds exactly as today.
- Touch insert failure must not fail the booking: log, continue.

## 4. Database — `utm_touches` (migration in backoffice repo, which owns the schema)

```sql
create table if not exists utm_touches (
  id bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id),
  position smallint not null,          -- 0 = primary (attribution), 1..n = history
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  fbclid text,
  is_influencer boolean not null default false,
  visited_at timestamptz,              -- when the touch happened (from cookie)
  created_at timestamptz not null default now()
);
create index if not exists utm_touches_reservation_idx on utm_touches (reservation_id);
create index if not exists utm_touches_source_idx on utm_touches (utm_source);
create index if not exists utm_touches_campaign_idx on utm_touches (utm_campaign);
```

- Written by main (service-role, server-side) at confirm-order; read by backoffice.
- Analytics-ready: bookings by source/campaign, first-touch vs last-touch,
  influencer-assisted conversions — plain SQL `group by`.
- Migration workflow per `.claude/rules/migrations.md` (merge master first,
  `npm run db:new`, apply from master only, then `npm run db:types`).

## 5. Backoffice display

Reservation detail page → new "מקור הגעה" (Attribution) section:

- Primary badge: `utm_source / utm_medium / utm_campaign`, with a distinct
  influencer marker when `is_influencer`.
- History list beneath: each touch with source/medium/campaign and relative time
  ("3 days before booking").
- Reservations with no touches → section hidden entirely.
- Data via a server action joining `utm_touches` by `reservation_id`.

## 6. Cross-project sync checklist

- New shared type `UtmTouch` in backoffice `types/utm.types.ts`; main carries the
  insert-side subset `UtmTouchInsert` in `lib/utm.ts` (main never reads rows back).
  **Intentional diff** — the two are cross-referenced in comments; keep in sync.
- `npm run db:types` after the migration lands.
- Portal/backoffice link builders (tracking links, prepared-package links) append
  `utm_medium=influencer` to generated partner links.
- Main's confirm-order contract otherwise unchanged.

## Error handling summary

| Failure | Behavior |
|---|---|
| Corrupt cookie JSON | Treat as absent; write fresh on next capture |
| Cookie > 4KB | Trim oldest history entries until it fits |
| Partner lookup error in middleware | `inf` from marker only; log; page proceeds |
| `utm_touches` insert error at checkout | Log; booking proceeds |

## Testing

- Unit-test `applyUtmCapture` (pure): no-UTM no-op, first capture, identical-set
  refresh, campaign-over-influencer protection, influencer-over-influencer override,
  history cap + trim, corrupt-cookie recovery.
- Manual E2E: land with `?utm_source=google&utm_campaign=x` → cookie set (DevTools);
  revisit clean URL → cookie unchanged; land with influencer link → `inf: true`;
  then campaign link → primary unchanged, history grows; book → `utm_touches` rows
  appear; backoffice reservation shows the attribution section.

## Rollout — staged, fail-open

Two danger zones: middleware (runs on every page — an uncaught throw is a site-wide
500) and confirm-order (touches real bookings). Both must **fail open**:

- Middleware capture wrapped entirely in try/catch → any error returns
  `NextResponse.next()` (page behaves as if the feature doesn't exist). Partner
  lookup gets a hard timeout (~400ms, AbortSignal) → on timeout, classify by the
  `utm_medium=influencer` marker alone.
- Confirm-order: `aff_partner_tracking_code` derivation wrapped → any error falls
  back to the legacy client-sent value (today's behavior). Touch-insert failure
  logs and the booking proceeds.
- **Cache rule:** a response that sets `myt_utm` must be `Cache-Control: private,
  no-store` (never publicly cache a Set-Cookie response). Only UTM landings are
  affected; normal pages keep the existing caching.

Deploy in four independently-safe stages, verifying each before the next:

| Stage | Deploy | Risk | Gate to next stage |
|---|---|---|---|
| 1 | `utm_touches` migration + `db:types` (backoffice) | None — inert table | Table exists, types regenerated |
| 2 | Main: middleware capture only | Fail-open | 2-3 days of checks below |
| 3 | Main: checkout attach + surgical fix | Guarded fallback | Real-booking checks below |
| 4 | Backoffice attribution section | Read-only UI | — |

**Stage 2 verification (prod):**

- Land with `?utm_source=test_deploy&utm_medium=cpc` → DevTools shows `myt_utm`,
  ~90-day expiry. Clean-URL revisit → cookie unchanged.
- Influencer link → `inf: true`; then a campaign link → primary unchanged, history grows.
- **iPhone Safari explicitly** (the browser the middleware choice exists for).
- Vercel logs: zero middleware errors; TTFB unchanged on CLEAN landings (no UTM).
  UTM landings with a non-partner source (google/facebook) legitimately pay the
  partner lookup — bounded at +400ms worst case by the abort timeout; expected.
- UTM-landing response headers: `private, no-store`; normal pages still cached.

**Stage 3 verification (prod):**

- Booking with cookie → `utm_touches` rows present, position 0 = primary.
- Incognito/direct booking (no cookie) → books fine, zero rows.
- Influencer-attributed booking → `aff_partner_tracking_code` = influencer code.
- Mixpanel checkout conversion flat vs the prior week.

## Out of scope (explicit)

- Replacing the localStorage stage-events mechanism (`mytData`) — future unification.
- Google/Meta conversion API feedback (click IDs are stored to enable it later).
- Analytics dashboards over `utm_touches` — separate follow-up feature.
- Cookie-consent banner work.
