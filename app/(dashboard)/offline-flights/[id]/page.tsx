import { getOfflineFlight } from "@/lib/actions/offline-flight-actions";
import { getReservationsForFlight, reconcileFlightInventory } from "@/lib/actions/reservation-actions";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { LogoImage } from "@/components/logo-image";
import { ReservationsForInventory } from "@/components/reservations-for-inventory";
import { FlightPassengerManifest } from "@/components/offline-flights/flight-passenger-manifest";

interface OfflineFlightDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

function FlightDetailItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number | boolean | null | undefined | React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`py-3 sm:grid sm:grid-cols-3 sm:gap-4 ${className}`}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground sm:mt-0 sm:col-span-2">
        {typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : value === null || value === undefined || value === ""
          ? "N/A"
          : value}
      </dd>
    </div>
  );
}

const formatDateTime = (dateTimeString: string | null | undefined) => {
  if (!dateTimeString) return "N/A";
  try {
    if (
      (dateTimeString.length === 19 && dateTimeString.includes("T")) ||
      (dateTimeString.length === 16 && dateTimeString.includes("T"))
    ) {
      return new Date(dateTimeString).toLocaleString();
    }
    return "Invalid Date";
  } catch (e) {
    console.error("Error formatting date:", e);
    return "Invalid Date";
  }
};

export default async function OfflineFlightDetailsPage({
  params,
}: OfflineFlightDetailsPageProps) {
  // Await params before accessing its properties
  const awaitedParams = await params;
  const flightIdAsNumber = parseInt(awaitedParams.id, 10);

  if (isNaN(flightIdAsNumber)) {
    notFound();
  }

  let flight = await getOfflineFlight(flightIdAsNumber);

  if (!flight) {
    notFound();
  }

  // Self-heal stored consumed_quantity from active reservations before render
  await reconcileFlightInventory(flightIdAsNumber);
  flight = await getOfflineFlight(flightIdAsNumber);

  const reservations = await getReservationsForFlight(flightIdAsNumber);

  return (
    <div className="container mx-auto py-10 max-w-4xl">
      <div className="mb-6 flex justify-start">
        <Button variant="outline" asChild>
          <Link href="/offline-flights">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Flights
          </Link>
        </Button>
      </div>

      <div className="bg-card shadow overflow-hidden sm:rounded-lg border">
        <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
          <div>
            <h3 className="text-2xl leading-6 font-bold text-card-foreground">
              Flight Details
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              ID: {flight.id}
            </p>
          </div>
          <Button asChild>
            <Link href={`/offline-flights/${flight.id}/edit`}>Edit Flight</Link>
          </Button>
        </div>

        <div className="border-t border-border px-4 py-5 sm:p-0">
          <dl className="sm:divide-y sm:divide-border">
            {/* General Details Section */}
            <div className="px-4 py-3 sm:px-6 bg-muted/50">
              <h4 className="text-lg font-semibold text-foreground">
                General Information
              </h4>
            </div>
            <div className="px-6">
              <FlightDetailItem
                label="Status"
                value={
                  flight.is_deleted ? (
                    <Badge variant="destructive">Deleted</Badge>
                  ) : (
                    <Badge variant="default">Active</Badge>
                  )
                }
              />
              <FlightDetailItem
                label="Airline Code"
                value={flight.airline_code}
              />
              <FlightDetailItem
                label="Price"
                value={`$${Number(flight.price).toFixed(2)}`}
              />
              <FlightDetailItem
                label="Inventory"
                value={(() => {
                  const avail = flight.initial_quantity - flight.consumed_quantity;
                  return (
                    <span className={avail > 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                      {avail} available / {flight.initial_quantity} total · {flight.consumed_quantity} reserved
                    </span>
                  );
                })()}
              />
              <FlightDetailItem
                label="Total Duration (Round Trip)"
                value={flight.duration}
              />
              <FlightDetailItem label="Stops" value={flight.stops} />
            </div>
            <Separator className="my-2" />

            {/* Outbound Details Section */}
            <div className="px-4 py-3 sm:px-6 bg-gray-50">
              <h4 className="text-lg font-semibold text-gray-800">
                Outbound Flight
              </h4>
            </div>
            <div className="px-6">
              <FlightDetailItem
                label="Flight Number"
                value={flight.outbound_flight_number}
              />
              <FlightDetailItem
                label="Departure Airport"
                value={flight.outbound_departure_airport}
              />
              <FlightDetailItem
                label="Departure Time"
                value={formatDateTime(flight.outbound_departure_time)}
              />
              <FlightDetailItem
                label="Arrival Airport"
                value={flight.outbound_arrival_airport}
              />
              <FlightDetailItem
                label="Arrival Time"
                value={formatDateTime(flight.outbound_arrival_time)}
              />
              <FlightDetailItem
                label="Duration"
                value={flight.outbound_duration}
              />
              <FlightDetailItem
                label="Cabin Bags Included"
                value={
                  flight.outbound_cabin_bags_included
                    ? "Included"
                    : "Not Included"
                }
              />
              <FlightDetailItem
                label="Checked Bags Included"
                value={
                  flight.outbound_check_bags_included
                    ? "Included"
                    : "Not Included"
                }
              />
            </div>
            <Separator className="my-2" />

            {/* Inbound Details Section */}
            <div className="px-4 py-3 sm:px-6 bg-gray-50">
              <h4 className="text-lg font-semibold text-gray-800">
                Inbound Flight
              </h4>
            </div>
            <div className="px-6">
              <FlightDetailItem
                label="Flight Number"
                value={flight.inbound_flight_number}
              />
              <FlightDetailItem
                label="Departure Airport"
                value={flight.inbound_departure_airport}
              />
              <FlightDetailItem
                label="Departure Time"
                value={formatDateTime(flight.inbound_departure_time)}
              />
              <FlightDetailItem
                label="Arrival Airport"
                value={flight.inbound_arrival_airport}
              />
              <FlightDetailItem
                label="Arrival Time"
                value={formatDateTime(flight.inbound_arrival_time)}
              />
              <FlightDetailItem
                label="Duration"
                value={flight.inbound_duration}
              />
              <FlightDetailItem
                label="Cabin Bags Included"
                value={
                  flight.inbound_cabin_bags_included
                    ? "Included"
                    : "Not Included"
                }
              />
              <FlightDetailItem
                label="Checked Bags Included"
                value={
                  flight.inbound_check_bags_included
                    ? "Included"
                    : "Not Included"
                }
              />
            </div>
            <Separator className="my-2" />

            {/* Metadata Details Section */}
            <div className="px-4 py-3 sm:px-6 bg-gray-50">
              <h4 className="text-lg font-semibold text-gray-800">
                Airline Metadata
              </h4>
            </div>
            <div className="px-6">
              <FlightDetailItem
                label="Metadata IATA"
                value={flight.metadata_iata}
              />
              <FlightDetailItem
                label="Metadata Name"
                value={flight.metadata_name}
              />
              <FlightDetailItem
                label="Metadata Logo URL"
                value={flight.metadata_logo}
              />
              {flight.metadata_logo && (
                <div className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
                  <dt className="text-sm font-medium text-gray-500">
                    Logo Preview
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                    <LogoImage
                      src={flight.metadata_logo}
                      alt={`${flight.metadata_name || "Airline"} logo`}
                    />
                  </dd>
                </div>
              )}
            </div>
          </dl>
        </div>
      </div>

      <ReservationsForInventory reservations={reservations} />

      <FlightPassengerManifest reservations={reservations} />
    </div>
  );
}
