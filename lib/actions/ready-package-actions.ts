"use server";

// Ready package ("חבילה מוכנה") - what the event editor's card calls.
// Spec: docs/superpowers/specs/2026-10-04-ready-package-design.md.
// Every action is staff-only, audited, and answers `{ ok: false, error }`
// instead of throwing (Next hides a thrown action error in production).

import { requireStaff } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { revalidateMain } from "@/lib/revalidate-main";
import { supabase, supabaseTyped } from "@/lib/supabase-server";
import {
  adoptPackage,
  loadHousePackageForEvent,
  loadReadyEvent,
  refreshHousePackage,
  setEventReady,
  toReadyView,
} from "@/lib/services/ready-package";
import {
  READY_MAX_TRAVELERS_CAP,
  canGoLive,
  flightLabel,
  hotelLabel,
  specFromComposition,
  type CompositionLike,
  type FlightLike,
  type HotelLike,
} from "@/lib/ready-package";
import {
  READY_PACKAGE_MODES,
  type ReadyPackageMode,
  type ReadyPackageView,
} from "@/types/ready-package.types";

/** A prepared package of this event that could become its ready package. */
export type ReadyCandidate = {
  id: number;
  createdAt: string;
  travelers: number;
  partnerCode: string | null;
  ticket: string;
  flight: string;
  hotel: string;
  /** Null when it can be used; otherwise why not (a piece left for the customer to pick). */
  problem: string | null;
};

export type ReadyCardData = {
  view: ReadyPackageView | null;
  candidates: ReadyCandidate[];
};

export type ReadyActionResult =
  | { ok: true; data: ReadyCardData; message?: string }
  | { ok: false; error: string };

const CANDIDATES_MAX = 30;

async function cardData(eventId: number): Promise<ReadyCardData> {
  const [event, pkg, candidatesRes] = await Promise.all([
    loadReadyEvent(eventId),
    loadHousePackageForEvent(eventId),
    supabase
      .from("prepared_packages")
      .select(
        "id, created_at, num_travelers, partner_tracking_code, event_order_info, flight_order_info, flight_skipped, hotel_order_info, hotel_skipped",
      )
      .eq("event_id", eventId)
      .eq("kind", "partner")
      .order("created_at", { ascending: false })
      .limit(CANDIDATES_MAX),
  ]);
  if (candidatesRes.error) {
    console.error("ready-package: candidates failed", JSON.stringify(candidatesRes.error));
  }
  const rows = (candidatesRes.data ?? []) as unknown as (CompositionLike & {
    id: number;
    created_at: string;
    partner_tracking_code: string | null;
  })[];
  const candidates: ReadyCandidate[] = rows.map((row) => {
    const parsed = specFromComposition(row);
    return {
      id: row.id,
      createdAt: row.created_at,
      travelers: row.num_travelers,
      partnerCode: row.partner_tracking_code,
      ticket: row.event_order_info?.category ?? "",
      flight: flightLabel(row.flight_order_info as FlightLike | null, row.flight_skipped),
      hotel: hotelLabel(row.hotel_order_info as HotelLike | null, row.hotel_skipped),
      problem: parsed.ok ? null : parsed.error,
    };
  });
  return { view: event && pkg ? toReadyView(pkg, event) : null, candidates };
}

const validId = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function getReadyPackageCard(eventId: number): Promise<ReadyActionResult> {
  await requireStaff();
  const id = validId(eventId);
  if (!id) return { ok: false, error: "Invalid event." };
  try {
    return { ok: true, data: await cardData(id) };
  } catch (error) {
    console.error("getReadyPackageCard:", error);
    return { ok: false, error: "Could not load the ready package." };
  }
}

/** Makes a prepared package (built in the portal wizard) this event's ready package. */
export async function adoptReadyPackage(
  eventId: number,
  sourcePackageId: number,
): Promise<ReadyActionResult> {
  const session = await requireStaff();
  const id = validId(eventId);
  const sourceId = validId(sourcePackageId);
  if (!id || !sourceId) return { ok: false, error: "Invalid package." };
  try {
    const result = await adoptPackage({ eventId: id, sourcePackageId: sourceId, createdBy: session.sub });
    if (!result.ok) return result;
    await logAudit({
      action: "ready_package.adopted",
      entityType: "event",
      entityId: id,
      metadata: { package_id: result.row.id, source_package_id: sourceId },
    });
    await revalidateMain();
    return { ok: true, data: await cardData(id) };
  } catch (error) {
    console.error("adoptReadyPackage:", error);
    return { ok: false, error: "Could not save the ready package." };
  }
}

/**
 * Prices ONE party size (a flight search and a hotel search through main).
 * The card calls it once per size - a whole package in one call would not fit
 * a function's time window.
 */
export async function buildReadyPackageSize(eventId: number, size: number): Promise<ReadyActionResult> {
  await requireStaff();
  const id = validId(eventId);
  const pax = Math.floor(Number(size));
  if (!id || !Number.isInteger(pax) || pax < 1 || pax > READY_MAX_TRAVELERS_CAP) {
    return { ok: false, error: "Invalid party size." };
  }
  try {
    const pkg = await loadHousePackageForEvent(id);
    if (!pkg) return { ok: false, error: "This event has no ready package." };
    const summary = await refreshHousePackage(pkg, { sizes: [pax] });
    const failure = summary.failures.find((f) => f.size === pax);
    return {
      ok: true,
      data: await cardData(id),
      message: failure ? `${pax} travellers: ${failure.reason}` : undefined,
    };
  } catch (error) {
    console.error("buildReadyPackageSize:", error);
    return { ok: false, error: `Could not price ${pax} travellers.` };
  }
}

export async function setReadyPackageMode(eventId: number, mode: ReadyPackageMode): Promise<ReadyActionResult> {
  await requireStaff();
  const id = validId(eventId);
  if (!id || !(READY_PACKAGE_MODES as readonly string[]).includes(mode)) {
    return { ok: false, error: "Invalid mode." };
  }
  try {
    const [event, pkg] = await Promise.all([loadReadyEvent(id), loadHousePackageForEvent(id)]);
    if (!event || !pkg) return { ok: false, error: "This event has no ready package." };
    const defaultSize = pkg.spec?.defaultTravelers ?? pkg.num_travelers;
    if (mode === "live" && !canGoLive(pkg.variants, defaultSize)) {
      return {
        ok: false,
        error: `The package has no price for ${defaultSize} travellers yet - refresh it before going live.`,
      };
    }
    const before = event.ready_package_mode;
    await setEventReady(id, { token: pkg.share_token, mode });
    await logAudit({
      action: "ready_package.mode",
      entityType: "event",
      entityId: id,
      changes: { ready_package_mode: { from: before, to: mode } },
      metadata: { package_id: pkg.id },
    });
    await revalidateMain();
    return { ok: true, data: await cardData(id) };
  } catch (error) {
    console.error("setReadyPackageMode:", error);
    return { ok: false, error: "Could not change the mode." };
  }
}

export async function setReadyPackageOptions(
  eventId: number,
  options: { maxTravelers?: number; allowEdit?: boolean },
): Promise<ReadyActionResult> {
  await requireStaff();
  const id = validId(eventId);
  if (!id) return { ok: false, error: "Invalid event." };
  const update: { max_travelers?: number; allow_edit?: boolean } = {};
  if (options.maxTravelers !== undefined) {
    const max = Math.floor(Number(options.maxTravelers));
    if (!Number.isInteger(max) || max < 1 || max > READY_MAX_TRAVELERS_CAP) {
      return { ok: false, error: `Max travellers is 1 to ${READY_MAX_TRAVELERS_CAP}.` };
    }
    update.max_travelers = max;
  }
  if (options.allowEdit !== undefined) update.allow_edit = options.allowEdit === true;
  if (Object.keys(update).length === 0) return { ok: false, error: "Nothing to change." };
  try {
    const pkg = await loadHousePackageForEvent(id);
    if (!pkg) return { ok: false, error: "This event has no ready package." };
    const defaultSize = pkg.spec?.defaultTravelers ?? pkg.num_travelers;
    if (update.max_travelers !== undefined && update.max_travelers < defaultSize) {
      return {
        ok: false,
        error: `The package was built for ${defaultSize} travellers - the max cannot be lower.`,
      };
    }
    const { error } = await supabaseTyped.from("prepared_packages").update(update).eq("id", pkg.id);
    if (error) {
      console.error("setReadyPackageOptions:", JSON.stringify(error));
      return { ok: false, error: "Could not save." };
    }
    await logAudit({
      action: "ready_package.options",
      entityType: "event",
      entityId: id,
      changes: update,
      metadata: { package_id: pkg.id },
    });
    await revalidateMain();
    return { ok: true, data: await cardData(id) };
  } catch (error) {
    console.error("setReadyPackageOptions:", error);
    return { ok: false, error: "Could not save." };
  }
}

/**
 * Detaches the ready package: the event goes back to the regular flow and the
 * site stops serving the package. The house row itself stays (history, and a
 * later adoption rewrites it under the same token).
 */
export async function removeReadyPackage(eventId: number): Promise<ReadyActionResult> {
  await requireStaff();
  const id = validId(eventId);
  if (!id) return { ok: false, error: "Invalid event." };
  try {
    const event = await loadReadyEvent(id);
    if (!event) return { ok: false, error: "Event not found." };
    await setEventReady(id, { token: null, mode: "off", price: null });
    await logAudit({
      action: "ready_package.removed",
      entityType: "event",
      entityId: id,
      metadata: { token: event.ready_package_token, mode: event.ready_package_mode },
    });
    await revalidateMain();
    return { ok: true, data: await cardData(id) };
  } catch (error) {
    console.error("removeReadyPackage:", error);
    return { ok: false, error: "Could not remove the ready package." };
  }
}
