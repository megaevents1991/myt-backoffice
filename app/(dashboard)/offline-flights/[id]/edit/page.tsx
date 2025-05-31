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

import {
  getOfflineFlight,
  updateOfflineFlight,
} from "@/lib/actions/offline-flight-actions";
import { OfflineFlight } from "@/types/offline-flight.types";

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
    .positive({ message: "Initial quantity must be a positive integer." }),
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
  stops: z.literal(0, {
    errorMap: () => ({ message: "Stops must be 0 for direct flights." }),
  }),
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

  const form = useForm<OfflineFlightFormData>({
    resolver: zodResolver(offlineFlightFormSchema, {
      errorMap: customErrorMap,
    }),
  });

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

          form.reset({
            ...restOfFlightData,
            price: Number(flight.price),
            stops: 0 as const,
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
    <div className="container mx-auto py-10 max-w-3xl">
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
                  <FormDescription>Total round trip duration.</FormDescription>
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
                    <Input type="number" readOnly {...field} />
                  </FormControl>
                  <FormDescription>
                    Must be 0 for direct flights.
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
                    <Input placeholder="e.g., PT4H5M" {...field} />
                  </FormControl>
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
                    <Input placeholder="e.g., PT3H50M" {...field} />
                  </FormControl>
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
          <Button
            type="submit"
            disabled={isPending || isLoadingFlight}
            className="mt-8"
          >
            {isPending ? "Updating..." : "Update Flight"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
