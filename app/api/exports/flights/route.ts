import { NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import { getActiveCompany } from "@/lib/company";
import { sellsTours } from "@/lib/flights-scope";
import { buildInventoryWorkbook } from "@/lib/exports/flight-workbook";
import { loadFlightsForExport } from "@/lib/exports/flight-export-query";

export async function GET(request: Request) {
  const denied = await guardAdminRoute({ anyCompany: true });
  if (denied) return denied;

  try {
    // The export is the Offline Flights screen on paper: the ACTIVE company's
    // flights and nothing else.
    const company = await getActiveCompany();
    const flights = await loadFlightsForExport(request.url, company);
    const buffer = await buildInventoryWorkbook(flights, {
      tours: sellsTours(company),
    });

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
