"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { 
  Calendar, 
  MapPin, 
  Search, 
  RefreshCw, 
  Ticket, 
  Music,
  Trophy,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SortAsc,
  SortDesc
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getTixStockEvents, getTixStockTickets, triggerTixStockSync } from "@/lib/actions/tixstock-actions";
import { TixStockEventDB, TixStockListing } from "@/types/tixstock.types";
import { Event, EventTicket } from "@/types/app.types";
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";

// Helper component for filter and sort controls
const FilterSortControls = ({
  filter,
  setFilter,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  sortOptions,
  placeholder,
}: {
  filter: string;
  setFilter: (value: string) => void;
  sortBy: string;
  setSortBy: (value: string) => void;
  sortOrder: "asc" | "desc";
  setSortOrder: (value: "asc" | "desc") => void;
  sortOptions: { value: string; label: string }[];
  placeholder: string;
}) => (
  <div className="flex gap-2 mb-4">
    <div className="relative flex-1">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="pl-8"
      />
    </div>
    <Select value={sortBy} onValueChange={setSortBy}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sortOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Button
      variant="outline"
      size="icon"
      onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
    >
      {sortOrder === "asc" ? (
        <SortAsc className="h-4 w-4" />
      ) : (
        <SortDesc className="h-4 w-4" />
      )}
    </Button>
  </div>
);

// Helper component for pagination
const PaginationControls = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
}: {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) => {
  const totalPages = Math.ceil(totalItems / pageSize);

  if (totalPages <= 1) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs sm:text-sm text-muted-foreground leading-snug">
        Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalItems)} of {totalItems} items
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden xs:inline">Previous</span>
          <span className="xs:hidden">Prev</span>
        </Button>
        <span className="flex items-center px-2 text-xs sm:text-sm">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="flex items-center gap-1"
        >
          <span className="hidden xs:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export function TixStockEventsContent() {
  const router = useRouter();
  const { toast } = useToast();
  
  // Data states
  const [events, setEvents] = useState<TixStockEventDB[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [performers, setPerformers] = useState<string[]>([]);
  const [tickets, setTickets] = useState<TixStockListing[]>([]);
  
  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Selection states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPerformer, setSelectedPerformer] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TixStockEventDB | null>(null);

  // Filter & Sort states
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryPage, setCategoryPage] = useState(1);
  const categoryPageSize = 10;

  const [performerFilter, setPerformerFilter] = useState("");
  const [performerPage, setPerformerPage] = useState(1);
  const performerPageSize = 30;

  const [eventFilter, setEventFilter] = useState("");
  const [eventSortBy, setEventSortBy] = useState<"name" | "date">("date");
  const [eventSortOrder, setEventSortOrder] = useState<"asc" | "desc">("asc");
  const [eventPage, setEventPage] = useState(1);
  const eventPageSize = 10;

  const [ticketFilter, setTicketFilter] = useState("");
  const [ticketSortBy, setTicketSortBy] = useState<"price" | "quantity">("price");
  const [ticketSortOrder, setTicketSortOrder] = useState<"asc" | "desc">("asc");
  const [ticketPage, setTicketPage] = useState(1);
  const ticketPageSize = 10;

  const loadEvents = async () => {
    try {
      setIsLoading(true);
      const data = await getTixStockEvents("");
      setEvents(data);
      
      // Extract unique categories
      const uniqueCategories = Array.from(new Set(data.map(e => e.category_name).filter(Boolean))).sort();
      setCategories(uniqueCategories);

      // Extract unique performers
      const uniquePerformers = new Set<string>();
      data.forEach(e => {
        e.performers?.forEach(p => {
          if (p.name) uniquePerformers.add(p.name);
        });
      });
      setPerformers(Array.from(uniquePerformers).sort());

    } catch (error) {
      console.error("Failed to load events:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load TixStock events.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadTickets = async (eventId: string) => {
    try {
      setIsLoadingTickets(true);
      const data = await getTixStockTickets(eventId);
      setTickets(data);
    } catch (error) {
      console.error("Failed to load tickets:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load TixStock tickets.",
      });
    } finally {
      setIsLoadingTickets(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (selectedEvent) {
      setTickets([]);
      loadTickets(selectedEvent.event_id);
    } else {
      setTickets([]);
    }
  }, [selectedEvent]);

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      toast({
        title: "Sync Started",
        description: "Syncing events from TixStock...",
      });
      
      await triggerTixStockSync();
      
      toast({
        title: "Sync Completed",
        description: "Events have been updated successfully.",
      });
      loadEvents();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: "Failed to sync events from TixStock.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const getCategoryIcon = (categoryName: string) => {
    if (categoryName?.toLowerCase().includes('sport') || categoryName?.toLowerCase().includes('football')) {
      return <Trophy className="h-4 w-4" />;
    }
    return <Music className="h-4 w-4" />;
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

  const handleCreateEventFromTixStock = async (event: TixStockEventDB) => {
    try {
      // Update exchange rates first
      await exchangeRateClientService.updateAllExchangeRates();

      // Fetch tickets for this event
      const tixStockTickets = await getTixStockTickets(event.event_id);

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
        tixStockTickets.map(async (ticket) => {
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

      const locationData: { latitude: number; longitude: number; name: string; city_iata: string; country_code?: string } = {
        latitude: event.venue_data?.latitude || 0,
        longitude: event.venue_data?.longitude || 0,
        name: event.venue_name || "Unknown Venue",
        city_iata: "",
        country_code: undefined,
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
        tags: "",
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

  // Filtered Data Logic
  const filteredCategories = useMemo(() => {
    return categories.filter(c => c.toLowerCase().includes(categoryFilter.toLowerCase()));
  }, [categories, categoryFilter]);

  const paginatedCategories = useMemo(() => {
    const start = (categoryPage - 1) * categoryPageSize;
    return filteredCategories.slice(start, start + categoryPageSize);
  }, [filteredCategories, categoryPage]);

  const filteredPerformers = useMemo(() => {
    let filtered = performers.filter(p => p.toLowerCase().includes(performerFilter.toLowerCase()));
    
    // If category selected, filter performers by that category
    if (selectedCategory) {
      const performersInCat = new Set<string>();
      events.filter(e => e.category_name === selectedCategory).forEach(e => {
        e.performers?.forEach(p => performersInCat.add(p.name));
      });
      filtered = filtered.filter(p => performersInCat.has(p));
    }
    
    return filtered;
  }, [performers, performerFilter, selectedCategory, events]);

  const paginatedPerformers = useMemo(() => {
    const start = (performerPage - 1) * performerPageSize;
    return filteredPerformers.slice(start, start + performerPageSize);
  }, [filteredPerformers, performerPage]);

  const filteredEvents = useMemo(() => {
    let filtered = events.filter(e => {
      const matchesSearch = e.event_name.toLowerCase().includes(eventFilter.toLowerCase());
      const matchesCategory = selectedCategory ? e.category_name === selectedCategory : true;
      const matchesPerformer = selectedPerformer ? e.performers?.some(p => p.name === selectedPerformer) : true;
      return matchesSearch && matchesCategory && matchesPerformer;
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      if (eventSortBy === 'name') {
        comparison = a.event_name.localeCompare(b.event_name);
      } else {
        comparison = new Date(a.show_date).getTime() - new Date(b.show_date).getTime();
      }
      return eventSortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [events, eventFilter, selectedCategory, selectedPerformer, eventSortBy, eventSortOrder]);

  const paginatedEvents = useMemo(() => {
    const start = (eventPage - 1) * eventPageSize;
    return filteredEvents.slice(start, start + eventPageSize);
  }, [filteredEvents, eventPage]);

  const filteredTickets = useMemo(() => {
    let filtered = tickets.filter(t => {
      const matchesSearch = t.seat_details?.category?.toLowerCase().includes(ticketFilter.toLowerCase()) || 
                            t.seat_details?.section?.toLowerCase().includes(ticketFilter.toLowerCase());
      return matchesSearch;
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      if (ticketSortBy === 'price') {
        comparison = parseFloat(a.face_value?.amount || "0") - parseFloat(b.face_value?.amount || "0");
      } else if (ticketSortBy === 'quantity') {
        comparison = a.number_of_tickets_for_sale.quantity_available - b.number_of_tickets_for_sale.quantity_available;
      }
      return ticketSortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [tickets, ticketFilter, ticketSortBy, ticketSortOrder]);

  const paginatedTickets = useMemo(() => {
    const start = (ticketPage - 1) * ticketPageSize;
    return filteredTickets.slice(start, start + ticketPageSize);
  }, [filteredTickets, ticketPage]);

  // Reset pagination when filters change
  useEffect(() => setCategoryPage(1), [categoryFilter]);
  useEffect(() => setPerformerPage(1), [performerFilter]);
  useEffect(() => setEventPage(1), [eventFilter, selectedCategory, selectedPerformer]);
  useEffect(() => setTicketPage(1), [ticketFilter, ticketSortBy, ticketSortOrder]);

  return (
    <div className="space-y-6">
      {/* Sync Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                TixStock Events Sync Status
              </CardTitle>
              <CardDescription>
                Manage data synchronization with TixStock API
              </CardDescription>
            </div>
            <Button onClick={handleSync} disabled={isSyncing} size="sm">
              {isSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <div>Total Events: <strong>{events.length}</strong></div>
            <div>Categories: <strong>{categories.length}</strong></div>
            <div>Performers: <strong>{performers.length}</strong></div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Categories Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Categories
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter categories..."
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="pl-8"
                />
              </div>
              
              <div className="space-y-2">
                <Button
                  variant={selectedCategory === null ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => {
                    setSelectedCategory(null);
                    setSelectedPerformer(null);
                  }}
                >
                  All Categories
                </Button>
                {paginatedCategories.map(category => (
                  <Button
                    key={category}
                    variant={selectedCategory === category ? "default" : "outline"}
                    className="w-full justify-start text-left h-auto p-3"
                    onClick={() => {
                      setSelectedCategory(prev => prev === category ? null : category);
                      setSelectedPerformer(null);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(category)}
                      <span className="truncate">{category}</span>
                    </div>
                  </Button>
                ))}
              </div>

              <PaginationControls
                currentPage={categoryPage}
                totalItems={filteredCategories.length}
                pageSize={categoryPageSize}
                onPageChange={setCategoryPage}
              />
            </CardContent>
          </Card>
        </div>

        {/* Performers Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Performers
                {selectedCategory && <Badge variant="outline" className="ml-2 text-xs">{selectedCategory}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter performers..."
                  value={performerFilter}
                  onChange={(e) => setPerformerFilter(e.target.value)}
                  className="pl-8"
                />
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
                {paginatedPerformers.map(performer => (
                  <Button
                    key={performer}
                    variant={selectedPerformer === performer ? "default" : "outline"}
                    className="w-full justify-start text-left h-auto p-2 text-sm"
                    onClick={() => setSelectedPerformer(prev => prev === performer ? null : performer)}
                  >
                    <span className="truncate">{performer}</span>
                  </Button>
                ))}
                {paginatedPerformers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No performers found</p>
                )}
              </div>

              <PaginationControls
                currentPage={performerPage}
                totalItems={filteredPerformers.length}
                pageSize={performerPageSize}
                onPageChange={setPerformerPage}
              />
            </CardContent>
          </Card>
        </div>

        {/* Events List Panel */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="h-5 w-5" />
                Events
                <Badge variant="secondary" className="ml-2">
                  {filteredEvents.length}
                </Badge>
              </CardTitle>
              <CardDescription>
                Select an event to view tickets
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <FilterSortControls
                filter={eventFilter}
                setFilter={setEventFilter}
                sortBy={eventSortBy}
                setSortBy={(val) => setEventSortBy(val as "name" | "date")}
                sortOrder={eventSortOrder}
                setSortOrder={setEventSortOrder}
                sortOptions={[
                  { value: "date", label: "Date" },
                  { value: "name", label: "Name" },
                ]}
                placeholder="Search events..."
              />

              <div className="space-y-4 mt-4">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : paginatedEvents.length > 0 ? (
                  paginatedEvents.map((event) => (
                    <div key={event.event_id} className="relative group">
                      <Card 
                        className={`cursor-pointer transition-colors ${selectedEvent?.event_id === event.event_id ? 'bg-accent border-primary' : 'hover:bg-accent/50'}`}
                        onClick={() => setSelectedEvent(event)}
                      >
                        <CardContent className="p-4">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-start justify-between">
                              <h3 className="font-semibold text-sm">{event.event_name}</h3>
                              <Badge variant={event.is_active ? "default" : "secondary"} className="text-xs">
                                {event.event_status}
                              </Badge>
                            </div>
                            
                            <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-3 w-3" />
                                {format(new Date(event.show_date), "PPP p")}
                              </div>
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3 w-3" />
                                {event.venue_name}, {event.city_name}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 bg-background/80 backdrop-blur-sm hover:bg-background"
                          title="Create Event"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateEventFromTixStock(event);
                          }}
                        >
                          <Calendar className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 border rounded-lg bg-muted/10">
                    <p className="text-muted-foreground">No events found matching your criteria</p>
                  </div>
                )}
              </div>

              <PaginationControls
                currentPage={eventPage}
                totalItems={filteredEvents.length}
                pageSize={eventPageSize}
                onPageChange={setEventPage}
              />
            </CardContent>
          </Card>
        </div>

        {/* Tickets Panel */}
        {selectedEvent && (
          <div className="space-y-4 lg:col-span-1">
            <Card className="h-full flex flex-col">
              <CardHeader>
                <CardTitle className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Ticket className="h-5 w-5" />
                    Tickets
                  </div>
                  <Badge variant="secondary" className="text-xs w-fit truncate max-w-full">
                    {selectedEvent.event_name}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                <FilterSortControls
                  filter={ticketFilter}
                  setFilter={setTicketFilter}
                  sortBy={ticketSortBy}
                  setSortBy={(val) => setTicketSortBy(val as "price" | "quantity")}
                  sortOrder={ticketSortOrder}
                  setSortOrder={setTicketSortOrder}
                  sortOptions={[
                    { value: "price", label: "Price" },
                    { value: "quantity", label: "Quantity" },
                  ]}
                  placeholder="Filter tickets..."
                />

                <div className="space-y-3 mt-4">
                  {isLoadingTickets ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : paginatedTickets.length > 0 ? (
                    paginatedTickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-medium text-sm">
                            {ticket.seat_details?.category}
                            {ticket.seat_details?.section && ` - ${ticket.seat_details.section}`}
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-primary">
                              {ticket.face_value?.amount} {ticket.face_value?.currency}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>Qty: {ticket.number_of_tickets_for_sale?.quantity_available}</div>
                          <div>Type: {ticket.ticket?.type}</div>
                          {ticket.ticket?.instant_download === "true" && (
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-800 border-green-200">
                              Instant
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 border rounded-lg bg-muted/10">
                      <p className="text-muted-foreground text-sm">No tickets available</p>
                    </div>
                  )}
                </div>

                <PaginationControls
                  currentPage={ticketPage}
                  totalItems={filteredTickets.length}
                  pageSize={ticketPageSize}
                  onPageChange={setTicketPage}
                />
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}
