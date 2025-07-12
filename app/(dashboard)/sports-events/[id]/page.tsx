"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Ticket,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getLiveTickets } from "@/lib/actions/sports-events-actions";
import { findNearestLocation } from "@/lib/actions/location-actions";
import { supabase } from "@/lib/supabase-client";
import {
  XS2Event,
  XS2Ticket,
  XS2Tournament,
  XS2Sport,
} from "@/types/sports-events.types";
import { Event, EventTicket } from "@/types/app.types";
import { formatTicketNetPrice, formatTicketFaceValue } from "@/lib/utils";

interface EventDetails extends XS2Event {
  tournament?: XS2Tournament;
  sport?: XS2Sport;
}

export default function EventDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const eventId = params.id as string;

  const [event, setEvent] = useState<EventDetails | null>(null);
  const [tickets, setTickets] = useState<XS2Ticket[]>([]);
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

      // Fetch event details
      const { data: eventData, error: eventError } = await supabase
        .from("xs2e_events")
        .select("*")
        .eq("event_id", id)
        .single();

      if (eventError) {
        throw new Error(eventError.message);
      }

      if (!eventData) {
        throw new Error("Event not found");
      }

      // Fetch tournament details (tournament_id is NOT NULL in schema)
      let tournamentData = null;
      const { data: tournament } = await supabase
        .from("xs2e_tournaments")
        .select("*")
        .eq("tournament_id", eventData.tournament_id)
        .single();
      tournamentData = tournament;

      // Fetch sport details if tournament is available
      let sportData = null;
      if (tournamentData?.sport_type) {
        const { data: sport } = await supabase
          .from("xs2e_sports")
          .select("*")
          .eq("sport_id", tournamentData.sport_type)
          .single();
        sportData = sport;
      }

      // Combine all data
      const eventDetails: EventDetails = {
        ...eventData,
        tournament: tournamentData,
        sport: sportData,
      };

      setEvent(eventDetails);

      // Load tickets for this event
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

  const loadTickets = async (eventId: string) => {
    try {
      setIsLoadingTickets(true);
      const ticketsData = await getLiveTickets(eventId);
      setTickets(ticketsData);
    } catch (error) {
      console.error("Failed to load tickets:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load live tickets. Please try again.",
      });
    } finally {
      setIsLoadingTickets(false);
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (dateString: string | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPrice = (price: number, currency: string = "EUR") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(price);
  };

  const getStatusColor = (status: string | undefined) => {
    switch (status?.toLowerCase()) {
      case "available":
        return "bg-green-100 text-green-800";
      case "disabled":
      case "error":
        return "bg-red-100 text-red-800";
      case "returned":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getTicketTypeColor = (type: string) => {
    switch (type) {
      case "eticket":
        return "bg-blue-100 text-blue-800";
      case "appticket":
        return "bg-purple-100 text-purple-800";
      case "paper-ticket":
        return "bg-orange-100 text-orange-800";
      case "collection-stadium":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const handleCreateEvent = async () => {
    if (!event || !tickets) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Event data not available. Please refresh and try again.",
      });
      return;
    }

    // Convert XS2Tickets to EventTickets (with actual prices in euros)
    const eventTickets: EventTicket[] = tickets.map((ticket) => ({
      id: ticket.ticket_id,
      category: ticket.category_name || ticket.ticket_title,
      price: ticket.local_rates?.net_rate_eur
        ? ticket.local_rates.net_rate_eur / 100
        : 0, // Convert from cents to euros
      description: ticket.description_supplier || ticket.ticket_title,
      colorOnTheMap: "#3B82F6", // Default blue color
    }));

    // Try to find the nearest location
    let locationData = {
      latitude: Number(event.latitude) || 0,
      longitude: Number(event.longitude) || 0,
      name: event.venue_name || event.city || "Unknown Venue",
      city_iata: "", // This would need to be mapped separately
    };

    try {
      // Only search for nearest location if we have valid coordinates
      if (event.latitude && event.longitude) {
        const nearestLocation = await findNearestLocation(
          Number(event.latitude),
          Number(event.longitude)
        );

        if (nearestLocation) {
          // Use the nearest location data instead
          locationData = {
            latitude: nearestLocation.latitude,
            longitude: nearestLocation.longitude,
            name: nearestLocation.name,
            city_iata: nearestLocation.city_iata || "",
          };

          toast({
            title: "Location Auto-filled",
            description: `Found nearest location: ${
              nearestLocation.name
            } (${nearestLocation.distance?.toFixed(1)} km away)`,
          });
        }
      }
    } catch (error) {
      console.error("Failed to find nearest location:", error);
      // Continue with original location data if nearest location search fails
    }

    // Create Event object from XS2Event data
    const eventData: Omit<Event, "id"> = {
      name: event.event_name,
      name_english: event.event_name, // Fallback to same name if no translation
      date: new Date(event.date_start).toISOString().split("T")[0], // Convert to YYYY-MM-DD format
      location: locationData,
      map_image_url: "", // Not available in XS2Event
      description:
        event.event_description || `${event.event_name} at ${event.venue_name}`,
      card_image_url: "", // Not available in XS2Event
      tickets_and_rates: eventTickets,
      def_date_depart: "", // Will be calculated by smart dates
      def_date_return: "", // Will be calculated by smart dates
      usual_price: 0, // Would need to be calculated or set manually
      base_flight_price: 0, // Would need to be set manually
      base_hotel_price: 0, // Would need to be set manually
      is_prioritized: event.is_popular || false,
      is_deleted: "",
      tags: [
        event.sport?.sport_id,
        event.tournament?.official_name,
        event.city,
        event.event_status,
      ]
        .filter(Boolean)
        .join(", "),
    };

    // Apply smart date calculation
    const smartDates = calculateSmartDates(eventData.date);
    eventData.def_date_depart = smartDates.departure;
    eventData.def_date_return = smartDates.return;

    // Encode the event data and navigate to create event page
    const encodedData = encodeURIComponent(JSON.stringify(eventData));
    router.push(`/events/new?data=${encodedData}`);
  };

  // Helper function to calculate smart departure and return dates
  const calculateSmartDates = (eventDate: string) => {
    const event = new Date(eventDate);

    // Calculate departure date (2 days before, but avoid Friday/Saturday)
    const departure = new Date(event);
    departure.setDate(event.getDate() - 2);

    // If departure falls on Friday (5) or Saturday (6), move to Thursday
    const departureDay = departure.getDay();
    if (departureDay === 5) {
      // Friday
      departure.setDate(departure.getDate() - 1); // Move to Thursday
    } else if (departureDay === 6) {
      // Saturday
      departure.setDate(departure.getDate() - 2); // Move to Thursday
    }

    // Calculate return date (1 day after, but if Saturday move to Sunday)
    const returnDate = new Date(event);
    returnDate.setDate(event.getDate() + 1);

    // If return falls on Saturday (6), move to Sunday
    if (returnDate.getDay() === 6) {
      returnDate.setDate(returnDate.getDate() + 1); // Move to Sunday
    }

    return {
      departure: departure.toISOString().split("T")[0],
      return: returnDate.toISOString().split("T")[0],
    };
  };

  if (isLoadingEvent) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-lg">Loading event details...</span>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Event Not Found
        </h2>
        <p className="text-gray-600 mb-4">
          The requested event could not be found.
        </p>
        <Button onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">
            {event.event_name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            {event.sport && (
              <Badge variant="secondary">{event.sport.sport_id}</Badge>
            )}
            {event.tournament && (
              <Badge variant="outline">{event.tournament.official_name}</Badge>
            )}
            {event.event_status && (
              <Badge className={getStatusColor(event.event_status)}>
                {event.event_status}
              </Badge>
            )}
          </div>
        </div>

        <Button
          onClick={() => handleCreateEvent()}
          className="flex items-center gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Create Event
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Event Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Event Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">
                    Start Date
                  </label>
                  <p className="text-lg">{formatDate(event.date_start)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">
                    Start Time
                  </label>
                  <p className="text-lg">{formatTime(event.date_start)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">
                    End Date
                  </label>
                  <p className="text-lg">{formatDate(event.date_stop)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">
                    End Time
                  </label>
                  <p className="text-lg">{formatTime(event.date_stop)}</p>
                </div>
              </div>

              {event.slug && (
                <div>
                  <label className="text-sm font-medium text-gray-500">
                    Event Slug
                  </label>
                  <p className="text-sm font-mono rounded">{event.slug}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tournament Information */}
          {event.tournament && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Tournament Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-500">
                      Tournament Name
                    </label>
                    <p className="text-lg">{event.tournament.official_name}</p>
                  </div>
                  {event.tournament.season && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">
                        Season
                      </label>
                      <p className="text-lg">{event.tournament.season}</p>
                    </div>
                  )}
                  {event.tournament.tournament_type && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">
                        Type
                      </label>
                      <p className="text-lg">
                        {event.tournament.tournament_type}
                      </p>
                    </div>
                  )}
                  {event.tournament.region && (
                    <div>
                      <label className="text-sm font-medium text-gray-500">
                        Region
                      </label>
                      <p className="text-lg">{event.tournament.region}</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-gray-500">
                      Tournament Start
                    </label>
                    <p>{formatDate(event.tournament.date_start)}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500">
                      Tournament End
                    </label>
                    <p>{formatDate(event.tournament.date_stop)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Tickets Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Ticket className="h-5 w-5" />
                  Live Tickets
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadTickets(eventId)}
                  disabled={isLoadingTickets}
                >
                  {isLoadingTickets ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </CardTitle>
              <CardDescription>
                {tickets.length} tickets available
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingTickets ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : tickets.length > 0 ? (
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div
                      key={ticket.ticket_id}
                      className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-medium text-sm">
                          {ticket.ticket_title}
                        </h4>
                        <Badge
                          variant="outline"
                          className={getStatusColor(ticket.ticket_status)}
                        >
                          {ticket.ticket_status}
                        </Badge>
                      </div>

                      <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Category:</span>
                          <span className="font-medium">
                            {ticket.category_name}
                          </span>
                        </div>

                        {ticket.sub_category && (
                          <div className="flex justify-between">
                            <span>Sub-category:</span>
                            <span className="font-medium">
                              {ticket.sub_category}
                            </span>
                          </div>
                        )}

                        <div className="flex justify-between">
                          <span>Type:</span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${getTicketTypeColor(
                              ticket.type_ticket
                            )}`}
                          >
                            {ticket.type_ticket}
                          </Badge>
                        </div>

                        <div className="flex justify-between">
                          <span>Stock:</span>
                          <span className="font-medium">{ticket.stock}</span>
                        </div>

                        <Separator />

                        <div className="flex justify-between items-center">
                          <span>Price:</span>
                          <span className="font-bold text-primary">
                            {formatTicketNetPrice(ticket)}
                          </span>
                        </div>

                        {(ticket.face_value ||
                          ticket.local_rates?.face_value_eur) && (
                          <div className="flex justify-between">
                            <span>Face Value:</span>
                            <span className="font-medium">
                              {formatTicketFaceValue(ticket)}
                            </span>
                          </div>
                        )}
                      </div>

                      {ticket.description_supplier && (
                        <div className="mt-3 pt-2 border-t">
                          <p className="text-xs text-muted-foreground">
                            {ticket.description_supplier}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground">No tickets available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
