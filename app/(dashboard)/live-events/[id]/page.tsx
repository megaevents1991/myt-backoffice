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
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Users,
  Ticket,
  Trophy,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getLiveEventById,
  getLiveTickets,
} from "@/lib/actions/live-events-actions";
import {
  LiveEventDB,
  LiveTicketCategory,
  CURRENCIES,
  SEATING_METHODS,
} from "@/types/live-events.types";
import { Event, EventTicket } from "@/types/app.types";

export default function LiveEventDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const eventId = parseInt(params.id as string);

  const [event, setEvent] = useState<LiveEventDB | null>(null);
  const [tickets, setTickets] = useState<LiveTicketCategory[]>([]);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  useEffect(() => {
    if (eventId) {
      loadEventDetails(eventId);
    }
  }, [eventId]);

  const loadEventDetails = async (id: number) => {
    try {
      setIsLoadingEvent(true);

      const eventData = await getLiveEventById(id);

      if (!eventData) {
        toast({
          variant: "destructive",
          title: "Event Not Found",
          description: "The requested event could not be found.",
        });
        router.push("/live-events");
        return;
      }

      setEvent(eventData);

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

  const loadTickets = async (eventId: number) => {
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

  const formatPrice = (price: number, currency: number = 2) => {
    const currencyCode = getCurrencyCode(currency);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).format(price);
  };

  const getCurrencyCode = (currencyId: number): string => {
    switch (currencyId) {
      case CURRENCIES.USD: return "USD";
      case CURRENCIES.EUR: return "EUR";
      case CURRENCIES.GBP: return "GBP";
      case CURRENCIES.ILS: return "ILS";
      default: return "EUR";
    }
  };

  const getCurrencyName = (currencyId: number): string => {
    switch (currencyId) {
      case CURRENCIES.USD: return "USD";
      case CURRENCIES.EUR: return "EUR";
      case CURRENCIES.GBP: return "GBP";
      case CURRENCIES.ILS: return "ILS";
      default: return "OTHER";
    }
  };

  const getSeatingMethodName = (methodId: number): string => {
    switch (methodId) {
      case SEATING_METHODS.GA: return "General Admission";
      case SEATING_METHODS.SINGLES: return "Singles";
      case SEATING_METHODS.DOUBLES: return "Pairs";
      case SEATING_METHODS.GROUP: return "Group";
      default: return "Unknown";
    }
  };

  const getEventTypeIcon = (eventType: string) => {
    if (eventType === 'music_live_event_dynamic') {
      return <Ticket className="h-5 w-5" />;
    }
    return <Trophy className="h-5 w-5" />;
  };

  const getEventTypeBadgeColor = (eventType: string) => {
    if (eventType === 'music_live_event_dynamic') {
      return "bg-purple-100 text-purple-800";
    }
    return "bg-green-100 text-green-800";
  };

  const handleCreateEvent = async () => {
    if (!event || !tickets) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Event or ticket data is missing.",
      });
      return;
    }

    try {
      // Convert LIVE tickets to EventTickets
      const eventTickets: EventTicket[] = tickets.map((ticket) => ({
        id: ticket.id.toString(),
        category: ticket.title || ticket.hebTitle,
        price: ticket.cost,
        description: ticket.hebComments || ticket.engComments || "",
        colorOnTheMap: "#3B82F6",
        vendor: "LIVE",
      }));

      // Try to find the nearest location
      let locationData = {
        latitude: 0,
        longitude: 0,
        name: event.city_name || "Unknown Location",
        city_iata: event.iata || "",
      };

      try {
        // Only search for nearest location if we have valid coordinates
        // Since LIVE API might not provide coordinates, we'll use city name
        toast({
          title: "Location Auto-filled",
          description: `Using location: ${event.city_name}, ${event.country_name}`,
        });
      } catch (locationError) {
        console.error("Failed to find nearest location:", locationError);
      }

      // Calculate average ticket price for usual_price
      const ticketPrices = eventTickets
        .map((ticket) => ticket.price)
        .filter((price) => price > 0);
      const averageTicketPrice =
        ticketPrices.length > 0
          ? ticketPrices.reduce((sum, price) => sum + price, 0) /
            ticketPrices.length
          : 0;

      // Create Event object from LIVE event data
      const eventData: Omit<Event, "id"> = {
        name: event.event_name_heb || event.event_name,
        name_english: event.event_name,
        type: event.event_type,
        date: new Date(event.show_date).toISOString().split("T")[0],
        location: locationData,
        map_image_url: event.venue_map_url || "",
        description: event.show_date_remarks || `${event.event_name} at ${event.city_name}`,
        card_image_url: "",
        tickets_and_rates: eventTickets,
        def_date_depart: "",
        def_date_return: "",
        usual_price: Math.round(averageTicketPrice),
        base_flight_price: 0,
        base_hotel_price: 0,
        is_prioritized: false,
        is_deleted: "",
        tags: [
          event.primary_category,
          ...event.performers.map((p: any) => p.name),
          event.city_name,
          getCurrencyName(event.currency),
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
    } catch (error) {
      console.error("Failed to create event from LIVE event:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to prepare event data. Please try again.",
      });
    }
  };

  // Helper function to calculate smart departure and return dates
  const calculateSmartDates = (eventDate: string) => {
    const event = new Date(eventDate);

    // Calculate departure date (2 days before, but avoid Friday/Saturday)
    const departure = new Date(event);
    departure.setDate(event.getDate() - 2);

    const departureDay = departure.getDay();
    if (departureDay === 5) {
      departure.setDate(departure.getDate() - 1);
    } else if (departureDay === 6) {
      departure.setDate(departure.getDate() - 2);
    }

    // Calculate return date (1 day after, but if Saturday move to Sunday)
    const returnDate = new Date(event);
    returnDate.setDate(event.getDate() + 1);

    if (returnDate.getDay() === 6) {
      returnDate.setDate(returnDate.getDate() + 1);
    }

    return {
      departure: departure.toISOString().split("T")[0],
      return: returnDate.toISOString().split("T")[0],
    };
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
          The event you're looking for doesn't exist or has been removed.
        </p>
        <Button onClick={() => router.push("/live-events")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Live Events
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
              {getEventTypeIcon(event.event_type)}
              {event.event_name}
            </h1>
            {event.event_name_heb && (
              <p className="text-lg text-muted-foreground mt-1">
                {event.event_name_heb}
              </p>
            )}
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
                  <label className="text-sm font-medium text-muted-foreground">
                    Date
                  </label>
                  <p className="font-semibold">{formatDate(event.show_date)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Time
                  </label>
                  <p className="font-semibold">{formatTime(event.show_date)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Event Type
                  </label>
                  <Badge
                    variant="outline"
                    className={`${getEventTypeBadgeColor(event.event_type)}`}
                  >
                    {event.event_type === 'music_live_event_dynamic' ? 'Music Event' : 'Sports Event'}
                  </Badge>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Currency
                  </label>
                  <Badge variant="outline">
                    {getCurrencyName(event.currency)}
                  </Badge>
                </div>
              </div>

              {event.show_date_remarks && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Remarks
                  </label>
                  <p className="text-sm">{event.show_date_remarks}</p>
                </div>
              )}

              {event.is_show_date_finale && (
                <Badge variant="secondary">Finale Event</Badge>
              )}
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
                  <label className="text-sm font-medium text-muted-foreground">
                    City
                  </label>
                  <p className="font-semibold">{event.city_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Country
                  </label>
                  <p className="font-semibold">
                    {event.country_name} ({event.iata})
                  </p>
                </div>
              </div>

              {event.street_address && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Address
                  </label>
                  <p className="text-sm">{event.street_address}</p>
                  {event.street_address_heb && (
                    <p className="text-sm text-muted-foreground">
                      {event.street_address_heb}
                    </p>
                  )}
                </div>
              )}

              {event.passport_required && (
                <Badge variant="destructive">Passport Required</Badge>
              )}

              {event.venue_map_url && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={event.venue_map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Venue Map
                    </a>
                  </Button>
                  {event.venue_map_heb_url && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={event.venue_map_heb_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Hebrew Map
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performers & Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Performers & Categories
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {event.performers.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Performers
                  </label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {event.performers.map((performer: any) => (
                      <Badge key={performer.id} variant="outline">
                        {performer.name}
                        {performer.isDtPerformer && " (DT)"}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Primary Category
                </label>
                <Badge variant="secondary" className="ml-2">
                  {event.primary_category}
                </Badge>
              </div>

              {event.categories && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    All Categories
                  </label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {event.categories.category1?.map((cat: any) => (
                      <Badge key={cat.id} variant="outline">
                        {cat.name}
                      </Badge>
                    ))}
                    {event.categories.category2?.map((cat: any) => (
                      <Badge key={cat.id} variant="outline">
                        {cat.name}
                      </Badge>
                    ))}
                    {event.categories.category3?.map((cat: any) => (
                      <Badge key={cat.id} variant="outline">
                        {cat.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
              {tickets.length > 0 ? (
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-semibold text-sm">
                            {ticket.title}
                          </h4>
                          {ticket.hebTitle && ticket.hebTitle !== ticket.title && (
                            <p className="text-xs text-muted-foreground">
                              {ticket.hebTitle}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-primary">
                            {formatPrice(ticket.cost, event.currency)}
                          </div>
                          {ticket.specialCost !== ticket.cost && (
                            <div className="text-xs text-muted-foreground line-through">
                              {formatPrice(ticket.specialCost, event.currency)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Seating:</span>
                          <Badge variant="outline" className="text-xs">
                            {getSeatingMethodName(ticket.seatingMethodId)}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Max Tickets:</span>
                          <span>{ticket.maxTicketAmount}</span>
                        </div>

                        {ticket.seatingMethodId === SEATING_METHODS.GROUP && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Group Size:</span>
                            <span>{ticket.seatingGroupMAXSize}</span>
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          {ticket.isOfficial && (
                            <Badge variant="outline" className="text-xs">
                              Official
                            </Badge>
                          )}
                          {ticket.apiImmediatePurchase && (
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-800">
                              Instant Purchase
                            </Badge>
                          )}
                          {ticket.hotelDetailsRequired && (
                            <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800">
                              Hotel Required
                            </Badge>
                          )}
                        </div>

                        {(ticket.hebComments || ticket.engComments ) && (
                          <div className="text-xs text-muted-foreground pt-2 border-t">
                            {ticket.hebComments || ticket.engComments}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : isLoadingTickets ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
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
