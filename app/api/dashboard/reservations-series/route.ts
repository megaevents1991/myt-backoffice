import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { dailySeries, seriesWindow } from "@/lib/dashboard-series";

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
      const se = seriesWindow(range);
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

    const series = dailySeries(
      ((data ?? []) as { created_at: string }[]).map((row) => row.created_at),
      start,
      end,
    );

    return NextResponse.json({ start: start.toISOString(), end: end.toISOString(), series });
  } catch (e) {
    console.error("reservations-series error", e);
    return NextResponse.json({ error: "Failed to fetch reservations series" }, { status: 500 });
  }
}
