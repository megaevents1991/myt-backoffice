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
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getP1EventById,
} from "@/lib/actions/p1-events-actions";
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";
import {
  P1EventDB,
  P1Ticket,
} from "@/types/p1-events.types";
import { Event, EventTicket } from "@/types/app.types";

export default function P1EventDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const eventId = params.id as string;

  const [event, setEvent] = useState<P1EventDB | null>(null);
  const [tickets, setTickets] = useState<P1Ticket[]>([]);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);

  useEffect(() => {
    if (eventId) {
      loadEventDetails(eventId);
    }
  }, [eventId]);

  const loadEventDetails = async (id: string) => {
    try {
      setIsLoadingEvent(true);

      const eventData = await getP1EventById(id);

      if (!eventData) {
        toast({
          variant: "destructive",
          title: "Event Not Found",
          description: "The requested event could not be found.",
        });
        router.push("/p1-events");
        return;
      }

      setEvent(eventData);
      
      // Tickets are already embedded in the event
      if (eventData.tickets && Array.isArray(eventData.tickets)) {
        setTickets(eventData.tickets);
      }
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

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
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
      // Update exchange rates first
      await exchangeRateClientService.updateAllExchangeRates();

      // Filter out tickets with stock < 2 and hospitality tickets
      const availableTickets = tickets.filter(
        (ticket) =>
          ticket.stock >= 2 &&
          !ticket.tags.some((tag) => tag.toLowerCase() === "hospitality")
      );

      if (availableTickets.length === 0) {
        toast({
          variant: "destructive",
          title: "No Tickets Available",
          description: "This event has no available tickets (excluding low stock and hospitality).",
        });
        return;
      }

      // Helper function to convert price to USD
      const convertPriceToUSD = async (
        price: number,
        currency: string
      ): Promise<number> => {
        if (currency === "USD") {
          return price + 40;
        }

        let result: number;
        switch (currency.toUpperCase()) {
          case "EUR":
            result = await exchangeRateClientService.convertToUSD(price + 40, "EUR");
            break;
          case "GBP":
            result = await exchangeRateClientService.convertToUSD(price + 35, "GBP");
            break;
          case "ILS":
            result = await exchangeRateClientService.convertToUSD(price + 150, "ILS");
            break;
          default:
            result = price;
        }
        return result;
      };

      const eventTickets: EventTicket[] = await Promise.all(
        availableTickets.map(async (ticket) => {
          const priceInUSD = Math.round(
            await convertPriceToUSD(ticket.price_ticket, ticket.currency)
          );

          const roundedPrice = Math.ceil(priceInUSD / 10) * 10 - 1;

          return {
            id: ticket.id,
            eid: event.event_id,
            category: ticket.category,
            price: roundedPrice,
            description: ticket.seatingplan_category_description || "",
            colorOnTheMap: "#fdfdfdff",
            vendor: "P1Tickets",
            available: true,
          };
        })
      );

      const locationData = {
        latitude: event.venue_latitude,
        longitude: event.venue_longitude,
        name: event.venue_name,
        city_iata: "",
        country_code: undefined,
      };

      const eventData: Omit<Event, "id"> = {
        name: event.title,
        name_english: event.title_english || event.title,
        type: "sports_event",
        date: new Date(event.date_start).toISOString().split("T")[0],
        location: locationData,
        map_image_url: "",
        description: event.series_name
          ? `${event.title} - ${event.series_name}`
          : event.title,
        card_image_url: "",
        tickets_and_rates: eventTickets,
        def_date_depart: "",
        def_date_return: "",
        usual_price: 0,
        base_flight_price: 0,
        base_hotel_price: 0,
        is_prioritized: false,
        is_deleted: "",
        tags: event.category,
      };

      // Apply smart date calculation
      const smartDates = calculateSmartDates(eventData.date);
      eventData.def_date_depart = smartDates.departure;
      eventData.def_date_return = smartDates.return;

      // Encode the event data and navigate to create event page
      const encodedData = encodeURIComponent(JSON.stringify(eventData));
      router.push(`/events/new?data=${encodedData}`);
    } catch (error) {
      console.error("Failed to create event from P1 event:", error);
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
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Event not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Filter tickets for display (same as in handleCreateEvent)
  const displayTickets = tickets.filter(
    (ticket) =>
      ticket.stock >= 2 &&
      !ticket.tags.some((tag) => tag.toLowerCase() === "hospitality")
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={handleCreateEvent}>
          <Calendar className="mr-2 h-4 w-4" />
          Create Event from P1 Data
        </Button>
      </div>

      {/* Event Details */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{event.title}</CardTitle>
              {event.series_name && (
                <CardDescription className="text-base mt-2">
                  {event.series_name}
                </CardDescription>
              )}
            </div>
            <Badge variant="secondary" className="text-sm">
              {event.category}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Date & Time */}
          <div className="flex items-start gap-3">
            <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">Date & Time</p>
              <p className="text-muted-foreground">{formatDate(event.date_start)}</p>
              {event.date_end && (
                <p className="text-sm text-muted-foreground">
                  Ends: {formatDate(event.date_end)}
                </p>
              )}
              <div className="flex gap-2 mt-2">
                {event.date_confirmed && (
                  <Badge variant="outline" className="text-xs">
                    Date Confirmed
                  </Badge>
                )}
                {event.has_available_tickets && (
                  <Badge variant="outline" className="text-xs bg-green-100 text-green-800">
                    Tickets Available
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Venue */}
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">{event.venue_name}</p>
              <p className="text-muted-foreground">
                {event.venue_city}, {event.venue_country_code}
              </p>
              <p className="text-sm text-muted-foreground">
                Lat: {event.venue_latitude}, Lng: {event.venue_longitude}
              </p>
            </div>
          </div>

          {/* Stock & Availability */}
          <div className="flex items-start gap-3">
            <Ticket className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">Stock Information</p>
              <p className="text-muted-foreground">
                Total Stock: {event.stock}
              </p>
              <p className="text-sm text-muted-foreground">
                Available Tickets (filtered): {displayTickets.length}
              </p>
            </div>
          </div>

          {/* Links */}
          {event.checkout_link && (
            <div className="flex items-start gap-3">
              <ExternalLink className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">External Links</p>
                <a
                  href={event.checkout_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  P1 Checkout Page
                </a>
              </div>
            </div>
          )}

          {/* Compare Prices */}
          {(event.compare_price_ticket_only || event.compare_price_ticket_hotel) && (
            <div className="border-t pt-4">
              <p className="font-medium mb-2">Reference Prices</p>
              <div className="grid grid-cols-2 gap-4">
                {event.compare_price_ticket_only && (
                  <div>
                    <p className="text-sm text-muted-foreground">Ticket Only</p>
                    <p className="font-medium">
                      {formatPrice(event.compare_price_ticket_only, "EUR")}
                    </p>
                  </div>
                )}
                {event.compare_price_ticket_hotel && (
                  <div>
                    <p className="text-sm text-muted-foreground">Ticket + Hotel</p>
                    <p className="font-medium">
                      {formatPrice(event.compare_price_ticket_hotel, "EUR")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            Available Tickets
          </CardTitle>
          <CardDescription>
            {displayTickets.length} tickets available (excluding low stock and hospitality)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {displayTickets.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {displayTickets.map((ticket) => (
                <Card key={ticket.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{ticket.category}</CardTitle>
                    {ticket.seatingplan_category_name !== ticket.category && (
                      <CardDescription className="text-sm">
                        {ticket.seatingplan_category_name}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Price</span>
                      <span className="text-lg font-bold text-primary">
                        {formatPrice(ticket.price_ticket, ticket.currency)}
                      </span>
                    </div>

                    {ticket.price_ticket_hotel && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          With Hotel
                        </span>
                        <span className="text-sm font-medium">
                          {formatPrice(ticket.price_ticket_hotel, ticket.currency)}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Stock</span>
                      <Badge variant="outline">{ticket.stock}</Badge>
                    </div>

                    {ticket.seatingplan_category_description && (
                      <p className="text-xs text-muted-foreground border-t pt-2">
                        {ticket.seatingplan_category_description}
                      </p>
                    )}

                    {ticket.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 border-t pt-2">
                        {ticket.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {ticket.possible_ticket_types.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Types: {ticket.possible_ticket_types.join(", ")}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No tickets available for this event (after filtering)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
