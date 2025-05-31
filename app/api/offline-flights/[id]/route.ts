import { NextResponse } from "next/server";
import {
  getOfflineFlight,
  updateOfflineFlight,
  softDeleteOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import type { OfflineFlight } from "@/types/offline-flight.types"; // Correct import

interface Params {
  id: string;
}

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json({ message: "Flight ID is required" }, { status: 400 });
    }
    const flight = await getOfflineFlight(id);
    if (!flight) {
      return NextResponse.json({ message: "Flight not found" }, { status: 404 });
    }
    return NextResponse.json(flight);
  } catch (error) {
    console.error(`API GET /offline-flights/${params.id} Error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to fetch offline flight", error: errorMessage }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Params }) {
  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json({ message: "Flight ID is required" }, { status: 400 });
    }
    const body = await request.json();
    // For updateOfflineFlight, the input type is Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>
    const flightUpdateData: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">> = body;

    const updatedFlight = await updateOfflineFlight(id, flightUpdateData);
    if (!updatedFlight) {
      return NextResponse.json({ message: "Flight not found or update failed" }, { status: 404 });
    }
    return NextResponse.json(updatedFlight);
  } catch (error) {
    console.error(`API PUT /offline-flights/${params.id} Error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to update offline flight", error: errorMessage }, { status: 500 });
  }
}

// PATCH can be similar to PUT or more specific for partial updates
export async function PATCH(request: Request, { params }: { params: Params }) {
  // Implementation similar to PUT, as updateOfflineFlight already handles partial updates
  return PUT(request, { params });
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json({ message: "Flight ID is required" }, { status: 400 });
    }
    const deletedFlight = await softDeleteOfflineFlight(id);
    if (!deletedFlight) {
      return NextResponse.json({ message: "Flight not found or delete failed" }, { status: 404 });
    }
    // Return the "deleted" flight object or just a success message
    return NextResponse.json({ message: "Flight soft deleted successfully", flight: deletedFlight });
  } catch (error) {
    console.error(`API DELETE /offline-flights/${params.id} Error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to delete offline flight", error: errorMessage }, { status: 500 });
  }
}