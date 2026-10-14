/**
 * Every order of a window for the Executive funnel and the Traffic tab (spec 2026-10-14 section 3) -
 * any status, not soft-deleted, Israel calendar days, each with its source (`orderSourceOf`).
 * Session-free; the callers guard. Throws on a read error (an empty funnel would read as "no orders").
 */
import { mdb } from "@/lib/services/marketing-db";
import { fetchPaged } from "@/lib/supabase-paged";
import { readTouches } from "@/lib/services/marketing-purchases";
import { addDays, israelDayOf, israelDayStartUtc } from "@/lib/marketing/range";
import { orderSourceOf } from "@/lib/marketing/order-source";
import type { FunnelOrder } from "@/lib/marketing/funnel";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import type { ReservationEventOrderInfo } from "@/types/reservation.types";

/** Orders read per window. Past it the read throws - a funnel missing rows is worse than none. */
const ORDERS_MAX = 20_000;

type OrderRow = { id: number; created_at: string; status: string | null; aff_partner_tracking_code: string | null; event_order_info: ReservationEventOrderInfo | null };

const ticketsOf = (info: ReservationEventOrderInfo | null): number =>
  normalizeReservationEventOrderInfo(info).reduce((n, e) => n + (Number(e?.number_of_ticket) || 0), 0);

export async function funnelOrders(since: string, until: string): Promise<FunnelOrder[]> {
  const { rows, truncated, error } = await fetchPaged<OrderRow>(
    () => mdb.from("reservations").select("id, created_at, status, aff_partner_tracking_code, event_order_info").is("is_deleted", null).gte("created_at", israelDayStartUtc(since)).lt("created_at", israelDayStartUtc(addDays(until, 1))).order("id"),
    ORDERS_MAX,
  );
  if (error) throw new Error(`reservations read: ${error.message}`);
  if (truncated) throw new Error(`reservations read: more than ${ORDERS_MAX} orders in ${since}..${until} - narrow the range`);
  const touches = await readTouches(rows.map((r) => r.id));
  return rows.map((r) => ({
    day: israelDayOf(r.created_at),
    paid: (r.status ?? "").trim().toLowerCase() === "paid",
    tickets: ticketsOf(r.event_order_info),
    source: orderSourceOf({ touches: touches.get(r.id) ?? [], partnerCode: r.aff_partner_tracking_code }),
  }));
}
