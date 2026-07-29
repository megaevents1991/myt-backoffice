"use client";

import Link from "next/link";
import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import type { Reservation } from "@/types/reservation.types";
import { getReservation } from "@/lib/actions/reservation-actions";
import {
  getOfflineHotelsByIds,
  type ReservationOfflineRoom,
} from "@/lib/actions/offline-hotel-actions";
import { getRoomsByReservationId } from "@/lib/actions/offline-hotel-room-actions";
import type { OfflineHotelRoom } from "@/types/offline-hotel.types";
import { hasHotelInfo, normalizeReservationEventOrderInfo } from "@/lib/utils";

// Visible marker for reservations whose flight/hotel came from our own
// offline inventory (the `flights` / `offline_hotels` tables) rather than
// third-party suppliers like Amadeus or WorldOTA. Gold→magenta gradient so
// it stands out against the neutral reservation cards without looking like
// a status tag.
function MegaBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
      style={{
        background: "linear-gradient(90deg, #d4af37 0%, #c026d3 100%)",
      }}
    >
      Mega
    </span>
  );
}

export default function ReservationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const resolvedParams = use(params);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineRooms, setOfflineRooms] = useState<ReservationOfflineRoom[]>([]);
  const [offlineRoomCounts, setOfflineRoomCounts] = useState<Map<number, number>>(
    new Map()
  );
  // Specific child rooms (offline_hotel_rooms) manually linked to this reservation.
  const [linkedChildRooms, setLinkedChildRooms] = useState<OfflineHotelRoom[]>([]);

  useEffect(() => {
    async function fetchReservation() {
      try {
        const data = await getReservation(Number.parseInt(resolvedParams.id));
        setReservation(data);
      } catch (error) {
        console.error("Error fetching reservation:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load reservation details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchReservation();
  }, [resolvedParams.id, toast]);

  useEffect(() => {
    if (!reservation) return;
    const ids =
      reservation.offline_hotel_ids && reservation.offline_hotel_ids.length > 0
        ? reservation.offline_hotel_ids
        : reservation.offline_hotel_id != null
        ? [reservation.offline_hotel_id]
        : [];
    // Per-room child rows linked to this reservation (manual link, phase 1).
    getRoomsByReservationId(reservation.id)
      .then(setLinkedChildRooms)
      .catch((err) => {
        console.error("Failed to load linked child rooms:", err);
        setLinkedChildRooms([]);
      });

    if (ids.length === 0) {
      setOfflineRooms([]);
      setOfflineRoomCounts(new Map());
      return;
    }
    const counts = new Map<number, number>();
    for (const rowId of ids) {
      counts.set(rowId, (counts.get(rowId) || 0) + 1);
    }
    setOfflineRoomCounts(counts);
    getOfflineHotelsByIds(ids)
      .then((rows) => setOfflineRooms(rows))
      .catch((err) => {
        console.error("Failed to load offline hotel rooms:", err);
        setOfflineRooms([]);
      });
  }, [reservation]);

  if (loading) {
    return <div>Loading reservation details...</div>;
  }

  if (!reservation) {
    return <div>Reservation not found</div>;
  }

  const paymentInfo = {
    amount:
      reservation.payment_info?.ashrait?.response?.inquireTransactions?.row
        ?.amount / 100,
    currency:
      reservation.payment_info?.ashrait?.response?.inquireTransactions?.row
        ?.currency,
    status:
      reservation.payment_info?.ashrait?.response?.inquireTransactions?.row
        ?.statusText,
    transactionId:
      reservation.payment_info?.ashrait?.response?.inquireTransactions?.row
        ?.cgGatewayResponseXML?.ashrait?.response?.tranId,
  };

  const reservationEvents = normalizeReservationEventOrderInfo(
    reservation.event_order_info
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">
          Reservation #{reservation.id}
        </h1>
        <Button
          variant="outline"
          onClick={() => window.print()}
          className="ml-auto mr-4"
        >
          Print
        </Button>
        <Link href={`/reservations/${reservation.id}/edit`}>
          <Button>Edit Reservation</Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
            <CardDescription>
              Contact details for the reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">First Name</p>
                <p className="text-lg">{reservation.main_contact_first_name}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Last Name</p>
                <p className="text-lg">{reservation.main_contact_last_name}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-lg">{reservation.main_contact_email}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Phone</p>
                <p className="text-lg">
                  {reservation.main_contact_phone_number}
                </p>
              </div>
            </div>

            {/* Read-only here by design — passengers are edited on the edit
                screen, so this page never writes. */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Passengers</p>

              <div className="rounded-md border p-3 text-sm">
                <span className="font-medium">
                  {reservation.main_contact_first_name}{" "}
                  {reservation.main_contact_last_name}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  main contact
                </span>
              </div>

              {(reservation.more_pax_info ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No additional passengers.
                </p>
              ) : (
                (reservation.more_pax_info ?? []).map((pax, index) => {
                  const details = [
                    pax.passport_number && `Passport ${pax.passport_number}`,
                    pax.passport_expiry && `expires ${pax.passport_expiry}`,
                    pax.date_of_birth && `born ${pax.date_of_birth}`,
                    pax.gender,
                    pax.nationality,
                  ].filter(Boolean);
                  return (
                    <div key={index} className="rounded-md border p-3 text-sm">
                      <span className="font-medium">
                        {pax.first_name} {pax.last_name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {details.length > 0
                          ? details.join(" · ")
                          : "no passport details yet"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reservation Details</CardTitle>
            <CardDescription>
              General information about the reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">Created At</p>
                <p className="text-lg">
                  {new Date(reservation.created_at).toLocaleString()}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Total Price</p>
                <p className="text-lg font-bold">
                  ${reservation.user_shown_price.toFixed(2)}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Event ID</p>
                <p className="text-lg">{reservation.event_id}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Status</p>
                <p className="text-lg">{reservation.status}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Accounting No.</p>
                <p className="text-lg">{reservation.accounting_number}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Payment info</p>
                <p className="text-lg">
                  {JSON.stringify(paymentInfo, null, 2)}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Exchange Rate</p>
                <p className="text-lg">
                  {reservation.exchange_rate_usd_ils_100 / 100}
                </p>
              </div>

              {reservation.aff_partner_tracking_code && (
                <div>
                  <p className="text-sm font-medium">Partner Tracking Code</p>
                  <p className="text-lg">
                    {reservation.aff_partner_tracking_code}
                  </p>
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium">Comments</p>
              <p className="text-lg">{reservation.comments || "None"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event Information</CardTitle>
          <CardDescription>
            Details about the event in this reservation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reservationEvents.length > 0 && (
            <div className="space-y-6">
              {reservationEvents.map((evt, index) => (
                <div key={`${evt.event_id}-${evt.id ?? index}`}>
                  {reservationEvents.length > 1 && (
                    <p className="text-sm font-medium mb-3">
                      Event {index + 1}
                    </p>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-sm font-medium">Event Name</p>
                      <p className="text-lg">{evt.name}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium">Event Date</p>
                      <p className="text-lg">
                        {evt.date ? new Date(evt.date).toLocaleDateString() : "—"}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-lg">{evt.location_name}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium">Ticket Category</p>
                      <p className="text-lg">{evt.category}</p>
                    </div>

                    {evt.vendor && (
                      <div>
                        <p className="text-sm font-medium">Ticket Vendor</p>
                        <p className="text-lg">{evt.vendor}</p>
                      </div>
                    )}

                    {evt.id && (
                      <div>
                        <p className="text-sm font-medium">Ticket ID</p>
                        <p className="text-lg">{evt.id}</p>
                      </div>
                    )}

                    <div>
                      <p className="text-sm font-medium">Number of Tickets</p>
                      <p className="text-lg">{evt.number_of_ticket}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium">Price per Ticket</p>
                      <p className="text-lg">
                        ${Number(evt.price_per_ticket || 0).toFixed(2)}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-medium">Total Tickets Price</p>
                      <p className="text-lg">
                        ${Number(evt.total_tickets_price || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  {index < reservationEvents.length - 1 && (
                    <Separator className="mt-6" />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Flight Information</span>
              {(reservation.offline_flight_id != null ||
                (reservation.flight_order_info as { isOffline?: boolean })
                  ?.isOffline) && <MegaBadge />}
            </CardTitle>
            <CardDescription>
              Details about the flight in this reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reservation.flight_order_info &&
            "airline" in reservation.flight_order_info ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Airline</p>
                    <p className="text-lg">
                      {reservation.flight_order_info.airline}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Flight Price</p>
                    <p className="text-lg">
                      ${reservation.flight_order_info.price.toFixed(2)}
                    </p>
                    {(() => {
                      const info = reservation.flight_order_info as {
                        isOffline?: boolean;
                        offlineRawPrice?: number;
                        numOfTravelers?: number;
                      };
                      const raw =
                        reservation.offline_flight_cost ??
                        info.offlineRawPrice;
                      const isOffline =
                        reservation.offline_flight_id != null || info.isOffline;
                      if (!isOffline || raw == null) return null;
                      const travelers = info.numOfTravelers || 1;
                      return (
                        <p className="text-xs text-muted-foreground">
                          Mega inventory cost: ${raw.toFixed(2)} × {travelers}{" "}
                          = ${(raw * travelers).toFixed(2)}
                        </p>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Elal Classic (Virtual Offer)</p>
                    <p className="text-lg">
                      {reservation.flight_order_info &&
                      "virtualOfferType" in reservation.flight_order_info
                        ? reservation.flight_order_info.virtualOfferType === true
                          ? "Yes"
                          : "No"
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Duration</p>
                    <p className="text-lg">
                      {reservation.flight_order_info.duration}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Number of Stops</p>
                    <p className="text-lg">
                      {reservation.flight_order_info.stops}
                    </p>
                  </div>
                </div>

                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Outbound Flight</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">From</p>
                      <p>
                        {
                          reservation.flight_order_info.outbound
                            .departureAirport
                        }
                      </p>
                      <p className="text-sm">
                        {new Date(
                          reservation.flight_order_info.outbound.departureTime
                        ).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">To</p>
                      <p>
                        {reservation.flight_order_info.outbound.arrivalAirport}
                      </p>
                      <p className="text-sm">
                        {new Date(
                          reservation.flight_order_info.outbound.arrivalTime
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-sm font-medium">Luggage Information</p>
                    <p className="text-sm">
                      Checked Bags:{" "}
                      {reservation.flight_order_info.outbound.checkBagsIncluded
                        ? "Yes"
                        : "No"}
                    </p>
                    <p className="text-sm">
                      Carry-On:{" "}
                      {reservation.flight_order_info.offer &&
                      reservation.flight_order_info.offer.travelerPricings
                        ?.length > 0
                        ? reservation.flight_order_info.offer.travelerPricings[0].fareDetailsBySegment.some(
                            (segment: {
                              segmentId: any;
                              includedCabinBags: { quantity: number };
                            }) => segment.includedCabinBags.quantity > 0
                          )
                          ? "Yes"
                          : "No"
                        : reservation.flight_order_info.outbound
                            .cabinBagsIncluded
                        ? "Yes"
                        : "No"}
                    </p>
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Inbound Flight</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">From</p>
                      <p>
                        {reservation.flight_order_info.inbound.departureAirport}
                      </p>
                      <p className="text-sm">
                        {new Date(
                          reservation.flight_order_info.inbound.departureTime
                        ).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">To</p>
                      <p>
                        {reservation.flight_order_info.inbound.arrivalAirport}
                      </p>
                      <p className="text-sm">
                        {new Date(
                          reservation.flight_order_info.inbound.arrivalTime
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-sm font-medium">Luggage Information</p>
                    <p className="text-sm">
                      Checked Bags:{" "}
                      {reservation.flight_order_info.inbound.checkBagsIncluded
                        ? "Yes"
                        : "No"}
                    </p>
                    <p className="text-sm">
                      Carry-On:{" "}
                      {reservation.flight_order_info.offer &&
                      reservation.flight_order_info.offer.travelerPricings
                        ?.length > 0
                        ? reservation.flight_order_info.offer.travelerPricings[0].fareDetailsBySegment.some(
                            (segment: {
                              segmentId: any;
                              includedCabinBags: { quantity: number };
                            }) => segment.includedCabinBags.quantity > 0
                          )
                          ? "Yes"
                          : "No"
                        : reservation.flight_order_info.inbound
                            .cabinBagsIncluded
                        ? "Yes"
                        : "No"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-lg font-medium">No Flight Included</p>
                <p className="text-sm mt-2">This reservation does not include a flight.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Hotel Information</span>
              {(reservation.offline_hotel_id != null ||
                (reservation.hotel_order_info as { isOffline?: boolean })
                  ?.isOffline) && <MegaBadge />}
            </CardTitle>
            <CardDescription>
              Details about the hotel in this reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasHotelInfo(reservation.hotel_order_info) ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium">Hotel Name</p>
                    <p className="text-lg">
                      {reservation.hotel_order_info.name}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Price</p>
                    <p className="text-lg">
                      ${reservation.hotel_order_info.price}
                    </p>
                    {(() => {
                      const info = reservation.hotel_order_info as {
                        isOffline?: boolean;
                        offlineRawPrice?: number;
                        guests?: unknown[];
                      };
                      const raw =
                        reservation.offline_hotel_cost ??
                        info.offlineRawPrice;
                      const isOffline =
                        reservation.offline_hotel_id != null || info.isOffline;
                      if (!isOffline || raw == null) return null;
                      const rooms = info.guests?.length || 1;
                      return (
                        <p className="text-xs text-muted-foreground">
                          Mega inventory cost: ${raw.toFixed(2)} × {rooms} room
                          {rooms > 1 ? "s" : ""} = $
                          {(raw * rooms).toFixed(2)}
                        </p>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Address</p>
                    <p className="text-lg">
                      {reservation.hotel_order_info.address}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium">Check-in</p>
                      <p className="text-lg">
                        {new Date(
                          reservation.hotel_order_info.checkin
                        ).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Check-out</p>
                      <p className="text-lg">
                        {new Date(
                          reservation.hotel_order_info.checkout
                        ).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium">Rooms Information</p>
                    <div className="space-y-2">
                      {reservation.hotel_order_info.guests.map(
                        (
                          room: { adults: number; children: any[] },
                          index: number
                        ) => (
                          <div key={index} className="text-sm">
                            <p>Room {index + 1}:</p>
                            <p>
                              Adults: {room.adults}, Children:{" "}
                              {room.children.length}
                            </p>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium">Meal</p>
                    <p className="text-lg">
                      {reservation.hotel_order_info?.rate?.meal_data
                        ?.has_breakfast
                        ? "Includes Breakfast"
                        : "No Meal Included"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-lg font-medium">No Hotel Included</p>
                <p className="text-sm mt-2">This reservation does not include hotel accommodation.</p>
              </div>
            )}
            {offlineRooms.length > 0 && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-2">Mega inventory rooms</p>
                <div className="space-y-1">
                  {offlineRooms.map((room) => {
                    const count = offlineRoomCounts.get(room.id) || 1;
                    return (
                      <div key={room.id} className="text-sm">
                        <span className="font-medium">{room.hotel_name}</span>
                        {" — "}
                        {room.room_type}
                        {count > 1 ? ` × ${count}` : ""}
                        {" ("}
                        {new Date(room.check_in).toLocaleDateString()}
                        {" → "}
                        {new Date(room.check_out).toLocaleDateString()}
                        {") — $"}
                        {Number(room.price).toFixed(2)} / room
                        {room.meal_plan ? ` — ${room.meal_plan}` : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {linkedChildRooms.length > 0 && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-2">Assigned room details</p>
                <div className="space-y-2">
                  {linkedChildRooms.map((room) => (
                    <div
                      key={room.id}
                      className="rounded-md border p-3 text-sm grid grid-cols-2 md:grid-cols-4 gap-2"
                    >
                      <div>
                        <span className="text-xs text-muted-foreground block">Room</span>
                        #{room.id} · {room.room_type}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Price / room</span>
                        ${Number(room.price).toFixed(2)}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Meal</span>
                        {room.meal_plan ?? "—"}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Cancel by</span>
                        {room.last_cancellation_date ?? "—"}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Supplier</span>
                        {room.supplier ?? "—"}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Order No</span>
                        {room.order_no ?? "—"}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">Acc No</span>
                        {room.acc_no ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
      </div>
    </div>
  );
}

/*
Standard JSON data for flight offer
{"offer":{"type":"flight-offer","id":"113","source":"GDS","instantTicketingRequired":false,"nonHomogeneous":false,"oneWay":false,"isUpsellOffer":false,"lastTicketingDate":"2025-07-07","lastTicketingDateTime":"2025-07-07","numberOfBookableSeats":2,"itineraries":[{"duration":"PT5H15M","segments":[{"departure":{"iataCode":"TLV","terminal":"3","at":"2025-11-06T16:00:00"},"arrival":{"iataCode":"AMS","at":"2025-11-06T20:15:00"},"carrierCode":"LY","number":"339","aircraft":{"code":"738"},"operating":{"carrierCode":"LY"},"duration":"PT5H15M","id":"16","numberOfStops":0,"blacklistedInEU":false}]},{"duration":"PT4H25M","segments":[{"departure":{"iataCode":"AMS","at":"2025-11-11T11:30:00"},"arrival":{"iataCode":"TLV","terminal":"3","at":"2025-11-11T16:55:00"},"carrierCode":"LY","number":"338","aircraft":{"code":"738"},"operating":{"carrierCode":"LY"},"duration":"PT4H25M","id":"86","numberOfStops":0,"blacklistedInEU":false}]}],"price":{"currency":"USD","total":"1643.56","base":"1372.00","fees":[{"amount":"0.00","type":"SUPPLIER"},{"amount":"0.00","type":"TICKETING"}],"grandTotal":"1643.56"},"pricingOptions":{"fareType":["PUBLISHED"],"includedCheckedBagsOnly":false},"validatingAirlineCodes":["LY"],"travelerPricings":[{"travelerId":"1","fareOption":"STANDARD","travelerType":"ADULT","price":{"currency":"USD","total":"821.78","base":"686.00"},"fareDetailsBySegment":[{"segmentId":"16","cabin":"ECONOMY","fareBasis":"VLL1PR","brandedFare":"LITE","brandedFareLabel":"LITE","class":"V","includedCheckedBags":{"quantity":0},"includedCabinBags":{"quantity":1},"amenities":[{"description":"UPTO50LB 23KG AND62LI 158LCM","isChargeable":true,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"CARRY8KG 18LB UPTO 45LI 115LCM","isChargeable":false,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"MEAL","isChargeable":false,"amenityType":"MEAL","amenityProvider":{"name":"BrandedFare"}},{"description":"BASIC SEAT","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}},{"description":"CHANGEABLE TICKET","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}}]},{"segmentId":"86","cabin":"ECONOMY","fareBasis":"VLL1PR","brandedFare":"LITE","brandedFareLabel":"LITE","class":"V","includedCheckedBags":{"quantity":0},"includedCabinBags":{"quantity":1},"amenities":[{"description":"UPTO50LB 23KG AND62LI 158LCM","isChargeable":true,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"CARRY8KG 18LB UPTO 45LI 115LCM","isChargeable":false,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"MEAL","isChargeable":false,"amenityType":"MEAL","amenityProvider":{"name":"BrandedFare"}},{"description":"BASIC SEAT","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}},{"description":"CHANGEABLE TICKET","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}}]}]},{"travelerId":"2","fareOption":"STANDARD","travelerType":"ADULT","price":{"currency":"USD","total":"821.78","base":"686.00"},"fareDetailsBySegment":[{"segmentId":"16","cabin":"ECONOMY","fareBasis":"VLL1PR","brandedFare":"LITE","brandedFareLabel":"LITE","class":"V","includedCheckedBags":{"quantity":0},"includedCabinBags":{"quantity":1},"amenities":[{"description":"UPTO50LB 23KG AND62LI 158LCM","isChargeable":true,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"CARRY8KG 18LB UPTO 45LI 115LCM","isChargeable":false,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"MEAL","isChargeable":false,"amenityType":"MEAL","amenityProvider":{"name":"BrandedFare"}},{"description":"BASIC SEAT","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}},{"description":"CHANGEABLE TICKET","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}}]},{"segmentId":"86","cabin":"ECONOMY","fareBasis":"VLL1PR","brandedFare":"LITE","brandedFareLabel":"LITE","class":"V","includedCheckedBags":{"quantity":0},"includedCabinBags":{"quantity":1},"amenities":[{"description":"UPTO50LB 23KG AND62LI 158LCM","isChargeable":true,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"CARRY8KG 18LB UPTO 45LI 115LCM","isChargeable":false,"amenityType":"BAGGAGE","amenityProvider":{"name":"BrandedFare"}},{"description":"MEAL","isChargeable":false,"amenityType":"MEAL","amenityProvider":{"name":"BrandedFare"}},{"description":"BASIC SEAT","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}},{"description":"CHANGEABLE TICKET","isChargeable":true,"amenityType":"BRANDED_FARES","amenityProvider":{"name":"BrandedFare"}}]}]}]},"id":"112","numOfTravelers":2,"price":1643.56,"duration":"PT5H15M","stops":0,"airline":"LY","outbound":{"stops":[{"iataCode":"AMS","duration":null}],"departureTime":"2025-11-06T16:00:00","departureAirport":"TLV","arrivalAirport":"AMS","arrivalTime":"2025-11-06T20:15:00","duration":"PT5H15M","checkBagsIncluded":false,"cabinBagsIncluded":true,"flightNumber":"LY339"},"inbound":{"departureTime":"2025-11-11T11:30:00","departureAirport":"AMS","arrivalAirport":"TLV","arrivalTime":"2025-11-11T16:55:00","stops":[{"iataCode":"TLV","duration":null}],"duration":"PT4H25M","checkBagsIncluded":false,"cabinBagsIncluded":true,"flightNumber":"LY338"},"metadata":{"iata":"LY","icao":"ELY","name":"EL AL","logo":"https://www.avcodes.co.uk/images/logos/ELY.png"},"penalties":"PE.PENALTIES \nCANCELLATIONS\nACCORDING TO ISRAELI CONSUMER PROTECTION LAW.\nFOR MORE INFORMATION PLEASE VISIT WWW.ELAL.COM/HEB/LEGAL/TICKET-CANCELLATION.","bags":65}

Charter JSON data for flight offer
{"offer":{},"id":"1","numOfTravelers":2,"price":700,"duration":"PT8H55M","stops":0,"airline":"LY","outbound":{"stops":[{"iataCode":"BCN","duration":null}],"departureTime":"2025-10-28T06:30:00","departureAirport":"TLV","arrivalAirport":"BCN","arrivalTime":"2025-10-28T10:15:00","duration":"PT4H45M","checkBagsIncluded":true,"cabinBagsIncluded":true,"flightNumber":"LY393"},"inbound":{"stops":[{"iataCode":"TLV","duration":null}],"departureTime":"2025-11-01T22:50:00","departureAirport":"BCN","arrivalAirport":"TLV","arrivalTime":"2025-11-02T04:00:00","duration":"PT4H10M","checkBagsIncluded":true,"cabinBagsIncluded":true,"flightNumber":"LY392"},"metadata":{"iata":"LY","name":"EL AL","logo":"https://www.avcodes.co.uk/images/logos/ELY.png"},"penalties":"PE.PENALTIES \nCANCELLATIONS \n45 DAYS OR MORE BEFORE DEPARTURE CHARGE USD 100.00 FOR CANCELLATIONS PER TICKET.\n44-30 DAYS BEFORE DEPARTURE CHARGE USD 250.00 FOR CANCELLATIONS PER TICKET.\nLESS THAN 30 DAYS BEFORE DEPARTURE NON-REFUNDABLE. \nCHANGES \nBEFORE DEPARTURE CHARGE USD 120.00 FOR REISSUE/REVALIDATION. NOTE - WHEN THE FIRST FLIGHT COUPON IS BEING CHANGED NEW FARE WILL BE RECALCULATED USING FARES AND IATA RATE OF EXCHANGE IN EFFECT ON THE DATE OF REISSUE. \nAFTER DEPARTURE CHARGE USD 120.00 FOR REISSUE/REVALIDATION. CHARGE USD 200.00 FOR NO-SHOW. NOTE - BEFORE EXPIRY OF FLIGHT COUPON. UPGRADE TO ANY HIGHER FARE PERMITTED IN WHICH CASE CHANGE OF RESERVATION FEE OF USD 120.00 WILL ALSO APPLY. ------------------------------------------------ THE AP THE SECURITY AND INSURANCE SURCHARGE WHICH IS COLLECTED IN THE TFC AREA OF THE TICKET IS NOT REFUNDABLE. UNLESS THE TICKETS FARE IS FULLY REFUNDABLE ","bags":65}
*/
