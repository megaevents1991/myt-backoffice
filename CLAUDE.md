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
>
> **Partner links + influencer coupons (2026-09-11):** the portal link builder
> can target any site page (`lib/actions/portal-site-pages-actions.ts` →
> `partnerPageLink` in `lib/site.ts`; artists/teams resolve to their `/c/`
> twin like main's `cmsTwin.ts`). Every `affiliate` partner can have ONE
> influencer coupon (`coupons.influencer_partner_code`, code = tracking code +
> value e.g. `AVIRAN30`, terms mirror `partners.user_discount`: 1..10 →
> percent, else fixed **per person** via `coupons.per_person`). Built from the
> partner editor, re-synced by `updatePartnerAccount` and the portal's
> rebalance (`lib/services/influencer-coupon.ts`). myt-main multiplies a
> per-person fixed coupon by the ticket count (`getCouponDiscountUsd`,
> validate route, confirm-order) - other coupons stay per order.
> **No coupon on a partner-link visit (2026-09-16):** a visitor who came
> through an agent/affiliate link (tracked partner or the `myt_utm`
> influencer primary) gets no coupon field on main, and confirm-order rejects
> one (`partnerLinkCode`); a coupon order's partner now beats a plain
> client-sent source like "google" in attribution. Portal rows show a
> "קופון" source and a greyed "צפוי" commission while not yet Paid
> (`expectedCommissionForReservation` - display only).
>
> **Portal history cut-off (2026-09-16):** `partners.portal_history_from`
> (date, null = all) - set in the partner editor ("Portal History From") for a
> partner starting fresh on a code that already has bookings (Aviran: code
> since 03/2025, portal since 09/2026, saw a 06/2025 customer). Every portal
> surface that lists/counts bookings applies it via `lib/portal-history.ts`
> (`portalHistoryFrom` + `fromPortalHistory`): reservations page, dashboard,
> stats, activity feed, user log. **Reporting only** - the monthly report and
> commission maths never read it.

> **✅ Redesign + Events Factory + Guide (branch `feat/backoffice-redesign`, 2026-09-02).**
> Everything below is on that branch, migrations already applied to prod.
>
> - **Chrome:** "MYT Admin" theme (forest sidebar / mint accent, light+dark via
>   `next-themes`, tokens in `app/globals.css`). Navigation is ONE source -
>   `lib/nav.ts` (groups, per-item `roles`, breadcrumbs, palette keywords).
>   Collapsible sidebar groups with hover preview, `Ctrl+B` icon mode, `Ctrl+K`
>   command palette. Tables use `components/data-table.tsx` v2 (saved views,
>   bulk bar, numbered pagination, `defaultSorting`) and **token search**
>   (`lib/search.ts` `matchesSearch` - words in any order, diacritics-insensitive,
>   guarded subsequence for nicknames: "barca" hits Barcelona).
> - **Deep links:** `id="fix-*"` / `id="section-*"` anchors flash on arrival
>   (`:target` keyframes in globals.css + `components/deep-link-scroll.tsx`).
>   Event editor sections carry `data-editor-section` for the `EditorRail`.
> - **Tasks + creative gaps:** `/tasks` (table `tasks`, editor+ self, admins
>   assign) and the gaps radar (12 kinds - 9 visual + team/artist `bio` +
>   category `page_content` text; live queries; false gaps filed in
>   `creative_gap_dismissals`). A gap's **Do** button lands on the actual fix:
>   team crest → `/assets?q=<team>`, missing creative → the event's `#fix-price`
>   when `campaign_skip_reason` mentions price (the pipeline's only skip).
>   Queue order (2026-09-10): severity → artists/teams **on sale now** (main's
>   on-tour rule, mirrored in `lib/on-tour.ts`) before wishlist ones → kind.
>   **Blob = main picture (2026-09-16):** `team_hero` / `artist_hero` fire only
>   when BOTH `image_url` and `art_image_url` are null (main's `DetailHero` shows
>   the blob first); `GapItem.demoted` is gone. Twin categories
>   (`lib/services/category-twins.ts`, shared with the portal link builder - a
>   leaf under the `teams`/`artists` hub; the FIRST active team/artist matching by
>   name, then only if it has both a Hebrew and an English name - exactly main's
>   `app/c/[...slug]`): main renders the team/artist page there, so a twin never
>   gets a `category_image` gap. A team twin keeps its `category_content` text gap
>   (main's `TeamCmsPage` reads the category's `page_content`); an artist twin has
>   none. Only `is_active` categories are checked. Assigning a task to someone else
>   mails them (`lib/services/task-notify.ts`); a gap task set to **done**
>   dismisses its gap (reopen restores). `/price-changes` rows can spawn a
>   `price_review` task (one open per event) or soft-delete the event; the
>   shared dialog is `components/task-editor.tsx`.
> - **Tasks Hub (2026-09-16):** everything below needs the unapplied migration
>   `supabase/migrations/20260916210000_tasks_hub.sql` applied from master
>   first - `/tasks/rules`, the Pricing tab's price-light rows, and
>   `scripts/import-roadmap.ts` all refuse to run without it.
>   - **Schema:** `tasks` gains `board` (`dev`/`marketing`/`ops`), `phase`
>     (smallint), `channel` (marketing-only), `progress` (smallint), and a
>     `paused` status that counts as OPEN (assignee/open-task indexes and
>     filters were updated to include it). New sources `recurring` (weekly
>     digest tasks) and `roadmap` (imported rows) alongside the existing ones.
>     `task_rules` (one row per recurring rule) and `task_comments` (the
>     thread) are new tables. `events.light_red_since` records when the EVENT
>     (either scope) last turned red - per event, not per scope - and is
>     cleared the moment it leaves red (`unchecked` included); the
>     `price_light` rule's `min_weeks_red` condition reads it today.
>     A partial unique index (`tasks_recurring_digest_week_uniq`) stops the
>     cron and a manual "run now" from double-creating the same rule's digest
>     in the same ISO week.
>   - **Thread** (`components/task-thread.tsx`, `lib/actions/task-comment-actions.ts`):
>     every task has a chronological comment thread mixing human comments and
>     the system's own activity rows (status/assignee/priority/due_date/progress/board
>     changes, written by `lib/services/task-activity.ts` from the same action
>     that makes the change - a DB trigger wouldn't know who the actor was).
>     Screenshots paste straight from the clipboard, client-shrunk to 2000px
>     and capped at 2.5MB (`lib/images/sniff.ts` magic-byte checks the real
>     type - a renamed `.png` that isn't actually an image is rejected) to stay
>     under the repo's 3MB server-action body limit, stored in the private
>     `task-attachments` bucket and served via signed URLs. `@name` mentions
>     (`lib/tasks/mentions.ts`, Unicode-aware so Hebrew names work) mail the
>     mentioned staff member (`lib/services/task-mention-notify.ts`) - a
>     mention removed from the text before sending is pruned and never mailed.
>   - **Recurring rules** (`lib/services/task-rules/*`, one file per domain -
>     `price-light.ts`, `price-changes.ts`, `creative-gaps.ts`, `custom.ts`):
>     each rule's `candidates()` generator **throws** on a load failure rather
>     than returning an empty list - an empty list reads as "no gaps" and
>     would auto-close open digests it shouldn't. `lib/services/weekly-task-gen.ts`
>     runs every active `task_rules` row through `weekly-task-plan.ts` (pure,
>     unit-tested against synthetic rows): a rule in `weekly_digest` mode gets
>     one summary task per ISO week; `per_item` mode creates one task per
>     candidate under the **domain's own native source** (`price_light`,
>     `price_review`, `creative_gap`) so it dedupes and closes exactly like a
>     hand-made task, not a separate "recurring" lane. `dow` (0=Sunday..6=Saturday)
>     is a **UTC** weekday, matched against `now.getUTCDay()` - the cron
>     (`weeklyTaskGen`, `?dry_run=1`) fires DAILY at 06:00 UTC and each rule
>     runs only on its own `dow`. A `per_item` rule creates at most
>     `PER_ITEM_MAX_PER_RUN` (25) tasks per run - the rest are reported as
>     skipped (`cap: N more next run`) and follow next time - and the run also
>     stops a rule at the time budget, still recording what it created. Its
>     assignee gets ONE summary mail per run (`notifyRuleTasksCreated`), not a
>     mail per task; a digest keeps its single assignment mail.
>     `/tasks/rules` (admin only) is where a rule's domain, match filter,
>     assignee, board and `dow` are set - kept out of the migration on purpose
>     so assignment stays something you change on the screen, not in SQL.
>   - **Visibility:** the whole board is visible to every staff member (Dor,
>     16.09) - what's restricted is editing. `lib/tasks/permissions.ts`:
>     admins edit every field on any task; an editor may change only `status`
>     and `progress`, and only on a task assigned to them - commenting on the
>     thread is a separate, always-open door.
>   - **Kanban + board lens** (`?tab=kanban`, `?board=`, `lib/tasks/kanban.ts`):
>     a swimlane view of the same tasks: the board lens (`all` or one of
>     `dev`/`marketing`/`ops`) filters the table, its counts and the kanban
>     together from one query-string source.
>   - **Pricing tab** (`?tab=pricing`, all staff, not admin-only like
>     `/price-light`): every open pricing problem - red price lights and
>     frozen `/price-changes` rows - in one list via
>     `lib/actions/pricing-gap-actions.ts`. Three buttons per row: **משימה**
>     (Task) opens a tracked task; **לתקן** (Fix) jumps straight to the fixing
>     control; **טופל** (Handled, `lib/services/gap-resolution.ts` +
>     `lib/services/price-light-decisions.ts`) never writes a price - on a
>     price light it logs a `price_light.repriced` audit row and mutes the row
>     until the next nightly recompute (00:30 UTC); on a frozen price-change
>     row it marks the row `reviewed` with note `"סומן כטופל | <original note>"`,
>     which is final - no reopen touches it. Only a `price_review` TASK close
>     stamps `"נסגר במשימה <taskId> | <original note>"`, and only rows carrying
>     that exact stamp are restored (status + original note) when that task
>     is reopened. Frozen rows whose event is soft-deleted or `is_test` are
>     dropped from the tab and from rule candidates. Because this tab
>     is open to every editor (not just admins), its actions call
>     `requireStaff()` and go through session-free service functions rather
>     than the admin-gated actions `/price-light` uses directly.
>   - **Gap-closing is now generic** (`lib/services/gap-resolution.ts`): a task
>     born from creative_gap/price_review closes that gap when marked done or
>     cancelled, and reopens it otherwise - one rule for every gap family,
>     replacing the old inline `if (source === "creative_gap")` branch in
>     `setTaskStatus` (creative behaviour is unchanged). A `price_light` task
>     records a `price_light.repriced` decision ONLY when it is marked done
>     while that scope's light is still red (`shouldRecordRepriced`);
>     cancelled records nothing, and reopening undoes nothing.
>   - **Roadmap import** (`scripts/import-roadmap.ts`, one-time, create-only by
>     default): migrates the old standalone RoadMap app's localStorage export
>     into `tasks` (source `roadmap`). Existing imported rows are left alone
>     unless `--update-existing` is passed, so re-running an export never
>     reverts an edit made in `/tasks`. See `docs/superpowers/roadmap-export-snippet.md`
>     for getting the export out of the old app first.
> - **Pricing brain:** `lib/services/price-quote.ts` - see "Price Logic Chain".
>   Nightly `base-price-sync` cron + `/price-changes` review screen
>   (`base_price_sync_log`).
> - **Event creation automation:** stadium memory, background base-price
>   auto-fill, nearest-location IATA, multi-team batch, batch from every
>   provider, and the `/factory` draft grid (`event_drafts`) - see "Event
>   creation automation".
> - **`/guide`:** bilingual (EN/HE toggle) system manual for staff, content in
>   `app/(dashboard)/guide/guide-content.ts`. **When a flow described there
>   changes, update it in the same PR.**
> - Not yet done post-merge: `npm run db:types` and drop the `supabase as any`
>   boundary casts in the new actions/services.

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
>   Amadeus prod, `*/tickets`) - add auth or shared-secret + rate limit.
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
- `components/` - shared UI components + `ui/` (shadcn/Radix-based). Notable: `data-table.tsx` (all tables), `app-sidebar.tsx` + `topbar.tsx` + `command-palette.tsx` (chrome), `editor-rail.tsx`, `deep-link-scroll.tsx`
- `contexts/auth-context.tsx` - React context wrapping client-side auth state
- `lib/nav.ts` - the ONLY definition of navigation (groups, roles, breadcrumb labels, palette keywords)
- `lib/search.ts` - `matchesSearch` token search used by every table/filter
- `lib/services/price-quote.ts` - the pricing rule + constants; `flight-search.ts` (Amadeus, server-side), `base-price-sync.ts` (nightly cron), `venue-memory.ts`, `nearest-location.ts`, `draft-builder.ts`
- `lib/provider-batch.ts` - per-provider identity mappers for the batch wizard + factory (`{ provider, rows }` stash envelope under localStorage `batch_create`)
- `docs/superpowers/` - design specs + implementation plans for big features (the Events Factory one is the reference)

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
- **Travellers (2026-09-16):** two numbers that must never be confused.
  *Reported* = the sum of the party-size question, a number question flagged
  `config.traveler_count` ("Travellers count" switch in the field editor, one per form -
  flagging another unflags the first; no flag = the first client-facing number question).
  One form often covers a whole family, and a blank form is not a party of zero, so it is
  left out. *Trip size* = `form_invites.total_travelers`, typed by staff when minting the
  trip link or later by clicking the trip's Travellers cell in the report
  (`setTripTotalTravelers`, audited). A trip row reads `reported / size` ("15 / 17");
  with no size set it shows the reported number alone. The summary card measures
  coverage over SIZED trips only (`sumTravelers`) and names travellers on unsized trips
  separately - mixing them in would put people in the numerator with no seat in the
  denominator. The "no trip" bucket can never be sized.
- **Staff edits (2026-09-16):** the report popup's **עריכה** lets staff and
  `forms_operator` correct the OPEN answers only - `STAFF_EDITABLE_TYPES` (text, number,
  email, phone, date). Ratings, scales and choices are never editable (they feed the
  averages and the review gate). `updateFormResponseAnswers` re-validates with the same
  field schema as the public submit, merges into `answers`, and writes an `audit_log` row
  (`update` / `form_response`, `changes` = before/after per field). No `edited_at` column.

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
- `googleReviewsSync` - daily 04:00 UTC: mirrors the Mega Events Google Business reviews into `google_reviews` / `google_review_sources` (`lib/services/google-reviews-sync.ts`). Source per run: Places API (New) when `NEXT_SECRET_GOOGLE_PLACES_API_KEY` is set (live rating/count, ≤5 reviews per call, no owner replies), **otherwise Elfsight's public review feed for our Place ID** (all reviews + replies; unofficial endpoint, refreshed on Elfsight's schedule - a failure lands in `google_review_sources.sync_error` and the site keeps what it has). The mirror only accumulates. Initial 71 rows seeded with `scripts/seed-google-reviews-from-elfsight.mjs`. myt-main renders "לקוחות משתפים" from these tables (its own carousel - the Elfsight widget is gone, 2026-09-09).
- `base-price-sync` - nightly 01:30 UTC: re-quotes live future events through `price-quote.ts`; deviation ≥$20 per component rewrites the base, >$400 freezes as `needs_review` (`/price-changes`); skips offline-linked components (`flights.event_ids` / `offline_hotels.event_ids`), base=0, events <2 days out. **Rotation** (2026-09-07): the 270s budget covers ~50 events, so each night takes the least-recently-visited first (newest log row per event = last visit), next-45-days ahead of the rest. **Every visit is logged** - `applied` / `needs_review` / `skipped` / `error` with the arithmetic in `note` - so the screen answers "why didn't it move". **`?dry_run=1` computes everything with zero writes** (no event update, no log row, rotation not advanced) - the way to test against prod from a preview. Daily summary email to `NEXT_SECRET_ADMIN_EMAIL` when anything happened.
- `price-light-crawl` - hourly tick (`7 * * * *`): crawls at most ONE competitor whose site is due (72h interval, `intervalHours` per scraper in `lib/services/competitor-scrapers/`), writing `competitor_listings`. Locking is a `competitor_crawl_runs` row in status `running` younger than 6 min - not an advisory lock. `?competitor=liveevents` forces a site (validated against `ACTIVE_COMPETITORS`), `?dry_run=1` writes nothing. Stealth is code, not a promise: one session at a time, 20-60s random pauses, blocked images/media/fonts/stylesheets, rotating Israeli UA, 45s page / 240s crawl timeout. Three consecutive `blocked`/`error` runs open a circuit for 24h (manual crawls bypass it); a listing-count drop ≥50% vs the last good run marks the run `partial` and emails `NEXT_SECRET_ADMIN_EMAIL`. `PRICE_LIGHT_SCRAPE=off` stops crawling (matching/lights still run off the stored catalog). Admin "crawl now" is `POST /api/price-light/crawl` (`guardAdminRoute`). **ISSTA is `crawlFrom: "local"`** (2026-09-15): its league pages answer Vercel's address with HTTP 200 and zero cards (an Israeli address gets them; spoofed forwarded-IP headers change nothing), so the tick never picks it, `runCrawl` records `skipped` for it whenever `VERCEL` is set, and the panel has no button for it. It is refreshed by `scripts/crawl-local.ts issta` - same `runCrawl`, same run row - which Windows Task Scheduler on Dor's machine runs DAILY at 03:30 ("MYT price-light ISSTA crawl", registered by `scripts/crawl-local-task.ps1`, log `%LOCALAPPDATA%\MYT\crawl-logs\issta.log`); the script itself exits "not due" until 72h have passed since the last real run, so a machine that is off some days catches up on its next day on. If that machine stays off for two weeks the ISSTA catalog goes stale and reads `unchecked` (partial coverage), never a false "alone".
- `price-light-retention` - weekly, Sundays 03:00 UTC: keeps `RETENTION_DAYS` (**180**) and hard-deletes the rest of `event_price_snapshots` (by `day`), `competitor_matches` (by the EVENT they describe being 180 days past - never by their own age, or a quiet row that is still an event's newest verdict would be erased and its light would vanish at the next recompute), `competitor_listings` (`last_seen_at` - not seen in six months = off their site), `competitor_crawl_runs` (`started_at`) and `audit_log` rows whose action starts `price_light.`. Backoffice-only log tables, so a hard delete is the policy here (same precedent as `purgeAuditLog`); it never touches `events`. `?dry_run=1` counts exactly what a real run would remove and writes nothing. **`purgeAuditLog` now EXEMPTS `price_light.*`** - those rows are the decisions the agent learns from, and dropping them at 30 days silently capped its 120-day memory at a month. Why these sizes are safe: the price-drop lookback reads 14 days, a light goes stale at 14, and the circuit reads the last handful of runs - every read path lives far inside 180.
- `price-light-ours` - nightly 02:40 UTC (after `base-price-sync` finishes its own Amadeus searches): describes OUR package contents for the /price-light comparison - the flight and hotel the pricing rule would buy today (cheapest direct / connection past the $300 gap via `fetchFlightOffers` + `pickFlightPrice`; cheapest 3★ via main's `/api/hotels`; a linked offline flight/hotel wins) - into `events.light_detail.ours`. Never-described first, then older than `OUR_OFFER_REFRESH_DAYS` (7) or last lost to a TRANSIENT error (HTTP/API/timeout - retried next night, not left blank a week), `OUR_OFFER_CONCURRENCY` 3 events at a time in a 260s budget (~5-8s per event). **Hotel searches run through ONE queue** whatever the event concurrency, with one retry on 429/5xx: main's `/api/hotels` fails under parallel load (first full pass lost 308 of 426 hotels; each answered alone). Flights: 423 of 426 described. Reads the rule, writes no price. `?dry_run=1` still SEARCHES (that is what is being tested) but writes nothing; `?limit=N` caps a manual run. Dor 2026-09-14: the extra Amadeus/hotel calls are fine nightly and on demand.
- `price-light-nightly` - 00:15 UTC, before `base-price-sync`: refreshes the `livetickets` competitor table from `live_events` first (it's an API read, never crawled, budgeted at 60s so it can't eat the whole run); then pass 1 snapshots every live future event and applies the "ירידת מחיר" tag (drop ≥$50 vs ~14 days ago, shown 14 days); pass 2 rule-matches every event against the stored catalogs and recomputes `events.light_package` / `light_ticket` / `light_detail`. Both passes go least-recently-checked first and share one 270s budget measured from the top of the run, so a cutoff mid-pass-1 is recorded (`snapshotsRemaining`) rather than silently skipped. Revalidates main (both targets) once if anything changed; summary email (which also reports `aiCalls` used out of `AI_CALLS_PER_RUN`). `?dry_run=1` = zero writes **and zero AI** - dry runs pass `judge: null`, so a report pointed at prod never spends money. Spec `docs/superpowers/specs/2026-09-09-price-light-design.md`; rules + constants ONLY in `lib/services/price-light.ts`.
- `weeklyTaskGen` - daily 06:00 UTC (`vercel.json` `0 6 * * *`); each rule runs only on its own UTC weekday (`dow`): runs every active `task_rules` row through its domain's generator (`lib/services/task-rules/*`) and `weekly-task-plan.ts`'s pure decision logic, creating one weekly-digest task per rule (source `recurring`) or one task per item under that domain's native source (`price_light`/`price_review`/`creative_gap`). Per-item rules are capped at 25 creates per run (`PER_ITEM_MAX_PER_RUN`) with one summary mail per assignee; the 270s budget is checked per created task. A generator that fails to load its data THROWS - never silently returns an empty list, which would auto-close open digests that are still valid. `?dry_run=1` reports what it would create with zero writes. See "Tasks Hub" above.

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

### Event creation automation (2026-09-02)

Spec: `docs/superpowers/specs/2026-09-02-events-factory-design.md`. Three paths share the same building blocks, all wired into `app/(dashboard)/events/[id]/page.tsx` (the `/events/new?batch=1` wizard) and `lib/services/draft-builder.ts` (the factory):

- **Stadium memory** (`lib/services/venue-memory.ts`): a step with no ticket categories copies `tickets_and_rates` structure from the most recent live event at the same venue (normalized name, fallback coords <1km). Prices come along only as the reprice fallback; ids regenerated. Banner + undo in the wizard.
- **Auto base-fill**: once a new event has `city_iata` + flight dates, `fetchPriceQuote` fills `base_flight_price`/`base_hotel_price` in the background - **empty (0) fields only**, one shot per step, green flash, inline warning on failure, never blocks save.
- **Nearest IATA** (`lib/services/nearest-location.ts`): venue coords → closest `locations` row with an IATA within 50km. This is what makes artist tours price per city.
- **Multi-team batch** (TixStock): selection accumulates across performers (chips per team); "select all home games of X" = `lib/tixstock-home.ts` `isHomeGame` (event name starts with team name); crossing teams in the wizard resets the dragged form.
- **Batch from every provider**: Live/P1/Sports tables have multi-select + Create-N; the stash is `{ provider, rows }` (`lib/provider-batch.ts` mappers are identity-only - name/date/venue/coords/smart dates; tickets come from stadium memory, not from provider live tickets, which stay on the single-event pages).
- **Factory** (`/factory`, `lib/actions/factory-actions.ts`, table `event_drafts`): "Send to factory" from any provider bar creates draft rows; the page loops `buildNextDraft()` one draft per call (stoppable) through the blocks above and records what stayed empty in `missing`; the grid inline-edits name/iata/prices (amber = missing), bulk-approve calls `createEvent` per draft. Drafts are a separate table on purpose - main never sees them. Terminal rows purge after 30 days.
- **Form cleanup**: legacy composed-pricing markups (`markup_ticket/flight/hotel`, `skip_hotel_markup`) sit in a collapsed Advanced section (auto-opens when used); `usual_price` is gone from the UI but the column stays (main's feed uses it as a last-resort price fallback).

### Price light (רמזור) (2026-09-10, phase 0)

Spec `docs/superpowers/specs/2026-09-09-price-light-design.md`; phase-0 task plan
`docs/superpowers/plans/2026-09-10-price-light-phase-0.md`; LiveEvents site recon
`docs/superpowers/scrapers/liveevents.md`. Own Playwright crawler per competitor site
(no Firecrawl - rejected in the design doc), never more than one site per 72h, matched
rule-first against our catalog and shown as two traffic-light pills (package / ticket)
on the events table. Rules, thresholds and normalization constants live ONLY in
`lib/services/price-light.ts` (pure, no DB/fetch - runs under plain `node` via
`scripts/price-light-selftest.ts`); the crawl loop is `lib/services/price-light-crawl.ts`,
matching is `lib/services/price-light-match.ts`, the nightly pass is
`lib/services/price-light-nightly.ts`, event-column read/write is
`lib/services/price-light-store.ts`, and each site's crawler lives in
`lib/services/competitor-scrapers/` (phase 0: `liveevents.ts` browser-mode, `livetickets-api.ts`
table-mode reading `live_events`). Browser acquisition (local `@sparticuz/chromium` vs remote
CDP, UA/viewport rotation, stealth headers) is centralized in `lib/services/browser.ts` - no
other file launches a browser. UI: `app/(dashboard)/events/price-light-cell.tsx` (pills, tooltip,
refresh, history sheet) via `lib/actions/price-light-actions.ts`. Local tooling:
`scripts/scrape-fixture.ts <competitor> [--save]` (parser regression on saved HTML),
`scripts/scrape-once.ts <competitor>` (live dry-run), `scripts/livetickets-brt-check.ts` (spot-checks
the `brt` = shelf-price assumption). The old `/api/competitor-pricing` route and its bulk-check
dialog on `/events` are gone - `createEvent` matches new events instantly (`on_create`) instead.
`comp_pricing` column/type is untouched here (removal is a separate PR). Phase 2 adds ISSTA,
Golasso, OnTour and the AI judge (`PRICE_LIGHT_AI`).

**Phase 1 (2026-09-10): AI judge + `/price-light` decision screen.** The rule matcher
(`price-light.ts`) is still phase 0's only *normalizer* - the AI never sets a light itself, it only
resolves what the rule couldn't. The judge is `extractAndJudge()` in
`lib/services/price-light-judge.ts`, and `price-light-match.ts` is its **only production call
site** - nothing else in the app may call it (the one other caller is the local
`scripts/price-light-judge-smoke.ts` smoke test, run by hand). The AI is
**opt-in**: `aiEnabled()` is true only when `PRICE_LIGHT_AI` is literally `"on"` AND
`ANTHROPIC_API_KEY` is set. Unset, empty or anything but `on` = off = rule-only, exactly phase-0
behaviour (it fails CLOSED on a typo, so the spending side can never turn itself on by accident);
every AI failure (timeout, truncation, bad output, disabled) resolves to `unsure` with a note and
never throws past `matchEvent`. Two ways in: the rule left the pick ambiguous (candidates handed
to the judge to pick `same_event` + extract listing attrs), or the rule already found the listing but
its `attrs` are all `unknown` and it has `detail_text` (extraction only, no re-judging same_event).
**One AI call per (event, listing) pair:** reused whenever the newest `competitor_matches` row for
that (event, competitor, scope) has the same `listing_id`, a non-null `ai_verdict` with no `error`,
and `listing_changed_at` unchanged - a fresh call only fires when the listing itself changed. A
reused verdict is copied onto the new row marked `cached: true`, which is how `aiCostThisMonth()`
avoids re-billing one call on every visit. A verdict produced this run against a row that has none
is ALWAYS persisted, even at an unchanged price - otherwise the cache could never engage. Page
`attrs` win over AI `attrs` **per field, only where the page actually knows the value** (a page
that stores `"unknown"` never overwrites an AI answer). Constants live only in the judge file:
`AI_CONFIDENCE_MIN 0.8` (below it → `unsure`), `AI_TIMEOUT_MS 12000` with `maxRetries: 0`,
`AI_CALLS_PER_RUN 40` (run-wide ceiling the nightly threads through `matchAllForEvent` as a shared
`aiBudget`; past it matching carries on rule-only and the summary reports `aiCalls`),
`AI_MAX_CANDIDATES 10`, `AI_DETAIL_TEXT_MAX 6000`, `AI_MODEL_DEFAULT "claude-opus-5"`,
`AI_USD_PER_M_INPUT 5` / `AI_USD_PER_M_OUTPUT 25` (Opus 5 pricing - cost computed and stored per
call in `ai_verdict`). The call is `max_tokens: 4000` + `output_config: { effort: "low" }` and
treats `stop_reason === "max_tokens"` as a failure: Opus 5 thinks adaptively, so a small ceiling
truncates the reasoning before the forced tool call ever lands. `scripts/price-light-judge-smoke.ts
<eventId>` (`npx tsx`, needs the key) smoke-tests one call live. **First live run (2026-09-15)
found Opus 5 answering the tool with STRINGS** (`"same_event": "true"`, `"nights": "3"` - the schema
allows `["boolean","string"]`); the reader accepted only real booleans/numbers, so every verdict read
as "unknown" and the judge could never find, rule out, or extract anything. `coerceBool`/`coerceNum`
now read both, every verdict carries `parser: AI_VERDICT_PARSER` (2), and both caches reuse only a
verdict with that stamp - older rows are asked again rather than recycled.

**Phase 2.1 (2026-09-13): duration-aware comparison + the agent's memory.** Two packages for the
same fixture are rarely the same length - ours is often a night longer - so a nights gap is now
measured, priced and, where it cannot be seen, *admitted*. (a) `ourNights()` returns `null`
instead of a flat 3 when an event has no travel window (a guess wearing a number's clothes);
(b) a nights gap is priced at `ourNightRateUsd()` - that event's own `base_hotel_price / nights`,
clamped to `NIGHT_RATE_MIN_USD 45`..`NIGHT_RATE_MAX_USD 260`, with the flat `NIGHT_USD 90` left
only as the fallback (measured: a Manchester night is $190, a Barcelona one $75-138, so the flat
rate mis-priced a one-night gap by up to 2x in both directions); (c) `listingNights()` derives
the competitor's nights from the listing's stored travel window when no detail page ever said
(123 of Golasso's 132 listings had `attrs: null` but all 132 carried the window); (d)
`nightsUncertaintyUsd()` returns one night's rate when either side's duration is unknown, and
`computeScopeLight` widens BOTH thresholds by it, so a duration we cannot see reads orange, never
a confident red (63 of 77 matched package listings published no nights at all; 10 events moved
red/green → orange on the first pass). `LightScopeDetail` carries `uncertainty_usd` + `nights`
(both optional - rows written earlier have neither), the events-table tooltip and the
`/price-light` row both print the duration line, and `matchEvent` rewrites a row whose nights
changed even when its price did not. **The detail queue is now ordered**
(`listingIdsWorthDetail`): matched-but-never-enriched first, then listings whose title actually
covers one of our event names (`DETAIL_NAME_MIN_SCORE 0.5`), then the long tail, and at most
`DETAIL_REFRESH_SLICE 6` refreshes of already-enriched rows - before this it re-fetched the same
head every run (18 of 570 enriched, unchanged run after run) and a listing with no detail page
has no nights, no stars and, on LiveEvents, no price. **The agent's memory** is
`lib/services/price-light-memory.ts`: `houseRules()` is GENERATED from the engine constants (so
tuning a constant re-teaches the judge on its next call, never a hand-copied prompt) and
`loadJudgeLessons()` quotes the notes staff wrote when they overrode a light (`audit_log`,
`price_light.override`, newest `LESSON_MAX 8` within `LESSON_LOOKBACK_DAYS 120`, capped at
`AI_MEMORY_MAX 2000` chars in the prompt). The nightly loads it ONCE per run and threads it as
`aiMemory` through `matchAllForEvent`; staff notes are quoted as evidence, explicitly not as
instructions. Setup steps for turning the AI on: `docs/superpowers/price-light-ai-setup.md`.

**One row per EVENT on `/price-light` (2026-09-14).** Dor: "צריך להיות באותה שורה גם המסקנה על
כרטיס וגם המסקנה על חבילה". `PriceLightRow` is now the event, carrying `package` / `ticket`
`PriceLightScopeCell`s (null when that scope is `na`); 406 of 435 events show both. The types and
`rowScopes()` live in `types/price-light.types.ts` - `price-light-actions.ts` is `"use server"` and
may only export async functions. Tiles and views count EVENTS and match when EITHER conclusion
qualifies; the table shows both pills, both prices, both gaps, and sorts by the worse gap. **Every
competitor is shown, not just the one that set the light** (`CompetitorAnswer[]`, deciding one
marked) - the data was always in `light_detail[scope].per_competitor` and had nowhere to be seen;
all 839 live scope cells carry it. Scope-specific decisions name their scope: with both scopes red
there are two **הוזל** buttons and two **משימה** items (`הוזל · חבילה`), and **דריסה** gains a scope
picker; **השאר בפיד**, **הסר מהאתר** and **בדוק עכשיו** stay event-level. The events-table light
column sorts by the worse of the two lights, not by the package one alone. **Load path (2026-09-16):** the screen
issues three independent loads (rows / competitors panel / AI cost) and renders each as it lands - the table never waits
for the panel. `listPriceLight` reads the newest match per (event, scope) through the Postgres function
`price_light_newest_matches(event_ids, since)` (migration `20260916113000`, `service_role` only; one round trip instead
of paging every match of the lookback window) and falls back to the paged read on `PGRST202` (function not migrated
yet); `listCrawlRuns` runs its 20 small reads concurrently. Measured before: 6s+ on prod. **Red first:** the opening
load asks `listPriceLight({ onlyRed: true })` (events with a red light on either scope - the default "ממתינים להחלטה"
view is a subset of them) and paints the table from that, then fetches the full list and swaps it in; until then every
non-red tile/view count shows "…" and a non-red view reads "טוען…", never a false 0 or "empty". A sequence counter drops
a stale answer, so a decision's refresh can never be overwritten by the opening full list. **Cached:** the three loads
are `unstable_cache`d under the tags in `lib/services/price-light-cache.ts` (rows 300s, panel 120s, AI cost 120s) with
auth kept outside the cached function; every write path that changes the screen calls `invalidatePriceLight(...)` ONCE
after its write - the decisions/recheck/refresh-ours actions, `insertRun`/`finishRun`, task status/delete/create
(open-task flag), `createEvent`/`updateEvent`/soft-deletes/`syncEventPrices`, and the nightly / ours / base-price-sync
crons at the end of a run. Outside a Next request (`scripts/crawl-local.ts`) the helper is a no-op. A payload over
Vercel's 2 MB data-cache item limit is silently not cached (today's full list is ~half that). The TTLs are the net for
any write path not wired (the 2-hourly ticket price sync).

**Partner pass (2026-09-14): every competitor, contents side by side, a package/ticket lens.**
(a) **Matching coverage.** 357 of 426 live events had NO priced package competitor, and 840 package
answers were `unsure` - almost none of them genuinely ambiguous. The rule (`price-light.ts`) now:
keeps a geresh inside a word ("מנצ'סטר" was two tokens), ignores competition names/years/club forms
(`STOP`), treats tokens as equal across a Hebrew prefix letter or one typo on 5+ letters
("הילרי"/"הילארי", "ויאריאל"/"וויאריאל"), scores BOTH ways (a short complete title "מילאן | לצ'ה"
counts, but only with ≥2 tokens), never picks a multi-fixture bundle (title "+", or detail text
"חבילה מרובת משחקים" - `isMultiMatchText`), and breaks a tie between copies of the same fixture by
the cheaper one. **`ruleSaysAbsent`**: when every candidate in the date window scores below
`RULE_ABSENT_BELOW` (0.4) it is plainly another event -> `not_selling` (still gated by `covers()` +
a good crawl) and no AI call is spent on it; a strong name one day off stays `unsure`. Measured:
0 found lost, +52 found, 520 `unsure` -> `not_selling`, 39 `unsure` left; 40 borderline absences
checked by hand, all correct. **`quote_only`** (LiveEvents sports "לקבלת הצעת מחיר": they sell it, no
number) travels match `note` -> store -> `per_competitor` -> UI as "מוכר · הצעת מחיר" instead of
"לא ודאי" (225 events). (b) **What each package contains** - partner format "טיסות: אל על עם מזוודה
ישיר 16-20 | מלון: שם, ארוחת בוקר או ללא | סוג כרטיס". Competitors: `lib/services/offer-detail.ts`,
pure per-site parsers over the STORED `detail_text` (LiveEvents / Golasso / OnTour; ISSTA's page is a
JS loader and LiveTickets is a table, so those fall back to `attrs`); the stored text cap is now
`DETAIL_TEXT_MAX` 6000 (`competitor-scrapers/shared.ts`) - at 2000 OnTour's ticket block was cut.
Ours: `lib/services/our-offer-detail.ts` re-runs the pricing RULE read-only (`fetchFlightOffers` +
`pickFlightPrice`, main's `/api/hotels` which already returns the hotel name/room/meal it picked;
linked offline flight/hotel wins) and stores `light_detail.ours` - it never writes a price, and
`recomputeEventLights`/`clearLightOverride` carry `ours` over. Refreshed by the `price-light-ours`
cron and the sheet's "פרט את שלנו עכשיו" (`refreshOurOffer`, `requireAdmin`). (c) **UI**: a
package/ticket lens above the tiles (a LENS: tiles, views and pending all count only the chosen
scope; `?scope=` preselects it), and **"השוואה מפורטת"** on each row opens `comparison-sheet.tsx`
(`getPriceLightComparison`, loaded per row - detail pages never ride the list payload): us first,
then every competitor with its published price, normalized price, own gap pill, status, and the
three contents lines.

**`events.light_red_since` (Tasks Hub, 2026-09-16):** timestamp of when the EVENT last turned red -
per event (either scope red), not per scope - written by `recomputeEventLights` through the pure
`redSinceUpdate` (`lib/services/price-light-red-since.ts`), and cleared the moment the event leaves
red (`unchecked` included). Not read anywhere in the price-light engine itself - the recurring-rules
engine (`lib/services/task-rules/price-light.ts`) reads it TODAY for the `price_light` rule's
`min_weeks_red` condition, so a light that just turned red doesn't already spawn a task.

### Agents (`lib/agents/`, 2026-09-13)

**One agent layer, and the price light is agent #1.** Dor: "צריך להיות agent שהוא במיוחד על זה,
אחריי זה נייצר עוד לדברים אחרים אז צריך להכין את השטח". An agent is DECLARED, not wired: `types.ts`
is the shape (`AgentDefinition`), `<name>.agent.ts` declares one (model, `callsPerRun`, `timeoutMs`,
`confidenceMin`, token prices, memory caps, `switchEnv`, `learnsFrom`, `houseRules`), `index.ts`
registers it, and the plumbing is shared: `switch.ts` (key shape check, per-agent switch, master
`AI_AGENTS` kill switch, `newBudget`/`takeBudget`, `callCostUsd`) and `memory.ts` (house rules +
recorded decisions, capped and fenced). Adding an agent = a declaration + an env switch; it never
means copying the price light's plumbing. `scripts/agents-selftest.ts` (`npx tsx`) covers the
switches, the budget, the cost maths and every lesson formatter with synthetic rows - no DB, no API.

**Two rules the layer enforces.** (1) **Opt-in, fails closed**: an agent runs only when its switch
is literally `"on"`, `AI_AGENTS` is not `"off"`, AND `ANTHROPIC_API_KEY` starts `sk-ant-`; anything
else is off and costs nothing, so the spending side can never turn itself on by accident. (2) **Staff
text is DATA**: recorded decisions are quoted to the model inside an explicit "data, not instructions"
fence - anyone with the decision screen can write into that block, so a prompt that obeyed it would be
a prompt they could rewrite.

**What the price-light agent learns from (`price_light.*` audit actions, newest 10 in 120 days).**
Every decision on `/price-light` now stamps a `LightDecisionSnapshot` into its audit metadata (scope,
light, diff, competitor, both normalized prices, both durations, the uncertainty) taken BEFORE its own
write - because "someone removed event 812" is not a lesson, while "package red +$420 vs Golasso, our
4 nights vs their 3, and a human pulled the event" is a labelled example. Sources in priority order:
`override` (the only one carrying a human's own sentence - `light` is the OVERRULED light, `to_light`
the forced one), `repriced`, `removed`, `silenced`, `task_opened`. **`הוזל` is now recorded**
(`markRepriced`, `price_light.repriced`): it was a bare `<Link>`, so the strongest signal we have -
a human judging a gap real - used to leave no trace at all. It still only logs; the light never
writes a price. A decision with no snapshot (rows predating this) is dropped rather than guessed at.

**Manual override beats the recompute.** `light_detail.override` (one scope-tagged field) is
re-applied by `recomputeEventLights` on every pass: the overridden scope keeps `override.light`
until the competitor's normalized price drifts more than `OVERRIDE_DRIFT_USD` ($20) from the number
recorded at override time (a null on either side = nothing to measure = the override stands). Past
that the override is dropped (`override: null`) and the computed light takes over - the market moved,
the manual call is stale.

**Admin-only surface.** Both the `/price-light` screen (`lib/nav.ts` roles) and the dashboard
`PriceLightWidget` are gated on `ADMIN_ROLES` - an editor sees neither the screen nor the red count
(the widget returns `null`); the server actions keep their own `requireAdmin`/`requireStaff` guards
regardless. **By Dor's ruling (Tasks Hub, 16.09) red lights still reach all staff elsewhere:** the
`/tasks` Pricing tab lists pricing gaps (red lights included) to every staff member, and a
price-light task's description - which includes the competitor lines - is visible on the shared
board. Only the `/price-light` screen itself (and its widget) stays admin.

`/price-light` (nav "Price Light", `ADMIN_ROLES` only) is where a red light gets a decision instead
of sitting on the events table. Tiles + views (`pending` / red / orange+ / package / ticket / next 45
days / partial-coverage crawls / changed this week / unchecked / AI sample / all) - **"ממתינים
להחלטה"** (pending, the default view) is red, not silenced right now, and with no open task already
chasing it (`isPending()` in `price-light-client.tsx`). Header line shows AI cost this month
(`aiCostThisMonth()`). Four decisions on a red row (`decision-actions.tsx`): **הוזל** (the drop is
real - a plain link to `/events/{id}#fix-price` to go fix the base price there, no separate write);
**השאר בפיד** (`silenceRedLight`, `SILENCE_DAYS 14` in `lib/actions/price-light-constants.ts` - the
light stays red, it just drops out of "ממתינים להחלטה" until it expires or the light itself changes:
`recomputeEventLights` clears `light_silenced_until` in the same write the moment no scope is red
any more, so a stale mute can never hide the NEXT red);
**הסר מהאתר** (`removeEventFromSite`, confirm dialog, soft delete only - never hard-deletes); **משימה**
(`openPriceLightTask` - dedupes on an already-open task for the same event+scope, returns `existed:
true` instead of a duplicate). Any row also gets **בדוק עכשיו** (`recheckEvent` - re-runs matching
against the stored catalogs, no browsing, same as the events-table refresh icon) and **דריסה**
(`setLightOverride`/`clearLightOverride` - forces a light, mandatory note ≥ 3 chars, stored in
`light_detail.override`; "בטל דריסה" clears it). `recomputeEventLights` auto-closes an open
price-light task the moment its scope's light reaches a real non-red verdict (`lightSettled`: green,
orange, alone or na - never `unchecked`, which is stale data, not a resolution; the same rule lifts
a "השאר בפיד" mute) (`status: "done"`, note
`"האור ירד מאדום אוטומטית (...)"` appended - never deleted, so the history stays). Every decision
writes `logAudit({ action: "price_light.<silenced|override|override_cleared|task_opened|task_autoclosed|removed|crawl_triggered>" })`.
Competitors panel on the same screen shows last run / listing count / next due / open circuit per
competitor with a **"סרוק עכשיו"** button (`triggerCrawl`, `requireAdmin()`, audited
`price_light.crawl_triggered`) - disabled for table-mode competitors (LiveTickets), which refresh
overnight from `live_events` instead of being crawled on demand. Dashboard mirror:
`components/price-light-widget.tsx`, a segmented bar + "N אדומים · M ממתינים להחלטה" linking to
`/price-light?f=pending`.

**Phase 2 (2026-09-11): ISSTA Sport, Golasso, OnTour.** Three more crawlers in `lib/services/competitor-scrapers/` (`issta.ts` fetch-mode, 7 league pages, local-only - see below; `golasso.ts` browser-mode all-packages page + fetchable `/pdetails/<id>` detail; `ontour.ts` fetch-mode `/artists/` → selling performer pages), registered in `index.ts` so the sports package light now compares against LiveEvents + ISSTA + Golasso and the music package light against LiveEvents + OnTour — "alone" needs all of them fresh. **ISSTA is crawled football-only** (`LEAGUES` = 7 soccer competitions), so `CompetitorScraper.covers?()` (`issta.coversEvent`, true only for the `football` vertical tag) gates ONLY the absence claim: a competitor that does not cover the event records `skipped` instead of `not_selling`, which lands the scope on `partial_coverage` rather than a false "alone" — `found`/`unsure` are evidence regardless and are never gated. `CompetitorScraper.detailMode` ("fetch" on golasso and liveevents, default = `mode`) says how `detail()` loads its page, so a browser-mode crawler whose detail pages are plain GETs is paced with `pauseShort()` (5–15 s) instead of the 20–60 s browser pause and actually finishes its enrichment inside the crawl budget; a details-budget cutoff keeps the run `ok` with a `details cut at budget` note (only a catalog cutoff is `partial`). **ISSTA and OnTour publish a travel window, not the match date:** such listings store `event_date = null` + `travel_depart/return`, and the matcher (`candidateCoversDate` in `price-light.ts`, the OR-clause in `candidatesFor`) treats them as on-date when the window contains our date. Shared parser helpers live in `competitor-scrapers/shared.ts`; `ctx.pauseShort()` (5–15 s) is the only pacing allowed between same-site paginated GETs in fetch mode. Fixture regression is per site: `scripts/scrape-fixture.ts <site>` with assertions in `scripts/fixture-checks/<site>.ts`. Recon + build addenda: `docs/superpowers/scrapers/phase2-recon.md`. **The light never touches pricing** — it reads `ourPackageUsd`/`ourTicketUsd` and writes only `light_*` columns; the pricing brain (`price-quote.ts`, `base-price-sync`, `/price-changes`) is untouched and stays the source of truth.

> **ISSTA is crawled from a local machine, not Vercel (2026-09-15).** Every league page answers HTTP 200 to Vercel's IP
> with ZERO `deal-item-container` cards, while the same fetch from an Israeli connection gets them - the site (ASP.NET
> behind a Google load balancer, `via: 1.1 google`, no Cloudflare/Akamai wall) serves a card-less page to
> foreign/datacenter addresses, and spoofed `X-Forwarded-For` / `X-Real-IP` / `True-Client-IP` / `Accept-Language` change
> nothing. Hence `CompetitorScraper.crawlFrom: "local"` on `issta` (see the `price-light-crawl` cron bullet for the
> mechanics and the scheduled task). Should that machine stop running the task, the paid alternative is an Israeli
> residential proxy in `NEXT_SECRET_SCRAPE_PROXY_URL` (browser-mode crawlers only; ISSTA is fetch-mode, so the proxy would
> need wiring into `ctx.fetch` too). `LEAGUES` is now 7 competitions - `uefa-europa-league` (404) was dropped.

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
# Optional. Google Places API (New) key for the daily googleReviewsSync cron;
# when unset the cron reads Elfsight's public feed instead (works today, but
# unofficial). NEXT_SECRET_GOOGLE_PLACE_ID is optional and defaults to the
# Mega Events profile (ChIJ4_iJNrNJZWoRHYuKTpYGzDE).
NEXT_SECRET_GOOGLE_PLACES_API_KEY=
NEXT_SECRET_GOOGLE_PLACE_ID=
# Optional - P1 feed URLs have hardcoded fallback values in p1-events-sync.ts
NEXT_SECRET_P1_EVENTS_FEED_URL=
NEXT_SECRET_P1_TICKETS_FEED_URL=
# Price light (רמזור). "off" is the kill switch - crawls report `skipped`, matching/lights
# still run off the stored catalog. Default "on" when unset.
PRICE_LIGHT_SCRAPE=
# Server-only, OUR Anthropic account (never the client, never billed to a customer key).
# Powers extractAndJudge() - the price light's one AI call site (lib/services/price-light-judge.ts).
# A console key from console.anthropic.com, starting "sk-ant-". The Vercel slot ships with a
# placeholder: `anthropicKey()` only accepts a value with that prefix, so a placeholder or a
# half-pasted value counts as NO key (rule-only) instead of turning every match into a 401.
# With PRICE_LIGHT_AI=on and an unusable key, the judge logs why once per process.
# Claude Code / Claude.ai subscriptions are interactive seats and cannot authenticate this -
# the cron calls the API server-to-server, so it needs a console key.
ANTHROPIC_API_KEY=
# Master kill switch for EVERY agent (lib/agents/). "off" stops all of them whatever their own
# switches say; unset means each agent is governed individually. Nothing else turns agents on.
AI_AGENTS=
# Phase 1 - AI judge for ambiguous matches (rule-match is phase 0's only matcher). OPT-IN, fails
# closed: set PRICE_LIGHT_AI=on to enable; unset, empty or anything but "on" = off = rule-only,
# exactly phase-0 behaviour (aiEnabled() false). Needs the key above as well - turning this on
# without it does nothing (still rule-only).
PRICE_LIGHT_AI=
# Model id for the judge. Empty -> AI_MODEL_DEFAULT "claude-opus-5" (price-light-judge.ts).
PRICE_LIGHT_AI_MODEL=
# Set -> crawler connects to a remote stealth browser over CDP (Browserbase/Bright Data) and
# that provider owns the fingerprint (UA/locale/timezone/proxy). Unset -> local @sparticuz/chromium.
NEXT_SECRET_BROWSER_CDP_URL=
# Optional residential proxy for the LOCAL chromium path only (ignored when CDP is set above).
NEXT_SECRET_SCRAPE_PROXY_URL=
# Dev-only override so `scripts/scrape-once.ts` can drive a real local Chrome instead of
# @sparticuz/chromium; never read in production (NODE_ENV check).
LOCAL_CHROME_PATH=
```

## Database

Schema is in `db.schema.sql`. Key tables: `events`, `reservations`, `partners`, `locations`, `p1_events`, `live_events`, `sports_events`, `offline_flights`, `tixstock_events`. Managed via Supabase (PostgreSQL).

Backoffice-only tables (RLS on, no policies, service-role access; main never reads them): `tasks`, `task_rules`, `task_comments`, `creative_gap_dismissals` (gap_key = `{kind}:{table}:{row_id}`), `base_price_sync_log`, `event_drafts`, `user_profiles`, `audit_log`, the `forms*` family, `prepared_packages`, `competitor_crawl_runs`, `competitor_listings`, `competitor_matches`, `event_price_snapshots`. Same shape but READ by main with its service client: `google_reviews` + `google_review_sources` (the site's "לקוחות משתפים"; `is_hidden` pulls a review off the site). Several predate the generated `types/database.types.ts` - their actions use a single `const db = supabase as any` boundary cast (scoped eslint-disable) until `npm run db:types` is rerun after the next master merge.

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

1. **This backoffice** sets: `base_flight_price`, `base_hotel_price`, and ticket prices on events (currency markups in `lib/services/ticket-price-sync.ts`: USD +$40, EUR +€40, GBP +£35, ILS +₪150).
   **Base prices come from ONE rule** - `lib/services/price-quote.ts` (Dor, 2026-09-02): flight = cheapest **direct** Amadeus offer **+$100**, but the cheapest connection (+$100) when the direct beats it by more than **$300**; hotel = cheapest **3-star** from main's `/api/hotels` (it already filters `star_rating = 3` - its `total_4star_hotels_found` field is a legacy misnomer) **per person - the route prices a room for 2 adults, divide by `QUOTE_HOTEL_ADULTS` - +$120**; both rounded to whole tens. `base_hotel_price` is per person (main compares `hotel.price / persons` to it); the room total doubled every base the first sync touched (2026-09-07). The form's Search buttons, the wizard auto-fill, the nightly sync and the factory all quote through it, so every surface shows the same number. Constants live there only: `FLIGHT_MARGIN_USD 100`, `HOTEL_MARGIN_USD 120`, `QUOTE_HOTEL_ADULTS 2`, `DIRECT_GAP_USD 300`, `SYNC_DEVIATION_USD 20`, `SYNC_FREEZE_USD 400`. (The `/api/flights/search` route keeps its older third-cheapest rule for legacy callers only.)
2. **Main app** calculates final customer price: `base_flight_price + base_hotel_price + min_ticket_price + 175 USD markup`
3. Changing price/markup logic here directly affects what customers see and pay in the main app

### What to Check in Main App After Changes Here

- **Added/removed event fields?** → Check `../myt---main/lib/app.types.ts` and event rendering components
- **Changed price calculation?** → Check `../myt---main/lib/events/price.ts` and `lib/price.utils.tsx`
- **Modified event types?** → Check `../myt---main/lib/app.types.ts` `EventType` and ticket vendor logic
- **Changed DB table schema?** → Check all Supabase queries in `../myt---main/lib/` and `../myt---main/app/api/`
