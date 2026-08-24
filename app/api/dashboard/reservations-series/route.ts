import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { guardAdminRoute } from "@/lib/auth/guards";

function startEndFromRange(range?: string) {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);
  switch (range) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "30d":
      start.setDate(start.getDate() - 30);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "ytd": {
      start = new Date(now.getFullYear(), 0, 1);
      break;
    }
    default:
      start.setDate(start.getDate() - 30);
  }
  return { start, end };
}

function toDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const denied = await guardAdminRoute();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || undefined;
  const status = searchParams.get("status") || "Paid";
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    let start: Date;
    let end: Date;
    if (startParam && endParam) {
      start = new Date(startParam);
      end = new Date(endParam);
    } else {
      const se = startEndFromRange(range);
      start = se.start;
      end = se.end;
    }

    // Query only created_at to reduce payload
    let query = supabase
      .from("reservations")
      .select("created_at")
      .is("is_deleted", null)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString());
    if (status) {
      query = query.eq("status", status);
    }
    const { data, error } = await query;
    if (error) throw error;

    // Aggregate by day
    const counts = new Map<string, number>();
    // Pre-seed days for continuity
    const cur = new Date(start);
    while (cur <= end) {
      counts.set(toDateKey(cur), 0);
      cur.setDate(cur.getDate() + 1);
    }
    for (const row of (data ?? []) as { created_at: string }[]) {
      const key = toDateKey(new Date(row.created_at));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const series = Array.from(counts.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json({ start: start.toISOString(), end: end.toISOString(), series });
  } catch (e) {
    console.error("reservations-series error", e);
    return NextResponse.json({ error: "Failed to fetch reservations series" }, { status: 500 });
  }
}
