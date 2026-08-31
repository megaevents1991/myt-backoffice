
"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Search, Loader2, ExternalLink, Ticket, Calendar as CalendarIcon, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { searchComparisonEvents, ComparisonEvent, getComparisonEventTickets, ComparisonTicket } from "@/lib/actions/comparison-actions";
import { TixStockEventDB } from "@/types/tixstock.types";

interface EventComparisonModalProps {
  event: TixStockEventDB;
}

export function EventComparisonModal({ event }: EventComparisonModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ComparisonEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVendors, setSelectedVendors] = useState<string[]>(['LiveEvents', 'P1Events', 'SportsEvents']);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedEvent, setSelectedEvent] = useState<ComparisonEvent | null>(null);
  const [tickets, setTickets] = useState<ComparisonTicket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  // Initialize search query with event name when modal opens
  useEffect(() => {
    if (isOpen && !searchQuery) {
      setSearchQuery(event.event_name);
    }
  }, [isOpen, event.event_name]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setIsLoading(true);
    setSelectedEvent(null); // Reset selection on new search
    try {
      const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
      const data = await searchComparisonEvents(searchQuery, selectedVendors, dateStr);
      setResults(data);
    } catch (error) {
      console.error("Failed to search comparison events:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewTickets = async (event: ComparisonEvent) => {
    setSelectedEvent(event);
    setIsLoadingTickets(true);
    try {
      const data = await getComparisonEventTickets(event);
      setTickets(data);
    } catch (error) {
      console.error("Failed to load tickets:", error);
    } finally {
      setIsLoadingTickets(false);
    }
  };

  const handleBackToResults = () => {
    setSelectedEvent(null);
    setTickets([]);
  };

  const toggleVendor = (vendor: string) => {
    setSelectedVendors(prev => 
      prev.includes(vendor) 
        ? prev.filter(v => v !== vendor)
        : [...prev, vendor]
    );
  };

  const getVendorBadgeColor = (vendor: string) => {
    switch (vendor) {
      case "LiveEvents": return "bg-blue-500";
      case "P1Events": return "bg-orange-500";
      case "SportsEvents": return "bg-green-500";
      default: return "bg-muted-foreground";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) {
        handleBackToResults(); // Reset on close
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Search className="mr-2 h-4 w-4" />
          Search More
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedEvent ? (
              <>
                <Button variant="ghost" size="icon" onClick={handleBackToResults} className="h-8 w-8 -ml-2">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="truncate">{selectedEvent.name}</span>
                <Badge className={getVendorBadgeColor(selectedEvent.vendor)}>
                  {selectedEvent.vendor}
                </Badge>
              </>
            ) : (
              "Compare Prices"
            )}
          </DialogTitle>
          <DialogDescription>
            {selectedEvent 
              ? `${selectedEvent.venue}, ${selectedEvent.city} • ${format(new Date(selectedEvent.date), "PPP")}`
              : `Search for "${event.event_name}" across other vendors.`
            }
          </DialogDescription>
        </DialogHeader>

        {!selectedEvent ? (
          <>
            <div className="space-y-4 py-4">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="vendor-live" 
                    checked={selectedVendors.includes('LiveEvents')}
                    onCheckedChange={() => toggleVendor('LiveEvents')}
                  />
                  <Label htmlFor="vendor-live">Live Events</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="vendor-p1" 
                    checked={selectedVendors.includes('P1Events')}
                    onCheckedChange={() => toggleVendor('P1Events')}
                  />
                  <Label htmlFor="vendor-p1">P1 Events</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="vendor-sports" 
                    checked={selectedVendors.includes('SportsEvents')}
                    onCheckedChange={() => toggleVendor('SportsEvents')}
                  />
                  <Label htmlFor="vendor-sports">Sports Events</Label>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by event name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="flex-1"
                />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-[240px] justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Button onClick={handleSearch} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Event Name</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead className="text-right">Min Price</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                        <span className="text-xs text-muted-foreground mt-2 block">Searching vendors...</span>
                      </TableCell>
                    </TableRow>
                  ) : results.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        No matching events found. Try adjusting your search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map((item) => (
                      <TableRow 
                        key={`${item.vendor}-${item.id}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleViewTickets(item)}
                      >
                        <TableCell>
                          <Badge className={getVendorBadgeColor(item.vendor)}>
                            {item.vendor}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.venue}</TableCell>
                        <TableCell>{item.city}</TableCell>
                        <TableCell className="text-right">
                          {item.minPrice ? `€${item.minPrice}` : '-'}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" title="View Tickets">
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 mt-4">
             <ScrollArea className="flex-1 border rounded-md">
               <Table>
                 <TableHeader>
                   <TableRow>
                     <TableHead>Category</TableHead>
                     <TableHead>Description</TableHead>
                     <TableHead>Type</TableHead>
                     <TableHead className="text-right">Stock</TableHead>
                     <TableHead className="text-right">Price</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {isLoadingTickets ? (
                     <TableRow>
                       <TableCell colSpan={5} className="h-24 text-center">
                         <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                         <span className="text-xs text-muted-foreground mt-2 block">Loading tickets...</span>
                       </TableCell>
                     </TableRow>
                   ) : tickets.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                         No tickets available for this event.
                       </TableCell>
                     </TableRow>
                   ) : (
                     tickets.map((ticket) => (
                       <TableRow key={ticket.id}>
                         <TableCell className="font-medium">{ticket.name}</TableCell>
                         <TableCell className="max-w-[300px] truncate" title={ticket.description}>
                           {ticket.description || '-'}
                         </TableCell>
                         <TableCell>{ticket.type || '-'}</TableCell>
                         <TableCell className="text-right">{ticket.stock}</TableCell>
                         <TableCell className="text-right font-bold">
                           {new Intl.NumberFormat('en-US', { style: 'currency', currency: ticket.currency }).format(ticket.price)}
                         </TableCell>
                       </TableRow>
                     ))
                   )}
                 </TableBody>
               </Table>
             </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
