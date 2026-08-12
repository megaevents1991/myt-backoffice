# User Management Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded admin credential with Supabase-Auth-backed per-person users, four roles (admin/editor/agent/affiliate), role-aware guards + middleware, an admin `/users` management page, and a bootstrap script - on branch `fix/security-hardening`.

**Architecture:** Supabase Auth is the identity provider only (password verify, Google OAuth, admin user CRUD). Sessions remain the existing HMAC-signed `session` cookie with an extended payload `{sub, email, role, partner_code, exp}`. All DB access stays on the service-role client; authorization is app-level guards. Spec: `docs/superpowers/specs/2026-07-14-user-management-design.md`.

**Tech Stack:** Next.js 15 App Router, Supabase (`@supabase/supabase-js` + `@supabase/ssr` - both already installed), shadcn/ui, TypeScript.

## Global Constraints

- **No commits by agents.** Dor reviews and commits via `/commit-push`. Each task ends at a verification step, not a commit. (Overrides the usual per-task commit step.)
- **No test suite exists.** Verification = `npx tsc --noEmit` (the real type gate; build ignores TS errors) + the manual check listed in each task.
- Roles: exactly `'admin' | 'editor' | 'agent' | 'affiliate'`.
- Cookie name stays `session`; max age stays 1 week; HMAC-SHA256 via Web Crypto (Edge-compatible - `lib/auth/session.ts` must not import Node-only or Supabase modules).
- Service-role Supabase client = `import { supabase } from "@/lib/supabase-server"`. Never create clients inline (exception: the two dedicated auth clients created in Tasks 3–4).
- New tables get `ENABLE ROW LEVEL SECURITY` with **no policies** → only the service-role key can touch them.
- Soft-delete/cross-project rules: `partners` table is NOT altered.
- Env vars available: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY`, `NEXT_SECRET_ADMIN_EMAIL`, `NEXT_SECRET_ADMIN_PASSWORD`, optional `NEXT_SECRET_SESSION_SECRET`.
- Migration deploy is manual: GitHub Action "Apply DB Migrations" (workflow_dispatch) runs `supabase db push`. Local dev against prod DB - the migration must be applied (Dor triggers) before Tasks 9–11 can be manually verified.
- Legacy env-credential login stays as a temporary fallback in the login route (marked `TODO(remove-after-bootstrap)`) so nobody is locked out before the first admin users exist.

---

### Task 1: DB migration - `user_profiles`, `audit_log`, `quotes`, storage buckets

**Files:**

- Create: `supabase/migrations/20260714090000_user_management.sql`

**Interfaces:**

- Produces: tables `public.user_profiles`, `public.audit_log`, `public.quotes`; storage buckets `partner-logos` (public), `quotes` (private). Later tasks read/write `user_profiles` via service-role client.

- [ ] **Step 1: Write the migration file**

```sql
-- User management foundation: profiles, audit log, quotes.
-- All three tables are backoffice-only; RLS enabled with NO policies so only
-- the service-role key (used by the backoffice server) can access them.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null check (role in ('admin','editor','agent','affiliate')),
  partner_tracking_code text references public.partners(partner_tracking_code),
  logo_url text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.user_profiles enable row level security;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  changes jsonb,
  metadata jsonb,
  ip text
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  partner_tracking_code text,
  event_id bigint,
  customer_name text,
  title text,
  line_items jsonb not null default '[]'::jsonb,
  currency text not null default 'USD',
  total numeric,
  notes text,
  valid_until date,
  status text not null default 'final',
  pdf_storage_path text
);

create index if not exists quotes_partner_idx on public.quotes (partner_tracking_code);

alter table public.quotes enable row level security;

-- Storage buckets: partner logos are publicly readable (used in rendered quote
-- PDFs and portal header); generated quote PDFs are private (signed URLs only).
insert into storage.buckets (id, name, public)
values ('partner-logos', 'partner-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('quotes', 'quotes', false)
on conflict (id) do nothing;
```

**Note:** if `supabase db push` fails on the `references public.partners(partner_tracking_code)` line (no unique constraint on that column in some environments), drop the `references ...` clause and keep the column plain `text` - the link is app-enforced. The `coupons` table already has such an FK, so the unique constraint should exist.

- [ ] **Step 2: Verify SQL syntax locally (no DB needed)**

Run: `npx tsc --noEmit` (unaffected - sanity) and visually re-read the SQL. If Docker + Supabase CLI local stack available: `supabase db lint`. Otherwise verification happens when Dor triggers the migration workflow.

- [ ] **Step 3: STOP - notify Dor**

Migration file ready. Dor: trigger GitHub Action **Apply DB Migrations** (workflow_dispatch on branch `fix/security-hardening` - or after this lands on master, per current workflow config it checks out default branch; if the Action only runs from master, apply manually with `supabase db push` locally). Tasks 9–11 manual verification needs these tables in the DB.

---

### Task 2: Shared auth types

**Files:**

- Create: `types/auth.types.ts`

**Interfaces:**

- Produces: `Role`, `UserProfile`, `SessionUser` - imported by session, guards, actions, and UI tasks.

- [ ] **Step 1: Write the types file**

```ts
/** Roles for backoffice users. admin/editor = staff; agent/affiliate = partner-linked. */
export const ROLES = ["admin", "editor", "agent", "affiliate"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = ["admin", "editor"];
export const PARTNER_ROLES: Role[] = ["agent", "affiliate"];

/** Row shape of public.user_profiles (hand-typed until `npm run db:types` regen). */
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  partner_tracking_code: string | null;
  logo_url: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

/** The user object exposed to the client (auth context / session route). */
export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  partner_code: string | null;
  display_name?: string | null;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - expect no new errors.

---

### Task 3: Session payload v2 (`lib/auth/session.ts`)

**Files:**

- Modify: `lib/auth/session.ts` (lines 20, 69–106)

**Interfaces:**

- Consumes: `Role` from `types/auth.types` - **import type only** (keeps the module Edge-safe).
- Produces:
  - `type SessionPayload = { sub: string; email: string; role: Role; partner_code: string | null; exp: number }`
  - `createSessionValue(user: { sub: string; email: string; role: Role; partner_code?: string | null }): Promise<string>`
  - `verifySessionValue(value?: string | null): Promise<SessionPayload | null>` - **return type changes from boolean**. Callers updated in Tasks 4, 5.

- [ ] **Step 1: Replace the payload type and the two functions**

Replace line 20:

```ts
import type { Role } from "@/types/auth.types";

export type SessionPayload = {
  sub: string; // auth.users uuid
  email: string;
  role: Role;
  partner_code: string | null; // partners.partner_tracking_code for agent/affiliate
  exp: number; // ms epoch
};
```

Replace `createSessionValue` (lines 68–77):

```ts
/** Build a fresh signed session cookie value for a successful login. */
export async function createSessionValue(user: {
  sub: string;
  email: string;
  role: Role;
  partner_code?: string | null;
}): Promise<string> {
  const payload: SessionPayload = {
    sub: user.sub,
    email: user.email,
    role: user.role,
    partner_code: user.partner_code ?? null,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}
```

Replace `verifySessionValue` (lines 79–106) - same logic, returns the payload:

```ts
/** The verified payload for a well-formed, correctly-signed, unexpired session; else null. */
export async function verifySessionValue(
  value?: string | null,
): Promise<SessionPayload | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!body || !sig) return null;

  let expected: string;
  try {
    expected = await hmac(body);
  } catch {
    return null;
  }
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body)),
    ) as SessionPayload;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (!["admin", "editor", "agent", "affiliate"].includes(payload.role))
      return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp)
      return null;
    return payload;
  } catch {
    return null;
  }
}
```

Also update the file's top doc comment: sessions now carry a real user identity (old `{role:"admin"}` cookies fail the `sub` check → forced re-login, intended).

- [ ] **Step 2: Verify type errors surface the callers**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `lib/auth/guards.ts`, `middleware.ts`, `app/api/auth/login/route.ts`, `app/api/auth/session/route.ts` (boolean→payload and createSessionValue arity). Fixed in Tasks 4–6. Any other file erroring = unexpected caller, investigate.

---

### Task 4: Role-aware guards (`lib/auth/guards.ts`)

**Files:**

- Modify: `lib/auth/guards.ts`
- Modify: `middleware.ts` (Task 5 does middleware; here only guards)

**Interfaces:**

- Consumes: `verifySessionValue` (payload-returning), `SESSION_COOKIE` from `./session`; `Role`, `STAFF_ROLES` from `@/types/auth.types`.
- Produces (used by every action/route task after this):
  - `getSession(): Promise<SessionPayload | null>`
  - `requireRole(...roles: Role[]): Promise<SessionPayload>` - throws `Error("Unauthorized")`
  - `requireStaff(): Promise<SessionPayload>` - admin|editor
  - `requireAdmin(): Promise<SessionPayload>` - admin only (signature: now returns payload; existing `await requireAdmin()` callers still typecheck)
  - `requirePartner(): Promise<SessionPayload & { partner_code: string }>` - agent|affiliate with non-null partner_code
  - `guardAdminRoute(): Promise<NextResponse | null>` - **now = staff check** (admin+editor). Route callers unchanged.
  - `guardCronRoute(request)` - unchanged.

- [ ] **Step 1: Rewrite guards (keep `guardCronRoute` as-is)**

```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionValue,
  type SessionPayload,
} from "./session";
import { STAFF_ROLES, type Role } from "@/types/auth.types";

/** Verified session payload from the request cookie, or null. */
export async function getSession(): Promise<SessionPayload | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE);
  return verifySessionValue(cookie?.value);
}

/** Server-action guard: caller must hold one of the given roles. Returns the actor. */
export async function requireRole(...roles: Role[]): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) {
    throw new Error("Unauthorized");
  }
  return session;
}

/** admin or editor - the default guard for all dashboard mutations. */
export async function requireStaff(): Promise<SessionPayload> {
  return requireRole("admin", "editor");
}

/** admin only - user management. */
export async function requireAdmin(): Promise<SessionPayload> {
  return requireRole("admin");
}

/** agent or affiliate with a linked partner code - portal actions. */
export async function requirePartner(): Promise<
  SessionPayload & { partner_code: string }
> {
  const session = await requireRole("agent", "affiliate");
  if (!session.partner_code) throw new Error("Unauthorized");
  return session as SessionPayload & { partner_code: string };
}

/**
 * Guard for API route handlers used by dashboard staff.
 *   const denied = await guardAdminRoute();
 *   if (denied) return denied;
 */
export async function guardAdminRoute(): Promise<NextResponse | null> {
  const session = await getSession();
  if (session && STAFF_ROLES.includes(session.role)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

(Keep the file header comment, update wording: multi-role now. Delete old `isAdmin` - next step catches stray callers.)

- [ ] **Step 2: Find stray `isAdmin` callers**

Run: `grep -rn "isAdmin" --include="*.ts*" app lib components contexts middleware.ts`
Expected: no hits outside `lib/auth/guards.ts` history. If any → replace with `getSession()` truthiness.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `middleware.ts` + the three `app/api/auth/*` routes.

---

### Task 5: Middleware role map

**Files:**

- Modify: `middleware.ts`

**Interfaces:**

- Consumes: `verifySessionValue` payload.
- Produces: route protection - `/users` admin-only; `/portal/*` all roles (partner home); all other dashboard pages staff-only; partners redirected to `/portal`.

- [ ] **Step 1: Rewrite middleware body**

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";

const PARTNER_ROLES = ["agent", "affiliate"];

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Skip static files, API routes and images. API routes and server actions
  // enforce their own auth via guards.
  if (
    pathname.startsWith("/_next/") ||
    pathname.includes(".") ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  const session = await verifySessionValue(
    req.cookies.get(SESSION_COOKIE)?.value,
  );
  const isAuthPage = pathname.startsWith("/auth");
  const home =
    session && PARTNER_ROLES.includes(session.role) ? "/portal" : "/dashboard";

  // Signed-in user hitting an auth page → send to their home.
  if (session && isAuthPage) {
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Unauthenticated user hitting a protected page → login.
  if (!session && !isAuthPage && pathname !== "/") {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (session) {
    const isPortal = pathname === "/portal" || pathname.startsWith("/portal/");
    const isUsersAdmin =
      pathname === "/users" || pathname.startsWith("/users/");

    // Partner roles may ONLY use /portal (staff may also enter /portal to debug).
    if (PARTNER_ROLES.includes(session.role) && !isPortal && pathname !== "/") {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    // /users is admin-only.
    if (isUsersAdmin && session.role !== "admin") {
      return NextResponse.redirect(new URL(home, req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: errors only left in `app/api/auth/*` routes (fixed next).

---

### Task 6: Login / session / logout routes + Supabase auth client

**Files:**

- Create: `lib/auth/supabase-auth.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/session/route.ts`
- Delete: `lib/actions/auth-actions.ts` (dead code, zero importers - verified)
- (No change: `app/api/auth/logout/route.ts` - cookie clear still valid)

**Interfaces:**

- Consumes: `createSessionValue(user)`, `verifySessionValue`, `UserProfile`.
- Produces:
  - `verifyPassword(email, password): Promise<{ userId: string } | null>` (anon-key client, server-only)
  - `getProfile(userId): Promise<UserProfile | null>` (service-role)
  - `getProfileByEmail(email): Promise<UserProfile | null>` (service-role; for OAuth callback + legacy fallback)
  - `POST /api/auth/login` body `{email, password}` → sets cookie, returns `{success, user: SessionUser}`
  - `GET /api/auth/session` → `{ user: SessionUser | null }`

- [ ] **Step 1: Write `lib/auth/supabase-auth.ts`**

```ts
/**
 * Supabase Auth integration (server-only). Supabase is the IDENTITY provider -
 * password verification, Google OAuth, admin user CRUD. Sessions stay our own
 * HMAC cookie (lib/auth/session.ts); Supabase sessions are never persisted.
 */
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-server";
import type { UserProfile } from "@/types/auth.types";

/** Verify email+password against Supabase Auth. Returns the auth user id, or null. */
export async function verifyPassword(
  email: string,
  password: string,
): Promise<{ userId: string } | null> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) return null;
  // We never use the Supabase session - sign it out server-side immediately.
  await anon.auth.signOut().catch(() => {});
  return { userId: data.user.id };
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("getProfile:", JSON.stringify(error));
    return null;
  }
  return (data as UserProfile) ?? null;
}

export async function getProfileByEmail(
  email: string,
): Promise<UserProfile | null> {
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(
      "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by",
    )
    .ilike("email", email)
    .maybeSingle();
  if (error) {
    console.error("getProfileByEmail:", JSON.stringify(error));
    return null;
  }
  return (data as UserProfile) ?? null;
}
```

(`(supabase as any)` because `user_profiles` isn't in the generated `types/database.types.ts` yet - same pattern the repo used for `coupons`. After the migration is applied, `npm run db:types` regenerates and the casts can go.)

- [ ] **Step 2: Rewrite `app/api/auth/login/route.ts`**

```ts
import { NextResponse } from "next/server";
import {
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";
import {
  verifyPassword,
  getProfile,
  getProfileByEmail,
} from "@/lib/auth/supabase-auth";
import type { UserProfile } from "@/types/auth.types";

async function respondWithSession(profile: UserProfile) {
  const response = NextResponse.json({
    success: true,
    user: {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      partner_code: profile.partner_tracking_code,
      display_name: profile.display_name,
    },
  });
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionValue({
      sub: profile.id,
      email: profile.email,
      role: profile.role,
      partner_code: profile.partner_tracking_code,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    },
  );
  return response;
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // Supabase Auth path - real users created by an admin.
    const verified = await verifyPassword(email, password);
    if (verified) {
      const profile = await getProfile(verified.userId);
      if (profile && profile.is_active) {
        return respondWithSession(profile);
      }
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // TODO(remove-after-bootstrap): legacy env-credential fallback so the
    // dashboard stays accessible until the first admin users exist in prod.
    if (
      process.env.NEXT_SECRET_ADMIN_EMAIL &&
      email === process.env.NEXT_SECRET_ADMIN_EMAIL &&
      password === process.env.NEXT_SECRET_ADMIN_PASSWORD
    ) {
      const profile = await getProfileByEmail(email);
      if (profile && profile.is_active) return respondWithSession(profile);
      // No profile row yet (pre-migration): mint an admin session with a
      // placeholder sub so the dashboard keeps working.
      return respondWithSession({
        id: "00000000-0000-0000-0000-000000000000",
        email,
        display_name: "Legacy Admin",
        role: "admin",
        partner_tracking_code: null,
        logo_url: null,
        phone: null,
        is_active: true,
        created_at: new Date().toISOString(),
        created_by: null,
      });
    }

    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Rewrite `app/api/auth/session/route.ts`**

```ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const sessionCookie = cookieHeader
      .split(";")
      .find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`))
      ?.split("=")
      .slice(1)
      .join("=");

    const payload = await verifySessionValue(sessionCookie);
    if (payload) {
      return NextResponse.json({
        user: {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          partner_code: payload.partner_code,
        },
      });
    }
    return NextResponse.json({ user: null });
  } catch (error) {
    console.error("Session check error:", error);
    return NextResponse.json(
      { error: "Failed to check session" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Delete `lib/actions/auth-actions.ts`**

Run: `grep -rn "auth-actions" --include="*.ts*" app lib components contexts` → expected: no hits. Then delete the file.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide.

Manual check: `npm run dev` → login with legacy env credentials still works → lands on `/dashboard`. Old cookie from before this change → redirected to login (payload lacks `sub`).

---

### Task 7: Google SSO (OAuth initiate + callback)

**Files:**

- Create: `app/api/auth/google/route.ts`
- Create: `app/api/auth/callback/route.ts`
- Modify: `app/auth/login/page.tsx` (add Google button + error display)

**Interfaces:**

- Consumes: `getProfileByEmail`, `createSessionValue`, `SESSION_COOKIE`, `SESSION_MAX_AGE`.
- Produces: `GET /api/auth/google` → 307 to Google; `GET /api/auth/callback?code=...` → sets session cookie, redirects to `/dashboard` or `/portal`; on unknown email redirects to `/auth/login?error=no-account`.

Uses `@supabase/ssr` `createServerClient` ONLY inside these two routes (PKCE code-verifier cookie handling). The Supabase cookies it sets are temporary and cleared in the callback.

- [ ] **Step 1: Write `app/api/auth/google/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const response = {
    cookies: [] as { name: string; value: string; options: object }[],
  };

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) =>
            response.cookies.push({ name, value, options }),
          );
        },
      },
    },
  );

  const origin = new URL(request.url).origin;
  const { data, error } = await supabaseAuth.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/api/auth/callback` },
  });

  if (error || !data.url) {
    console.error("Google OAuth init error:", error);
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth", request.url),
    );
  }

  const redirect = NextResponse.redirect(data.url);
  // Persist the PKCE code-verifier cookies Supabase generated.
  response.cookies.forEach(({ name, value, options }) =>
    redirect.cookies.set(
      name,
      value,
      options as Parameters<typeof redirect.cookies.set>[2],
    ),
  );
  return redirect;
}
```

- [ ] **Step 2: Write `app/api/auth/callback/route.ts`**

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  createSessionValue,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";
import { getProfileByEmail } from "@/lib/auth/supabase-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth", request.url),
    );
  }

  try {
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {}, // we do not keep the Supabase session
        },
      },
    );

    const { data, error } =
      await supabaseAuth.auth.exchangeCodeForSession(code);
    if (error || !data.user?.email) {
      console.error("OAuth exchange error:", error);
      return NextResponse.redirect(
        new URL("/auth/login?error=oauth", request.url),
      );
    }

    // Only pre-created users may enter - no self-signup via Google.
    const profile = await getProfileByEmail(data.user.email);
    if (!profile || !profile.is_active) {
      return NextResponse.redirect(
        new URL("/auth/login?error=no-account", request.url),
      );
    }

    const home = ["agent", "affiliate"].includes(profile.role)
      ? "/portal"
      : "/dashboard";
    const redirect = NextResponse.redirect(new URL(home, request.url));
    redirect.cookies.set(
      SESSION_COOKIE,
      await createSessionValue({
        sub: profile.id,
        email: profile.email,
        role: profile.role,
        partner_code: profile.partner_tracking_code,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      },
    );
    // Clear the temporary Supabase PKCE cookies.
    cookieStore.getAll().forEach(({ name }) => {
      if (name.startsWith("sb-")) redirect.cookies.delete(name);
    });
    return redirect;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/auth/login?error=oauth", request.url),
    );
  }
}
```

- [ ] **Step 3: Add Google button + error messages to `app/auth/login/page.tsx`**

Inside the form card, after the submit button:

```tsx
<div className="relative my-4">
  <div className="absolute inset-0 flex items-center">
    <span className="w-full border-t" />
  </div>
  <div className="relative flex justify-center text-xs uppercase">
    <span className="bg-background px-2 text-muted-foreground">or</span>
  </div>
</div>
<Button
  type="button"
  variant="outline"
  className="w-full"
  onClick={() => (window.location.href = "/api/auth/google")}
>
  Continue with Google
</Button>
```

And read the error query param (page is already a client component):

```tsx
// with the other imports
import { useSearchParams } from "next/navigation";

// inside the component
const searchParams = useSearchParams();
const urlError = searchParams.get("error");
```

Render above the form:

```tsx
{
  urlError === "no-account" && (
    <p className="text-sm text-destructive">
      No account for this Google email - contact an admin.
    </p>
  );
}
{
  urlError === "oauth" && (
    <p className="text-sm text-destructive">
      Google sign-in failed. Try again.
    </p>
  );
}
```

**Note:** `useSearchParams` in a client page requires a `<Suspense>` boundary in Next 15 builds. Wrap the page: export a default component that renders `<Suspense><LoginForm /></Suspense>` where `LoginForm` is the existing component body renamed.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` - zero errors.
Manual (needs Dor's manual step done - Google provider enabled in Supabase): click "Continue with Google" → Google → back → `/dashboard` (known email) or `no-account` error (unknown email). Until the provider is enabled, verify the button redirects and Supabase returns an error → lands on `/auth/login?error=oauth`.

---

### Task 8: Auth context returns real user (role available to UI)

**Files:**

- Modify: `contexts/auth-context.tsx`

**Interfaces:**

- Consumes: `GET /api/auth/session` shape from Task 6.
- Produces: `useAuth().user: SessionUser | null` - `role` and `partner_code` now real. Sidebar (Task 11) reads `user.role`.

- [ ] **Step 1: Update the `User` type and strip debug logging**

Replace the local `User` type (lines 7–11):

```tsx
import type { SessionUser } from "@/types/auth.types";

type User = SessionUser;
```

Remove all `console.log`/`console.error` debug lines in `checkSession` and `login` (keep `console.error` in `logout`'s catch). No logic changes - endpoints are the same.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - zero errors. Manual: login → user menu still renders email.

---

### Task 9: Guard sweep - `requireAdmin()` → `requireStaff()` + coupon gap

**Files:**

- Modify (14 files): `lib/actions/artist-actions.ts`, `blog-actions.ts`, `category-actions.ts`, `dashboard-actions.ts`, `event-actions.ts`, `football-actions.ts`, `location-actions.ts`, `map-actions.ts`, `offline-flight-actions.ts`, `offline-hotel-actions.ts`, `offline-hotel-room-actions.ts`, `partner-actions.ts`, `reservation-actions.ts`, `storage-actions.ts`
- Modify: `lib/actions/coupon-actions.ts` (add missing guards)
- Modify: `lib/actions/template-crud.ts` if it calls `requireAdmin` (check)

**Interfaces:**

- Consumes: `requireStaff` from `@/lib/auth/guards`.
- Produces: every dashboard mutation requires admin|editor. `requireAdmin` remains ONLY in future `user-actions.ts` (Task 10).

- [ ] **Step 1: Mechanical replace in the 14 files**

In each file: change import `requireAdmin` → `requireStaff` and every call `await requireAdmin()` → `await requireStaff()`.

Run to find them all: `grep -rn "requireAdmin" lib/actions app/api --include="*.ts"`
Every hit in `lib/actions/*` gets replaced. Hits in `app/api/*` calling `guardAdminRoute()` need **no change** (that guard is now staff-level, Task 4).

- [ ] **Step 2: Add guards to coupon actions**

In `lib/actions/coupon-actions.ts`: add `import { requireStaff } from "@/lib/auth/guards";` and `await requireStaff();` as the first line of every exported mutating/data function (`getCoupons`, `createCoupon`, `updateCoupon`, `deleteCoupon`, and any toggle/bulk functions present - add to ALL exported async functions in the file).

- [ ] **Step 3: Verify nothing still imports requireAdmin outside user management**

Run: `grep -rn "requireAdmin" lib app --include="*.ts"`
Expected hits: only `lib/auth/guards.ts` (definition). Then: `npx tsc --noEmit` - zero errors.

---

### Task 10: User management server actions (`lib/actions/user-actions.ts`)

**Files:**

- Create: `lib/actions/user-actions.ts`

**Interfaces:**

- Consumes: `requireAdmin` (returns actor payload), `supabase` service client, `UserProfile`, `Role`.
- Produces (consumed by Task 11 UI):
  - `listUsers(): Promise<UserProfile[]>`
  - `createUser(input: { email; password; display_name; role; partner_tracking_code?; phone? }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `updateUser(id: string, input: { display_name?; role?; partner_tracking_code?; phone?; is_active? }): Promise<{ ok: true } | { ok: false; error: string }>`
  - `resetUserPassword(id: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the file**

```ts
"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import type { Role, UserProfile } from "@/types/auth.types";
import { PARTNER_ROLES } from "@/types/auth.types";

type Result = { ok: true } | { ok: false; error: string };

const PROFILE_COLUMNS =
  "id,email,display_name,role,partner_tracking_code,logo_url,phone,is_active,created_at,created_by";

export async function listUsers(): Promise<UserProfile[]> {
  await requireAdmin();
  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .select(PROFILE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listUsers:", JSON.stringify(error));
    return [];
  }
  return (data as UserProfile[]) ?? [];
}

export async function createUser(input: {
  email: string;
  password: string;
  display_name: string;
  role: Role;
  partner_tracking_code?: string | null;
  phone?: string | null;
}): Promise<Result> {
  const actor = await requireAdmin();

  const email = input.email?.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return {
      ok: false,
      error: "Email and a password of 8+ characters are required",
    };
  }
  if (PARTNER_ROLES.includes(input.role) && !input.partner_tracking_code) {
    return { ok: false, error: "Agent/affiliate users need a partner link" };
  }

  const { data: created, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    });
  if (authError || !created.user) {
    console.error("createUser auth:", JSON.stringify(authError));
    return {
      ok: false,
      error: authError?.message ?? "Auth user creation failed",
    };
  }

  const { error: profileError } = await (supabase as any)
    .from("user_profiles")
    .insert({
      id: created.user.id,
      email,
      display_name: input.display_name || null,
      role: input.role,
      partner_tracking_code: input.partner_tracking_code || null,
      phone: input.phone || null,
      is_active: true,
      created_by: actor.sub,
    });
  if (profileError) {
    console.error("createUser profile:", JSON.stringify(profileError));
    // Roll back the orphan auth user so the email isn't locked.
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: "Profile creation failed" };
  }
  return { ok: true };
}

export async function updateUser(
  id: string,
  input: {
    display_name?: string | null;
    role?: Role;
    partner_tracking_code?: string | null;
    phone?: string | null;
    is_active?: boolean;
  },
): Promise<Result> {
  const actor = await requireAdmin();
  if (id === actor.sub && input.is_active === false) {
    return { ok: false, error: "You cannot disable your own account" };
  }
  if (id === actor.sub && input.role && input.role !== "admin") {
    return { ok: false, error: "You cannot demote your own account" };
  }

  // Map columns explicitly - never spread client input.
  const update: Record<string, unknown> = {};
  if (input.display_name !== undefined)
    update.display_name = input.display_name;
  if (input.role !== undefined) update.role = input.role;
  if (input.partner_tracking_code !== undefined)
    update.partner_tracking_code = input.partner_tracking_code;
  if (input.phone !== undefined) update.phone = input.phone;
  if (input.is_active !== undefined) update.is_active = input.is_active;

  const { error } = await (supabase as any)
    .from("user_profiles")
    .update(update)
    .eq("id", id);
  if (error) {
    console.error("updateUser:", JSON.stringify(error));
    return { ok: false, error: "Update failed" };
  }
  return { ok: true };
}

export async function resetUserPassword(
  id: string,
  newPassword: string,
): Promise<Result> {
  await requireAdmin();
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "Password must be 8+ characters" };
  }
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    console.error("resetUserPassword:", JSON.stringify(error));
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` - zero errors. (Manual verification of these actions happens through the UI in Task 11, after the migration is applied.)

---

### Task 11: `/users` admin page + sidebar links

**Files:**

- Create: `app/(dashboard)/users/page.tsx` (server component)
- Create: `app/(dashboard)/users/users-client.tsx` (client component: table + dialogs)
- Modify: `components/sidebar.tsx` (add Users link, admin-only; hide sidebar entries by role if the sidebar already maps items - follow its existing item-list pattern)

**Interfaces:**

- Consumes: `listUsers`, `createUser`, `updateUser`, `resetUserPassword` from Task 10; `getPartners` from `lib/actions/partner-actions.ts` (existing) for the partner select; `useAuth().user.role` (Task 8) for sidebar visibility.
- Produces: admin UI at `/users`.

- [ ] **Step 1: Server page**

```tsx
import { listUsers } from "@/lib/actions/user-actions";
import { getPartners } from "@/lib/actions/partner-actions";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const [users, partners] = await Promise.all([listUsers(), getPartners()]);
  // Filter out per-customer refund placeholder partners from the link dropdown.
  const realPartners = (partners ?? []).filter(
    (p: { name_hebrew?: string | null }) =>
      p.name_hebrew !== "החזר ללקוח ניתן להתעלם",
  );
  return <UsersClient users={users} partners={realPartners} />;
}
```

(Check `getPartners()` return shape when implementing; adapt the filter to the actual placeholder-detection used in `coupon-actions.ts:87-96` - reuse the same condition.)

- [ ] **Step 2: Client component**

`users-client.tsx` - shadcn `Table` listing: email, display name, role (Badge), partner code, active (Switch → `updateUser(id,{is_active})`), created. Header button "Add user" opens a `Dialog` with fields: email (`Input`), temp password (`Input type=password`), display name, role (`Select` over the 4 roles), partner (`Select` from `partners`, shown only when role is agent/affiliate), phone. Submit → `createUser(...)` → `router.refresh()` + toast on error. Row menu (`DropdownMenu`): "Edit" (same dialog prefilled → `updateUser`), "Reset password" (small dialog, one password field → `resetUserPassword`). Use `useState` for dialogs, `useTransition` for pending state. All shadcn primitives from `components/ui/` - no new UI libs. Follow the table/dialog style used in `app/(dashboard)/partners/` for consistency.

(Full JSX left to the implementer BUT: every mutation call, field list, and visibility rule above is exact. No other features - no delete button; disabling is the only deactivation path.)

- [ ] **Step 3: Sidebar link**

In `components/sidebar.tsx`, find the nav-items structure and add a `Users` item (lucide `Users` icon, href `/users`). Visibility: the sidebar is a client component using `useAuth()` - render the item only when `user?.role === "admin"`. If the sidebar is currently static, wrap the items list in a role filter:

```tsx
const { user } = useAuth();
const visibleItems = items.filter(
  (item) => item.href !== "/users" || user?.role === "admin",
);
```

- [ ] **Step 4: Verify (requires migration applied + bootstrap or manual profile row)**

Run: `npx tsc --noEmit` - zero errors.
Manual: login as admin → `/users` → create an `editor` user → logout → login as editor → `/users` redirects away (middleware) + sidebar hides the link → editor can still open `/events` and save an edit (guard sweep works).

---

### Task 12: Bootstrap script for first admins

**Files:**

- Create: `scripts/bootstrap-admins.mjs`

**Interfaces:**

- Consumes: `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY`).
- Produces: auth users + admin `user_profiles` rows for Dor + Alon.

- [ ] **Step 1: Write the script (plain Node, no new deps)**

```js
// Usage: node scripts/bootstrap-admins.mjs <email> <password> [display_name]
// Reads .env.local for Supabase URL + service-role key. Run once per admin.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);

const [email, password, displayName] = process.argv.slice(2);
if (!email || !password) {
  console.error(
    "Usage: node scripts/bootstrap-admins.mjs <email> <password> [display_name]",
  );
  process.exit(1);
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: created, error: authError } =
  await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
if (authError) {
  console.error("Auth user creation failed:", authError.message);
  process.exit(1);
}

const { error: profileError } = await supabase.from("user_profiles").insert({
  id: created.user.id,
  email: email.toLowerCase(),
  display_name: displayName ?? null,
  role: "admin",
  is_active: true,
});
if (profileError) {
  console.error("Profile insert failed:", JSON.stringify(profileError));
  await supabase.auth.admin.deleteUser(created.user.id);
  process.exit(1);
}

console.log(`Admin created: ${email} (${created.user.id})`);
```

- [ ] **Step 2: Verify**

After the migration is applied, Dor runs it once per admin:
`node scripts/bootstrap-admins.mjs shiz20shiz@gmail.com <strong-password> "Dor"`
`node scripts/bootstrap-admins.mjs <alon-email> <strong-password> "Alon"`
Expected output: `Admin created: ... (uuid)`. Then login via the login page with those credentials (Supabase path, not legacy fallback).

---

## Phase 1 acceptance checklist

- [ ] `npx tsc --noEmit` - zero errors
- [ ] Legacy env login works pre-migration; Supabase login works post-bootstrap
- [ ] Old (pre-change) session cookies rejected → re-login forced
- [ ] Editor: full dashboard, blocked from `/users` (middleware + hidden sidebar + `requireAdmin` in actions)
- [ ] Agent/affiliate user: any dashboard URL redirects to `/portal` (404 page until Phase 3 - expected; middleware rule verified)
- [ ] Google SSO: known email → in; unknown email → `no-account` error
- [ ] Coupon actions now guarded
- [ ] Dor manual steps done: Google provider configured, `NEXT_SECRET_SESSION_SECRET` set in Vercel, migration applied, bootstrap run
- [ ] Follow-up (post-verification): remove legacy env fallback from login route + delete `NEXT_SECRET_ADMIN_EMAIL/PASSWORD` from Vercel; run `npm run db:types` to regenerate `types/database.types.ts` and drop the `(supabase as any)` casts

## Phases 2–4

Separate plans, written after Phase 1 review:

- Phase 2: `lib/audit.ts` + wiring into all mutations/auth events + `/audit-log` UI
- Phase 3: `app/portal/` layout, dashboard, coupons, reservations (uses `requirePartner()` from Task 4)
- Phase 4: quotes form + Hebrew RTL PDF via existing `@sparticuz/chromium` infra + `quotes` bucket
