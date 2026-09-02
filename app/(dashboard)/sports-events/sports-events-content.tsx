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
import {
  Loader2,
  RefreshCw,
  Calendar,
  MapPin,
  Users,
  Ticket,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getSports,
  getTournaments,
  getEvents,
  getLiveTickets,
  getSyncStatus,
  triggerSync,
} from "@/lib/actions/sports-events-actions";
import { findNearestLocation } from "@/lib/actions/location-actions";
import { matchesSearch } from "@/lib/search";
import { exchangeRateClientService } from "@/lib/services/exchange-rate-client";
import {
  XS2Sport,
  XS2Tournament,
  XS2Event,
  XS2Ticket,
  SyncStatusResponse,
} from "@/types/sports-events.types";
import { Event, EventTicket } from "@/types/app.types";
import { formatTicketNetPrice } from "@/lib/utils";
import {
  FilterSortControls,
  PaginationControls,
} from "@/components/provider-browse";




export function SportsEventsContent() {
  const { toast } = useToast();
  const router = useRouter();

  // State management
  const [sports, setSports] = useState<XS2Sport[]>([]);
  const [tournaments, setTournaments] = useState<XS2Tournament[]>([]);
  const [events, setEvents] = useState<XS2Event[]>([]);
  const [tickets, setTickets] = useState<XS2Ticket[]>([]);

  const [selectedSport, setSelectedSport] = useState<XS2Sport | null>(null);
  const [selectedTournament, setSelectedTournament] =
    useState<XS2Tournament | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<XS2Event | null>(null);

  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);

  // Loading states
  const [isLoadingSports, setIsLoadingSports] = useState(true);
  const [isLoadingTournaments, setIsLoadingTournaments] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Filtering and sorting states
  const [tournamentFilter, setTournamentFilter] = useState("");
  const [tournamentSortBy, setTournamentSortBy] = useState<
    "name" | "date_start" | "date_stop"
  >("name");
  const [tournamentSortOrder, setTournamentSortOrder] = useState<
    "asc" | "desc"
  >("asc");
  const [tournamentPage, setTournamentPage] = useState(1);
  const tournamentPageSize = 10;

  const [eventFilter, setEventFilter] = useState("");
  const [eventSortBy, setEventSortBy] = useState<
    "name" | "date_start" | "date_stop"
  >("date_start");
  const [eventSortOrder, setEventSortOrder] = useState<"asc" | "desc">("asc");
  const [eventPage, setEventPage] = useState(1);
  const eventPageSize = 10;

  const [ticketFilter, setTicketFilter] = useState("");
  const [ticketSortBy, setTicketSortBy] = useState<"title" | "price" | "stock">(
    "title"
  );
  const [ticketSortOrder, setTicketSortOrder] = useState<"asc" | "desc">("asc");
  const [ticketPage, setTicketPage] = useState(1);
  const ticketPageSize = 10;

  // Filtered and sorted data with pagination
  const filteredTournaments = useMemo(() => {
    const filtered = tournaments.filter((tournament) =>
      matchesSearch(tournamentFilter, tournament.official_name),
    );

    // Sort tournaments
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (tournamentSortBy) {
        case "name":
          comparison = a.official_name.localeCompare(b.official_name);
          break;
        case "date_start":
          comparison =
            new Date(a.date_start).getTime() - new Date(b.date_start).getTime();
          break;
        case "date_stop":
          comparison =
            new Date(a.date_stop).getTime() - new Date(b.date_stop).getTime();
          break;
      }
      return tournamentSortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [tournaments, tournamentFilter, tournamentSortBy, tournamentSortOrder]);

  const paginatedTournaments = useMemo(() => {
    const startIndex = (tournamentPage - 1) * tournamentPageSize;
    const endIndex = startIndex + tournamentPageSize;
    return filteredTournaments.slice(startIndex, endIndex);
  }, [filteredTournaments, tournamentPage, tournamentPageSize]);

  const filteredEvents = useMemo(() => {
    const filtered =events.filter((event) =>
      matchesSearch(eventFilter, event.event_name)
    );

    // Sort events
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (eventSortBy) {
        case "name":
          comparison = a.event_name.localeCompare(b.event_name);
          break;
        case "date_start":
          comparison =
            new Date(a.date_start).getTime() - new Date(b.date_start).getTime();
          break;
        case "date_stop":
          comparison =
            new Date(a.date_stop).getTime() - new Date(b.date_stop).getTime();
          break;
      }
      return eventSortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [events, eventFilter, eventSortBy, eventSortOrder]);

  const paginatedEvents = useMemo(() => {
    const startIndex = (eventPage - 1) * eventPageSize;
    const endIndex = startIndex + eventPageSize;
    return filteredEvents.slice(startIndex, endIndex);
  }, [filteredEvents, eventPage, eventPageSize]);

  const filteredTickets = useMemo(() => {
    const filtered =tickets.filter((ticket) =>
      matchesSearch(ticketFilter, ticket.ticket_title)
    );

    // Sort tickets
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (ticketSortBy) {
        case "title":
          comparison = a.ticket_title.localeCompare(b.ticket_title);
          break;
        case "price":
          const priceA = a.local_rates?.net_rate_eur ?? a.net_rate;
          const priceB = b.local_rates?.net_rate_eur ?? b.net_rate;
          comparison = priceA - priceB;
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
    setTournamentPage(1);
  }, [tournamentFilter, tournamentSortBy, tournamentSortOrder]);

  useEffect(() => {
    setEventPage(1);
  }, [eventFilter, eventSortBy, eventSortOrder]);

  useEffect(() => {
    setTicketPage(1);
  }, [ticketFilter, ticketSortBy, ticketSortOrder]);

  // Reset filters and pagination when selections change
  useEffect(() => {
    setTournamentFilter("");
    setTournamentPage(1);
  }, [selectedSport]);

  useEffect(() => {
    setEventFilter("");
    setEventPage(1);
  }, [selectedTournament]);

  useEffect(() => {
    setTicketFilter("");
    setTicketPage(1);
  }, [selectedEvent]);

  // Load initial data
  useEffect(() => {
    loadSportsAndSyncStatus();
  }, []);

  // Load tournaments when sport is selected
  useEffect(() => {
    if (selectedSport) {
      loadTournaments(selectedSport.sport_id);
      setSelectedTournament(null);
      setSelectedEvent(null);
      setTournaments([]);
      setEvents([]);
      setTickets([]);
    }
  }, [selectedSport]);

  // Load events when tournament is selected
  useEffect(() => {
    if (selectedTournament) {
      loadEvents(selectedTournament.tournament_id);
      setSelectedEvent(null);
      setEvents([]);
      setTickets([]);
    }
  }, [selectedTournament]);

  // Load tickets when event is selected
  useEffect(() => {
    if (selectedEvent) {
      loadTickets(selectedEvent.event_id);
    }
  }, [selectedEvent]);

  // Auto-select first tournament from filtered and sorted list
  useEffect(() => {
    if (
      filteredTournaments.length > 0 &&
      !selectedTournament &&
      tournaments.length > 0
    ) {
      setSelectedTournament(filteredTournaments[0]);
    }
  }, [filteredTournaments, selectedTournament, tournaments.length]);

  // Auto-select first event from filtered and sorted list
  useEffect(() => {
    if (filteredEvents.length > 0 && !selectedEvent && events.length > 0) {
      setSelectedEvent(filteredEvents[0]);
    }
  }, [filteredEvents, selectedEvent, events.length]);

  const loadSportsAndSyncStatus = async () => {
    try {
      setIsLoadingSports(true);
      const [sportsData, statusData] = await Promise.all([
        getSports(),
        getSyncStatus(),
      ]);

      setSports(sportsData);
      setSyncStatus(statusData);

      // Auto-select first sport if available
      if (sportsData.length > 0) {
        setSelectedSport(sportsData[0]);
      }
    } catch (error) {
      console.error("Failed to load sports:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load sports data. Please try again.",
      });
    } finally {
      setIsLoadingSports(false);
    }
  };

  const loadTournaments = async (sportId: string) => {
    try {
      setIsLoadingTournaments(true);
      const data = await getTournaments(sportId);
      setTournaments(data);
    } catch (error) {
      console.error("Failed to load tournaments:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load tournaments. Please try again.",
      });
    } finally {
      setIsLoadingTournaments(false);
    }
  };

  const loadEvents = async (tournamentId: string) => {
    try {
      setIsLoadingEvents(true);
      const data = await getEvents(tournamentId);
      setEvents(data);
    } catch (error) {
      console.error("Failed to load events:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load events. Please try again.",
      });
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const loadTickets = async (eventId: string) => {
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
      await triggerSync(type);

      toast({
        title: "Sync Started",
        description: `${
          type ? `${type.charAt(0).toUpperCase() + type.slice(1)} ` : ""
        }sync completed successfully.`,
      });

      // Reload data after sync
      await loadSportsAndSyncStatus();
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

  const handleCreateEventFromList = async (event: XS2Event) => {
    try {
      // Update exchange rates first
      await exchangeRateClientService.updateAllExchangeRates();

      // Get tickets for this specific event
      const eventTickets = await getLiveTickets(event.event_id);

      // Filter out tickets with stock < 4
      const filteredEventTickets = eventTickets.filter(
        (ticket) => ticket.stock >= 4
      );

      // Convert XS2Tickets to EventTickets with EUR to USD conversion
      const mappedTickets: EventTicket[] = await Promise.all(
        filteredEventTickets.map(async (ticket) => {
          // Get price in EUR (convert from cents to euros)
          const priceInEUR = ticket.local_rates?.net_rate_eur
            ? ticket.local_rates.net_rate_eur / 100
            : 0;
          
          // Convert EUR to USD
          const priceInUSD = priceInEUR > 0 
            ? Math.round(await exchangeRateClientService.convertToUSD(priceInEUR, 'EUR'))
            : 0;

          return {
            id: ticket.ticket_id,
            category: ticket.category_name || ticket.ticket_title,
            price: priceInUSD, // Price converted to USD
            description: ticket.description_supplier || ticket.ticket_title,
            colorOnTheMap: "#3B82F6", // Default blue color
            vendor: "XS2Events", // Optional vendor field, can be filled manually later
            available: true
          };
        })
      );

      // Try to find the nearest location
      let locationData: { latitude: number; longitude: number; name: string; city_iata: string; country_code?: string } = {
        latitude: Number(event.latitude) || 0,
        longitude: Number(event.longitude) || 0,
        name: event.venue_name || event.city || "Unknown Venue",
        city_iata: "", // This would need to be mapped separately
        country_code: undefined,
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
              country_code: nearestLocation.country_code || undefined,
            };

            toast({
              title: "Location Auto-filled",
              description: `Found nearest location: ${
                nearestLocation.name
              } (${nearestLocation.distance?.toFixed(1)} km away)`,
            });
          }
        }
      } catch (locationError) {
        console.error("Failed to find nearest location:", locationError);
        // Continue with original location data if nearest location search fails
      }

      // Create Event object from XS2Event data
      const eventData: Omit<Event, "id"> = {
        name: "", // TBD translate to hebrew first
        name_english: event.event_name, // Fallback to same name if no translation
        type: "sports_event_dynamic", // Set type for events created from sports events
        date: new Date(event.date_start).toISOString().split("T")[0], // Convert to YYYY-MM-DD format
        location: locationData,
        map_image_url: `https://cdn.xs2event.com/venues/static/${event.venue_id}-legend.png`, // Auto-populated from venue_id
        description:
          event.event_description ||
          `${event.event_name} at ${event.venue_name}`,
        card_image_url: "", // Not available in XS2Event
        tickets_and_rates: mappedTickets,
        def_date_depart: "", // Will be calculated by smart dates
        def_date_return: "", // Will be calculated by smart dates
        usual_price: 0, // Would need to be set manually
        base_flight_price: 0, // Would need to be set manually
        base_hotel_price: 0, // Would need to be set manually
        is_prioritized: false,
        event_additional_markup: null,
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
    } catch (error) {
      console.error("Failed to create event from sports event:", error);
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

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
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
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Sync Status and Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Data Sync Status
          </CardTitle>
          <CardDescription>
            Manage data synchronization with XS2Event API
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncStatus && (
            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              <div>
                Sports:{" "}
                <strong>{syncStatus.results?.sports?.count || 0}</strong>
              </div>
              <div>
                Tournaments:{" "}
                <strong>{syncStatus.results?.tournaments?.count || 0}</strong>
              </div>
              <div>
                Events:{" "}
                <strong>{syncStatus.results?.events?.count || 0}</strong>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleSync()} disabled={isSyncing} size="sm">
              {isSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync All
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => handleSync("sports")}
              disabled={isSyncing}
              size="sm"
            >
              Sync Sports
            </Button>

            <Button
              variant="outline"
              onClick={() => handleSync("tournaments")}
              disabled={isSyncing}
              size="sm"
            >
              Sync Tournaments
            </Button>

            <Button
              variant="outline"
              onClick={() => handleSync("events")}
              disabled={isSyncing}
              size="sm"
            >
              Sync Events
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Sports Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Sports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSports ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : sports.length > 0 ? (
              <div className="space-y-2">
                {sports.map((sport) => (
                  <Button
                    key={sport.sport_id}
                    variant={
                      selectedSport?.sport_id === sport.sport_id
                        ? "default"
                        : "outline"
                    }
                    className="w-full justify-start text-left h-auto p-3"
                    onClick={() => setSelectedSport(sport)}
                  >
                    <div>
                      <div className="font-medium">{sport.sport_id}</div>
                    </div>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  No sports available
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSync("sports")}
                  className="mt-2"
                >
                  Sync Sports Data
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              {sports.length} sports available
            </p>
          </CardContent>
        </Card>

        {/* Tournaments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Tournaments
              </div>
              {selectedSport && (
                <Badge variant="secondary" className="text-xs w-fit">
                  {selectedSport.sport_id}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedSport && (
              <FilterSortControls
                filter={tournamentFilter}
                setFilter={setTournamentFilter}
                sortBy={tournamentSortBy}
                setSortBy={(value) =>
                  setTournamentSortBy(
                    value as "name" | "date_start" | "date_stop"
                  )
                }
                sortOrder={tournamentSortOrder}
                setSortOrder={setTournamentSortOrder}
                sortOptions={[
                  { value: "name", label: "Name" },
                  { value: "date_start", label: "Start Date" },
                  { value: "date_stop", label: "End Date" },
                ]}
                placeholder="Filter tournaments..."
              />
            )}

            {isLoadingTournaments ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : paginatedTournaments.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedTournaments.map((tournament) => (
                    <Button
                      key={tournament.tournament_id}
                      variant={
                        selectedTournament?.tournament_id ===
                        tournament.tournament_id
                          ? "default"
                          : "outline"
                      }
                      className="w-full justify-start text-left h-auto p-3"
                      onClick={() => setSelectedTournament(tournament)}
                    >
                      <div>
                        <div className="font-medium text-sm">
                          {tournament.official_name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {tournament.season && `Season: ${tournament.season}`}
                          {tournament.region && ` • ${tournament.region}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(tournament.date_start)} -{" "}
                          {formatDate(tournament.date_stop)}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>

                <PaginationControls
                  currentPage={tournamentPage}
                  totalItems={filteredTournaments.length}
                  pageSize={tournamentPageSize}
                  onPageChange={setTournamentPage}
                />
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-4">
                {selectedSport
                  ? tournamentFilter
                    ? "No tournaments found matching your filter"
                    : "No tournaments found"
                  : "Select a sport first"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Events */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Events
              </div>
              {selectedTournament && (
                <Badge variant="secondary" className="text-xs w-fit">
                  {selectedTournament.official_name}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTournament && (
              <FilterSortControls
                filter={eventFilter}
                setFilter={setEventFilter}
                sortBy={eventSortBy}
                setSortBy={(value) =>
                  setEventSortBy(value as "name" | "date_start" | "date_stop")
                }
                sortOrder={eventSortOrder}
                setSortOrder={setEventSortOrder}
                sortOptions={[
                  { value: "name", label: "Name" },
                  { value: "date_start", label: "Start Date" },
                  { value: "date_stop", label: "End Date" },
                ]}
                placeholder="Filter events..."
              />
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
                        className="w-full justify-start text-left h-auto p-3 pr-20"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div>
                          <div className="font-medium text-sm">
                            {event.event_name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {event.date_start && formatDate(event.date_start)}
                          </div>
                          {event.event_status && (
                            <Badge
                              variant="outline"
                              className={`text-xs mt-1 ${getStatusColor(
                                event.event_status
                              )}`}
                            >
                              {event.event_status}
                            </Badge>
                          )}
                        </div>
                      </Button>
                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Link href={`/sports-events/${event.event_id}`}>
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
                            handleCreateEventFromList(event);
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
                {selectedTournament
                  ? eventFilter
                    ? "No events found matching your filter"
                    : "No events found"
                  : "Select a tournament first"}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Live Tickets */}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Ticket className="h-5 w-5" />
                Live Tickets
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
                <div className="space-y-3">
                  {paginatedTickets.map((ticket) => (
                    <div
                      key={ticket.ticket_id}
                      className="border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">
                          {ticket.ticket_title}
                        </div>
                        <Badge
                          variant="outline"
                          className={getStatusColor(ticket.ticket_status)}
                        >
                          {ticket.ticket_status}
                        </Badge>
                      </div>

                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>Type: {ticket.type_ticket}</div>
                        <div>Stock: {ticket.stock}</div>
                        <div className="font-medium text-primary">
                          {formatTicketNetPrice(ticket)}
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
