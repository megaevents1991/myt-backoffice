"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { 
  ArrowLeft, 
  Calendar, 
  MapPin, 
  Ticket, 
  Info,
  CreditCard,
  Truck,
  Plus,
  Loader2,
  Map as MapIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { EventComparisonModal } from "@/components/event-comparison-modal";
import { getTixStockEventById, getTixStockTickets } from "@/lib/actions/tixstock-actions";
import { getDynamicMaps } from "@/lib/actions/map-actions";
import { TixStockEventDB, TixStockListing } from "@/types/tixstock.types";
import { Event, EventTicket } from "@/types/app.types";
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";

export default function TixStockEventDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const eventId = params.id as string;

  const [event, setEvent] = useState<TixStockEventDB | null>(null);
  const [tickets, setTickets] = useState<TixStockListing[]>([]);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  // Map state
  const [availableMaps, setAvailableMaps] = useState<{ name: string; path: string }[]>([]);
  const [selectedMapPath, setSelectedMapPath] = useState<string>("");
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [hoveredTicket, setHoveredTicket] = useState<TixStockListing | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (eventId) {
      loadEventDetails(eventId);
    }
    getDynamicMaps().then(setAvailableMaps);
  }, [eventId]);

  useEffect(() => {
    async function fetchSvg() {
      if (!selectedMapPath) {
        setSvgContent(null);
        return;
      }

      setIsLoadingMap(true);
      try {
        const response = await fetch(selectedMapPath);
        const text = await response.text();
        setSvgContent(text);
      } catch (error) {
        console.error("Failed to load SVG:", error);
        setSvgContent(null);
      } finally {
        setIsLoadingMap(false);
      }
    }

    fetchSvg();
  }, [selectedMapPath]);

  // Helper to check if a ticket matches a map section ID
  const isTicketMatchingSection = (ticket: TixStockListing, mapSectionId: string) => {
    if (!ticket.seat_details.section) return false;
    const norm = ticket.seat_details.section.replace(/block|section/gi, '').trim().toLowerCase();
    const mapId = mapSectionId.toLowerCase();
    return mapId === norm || mapId.endsWith(`_${norm}`) || mapId.endsWith(`-${norm}`);
  };

  // Handle SVG highlighting
  useEffect(() => {
    if (!svgContent || !mapContainerRef.current) return;

    // Clear previous highlights
    const highlightedElements = mapContainerRef.current.querySelectorAll('.svg-highlighted');
    highlightedElements.forEach(el => el.classList.remove('svg-highlighted'));

    // 1. Highlight Selected Section (Persistent)
    if (selectedSection) {
      const allSections = mapContainerRef.current.querySelectorAll('[data-section]');
      allSections.forEach(el => {
        if (el.getAttribute('data-section') === selectedSection) {
          el.classList.add('svg-highlighted');
        }
      });
    }

    // 2. Highlight Hovered Ticket (Transient) - only if no section is selected OR if it matches the selected one
    // Actually, user might want to see where the hovered ticket is even if a section is selected.
    // But if we are filtering, we only see tickets for that section anyway.
    if (hoveredTicket && hoveredTicket.seat_details.section) {
      const section = hoveredTicket.seat_details.section;
      // Simple normalization: remove "Block", "Section", trim, lowercase
      const normalizedSection = section.replace(/block|section/gi, '').trim().toLowerCase();
      
      // Find elements with data-section attribute
      const allSections = mapContainerRef.current.querySelectorAll('[data-section]');
      allSections.forEach(el => {
        const dataSection = el.getAttribute('data-section')?.toLowerCase();
        if (dataSection) {
            const isMatch = (
                dataSection === normalizedSection || 
                dataSection.endsWith(`_${normalizedSection}`) || 
                dataSection.endsWith(`-${normalizedSection}`)
            );

            if (isMatch) {
                el.classList.add('svg-highlighted');
            }
        }
      });
    }
  }, [hoveredTicket, svgContent, selectedSection]);

  const loadEventDetails = async (id: string) => {
    try {
      setIsLoadingEvent(true);
      const eventData = await getTixStockEventById(id);
      
      if (!eventData) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Event not found.",
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
        description: "Failed to load event details.",
      });
    } finally {
      setIsLoadingEvent(false);
    }
  };

  const loadTickets = async (id: string) => {
    try {
      setIsLoadingTickets(true);
      const ticketsData = await getTixStockTickets(id);
      setTickets(ticketsData);
    } catch (error) {
      console.error("Failed to load tickets:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load tickets from TixStock.",
      });
    } finally {
      setIsLoadingTickets(false);
    }
  };

  const formatPrice = (amount: string, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(parseFloat(amount));
  };

  // Helper function to calculate smart departure and return dates
  const calculateSmartDates = (eventDate: string) => {
    const event = new Date(eventDate);

    // Calculate departure date (2 days before, but avoid Friday/Saturday)
    const departure = new Date(event);
    departure.setDate(event.getDate() - 2);

    const departureDay = departure.getDay();
    if (departureDay === 5) {
      departure.setDate(departure.getDate() - 1); // Move to Thursday
    } else if (departureDay === 6) {
      departure.setDate(departure.getDate() - 2); // Move to Thursday
    }

    // Calculate return date (1 day after, but if Saturday move to Sunday)
    const returnDate = new Date(event);
    returnDate.setDate(event.getDate() + 1);

    if (returnDate.getDay() === 6) {
      returnDate.setDate(returnDate.getDate() + 1); // Move to Sunday
    }

    return {
      departure: departure.toISOString().split("T")[0],
      return: returnDate.toISOString().split("T")[0],
    };
  };

  const handleCreateEventFromTixStock = async () => {
    if (!event) return;

    try {
      // Update exchange rates first
      await exchangeRateClientService.updateAllExchangeRates();

      // Use the map URL directly
      const mapImageUrl = event.venue_map_url || "";

      // Helper function to convert price to USD
      const convertPriceToUSD = async (
        price: number,
        currency: string
      ): Promise<number> => {
        if (currency === "USD") {
          return price + 40; // Markup only
        }

        let result: number;
        switch (currency.toUpperCase()) {
          case "EUR":
            result = await exchangeRateClientService.convertToUSD(price + 40, "EUR");
            break;
          case "GBP":
            result = await exchangeRateClientService.convertToUSD(price + 35, "GBP");
            break;
          default:
            console.warn(`Unknown currency ${currency}, using price as-is`);
            result = price;
        }

        return result;
      };

      // Map tickets
      const mappedTickets: EventTicket[] = await Promise.all(
        tickets.map(async (ticket) => {
            const priceVal = parseFloat(ticket.face_value?.amount || "0");
            const currency = ticket.face_value?.currency || "EUR";
            
            const priceInUSD = Math.round(
                await convertPriceToUSD(priceVal, currency)
            );
            
            const roundedPrice = Math.ceil(priceInUSD / 10) * 10 - 1;

            return {
                id: ticket.id,
                category: ticket.seat_details?.category || "Unknown",
                price: roundedPrice,
                description: `${ticket.seat_details?.section || ''} ${ticket.seat_details?.row ? `Row ${ticket.seat_details.row}` : ''}`.trim(),
                colorOnTheMap: "#fdfdfdff",
                vendor: "TixStock",
                available: ticket.number_of_tickets_for_sale?.quantity_available > 0,
                eid: event.event_id,
            };
        })
      );

      const locationData = {
        latitude: event.venue_data?.latitude || 0,
        longitude: event.venue_data?.longitude || 0,
        name: event.venue_name || "Unknown Venue",
        city_iata: "", 
      };

      const eventData: Omit<Event, "id"> = {
        name: event.event_name,
        name_english: event.event_name,
        type: "tx_event", 
        date: new Date(event.show_date).toISOString().split("T")[0],
        location: locationData,
        map_image_url: mapImageUrl,
        description: `${event.event_name} at ${event.venue_name}`,
        card_image_url: "",
        tickets_and_rates: mappedTickets,
        def_date_depart: "",
        def_date_return: "",
        usual_price: 0,
        base_flight_price: 0,
        base_hotel_price: 0,
        is_prioritized: false,
        is_deleted: "",
        tags: event.category_name || "",
      };

      // Apply smart date calculation
      const smartDates = calculateSmartDates(eventData.date);
      eventData.def_date_depart = smartDates.departure;
      eventData.def_date_return = smartDates.return;

      // Encode the event data and navigate to create event page
      const encodedData = encodeURIComponent(JSON.stringify(eventData));
      router.push(`/events/new?data=${encodedData}`);

      toast({
        title: "Event Data Prepared",
        description: "Redirecting to create event page with TixStock event data.",
      });

    } catch (error) {
      console.error("Failed to create event from TixStock event:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to prepare event data. Please try again.",
      });
    }
  };

  if (isLoadingEvent) {
    return <div className="p-8 text-center">Loading event details...</div>;
  }

  if (!event) {
    return <div className="p-8 text-center">Event not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{event.event_name}</h2>
            <div className="flex items-center text-muted-foreground space-x-4 mt-1">
              <div className="flex items-center">
                <Calendar className="mr-1 h-4 w-4" />
                {format(new Date(event.show_date), "PPP p")}
              </div>
              <div className="flex items-center">
                <MapPin className="mr-1 h-4 w-4" />
                {event.venue_name}, {event.city_name}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <EventComparisonModal event={event} />
          <Button onClick={handleCreateEventFromTixStock}>
            <Plus className="mr-2 h-4 w-4" />
            Create Event
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Category</p>
                <p>{event.category_name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <Badge variant={event.is_active ? "default" : "secondary"}>
                  {event.event_status}
                </Badge>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Venue</p>
                <p>{event.venue_name}</p>
                <p className="text-sm text-muted-foreground">
                  {event.venue_data?.address_line_1}, {event.venue_data?.city}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Performers</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {event.performers?.map((p) => (
                    <Badge key={p.id} variant="outline">{p.name}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ticket Stats</CardTitle>
            <CardDescription>Real-time inventory summary</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col items-center justify-center p-4 border rounded-lg">
                <Ticket className="h-8 w-8 mb-2 text-primary" />
                <span className="text-2xl font-bold">{tickets.length}</span>
                <span className="text-xs text-muted-foreground">Listings Available</span>
              </div>
              <div className="flex flex-col items-center justify-center p-4 border rounded-lg">
                <CreditCard className="h-8 w-8 mb-2 text-green-600" />
                <span className="text-2xl font-bold">
                  {tickets.length > 0 
                    ? formatPrice(
                        Math.min(...tickets.map(t => parseFloat(t.proceed_price.amount))).toString(),
                        tickets[0]?.proceed_price.currency || 'EUR'
                      )
                    : '-'}
                </span>
                <span className="text-xs text-muted-foreground">Starting Price</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dynamic Map Selection */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex flex-col space-y-1.5">
            <CardTitle>Dynamic Map</CardTitle>
            <CardDescription>Select a map to visualize sections</CardDescription>
          </div>
          <Select value={selectedMapPath} onValueChange={setSelectedMapPath}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select a map..." />
            </SelectTrigger>
            <SelectContent>
              {availableMaps.map((map) => (
                <SelectItem key={map.path} value={map.path}>
                  {map.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {selectedMapPath ? (
            <div className="venue-map-container flex items-center justify-center min-h-[400px] p-6 bg-white rounded-md border mt-4">
              <style jsx global>{`
                .venue-map-container text,
                .venue-map-container tspan {
                  pointer-events: none !important;
                  user-select: none !important;
                }
                .venue-map-container path,
                .venue-map-container rect,
                .venue-map-container polygon,
                .venue-map-container circle,
                .venue-map-container [data-section] {
                  pointer-events: all !important;
                  cursor: pointer !important;
                }
                .svg-highlighted,
                .svg-highlighted * {
                  fill: #ff0000 !important;
                  stroke: #fff !important;
                  stroke-width: 1px !important;
                  opacity: 1 !important;
                  transition: all 0.3s ease;
                }
                [data-section] {
                  transition: fill 0.3s ease;
                  cursor: pointer;
                }
              `}</style>
              {isLoadingMap ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : svgContent ? (
                <div 
                  ref={mapContainerRef}
                  className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-[600px] [&>svg]:w-auto [&>svg]:h-auto"
                  dangerouslySetInnerHTML={{ __html: svgContent }} 
                  onClick={(e) => {
                    // Advanced Click Handling:
                    // 1. Get all elements under the cursor (handles overlapping layers)
                    // 2. Prioritize elements that have matching tickets
                    // 3. Fallback to the top-most element with a data-section
                    
                    const elements = document.elementsFromPoint(e.clientX, e.clientY);
                    
                    let bestMatch: { section: string, hasTickets: boolean } | null = null;
                    let firstSectionFound: string | null = null;

                    for (const el of elements) {
                        // Ensure the element is part of our map
                        if (!mapContainerRef.current?.contains(el)) continue;

                        const sectionEl = el.closest('[data-section]');
                        const dataSection = sectionEl?.getAttribute('data-section');

                        if (dataSection) {
                            if (!firstSectionFound) firstSectionFound = dataSection;

                            const hasTickets = tickets.some(t => isTicketMatchingSection(t, dataSection));
                            if (hasTickets) {
                                bestMatch = { section: dataSection, hasTickets: true };
                                break; // Found a high-priority match!
                            }
                        }
                    }

                    // If no ticket-holding section was found, use the first section we hit (if any)
                    const finalSection = bestMatch ? bestMatch.section : firstSectionFound;
                    const hasTickets = bestMatch ? bestMatch.hasTickets : false;

                    if (finalSection) {
                      if (hasTickets) {
                        // Toggle selection or select new
                        setSelectedSection(prev => prev === finalSection ? null : finalSection);
                        
                        // Count tickets for toast
                        const count = tickets.filter(t => isTicketMatchingSection(t, finalSection)).length;
                        toast({
                          title: "Filter Applied",
                          description: `Showing ${count} tickets for section.`,
                        });
                      } else {
                        // Clicked section with no tickets -> reset
                        setSelectedSection(null);
                        toast({
                          title: "No Tickets",
                          description: "No tickets available for this section.",
                        });
                      }
                    } else {
                      // Clicked outside any section -> reset
                      setSelectedSection(null);
                    }
                  }}
                />
              ) : (
                <p className="text-muted-foreground">Failed to load map</p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[100px] text-muted-foreground text-sm border-dashed border-2 rounded-md mt-4">
              Select a map from the dropdown to view it here
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Available Tickets</CardTitle>
            <CardDescription>
              Live inventory from TixStock API
              {selectedSection && (
                <span className="ml-2 font-medium text-primary">
                  (Filtered by map selection)
                </span>
              )}
            </CardDescription>
          </div>
          {selectedSection && (
            <Button variant="outline" size="sm" onClick={() => setSelectedSection(null)}>
              Show All Tickets
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category / Section</TableHead>
                <TableHead>Row</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead className="text-right">Cost Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingTickets ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    Loading tickets...
                  </TableCell>
                </TableRow>
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    No tickets available for this event.
                  </TableCell>
                </TableRow>
              ) : (
                tickets
                  .filter(ticket => !selectedSection || isTicketMatchingSection(ticket, selectedSection))
                  .map((ticket) => (
                  <TableRow 
                    key={ticket.id}
                    onMouseEnter={() => setHoveredTicket(ticket)}
                    onMouseLeave={() => setHoveredTicket(null)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>
                      <div className="font-medium">{ticket.seat_details.category}</div>
                      <div className="text-xs text-muted-foreground">
                        {ticket.seat_details.section}
                      </div>
                    </TableCell>
                    <TableCell>{ticket.seat_details.row || "Any"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ticket.number_of_tickets_for_sale.quantity_available}
                      </Badge>
                    </TableCell>
                    <TableCell>{ticket.ticket.type}</TableCell>
                    <TableCell>
                      <div className="flex items-center text-xs">
                        <Truck className="mr-1 h-3 w-3" />
                        {ticket.delivery.type}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {formatPrice(ticket.proceed_price.amount, ticket.proceed_price.currency)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
