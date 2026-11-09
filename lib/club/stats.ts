// MEGA CLUB numbers for /marketing/club (spec §10). Pure: Israel calendar days, previous period of the same length.
import { daysBetween, israelDayOf, israelToday, resolveWindow } from "@/lib/marketing/range";
import { trendOf, type Trend } from "@/lib/marketing/sales";
import type { ClubMemberRow, ClubMemberView, ClubOrderRow } from "@/lib/club/types";

export const CLUB_RANGES = ["7d", "30d", "90d", "all"] as const;
export type ClubRange = (typeof CLUB_RANGES)[number];

export type DayWindow = { since: string; until: string };

/** The screen's period. "all" starts on the first join day (today when nobody joined yet). */
export function clubWindow(range: string, now: Date, firstJoinDay: string | null): DayWindow & { range: ClubRange } {
  const r: ClubRange = (CLUB_RANGES as readonly string[]).includes(range) ? (range as ClubRange) : "30d";
  if (r === "all") {
    const today = israelToday(now);
    return { range: r, since: firstJoinDay && firstJoinDay < today ? firstJoinDay : today, until: today };
  }
  const w = resolveWindow({ range: r }, now);
  return { range: r, since: w.since, until: w.until };
}

export type ClubOverview = {
  members: { total: number; inWindow: number; prevWindow: number; trend: Trend };
  joinsByDay: { day: string; count: number }[];
  orders: { all: number; paid: number };
  paidRevenueUsd: number;
  discountGivenUsd: number;
  unsubscribed: number;
  welcomeFailed: number;
  topEvents: { eventId: number; members: number }[];
};

const PAID = "Paid";
const inWin = (iso: string, w: DayWindow) => {
  const d = israelDayOf(iso);
  return d >= w.since && d <= w.until;
};

export function clubOverview(members: ClubMemberRow[], orders: ClubOrderRow[], win: DayWindow, prev: DayWindow): ClubOverview {
  const active = members.filter((m) => m.status === "active");
  const joined = members.filter((m) => inWin(m.created_at, win));
  const prevJoined = members.filter((m) => inWin(m.created_at, prev)).length;

  const perDay = new Map<string, number>();
  for (const m of joined) {
    const d = israelDayOf(m.created_at);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }

  const winOrders = orders.filter((o) => inWin(o.created_at, win));
  const paid = winOrders.filter((o) => o.status === PAID);

  const perEvent = new Map<number, number>();
  for (const m of joined) if (m.event_id != null) perEvent.set(m.event_id, (perEvent.get(m.event_id) ?? 0) + 1);

  return {
    members: { total: active.length, inWindow: joined.length, prevWindow: prevJoined, trend: trendOf(joined.length, prevJoined) },
    joinsByDay: daysBetween(win.since, win.until).map((day) => ({ day, count: perDay.get(day) ?? 0 })),
    orders: { all: winOrders.length, paid: paid.length },
    paidRevenueUsd: paid.reduce((s, o) => s + (Number(o.user_shown_price) || 0), 0),
    discountGivenUsd: paid.reduce((s, o) => s + (Number(o.coupon_discount_usd) || 0), 0),
    unsubscribed: active.filter((m) => m.marketing === "unsubscribed").length,
    welcomeFailed: members.filter((m) => !m.welcome_sent_at && !!m.welcome_error).length,
    topEvents: [...perEvent.entries()]
      .map(([eventId, n]) => ({ eventId, members: n }))
      .sort((a, b) => b.members - a.members || a.eventId - b.eventId)
      .slice(0, 5),
  };
}

/** The member table's rows: each member's orders (all statuses and Paid), Paid revenue and the event they joined at. */
export function memberViews(members: ClubMemberRow[], orders: ClubOrderRow[], eventNames: Map<number, string>): ClubMemberView[] {
  const byCode = new Map<string, ClubOrderRow[]>();
  for (const o of orders) {
    const k = o.coupon_code.toUpperCase();
    const list = byCode.get(k);
    if (list) list.push(o);
    else byCode.set(k, [o]);
  }
  return members.map((m) => {
    const mine = byCode.get(m.coupon_code.toUpperCase()) ?? [];
    const paid = mine.filter((o) => o.status === PAID);
    return {
      ...m,
      ordersAll: mine.length,
      ordersPaid: paid.length,
      paidRevenueUsd: paid.reduce((s, o) => s + (Number(o.user_shown_price) || 0), 0),
      eventName: m.event_id != null ? eventNames.get(m.event_id) ?? null : null,
    };
  });
}
