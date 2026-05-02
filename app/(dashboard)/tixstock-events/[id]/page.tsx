"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Ticket,
  Trophy,
  Music,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getTixStockEventById, getTixStockTickets } from "@/lib/actions/tixstock-actions";
import { TixStockEventDB, TixStockListing } from "@/types/tixstock.types";
import { Event } from "@/types/app.types";

export default function TixStockEventDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const eventId = params.id as string;

  const [event, setEvent] = useState<TixStockEventDB | null>(null);
  const [tickets, setTickets] = useState<TixStockListing[]>([]);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  useEffect(() => {
    if (eventId) {
      loadEventDetails(eventId);
    }
  }, [eventId]);

  const loadEventDetails = async (id: string) => {
    try {
      setIsLoadingEvent(true);
      const eventData = await getTixStockEventById(id);

      if (!eventData) {
        toast({
          variant: "destructive",
          title: "Event Not Found",
          description: "The requested event could not be found.",
        });
        router.push("/tixstock-events");
        return;
      }

      setEvent(eventData);
      loadTickets(id);
    } catch (error) {
      console.error("Failed to load event:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load event details. Please try again.",
      });
    } finally {
      setIsLoadingEvent(false);
    }
  };

  const loadTickets = async (id: string) => {
    try {
      setIsLoadingTickets(true);
      const data = await getTixStockTickets(id);
      setTickets(data);
    } catch (error) {
      console.error("Failed to load tickets:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load tickets. Please try again.",
      });
    } finally {
      setIsLoadingTickets(false);
    }
  };

  // Helper function to calculate smart departure and return dates
  const calculateSmartDates = (eventDate: string) => {
    const d = new Date(eventDate);

    const departure = new Date(d);
    departure.setDate(d.getDate() - 2);
    const depDay = departure.getDay();
    if (depDay === 5) departure.setDate(departure.getDate() - 1);
    else if (depDay === 6) departure.setDate(departure.getDate() - 2);

    const returnDate = new Date(d);
    returnDate.setDate(d.getDate() + 1);
    if (returnDate.getDay() === 6) returnDate.setDate(returnDate.getDate() + 1);

    return {
      departure: departure.toISOString().split("T")[0],
      return: returnDate.toISOString().split("T")[0],
    };
  };

  const handleCreateEvent = () => {
    if (!event) return;

    const locationData = {
      latitude: event.venue_data?.latitude || 0,
      longitude: event.venue_data?.longitude || 0,
      name: event.venue_name || "Unknown Venue",
      city_iata: "",
      country_code: event.country_code,
    };

    const eventData: Omit<Event, "id"> = {
      name: event.event_name,
      name_english: event.event_name,
      type: "tx_event",
      date: new Date(event.show_date).toISOString().split("T")[0],
      location: locationData,
      map_image_url: event.venue_map_url || "",
      description: `${event.event_name} at ${event.venue_name}`,
      card_image_url: "",
      tickets_and_rates: [],
      def_date_depart: "",
      def_date_return: "",
      usual_price: 0,
      base_flight_price: 0,
      base_hotel_price: 0,
      is_prioritized: false,
      is_deleted: "",
      tags: "",
    };

    const smartDates = calculateSmartDates(eventData.date);
    eventData.def_date_depart = smartDates.departure;
    eventData.def_date_return = smartDates.return;

    const encodedData = encodeURIComponent(JSON.stringify(eventData));
    router.push(`/events/new?data=${encodedData}&txEventId=${event.event_id}`);
  };

  const getCategoryIcon = (categoryName: string) => {
    if (categoryName?.toLowerCase().includes("sport") || categoryName?.toLowerCase().includes("football")) {
      return <Trophy className="h-5 w-5" />;
    }
    return <Music className="h-5 w-5" />;
  };

  if (isLoadingEvent) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="h-64 bg-muted animate-pulse rounded-lg" />
            <div className="h-32 bg-muted animate-pulse rounded-lg" />
          </div>
          <div className="h-96 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <h2 className="text-2xl font-semibold">Event Not Found</h2>
        <p className="text-muted-foreground">
          The event you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <Button onClick={() => router.push("/tixstock-events")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to TixStock Events
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              {getCategoryIcon(event.category_name)}
              {event.event_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {event.category_name}
            </p>
          </div>
        </div>
        <Button onClick={handleCreateEvent} size="lg">
          <Calendar className="h-4 w-4 mr-2" />
          Create Event
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Event Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Event Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Date</label>
                  <p className="font-semibold">{format(new Date(event.show_date), "EEEE, MMMM d, yyyy")}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Time</label>
                  <p className="font-semibold">{format(new Date(event.show_date), "hh:mm a")}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <Badge variant={event.is_active ? "default" : "secondary"}>
                    {event.event_status}
                  </Badge>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Category</label>
                  <Badge variant="outline">{event.category_name}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Location Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Venue</label>
                  <p className="font-semibold">{event.venue_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">City</label>
                  <p className="font-semibold">{event.city_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Country</label>
                  <p className="font-semibold">{event.country_code}</p>
                </div>
                {event.venue_data?.postcode && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Postcode</label>
                    <p className="font-semibold">{event.venue_data.postcode}</p>
                  </div>
                )}
              </div>

              {(event.venue_data?.address_line_1 || event.venue_data?.address_line_2) && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Address</label>
                  <p className="text-sm">{event.venue_data.address_line_1}</p>
                  {event.venue_data.address_line_2 && (
                    <p className="text-sm text-muted-foreground">{event.venue_data.address_line_2}</p>
                  )}
                </div>
              )}

              {event.venue_map_url && (
                <Button variant="outline" size="sm" asChild>
                  <a href={event.venue_map_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Venue Map
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Performers & Categories */}
          {event.performers && event.performers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Performers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {event.performers.map((performer) => (
                    <Badge key={performer.id} variant="outline">
                      {performer.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar - Tickets */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="h-5 w-5" />
                Available Tickets
                {isLoadingTickets && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
              </CardTitle>
              <CardDescription>
                Live ticket pricing and availability
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingTickets ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : tickets.length > 0 ? (
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold text-sm">
                            {ticket.seat_details?.category || "General"}
                          </p>
                          {ticket.seat_details?.section && (
                            <p className="text-xs text-muted-foreground">
                              Section: {ticket.seat_details.section}
                              {ticket.seat_details.row ? ` · Row: ${ticket.seat_details.row}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm">
                            {ticket.face_value?.currency} {parseFloat(ticket.face_value?.amount || "0").toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {ticket.number_of_tickets_for_sale?.quantity_available} available
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Type</span>
                          <span>{ticket.ticket?.type || "N/A"}</span>
                        </div>
                        {ticket.proceed_price && (
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Proceed Price</span>
                            <span>{ticket.proceed_price.currency} {parseFloat(ticket.proceed_price.amount || "0").toFixed(2)}</span>
                          </div>
                        )}
                        {ticket.ticket?.general_admission === "true" && (
                          <Badge variant="secondary" className="text-xs">General Admission</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No tickets available</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadTickets(event.event_id)}
                    className="mt-2"
                  >
                    Refresh Tickets
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
