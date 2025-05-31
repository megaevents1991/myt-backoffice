import { NextResponse } from "next/server";
import {
  getOfflineFlights,
  createOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import type { OfflineFlight } from "@/types/offline-flight.types"; // Correct import

export async function GET() {
  try {
    const flights = await getOfflineFlights();
    return NextResponse.json(flights);
  } catch (error) {
    console.error("API GET /offline-flights Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to fetch offline flights", error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Add validation here if necessary, e.g., using Zod,
    // though server actions might already have it.
    // For createOfflineFlight, the input type is Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">

    const newFlightData: Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted"> = body;

    const newFlight = await createOfflineFlight(newFlightData);
    return NextResponse.json(newFlight, { status: 201 });
  } catch (error) {
    console.error("API POST /offline-flights Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to create offline flight", error: errorMessage }, { status: 500 });
  }
}