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
> **Portal search + page picker (2026-09-18):** `getPackageBuilderEvents` and
> `getQuoteEvents` PAGE the live future events (`fetchPaged`) - the old `.limit(300)`
> cut every event dated after the 300th once the catalog passed 300 (the 2027 tours
> the "מה חדש" carousel advertised were unsearchable), and the tag-links read is
> chunked by 100 events to stay under PostgREST's 1000-row cap. The dashboard search
> is `matchesSearch` over Hebrew name, `name_english`, venue and tag names. The
> site-page picker is its own component (`app/portal/links/site-page-picker.tsx`,
> Hebrew + English search) shown on the portal dashboard AND in `LinkBuilder`; the
> menu has "הלינקים שלי" -> `/portal/packages` again (the V2 menu had dropped the only
> way to reach the picker).
>
> **"לאתר" in the portal menu (2026-09-18) - the portal stays the agent's ONE login.**
> Alon asked for an agent login on main; Dor ruled against a second door. Instead the
> menu button calls `getSiteHandoffLink()` (`portal-package-actions.ts`, sharing
> `handoffUrl` with "הזמנה עבור הלקוח"): a seller lands on main's homepage through
> `/api/partner-handoff` with agent mode live (main's header shows `AgentConnectedBadge`,
> checkout offers agent card / voucher); an influencer has no agent mode and simply
> opens the site through their own tracking link. Do NOT build a partner login on main.
>
> **Entry funnels + demand period (2026-09-30):** the three "entered on" cards
> (staff `/partners/[code]/view`, Insights tab, portal "ביקושים") classify a
> visitor by their FIRST tracked page - `classifyEntry` in
> `lib/partner-entry-funnels.ts`, mirrored as SQL in `partner_entry_funnels_range`
> / `partners_entry_funnels_all` (migration `20260930170000`; selftest
> `scripts/partner-entry-funnels-selftest.ts`). A LEAF of the `artists` / `teams`
> hub (`/c/music/artists/oasis`, `/c/football/teams/liverpool` - where every
> partner link to a person has pointed since 09-11) is an ARTIST entry; the hub
> itself, genres, leagues and destinations stay "other" (the footnote). Before
> this, an influencer had 1,366 of 1,927 monthly visitors in the footnote. The
> portal's demand tab has the same period pills as the staff view
> (`?tab=demand&range=`, default 30 days) and its top picks follow the range.
>
> **Portal history cut-off (2026-09-16):** `partners.portal_history_from`
> (date, null = all) - set in the partner editor ("Portal History From") for a
> partner starting fresh on a code that already has bookings (Aviran: code
> since 03/2025, portal since 09/2026, saw a 06/2025 customer). Every portal
> surface that lists/counts bookings applies it via `lib/portal-history.ts`
> (`portalHistoryFrom` + `fromPortalHistory`): reservations page, dashboard,
> stats, activity feed, user log. **Reporting only** - the monthly report and
> commission maths never read it.

> **✅ Homepage layout board (`/homepage`, 2026-09-16).** Spec
> `docs/superpowers/specs/2026-09-16-homepage-layout-design.md`. One dummy of
> main's homepage where staff drag SECTIONS into order / hide them and pin the
> ITEMS that open each carousel - tables `homepage_sections` (key, position,
> is_visible) and `homepage_items` (section, kind `event|artist|team`, ref_id =
> `events.id` as text or the person SLUG, position); RLS on, no policies, main
> reads them with its service client (`lib/homepageLayout.ts`, `app/page.tsx`).
> Keys mirror `types/homepage.types.ts` ↔ main: `hero` (always first),
> `most_wanted`, `newest`, `football`, `artists`, `reviews`, `more_events`.
> What is NOT pinned follows each section's automatic rule after the pinned
> items (hero: every available artist/team interleaved; most wanted: Prioritized
> then fill, 12 max; newest: `created_at desc`, 12 max, minus most-wanted;
> football/artists: available-first, then name). One Save
> (`saveHomepageLayout`) replaces the whole layout, audits `homepage_layout`,
> pings main's revalidate. **Replaced:** Templates → Homepage Order screens,
> `PeopleOrderList`, `saveRowOrder` and the person "Featured order" field -
> `display_order` / `featured_order` stay as columns, nothing writes them, main
> no longer reads them (the migration backfilled `homepage_items` from both so
> the deploy changed nothing visually). Main's vertical hubs also take their
> cover-strip order from the `hero` pins. The board tolerates the migration not
> being applied yet (default layout, nothing pinned).
>
> **Titles + free blocks (2026-09-18).** Spec
> `docs/superpowers/specs/2026-09-18-homepage-blocks-design.md`. `homepage_sections`
> gained `page` (only `'home'` today - the column is there so another page or brand
> never needs a rewrite), `type` (`builtin` = the seven coded sections, else a block
> type; NO check constraint - new types arrive without a migration), `title` (staff
> heading; null = the coded default for a builtin, no heading for a block) and
> `config` jsonb. A block's key is `blk_` + 8 hex chars, minted by the board; its
> pinned events are ordinary `homepage_items` rows with `section = <block key>`.
> Phase 1 block types: `event_slider` (`{ category_id }` - pins first, then that
> category's events soonest-first, 12 max, same `EventCard size="row"` as "המבוקשים
> ביותר") and `banner` (`{ banners: [{ image_url, link_url, title }] }`, 1-3, rendered
> by main's `ArtistBanners`). Text / destinations / gallery are phase 2 on the same
> columns. **Every rule lives in the pure `lib/homepage/blocks.ts`**
> (`normalizeSections`, `itemKindsFor`, `newBlockKey`; `scripts/homepage-blocks-selftest.ts`):
> a banner image must sit in OUR public Storage, a link is `/path` or `https://`,
> 12 blocks per page, one bad block fails the whole save before any write, builtins
> are never deleted, and only block types this build knows are ever deleted. The
> board's block editors are `app/(dashboard)/homepage/homepage-blocks.tsx`. Before
> the migration runs `getHomepageLayout` falls back to the old columns and returns
> `blocksReady: false` (no pencil, no "+ Add block"). Block types + config shapes
> are mirrored in main's `lib/homepageLayout.ts`; main skips a type it does not know.
> **Phase 2 + Remove in "החדשים" (2026-09-19, staff doc tab "סליידרים הום פייג").** Three
> more block types on the same columns, no migration: `text` (`{ body }` - plain text,
> `TEXT_MAX` 1200, a blank line = a new paragraph; main prints paragraphs, never HTML),
> `destinations` (`{ category_ids, parent_id }` - the chosen category tiles first, then the
> parent's active children; main resolves them in `resolveBlockTiles` and draws the
> football hub's `HubTilesRow`, each tile linking to its `/c/` path; `MAX_DESTINATIONS` 20
> chosen, 24 tiles shown) and `gallery` (`{ images: [{ image_url, alt }] }`, 1-`MAX_GALLERY`
> 12, same our-Storage-only rule as a banner; one scrolling row on main). **`newest` is the
> one BUILTIN with a config:** `{ hidden_event_ids }` = events staff removed from the
> AUTOMATIC part of the row with the auto card's **Remove** (part of Save, unlike "המבוקשים"
> where Remove drops the Prioritized flag at once). `parseBuiltinConfig` is lenient (a
> builtin can never fail a save), caps at `MAX_HIDDEN_EVENTS` 100 keeping the newest
> removals; pinning a hidden event un-hides it, and main never filters a PIN - only the
> automatic fill (`layout.hiddenEventIds.newest`). Removed events show as restore chips
> under the strip. The Pin button and a legend line under every strip with auto cards say
> what Pin / Remove do (Alon asked "מה עושה ה-PIN?"). Deploy order does not matter: an
> older main skips block types it does not know and ignores the builtin config.
>
> **Event thumbnails on the board** (`lib/homepage/event-art.ts`, pure, same selftest):
> most events carry no image of their own, so a card borrows its artist's / HOME team's
> picture the way the site does (main `lib/events/fallbackImage.ts`; names matched by
> main's rule, mirrored in `lib/on-tour.ts`). An approximation - the site also rotates
> gallery cut-outs and draws "crest VS crest"; the board only needs to be recognisable.

> **✅ Marketing dashboard (`/marketing`, 2026-10-08).** Spec
> `docs/superpowers/specs/2026-10-08-marketing-dashboard-design.md`, plan
> `docs/superpowers/plans/2026-10-08-marketing-dashboard.md`, migration
> `20261008120000_marketing_dashboard.sql`. One screen (nav group Marketing, `ADMIN_ROLES`, every
> action `requireAdmin()`) over Meta + Google Ads spend, Instagram and OUR paid orders - **read
> only against the ad accounts** (the Meta write token sits in the env but nothing reads it: no
> campaign pause/resume this round). Five tabs on `UrlTabs` (`?tab=`): **Executive** `exec` (cards
> Spend / Revenue / COGS / Net profit vs `monthly_profit_target_usd` / CAC / ROAS / POAS + a daily
> spend-vs-revenue chart; `?range=` 7d / 30d / 90d / month and `?brand=` default Mega Events, both
> kept in the URL), **Media** `media` (campaign `DataTable`, a row opens its adsets / ad groups, plus
> the "Unresolved", "Unattributed" and "Other brand campaign" cards), **Instagram** `instagram` (media grid,
> "Viral" badge), **Alerts** `alerts`, **Settings** `settings` (fee %, profit target, alert thresholds
> + emails, a brand select per campaign, "Sync now" = `runMarketingSyncNow`, 240 s budget inside
> the page's `maxDuration` 300 - page.tsx + `vercel.json`, like `/price-light`; the brand table
> reloads in place when it ends). The Settings tab loads with ONE action (`getMarketingSettingsPage`).
> Settings are validated by the pure `validateSettingsPatch` (`lib/marketing/settings.ts`, selftest
> `marketing-settings`: fee 0-100, days integer 1-60, viral 50-1000, bleed ₪0-1,000,000, target
> $0-100M, at most 10 deduped emails) BEFORE anything is read or written. Display currency
> is USD; the P&L read is cached 300 s (`unstable_cache`, tag `marketing-pnl`,
> `lib/services/marketing-cache.ts`; an ops save of the actual cost drops it); every write is audited
> (`marketing.settings` / `marketing.brand` / `marketing.sync_triggered`). Paged reads go through ONE
> `readAll` (`lib/services/marketing-db.ts`: order by the table's key, dedupe by it, throw past the
> cap). The sync is the `marketingSync` cron (cron list).
>
> **Phase 0 - the numbers are real** (pure, `lib/services/reservation-pnl.ts`). Revenue =
> `user_shown_price` (USD, the coupon is already inside it - never subtracted again) minus
> `agent_card_discount_ils / (exchange_rate_usd_ils_100 / 100)` when `partner_settlement_method`
> is `agent_card`; Paid only. COGS = flight (offline: `offline_flight_cost`; Amadeus:
> `offer.price.grandTotal` + bags at cost) + hotel (offline: `offline_hotel_cost`; else
> `hotel_order_info.price` plus the other `hotel_segments`) + ticket = `reservations.ticket_cost_usd`,
> where `ticket_cost_source` says who wrote it: `live` (main's confirm-order, LiveTickets +
> TixStock), `estimated` (the sync's `cogs` step, `lib/services/reservation-cogs-fill.ts`:
> LiveTickets' category cost, XS2Event's net rate, else the markup inverted `price / 1.035 - 40`;
> 200 Paid reservations of the last 120 days per run, never over a `live` / `manual` cost; stops 20 s
> before the run's budget and reports `remaining`) or `manual` (RESERVED - nothing writes it yet; ops'
> real cost goes to `actual_cost_usd`). A ticket with no snapshot falls back to its SALE price flagged estimated, and ops'
> **`actual_cost_usd`** (reservation edit page, "Actual supplier cost (USD)" + `actual_cost_note`)
> beats the whole computed COGS. Anything standing in for a real cost shows "N estimated". Partner
> commission is deliberately NOT in COGS (the partner P&L on `/partners` owns it; counting it here
> would double-count against attribution). The dashboard's `pax * 175` "Est. Margin" is gone: its
> card is "Revenue" = `revenueUsd` of every Paid booking. Net = revenue - COGS - fee - spend;
> POAS = net / spend, ROAS = revenue / spend, CAC = spend / purchases
> (`lib/services/marketing-pnl.ts`). Those cards cover the orders credited to a paid campaign (the
> chosen brand's, plus each platform's unresolved ones - those only for Mega Events / all, never for
> "other": an unresolved touch is a click on OUR links). **Revenue never drops out of a brand view:**
> a booking whose resolved campaign is outside the brand - or has no `ad_entities` row (no known brand
> = "other", the same predicate the spend side uses) - lands in `Pnl.otherBrand` ("Other brand
> campaign"), printed beside the cards with "Unattributed", never inside. The net card is **"Net profit from media"**
> (`totals.netUsd`) with the "Unattributed" and "Other brand" nets under it; the monthly target (month range)
> is held against the ALL-IN net = media + unattributed + other brand ("Target ... vs all-in net $X").
> Ranges are N calendar days INCLUSIVE of today (`rangeWindow`: 30d on 10-08 = 09-09..10-08).
>
> **Attribution = last PAID touch** (`lib/services/marketing-attribution.ts`: `paidTouchOf` over
> the reservation's `utm_touches`, position 0 = the credited one first; an influencer touch at position 0 is never itself
> counted as paid - the scan goes on to the older touches). The join keys are ids, never campaign NAMES: Meta (`utm_source` facebook /
> fb / ig / instagram / meta, or an `fbclid`) = `utm_content`, the numeric ad id, resolved through
> `ad_entities` kind `ad` to its adset + campaign - and when `utm_campaign` is itself a Meta id (the
> feed campaign) that IS the campaign and `utm_term` the adset; Google = the `gclid` through
> `ad_clicks` (filled from `click_view`, kept 100 days) or `utm_source=google` + `utm_medium=cpc`.
> A paid touch that cannot be resolved stays visible as "Meta · unresolved" / "Google · unresolved" with its
> revenue; no paid touch at all = "Unattributed" (organic, direct, partner). **Brand**
> (`lib/services/ads/brand.ts`): ONE Meta account and ONE Google customer serve MYT / Mega Family /
> Mega TR, so each campaign is `mega_events` when its name says so (MYT, מייטי, Mega Events, מגה
> אירועים) OR any of its ads lands on `mega-events.co.il` (`pickLandingDomain` - a mixed campaign is
> ours), else `other`. The sync re-derives `brand_source = 'rule'` rows; a brand picked on the
> Settings tab is `manual` and the sync never touches it ("By rule" hands it back).
>
> **Alerts** (`lib/services/marketing-alerts.ts`, mail through `sendMail`, no Slack):
> `budget_bleed` "Budget bleed" - a Mega Events campaign past `budget_bleed_ils` (1,500) in
> `budget_bleed_days` (3) with zero attributed purchases; `viral_post` "Viral post" - an IG post (not a
> story, 24 h old, published within `VIRAL_MAX_AGE_DAYS` 7) whose engagement beats `viral_pct` (200) %
> of the mean of the 30 before it (the grid badge reads the same rule, `lib/marketing/engagement.ts`,
> WITHOUT the age cap - it is a display; both read the newest `IG_MEDIA_READ` 200 posts). The mail, the
> tab and the guide use the same two names (`ALERT_KIND_LABEL`). `marketing_alerts` dedupes: mailed once when first seen,
> again only after the condition cleared and fired anew; `last_mailed_at` is stamped BEFORE the send
> and cleared if the send fails (retried next run). Recipients = `alert_emails`, else
> `NEXT_SECRET_ADMIN_EMAIL`. Thresholds live in `marketing_settings`, never
> in code. **Pure modules + selftests** (`npx tsx scripts/<name>-selftest.ts`): `reservation-pnl`,
> `ad-brand`, `reservation-cogs` (`estimateTicketCostUsd`), `marketing-attribution`, `marketing-pnl`,
> `marketing-alerts`, `marketing-settings`. **Main side** (myt-main `eff67c5`, hardened in `971c78e`;
> deploy AFTER the backoffice migration):
> confirm-order snapshots the ticket's supplier cost into `ticket_cost_usd` /
> `ticket_cost_source = 'live'` (`lib/ticket-cost.ts`: LiveTickets' offer cost; TixStock = the raw
> `proceed_price` of the listing the site would sell, `lib/tixstock-feed.ts`; neither carries our
> markup or the 3.5 %; the snapshot has a 3 s deadline, so a slow supplier never holds up a checkout),
> and the confirmation page sends the REAL `user_shown_price` as the `purchase` value (GTM no longer
> fires `value || 1500`; the GA4 item `price` is per UNIT = total / quantity). The insert retry is
> STAGED (`lib/reservation-insert.ts`, tested): the cost step retries on `42703` OR `PGRST204` and
> strips only the two cost keys; the settlement step retries on `42703` only and strips the
> settlement keys too - so before the migration an `agent_card` order is never charged in full. The public
> `/api/livetickets/tickets` strips the cost fields. **Deferred on purpose:** campaign pause/resume
> (write token, expires 2026-11-27), traffic / CVR (GA4 Data API), Search Console, Clarity, Ads
> Library, retiring Mixpanel in main - they wait for the accesses in the doc "גישות חסרות -
> דשבורד שיווק". **Operational:** apply the migration (it rides the push to master, never from a
> branch) BEFORE the cron's first prod tick, else every tick fails on the missing tables and mails
> Dor; then `npm run db:types`; the ten secrets go to Vercel (env block below); the first real run
> is `?backfill_days=90`.

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
>   **Table chrome (2026-09-30):** a `DataTable` scrolls INSIDE its card from `md` up
>   (`max-h: 100svh - 9rem`) with a sticky header, so the sideways bar is always in reach;
>   a LAST column whose id is `"actions"` is pinned to the trailing edge (name a row-actions
>   column `actions` and it never hides behind a sideways scroll); edge shadows say when
>   columns are cut off; header sort buttons are normalized in one place (`HEADER_BUTTON`);
>   a search resets to page 1 and the page index is clamped when rows shrink.
>   `DataTableSkeleton` is the loading state for list screens. **Scrollbars** are themed in
>   `app/globals.css`; add `scrollbar-rail` to a side rail (sidebar nav, guide contents,
>   `EditorRail`) - its thumb shows on hover only. A pin is skipped when that column is wider
>   than `PIN_MAX_SHARE` (35%) of the table (price-changes' four labelled buttons). A hand-built
>   `<Table look="list">` (users, audit log, forms, offline flights/hotels, templates) wears the
>   same header + density by swapping the primitive's DEFAULTS only - a cell's own className
>   still wins; the portal keeps `default`. **Search boxes** are `components/search-input.tsx`
>   (`SearchInput`: glass, clear button, Esc, logical sides for RTL) - used by DataTable and
>   every list screen; do not draw another.
>   **A refresh keeps your place (2026-10-01).** Screens held their tab / view / filters in
>   `useState`, so F5 reset them (Tasks READ `?tab=` on arrival and never wrote it). One rule,
>   pure in `lib/view-state.ts` (`scripts/view-state-selftest.ts`), two hooks in
>   `hooks/use-view-state.ts`: **which tab / view I am on -> the URL** (`useUrlState`, or
>   `components/url-tabs.tsx` `UrlTabs` for a screen's main tabs; `history.replaceState`, the
>   default value is never written); **how I narrowed the list -> `sessionStorage`**
>   (`useSessionState`, a drop-in for `useState`, key `myt:view:<path>:<name>`; a stored value
>   that lost the default's shape is ignored). `DataTable` remembers search / sort / page /
>   hidden columns by itself (key from the column ids; pass `stateKey` when the columns change
>   with the data - price-light). New screen: use these, not a bare `useState`, for anything a
>   refresh should keep. `useSessionState` reads storage on first render, so it is for
>   dashboard content only (mounted after the session check), never server-rendered markup.
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
> - **Tasks Hub (2026-09-16, in prod - PR #38, migration
>   `supabase/migrations/20260916210000_tasks_hub.sql` applied).**
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
>   - **Who gets mailed (2026-09-18):** assignment -> the assignee (`task-notify.ts`,
>     returns `sent`/`skipped`/`failed`; `createTask`/`updateTask` pass it back as
>     `mail` and the dialog's toast says what happened - it no longer promises a mail).
>     `@mention` -> the mentioned. New in `lib/services/task-watch-notify.ts`: a task
>     marked **done** mails its creator; a new **comment** mails creator + assignee (19.09: the whole conversation - see below) -
>     never the actor, never someone the mention mail already covers. Every send/skip
>     is logged (`tasks: <kind> mail sent|skipped|failed for task <id>`), so Vercel logs
>     can tell "sent" from "never tried". Rule-made tasks have no human creator.
>     **Inline thread:** a row click (or the speech-bubble button) on the Tasks table
>     opens `TaskThread` under the row - `DataTable`'s optional `onRowClick` /
>     `expandedRowId` / `renderExpandedRow` (clicks on controls inside the row are
>     ignored). **Site link:** `TaskWithNames.site_url` (`lib/services/task-site-url.ts`:
>     events -> `/order/{id}`, teams/artists -> legacy routes, categories -> `/c/` path)
>     renders as "באתר" next to "Do:"; the Pricing tab has the same link per row and its
>     gap filter is a two-thumb range slider (`components/ui/slider.tsx` renders one
>     thumb per value).
>   - **Unread comments + reply mails (2026-09-19).** One pure rule,
>     `lib/tasks/thread-watch.ts` (`scripts/task-thread-selftest.ts`): a conversation
>     belongs to the task's creator, its assignee, and whoever wrote or was @mentioned
>     in it. (a) **Mail:** a new comment mails all of them (`commentMailTargets`) - so a
>     REPLY reaches the person it answers, not only creator + assignee - minus the author
>     and the people this comment mentions (the mention mail covers them). Both mails
>     carry the comment itself (`commentForMail`, 2000 chars), not a 300-char teaser.
>     (b) **Unread marker:** table `task_reads` (task_id, user_id, last_read_at; migration
>     `20260919100000`), stamped by `loadTaskThread` every time `TaskThread` loads (never
>     while impersonating). `TaskWithNames.unread_count` (`unreadCounts`) = comments by
>     someone else newer than the viewer's stamp, ONLY on tasks whose conversation they
>     are part of - the whole board is visible to everyone, a dot on every commented task
>     would mark nothing. Shown on the table's speech bubble ("N חדשות"), as a dot on
>     kanban / roadmap cards, and as a "חדש" tag on those comments inside the thread
>     (what was unread when it OPENED). A failed `task_reads` read (table not migrated
>     yet) = nothing unread, never "everything unread". (c) A comment's edit / delete are
>     icon buttons in its header (delete asks once); rules unchanged - the author edits
>     and deletes their own, an admin deletes anyone's but never edits.
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
>     The **Task rules** tab (`/tasks?tab=rules`, admin only; `/tasks/rules` redirects there) is where a rule's domain, match filter,
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
>     **One card per GENERAL task (2026-10-05, Dor: "תת משימה לא צריכה להופיע כמשימה לבדה").**
>     The Kanban and the Roadmap / Marketing maps never draw a sub-task as a card: `generalTasks(visible, all)`
>     (pure, `lib/tasks/subtasks.ts`, with `partsByTask` + `subtaskProgress`; selftest `scripts/kanban-selftest.ts`)
>     maps every part the filters matched to the task it belongs to, deduped - so "המשימות שלי" still shows the
>     general task that holds MY part (nothing of mine drops off), with an "x/y" on the card. A part whose general
>     task is gone from the board stays a card. The TABLE is unchanged (a part sits under its task, "חלק מ:"), and so
>     are the counts (board pills, owner filter, view tabs count parts as tasks) and the dashboard widget.
>   - **Opening a task = ONE action (2026-10-05).** Next sends a tab's server actions one at a time
>     (`app-router-instance.js` `runRemainingActions`), and every action pays its guard again - so N loads fired on
>     mount are N waits in a row. Opening one task was 5 actions / 23 DB round trips (measured). Now `loadTaskThread`
>     (`task-comment-actions.ts`) returns the comments, the read stamp and - only when nobody handed them in - the
>     people, with one guard and everything independent read side by side (the rows are handed out only after the
>     task is confirmed to be the company's; nothing is stamped when the thread read failed). `/tasks` loads the
>     company's people ONCE and passes them to `TaskEditor` (`people`) and every `TaskThread`; a screen that passes
>     none (price-changes) still works - the dialog and the thread load their own. `listTasks`' thread chunks run
>     concurrently (`idChunks`). **New screen rule: do not fire several read actions on mount - load them in one.**
>   - **A picture inside a comment + a bigger writing box (2026-10-06, Alon: "could not put a screenshot
    under the line I wrote, and the bubble is tiny").** A comment's pictures are still its
    `attachments`; what is new is a marker in the text - `[תמונה N]` = the comment's N-th attachment,
    drawn at that spot (pure `lib/tasks/inline-images.ts`, in `scripts/task-thread-selftest.ts`).
    A pasted / attached picture puts its marker at the cursor on a line of its own; the composer
    numbers pictures as they arrive and `renumberImageTokens` rewrites them to final positions on
    send; removing a picture removes its marker; a picture with no marker (and every PDF) stays in
    the row under the comment. The marker is readable Hebrew on purpose - mails quote the comment
    as text. No migration, nothing server-side changed. The composer and the edit box grow with the
    text (up to 60% of the screen).
  - **Pricing board + bulk bar + sub-tasks (2026-09-28, doc tab "באגים ושיפורים" section "טסקס",
>     migration `20260928120000_tasks_pricing_board_subtasks.sql`).** A fourth board `pricing`
>     (`TASK_BOARDS`, `BOARD_META` "תמחור"): `defaultBoardFor(source)` (`lib/task-boards.ts`) puts
>     `price_light` / `price_review` tasks there (createTask, `openPriceLightTask`'s insert, the
>     editor's prefill); the migration moved the open ones, their rules' digests and the price rules
>     themselves off `ops` (32 of ops' 37 open tasks were price lights). The rules form's board
>     follows the domain while it is still a default. **Bulk bar** (admins): the table ticks rows and
>     `bulkUpdateTasks(ids, { assignee_id | board | status })` - one UPDATE for assignee/board with an
>     activity row per task, status via `setTaskStatus` per task (gap closing unchanged), and ONE
>     mail per recipient (`notifyTasksAssigned`, `sendTaskListMail` shared with the rule summary).
>     **Sub-tasks:** `tasks.parent_id` (FK, one level - createTask refuses a parent that is itself a
>     sub-task; only an admin or the parent's assignee/creator may split). A sub-task inherits board,
>     phase and channel, is an ordinary task (own status, thread, mails), sits right under its
>     parent in the table ("חלק מ:"), and the parent shows done/total (`subtaskProgress`, cancelled
>     parts excluded). Panel: `components/task-subtasks.tsx`, in the expanded row and the dialog
>     (TaskEditor's children slot). The parent is never auto-closed.
>   - **New-task extras + owner filter (2026-09-30, Dor's six notes).** (a) The New-task form takes
>     **files** (up to 5, images or a PDF - `sniffAttachmentMime`, 2.5MB; paste works) and **sub-task
>     drafts**; both need the new id, so `TaskEditor.saveExtras` writes them right AFTER `createTask`:
>     uploads via `lib/tasks/attachment-upload.ts` (shared with the thread composer), then
>     `attachFilesToNewTask` puts them in the task's FIRST comment (creator only, empty thread only,
>     NO mail - the assignment mail just went out), then one `createTask({ parent_id })` per part.
>     A failure there never loses the task: the toast lists what did not go through. A thread shows a
>     PDF as a named chip (new tab), not a thumbnail. (b) **Owner filter** replaces the "המשימות שלי"
>     switch on the table and the Kanban (`lib/tasks/owner-filter.ts`, pure, in
>     `scripts/task-thread-selftest.ts`): all / mine / "ששייכתי לאחרים" for everyone, plus per-person
>     and "ללא שיוך" for admins, each with its open count. "Assigned by me" is
>     `TaskWithNames.assigned_by` = the author of the newest `assignee` activity row that landed on
>     the current owner, else `created_by` - NOT `created_by` alone, or a bulk-assigned rule task
>     (no creator) would belong to nobody. (c) The board pills count OPEN tasks only. (d) "New task"
>     under a board pill opens on that board. (e) Bulk-bar selects carry `text-foreground` (the bar is
>     `bg-primary`; the inherited light text made their placeholders invisible).
>   - **"In review" status (2026-09-30).** `review` sits between `paused` and `done`, counts as OPEN
>     (`OPEN_TASK_STATUSES`), and needed no migration (`tasks.status` has no CHECK). Meaning: the
>     assignee finished their side and hands the task BACK - the assignee is NOT changed (it is the
>     record of who did the work), what changes is whose move it is. Every rule is pure in
>     `lib/tasks/review.ts` (selftest `scripts/task-thread-selftest.ts`): `reviewerOf` = `created_by`,
>     else (a rule-made task) whoever assigned it; `awaitsReviewBy`; `canChangeStatus` = admin, the
>     owner, or the reviewer WHILE the task waits for them (`setTaskStatus` enforces the same - a
>     non-admin reviewer's update is scoped `status = 'review'`); `reviewMove` names the three mails
>     (`task-watch-notify.ts`): into review -> the reviewer (`notifyTaskReview`, its outcome returned
>     as `mail`, the board toasts it), review -> done = "אושרה" and review -> todo/in_progress/paused
>     = "הוחזרה אליך", both to the assignee (`notifyReviewOutcome`); never to the actor. A task in
>     review shows in its reviewer's "המשימות שלי" (`matchesOwner`) with a "לבדיקה שלך" badge, and in
>     their dashboard widget (`listMyOpenTasks` = my working tasks + tasks in review I created; a
>     task I sent to review leaves MY widget). Gap tasks: review keeps the gap open (`gapAction`).
>     **Picked reviewers (same day):** `tasks.reviewer_ids uuid[]` (migration `20260930203000`,
>     GIN index; `types/database.types.ts` hand-patched - `npm run db:types` yields the same) -
>     "Alon opened it, but Tom checks it, or both". `reviewersOf` = the picked ids when any, else
>     the creator / assigner fallback; every reviewer is mailed, sees the task in "המשימות שלי" and
>     the widget (`reviewer_ids.cs.{me}` OR null + `created_by`), and may move it while it waits.
>     Picked on the task form ("Reviewers", chips + "הוסף בודק…", staff via `listStaffForMentions`
>     so an editor can pick one for their own new task); on an existing task it is admin-only
>     (`TASK_FIELDS`). Validated server-side (`cleanReviewerIds`: active staff ids, `REVIEWERS_MAX`
>     5; `[]`/null = back to the default). The table prints "בודק: X, Y" under the assignee only
>     when someone was picked.
>     **"In review" view (2026-10-05):** the Tasks table's views are **Open / In review / Done /
>     All** (`?view=review`; `TASK_VIEWS`, `taskViewOf`, `inTaskView` in `lib/tasks/review.ts`,
>     same selftest). A task in review LEAVES "Open" (= todo / in_progress / paused, the work
>     still to do) and waits under "In review", where what waits for the VIEWER's check sorts
>     first (`reviewRank`). Only the table's piles changed: `review` is still an OPEN status
>     everywhere else (`OPEN_TASK_STATUSES` - board pills, owner-filter counts, the dashboard
>     widget), so a board pill reads Open + In review together.
>   - **Editors assign + reminders + late alerts (2026-10-01).** (a) Liz (`editor`) could not give a
>     task to anyone - `createTask` forced `assignee_id = session.sub` and the form hid "Assign to".
>     Now any staff member picks any assignee on a NEW task (an editor's form starts on themself;
>     the id is validated server-side, `cleanAssigneeId`), and `editableFields(role, isOwn,
>     isOpenedByMe)` lets an editor change `assignee_id` on a task assigned to them (plus status /
>     progress) or one they opened; `updateTask` reads the owner first and scopes its write by
>     assignee or creator. The sub-task panel and the form's drafts offer the picker to editors.
>     (b) **Reminder button** (bell at the row's end, "תזכורת" in the dialog header,
>     `components/task-remind-button.tsx` -> `remindTask`): mails whoever holds the next move -
>     the assignee, or the reviewers while in review (`reminderTargets`) - shown to an admin or
>     anyone the task belongs to (`canRemind`), one per task per hour (`REMINDER_COOLDOWN_MS`),
>     recorded as a `reminder` activity row. (c) **Late without an answer** (`lateWithoutAnswer`,
>     pure in `lib/tasks/reminders.ts`, selftest `scripts/task-thread-selftest.ts`): a
>     working-status task (todo / in_progress / paused - not review) past its due date (Israel
>     calendar, `israelDate`) whose ASSIGNEE wrote or changed nothing on it since the due day and
>     since it reached them; a task someone opened for themself never counts.
>     `TaskWithNames.late` -> red "באיחור, בלי מענה" tag + red due date, owner filter "late"
>     (= late tasks I opened, `openerOf` = creator, else assigner) and a banner above the tabs.
>     The cron `taskOverdueAlerts` mails each opener ONE digest
>     (`lib/services/task-overdue-alerts.ts`, `task-reminder-notify.ts`) and writes an
>     `overdue_alert` activity row (author null) per task - the dedupe: raised again only after
>     `OVERDUE_REALERT_DAYS` (3); a skipped / failed mail writes nothing and retries next run.
>     Both new activity kinds are in `ACTIVITY_FIELDS`; no migration (activity is jsonb, no CHECK).
>     Dry run on prod 01.10: 23 assigned tasks overdue, 9 late without an answer (Alon 7).
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
>   - **Roadmap + Marketing tabs** (`?tab=roadmap`, `?tab=marketing`,
>     `app/(dashboard)/tasks/task-map-view.tsx`, pure grouping in
>     `lib/tasks/roadmap.ts` + `scripts/roadmap-selftest.ts`): the old standalone
>     RoadMap app lives here now (Dor, 16.09 - its data was NOT imported; the board
>     started empty and the import script was removed). Roadmap = `dev` tasks by
>     phase 1-7 (+ "ללא פאזה"), Marketing = `marketing` tasks by channel with mean
>     progress (a done task counts 100). Cancelled tasks are off the map. Both read
>     the whole board (own search + assignee filter, not the board lens or the
>     my-tasks switch); "+" in a section opens the task dialog pre-placed there
>     (`TaskEditorState.defaults`). The `roadmap` task source stays in the type
>     list but nothing writes it any more.
> - **Pricing brain:** `lib/services/price-quote.ts` - see "Price Logic Chain".
>   Nightly `base-price-sync` cron + `/price-changes` review screen
>   (`base_price_sync_log`).
> - **Event creation automation:** stadium memory, background base-price
>   auto-fill, nearest-location IATA, multi-team batch, batch from every
>   provider, and the `/factory` draft grid (`event_drafts`) - see "Event
>   creation automation".
> - **`/guide`:** bilingual (EN/HE toggle, Hebrew default) system manual for staff, content in
>   `app/(dashboard)/guide/guide-content.ts`. **When a flow described there
>   changes, update it in the same PR.** Laid out like the sidebar (2026-09-30): every
>   section names its menu screen (`nav` = the `lib/nav.ts` href, or `"start"`) and
>   `guide-model.ts` groups them under the sidebar's own headings, so a new menu screen
>   shows up by itself. `howTo` = numbered step-by-step recipes; any text may carry
>   `[label](/path)` links, and EVERY guide link opens in a new tab. Search reads both
>   languages. **Every screen's top bar has "Guide"** (`components/topbar.tsx`, 30.09): it opens
>   `/guide#nav-<screen>` in a new tab - `guideLinkFor` in `lib/guide-link.ts` picks the most
>   specific menu item covering the path (a sub-screen -> its parent, no match -> the guide's
>   top); hidden on /guide and for `forms_operator`. `npx tsx scripts/guide-selftest.ts` fails when a menu screen has no
>   section, a text lacks a language, or a link has no route - run it after adding a
>   screen or a link.
> - **Typed DB client (2026-09-16):** `supabaseTyped` (`lib/supabase-server.ts`) is the
>   same client typed with `types/database.types.ts` - the plain `supabase` export is
>   untyped (rows resolve to `never`), which is why older code casts it to `any`. The
>   Tasks Hub files use `supabaseTyped`; new code should too. jsonb-column shapes must be
>   `type` aliases, not `interface`s, to be assignable to `Json`.

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
>   Amadeus prod, `map-proxy`, `proxy-image`, `dashboard/counts`) - add auth or shared-secret + rate
>   limit. **Closed 2026-10-05:** the eight provider routes (`live-events/{events,tickets,categories,performers}`,
>   `tixstock/{events,tickets}`, `p1-events/events`, `sports-events/live-tickets`) answered anyone with no session
>   (`live-events/events` = the whole supplier catalog, 5.8MB a call); they now start with `guardAdminRoute()`.
>   Only dashboard client code calls them (relative fetch, staff cookie) - main and the portal never did.
>   `middleware.ts` skips `/api`, so **every new route handler needs its own guard on the first line.**
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

**Where it runs (2026-10-05).** The database is Supabase `eu-central-1` (Frankfurt); `vercel.json` pins the functions to
`fra1` (`"regions"`), the same city. Until then they ran in `iad1` (Washington) - Vercel's default - so every DB query
crossed the Atlantic: measured from Israel, a function call with no DB took 0.34s and each query added ~0.1s (myt-main
already ran in `fra1`, set in its project settings). Keep the two together; check with
`curl -sI <prod>/api/exchange-rates | grep x-vercel-id` (`edge::function-region::id`).
**Two rules the 05.10 load check produced:** (1) a plain select answers 1,000 rows at most and says nothing -
anything that can pass 1,000 is read in pages (`lib/supabase-paged.ts` `fetchPaged`; a table with no `id` pages on its
own key, e.g. `allLinkRows` in `event-taxonomy-actions.ts` - the events table showed tags for 516 of 823 live events
until then, and `/price-changes` lost its oldest 284 log rows). (2) server actions of one tab run one at a time - see
"Opening a task = ONE action" under Tasks Hub. DB statistics: `npx supabase inspect db
table-stats|index-stats|db-stats|bloat|vacuum-stats|outliers --linked` (read-only, no password needed).
**Load check 2026-10-07 (migration `20261007062437`).** Measured, not inferred: the database runs on Supabase's smallest
machine (Micro: 2 shared cores, 1 GB). CPU ~3%, 12 of 60 connections, 0 deadlocks - but swap was 74% full and moving,
because the data (906 MB: `hotels` 617 MB, `tixstock_events` 134 MB) does not fit in memory; a cold read of a simple
query can take 5-8 s. Vercel showed no load problem (0 throttles, ~0 timeouts). What the check changed:
(1) **TixStock browse (`app/api/tixstock/events/route.ts`) takes no exact count** - a count reads the whole 116 MB table
(90,000 of its 105,000 rows are future events with zero tickets) and that is what answered 500 on 06.10. "Has tickets" is
read as TWO plain filters (`ticket_count > 0`; `ticket_count is null` + synced lately), each through its own partial
index, and merged in the route - **written as one OR neither index applies**. The checkbox's "(~N)" is the planner's
estimate (`count: "planned"`, 89,535 against 89,543 real). (2) **No index on a column a sync rewrites on every row**
(`updated_at`, `last_synced`): it turns the sync's cheap (HOT) updates into full ones. (3) **A company's site reads its schema through its OWN role (migrations `20261007080556` + `20261007081943`).** The
views of `c_<slug>` are SECURITY DEFINER on purpose (one company, published rows, fixed columns; some values are derived
from tables the site must never read - seats left from bookings, flights from our inventory). While `anon` could read
them the advisor raised each as a critical "Security Definer View", and its fix - `security_invoker = on`, pressed by
hand three times - cut the site off ("permission denied for table ..."; mega-family's build-time sync then keeps its old
JSON WITHOUT an error) until the next tours migration re-created the views; that loop is why the errors "kept coming
back". Now: role `site_megafamily` (a Supabase secret key with `secret_jwt_template {"role": "site_megafamily"}`, in the
site's Vercel env as `CONTENT_SUPABASE_SITE_KEY`) reads the schema; `anon` / `authenticated` have nothing there, so the
advisor is silent and the public anon key no longer reads the views or calls `submit_lead` / `site_booking`. **The rule
lives in ONE function, `public.secure_company_schema(schema)`, which `reprovision_all_companies()` runs after every
provision and which fails if anything in the schema is still open.** `provision_company()` is re-pasted whole into each
tours migration and still carries `grant ... to anon` lines - dead letters, the wrapper's secure step has the last word;
so **always call `reprovision_all_companies()`, never a bare `provision_company()`**, and **never set `security_invoker`
on a site view**. A new company's site: mint its key the same way (role `site_<slug>`). `rls_enabled_no_policy` on
every table is the design (service role only). Read the notes with
`GET https://api.supabase.com/v1/projects/<ref>/advisors/{performance|security}` and run read-only SQL with
`POST .../database/query` `{ query, read_only: true }` (both take `SUPABASE_ACCESS_TOKEN`).

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
- **Delete, escorts, PDF (2026-09-30).** (a) The popup's **מחיקה** (staff AND `forms_operator`)
  SOFT-deletes an irrelevant response: `form_responses.is_deleted` ("MM-DD-YYYY", migration
  `20260930120000`), `deleteFormResponse` / `restoreFormResponse` (the toast's "ביטול"), audit
  `delete` / `restore` with the answers in metadata. Every read skips it - report, `/forms`
  count, xlsx - through `liveRowsQuery` (`lib/forms/soft-delete.ts`), which re-reads
  unfiltered on 42703/PGRST204 so the forms area survives a deploy that beat its migration. The
  invite is left alone. A TRIP LINK the user does not need goes the same way: the bin at the end
  of its report row → `deleteTripLink` / `restoreTripLink` (`form_invites.is_deleted`, migration
  `20260930150000`), only for an EMPTY trip (server re-counts live responses); a removed link
  leaves the report and the links list and stops taking answers (`getPublicFormByToken` /
  `submitFormResponse` skip it). (b) **One filter rule** for the screen and the PDF, pure in
  `lib/forms/report.ts` (`filterTrips`, `responsesOfTrips`, `summarizeTrips`,
  `tripFiltersToQuery`/`FromQuery`; selftest `scripts/forms-report-selftest.ts`): code, escort
  (part match, `escortKey` = trimmed / spaces collapsed / lower case), departure from / to, year,
  one trip. (c) **Escorts** = the first short_text STAFF answer of a trip link.
  `buildEscortRows` (tab "Escorts": trips, first/last departure, average, `trend` = latest rated
  trip vs the flat average of their earlier ones) and `compareWithEscortPast` (an open trip vs
  the same escort's EARLIER trips per question, plus every other response as the house average;
  always over the unfiltered trips, so a 2026 filter still compares with 2025). "Questions" tab =
  per-question averages, weakest first. (d) **PDF** = `/forms/[id]/pdf?<filters>`
  (`app/(dashboard)/forms/[id]/pdf`; the dashboard layout renders that path bare so no chrome
  prints - a root-level `app/forms` would shadow `(dashboard)/forms` and 404 /forms; loads
  through the same guarded actions, `/forms/*` keeps the operator's confinement). The
  browser's print → "Save as PDF" makes the file (Hebrew/RTL render exactly; no PDF library):
  page 1 = summary (+ the escort comparison when one trip is exported), then `break-before-page`
  one sheet per response. `PrintBar` names the tab (= default file name) and opens the print
  dialog once fonts and the logo loaded. Language: Hebrew unless the form is English-only.

### Reservation Follow-up (2026-10-04)

A reservation in status `Follow-up` = a customer waiting for us to get back to them. The status
existed (edit page + bulk "Set status…"); what was added is the DAY and everything that makes the
pile stand out. Mega Events only (`/dashboard`, `/reservations`) - not the tours companies.

- **`reservations.follow_up_date`** (date, null; migration `20261004210000`; `database.types.ts`
  hand-patched). Backoffice-only - main never reads or writes it, and it is read only WHILE the
  status is Follow-up, so leaving the status clears nothing.
- **Every rule is pure in `lib/reservations/follow-up.ts`** (`scripts/reservation-follow-up-selftest.ts`):
  `isFollowUpStatus` (the status box takes free text - "follow up", "FollowUp" count),
  `followUpState` = `overdue` / `today` / `undated` / `upcoming` against the date in ISRAEL,
  `needsCallNow` = everything but `upcoming` (a row nobody ever dated still counts as waiting),
  `nextWorkingDay` (Sunday-Thursday), `compareFollowUps` (longest overdue, today, undated, nearest),
  and `followUpDateOnSave` - a reservation that ENTERS Follow-up always gets a day: the one picked,
  else a stored day still ahead, else the next working day. The edit form sends the whole row back,
  so a past day identical to the stored one is a leftover of an older round, not a choice.
- **Writes:** `updateReservation` (`withFollowUpDate`) and `updateReservationsStatus`
  (`followUpDatesForBulk`, read BEFORE the status write) apply that rule; the inline date box in the
  table calls `setFollowUpDate` (`lib/actions/reservation-follow-up-actions.ts`, explicit column,
  audited). A date that fails to save never fails the status change - the row reads "No date".
- **Reads:** ONE loader, `loadFollowUps` (`lib/services/reservation-follow-ups.ts`, session-free,
  THROWS on a failed read - an empty list would read as "nobody is waiting") feeds the dashboard and
  the mail. Dashboard: `FollowUpAlert` (only while someone `needsCallNow`; red once overdue) and the
  `FollowUpWidget` card under the top cards - both from one `useFollowUps()` read in the page
  (`components/follow-up-widget.tsx`). Table: coloured status tag, the day + its label under a
  Follow-up tag, tinted rows, and a view **All / Follow-up (N)** kept in the URL
  (`/reservations?status=Follow-up` - what the dashboard and the mail link to).
- **Morning mail:** cron `followUpReminder` (below).
- **Deploy order does not matter:** every read of the column falls back on 42703 / PGRST204
  (`isMissingColumn`) - the list and the pile load undated, the date box answers "available after
  the system update".

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
- `nightlyCampaignCreatives` - feed creatives every HOUR at :15 (`15 * * * *`, was every 4h until 2026-10-01), time-budgeted (~250s, ~21 renders a run). The feed (main `buildActivityItem`) skips an event with no `campaign_image_url`, so this cron is what puts a NEW event into Meta. **Order (`creativeWorkOrder`, pure, selftested): never-rendered events first, then the rest LEAST RECENTLY DRAWN first (`campaign_generated_at` - a rotation).** The hash carries the package price, which moves several times a day on near events, so a date-only scan spent every run re-rendering those: on 2026-09-29 31 new far-out events (Oasis / Harry Styles 2027...) never got a creative until "sync everything", and on 2026-10-01 245 of 450 creatives were stale (some drawn 16.08) and the eleven Oasis Manchester ads still said "לונדון" a day after the `placeLabel` fix deployed - a fix to what the creative PRINTS only reaches an ad when the cron reaches the event. A render that throws keeps its old stamp, so it is retried at the head of every run. **Two picture pools per person (2026-10-01, migration `20261001150000`, pure rules `lib/person-gallery.ts`):** `gallery` = the mood gallery on the artist / team PAGE only; `event_gallery` = the pictures an artist's site event cards (main `galleryArtFor`) and Meta creatives (`pickGalleryImage`, `PersonRow.eventGallery`) rotate through. One column did both until mood photos Liz uploaded for the Oasis page went onto its event cards and ads. The artist form shows both groups with a "To events" / "To mood" button per picture (`GalleryField withEvents`; a plain upload joins mood, "Upload + cut out" joins events); teams have no event pool (their events wear the crest) though the column exists on both tables. `loadArtistRows` falls back to `gallery` only when `event_gallery` is missing (a deploy that beat its migration). The `artist_gallery` gap still means "no MOOD gallery". One event on demand: the editor's "העלה לפיד עכשיו" (`pushEventToFeedAction`, `lib/actions/meta-feed-actions.ts`): `generateCampaignForEvent` + `publishMetaFeeds`, then reports whether the id is in the activities file (`activityIdsOf`) and, if not, why. **Chosen events, forced (2026-09-30, Alon's doc):** `/meta-feed` card "אירועים ספציפיים לפיד" (`push-events-panel.tsx`) - search, tick up to 20, "צייר מחדש והעלה לפיד": one `renderEventCreativeAction(id, { force: true })` per event, then ONE `syncMetaFeedAction` (a request per event, like "סנכרן הכל", so no duration limit), ✓ / ⚠ + blockers / ✗ per row. `generateCampaignForEvent(event, caches, { force })` skips the hash short-circuit and stamps `?v=` with `creativeVersion(hash, Date.now())` - the same URL would keep serving Meta its cached picture (the 12.08 lesson); the stored `campaign_input_hash` stays the expected one so the cron does not redraw it again. The editor button stays hash-gated. Selftest `scripts/meta-feed-selftest.ts`. **A render that throws now leaves `campaign_skip_reason` = "שגיאה ביצירת התמונה: ..."** (no hash, so the next run retries) - before, a crash left no trace and looked exactly like "never reached"; main's `/product-feed` prints that column per event (`lib/feed/skipExplain.ts` there). **A weak look is in the hash (2026-09-29):** `creativeGap` (`photo-circle` = artist with a flat photo only, `one-team` = one crest missing, `event-photo` / `bare`) is appended as `|gap:<gap>` ONLY when present, so a full-look event keeps a byte-identical hash, and uploading the missing crest / artist cut-out flips the hash of every event of that team or artist -> the next run redraws them under a new `?v=` URL (Meta refetches). The subject decision is the pure `resolveCreativeSubject` over tables loaded once per run (`loadArtistRows` / `loadSubjectRows`, ordered by id so the first containment match is stable); `expectedCampaignHash` is the one hash both the cron pre-check and `generateCampaignForEvent` use. Before this, a crest upload changed nothing on the event and its ad kept the weak look until its price moved.
- `publishMetaFeed` - copies the live feed to the Storage file Meta reads, 6x/day (05,08,11,14,17,20 UTC)
- `partnerMonthlyReport` - partner report monthly
- `purgeTixstockEvents` - daily 04:45 UTC: hard-deletes `tixstock_events` rows whose `show_date` passed 7 days ago (a provider feed cache - nothing references it, the sync only upserts). **It deleted NOTHING from the day it shipped until 2026-10-05:** each batch sent 1,000 ids in the request line (`event_id=in.(...)`, 26 chars each = a 27KB URL) and the API refused it with a bare HTTP 400 and an EMPTY error message - 30,418 past rows piled up (oldest from May) and the table reached 130K rows / 123MB. Now 200 ids a batch, up to 400 batches inside a 45s budget, the HTTP status in the log, `?dry_run=1` = the count a real run would remove. **A `.in()` filter travels in the URL - keep id lists near 200 (uuids / long ids), never 1,000.** Migration `20261005140000` added the table's first real index, `(show_date, event_id)` - every reader goes by show_date (browse screen, this cron, stadium memory, price advisor) and each was a 113MB scan.
- `googleReviewsSync` - daily 04:00 UTC: mirrors the Mega Events Google Business reviews into `google_reviews` / `google_review_sources` (`lib/services/google-reviews-sync.ts`). Source per run: Places API (New) when `NEXT_SECRET_GOOGLE_PLACES_API_KEY` is set (live rating/count, ≤5 reviews per call, no owner replies), **otherwise Elfsight's public review feed for our Place ID** (all reviews + replies; unofficial endpoint, refreshed on Elfsight's schedule - a failure lands in `google_review_sources.sync_error` and the site keeps what it has). The mirror only accumulates. Initial 71 rows seeded with `scripts/seed-google-reviews-from-elfsight.mjs`. myt-main renders "לקוחות משתפים" from these tables (its own carousel - the Elfsight widget is gone, 2026-09-09). **The Elfsight feed FROZE (found 2026-10-01):** it sat at 71 reviews, newest 04.09, while Google had 84 - and every run said "synced", because the summary was the feed's own length. Now, on the Elfsight source: `review_count` / `rating` come from the MIRROR (`mirrorSummary` - the stored count is never lowered, so a number checked against Google survives a stale feed), and a feed whose newest review is `FEED_QUIET_DAYS` (21) old writes `sync_error` with `STALE_FEED_MARK` - the dashboard banner then says the source is stale, not that the run failed. Pure rules + `scripts/google-reviews-selftest.ts`. The real fix is Google's own Business Profile API - plan `docs/superpowers/plans/2026-10-01-google-business-profile-reviews.md` (needs Google's access approval + an owner's OAuth). The gap (13 reviews) was filled by hand the same day: 5 from the public Maps page with Google's own ids, then the other 8 from Dor's signed-in Chrome - the browser extension blocks review ids as encoded data, so those carry a `manual:` key and an "N days / weeks ago" date. `upsertReviews` ADOPTS a `manual:` row when a source brings the same author + rating within `MANUAL_MATCH_DAYS` (10): the row takes the real key, exact date, text and reply - so a thawed feed or the future API never duplicates them (`adoptsManualRow`, selftested). Mirror = 84 = Google that evening. **The two tables hold SEVERAL Google profiles (since 2026-10-06, migration `20261006100000`):** the cron also mirrors each tours company's profile (`tourCompanyPlaceIds` - `googlePlaceId` in its general site document), every row under its own `place_id`. **Every reader filters by `place_id`** - the tours sites through their `c_<slug>` views, the dashboard banner and main's `lib/googleReviews.ts` by the Mega Events id (`DEFAULT_PLACE_ID` here = `MEGA_EVENTS_PLACE_ID` there, env `NEXT_SECRET_GOOGLE_PLACE_ID` on both). Main's reader predated the second profile and read "the source row with the most reviews" + every review in the table: on 08.10 the Mega Events homepage said 4.6 (100) - Mega Family's profile - while Google said 5.0, and 44 of the 100 reviews in its carousel were the other company's (fixed in main the same day, test `lib/__tests__/googleReviews.test.ts`).
- `base-price-sync` - nightly 01:30 UTC: re-quotes live future events through `price-quote.ts`; deviation ≥$20 per component rewrites the base, >$400 freezes as `needs_review` (`/price-changes`); skips offline-linked components (`flights.event_ids` / `offline_hotels.event_ids`), base=0, events <2 days out. **Rotation** (2026-09-07, fixed 2026-09-17): the 270s budget covers ~24 events, so each night takes the least-recently-visited first (newest log row per event = last visit), ALTERNATING between the next-45-days queue and the farther one (`lib/services/base-price-rotation.ts`, pure, `scripts/base-price-rotation-selftest.ts`). Until 09-17 the near queue simply went first: 110 near events at ~24 visits a night never emptied, so 328 farther events were never visited and kept bases typed before the rule existed - including 8 hotel bases holding the ROOM total instead of the per-person price (ratio 1.35-1.77 vs the rule). A far event's first visit moves its base to the rule: usually UP ~$100-220 on the site "from" (pre-rule bases carried no margin), a change over $400 freezes as `needs_review`. **Every visit is logged** - `applied` / `needs_review` / `skipped` / `error` with the arithmetic in `note` - so the screen answers "why didn't it move". **`?dry_run=1` computes everything with zero writes** (no event update, no log row, rotation not advanced) - the way to test against prod from a preview. Daily summary email to `NEXT_SECRET_ADMIN_EMAIL` when anything happened.
- `ready-package-refresh` - nightly 03:10 UTC (after `base-price-sync` and `price-light-ours` finished their own searches): re-prices every ready package an event opens on (`ready_package_mode` preview / live) - each party size looked up again through main's search APIs (`runReadyPackageRefresh`, `lib/services/ready-package.ts`) - and rewrites `events.ready_package_price_usd`. Least recently refreshed first inside a 250s budget; `remaining` are first the next night. A LIVE package whose built size can no longer be served is mailed to `NEXT_SECRET_ADMIN_EMAIL` (its customers fall back to the regular flow). `?dry_run=1` searches but writes and mails nothing. See "Ready package" under Event Creation Flow.
- `price-light-crawl` - tick every 6h (`7 */6 * * *`; catalog intervals are 168h per site since 2026-09-17, the 72h/hourly wording below is history; a tick with no catalog due runs a DETAILS pass instead - see "Contents accuracy", 2026-09-19): crawls at most ONE competitor whose site is due (72h interval, `intervalHours` per scraper in `lib/services/competitor-scrapers/`), writing `competitor_listings`. Locking is a `competitor_crawl_runs` row in status `running` younger than 6 min - not an advisory lock. `?competitor=liveevents` forces a site (validated against `ACTIVE_COMPETITORS`), `?dry_run=1` writes nothing. Stealth is code, not a promise: one session at a time, 20-60s random pauses, blocked images/media/fonts/stylesheets, rotating Israeli UA, 45s page / 240s crawl timeout. Three consecutive `blocked`/`error` runs open a circuit for 24h (manual crawls bypass it); a listing-count drop ≥50% vs the last good run marks the run `partial` and emails `NEXT_SECRET_ADMIN_EMAIL`. `PRICE_LIGHT_SCRAPE=off` stops crawling (matching/lights still run off the stored catalog). Admin "crawl now" is `POST /api/price-light/crawl` (`guardAdminRoute`). **ISSTA is `crawlFrom: "local"`** (2026-09-15): its league pages answer Vercel's address with HTTP 200 and zero cards (an Israeli address gets them; spoofed forwarded-IP headers change nothing), so the tick never picks it, `runCrawl` records `skipped` for it whenever `VERCEL` is set, and the panel has no button for it. It is refreshed by `scripts/crawl-local.ts issta` - same `runCrawl`, same run row - which Windows Task Scheduler on Dor's machine runs DAILY at 03:30 ("MYT price-light local crawl", registered by `scripts/crawl-local-task.ps1`, one log per site in `%LOCALAPPDATA%\MYT\crawl-logs\<site>.log`); the script itself exits "not due" until the site's interval has passed since the last real run, so a machine that is off some days catches up on its next day on. If that machine stays off for two weeks the ISSTA catalog goes stale and reads `unchecked` (partial coverage), never a false "alone". **LiveEvents is `crawlFrom: "local"` + `mode: "fetch"` too (2026-09-28):** its concerts board (`/events/`, rows from a WP AJAX POST) answered Vercel with ZERO rows on every run since 15.09 - Playwright and plain POSTs alike - while `/matches/` worked, and the runs read `ok`; the music listings passed the 14-day freshness line on 26.09 and 38 music package lights fell to a false "alone" (39 events had lost their LiveEvents match). The same task now runs both sites (`issta` then `liveevents`, each its own log; one failing never skips the next). **`ctx.degrade(note)`**: a scraper whose catalog came back partly failed or partly empty (one board of two, some months) reports it, and `runCrawl` records the run `partial` with the note and mails ONE alert (shared with the drop alarm) - never a quiet `ok` again.
- `price-light-retention` - weekly, Sundays 03:00 UTC: keeps `RETENTION_DAYS` (**180**) and hard-deletes the rest of `event_price_snapshots` (by `day`), `competitor_matches` (by the EVENT they describe being 180 days past - never by their own age, or a quiet row that is still an event's newest verdict would be erased and its light would vanish at the next recompute), `competitor_listings` (`last_seen_at` - not seen in six months = off their site), `competitor_crawl_runs` (`started_at`) and `audit_log` rows whose action starts `price_light.`. Backoffice-only log tables, so a hard delete is the policy here (same precedent as `purgeAuditLog`); it never touches `events`. `?dry_run=1` counts exactly what a real run would remove and writes nothing. **`purgeAuditLog` now EXEMPTS `price_light.*`** - those rows are the decisions the agent learns from, and dropping them at 30 days silently capped its 120-day memory at a month. Why these sizes are safe: the price-drop lookback reads 14 days, a light goes stale at 14, and the circuit reads the last handful of runs - every read path lives far inside 180.
- `price-light-ours` - nightly 02:40 UTC (after `base-price-sync` finishes its own Amadeus searches): describes OUR package contents for the /price-light comparison - the flight and hotel the pricing rule would buy today (cheapest direct / connection past the $300 gap via `fetchFlightOffers` + `pickFlightPrice`; cheapest 3★ via main's `/api/hotels`; a linked offline flight/hotel wins) - into `events.light_detail.ours`. Never-described first, then older than `OUR_OFFER_REFRESH_DAYS` (7) or last lost to a TRANSIENT error (HTTP/API/timeout - retried next night, not left blank a week), `OUR_OFFER_CONCURRENCY` 3 events at a time in a 260s budget (~5-8s per event). **Hotel searches run through ONE queue** whatever the event concurrency, with one retry on 429/5xx: main's `/api/hotels` fails under parallel load (first full pass lost 308 of 426 hotels; each answered alone). Flights: 423 of 426 described. Reads the rule, writes no price. `?dry_run=1` still SEARCHES (that is what is being tested) but writes nothing; `?limit=N` caps a manual run. Dor 2026-09-14: the extra Amadeus/hotel calls are fine nightly and on demand.
- `price-light-nightly` - 00:15 UTC, before `base-price-sync`: refreshes the `livetickets` competitor table from `live_events` first (it's an API read, never crawled, budgeted at 60s so it can't eat the whole run); then pass 1 snapshots every live future event and applies the "ירידת מחיר" tag (drop ≥$50 vs ~14 days ago, shown 14 days); pass 2 rule-matches every event against the stored catalogs and recomputes `events.light_package` / `light_ticket` / `light_detail`. Both passes go least-recently-checked first and share one 270s budget measured from the top of the run, so a cutoff mid-pass-1 is recorded (`snapshotsRemaining`) rather than silently skipped. **Follow-ups at 03:30 and 05:30 UTC** (`?followup=1`, 2026-09-24): same queue, no LiveTickets refresh, no second snapshot for an event already snapshotted today - the lights the first run did not reach (it covered ~60 of 430 a night, so a light sat ~8 days); a follow-up mails only on a red move or an error. Revalidates main (both targets) once if anything changed; summary email (which also reports `aiCalls` used out of `AI_CALLS_PER_RUN`). `?dry_run=1` = zero writes **and zero AI** - dry runs pass `judge: null`, so a report pointed at prod never spends money. Spec `docs/superpowers/specs/2026-09-09-price-light-design.md`; rules + constants ONLY in `lib/services/price-light.ts`.
- `taskOverdueAlerts` - Sunday-Thursday 06:30 UTC (`30 6 * * 0-4`, the office's working days): every task past its due date whose assignee has said nothing since is raised to whoever opened it, ONE mail per opener, again every `OVERDUE_REALERT_DAYS` (3) while it stays silent (`overdue_alert` activity rows are the dedupe). Reads every company's tasks on purpose. `?dry_run=1` = full report, nothing mailed or written. See "Editors assign + reminders + late alerts" under Tasks Hub.
- `followUpReminder` - Sunday-Thursday 05:15 UTC (`15 5 * * 0-4`, morning in Israel): ONE mail with every reservation in `Follow-up` whose customer is waiting today - call-back day today, passed, or never set (`needsCallNow`); a later day stays out until it comes; nobody waiting = no mail (`lib/services/follow-up-reminder.ts`). A daily digest on purpose - no dedupe: a customer stays in it until the day is moved or the status changes. Recipient = Alon's Mega mailbox (`DEFAULT_FROM` in `lib/email.ts` - Dor, 04.10) unless `NEXT_SECRET_FOLLOW_UP_REMINDER_TO` (comma-separated) names others. `?dry_run=1` = full report (reservation ids + labels, no customer details), nothing mailed. See "Reservation Follow-up".
- `weeklyTaskGen` - daily 06:00 UTC (`vercel.json` `0 6 * * *`); each rule runs only on its own UTC weekday (`dow`): runs every active `task_rules` row through its domain's generator (`lib/services/task-rules/*`) and `weekly-task-plan.ts`'s pure decision logic, creating one weekly-digest task per rule (source `recurring`) or one task per item under that domain's native source (`price_light`/`price_review`/`creative_gap`). Per-item rules are capped at 25 creates per run (`PER_ITEM_MAX_PER_RUN`) with one summary mail per assignee; the 270s budget is checked per created task. A generator that fails to load its data THROWS - never silently returns an empty list, which would auto-close open digests that are still valid. `?dry_run=1` reports what it would create with zero writes. See "Tasks Hub" above.
- `marketingSync` - every six hours at 01:20, 07:20, 13:20 and 19:20 UTC (`vercel.json` `20 1,7,13,19 * * *`), `maxDuration` 300, 270 s budget: the marketing dashboard's one sync (`lib/services/marketing-sync.ts`, spec section 4). Six steps in this order, each in its own try/catch so one source failing never skips the next: (1) `meta` - `lib/services/ads/meta.ts`, Graph `v26.0`: `act_<id>/insights` per adset per day for the last 7 days (Meta restates recent days), read in 7-day windows one after the other, a window that times out asked once more (`dayChunks` / `META_SPEND_CHUNK_DAYS` / `META_SPEND_RETRIES` - one 30-day or 90-day insights request outlasts Meta's answer time and the 30 s read timeout; measured 2026-10-08: a 90-day backfill in 14-day windows = 7 requests, 1,090 rows, ~160 s, but a 14-day window took 9-25 s and one of two runs still lost a window to the timeout, hence a week) -> `ad_spend_daily`, WRITTEN before the entity walk starts, then campaigns / adsets / ads (~1,800 ads, 50 a page) -> `ad_entities` (ACTIVE / PAUSED / ARCHIVED / CAMPAIGN_PAUSED / ADSET_PAUSED / IN_PROCESS / WITH_ISSUES on every edge - an archived campaign still has spend history and bookings; ads add PENDING_REVIEW / DISAPPROVED / PREAPPROVED / PENDING_BILLING_INFO. **DELETED cannot be asked for:** the account edges answer 400 code 100 / subcode 1815001 "deleted objects are not supported on this endpoint" (measured 2026-10-08) - a deleted Meta object is readable only by its own id, and that day no deleted or archived campaign had spend in the last 90 days); (2) `google` - `ads/google.ts`, `googleAds:search` on v25 with a JWT-signed service account and NO developer token: spend per ad group (per campaign for PERFORMANCE_MAX) -> `ad_spend_daily` (written first, same rule), then campaigns + ad groups -> `ad_entities` in every status, REMOVED included (a removed campaign keeps spend rows and bookings inside the 90-day backfill) - ads and asset groups are read only for the campaign's landing domain, never written; then `click_view` -> `ad_clicks`: the last 3 days on every run, and on a backfill each older day of the window that has no click row yet, walked OLDEST missing day first until the budget - so a backfill cut short resumes where it stopped when it is run again, and the note says how many days are still missing; (3) `instagram` - `ads/instagram.ts`: the newest 100 posts + live stories -> `ig_media` (per-post insights fill its counters and add today's row to `ig_media_insights_daily`), followers -> `ig_account_daily`; (4) `cogs` - `reservation-cogs-fill.ts`: an `estimated` `ticket_cost_usd` for up to 200 Paid reservations that have none, stopping 20 s before the budget (`deadlineMs`, `remaining` in the note); `ticket_cost_source = 'manual'` is RESERVED - nothing writes it; (5) `alerts` - the two rules, `marketing_alerts`, the alert mail; (6) `retention` - deletes `ad_clicks` older than 100 days and `ig_media_insights_daily` older than 180. `spend_usd` = `spend x fx_rate`, the UNROUNDED ILS rate (`getRawRate` on the exchange-rate service in `ticket-price-sync.ts`, which the sync imports DYNAMICALLY - that module throws at load without the supplier env), read once at the top of the run and stored on every row. **FX fallback:** when the rate refresh failed and ILS is still the built-in fallback, NO spend is written - `meta` / `google` fail "ILS rate unavailable (fallback) - spend not written, retried next tick" (their entities and clicks are still written). A step that would start after the budget is spent is reported `ok: false` "skipped: budget" (the run is not ok and the failure mail names it). `ad_entities`' manual-brand read tolerates ONLY a missing table (`42P01` / `PGRST205`). Params, on top of the bearer / `?key=`: `?dry_run=1` reads everything and writes and mails nothing; `?only=meta|google|instagram|cogs|alerts|retention` runs one step (any other value answers 400 `unknown step`); `?backfill_days=N` widens the spend window (default 7, max 180) and the click_view walk (default 3 days, max 90) - for the one-off first run. **Mail:** a healthy run is silent (four mails a day would be noise); `NEXT_SECRET_ADMIN_EMAIL` gets "Marketing sync: N step(s) failed" naming each failed step (step and note HTML-escaped, `lib/html-escape.ts`), and the `alerts` step mails new alerts to `marketing_settings.alert_emails`, falling back to `NEXT_SECRET_ADMIN_EMAIL` when that list is empty. The `marketing-*` caches are invalidated once at the end. **Migration first:** `20261008120000` must be applied before the first prod tick, or every step fails on the missing tables and Dor is mailed four times a day. Measured (full dry run on prod, 2026-10-08): about 180 s of the 270 - Meta ~93 s (the ads edge is most of it), Instagram ~80 s. The screen's "Sync now" runs the same function with a 240 s budget (the page's `maxDuration` is 300). See "Marketing dashboard" above.

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

**Ticket-only events (2026-09-23, spec `docs/superpowers/specs/2026-09-20-lodging-destinations-design.md` part A, plan `docs/superpowers/plans/2026-09-23-ticket-only-events.md`).** `events.package_mode` text (`package` default | `ticket_only`, NO check constraint - a later mode needs no migration; helpers `isTicketOnlyEvent` / `ticketOnlyProblems` in `lib/package-mode.ts`, selftest `scripts/package-mode-selftest.ts`, mirrored in main `lib/events/price.ts`). The editor switch ("Ticket only (no flight, no hotel)") **zeroes `base_flight_price`/`base_hotel_price` and requires `ticket_only_markup`** (0 allowed) - so every existing `base > 0` gate (base-price-sync, price-light-ours, alternatives, package light = `na`) skips the event with no code of its own; the ticket light still runs. Events table: filter reads the flag (not the noisy `skip_flight`), amber badge, bulk ON/OFF. Portal: `BuilderEvent.package_mode`, the wizard is locked to tickets (`lockedTicketsOnly`). Main (live since 2026-09-30 - PR #47 merged to `main`, branch deleted): forces both skips, walks 1 → 4 with a 2-step stepper, prices via `isTicketOnlyOverride`, card badge "כרטיס בלבד" + ticket icon only + "מחיר / לכרטיס", feeds say "כרטיס", `confirm-order` rejects any flight/hotel on such an event. Deploy backoffice (migration) before main.
**In Meta ads (2026-10-06, no migration).** A ticket-only event's ad said "טיסות, מלון, כרטיסים - הרכיבו בעצמכם", "ממוצע לנוסע $707" and a title ending "טיסה+מלון+כרטיס" (Stevie Wonder Hannover) - and the $707 was WRONG: the creative priced every event with the package rule (ticket + 175) while the site charged ticket + `ticket_only_markup` ($782). Now everything follows `package_mode`, so a future ticket-only event is right by itself: (a) **price** - the creative prints `siteCardPrice(event)` (`lib/package-price.ts`), a branch-for-branch mirror of main's `computePackagePrice`: a `live` ready package's price, else ticket + its own markup for ticket-only, else the package rule. **A new branch in main's function must be added there.** Every read that prices a creative selects `SITE_PRICE_COLUMNS` (`lib/creative/auto.ts`). (b) **words** - pill "כרטיסים החל מ-$X" (`mode: "ticket"`), tagline "כרטיסים רשמיים · כרטיס בלבד" (`creativeTagline`, `CreativeInput.ticketOnly`). (c) **hash** - `|mode:ticket_only` is appended ONLY for such events, so flipping the switch redraws under a new `?v=` and every package keeps a byte-identical hash (no mass redraw). (d) **feed (main)** - title ends "כרטיס בלבד" and names the event city alone. **The event stays in the same catalog and the same ad sets** (Dor 06.10: "everything goes up automatically, ticket-only too - it just gets a different post"): its `custom_label`s are the ordinary ones and `custom_label_4` stays availability alone - never put the mode there, a set filtering `available` would lose the event; the commerce feed only adds the internal label `ticket-only`. Selftest `scripts/meta-feed-selftest.ts`; main `lib/feed/__tests__/*`. The manual Creative Generator is untouched (it makes site card pictures, not feed creatives).

**Ready package ("חבילה מוכנה", 2026-10-04, spec `docs/superpowers/specs/2026-10-04-ready-package-design.md`; internal name "חבילת קהל מבוגר").** For events sold to an audience that should not be asked to choose: ONE house-built ticket + flight + hotel per event, and a click on the event card lands the customer on the order summary drawn as three visual cards with a traveller picker. It is the prepared-package link feature plus three things. (1) **A house row:** `prepared_packages.kind` (`partner` default | `house`; `partner_tracking_code` is nullable for it - no partner, no commission), `spec` jsonb = the IDENTITY of each piece (ticket id + category; flight numbers + departure times, or the offline flight id; hotel id + room + meal + dates, or the offline room row ids; or "none"), `variants` jsonb = one priced composition per party size (`{"2": {event_order_info, flight_order_info, ...}}`, the shapes main round-trips), `max_travelers`, `refreshed_at` / `refresh_status` (`ok` | `partial` = some sizes missing | `broken` = the built size cannot be served) / `refresh_note`. The top-level `*_order_info` columns keep the default size, so every older reader of the row is right. (2) **Three event columns:** `ready_package_token`, `ready_package_mode` (`off` default | `preview` = only the staff link `?ready=<token>` opens it | `live` = the card click does; no CHECK, anything else reads as off) and `ready_package_price_usd` (per person at the default size - what the site card shows in `live`). They are owned by the editor's card and the cron; **`updateEvent` strips them** like the light columns. (3) **A refresh:** every party size is looked up again through main's own search APIs and priced with `computePerPersonPackagePrice` - no pricing rule of its own. **Pure rules** in `lib/ready-package.ts` (`scripts/ready-package-selftest.ts`): an offline flight is the same inventory row; a live flight is the same when both legs leave at the same minute and every flight number both sides know is equal (several fares -> the cheapest); a live hotel is the same hotel id, then same room + meal, then any room with the same meal, then (only when a meal was promised) any room WITH a meal - **a promised breakfast is never dropped**, no meal on offer = that size is not sold; offline rooms scale only when they come from one inventory row. A size whose piece is gone leaves the picker; a size whose SEARCH failed keeps its last priced variant (one timeout must not break a package). **Service** `lib/services/ready-package.ts` (`buildVariant`, `refreshHousePackage` - default size first, `createHousePackage` - one house row per event, re-adoption rewrites it under the same token, `adoptPackage`, `composeAuto`, `runReadyPackageRefresh`); the wizard's search bodies and snapshot builders moved verbatim into `lib/services/package-search.ts` / `package-snapshots.ts` so the portal actions (still `requirePartner`-gated wrappers) and this service share them. **Building (2026-10-05): "Build closed package" in the event editor's "Ready package" card** (`ready-package-builder.tsx`, opened on request - it loads nothing until then): party size + dates, then "Compose automatically" (`suggestBuild`: cheapest ticket, cheapest direct flight with a checked bag, cheapest 4★ with a meal - pure pickers `pickSuggestedFlight` / `pickSuggestedHotel`, each saying which fallback it took) or a hand pick from `searchBuildFlights` / `searchBuildHotels` (main's own searches; our inventory first; several fares of one flight collapse to the cheapest; hotel name query runs before the result cap). **The browser only NAMES the pieces** - it sends a `ReadyPackageSpec`, `parseSpecInput` checks its shape field by field, and `createHousePackageFromSpec` looks every piece up again and prices it (`buildVariant`) before `saveHousePackage` writes the row; nothing price-bearing comes from the client. "Closed package" (default on) saves `allow_edit = false` - the customer cannot swap a piece. The older way stays beside it: build in the portal wizard (as a partner / impersonating one) and ADOPT it in the same card (`app/(dashboard)/events/[id]/ready-package-card.tsx`, `lib/actions/ready-package-actions.ts`, audit `ready_package.*`): the card copies it into the house row, then prices EVERY size - the built one included, a fresh search is what gives it today's price and the hotel photo the site shows (`ReadyVariant.hotel_image`) - one call per size (the editor's `layout.tsx` raises `maxDuration`), and holds mode / max travellers (default 4, cap 6) / "customer may swap pieces" (`allow_edit`) / preview link / refresh / replace / remove. `live` is refused while the built size has no variant. `scripts/ready-package-create.ts <eventId> [--apply]` composes one by a plain rule (cheapest ticket, cheapest direct flight with a bag, cheapest 4-star with a meal) straight into `preview` - for tests. **Main:** `lib/events/readyPackage.ts` decides which token a page load opens, `/api/package/[id]` serves a house row only while its event still points at it (`?pax=N` picks the variant), `ReadyPackageShowcase` replaces the summary's `<Review>` when a house answer arrived; partner links and the regular flow are untouched. Not built: several packages per event, a live re-search at the moment of booking, building on `/events/new` before the first save (a package needs a saved event). Deploy backoffice (migration `20261004230000`) before main.
**Alon's QA round (2026-10-06, no migration).** (a) **Swap per piece:** `spec.swap = { ticket, flight, hotel }` (pure `swapOf(spec, allow_edit)` / `parseSwap` / `anySwap` in `lib/ready-package.ts`, mirrored as `swapOf` in main's `lib/events/readyPackage.ts`). Absent = every piece follows `allow_edit`; `allow_edit` itself is kept as "at least one piece is open", so an older reader is never wrong about a closed package. Set in the builder ("Closed package" switch + three boxes) and on the card ("The customer may swap", `setReadyPackageOptions({ swap })`); a rebuild keeps it. Main's route answers `swap` for a house row and the package view draws "החלפה" only on an open piece. (b) **No limit of its own:** `READY_MAX_TRAVELERS_CAP` = **9** in both repos = main's ticket-step `MAX_TICKETS`. The "Max travellers" select is gone; `max_travelers` is written as the cap on every save and refresh (main still reads the column, so an older row lifts on its next refresh). Nine sizes = nine flight + nine hotel searches a refresh: the nightly 250s covers a couple of packages a night, the rest are first tomorrow. **Which sizes are sold is staff's call (Dor 06.10):** `spec.sizes` (e.g. `[2, 4, 6, 8]` = pairs only; absent = every size; pure `allowedSizes` / `parseSizes` / `pairSizes`, the built size is always in). Set in the builder ("Sold to") and on the card ("Sold to parties of" - a number per size, plus "Pairs only" / "All"; `setReadyPackageOptions({ sizes })`). A size that is not sold holds NO variant (the action drops it at once, a refresh never builds it) - which is all main needs: its picker offers exactly the sizes that have one. A refresh prices only the sold sizes, so pairs-only is four searches, not nine. (c) **The site's own ticket rules on the package's ticket** (main `app/hooks/useReadyTicketLive.ts`): a ready package lands past the ticket step, so on landing and after each traveller change its ONE ticket goes through `priceTicketsForQuantity` with the ticket step's three live calls - live price for that quantity, supplier / eid on the order (`toOrderTicket`), our stock left. A size the supplier cannot sell leaves the picker for the visit (`blockedPax` + `notice`) and the package moves to the nearest size; none left = the regular flow, on step 1. (d) **Builder:** `loadBuildOptions(eventId, travelers)` answers tickets + dates + OUR inventory in one action (`ReadyInventory`: flight blocks through `megaEventsFlights`, offline rooms) - listed in an "Our inventory" block before any search (`getReadyInventory` re-reads it when "Built for" changes); a ticket says "our stock (N seats)" or its supplier; **"Change a piece"** opens the builder on the package as it stands (`ReadyBuilderInitial`) and an untouched piece keeps its stored identity. (e) **Card:** the first thing on it is "Is it on the site?" - Off / Preview / Live on the site with one sentence each - and the build toast says the package was saved in Preview. (f) **Main landing:** no "כמעט שם" popup and no 15-minute countdown on a ready package (it is the first page the customer sees: `openModal` starts false, the two `Timer`s are not mounted, `MobileHeader showTimer`); desktop is a one-pager - a narrow column (travellers, total, terms, pay, trust) beside the wide package, by class conditions on `readyPackage` only; every card says how many it holds and the hotel names its rooms (`roomsLabel` over `hotel.guests`). The quantity inside the ticket step is locked during a package swap (07.10, main) - a swap always comes back to the summary.
**Why a size is not offered (2026-10-07, no migration).** Dor's package showed 3, 5-9 amber with one line about 9. Three things. (a) **The note lost its reasons:** the card prices ONE size per call and every call rewrote `refresh_note` with its own failures alone, so the last size priced erased the rest. The note is now one line per size (`parseSizeNotes` / `formatSizeNotes`, sizes that share a reason share a line: "5, 6, 7 travellers: ..."); `summarizeRefresh` takes `handled` (the sizes this call visited) + `previousNote` and keeps what earlier calls said about the others; the card lists the lines and each number's tooltip gives its own. (b) **A trio in a hotel with no room for three:** a party is searched with rooms of two and, for an odd party, one room of three; a twin-room hotel answered nothing, so the size was never sold although the regular flow serves three. `resolveHotel` now retries the SAME hotel and meal with rooms of two and a single (`roomSplitWithoutTriple`: 3 → [2, 1], 5 → [2, 2, 1]; `searchHotelsViaMain({ rooms })`), prices what those rooms really cost, and notes "2 rooms (2 + 1)"; main's `roomsLabel` prints "חדר זוגי + חדר ליחיד". (c) **Sizes above our own ticket's stock cannot be sold** - that part is inventory, not a bug: the reason now names the stock ("our own stock of 4 seats ... raise the stock, or build the package on a supplier's ticket").
**Add-ons on the landing (2026-10-08, main only, no migration).** The package view sells the regular summary's paid add-ons on its own cards - a suitcase for every traveller (El Al: the Classic upgrade), a trolley where the airline sells one, breakfast when the hotel's rate has none - through the summary's own handlers and prices, never a rule of its own. **Also on a CLOSED package:** closed = no piece may be swapped, and an add-on swaps none (a partner's locked package still offers nothing). An add-on follows the traveller picker (re-added at the new party's own price, or the picker says it came off). The landing's hotel search is the package's own stay - its dates and rooms - which is what the breakfast rate is read from; a hotel that already includes a meal spends no further search. Nothing changed here: `added_bags` / `fare_upgrade` / `breakfast_upgrade` reach the reservation and the ops mail exactly as from a regular order. The three piece cards read text first, picture last, and the "חבילה מוכנה" tag is gone (main CLAUDE.md, "Fourth pass").

**Lodging cities + split stay + hotel warm-up (2026-09-24, same spec parts B-min/C1/C2, plan `docs/superpowers/plans/2026-09-24-lodging-cities.md`, migration `20260924090000_lodging_cities.sql`).** Flight city = `events.location` (unchanged, IATA); event city = `events.event_location jsonb` (null = same); `lodging_mode` (`flight_city` default | `event_city_only` | `choice` | `choice_split`), `lodging_default` (`flight`|`event`), `lodging_note`, `split_default_nights` (1|2). **Every rule is pure in `lib/lodging.ts`** (`offeredCities`, `defaultCity`, `lodgingLocation`, `defaultSplit`, `segmentsFromNights` max 3, `flipNight`, `refitNights`; selftest `scripts/lodging-selftest.ts`) and mirrored verbatim in main `lib/events/lodging.ts`. Editor: "Lodging" card (`section-lodging`) fed by the Locations dropdown, `lodgingProblems` blocks a mode without a real event city; `findVenueMemory` now also returns `lodging` and the editor seeds it. Main (same PR #47, live): **hotel step v6 (Dor + Alon 28.09, spec block "v6")** - no entry popup any more (`LodgingPlanDialog` / `lodgingPlanned` are gone): the step opens on the default city's ordinary list, and "איפה ישנים?" above it (`components/order/LodgingToggle.tsx`) is a three-way radio - `לינה ב<flight city>` / `לינה ב<event city>` / `פיצול מלונות` (= `proposedSplit`, the event's default split, pure in `lib/lodging.ts`, selftested). An active split shows "עריכת הפיצול", which opens `components/order/SplitEditor.tsx` in place (night squares `NightStrip.tsx`, "עדכון הלינה"); dates + guests stay in the step's search bar. First visit to such a step: a one-time hint bubble on the split button (`localStorage myt:split-hint:<eventId>`, never on edit-from-summary / a locked package). **Same city twice = same hotel** (`HotelSelection` anchors per city: the list pick the split started from, else the city's first segment; `closestRate` in `order-review.utils.ts` keeps room / board / refundability; a swap drags the city's other segments along unless swapped by hand; "חוזרים לאותו מלון" tag, and a note when the hotel has no room those nights). Leaving a split for a city reuses the provider's list when it already holds that city/dates/guests (no new search); edit-from-summary on a split keeps the split's own dates. `SegmentsList` (sequential searches - `serp/geo` is 10/min - auto-pick per segment, "החלפת מלון" modal); INVARIANT `hotel` = `hotelSegments[0]`, price sums segments. **Breakfast per segment (28.09):** each segment carries an in-session `breakfast_offer` (the same room's breakfast rate from ITS OWN search, captured at pick/swap - the provider only holds the main list) → `SegmentBreakfast` row in the hotel step AND the summary ("הוסף" asks once "all hotels or only this one"), `useSegmentBreakfast` (main `app/order/hooks.tsx`); `persistableHotel` strips `breakfast_offer` / `prev_rate` before saving. The summary lists each hotel with its own +/- (rounded to add up to the total line); customer mail + confirmation page list every hotel; `cityName` drops the country ("לונדון, בריטניה" → "לונדון", `shortPlace`) and a two-city order's `location_name` is "ליברפול · טיסה ללונדון"; `reservations.hotel_segments jsonb` (OrderHotel[] with `city`/`cityName`), `hotel_order_info` = first segment so every old reader stays right; the reservation detail page lists the segments. **Warm-up (B-min):** main `POST /api/hotels-warm` (`x-hotel-secret` = `NEXT_SECRET_REVALIDATION_SECRET`; one `serp/geo`, ≤12 `hotel/info` 2.5 s apart, awaited upsert with a real `city`) ← backoffice `warmHotelsStep` (`lib/actions/hotel-warm-actions.ts`, table `hotel_warm_areas`, audit `hotels.warm`) ← `HotelWarmButton` on Locations cards and both editor location cards, looping until `remaining` = 0. No cron yet (B-full later). Offline hotels and the partner portal ignore the event city for now. **Place label (30.09):** every customer surface (cards, search, homepage, banners, feed titles, partner quotes) prints `placeLabel(event)` - "מנצ'סטר · טיסה ללונדון" on a two-city event, else `location.name`; `eventCityName` for the city filter / schema.org Place / feed `location_names`. Both live in `lib/lodging.ts` here and main's `lib/events/lodging.ts`. **The Meta creative is the exception (Dor 01.10): it prints the show's city ALONE** ("מנצ'סטר", `creativePlaceText` in `lib/creative/auto.ts`, selftested) - "טיסה ללונדון" belongs to the site and the feed text, not the ad picture. The creative hash carries `|place:` only for two-city events.

**Our own tickets with stock (2026-09-28, Alon's two-supplier tab item 3).** A ticket on a multi-supplier (`tx_event`) event can be OURS: `supplier: "static"` + `EventTicket.stock` (seats we hold; no migration - a field inside `tickets_and_rates`, mirrored in main `lib/app.types.ts`). Added from Suppliers & zones → "Our own ticket" (name, USD price = the ticket part, seats, zone - required once the map is ours; the venue template never learns it); the zones board has a third column "Our stock" with inline price / seats and "sold X · left Y" (`getOwnStockHeld`, `supplier-attach-actions.ts`); a ticket with seats sold cannot be removed, only lowered. **One count, pure, mirrored verbatim** in `lib/own-stock.ts` (both repos, selftest in `scripts/multi-supplier-selftest.ts` / main `lib/__tests__/supplier-offers.test.ts`): seats held = `number_of_ticket` of every live reservation whose `event_order_info.id` is the ticket (flat or `{events:[...]}` shape; `is_deleted` null; statuses Cancelled / Lost / 24Save hold nothing - same set as `RELEASED_STATUSES`); left = max(0, stock - held). Main: `markOwnStockSoldOut` (`lib/events/ownStock.ts`) runs inside `getEvents` next to `markLockedPackagesSoldOut` and sets `available: false` on a sold-out one (catalog, "from" price, sold-out cards - up to an hour old); the order page counts fresh via `GET /api/own-stock?event_id=` into `SupplierLiveData.ownStock` (a party bigger than what is left drops the ticket, the nearest-quantity rescue sees it too); `confirm-order` `validateOwnStock` re-counts before booking (rejects as `PRICE_VALIDATION_FAILED` = "the ticket is no longer available"), sets `event_order_info.own_stock` from the EVENT, and the ops mail / reservation page say "OUR STOCK - nothing to buy". Not closed: two orders in the same second can both pass the count (no DB lock). Our own stock never moves between fixtures (`carriesToAnotherFixture`). **Seats together (Alon 29.09):** `EventTicket.seatsTogether` ("Together (up to)" in the add form and on the board; empty = no promise) - `ownSeating` (pure, same `lib/own-stock.ts`): a party up to that many is "ישיבה ביחד מובטחת", a bigger one "ישיבה יחד בקבוצות של עד X" (and, as a split, it gets the zone's together toggle like any supplier). **LiveTickets "doubles" at an odd party (Alon + Dor 29.09, main only):** doubles (`seatingMethodId` 3) is LiveTickets' most common seating (3,070 categories / 1,061 future events) and never carries a `seatingGroupFee` - they sell no triple there. Main's `pairsPlusSingle` makes three [2, 1] and five [2, 2, 1] at the LISTED price, the card says "ישיבה: זוג + מושב נפרד", and as a split it gets the together / split toggle when another offer in the zone seats the whole party together. Group categories (method 4) keep folding their fee into the price, as before.

Exchange rates (EUR, ILS, GBP → USD) are managed via `lib/services/exchange-rate-client.ts` and the `/api/exchange-rates` route. The sync services call this when converting ticket prices.

`/api/validate-airline` uses headless Playwright + `@sparticuz/chromium` to scrape airline codes from avcodes.co.uk. It has a dedicated Vercel function config with 1024 MB memory / 30s timeout.

### Event creation automation (2026-09-02)

Spec: `docs/superpowers/specs/2026-09-02-events-factory-design.md`. Three paths share the same building blocks, all wired into `app/(dashboard)/events/[id]/page.tsx` (the `/events/new?batch=1` wizard) and `lib/services/draft-builder.ts` (the factory):

- **Stadium memory** (`lib/services/venue-memory.ts`): a step with no ticket categories copies `tickets_and_rates` structure from the most recent live, non-test event of the same `type` on the same SEAT MAP - `map_image_url` in any spelling (spaces vs `%20`), its `venue_maps` twin (supplier drawing <-> our copy), and - for a FOOTBALL drawing only - every other football drawing TixStock uses for the same `venue_name` (Anfield has two). **Football only (Alon 29.09):** widened by venue name, Oasis at the Etihad copied Man City - Aston Villa (the Etihad has five TixStock drawings: two football, three concerts); a concert is staged per tour, so its drawing alone is its venue. `isFixtureDrawing` (pure) = most TixStock events drawn on it are "A vs B" fixtures (`fixturePair`); an unknown drawing never widens. **Not the location** (2026-09-28): every live event's `location` is a CITY from the Locations dropdown, so the old name / <1km coords match meant "latest event in the same city" (a Real Madrid game got Harry Styles' tickets). A map TixStock uses for more than `GENERIC_MAP_VENUES` (3) venues is a placeholder ("General Admission.svg", 244 venues) and remembers nothing. Only tickets that may move between fixtures are copied (`carriesToAnotherFixture` in `lib/suppliers.ts`: TixStock + manual structure; never LiveTickets / XS2Event ids or our own `static` stock), with fresh ids and the NEW fixture's TixStock id as `eid` (`ticketForFixture`; the factory carries it as `payload.source_event_id`, stripped before insert); `zoneId` survives only on the same drawing. The same rule gates the TixStock batch "Save & Next" carry-over (a banner counts what stayed behind). Prices come along only as the reprice fallback. Banner + undo in the wizard.
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
three contents lines. **Table layout (2026-09-17):** one table per scope - suppliers down (us first), flight / hotel / ticket across with column dividers, so our flight sits right above theirs; our row links to the event on the site (`/order/{id}`) the way each competitor row links to its page.

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

**Agent #2: the price advisor (`lib/agents/price-advisor.agent.ts`, `PRICE_ADVISOR_AI`,
2026-09-17).** It never touches a competitor or a light - it only WORDS and RANKS (1-3, biggest
saving first) the deterministic facts `lib/services/price-advice.ts` already computed for one red
scope (a markup cut to orange/green, a cheaper LiveTickets ticket, a nights gap - every number
already backed by the light's own arithmetic). The one call site is `openAutoRedTasks`
(`price-light-nightly.ts`), for a scope that turned red tonight; `wordAdvice()`
(`lib/services/price-advisor.ts`) is the one place it calls Claude, same discipline as the judge
(`maxRetries: 0`, its own `timeoutMs`, a forced tool call, `stop_reason === "max_tokens"` = failure).
**It can never state a number the facts didn't give it**: `numbersAreFromFacts()` checks every
`$<number>` in the model's text against the facts' own text, and a text that fails is discarded -
the task gets the deterministic block alone. AI-worded advice keeps the deterministic block
underneath it regardless, so the facts are never hidden behind the wording. Off, out of budget
(`callsPerRun: 15`, shared with the run the way the judge's `aiBudget` is), no facts, or any
failure -> `adviceBlock(facts)` verbatim, `ai: false`, never a throw - a dry run never builds this
agent's memory and `openAutoRedTasks` never runs on one, so it never calls the AI either. It learns
from `price_light.repriced` (its metadata now carries `column`/`before`/`after` from
`setEventMarkupFromLight` - what a human actually CUT, not just that a gap existed) and its own
slice of the shared `agent.feedback` action (rows tagged `metadata.agent: "price-advisor"` only -
a mark left on the price-light judge's verdicts must never teach this agent something about
itself it never said, and `ai-factory.ts`'s maturity read was fixed the same way: the untagged
`price_light.*` outcome actions now count ONLY for `price-light`, or a second agent with none of
its own yet would have inherited price-light's whole agree/disagree history for free). It has no
per-call log table yet, so `/ai-factory/price-advisor`'s cost reads $0 and its "יומן" tab reads
empty (`listAgentLog` already returns `{ rows: [] }` for any key but `"price-light"`) even though
every AI-worded advice is now audited as `agent.advice` (`{ agent, event_id, scope, cost_usd }`) -
that row is deliberately left unread by the tab for now, so a later log reader has a source to
build on without this task's screen changes.

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

**Phase 2 (2026-09-11): ISSTA Sport, Golasso, OnTour.** Three more crawlers in `lib/services/competitor-scrapers/` (`issta.ts` fetch-mode, 7 league pages, local-only - see below; `golasso.ts` browser-mode all-packages page + fetchable `/pdetails/<id>` detail; `ontour.ts` fetch-mode `/artists/` → selling performer pages), registered in `index.ts` so the sports package light now compares against LiveEvents + ISSTA + Golasso and the music package light against LiveEvents + OnTour — "alone" needs all of them fresh. **ISSTA is crawled football-only** (`LEAGUES` = 7 soccer competitions), so `CompetitorScraper.covers?()` (`issta.coversEvent`, true only for the `football` vertical tag) gates ONLY the absence claim: a competitor that does not cover the event records `skipped` instead of `not_selling`, which lands the scope on `partial_coverage` rather than a false "alone" — `found`/`unsure` are evidence regardless and are never gated. `CompetitorScraper.detailMode` ("fetch" on golasso and liveevents, default = `mode`) says how `detail()` loads its page, so a browser-mode crawler whose detail pages are plain GETs is paced with `pauseShort()` (5–15 s) instead of the 20–60 s browser pause and actually finishes its enrichment inside the crawl budget; a details-budget cutoff keeps the run `ok` with a `details cut at budget` note (only a catalog cutoff is `partial`). **ISSTA and OnTour publish a travel window, not the match date:** such listings store `event_date = null` + `travel_depart/return`, and the matcher (`candidateCoversDate` in `price-light.ts`, the OR-clause in `candidatesFor`) treats them as on-date when the window contains our date. Shared parser helpers live in `competitor-scrapers/shared.ts`; `ctx.pauseShort()` (5–15 s) is the only pacing allowed between same-site paginated GETs in fetch mode. Fixture regression is per site: `scripts/scrape-fixture.ts <site>` with assertions in `scripts/fixture-checks/<site>.ts`. Recon + build addenda: `docs/superpowers/scrapers/phase2-recon.md`. **The light never touches pricing** — it reads `ourFromUsd`/`ourTicketUsd` and writes only `light_*` columns; the pricing brain (`price-quote.ts`, `base-price-sync`, `/price-changes`) is untouched and stays the source of truth.

**Event kind reads tags (2026-09-17).** `kindOf(e, tagSlugs?)` is music when the type is a music type OR the event carries the `music` feed tag: 136 live music events are `type: "tx_event"` (TixStock) and were classified sports, so their package light compared against ISSTA + Golasso, never OnTour, and sat on `partial_coverage` ("לא נבדק"). Tags come from `lib/services/price-light-tags.ts` (`tagSlugsForEvent` per event; `musicTaggedEventIds` = one chunked, concurrent read for the whole `/price-light` list - `event_tag_links` has no `id`, so not `fetchPaged`); a failed tag read logs and falls back to type-only kinds (the safe direction: never a false "alone"). **"השתנה השבוע"** now means the scope's LIGHT changed in the last 7 days: `light_detail[scope].light_changed_at`, stamped by the pure `stampLightChange` (in `price-light.ts`, column-first: the `light_package`/`light_ticket` column is the previous light, because an override writes the column only) inside `recomputeEventLights`, and by `setLightOverride` when the forced light is new; scopes stamped before this existed read as unchanged. The **"כיסוי חלקי"** view filters `PriceLightScopeCell.partial_coverage` (`reason === "partial_coverage"`); `cell.partial` (unknown listing attrs) is worded "נרמול חלקי" so the two ideas no longer share a name. `/price-light` search reads the Hebrew and English event name.

**Decision screen, second pass (2026-09-17, doc tab "רמזור אפיון").** (a) **A column per competitor** (`COMPETITOR_ORDER` in `price-light-client.tsx`; only competitors in play for the rows on screen get one): price + own gap pill per scope, "לא מכוסה" = `skipped`, "מוכר · הצעת מחיר" = quote-only, a dot on the competitor that set the light. The header is a three-state button - filter to the events that competitor sells (`?comp=golasso`, kept in the URL beside `?scope=`), then sort by the gap against it, then clear. The same filter is also a visible select on the toolbar ("כל המתחרים") with a chip "מוכר ע״י X · N מתוך M" that clears it - a header click alone changed nothing the eye could see when the top rows already belonged to that competitor. Our four-line breakdown (טיסה / מלון / כרטיס / עמלות לקוח) sits compact under our price. (b) **"הוזל" is a popover, and it is the ONE price write this feature makes** - a markup, never a base price, never the pricing rule: `setEventMarkupFromLight(eventId, scope, value, { markPriceDrop })` writes a single explicit column (package -> `event_additional_markup`, ticket -> `ticket_only_markup`, null clears the ticket-only price; 0..5000; NOT through `updateEvent`), then recomputes the lights, invalidates, revalidates main and audits `price_light.repriced` with the decision snapshot + `{ column, before, after }`. The live line "מחיר ← X · פער ← Y · אור ← Z" is the pure `previewMarkupChange` (`price-light.ts`) - same price functions, same `lightFor` band as the engine, fed by `PriceLightRow.pricing` (the priced columns only, cheapest ticket only). The popover's link to the event page still records `markRepriced`. **"המחיר ירד"** (package only): the checkbox stamps `price_drop_usd/from/until` from the SITE card price (`ourPackageUsd`) before/after, same columns and `PRICE_DROP_SHOW_DAYS` as the nightly tag; it is offered only from `PRICE_DROP_MIN_USD`, because the nightly would clear a smaller one the same night. (c) **"סולד אאוט"**: `setEventSoldOut(eventId, on)` writes `events.tags = "Sold"` (main's `isEventSoldOut`: sold-out card, not bookable, out of search, out of stock in the feed); the tag it replaced rides in the audit row (`price_light.sold_out`, `previous_tags`) and turning it off restores it (`price_light.sold_out_cleared`). It is a learning source for the agent. (d) **"בדוק עכשיו" refreshes ONE row**: `recheckEvent(id, { withRow, describeOurs })` returns the fresh `PriceLightRow` (single-event `buildPriceLightRow`, uncached) and the client patches it in place - a full reload re-sorted the table and the row the reader was on jumped away; with `describeOurs` an admin's recheck first re-describes OUR package when `light_detail.ours.at` is older than `OUR_OFFER_REFRESH_DAYS` (never fails the recheck). The events-table icon asks for neither. The row also carries `site_url` (`${PUBLIC_SITE_URL}/order/{id}`) and shows "נבדק לפני X". (e) **Rule C - a scope that TURNS red tonight gets a task**: `price-light-nightly` opens an unassigned `price_light` task per (event, scope) transition into red (never for a scope that was already red - 225 ticket lights were red the day this shipped), skipping muted events, at most `AUTO_RED_TASKS_PER_RUN` (15) a night, deduped by `openPriceLightTask`; the mail reports "N משימות נפתחו". The task carries **price advice** - `lib/services/price-advice.ts`, pure and selftested: the markup cut that reaches orange / green inside the light's own band (or "markup alone will not close it"), a cheaper ticket source when LiveTickets' shelf price for the same event undercuts our cheapest ticket by $20+, and the cost of an extra night at OUR night rate. Facts, never a decision, and it never writes a price.

**Staff notes after the 17.09 check (2026-09-18, doc tab "רמזור אפיון").** (a) **The combined row is lighter:** under the "חבילה + כרטיס" lens the site price, `OurBreakdown`, the listing link, the nights line and the adjustment chips are hidden - they show under a single-scope lens and always in the sheet. (b) **A picked competitor stands alone:** `shownCompetitors = [comp]`, the gap column becomes `gapOf(cell, comp)` ("פער מול X", and the default sort follows it), and a card in `CompetitorsPanel` is the same filter (`picked` / `onPick`, click again = clear). (c) **The comparison sheet sets its own direction** (`dir="rtl"` on `SheetContent` - the dashboard around it is LTR): every " · " piece of a line is its own `<bdi>` (`Mixed` / `Segment`), and a time or date range is pinned `dir="ltr"` with an arrow ("15:10 → 17:55") - in one bidi run the pieces traded places. (d) **Why the sheet said "לא פורסם" so often** (measured with `scripts/offer-detail-coverage.ts [--matched] [--samples N]`, read-only: 16 of 69 matched Golasso listings had a detail text, 6 of 42 LiveEvents, 0 of 24 ISSTA parsed, LiveTickets none): `detail_text != null` is how the detail queue reads "page already opened", and two CATALOG parsers wrote junk there - ISSTA its card tagline (all 46 rows, so none was ever queued) and LiveEvents the board's status cell ("פסח"). Both emit `null` now (ISSTA `attrs: null` too - the card's window-only attrs overwrote enriched ones every crawl; nights still come from `listingNights()`), and migration `20260918090000` clears what they left. **Never put anything but a detail page's text in `detail_text`** - and never a text on an attrs-less listing you do not want sent to the AI (`price-light-match.ts` extracts when `detail_text && attrsAllUnknown`), which is why LiveTickets' seat category is read from `live_events.ticket_categories` inside `buildComparison` instead of being stored. **ISSTA has a real detail page:** the card's `/loader?url=` opens `/sport/details?...`, server-rendered from an Israeli address; `issta.detail()` (runs locally with the crawl) reads the pre-selected flight strip, the `selected` hotel (stars = icon count, breakfast from the facility list) and the seat category at "תוספת €0", fills `attrs` and stores a compact summary ("טיסה: ... | מלון: ... | כרטיס: ...") that `offer-detail.ts` `parseIssta` reads back - fixture `scripts/fixtures/issta/detail.html`. **LiveEvents `/show/` tier pages** are followed to their cheapest `/package/` (`cheapestPackageUrl`, one more paced GET). **One page, many listings:** the detail loop reuses a URL already read this run (LiveEvents keeps a listing per show date on one package URL - six Shakira nights re-read one page and ate the 10-page cap); a reused page's travel window is applied only to the listing whose date it holds (`windowFits`), and the cap `continue`s rather than `break`s so later rows can still reuse. With the weekly cadence and `DETAIL_PAGES_PER_RUN` 10 the contents fill in over a few crawls, matched listings first.

**Staff corrections in the detailed comparison (2026-09-18).** Spec `docs/superpowers/specs/2026-09-18-price-light-corrections-design.md`. A pencil on every COMPETITOR row of the sheet (`correction-dialog.tsx`; our own side is never editable - it is the pricing rule's answer) lets an admin fix what the crawl or the AI got wrong about one listing: its price, the six `ExtractedAttrs`, three display texts (airline / hotel name / ticket), or "this is not our event" - with a structured reason (`CORRECTION_REASONS`) and a mandatory note. **A correction is an OVERLAY row in `competitor_listing_corrections`, never a write to `competitor_listings`** (the next crawl would overwrite it). Rules are pure and selftested - `lib/services/price-light-corrections.ts`, `scripts/price-light-corrections-selftest.ts`; table access is `price-light-corrections-store.ts`. **Precedence per field: staff > page > AI.** Scope: everything is LISTING-wide (it follows the listing into every event matched to it) except `not_same_event`, which belongs to one (event, listing) pair and is therefore loaded by event (`loadPairCorrections`) - its listing is no longer matched, so nothing else would lead back to it. **Live = not revoked AND the crawled value still equals the `original` it was made against** - when the source changes the market moved and the correction is stale (the override's drift idea); liveness is computed on read, nothing writes an expiry, and saving a field back to the crawled value revokes instead of stacking. `original` for an attribute is the PAGE's value, never the AI's; `source` (`page`/`parser`/`ai`/`rule`/`none`) separately records who produced what staff saw, and the client never sends either. **It changes the light at once (Dor):** `matchEvent` runs `correctCandidates` before anything is decided (a pair-marked listing is no candidate, a corrected price is what the rule, the judge and `normalize` see - so a quote-only listing can be given a price) and `correctAttrs` after the page/AI merge; `saveListingCorrections` / `revokeListingCorrection` (in `price-light-actions.ts`, `requireAdmin`) then re-match that event rule-only plus up to `CORRECTION_REMATCH_OTHERS` (5) other events resting on the listing - the rest follow at the nightly - and hand back the fresh comparison + table row, patched in place. A cache hit reuses `ai_verdict.attrs`, not the row's merged `attrs` (`verdictAttrs`), or a revoked correction would live on inside "the AI's answer". **What "the AI learns" means:** every change is audited `price_light.corrected` (`{competitor, listing_id, listing_title, event_name, scope, field, from, to, source, reason, note}`), but the judge's `learnsFrom` quotes it only when the value was the AGENT's own (`source: "ai"`) or the field is `not_same_event` - a parser's misread is not its lesson and would only spend its ten slots; such a row also counts `reviewedBad` in its maturity. Parser mistakes surface instead as the per-competitor count on the competitors strip ("✎ N", by field in the tooltip, `CORRECTION_REPORT_DAYS` 30, `correctionCounts`): many fixes of one field on one site is a crawler bug to fix in code. The store reads the whole un-revoked table once per 20 s per instance (`matchEvent` asks ~2,000 times a nightly pass), a missing table reads as "no corrections" (logged once), and any other read failure THROWS - matching without the corrections would flip a fixed light back. Nothing here writes one of our prices. **Review fixes (same day):** the save validates EVERY field before its first write and a failed re-match never reports "not saved" (`recomputed: false` instead - the row is live); "back to the machine's value" revokes, where the machine's value is the page's, else the AI's, else (nights) the travel window's - so "AI said 3★, we do not know" IS a correction, not a no-op; the re-match runs by "בדוק עכשיו"'s rules (judge available under one `RECHECK_AI_CALLS` budget), because a rule-only pass would turn an AI-made match whose verdict cannot be reused into `unsure`; and `matchEvent`'s `unchanged` guard compares every attribute (`attrsUnchanged`), not nights alone - a correction worth $0 (stars 3, no bag, direct) left `normalized_usd` where it was and the row, with its "נרמול חלקי" flag, was never rewritten. **`scraper.detail()` contract:** a failed fetch THROWS (LiveEvents, ISSTA); `{}` means "read, no package on it", which `runCrawl` stamps `""` = opened for good. The loop leaves a throwing URL's listings untouched (`failedThisRun`) so they queue again - with one page shared across listings, a cached `{}` from a timeout would have closed every one of them.

**The price advisor's two newer facts: other travel days, other ticket suppliers (2026-09-18, staff doc note 6).** Agent #2 still only WORDS and RANKS facts - so the ability lives in the facts. `lib/services/price-alternatives.ts` QUOTES (never decides, never writes a price) and stores under `light_detail.ours.alt` (`OurAlternatives`; inside `ours` on purpose - every writer of `light_detail` already carries `ours` over whole, and `storeOurOffer` keeps `alt` across a re-describe): **(a) travel days** - `altDateCandidates` (pure, `price-advice.ts`): leave a day later, return a day earlier, both, or the same length shifted a day either way, bounded by what our packages already keep (land by the day BEFORE the event, fly home the day AFTER at the earliest, nothing before tomorrow); each window AND the baseline go through the pricing rule's own flight search (`describeRuleFlight`, exported) side by side, so a saving compares two prices quoted the same minute. Only for a RED PACKAGE (225 of 242 red events on the day were red on the ticket alone), never for an offline flight (fixed days); **`skip_flight` is NOT a gate** - it is true on almost every event and the light ignores it too. **(b) suppliers** the event does not already buy from (`ticketSupplier`): LiveTickets (the listing the ticket light already matched -> `live_events`, cheapest category the attach flow would accept, `liveTicketsPriceUsd`), TixStock (catalog has no prices -> the matched event's live feed, pairs only; `fetchTixStockFeed`) - both attachable today - and XS2Event (`xs2e_events.min_ticket_price_eur`, in EUR not cents; NOT attachable as a second supplier, and the sentence says "מידע בלבד"). TixStock/XS2 rows are paired by the light's own `pickRuleMatch` over ±1 day, the bar a competitor listing has to pass. `sell_usd` = the supplier's cost through OUR per-currency markup (`supplierPriceUsd`), so it compares with our cheapest ticket like for like. **Facts** (`altDatesFacts`, `supplierSwapFacts`, kinds `alt_dates` / `supplier_swap`): flight difference + a shorter stay at OUR night rate (the hotel is not re-searched per window, and the sentence says so), floor `ALT_DATES_MIN_SAVING_USD` 30, two shown; suppliers from `SUPPLIER_MIN_SAVING_USD` 20, and a quoted LiveTickets alternative REPLACES the older `cheaper_ticket` shelf-price line. The advisor's house rules and system prompt were widened to match (they forbade pointing at anything but a markup cut). **When:** the second half of the `price-light-ours` cron (02:40) spends what is left of its 260s budget on red events whose `alt.at` is missing or older than `ALT_REFRESH_DAYS` (3), never-quoted first, `ALT_CONCURRENCY` 2 (measured 4-8s an event); "פרט את שלנו עכשיו" re-quotes a red event on the spot (Dor: Amadeus is our own paid environment - sample it whenever). A scope that turned red only tonight has no `alt` yet, so its auto-task carries the three older facts. **Where:** the auto-opened task (unchanged path, AI-worded), plus - deterministic lines only, a sheet must never cost a model call - `AdviceBlock` above each red scope in the comparison sheet (`PriceLightComparison.advice` / `alt_at`) and in the "הוזל" popover (`getPriceAdvice`, loaded on open, never on the list payload).

**Contents accuracy + what the agent learns (2026-09-19).** Measured first (`scripts/offer-detail-coverage.ts --matched`): the offer parsers read every page they were given (Golasso 16/16, LiveEvents 2/2) - the hole was that the pages were never OPENED (LiveEvents 2 of 42 matched listings, ISSTA 0 of 25), because enrichment rode on the weekly catalog crawl at ten pages a visit. **Details pass** (`runDetailPass` / `pickDueDetailPass`, `price-light-crawl.ts`): a tick with no catalog due opens up to `DETAIL_PAGES_PER_RUN` detail pages of ONE site whose last visit of any kind is older than `DETAIL_PASS_HOURS` (24) - same queue (`listingIdsWorthDetail`), same pacing, no catalog re-crawl; the loop itself is `enrichDetails`, shared with `runCrawl`. Its run row is `trigger: "details"` and finishes as `skipped`, so every reader of the table (catalog interval, circuit, `hadGoodCrawl`, "next due") ignores it - it must never postpone or vouch for a catalog crawl; in flight it is `running` and holds the lock. `?details=<key>` forces one on the cron; `scripts/crawl-local.ts <site> --details` forces one locally, and the daily ISSTA task runs one by itself on the days the catalog is not due. First live passes: ISSTA 0 -> 19 of 25, LiveEvents 2 -> 16 of 42. **A detail page that is GONE (HTTP 404/410) is read as `{}`** (stamped `""`, never queued again) - LiveEvents keeps dead `/package/` URLs on its board and a throw re-queued them first, for ever; Golasso's `detail()` now THROWS on any other failed fetch like the rest (it answered `{}`, which would have closed a listing for good over one timeout). The competitors strip shows **"תכולה X/Y"** per site (`CrawlPanelRow.details`: matched listings whose page was read). **LiveTickets seat** (`lib/services/seat-tier.ts`, pure, `scripts/seat-tier-selftest.ts`): our category names (TixStock) and theirs do not pair by text (86 of 91 events), so a coarse tier is read off each name (vip / cat N / standing / upper / middle / lower / side; unknown = null, never a guess) and the sheet's ticket cell says the seat's price, "הזול מתוך N קטגוריות", "מושב שונה משלנו" when both tiers are known and differ, and their cheapest seat in OUR tier (`ComparisonOffer.ticket_note`, display only - the light still compares cheapest with cheapest). One show split over several `live_events` rows is not a thing (1 of 1,779). **The normalized price explains itself**: `ComparisonOffer.adjustments` prints "פורסם $1,043" and each like-for-like step under the big number - staff had read Golasso's $801 as a bad conversion of EUR 899 (it converted correctly to $1,043) and "corrected" the price. **Impossible nights**: a stated night count above `MAX_WINDOW_DAYS` is their typo, not a trip (`listingNights` + `normalize`; OnTour printed a 2027 return for a 2026 show: 368 nights, normalized -$27,596, a red light and an auto task off it). **What the judge learns, and from where** - AI Factory -> "זיכרון ולימוד": `traceAgentLessons` (`lib/agents/memory.ts`; `loadAgentLessons` IS its quoted slice, so the screen cannot disagree with the prompt) lists every mark of the lookback window as `quoted` / `over_quota` / `dropped` with the source's own `whyDropped`, a per-source count table, and the whole memory block exactly as the model reads it (`AgentDetail.promptPreview`). Three teaching bugs it exposed the day it shipped: (1) a correction taught the judge only when the wrong value was the agent's own, so all five real corrections - notes included - reached nobody; now `correctionTeachesJudge` also quotes any correction of one of the six attributes the agent extracts (a note like "רק תיק גב = בלי מזוודה" is about READING a listing), while price / airline / hotel name / ticket text stay the crawler's (the "✎ N" report); (2) tasks the NIGHTLY opened were quoted as "a human opened a task" and held five of the ten slots - dropped now (`metadata.auto`, or an actor-less older row via `AuditLessonRow.by`); (3) a 200-char cut ended a real staff note before its point - `lessonChars` 340, `memoryMaxChars` 4,000 on both agents. The tab also says what this agent can act on: a taught rule about pricing or which flight to buy enters the prompt and changes nothing (the one rule staff wrote so far is exactly that).

**Staff notes 23.09 (doc tab "רמזור"): own call per competitor, AI rule, low-cost, light follows our side.**
(1) "Editing doesn't recompute" was two things. A competitor correction DID recompute (event 1108 red -> orange,
task auto-closed); staff read an unchanged red as "nothing happened" (717: still $267 dear after the fix; 781:
"corrected" €1,349 to $1,542 = the same price - the $1,280 on screen was the NORMALIZED price, 4★ vs our 3★). So
`saveListingCorrections` / `revokeListingCorrection` now return `lights: { before, after }` and the toast says
"חבילה: אדום ← כתום" / "נשאר אדום"; the sheet always prints the published price in dollars under the normalized one.
The real bug was OUR side: `updateEvent` and "פרט את שלנו עכשיו" (`refreshOurOffer`) never recomputed the light -
now `updateEvent` calls `recomputeEventLights` (stored answers, no crawl, no AI; never fails the save) and
`refreshOurOffer` re-matches by "בדוק עכשיו"'s rules (`rematchEvent`) and returns the fresh row, patched in place.
(2) **"הוסף חוק ל-AI"** in the sheet header writes an `agent_instructions` row for `price-light` (the existing
taught-rules table, listed and retired in AI Factory -> "זיכרון ולימוד") - the dialog says the judge only matches and
extracts, never sets a color or a price. (3) **Per-competitor call** (`setCompetitorLightOverride`, admin):
`light_detail.competitor_overrides[scope][competitor] = { light, note, by, at, normalized_usd }`. In
`computeScopeLight` (`forced` input) that competitor's verdict is forced (`PerCompetitor.forced.computed` keeps the
computed one), it drops out of "cheapest on the shelf", the rest decide among themselves, and the scope takes the
WORSE of theirs and every forced one (a forced red wins and becomes the named competitor). Lapses when that
competitor's normalized price moves > OVERRIDE_DRIFT_USD or it has no price (`competitorOverrideHolds`); only
`recomputeEventLights` rebuilds `light_detail` from scratch and it carries the holding ones. Audited as
`price_light.override` with `per_competitor: true` (the judge's override lesson source). The scope-wide "דריסה" is
unchanged. (4) **Low-cost step** in `normalize()`: THEIR airline (offer parser over the stored detail text + a live
staff "airline" correction, `price-light-match.ts`) low-cost and OURS (`light_detail.ours.flight.airline`) a named
full-service carrier -> +`LOW_COST_USD` on their normalized price, adjustment key `low_cost`; and the reverse (we
low-cost, they full-service) -> -`LOW_COST_USD`. Alon's QA the same day set it to **$300, both directions**, and ruled
Israir / Arkia **charters, not low-cost** (out of `isLowCostAirline`; the list is Wizz, Ryanair, easyJet, Vueling,
Transavia, Pegasus, Blue Bird, Jet2, Eurowings, Volotea + bare IATA codes). Unknown airline = no step and NOT partial.
Measured on 431 live events after that: 4 low-cost-vs-full pairs (all Wizz on their side), 3 lights red -> orange
(Muse 868/869, Inter-Juve 760). It lands on the next match of each event (nightly, "בדוק עכשיו", a correction).
**The sheet shows it from OUR side** (Alon: "לא רוצה שיוריד את המחיר מהם אלא שיתאים את החבילה שלנו לחבילה שלהם"):
a competitor row's big number is what they PUBLISHED (in dollars), and under it "שלנו מותאם לחבילה שלהם: $X" =
our price − Σadjustments, with each step sign-flipped. Same arithmetic, so the gap and the light are unchanged; the
engine still stores `normalized_usd` on their side. Selftests: `scripts/price-light-selftest.ts`.

**Symmetric normalization, couple-buyable LiveTickets, parallel nightly (2026-09-24).** (1) `normalize()` used to
assume OUR package was bare (no bag, no breakfast, direct, 3★), so a competitor's bag / breakfast came off their price
even when ours had one too (781: El Al with a bag; 868/869: our hotel with breakfast). `price-light-match.ts` now passes
`ourPackageAttrs(light_detail.ours)` (bag from the bag wording via `bagIncludedFrom`, breakfast = board not
`room_only`, `direct`, `stars`) and each step prices only the DIFFERENCE - a shared feature is omitted, the reverse
steps exist (`no bag +$120`, `no breakfast +`, `direct vs our connection −$100`, same keys). Unknown ours = the old
bare assumption. Stars and breakfast now scale by THEIR nights (theirs unknown -> ours -> NIGHTS_FALLBACK) - also for
events with no `ours`. Rows move on each event's next match. (2) `cheapestShelf` (LiveTickets ticket light) and the
sheet's seat note consider only categories a couple can buy (`buyableForParty`: `maxTicketAmount` missing or >=
`MIN_PARTY` 2), the price advisor's bar. (3) `price-light-nightly` runs pass 1 `SNAPSHOT_CONCURRENCY` (8) and pass 2
`MATCH_CONCURRENCY` (3) events at a time (`runPool`, start order unchanged), and pass 1 stops by `budgetMs -
MATCH_RESERVE_MS` (150s) so matching always gets its share - sequential, pass 2 reached ~60 of 433 events a night
(~8 days per light). `takeBudget` is synchronous, so the shared `aiBudget` cannot be overspent; the auto-task ceiling
reserves its slot before the awaits. Budget still 240s of `maxDuration` 300.

**Quote-only is its own answer (2026-09-17).** LiveEvents publishes NO price for any sports match ("לקבלת הצעת מחיר" - 164 live listings; many music rows too), so those events could never get a package verdict and sat on "לא נבדק / כיסוי חלקי" - 175 of the 248 unchecked package lights - sending staff to look for a crawl problem that did not exist. `computeScopeLight` now separates a competitor that SELLS without a number (`quote_only`, fresh) from a real hole (no match, stale, unsure, skipped): with no priced competitor, at least one quote and zero holes the scope is `unchecked` with `reason: "quote_only"` ("מתחרה מוכר בהצעת מחיר בלבד", view **"הצעת מחיר בלבד"**, `PriceLightScopeCell.quote_only`). Never "alone" (someone does sell it); a hole beside the quote is still `partial_coverage`; a priced competitor still sets the light as before. **LiveEvents music catalog without a browser:** `/events/` fills its month containers from `admin-ajax.php` (`action=events_table_action&month=MM.YYYY&count=N`); `fetchMusicCatalogViaAjax` POSTs the same (24 months, `MUSIC_MONTH_BATCH` 4 side by side, `pauseShort()` between batches - the real page fires all of them at once) and falls back to the Playwright page only when that yields no rows. The Playwright path returned ZERO music rows from Vercel on 2026-09-15 (607 -> 239 listings) and every music listing was left to go stale. **Ticket light check (2026-09-17):** the 225 red ticket lights are real, not a matching or units bug - all 225 matched the right LiveTickets event, `brt` equals the shelf price on their site (spot check: £125 both), and 197 of them carry `ticket_only_markup` $200, so our ticket-only price sits a median $229 above theirs; the fix is a pricing decision, not code.

**Our "from" price (2026-09-17).** Dor: the site's base prices carry the rule's +$100 flight / +$120 hotel margins ON PURPOSE (the site is an average-per-traveller price, and the margin lets a customer who picks a different flight or hotel see a minus) - never remove them. The light alone compares competitors against our margin-free "from" price: `ourFromUsd(e)` = net flight + net hotel per person + cheapest ticket + `totalMarkupUsd`, where the net comes from `light_detail.ours` (the offer the rule would buy today, offline inventory first) and falls back to `base − margin` (a base at or below the margin is a hand-typed number and is kept whole). The margins live in `lib/services/price-margins.ts`, shared by `price-quote.ts` and the light. `ourPackageUsd` stays the SITE card price and still feeds the daily snapshots and the "ירידת מחיר" tag - switching those would record a fake ~$220 drop. `/price-light` shows "החל מ- (שלנו)" with a four-line breakdown (טיסה / מלון / כרטיס / עמלות לקוח) and `באתר $X` beneath (`PriceLightScopeCell.site_usd`); the nights rate (`ourNightRateUsd`) uses the net hotel too.

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
# Optional. Who gets the morning Follow-up reminder (cron followUpReminder), comma-separated.
# Unset -> Alon's Mega mailbox (DEFAULT_FROM in lib/email.ts).
NEXT_SECRET_FOLLOW_UP_REMINDER_TO=
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
# Agent #2 - the price advisor (lib/agents/price-advisor.agent.ts). Same opt-in, fails-closed rule
# as PRICE_LIGHT_AI above (needs ANTHROPIC_API_KEY too, and AI_AGENTS=off still stops it): unset,
# empty or anything but "on" = off = the deterministic block alone (lib/services/price-advice.ts),
# never a throw. It only ever WORDS and RANKS facts the light already computed - it never sets a
# light, never writes a price, and can never state a number the facts didn't give it.
PRICE_ADVISOR_AI=
# Model id for the advisor. Empty -> its own defaultModel "claude-opus-5" (price-advisor.agent.ts).
PRICE_ADVISOR_AI_MODEL=
# Set -> crawler connects to a remote stealth browser over CDP (Browserbase/Bright Data) and
# that provider owns the fingerprint (UA/locale/timezone/proxy). Unset -> local @sparticuz/chromium.
NEXT_SECRET_BROWSER_CDP_URL=
# Optional residential proxy for the LOCAL chromium path only (ignored when CDP is set above).
NEXT_SECRET_SCRAPE_PROXY_URL=
# Dev-only override so `scripts/scrape-once.ts` can drive a real local Chrome instead of
# @sparticuz/chromium; never read in production (NODE_ENV check).
LOCAL_CHROME_PATH=
# Marketing dashboard (marketingSync cron + /marketing). Values sit in .env.local under
# "MARKETING DASHBOARD"; upload all ten to Vercel. The code reads five of them (READ_TOKEN,
# AD_ACCOUNT_ID, IG_USER_ID, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_SA_JSON_B64) - a missing one fails its
# sync step; the other five are reserved for later work. Meta Graph is called as v26.0 (an
# unversioned call answers "deprecated").
# Meta read token: system user "Insights Reader", never expires (ads_read, read_insights,
# pages_show_list, pages_read_engagement, instagram_basic, instagram_manage_insights).
NEXT_SECRET_META_READ_TOKEN=
# Meta write token: system user "Campaign Toggle" (ads_management) - EXPIRES 2026-11-27. Reserved
# for the campaign pause/resume toggle; nothing reads it yet and reporting never should.
NEXT_SECRET_META_WRITE_TOKEN=
# The ONE Meta ad account of every brand (MYT, Mega Family, Mega TR) - campaigns are told apart by brand.
NEXT_SECRET_META_AD_ACCOUNT_ID=
# Facebook page "מגה תיירות" (reserved) and its Instagram business account @megatr_il (instagram step).
NEXT_SECRET_META_PAGE_ID=
NEXT_SECRET_META_IG_USER_ID=
# Meta pixel on mega-events.co.il (reserved).
NEXT_SECRET_META_PIXEL_ID=
# Google Ads customer id (ILS, not a manager account, one for every brand). The googleAds:search
# calls run on API v25 and need NO developer token.
NEXT_SECRET_GOOGLE_ADS_CUSTOMER_ID=
# The whole service-account JSON, base64 so the private key survives dotenv and Vercel as one line.
# Decode: JSON.parse(Buffer.from(v, "base64").toString()).
NEXT_SECRET_GOOGLE_SA_JSON_B64=
# Site tracking ids (reserved for the GA4 / conversion work): GA4 production stream, Google Ads conversion id.
NEXT_SECRET_GA4_MEASUREMENT_ID=
NEXT_SECRET_GOOGLE_ADS_CONVERSION_ID=
```

## Database

Schema is in `db.schema.sql`. Key tables: `events`, `reservations`, `partners`, `locations`, `p1_events`, `live_events`, `sports_events`, `offline_flights`, `tixstock_events`. Managed via Supabase (PostgreSQL).

Backoffice-only tables (RLS on, no policies, service-role access; main never reads them): `tasks`, `task_rules`, `task_comments`, `task_reads`, `creative_gap_dismissals` (gap_key = `{kind}:{table}:{row_id}`), `base_price_sync_log`, `event_drafts`, `user_profiles`, `audit_log`, the `forms*` family, `prepared_packages`, `competitor_crawl_runs`, `competitor_listings`, `competitor_matches`, `competitor_listing_corrections`, `event_price_snapshots`, and the marketing dashboard's eight (migration `20261008120000`): `ad_spend_daily`, `ad_entities`, `ad_clicks`, `ig_media`, `ig_media_insights_daily`, `ig_account_daily`, `marketing_settings`, `marketing_alerts` (the same migration added `ticket_cost_usd`, `ticket_cost_source`, `actual_cost_usd`, `actual_cost_note` to `reservations`; main writes the first two). Same shape but READ by main with its service client: `google_reviews` + `google_review_sources` (the site's "לקוחות משתפים"; `is_hidden` pulls a review off the site). Several predate the generated `types/database.types.ts` - their actions use a single `const db = supabase as any` boundary cast (scoped eslint-disable) until `npm run db:types` is rerun after the next master merge.

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
   **A TixStock ticket's price is ONE formula in both repos (2026-10-07):** `supplierPriceUsd` (`lib/suppliers.ts`) = (cost + currency markup) → USD → **+3.5% → rounded up**, identical to main's `lib/supplier-pricing.ts`. Main prices the same listing with it on a customer's ticket step AND writes that price back to `events.tickets_and_rates` (`/api/tixstock/tickets`), so two writers hold this column: the TixStock price sync (03/09/15/21 UTC) and every visitor. The sync now prices through `tixstockTicketPriceUsd` (`lib/services/tixstock-price-sync.ts`). Until then it had its own inline formula - no 3.5%, rounded to nearest - so four times a day it wrote every price 3.5% UNDER what the order page charges and the first visitor to each event wrote it back: 340 rewrites a day (859 of their 1,418 ticket prices moved by exactly 3.5%), a card / feed price that dipped in between, and - main dropped its `events` cache tag on each - a re-render of the whole site every time (main's side: `lib/events/livePriceInvalidation.ts`). **The sync also picks the SAME listing main does (same day):** only a listing the site would sell to a pair sets a price - `listingsTheSiteSells` in the pure `lib/tixstock-listings.ts` (`scripts/tixstock-listings-selftest.ts`), main's own three rules mirrored: not in a section staff excluded on the event's map (`events.tx_excluded_sections`), not a restricted / limited / side / partial view, and the seller splits to two (`listingCanSatisfyQuantity`: an all-or-nothing block of four, or three seats under "avoid leaving one", cannot serve a pair). Then the cheapest AS PRICED (each listing through the formula, then the minimum). Before, any listing with 2+ seats did: with the formula alone 65 of 106 just-visited tickets came out equal and 17 more than 4.5% under main, some at a third of the price (event 794: 1,101 stored, 333 from the sync) - a card price hundreds of dollars under what the order page offers, until a visitor came. With both, a dry run on 30 events a visitor had priced in the last two hours: **114 of 117 tickets identical, 27 of 30 events untouched**. A category with no listing the site would sell keeps its price (main does the same); availability (`planTixstockAvailability`) still reads the whole feed. **A rule that changes in main (`lib/tixstock-quantity.ts`, the two filters in `app/api/tixstock/tickets/route.ts`, `categoryMatchesMapId`) changes in `lib/tixstock-listings.ts` too**, or the two writers drift apart again. Not moved: the event editor's two TixStock price buttons (`app/(dashboard)/events/[id]/page.tsx`) still carry the old inline formula and choice - the next sync run corrects what they write.
2. **Main app** calculates final customer price: `base_flight_price + base_hotel_price + min_ticket_price + 175 USD markup`
3. Changing price/markup logic here directly affects what customers see and pay in the main app

### What to Check in Main App After Changes Here

- **Added/removed event fields?** → Check `../myt---main/lib/app.types.ts` and event rendering components
- **Changed price calculation?** → Check `../myt---main/lib/events/price.ts` and `lib/price.utils.tsx`
- **Modified event types?** → Check `../myt---main/lib/app.types.ts` `EventType` and ticket vendor logic
- **Changed DB table schema?** → Check all Supabase queries in `../myt---main/lib/` and `../myt---main/app/api/`
