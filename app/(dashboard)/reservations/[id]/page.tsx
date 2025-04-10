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

export default function ReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const resolvedParams = use(params);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <div>Loading reservation details...</div>;
  }

  if (!reservation) {
    return <div>Reservation not found</div>;
  }

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
          className="ml-auto"
        >
          Print
        </Button>
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
            </div>

            <div>
              <p className="text-sm font-medium">Email</p>
              <p className="text-lg">{reservation.main_contact_email}</p>
            </div>

            <div>
              <p className="text-sm font-medium">Phone</p>
              <p className="text-lg">{reservation.main_contact_phone_number}</p>
            </div>

            {reservation.more_pax_info &&
              reservation.more_pax_info.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Additional Guests</p>
                  <div className="space-y-2">
                    {reservation.more_pax_info.map((guest, index) => (
                      <div key={index} className="flex gap-2">
                        <p>
                          {guest.first_name} {guest.last_name}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
          {reservation.event_order_info && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium">Event Name</p>
                <p className="text-lg">{reservation.event_order_info.name}</p>
              </div>

              <div>
                <p className="text-sm font-medium">Event Date</p>
                <p className="text-lg">
                  {new Date(
                    reservation.event_order_info.date
                  ).toLocaleDateString()}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Location</p>
                <p className="text-lg">
                  {reservation.event_order_info.location_name}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Ticket Category</p>
                <p className="text-lg">
                  {reservation.event_order_info.category}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Number of Tickets</p>
                <p className="text-lg">
                  {reservation.event_order_info.number_of_ticket}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Price per Ticket</p>
                <p className="text-lg">
                  ${reservation.event_order_info.price_per_ticket.toFixed(2)}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium">Total Tickets Price</p>
                <p className="text-lg">
                  ${reservation.event_order_info.total_tickets_price.toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Flight Information</CardTitle>
            <CardDescription>
              Details about the flight in this reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reservation.flight_order_info && (
              <div className="space-y-4">
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
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hotel Information</CardTitle>
            <CardDescription>
              Details about the hotel in this reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reservation.hotel_order_info && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium">Hotel Name</p>
                  <p className="text-lg">{reservation.hotel_order_info.name}</p>
                </div>

                <div>
                  <p className="text-sm font-medium">Address</p>
                  <p className="text-lg">
                    {reservation.hotel_order_info.address}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium">Price</p>
                  <p className="text-lg">
                    ${reservation.hotel_order_info.price}
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

                {reservation.hotel_order_info.guests &&
                  reservation.hotel_order_info.guests.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Guests</p>
                      <div className="space-y-2">
                        {reservation.hotel_order_info.guests.map(
                          (guest, index) => (
                            <div key={index} className="text-sm">
                              Guest {index + 1}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
        <Link href={`/reservations/${reservation.id}/edit`}>
          <Button>Edit Reservation</Button>
        </Link>
      </div>
    </div>
  );
}
