"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { 
  ArrowLeft, 
  Calendar, 
  MapPin, 
  Ticket, 
  Info,
  CreditCard,
  Truck
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getTixStockEventById, getTixStockTickets } from "@/lib/actions/tixstock-actions";
import { TixStockEventDB, TixStockListing } from "@/types/tixstock.types";

export default function TixStockEventDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const eventId = params.id as string;

  const [event, setEvent] = useState<TixStockEventDB | null>(null);
  const [tickets, setTickets] = useState<TixStockListing[]>([]);
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

  if (isLoadingEvent) {
    return <div className="p-8 text-center">Loading event details...</div>;
  }

  if (!event) {
    return <div className="p-8 text-center">Event not found</div>;
  }

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <CardTitle>Available Tickets</CardTitle>
          <CardDescription>
            Live inventory from TixStock API
          </CardDescription>
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
                tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
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
