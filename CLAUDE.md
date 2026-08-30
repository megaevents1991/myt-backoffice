# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **✅ Partner self-service portal is BACK HOME here (2026-08-02).**
> The 2026-07-30 move of `app/portal/*` to main's `/agent` was reversed: main is
> for customers only, and the partner (`agent`/`affiliate`) self-service lives in
> this backoffice at `/portal` - dashboard, links, credit, coupons, reservations,
> quotes, and the **prepared-package live-link builder** (`/portal/packages`,
> `lib/actions/portal-package-actions.ts`, table `prepared_packages`). A package
> link is `{main}/order/{eventId}?utm_source={code}&pkg={share_token}`; myt-main
> consumes it via `app/api/package/[id]` (that route, the checkout settlement
> logic and `utm_source` tracking are customer-facing and STAY in main). Main's
> `feat/agent-area` branch's `/agent` area is **deprecated** - do not build on
> it; it is slated for removal. Staff-facing `/partners/[code]/view` remains
> here, unchanged. The portal is styled with the main app's brand (forest
> `#0A1A14` / mint `#5BFF95`, Assistant+Rubik) via the `portal-theme` scope in
> `app/globals.css` - the admin dashboard look is untouched.

> **✅ Contentful → Supabase CMS migration COMPLETE (2026-07-22).**
> This backoffice owns the CMS under **Templates** (תבניות): per-type
> Supabase tables (`categories`, `artists`, `football_teams`, `blog_posts`)
> sharing a CRUD factory (`lib/actions/template-crud.ts`). The main app reads
> these tables directly - the Contentful fallback and SDK were removed from
> both repos (Phase 3 done). Contentful is fully retired.

> **🔒 TODO - SECURITY HARDENING (deferred, do carefully later).**
> Branch `fix/security-hardening` added signed admin session (`lib/auth/`), cron/route
> guards, storage path checks, and guarded the exchange-rate + reservations-series
> routes. **Still open - fix carefully later:**
>
> - **User management.** Admins share ONE hardcoded env credential
>   (`NEXT_SECRET_ADMIN_EMAIL`/`_PASSWORD`, checked in `lib/actions/auth-actions.ts`);
>   no per-person accounts, roles, or audit. Two overlapping session systems
>   (`lib/auth/session.ts` HMAC vs `auth-actions.ts` Supabase-session cookie) - consolidate.
>   Plan: unify on Supabase Auth + roles table. See Claude memory `auth-user-management-todo`.
> - **Mass-assignment.** Several actions spread whole client objects into price/commission
>   columns (`event-actions.ts`, `offline-flight-actions.ts`, `partner-actions.ts`) - map
>   columns explicitly + validate prices/commission are positive finite (pattern:
>   `offline-hotel-room-actions.ts` `replaceOfflineHotelRooms`).
> - **Unauth resource-abuse proxies** (`validate-airline` headless Chromium, `flights/search`
>   Amadeus prod, `*/tickets`, `competitor-pricing`) - add auth or shared-secret + rate limit.
> - **Secret in URL** on `hotels/search` - move to a header + rotate (cross-project with main).

## Always-on rules (auto-loaded)

Tech standards:
@.claude/rules/standards/typescript.md
@.claude/rules/standards/react.md
@.claude/rules/standards/nextjs.md
@.claude/rules/standards/supabase.md

MYT domain rules:
@.claude/rules/pricing.md
@.claude/rules/data-model.md
@.claude/rules/migrations.md
@.claude/rules/cross-project.md
@.claude/rules/conventions.md

> **⚠ IMPORTANT: This project is part of a two-project platform.**
> The sibling project `../myt-main` is the customer-facing booking app that reads the data this backoffice manages.
> See `../CLAUDE.md` for the full system architecture and shared database schema.
> **Any change to events, types, database tables, or price logic may require changes in the main app too.**

## Commands

```bash
npm run dev       # Start dev server (Next.js)
npm run build     # Build for production
npm run start     # Start production server
npm run lint      # Run ESLint
```

No test suite exists. TypeScript and ESLint errors are intentionally ignored during build (`next.config.mjs`).

## Architecture

**Next.js 15 App Router** backoffice for MYT (MegaEvent). Single admin user. Deployed on Vercel.

### Directory Layout

- `app/(dashboard)/` - protected dashboard pages (route group)
- `app/api/` - API routes: `cron/`, `sports-events/`, `live-events/`, `flights/`, `hotels/`, `tixstock/`, etc.
- `lib/actions/` - Next.js Server Actions, one file per domain (e.g. `event-actions.ts`, `reservation-actions.ts`)
- `lib/services/` - sync logic that external cron routes call (sports, live events, tixstock, ticket prices)
- `types/` - shared TypeScript types per domain (`app.types.ts`, `reservation.types.ts`, etc.)
- `components/` - shared UI components + `ui/` (shadcn/Radix-based)
- `contexts/auth-context.tsx` - React context wrapping client-side auth state

### Auth

Cookie-based, **not** Supabase SSR sessions. Middleware (`middleware.ts`) checks for a `session` cookie. Login validates against `NEXT_SECRET_ADMIN_EMAIL` / `NEXT_SECRET_ADMIN_PASSWORD` env vars, then calls Supabase `signInWithPassword` and stores the session JSON in an httpOnly cookie.

Two Supabase clients:

- `lib/supabase-server.ts` - uses `NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY` (server-side, bypasses RLS)
- `lib/supabase-client.ts` - uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client-side)

### Data Model

Multiple event source tables in Supabase:

| Table                                              | Source          | Prefix  |
| -------------------------------------------------- | --------------- | ------- |
| `xs2e_events` / `xs2e_tournaments` / `xs2e_sports` | Sports data API | `xs2e_` |
| `live_events`                                      | LIVE API        | -       |
| `p1_events`                                        | P1 Tickets XML  | -       |
| `tixstock_events`                                  | TixStock API    | -       |
| `locations`                                        | Manual          | -       |

Core `Event` type (from Supabase `events` table, not the external sources above) has `type: EventType` which is one of: `sports_event`, `music_event`, `sports_event_dynamic`, `sports_live_event_dynamic`, `music_live_event_dynamic`, `tx_event`.

Ticket prices (from sports events) are stored in **cents** - divide by 100. Use `getTicketNetPriceEUR` / `getTicketFaceValueEUR` from `lib/utils.ts`.

### Dynamic Forms (טפסים)

Google-Forms-style bilingual questionnaires built in `/forms`, filled by clients on a
public page, answered into Supabase. Backoffice-only - the main app does not read
these tables.

| Table            | Holds                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| `forms`          | title/description/thank-you in EN+HE, `slug`, `status`, soft delete     |
| `form_fields`    | one row per question: type, position, EN+HE labels, `options`, `config` |
| `form_invites`   | per-recipient `token`, language, `sent_at`/`opened_at`/`submitted_at`   |
| `form_responses` | `answers` jsonb keyed by **field id**, plus `lang`, `ip`                |

- **`/f/<slug>` and `/f/i/<token>` are the only unauthenticated pages** - `middleware.ts`
  skips the session check for `/f/*`. The submit server action
  (`lib/actions/form-response-actions.ts`) is therefore a public endpoint: it resolves
  `form_id`/`invite_id` from the slug or token (never from the client), re-checks that
  the form is `live`, validates every answer against the stored field definitions,
  drops unknown field ids, rate-limits per IP per hour, and uses a honeypot.
- **Field ids are stable.** `answers` is keyed by `form_fields.id`, so `saveFormFields`
  updates existing rows in place instead of delete-and-reinsert. Choice option `value`s
  are generated once and never regenerated on a label edit, for the same reason.
- Bilingual with no i18n library: `*_en` / `*_he` column pairs, falling back **either
  way** (`adminLabel` / `pickLang` in `lib/forms/i18n.ts`) - a form may be authored in
  Hebrew only, so nothing may assume the English string exists. RTL is applied by `dir`
  on the form container.
- `forms.languages` (`en` | `he` | `both`) is the per-form language choice. `both` shows
  one language at a time starting at `default_lang`, with a client-facing toggle; a
  single language hides the toggle and hides the other tab in the builder too.
- Invite emails go out through `lib/email.ts` (shared ZeptoMail transport).

### Cron Jobs (Vercel)

Defined in `vercel.json`. All cron routes are secured via `guardCronRoute()`
(`lib/auth/guards.ts`), which accepts Vercel's `Authorization: Bearer $CRON_SECRET`
header (set `CRON_SECRET` in Vercel) with a legacy `?key=$NEXT_SECRET_CRON_SECRET_KEY`
fallback for manual triggers:

- `dailyEventsSync` - sports events daily
- `monthlyTournamentsSync` - sports tournaments monthly
- `dailyLiveEventsSync` - live events twice daily
- `ticketPriceSync` - ticket prices every 2 hours
- `nightlyTixstockSync` - TixStock events nightly (800s max duration)
- `nightlyTixstockPriceSync` - TixStock prices 4x/day (03,09,15,21 UTC; time-budgeted, reports `remaining`)
- `nightlyCampaignCreatives` - feed creatives every 4h (backlog drains ~35/run)
- `publishMetaFeed` - copies the live feed to the Storage file Meta reads, 6x/day (05,08,11,14,17,20 UTC)
- `partnerMonthlyReport` - partner report monthly

### Environment Variables

Required in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_SECRET_ADMIN_EMAIL`
- `NEXT_SECRET_ADMIN_PASSWORD`

### UI Patterns

Built on **shadcn/ui** (Radix UI + Tailwind). Component config in `components.json`. All shadcn components live in `components/ui/`. Custom shared components (Sidebar, etc.) are in `components/`.

### Event Creation Flow

Events have a `type` field (`sports_event`, `music_event`, `sports_event_dynamic`, `sports_live_event_dynamic`, `music_live_event_dynamic`, `tx_event`). When creating events from external providers (P1, LiveTickets), prices are converted to USD with markups and rounded to nearest $10 minus $1 (e.g. $129, $199).

Soft deletes use the `is_deleted` column - set to a `MM-DD-YYYY` date string (not a boolean). Never hard-delete events; use `softDeleteEvent` / `bulkSoftDeleteEvents` from `lib/actions/event-actions.ts`.

Exchange rates (EUR, ILS, GBP → USD) are managed via `lib/services/exchange-rate-client.ts` and the `/api/exchange-rates` route. The sync services call this when converting ticket prices.

`/api/validate-airline` uses headless Playwright + `@sparticuz/chromium` to scrape airline codes from avcodes.co.uk. It has a dedicated Vercel function config with 1024 MB memory / 30s timeout.

### Types

All TypeScript types live in `types/`. Key files: `app.types.ts` (core `Event`, `Flight`, `Order` types), `reservation.types.ts`, `partner.types.ts`, `p1-events.types.ts`, `live-events.types.ts`, `sports-events.types.ts`, `tixstock.types.ts`.

## Required Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY=
NEXT_SECRET_ADMIN_EMAIL=
NEXT_SECRET_ADMIN_PASSWORD=
# REQUIRED IN VERCEL or every cron 401s. Vercel injects it as
# "Authorization: Bearer $CRON_SECRET" on each cron run; guardCronRoute checks it.
# Missing between 2026-07-15 and 2026-07-29 → nothing synced for two weeks.
CRON_SECRET=
# Legacy ?key= fallback for manual triggers only (was public in the repo once - rotate).
NEXT_SECRET_CRON_SECRET_KEY=
NEXT_SECRET_AMADEUS_CLIENT_ID=
NEXT_SECRET_AMADEUS_CLIENT_SECRET=
NEXT_SECRET_HOTEL_SERVICE_URL=
NEXT_SECRET_LIVE_API_URL=
NEXT_SECRET_LIVE_API_KEY=
NEXT_SECRET_XS2EVENT_API_KEY=
NEXT_SECRET_XS2EVENT_API_URL=
NEXT_SECRET_TIXSTOCK_API_URL=
NEXT_SECRET_TIXSTOCK_TOKEN=
NEXT_SECRET_REVALIDATION_SECRET=
# Optional - customer-facing site the partner portal builds tracking links against.
# Defaults to https://www.mega-events.co.il (lib/site.ts).
NEXT_PUBLIC_MAIN_SITE_URL=
# Session signing key. MUST equal myt-main's NEXT_SECRET_SESSION_SECRET - the
# portal's "הזמנה עבור הלקוח" mints a short-lived token in main's
# partner_session format (lib/auth/partner-handoff.ts) that main's
# /api/partner-handoff verifies; different values silently break agent-mode
# settlement (agent card / voucher) on main. Dashboard sessions fall back to
# NEXT_SECRET_ADMIN_PASSWORD when unset, the handoff does not.
NEXT_SECRET_SESSION_SECRET=
# Absolute origin of this backoffice, used to build the form links that get emailed
# out. Falls back to VERCEL_URL, then http://localhost:3000.
NEXT_PUBLIC_APP_URL=
NEXT_SECRET_EMAIL_SERVER_USER=
NEXT_SECRET_EMAIL_SERVER_PASSWORD=
# Optional - P1 feed URLs have hardcoded fallback values in p1-events-sync.ts
NEXT_SECRET_P1_EVENTS_FEED_URL=
NEXT_SECRET_P1_TICKETS_FEED_URL=
```

## Database

Schema is in `db.schema.sql`. Key tables: `events`, `reservations`, `partners`, `locations`, `p1_events`, `live_events`, `sports_events`, `offline_flights`, `tixstock_events`. Managed via Supabase (PostgreSQL).

### Migrations (Supabase CLI)

**This repo owns the schema.** The main app never runs migrations. Schema changes go through versioned migration files in `supabase/migrations/` - never ad-hoc SQL in the dashboard without capturing it.

> **⛔ NEVER apply migrations from a feature branch.** Both routes write to the
> SHARED PRODUCTION database: `supabase db push` locally, and running "Apply DB
> Migrations" with a branch picked in the dispatch UI - the second is what
> actually broke it on 2026-07-29.
>
> Migrations applied from a branch land in the remote migration-history table
> while their files exist nowhere else, so master now has versions it has never
> seen and every later run dies with _"Remote migration versions not found in
> local migrations directory"_.
>
> Both paths are now blocked. The workflow refuses any ref that is not master
> (override: re-run with `allow_non_master` checked). `npm run db:push` is gated
> by `scripts/guard-db-push.mjs`, which refuses unless you are on master, in sync
> with origin, with no uncommitted migration files and no duplicate version
> prefixes (override: `ALLOW_DB_PUSH=1`).

Workflow for any schema change:

1. **Merge master first** - `git fetch origin && git merge origin/master`. Several people write
   migrations in parallel; branching from a stale master is what produces
   _"Remote migration versions not found"_ and duplicate version numbers. See `@.claude/rules/migrations.md`.
2. `npm run db:new <name>` - creates `supabase/migrations/<timestamp>_<name>.sql`; write the SQL there.
   (Or prototype in the dashboard, then capture the drift: `npm run db:diff <name>` - requires Docker running.)
3. Commit the migration file with the feature PR.
4. **Merge to master.** The "Apply DB Migrations" workflow runs automatically on
   any push to master touching `supabase/migrations/**`. Nobody applies anything
   by hand, and **never from a branch** - that puts versions into the remote
   history master has never seen and blocks everyone's next push.
   `workflow_dispatch` remains for re-runs and repairs.
5. Regenerate DB types: `npm run db:types` (writes `types/database.types.ts`).

Two migrations must never share a version prefix (the leading timestamp) - the
applied version becomes ambiguous. The guard checks for this too.

If the history is already out of sync, the fix is to bring the missing migration
_files_ onto master (`git checkout <branch> -- supabase/migrations/<file>.sql`)
so local matches remote. Prefer that over
`supabase migration repair --status reverted`, which marks them un-applied while
their schema changes are still live - the history then lies, and re-applying on
merge fails.

One-time setup per machine: `npx supabase login`, then `npx supabase link --project-ref fandqafngybfdyslofmr` (asks for the DB password).

CI (`.github/workflows/db-migrate.yml`) needs repo secrets `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`.
It refuses to run off master (override: `allow_non_master`), fails fast if two migrations share a
version prefix, and serialises runs so two pushes can't interleave against the same history.

---

## Connection to Main App (`../myt---main`)

### How They're Connected

Both projects share the **same Supabase database**. This backoffice syncs external providers, manages events, and writes to the DB. The main app reads that data and displays it to customers. This backoffice also calls the main app's API for hotel searches and cache invalidation.

### API Calls This Project Makes to Main App

Via `NEXT_SECRET_HOTEL_SERVICE_URL` (currently `https://myt-kohl.vercel.app`):

1. `GET /api/hotels` - Proxied hotel search (in `app/api/hotels/search/route.ts`)
2. `GET /api/revalidate` - Triggers ISR cache refresh after event changes (in `app/api/revalidate/route.ts`)

`middleware.ts` confines partner-role (`agent`/`affiliate`) sessions to `/portal*` - a partner hitting any other path is redirected to `/portal`. Staff may also open `/portal` to debug. Partner tracking links and package links point at `NEXT_PUBLIC_MAIN_SITE_URL` (default `https://www.mega-events.co.il`, see `lib/site.ts`).

### Shared Database Tables

| Table                  | This App                               | Main App                          |
| ---------------------- | -------------------------------------- | --------------------------------- |
| `events`               | Creates, updates, soft-deletes         | Reads (displays to customers)     |
| `reservations`         | Reads (dashboard, reports)             | Creates (on customer booking)     |
| `partners`             | Creates, manages                       | Reads (affiliate auth)            |
| `hotels`               | Reads                                  | Writes (search cache)             |
| `flights`              | Manages (offline inventory)            | Reads                             |
| `categories`           | Creates/manages (card + tree)          | Reads (/c/ pages, homepage tiles) |
| `category_tags`        | Writes (which tags compose a category) | -                                 |
| `event_category_links` | **VIEW** - derived, read-only          | Reads                             |
| `event_tags`           | Creates/manages (feed tags)            | Reads (feed targeting)            |
| `event_tag_links`      | Writes (event↔tag)                     | Reads                             |

**Tags compose categories - never the other way round (2026-07-29).** An event
is only ever _tagged_; you never assign it to a category. A category declares
which tags make it up (`category_tags`), and every event carrying one of them
is pulled in. `event_category_links` is a VIEW over that join - what main reads
for `/c/` pages and the feed's `product_type`. Membership is OR over the tags
and does **not** inherit down the tree: a parent collects only what its own
tags collect (main's `getEventsInCategory` defaults `includeDescendants: false`
to match). An event lands in as many categories as its tags earn it.

**One category table.** `categories` is it - the Templates card (image,
subtitle, blob art, member pages) which also carries the tree (`parent_id`) and
its tags. The old parallel `event_categories` node is gone (kept as
`event_categories_legacy` for one release), and with it the separate
`/event-taxonomy` screen: **Templates → Categories** is where a category is
created, placed in the tree, given its tags and switched live. One switch -
`is_active` publishes both the homepage tile and the `/c/` page - and the
card's `link_url` is kept pointing at its own `/c/` path. On the customer side
`/category/<slug>` permanently redirects to `/c/`, so there is one category URL.

### Shared Types - Keep In Sync!

Types in `types/app.types.ts` are duplicated in `../myt---main/lib/app.types.ts`. These types MUST match:
`Event`, `EventType`, `Flight`, `FlightSegment`, `Order`, `OrderHotel`, `OrderTicket`, `FlightSearchOptions`, `TimeRange`, `AffiliateTracking`, `VipConfig`, `EventTicket`

**Event taxonomy:** `types/taxonomy.types.ts` (`EventCategory`,
`EventCategoryNode`, `EventTag`) + the pure tree helpers in `lib/taxonomy-tree.ts`
(`buildTree`, `flattenWithPath`, `descendantIds`) are mirrored to main as
`lib/taxonomy.types.ts` + `lib/taxonomy-tree.ts`. `EventCategory` is a row of
`categories`. Backoffice writes `categories`, `category_tags`, `event_tags`
and `event_tag_links`; main reads them to build category pages and target the
product feed. Keep both copies in sync.

**Known intentional differences:**

- This project's `EventType` has extra value `sports_live_event_dynamic`
- This project's `Flight` uses simplified airline metadata
- This project has additional types not in main: `LiveEvent`, `P1Event`, `TixStockEvent`, `SportsEvent`, `OfflineFlight`, `OfflineHotel`, `Location`, `Reservation`, `Partner`

### Price Logic Chain (Spans Both Projects)

1. **This backoffice** sets: `base_flight_price`, `base_hotel_price`, and ticket prices on events (currency markups in `lib/services/ticket-price-sync.ts`: USD +$40, EUR +€40, GBP +£35, ILS +₪150)
2. **Main app** calculates final customer price: `base_flight_price + base_hotel_price + min_ticket_price + 175 USD markup`
3. Changing price/markup logic here directly affects what customers see and pay in the main app

### What to Check in Main App After Changes Here

- **Added/removed event fields?** → Check `../myt---main/lib/app.types.ts` and event rendering components
- **Changed price calculation?** → Check `../myt---main/lib/events/price.ts` and `lib/price.utils.tsx`
- **Modified event types?** → Check `../myt---main/lib/app.types.ts` `EventType` and ticket vendor logic
- **Changed DB table schema?** → Check all Supabase queries in `../myt---main/lib/` and `../myt---main/app/api/`
