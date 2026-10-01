import { NextResponse } from "next/server";
import {
  getOfflineFlight,
  updateOfflineFlight,
  softDeleteOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import { guardAdminRoute } from "@/lib/auth/guards";
import type { OfflineFlight } from "@/types/offline-flight.types"; // Correct import

interface Params {
  id: string;
}

type RouteContext = { params: Promise<Params> };

// The actions work in the ACTIVE company (lib/flights-scope.ts): a flight of
// another company is "not found" here - never returned, updated or deleted.
const NOT_FOUND = "Flight not found";

/** The flight id as a positive integer, or null when the segment is not one. */
async function flightId(context: RouteContext): Promise<number | null> {
  const { id } = await context.params;
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const badId = () =>
  NextResponse.json({ message: "Flight ID is required" }, { status: 400 });

const isNotFound = (error: unknown) =>
  error instanceof Error && error.message === NOT_FOUND;

export async function GET(request: Request, context: RouteContext) {
  const denied = await guardAdminRoute({ anyCompany: true });
  if (denied) return denied;
  const id = await flightId(context);
  if (id === null) return badId();
  try {
    const flight = await getOfflineFlight(id);
    if (!flight) {
      return NextResponse.json({ message: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json(flight);
  } catch (error) {
    console.error(`API GET /offline-flights/${id} Error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to fetch offline flight", error: errorMessage }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = await guardAdminRoute({ anyCompany: true });
  if (denied) return denied;
  const id = await flightId(context);
  if (id === null) return badId();
  try {
    const body = await request.json();
    // For updateOfflineFlight, the input type is Partial<Omit<OfflineFlight, "id" | "consumed_quantity">>
    const flightUpdateData: Partial<Omit<OfflineFlight, "id" | "consumed_quantity">> = body;

    const updatedFlight = await updateOfflineFlight(id, flightUpdateData);
    if (!updatedFlight) {
      return NextResponse.json({ message: "Flight not found or update failed" }, { status: 404 });
    }
    return NextResponse.json(updatedFlight);
  } catch (error) {
    if (isNotFound(error)) {
      return NextResponse.json({ message: "Flight not found or update failed" }, { status: 404 });
    }
    console.error(`API PUT /offline-flights/${id} Error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to update offline flight", error: errorMessage }, { status: 500 });
  }
}

// PATCH can be similar to PUT or more specific for partial updates
export async function PATCH(request: Request, context: RouteContext) {
  // Implementation similar to PUT, as updateOfflineFlight already handles partial updates
  return PUT(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = await guardAdminRoute({ anyCompany: true });
  if (denied) return denied;
  const id = await flightId(context);
  if (id === null) return badId();
  try {
    const deletedFlight = await softDeleteOfflineFlight(id);
    if (!deletedFlight) {
      return NextResponse.json({ message: "Flight not found or delete failed" }, { status: 404 });
    }
    // Return the "deleted" flight object or just a success message
    return NextResponse.json({ message: "Flight soft deleted successfully", flight: deletedFlight });
  } catch (error) {
    if (isNotFound(error)) {
      return NextResponse.json({ message: "Flight not found or delete failed" }, { status: 404 });
    }
    console.error(`API DELETE /offline-flights/${id} Error:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ message: "Failed to delete offline flight", error: errorMessage }, { status: 500 });
  }
}
