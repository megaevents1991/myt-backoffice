"use client";

import Link from "next/link";
import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { Event } from "@/types/app.types";
import { getEvent } from "@/lib/actions/event-actions";

export default function ViewEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const unwrappedParams = use(params);
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEvent() {
      try {
        const data = await getEvent(Number.parseInt(unwrappedParams.id));
        setEvent(data);
      } catch (error) {
        console.error("Error fetching event:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load event details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchEvent();
  }, [unwrappedParams.id, toast]);

  if (loading) {
    return <div>Loading event details...</div>;
  }

  if (!event) {
    return <div>Event not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-3xl font-bold tracking-tight ml-4">
            Event: {event.name}
          </h1>
        </div>
        <Link href={`/events/${event.id}`}>
          <Button>
            <Edit className="mr-2 h-4 w-4" />
            Edit Event
          </Button>
        </Link>
      </div>

      {event.is_deleted && (
        <Badge variant="destructive" className="text-sm">
          Deleted on {event.is_deleted}
        </Badge>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>General details about this event</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">Name</p>
                <p className="text-lg">{event.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium">English Name</p>
                <p className="text-lg">{event.name_english}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium">Date</p>
              <p className="text-lg">
                {new Date(event.date).toLocaleDateString()}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">Description</p>
              <p className="text-lg">
                {event.description || "No description provided"}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm font-medium">Usual Price</p>
                <p className="text-lg">${event.usual_price.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Base Flight Price</p>
                <p className="text-lg">${event.base_flight_price.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Base Hotel Price</p>
                <p className="text-lg">${event.base_hotel_price.toFixed(2)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm font-medium">Prioritized</p>
                <p className="text-lg">{event.is_prioritized ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Tags</p>
                <p className="text-lg">{event.tags}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
            <CardDescription>Location details for this event</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium">Location Name</p>
              <p className="text-lg">{event.location.name}</p>
            </div>

            <div>
              <p className="text-sm font-medium">City IATA Code</p>
              <p className="text-lg">{event.location.city_iata || "N/A"}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">Latitude</p>
                <p className="text-lg">{event.location.latitude}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Longitude</p>
                <p className="text-lg">{event.location.longitude}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tickets and Rates</CardTitle>
          <CardDescription>
            Available ticket categories for this event
          </CardDescription>
        </CardHeader>
        <CardContent>
          {event.tickets_and_rates.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              No tickets have been added to this event.
            </div>
          ) : (
            <div className="space-y-6">
              {event.tickets_and_rates.map((ticket, index) => (
                <div key={ticket.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium">
                      Ticket #{index + 1}: {ticket.category}
                    </h3>
                    <div
                      className="w-6 h-6 rounded-full"
                      style={{ backgroundColor: ticket.colorOnTheMap }}
                    />
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <p className="text-sm font-medium">Price</p>
                      <p className="text-lg">${ticket.price.toFixed(2)}</p>
                    </div>

                    {ticket.description && (
                      <div>
                        <p className="text-sm font-medium">Description</p>
                        <p className="text-lg">{ticket.description}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
          <CardDescription>Images associated with this event</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {event.card_image_url && (
            <div>
              <p className="text-sm font-medium mb-2">Card Image</p>
              <div className="overflow-hidden rounded-md border">
                <img
                  src={event.card_image_url || "/placeholder.svg"}
                  alt={`Card image for ${event.name}`}
                  className="h-48 w-full object-cover"
                />
              </div>
            </div>
          )}

          {event.map_image_url && (
            <div>
              <p className="text-sm font-medium mb-2">Map Image</p>
              <div className="overflow-hidden rounded-md border">
                <img
                  src={event.map_image_url || "/placeholder.svg"}
                  alt={`Map image for ${event.name}`}
                  className="h-48 w-full object-cover"
                />
              </div>
            </div>
          )}

          {!event.card_image_url && !event.map_image_url && (
            <div className="text-center py-4 text-muted-foreground">
              No images have been added to this event.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
