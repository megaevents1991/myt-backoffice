"use client";

import { useEffect, useState, useMemo } from "react";
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
  ExternalLink
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
import { useToast } from "@/hooks/use-toast";
import { getTixStockEvents, getTixStockTickets, triggerTixStockSync } from "@/lib/actions/tixstock-actions";
import { matchesSearch } from "@/lib/search";
import { TixStockEventDB, TixStockListing } from "@/types/tixstock.types";
import { Checkbox } from "@/components/ui/checkbox";
import { tixstockToEvent } from "./batch/tixstock-to-event";
import { homeTeamOf, isHomeGame } from "@/lib/tixstock-home";
import { createDraftBatch } from "@/lib/actions/factory-actions";
import {
  FilterSortControls,
  PaginationControls,
} from "@/components/provider-browse";


/**
 * "Known empty" for the hide-toggle. ticket_count 0 is a measured zero; a NULL
 * on a row the nightly sync hasn't touched in two runs means the event is gone
 * from the TixStock feed entirely (dropped fixtures keep their DB row) — there
 * is nothing to buy either way. A fresh null stays visible as genuinely unknown.
 */
const STALE_SYNC_MS = 48 * 60 * 60 * 1000;

/**
 * Events starting sooner than this never make the list. MYT packages need
 * flight+hotel lead time, and the nightly snapshot is stale by showtime anyway
 * (TixStock pulls listings during the day of the event) — the head of the
 * date-sorted list was permanently unreliable.
 */
const MIN_LEAD_MS = 48 * 60 * 60 * 1000;
const isKnownEmpty = (event: TixStockEventDB): boolean => {
  if (event.ticket_count === 0) return true;
  if (event.ticket_count == null) {
    const synced = event.last_synced ? Date.parse(event.last_synced) : NaN;
    return Number.isFinite(synced) && Date.now() - synced > STALE_SYNC_MS;
  }
  return false;
};



export function TixStockEventsContent() {
  const { toast } = useToast();
  
  // Data states
  const [events, setEvents] = useState<TixStockEventDB[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [performers, setPerformers] = useState<string[]>([]);
  const [tickets, setTickets] = useState<TixStockListing[]>([]);
  // Ticketless events the server left out, counted so the checkbox can say how
  // many are hidden without shipping the rows it is describing.
  const [hiddenEmpty, setHiddenEmpty] = useState(0);
  const [truncated, setTruncated] = useState(false);
  
  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Selection states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPerformer, setSelectedPerformer] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TixStockEventDB | null>(null);

  // Batch multi-select state (scoped to the performer-filtered events list)
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());

  const sendToFactory = async () => {
    if (selectedEvents.length === 0) return;
    const result = await createDraftBatch({
      source: "tixstock",
      scope: { manual: true, count: selectedEvents.length },
      payloads: selectedEvents.map(tixstockToEvent),
    });
    if (!result.ok) {
      toast({ variant: "destructive", title: "Factory intake failed" });
      return;
    }
    setSelectedEventIds(new Set());
    window.open("/factory", "_blank");
  };

  // Stash the selected events and open the shared create form (real /events/new in
  // batch mode). One Save there creates one event per selected TixStock event.
  const openBatchCreate = () => {
    if (selectedEvents.length === 0) return;
    try {
      window.localStorage.setItem(
        "batch_create",
        JSON.stringify({ provider: "tixstock", rows: selectedEvents }),
      );
      window.localStorage.removeItem("tx_batch_create");
    } catch (error) {
      console.error("Failed to stash batch events:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not start batch create." });
      return;
    }
    window.open("/events/new?batch=1", "_blank");
  };

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
  // Hide events whose nightly availability snapshot is 0 (null = unknown → kept).
  const [hideNoTickets, setHideNoTickets] = useState(true);
  const eventPageSize = 10;

  const [ticketFilter, setTicketFilter] = useState("");
  const [ticketSortBy, setTicketSortBy] = useState<"price" | "quantity">("price");
  const [ticketSortOrder, setTicketSortOrder] = useState<"asc" | "desc">("asc");
  const [ticketPage, setTicketPage] = useState(1);
  const ticketPageSize = 10;

  // `withTickets` is a server-side filter, not a client one - flipping the
  // checkbox refetches. Keeping it client-side meant downloading all 50k rows
  // (49 MB) on every page load just so the 16% with tickets could be shown.
  const loadEvents = async (withTickets: boolean) => {
    try {
      setIsLoading(true);
      const result = await getTixStockEvents({ withTickets });
      const data = result.events;
      setEvents(data);
      setHiddenEmpty(result.hiddenEmpty);
      setTruncated(result.truncated);

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
    loadEvents(hideNoTickets);
  }, [hideNoTickets]);

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
      loadEvents(hideNoTickets);
    } catch {
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

  const handleCreateEventFromTixStock = async (event: TixStockEventDB) => {
    try {
      // Shared mapping (name/date/venue/coords/map + smart dates) - same as batch-create.
      const eventData = tixstockToEvent(event);

      // Encode the event data and navigate to create event page
      const encodedData = encodeURIComponent(JSON.stringify(eventData));
      window.open(`/events/new?data=${encodedData}&txEventId=${event.event_id}`, "_blank");

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
    return categories.filter(c => matchesSearch(categoryFilter, c));
  }, [categories, categoryFilter]);

  const paginatedCategories = useMemo(() => {
    const start = (categoryPage - 1) * categoryPageSize;
    return filteredCategories.slice(start, start + categoryPageSize);
  }, [filteredCategories, categoryPage]);

  const filteredPerformers = useMemo(() => {
    let filtered = performers.filter(p => matchesSearch(performerFilter, p));
    
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

  const { filteredEvents, knownEmptyCount } = useMemo(() => {
    const leadHorizon = Date.now() + MIN_LEAD_MS;
    const base = events.filter(e => {
      const showMs = Date.parse(e.show_date);
      // Unparseable dates stay visible rather than silently vanishing.
      if (Number.isFinite(showMs) && showMs < leadHorizon) return false;
      const matchesQuery = matchesSearch(eventFilter, e.event_name, e.venue_name, e.city_name);
      const matchesCategory = selectedCategory ? e.category_name === selectedCategory : true;
      const matchesPerformer = selectedPerformer ? e.performers?.some(p => p.name === selectedPerformer) : true;
      return matchesQuery && matchesCategory && matchesPerformer;
    });

    // Measured zeros + stale nulls (dropped from the feed); fresh unknowns kept.
    const knownEmptyCount = base.filter(isKnownEmpty).length;
    const filtered = hideNoTickets ? base.filter(e => !isKnownEmpty(e)) : base;

    filtered.sort((a, b) => {
      let comparison = 0;
      if (eventSortBy === 'name') {
        comparison = a.event_name.localeCompare(b.event_name);
      } else {
        comparison = new Date(a.show_date).getTime() - new Date(b.show_date).getTime();
      }
      return eventSortOrder === 'asc' ? comparison : -comparison;
    });

    return { filteredEvents: filtered, knownEmptyCount };
  }, [events, eventFilter, selectedCategory, selectedPerformer, eventSortBy, eventSortOrder, hideNoTickets]);

  const paginatedEvents = useMemo(() => {
    const start = (eventPage - 1) * eventPageSize;
    return filteredEvents.slice(start, start + eventPageSize);
  }, [filteredEvents, eventPage]);

  // While hiding them the rows aren't loaded at all, so the count comes from
  // the server; while showing them we can count what's on screen.
  const emptyLabelCount = hideNoTickets ? hiddenEmpty : knownEmptyCount;

  // Multi-team batch (spec 2026-09-02, section 5): the selection ACCUMULATES
  // across performers - the chips row above the table shows what came from
  // each team. (The old one-performer reset lived here.)

  const toggleSelected = (id: string) =>
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedEvents = useMemo(
    () =>
      events
        .filter((e) => selectedEventIds.has(e.event_id))
        .sort(
          (a, b) =>
            homeTeamOf(a).localeCompare(homeTeamOf(b)) ||
            Date.parse(a.show_date) - Date.parse(b.show_date),
        ),
    [events, selectedEventIds]
  );

  const filteredTickets = useMemo(() => {
    const query = ticketFilter.trim().toLowerCase();
    // No query = keep everything. A listing without seat_details must not be
    // dropped by `undefined?.includes(...)` evaluating to undefined.
    const filtered = tickets.filter(t =>
      !query ||
      (t.seat_details?.category?.toLowerCase().includes(query) ?? false) ||
      (t.seat_details?.section?.toLowerCase().includes(query) ?? false)
    );

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
  useEffect(() => setEventPage(1), [eventFilter, selectedCategory, selectedPerformer, hideNoTickets]);
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

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <Checkbox
                  checked={hideNoTickets}
                  onCheckedChange={(v) => setHideNoTickets(v === true)}
                />
                Hide events without tickets
                {emptyLabelCount > 0 && ` (${emptyLabelCount})`}
              </label>

              {truncated && (
                <p className="mt-2 text-xs text-amber-600">
                  Showing the first {events.length.toLocaleString()} events only - narrow the
                  search or re-tick &quot;Hide events without tickets&quot; to see the full list.
                </p>
              )}

              {selectedEventIds.size > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {[...new Set(selectedEvents.map(homeTeamOf))].map((team) => {
                    const count = selectedEvents.filter((e) => homeTeamOf(e) === team).length;
                    return (
                      <span
                        key={team}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium"
                      >
                        {team}
                        <span className="tabular text-muted-foreground">{count}</span>
                        <button
                          type="button"
                          aria-label={`Clear ${team}`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setSelectedEventIds((prev) => {
                              const next = new Set(prev);
                              for (const e of selectedEvents)
                                if (homeTeamOf(e) === team) next.delete(e.event_id);
                              return next;
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {selectedPerformer && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    setSelectedEventIds((prev) => {
                      const next = new Set(prev);
                      for (const e of filteredEvents)
                        if (isHomeGame(e.event_name, selectedPerformer)) next.add(e.event_id);
                      return next;
                    })
                  }
                >
                  בחר את כל משחקי הבית של {selectedPerformer}
                </Button>
              )}

              <div className="space-y-4 mt-4">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : paginatedEvents.length > 0 ? (
                  paginatedEvents.map((event) => (
                    <div key={event.event_id} className="relative group">
                      <div
                        className="absolute left-2 top-2 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedEventIds.has(event.event_id)}
                          onCheckedChange={() => toggleSelected(event.event_id)}
                          aria-label={`Select ${event.event_name}`}
                        />
                      </div>
                      <Card
                        className={`cursor-pointer transition-colors ${selectedEvent?.event_id === event.event_id ? 'bg-accent border-primary' : 'hover:bg-accent/50'} ${isKnownEmpty(event) ? 'opacity-50' : ''}`}
                        onClick={() => setSelectedEvent(event)}
                      >
                        <CardContent className="p-4 pl-9">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-start justify-between">
                              <h3 className="font-semibold text-sm">{event.event_name}</h3>
                              <div className="flex items-center gap-1 shrink-0">
                                {selectedPerformer && isHomeGame(event.event_name, selectedPerformer) && (
                                  <Badge className="bg-success-muted text-success text-xs" variant="outline">
                                    בית
                                  </Badge>
                                )}
                                {isKnownEmpty(event) ? (
                                  <Badge variant="outline" className="text-xs text-muted-foreground">
                                    No tickets
                                  </Badge>
                                ) : typeof event.ticket_count === "number" ? (
                                  <Badge variant="outline" className="text-xs">
                                    {event.ticket_count} tix
                                  </Badge>
                                ) : null}
                                <Badge variant={event.is_active ? "default" : "secondary"} className="text-xs">
                                  {event.event_status}
                                </Badge>
                              </div>
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
                          title="View Details"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`/tixstock-events/${event.event_id}`, "_blank");
                          }}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
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

              {selectedEventIds.size > 0 && (
                <div className="sticky bottom-0 z-20 mt-3 flex items-center justify-between rounded-md border bg-background p-3 shadow">
                  <span className="text-sm font-medium">{selectedEventIds.size} selected</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedEventIds(new Set())}>
                      Clear
                    </Button>
                    <Button size="sm" onClick={openBatchCreate}>
                      Create {selectedEventIds.size} events
                    </Button>
                    <Button size="sm" variant="secondary" onClick={sendToFactory}>
                      Send to factory
                    </Button>
                  </div>
                </div>
              )}

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
