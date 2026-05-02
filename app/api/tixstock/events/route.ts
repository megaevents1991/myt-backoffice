import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");

    const allData: any[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let totalCount: number | null = null;

    do {
      let dbQuery = supabase
        .from("tixstock_events")
        .select("*", { count: "exact" })
        .not("event_status", "in", '("Cancelled","Deleted")')
        .order("show_date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (query) {
        dbQuery = dbQuery.ilike("event_name", `%${query}%`);
      }

      const { data, error, count } = await dbQuery;

      if (error) throw error;

      if (totalCount === null) totalCount = count ?? 0;
      if (data) allData.push(...data);

      from += PAGE_SIZE;
    } while (from < (totalCount ?? 0));

    return NextResponse.json({
      success: true,
      data: allData,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 },
    );
  }
}
