"use server";

import { requirePartner } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { PAID_STATUS } from "@/lib/partner-commission";
import {
  resolvePortalScope,
  getReservationAttribution,
  visibleToAgent,
  mergedOwner as computeMergedOwner,
} from "@/lib/portal-attribution";
import {
  rangeWindowISO,
  type InsightsRange,
} from "@/lib/actions/partner-performance-actions";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import { SELLER_ROLES } from "@/types/auth.types";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/**
 * Two derived views over data the portal already owns - no new tables:
 *
 * 1. The activity feed (עדכונים): quote created / package link created /
 *    order entered / order paid, folded from quotes, prepared_packages and
 *    reservations.
 * 2. The user search log: every visitor's tracked journey from
 *    affiliates_tracking, grouped per user and folded into one row per
 *    SIMULATION (an event they explored), not one row per click.
 */

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type PortalActivityType =
  | "quote_created"
  | "package_created"
  | "order_created"
  | "order_paid"
  | "coupon_created"
  | "coupon_redeemed";

export interface PortalActivityItem {
  type: PortalActivityType;
  at: string;
  title: string;
  subtitle: string | null;
}

const FEED_LIMIT = 60;

export async function getPortalActivityFeed(): Promise<PortalActivityItem[]> {
  const session = await requirePartner();
  const code = session.partner_code;
  const scope = await resolvePortalScope(session);
  // An agent in a multi-user office only ever sees their OWN activity;
  // managers and solo agents see the whole office's feed.
  const isolate = session.role === "agent" && !scope.soloOffice;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let quotesQuery = (supabase as any)
    .from("quotes")
    .select("id,created_at,customer_name,title")
    .eq("partner_tracking_code", code)
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);
  if (isolate) quotesQuery = quotesQuery.eq("created_by", session.sub);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let packagesQuery = (supabase as any)
    .from("prepared_packages")
    .select("id,created_at,event_order_info")
    .eq("partner_tracking_code", code)
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);
  if (isolate) packagesQuery = packagesQuery.eq("created_by", session.sub);

  const [quotesResult, packagesResult, reservationsInitial, couponsResult] =
    await Promise.all([
      SELLER_ROLES.includes(session.role)
        ? quotesQuery
        : Promise.resolve({ data: [], error: null }),
      packagesQuery,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("reservations")
        .select(
          "id,created_at,status,main_contact_first_name,event_order_info,voucher_state,coupon_code,agent_user_id",
        )
        .eq("aff_partner_tracking_code", code)
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT),
      // Coupons are office-level (no creator column) - an isolated agent gets
      // none of them rather than a filter that can't be expressed.
      isolate
        ? Promise.resolve({ data: [], error: null })
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("coupons")
            .select(
              "code,created_at,discount_type,discount_value,funded_by_commission",
            )
            .eq("partner_tracking_code", code)
            .order("created_at", { ascending: false })
            .limit(FEED_LIMIT),
    ]);

  let reservationsResult = reservationsInitial;
  if (reservationsResult.error?.code === "42703") {
    // agent_user_id not migrated yet - retry without it; the isolation
    // filter below then relies on UTM attribution alone (override
    // contributes nothing until the migration lands).
    reservationsResult = await supabase
      .from("reservations")
      .select(
        "id,created_at,status,main_contact_first_name,event_order_info,voucher_state,coupon_code",
      )
      .eq("aff_partner_tracking_code", code)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT);
  }

  for (const [label, result] of [
    ["quotes", quotesResult],
    ["packages", packagesResult],
    ["reservations", reservationsResult],
    ["coupons", couponsResult],
  ] as const) {
    if (result.error) {
      console.error(
        `getPortalActivityFeed ${label}:`,
        JSON.stringify(result.error),
      );
    }
  }

  const items: PortalActivityItem[] = [];

  for (const quote of (quotesResult.data ?? []) as {
    id: number;
    created_at: string;
    customer_name: string | null;
    title: string | null;
  }[]) {
    items.push({
      type: "quote_created",
      at: quote.created_at,
      title: `הצעת מחיר #${quote.id} נוצרה`,
      subtitle:
        [quote.customer_name, quote.title].filter(Boolean).join(" · ") || null,
    });
  }

  for (const pkg of (packagesResult.data ?? []) as {
    id: number;
    created_at: string;
    event_order_info: ReservationEventOrderInfo | null;
  }[]) {
    const eventName =
      normalizeReservationEventOrderInfo(pkg.event_order_info)[0]?.name ?? null;
    items.push({
      type: "package_created",
      at: pkg.created_at,
      title: "לינק חבילה נוצר",
      subtitle: eventName,
    });
  }

  // Coupon lifecycle: created here in the portal, redeemed when a customer's
  // order carries the code (שובר הנחה - הונפק / בשימוש; דור, 2026-08-09).
  const myCoupons = (couponsResult.data ?? []) as {
    code: string | null;
    created_at: string | null;
    discount_type: string | null;
    discount_value: number | null;
    funded_by_commission?: boolean | null;
  }[];
  const myCouponCodes = new Set(
    myCoupons
      .map((coupon) => (coupon.code ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  for (const coupon of myCoupons) {
    if (!coupon.code || !coupon.created_at) continue;
    const value =
      coupon.discount_type === "percent"
        ? `${coupon.discount_value ?? 0}% הנחה`
        : `$${coupon.discount_value ?? 0} הנחה`;
    items.push({
      type: "coupon_created",
      at: coupon.created_at,
      title: `קופון ${coupon.code} הונפק`,
      subtitle: value + (coupon.funded_by_commission ? " · במימון העמלה" : ""),
    });
  }

  const reservationRows = (reservationsResult.data ?? []) as {
    id: number;
    created_at: string;
    status: string | null;
    main_contact_first_name: string | null;
    event_order_info: ReservationEventOrderInfo | null;
    voucher_state?: "sent" | "received" | "collected" | null;
    coupon_code?: string | null;
    agent_user_id?: string | null;
  }[];
  // Reservations carry no created_by (attribution rides the UTM pipeline
  // instead) - filter the fetched rows against the attribution map rather
  // than the query itself. The manager-set agent_user_id override (QA wave
  // 2, 20.08) wins over that attribution, same as everywhere else.
  const attribution = isolate
    ? await getReservationAttribution(
        reservationRows.map((r) => r.id),
        scope.officeUsers,
      )
    : null;
  const visibleReservations = attribution
    ? reservationRows.filter((r) => {
        const owner = computeMergedOwner(r.agent_user_id, attribution.get(r.id) ?? null);
        return visibleToAgent(owner, session.sub, scope.soloOffice);
      })
    : reservationRows;

  for (const reservation of visibleReservations) {
    const eventName =
      normalizeReservationEventOrderInfo(reservation.event_order_info)[0]
        ?.name ?? null;
    // Voucher orders narrate their settlement stage - נשלח/נקלט/נגבה is what
    // the agent actually tracks on them (אלון, 2026-08-07).
    const voucherLabel =
      reservation.voucher_state === "sent"
        ? "שובר נשלח"
        : reservation.voucher_state === "received"
          ? "שובר נקלט"
          : reservation.voucher_state === "collected"
            ? "שובר נגבה"
            : null;
    const subtitle =
      [reservation.main_contact_first_name, eventName, voucherLabel]
        .filter(Boolean)
        .join(" · ") || null;
    // A paid order is worth two beats in the story ("נכנסה" ואז "שולמה"), but
    // reservations carry no payment timestamp - so it appears once, as its
    // strongest state.
    items.push({
      type: reservation.status === PAID_STATUS ? "order_paid" : "order_created",
      at: reservation.created_at,
      title:
        reservation.status === PAID_STATUS
          ? `הזמנה #${reservation.id} שולמה`
          : `הזמנה #${reservation.id} נכנסה`,
      subtitle,
    });

    // One of THIS partner's coupons spent on the order - its own beat.
    const usedCode = (reservation.coupon_code ?? "").trim().toUpperCase();
    if (usedCode && myCouponCodes.has(usedCode)) {
      items.push({
        type: "coupon_redeemed",
        at: reservation.created_at,
        title: `קופון ${usedCode} מומש`,
        subtitle:
          [`הזמנה #${reservation.id}`, eventName].filter(Boolean).join(" · ") ||
          null,
      });
    }
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, FEED_LIMIT);
}

// ---------------------------------------------------------------------------
// User search log
// ---------------------------------------------------------------------------

/** One simulation - an event a visitor explored, folded to a single row. */
export interface UserSimulation {
  event: string | null;
  event_date: string | null;
  event_location: string | null;
  tickets_type: string | null;
  num_tickets: number | null;
  /** null = the step never happened; otherwise chosen or skipped. */
  flight: "chosen" | "skipped" | null;
  hotel: "chosen" | "skipped" | null;
  confirmed: boolean;
  /**
   * A real reservation matched to this simulation (same partner, same event,
   * created within 48h of it): paid → the row paints green, pending → light
   * blue. Same attribution rule the funnels use - best effort, not a receipt.
   */
  order: "paid" | "pending" | null;
  last_seen: string;
}

export interface UserActivityGroup {
  user_id: string;
  last_seen: string;
  simulations: UserSimulation[];
}

export interface PortalUserActivity {
  users: UserActivityGroup[];
  /** True when the scan hit its row cap - older activity exists beyond it. */
  truncated: boolean;
}

const ACTIVITY_SCAN_LIMIT = 8000;
const MAX_USERS = 40;

type TrackingRow = {
  user_id: string;
  stage: string | null;
  created_at: string;
  event: string | null;
  event_name: string | null;
  event_date: string | null;
  event_location: string | null;
  tickets_type: string | null;
  num_tickets: string | null;
  flight: string | null;
  hotel: string | null;
};

/** The tracked stages fold into simulations; VISIT rows only prove presence. */
function foldSimulations(rows: TrackingRow[]): UserSimulation[] {
  const sims: UserSimulation[] = [];
  let current: UserSimulation | null = null;

  const startNew = (row: TrackingRow, event: string | null): UserSimulation => {
    const sim: UserSimulation = {
      event,
      event_date: null,
      event_location: null,
      tickets_type: null,
      num_tickets: null,
      flight: null,
      hotel: null,
      confirmed: false,
      order: null,
      last_seen: row.created_at,
    };
    sims.push(sim);
    return sim;
  };

  for (const row of rows) {
    const stage = row.stage;
    if (!stage || stage === "VISIT") continue;
    const rowEvent = row.event ?? row.event_name ?? null;

    // A different event name means a new simulation - the visitor moved on.
    if (
      current &&
      rowEvent &&
      current.event &&
      rowEvent.trim().toLowerCase() !== current.event.trim().toLowerCase()
    ) {
      current = null;
    }
    if (!current) current = startNew(row, rowEvent);
    if (!current.event && rowEvent) current.event = rowEvent;
    current.last_seen = row.created_at;

    switch (stage) {
      case "EVENT_SELECTED":
        current.event_date = row.event_date ?? current.event_date;
        current.event_location = row.event_location ?? current.event_location;
        break;
      case "TICKET_SELECTED": {
        current.tickets_type = row.tickets_type ?? current.tickets_type;
        const parsed = Number(row.num_tickets);
        if (Number.isFinite(parsed) && parsed > 0) current.num_tickets = parsed;
        break;
      }
      case "FLIGHT_SELECTED":
        // The stage row exists either way; a null payload means "skipped".
        current.flight = row.flight ? "chosen" : "skipped";
        break;
      case "HOTEL_SELECTED":
        current.hotel = row.hotel ? "chosen" : "skipped";
        break;
      case "CONFIRMED":
        current.confirmed = true;
        break;
    }
  }
  return sims.reverse(); // newest simulation first
}

/** Reservation slice used to paint simulation rows that became real orders. */
type OrderMatchRow = {
  status: string | null;
  created_at: string | null;
  event_order_info: ReservationEventOrderInfo | null;
};

const ORDER_MATCH_WINDOW_MS = 48 * 3_600_000;

/**
 * Paint sims that turned into orders - same partner, same event, ±48h - with
 * each order claiming EXACTLY ONE simulation (the nearest in time).
 *
 * The tracking rows and reservations share no user key (gtmIdnts holds GA/FB
 * ids, not the tracking uuid), so the match is heuristic. The first version
 * let one paid order paint EVERY browser of that event green - שגיא's log
 * showed 40 "שולם" rows off a couple of real orders (2026-08-09). Consuming
 * one sim per order keeps the count honest: N orders → at most N painted rows.
 */
function assignOrdersOnce(
  allSims: UserSimulation[],
  orders: OrderMatchRow[],
): void {
  if (orders.length === 0 || allSims.length === 0) return;
  const parsed = orders
    .map((order) => ({
      status: order.status,
      at: Date.parse(order.created_at ?? ""),
      names: normalizeReservationEventOrderInfo(order.event_order_info)
        .map((event) => (event?.name ?? "").trim().toLowerCase())
        .filter(Boolean),
    }))
    .filter((order) => Number.isFinite(order.at) && order.names.length > 0);

  const candidates = allSims
    .map((sim) => ({
      sim,
      name: (sim.event ?? "").trim().toLowerCase(),
      at: Date.parse(sim.last_seen),
    }))
    .filter((candidate) => candidate.name && Number.isFinite(candidate.at));

  const claim = (
    order: (typeof parsed)[number],
    paint: "paid" | "pending",
  ): void => {
    let best: (typeof candidates)[number] | null = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (candidate.sim.order != null) continue; // already claimed
      if (!order.names.includes(candidate.name)) continue;
      const distance = Math.abs(order.at - candidate.at);
      if (distance > ORDER_MATCH_WINDOW_MS) continue;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (best) best.sim.order = paint;
  };

  // Paid orders claim first - green is the scarce, important signal.
  for (const order of parsed) {
    if (order.status === PAID_STATUS) claim(order, "paid");
  }
  for (const order of parsed) {
    if (
      order.status !== PAID_STATUS &&
      order.status !== "Cancelled" &&
      order.status !== "Lost"
    ) {
      claim(order, "pending");
    }
  }
}

export async function getPortalUserActivity(
  range: InsightsRange = "30d",
): Promise<PortalUserActivity> {
  const session = await requirePartner();
  const { from, to } = await rangeWindowISO(range);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("affiliates_tracking")
    .select(
      "user_id,stage,created_at," +
        "event:data->data->>event,event_name:data->data->>eventName," +
        "event_date:data->data->>eventDate,event_location:data->data->>eventLocation," +
        "tickets_type:data->data->>ticketsType,num_tickets:data->data->>numOfTicket," +
        "flight:data->data->>flight,hotel:data->data->>hotel",
    )
    .eq("affiliate_id", session.partner_code)
    // NEWEST first - with a big history (שגיא) an ascending scan hit the
    // 8000-row cap on ANCIENT rows and the log showed years-old users while
    // this week's traffic (and its orders) never made it in (2026-08-09).
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_SCAN_LIMIT);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);

  // Orders are matched ±48h around a simulation, so widen the fetch window by
  // that much on each side - a range-edge simulation still finds its order.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ordersQuery = (supabase as any)
    .from("reservations")
    .select("status,created_at,event_order_info")
    .eq("aff_partner_tracking_code", session.partner_code)
    .order("created_at", { ascending: false })
    .limit(500);
  if (from) {
    ordersQuery = ordersQuery.gte(
      "created_at",
      new Date(Date.parse(from) - ORDER_MATCH_WINDOW_MS).toISOString(),
    );
  }
  if (to) {
    ordersQuery = ordersQuery.lt(
      "created_at",
      new Date(Date.parse(to) + ORDER_MATCH_WINDOW_MS).toISOString(),
    );
  }

  const [{ data, error }, ordersResult] = await Promise.all([
    query,
    ordersQuery,
  ]);
  if (error) {
    console.error("getPortalUserActivity:", JSON.stringify(error));
    return { users: [], truncated: false };
  }
  if (ordersResult.error) {
    // Row painting is decoration - the log still renders without it.
    console.error(
      "getPortalUserActivity orders:",
      JSON.stringify(ordersResult.error),
    );
  }
  const orderRows = (ordersResult.data ?? []) as OrderMatchRow[];

  const rows = (data ?? []) as TrackingRow[];
  const byUser = new Map<string, TrackingRow[]>();
  for (const row of rows) {
    if (!row.user_id) continue;
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  const users: UserActivityGroup[] = [];
  for (const [userId, userRows] of byUser) {
    // The scan is newest-first; folding walks a user's story chronologically.
    const chronological = [...userRows].reverse();
    const simulations = foldSimulations(chronological);
    if (simulations.length === 0) continue;
    users.push({
      user_id: userId,
      last_seen: chronological[chronological.length - 1].created_at,
      simulations,
    });
  }
  // Global one-order-one-row assignment across every user's simulations.
  assignOrdersOnce(
    users.flatMap((user) => user.simulations),
    orderRows,
  );
  // Users who ORDERED float to the top (paid, then pending) - the green/blue
  // rows are the whole point of the log, and buried below 40 recent browsers
  // nobody ever saw them (אלון+דור, 2026-08-09). Recency breaks ties.
  const tier = (user: UserActivityGroup) =>
    user.simulations.some((sim) => sim.order === "paid")
      ? 0
      : user.simulations.some((sim) => sim.order === "pending")
        ? 1
        : 2;
  users.sort(
    (a, b) => tier(a) - tier(b) || (a.last_seen < b.last_seen ? 1 : -1),
  );

  return {
    users: users.slice(0, MAX_USERS),
    truncated: rows.length >= ACTIVITY_SCAN_LIMIT || users.length > MAX_USERS,
  };
}
