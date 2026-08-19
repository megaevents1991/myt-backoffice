# Office Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `office_manager` role + per-agent sales attribution (via `utm_content` on the live UTM pipeline) + portal isolation (agent sees own data, manager sees the office) + `/portal/team` self-service user management.

**Architecture:** One migration adds the role + `user_profiles.agent_slug`. Every portal link gains `utm_content=ag-<slug>`; myt-main already captures it into `utm_touches` (position 0 = primary) — **zero myt-main changes**. Reads join reservations→primary touch in JS. Work items (packages/quotes) isolate on the existing `created_by`. A new attribution helper module is the single source of scoping truth.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (service-role server client), shadcn/ui, portal-theme (RTL Hebrew).

**Spec:** `docs/superpowers/specs/2026-08-19-office-agents-design.md`

## Global Constraints

- **NO `git commit` / `git push` anywhere.** Dor reviews and commits himself (global rule). Every task ends by reporting, not committing.
- **Type gate:** `npx tsc --noEmit` (build ignores TS errors; tsc is the real gate). Run it at the end of every task; it must come back clean (or only with errors that pre-exist the task — record them at task start).
- No test suite exists. "Verify" = tsc + the explicit behavioral checks listed in each task. Final QA is Dor's manual checklist (Task 14).
- Migration rules: create via `npm run db:new`, idempotent SQL, NEVER apply from a branch (`npm run db:push` is guarded). Do not run db:push in this plan.
- Supabase idiom: shared client from `@/lib/supabase-server`; check `if (error)` + `console.error(JSON.stringify(error))`; explicit column selects; explicit insert/update maps (no spreads). The `(supabase as any)` + eslint-disable pairing is the existing repo idiom for tables missing from generated types — match it for `user_profiles` / `utm_touches` queries.
- Hebrew UI strings in the portal; `dir="rtl"` inherited from the portal layout; shadcn primitives from `components/ui/`; portal pages follow the portal-theme brand.
- Roles trap: main's influencer classifier reads `partners.type in ('agent','affiliate')` — `partners.type` must NEVER be set to `office_manager`.
- `agent_slug` is customer-visible in URLs, stable forever once assigned — never regenerate an existing slug.

---

### Task 1: Migration + role/slug types + session allowlist

**Files:**
- Create: `supabase/migrations/<timestamp>_office_manager_role.sql` (via `npm run db:new office_manager_role`)
- Modify: `types/auth.types.ts`
- Modify: `lib/auth/session.ts:163-168` (hardcoded role allowlist)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: role `"office_manager"` in `ROLES` + `PARTNER_ROLES`; new `SELLER_ROLES: Role[]` (`["agent","office_manager"]`); `UserProfile.agent_slug: string | null`. Every later task relies on these exact names.

- [ ] **Step 1: Create the migration**

Run: `npm run db:new office_manager_role`
Write into the created file:

```sql
-- office_manager role + per-agent attribution slug.
-- user_profiles is backoffice-only (RLS, no policies) - zero main-app impact.

alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check
  check (role in ('superadmin','admin','editor','office_manager','agent','affiliate'));

alter table public.user_profiles add column if not exists agent_slug text;

-- Backfill existing partner-role users deterministically (6 hex chars of the
-- uuid's md5). The unique index below is the collision backstop - the
-- migration fails loudly rather than silently double-assigning a slug.
update public.user_profiles
  set agent_slug = substr(md5(id::text), 1, 6)
  where agent_slug is null and role in ('agent','affiliate');

create unique index if not exists user_profiles_agent_slug_key
  on public.user_profiles (agent_slug) where agent_slug is not null;
```

- [ ] **Step 2: Update `types/auth.types.ts`**

Replace the `ROLES` block and role lists (keep the file's comment style):

```ts
export const ROLES = [
  "superadmin",
  "admin",
  "editor",
  "office_manager",
  "agent",
  "affiliate",
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = ["superadmin", "admin", "editor"];
/** Roles allowed into user management. Only superadmin may manage these roles' accounts. */
export const ADMIN_ROLES: Role[] = ["superadmin", "admin"];
/** Partner-linked, portal-confined roles. */
export const PARTNER_ROLES: Role[] = ["office_manager", "agent", "affiliate"];
/** Partner roles that SELL (build packages, quote, order for a customer). */
export const SELLER_ROLES: Role[] = ["agent", "office_manager"];
```

Add to `UserProfile` (after `partner_tracking_code`):

```ts
  /** Short stable id carried as utm_content=ag-<slug> on this user's links. Never regenerated. */
  agent_slug: string | null;
```

- [ ] **Step 3: Fix the session-verify allowlist (`lib/auth/session.ts:163-168`)**

Without this every `office_manager` login mints a cookie that then fails verification → redirect loop. Replace:

```ts
    if (
      !["superadmin", "admin", "editor", "agent", "affiliate"].includes(
        payload.role,
      )
    )
      return null;
```

with (add `ROLES` to the existing `import type { Role } from "@/types/auth.types";` line — it becomes a value import: `import { ROLES, type Role } from "@/types/auth.types";`):

```ts
    if (!(ROLES as readonly string[]).includes(payload.role)) return null;
```

- [ ] **Step 4: Type gate**

Run: `npx tsc --noEmit`
Expected: errors ONLY where `agent_slug` is now missing from selects that cast to `UserProfile` — if `lib/actions/user-actions.ts` `PROFILE_COLUMNS` complains, that is fixed in Task 4; note it and continue if it is the sole category. Anything else: fix here.

- [ ] **Step 5: Report** — migration file path + what changed. NO commit.

---

### Task 2: Guards, login redirects, layout label, nav roles

**Files:**
- Modify: `lib/auth/guards.ts:36,68-74`
- Modify: `app/api/auth/login/route.ts:37`
- Modify: `app/auth/login/page.tsx:31,47`
- Modify: `app/portal/layout.tsx:29,73` and `app/portal/portal-nav.tsx`

**Interfaces:**
- Consumes: `PARTNER_ROLES`, `SELLER_ROLES` (Task 1).
- Produces: `requireOfficeManager(): Promise<SessionPayload & { partner_code: string }>` in `lib/auth/guards.ts`; `PortalNav` prop signature becomes `{ role, showCredit }: { role?: string | null; showCredit?: boolean }`.

- [ ] **Step 1: `lib/auth/guards.ts`**

Import `PARTNER_ROLES` (extend the existing import from `@/types/auth.types`). In `getSession()` replace line 36:

```ts
  if (portal && PARTNER_ROLES.includes(portal.role)) {
```

Replace `requirePartner` body's role list and add the manager guard after it:

```ts
/** office_manager, agent or affiliate with a linked partner code - portal actions. */
export async function requirePartner(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requireRole("office_manager", "agent", "affiliate");
  if (!session.partner_code) throw new Error("Unauthorized");
  return session as SessionPayload & { partner_code: string };
}

/** office_manager only - team management, office-wide views, credit/coupons. */
export async function requireOfficeManager(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requireRole("office_manager");
  if (!session.partner_code) throw new Error("Unauthorized");
  return session as SessionPayload & { partner_code: string };
}
```

- [ ] **Step 2: Login route + login page**

`app/api/auth/login/route.ts:37` — replace with (import `PARTNER_ROLES` from `@/types/auth.types`):

```ts
  const isPartner = PARTNER_ROLES.includes(profile.role);
```

`app/auth/login/page.tsx` — both redirect expressions (lines 31 and 46-49): replace `user.role === "agent" || user.role === "affiliate"` / `result.user.role === "agent" || result.user.role === "affiliate"` with `(PARTNER_ROLES as readonly string[]).includes(user.role)` / `(PARTNER_ROLES as readonly string[]).includes(result.user.role)` (import `PARTNER_ROLES` from `@/types/auth.types` — it is a client component; the types module has no server code).

- [ ] **Step 3: Portal layout label + nav wiring (`app/portal/layout.tsx`)**

Line 29 becomes:

```ts
  const roleLabel =
    session?.role === "office_manager"
      ? "מנהל משרד"
      : session?.role === "agent"
        ? "סוכן"
        : "משפיען";
```

Line 73: `<PortalNav role={session?.role ?? null} />` becomes (showCredit logic arrives in Task 9 — for now pass a compiling default):

```tsx
          <PortalNav role={session?.role ?? null} showCredit={session?.role !== "agent"} />
```

- [ ] **Step 4: `app/portal/portal-nav.tsx` — role-aware items**

Replace the `NavItem` type, `navItems`, component signature and filter:

```tsx
type NavItem = { name: string; href: string; roles?: string[]; creditGated?: boolean };

const navItems: NavItem[] = [
  { name: "דשבורד", href: "/portal" },
  { name: "החבילות והלינקים שלי", href: "/portal/packages" },
  // Office money - manager + affiliate; a solo-office agent keeps access
  // (creditGated resolves via the showCredit prop computed server-side).
  { name: "הצבירה שלי", href: "/portal/credit", creditGated: true },
  { name: "הקופונים שלי", href: "/portal/coupons", creditGated: true },
  { name: "ההזמנות שלי", href: "/portal/reservations" },
  // Sellers only - an influencer promotes a link and never prices a package
  // for a named customer. The server action enforces it too.
  { name: "הצעות מחיר", href: "/portal/quotes", roles: ["agent", "office_manager"] },
  { name: "הצוות שלי", href: "/portal/team", roles: ["office_manager"] },
  { name: "עדכונים", href: "/portal/activity" },
  { name: "הפרופיל שלי", href: "/portal/profile" },
];

export function PortalNav({
  role,
  showCredit,
}: {
  role?: string | null;
  showCredit?: boolean;
}) {
```

and the filter inside the JSX:

```tsx
      {navItems
        .filter((item) => !item.roles || (role != null && item.roles.includes(role)))
        .filter((item) => !item.creditGated || showCredit)
        .map((item) => {
```

(The old `agentOnly` field and `isAgent` const are removed.)

- [ ] **Step 5: Type gate + report**

Run: `npx tsc --noEmit` → clean (minus recorded pre-existing). Report. NO commit.

---

### Task 3: Attribution helper module (new)

**Files:**
- Create: `lib/portal-attribution.ts`

**Interfaces:**
- Consumes: `Role`, `PARTNER_ROLES` (Task 1); `@/lib/supabase-server`.
- Produces (exact — later tasks import these):
  - `AGENT_UTM_PREFIX = "ag-"`
  - `generateAgentSlug(): string`
  - `agentUtmContent(slug: string | null | undefined): string | null`
  - `type OfficeUser = { id: string; email: string; display_name: string | null; role: Role; agent_slug: string | null; is_active: boolean; created_at: string }`
  - `getOfficeUsers(partnerCode: string): Promise<OfficeUser[]>`
  - `getAgentSlugForUser(sub: string): Promise<string | null>`
  - `type PortalScope = { isManager: boolean; slug: string | null; soloOffice: boolean; officeUsers: OfficeUser[] }`
  - `resolvePortalScope(session: { sub: string; role: Role; partner_code: string }): Promise<PortalScope>`
  - `getReservationAttribution(reservationIds: number[], officeUsers: OfficeUser[]): Promise<Map<number, string | null>>` — reservation id → office user **id** (null/absent = unattributed)
  - `visibleToAgent(ownerSub: string | null | undefined, viewerSub: string, soloOffice: boolean): boolean`

- [ ] **Step 1: Write the file**

```ts
/**
 * Per-agent attribution + portal scoping (spec: 2026-08-19-office-agents-design.md).
 *
 * Attribution rides the UTM pipeline: every portal link carries
 * `utm_content=ag-<agent_slug>`, myt-main captures it into `utm_touches`
 * (position 0 = the primary/credited touch), and this module joins it back.
 * Money stays office-level - this is reporting only.
 *
 * Server-only (service-role client) - never import VALUES from a client
 * component (type-only imports are fine, they erase at build).
 */

import { supabase } from "@/lib/supabase-server";
import type { Role } from "@/types/auth.types";
import { PARTNER_ROLES } from "@/types/auth.types";

/** Namespaces agent slugs from marketing uses of utm_content (ad-creative names etc). */
export const AGENT_UTM_PREFIX = "ag-";

/** The utm_content value for a user's links, or null when they have no slug. */
export function agentUtmContent(slug: string | null | undefined): string | null {
  return slug ? `${AGENT_UTM_PREFIX}${slug}` : null;
}

/**
 * 6 hex chars - short enough for a URL, random enough for uniqueness at this
 * scale. The DB unique index is the backstop; callers retry once on 23505.
 * NEVER regenerate an existing user's slug - old links must keep attributing.
 */
export function generateAgentSlug(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type OfficeUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  agent_slug: string | null;
  is_active: boolean;
  created_at: string;
};

/** Every portal user (any partner role) linked to the office's tracking code. */
export async function getOfficeUsers(partnerCode: string): Promise<OfficeUser[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("id,email,display_name,role,agent_slug,is_active,created_at")
    .eq("partner_tracking_code", partnerCode)
    .in("role", PARTNER_ROLES)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getOfficeUsers:", JSON.stringify(error));
    return [];
  }
  return (data as OfficeUser[]) ?? [];
}

/** The viewer's own slug (for building their links). */
export async function getAgentSlugForUser(sub: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("agent_slug")
    .eq("id", sub)
    .maybeSingle();
  if (error) {
    console.error("getAgentSlugForUser:", JSON.stringify(error));
    return null;
  }
  return (data?.agent_slug as string | null) ?? null;
}

export type PortalScope = {
  /** office_manager - sees the whole office. */
  isManager: boolean;
  /** The viewer's own agent_slug (null for impersonating admins with no profile). */
  slug: string | null;
  /**
   * Exactly one active portal user on the code. Solo offices keep today's
   * behavior: the sole agent sees unattributed (pre-slug) reservations and
   * keeps the credit/coupons screens - existing partners feel no change.
   */
  soloOffice: boolean;
  officeUsers: OfficeUser[];
};

export async function resolvePortalScope(session: {
  sub: string;
  role: Role;
  partner_code: string;
}): Promise<PortalScope> {
  const officeUsers = await getOfficeUsers(session.partner_code);
  const me = officeUsers.find((u) => u.id === session.sub) ?? null;
  return {
    isManager: session.role === "office_manager",
    slug: me?.agent_slug ?? null,
    soloOffice: officeUsers.filter((u) => u.is_active).length <= 1,
    officeUsers,
  };
}

const TOUCH_CHUNK = 200;

/**
 * reservation id → the office user CREDITED with it (their `id`), from the
 * primary UTM touch. Missing key / null = unattributed (pre-slug link, coupon
 * code typed directly, organic).
 */
export async function getReservationAttribution(
  reservationIds: number[],
  officeUsers: OfficeUser[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (reservationIds.length === 0) return map;
  const bySlug = new Map<string, string>();
  for (const u of officeUsers) {
    if (u.agent_slug) bySlug.set(`${AGENT_UTM_PREFIX}${u.agent_slug}`, u.id);
  }
  for (let i = 0; i < reservationIds.length; i += TOUCH_CHUNK) {
    const chunk = reservationIds.slice(i, i + TOUCH_CHUNK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("utm_touches")
      .select("reservation_id,utm_content")
      .eq("position", 0)
      .in("reservation_id", chunk);
    if (error) {
      // Fail open to "unattributed" - a report gap, never a broken page.
      console.error("getReservationAttribution:", JSON.stringify(error));
      continue;
    }
    for (const row of (data ?? []) as {
      reservation_id: number;
      utm_content: string | null;
    }[]) {
      map.set(
        row.reservation_id,
        row.utm_content ? (bySlug.get(row.utm_content) ?? null) : null,
      );
    }
  }
  return map;
}

/** The agent-isolation rule, in one place. */
export function visibleToAgent(
  ownerSub: string | null | undefined,
  viewerSub: string,
  soloOffice: boolean,
): boolean {
  const owner = ownerSub ?? null;
  return owner === viewerSub || (owner === null && soloOffice);
}
```

- [ ] **Step 2: Sanity-run the slug expression**

Run: `node -e "const b=new Uint8Array(3);crypto.getRandomValues(b);console.log(Array.from(b,x=>x.toString(16).padStart(2,'0')).join(''))"`
Expected: 6 hex chars printed.

- [ ] **Step 3: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 4: Shared user-creation core + user-actions rules

**Files:**
- Create: `lib/auth/user-create.ts`
- Modify: `lib/actions/user-actions.ts`

**Interfaces:**
- Consumes: `generateAgentSlug` (Task 3); `PARTNER_ROLES`, `ADMIN_ROLES`, `Role` (Task 1).
- Produces: in `lib/auth/user-create.ts` —
  - `type CreatePortalUserInput = { email: string; password: string; display_name: string; role: Role; partner_tracking_code: string | null; phone: string | null; created_by: string }`
  - `createManagedUser(input: CreatePortalUserInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>`
  - `resetPasswordById(id: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`

  Task 6 (team actions) calls both. `user-actions.ts` keeps its exported action signatures unchanged.

- [ ] **Step 1: Create `lib/auth/user-create.ts`**

Move (cut, don't copy) `ensurePartnerForUser` and `rollbackCreatedPartner` from `lib/actions/user-actions.ts` into this new file, unchanged EXCEPT the partner-type mapping inside `ensurePartnerForUser`'s insert — replace `type: args.role,` with:

```ts
    // office_manager must NEVER leak into partners.type: myt-main's influencer
    // classifier only recognizes 'agent'/'affiliate' there. The office row is
    // an agent-type partner regardless of which portal role its users hold.
    type: args.role === "affiliate" ? "affiliate" : "agent",
```

Then add the shared core (this file is a plain server module — NO `"use server"` at the top; it must not expose its functions as actions):

```ts
/**
 * Shared user-creation/reset core. Two callers, each with its OWN guard:
 * admin user management (lib/actions/user-actions.ts, requireAdmin) and the
 * office manager's team page (lib/actions/portal-team-actions.ts,
 * requireOfficeManager). Auth checks live in the callers - everything here
 * assumes the caller already authorized the operation.
 */

import { supabase } from "@/lib/supabase-server";
import type { Role } from "@/types/auth.types";
import { PARTNER_ROLES } from "@/types/auth.types";
import { generateAgentSlug } from "@/lib/portal-attribution";
import { logAudit } from "@/lib/audit";

export type CreatePortalUserInput = {
  email: string;
  password: string;
  display_name: string;
  role: Role;
  partner_tracking_code: string | null;
  phone: string | null;
  /** The authorized actor's sub - recorded as user_profiles.created_by. */
  created_by: string;
};

export async function createManagedUser(
  input: CreatePortalUserInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const email = input.email?.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return {
      ok: false,
      error: "Email and a password of 8+ characters are required",
    };
  }
  if (PARTNER_ROLES.includes(input.role) && !input.partner_tracking_code) {
    return { ok: false, error: "Partner-linked users need a partner link" };
  }

  let createdPartnerCode: string | null = null;
  if (PARTNER_ROLES.includes(input.role) && input.partner_tracking_code) {
    const ensured = await ensurePartnerForUser({
      trackingCode: input.partner_tracking_code,
      role: input.role,
      email,
      name: input.display_name,
    });
    if (!ensured.ok) return { ok: false, error: ensured.error };
    if (ensured.created)
      createdPartnerCode = input.partner_tracking_code.trim();
  }

  const { data: created, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
  if (authError || !created.user) {
    console.error("createManagedUser auth:", JSON.stringify(authError));
    await rollbackCreatedPartner(createdPartnerCode);
    return {
      ok: false,
      error: authError?.message ?? "Auth user creation failed",
    };
  }

  const insertProfile = (slug: string | null) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from("user_profiles").insert({
      id: created.user.id,
      email,
      display_name: input.display_name || null,
      role: input.role,
      partner_tracking_code: input.partner_tracking_code || null,
      phone: input.phone || null,
      agent_slug: slug,
      is_active: true,
      created_by: input.created_by,
    });

  const wantsSlug = PARTNER_ROLES.includes(input.role);
  let { error: profileError } = await insertProfile(
    wantsSlug ? generateAgentSlug() : null,
  );
  if (profileError?.code === "23505" && wantsSlug) {
    // agent_slug unique-index collision (astronomically rare) - one retry.
    ({ error: profileError } = await insertProfile(generateAgentSlug()));
  }
  if (profileError) {
    console.error("createManagedUser profile:", JSON.stringify(profileError));
    await supabase.auth.admin
      .deleteUser(created.user.id)
      .catch((e) =>
        console.error(
          "createManagedUser rollback failed (orphan auth user):",
          JSON.stringify(e),
        ),
      );
    await rollbackCreatedPartner(createdPartnerCode);
    return { ok: false, error: "Profile creation failed" };
  }
  return { ok: true, id: created.user.id };
}

export async function resetPasswordById(
  id: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be 8+ characters" };
  }
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    console.error("resetPasswordById:", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
```

(Keep the moved `ensurePartnerForUser`'s internal `logAudit` call — that is why `logAudit` is imported. A 23505 unique-violation retry only fires on the slug index: email uniqueness fails earlier at the auth step.)

- [ ] **Step 2: Rewire `lib/actions/user-actions.ts`**

1. Remove the moved functions and their now-unused imports; add `import { createManagedUser, resetPasswordById } from "@/lib/auth/user-create";`.
2. `PROFILE_COLUMNS` gains `agent_slug`:

```ts
const PROFILE_COLUMNS =
  "id,email,display_name,role,partner_tracking_code,agent_slug,logo_url,phone,contract_url,is_active,created_at,created_by";
```

3. Hierarchy: only superadmin touches admins AND office managers. Replace `canManage`:

```ts
/**
 * Hierarchy: superadmin manages everyone; admin manages only editor/agent/
 * affiliate. Admins can never touch admin, superadmin or office_manager
 * accounts - appointing/managing office managers is a superadmin call (Dor).
 */
function canManage(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "superadmin") return true;
  return !ADMIN_ROLES.includes(targetRole) && targetRole !== "office_manager";
}
```

4. `createUser` — replace the admin-role gate at the top with:

```ts
  if (
    (ADMIN_ROLES.includes(input.role) || input.role === "office_manager") &&
    actor.role !== "superadmin"
  ) {
    return {
      ok: false,
      error: "Only a superadmin can create admin or office-manager users",
    };
  }
```

then replace everything from the email validation down to (and including) the profile insert + rollback with a single call, keeping the audit log after it:

```ts
  const created = await createManagedUser({
    email: input.email,
    password: input.password,
    display_name: input.display_name,
    role: input.role,
    partner_tracking_code: input.partner_tracking_code ?? null,
    phone: input.phone ?? null,
    created_by: actor.sub,
  });
  if (!created.ok) return created;
  await logAudit({
    action: "user_created",
    entityType: "user",
    entityId: created.id,
    changes: {
      email: input.email?.trim().toLowerCase(),
      role: input.role,
      partner_tracking_code: input.partner_tracking_code || null,
      display_name: input.display_name || null,
    },
  });
  return { ok: true, id: created.id };
```

5. `updateUser` — the role-grant gate becomes:

```ts
  if (
    input.role &&
    (ADMIN_ROLES.includes(input.role) || input.role === "office_manager") &&
    actor.role !== "superadmin"
  ) {
    return {
      ok: false,
      error: "Only a superadmin can grant admin or office-manager roles",
    };
  }
```

6. `resetUserPassword` — replace the inline `supabase.auth.admin.updateUserById` block with `const result = await resetPasswordById(id, newPassword); if (!result.ok) return result;` (keep the guard, `canManage` check, and audit exactly as they are; the length validation now lives in `resetPasswordById`, remove the duplicate here).

- [ ] **Step 3: Type gate + report** — `npx tsc --noEmit`. The Task-1 `PROFILE_COLUMNS` note should now be resolved. NO commit.

---

### Task 5: Admin `/users` UI role gating

**Files:**
- Modify: `app/(dashboard)/users/users-client.tsx:195-201` (+ role label rendering — search the file for where `user.role` / role options render)

**Interfaces:**
- Consumes: `ROLES`, `ADMIN_ROLES` (already imported there).
- Produces: nothing new — UI mirror of Task 4's server rules.

- [ ] **Step 1: Gate role assignment + row management**

Replace lines 195-201:

```ts
  const isSuper = me?.role === "superadmin";
  // Admins cannot assign or touch admin/superadmin/office_manager accounts -
  // appointing office managers is superadmin-only (server-enforced too).
  const assignableRoles = ROLES.filter((r) =>
    isSuper ? true : !ADMIN_ROLES.includes(r) && r !== "office_manager",
  );
  const canManageRow = (target: UserProfile) =>
    isSuper ||
    (!ADMIN_ROLES.includes(target.role) && target.role !== "office_manager");
```

- [ ] **Step 2: Role display label**

Find where the role value renders in the table/dropdown. If raw strings render, `office_manager` appears automatically — acceptable. If there is a label map, add `office_manager: "מנהל משרד"`.

- [ ] **Step 3: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 6: Team actions (`portal-team-actions.ts`, new)

**Files:**
- Create: `lib/actions/portal-team-actions.ts`

**Interfaces:**
- Consumes: `requireOfficeManager` (Task 2), `createManagedUser`, `resetPasswordById` (Task 4), `getOfficeUsers`, `OfficeUser` (Task 3), `logAudit` (`@/lib/audit`).
- Produces (Task 7's page calls these exact signatures):
  - `listOfficeUsers(): Promise<OfficeUser[]>`
  - `createOfficeAgent(input: { email: string; password: string; display_name: string; phone?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }>`
  - `resetOfficeAgentPassword(id: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `setOfficeAgentActive(id: string, isActive: boolean): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the file**

```ts
"use server";

/**
 * Office-manager self-service team management (/portal/team).
 *
 * Hard rules, all server-enforced: the manager touches ONLY users of their own
 * partner_tracking_code; may CREATE only role='agent' (never managers/staff -
 * appointing managers is superadmin-only in /users); may reset/disable only
 * role='agent' targets. Everything is audited.
 */

import { requireOfficeManager } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { createManagedUser, resetPasswordById } from "@/lib/auth/user-create";
import { getOfficeUsers, type OfficeUser } from "@/lib/portal-attribution";
import { logAudit } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * The target row a manager may mutate: an AGENT of the manager's own office.
 * Fetched fresh per mutation - never trust a client-sent id.
 */
async function getManagedAgent(
  id: string,
  partnerCode: string,
): Promise<
  | { ok: true; user: { id: string; email: string; role: string } }
  | { ok: false; error: string }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select("id,email,role,partner_tracking_code")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getManagedAgent:", JSON.stringify(error));
    return { ok: false, error: "טעינת המשתמש נכשלה" };
  }
  if (
    !data ||
    data.partner_tracking_code !== partnerCode ||
    data.role !== "agent"
  ) {
    // Same message for "not found", "other office" and "not an agent" -
    // don't confirm foreign ids exist.
    return { ok: false, error: "המשתמש לא נמצא במשרד שלך" };
  }
  return { ok: true, user: { id: data.id, email: data.email, role: data.role } };
}

export async function listOfficeUsers(): Promise<OfficeUser[]> {
  const session = await requireOfficeManager();
  return getOfficeUsers(session.partner_code);
}

export async function createOfficeAgent(input: {
  email: string;
  password: string;
  display_name: string;
  phone?: string | null;
}): Promise<CreateResult> {
  const session = await requireOfficeManager();
  const created = await createManagedUser({
    email: input.email,
    password: input.password,
    display_name: input.display_name,
    // Both FORCED - a manager creates agents of their own office, nothing else.
    role: "agent",
    partner_tracking_code: session.partner_code,
    phone: input.phone ?? null,
    created_by: session.sub,
  });
  if (!created.ok) return created;
  await logAudit({
    action: "user_created",
    entityType: "user",
    entityId: created.id,
    changes: {
      email: input.email?.trim().toLowerCase(),
      role: "agent",
      partner_tracking_code: session.partner_code,
      display_name: input.display_name || null,
    },
    metadata: { via: "portal_team" },
  });
  return created;
}

export async function resetOfficeAgentPassword(
  id: string,
  newPassword: string,
): Promise<Result> {
  const session = await requireOfficeManager();
  const target = await getManagedAgent(id, session.partner_code);
  if (!target.ok) return target;
  const result = await resetPasswordById(id, newPassword);
  if (!result.ok) return result;
  await logAudit({
    action: "password_reset",
    entityType: "user",
    entityId: id,
    metadata: { via: "portal_team" },
  });
  return { ok: true };
}

export async function setOfficeAgentActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const session = await requireOfficeManager();
  if (id === session.sub) {
    return { ok: false, error: "אי אפשר להשבית את החשבון של עצמך" };
  }
  const target = await getManagedAgent(id, session.partner_code);
  if (!target.ok) return target;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_profiles")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) {
    console.error("setOfficeAgentActive:", JSON.stringify(error));
    return { ok: false, error: "העדכון נכשל" };
  }
  await logAudit({
    action: isActive ? "user_updated" : "user_disabled",
    entityType: "user",
    entityId: id,
    changes: { is_active: isActive },
    metadata: { via: "portal_team" },
  });
  return { ok: true };
}
```

(`id === session.sub` self-disable check is defense in depth — a manager is not role `agent` so `getManagedAgent` rejects anyway.)

- [ ] **Step 2: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 7: `/portal/team` page (new)

**Files:**
- Create: `app/portal/team/page.tsx` (server component)
- Create: `app/portal/team/team-client.tsx` (client component)

**Interfaces:**
- Consumes: Task 6 actions (exact signatures above), `getSession` (`@/lib/auth/guards`), shadcn `Card/Table/Dialog/Button/Input/Badge` from `components/ui/`, `useToast` (match the exact import path used in `app/(dashboard)/users/users-client.tsx`).
- Produces: nothing consumed later.

- [ ] **Step 1: `app/portal/team/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";
import { listOfficeUsers } from "@/lib/actions/portal-team-actions";
import { TeamClient } from "./team-client";

export default async function PortalTeamPage() {
  const session = await getSession();
  // Manager-only page; agents/affiliates land back on the dashboard. Staff
  // debugging the portal (no partner session) see nothing rather than a crash.
  if (!session || session.role !== "office_manager") redirect("/portal");

  const users = await listOfficeUsers();
  return <TeamClient initialUsers={users} myId={session.sub} />;
}
```

- [ ] **Step 2: `app/portal/team/team-client.tsx`**

Client component, RTL Hebrew, portal look. Before writing, check `app/(dashboard)/users/users-client.tsx` imports for the exact `useToast` path and shadcn component paths — mirror them. Full skeleton:

```tsx
"use client";

import { useState } from "react";
import type { OfficeUser } from "@/lib/portal-attribution";
import {
  createOfficeAgent,
  resetOfficeAgentPassword,
  setOfficeAgentActive,
  listOfficeUsers,
} from "@/lib/actions/portal-team-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const ROLE_LABELS: Record<string, string> = {
  office_manager: "מנהל משרד",
  agent: "סוכן",
  affiliate: "משפיען",
};

export function TeamClient({
  initialUsers,
  myId,
}: {
  initialUsers: OfficeUser[];
  myId: string;
}) {
  const { toast } = useToast();
  const [users, setUsers] = useState(initialUsers);
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", phone: "" });

  const [resetTarget, setResetTarget] = useState<OfficeUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const refresh = async () => setUsers(await listOfficeUsers());

  const handleAdd = async () => {
    if (!form.email.trim() || form.password.length < 8 || !form.display_name.trim()) {
      toast({ variant: "destructive", title: "פרטים חסרים", description: "אימייל, שם, וסיסמה של 8+ תווים." });
      return;
    }
    setBusy(true);
    const result = await createOfficeAgent({
      email: form.email,
      password: form.password,
      display_name: form.display_name,
      phone: form.phone || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast({ variant: "destructive", title: "הוספת הסוכן נכשלה", description: result.error });
      return;
    }
    toast({ title: "הסוכן נוסף", description: `${form.display_name} יכול להתחבר לפורטל.` });
    setAddOpen(false);
    setForm({ email: "", password: "", display_name: "", phone: "" });
    await refresh();
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    const result = await resetOfficeAgentPassword(resetTarget.id, resetPassword);
    setBusy(false);
    if (!result.ok) {
      toast({ variant: "destructive", title: "איפוס הסיסמה נכשל", description: result.error });
      return;
    }
    toast({ title: "הסיסמה אופסה" });
    setResetTarget(null);
    setResetPassword("");
  };

  const handleToggleActive = async (user: OfficeUser) => {
    setBusy(true);
    const result = await setOfficeAgentActive(user.id, !user.is_active);
    setBusy(false);
    if (!result.ok) {
      toast({ variant: "destructive", title: "העדכון נכשל", description: result.error });
      return;
    }
    await refresh();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>הצוות שלי</CardTitle>
            <CardDescription>
              הסוכנים של המשרד. כל סוכן מקבל לינקים אישיים והמכירות שלו נספרות בנפרד - העמלה נשארת של המשרד.
            </CardDescription>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>הוספת סוכן</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>סוכן חדש במשרד</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input placeholder="שם מלא" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
                <Input placeholder="אימייל" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <Input placeholder="סיסמה (8+ תווים)" dir="ltr" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <Input placeholder="טלפון (לא חובה)" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <DialogFooter>
                <Button onClick={handleAdd} disabled={busy}>הוספה</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם</TableHead>
                <TableHead className="text-right">אימייל</TableHead>
                <TableHead className="text-right">תפקיד</TableHead>
                <TableHead className="text-right">מזהה לינק</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.display_name || "-"}
                    {user.id === myId && <span className="ms-1 text-xs text-muted-foreground">(אני)</span>}
                  </TableCell>
                  <TableCell dir="ltr" className="text-right">{user.email}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role] ?? user.role}</TableCell>
                  <TableCell dir="ltr" className="text-right font-mono text-xs">
                    {user.agent_slug ? `ag-${user.agent_slug}` : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "secondary"}>
                      {user.is_active ? "פעיל" : "מושבת"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2 space-x-reverse whitespace-nowrap">
                    {user.role === "agent" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => { setResetTarget(user); setResetPassword(""); }}>
                          איפוס סיסמה
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => handleToggleActive(user)}>
                          {user.is_active ? "השבתה" : "הפעלה"}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>איפוס סיסמה - {resetTarget?.display_name || resetTarget?.email}</DialogTitle>
          </DialogHeader>
          <Input placeholder="סיסמה חדשה (8+ תווים)" dir="ltr" type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
          <DialogFooter>
            <Button onClick={handleReset} disabled={busy || resetPassword.length < 8}>איפוס</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Type-import caveat:** `team-client.tsx` imports `type OfficeUser` from the server-only `lib/portal-attribution.ts`. Type-only imports erase at build and are safe — keep the `import type` form; never import a VALUE from that module in a client file.

- [ ] **Step 3: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 8: Links carry the agent slug (+ handoff for managers)

**Files:**
- Modify: `lib/site.ts:21-34`
- Modify: `app/portal/links/page.tsx` + `app/portal/links/link-builder.tsx:60,121`
- Modify: `app/portal/packages/page.tsx` + `app/portal/packages/event-links.tsx:42`
- Modify: `lib/actions/portal-package-actions.ts:1589,1691,1800-1866`
- Modify: `lib/actions/portal-dashboard-actions.ts:458,646`

**Interfaces:**
- Consumes: `getAgentSlugForUser`, `agentUtmContent` (Task 3), `SELLER_ROLES` (Task 1).
- Produces: `partnerLink(trackingCode, eventId?, shareToken?, agentUtm?)` — 4th optional positional param, the FULL utm_content value (already prefixed, i.e. the return of `agentUtmContent`), or null/undefined for the legacy office-level link.

- [ ] **Step 1: `lib/site.ts`**

```ts
export function partnerLink(
  trackingCode: string,
  eventId?: number | null,
  shareToken?: string | null,
  /** Full utm_content value (`ag-<slug>` via agentUtmContent) - credits the sale to that agent. */
  agentUtm?: string | null,
): string {
  const path = eventId == null ? "/" : `/order/${eventId}`
  // utm_medium=influencer is the classifier fast path in myt-main's middleware
  // (myt_utm cookie): it marks the visit as influencer-attributed without a
  // partners-table lookup. Old links without it still classify via the lookup.
  let base = `${PUBLIC_SITE_URL}${path}?utm_source=${encodeURIComponent(trackingCode)}&utm_medium=influencer`
  // Per-agent attribution: myt-main captures utm_content into utm_touches
  // (position 0 = credited touch); the backoffice joins it back per agent.
  if (agentUtm) base += `&utm_content=${encodeURIComponent(agentUtm)}`
  return shareToken ? `${base}&pkg=${encodeURIComponent(shareToken)}` : base
}
```

(Keep the existing doc comment above the function.)

- [ ] **Step 2: Links page**

Read `app/portal/links/page.tsx` first for the exact prop wiring into `<LinkBuilder>`. In the server component, resolve the viewer's utm value and pass it down:

```ts
import { getAgentSlugForUser, agentUtmContent } from "@/lib/portal-attribution";
// inside the page, after the session resolution:
const agentUtm = session ? agentUtmContent(await getAgentSlugForUser(session.sub)) : null;
```

`link-builder.tsx`: add `agentUtm?: string | null` to its props type; thread it into BOTH `partnerLink(...)` calls: line 60 `partnerLink(trackingCode)` → `partnerLink(trackingCode, undefined, undefined, agentUtm)`; line 121 `partnerLink(trackingCode, selected.id)` → `partnerLink(trackingCode, selected.id, undefined, agentUtm)`.

- [ ] **Step 3: Packages page copy-link**

Same pattern: `app/portal/packages/page.tsx` computes `agentUtm` server-side (same two imports) and passes it to `<EventLinks .../>`; `event-links.tsx:42` becomes `partnerLink(trackingCode, eventId, undefined, agentUtm)` with the prop added to its type.

- [ ] **Step 4: `lib/actions/portal-package-actions.ts`**

Add import: `import { getAgentSlugForUser, agentUtmContent } from "@/lib/portal-attribution";` and add `SELLER_ROLES` to (or create) the `@/types/auth.types` import.

1. `createPreparedPackage` (return at line 1589): before the return, `const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));` then `partnerLink(session.partner_code, event.id, token, agentUtm)`.
2. `getMyPreparedPackages` (line 1691): resolve once before the `.map`: `const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));` then `link: partnerLink(session.partner_code, row.event_id, row.share_token, agentUtm),`. (The VIEWER's slug on every row is intentional — credit follows whoever distributes the link.)
3. `getAgentOrderHandoffLink`:
   - Line 1805: `if (session.role !== "agent")` → `if (!SELLER_ROLES.includes(session.role))` (keep the Hebrew error string).
   - Line 1833: `.in("role", ["agent", "affiliate"])` → `.in("role", ["agent", "affiliate", "office_manager"])`.
   - The mint at 1845-1850 stays `role: "agent"` — add above it: `// Always minted as "agent": main's requireAgent doesn't know office_manager and doesn't need to.`
   - The `next` URL (1859-1861) gains utm_content (resolve `const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));` before it):

```ts
  const next = `/order/${data.event_id}?utm_source=${encodeURIComponent(
    session.partner_code,
  )}&utm_medium=influencer${
    agentUtm ? `&utm_content=${encodeURIComponent(agentUtm)}` : ""
  }&pkg=${encodeURIComponent(data.share_token)}`;
```

- [ ] **Step 5: `lib/actions/portal-dashboard-actions.ts` hrefs (lines 458, 646)**

Both build `href: partnerLink(code, ...)` for the viewer to copy/click. In `getPortalDashboard`, resolve once near the top (after `const code = session.partner_code;`): `const agentUtm = agentUtmContent(await getAgentSlugForUser(session.sub));` (imports as in Step 4) and pass as the 4th arg at both call sites (3rd arg `undefined` where no share token is passed today).

- [ ] **Step 6: Verify + report**

Run: `npx tsc --noEmit` → clean.
Run: `grep -rn "partnerLink(" --include="*.ts*" app lib` — list every call site with its 4th arg in the report; each either passes `agentUtm` or is deliberately office-level (name which). NO commit.

---

### Task 9: Seller-role sweep + credit access rule

**Files:**
- Modify: `lib/auth/guards.ts` (add `requireCreditAccess`)
- Modify: `lib/actions/quote-actions.ts:239,249,284,351,404`
- Modify: `lib/actions/partner-credit-actions.ts:267,310,320,435`
- Modify: `lib/actions/portal-coupon-actions.ts:32,199`
- Modify: `lib/actions/portal-actions.ts:305` (getPortalCoupons)
- Modify: `lib/actions/portal-activity-actions.ts:51`
- Modify: `app/portal/layout.tsx` (real `showCredit`), `app/portal/page.tsx:70`, `app/portal/credit/page.tsx:32`, `app/portal/coupons/page.tsx`, `app/portal/quotes/page.tsx`, `app/portal/quotes/new/page.tsx:33`, `app/portal/packages/page.tsx:74`
- Read-check: `app/portal/reservations/page.tsx:18`, `app/portal/activity/page.tsx:47` (change only if they hard-check `"agent"`)

**Interfaces:**
- Consumes: `SELLER_ROLES` (Task 1), `resolvePortalScope` (Task 3), `requirePartner` (Task 2).
- Produces: `requireCreditAccess(): Promise<SessionPayload & { partner_code: string }>` in `lib/auth/guards.ts`.

- [ ] **Step 1: `requireCreditAccess` in `lib/auth/guards.ts`**

First verify middleware does not import guards: `grep -n "auth/guards" middleware.ts` → expected no match (the count query below is not Edge-safe). If it matches, STOP and report.

Append to guards.ts (add `import { supabase } from "@/lib/supabase-server";`):

```ts
/**
 * Credit + coupons are OFFICE money: office_manager and affiliate always;
 * an agent only when they are the office's sole active portal user (legacy
 * solo partners keep today's behavior - spec §5).
 */
export async function requireCreditAccess(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requirePartner();
  if (session.role === "office_manager" || session.role === "affiliate") {
    return session;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from("user_profiles")
    .select("id", { count: "exact", head: true })
    .eq("partner_tracking_code", session.partner_code)
    .in("role", PARTNER_ROLES)
    .eq("is_active", true);
  if (error) {
    console.error("requireCreditAccess:", JSON.stringify(error));
    throw new Error("Unauthorized");
  }
  if ((count ?? 0) > 1) throw new Error("Unauthorized");
  return session;
}
```

- [ ] **Step 2: Quote actions — sellers, not just agents**

In `lib/actions/quote-actions.ts`, replace each `if (session.role !== "agent")` at lines 239, 249, 284, 351, 404 with `if (!SELLER_ROLES.includes(session.role))` (import `SELLER_ROLES` from `@/types/auth.types`). Keep each early-return value exactly as it is today (read each site: null / [] / empty object / error result respectively).

- [ ] **Step 3: Credit + coupon actions — requireCreditAccess**

- `partner-credit-actions.ts`: `getMyCredit` (267) and `convertCreditToCoupon` (435): replace `await requirePartner()` with `await requireCreditAccess()` (adjust the guards import). `getMyVoucherSettlement` (310): `requirePartner()` → `requireCreditAccess()` AND line 320 `if (session.role !== "agent") return empty;` → `if (session.role === "affiliate") return empty;` (voucher settlement is a seller flow; manager and solo agent see it, influencers keep the empty result).
- `portal-coupon-actions.ts`: `getMyCouponTerms` (32) and `createPartnerCoupon` (199): `requirePartner()` → `requireCreditAccess()`. Do NOT touch `fundedCouponCodesFor` / `quoteUpliftsFor` — internal helpers taking a code param, used by reservation math for every role.
- `portal-actions.ts` `getPortalCoupons` (305): `requirePartner()` → `requireCreditAccess()`.

- [ ] **Step 4: Activity feed quotes branch**

`portal-activity-actions.ts:51`: `session.role === "agent"` → `SELLER_ROLES.includes(session.role)` (import from `@/types/auth.types`).

- [ ] **Step 5: Pages + layout showCredit**

- `app/portal/layout.tsx`: replace the Task-2 placeholder. Add a top-of-file static import `import { resolvePortalScope } from "@/lib/portal-attribution";` then after `const profile = ...`:

```ts
  const scope =
    isPartner && session?.partner_code
      ? await resolvePortalScope({
          sub: session.sub,
          role: session.role,
          partner_code: session.partner_code,
        })
      : null;
  const showCredit =
    !!session &&
    (session.role === "office_manager" ||
      session.role === "affiliate" ||
      (session.role === "agent" && (scope?.soloOffice ?? false)));
```

Pass `showCredit={showCredit}` to `PortalNav`.

- `app/portal/credit/page.tsx` and `app/portal/coupons/page.tsx`: after the existing `isPartner` check, add the same rule and redirect on failure (import `redirect` from `next/navigation`, `resolvePortalScope` from `@/lib/portal-attribution`):

```ts
  const scope = await resolvePortalScope({
    sub: session.sub,
    role: session.role,
    partner_code: session.partner_code!,
  });
  const creditAllowed =
    session.role === "office_manager" ||
    session.role === "affiliate" ||
    scope.soloOffice;
  if (!creditAllowed) redirect("/portal");
```

- `app/portal/credit/page.tsx:32`: `const isAgent = session.role === "agent";` → `const isAgent = SELLER_ROLES.includes(session.role);` (voucher settlement fetch now includes managers).
- Seller display toggles — each `role === "agent"` becomes `SELLER_ROLES.includes(role)`: `app/portal/page.tsx:70`, `app/portal/quotes/new/page.tsx:33`, `app/portal/packages/page.tsx:74` (`isAgent={SELLER_ROLES.includes(session.role)}`), `app/portal/quotes/page.tsx` gate. Read each site first. Intent everywhere: **"agent-only" becomes "seller-only" (agent + office_manager); "affiliate" branches unchanged.**
- Read-check `app/portal/reservations/page.tsx:18` and `app/portal/activity/page.tsx:47` — both use `PARTNER_ROLES.includes(...)` (no change) unless a hard `"agent"` check hides seller UI; if so, same SELLER_ROLES swap.

- [ ] **Step 6: Type gate + report** — `npx tsc --noEmit`. Report every touched call site. NO commit.

---

### Task 10: Reservations + stats isolation (actions + page)

**Files:**
- Modify: `lib/actions/portal-actions.ts` (`getPortalStats:218`, `getPortalReservations:372`)
- Modify: `app/portal/reservations/page.tsx` + its client table component (read the folder first; the table lives beside the page)

**Interfaces:**
- Consumes: `resolvePortalScope`, `getReservationAttribution`, `visibleToAgent` (Task 3).
- Produces: `PortalReservation` rows gain `agent_name: string | null`; `PortalReservationsPage` gains `officeAgents: { sub: string; name: string }[]` (empty for non-managers); `getPortalReservations(filterAgentSub?: string | null)` gains one optional param (manager-only filter; `"none"` = unattributed bucket). The page consumes these exact names.

- [ ] **Step 1: Scope `getPortalStats`**

After `const session = await requirePartner();` add `const scope = await resolvePortalScope(session);` (import the three helpers from `@/lib/portal-attribution`).

After the reservations rows are parsed (the `const reservations = ...` cast) and BEFORE `const paid = reservations.filter(isPaid);`, insert:

```ts
  // Agent isolation: only reservations credited to me (solo offices keep
  // unattributed rows - pre-slug history; spec §5).
  let scoped = reservations;
  if (!scope.isManager && session.role === "agent") {
    const attribution = await getReservationAttribution(
      reservations.map((r) => r.id),
      scope.officeUsers,
    );
    scoped = reservations.filter((r) =>
      visibleToAgent(attribution.get(r.id), session.sub, scope.soloOffice),
    );
  }
```

and use `scoped` (not `reservations`) for `paid`, `totalReservations`, `totalSalesUsd`, `paidTickets`, `estimatedCommissionUsd`. Affiliates: the condition is false → unscoped, unchanged.

- [ ] **Step 2: Scope `getPortalReservations` + agent names**

Signature: `export async function getPortalReservations(filterAgentSub?: string | null): Promise<PortalReservationsPage> {`.

After the session line add `const scope = await resolvePortalScope(session);`. After `const all = (reservationsResult.data ?? []) as Row[];` insert:

```ts
  const attribution = await getReservationAttribution(
    all.map((r) => r.id),
    scope.officeUsers,
  );
  const nameBySub = new Map(
    scope.officeUsers.map((u) => [u.id, u.display_name || u.email]),
  );
  let visible = all;
  if (!scope.isManager && session.role === "agent") {
    visible = all.filter((r) =>
      visibleToAgent(attribution.get(r.id), session.sub, scope.soloOffice),
    );
  } else if (scope.isManager && filterAgentSub) {
    visible =
      filterAgentSub === "none"
        ? all.filter((r) => (attribution.get(r.id) ?? null) === null)
        : all.filter((r) => attribution.get(r.id) === filterAgentSub);
  }
```

Switch the truncation lines to `visible` (`visible.length > RESERVATIONS_PAGE_SIZE`, `visible.slice(0, RESERVATIONS_PAGE_SIZE)`), and inside the row `.map` add:

```ts
      agent_name: (() => {
        const owner = attribution.get(r.id) ?? null;
        return owner ? (nameBySub.get(owner) ?? null) : null;
      })(),
```

Add `agent_name: string | null;` to the `PortalReservation` type (find its definition — same file or its types import). Extend the page type and BOTH return paths (error path returns `officeAgents: []`):

```ts
export interface PortalReservationsPage {
  rows: PortalReservation[];
  truncated: boolean;
  /** Manager only - the office roster for the per-agent filter. Empty otherwise. */
  officeAgents: { sub: string; name: string }[];
}
```

```ts
    officeAgents: scope.isManager
      ? scope.officeUsers.map((u) => ({ sub: u.id, name: u.display_name || u.email }))
      : [],
```

- [ ] **Step 3: Reservations page UI**

Read `app/portal/reservations/page.tsx` and the component it renders. Changes:
- The page accepts `searchParams` (Next 15 Promise: `const { agent } = await searchParams;`) and calls `getPortalReservations(typeof agent === "string" ? agent : null)`.
- Manager view (`session.role === "office_manager"`): a filter row of `<Link>` pills above the table — "כל המשרד" (`/portal/reservations`), one pill per office user (`/portal/reservations?agent=<sub>`), "לא משויך" (`?agent=none`) — active pill styled with the portal's `bg-brand-mint text-brand-forest` idiom; plus an "סוכן" column rendering `row.agent_name ?? "לא משויך"`.
- Agent view: no filter UI, no agent column.

- [ ] **Step 4: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 11: Dashboard isolation + manager toggle + per-agent breakdown

**Files:**
- Modify: `lib/actions/portal-dashboard-actions.ts` (`getPortalDashboard:164`)
- Modify: `app/portal/page.tsx`

**Interfaces:**
- Consumes: `resolvePortalScope`, `getReservationAttribution`, `visibleToAgent` (Task 3).
- Produces: `getPortalDashboard(range?: InsightsRange, view?: "office" | "mine")`; `PortalDashboard` gains `agentBreakdown: AgentBreakdownRow[] | null`:

```ts
export interface AgentBreakdownRow {
  sub: string;
  name: string;
  totalReservations: number;
  paidReservations: number;
  totalSalesUsd: number;
}
```

- [ ] **Step 1: Scope the dashboard action**

Signature: `export async function getPortalDashboard(range: InsightsRange = "all", view: "office" | "mine" = "office"): Promise<PortalDashboard> {`.

After `const code = session.partner_code;` add `const scope = await resolvePortalScope(session);`.

Read the function body fully first, find the local name binding the reservations rows (from `reservationsResult.data`). After the error checks, insert (using that local name — shown here as `reservationRows`):

```ts
  const attribution = await getReservationAttribution(
    reservationRows.map((r) => r.id),
    scope.officeUsers,
  );
  let scopedRows = reservationRows;
  if (!scope.isManager && session.role === "agent") {
    scopedRows = reservationRows.filter((r) =>
      visibleToAgent(attribution.get(r.id), session.sub, scope.soloOffice),
    );
  } else if (scope.isManager && view === "mine") {
    scopedRows = reservationRows.filter(
      (r) => attribution.get(r.id) === session.sub,
    );
  }
```

Every downstream aggregate built from reservations (sales totals, paid counts, booking funnel stage, top picks) switches to `scopedRows`. RPC funnel/click counts (`partner_funnel_counts_range`, `partner_clicked_events_range`, `partner_entry_funnels_range`) stay office-level — click analytics keyed by code, not per-agent; leave untouched.

Breakdown (manager, office view) — after the aggregates, reusing the file's own paid/sales helpers (match their local names, e.g. `isPaid` and the per-row sales accessor):

```ts
  const agentBreakdown: AgentBreakdownRow[] | null = scope.isManager
    ? (() => {
        const rows = new Map<string, AgentBreakdownRow>();
        for (const u of scope.officeUsers) {
          rows.set(u.id, {
            sub: u.id,
            name: u.display_name || u.email,
            totalReservations: 0,
            paidReservations: 0,
            totalSalesUsd: 0,
          });
        }
        const unattributed: AgentBreakdownRow = {
          sub: "",
          name: "לא משויך",
          totalReservations: 0,
          paidReservations: 0,
          totalSalesUsd: 0,
        };
        for (const r of reservationRows) {
          const owner = attribution.get(r.id) ?? null;
          const row = owner ? rows.get(owner) : unattributed;
          if (!row) continue;
          row.totalReservations += 1;
          if (isPaid(r)) {
            row.paidReservations += 1;
            row.totalSalesUsd += r.user_shown_price ?? 0;
          }
        }
        const list = [...rows.values()].sort(
          (a, b) => b.totalSalesUsd - a.totalSalesUsd,
        );
        if (unattributed.totalReservations > 0) list.push(unattributed);
        return list;
      })()
    : null;
```

(If the headline sales figure uses a helper like `sumSales`, mirror the same per-row accessor here so breakdown dollars match headline dollars.) Add `agentBreakdown` to the `PortalDashboard` interface and the return object.

- [ ] **Step 2: Dashboard page**

`app/portal/page.tsx` (read fully first; note how it currently reads a range param, if any):
- Accept `searchParams` (Next 15 Promise), extract `view`, call `getPortalDashboard(range, session.role === "office_manager" && view === "mine" ? "mine" : "office")`.
- Manager only: a two-pill toggle above the stat cards — `<Link href="/portal">כל המשרד</Link>` / `<Link href="/portal?view=mine">המכירות שלי</Link>`, active pill `bg-brand-mint text-brand-forest`.
- Manager + office view: render `dashboard.agentBreakdown` as a Card + Table titled "מכירות לפי סוכן", columns: שם / הזמנות / שולמו / מכירות ($). Skip when null/empty. Reuse the page's existing Card/Table imports.

- [ ] **Step 3: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 12: Work-items isolation (packages + quotes)

**Files:**
- Modify: `lib/actions/portal-package-actions.ts` (`getMyPreparedPackages:1648`, `deletePreparedPackage:1722`, `setPackageAllowEdit:1759`, `getAgentOrderHandoffLink:1812-1817`)
- Modify: `lib/actions/quote-actions.ts` (`getPortalQuotes:246`, `getPortalQuotesOverview:272`, `updateQuoteStatus:346`)
- Modify: `app/portal/packages/page.tsx` + the packages list component (creator column for managers)

**Interfaces:**
- Consumes: `resolvePortalScope` (Task 3), `SELLER_ROLES` (Task 1).
- Produces: `PreparedPackageListItem` gains `creator_name: string | null`.

- [ ] **Step 1: Packages list scoping + creator names**

In `getMyPreparedPackages`:
- Add `created_by` to both selects (`${LIST_COLUMNS}, allow_edit, created_by` and fallback `${LIST_COLUMNS}, created_by`) and `created_by?: string | null` to `PreparedPackageRow` (type is in the same file).
- After the session line: `const scope = await resolvePortalScope(session);`.
- Agent isolation on the QUERY: when `session.role === "agent" && !scope.soloOffice`, chain `.eq("created_by", session.sub)` onto both queries. Solo agents and managers see all office rows (solo-office legacy packages may predate `created_by` — never hide them from the only user).
- Manager creator column: `const nameBySub = new Map(scope.officeUsers.map((u) => [u.id, u.display_name || u.email]));` and in the returned map add `creator_name: row.created_by ? (nameBySub.get(row.created_by) ?? null) : null,`. Add the field to `PreparedPackageListItem`.

- [ ] **Step 2: Package mutations ownership**

`deletePreparedPackage` (1722) and `setPackageAllowEdit` (1759) already filter `.eq("partner_tracking_code", session.partner_code)` (read each body). In each: `const scope = await resolvePortalScope(session);` after the session line, and chain `.eq("created_by", session.sub)` onto the lookup/mutation query when `session.role === "agent" && !scope.soloOffice`. Managers manage all office packages. Same treatment for the package lookup inside `getAgentOrderHandoffLink` (lines 1812-1817): an agent may hand off only their own package.

- [ ] **Step 3: Quotes scoping**

- `getPortalQuotes` (246): after the seller gate, `const scope = await resolvePortalScope(session);` and chain `.eq("created_by", session.sub)` when `session.role === "agent" && !scope.soloOffice`.
- `getPortalQuotesOverview` (272): composes `getPortalQuotes()` (now scoped). Its linked-reservations query (`.eq("aff_partner_tracking_code", ...)`) stays office-level — it only auto-closes quotes, and a manager-made sale closing an agent's quote is correct. No change.
- `updateQuoteStatus` (346): read the body; on the UPDATE query add `.eq("created_by", session.sub)` when `session.role === "agent" && !scope.soloOffice` (manager may update any office quote). Keep the existing partner-code filter.

- [ ] **Step 4: Packages page creator column**

In the packages list UI (component rendering `PreparedPackageListItem[]`, found via `app/portal/packages/page.tsx` imports): pass `isManager={session.role === "office_manager"}` from the page; when true, render a "נוצר ע\"י" column showing `creator_name ?? "-"`. Agents see no new column.

- [ ] **Step 5: Activity feed isolation (`lib/actions/portal-activity-actions.ts`)**

`getPortalActivityFeed` (line 45) builds four office-scoped queries (quotes / prepared_packages / reservations / coupons — read the whole function first). Scope it for non-solo agents:

- After the session line: `const scope = await resolvePortalScope(session);` and `const isolate = session.role === "agent" && !scope.soloOffice;` (import `resolvePortalScope`, `getReservationAttribution`, `visibleToAgent` from `@/lib/portal-attribution`).
- Quotes + packages branches: when `isolate`, chain `.eq("created_by", session.sub)` onto each query.
- Reservations branch: after its rows land, when `isolate`, filter with the attribution map:

```ts
  const attribution = isolate
    ? await getReservationAttribution(
        reservationRows.map((r) => r.id),
        scope.officeUsers,
      )
    : null;
  const visibleReservations = attribution
    ? reservationRows.filter((r) =>
        visibleToAgent(attribution.get(r.id), session.sub, scope.soloOffice),
      )
    : reservationRows;
```

(`reservationRows` = the function's local name for the reservations result rows; feed items build from `visibleReservations`.)
- Coupons branch: coupons are office-level (no creator column) — when `isolate`, skip the coupons query entirely (`Promise.resolve({ data: [], error: null })`, same pattern the file already uses for the non-seller quotes branch).

- [ ] **Step 6: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 13: Impersonation gets manager semantics

**Files:**
- Modify: `lib/actions/impersonate-actions.ts:48,52-57,150,157-162`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: `impersonatePartner`**

Line 48 `const role = partner.type === "agent" ? "agent" : "affiliate";` becomes:

```ts
  // Agent-type offices are entered as office_manager: portal isolation keys
  // "own" views on created_by/slug, which an admin's sub never matches - the
  // manager view (whole office) is the only one that renders correctly.
  const role =
    partner.type === "agent" ? ("office_manager" as const) : ("affiliate" as const);
```

The profile lookup (52-57) prefers a real manager identity when one exists:

```ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("user_profiles")
    .select("id, email")
    .eq("partner_tracking_code", code)
    .in("role", ["office_manager", "agent", "affiliate"])
    // 'office_manager' > 'agent' > 'affiliate' alphabetically - descending
    // puts a real manager first, so the minted sub gets the fullest view.
    .order("role", { ascending: false })
    .limit(1)
    .maybeSingle();
```

- [ ] **Step 2: `switchToMyPartnerPortal`** — same two changes at lines 150 and 157-162 (role mapping + ordered lookup).

- [ ] **Step 3: Type gate + report** — `npx tsc --noEmit`. NO commit.

---

### Task 14: Wrap-up — full gate, spec sweep, QA handoff

**Files:** none new.

- [ ] **Step 1: Full repo gates**

Run: `npx tsc --noEmit` → clean (or only the errors recorded as pre-existing in Task 1).
Run: `npm run lint` → no NEW errors versus master.

- [ ] **Step 2: Spec coverage sweep**

Open `docs/superpowers/specs/2026-08-19-office-agents-design.md`, walk §2-§9, and for each requirement name the implementing file. Any gap → fix now. Re-verify the two traps: (a) `grep -n "type:" lib/auth/user-create.ts` shows the office_manager→agent partners.type mapping; (b) `grep -n "office_manager" types/auth.types.ts lib/auth/session.ts` shows the role in ROLES and no leftover hardcoded allowlist.

- [ ] **Step 3: Report to Dor (NO commit, NO push)**

Output: changed-files list, the migration filename, and this manual QA checklist (his, on staging/prod after deploy):

1. Superadmin: create `office_manager` on an office code in `/users`; a plain admin cannot select that role.
2. Manager login → `/portal` shows toggle כל המשרד/המכירות שלי + "מכירות לפי סוכן"; `/portal/team` creates an agent (appears with `ag-` slug), resets their password, disables them; audit log shows all three.
3. Agent login → sees only own packages/quotes/reservations; no צבירה/קופונים/צוות in nav; typing `/portal/credit` redirects to `/portal`; link on `/portal/links` contains `utm_content=ag-<slug>`.
4. Click the agent's link → book on main → reservation appears under that agent (manager breakdown + reservations agent column). A second agent's link clicked later in the same browser wins the credit.
5. Old link (no utm_content) → books into "לא משויך".
6. Handoff (הזמנה עבור הלקוח) as manager works; the resulting order carries the manager's utm_content.
7. Existing SOLO partner (e.g. Sagi): everything looks exactly like yesterday — reservations list full, credit/coupons visible.
8. Affiliate portal: unchanged.
9. Superadmin impersonation of an agent-type office → full manager view.
10. After the migration merges + auto-applies on master: `npm run db:types` (beware: a failed gen clobbers `types/database.types.ts` — restore from git if so).
