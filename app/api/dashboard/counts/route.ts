import { NextResponse } from "next/server";
import { getDashboardCounts } from "@/lib/actions/dashboard-actions";

export async function GET() {
  try {
    const counts = await getDashboardCounts();
    return NextResponse.json(counts);
  } catch (error) {
    console.error("Error fetching dashboard counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard counts" },
      { status: 500 }
    );
  }
}