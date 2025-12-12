"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  RefreshCw,
  Calendar,
  MapPin,
  Users,
  Ticket,
  ExternalLink,
  Search,
  SortAsc,
  SortDesc,
  ChevronLeft,
  ChevronRight,
  Trophy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getLiveTickets,
  getLiveSyncStatus,
  triggerLiveSync,
} from "@/lib/actions/live-events-actions";
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";
import {
  LiveEventDB,
  LiveTicketCategory,
  CURRENCIES,
  SEATING_METHODS,
} from "@/types/live-events.types";
import { Event, EventTicket } from "@/types/app.types";

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

export function LiveEventsContent() {
  const { toast } = useToast();
  const router = useRouter();

  // State management
  const [eventType, setEventType] = useState<'all' | 'sports_live_event_dynamic' | 'music_live_event_dynamic'>('all');
  const [categories1, setCategories1] = useState<string[]>([]);
  const [categories2, setCategories2] = useState<string[]>([]);
  const [categories3, setCategories3] = useState<string[]>([]);
  const [performers, setPerformers] = useState<string[]>([]);
  const [events, setEvents] = useState<LiveEventDB[]>([]);
  const [allEvents, setAllEvents] = useState<LiveEventDB[]>([]); // Store all events for filtering
  const [tickets, setTickets] = useState<LiveTicketCategory[]>([]);

  const [selectedCategory1, setSelectedCategory1] = useState<string | null>(null);
  const [selectedCategory2, setSelectedCategory2] = useState<string | null>(null);
  const [selectedCategory3, setSelectedCategory3] = useState<string | null>(null);
  const [selectedPerformer, setSelectedPerformer] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<LiveEventDB | null>(null);

  const [syncStatus, setSyncStatus] = useState<any>(null);

  // Loading states
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingPerformers, setIsLoadingPerformers] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Filtering and sorting states
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryPage, setCategoryPage] = useState(1);
  const categoryPageSize = 10;

  const [performerFilter, setPerformerFilter] = useState("");
  const [performerSortBy, setPerformerSortBy] = useState<"name" | "classification">("name");
  const [performerSortOrder, setPerformerSortOrder] = useState<"asc" | "desc">("asc");
  const [performerPage, setPerformerPage] = useState(1);
  const performerPageSize = 30;

  const [eventFilter, setEventFilter] = useState("");
  const [eventPage, setEventPage] = useState(1);
  const eventPageSize = 10;

  const [ticketFilter, setTicketFilter] = useState("");
  const [ticketSortBy, setTicketSortBy] = useState<"title" | "price" | "type">("title");
  const [ticketSortOrder, setTicketSortOrder] = useState<"asc" | "desc">("asc");
  const [ticketPage, setTicketPage] = useState(1);
  const ticketPageSize = 10;

  // Filtered and sorted data with pagination
  const filteredCategories = useMemo(() => {
    return categories1
      .filter((category) =>
        category.toLowerCase().includes(categoryFilter.toLowerCase())
      )
      .sort((a, b) => a.localeCompare(b));
  }, [categories1, categoryFilter]);

  const paginatedCategories = useMemo(() => {
    const startIndex = (categoryPage - 1) * categoryPageSize;
    const endIndex = startIndex + categoryPageSize;
    return filteredCategories.slice(startIndex, endIndex);
  }, [filteredCategories, categoryPage, categoryPageSize]);

  const filteredPerformers = useMemo(() => {
    let filtered = performers.filter((performer) => {
      // Ensure performer is a string before calling toLowerCase
      if (typeof performer !== 'string') {
        console.warn('Non-string performer found:', performer);
        return false;
      }
      return performer.toLowerCase().includes(performerFilter.toLowerCase());
    });

    // Sort performers alphabetically
    filtered.sort((a, b) => a.localeCompare(b));

    return filtered;
  }, [performers, performerFilter, performerSortBy, performerSortOrder]);

  const paginatedPerformers = useMemo(() => {
    const startIndex = (performerPage - 1) * performerPageSize;
    const endIndex = startIndex + performerPageSize;
    return filteredPerformers.slice(startIndex, endIndex);
  }, [filteredPerformers, performerPage, performerPageSize]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) =>
      event.event_name.toLowerCase().includes(eventFilter.toLowerCase())
    );
  }, [events, eventFilter]);

  const paginatedEvents = useMemo(() => {
    const startIndex = (eventPage - 1) * eventPageSize;
    const endIndex = startIndex + eventPageSize;
    return filteredEvents.slice(startIndex, endIndex);
  }, [filteredEvents, eventPage, eventPageSize]);

  const filteredTickets = useMemo(() => {
    let filtered = tickets.filter((ticket) =>
      ticket.hebTitle.toLowerCase().includes(ticketFilter.toLowerCase()) &&
      ticket.seatingMethodId !== 2 && // Filter out tickets with seatingMethodId = 2 (Singles)
      ticket.maxTicketAmount >= 2 // Filter out tickets with maxTicketAmount < 2
    );

    filtered.sort((a, b) => {
      let comparison = 0;
      switch (ticketSortBy) {
        case "title":
          comparison = a.hebTitle.localeCompare(b.hebTitle);
          break;
        case "price":
          comparison = a.cost - b.cost;
          break;
        case "type":
          comparison = a.seatingMethodId - b.seatingMethodId;
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
    setPerformerPage(1);
  }, [performerFilter, performerSortBy, performerSortOrder]);

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

  // Filter events when eventType changes - reload all events
  useEffect(() => {
    if (allEvents.length > 0) {
      loadCategoriesAndSyncStatus(); // Reload with new event type filter
    }
  }, [eventType]);

  // Filter events and build available categories/performers based on selections
  useEffect(() => {
    let filteredEvents = allEvents;

    // Filter by category1 if selected
    if (selectedCategory1) {
      const beforeFilter = filteredEvents.length;
      filteredEvents = filteredEvents.filter(event => {
        const hasCategory = event.categories?.category1?.some((cat: any) => cat.name === selectedCategory1);
        if (!hasCategory && event.event_name.includes('SPECIFIC_ARTIST_NAME')) { // Replace with the missing artist's event name
          console.log('Event missing from category1 filter:', event.event_name, event.categories);
        }
        return hasCategory;
      });
      console.log(`Category1 filter: ${beforeFilter} → ${filteredEvents.length} events`);
      
      // Build available category2 options from filtered events
      const category2Set = new Set<string>();
      filteredEvents.forEach((event: any) => {
        if (event.categories?.category2 && Array.isArray(event.categories.category2)) {
          event.categories.category2.forEach((cat: any) => {
            if (cat.name && cat.name !== '-') {
              category2Set.add(cat.name);
            }
          });
        }
      });
      setCategories2(Array.from(category2Set).sort());
      
      if (selectedCategory2 && !category2Set.has(selectedCategory2)) {
        setSelectedCategory2(null);
      }
    } else {
      setCategories2([]);
      setSelectedCategory2(null);
    }

    // Filter by category2 if selected
    if (selectedCategory1 && selectedCategory2) {
      filteredEvents = filteredEvents.filter(event => 
        event.categories?.category2?.some((cat: any) => cat.name === selectedCategory2)
      );
      
      // Build available category3 options from filtered events
      const category3Set = new Set<string>();
      filteredEvents.forEach((event: any) => {
        if (event.categories?.category3 && Array.isArray(event.categories.category3)) {
          event.categories.category3.forEach((cat: any) => {
            if (cat.name) {
              category3Set.add(cat.name);
            }
          });
        }
      });
      setCategories3(Array.from(category3Set).sort());
      
      // Clear category3 selection if no longer available
      if (selectedCategory3 && !category3Set.has(selectedCategory3)) {
        setSelectedCategory3(null);
      }
    } else {
      // No category2 selected, clear category3
      setCategories3([]);
      setSelectedCategory3(null);
    }

    // Filter by category3 if selected
    if (selectedCategory1 && selectedCategory2 && selectedCategory3) {
      filteredEvents = filteredEvents.filter(event => 
        event.categories?.category3?.some((cat: any) => cat.name === selectedCategory3)
      );
    }

    // Update performers list based on filtered events
    const performerSet = new Set<string>();
    filteredEvents.forEach((event: any) => {
      if (event.performers && Array.isArray(event.performers)) {
        event.performers.forEach((performer: any) => {
          if (performer.name) {
            performerSet.add(performer.name);
          }
        });
      }
    });
    const performersFromFilteredEvents = Array.from(performerSet).sort();
    setPerformers(performersFromFilteredEvents);

    // Check if selected performer is still available in filtered events
    if (selectedPerformer && !performerSet.has(selectedPerformer)) {
      setSelectedPerformer(null);
    }

    // Filter by performer if selected
    if (selectedPerformer) {
      filteredEvents = filteredEvents.filter(event => 
        event.performers && 
        Array.isArray(event.performers) && 
        event.performers.some((performer: any) => performer.name === selectedPerformer)
      );
    }

    setEvents(filteredEvents);
    setSelectedEvent(null);
    setTickets([]);
  }, [allEvents, selectedCategory1, selectedCategory2, selectedCategory3, selectedPerformer]);

  useEffect(() => {
    if (!selectedEvent) return;
    // Always fetch fresh tickets from LIVE API - no optimistic caching
    setTickets([]);
    loadTickets(selectedEvent.event_id);
  }, [selectedEvent]);

  const loadCategoriesAndSyncStatus = async () => {
    try {
      setIsLoadingCategories(true);
      setIsLoadingEvents(true);
      
      // Load all events and sync status
      const [eventsResponse, statusData] = await Promise.all([
        fetch(`/api/live-events/events?limit=10000&upcoming=true${eventType !== 'all' ? `&type=${eventType}` : ''}`, {
          cache: 'no-store'
        }),
        getLiveSyncStatus(),
      ]);

      if (!eventsResponse.ok) throw new Error('Failed to load events');
      const eventsData = await eventsResponse.json();
      const allEventsData = eventsData.data || [];

      // Store all events
      setAllEvents(allEventsData);
      setEvents(allEventsData); // Initially show all events

      // Build categories1 from events
      const category1Set = new Set<string>();
      allEventsData.forEach((event: any) => {
        if (event.categories?.category1 && Array.isArray(event.categories.category1)) {
          event.categories.category1.forEach((cat: any) => {
            if (cat.name) {
              category1Set.add(cat.name);
            }
          });
        }
      });
      const categories1FromEvents = Array.from(category1Set).sort();
      setCategories1(categories1FromEvents);

      // Build performers from events
      const performerSet = new Set<string>();
      allEventsData.forEach((event: any) => {
        if (event.performers && Array.isArray(event.performers)) {
          event.performers.forEach((performer: any) => {
            if (performer.name) {
              performerSet.add(performer.name);
            }
          });
        }
      });
      const performersFromEvents = Array.from(performerSet).sort();
      setPerformers(performersFromEvents);

      setSyncStatus(statusData);

    } catch (error) {
      console.error("Failed to load live data:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load live events data. Please try again.",
      });
    } finally {
      setIsLoadingCategories(false);
      setIsLoadingEvents(false);
    }
  };

  const loadTickets = async (eventId: number) => {
    try {
      setIsLoadingTickets(true);
      const data = await getLiveTickets(eventId);
      setTickets(data);
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

  const handleSync = async (type?: string) => {
    try {
      setIsSyncing(true);
      await triggerLiveSync(type);

      toast({
        title: "Sync Started",
        description: `${
          type ? `${type.charAt(0).toUpperCase() + type.slice(1)} ` : ""
        }sync completed successfully.`,
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

  const handleCreateEventFromLive = async (event: LiveEventDB) => {
    try {
      // Update exchange rates first
      await exchangeRateClientService.updateAllExchangeRates();

      // Get tickets for this specific event
      const eventTickets = await getLiveTickets(event.event_id);

      // Filter out tickets with seatingMethodId = 2 (Singles) and maxTicketAmount < 2
      const filteredEventTickets = eventTickets.filter(
        (ticket) => ticket.seatingMethodId !== 2 && ticket.maxTicketAmount >= 2
      );

      // Helper function to convert price to USD based on event currency
      const convertPriceToUSD = async (price: number, currencyId: number): Promise<number> => {
        let result: number;
        switch (currencyId) {
          case CURRENCIES.USD:
            result = price + 40; // Markup only. Already in USD
            break;
          case CURRENCIES.EUR:
            result = await exchangeRateClientService.convertToUSD(price + 40, 'EUR');
            break;
          case CURRENCIES.GBP:
            result = await exchangeRateClientService.convertToUSD(price + 35, 'GBP');
            break;
          case CURRENCIES.ILS:
            result = await exchangeRateClientService.convertToUSD(price + 150, 'ILS');
            break;
          default:
            console.warn(`Unknown currency ${currencyId}, using price as-is`);
            result = price;
        }
        
        return result;
      };

      // Convert LiveTickets tickets to EventTickets with USD conversion
      const mappedTickets: EventTicket[] = await Promise.all(
        filteredEventTickets.map(async (ticket, index) => {
          const priceInUSD = Math.round(await convertPriceToUSD(ticket.cost, event.currency));
          
            const roundedPrice = Math.ceil(priceInUSD / 10) * 10 - 1;
            
            const mappedTicket = {
            id: ticket.id.toString(),
            category: ticket.hebTitle || ticket.title,
            price: roundedPrice, // Rounded to nearest 9
            description: ticket.hebComments || ticket.engComments || "",
            colorOnTheMap: "#fdfdfdff", // Default gray color
            vendor: "LiveTickets",
            available: true,
            eid: event.event_id.toString(),
            };
          return mappedTicket;
        })
      );

      // Try to find the nearest location
      let locationData = {
        latitude: 0,
        longitude: 0,
        name: event.city_name || "Unknown Location",
        city_iata: event.iata || "",
      };

      const eventData: Omit<Event, "id"> = {
        name: event.event_name_heb || event.event_name,
        name_english: event.event_name,
        type: event.event_type,
        date: new Date(event.show_date).toISOString().split("T")[0],
        location: locationData,
        map_image_url: event.venue_map_url || "",
        description: event.show_date_remarks || `${event.event_name} at ${event.city_name}`,
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
        description: "Redirecting to create event page with LIVE event data.",
      });
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

  const getSeatingMethodName = (methodId: number): string => {
    switch (methodId) {
      case SEATING_METHODS.GA: return "General Admission";
      case SEATING_METHODS.SINGLES: return "Singles";
      case SEATING_METHODS.DOUBLES: return "Pairs";
      case SEATING_METHODS.GROUP: return "Group";
      default: return "Unknown";
    }
  };

  const getEventTypeBadgeColor = (eventType: string) => {
    if (eventType === 'music_live_event_dynamic') {
      return "bg-purple-100 text-purple-800";
    }
    return "bg-green-100 text-green-800";
  };

  // Format event names: if API returns an ALL UPPERCASE string, convert to Title Case for readability
  const formatEventName = (name: string) => {
    if (!name) return '';
    const isAllCaps = name === name.toUpperCase();
    if (!isAllCaps) return name; // keep original casing if mixed
    return name
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
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
                LIVE Events Data Sync Status
              </CardTitle>
              <CardDescription>
                Manage data synchronization with LIVE API (doctorticket.com)
              </CardDescription>
            </div>
            <Button onClick={() => handleSync("events")} disabled={isSyncing} size="sm">
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
          {syncStatus && syncStatus.results && (
            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              <div>
                Total Events:{" "}
                <strong>{syncStatus.results?.events?.total || 0}</strong>
              </div>
              <div>
                Sports Events:{" "}
                <strong>{syncStatus.results?.events?.sports || 0}</strong>
              </div>
              <div>
                Music Events:{" "}
                <strong>{syncStatus.results?.events?.music || 0}</strong>
              </div>
              <div>
                Categories:{" "}
                <strong>{syncStatus.results?.categories?.count || 0}</strong>
              </div>
              <div>
                Performers:{" "}
                <strong>{syncStatus.results?.performers?.count || 0}</strong>
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        {/* Categories 1 & 2 Panel (Stacked) */}
        <div className="space-y-4">
          {/* Category 1 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                <span className="truncate">Categories</span>
              </CardTitle>
            </CardHeader>
          <CardContent>
            {isLoadingCategories ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : paginatedCategories.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedCategories.map((category: string) => (
                    <Button
                      key={category}
                      variant={
                        selectedCategory1 === category
                          ? "default"
                          : "outline"
                      }
                      className="w-full justify-start text-left h-auto p-3"
                      onClick={() => {
                        // Toggle category selection without clearing performer
                        setSelectedCategory1(prev => prev === category ? null : category);
                      }}
                    >
                      <div>
                        <div className="font-medium">{category}</div>
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
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  No categories available
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync("categories")}
                  className="mt-2"
                >
                  Sync Categories Data
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              {categories1.length} categories available
            </p>
          </CardContent>
        </Card>

        {/* Category 2 - Only show if category1 is selected */}
        {selectedCategory1 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                <span className="truncate">Category 2</span>
                <Badge variant="outline" className="text-xs">
                  {selectedCategory1}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {categories2.length > 0 ? (
                <div className="space-y-2">
                  {categories2.map((category: string) => (
                    <Button
                      key={category}
                      variant={
                        selectedCategory2 === category
                          ? "default"
                          : "outline"
                      }
                      className="w-full justify-start text-left h-auto p-3"
                      onClick={() => {
                        setSelectedCategory2(prev => prev === category ? null : category);
                      }}
                    >
                      <div>
                        <div className="font-medium">{category}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No subcategories available
                </p>
              )}

              <p className="text-xs text-muted-foreground mt-4">
                {categories2.length} subcategories available
              </p>
            </CardContent>
          </Card>
        )}

        {/* Category 3 - Only show if category2 is selected */}
        {selectedCategory1 && selectedCategory2 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                <span className="truncate">Category 3</span>
                <Badge variant="outline" className="text-xs">
                  {selectedCategory2}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {categories3.length > 0 ? (
                <div className="space-y-2">
                  {categories3.map((category: string) => (
                    <Button
                      key={category}
                      variant={
                        selectedCategory3 === category
                          ? "default"
                          : "outline"
                      }
                      className="w-full justify-start text-left h-auto p-3"
                      onClick={() => {
                        setSelectedCategory3(prev => prev === category ? null : category);
                      }}
                    >
                      <div>
                        <div className="font-medium">{category}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-4">
                  No subcategories available
                </p>
              )}

              <p className="text-xs text-muted-foreground mt-4">
                {categories3.length} subcategories available
              </p>
            </CardContent>
          </Card>
        )}
        </div>

        {/* Performers (Optional Column) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Ticket className="h-4 w-4" />
              <span className="truncate">Performers</span>
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

            {isLoadingPerformers ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : paginatedPerformers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedPerformers.map((performer) => (
                    <Button
                      key={performer}
                      variant={
                        selectedPerformer === performer
                          ? "default"
                          : "outline"
                      }
                      className="w-full justify-start text-left h-auto p-3"
                      onClick={() => {
                        // Toggle performer selection without clearing category
                        setSelectedPerformer(prev => prev === performer ? null : performer);
                      }}
                    >
                      <div>
                        <div className="font-medium text-sm">
                          {performer}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>

                <PaginationControls
                  currentPage={performerPage}
                  totalItems={filteredPerformers.length}
                  pageSize={performerPageSize}
                  onPageChange={setPerformerPage}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                No performers available
              </p>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              {performers.length} performers available
            </p>
          </CardContent>
        </Card>

        {/* Events */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span className="text-sm font-medium truncate">Events</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedCategory1 && (
                  <Badge variant="secondary" className="text-xs">
                    Cat1: {selectedCategory1}
                  </Badge>
                )}
                {selectedCategory2 && (
                  <Badge variant="secondary" className="text-xs">
                    Cat2: {selectedCategory2}
                  </Badge>
                )}
                {selectedCategory3 && (
                  <Badge variant="secondary" className="text-xs">
                    Cat3: {selectedCategory3}
                  </Badge>
                )}
                {selectedPerformer && (
                  <Badge variant="outline" className="text-xs">
                    Performer: {selectedPerformer}
                  </Badge>
                )}
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
            {(selectedCategory1 || selectedCategory2 || selectedCategory3 || selectedPerformer) && (
              <div className="mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory1(null);
                    setSelectedCategory2(null);
                    setSelectedCategory3(null);
                    setSelectedPerformer(null);
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
                <div className="space-y-2">
                  {paginatedEvents.map((event) => (
                    <div key={event.event_id} className="relative group">
                      <Button
                        variant={
                          selectedEvent?.event_id === event.event_id
                            ? "default"
                            : "outline"
                        }
                        className="w-full justify-start text-left h-auto p-3 pr-20 whitespace-normal items-start"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className="flex flex-col items-start w-full">
                          <div className="flex items-start gap-2 w-full">
                            <span className="block font-medium text-sm leading-snug break-words">
                              {formatEventName(event.event_name)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatDate(event.show_date)} • {event.city_name}
                          </div>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`text-xs ${getEventTypeBadgeColor(event.event_type)}`}
                            >
                              {event.event_type === 'music_live_event_dynamic' ? 'Music' : 'Sports'}
                            </Badge>
                          </div>
                        </div>
                      </Button>
                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Link href={`/live-events/${event.event_id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="View Details"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Create Event"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCreateEventFromLive(event);
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
                {selectedCategory1 || eventType !== 'all'
                  ? eventFilter
                    ? "No events found matching your filter"
                    : "No events found"
                  : "Select a category or filter by event type"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Live Tickets */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Ticket className="h-4 w-4" />
                <span className="text-sm font-medium truncate">Live Tickets</span>
              </div>
              {selectedEvent && (
                <Badge variant="secondary" className="text-xs w-fit">
                  {selectedEvent.event_name}
                </Badge>
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
                  setTicketSortBy(value as "title" | "price" | "type")
                }
                sortOrder={ticketSortOrder}
                setSortOrder={setTicketSortOrder}
                sortOptions={[
                  { value: "title", label: "Title" },
                  { value: "price", label: "Price" },
                  { value: "type", label: "Seating Type" },
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
                <div className="space-y-3">
                  {paginatedTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">
                          {ticket.hebTitle}
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-primary">
                            {formatPrice(ticket.cost, selectedEvent?.currency)}
                          </div>
                          {ticket.specialCost !== ticket.cost && (
                            <div className="text-xs text-muted-foreground line-through">
                              {formatPrice(ticket.specialCost, selectedEvent?.currency)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>Seating: {getSeatingMethodName(ticket.seatingMethodId)}</div>
                        <div>Max Tickets: {ticket.maxTicketAmount}</div>
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

            {selectedEvent &&
              filteredTickets.length === 0 &&
              !isLoadingTickets &&
              !ticketFilter && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadTickets(selectedEvent.event_id)}
                  className="w-full mt-2"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh Tickets
                </Button>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
