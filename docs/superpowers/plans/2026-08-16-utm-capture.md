# UTM Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture campaign UTMs into a 90-day first-party cookie on myt-main (influencer-protected, with history), attach them to reservations as `utm_touches` rows, and display attribution in the backoffice reservation detail.

**Architecture:** Server-set cookie written by main's middleware (survives Safari ITP); pure decision logic in `lib/utm.ts` (unit-tested); confirm-order reads the cookie server-side and inserts normalized touch rows; backoffice owns the migration and renders the attribution section. Every failure path fails open to today's behavior.

**Tech Stack:** Next.js 15 middleware (main), vitest (main, already installed), Supabase (shared DB), shadcn/ui (backoffice).

**Spec:** `docs/superpowers/specs/2026-08-16-utm-capture-design.md` — read it before starting any task.

## Global Constraints

- **Two repos.** BACKOFFICE = `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-backoffice`, MAIN = `C:\Users\doraz\OneDrive\Desktop\Work\MegaEvent\MYT_Git_Shered\myt-main`. Each task states its repo; run all commands from that repo's root.
- **Git:** NEVER commit or push unprompted. At each task's end, STOP and report — Dor reviews the diff and commits via `/commit-push`. Never `git merge` (hard-blocked by hook). No AI co-author lines ever.
- **Fail-open is non-negotiable:** middleware capture fully wrapped in try/catch → on any error the page loads as if the feature doesn't exist; confirm-order UTM logic wrapped → any error falls back to today's behavior; `utm_touches` insert failure must never fail a booking.
- Cookie name `myt_utm`, Max-Age 90 days, `SameSite=Lax`, `Secure`, `httpOnly: false`, short JSON keys, history cap 5, serialized size guard ~3.5KB.
- Any response that sets `myt_utm` must also get `Cache-Control: private, no-store`.
- Type gate is `npx tsc --noEmit` (builds ignore TS errors in both repos). Main's tests: `npx vitest run`.
- Deploy stages (spec "Rollout"): Task 1 = stage 1, Tasks 2-3 = stage 2, Task 4 = stage 3, Tasks 5-6 = stage 4/independent. Do not collapse stages.

## File Structure

| Repo | File | Responsibility |
|---|---|---|
| BACKOFFICE | `supabase/migrations/<ts>_utm_touches.sql` | Create `utm_touches` table + indexes (create) |
| BACKOFFICE | `types/utm.types.ts` | `UtmTouch` row type (create) |
| MAIN | `lib/utm.ts` | Cookie types, parse/apply/serialize pure logic, checkout helpers (create) |
| MAIN | `lib/__tests__/utm.test.ts` | Vitest suite for the pure logic (create) |
| MAIN | `middleware.ts` | Capture integration: parse → classify → apply → set cookie (modify) |
| MAIN | `app/api/confirm-order/route.ts` | Read cookie, surgical fix for `aff_partner_tracking_code`, insert touches (modify) |
| BACKOFFICE | `lib/site.ts` | `partnerLink()` gains `utm_medium=influencer` (modify) |
| BACKOFFICE | `lib/actions/portal-package-actions.ts:1823`, `lib/actions/quote-actions.ts:521` | Same marker on inline-built links (modify) |
| BACKOFFICE | `lib/actions/reservation-actions.ts` | `getReservationUtmTouches` server action (modify) |
| BACKOFFICE | `app/(dashboard)/reservations/[id]/page.tsx` | "מקור הגעה" attribution section (modify) |

---

### Task 1: `utm_touches` migration + shared type (BACKOFFICE, deploy stage 1)

**Files:**
- Create: `supabase/migrations/<timestamp>_utm_touches.sql` (via `npm run db:new`)
- Create: `types/utm.types.ts`

**Interfaces:**
- Produces: table `utm_touches` (columns exactly as in the SQL below) and type `UtmTouch` — Task 4 inserts into the table, Task 6 reads it and imports the type.

- [ ] **Step 1: Sync master** (migrations rule — timestamps must land after everything applied)

```bash
git fetch origin
git status
```
If behind origin/master: `git pull --ff-only origin master`. (Never `git merge`.)

- [ ] **Step 2: Create the migration file**

```bash
npm run db:new utm_touches
```

Write into the created `supabase/migrations/<timestamp>_utm_touches.sql`:

```sql
-- Attribution touches captured from the myt_utm cookie at checkout.
-- position 0 = primary (the attribution), 1..n = older history touches.
-- Written by myt-main's confirm-order (service role); read by the backoffice.
create table if not exists utm_touches (
  id bigint generated always as identity primary key,
  reservation_id bigint not null references reservations(id),
  position smallint not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  fbclid text,
  is_influencer boolean not null default false,
  visited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists utm_touches_reservation_idx on utm_touches (reservation_id);
create index if not exists utm_touches_source_idx on utm_touches (utm_source);
create index if not exists utm_touches_campaign_idx on utm_touches (utm_campaign);

-- Service-role only (both apps write/read server-side). No anon policies on purpose.
alter table utm_touches enable row level security;
```

- [ ] **Step 3: Create `types/utm.types.ts`**

```ts
/**
 * A row of `utm_touches` - attribution touches captured from the `myt_utm`
 * cookie when a reservation is created. position 0 is the primary
 * (attributed) touch; 1..n are older history touches, newest first.
 * Written by myt-main's confirm-order; read here for the reservation
 * detail's attribution section. Keep in sync with myt-main's lib/utm.ts
 * (UtmTouchInsert is the insert-side subset of this row).
 */
export type UtmTouch = {
  id: number;
  reservation_id: number;
  position: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  is_influencer: boolean;
  visited_at: string | null;
  created_at: string;
};
```

- [ ] **Step 4: Type gate**

Run: `npx tsc --noEmit`
Expected: no NEW errors (pre-existing errors unrelated to `types/utm.types.ts` are out of scope).

- [ ] **Step 5: Verify no duplicate migration version prefix**

```bash
ls supabase/migrations/ | cut -c1-14 | sort | uniq -d
```
Expected: empty output.

- [ ] **Step 6: STOP — report to Dor.** Migration + type ready. Dor reviews, commits, merges to master; the "Apply DB Migrations" workflow applies it. After it lands on master, Dor (or a later task) runs `npm run db:types` to refresh `types/database.types.ts`. **Do not run `npm run db:push`.**

---

### Task 2: Pure UTM logic + tests (MAIN, deploy stage 2)

**Files:**
- Create: `lib/utm.ts`
- Create: `lib/__tests__/utm.test.ts` (vitest is already set up — see `lib/__tests__/*.test.ts`)

**Interfaces:**
- Produces (Task 3 and Task 4 import these — exact signatures):
  - `UTM_COOKIE = "myt_utm"`, `UTM_COOKIE_MAX_AGE = 7776000`
  - `type CookieTouch = { s: string|null; m: string|null; c: string|null; t: string|null; ct: string|null; g: string|null; f: string|null; inf: boolean; at: string }`
  - `type UtmCookie = { v: 1; p: CookieTouch; h: CookieTouch[] }`
  - `type IncomingTouch = Omit<CookieTouch, "inf" | "at">`
  - `type UtmTouchInsert` (insert shape for `utm_touches`)
  - `parseUtmParams(sp: URLSearchParams): IncomingTouch | null`
  - `parseUtmCookie(raw: string | undefined | null): UtmCookie | null`
  - `readUtmCookieFromHeader(cookieHeader: string | null): UtmCookie | null`
  - `sameTouch(a: CookieTouch, b: IncomingTouch): boolean`
  - `applyUtmCapture(existing: UtmCookie | null, incoming: IncomingTouch, isInfluencer: boolean, nowIso: string): UtmCookie`
  - `serializeUtmCookie(cookie: UtmCookie): string`
  - `influencerPrimaryCode(cookie: UtmCookie | null): string | null`
  - `touchRows(cookie: UtmCookie | null, reservationId: number): UtmTouchInsert[]`

- [ ] **Step 1: Write the failing test file** — `lib/__tests__/utm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyUtmCapture,
  influencerPrimaryCode,
  parseUtmCookie,
  parseUtmParams,
  readUtmCookieFromHeader,
  sameTouch,
  serializeUtmCookie,
  touchRows,
  type CookieTouch,
  type UtmCookie,
} from "../utm";

const NOW = "2026-08-16T10:00:00.000Z";

const touch = (over: Partial<CookieTouch> = {}): CookieTouch => ({
  s: "google",
  m: "cpc",
  c: "summer_f1",
  t: null,
  ct: null,
  g: null,
  f: null,
  inf: false,
  at: "2026-08-10T09:00:00.000Z",
  ...over,
});

describe("parseUtmParams", () => {
  it("returns null when none of the 7 params are present", () => {
    expect(parseUtmParams(new URLSearchParams("?foo=1&pkg=abc"))).toBeNull();
  });

  it("captures the 5 utms + click ids", () => {
    const sp = new URLSearchParams(
      "utm_source=google&utm_medium=cpc&utm_campaign=x&utm_term=y&utm_content=z&gclid=g1&fbclid=f1",
    );
    expect(parseUtmParams(sp)).toEqual({
      s: "google", m: "cpc", c: "x", t: "y", ct: "z", g: "g1", f: "f1",
    });
  });

  it("a bare gclid still creates a touch (google auto-tagging)", () => {
    expect(parseUtmParams(new URLSearchParams("gclid=abc"))).toEqual({
      s: null, m: null, c: null, t: null, ct: null, g: "abc", f: null,
    });
  });

  it("trims and caps values at 200 chars", () => {
    const sp = new URLSearchParams(`utm_source=${" x".repeat(1) + "a".repeat(300)}`);
    const got = parseUtmParams(sp);
    expect(got?.s?.length).toBeLessThanOrEqual(200);
    expect(got?.s?.startsWith("x")).toBe(true);
  });
});

describe("parseUtmCookie", () => {
  it("round-trips through serializeUtmCookie", () => {
    const cookie: UtmCookie = { v: 1, p: touch(), h: [touch({ s: "old" })] };
    expect(parseUtmCookie(serializeUtmCookie(cookie))).toEqual(cookie);
  });

  it("corrupt json → null", () => {
    expect(parseUtmCookie("{not json")).toBeNull();
  });

  it("wrong shape → null", () => {
    expect(parseUtmCookie(JSON.stringify({ v: 2, foo: 1 }))).toBeNull();
    expect(parseUtmCookie(JSON.stringify({ v: 1 }))).toBeNull();
  });

  it("undefined → null", () => {
    expect(parseUtmCookie(undefined)).toBeNull();
  });
});

describe("readUtmCookieFromHeader", () => {
  it("finds myt_utm among other cookies (url-encoded value)", () => {
    const cookie: UtmCookie = { v: 1, p: touch(), h: [] };
    const header = `session=abc; myt_utm=${encodeURIComponent(serializeUtmCookie(cookie))}; other=1`;
    expect(readUtmCookieFromHeader(header)).toEqual(cookie);
  });

  it("null header → null", () => {
    expect(readUtmCookieFromHeader(null)).toBeNull();
  });
});

describe("applyUtmCapture", () => {
  const incoming = { s: "facebook", m: "paid", c: "c2", t: null, ct: null, g: null, f: "fb1" };

  it("first capture → becomes primary, empty history", () => {
    const got = applyUtmCapture(null, incoming, false, NOW);
    expect(got.p).toEqual({ ...incoming, inf: false, at: NOW });
    expect(got.h).toEqual([]);
  });

  it("identical set to primary → returns existing unchanged (refresh only)", () => {
    const existing: UtmCookie = { v: 1, p: touch(), h: [] };
    const same = { s: "google", m: "cpc", c: "summer_f1", t: null, ct: null, g: null, f: null };
    expect(applyUtmCapture(existing, same, false, NOW)).toBe(existing);
  });

  it("new campaign over campaign → old primary pushed to history", () => {
    const existing: UtmCookie = { v: 1, p: touch(), h: [] };
    const got = applyUtmCapture(existing, incoming, false, NOW);
    expect(got.p.s).toBe("facebook");
    expect(got.h[0].s).toBe("google");
  });

  it("campaign over INFLUENCER → primary protected, touch goes to history", () => {
    const inf = touch({ s: "dani_promo", m: "influencer", inf: true });
    const existing: UtmCookie = { v: 1, p: inf, h: [] };
    const got = applyUtmCapture(existing, incoming, false, NOW);
    expect(got.p).toEqual(inf);
    expect(got.h[0]).toEqual({ ...incoming, inf: false, at: NOW });
  });

  it("influencer over influencer → NEW influencer wins", () => {
    const oldInf = touch({ s: "dani_promo", inf: true });
    const existing: UtmCookie = { v: 1, p: oldInf, h: [] };
    const newInf = { s: "roni_promo", m: "influencer", c: null, t: null, ct: null, g: null, f: null };
    const got = applyUtmCapture(existing, newInf, true, NOW);
    expect(got.p.s).toBe("roni_promo");
    expect(got.p.inf).toBe(true);
    expect(got.h[0].s).toBe("dani_promo");
  });

  it("history capped at 5", () => {
    const existing: UtmCookie = {
      v: 1,
      p: touch(),
      h: [1, 2, 3, 4, 5].map((i) => touch({ s: `old${i}` })),
    };
    const got = applyUtmCapture(existing, incoming, false, NOW);
    expect(got.h).toHaveLength(5);
    expect(got.h[0].s).toBe("google");
    expect(got.h[4].s).toBe("old4");
  });
});

describe("serializeUtmCookie size guard", () => {
  it("drops oldest history entries until under ~3.5KB", () => {
    const big = (i: number) => touch({ c: `campaign_${"x".repeat(400)}_${i}` });
    const cookie: UtmCookie = { v: 1, p: big(0), h: [1, 2, 3, 4, 5].map(big) };
    const raw = serializeUtmCookie(cookie);
    expect(raw.length).toBeLessThanOrEqual(3500);
    const parsed = parseUtmCookie(raw)!;
    expect(parsed.p.c).toBe(cookie.p.c); // primary never dropped
    expect(parsed.h.length).toBeLessThan(5);
  });
});

describe("checkout helpers", () => {
  it("influencerPrimaryCode: influencer primary → its source", () => {
    const c: UtmCookie = { v: 1, p: touch({ s: "dani_promo", inf: true }), h: [] };
    expect(influencerPrimaryCode(c)).toBe("dani_promo");
  });

  it("influencerPrimaryCode: campaign primary → null", () => {
    expect(influencerPrimaryCode({ v: 1, p: touch(), h: [] })).toBeNull();
  });

  it("influencerPrimaryCode: null cookie → null", () => {
    expect(influencerPrimaryCode(null)).toBeNull();
  });

  it("touchRows maps primary to position 0, history to 1..n", () => {
    const c: UtmCookie = { v: 1, p: touch({ s: "dani", inf: true }), h: [touch({ s: "google" })] };
    const rows = touchRows(c, 42);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      reservation_id: 42, position: 0,
      utm_source: "dani", utm_medium: "cpc", utm_campaign: "summer_f1",
      utm_term: null, utm_content: null, gclid: null, fbclid: null,
      is_influencer: true, visited_at: touch().at,
    });
    expect(rows[1].position).toBe(1);
    expect(rows[1].utm_source).toBe("google");
  });

  it("touchRows: null cookie → empty array", () => {
    expect(touchRows(null, 42)).toEqual([]);
  });
});

describe("sameTouch", () => {
  it("ignores inf/at, compares the 7 params", () => {
    expect(sameTouch(touch({ inf: true, at: "other" }), {
      s: "google", m: "cpc", c: "summer_f1", t: null, ct: null, g: null, f: null,
    })).toBe(true);
    expect(sameTouch(touch(), { s: "google", m: "cpc", c: "DIFF", t: null, ct: null, g: null, f: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run lib/__tests__/utm.test.ts`
Expected: FAIL — cannot resolve `../utm`.

- [ ] **Step 3: Implement `lib/utm.ts`**

```ts
/**
 * UTM capture - pure decision logic + cookie codec.
 *
 * The `myt_utm` cookie holds the visitor's attribution: `p` (primary = the
 * touch that gets credit) and `h` (history, newest first, capped). Short keys
 * on purpose - the whole serialized value must stay well under the 4KB cookie
 * limit. Spec: myt-backoffice docs/superpowers/specs/2026-08-16-utm-capture-design.md.
 *
 * Everything here is pure and side-effect free so it can be unit-tested;
 * middleware.ts and confirm-order are thin adapters around it.
 */

export const UTM_COOKIE = "myt_utm";
export const UTM_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days, rolling
const HISTORY_MAX = 5;
const COOKIE_BYTE_BUDGET = 3500;
const VALUE_MAX = 200;

export type CookieTouch = {
  s: string | null; // utm_source
  m: string | null; // utm_medium
  c: string | null; // utm_campaign
  t: string | null; // utm_term
  ct: string | null; // utm_content
  g: string | null; // gclid
  f: string | null; // fbclid
  inf: boolean; // source resolved to a marketing partner (influencer/agent)
  at: string; // ISO timestamp of the touch
};

export type IncomingTouch = Omit<CookieTouch, "inf" | "at">;

export type UtmCookie = { v: 1; p: CookieTouch; h: CookieTouch[] };

/** Insert shape for the shared `utm_touches` table (backoffice owns the schema). */
export type UtmTouchInsert = {
  reservation_id: number;
  position: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  is_influencer: boolean;
  visited_at: string | null;
};

const clean = (v: string | null): string | null => {
  const trimmed = v?.trim();
  return trimmed ? trimmed.slice(0, VALUE_MAX) : null;
};

/** A touch exists if ANY of the 7 params is present (bare gclid counts - Google auto-tagging). */
export function parseUtmParams(sp: URLSearchParams): IncomingTouch | null {
  const touch: IncomingTouch = {
    s: clean(sp.get("utm_source")),
    m: clean(sp.get("utm_medium")),
    c: clean(sp.get("utm_campaign")),
    t: clean(sp.get("utm_term")),
    ct: clean(sp.get("utm_content")),
    g: clean(sp.get("gclid")),
    f: clean(sp.get("fbclid")),
  };
  return Object.values(touch).some((v) => v !== null) ? touch : null;
}

const isTouchShape = (x: unknown): x is CookieTouch =>
  typeof x === "object" && x !== null && typeof (x as CookieTouch).at === "string";

/** Corrupt/foreign cookie → null (treated as absent; next capture writes fresh). */
export function parseUtmCookie(raw: string | undefined | null): UtmCookie | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const cookie = parsed as UtmCookie;
    if (cookie?.v !== 1 || !isTouchShape(cookie.p) || !Array.isArray(cookie.h)) return null;
    return { v: 1, p: cookie.p, h: cookie.h.filter(isTouchShape) };
  } catch {
    return null;
  }
}

/** For runtimes handing us a raw Cookie header instead of a parsed cookie jar. */
export function readUtmCookieFromHeader(cookieHeader: string | null): UtmCookie | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== UTM_COOKIE) continue;
    try {
      return parseUtmCookie(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      return null;
    }
  }
  return null;
}

/** Same 7 params = same touch; inf/at are derived, not identity. */
export function sameTouch(a: CookieTouch, b: IncomingTouch): boolean {
  return (
    a.s === b.s && a.m === b.m && a.c === b.c && a.t === b.t &&
    a.ct === b.ct && a.g === b.g && a.f === b.f
  );
}

/**
 * The core rule (approved spec):
 * - identical to current primary → no structural change (caller just refreshes expiry)
 * - influencer primary + non-influencer touch → primary protected, touch recorded in history
 * - otherwise (incl. influencer over influencer) → new touch wins, old primary → history
 */
export function applyUtmCapture(
  existing: UtmCookie | null,
  incoming: IncomingTouch,
  isInfluencer: boolean,
  nowIso: string,
): UtmCookie {
  const touch: CookieTouch = { ...incoming, inf: isInfluencer, at: nowIso };
  if (!existing) return { v: 1, p: touch, h: [] };
  if (sameTouch(existing.p, incoming)) return existing;
  if (existing.p.inf && !isInfluencer)
    return { v: 1, p: existing.p, h: [touch, ...existing.h].slice(0, HISTORY_MAX) };
  return { v: 1, p: touch, h: [existing.p, ...existing.h].slice(0, HISTORY_MAX) };
}

/** Primary is sacred; history is dropped oldest-first until the value fits the budget. */
export function serializeUtmCookie(cookie: UtmCookie): string {
  const h = [...cookie.h];
  let raw = JSON.stringify({ v: 1, p: cookie.p, h });
  while (raw.length > COOKIE_BYTE_BUDGET && h.length > 0) {
    h.pop();
    raw = JSON.stringify({ v: 1, p: cookie.p, h });
  }
  return raw;
}

/** The influencer-protected attribution code for the reservation, if any. */
export function influencerPrimaryCode(cookie: UtmCookie | null): string | null {
  return cookie?.p.inf && cookie.p.s ? cookie.p.s : null;
}

/** Cookie → `utm_touches` rows. Primary at position 0, history at 1..n. */
export function touchRows(cookie: UtmCookie | null, reservationId: number): UtmTouchInsert[] {
  if (!cookie) return [];
  return [cookie.p, ...cookie.h].map((t, i) => ({
    reservation_id: reservationId,
    position: i,
    utm_source: t.s,
    utm_medium: t.m,
    utm_campaign: t.c,
    utm_term: t.t,
    utm_content: t.ct,
    gclid: t.g,
    fbclid: t.f,
    is_influencer: t.inf,
    visited_at: t.at ?? null,
  }));
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run lib/__tests__/utm.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Type gate**

Run: `npx tsc --noEmit` — no NEW errors.

- [ ] **Step 6: STOP — report to Dor** (diff: 2 new files, no behavior change yet).

---

### Task 3: Middleware capture (MAIN, deploy stage 2)

**Files:**
- Modify: `middleware.ts` (current file is ~77 lines; capture goes after the existing cache-control block, before the final `return response`)

**Interfaces:**
- Consumes from Task 2: `UTM_COOKIE`, `UTM_COOKIE_MAX_AGE`, `parseUtmParams`, `parseUtmCookie`, `sameTouch`, `applyUtmCapture`, `serializeUtmCookie`.

- [ ] **Step 1: Add the classifier + capture helper to `middleware.ts`**

Add imports at the top:

```ts
import {
  UTM_COOKIE,
  UTM_COOKIE_MAX_AGE,
  applyUtmCapture,
  parseUtmCookie,
  parseUtmParams,
  sameTouch,
  serializeUtmCookie,
} from "@/lib/utm";
```

Add above the `middleware` function:

```ts
/**
 * Is this utm_source a marketing partner (influencer/agent)?
 * Fast path: our own link builders stamp utm_medium=influencer - no lookup.
 * Fallback (old links in the wild): one indexed REST read against partners.
 * Hard 400ms timeout; ANY failure → false (the marker path already ran).
 * Runs only when a NEW source lands (not on every page - see the sameTouch
 * short-circuit in the capture block).
 */
async function classifyInfluencer(
  source: string | null,
  medium: string | null,
): Promise<boolean> {
  if (medium === "influencer") return true;
  if (!source) return false;
  const url = process.env.NEXT_SECRET_SUPABASE_URL;
  const key = process.env.NEXT_SECRET_SUPABASE_SERVICE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/partners?partner_tracking_code=eq.${encodeURIComponent(source)}` +
        `&type=in.(agent,affiliate)&select=partner_tracking_code&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(400),
      },
    );
    if (!res.ok) return false;
    const rows: unknown = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    console.error("utm classify lookup failed:", e);
    return false;
  }
}
```

- [ ] **Step 2: Add the capture block**

In the main flow (after the partner-area early returns), immediately **after** the existing HTML cache-control `if` block and **before** `return response;`, insert:

```ts
  // UTM capture (spec: backoffice docs/superpowers/specs/2026-08-16-utm-capture-design.md).
  // Server-set so Safari's 7-day cap on JS cookies doesn't apply. Fully
  // fail-open: ANY error and the page ships exactly as it would without this.
  try {
    const isPage =
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/feeds/") &&
      !pathname.startsWith("/_next/") &&
      !pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/);
    if (isPage) {
      const incoming = parseUtmParams(request.nextUrl.searchParams);
      if (incoming) {
        const existing = parseUtmCookie(request.cookies.get(UTM_COOKIE)?.value);
        // Same set as the current primary → skip the partner lookup entirely,
        // just refresh the rolling 90-day window.
        const inf =
          existing && sameTouch(existing.p, incoming)
            ? existing.p.inf
            : await classifyInfluencer(incoming.s, incoming.m);
        const next = applyUtmCapture(existing, incoming, inf, new Date().toISOString());
        response.cookies.set(UTM_COOKIE, serializeUtmCookie(next), {
          maxAge: UTM_COOKIE_MAX_AGE,
          path: "/",
          sameSite: "lax",
          secure: true,
          httpOnly: false,
        });
        // Never publicly cache a Set-Cookie response (overrides the block above).
        response.headers.set("Cache-Control", "private, no-store");
      }
    }
  } catch (e) {
    console.error("utm capture failed:", e);
  }
```

- [ ] **Step 3: Type gate**

Run: `npx tsc --noEmit` — no NEW errors.

- [ ] **Step 4: Verify locally with the dev server**

Run `npm run dev`, then:

```bash
curl -sI "http://localhost:3000/?utm_source=test_local&utm_medium=cpc&utm_campaign=check" | grep -i -E "set-cookie|cache-control"
```
Expected: `Set-Cookie: myt_utm=...` containing `test_local`, `Max-Age=7776000`, `SameSite=lax`; `Cache-Control: private, no-store`.

```bash
curl -sI "http://localhost:3000/" | grep -i set-cookie
```
Expected: NO `myt_utm` Set-Cookie (bare URL = do nothing).

```bash
curl -sI "http://localhost:3000/?utm_medium=influencer&utm_source=whatever" | grep -i set-cookie
```
Expected: `myt_utm` value contains `"inf":true` (URL-encoded: `%22inf%22%3Atrue`).

- [ ] **Step 5: Run the full test suite** (`npx vitest run`) — still green.

- [ ] **Step 6: STOP — report to Dor.** This diff is deploy stage 2 — it ships ALONE and gets 2-3 days of the spec's stage-2 verification (iPhone Safari check, Vercel logs, TTFB, cache headers) before Task 4's diff deploys.

---

### Task 4: Checkout attach + surgical fix (MAIN, deploy stage 3)

**Files:**
- Modify: `app/api/confirm-order/route.ts` (reservation payload at ~line 167-226; insert + `id` at ~line 229-254)

**Interfaces:**
- Consumes from Task 2: `UTM_COOKIE`, `readUtmCookieFromHeader`, `influencerPrimaryCode`, `touchRows`.
- Consumes from Task 1: table `utm_touches`.

- [ ] **Step 1: Read the cookie at the top of the POST handler**

Add imports:

```ts
import {
  influencerPrimaryCode,
  readUtmCookieFromHeader,
  touchRows,
} from "@/lib/utm";
```

Near the start of the handler (after the request body is parsed), add — using the raw header so this works whatever the request type is:

```ts
  // Attribution cookie - server-set by middleware, server-read here. Fail-open:
  // any parse problem behaves like "no cookie" (today's exact behavior).
  const utmCookie = readUtmCookieFromHeader(request.headers.get("cookie"));
```

- [ ] **Step 2: Surgical fix for `aff_partner_tracking_code`**

In `reservationPayload` (currently lines 182-185), change:

```ts
    aff_partner_tracking_code:
      validatedData.aff_partner_tracking_code ||
      coupon?.partner_tracking_code ||
      "",
```

to:

```ts
    // Influencer-protected attribution wins: the myt_utm cookie's primary is
    // immune to later campaign clicks (utm_source=google used to overwrite the
    // influencer's code in localStorage and steal the credit). Falls back to
    // the legacy client-sent value, then coupon attribution - today's chain.
    aff_partner_tracking_code:
      influencerPrimaryCode(utmCookie) ||
      validatedData.aff_partner_tracking_code ||
      coupon?.partner_tracking_code ||
      "",
```

- [ ] **Step 3: Insert touch rows after the reservation id exists**

Directly after `const id = data?.id;` (~line 254) and its error-handling block, add:

```ts
  // Attribution touches → utm_touches (position 0 = primary). Purely
  // additive analytics data: a failure here must NEVER fail the booking.
  if (id && utmCookie) {
    try {
      const rows = touchRows(utmCookie, id);
      if (rows.length > 0) {
        const { error: utmError } = await supabase.from("utm_touches").insert(rows);
        if (utmError)
          console.error("utm_touches insert failed:", JSON.stringify(utmError));
      }
    } catch (e) {
      console.error("utm_touches insert failed:", e);
    }
  }
```

Place it so it runs on the success path (after the insert error `return`, if there is one — follow the existing control flow; the touches insert must only run when a reservation row exists).

- [ ] **Step 4: Type gate + tests**

Run: `npx tsc --noEmit` — no NEW errors. `npx vitest run` — green.

- [ ] **Step 5: Local booking smoke (if a local booking flow is practical)**

If the dev environment supports completing a test booking: land on `http://localhost:3000/?utm_source=stage3_test&utm_campaign=local`, complete a booking, then check Supabase: `select * from utm_touches order by id desc limit 5;` → rows with `position 0` and `utm_source='stage3_test'`. If not practical locally, this is covered by the spec's stage-3 prod verification.

- [ ] **Step 6: STOP — report to Dor.** Deploys only after stage 2 has soaked 2-3 days clean.

---

### Task 5: Influencer marker on generated links (BACKOFFICE, independent)

**Files:**
- Modify: `lib/site.ts` (`partnerLink`, line ~25)
- Modify: `lib/actions/portal-package-actions.ts:1823`
- Modify: `lib/actions/quote-actions.ts:521`

**Interfaces:**
- Produces: every backoffice/portal-generated partner link carries `utm_medium=influencer` — the middleware classifier's fast path (Task 3) keys on it.

- [ ] **Step 1: `lib/site.ts` — add the marker**

Change line 25 from:

```ts
  const base = `${PUBLIC_SITE_URL}${path}?utm_source=${encodeURIComponent(trackingCode)}`
```

to:

```ts
  // utm_medium=influencer is the classifier fast path in myt-main's middleware
  // (myt_utm cookie): it marks the visit as influencer-attributed without a
  // partners-table lookup. Old links without it still classify via the lookup.
  const base = `${PUBLIC_SITE_URL}${path}?utm_source=${encodeURIComponent(trackingCode)}&utm_medium=influencer`
```

Also update the function's doc comment (lines 12-18): it says the code "is stored in localStorage on arrival" — append: "Since 2026-08, arrival is also captured server-side into the `myt_utm` cookie (see myt-main `lib/utm.ts`)."

- [ ] **Step 2: `portal-package-actions.ts:1823`** — the `next` redirect path:

```ts
  const next = `/order/${data.event_id}?utm_source=${encodeURIComponent(
```
Add `&utm_medium=influencer` to that URL string, after the existing utm_source segment (keep any `pkg` param intact).

- [ ] **Step 3: `quote-actions.ts:521`** — the quote link builds `utm_source=${session.partner_code}`; append `&utm_medium=influencer` the same way.

- [ ] **Step 4: Sweep for any other builders**

Run: `grep -rn "utm_source=" lib/ app/ --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: only the three files above (plus docs). Any new hit → apply the same marker.

- [ ] **Step 5: Type gate**

Run: `npx tsc --noEmit` — no NEW errors.

- [ ] **Step 6: STOP — report to Dor.**

---

### Task 6: Backoffice attribution section (BACKOFFICE, deploy stage 4)

**Files:**
- Modify: `lib/actions/reservation-actions.ts` (add `getReservationUtmTouches`)
- Modify: `app/(dashboard)/reservations/[id]/page.tsx` (client component; fetches via server actions in `useEffect` — follow the existing `getReservation` pattern)

**Interfaces:**
- Consumes: `UtmTouch` from Task 1 (`types/utm.types.ts`); table `utm_touches`.
- Produces: `getReservationUtmTouches(reservationId: number): Promise<UtmTouch[]>`.

- [ ] **Step 1: Server action** — in `lib/actions/reservation-actions.ts`, add (match the file's existing supabase client import — the same one `getReservation` uses):

```ts
export async function getReservationUtmTouches(
  reservationId: number,
): Promise<UtmTouch[]> {
  const { data, error } = await supabase
    .from("utm_touches")
    .select(
      "id, reservation_id, position, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, is_influencer, visited_at, created_at",
    )
    .eq("reservation_id", reservationId)
    .order("position", { ascending: true });
  if (error) {
    console.error(JSON.stringify(error));
    return [];
  }
  return (data ?? []) as UtmTouch[];
}
```

Import `UtmTouch` from `@/types/utm.types` at the top. If the table doesn't exist yet in the connected DB (stage 1 not applied), the error branch returns `[]` — the section simply stays hidden.

- [ ] **Step 2: UI section** — in `app/(dashboard)/reservations/[id]/page.tsx`:

Fetch alongside the existing data loads (`useEffect` that calls `getReservation`): add state `const [utmTouches, setUtmTouches] = useState<UtmTouch[]>([]);` and call `getReservationUtmTouches(Number(id)).then(setUtmTouches).catch(() => {});`.

Render, as a `Card` near the reservation's other info cards (hidden when empty):

```tsx
{utmTouches.length > 0 && (
  <Card>
    <CardHeader>
      <CardTitle>מקור הגעה</CardTitle>
      <CardDescription>UTM attribution — המגע האחרון קובע את הזיכוי</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {utmTouches.map((touch) => (
        <div key={touch.id} className="flex flex-wrap items-center gap-2 text-sm">
          {touch.position === 0 ? (
            <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
              Primary
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">#{touch.position}</span>
          )}
          <span className="font-medium">{touch.utm_source ?? "(no source)"}</span>
          {touch.utm_medium && (
            <span className="text-muted-foreground">/ {touch.utm_medium}</span>
          )}
          {touch.utm_campaign && (
            <span className="text-muted-foreground">/ {touch.utm_campaign}</span>
          )}
          {touch.is_influencer && (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-700">
              משפיען
            </span>
          )}
          {touch.visited_at && (
            <span className="ms-auto text-xs text-muted-foreground">
              {new Date(touch.visited_at).toLocaleDateString("he-IL", {
                day: "2-digit", month: "2-digit", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
          )}
        </div>
      ))}
    </CardContent>
  </Card>
)}
```

Import `UtmTouch` and `getReservationUtmTouches` at the top.

- [ ] **Step 3: Type gate**

Run: `npx tsc --noEmit` — no NEW errors.

- [ ] **Step 4: Visual verify** — `npm run dev`, open a reservation that has touch rows (insert a test row by hand if stage 3 hasn't produced any yet:
`insert into utm_touches (reservation_id, position, utm_source, utm_medium, utm_campaign, is_influencer, visited_at) values (<existing id>, 0, 'dani_promo', 'influencer', null, true, now()), (<existing id>, 1, 'google', 'cpc', 'summer_f1', false, now() - interval '3 days');`)
→ section renders: Primary badge, משפיען badge, history row, timestamps. Open a reservation with no rows → section absent. Delete the hand-inserted test rows afterwards.

- [ ] **Step 5: STOP — report to Dor.**

---

## Plan self-review notes (done at authoring)

- **Spec coverage:** cookie format/flow → T2+T3; classification "both" → T3 (marker + lookup) + T5 (marker on links); checkout attach + surgical fix → T4; `utm_touches` + RLS → T1; backoffice display → T6; rollout stages → task ordering + STOP gates; error table → fail-open wraps in T3/T4, corrupt-cookie in T2, size guard in T2.
- **Deliberate deviations:** none.
- **Post-merge follow-ups (not tasks):** `npm run db:types` after T1's migration applies on master; `/sync-types` is satisfied by `UtmTouchInsert` (main) ↔ `UtmTouch` (backoffice) being documented mirrors — no existing shared type changed.
