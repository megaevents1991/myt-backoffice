# Office Agents: `office_manager` Role, Per-Agent Attribution, Portal Isolation

**Date:** 2026-08-19
**Status:** Approved by Dor (chat), pending spec review
**Repo:** myt-backoffice only. **Zero myt-main changes.**

## 1. Context

Travel agencies (offices) need multiple agents sharing ONE commission agreement.
Today this half-works: `user_profiles.partner_tracking_code` is a non-unique FK,
so several `agent` users can already point at one `partners` row (= the office =
the agreement). What's missing:

1. **Per-agent sales attribution** inside an office (reporting only — commission
   is paid to the agency as one pot).
2. **`office_manager` role**: a partner-side user who manages the office's own
   agent users, sees the whole office, and also sells like a regular agent.
3. **Isolation**: a regular agent sees ONLY their own data; only office managers
   (and staff) see office-wide data.

### Decisions locked with Dor (2026-08-19)

| Question | Decision |
|---|---|
| Per-agent attribution timing | Needed NOW, v1 |
| Money | **Reporting only.** Commission + credit stay office-level; one agreement, one monthly report. No per-agent payout. |
| Manager is also a seller | Yes. Manager sees office view (like today) + "שלי" filter for own sales; each agent sees own progress. |
| Agent visibility | **Full isolation** — agent sees only their own reservations/packages/quotes. Manager sees everything. |
| Password reset | Manager may reset ONLY their own office's agents. |
| Credit + coupons screens | **Manager only.** Credit is office money; regular agents cannot convert credit or create coupons. |
| Who appoints managers | **Superadmin only** (in `/users`). Managers create agents only — never other managers. |
| Managers per office | Multiple allowed (natural: role is per-user, N users may hold `office_manager` on one code). |

## 2. Attribution Design (Approach 1 — ride the UTM pipeline)

The UTM capture feature (live 2026-08-17) already does the heavy lifting:
main's `lib/utm.ts` parses `utm_content` from the URL (line 64), carries it in
the `myt_utm` cookie (`ct`), and confirm-order writes it to `utm_touches`
(`utm_content`, position 0 = primary). **Verified end-to-end; no main change.**

### Mechanism

- New column `user_profiles.agent_slug` — short, stable, unique, auto-generated.
  Customer-visible in URLs. Never regenerated (same stability rule as form field
  ids / choice option values).
- `partnerLink()` (`lib/site.ts`) gains an optional `agentSlug` param →
  appends `&utm_content=ag-<slug>`. All portal callers pass the session user's
  slug: links page, packages event-links, package share links
  (`portal-package-actions.ts:1589,1691`), dashboard hot-event links
  (`portal-dashboard-actions.ts:458,646`).
- Agent-mode handoff (`getAgentOrderHandoffLink`): the `next` URL (already
  carries `utm_source` + `utm_medium=influencer`) gains the same
  `utm_content=ag-<slug>` → main's middleware sets the cookie on the agent's
  browser → confirm-order attaches. Same pipeline, no special case.
- The `ag-` prefix namespaces agent slugs from marketing uses of `utm_content`
  (ad-creative names etc.), so reports can filter `utm_content like 'ag-%'`.

### Attribution rule (inherited, not invented)

`applyUtmCapture` in main: influencer-primary is protected from later
NON-influencer touches; a later influencer touch WINS. Two agents of the same
office differ by `ct` → distinct touches → **last agent's link gets credit**.
Identical to today's office-vs-office behavior; per-agent inherits it.

### Reading attribution (backoffice reports)

"Which agent sold reservation R" =
`utm_touches where reservation_id = R and position = 0` → `utm_content`
(strip `ag-`) → `user_profiles.agent_slug` → display name.

- No primary touch, or `utm_content` not matching an office slug → bucket
  **"משרד — לא משויך"** (office-level / unattributed).
- History: attribution starts at deploy. Old reservations and links copied
  before the change have no `utm_content` → unattributed bucket. Packages and
  quotes are attributed retroactively — they carry `created_by` since day one.
- Coupon-only bookings (customer types a code, no link click) → unattributed.
  Accepted for v1; coupons are office money anyway.
- `utm_touches` already has `utm_touches_reservation_idx`; office report joins
  a bounded set (the office's reservations), no new index needed for v1.

### Known trap (do NOT regress)

Main's influencer classifier fast path is `utm_medium=influencer` with a
fallback lookup on `partners.type in ('agent','affiliate')`. Therefore the
office's `partners.type` stays **`'agent'`** even when its users hold
`office_manager` — `ensurePartnerForUser` must map `office_manager → 'agent'`
when it auto-creates a partner row. `office_manager` is never a `partners.type`
value (also: `partners.type` must carry no CHECK constraint per migrations
rule — main writes that table).

## 3. Data Model (one migration)

```sql
-- created via `npm run db:new office_manager_role` (timestamp assigned then); idempotent
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('superadmin','admin','editor','office_manager','agent','affiliate'));

alter table public.user_profiles add column if not exists agent_slug text;

-- Backfill every existing partner-role user deterministically (md5 of the
-- uuid, 6 hex chars). Collision odds negligible at this scale; unique index
-- below is the safety net (migration fails loudly rather than silently).
update public.user_profiles
  set agent_slug = substr(md5(id::text), 1, 6)
  where agent_slug is null and role in ('agent','affiliate');

create unique index if not exists user_profiles_agent_slug_key
  on public.user_profiles (agent_slug) where agent_slug is not null;
```

- `user_profiles` is backoffice-only (RLS, no policies) → zero main impact.
- App code generates `agent_slug` the same way (`md5`-style short code) for
  every NEW partner-role user in `createUser` / team actions. Staff roles get
  none.
- After merge: `npm run db:types`.

## 4. Roles, Session, Guards

- `types/auth.types.ts`: add `office_manager` to `ROLES` and to
  `PARTNER_ROLES` (manager is partner-linked, portal-confined); new
  `SELLER_ROLES = ["agent","office_manager"]` for "agent-only" seller flows.
  `SessionPayload` shape is UNCHANGED — the viewer's `agent_slug` is looked up
  per request from `user_profiles` by `sub` (simpler than versioning the
  cookie payload; also correct under impersonation, where the sub may be an
  admin with no slug). `lib/auth/session.ts` verify-allowlist (hardcoded role
  array, line ~164) must switch to `ROLES` or every office_manager session
  fails verification.
- `lib/auth/guards.ts`:
  - `getSession()` line 36: portal-cookie allowlist becomes
    `PARTNER_ROLES.includes(portal.role)` (covers `office_manager`; keeps the
    no-escalation property — office_manager is portal-only).
  - `requirePartner()` accepts agent | affiliate | office_manager.
  - New `requireOfficeManager()`: role `office_manager` + `partner_code`.
- Hardcoded role spots to update: `app/auth/login/page.tsx:31,47` (redirect →
  `/portal` for all PARTNER_ROLES), `app/portal/layout.tsx:29` (role label
  "מנהל משרד"), `app/portal/portal-nav.tsx` (nav per role), every
  `isAgent = role === "agent"` display toggle in portal pages → a shared
  helper (`isSellerRole(role)`: agent | office_manager).
- Middleware: no change needed — it filters by `PARTNER_ROLES`, which now
  includes the new role.
- Handoff (`lib/auth/partner-handoff.ts`): `PartnerHandoffUser.role` union
  stays `"agent" | "affiliate"` — an `office_manager` is minted as `"agent"`
  (main doesn't know the new role and doesn't need to).
  `getAgentOrderHandoffLink`: allow role `office_manager` (line 1805) and add
  it to the profile-existence check (line 1833).
- Impersonation (superadmin → portal): impersonated sessions must get **manager
  view semantics** — the admin's `sub` matches no `created_by`, so an "own"
  view would render empty. Implementation: impersonating an agent-type partner
  ALWAYS mints role `office_manager` (full office view); affiliate-type
  partners mint `affiliate` as today (no isolation there).

## 5. Portal Isolation Matrix

Scoping today is `partner_code` everywhere. New second dimension: `created_by`
/ `agent_slug`. Per page:

| Page | agent | office_manager | affiliate |
|---|---|---|---|
| `/portal` dashboard | Own stats only (sales attributed to own slug; own packages/quotes counts) | Office totals (default, like today) + view toggle **"שלי / כל המשרד"** + per-agent breakdown table | unchanged |
| `/portal/links` | Own links (own slug baked in) | Same — manager's links carry manager's slug | unchanged (+slug) |
| `/portal/packages` | Only own packages (`created_by = sub`); share links carry own slug | All office packages + creator column; own links carry own slug | unchanged |
| `/portal/quotes` | Only own quotes (`created_by`) | All office quotes + creator column | unchanged |
| `/portal/reservations` | Only reservations attributed to own slug (primary touch join) | All office reservations + "סוכן" column + per-agent filter | unchanged |
| `/portal/activity` | Own activity | Office activity | unchanged |
| `/portal/credit` | **No access** (nav hidden + guard) — EXCEPTION: a solo-office agent (sole active portal user) keeps access, so existing single-agent partners feel no change | Full access (office pot) | unchanged |
| `/portal/coupons` | **No access** (same solo-office exception) | Full access | unchanged |
| `/portal/team` (NEW) | No access | Full access | no access |
| `/portal/profile` | Own | Own | own |

- Enforcement is server-side in every action (`lib/actions/portal-*.ts`):
  agent-role sessions get the extra `.eq("created_by", session.sub)` /
  slug-join filter; manager sessions get office-wide (today's behavior).
  Nav hiding is UX only — guards are the security boundary.
- Single-user offices (all existing partners today): the sole user keeps role
  `agent` → after isolation ships they see "own" data, which for a
  one-slug office is everything attributed + own work items. **Their old
  pre-slug reservations fall into the unattributed bucket and would vanish
  from their list.** Mitigation: for the AGENT reservations/dashboard scope,
  include unattributed office reservations **when the office has exactly one
  active portal user** (count of partner-role users on the code = 1). Multi-
  user offices show unattributed rows only to the manager.

## 6. Team Management (`/portal/team` + `lib/actions/portal-team-actions.ts`)

All actions open with `requireOfficeManager()`; every target row is verified
`partner_tracking_code = actor.partner_code` before any write. All mutations →
existing `logAudit`.

- `listOfficeUsers()` — all profiles on the manager's code (managers shown
  too, read-only); mutations below are allowed on role `agent` targets only.
- `createOfficeAgent({ email, password, display_name, phone })` — role FORCED
  to `'agent'`, `partner_tracking_code` FORCED to actor's, slug auto-generated.
  Reuses the `createUser` internals (auth user + profile + rollback paths) via
  a shared helper extracted from `user-actions.ts` — not a copy-paste.
- `resetOfficeAgentPassword(id, newPassword)` — target must be role `agent`
  AND same office. Managers cannot reset other managers or staff.
- `setOfficeAgentActive(id, isActive)` — same constraints; disable only
  (soft). No delete.
- Explicitly impossible via team actions: creating managers, changing roles,
  changing `partner_tracking_code`, touching users of another office, touching
  staff.

UI: RTL card list (name, email, slug, active badge, last activity), add-agent
dialog, reset-password dialog, disable toggle. Portal brand (portal-theme
scope), shadcn primitives.

## 7. Admin `/users` Changes

- Role dropdown gains `office_manager` — selectable **only when actor is
  superadmin** (server-enforced in `createUser`/`updateUser`: granting or
  removing `office_manager` requires `actor.role === 'superadmin'`; plain
  admins keep managing agent/affiliate/editor as today).
- `office_manager` requires a partner link (same rule as agent/affiliate) —
  add the role to the `PARTNER_ROLES.includes(...)` checks in
  `user-actions.ts:152,160` (it will be in `PARTNER_ROLES` already).
- `ensurePartnerForUser`: `type: args.role` becomes a mapping —
  `office_manager → 'agent'` (see §2 trap).
- Cosmetic office grouping in the users list: out of scope v1.

## 8. Reporting Queries (v1)

- **Agent "my progress"** (dashboard + reservations): office reservations
  (`aff_partner_tracking_code = code`) joined to primary touch, filtered
  `utm_content = 'ag-' || slug`; plus single-user-office fallback (§5).
- **Manager per-agent breakdown**: same join, grouped by `utm_content`,
  mapped through office slugs; leftover/null bucket labeled "לא משויך".
  Counts + revenue + commission-relevant totals reuse existing dashboard
  aggregation helpers.
- Implementation detail: fetch office reservations first (existing queries),
  then one `in (reservation_ids)` query on `utm_touches position=0` and merge
  in JS — avoids a PostgREST embedded join on a FK-less path and stays under
  the 1000-row lesson (page if needed).

## 9. Error Handling & Security Notes

- Every new server action: role guard first line, `{ data, error }` checked,
  `console.error(JSON.stringify(error))`, explicit column selects, explicit
  insert/update maps (no spreads).
- Team actions re-verify office ownership on the TARGET row inside the action
  (never trust a client-sent id).
- Slug collisions: unique index is the backstop; generator retries once on
  conflict.
- Slug is not a secret (appears in URLs); it grants nothing — all reads go
  through role guards. Forging another agent's slug in a link only mis-credits
  a sale WITHIN the same office's pot (no money movement) — accepted.
- Disabled agent: session cookie may stay valid up to a week (known platform
  gap, see auth TODO) — team-page disable still blocks at next login; portal
  actions additionally check `is_active` on the profile for team mutations.

## 10. Rollout

1. Merge migration to master (auto-applies via CI). `npm run db:types`.
2. Deploy backoffice. From this moment new portal links carry `utm_content`.
3. Superadmin: pick pilot office → create/promote `office_manager` user(s)
   via `/users`; manager builds their team in `/portal/team`.
4. Existing single-agent partners: untouched, behavior identical (single-user
   fallback keeps their lists full).
5. QA (manual, no test suite in repo):
   - Agent link → book on main → reservation shows agent in manager breakdown.
   - Package link + handoff order → same.
   - Old link (no `utm_content`) → unattributed bucket.
   - Two agents same office: second link click wins attribution.
   - Agent A cannot see B's packages/quotes/reservations (URL probing incl.).
   - Manager: toggle שלי/משרד; create agent; reset password; disable; all in
     audit log; cannot create manager; cannot touch another office (forged id).
   - Admin (non-super) cannot grant `office_manager`; superadmin can.
   - Affiliate flow unchanged. Single-user office unchanged.

## 11. Out of Scope (v1)

- Per-agent commission/credit payout or splits (money stays office-level).
- Attribution for coupon-only bookings.
- Retroactive attribution of pre-deploy reservations.
- Office grouping/columns in admin `/users` list.
- Manager-to-manager administration (creating/promoting managers stays
  superadmin-only).
- Per-agent breakdown in the monthly partner email report.
