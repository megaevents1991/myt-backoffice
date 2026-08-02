# Agent/Affiliate Area Returns to the Backoffice — Design

**Date:** 2026-08-02 · **Branch:** `feat/agent-influencer-area` (backoffice) · **Counterpart:** `feat/agent-area` (myt-main, stays as-is)

## Decision

The partner self-service area lives in the **backoffice** at `/portal`, not in myt-main's `/agent`.
myt-main is for customers; carrying the agent area there bloats and slows it. The `/agent` area
built on main's `feat/agent-area` branch is **left in place but deprecated** (CLAUDE.md note there),
because three of its pieces are genuinely customer-facing and STAY in main:

1. `app/api/package/[id]` — customers open shared package links; main re-validates and prices live.
2. `confirm-order` settlement (`partner_settlement_method`, `agent_card_discount_ils`, voucher flow) —
   runs inside the customer checkout.
3. `utm_source` affiliate tracking + funnel writes.

Everything self-service (dashboard, links, credit, coupons, reservations, quotes, **package building**)
is served by the backoffice portal.

## What already exists

Retirement (`31014c7`) was middleware-only — every portal page and action survived intact.
The backoffice portal already has: dashboard (`getPortalDashboard`), links + logo, credit +
convert-to-coupon, coupons, reservations + open holds, quotes (with PDF via Playwright — better than
main's print-page). Auth is the shared cookie session (`lib/auth/session.ts`, roles `agent`/`affiliate`,
`requirePartner()` guards).

## New work

### 1. Migration hygiene (Stage 0)

- `20260729200000_partner_credit_usage.sql` collides with master's
  `20260729200000_one_category_table.sql` (same 14-digit version). The credit_usage SQL was applied
  to prod under that version on 2026-07-30 (run 30519819981). File is fully idempotent →
  **renumber to `20260802100000`**; it re-applies as a no-op and the old remote version stays
  matched by master's one_category_table file.
- `20260730100000_prepared_packages.sql` was **never applied** (edited in place 2026-07-30 13:02,
  no successful push since; today's master run applied only `20260802090000`). Unapplied → rename is
  safe: **renumber to `20260802110000`** so it lands after everything applied.
- Apply via the "Apply DB Migrations" workflow (Dor authorized running it); files ride to master
  with the PR merge.

### 2. Un-retire the portal (Stage A)

- `middleware.ts`: partner-role home is `/portal` again; partners are confined to `/portal*`;
  staff may enter `/portal` to debug. Drop `mainAgentUrl()`.
- `app/page.tsx`: role-aware redirect (partner → `/portal`, staff → `/dashboard`) to kill the
  `/` → `/dashboard` → `/portal` ping-pong. `app/api/auth/callback` already points partners at
  `/portal` — becomes correct again untouched.
- CLAUDE.md: replace the RETIRED banner with the new state.

### 3. Live-link builder (Stage B) — the flagship flow

Agents/influencers assemble a concrete package **from backoffice data** and get a shareable link
that lands the customer on main's order page with everything pre-selected.

- **Data**: `events` (active, future, not deleted), each event's ticket categories, offline
  `flights` linked to the event, `offline_hotels`. No Amadeus/Ratehawk calls in v1 — the "live"
  option simply leaves flight/hotel unset so main sends the customer to pick them live
  (main's `flight_needs_repick` / `hotel_needs_repick` behavior, already shipped).
- **Wizard** at `/portal/packages/new`: event (searchable) → tickets (category + qty 1–8) →
  flight (offline option / customer-picks-live / no-flight) → hotel (same three) → review + create.
- **Action** `lib/actions/portal-package-actions.ts`:
  - `createPreparedPackage` — `requirePartner()`; re-reads event/flight/hotel rows server-side
    (client sends ids only); snapshots JSON in the exact shapes main round-trips
    (`event_order_info` = flattened ticket object with `price_per_ticket`, `total_tickets_price`,
    `vendor`; `flight_order_info` = `Flight`; `hotel_order_info` = `OrderHotel`) — mirroring
    main's `lib/agent-package-actions.ts` writer; `share_token = crypto.randomUUID()`.
  - `getMyPreparedPackages` / `deletePreparedPackage` (hard delete is fine — a link is not an
    event; deleting only invalidates the link, main 404→fresh-flow).
- **Link**: `lib/site.ts` `partnerLink(code, eventId, shareToken)` →
  `${PUBLIC_SITE_URL}/order/{eventId}?utm_source={code}&pkg={share_token}` — identical to what
  main's agent area generates today, so zero changes needed in main.
- **List** at `/portal/packages`: existing links with event name, contents summary, copy button,
  delete. Nav gets a "החבילות שלי" item (both roles — main gated link-creation to both).

Package *search* needs no separate page: per-event deep links already exist in `/portal/links`,
and the wizard's event picker is the search.

### 4. Restyle (Stage C) — main's brand, portal-scoped

The portal must feel like the partner-facing product, not the grayscale admin. Brand tokens lifted
from main's `globals.css`:

- **Forest** `#0A1A14` (hsl 158 44% 7%) — headers, primary pills, active nav.
- **Glow mint** `#5BFF95` (hsl 141 100% 68%) — CTAs (with forest text — 14.6:1 contrast), funnel
  bars, accents. Never mint text on white.
- Accents: aqua `#45E2FF`, violet `#BBA1FF`, coral `#FF4F61` (destructive), gold `#FACC15` (warn).
- Background off-white `#FAFAF5`; cards white, `rounded-2xl`, soft `shadow-card`.
- **Fonts**: Assistant (body) + Rubik (display), `next/font/google` with `hebrew` subset, loaded in
  the portal layout only.
- Scoping: a `portal-theme` wrapper class in `globals.css` overrides the shadcn HSL tokens
  (`--primary`, `--ring`, `--background`…) for the portal subtree only — dashboard untouched,
  shadcn primitives keep working and pick up the brand automatically. Light mode only (like main's
  agent area). RTL preserved.
- Page-level patterns from main's agent area: stat tiles (`text-xs` label / `text-xl font-bold`
  value), forest hero header band with partner logo + role label, mint-on-forest funnel, badge
  system (green/amber/gray/red rounded-full), dashed empty states.

### 5. myt-main deprecation note (Stage D)

CLAUDE.md on `feat/agent-area`: `/agent/*`, `lib/agent-*-actions`, `lib/partner-auth` are
deprecated — remove in the future; do not build on them. Keep the three customer-facing pieces
(§Decision). No code changes.

## Round 2 additions (same day) — full parity with main's agent area

- **Site price + sold-out in the builder** — `lib/package-price.ts` gained an
  optional specific-ticket price param plus `hasAvailableTickets`/`isEventSoldOut`
  (mirroring main's `lib/events/price.ts`, incl. a lite locked-flight check
  against `flights` remaining). Builder event cards show the per-traveler site
  price or "אזל"; ticket cards show the per-category site price; review shows
  the estimated site total.
- **Live search in the wizard** — two `requirePartner` server actions call
  myt-main's own customer APIs server-side (base `NEXT_SECRET_HOTEL_SERVICE_URL`):
  `searchLiveFlights` → `POST /api/flights/search?eventId=` (Amadeus + offline
  merged; offers stored verbatim as `flight_order_info`, main's own shape) and
  `searchLiveHotels` → `POST /api/hotels` + `POST /api/hotels-info` (Ratehawk;
  the action assembles ready OrderHotel snapshots the way main's HotelSelection
  does). `createPreparedPackage` gained `live-offer` modes with main's exact
  trust model: live offers trusted (no ground truth short of re-search,
  confirm-order's floor is the backstop), offline-sourced offers floored
  against `offlineRawPrice`. Locked-flight events skip live flight search
  (locked sells exactly one flight).
- **Clicked-events cross-ref**: already ported in round 1 — verified identical.
- **Visual polish**: aurora-glow forest hero, mint CTAs with glow, card shadow
  scale (`shadow-card`/`card-hover`), segmented wizard progress bar.
- **Nothing in main was deleted** — its `/agent` area stays deprecated-but-alive.

## Error handling

- All new actions: `requirePartner()` first line, `{ data, error }` checks, explicit column
  selects/inserts (no spreads), server-side re-derivation of every price.
- Builder validates: event exists + future + not deleted; qty 1–8; offline flight/hotel rows still
  have inventory at snapshot time (best-effort — main re-validates live on open anyway).

## Testing

No test suite exists (repo convention). Gate = `npm run build`, `npm run lint`,
`npx tsc --noEmit`, plus manual dev-server walk of the portal.

## Cross-project impact

- No shared-type edits (`app.types.ts` untouched both sides) → no `/sync-types` needed.
- No main-app code changes beyond a CLAUDE.md note.
- DB: renames only affect files; schema change = prepared_packages table creation (idempotent),
  already expected by main's deployed(?) `/api/package/[id]`.
