# User Management Phase 3 (Partner Portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Agents/affiliates log in and land in `/portal` — Hebrew RTL area showing ONLY their own data: dashboard stats, their coupons, their reservations. No admin sidebar, no internal costs.

**Architecture:** `lib/actions/portal-actions.ts` — every function starts `const { partner_code } = await requirePartner();` and hard-filters by that code (NEVER by client-supplied identifiers). Pages are server components under `app/portal/` with their own minimal RTL layout. Middleware already locks partner roles to `/portal` and admits staff for debugging (Phase 1). Spec: `docs/superpowers/specs/2026-07-14-user-management-design.md`.

## Global Constraints

- **No commits by agents.** Dor commits via `/commit-push`.
- **No test suite.** Verification = `npx tsc --noEmit` — 32 pre-existing baseline errors, ZERO new.
- **Data isolation is the whole point:** every portal query filters by the session's `partner_code`. No portal action accepts a partner code, user id, or reservation id list from the client (a reservation-detail lookup must ALSO re-check `aff_partner_tracking_code === partner_code`).
- **Never selected/returned to portal users:** `final_purchase_price_ils`, `offline_flight_cost`, `offline_hotel_cost`, `payment_info`, `accounting_number`, `exchange_rate_usd_ils_100`, `comments`, partner `password`, other partners' anything.
- Reservation columns partners MAY see: `id, created_at, main_contact_first_name, main_contact_last_name, status, user_shown_price, event_id, event_order_info` (event title only rendered from it).
- Hebrew RTL: portal layout sets `dir="rtl"`; labels in Hebrew.
- shadcn only; Server Components by default; `"use client"` only where interactive.
- requirePartner() (lib/auth/guards.ts) throws unless role agent/affiliate AND partner_code non-null; staff visiting /portal pages will therefore see an empty/denied state — acceptable: pages catch the throw by checking session first via getSession() and rendering a notice for staff (see Task 2 pattern).
- Staff-debug rule: portal PAGES may render for staff with a "staff preview — no partner data" notice instead of throwing (use `getSession()` + role check in the page, only call portal actions for partner roles).

---

### Task 1: `lib/actions/portal-actions.ts`

**Files:** Create `lib/actions/portal-actions.ts`

**Interfaces (produced):**
```ts
export interface PortalProfile { name_hebrew: string | null; partner_tracking_code: string; commission: number | null; logo_url: string | null; display_name: string | null; email: string }
export interface PortalStats { totalReservations: number; paidReservations: number; totalSalesUsd: number; commissionPercent: number | null; estimatedCommissionUsd: number; activeCoupons: number; couponUses: number }
export interface PortalCoupon { id: number; code: string; discount_type: string; discount_value: number; valid_until: string | null; max_uses: number | null; times_used: number | null; times_paid: number | null; is_active: boolean; event_id: number | null }
export interface PortalReservation { id: number; created_at: string; customer_name: string; status: string; user_shown_price: number; event_id: number; event_title: string | null }
export async function getPortalProfile(): Promise<PortalProfile | null>
export async function getPortalStats(): Promise<PortalStats>
export async function getPortalCoupons(): Promise<PortalCoupon[]>
export async function getPortalReservations(): Promise<PortalReservation[]>
```

- [ ] **Step 1: Write the file**

```ts
"use server";

import { requirePartner, getSession } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";

export interface PortalProfile {
  name_hebrew: string | null;
  partner_tracking_code: string;
  commission: number | null;
  logo_url: string | null;
  display_name: string | null;
  email: string;
}

export interface PortalStats {
  totalReservations: number;
  paidReservations: number;
  totalSalesUsd: number;
  commissionPercent: number | null;
  estimatedCommissionUsd: number;
  activeCoupons: number;
  couponUses: number;
}

export interface PortalCoupon {
  id: number;
  code: string;
  discount_type: string;
  discount_value: number;
  valid_until: string | null;
  max_uses: number | null;
  times_used: number | null;
  times_paid: number | null;
  is_active: boolean;
  event_id: number | null;
}

export interface PortalReservation {
  id: number;
  created_at: string;
  customer_name: string;
  status: string;
  user_shown_price: number;
  event_id: number;
  event_title: string | null;
}

export async function getPortalProfile(): Promise<PortalProfile | null> {
  const session = await requirePartner();
  const [{ data: partner, error: pErr }, { data: profile, error: prErr }] =
    await Promise.all([
      (supabase as any)
        .from("partners")
        .select("name_hebrew,partner_tracking_code,commission")
        .eq("partner_tracking_code", session.partner_code)
        .maybeSingle(),
      (supabase as any)
        .from("user_profiles")
        .select("logo_url,display_name,email")
        .eq("id", session.sub)
        .maybeSingle(),
    ]);
  if (pErr) console.error("getPortalProfile partner:", JSON.stringify(pErr));
  if (prErr) console.error("getPortalProfile profile:", JSON.stringify(prErr));
  if (!partner) return null;
  return {
    name_hebrew: partner.name_hebrew ?? null,
    partner_tracking_code: partner.partner_tracking_code,
    commission: partner.commission ?? null,
    logo_url: profile?.logo_url ?? null,
    display_name: profile?.display_name ?? null,
    email: profile?.email ?? session.email,
  };
}

export async function getPortalStats(): Promise<PortalStats> {
  const session = await requirePartner();
  const empty: PortalStats = {
    totalReservations: 0,
    paidReservations: 0,
    totalSalesUsd: 0,
    commissionPercent: null,
    estimatedCommissionUsd: 0,
    activeCoupons: 0,
    couponUses: 0,
  };

  const [resResult, couponResult, partnerResult] = await Promise.all([
    (supabase as any)
      .from("reservations")
      .select("id,status,user_shown_price")
      .eq("aff_partner_tracking_code", session.partner_code),
    (supabase as any)
      .from("coupons")
      .select("id,is_active,times_used")
      .eq("partner_tracking_code", session.partner_code),
    (supabase as any)
      .from("partners")
      .select("commission")
      .eq("partner_tracking_code", session.partner_code)
      .maybeSingle(),
  ]);

  if (resResult.error) {
    console.error("getPortalStats reservations:", JSON.stringify(resResult.error));
    return empty;
  }
  if (couponResult.error) {
    console.error("getPortalStats coupons:", JSON.stringify(couponResult.error));
  }

  const reservations = (resResult.data ?? []) as {
    id: number;
    status: string;
    user_shown_price: number | null;
  }[];
  const coupons = (couponResult.data ?? []) as {
    id: number;
    is_active: boolean;
    times_used: number | null;
  }[];
  const commissionPercent = partnerResult.data?.commission ?? null;

  const paid = reservations.filter((r) => (r.status ?? "").toLowerCase() === "paid");
  const totalSalesUsd = paid.reduce((sum, r) => sum + (r.user_shown_price ?? 0), 0);

  return {
    totalReservations: reservations.length,
    paidReservations: paid.length,
    totalSalesUsd,
    commissionPercent,
    estimatedCommissionUsd: commissionPercent
      ? Math.round(totalSalesUsd * (commissionPercent / 100))
      : 0,
    activeCoupons: coupons.filter((c) => c.is_active).length,
    couponUses: coupons.reduce((sum, c) => sum + (c.times_used ?? 0), 0),
  };
}

export async function getPortalCoupons(): Promise<PortalCoupon[]> {
  const session = await requirePartner();
  const { data, error } = await (supabase as any)
    .from("coupons")
    .select(
      "id,code,discount_type,discount_value,valid_until,max_uses,times_used,times_paid,is_active,event_id"
    )
    .eq("partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getPortalCoupons:", JSON.stringify(error));
    return [];
  }
  return (data as PortalCoupon[]) ?? [];
}

export async function getPortalReservations(): Promise<PortalReservation[]> {
  const session = await requirePartner();
  const { data, error } = await (supabase as any)
    .from("reservations")
    .select(
      "id,created_at,main_contact_first_name,main_contact_last_name,status,user_shown_price,event_id,event_order_info"
    )
    .eq("aff_partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("getPortalReservations:", JSON.stringify(error));
    return [];
  }
  type Row = {
    id: number;
    created_at: string;
    main_contact_first_name: string | null;
    main_contact_last_name: string | null;
    status: string;
    user_shown_price: number | null;
    event_id: number;
    event_order_info: unknown;
  };
  return ((data ?? []) as Row[]).map((r) => {
    // Event title lives inside the order-info JSON when present.
    let event_title: string | null = null;
    const info = r.event_order_info as
      | { events?: { name?: string; event_name?: string }[] }
      | { name?: string }
      | null;
    if (info && typeof info === "object") {
      if (Array.isArray((info as { events?: unknown }).events)) {
        const first = (info as { events: { name?: string; event_name?: string }[] })
          .events[0];
        event_title = first?.name ?? first?.event_name ?? null;
      } else if ("name" in info && typeof info.name === "string") {
        event_title = info.name;
      }
    }
    return {
      id: r.id,
      created_at: r.created_at,
      customer_name: [r.main_contact_first_name, r.main_contact_last_name]
        .filter(Boolean)
        .join(" "),
      status: r.status,
      user_shown_price: r.user_shown_price ?? 0,
      event_id: r.event_id,
      event_title,
    };
  });
}
```

NOTE for implementer: check `types/reservation.types.ts` `ReservationEventOrderInfoItem` for the real title field name and adjust the extraction accordingly (keep the defensive shape).

- [ ] **Step 2:** `npx tsc --noEmit` — 32 baseline, zero new.

---

### Task 2: Portal layout + dashboard

**Files:** Create `app/portal/layout.tsx`, `app/portal/page.tsx`, `app/portal/portal-nav.tsx` (client), `app/portal/staff-notice.tsx` (tiny server-safe component or inline)

- [ ] **Step 1: `app/portal/layout.tsx`** (server component)

```tsx
import { getSession } from "@/lib/auth/guards";
import { getPortalProfile } from "@/lib/actions/portal-actions";
import { PARTNER_ROLES } from "@/types/auth.types";
import { PortalNav } from "./portal-nav";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isPartner = !!session && PARTNER_ROLES.includes(session.role);
  const profile = isPartner ? await getPortalProfile() : null;

  return (
    <div dir="rtl" className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {profile?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logo_url}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : null}
            <div>
              <div className="font-bold">
                {profile?.name_hebrew || profile?.display_name || "פורטל שותפים"}
              </div>
              <div className="text-xs text-muted-foreground">MYT — פורטל שותפים</div>
            </div>
          </div>
          <PortalNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {!isPartner ? (
          <div className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            תצוגת צוות — נתוני שותף לא נטענים עבור משתמשי צוות.
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: `app/portal/portal-nav.tsx`** (client): links דשבורד `/portal`, הקופונים שלי `/portal/coupons`, ההזמנות שלי `/portal/reservations` (active state via usePathname, same styling idiom as sidebar links but horizontal) + logout button calling `useAuth().logout()`.

- [ ] **Step 3: `app/portal/page.tsx`** (server): if session is partner → `const stats = await getPortalStats();` render stat cards (shadcn Card grid, Hebrew labels): סה"כ הזמנות / הזמנות ששולמו / סה"כ מכירות ($ formatted) / אחוז עמלה / עמלה משוערת ($) / קופונים פעילים / שימושי קופון. If staff → render the layout notice only (page returns null content beyond notice). Follow `components/dashboard-cards.tsx` style if helpful.

- [ ] **Step 4:** tsc — 32 baseline, zero new.

---

### Task 3: Portal coupons + reservations pages

**Files:** Create `app/portal/coupons/page.tsx`, `app/portal/reservations/page.tsx` (server components; simple shadcn Tables — static render, no client interactivity needed; may add a small client component only if sorting is desired — NOT required)

- [ ] **Step 1: coupons page** — partner: `getPortalCoupons()` → RTL table: קוד, סוג הנחה (אחוז/קבוע), ערך, בשימוש (times_used/max_uses), שולמו (times_paid), בתוקף עד, פעיל (Badge). Staff: notice only (layout already shows it; page renders empty state).
- [ ] **Step 2: reservations page** — partner: `getPortalReservations()` → RTL table: מספר, תאריך, לקוח, אירוע (event_title או event_id), סטטוס (Badge), סכום ($). NO internal cost columns.
- [ ] **Step 3:** tsc — 32 baseline, zero new. Acceptance note: real data check happens after Dor applies migration + creates an agent user linked to a real partner code.

---

## Acceptance checklist (Phase 3)

- [ ] tsc: 32 baseline, zero new
- [ ] Every portal action starts with requirePartner() and filters by session partner_code only
- [ ] Forbidden columns never selected (grep the portal actions for final_purchase_price_ils/payment_info/accounting_number/offline_*_cost/exchange_rate — zero hits)
- [ ] Partner login → lands /portal (middleware), sees own stats/coupons/reservations only
- [ ] Staff visiting /portal sees staff-notice, no crash
- [ ] RTL Hebrew layout with partner logo
