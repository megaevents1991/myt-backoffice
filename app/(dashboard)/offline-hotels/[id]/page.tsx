import { getOfflineHotel } from "@/lib/actions/offline-hotel-actions";
import { getReservationsForHotel, reconcileHotelInventory } from "@/lib/actions/reservation-actions";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ReservationsForInventory } from "@/components/reservations-for-inventory";
import { getOfflineHotelRooms } from "@/lib/actions/offline-hotel-room-actions";
import { HotelRoomsTable } from "@/components/offline-hotels/hotel-rooms-table";

interface OfflineHotelDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

function HotelDetailItem({
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

export default async function OfflineHotelDetailsPage({
  params,
}: OfflineHotelDetailsPageProps) {
  const awaitedParams = await params;
  const hotelIdAsNumber = parseInt(awaitedParams.id, 10);

  if (isNaN(hotelIdAsNumber)) {
    notFound();
  }

  let hotel = await getOfflineHotel(hotelIdAsNumber);

  if (!hotel) {
    notFound();
  }

  // Self-heal stored consumed_rooms from active reservations before render
  await reconcileHotelInventory(hotelIdAsNumber);
  hotel = await getOfflineHotel(hotelIdAsNumber);

  const reservations = await getReservationsForHotel(hotelIdAsNumber);
  const rooms = await getOfflineHotelRooms(hotelIdAsNumber);
  // Map each reservation id → the rooms it consumed, for the reservations table.
  const roomsByReservation = rooms.reduce<Record<number, typeof rooms>>((acc, room) => {
    if (room.reservation_id != null) {
      (acc[room.reservation_id] ??= []).push(room);
    }
    return acc;
  }, {});

  return (
    <div className="container mx-auto py-10 max-w-4xl">
      <div className="mb-6 flex justify-start">
        <Button variant="outline" asChild>
          <Link href="/offline-hotels">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Hotels
          </Link>
        </Button>
      </div>

      <div className="bg-card shadow overflow-hidden sm:rounded-lg border">
        <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
          <div>
            <h3 className="text-2xl leading-6 font-bold text-card-foreground">
              Hotel Details
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              ID: {hotel.id}
            </p>
          </div>
          <Button asChild>
            <Link href={`/offline-hotels/${hotel.id}/edit`}>Edit Hotel</Link>
          </Button>
        </div>

        <div className="border-t border-border px-4 py-5 sm:p-0">
          <dl className="sm:divide-y sm:divide-border">
            {/* General Details */}
            <div className="px-4 py-3 sm:px-6 bg-muted/50">
              <h4 className="text-lg font-semibold text-foreground">General Information</h4>
            </div>
            <div className="px-6">
              <HotelDetailItem
                label="Status"
                value={
                  hotel.is_deleted ? (
                    <Badge variant="destructive">Deleted</Badge>
                  ) : (
                    <Badge variant="default">Active</Badge>
                  )
                }
              />
              <HotelDetailItem label="Hotel Name" value={hotel.hotel_name} />
              <HotelDetailItem label="City" value={hotel.city} />
              <HotelDetailItem label="WorldOTA Hotel ID (hid)" value={hotel.hid} />
            </div>
            <Separator className="my-2" />

            {/* Availability */}
            <div className="px-4 py-3 sm:px-6 bg-muted/50">
              <h4 className="text-lg font-semibold text-foreground">Availability</h4>
            </div>
            <div className="px-6">
              <HotelDetailItem label="Check-in" value={hotel.check_in} />
              <HotelDetailItem label="Check-out" value={hotel.check_out} />
              <HotelDetailItem
                label="Inventory"
                value={(() => {
                  const avail = hotel.num_rooms - hotel.consumed_rooms;
                  return (
                    <span className={avail > 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                      {avail} available / {hotel.num_rooms} total · {hotel.consumed_rooms} reserved
                    </span>
                  );
                })()}
              />
              <HotelDetailItem
                label="Last Cancellation Date"
                value={hotel.last_cancellation_date}
              />
            </div>
            <Separator className="my-2" />

            {/* Links */}
            <div className="px-4 py-3 sm:px-6 bg-muted/50">
              <h4 className="text-lg font-semibold text-foreground">Linked Records</h4>
            </div>
            <div className="px-6">
              <HotelDetailItem
                label="Event IDs"
                value={
                  hotel.event_ids?.length
                    ? hotel.event_ids.join(", ")
                    : "None"
                }
              />
              <HotelDetailItem
                label="Flight IDs"
                value={
                  hotel.flight_ids?.length
                    ? hotel.flight_ids.join(", ")
                    : "None"
                }
              />
              <HotelDetailItem label="Notes" value={hotel.notes} />
              <HotelDetailItem
                label="Created At"
                value={
                  hotel.created_at
                    ? new Date(hotel.created_at).toLocaleString()
                    : "N/A"
                }
              />
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 bg-card shadow overflow-hidden sm:rounded-lg border">
        <div className="px-4 py-5 sm:px-6">
          <h3 className="text-2xl leading-6 font-bold text-card-foreground">Rooms</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {rooms.length} room{rooms.length === 1 ? "" : "s"} in this batch ·
            {" "}{rooms.filter((r) => !r.is_booked).length} available.
            Edit Supplier / Order No / Acc No inline after a booking.
          </p>
        </div>
        <div className="border-t border-border overflow-x-auto">
          <HotelRoomsTable initialRooms={rooms} reservations={reservations} />
        </div>
      </div>

      <ReservationsForInventory
        reservations={reservations}
        roomsByReservation={roomsByReservation}
      />
    </div>
  );
}
