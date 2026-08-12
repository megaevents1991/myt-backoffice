import { NextResponse } from "next/server";
import { guardAdminRoute } from "@/lib/auth/guards";
import {
  buildManifestWorkbook,
  type ManifestRow,
} from "@/lib/exports/flight-workbook";
import { loadFlightsForExport } from "@/lib/exports/flight-export-query";
import { getReservationsForFlight } from "@/lib/actions/reservation-actions";
import type { PaxInfo } from "@/types/reservation.types";

export async function GET(request: Request) {
  const denied = await guardAdminRoute();
  if (denied) return denied;

  try {
    const flights = await loadFlightsForExport(request.url);
    const rows: ManifestRow[] = [];

    for (const flight of flights) {
      // Already excludes Cancelled/Lost, so released bookings never reach the
      // manifest and we never ticket a passenger who did not pay.
      const reservations = await getReservationsForFlight(flight.id);
      const route = `${flight.outbound_departure_airport}-${flight.outbound_arrival_airport}`;

      for (const reservation of reservations) {
        // The main contact flies too - they are a passenger, not just a payer.
        const pax: PaxInfo[] = [
          {
            first_name: reservation.main_contact_first_name,
            last_name: reservation.main_contact_last_name,
          },
          ...(reservation.more_pax_info ?? []),
        ];

        for (const person of pax) {
          rows.push({
            airline_code: flight.airline_code,
            flight_id: flight.id,
            outbound_flight_number: flight.outbound_flight_number,
            outbound_departure_time: flight.outbound_departure_time,
            inbound_flight_number: flight.inbound_flight_number,
            inbound_departure_time: flight.inbound_departure_time,
            route,
            pnr: flight.pnr ?? null,
            reservation_id: reservation.id,
            reservation_status: reservation.status,
            first_name: person.first_name,
            last_name: person.last_name,
            passport_number: person.passport_number ?? null,
            passport_expiry: person.passport_expiry ?? null,
            date_of_birth: person.date_of_birth ?? null,
            gender: person.gender ?? null,
            nationality: person.nationality ?? null,
            contact_email: reservation.main_contact_email,
            contact_phone: reservation.main_contact_phone_number,
          });
        }
      }
    }

    const buffer = await buildManifestWorkbook(rows);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="flights-manifest.xlsx"',
      },
    });
  } catch (error) {
    console.error("Flight manifest export failed:", JSON.stringify(error));
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
