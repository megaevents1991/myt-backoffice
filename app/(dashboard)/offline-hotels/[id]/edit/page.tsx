"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState, useTransition, useEffect, use } from "react";
import { toast } from "react-hot-toast";
import Link from "next/link";
import { ArrowLeft, Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

import {
  getOfflineHotel,
  updateOfflineHotel,
  getRelevantEventsForHotel,
  getRelevantFlightsForHotel,
  searchWorldOTAHotels,
  type HotelSearchResult,
} from "@/lib/actions/offline-hotel-actions";
import type { OfflineHotel } from "@/types/offline-hotel.types";

const offlineHotelFormSchema = z.object({
  hotel_name: z.string().min(1, "Hotel name is required."),
  city: z
    .string()
    .min(2, "City must be at least 2 characters.")
    .regex(
      /^[\p{L}][\p{L}\s\-'.,]+$/u,
      "City must contain letters only (no digits)."
    ),
  hid: z.coerce.number().int().positive().optional().or(z.literal("")),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD."),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD."),
  price: z.coerce.number().positive("Price must be positive."),
  room_type: z.string().min(1, "Room type is required."),
  num_rooms: z.coerce.number().int().positive("Must be at least 1."),
  meal_plan: z.string().optional(),
  notes: z.string().optional(),
  last_cancellation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.").optional().or(z.literal("")),
  event_ids: z.array(z.number().int()).default([]),
  flight_ids: z.array(z.number().int()).default([]),
}).refine(
  (d) => !d.check_in || !d.check_out || d.check_in < d.check_out,
  { message: "Check-out must be after check-in.", path: ["check_out"] }
);

type HotelFormData = z.infer<typeof offlineHotelFormSchema>;

interface EditOfflineHotelPageProps {
  params: Promise<{ id: string }>;
}

export default function EditOfflineHotelPage({ params }: EditOfflineHotelPageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const hotelIdParam = resolvedParams.id;
  const [isPending, startTransition] = useTransition();
  const [isLoadingHotel, setIsLoadingHotel] = useState(true);
  const [hotelId, setHotelId] = useState<number | null>(null);
  const [relevantEvents, setRelevantEvents] = useState<{ id: number; name: string; date: string }[]>([]);
  const [relevantFlights, setRelevantFlights] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isLoadingFlights, setIsLoadingFlights] = useState(false);

  // WorldOTA hotel search
  const [hotelSearchQuery, setHotelSearchQuery] = useState("");
  const [hotelSearchResults, setHotelSearchResults] = useState<HotelSearchResult[]>([]);
  const [isSearchingHotels, setIsSearchingHotels] = useState(false);
  const [linkedHotel, setLinkedHotel] = useState<HotelSearchResult | null>(null);
  const [hotelSearchOpen, setHotelSearchOpen] = useState(false);

  const form = useForm<HotelFormData>({
    resolver: zodResolver(offlineHotelFormSchema),
  });

  useEffect(() => {
    if (!hotelIdParam) return;
    const parsedId = parseInt(hotelIdParam, 10);
    if (isNaN(parsedId)) {
      toast.error("Invalid hotel ID.");
      router.push("/offline-hotels");
      setIsLoadingHotel(false);
      return;
    }
    setHotelId(parsedId);
    setIsLoadingHotel(true);
    getOfflineHotel(parsedId)
      .then((hotel) => {
        form.reset({
          hotel_name: hotel.hotel_name,
          city: hotel.city,
          hid: hotel.hid ?? ("" as any),
          check_in: hotel.check_in,
          check_out: hotel.check_out,
          price: Number(hotel.price),
          room_type: hotel.room_type,
          num_rooms: hotel.num_rooms,
          meal_plan: hotel.meal_plan ?? "",
          notes: hotel.notes ?? "",
          last_cancellation_date: hotel.last_cancellation_date ?? "",
          event_ids: hotel.event_ids ?? [],
          flight_ids: hotel.flight_ids ?? [],
        });
        if (hotel.hid) {
          setLinkedHotel({ hid: hotel.hid, name: hotel.hotel_name, star_rating: 0, address: hotel.city });
        }
      })
      .catch(() => {
        toast.error("Failed to load hotel data.");
        router.push("/offline-hotels");
      })
      .finally(() => setIsLoadingHotel(false));
  }, [hotelIdParam, form, router]);

  const city = form.watch("city");
  const checkIn = form.watch("check_in");
  const checkOut = form.watch("check_out");

  // Debounced WorldOTA hotel search
  useEffect(() => {
    if (hotelSearchQuery.trim().length < 2) { setHotelSearchResults([]); return; }
    setIsSearchingHotels(true);
    const timer = setTimeout(() => {
      searchWorldOTAHotels(hotelSearchQuery)
        .then(setHotelSearchResults)
        .catch(console.error)
        .finally(() => setIsSearchingHotels(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [hotelSearchQuery]);

  useEffect(() => {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(checkIn) || !datePattern.test(checkOut)) {
      setRelevantEvents([]);
      setRelevantFlights([]);
      return;
    }
    let cancelled = false;

    setIsLoadingEvents(true);
    getRelevantEventsForHotel(city, checkIn, checkOut)
      .then((e) => { if (!cancelled) setRelevantEvents(e as any); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setIsLoadingEvents(false); });

    setIsLoadingFlights(true);
    getRelevantFlightsForHotel(city, checkIn, checkOut)
      .then((f) => { if (!cancelled) setRelevantFlights(f as any); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setIsLoadingFlights(false); });

    return () => { cancelled = true; };
  }, [city, checkIn, checkOut]);

  async function onSubmit(values: HotelFormData) {
    if (hotelId === null) { toast.error("Hotel ID missing."); return; }
    startTransition(async () => {
      try {
        await updateOfflineHotel(hotelId, {
          ...values,
          hid: values.hid ? Number(values.hid) : null,
          meal_plan: values.meal_plan || null,
          notes: values.notes || null,
          last_cancellation_date: values.last_cancellation_date || null,
        } as Partial<Omit<OfflineHotel, "id" | "consumed_rooms" | "created_at">>);
        toast.success("Hotel updated successfully!");
        router.push("/offline-hotels");
        router.refresh();
      } catch (error) {
        toast.error((error as Error)?.message || "Failed to update hotel.");
      }
    });
  }

  if (isLoadingHotel) return <div className="container mx-auto py-10">Loading hotel data...</div>;
  if (hotelId === null) return <div className="container mx-auto py-10">Invalid Hotel ID.</div>;

  return (
    <div className="container mx-auto py-10 max-w-3xl">
      <div className="mb-6 flex justify-start">
        <Button variant="outline" asChild>
          <Link href="/offline-hotels">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Hotels
          </Link>
        </Button>
      </div>
      <h1 className="text-3xl font-bold mb-6">Edit Offline Hotel (ID: {hotelId})</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

          <h2 className="text-xl font-semibold border-b pb-2">Hotel Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* ── WorldOTA hotel search ── */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-medium">Search Hotel (WorldOTA)</label>
              <Popover open={hotelSearchOpen} onOpenChange={setHotelSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" type="button" className="w-full justify-between font-normal">
                    {linkedHotel ? (
                      <span>{"★".repeat(linkedHotel.star_rating)} {linkedHotel.name}</span>
                    ) : (
                      <span className="text-muted-foreground">Type to search hotels from WorldOTA…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search by hotel name…"
                      value={hotelSearchQuery}
                      onValueChange={setHotelSearchQuery}
                    />
                    <CommandList>
                      {isSearchingHotels ? (
                        <CommandEmpty>Searching…</CommandEmpty>
                      ) : hotelSearchQuery.length < 2 ? (
                        <CommandEmpty>Type at least 2 characters.</CommandEmpty>
                      ) : hotelSearchResults.length === 0 ? (
                        <CommandEmpty>No hotels found.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {hotelSearchResults.map((h) => (
                            <CommandItem
                              key={h.hid}
                              value={String(h.hid)}
                              onSelect={() => {
                                setLinkedHotel(h);
                                form.setValue("hotel_name", h.name);
                                form.setValue("hid", h.hid as any);
                                // Extract city: "Street, City" → last part; "Street, PostalCode City, Country" → second-to-last
                                const parts = h.address.split(",").map(p => p.trim());
                                const cityRaw = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
                                const city = cityRaw.replace(/^\d{4,6}\s*[A-Z]{0,2}\s+/i, "").trim();
                                if (city) form.setValue("city", city);
                                setHotelSearchOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", linkedHotel?.hid === h.hid ? "opacity-100" : "opacity-0")} />
                              <div className="flex flex-col">
                                <span className="font-medium">{h.name}</span>
                                <span className="text-xs text-muted-foreground">{"★".repeat(h.star_rating)} · {h.address}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {linkedHotel && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Linked: hid <strong>{linkedHotel.hid}</strong></span>
                  <button
                    type="button"
                    className="text-red-500 hover:underline"
                    onClick={() => {
                      setLinkedHotel(null);
                      form.setValue("hid", "" as any);
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <FormField control={form.control} name="hotel_name" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Hotel Name</FormLabel>
                <FormControl><Input placeholder="e.g., Grand Hyatt Amsterdam" {...field} /></FormControl>
                <FormDescription>Auto-filled from search above — edit if needed.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl><Input placeholder="e.g., Amsterdam" {...field} /></FormControl>
                <FormDescription>Used to match relevant flights.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="room_type" render={({ field }) => (
              <FormItem>
                <FormLabel>Room Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select room type…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Standard">Standard</SelectItem>
                    <SelectItem value="Double">Double</SelectItem>
                    <SelectItem value="Twin">Twin</SelectItem>
                    <SelectItem value="Triple">Triple</SelectItem>
                    <SelectItem value="Deluxe">Deluxe</SelectItem>
                    <SelectItem value="Junior Suite">Junior Suite</SelectItem>
                    <SelectItem value="Suite">Suite</SelectItem>
                    <SelectItem value="Family Room">Family Room</SelectItem>
                    <SelectItem value="Studio">Studio</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="check_in" render={({ field }) => (
              <FormItem>
                <FormLabel>Check-in Date</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="check_out" render={({ field }) => (
              <FormItem>
                <FormLabel>Check-out Date</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="price" render={({ field }) => (
              <FormItem>
                <FormLabel>Price (USD)</FormLabel>
                <FormControl><Input type="number" step="1" placeholder="e.g., 250" {...field} /></FormControl>
                <FormDescription>Total per room for the stay.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="num_rooms" render={({ field }) => (
              <FormItem>
                <FormLabel>Number of Rooms</FormLabel>
                <FormControl><Input type="number" placeholder="e.g., 10" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="meal_plan" render={({ field }) => (
              <FormItem>
                <FormLabel>Meal Plan (optional)</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select meal plan…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    <SelectItem value="Room Only">Room Only</SelectItem>
                    <SelectItem value="Bed & Breakfast">Bed &amp; Breakfast</SelectItem>
                    <SelectItem value="Half Board">Half Board</SelectItem>
                    <SelectItem value="Full Board">Full Board</SelectItem>
                    <SelectItem value="All Inclusive">All Inclusive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="last_cancellation_date" render={({ field }) => (
              <FormItem>
                <FormLabel>Last Cancellation Date (optional)</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormDescription>Free cancellation deadline shown to customers. Leave blank if not applicable.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea placeholder="Any additional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <h2 className="text-xl font-semibold border-b pb-2">Link to Events (optional)</h2>
          <FormField control={form.control} name="event_ids" render={({ field }) => (
            <FormItem>
              <FormLabel>Linked Events</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" type="button" className="w-full justify-between">
                    {(field.value as number[]).length === 0 ? "Select events..." : `${(field.value as number[]).length} event(s) selected`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search events..." />
                    <CommandList>
                      {isLoadingEvents ? (
                        <CommandEmpty>Loading events...</CommandEmpty>
                      ) : relevantEvents.length === 0 ? (
                        <CommandEmpty>{checkIn && checkOut ? "No events found in this date range." : "Fill in check-in and check-out dates first."}</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {relevantEvents.map((event) => (
                            <CommandItem key={event.id} onSelect={() => {
                              const current = field.value as number[];
                              field.onChange(current.includes(event.id) ? current.filter((id) => id !== event.id) : [...current, event.id]);
                            }}>
                              <Check className={cn("mr-2 h-4 w-4", (field.value as number[]).includes(event.id) ? "opacity-100" : "opacity-0")} />
                              {event.name}
                              <span className="ml-auto text-xs text-muted-foreground">{event.date}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )} />

          <h2 className="text-xl font-semibold border-b pb-2">Link to Flights (optional)</h2>
          <FormField control={form.control} name="flight_ids" render={({ field }) => (
            <FormItem>
              <FormLabel>Linked Flights</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" type="button" className="w-full justify-between">
                    {(field.value as number[]).length === 0 ? "Select flights..." : `${(field.value as number[]).length} flight(s) selected`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search flights..." />
                    <CommandList>
                      {isLoadingFlights ? (
                        <CommandEmpty>Loading flights...</CommandEmpty>
                      ) : relevantFlights.length === 0 ? (
                        <CommandEmpty>{checkIn && checkOut ? "No matching flights found." : "Fill in check-in and check-out dates first."}</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          {relevantFlights.map((flight: any) => (
                            <CommandItem key={flight.id} onSelect={() => {
                              const current = field.value as number[];
                              field.onChange(current.includes(flight.id) ? current.filter((id) => id !== flight.id) : [...current, flight.id]);
                            }}>
                              <Check className={cn("mr-2 h-4 w-4", (field.value as number[]).includes(flight.id) ? "opacity-100" : "opacity-0")} />
                              {flight.metadata_name} ({flight.airline_code}) · {flight.outbound_departure_airport} → {flight.outbound_arrival_airport}
                              <span className="ml-auto text-xs text-muted-foreground">{flight.outbound_departure_time?.slice(0, 10)}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )} />

          <Button type="submit" disabled={isPending || isLoadingHotel} className="mt-8">
            {isPending ? "Updating..." : "Update Hotel"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
