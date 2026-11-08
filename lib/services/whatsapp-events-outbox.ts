/**
 * Sends Mega Events' queued order updates (spec docs/superpowers/specs/2026-11-08-whatsapp-mega-events-design.md,
 * section 9). Each pending wa_outbox row whose time came goes through the pure outboxDecision, then the approved
 * template through sendTemplate (origin automation, the order's id on the message). Trial (D-7): while
 * NEXT_SECRET_WA_EVENTS_TRIAL_PHONE is set every message goes THERE with the customer's parameters. A failed send is
 * tried twice more, then left failed with Meta's error. Dependencies are injected - the selftest runs it over stubs.
 * Callers: the cron waEventsOutbox (every 2 minutes) and the staff actions (drainOutboxFor, right after their write).
 */
import { supabase } from "@/lib/supabase-server";
import { MEGA_EVENTS_COMPANY_ID } from "@/lib/company-ids";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { hasHotelInfo, normalizeReservationEventOrderInfo } from "@/lib/utils";
import { shortPlace } from "@/lib/lodging";
import { whatsappPhone } from "@/lib/tours/cases";
import { outboxDecision, TEMPLATE_LANGUAGE, type OrderLite, type OutboxKind } from "@/lib/whatsapp/events/outbox";
import { documentsOf, paramsFor, type ParamSource } from "@/lib/whatsapp/events/params";
import { flightFacts, flightParams } from "@/lib/whatsapp/events/schedule";
import { sendTemplate } from "@/lib/services/whatsapp-cloud";
import { companyById, listTemplates } from "@/lib/services/whatsapp-db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Tries of one row: the first and two more, then it stays failed. */
export const MAX_ATTEMPTS = 3;
const BATCH = 100;
/** myt-main's resume link (/api/find-order) works for 25 hours after the order was created. */
const RESUME_WINDOW_MS = 25 * 60 * 60 * 1000;
export const TRIAL_REASON = "נשלח לטלפון הניסיון";

export type DrainRow = {
  id: string;
  kind: OutboxKind;
  reservationId: number;
  dueAt: string;
  fromStatus: string | null;
  createdAt: string;
  status: string;
  attempts: number;
};
export type FinishPatch = { status: "pending" | "sent" | "skipped" | "failed"; reason: string | null; sentTo: string | null; attempts: number };

export interface DrainDeps {
  now(): Date;
  env(): { auto: boolean; trialPhone: string | null };
  pendingRows(opts: { reservationId?: number; limit: number; now: Date }): Promise<DrainRow[]>;
  approved(): Promise<Set<string>>;
  load(reservationId: number): Promise<{ order: OrderLite; source: ParamSource } | null>;
  newerPaidSameEvent(order: OrderLite): Promise<boolean>;
  send(to: string, template: string, params: string[], reservationId: number): Promise<{ ok: true } | { ok: false; error: string }>;
  finish(id: string, patch: FinishPatch): Promise<void>;
}

export type DrainSummary = { sent: number; skipped: number; failed: number; waiting: number; lines: { id: string; kind: string; reservationId: number; result: string }[] };

export async function drainOutbox(opts: { budgetMs: number; dryRun: boolean; reservationId?: number }, deps: DrainDeps = realDrainDeps()): Promise<DrainSummary> {
  const started = Date.now();
  const now = deps.now();
  const env = deps.env();
  const out: DrainSummary = { sent: 0, skipped: 0, failed: 0, waiting: 0, lines: [] };
  const rows = await deps.pendingRows({ reservationId: opts.reservationId, limit: BATCH, now });
  if (rows.length === 0) return out;
  const approved = await deps.approved();
  for (const row of rows) {
    if (Date.now() - started > opts.budgetMs) break;
    const loaded = await deps.load(row.reservationId);
    if (!loaded) {
      out.skipped += 1;
      out.lines.push({ id: row.id, kind: row.kind, reservationId: row.reservationId, result: "skip: ההזמנה לא נמצאה" });
      if (!opts.dryRun) await deps.finish(row.id, { status: "skipped", reason: "ההזמנה לא נמצאה", sentTo: null, attempts: row.attempts });
      continue;
    }
    const newer = row.kind === "payment_failed" ? await deps.newerPaidSameEvent(loaded.order) : false;
    const decision = outboxDecision(row, loaded.order, newer, { auto: env.auto, approved }, now);
    if (decision.act === "wait") {
      out.waiting += 1;
      out.lines.push({ id: row.id, kind: row.kind, reservationId: row.reservationId, result: "wait" });
      continue;
    }
    if (decision.act === "skip") {
      out.skipped += 1;
      out.lines.push({ id: row.id, kind: row.kind, reservationId: row.reservationId, result: `skip: ${decision.reason}` });
      if (!opts.dryRun) await deps.finish(row.id, { status: "skipped", reason: decision.reason, sentTo: null, attempts: row.attempts });
      continue;
    }
    const trial = env.trialPhone ? whatsappPhone(env.trialPhone) : null;
    const to = trial ?? decision.to;
    out.lines.push({ id: row.id, kind: row.kind, reservationId: row.reservationId, result: "send" });
    if (opts.dryRun) continue;
    const answer = await deps.send(to, row.kind, paramsFor(row.kind, loaded.source), row.reservationId);
    const attempts = row.attempts + 1;
    if (answer.ok) {
      out.sent += 1;
      await deps.finish(row.id, { status: "sent", reason: trial ? TRIAL_REASON : null, sentTo: to, attempts });
    } else {
      const final = attempts >= MAX_ATTEMPTS;
      if (final) out.failed += 1;
      await deps.finish(row.id, { status: final ? "failed" : "pending", reason: answer.error, sentTo: to, attempts });
    }
  }
  return out;
}

/** Right after a staff write: that order's rows leave now; a failure never fails the staff action. */
export async function drainOutboxFor(reservationId: number): Promise<void> {
  try {
    await drainOutbox({ budgetMs: 8000, dryRun: false, reservationId });
  } catch (e) {
    console.warn(`whatsapp-events-outbox: drain of reservation ${reservationId} failed:`, e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------- the real dependencies

type OrderRow = {
  id: number;
  status: string | null;
  is_deleted: string | null;
  whatsapp_off_at: string | null;
  main_contact_phone_number: string | null;
  main_contact_phone_key: string | null;
  main_contact_first_name: string | null;
  event_id: number | null;
  created_at: string;
  flight_order_info: { outbound?: unknown } | null;
  hotel_order_info: unknown;
  hotel_segments: unknown[] | null;
  offline_flight_id: number | null;
  offline_hotel_id: number | null;
  event_order_info: unknown;
};
type EventRow = { id: number; name: string | null; date: string | null; location: { name?: string } | null; event_location: { name?: string } | null };

const ORDER_COLUMNS =
  "id, status, is_deleted, whatsapp_off_at, main_contact_phone_number, main_contact_phone_key, main_contact_first_name, event_id, created_at, flight_order_info, hotel_order_info, hotel_segments, offline_flight_id, offline_hotel_id, event_order_info";

async function itineraryGroupOf(id: number): Promise<string | null> {
  const { data, error } = await db.from("reservations").select("itinerary_group").eq("id", id).maybeSingle();
  if (error) return null; // the Euro Trip columns may not be migrated: no group
  return (data as { itinerary_group: string | null } | null)?.itinerary_group ?? null;
}

/** The order's shape as the messages need it: its state, its event's label, what the mail carries. Exported for E3. */
export async function loadOrderForMessage(reservationId: number): Promise<{ order: OrderLite; source: ParamSource; row: OrderRow; event: EventRow | null } | null> {
  const { data, error } = await db.from("reservations").select(ORDER_COLUMNS).eq("id", reservationId).maybeSingle();
  if (error) throw new Error(`reservations: ${error.message}`);
  const row = data as OrderRow | null;
  if (!row) return null;
  const [eventRes, sentRes, itineraryGroup, offlineFlight] = await Promise.all([
    row.event_id ? db.from("events").select("id, name, date, location, event_location").eq("id", row.event_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("wa_outbox").select("id").eq("reservation_id", row.id).eq("kind", "payment_received").eq("status", "sent").limit(1),
    itineraryGroupOf(row.id),
    row.offline_flight_id
      ? db.from("flights").select("outbound_departure_time, outbound_flight_number, outbound_departure_airport, inbound_arrival_time, is_deleted, cancelled_at").eq("id", row.offline_flight_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  const event = (eventRes.data ?? null) as EventRow | null;
  const info = normalizeReservationEventOrderInfo(row.event_order_info as never)[0];
  const eventName = (event?.name || info?.name || "").trim();
  const cityRaw = event?.event_location?.name || event?.location?.name || "";
  const city = cityRaw ? shortPlace(cityRaw) : "";
  const created = Date.parse(row.created_at);
  const fresh = Number.isFinite(created) && Date.now() - created < RESUME_WINDOW_MS;
  const order: OrderLite = {
    id: row.id,
    status: row.status ?? "",
    isDeleted: !!row.is_deleted,
    whatsappOffAt: row.whatsapp_off_at,
    itineraryGroup,
    phone: row.main_contact_phone_number,
    phoneKey: row.main_contact_phone_key ?? "",
    eventId: row.event_id,
    eventDate: event?.date ? String(event.date).slice(0, 10) : null,
    createdAt: row.created_at,
    paymentReceivedSent: ((sentRes.data ?? []) as unknown[]).length > 0,
  };
  const hasFlight = !!row.offline_flight_id || !!(row.flight_order_info && row.flight_order_info.outbound);
  const hasHotel = !!row.offline_hotel_id || hasHotelInfo(row.hotel_order_info) || (Array.isArray(row.hotel_segments) && row.hotel_segments.length > 0);
  const facts = flightFacts({ flightOrderInfo: row.flight_order_info, offline: offlineFlight.error ? null : offlineFlight.data ?? null });
  // the flight lands in the FLIGHT city (events.location), which on a two-city event is not the show's city
  const flightCity = event?.location?.name ? shortPlace(event.location.name) : city;
  const venue = await venueOf(info);
  const source: ParamSource = {
    firstName: row.main_contact_first_name,
    orderId: row.id,
    eventLabel: city && eventName ? `${eventName} ב${city}` : eventName || city,
    eventName,
    resumeUrl: row.event_id ? `${PUBLIC_SITE_URL}/order/${row.event_id}${fresh ? `?orderId=${row.id}` : ""}` : PUBLIC_SITE_URL,
    documents: documentsOf({ hasFlight, hasHotel }),
    ...(facts ? { flight: flightParams(facts, flightCity) } : {}),
    place: venue && city ? `${venue}, ${city}` : venue || city,
  };
  return { order, source, row, event };
}

/** The venue's name, only when the order's ticket comes from TixStock or LiveTickets (events carry none of their own). */
async function venueOf(info: { supplier?: string; supplier_event_id?: string } | undefined): Promise<string> {
  const supplier = (info?.supplier ?? "").toLowerCase();
  const id = info?.supplier_event_id;
  if (!id) return "";
  try {
    if (supplier === "tixstock") {
      const { data } = await db.from("tixstock_events").select("venue_name").eq("event_id", String(id)).maybeSingle();
      return ((data as { venue_name: string | null } | null)?.venue_name ?? "").trim();
    }
    if (supplier === "livetickets" && /^\d+$/.test(String(id))) {
      const { data } = await db.from("live_events").select("venues").eq("event_id", Number(id)).maybeSingle();
      const venues = (data as { venues: { name?: string }[] | null } | null)?.venues;
      return (Array.isArray(venues) ? venues[0]?.name ?? "" : "").trim();
    }
  } catch {
    // no venue is no failure: the city alone is printed
  }
  return "";
}

export function realDrainDeps(): DrainDeps {
  let company: Promise<Awaited<ReturnType<typeof companyById>>> | null = null;
  const companyOnce = () => (company ??= companyById(MEGA_EVENTS_COMPANY_ID));
  return {
    now: () => new Date(),
    env: () => ({
      auto: process.env.EVENTS_WHATSAPP_AUTO?.trim().toLowerCase() !== "off",
      trialPhone: process.env.NEXT_SECRET_WA_EVENTS_TRIAL_PHONE?.trim() || null,
    }),
    async pendingRows({ reservationId, limit, now }) {
      let query = db
        .from("wa_outbox")
        .select("id, kind, reservation_id, due_at, from_status, created_at, status, attempts")
        .eq("company_id", MEGA_EVENTS_COMPANY_ID)
        .eq("status", "pending")
        .lte("due_at", now.toISOString())
        .order("created_at")
        .limit(limit);
      if (reservationId !== undefined) query = query.eq("reservation_id", reservationId);
      const { data, error } = await query;
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return [];
        throw new Error(`wa_outbox: ${error.message}`);
      }
      return ((data ?? []) as { id: string; kind: OutboxKind; reservation_id: number; due_at: string; from_status: string | null; created_at: string; status: string; attempts: number }[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        reservationId: r.reservation_id,
        dueAt: r.due_at,
        fromStatus: r.from_status,
        createdAt: r.created_at,
        status: r.status,
        attempts: r.attempts ?? 0,
      }));
    },
    async approved() {
      const templates = await listTemplates(MEGA_EVENTS_COMPANY_ID);
      return new Set(templates.filter((t) => t.status === "APPROVED").map((t) => `${t.name}:${t.language}`));
    },
    async load(reservationId) {
      const got = await loadOrderForMessage(reservationId);
      return got ? { order: got.order, source: got.source } : null;
    },
    async newerPaidSameEvent(order) {
      if (!order.phoneKey || !order.eventId) return false;
      const { data, error } = await db
        .from("reservations")
        .select("id")
        .eq("main_contact_phone_key", order.phoneKey)
        .eq("event_id", order.eventId)
        .eq("status", "Paid")
        .is("is_deleted", null)
        .gt("created_at", order.createdAt)
        .limit(1);
      if (error) throw new Error(`reservations: ${error.message}`);
      return ((data ?? []) as unknown[]).length > 0;
    },
    async send(to, template, params, reservationId) {
      const co = await companyOnce();
      if (!co) return { ok: false, error: "Mega Events company not found" };
      const answer = await sendTemplate(co, { to, template, params, language: TEMPLATE_LANGUAGE, origin: "automation", reservationId });
      return answer.ok ? { ok: true } : { ok: false, error: answer.error };
    },
    async finish(id, patch) {
      const { error } = await db
        .from("wa_outbox")
        .update({ status: patch.status, reason: patch.reason, sent_to: patch.sentTo, attempts: patch.attempts, finished_at: patch.status === "pending" ? null : new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`wa_outbox: ${error.message}`);
    },
  };
}
