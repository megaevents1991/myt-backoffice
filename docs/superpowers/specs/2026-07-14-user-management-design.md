# User Management, Roles, Audit Log & Partner Portal — Design

**Date:** 2026-07-14
**Branch:** `fix/security-hardening`
**Status:** Approved by Dor

## Goal

Replace the single hardcoded admin credential with real user management: per-person accounts, four roles, a full audit trail, a limited partner portal for agents/affiliates, and a branded Hebrew price-quote (הצעת מחיר) PDF generator.

## Current state (what this replaces)

- Identity today is the literal string `"admin"` inside a signed HMAC cookie (`lib/auth/session.ts`). Login compares plaintext env vars (`NEXT_SECRET_ADMIN_EMAIL` / `NEXT_SECRET_ADMIN_PASSWORD`) in `app/api/auth/login/route.ts`.
- `lib/actions/auth-actions.ts` contains a dead Supabase-Auth login path that writes an incompatible JSON cookie — to be deleted.
- All DB access uses the service-role client (`lib/supabase-server.ts`); authorization is app-level via `requireAdmin()` / `guardAdminRoute()` (`lib/auth/guards.ts`).
- No users table, no audit log, no partner login, no quote generator.
- Known gap: `lib/actions/coupon-actions.ts` mutations have no auth guard — fixed by this work.

## Decisions (locked)

| Question | Decision |
|---|---|
| Auth backbone | Supabase Auth: admin-created email+password users, Google SSO linkable per user. No self-signup ever. |
| Roles | `superadmin`, `admin`, `editor`, `agent`, `affiliate`. Agent and affiliate identical permissions for now (kept as two roles for future divergence). Superadmin (added 2026-07-14 per Dor): manages everyone incl. admins; admins can manage only editor/agent/affiliate accounts — an admin can never create, modify, disable or password-reset an admin/superadmin. |
| Editor limits | Everything except user management (`/users`). Editors CAN view audit log. |
| Audit scope | All mutations (with before→after diff) + auth events (login, failed login, logout, user created/disabled). No page-view logging. |
| Portal location | Same app, separate `app/portal/` route group with its own minimal layout. |
| Quote format | Branded PDF download, Hebrew RTL, stored in DB + storage for re-download. |
| Quote pricing | Prefilled from event price chain; agent can edit final price / line items. |
| Authorization model | Approach A: Supabase Auth as identity provider only. Sessions stay our signed HMAC cookie. Service-role client + app-level guards. No RLS changes. |

## Architecture

### Identity & session

- Users live in Supabase Auth (`auth.users`). Created only by admins via `supabase.auth.admin.createUser` (service role). Google SSO via Supabase OAuth — callback rejects any email without an existing `user_profiles` row.
- Session cookie stays the existing HMAC-SHA256 signed cookie (`lib/auth/session.ts`), payload extended to v2:
  ```json
  { "sub": "<auth.users uuid>", "email": "...", "role": "admin|editor|agent|affiliate", "partner_code": "<partner_tracking_code|null>", "exp": 1234567890 }
  ```
- Middleware keeps verifying the signature locally — zero network calls per request. Old `{role:"admin"}` cookies fail verification → one-time forced re-login for everyone.
- Login flow (password): `POST /api/auth/login` → `supabase.auth.signInWithPassword` (server-side anon client) → load `user_profiles`, require `is_active` → mint cookie.
- Login flow (Google): button → Supabase OAuth redirect → `GET /api/auth/callback` → exchange code → match email to `user_profiles` (reject unknown) → mint same cookie.
- `lib/actions/auth-actions.ts` dead path deleted. `NEXT_SECRET_ADMIN_EMAIL/PASSWORD` env creds removed after bootstrap is verified in production.
- Bootstrap: `scripts/bootstrap-admins.ts` run locally with service-role env — creates Dor + Alon as admin users + profiles.

### Data model — one migration `supabase/migrations/<ts>_user_management.sql`

**`user_profiles`**
```sql
id uuid primary key references auth.users(id) on delete cascade,
email text not null unique,
display_name text,
role text not null check (role in ('admin','editor','agent','affiliate')),
partner_tracking_code text,        -- required (app-enforced) for agent/affiliate
logo_url text,
phone text,
is_active boolean not null default true,
created_at timestamptz not null default now(),
created_by uuid
```

**`audit_log`**
```sql
id bigint generated always as identity primary key,
created_at timestamptz not null default now(),
actor_id uuid, actor_email text, actor_role text,
action text not null,       -- create|update|delete|login|login_failed|logout|user_created|user_updated|user_disabled|quote_created|pdf_generated
entity_type text,           -- 'event','coupon','partner','reservation','user','quote',...
entity_id text,
changes jsonb,              -- update: {field:{from,to}}; create: snapshot
metadata jsonb,
ip text
-- indexes: (created_at desc), (actor_id), (entity_type, entity_id)
```

**`quotes`**
```sql
id bigint generated always as identity primary key,
created_at timestamptz not null default now(),
created_by uuid not null,
partner_tracking_code text,
event_id bigint,
customer_name text,
title text,
line_items jsonb not null default '[]',   -- [{label, qty, unit_price}]
currency text not null default 'USD',
total numeric,
notes text,
valid_until date,
status text not null default 'final',
pdf_storage_path text
```

Plus: storage bucket `partner-logos` (public read) and `quotes` (private).

**NOT changed:** `partners` table columns (main app reads it — cross-project). `partners.password` becomes unused by backoffice but is not dropped.

### Authorization

- Guards in `lib/auth/guards.ts`:
  - `requireRole(...roles)` — throws unless session role matches; returns full session payload (actor identity for audit).
  - `requireStaff()` = `requireRole('admin','editor')`
  - `requireAdmin()` = `requireRole('admin')` — user management only
  - `requirePartner()` = `requireRole('agent','affiliate')` — returns `partner_code`; throws if missing
  - `guardAdminRoute()` / `guardCronRoute()` keep working (route variants updated for roles).
- Middleware route map:
  - `/users`, `/audit-log` admin/editor rules: `/users` → admin only; `/audit-log` → admin+editor
  - `/portal/*` → agent/affiliate (+ admin/editor allowed for debugging)
  - all other dashboard routes → admin+editor; agents/affiliates redirected to `/portal`
- Server-action sweep: every existing `requireAdmin()` becomes `requireStaff()`, except user management. Coupon actions get the guard they're missing.
- Portal data access: new `lib/actions/portal-actions.ts` — every query filtered by the session's `partner_code`, never by client-supplied identifiers.

### Audit log

- `lib/audit.ts` → `logAudit({ action, entityType, entityId, changes, metadata })`. Actor pulled from session. Fire-and-forget: audit failure logs to console but never fails the mutation.
- `diffChanges(before, after)` helper → `{field: {from, to}}` (only changed fields).
- Wired into: all mutating server actions, login/logout/failed-login routes, user management actions, quote creation, PDF generation.
- `/audit-log` page (admin + editor): filterable table — actor, entity type, action, date range — expandable row shows the JSON diff.

### User management UI — `/users` (admin only)

- List: email, name, role, partner link, active, last sign-in (from Supabase Auth), created.
- Create: email, temp password, role, partner_tracking_code (searchable select over real partners, refund placeholders filtered out), logo upload (for agent/affiliate).
- Actions: disable/enable, change role, reset password (admin sets new temp password via admin API), edit profile.
- Server actions in `lib/actions/user-actions.ts` — all `requireAdmin()`, all audited.

### Partner portal — `app/portal/`

Minimal Hebrew RTL layout with partner logo, no admin sidebar.

- `/portal` — dashboard: own reservations count, commission total, coupon usage stats.
- `/portal/coupons` — own coupons, read-only + usage counters.
- `/portal/reservations` — own reservations (`aff_partner_tracking_code = partner_code`), limited columns: customer name, event, date, status, amount, own commission. Internal base costs/margins never selected.
- `/portal/quotes` — quote list + create.

### Quote generator (הצעת מחיר)

- `/portal/quotes/new`: event search → suggested price prefilled from price chain (`base_flight_price + base_hotel_price + min ticket + 175`) → editable line items, customer name, notes, valid-until.
- Save quote row → `POST /api/quotes/[id]/pdf`: renders Hebrew RTL HTML template (partner logo header, quote table, validity, contact footer) → existing `@sparticuz/chromium` + Playwright infra (same pattern as `validate-airline`, dedicated function config: 1024 MB / 30s) → `page.pdf()` → upload to `quotes` storage bucket → signed download URL.
- Quotes are audited (`quote_created`, `pdf_generated`).

## Cross-project impact (myt-main)

- No shared-table columns renamed or dropped. New tables (`user_profiles`, `audit_log`, `quotes`) are backoffice-only.
- `partners` untouched structurally. Main app's affiliate auth against `partners.email/password` unaffected.
- No shared TypeScript types change (`types/app.types.ts` untouched except possibly `Coupon` — no).

## Implementation phases (all on `fix/security-hardening`)

1. **Foundation:** migration + generated DB types, auth swap (login/callback/logout, session payload v2), guards + middleware role map, server-action guard sweep, `/users` UI, bootstrap script.
2. **Audit:** `lib/audit.ts`, wire all mutations + auth events, `/audit-log` UI.
3. **Portal:** layout + dashboard + coupons + reservations pages, portal actions.
4. **Quotes:** quote form, PDF template + chromium route, storage, quote list.

## Manual steps for Dor

1. Google Cloud Console: create OAuth client (web), redirect URL = Supabase callback URL. Enable Google provider in Supabase dashboard with client id/secret.
2. Vercel env: add `NEXT_SECRET_SESSION_SECRET` (strong random) — stop relying on the admin-password fallback for cookie signing.
3. Run `scripts/bootstrap-admins.ts` locally (creates Dor + Alon admin users).
4. Trigger the `Apply DB Migrations` GitHub Action after the migration lands.
5. After verifying login works in prod: remove `NEXT_SECRET_ADMIN_EMAIL` / `NEXT_SECRET_ADMIN_PASSWORD` from Vercel.

## Error handling

- Login failures: generic "invalid credentials" to client; `login_failed` audit row with email + IP.
- Disabled user (`is_active=false`): login treated as invalid credentials. An already-issued cookie stays valid until expiry (max 1 week) — disabling takes effect on next login. Acceptable for v1; future improvement: session revocation list.
- Google callback with unknown email: redirect to login with "no account — contact admin" message; `login_failed` audit row.
- Audit insert failure: console.error only, mutation proceeds.
- PDF generation failure: quote row still saved; user sees retry button.

## Testing

No test suite exists in repo. Verification is manual per phase:
- Phase 1: login as each role (password + Google), verify middleware redirects, verify editor blocked from `/users`, verify old cookie rejected.
- Phase 2: perform CRUD across domains, verify audit rows + diffs; failed login logged.
- Phase 3: partner sees only own data (verify with two partner accounts).
- Phase 4: generate quote PDF, verify Hebrew RTL rendering + logo + storage.
