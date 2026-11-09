# Members Club Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A members club on mega-events.co.il's order summary that replaces today's 22-second discount popup: join with email + phone + consent, get a personal member code worth $50 per ticket on every package order, recorded consent, a welcome mail, and a full backoffice screen.

**Architecture:** The backoffice (master) owns the schema (`club_members`, `club_log`, `club_settings`, `coupons.source`) and the staff screen. The site (myt-main, branch `feat/members-club` in worktree `~/work/myt-main-club`) owns the popup, the row, two public routes, the welcome mail and the unsubscribe page. A member's price is an ordinary per-person coupon row (`source = 'club'`), so validate / confirm-order / `reservations.coupon_code` work unchanged.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase (service role), Mantine (main) / shadcn (backoffice), nodemailer over ZeptoMail SMTP, vitest (main), `npx tsx` selftests + PGlite (backoffice).

**Spec:** `docs/superpowers/specs/2026-11-09-members-club-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Amount = `$50` per **event ticket** (`numberOfEventTickets` in the summary, `number_of_ticket` in confirm-order), settings range `1..500` integer; popup delay `22` s, range `5..120` integer.
- Member code = `"MEGA"` + 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. `member_no` starts at `1001`.
- Consent text (verbatim, `lib/club/copy.ts`): `אני רוצה לקבל ממגה איבנטס עדכונים ומבצעים במייל, ב-SMS ובוואטסאפ. אפשר להסיר בכל רגע.` · `consent_version` = `club-2026-11-09-v1`.
- One consent covers mail, SMS and WhatsApp; any withdrawal sets `marketing = 'unsubscribed'`; the member price stays (D9).
- No club on agent mode, ticket-only (`flightSkipped`), percentage-affiliate, blocklisted events; partner-link visits and "club off" get **today's popup unchanged** (spec §4).
- Lookup and rejoin answers never carry a name and never change `marketing` (spec §8).
- Welcome mail: confirmation only, **no perks / deals / events**. From `"מגה איבנטס" <news@mega-events.co.il>`, Reply-To `SALES_REP_EMAIL`, `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Public routes: 5 requests per IP per hour per route, counted in `club_log`; honeypot field `hp`; every DB call ≤ 3 s; answers `{ ok: false, kind }`, never a thrown error; a club failure never blocks checkout.
- No CHECK constraints on columns main writes. RLS on, no policies, `anon`/`authenticated` revoked on the three new tables.
- `.in()` lists ≤ 200 values. Paged reads over 1,000 rows (`fetchPaged`).
- Backoffice: commit by explicit path (`git commit -- <paths>`), on master, no push until Dor says "push". Main: branch `feat/members-club` only. No AI attribution in commit messages.
- Hebrew UI copy from the spec / the mockup version **Dor picks (still open, spec D11)** - M1's `CLUB_COPY` and M4's `ClubCard` wait for it; every other task does not; English code and commits.

## Review Focus

1. **Two joins of the same email at once** (double click, two tabs): one member, one coupon, the second answer is `returning: true` and the orphan coupon is deleted → test in Task M3.
2. **The mail server refuses** (ZeptoMail credit gone, SMTP down): the join still answers `ok: true` with the code, `welcome_error` is written → test in Task M3.
3. **Email and phone in real-world shapes** (`" Dana@Gmail.COM "`, `"+972 50-123-4567"`, `"050 1234567"`): the same member, a valid phone; garbage is refused with `kind: "invalid"` → test in Task M1.
4. **Settings unreadable** (table missing before the migration, DB timeout): the site shows today's popup and checkout works → test in Task M1 (`parseClubSettings`) and Task M3 (`getClubSettings` failure ⇒ disabled).
5. **A recognized member on a ticket-only order, or with another coupon applied**: nothing is auto-applied, no error shows → test in Task M1 (`shouldAutoApply`).

---

## Part B - Backoffice (myt-backoffice, master)

### Task B1: Migration + SQL test

**Files:**
- Create: `supabase/migrations/<timestamp>_members_club.sql` (via `npm run db:new members_club`, after `git fetch && git merge origin/master`)
- Create: `scripts/club-sql-pglite-test.mjs` (mirror `scripts/tours-waitlist-sql-pglite-test.mjs`: stub tables, `PGLITE_PATH`)
- Modify: `types/database.types.ts` (hand-patch the three tables + `coupons.source`, as done for `reviewer_ids`)

**Interfaces:**
- Produces: tables exactly as spec §7 - `club_members` (columns, `club_member_no_seq` from 1001, unique index on `lower(btrim(email))`, unique `coupon_code`, unique `unsubscribe_token`, index on `phone_key`), `club_log` (index on `(ip, at)`), `club_settings` (`key text pk, value jsonb, updated_at, updated_by`), `coupons.source text null`. Seed `club_settings` key `program` = `{"enabled": true, "discount_per_traveler_usd": 50, "popup_delay_seconds": 22}` with `on conflict do nothing`.

- [ ] **Step 1:** Write `scripts/club-sql-pglite-test.mjs` asserting: two inserts get `member_no` 1001 and 1002; inserting `"Dana@x.com"` then `" dana@x.com"` fails on the unique index; `club_settings` has the `program` row with the three values; `coupons.source` exists and is nullable; running the migration twice succeeds (idempotent).
- [ ] **Step 2:** Run `PGLITE_PATH=… node scripts/club-sql-pglite-test.mjs` → FAIL (no migration).
- [ ] **Step 3:** Write the migration (idempotent: `if not exists`, `on conflict do nothing`; RLS on; `revoke all … from anon, authenticated`; no CHECK constraints).
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Hand-patch `types/database.types.ts`; `npx tsc --noEmit` shows no new errors.
- [ ] **Step 6:** Commit: `feat(club): members club tables, settings seed, coupons.source`.

### Task B2: Pure rules + selftest

**Files:**
- Create: `lib/club/types.ts`, `lib/club/settings.ts`, `lib/club/stats.ts`, `lib/club/csv.ts`
- Create: `scripts/club-selftest.ts`

**Interfaces:**
- Produces:
  - `type ClubSettings = { enabled: boolean; discount_per_traveler_usd: number; popup_delay_seconds: number }`
  - `validateClubSettings(input: unknown): { ok: true; value: ClubSettings } | { ok: false; error: string }` - integers only, amount 1..500, delay 5..120, enabled boolean.
  - `type ClubMemberRow` (the `club_members` columns the screen reads) and `type ClubOrderRow = { coupon_code: string; status: string; created_at: string; user_shown_price: number | null; coupon_discount_usd: number | null }`
  - `CLUB_RANGES = ["7d","30d","90d","all"] as const`; `clubWindow(range, now, firstJoinDay)` → `{ since, until }` (Israel days; "all" starts at the first join day; the first three via `resolveWindow`).
  - `clubOverview(members: ClubMemberRow[], orders: ClubOrderRow[], win: {since,until}, prev: {since,until}): ClubOverview` with `members.total`, `members.inWindow`, `members.prevWindow`, `members.trend` (`trendOf`), `joinsByDay: {day,count}[]` (every day of the window, zeros included), `orders.all`, `orders.paid`, `paidRevenueUsd`, `discountGivenUsd` (Paid only), `unsubscribed`, `welcomeFailed`, `topEvents: {eventId, members}[]` (top 5).
  - `membersCsv(rows: ClubMemberRow[]): string` - UTF-8 BOM, header `member_no,first_name,last_name,email,phone,joined_at,source,marketing,status,utm_source,utm_medium,utm_campaign,code`, joined_at in Israel time `YYYY-MM-DD HH:mm`, quotes doubled, fields with comma/quote/newline quoted.

- [ ] **Step 1:** Write `scripts/club-selftest.ts` (node:assert/strict, style of `scripts/marketing-range-selftest.ts`): settings bounds (0 → error, 500 → ok, 12.5 → error, `"50"` → error); an order Paid on 2026-11-03 counts `discountGivenUsd` 100 and an unpaid one counts 0; a join at 23:30 UTC on 2026-11-02 lands on Israel day 2026-11-03; `joinsByDay` for a 7-day window has 7 entries; CSV escapes `Levi, "Dana"` as `"Levi, ""Dana"""` and starts with `﻿`.
- [ ] **Step 2:** `npx tsx scripts/club-selftest.ts` → FAIL.
- [ ] **Step 3:** Implement the four modules.
- [ ] **Step 4:** `npx tsx scripts/club-selftest.ts` → PASS.
- [ ] **Step 5:** Commit: `feat(club): pure rules - settings, overview stats, CSV`.

### Task B3: Data access + server actions

**Files:**
- Create: `lib/services/club-db.ts`, `lib/actions/club-actions.ts`

**Interfaces:**
- Consumes: B2 types and functions.
- Produces (all `"use server"`, `requireAdmin()` first, input validated before any read, `{ ok: false, kind }` on failure, tolerate the tables missing → `kind: "not_ready"`):
  - `getClubPage(range: string): Promise<{ ok: true; settings: ClubSettings; overview: ClubOverview; members: ClubMemberView[] } | { ok: false; kind: string }>` - ONE action for the screen (repo rule: one load per screen). `ClubMemberView` = `ClubMemberRow` + `ordersAll`, `ordersPaid`, `paidRevenueUsd`, `eventName`.
  - `getClubMemberLog(memberId: string)` → the member's `club_log` rows, newest first.
  - `saveClubSettings(input: unknown)` → validate, upsert `club_settings.program`, `update coupons set discount_value = $amount where source = 'club'`, `logAudit({ action: "club.settings", changes: { before, after } })`.
  - `unsubscribeClubMember(id)`, `removeClubMember(id)` (status `removed`, `removed_at`, coupon `is_active = false`), `restoreClubMember(id)` (back to `active`, coupon active) - each writes a `club_log` row and an audit row.
  - `resendClubWelcome(id)` → `POST {main base}/api/club/resend` with header `x-hotel-secret: NEXT_SECRET_REVALIDATION_SECRET`, body `{ memberId }`, 10 s timeout; main base = the base `fetchPools` uses for `/api/homepage-pools`; a 404 → `kind: "site_not_ready"`.
- Reads: members via `fetchPaged`; member orders = `reservations` (`coupon_code, status, created_at, user_shown_price, coupon_discount_usd`, not deleted) where `coupon_code` in the member codes, chunks of 200.

- [ ] **Step 1:** Add to `scripts/club-selftest.ts` a check of the pure `memberViews(members, orders, eventNames)` helper (put it in `lib/club/stats.ts`): a member with one Paid and one Pending order shows `ordersAll` 2, `ordersPaid` 1, revenue of the Paid one only.
- [ ] **Step 2:** Run → FAIL. Implement `memberViews`, `club-db.ts`, `club-actions.ts`.
- [ ] **Step 3:** Run selftest → PASS; `npx tsc --noEmit` clean for the new files.
- [ ] **Step 4:** Commit: `feat(club): club data access and admin actions`.

### Task B4: The screen, nav, guide

**Files:**
- Create: `app/(dashboard)/marketing/club/page.tsx`, `club-client.tsx`, `overview-tab.tsx`, `members-tab.tsx`, `settings-tab.tsx`
- Modify: `lib/nav.ts` (Marketing group: `{ name: "Members Club", href: "/marketing/club", icon: <lucide Ticket>, keywords: "club members newsletter מועדון חברים שורה ראשונה", roles: ADMIN_ROLES, productType: "events" }`)
- Modify: `app/(dashboard)/guide/guide-content.ts` (a section for `/marketing/club`, EN + HE, how the club works on the site, what each tab shows, what the switch does)

**Interfaces:**
- Consumes: `getClubPage`, `getClubMemberLog`, `saveClubSettings`, `unsubscribeClubMember`, `removeClubMember`, `restoreClubMember`, `resendClubWelcome`.
- Behaviour per spec §10: `UrlTabs` `?tab=overview|members|settings`, `?range=7d|30d|90d|all` (default `30d`); Members = `DataTable` with `stateKey`, search, a pinned `actions` column (resend / unsubscribe / remove or restore / log in a dialog), "Export CSV" of the filtered rows via `membersCsv` (a Blob download in the dashboard - it is not an artifact); Settings = switch + two number inputs, Save shows a toast with what changed.

- [ ] **Step 1:** Build the screen and wire nav + guide.
- [ ] **Step 2:** `npx tsx scripts/guide-selftest.ts` → PASS (it fails if the new menu screen has no section).
- [ ] **Step 3:** `npm run dev` (check `.env.development.local` exists first - local DB), open `/marketing/club` in the browser pane, apply the migration to the local DB, insert two test members by SQL, see the cards, the table, the CSV and a settings save; screenshot.
- [ ] **Step 4:** Commit: `feat(club): Members Club screen, nav and guide`.

### Task B5: /coupons filter, reservation chip, WhatsApp "הסר"

**Files:**
- Modify: `lib/actions/coupon-actions.ts` (`getCoupons()` → `getCoupons({ includeClub = false } = {})`, filters `source is null or source <> 'club'` unless asked)
- Modify: `app/(dashboard)/coupons/coupons-table.tsx` (toggle "Show member codes")
- Modify: `app/(dashboard)/reservations/[id]/page.tsx` (chip "חבר מועדון #<member_no>" next to the price when `coupon_code` matches a member; one extra read by code)
- Modify: `lib/services/whatsapp-events-inbound.ts` (`EventsInboundDeps.unsubscribeClubByPhone(phoneKey: string, at: string): Promise<number>`, called inside the `isOptOutWhole` branch after `markChat`, in try/catch, never blocks the reply)
- Modify: `lib/services/whatsapp-events-db.ts` (implementation: update `club_members` where `phone_key = $key and marketing = 'subscribed'` → `unsubscribed`, `unsubscribed_at`, `unsubscribe_source = 'whatsapp'`; one `club_log` row each; a missing table (42P01 / PGRST205) = 0)
- Modify: `scripts/whatsapp-events-selftest.ts`

- [ ] **Step 1:** In `whatsapp-events-selftest.ts`, assert a whole-message "הסר" calls the fake `unsubscribeClubByPhone` once with the phone's last 9 digits, and that a throwing fake still sends the opt-out reply.
- [ ] **Step 2:** Run `npx tsx scripts/whatsapp-events-selftest.ts` → FAIL.
- [ ] **Step 3:** Implement the five file changes.
- [ ] **Step 4:** Selftest → PASS; `/coupons` in the browser pane hides a test `source='club'` row until the toggle.
- [ ] **Step 5:** Commit: `feat(club): hide member codes on /coupons, member chip, WhatsApp opt-out reaches the club`.

---

## Part M - Site (myt-main, branch `feat/members-club`)

### Task M0: Worktree

- [ ] `git -C ~/work/myt-main fetch origin && git -C ~/work/myt-main worktree add -b feat/members-club ~/work/myt-main-club origin/main`; `cd ~/work/myt-main-club && yarn install --frozen-lockfile`; `yarn vitest run lib/__tests__/cheapestTicket.test.ts` passes (the harness works). Never switch the shared `~/work/myt-main` checkout.

### Task M1: Pure club rules + copy

**Files:**
- Create: `lib/club/copy.ts`, `lib/club/rules.ts`
- Test: `lib/__tests__/club.test.ts`

**Interfaces:**
- Produces:
  - `copy.ts`: `CLUB_CONSENT_TEXT`, `CLUB_CONSENT_VERSION = "club-2026-11-09-v1"`, `CLUB_COPY` (version A strings from the mockup: title "רוצים לשבת בשורה הראשונה?", sub, three perks, cta "שריינו לי מקום", already-link, member title, welcome "ברוכים הבאים לשורה הראשונה", welcome-back "ברוכים השבים", row title "השורה הראשונה של מגה", row sub "חברים מקבלים מחיר חבר", applied "מחיר חבר הופעל", swap "להחליף למחיר חבר", ticket-only refusal "מחיר חבר תקף בהזמנת חבילה עם טיסה", not found "לא מצאנו את המייל הזה במועדון", error "משהו השתבש, נסו שוב").
  - `type ClubSettings = { enabled: boolean; discount_per_traveler_usd: number; popup_delay_seconds: number }`; `parseClubSettings(json: unknown): ClubSettings` - anything malformed ⇒ `{ enabled: false, discount_per_traveler_usd: 50, popup_delay_seconds: 22 }`.
  - `type ClubSurface = "club" | "legacy_popup" | "none"`; `clubSurface(v: { enabled: boolean; isAgentVisitor: boolean; arrivedViaPartner: boolean; flightSkipped: boolean; isPercentageAffiliateDiscount: boolean; isSpecialOfferAllowed: boolean }): ClubSurface` - order: agent / percentage / blocklisted / flightSkipped ⇒ `none`; partner ⇒ `legacy_popup`; `!enabled` ⇒ `legacy_popup`; else `club`.
  - `MEMBER_CODE_ALPHABET`; `newMemberCode(randomInt: (maxExclusive: number) => number): string`.
  - `cleanEmail(v: unknown): string | null` (trim, lower case, `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤ 254); `cleanPhone(v: unknown): string | null` (digits only, a leading `+` dropped, 9..15 digits); `phoneKey(phone: string): string` (last 9 digits); `maskEmail(email): string` (`d***@gmail.com`).
  - `clubCouponQty(coupon: { source?: string | null }, persons: number, eventTickets: number): number` - club ⇒ `eventTickets`, else `persons`.
  - `couponFitsOrder(source: string | null | undefined, hasOutbound: boolean): boolean` - club needs an outbound leg.
  - `CLUB_COOKIE = "myt_club"`; `type ClubCookie = { v: 1; code: string; no: number; name?: string }`; `parseClubCookie(raw: string | null | undefined): ClubCookie | null` (rejects a code that fails `normalizeCouponCode` or does not start with `MEGA`); `serializeClubCookie(c: ClubCookie): string`.
  - `shouldAutoApply(v: { surface: ClubSurface; slotEmpty: boolean; flightSkipped: boolean; cookie: ClubCookie | null }): boolean`.

- [ ] **Step 1:** Write `lib/__tests__/club.test.ts`: the surface table of spec §4 (one case per row, plus `enabled: false` ⇒ `legacy_popup`); `newMemberCode(() => 0)` = `"MEGAAAAAAA"` and every char in the alphabet over 1,000 random draws; `cleanEmail(" Dana@Gmail.COM ")` = `"dana@gmail.com"`, `cleanEmail("dana@")` = null; `cleanPhone("+972 50-123-4567")` = `"972501234567"`, `cleanPhone("050 1234567")` = `"0501234567"`, `cleanPhone("12345")` = null; `phoneKey("972501234567")` = `"501234567"`; `clubCouponQty({source:"club"}, 3, 2)` = 2 and `({source:null}, 3, 2)` = 3; `couponFitsOrder("club", false)` = false, `(null, false)` = true; `parseClubSettings(null).enabled` = false, `parseClubSettings({enabled:true, discount_per_traveler_usd:50, popup_delay_seconds:22}).enabled` = true; `shouldAutoApply` false when `flightSkipped`, false when `!slotEmpty`, false when `surface !== "club"`, true otherwise with a cookie; cookie round-trip, and `parseClubCookie('{"v":1,"code":"ABC","no":1}')` = null.
- [ ] **Step 2:** `yarn vitest run lib/__tests__/club.test.ts` → FAIL.
- [ ] **Step 3:** Implement `copy.ts` and `rules.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(club): pure rules and version A copy`.

### Task M2: Coupon path knows `source`

**Files:**
- Modify: `lib/app.types.ts` (`Coupon.source?: string | null`), `lib/coupon.utils.ts` (`AppliedCoupon.source?: string | null`), `lib/coupons.ts` (`findValidCoupon` selects `source`; on 42703 / PGRST204 re-selects without it), `app/api/coupons/validate/route.ts` (answer adds `source`), `app/api/confirm-order/route.ts` (after `findValidCoupon`: `if (!couponFitsOrder(coupon.source, !!validatedData.flight_order_info?.outbound)) → 409 COUPON_INVALID` with a log line)
- Test: `lib/__tests__/club.test.ts` already covers `couponFitsOrder`; add `lib/__tests__/coupons.test.ts` case if one exists for `findValidCoupon`, else none.

- [ ] **Step 1:** Make the changes.
- [ ] **Step 2:** `yarn vitest run` → all PASS; `npx tsc --noEmit` clean for the touched files.
- [ ] **Step 3:** Commit: `feat(club): coupons carry source; confirm-order refuses a member code without a flight`.

### Task M3: Join / lookup / resend / unsubscribe server + welcome mail

**Files:**
- Create: `lib/club/join.ts` (orchestration over injected deps), `lib/club/db.ts` (real deps over `@/lib/supabase`, each call raced against a 3 s timeout), `lib/club/mail.ts`, `lib/club/settings-server.ts` (`getClubSettings(): Promise<ClubSettings>`, 60 s in-memory cache, any failure ⇒ `parseClubSettings(null)`)
- Create: `app/api/club/config/route.ts` (GET → `{ enabled, popupDelaySeconds }`), `app/api/club/join/route.ts`, `app/api/club/lookup/route.ts`, `app/api/club/unsubscribe/route.ts` (POST `{ t }` or one-click form post), `app/api/club/resend/route.ts` (POST, `x-hotel-secret` must equal `NEXT_SECRET_REVALIDATION_SECRET` else 401), `app/club/unsubscribe/page.tsx` (masked email + button; done text "הוסרת מהעדכונים. מחיר החבר נשאר שלך.")
- Test: `lib/__tests__/clubJoin.test.ts`, `lib/__tests__/clubMail.test.ts`

**Interfaces:**
- Consumes: M1.
- Produces:
  - `type ClubAnswer = { ok: true; code: string; memberNo: number; firstName: string | null; discountType: "fixed"; discountValue: number; perPerson: true; returning: boolean } | { ok: false; kind: "off" | "invalid" | "rate_limited" | "removed" | "not_found" | "error" }`
  - `type ClubCtx = { ip: string | null; userAgent: string | null; sourcePath: string | null; utm: UtmCookie | null; now: Date }`
  - `type ClubDeps = { settings(): Promise<ClubSettings>; countRecent(ip: string, actions: string[], sinceIso: string): Promise<number>; memberByEmail(emailKey: string): Promise<ClubMember | null>; insertCoupon(code: string, amount: number): Promise<{ id: number } | { clash: true }>; deleteCoupon(id: number): Promise<void>; insertMember(row: NewClubMember): Promise<ClubMember | { clash: true }>; log(row: ClubLogInsert): Promise<void>; sendWelcome(m: ClubMember): Promise<{ ok: true } | { ok: false; error: string }>; markWelcome(id: string, result: { ok: true } | { ok: false; error: string }): Promise<void>; randomInt(max: number): number }`
  - `db.ts` `insertCoupon` writes `code, discount_type: "fixed", discount_value: amount, per_person: true, is_active: true, source: "club", event_id: null, max_uses: null, valid_until: null` (spec §6).
  - `joinClub(input: unknown, ctx: ClubCtx, deps: ClubDeps): Promise<ClubAnswer>` - spec §8 steps 1-6; code clash ⇒ new code, ≤ 3 tries; member clash (same email, race) ⇒ delete the coupon, re-read, answer `returning: true`; welcome mail with a 4 s deadline, result recorded by `markWelcome`, never changes the answer.
  - `lookupClub(input: unknown, ctx: ClubCtx, deps: ClubDeps): Promise<ClubAnswer>` - no name; logs `lookup` / `lookup_miss`.
  - `welcomeMail(m: { memberNo: number; code: string; firstName: string | null; unsubscribeUrl: string; siteUrl: string }): { subject: string; html: string; text: string }` - RTL, member card "שורה 1 · מושב <no>", the code large, "מחיר החבר מופעל לבד במכשיר הזה, או הקלידו את הקוד בהזמנה", site link, company address line, unsubscribe link.
  - Routes read the IP as `x-forwarded-for` first entry, else `x-real-ip`; UTM via `readUtmCookieFromHeader`; set no cookie (the client sets `myt_club`).

- [ ] **Step 1:** Write `clubJoin.test.ts` with fake deps: new email ⇒ `ok`, `returning:false`, one coupon + one member + one `join` log with `CLUB_CONSENT_TEXT`; consent missing ⇒ `invalid` and nothing written; honeypot filled ⇒ `invalid`; settings disabled ⇒ `off`; `deps.settings()` throws ⇒ `off` (never `error` to the page); 5 recent rows for the IP ⇒ `rate_limited`; existing active member ⇒ `returning:true`, `firstName:null`, no insert, `marketing` untouched, `rejoin` logged; removed member ⇒ `removed`; **race**: `insertMember` returns `{clash:true}` ⇒ `deleteCoupon` called with the new coupon id and the answer is the existing member's code with `returning:true`; **mail failure**: `sendWelcome` rejects ⇒ answer still `ok:true`, `markWelcome` got `{ok:false}`; `lookupClub` for an unknown email ⇒ `not_found` + `lookup_miss` log with no member id; for a known one ⇒ no `firstName`.
- [ ] **Step 2:** Write `clubMail.test.ts`: html contains `dir="rtl"`, the code, `מושב 1001`, the unsubscribe URL; html and text contain none of `מבצעים`, `הנחה בלעדית`, `אירועים חדשים` (no perks).
- [ ] **Step 3:** `yarn vitest run lib/__tests__/clubJoin.test.ts lib/__tests__/clubMail.test.ts` → FAIL.
- [ ] **Step 4:** Implement `join.ts`, `mail.ts`, `settings-server.ts`, `db.ts` and the six routes / page. Mail transport like `app/api/sendUserEmail.ts` (`EMAIL_SERVER_*`, `smtp.zeptomail.com:587`), headers `List-Unsubscribe: <{site}/api/club/unsubscribe?t=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- [ ] **Step 5:** Tests → PASS; `npx tsc --noEmit` clean for the new files.
- [ ] **Step 6:** Commit: `feat(club): join, lookup, unsubscribe, resend routes and the welcome mail`.

### Task M4: The popup, the row, the order summary

**Files:**
- Create: `components/order/club/ClubModal.tsx` (Mantine `Modal` with a close X; states `join` | `member` | `joined` | `welcome_back`; consent checkbox gates the button), `components/order/club/ClubRow.tsx`, `components/order/club/ClubCard.tsx` (the ticket card of version A)
- Modify: `app/order/OrderReview.tsx`

**Interfaces:**
- Consumes: M1 (`clubSurface`, `clubCouponQty`, `shouldAutoApply`, cookie helpers, `CLUB_COPY`), M3 routes, the existing `setAppliedCoupon` / `setCouponStatus` / `validateCoupon` / `removeCoupon`.
- `ClubModal` props: `{ open: boolean; initialMode: "join" | "member"; onClose(): void; prefill: { email: string; phone: string; firstName: string; lastName: string }; eventId: number; method: "popup" | "row"; ticketCount: number; onApplied(a: Extract<ClubAnswer, { ok: true }>, how: "join" | "lookup"): void }`.
- OrderReview changes:
  - fetch `/api/club/config` once; compute `surface = clubSurface({...})`.
  - `legacy_popup` ⇒ today's special-offer modal, untouched. `club` ⇒ the same inactivity effect (delay = `popupDelaySeconds * 1000`) opens `ClubModal` mode `join` instead. `none` ⇒ neither.
  - `ClubRow` inside `couponRow` when `surface === "club"`; shows "מחיר חבר הופעל" when the applied coupon has `source === "club"`, the swap button when another coupon holds the slot.
  - On mount: `parseClubCookie(document.cookie)`; if `shouldAutoApply(...)` ⇒ `validateCoupon(cookie.code)` silently, then `trackEvent("Club_Member_Applied", { method: "cookie" })` and the `club_member_applied` dataLayer push.
  - `onApplied`: set `appliedCoupon` from the answer (`source: "club"`), status `applied`; write the `myt_club` cookie (365 days, `path=/`, `SameSite=Lax`; `name` only on a new join with a first name); push `club_join` / `club_member_applied`; Mixpanel `Club_Join` / `Club_Member_Applied`.
  - `couponDiscountUsd` uses `clubCouponQty(appliedCoupon, numberOfPersons, numberOfEventTickets)`.
  - `validateCoupon`: an answer with `source === "club"` while `flightSkipped` ⇒ not applied, message `CLUB_COPY.ticketOnly`.

- [ ] **Step 1:** Build the three components and the OrderReview wiring.
- [ ] **Step 2:** `yarn vitest run` → PASS; `npx tsc --noEmit` clean for touched files.
- [ ] **Step 3:** Run the worktree's dev server (its own `.claude/launch.json` entry on a free port, `preview_start`), go through a package order to the summary: wait 22 s ⇒ popup; join with a test email ⇒ card, total drops by `$50 × tickets`; reload ⇒ the row says applied with no popup; a ticket-only order ⇒ no club anywhere; a `?utm_source=<affiliate code>` visit ⇒ today's popup. Screenshots of each.
- [ ] **Step 4:** Commit: `feat(club): club popup, row and member price on the order summary`.

### Task M5: Privacy line

- [ ] Modify `app/privacy/page.tsx:138` to: `שיווק והצעות מותאמות אישית - רק אם נתת הסכמה מפורשת מראש בסימון תיבה. ההסכמה נשמרת אצלנו עם מועד ההסכמה, ואפשר לבטל אותה בכל רגע מהקישור שבכל הודעה.` Commit: `docs(privacy): marketing consent is a recorded opt-in`.

---

## Part E - End to end (after Dor's "push" for the backoffice)

### Task E1: Live check on a preview

- [ ] **Step 1:** Backoffice pushed by Dor's word (push-coordinator if other sessions are active) → "Apply DB Migrations" green → `npm run db:types` → Vercel green.
- [ ] **Step 2:** Push the branch `feat/members-club` (Dor's word) → Vercel preview of myt-main (same DB).
- [ ] **Step 3:** On the preview: join with Dor's test email ⇒ the welcome mail arrives (headers show ZeptoMail account `6d1b33ed…`), the member shows on `/marketing/club`, the code applies; place a test order to confirm-order (Pending) ⇒ `coupon_code` = the member code and `coupon_discount_usd` = `50 × tickets`; unsubscribe from the mail link ⇒ the screen shows unsubscribed and the price still applies; remove the member in the backoffice ⇒ the code stops working. Delete the test order and the test member afterwards (soft for the order, `remove` for the member).
- [ ] **Step 4:** Report to Dor with screenshots; the merge to main waits for his OK.
