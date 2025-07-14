"use client";

import type React from "react";
import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { Event, EventTicket } from "@/types/app.types";
import {
  getEvent,
  updateEvent,
  createEvent,
} from "@/lib/actions/event-actions";
import { ColorPicker } from "@/components/color-picker";
import { ImageFilePicker } from "@/components/image-file-picker";
import { v4 as uuidv4 } from "uuid";

export default function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const unwrappedParams = use(params);
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isNewEvent = unwrappedParams.id === "new";

  useEffect(() => {
    async function fetchEvent() {
      if (isNewEvent) {
        // Check if there's pre-populated data from sports events
        const dataParam = searchParams.get("data");

        if (dataParam) {
          try {
            const prePopulatedData = JSON.parse(
              decodeURIComponent(dataParam)
            ) as Omit<Event, "id">;

            // Apply smart date calculation if we have an event date
            let finalData = { ...prePopulatedData };
            if (prePopulatedData.date) {
              const smartDates = calculateSmartDates(prePopulatedData.date);
              finalData.def_date_depart = smartDates.departure;
              finalData.def_date_return = smartDates.return;
            }

            setEvent({
              id: 0,
              ...finalData,
            });
          } catch (error) {
            console.error("Failed to parse pre-populated data:", error);
            toast({
              variant: "destructive",
              title: "Error",
              description:
                "Failed to load pre-populated data. Using default values.",
            });
            // Fall back to default empty event
            setEvent({
              id: 0,
              name: "",
              name_english: "",
              date: new Date().toISOString().split("T")[0],
              location: {
                latitude: 0,
                longitude: 0,
                name: "",
                city_iata: "",
              },
              map_image_url: "",
              description: "",
              card_image_url: "",
              tickets_and_rates: [],
              def_date_depart: "",
              def_date_return: "",
              usual_price: 0,
              base_flight_price: 0,
              base_hotel_price: 0,
              is_prioritized: false,
              is_deleted: "",
              tags: "",
            });
          }
        } else {
          // Default empty event
          setEvent({
            id: 0,
            name: "",
            name_english: "",
            date: new Date().toISOString().split("T")[0],
            location: {
              latitude: 0,
              longitude: 0,
              name: "",
              city_iata: "",
            },
            map_image_url: "",
            description: "",
            card_image_url: "",
            tickets_and_rates: [],
            def_date_depart: "",
            def_date_return: "",
            usual_price: 0,
            base_flight_price: 0,
            base_hotel_price: 0,
            is_prioritized: false,
            is_deleted: "",
            tags: "",
          });
        }
        setLoading(false);
        return;
      }

      try {
        const data = await getEvent(Number.parseInt(unwrappedParams.id));
        setEvent(data);
      } catch (error) {
        console.error("Error fetching event:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load event details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchEvent();
  }, [unwrappedParams.id, toast, isNewEvent, searchParams]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    if (name.includes(".")) {
      const [parent, child] = name.split(".");
      setEvent((prev) => {
        if (!prev) return prev;

        const parentValue = prev[parent as keyof Event];
        // Ensure we're only spreading object types
        if (parentValue && typeof parentValue === "object") {
          // Convert city_iata to uppercase
          const finalValue = child === "city_iata" ? value.toUpperCase() : value;
          return {
            ...prev,
            [parent]: {
              ...parentValue,
              [child]: finalValue,
            },
          };
        }
        return prev;
      });
    } else {
      setEvent((prev) => {
        if (!prev) return prev;

        const updatedEvent = {
          ...prev,
          [name]: value,
        };

        // If the date field is being changed, automatically calculate smart departure and return dates
        if (name === "date" && value) {
          const smartDates = calculateSmartDates(value);
          updatedEvent.def_date_depart = smartDates.departure;
          updatedEvent.def_date_return = smartDates.return;
        }

        return updatedEvent;
      });
    }
  };

  const handleSwitchChange = (checked: boolean) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        is_prioritized: checked,
      };
    });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [name]: Number.parseFloat(value),
      };
    });
  };

  const handleLocationNumberChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = e.target;
    const field = name.split(".")[1];

    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        location: {
          ...prev.location,
          [field]: Number.parseFloat(value),
        },
      };
    });
  };

  const handleAddTicket = () => {
    if (!event) return;

    const newTicket: EventTicket = {
      id: uuidv4(),
      category: "",
      price: 0,
      description: "",
      colorOnTheMap: "#000000",
    };

    setEvent({
      ...event,
      tickets_and_rates: [...event.tickets_and_rates, newTicket],
    });
  };

  const handleRemoveTicket = (ticketId: string) => {
    if (!event) return;

    setEvent({
      ...event,
      tickets_and_rates: event.tickets_and_rates.filter(
        (ticket) => ticket.id !== ticketId
      ),
    });
  };

  const handleTicketChange = (
    ticketId: string,
    field: keyof EventTicket,
    value: string | number
  ) => {
    if (!event) return;

    setEvent({
      ...event,
      tickets_and_rates: event.tickets_and_rates.map((ticket) =>
        ticket.id === ticketId ? { ...ticket, [field]: value } : ticket
      ),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    // Validate required fields for new events
    if (isNewEvent) {
      const requiredFields = [
        { field: "name", label: "Name" },
        { field: "name_english", label: "English Name" },
        { field: "date", label: "Date" },
        { field: "location.name", label: "Location Name" },
      ];

      for (const { field, label } of requiredFields) {
        const value = field.includes(".")
          ? event.location.name // For nested fields
          : event[field as keyof Event];

        if (!value || value === "") {
          toast({
            variant: "destructive",
            title: "Validation Error",
            description: `${label} is required.`,
          });
          return;
        }
      }
    }

    // Show confirmation dialog with appropriate message
    const confirmed = window.confirm(
      isNewEvent
        ? "Are you sure you want to create this event?"
        : "Are you sure you want to save changes to this event?"
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      if (isNewEvent) {
        // For new events, remove the id and ensure proper field values
        const { id, ...eventWithoutId } = event;
        const eventData = {
          ...eventWithoutId,
        };

        await createEvent(eventData);
        toast({
          title: "Success",
          description: "Event has been created successfully.",
        });
      } else {
        // For existing events, use updateEvent
        await updateEvent(event.id, event);
        toast({
          title: "Success",
          description: "Event has been saved successfully.",
        });
      }
      router.push("/events");
    } catch (error) {
      console.error(
        `Error ${isNewEvent ? "creating" : "saving"} event:`,
        error
      );
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to ${
          isNewEvent ? "create" : "save"
        } event. Please try again.`,
      });
    } finally {
      setSaving(false);
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

  if (loading) {
    return <div>Loading event details...</div>;
  }

  if (!event) {
    return <div>Event not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="ml-4">
          <h1 className="text-3xl font-bold tracking-tight">
            {isNewEvent
              ? searchParams.get("data")
                ? "Create Event from Sports Event"
                : "Create Event"
              : `Edit Event: ${event.name}`}
          </h1>
          {isNewEvent && searchParams.get("data") && (
            <p className="text-sm text-muted-foreground mt-1">
              Pre-populated with data from XS2Event. Review and adjust as
              needed.
            </p>
          )}
        </div>
      </div>

      {event.is_deleted && (
        <Card className="bg-destructive/10 border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="font-medium text-destructive">
                This event is marked as deleted on {event.is_deleted}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Enter the basic details for this event.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={event.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name_english">English Name</Label>
                <Input
                  id="name_english"
                  name="name_english"
                  value={event.name_english}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                value={event.date.split("T")[0]}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={event.description}
                onChange={handleChange}
                rows={4}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="usual_price">Usual Price</Label>
                <Input
                  id="usual_price"
                  name="usual_price"
                  type="number"
                  value={event.usual_price}
                  onChange={handleNumberChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_flight_price">Base Flight Price</Label>
                <Input
                  id="base_flight_price"
                  name="base_flight_price"
                  type="number"
                  value={event.base_flight_price}
                  onChange={handleNumberChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="base_hotel_price">Base Hotel Price</Label>
                <Input
                  id="base_hotel_price"
                  name="base_hotel_price"
                  type="number"
                  value={event.base_hotel_price}
                  onChange={handleNumberChange}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="def_date_depart">Default Departure Date</Label>
                <Input
                  id="def_date_depart"
                  name="def_date_depart"
                  type="date"
                  value={
                    event.def_date_depart
                      ? event.def_date_depart.split("T")[0]
                      : ""
                  }
                  onChange={handleChange}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-calculated: 2 days before event (avoids Fri/Sat, uses Thu
                  instead)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="def_date_return">Default Return Date</Label>
                <Input
                  id="def_date_return"
                  name="def_date_return"
                  type="date"
                  value={
                    event.def_date_return
                      ? event.def_date_return.split("T")[0]
                      : ""
                  }
                  onChange={handleChange}
                />
                <p className="text-xs text-muted-foreground">
                  Auto-calculated: 1 day after event (if Sat, moves to Sun)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="is_prioritized">Prioritized</Label>
              <div className="flex items-center space-x-2 pt-2">
                <Switch
                  id="is_prioritized"
                  checked={event.is_prioritized}
                  onCheckedChange={handleSwitchChange}
                />
                <Label htmlFor="is_prioritized">
                  {event.is_prioritized ? "Yes" : "No"}
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tag</Label>
              <select
                id="tags"
                name="tags"
                value={event.tags || "null"}
                onChange={(e) => {
                  const value = e.target.value === "null" ? "" : e.target.value;
                  setEvent((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      tags: value,
                    };
                  });
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="null">None</option>
                <option value="Sold">Sold</option>
                <option value="LastTickets">LastTickets</option>
                <option value="Popular">Popular</option>
                <option value="Restock">Restock</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
            <CardDescription>
              Enter the location details for this event.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="location.name">Location Name</Label>
              <Input
                id="location.name"
                name="location.name"
                value={event.location.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location.city_iata">City IATA Code</Label>
                <Input
                  id="location.city_iata"
                  name="location.city_iata"
                  value={event.location.city_iata}
                  onChange={handleChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location.latitude">Latitude</Label>
                <Input
                  id="location.latitude"
                  name="location.latitude"
                  type="number"
                  step="0.000001"
                  value={event.location.latitude}
                  onChange={handleLocationNumberChange}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location.longitude">Longitude</Label>
                <Input
                  id="location.longitude"
                  name="location.longitude"
                  type="number"
                  step="0.000001"
                  value={event.location.longitude}
                  onChange={handleLocationNumberChange}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Images</CardTitle>
            <CardDescription>
              Select image files from storage or enter URLs manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ImageFilePicker
              label="Card Image"
              value={event.card_image_url}
              onChange={(url) =>
                setEvent((prev) =>
                  prev ? { ...prev, card_image_url: url } : prev
                )
              }
              bucketName={
                process.env.NODE_ENV === "development"
                  ? "card-images"
                  : "card_images"
              }
              folder=""
            />

            <ImageFilePicker
              label="Map Image"
              value={event.map_image_url}
              onChange={(url) =>
                setEvent((prev) =>
                  prev ? { ...prev, map_image_url: url } : prev
                )
              }
              bucketName={
                process.env.NODE_ENV === "development"
                  ? "map-images"
                  : "map_images"
              }
              folder="maps"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Tickets and Rates</CardTitle>
              <CardDescription>
                Manage the ticket categories and prices for this event.
              </CardDescription>
            </div>
            <Button
              type="button"
              onClick={handleAddTicket}
              variant="outline"
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Ticket
            </Button>
          </CardHeader>
          <CardContent>
            {event.tickets_and_rates.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No tickets added yet. Click "Add Ticket" to create a new ticket
                category.
              </div>
            ) : (
              <div className="space-y-6">
                {event.tickets_and_rates.map((ticket, index) => (
                  <div key={ticket.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium">Ticket #{index + 1}</h3>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveTicket(ticket.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor={`ticket-${ticket.id}-category`}>
                            Category
                          </Label>
                          <Input
                            id={`ticket-${ticket.id}-category`}
                            value={ticket.category}
                            onChange={(e) =>
                              handleTicketChange(
                                ticket.id,
                                "category",
                                e.target.value
                              )
                            }
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`ticket-${ticket.id}-price`}>
                            Price
                          </Label>
                          <Input
                            id={`ticket-${ticket.id}-price`}
                            type="number"
                            value={ticket.price}
                            onChange={(e) =>
                              handleTicketChange(
                                ticket.id,
                                "price",
                                Number.parseFloat(e.target.value)
                              )
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`ticket-${ticket.id}-description`}>
                          Description
                        </Label>
                        <Textarea
                          id={`ticket-${ticket.id}-description`}
                          value={ticket.description}
                          onChange={(e) =>
                            handleTicketChange(
                              ticket.id,
                              "description",
                              e.target.value
                            )
                          }
                          rows={2}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`ticket-${ticket.id}-color`}>
                          Color on the Map
                        </Label>
                        <ColorPicker
                          value={ticket.colorOnTheMap}
                          onChange={(value) =>
                            handleTicketChange(
                              ticket.id,
                              "colorOnTheMap",
                              value
                            )
                          }
                          mapImageUrl={event.map_image_url}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Event"}
          </Button>
        </div>
      </form>
    </div>
  );
}
