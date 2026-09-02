// Nightly base-price sync (spec docs/superpowers/specs/2026-09-02, section 3).
//
// Replaces Dor's manual round over the site: quotes every live future event
// through the shared price-quote rule and realigns base_flight_price /
// base_hotel_price to the live market, both directions.
//
//   deviation < $150            -> nothing
//   $150 <= deviation <= $400   -> base = live quote (already margined+rounded)
//   deviation > $400            -> frozen: logged as needs_review, no write
//
// Exclusions: events with a linked offline flight skip the flight component,
// offline hotel skips the hotel component (fixed inventory = the price is a
// decision, not a market read); a component whose base is 0/null has no
// component at all. Events within 45 days sync nightly; farther ones once a
// week via a deterministic id bucket. dry_run computes everything and writes
// NOTHING - not even log rows - so it is safe to run against prod from a
// preview deploy.
import { supabase } from "@/lib/supabase-server";
import { appOrigin, sendMail } from "@/lib/email";
import {
  quoteFlight,
  quoteHotel,
  SYNC_FREEZE_USD,
  SYNC_DEVIATION_USD,
} from "@/lib/services/price-quote";

// base_price_sync_log predates the generated database types - cast once at
// the boundary, same pattern as the tasks/creative-gaps actions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type SyncDecision = "skip" | "apply" | "needs_review";

/** Pure: the $150 / $400 rule, both directions. */
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

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function offlineLinkedEventIds(
  table: "offline_flights" | "offline_hotels",
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

export async function runBasePriceSync(options: {
  dryRun: boolean;
  budgetMs: number;
}): Promise<SyncSummary> {
  const start = Date.now();
  const summary: SyncSummary = {
    scanned: 0,
    applied: [],
    needsReview: [],
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

  const [offlineFlightIds, offlineHotelIds] = await Promise.all([
    offlineLinkedEventIds("offline_flights"),
    offlineLinkedEventIds("offline_hotels"),
  ]);

  const nearWindow = isoDaysFromNow(45);
  const weekday = new Date().getUTCDay();
  const candidates = ((data ?? []) as CandidateEvent[]).filter(
    (event) => event.date <= nearWindow || event.id % 7 === weekday,
  );

  for (const [index, event] of candidates.entries()) {
    // Check the deadline BEFORE starting an event so `remaining` is exact.
    if (Date.now() - start > options.budgetMs) {
      summary.remaining = candidates.length - index;
      break;
    }
    summary.scanned += 1;

    const depart = event.def_date_depart;
    const ret = event.def_date_return;
    if (!depart || !ret) continue;

    // --- Flight component ---
    const flightBase = Number(event.base_flight_price) || 0;
    const iata = event.location?.city_iata;
    if (flightBase > 0 && iata && !offlineFlightIds.has(event.id)) {
      await syncComponent(event, "flight", flightBase, summary, options.dryRun, () =>
        quoteFlight(iata, depart, ret),
      );
    }

    // --- Hotel component ---
    const hotelBase = Number(event.base_hotel_price) || 0;
    const lat = event.location?.latitude;
    const lon = event.location?.longitude;
    if (
      hotelBase > 0 &&
      typeof lat === "number" &&
      typeof lon === "number" &&
      !offlineHotelIds.has(event.id)
    ) {
      await syncComponent(event, "hotel", hotelBase, summary, options.dryRun, () =>
        quoteHotel(lat, lon, depart, ret),
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
  quote: () => Promise<{ price: number } | null>,
): Promise<void> {
  try {
    const result = await quote();
    if (!result) {
      summary.errors.push({
        eventId: event.id,
        component,
        note: "no live price found",
      });
      return;
    }

    const decision = decideSync(base, result.price);
    if (decision === "skip") return;

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
        await logRow(event.id, component, base, result.price, "applied", null);
      }
      return;
    }

    summary.needsReview.push(change);
    if (!dryRun) {
      await logRow(
        event.id,
        component,
        base,
        null,
        "needs_review",
        `change of $${Math.abs(result.price - base)} frozen (> $${SYNC_FREEZE_USD})`,
        result.price,
      );
    }
  } catch (error) {
    console.error(
      `base-price-sync: event ${event.id} ${component} failed`,
      JSON.stringify(error),
    );
    summary.errors.push({
      eventId: event.id,
      component,
      note: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function logRow(
  eventId: number,
  component: string,
  oldPrice: number,
  newPrice: number | null,
  status: "applied" | "needs_review" | "error",
  note: string | null,
  livePriceOverride?: number,
): Promise<void> {
  const { error } = await db.from("base_price_sync_log").insert({
    event_id: eventId,
    component,
    old_price: oldPrice,
    new_price: newPrice,
    live_price: livePriceOverride ?? newPrice,
    status,
    note,
  });
  if (error) {
    // The sync already happened - a logging failure must not fail the run.
    console.error("base-price-sync: log insert failed", JSON.stringify(error));
  }
}
