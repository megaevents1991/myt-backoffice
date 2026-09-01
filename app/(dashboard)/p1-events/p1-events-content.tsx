"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Loader2,
  Search,
  MapPin,
  Calendar,
  Users,
  Ticket,
  ExternalLink,
  Trophy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getP1Events,
  getP1Tickets,
  getP1SyncStatus,
  triggerP1Sync,
} from "@/lib/actions/p1-events-actions";
import { P1EventDB, P1Ticket } from "@/types/p1-events.types";
import { Event, EventTicket } from "@/types/app.types";
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";
import {
  FilterSortControls,
  PaginationControls,
} from "@/components/provider-browse";




/** Shape of the P1 sync status payload, as this screen reads it. */
interface P1SyncStatus {
  results?: {
    events?: { total?: number };
    last_synced?: string;
    categories?: Record<string, number>;
  };
}

export function P1EventsContent() {
  const { toast } = useToast();
  const router = useRouter();

  // State management
  const [categories, setCategories] = useState<string[]>([]);
  const [series, setSeries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [events, setEvents] = useState<P1EventDB[]>([]);
  const [allEvents, setAllEvents] = useState<P1EventDB[]>([]);
  const [tickets, setTickets] = useState<P1Ticket[]>([]);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<P1EventDB | null>(null);

  const [syncStatus, setSyncStatus] = useState<P1SyncStatus | null>(null);

  // Loading states
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isLoadingTickets] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Filtering and sorting states
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryPage, setCategoryPage] = useState(1);
  const categoryPageSize = 10;

  const [seriesFilter, setSeriesFilter] = useState("");
  const [seriesPage, setSeriesPage] = useState(1);
  const seriesPageSize = 10;

  const [cityFilter, setCityFilter] = useState("");
  const [cityPage, setCityPage] = useState(1);
  const cityPageSize = 10;

  const [eventFilter, setEventFilter] = useState("");
  const [eventPage, setEventPage] = useState(1);
  const eventPageSize = 10;

  const [ticketFilter, setTicketFilter] = useState("");
  const [ticketSortBy, setTicketSortBy] = useState<"title" | "price" | "stock">("title");
  const [ticketSortOrder, setTicketSortOrder] = useState<"asc" | "desc">("asc");
  const [ticketPage, setTicketPage] = useState(1);
  const ticketPageSize = 10;

  // Filtered and sorted data with pagination
  const filteredCategories = useMemo(() => {
    return categories
      .filter((category) =>
        category.toLowerCase().includes(categoryFilter.toLowerCase())
      )
      .sort((a, b) => a.localeCompare(b));
  }, [categories, categoryFilter]);

  const paginatedCategories = useMemo(() => {
    const startIndex = (categoryPage - 1) * categoryPageSize;
    const endIndex = startIndex + categoryPageSize;
    return filteredCategories.slice(startIndex, endIndex);
  }, [filteredCategories, categoryPage, categoryPageSize]);

  const filteredSeries = useMemo(() => {
    return series
      .filter((s) => s.toLowerCase().includes(seriesFilter.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [series, seriesFilter]);

  const paginatedSeries = useMemo(() => {
    const startIndex = (seriesPage - 1) * seriesPageSize;
    const endIndex = startIndex + seriesPageSize;
    return filteredSeries.slice(startIndex, endIndex);
  }, [filteredSeries, seriesPage, seriesPageSize]);

  const filteredCities = useMemo(() => {
    return cities
      .filter((city) => city.toLowerCase().includes(cityFilter.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [cities, cityFilter]);

  const paginatedCities = useMemo(() => {
    const startIndex = (cityPage - 1) * cityPageSize;
    const endIndex = startIndex + cityPageSize;
    return filteredCities.slice(startIndex, endIndex);
  }, [filteredCities, cityPage, cityPageSize]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) =>
      event.title.toLowerCase().includes(eventFilter.toLowerCase())
    );
  }, [events, eventFilter]);

  const paginatedEvents = useMemo(() => {
    const startIndex = (eventPage - 1) * eventPageSize;
    const endIndex = startIndex + eventPageSize;
    return filteredEvents.slice(startIndex, endIndex);
  }, [filteredEvents, eventPage, eventPageSize]);

  const filteredTickets = useMemo(() => {
    const filtered = tickets.filter(
      (ticket) =>
        ticket.category.toLowerCase().includes(ticketFilter.toLowerCase()) &&
        ticket.stock >= 2 && // Filter out tickets with stock lower than 2
        !ticket.tags.some(tag => tag.toLowerCase() === 'hospitality') // Filter out hospitality tickets
    );

    filtered.sort((a, b) => {
      let comparison = 0;
      switch (ticketSortBy) {
        case "title":
          comparison = a.category.localeCompare(b.category);
          break;
        case "price":
          comparison = a.price_ticket - b.price_ticket;
          break;
        case "stock":
          comparison = a.stock - b.stock;
          break;
      }
      return ticketSortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [tickets, ticketFilter, ticketSortBy, ticketSortOrder]);

  const paginatedTickets = useMemo(() => {
    const startIndex = (ticketPage - 1) * ticketPageSize;
    const endIndex = startIndex + ticketPageSize;
    return filteredTickets.slice(startIndex, endIndex);
  }, [filteredTickets, ticketPage, ticketPageSize]);

  // Reset pagination when filters change
  useEffect(() => {
    setCategoryPage(1);
  }, [categoryFilter]);

  useEffect(() => {
    setSeriesPage(1);
  }, [seriesFilter]);

  useEffect(() => {
    setCityPage(1);
  }, [cityFilter]);

  useEffect(() => {
    setEventPage(1);
  }, [eventFilter]);

  useEffect(() => {
    setTicketPage(1);
  }, [ticketFilter, ticketSortBy, ticketSortOrder]);

  // Load initial data
  useEffect(() => {
    loadCategoriesAndSyncStatus();
  }, []);

  // Filter events based on selections
  useEffect(() => {
    let filteredEvents = allEvents;

    // Filter by category if selected
    if (selectedCategory) {
      filteredEvents = filteredEvents.filter(
        (event) => event.category === selectedCategory
      );

      // Build available series options from filtered events
      const seriesSet = new Set<string>();
      filteredEvents.forEach((event) => {
        if (event.series_name) {
          seriesSet.add(event.series_name);
        }
      });
      setSeries(Array.from(seriesSet).sort());

      if (selectedSeries && !seriesSet.has(selectedSeries)) {
        setSelectedSeries(null);
      }
    } else {
      setSeries([]);
      setSelectedSeries(null);
    }

    // Filter by series if selected
    if (selectedCategory && selectedSeries) {
      filteredEvents = filteredEvents.filter(
        (event) => event.series_name === selectedSeries
      );
    }

    // Update cities list based on filtered events
    const citySet = new Set<string>();
    filteredEvents.forEach((event) => {
      if (event.venue_city) {
        citySet.add(event.venue_city);
      }
    });
    const citiesFromFilteredEvents = Array.from(citySet).sort();
    setCities(citiesFromFilteredEvents);

    // Check if selected city is still available
    if (selectedCity && !citySet.has(selectedCity)) {
      setSelectedCity(null);
    }

    // Filter by city if selected
    if (selectedCity) {
      filteredEvents = filteredEvents.filter(
        (event) => event.venue_city === selectedCity
      );
    }

    setEvents(filteredEvents);
    setSelectedEvent(null);
    setTickets([]);
  }, [allEvents, selectedCategory, selectedSeries, selectedCity]);

  useEffect(() => {
    if (!selectedEvent) return;
    // Use embedded tickets when present (full row); slim list rows don't carry
    // them - lazy-load for the selected event only.
    if (Array.isArray(selectedEvent.tickets) && selectedEvent.tickets.length) {
      setTickets(selectedEvent.tickets);
      return;
    }
    setTickets([]);
    let cancelled = false;
    getP1Tickets(selectedEvent.event_id).then((loaded) => {
      if (!cancelled) setTickets(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEvent]);

  const loadCategoriesAndSyncStatus = async () => {
    try {
      setIsLoadingCategories(true);
      setIsLoadingEvents(true);

      // Load all events and sync status
      const [eventsData, statusData] = await Promise.all([
        getP1Events(),
        getP1SyncStatus(),
      ]);

      setAllEvents(eventsData);
      setEvents(eventsData);

      // Build categories from events
      const categorySet = new Set<string>();
      eventsData.forEach((event) => {
        if (event.category) {
          categorySet.add(event.category);
        }
      });
      setCategories(Array.from(categorySet).sort());

      // Build cities from events
      const citySet = new Set<string>();
      eventsData.forEach((event) => {
        if (event.venue_city) {
          citySet.add(event.venue_city);
        }
      });
      setCities(Array.from(citySet).sort());

      setSyncStatus(statusData);
    } catch (error) {
      console.error("Failed to load P1 data:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load P1 events data. Please try again.",
      });
    } finally {
      setIsLoadingCategories(false);
      setIsLoadingEvents(false);
    }
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await triggerP1Sync();

      toast({
        title: "Sync Started",
        description: "P1 events sync completed successfully.",
      });

      // Reload data after sync
      await loadCategoriesAndSyncStatus();
    } catch (error) {
      console.error("Failed to sync:", error);
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: "Failed to sync data. Please try again.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateEventFromP1 = async (event: P1EventDB) => {
    try {
      // Update exchange rates first
      await exchangeRateClientService.updateAllExchangeRates();

      // Get tickets for this event - slim list rows don't embed them, fetch on demand
      const eventTickets =
        Array.isArray(event.tickets) && event.tickets.length
          ? event.tickets
          : await getP1Tickets(event.event_id);

      // Filter out tickets with stock < 2 and hospitality tickets
      const availableTickets = eventTickets.filter(
        (ticket) => 
          ticket.stock >= 2 && 
          !ticket.tags.some(tag => tag.toLowerCase() === 'hospitality')
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
          case "ILS":
            result = await exchangeRateClientService.convertToUSD(price + 150, "ILS");
            break;
          default:
            console.warn(`Unknown currency ${currency}, using price as-is`);
            result = price;
        }

        return result;
      };

      // Convert P1 tickets to EventTickets with USD conversion
      const mappedTickets: EventTicket[] = await Promise.all(
        availableTickets.map(async (ticket) => {
          const priceInUSD = Math.round(
            await convertPriceToUSD(ticket.price_ticket, ticket.currency)
          );

          const roundedPrice = Math.ceil(priceInUSD / 10) * 10 - 1;

          return {
            id: ticket.id,
            category: ticket.category,
            price: roundedPrice,
            description: ticket.seatingplan_category_description || "",
            colorOnTheMap: "#fdfdfdff",
            vendor: "P1Tickets",
            available: true,
            eid: event.event_id,
          };
        })
      );

      // Location data
      const locationData: { latitude: number; longitude: number; name: string; city_iata: string; country_code?: string } = {
        latitude: event.venue_latitude,
        longitude: event.venue_longitude,
        name: event.venue_name,
        city_iata: "", // P1 doesn't provide IATA codes
      };

      const eventData: Omit<Event, "id"> = {
        name: event.title,
        name_english: event.title_english || event.title,
        type: "sports_event", // Default to sports
        date: new Date(event.date_start).toISOString().split("T")[0],
        location: locationData,
        map_image_url: "",
        description: event.series_name
          ? `${event.title} - ${event.series_name}`
          : event.title,
        card_image_url: "",
        tickets_and_rates: mappedTickets,
        def_date_depart: "",
        def_date_return: "",
        usual_price: 0,
        base_flight_price: 0,
        base_hotel_price: 0,
        is_prioritized: false,
        event_additional_markup: null,
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

      toast({
        title: "Event Data Prepared",
        description: "Redirecting to create event page with P1 event data.",
      });
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

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const formatPrice = (price: number, currency: string = "EUR") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(price);
  };

  return (
    <div className="space-y-6">
      {/* Sync Status and Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                P1 Tickets Data Sync Status
              </CardTitle>
              <CardDescription>
                Manage data synchronization with P1 Tickets XML feeds
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
                  Sync Now
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {syncStatus && syncStatus.results && (
            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              <div>
                Total Events:{" "}
                <span className="font-bold">
                  {syncStatus.results.events?.total || 0}
                </span>
              </div>
              {syncStatus.results.last_synced && (
                <div>
                  Last Synced:{" "}
                  <span className="font-bold">
                    {formatDate(syncStatus.results.last_synced)}
                  </span>
                </div>
              )}
            </div>
          )}
          {syncStatus && syncStatus.results?.categories && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(syncStatus.results.categories).map(
                ([cat, count]) => (
                  <Badge key={cat} variant="secondary">
                    {cat}: {count}
                  </Badge>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="space-y-4">
        {/* Categories Panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Trophy className="h-4 w-4" />
              Categories
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingCategories ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : paginatedCategories.length > 0 ? (
              <>
                <div className="relative mb-4">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter categories..."
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="pl-8"
                  />
                </div>

                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {paginatedCategories.map((category) => (
                    <button
                      key={category}
                      onClick={() =>
                        setSelectedCategory(
                          selectedCategory === category ? null : category
                        )
                      }
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedCategory === category
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>

                <PaginationControls
                  currentPage={categoryPage}
                  totalItems={filteredCategories.length}
                  pageSize={categoryPageSize}
                  onPageChange={setCategoryPage}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                No categories available
              </p>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              {categories.length} categories available
            </p>
          </CardContent>
        </Card>

        {/* Series Panel - Only show if category is selected */}
        {selectedCategory && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Series
              </CardTitle>
            </CardHeader>
            <CardContent>
              {series.length > 0 ? (
                <>
                  <div className="relative mb-4">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter series..."
                      value={seriesFilter}
                      onChange={(e) => setSeriesFilter(e.target.value)}
                      className="pl-8"
                    />
                  </div>

                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {paginatedSeries.map((s) => (
                      <button
                        key={s}
                        onClick={() =>
                          setSelectedSeries(selectedSeries === s ? null : s)
                        }
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedSeries === s
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>

                  <PaginationControls
                    currentPage={seriesPage}
                    totalItems={filteredSeries.length}
                    pageSize={seriesPageSize}
                    onPageChange={setSeriesPage}
                  />
                </>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No series available
                </p>
              )}

              <p className="text-xs text-muted-foreground mt-4">
                {series.length} series available
              </p>
            </CardContent>
          </Card>
        )}
        </div>

        {/* Cities Panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="h-4 w-4" />
              Cities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter cities..."
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="pl-8"
              />
            </div>

            {paginatedCities.length > 0 ? (
              <>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {paginatedCities.map((city) => (
                    <button
                      key={city}
                      onClick={() =>
                        setSelectedCity(selectedCity === city ? null : city)
                      }
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                        selectedCity === city
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                </div>

                <PaginationControls
                  currentPage={cityPage}
                  totalItems={filteredCities.length}
                  pageSize={cityPageSize}
                  onPageChange={setCityPage}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                No cities available
              </p>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              {cities.length} cities available
            </p>
          </CardContent>
        </Card>

        {/* Events */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Events
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter events..."
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="pl-8"
              />
            </div>

            {/* Clear Filters Button */}
            {(selectedCategory || selectedSeries || selectedCity) && (
              <div className="mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory(null);
                    setSelectedSeries(null);
                    setSelectedCity(null);
                  }}
                  className="w-full"
                >
                  Clear All Filters
                </Button>
              </div>
            )}

            {isLoadingEvents ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : paginatedEvents.length > 0 ? (
              <>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {paginatedEvents.map((event) => (
                    <div
                      key={event.event_id}
                      className={`group relative p-3 rounded-md border cursor-pointer transition-colors ${
                        selectedEvent?.event_id === event.event_id
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50 hover:bg-accent/50"
                      }`}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div className="space-y-1">
                        <p className="font-medium text-sm line-clamp-2">
                          {event.title}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(event.date_start)}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {event.venue_city}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {event.category}
                          </Badge>
                          {event.stock > 0 && (
                            <Badge variant="outline" className="text-xs">
                              Stock: {event.stock}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="View Details"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/p1-events/${event.event_id}`);
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Create Event"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateEventFromP1(event);
                          }}
                        >
                          <Calendar className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <PaginationControls
                  currentPage={eventPage}
                  totalItems={filteredEvents.length}
                  pageSize={eventPageSize}
                  onPageChange={setEventPage}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                {selectedCategory
                  ? eventFilter
                    ? "No events found matching your filter"
                    : "No events found"
                  : "Select a category to view events"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* P1 Tickets */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Ticket className="h-4 w-4" />
                Tickets
              </div>
              {selectedEvent && (
                <span className="text-xs text-muted-foreground font-normal">
                  {selectedEvent.title}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedEvent && (
              <FilterSortControls
                filter={ticketFilter}
                setFilter={setTicketFilter}
                sortBy={ticketSortBy}
                setSortBy={(value) =>
                  setTicketSortBy(value as "title" | "price" | "stock")
                }
                sortOrder={ticketSortOrder}
                setSortOrder={setTicketSortOrder}
                sortOptions={[
                  { value: "title", label: "Title" },
                  { value: "price", label: "Price" },
                  { value: "stock", label: "Stock" },
                ]}
                placeholder="Filter tickets..."
              />
            )}

            {isLoadingTickets ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : paginatedTickets.length > 0 ? (
              <>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {paginatedTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="p-3 rounded-md border hover:border-primary/50 transition-colors"
                    >
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{ticket.category}</p>
                        <p className="text-lg font-bold text-primary">
                          {formatPrice(ticket.price_ticket, ticket.currency)}
                        </p>
                        {ticket.seatingplan_category_description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {ticket.seatingplan_category_description}
                          </p>
                        )}
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            Stock: {ticket.stock}
                          </Badge>
                          {ticket.tags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="secondary"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <PaginationControls
                  currentPage={ticketPage}
                  totalItems={filteredTickets.length}
                  pageSize={ticketPageSize}
                  onPageChange={setTicketPage}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                {selectedEvent
                  ? ticketFilter
                    ? "No tickets found matching your filter"
                    : "No tickets available"
                  : "Select an event first"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
