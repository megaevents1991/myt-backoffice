/**
 * Mega Events' messages by date (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md, section 11):
 * the hourly cron waEventsSchedule enqueues into wa_outbox the date kinds whose slot falls in this Israel hour - the
 * flight reminder (09:00, 3 days before the outbound), "the event is today" (10:00) and, only while
 * EVENTS_WA_AFTER_TRIP=on, "how was it" (11:00 the day after the return). The 2-minute drain sends them through the same
 * decision as every order update. Dependencies are injected - the selftest runs it over stubs.
 */
import { supabase } from "@/lib/supabase-server";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { fetchPaged } from "@/lib/supabase-paged";
import { israelToday } from "@/lib/marketing/range";
import { dueThisHour, flightFacts, lateBooking, slotFor, type FlightFacts, type ScheduleKind } from "@/lib/whatsapp/events/schedule";
import { accountOfCompany } from "@/lib/services/whatsapp-db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ScheduleCandidate = {
  id: number;
  createdAt: string;
  eventDate: string | null;
  itineraryGroup: string | null;
  /** A payment_received of the order went out: it was paid after launch (D-3 - only reminders reach older ones). */
  paymentReceivedSent: boolean;
  flight: FlightFacts | null;
};
export type QueueRow = { kind: ScheduleKind; reservationId: number; dueAt: string; dedupeKey: string };

export interface ScheduleDeps {
  afterTripOn(): boolean;
  candidates(now: Date): Promise<ScheduleCandidate[]>;
  enqueue(rows: QueueRow[]): Promise<void>;
}

export type ScheduleSummary = { enqueued: { kind: string; reservationId: number }[]; skipped: { reservationId: number; why: string }[] };

/** The day a slot names in its dedupe key: the departure day, the event day, the "how was it" day. */
function slotDay(kind: ScheduleKind, c: ScheduleCandidate, slot: string): string {
  if (kind === "flight_reminder" && c.flight) return c.flight.departureLocal.slice(0, 10);
  if (kind === "event_today" && c.eventDate) return c.eventDate.slice(0, 10);
  return israelToday(new Date(slot));
}

export async function runEventsSchedule(opts: { dryRun: boolean; now?: Date }, deps: ScheduleDeps = realScheduleDeps()): Promise<ScheduleSummary> {
  const now = opts.now ?? new Date();
  const kinds: ScheduleKind[] = ["flight_reminder", "event_today", ...(deps.afterTripOn() ? (["after_trip"] as const) : [])];
  const out: ScheduleSummary = { enqueued: [], skipped: [] };
  const rows: QueueRow[] = [];
  for (const c of await deps.candidates(now)) {
    for (const kind of kinds) {
      const slot = slotFor(kind, { flight: c.flight, eventDate: c.eventDate });
      if (!slot || !dueThisHour(slot, now)) continue;
      if (c.itineraryGroup) {
        out.skipped.push({ reservationId: c.id, why: "טיול יורו - לא בסבב הזה" });
        continue;
      }
      if (kind === "flight_reminder" && lateBooking(c.createdAt, slot)) {
        out.skipped.push({ reservationId: c.id, why: "הזמנה מאוחרת" });
        continue;
      }
      if (kind === "after_trip" && !c.paymentReceivedSent) {
        out.skipped.push({ reservationId: c.id, why: "הזמנה מלפני ההפעלה" });
        continue;
      }
      rows.push({ kind, reservationId: c.id, dueAt: slot, dedupeKey: `${kind}:${c.id}:${slotDay(kind, c, slot)}` });
      out.enqueued.push({ kind, reservationId: c.id });
    }
  }
  if (!opts.dryRun && rows.length) await deps.enqueue(rows);
  return out;
}

// ---------------------------------------------------------------- the real dependencies

/** Events from this many days ago (a return a week after the show) to this many ahead (3 days before the flight). */
const DAYS_BACK = 8;
const DAYS_AHEAD = 5;
const IN_CHUNK = 200;
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += IN_CHUNK) out.push(xs.slice(i, i + IN_CHUNK));
  return out;
};
const shift = (day: string, n: number): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

type ResRow = { id: number; created_at: string; event_id: number | null; offline_flight_id: number | null; flight_order_info: unknown };
type FlightRow = { id: number; outbound_departure_time: string | null; outbound_flight_number: string | null; outbound_departure_airport: string | null; inbound_arrival_time: string | null; is_deleted: unknown; cancelled_at: string | null };

export function realScheduleDeps(): ScheduleDeps {
  return {
    afterTripOn: () => process.env.EVENTS_WA_AFTER_TRIP?.trim().toLowerCase() === "on",
    async candidates(now) {
      // nothing to queue before the number is connected (the trigger follows the same rule)
      const account = await accountOfCompany(MEGA_EVENTS_COMPANY_ID);
      if (!account?.isActive) return [];
      const today = israelToday(now);
      const { data: events, error: eventsError } = await db.from("events").select("id, date").gte("date", shift(today, -DAYS_BACK)).lte("date", shift(today, DAYS_AHEAD));
      if (eventsError) throw new Error(`events: ${eventsError.message}`);
      const eventDate = new Map(((events ?? []) as { id: number; date: string }[]).map((e) => [e.id, String(e.date).slice(0, 10)]));
      if (eventDate.size === 0) return [];
      const orders: ResRow[] = [];
      for (const part of chunks([...eventDate.keys()])) {
        const { rows, error } = await fetchPaged<ResRow>(
          () => db.from("reservations").select("id, created_at, event_id, offline_flight_id, flight_order_info").in("event_id", part).eq("status", "Paid").is("is_deleted", null).order("id"),
          20_000,
        );
        if (error) throw new Error(`reservations: ${error.message}`);
        orders.push(...rows);
      }
      if (orders.length === 0) return [];
      const ids = orders.map((o) => o.id);
      const flightIds = [...new Set(orders.map((o) => o.offline_flight_id).filter((x): x is number => typeof x === "number"))];
      const flights = new Map<number, FlightRow>();
      for (const part of chunks(flightIds)) {
        const { data, error } = await db.from("flights").select("id, outbound_departure_time, outbound_flight_number, outbound_departure_airport, inbound_arrival_time, is_deleted, cancelled_at").in("id", part);
        if (error) throw new Error(`flights: ${error.message}`);
        for (const f of (data ?? []) as FlightRow[]) flights.set(f.id, f);
      }
      const paid = new Set<number>();
      const groups = new Map<number, string>();
      for (const part of chunks(ids)) {
        const { data, error } = await db.from("wa_outbox").select("reservation_id").in("reservation_id", part).eq("kind", "payment_received").eq("status", "sent");
        if (error) throw new Error(`wa_outbox: ${error.message}`);
        for (const r of (data ?? []) as { reservation_id: number }[]) paid.add(r.reservation_id);
        // the Euro Trip columns may not be migrated: a failed read = no groups
        const g = await db.from("reservations").select("id, itinerary_group").in("id", part).not("itinerary_group", "is", null);
        if (!g.error) for (const r of (g.data ?? []) as { id: number; itinerary_group: string }[]) groups.set(r.id, r.itinerary_group);
      }
      return orders.map((o) => ({
        id: o.id,
        createdAt: o.created_at,
        eventDate: o.event_id ? eventDate.get(o.event_id) ?? null : null,
        itineraryGroup: groups.get(o.id) ?? null,
        paymentReceivedSent: paid.has(o.id),
        flight: flightFacts({ flightOrderInfo: o.flight_order_info, offline: o.offline_flight_id ? flights.get(o.offline_flight_id) ?? null : null }),
      }));
    },
    async enqueue(rows) {
      const { error } = await db.from("wa_outbox").upsert(
        rows.map((r) => ({ company_id: MEGA_EVENTS_COMPANY_ID, reservation_id: r.reservationId, kind: r.kind, dedupe_key: r.dedupeKey, due_at: r.dueAt })),
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
      if (error) throw new Error(`wa_outbox: ${error.message}`);
    },
  };
}
