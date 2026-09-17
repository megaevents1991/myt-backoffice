// Nightly base-price sync (spec docs/superpowers/specs/2026-09-02, section 3;
// reworked 2026-09-07 after the first prod run).
//
// Replaces Dor's manual round over the site: quotes every live future event
// through the shared price-quote rule and realigns base_flight_price /
// base_hotel_price to the live market, both directions.
//
//   deviation < $20             -> skipped (logged, so the screen shows WHY
//                                  an event did not move)
//   $20 <= deviation <= $400    -> base = live quote (already margined+rounded)
//   deviation > $400            -> frozen: logged as needs_review, no write
//
// Exclusions: events with a linked offline flight (`flights.event_ids`) skip
// the flight component, offline hotel skips the hotel component (fixed
// inventory = the price is a decision, not a market read); a component whose
// base is 0/null has no component at all.
//
// Coverage: the 270s budget fits ~40-60 events a night, not the ~440 live
// ones, so the run is a ROTATION. Every event's last visit is the newest log
// row it has (skips count), and each night takes the least-recently-visited
// first, ALTERNATING between the next-45-days queue and the farther one
// (base-price-rotation.ts). Until 2026-09-17 the near queue simply went first: 110 near
// events at ~24 visits a night never emptied, so 328 farther events were never visited. dry_run computes everything and writes
// NOTHING - not even log rows - so it is safe to run against prod from a
// preview deploy (it also does not advance the rotation).
import { supabase } from "@/lib/supabase-server";
import { orderForRotation } from "@/lib/services/base-price-rotation";
import { appOrigin, sendMail } from "@/lib/email";
import {
  describeQuote,
  quoteFlight,
  quoteHotel,
  SYNC_FREEZE_USD,
  SYNC_DEVIATION_USD,
  type QuoteResult,
} from "@/lib/services/price-quote";

// base_price_sync_log predates the generated database types - cast once at
// the boundary, same pattern as the tasks/creative-gaps actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type SyncDecision = "skip" | "apply" | "needs_review";
export type SyncLogStatus = "applied" | "needs_review" | "skipped" | "error";

/** Pure: the $20 / $400 rule, both directions. */
export function decideSync(base: number, live: number): SyncDecision {
  const delta = Math.abs(live - base);
  if (delta < SYNC_DEVIATION_USD) return "skip";
  if (delta > SYNC_FREEZE_USD) return "needs_review";
  return "apply";
}

export interface SyncChange {
  eventId: number;
  name: string;
  component: "flight" | "hotel";
  oldPrice: number;
  livePrice: number;
}

export interface SyncSummary {
  scanned: number;
  applied: SyncChange[];
  needsReview: SyncChange[];
  skipped: number;
  errors: { eventId: number; component: string; note: string }[];
  remaining: number;
  dryRun: boolean;
}

interface CandidateEvent {
  id: number;
  name: string;
  date: string;
  def_date_depart: string | null;
  def_date_return: string | null;
  location: {
    latitude?: number;
    longitude?: number;
    city_iata?: string;
  } | null;
  base_flight_price: number | null;
  base_hotel_price: number | null;
}

const NEAR_WINDOW_DAYS = 45;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function offlineLinkedEventIds(
  table: "flights" | "offline_hotels",
): Promise<Set<number>> {
  const { data, error } = await db.from(table).select("event_ids");
  if (error) {
    console.error(`base-price-sync: ${table} exclusion load failed`, JSON.stringify(error));
    return new Set();
  }
  const ids = new Set<number>();
  for (const row of (data ?? []) as { event_ids: number[] | null }[]) {
    for (const id of row.event_ids ?? []) ids.add(Number(id));
  }
  return ids;
}

/** Newest log row per event = when the rotation last visited it. */
async function lastVisitByEvent(): Promise<Map<number, string>> {
  const { data, error } = await db
    .from("base_price_sync_log")
    .select("event_id,created_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.error("base-price-sync: last-visit load failed", JSON.stringify(error));
    return new Map();
  }
  const seen = new Map<number, string>();
  for (const row of (data ?? []) as { event_id: number; created_at: string }[]) {
    if (!seen.has(row.event_id)) seen.set(row.event_id, row.created_at);
  }
  return seen;
}

// The visiting order is a pure rule of its own - lib/services/base-price-rotation.ts.
export { orderForRotation };

function hasFlightComponent(event: CandidateEvent, offlineFlightIds: Set<number>): boolean {
  return (
    (Number(event.base_flight_price) || 0) > 0 &&
    !!event.location?.city_iata &&
    !offlineFlightIds.has(event.id)
  );
}

function hasHotelComponent(event: CandidateEvent, offlineHotelIds: Set<number>): boolean {
  return (
    (Number(event.base_hotel_price) || 0) > 0 &&
    typeof event.location?.latitude === "number" &&
    typeof event.location?.longitude === "number" &&
    !offlineHotelIds.has(event.id)
  );
}

export async function runBasePriceSync(options: {
  dryRun: boolean;
  budgetMs: number;
}): Promise<SyncSummary> {
  const start = Date.now();
  const summary: SyncSummary = {
    scanned: 0,
    applied: [],
    needsReview: [],
    skipped: 0,
    errors: [],
    remaining: 0,
    dryRun: options.dryRun,
  };

  const { data, error } = await db
    .from("events")
    .select(
      "id,name,date,def_date_depart,def_date_return,location,base_flight_price,base_hotel_price",
    )
    .is("is_deleted", null)
    .gte("date", isoDaysFromNow(2)) // sync until 2 days before the event
    .order("date");
  if (error) {
    console.error("base-price-sync: candidate query failed", JSON.stringify(error));
    return summary;
  }

  const [offlineFlightIds, offlineHotelIds, lastVisit] = await Promise.all([
    offlineLinkedEventIds("flights"),
    offlineLinkedEventIds("offline_hotels"),
    lastVisitByEvent(),
  ]);

  // Only events with something to quote take a slot in the rotation.
  const quotable = ((data ?? []) as CandidateEvent[]).filter(
    (event) =>
      !!event.def_date_depart &&
      !!event.def_date_return &&
      (hasFlightComponent(event, offlineFlightIds) ||
        hasHotelComponent(event, offlineHotelIds)),
  );
  const candidates = orderForRotation(
    quotable,
    lastVisit,
    isoDaysFromNow(NEAR_WINDOW_DAYS),
  );

  for (const [index, event] of candidates.entries()) {
    // Check the deadline BEFORE starting an event so `remaining` is exact.
    if (Date.now() - start > options.budgetMs) {
      summary.remaining = candidates.length - index;
      break;
    }
    summary.scanned += 1;

    const depart = event.def_date_depart as string;
    const ret = event.def_date_return as string;

    if (hasFlightComponent(event, offlineFlightIds)) {
      const iata = event.location?.city_iata as string;
      await syncComponent(
        event,
        "flight",
        Number(event.base_flight_price),
        summary,
        options.dryRun,
        () => quoteFlight(iata, depart, ret),
      );
    }

    if (hasHotelComponent(event, offlineHotelIds)) {
      const lat = event.location?.latitude as number;
      const lon = event.location?.longitude as number;
      await syncComponent(
        event,
        "hotel",
        Number(event.base_hotel_price),
        summary,
        options.dryRun,
        () => quoteHotel(lat, lon, depart, ret),
      );
    }
  }

  if (!options.dryRun) await sendSummaryEmail(summary);
  return summary;
}

/** Daily one-liner (decision 5). Only when something happened; never fatal. */
async function sendSummaryEmail(summary: SyncSummary): Promise<void> {
  const total =
    summary.applied.length + summary.needsReview.length + summary.errors.length;
  if (total === 0) return;
  const to = process.env.NEXT_SECRET_ADMIN_EMAIL;
  if (!to) return;
  try {
    const line = (change: SyncChange) =>
      `<li>#${change.eventId} ${change.name} · ${change.component}: $${change.oldPrice} → $${change.livePrice}</li>`;
    await sendMail({
      to,
      subject: `Base price sync: ${summary.applied.length} applied · ${summary.needsReview.length} for review · ${summary.errors.length} errors`,
      html: [
        `<p><a href="${appOrigin()}/price-changes">Open the price-changes screen</a></p>`,
        `<p>Scanned ${summary.scanned} events · ${summary.skipped} components within $${SYNC_DEVIATION_USD} · ${summary.remaining} events wait for the next rotation.</p>`,
        summary.applied.length
          ? `<p><b>Applied</b></p><ul>${summary.applied.map(line).join("")}</ul>`
          : "",
        summary.needsReview.length
          ? `<p><b>Needs review (frozen &gt; $${SYNC_FREEZE_USD})</b></p><ul>${summary.needsReview.map(line).join("")}</ul>`
          : "",
        summary.errors.length
          ? `<p><b>Errors</b></p><ul>${summary.errors.map((e) => `<li>#${e.eventId} ${e.component}: ${e.note}</li>`).join("")}</ul>`
          : "",
      ].join(""),
    });
  } catch (error) {
    console.error("base-price-sync: summary email failed", JSON.stringify(error));
  }
}

async function syncComponent(
  event: CandidateEvent,
  component: "flight" | "hotel",
  base: number,
  summary: SyncSummary,
  dryRun: boolean,
  quote: () => Promise<QuoteResult>,
): Promise<void> {
  try {
    const result = await quote();
    if (!result) {
      const note = "no live price found";
      summary.errors.push({ eventId: event.id, component, note });
      if (!dryRun) {
        await logRow({ eventId: event.id, component, oldPrice: base, status: "error", note });
      }
      return;
    }

    const decision = decideSync(base, result.price);
    const arithmetic = describeQuote(result);
    const delta = result.price - base;
    const signed = `${delta >= 0 ? "+" : "-"}$${Math.abs(delta)}`;

    if (decision === "skip") {
      summary.skipped += 1;
      if (!dryRun) {
        await logRow({
          eventId: event.id,
          component,
          oldPrice: base,
          livePrice: result.price,
          status: "skipped",
          note: `${signed} is under the $${SYNC_DEVIATION_USD} threshold · ${arithmetic}`,
        });
      }
      return;
    }

    const change: SyncChange = {
      eventId: event.id,
      name: event.name,
      component,
      oldPrice: base,
      livePrice: result.price,
    };

    if (decision === "apply") {
      summary.applied.push(change);
      if (!dryRun) {
        const column =
          component === "flight" ? "base_flight_price" : "base_hotel_price";
        const { error } = await db
          .from("events")
          .update({ [column]: result.price })
          .eq("id", event.id);
        if (error) throw error;
        await logRow({
          eventId: event.id,
          component,
          oldPrice: base,
          newPrice: result.price,
          livePrice: result.price,
          status: "applied",
          note: `${signed} · ${arithmetic}`,
        });
      }
      return;
    }

    summary.needsReview.push(change);
    if (!dryRun) {
      await logRow({
        eventId: event.id,
        component,
        oldPrice: base,
        livePrice: result.price,
        status: "needs_review",
        note: `${signed} frozen (> $${SYNC_FREEZE_USD}) · ${arithmetic}`,
      });
    }
  } catch (error) {
    console.error(
      `base-price-sync: event ${event.id} ${component} failed`,
      JSON.stringify(error),
    );
    const note = error instanceof Error ? error.message : "unknown error";
    summary.errors.push({ eventId: event.id, component, note });
    if (!dryRun) {
      await logRow({ eventId: event.id, component, oldPrice: base, status: "error", note });
    }
  }
}

async function logRow(row: {
  eventId: number;
  component: string;
  oldPrice: number;
  newPrice?: number | null;
  livePrice?: number | null;
  status: SyncLogStatus;
  note: string | null;
}): Promise<void> {
  const { error } = await db.from("base_price_sync_log").insert({
    event_id: row.eventId,
    component: row.component,
    old_price: row.oldPrice,
    new_price: row.newPrice ?? null,
    live_price: row.livePrice ?? null,
    status: row.status,
    note: row.note,
  });
  if (error) {
    // The sync already happened - a logging failure must not fail the run.
    console.error("base-price-sync: log insert failed", JSON.stringify(error));
  }
}
