"use server";

import { requireStaff } from "@/lib/auth/guards";
import { supabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";

/**
 * "טען מלונות" - warm RateHawk static hotel data around a point (spec part B-min).
 * The work runs in main (`POST /api/hotels-warm`, it holds the WorldOTA keys and the
 * `hotels` writer); this action is the authenticated caller + the bookkeeping row in
 * `hotel_warm_areas`. One call loads at most WARM_BATCH hotels (RateHawk `hotel/info` is
 * 30/min, shared with customers); the button loops until `remaining` is 0.
 */
const WARM_BATCH = 12;
const WARM_RADIUS_M = 2000;

export type WarmPoint = { name: string; latitude: number; longitude: number; radius?: number };
export type WarmStatus = {
  name: string | null;
  latitude: number;
  longitude: number;
  radius: number;
  found: number;
  existing: number;
  loaded: number;
  remaining: number;
  error: string | null;
  warmed_at: string | null;
};
export type WarmStepResult =
  | { ok: true; status: WarmStatus }
  | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- hotel_warm_areas predates the generated DB types
const db = supabase as any;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function getWarmStatus(points: WarmPoint[]): Promise<WarmStatus[]> {
  await requireStaff();
  if (!points.length) return [];
  const { data, error } = await db
    .from("hotel_warm_areas")
    .select("name,latitude,longitude,radius,found,existing,loaded,remaining,error,warmed_at")
    .in("latitude", points.map((p) => round6(p.latitude)));
  if (error) {
    console.error("getWarmStatus:", JSON.stringify(error));
    return [];
  }
  const rows = (data ?? []) as WarmStatus[];
  return points
    .map((p) =>
      rows.find(
        (r) =>
          Number(r.latitude) === round6(p.latitude) &&
          Number(r.longitude) === round6(p.longitude) &&
          Number(r.radius) === (p.radius ?? WARM_RADIUS_M),
      ),
    )
    .filter((r): r is WarmStatus => !!r);
}

export async function warmHotelsStep(point: WarmPoint): Promise<WarmStepResult> {
  const session = await requireStaff();
  const lat = Number(point.latitude), lon = Number(point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: "Point has no coordinates." };
  const radius = point.radius ?? WARM_RADIUS_M;
  const base = process.env.NEXT_SECRET_HOTEL_SERVICE_URL || "http://localhost:3000";
  const secret = process.env.NEXT_SECRET_REVALIDATION_SECRET;
  if (!secret) return { ok: false, error: "NEXT_SECRET_REVALIDATION_SECRET is not set." };

  let res: Response;
  try {
    res = await fetch(`${base}/api/hotels-warm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hotel-secret": secret },
      body: JSON.stringify({ lat, lon, radius, name: point.name, max: WARM_BATCH }),
      signal: AbortSignal.timeout(58_000),
    });
  } catch (e) {
    return { ok: false, error: `main unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const json = (await res.json().catch(() => null)) as
    | { found: number; existing: number; loaded: number; remaining: number; error?: string | null }
    | null;
  if (!res.ok || !json) return { ok: false, error: `main answered ${res.status}` };

  const row: WarmStatus = {
    name: point.name,
    latitude: round6(lat),
    longitude: round6(lon),
    radius,
    found: json.found,
    existing: json.existing,
    loaded: json.loaded,
    remaining: json.remaining,
    error: json.error ?? null,
    warmed_at: new Date().toISOString(),
  };
  const { error } = await db.from("hotel_warm_areas").upsert(row, { onConflict: "latitude,longitude,radius" });
  if (error) console.error("hotel_warm_areas upsert:", JSON.stringify(error));
  await logAudit({
    action: "hotels.warm",
    entityType: "location",
    changes: { ...row, actor: session.email ?? null },
  });
  return { ok: true, status: row };
}
