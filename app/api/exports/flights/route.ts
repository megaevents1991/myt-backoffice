import { NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { buildInventoryWorkbook } from "@/lib/exports/flight-workbook";
import { loadFlightsForExport } from "@/lib/exports/flight-export-query";

export async function GET(request: Request) {
  const denied = await guardAdminRoute();
  if (denied) return denied;

  try {
    const flights = await loadFlightsForExport(request.url);
    const buffer = await buildInventoryWorkbook(flights);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="flights-inventory.xlsx"',
      },
    });
  } catch (error) {
    console.error("Flight inventory export failed:", JSON.stringify(error));
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
