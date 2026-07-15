# User Management Phase 2 (Audit Log) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every mutation and auth event in the backoffice writes a row to `audit_log` (who / when / what / before→after), viewable at `/audit-log` (staff).

**Architecture:** `lib/audit.ts` exposes `logAudit()` (fire-and-forget insert via service client — audit failure NEVER fails the mutation), `diffChanges()` (changed-fields diff), and `fetchBefore()` (cheap pre-update snapshot limited to the columns being changed). Actions call `logAudit` after a successful mutation. Auth routes log with explicit actor override (no session yet on login). Spec: `docs/superpowers/specs/2026-07-14-user-management-design.md`. The `audit_log` table + indexes already exist (Phase 1 migration).

**Tech Stack:** Next.js 15, service-role Supabase client, shadcn/ui.

## Global Constraints

- **No commits by agents** — Dor commits via `/commit-push`.
- **No test suite.** Verification = `npx tsc --noEmit` — 32 pre-existing baseline errors, ZERO new.
- `logAudit` must be fire-and-forget: wrapped so any thrown error / rejected promise is caught and `console.error`'d — a mutation must succeed even if audit insert fails. Never `await`-block the mutation response on audit (await is fine — it's one insert — but errors must be swallowed with logging).
- Audit rows are written ONLY via the service client (`@/lib/supabase-server`); `(supabase as any)` cast allowed (table not in generated types yet).
- `logAudit` reads the actor from `getSession()` unless an explicit `actor` override is passed (login/logout routes).
- Roles: superadmin/admin/editor/agent/affiliate. `/audit-log` page is STAFF (superadmin+admin+editor) — no extra middleware rule needed (staff default covers it).
- Action naming (exact strings): `create | update | delete | login | login_failed | logout | user_created | user_updated | user_disabled | password_reset | sync_triggered | quote_created | pdf_generated`.
- Entity types (exact): `event, coupon, partner, reservation, location, offline_flight, offline_hotel, offline_hotel_room, storage, user, creative, quote` + template tables by name (`artists, blog_posts, categories, football_teams`) + sync providers (`live, p1, sports, tixstock`).
- Soft-delete actions log `action: "delete"` (they ARE deletes from the business view); `changes` carries `{ is_deleted: { from: null, to: "<date>" } }` or the payload.

---

### Task 1: `lib/audit.ts` + auth-event wiring

**Files:**
- Create: `lib/audit.ts`
- Modify: `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/api/auth/callback/route.ts`

**Interfaces (produced — later tasks consume verbatim):**
```ts
export type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  changes?: unknown;          // JSON-serializable
  metadata?: Record<string, unknown>;
  actor?: { id?: string | null; email?: string | null; role?: string | null }; // override (auth routes)
  ip?: string | null;
};
export async function logAudit(input: AuditInput): Promise<void>
export function diffChanges(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }>
export async function fetchBefore(table: string, idColumn: string, idValue: string | number, payload: Record<string, unknown>): Promise<Record<string, unknown> | null>
export function requestIp(request: Request): string | null
```

- [ ] **Step 1: Write `lib/audit.ts`**

```ts
/**
 * Audit trail. Fire-and-forget: logAudit NEVER throws and never fails the
 * calling mutation — failures are console.error'd only. Rows go to
 * public.audit_log (RLS-locked, service-role only).
 */
import { supabase } from "@/lib/supabase-server";
import { getSession } from "@/lib/auth/guards";

export type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  changes?: unknown;
  metadata?: Record<string, unknown>;
  actor?: { id?: string | null; email?: string | null; role?: string | null };
  ip?: string | null;
};

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    let actor = input.actor;
    if (!actor) {
      const session = await getSession().catch(() => null);
      actor = session
        ? { id: session.sub, email: session.email, role: session.role }
        : { id: null, email: null, role: null };
    }
    const { error } = await (supabase as any).from("audit_log").insert({
      actor_id: actor.id ?? null,
      actor_email: actor.email ?? null,
      actor_role: actor.role ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId == null ? null : String(input.entityId),
      changes: input.changes ?? null,
      metadata: input.metadata ?? null,
      ip: input.ip ?? null,
    });
    if (error) console.error("logAudit insert failed:", JSON.stringify(error));
  } catch (e) {
    console.error("logAudit failed:", e);
  }
}

/** Changed-fields diff: only keys present in `after` that differ from `before`. */
export function diffChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before ? before[key] : undefined;
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      diff[key] = { from: from === undefined ? null : from, to: to === undefined ? null : to };
    }
  }
  return diff;
}

/** Pre-update snapshot limited to the columns being changed (cheap select). */
export async function fetchBefore(
  table: string,
  idColumn: string,
  idValue: string | number,
  payload: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const columns = Object.keys(payload);
    if (columns.length === 0) return null;
    const { data, error } = await (supabase as any)
      .from(table)
      .select(columns.join(","))
      .eq(idColumn, idValue)
      .maybeSingle();
    if (error) {
      console.error("fetchBefore failed:", JSON.stringify(error));
      return null;
    }
    return (data as Record<string, unknown>) ?? null;
  } catch (e) {
    console.error("fetchBefore failed:", e);
    return null;
  }
}

/** Client IP from proxy headers (Vercel). */
export function requestIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}
```

- [ ] **Step 2: Wire auth routes**

`app/api/auth/login/route.ts` — POST handler:
- Success (both Supabase path and legacy path, in `respondWithSession` callers): after determining `profile`, before returning, call
  `await logAudit({ action: "login", entityType: "user", entityId: profile.id, actor: { id: profile.id, email: profile.email, role: profile.role }, ip: requestIp(request) });`
  (For the legacy placeholder profile this logs the placeholder id — fine.) NOTE: `respondWithSession` doesn't see the request; log at the call sites, or change `respondWithSession(profile, request)` — implementer's choice, keep it simple.
- Failure paths (invalid credentials — Supabase verify failed AND legacy mismatch; also inactive-profile 401s): before returning 401, call
  `await logAudit({ action: "login_failed", actor: { email: typeof email === "string" ? email : null }, ip: requestIp(request), metadata: { reason: "invalid_credentials" } });`
  Use ONE call at the final 401 and one at each early inactive-profile 401. Do NOT differentiate reasons in the response body (stays generic).

`app/api/auth/logout/route.ts` — before clearing the cookie: read session via `verifySessionValue` on the cookie header (import from `@/lib/auth/session`; the route has `request` — parse cookie header same pattern as session route) OR simpler: `const session = await getSession()` won't work in route without cookies() — it does work (`cookies()` is available in route handlers). Use `getSession()` from guards. If session exists: `await logAudit({ action: "logout", actor: { id: session.sub, email: session.email, role: session.role } });`

`app/api/auth/callback/route.ts` — Google:
- Success: after profile found active, `await logAudit({ action: "login", entityType: "user", entityId: profile.id, actor: { id: profile.id, email: profile.email, role: profile.role }, ip: requestIp(request), metadata: { provider: "google" } });`
- no-account rejection: `await logAudit({ action: "login_failed", actor: { email: data.user.email }, ip: requestIp(request), metadata: { provider: "google", reason: "no_account" } });`

- [ ] **Step 3: Verify** — `npx tsc --noEmit` → 32 baseline, zero new.

---

### Task 2: Wire user-actions + template-crud + creative

**Files:** `lib/actions/user-actions.ts`, `lib/actions/template-crud.ts`, `lib/actions/creative-actions.ts`

- [ ] `user-actions.ts`:
  - `createUser` success → `await logAudit({ action: "user_created", entityType: "user", entityId: created.user.id, changes: { email, role: input.role, partner_tracking_code: input.partner_tracking_code || null, display_name: input.display_name || null } });`
  - `updateUser` success → action is `input.is_active === false ? "user_disabled" : "user_updated"`; before the `.update`, `const before = await fetchBefore("user_profiles", "id", id, update);` after success → `changes: diffChanges(before, update)`, entityId: id.
  - `resetUserPassword` success → `await logAudit({ action: "password_reset", entityType: "user", entityId: id });` (never log the password).
- [ ] `template-crud.ts` (choke point — covers artists/blog_posts/categories/football_teams wrappers): in `createRow` success → `logAudit({ action: "create", entityType: table, entityId: <returned id if available>, changes: <inserted payload> })`; `updateRow` → fetchBefore(table, idColumn, id, payload) + diffChanges; `softDeleteRow` → action "delete". Use whatever generic params the file already has (read it; it's a generic factory — table name and id column are in scope).
- [ ] `creative-actions.ts`: `generateCreative` success → `logAudit({ action: "create", entityType: "creative", entityId: <eventId if in scope>, metadata: { kind/size if in scope } })` — match actual variable names in the file, keep minimal.
- [ ] Verify: tsc 32 baseline, zero new.

---

### Task 3: Wire events / coupons / partners

**Files:** `lib/actions/event-actions.ts`, `lib/actions/coupon-actions.ts`, `lib/actions/partner-actions.ts`

Pattern per function (after successful mutation, before return):
- create* → `logAudit({ action: "create", entityType, entityId, changes: payload })`
- update* → `const before = await fetchBefore(table, idCol, id, payload)` BEFORE the update; after success `logAudit({ action: "update", entityType, entityId: id, changes: diffChanges(before, payload) })`
- delete/softDelete → `logAudit({ action: "delete", entityType, entityId: id })` (+ changes for soft-delete date if handy)
- bulk* → ONE audit row per bulk call: `entityId: null, metadata: { ids: [...], count }` — NOT one row per item.
- duplicate* → action "create", metadata: { duplicated_from: originalId }.

Functions to wire (exact list):
- event-actions: createEvent, updateEvent, softDeleteEvent, bulkSoftDeleteEvents, duplicateEvent, bulkUpdateEvents, bulkDuplicateEvents, syncEventPrices (action "sync_triggered", entityType "event", entityId eventId)
- coupon-actions: createCoupon, updateCoupon, toggleCouponActive (action "update", changes {is_active:{from,to}}), deleteCoupon
- partner-actions: createPartner, updatePartner (fetchBefore on "partners"/"partner_tracking_code"), deletePartner, bulkDeletePartners, duplicatePartner, bulkDuplicatePartners
Entity types: "event", "coupon", "partner". Never log `partners.password` values — if the update payload contains `password`, replace its diff value with `"***"` before logging.
- [ ] Verify: tsc 32 baseline, zero new.

---

### Task 4: Wire offline inventory / reservations / locations / storage / sync triggers

**Files:** `lib/actions/offline-flight-actions.ts`, `lib/actions/offline-hotel-actions.ts`, `lib/actions/offline-hotel-room-actions.ts`, `lib/actions/reservation-actions.ts`, `lib/actions/location-actions.ts`, `lib/actions/storage-actions.ts`, `lib/actions/live-events-actions.ts`, `lib/actions/p1-events-actions.ts`, `lib/actions/sports-events-actions.ts`, `lib/actions/tixstock-actions.ts`

Same pattern as Task 3. Lists:
- offline-flight: createOfflineFlight, updateOfflineFlight (fetchBefore), softDeleteOfflineFlight, restoreOfflineFlight (action "update", metadata {restored:true}), removeEventFromFlight / addEventToFlight (action "update", metadata {event_id})  — entityType "offline_flight"
- offline-hotel: createOfflineHotel, updateOfflineHotel (fetchBefore), softDeleteOfflineHotel, removeEventFromHotel / addEventToHotel / addFlightToHotel (action "update", metadata) — entityType "offline_hotel"
- offline-hotel-room: replaceOfflineHotelRooms (one row, metadata {hotel_id, room_count}), updateOfflineHotelRoom (fetchBefore), deleteOfflineHotelRoom — entityType "offline_hotel_room"; skip recomputeHotelMirror (internal recompute, not a user edit)
- reservations: createReservation, updateReservation (fetchBefore), updateReservationsStatus (one row, metadata {ids, status}), cancelReservation — entityType "reservation"; skip reconcile* (internal)
- locations: createLocation, updateLocation (fetchBefore), deleteLocation — entityType "location"
- storage: deleteBucket, deleteFile, createFolder, uploadFile, uploadImageFromUrl, createBucket — entityType "storage", entityId = path/bucket, action create/delete/update as fits; skip createSignedUrl (read)
- sync triggers: triggerLiveSync → {action:"sync_triggered", entityType:"live"}; triggerP1Sync → "p1"; triggerSync (sports) → "sports"; cleanupPastEvents → {action:"delete", entityType:"sports", metadata:{cleanup:true}}; triggerTixStockSync → "tixstock"
- [ ] Verify: tsc 32 baseline, zero new.

---

### Task 5: `/audit-log` page + audit read action + sidebar

**Files:**
- Create: `lib/actions/audit-actions.ts`, `app/(dashboard)/audit-log/page.tsx`, `app/(dashboard)/audit-log/audit-client.tsx`
- Modify: `components/sidebar.tsx` (add "Audit Log" item, icon `ScrollText`, href `/audit-log`, near Users; visible to staff — NO extra role filter needed beyond the existing /users one)

- [ ] `audit-actions.ts`:
```ts
"use server";
import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

export interface AuditRow {
  id: number; created_at: string;
  actor_id: string | null; actor_email: string | null; actor_role: string | null;
  action: string; entity_type: string | null; entity_id: string | null;
  changes: unknown; metadata: unknown; ip: string | null;
}

export async function getAuditLogs(filters: {
  actorEmail?: string; action?: string; entityType?: string;
  from?: string; to?: string; limit?: number;
}): Promise<AuditRow[]> {
  await requireStaff();
  let q = (supabase as any)
    .from("audit_log")
    .select("id,created_at,actor_id,actor_email,actor_role,action,entity_type,entity_id,changes,metadata,ip")
    .order("created_at", { ascending: false })
    .limit(Math.min(filters.limit ?? 200, 500));
  if (filters.actorEmail) q = q.ilike("actor_email", `%${filters.actorEmail}%`);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.entityType) q = q.eq("entity_type", filters.entityType);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", `${filters.to}T23:59:59`);
  const { data, error } = await q;
  if (error) { console.error("getAuditLogs:", JSON.stringify(error)); return []; }
  return (data as AuditRow[]) ?? [];
}
```
- [ ] `page.tsx` (server): `const rows = await getAuditLogs({});` → `<AuditClient initialRows={rows} />`
- [ ] `audit-client.tsx` (client): filter bar (Input actor email, Select action [all + the exact action strings from Global Constraints], Select entity type [all + entity list], two date Inputs type=date, "Apply" button → `startTransition(getAuditLogs(filters))` into state). Table: time (locale string), actor (email + role badge), action (Badge; destructive for delete/login_failed/user_disabled), entity (type + id), IP. Row click toggles expanded row (`<TableRow>` + conditional second row, colSpan full) showing `<pre className="text-xs overflow-x-auto">{JSON.stringify(changes ?? metadata, null, 2)}</pre>`. shadcn only, stable keys (row.id).
- [ ] Sidebar: add `{ name: "Audit Log", href: "/audit-log", icon: ScrollText }` after Users item. Import ScrollText from lucide-react. (Visible to editors too — no filter change.)
- [ ] Verify: tsc 32 baseline, zero new.

---

## Acceptance checklist (Phase 2)

- [ ] tsc: 32 baseline, zero new
- [ ] Every function listed in Tasks 2-4 calls logAudit on success; no mutation can fail because of audit
- [ ] Passwords never logged (user temp passwords, partner password field masked)
- [ ] Login/logout/failed-login logged with IP
- [ ] /audit-log renders, filters work, diff expands (manual — after migration applied)
- [ ] Sidebar shows Audit Log for staff
