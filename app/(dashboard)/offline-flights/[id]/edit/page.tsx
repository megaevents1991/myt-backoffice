"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z, ZodErrorMap, ZodIssueCode } from "zod";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, use } from "react";
import { toast } from "react-hot-toast";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { StickySaveBar } from "@/components/sticky-save-bar";
import {
  getOfflineFlight,
  updateOfflineFlight,
  getRelevantEventsForFlight,
} from "@/lib/actions/offline-flight-actions";
import { OfflineFlight } from "@/types/offline-flight.types";
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
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

function calcIsoDuration(departure: string, arrival: string): string {
  const dep = new Date(departure);
  const arr = new Date(arrival);
  const diffMs = arr.getTime() - dep.getTime();
  if (isNaN(diffMs) || diffMs <= 0) return "";
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `PT${hours}H${minutes}M`;
  if (hours > 0) return `PT${hours}H`;
  return `PT${minutes}M`;
}

function sumIsoDurations(a: string, b: string): string {
  const parseMinutes = (iso: string) => {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!m) return 0;
    return (parseInt(m[1] || "0") * 60) + parseInt(m[2] || "0");
  };
  const total = parseMinutes(a) + parseMinutes(b);
  if (total <= 0) return "";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) return `PT${hours}H${minutes}M`;
  if (hours > 0) return `PT${hours}H`;
  return `PT${minutes}M`;
}

// Helper function for custom error map
const getValueByPath = (obj: any, path: (string | number)[]): any => {
  let current = obj;
  for (const segment of path) {
    if (current && typeof current === "object" && segment in current) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
};

// customErrorMap - (implementation as before)
const customErrorMap: ZodErrorMap = (issue, ctx) => {
  const fieldPath = issue.path.join(".");
  if (
    issue.code === ZodIssueCode.invalid_string &&
    issue.validation === "datetime" &&
    issue.message ===
      "Final datetime must be YYYY-MM-DDTHH:mm:00 (local, no offset)."
  ) {
    const originalPickerValue = getValueByPath(ctx.data, issue.path);
    let valueAttemptedForFinalValidation =
      "(unknown, original picker value was likely invalid or not a string)";
    if (typeof originalPickerValue === "string") {
      valueAttemptedForFinalValidation = `${originalPickerValue}:00`;
    } else if (originalPickerValue !== undefined) {
      valueAttemptedForFinalValidation = `${String(
        originalPickerValue
      )}:00 (original picker value was not a string: ${typeof originalPickerValue})`;
    }
    const newMessage = `Validation failed for '${fieldPath}'. The value "${valueAttemptedForFinalValidation}" (derived from picker input "${originalPickerValue}") must be a valid date and time in YYYY-MM-DDTHH:mm:00 format (local, no offset).`;
    // console.error removed for brevity, but can be kept for debugging
    return { message: newMessage };
  }
  if (
    issue.code === ZodIssueCode.invalid_string &&
    issue.validation === "regex" &&
    issue.message === "Date and time from picker should be YYYY-MM-DDTHH:mm."
  ) {
    const originalPickerValue = getValueByPath(ctx.data, issue.path);
    const receivedValueString =
      typeof originalPickerValue === "string"
        ? `"${originalPickerValue}"`
        : `(received ${typeof originalPickerValue}: ${String(
            originalPickerValue
          )})`;
    const newMessage = `Invalid format for '${fieldPath}' from date-time picker. Expected YYYY-MM-DDTHH:mm. Received: ${receivedValueString}.`;
    // console.error removed for brevity
    return { message: newMessage };
  }
  // console.error removed for brevity
  return { message: ctx.defaultError };
};

const isoDurationPattern = /^P(T(\d+H)?(\d+M)?(\d+S)?)?$/;
const iataCodePattern = /^[A-Z]{3}$/;
const airlineCodePattern = /^[A-Z0-9]{2,3}$/;
const flightNumberPattern = /^[A-Z0-9]{2,7}$/;
const dateTimeLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const dateTimeWithSecondsSchema = z
  .string()
  .regex(dateTimeLocalPattern, {
    message: "Date and time from picker should be YYYY-MM-DDTHH:mm.",
  })
  .transform((val) => `${val}:00`)
  .pipe(
    z.string().datetime({
      local: true,
      precision: 0,
      message: "Final datetime must be YYYY-MM-DDTHH:mm:00 (local, no offset).",
    })
  );

const offlineFlightFormSchema = z.object({
  initial_quantity: z.coerce
    .number()
    .int()
    .min(0, { message: "Initial quantity must be 0 or more." }),
  price: z.coerce
    .number()
    .positive({ message: "Price must be a positive number." }),
  duration: z
    .string()
    .regex(
      isoDurationPattern,
      "Invalid total duration (ISO 8601 format, e.g., PT4H5M)."
    )
    .min(1, "Total duration is required."),
  // Connecting flights are storable since the migration dropped the old
  // `stops = 0` constraint. Pinning this to a literal 0 made the form reject
  // every one of them.
  stops: z.coerce
    .number()
    .int()
    .min(0, { message: "Stops cannot be negative." })
    .max(3, { message: "More than 3 stops is almost certainly a typo." }),
  airline_code: z
    .string()
    .regex(
      airlineCodePattern,
      "Invalid airline code (2-3 uppercase letters/digits)."
    )
    .min(2)
    .max(3),

  outbound_departure_time: dateTimeWithSecondsSchema,
  outbound_departure_airport: z
    .string()
    .regex(
      iataCodePattern,
      "Invalid outbound departure IATA (3 uppercase letters)."
    )
    .length(3),
  outbound_arrival_airport: z
    .string()
    .regex(
      iataCodePattern,
      "Invalid outbound arrival IATA (3 uppercase letters)."
    )
    .length(3),
  outbound_arrival_time: dateTimeWithSecondsSchema,
  outbound_duration: z
    .string()
    .regex(isoDurationPattern, "Invalid outbound duration (ISO 8601 format).")
    .min(1, "Outbound duration is required."),
  outbound_check_bags_included: z.boolean().default(false),
  outbound_cabin_bags_included: z.boolean().default(true),
  outbound_flight_number: z
    .string()
    .regex(flightNumberPattern, "Invalid outbound flight number.")
    .min(3)
    .max(7),

  inbound_departure_time: dateTimeWithSecondsSchema,
  inbound_departure_airport: z
    .string()
    .regex(
      iataCodePattern,
      "Invalid inbound departure IATA (3 uppercase letters)."
    )
    .length(3),
  inbound_arrival_airport: z
    .string()
    .regex(
      iataCodePattern,
      "Invalid inbound arrival IATA (3 uppercase letters)."
    )
    .length(3),
  inbound_arrival_time: dateTimeWithSecondsSchema,
  inbound_duration: z
    .string()
    .regex(isoDurationPattern, "Invalid inbound duration (ISO 8601 format).")
    .min(1, "Inbound duration is required."),
  inbound_check_bags_included: z.boolean().default(false),
  inbound_cabin_bags_included: z.boolean().default(true),
  inbound_flight_number: z
    .string()
    .regex(flightNumberPattern, "Invalid inbound flight number.")
    .min(3)
    .max(7),

  metadata_iata: z
    .string()
    .regex(
      airlineCodePattern,
      "Invalid metadata IATA code (2-3 letters/digits)."
    )
    .min(2)
    .max(3),
  metadata_name: z.string().min(1, "Airline name is required."),
  metadata_logo: z.string().url({ message: "Invalid metadata logo URL." }),

  // Relationships
  event_ids: z.array(z.number().int()).default([]),
});

type OfflineFlightFormData = z.infer<typeof offlineFlightFormSchema>;

interface EditOfflineFlightPageProps {
  params: Promise<{
    id: string; // Next.js params are now a Promise
  }>;
}

export default function EditOfflineFlightPage({
  params,
}: EditOfflineFlightPageProps) {
  const router = useRouter();
  const resolvedParams = use(params); // Unwrap the Promise
  const flightIdParam = resolvedParams.id; // Now access the id property
  const [isPending, startTransition] = useTransition();
  const [isLoadingFlight, setIsLoadingFlight] = useState(true);
  const [flightId, setFlightId] = useState<number | null>(null); // Store parsed ID
  const [relevantEvents, setRelevantEvents] = useState<
    { id: number; name: string; date: string }[]
  >([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  const form = useForm<OfflineFlightFormData>({
    resolver: zodResolver(offlineFlightFormSchema, {
      errorMap: customErrorMap,
    }),
  });

  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (!flightIdParam) return;

    const parsedId = parseInt(flightIdParam, 10);
    if (isNaN(parsedId)) {
      toast.error("Invalid flight ID format.");
      router.push("/offline-flights");
      setIsLoadingFlight(false);
      return;
    }
    setFlightId(parsedId); // Store the parsed ID

    setIsLoadingFlight(true);
    getOfflineFlight(parsedId) // Use parsed ID
      .then((flight) => {
        if (flight) {
          const formatForDateTimeLocalInput = (
            dateTimeString: string | null | undefined
          ) => {
            if (!dateTimeString) return "";
            try {
              // Ensure it's a valid date string before slicing
              new Date(dateTimeString).toISOString();
              return dateTimeString.slice(0, 16);
            } catch (e) {
              console.warn(
                `Invalid date string encountered for formatting: ${dateTimeString}`
              );
              return "";
            }
          };

          // Destructure to remove fields not in form; flight.id is now number
          const { id, consumed_quantity, is_deleted, ...restOfFlightData } =
            flight;

          // Convert HH:MM:SS durations to ISO 8601 PT format if needed
          const toIsoDuration = (val: string | undefined | null): string => {
            if (!val) return "";
            if (val.startsWith("PT")) return val; // already ISO
            const parts = val.split(":").map(Number);
            if (parts.length >= 2) {
              const h = parts[0] || 0;
              const m = parts[1] || 0;
              return `PT${h}H${m}M`;
            }
            return val;
          };

          form.reset({
            ...restOfFlightData,
            duration: toIsoDuration(flight.duration),
            outbound_duration: toIsoDuration(flight.outbound_duration),
            inbound_duration: toIsoDuration(flight.inbound_duration),
            price: Number(flight.price),
            // Load the flight's real value — hardcoding 0 here silently turned
            // every connecting flight back into a direct one on save.
            stops: Number(flight.stops) || 0,
            outbound_departure_time: formatForDateTimeLocalInput(
              flight.outbound_departure_time
            ),
            outbound_arrival_time: formatForDateTimeLocalInput(
              flight.outbound_arrival_time
            ),
            inbound_departure_time: formatForDateTimeLocalInput(
              flight.inbound_departure_time
            ),
            inbound_arrival_time: formatForDateTimeLocalInput(
              flight.inbound_arrival_time
            ),
            event_ids: flight.event_ids ?? [],
          });
        } else {
          toast.error("Flight not found.");
          router.push("/offline-flights");
        }
      })
      .catch((error) => {
        console.error("Failed to fetch flight for editing:", error);
        toast.error("Failed to load flight data.");
      })
      .finally(() => {
        setIsLoadingFlight(false);
      });
  }, [flightIdParam, form, router]);

  // Watch destination + dates to fetch relevant events
  const destinationIata = form.watch("outbound_arrival_airport");
  const departureTime = form.watch("outbound_departure_time");
  const returnTime = form.watch("inbound_arrival_time");
  const outboundArrivalTime = form.watch("outbound_arrival_time");
  const inboundDepartureTime = form.watch("inbound_departure_time");
  const outboundDuration = form.watch("outbound_duration");
  const inboundDuration = form.watch("inbound_duration");

  // Auto-calculate outbound duration
  useEffect(() => {
    if (!departureTime || !outboundArrivalTime) return;
    const calculated = calcIsoDuration(departureTime, outboundArrivalTime);
    if (calculated) form.setValue("outbound_duration", calculated, { shouldValidate: true });
  }, [departureTime, outboundArrivalTime]);

  // Auto-calculate inbound duration
  useEffect(() => {
    if (!inboundDepartureTime || !returnTime) return;
    const calculated = calcIsoDuration(inboundDepartureTime, returnTime);
    if (calculated) form.setValue("inbound_duration", calculated, { shouldValidate: true });
  }, [inboundDepartureTime, returnTime]);

  // Auto-calculate total duration as sum of outbound + inbound
  useEffect(() => {
    if (!outboundDuration || !inboundDuration) return;
    const total = sumIsoDurations(outboundDuration, inboundDuration);
    if (total) form.setValue("duration", total, { shouldValidate: true });
  }, [outboundDuration, inboundDuration]);

  useEffect(() => {
    if (
      !iataCodePattern.test(destinationIata) ||
      !departureTime ||
      !inboundDepartureTime
    ) {
      setRelevantEvents([]);
      return;
    }

    const departureDate = departureTime.slice(0, 10);
    const returnDepartureDate = inboundDepartureTime.slice(0, 10);

    let cancelled = false;
    setIsLoadingEvents(true);

    getRelevantEventsForFlight(destinationIata, departureDate, returnDepartureDate)
      .then((events) => {
        if (!cancelled) setRelevantEvents(events as { id: number; name: string; date: string }[]);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoadingEvents(false);
      });

    return () => {
      cancelled = true;
    };
  }, [destinationIata, departureTime, inboundDepartureTime]);

  async function onSubmit(values: OfflineFlightFormData) {
    if (flightId === null) {
      toast.error("Flight ID is missing. Cannot update.");
      return;
    }
    // console.log for values can be removed or kept
    startTransition(async () => {
      try {
        const dataToUpdate = values;
        await updateOfflineFlight(
          flightId, // Use the stored parsed number ID
          dataToUpdate as Partial<
            Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">
          >
        );
        toast.success("Offline flight updated successfully!");
        router.push("/offline-flights");
        router.refresh();
      } catch (error) {
        console.error("Failed to update offline flight:", error);
        toast.error(
          (error as Error)?.message || "Failed to update offline flight."
        );
      }
    });
  }

  if (isLoadingFlight) {
    return (
      <div className="container mx-auto py-10">Loading flight data...</div>
    );
  }
  if (flightId === null && !isLoadingFlight) {
    // Handle case where ID parsing failed earlier
    return <div className="container mx-auto py-10">Invalid Flight ID.</div>;
  }

  return (
    <div className="container mx-auto py-10 pb-28 max-w-3xl">
      <div className="mb-6 flex justify-start">
        <Button variant="outline" asChild>
          <Link href="/offline-flights">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Flights
          </Link>
        </Button>
      </div>

      <h1 className="text-3xl font-bold mb-6">
        Edit Offline Flight (ID: {flightId}) {/* Display parsed ID */}
      </h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <h2 className="text-xl font-semibold border-b pb-2">
            General Flight Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="airline_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Airline Code (IATA)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., LO, LH" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price (USD)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01" // Corrected step for price
                      placeholder="e.g., 838.76"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="initial_quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Quantity</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="e.g., 20" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="duration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Total Duration (ISO 8601)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., PT8H30M" {...field} />
                  </FormControl>
                  <FormDescription>Auto-calculated from outbound + inbound durations.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stops"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stops</FormLabel>
                  <FormControl>
                    <Input type="number" min={0} max={3} {...field} />
                  </FormControl>
                  <FormDescription>
                    0 for a direct flight. For a connecting flight set 1, then add
                    the stopover airport and layover from the flights list (click
                    the row id to open it) — otherwise it is sold as direct.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <h2 className="text-xl font-semibold border-b pb-2 mt-6">
            Outbound Flight
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="outbound_flight_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outbound Flight Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., LO152" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_departure_airport"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outbound Departure Airport (IATA)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., TLV" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_departure_time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outbound Departure Time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_arrival_airport"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outbound Arrival Airport (IATA)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., WAW" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_arrival_time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outbound Arrival Time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_duration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outbound Duration (ISO 8601)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., PT4H30M" {...field} />
                  </FormControl>
                  <FormDescription>Auto-calculated from departure/arrival times.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_cabin_bags_included"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Outbound Cabin Bags Included</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="outbound_check_bags_included"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Outbound Check Bags Included</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <h2 className="text-xl font-semibold border-b pb-2 mt-6">
            Inbound Flight
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="inbound_flight_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inbound Flight Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., LO151" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_departure_airport"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inbound Departure Airport (IATA)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., WAW" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_departure_time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inbound Departure Time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_arrival_airport"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inbound Arrival Airport (IATA)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., TLV" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_arrival_time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inbound Arrival Time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_duration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inbound Duration (ISO 8601)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., PT4H30M" {...field} />
                  </FormControl>
                  <FormDescription>Auto-calculated from departure/arrival times.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_cabin_bags_included"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Inbound Cabin Bags Included</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="inbound_check_bags_included"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Inbound Check Bags Included</FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <h2 className="text-xl font-semibold border-b pb-2 mt-6">
            Airline Metadata
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="metadata_iata"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Metadata Airline IATA</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., LO" {...field} />
                  </FormControl>
                  <FormDescription>
                    Usually same as Airline Code.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="metadata_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Metadata Airline Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., LOT POLISH AIRLINES" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="metadata_logo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Metadata Airline Logo URL</FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://example.com/logo.png"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <h2 className="text-xl font-semibold border-b pb-2 mt-6">
            Link to Events (optional)
          </h2>
          <FormField
            control={form.control}
            name="event_ids"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Linked Events</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      type="button"
                      className="w-full justify-between"
                    >
                      {(field.value as number[]).length === 0
                        ? "Select events..."
                        : `${(field.value as number[]).length} event(s) selected`}
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
                          <CommandEmpty>
                            {iataCodePattern.test(destinationIata) && departureTime && returnTime
                              ? "No matching events found."
                              : "Fill in destination airport and dates to see matching events."}
                          </CommandEmpty>
                        ) : (
                          <CommandGroup>
                            {relevantEvents.map((event) => (
                              <CommandItem
                                key={event.id}
                                onSelect={() => {
                                  const current = field.value as number[];
                                  const next = current.includes(event.id)
                                    ? current.filter((id) => id !== event.id)
                                    : [...current, event.id];
                                  field.onChange(next);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    (field.value as number[]).includes(event.id)
                                      ? "opacity-100"
                                      : "opacity-0"
                                  )}
                                />
                                {event.name}
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {event.date}
                                </span>
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
            )}
          />

          <Button
            type="submit"
            disabled={isPending || isLoadingFlight}
            className="mt-8"
          >
            {isPending ? "Updating..." : "Update Flight"}
          </Button>
        </form>
      </Form>

      <StickySaveBar
        isDirty={isDirty}
        isSaving={isPending}
        onSave={form.handleSubmit(onSubmit)}
        onDiscard={() => form.reset()}
        saveLabel="Update Flight"
        savingLabel="Updating..."
      />
    </div>
  );
}
