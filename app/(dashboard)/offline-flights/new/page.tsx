"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z, ZodErrorMap, ZodIssueCode } from "zod";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { toast } from "react-hot-toast";

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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  createOfflineFlight,
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
import React from "react";

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

    const newMessage = `Validation failed for '${fieldPath}'. The value "${valueAttemptedForFinalValidation}" (derived from picker input "${originalPickerValue}") must be a valid date and time. Expected format YYYY-MM-DDTHH:mm:00.`;
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
    return { message: newMessage };
  }

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

  // Outbound
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

  // Inbound
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

  // Metadata
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

export default function NewOfflineFlightPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    airlineName: string;
    airlineLogo: string;
    icaoCode?: string;
  } | null>(null);
  const [isValidated, setIsValidated] = useState(false);
  const [relevantEvents, setRelevantEvents] = useState<
    { id: number; name: string; date: string }[]
  >([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  const form = useForm<OfflineFlightFormData>({
    resolver: zodResolver(offlineFlightFormSchema, {
      errorMap: customErrorMap,
    }),
    defaultValues: {
      initial_quantity: 10,
      price: 100.0,
      stops: 0,
      outbound_check_bags_included: false,
      outbound_cabin_bags_included: true,
      inbound_check_bags_included: false,
      inbound_cabin_bags_included: true,
      duration: "PT8H0M",
      airline_code: "LY",
      outbound_departure_time: new Date().toISOString().slice(0, 16),
      outbound_departure_airport: "TLV",
      outbound_arrival_airport: "BER",
      outbound_arrival_time: new Date(Date.now() + 4 * 3600 * 1000)
        .toISOString()
        .slice(0, 16),
      outbound_duration: "PT4H25M",
      outbound_flight_number: "LY123",
      inbound_departure_time: new Date(Date.now() + 72 * 3600 * 1000)
        .toISOString()
        .slice(0, 16),
      inbound_departure_airport: "BER",
      inbound_arrival_airport: "TLV",
      inbound_arrival_time: new Date(Date.now() + 76 * 3600 * 1000)
        .toISOString()
        .slice(0, 16),
      inbound_duration: "PT4H25M",
      inbound_flight_number: "LY124",
      metadata_iata: "XX",
      metadata_name: "Example Airline",
      metadata_logo: "https://example.com/logo.png",
      event_ids: [],
    },
  });

  // Watch airline_code field to reset validation when it changes
  const airlineCodeValue = form.watch("airline_code");
  const destinationIata = form.watch("outbound_arrival_airport");
  const departureTime = form.watch("outbound_departure_time");
  const returnTime = form.watch("inbound_arrival_time");
  const outboundArrivalTime = form.watch("outbound_arrival_time");
  const inboundDepartureTime = form.watch("inbound_departure_time");

  // Reset validation when airline code changes
  React.useEffect(() => {
    setIsValidated(false);
    setValidationResult(null);
  }, [airlineCodeValue]);

  // Clear downstream times when an earlier time changes to be later
  React.useEffect(() => {
    if (!departureTime) return;
    if (outboundArrivalTime && outboundArrivalTime < departureTime) {
      form.setValue("outbound_arrival_time", "");
    }
    if (inboundDepartureTime && inboundDepartureTime < departureTime) {
      form.setValue("inbound_departure_time", "");
      form.setValue("inbound_arrival_time", "");
    }
  }, [departureTime]);

  React.useEffect(() => {
    if (!inboundDepartureTime) return;
    if (returnTime && returnTime < inboundDepartureTime) {
      form.setValue("inbound_arrival_time", "");
    }
  }, [inboundDepartureTime]);

  // Auto-calculate outbound duration from departure/arrival times
  React.useEffect(() => {
    if (!departureTime || !outboundArrivalTime) return;
    const calculated = calcIsoDuration(departureTime, outboundArrivalTime);
    if (calculated) form.setValue("outbound_duration", calculated, { shouldValidate: true });
  }, [departureTime, outboundArrivalTime]);

  // Auto-calculate inbound duration from departure/arrival times
  React.useEffect(() => {
    if (!inboundDepartureTime || !returnTime) return;
    const calculated = calcIsoDuration(inboundDepartureTime, returnTime);
    if (calculated) form.setValue("inbound_duration", calculated, { shouldValidate: true });
  }, [inboundDepartureTime, returnTime]);

  // Auto-calculate total duration as sum of outbound + inbound
  const outboundDuration = form.watch("outbound_duration");
  const inboundDuration = form.watch("inbound_duration");
  React.useEffect(() => {
    if (!outboundDuration || !inboundDuration) return;
    const total = sumIsoDurations(outboundDuration, inboundDuration);
    if (total) form.setValue("duration", total, { shouldValidate: true });
  }, [outboundDuration, inboundDuration]);

  // Fetch relevant events when destination + dates are filled in
  React.useEffect(() => {
    if (
      !iataCodePattern.test(destinationIata) ||
      !departureTime ||
      !returnTime
    ) {
      setRelevantEvents([]);
      return;
    }

    const departureDate = departureTime.slice(0, 10);
    const returnDate = returnTime.slice(0, 10);

    let cancelled = false;
    setIsLoadingEvents(true);

    getRelevantEventsForFlight(destinationIata, departureDate, returnDate)
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
  }, [destinationIata, departureTime, returnTime]);

  const validateAirlineCode = async () => {
    const airlineCode = form.getValues("airline_code");

    if (!airlineCode) {
      toast.error("Please enter an airline code first");
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const response = await fetch("/api/validate-airline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ airlineCode }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Found: ${data.airlineName}`);
        setValidationResult({
          airlineName: data.airlineName,
          airlineLogo: data.airlineLogo,
          icaoCode: data.icaoCode,
        });
        setIsValidated(true);

        // Auto-fill metadata fields
        form.setValue("metadata_iata", airlineCode);
        form.setValue("metadata_name", data.airlineName);
        form.setValue("metadata_logo", data.airlineLogo);
      } else {
        toast.error(data.error || "Validation failed");
        setValidationResult(null);
        setIsValidated(false);
      }
    } catch (error) {
      console.error("Validation error:", error);
      toast.error("Failed to validate airline code");
      setValidationResult(null);
      setIsValidated(false);
    } finally {
      setIsValidating(false);
    }
  };

  async function onSubmit(values: OfflineFlightFormData) {
    startTransition(async () => {
      try {
        const flightDataToSave: Omit<
          OfflineFlight,
          "id" | "consumed_quantity" | "is_deleted"
        > = values;
        await createOfflineFlight(flightDataToSave);
        toast.success("Offline flight created successfully!");
        router.push("/offline-flights");
        router.refresh();
      } catch (error) {
        console.error(
          "Failed to create offline flight (onSubmit error):",
          error
        );
        toast.error(
          (error as Error)?.message ||
            "Failed to create offline flight. Check console for details."
        );
      }
    });
  }

  // Add this for debugging
  console.log("isValidated:", isValidated, "isPending:", isPending);

  return (
    <TooltipProvider>
      <div className="container mx-auto py-10 max-w-3xl">
        <h1 className="text-3xl font-bold mb-6">Add New Offline Flight</h1>
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
                    <div className="flex gap-2">
                      <FormControl>
                        <Input placeholder="e.g., LO, LH" {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={validateAirlineCode}
                        disabled={isValidating || isValidated}
                      >
                        {isValidating
                          ? "Validating..."
                          : isValidated
                          ? "Validated"
                          : "Validate"}
                      </Button>
                    </div>
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
                        step="1"
                        placeholder="e.g., 438.76"
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
                      <Input placeholder="e.g., PT4H30M" {...field} />
                    </FormControl>
                    <FormDescription>
                      Auto-calculated from outbound + inbound durations.
                    </FormDescription>
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
                      <Input type="datetime-local" min={departureTime || undefined} {...field} />
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
                      <Input type="datetime-local" min={departureTime || undefined} {...field} />
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
                      <Input type="datetime-local" min={inboundDepartureTime || undefined} {...field} />
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
                      {/* Display as text instead of Input */}
                      <div className="pt-2 text-sm font-medium text-gray-700 dark:text-gray-300 min-h-[40px] flex items-center px-3 py-2 border border-transparent rounded-md">
                        {field.value || "-"}
                      </div>
                    </FormControl>
                    <FormDescription>
                      Auto-filled from Airline Code validation.
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
                      {/* Display as text instead of Input */}
                      <div className="pt-2 text-sm font-medium text-gray-700 dark:text-gray-300 min-h-[40px] flex items-center px-3 py-2 border border-transparent rounded-md">
                        {field.value || "-"}
                      </div>
                    </FormControl>
                    <FormDescription>
                      Auto-filled from validation.
                    </FormDescription>
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
                      {/* Display as link or text instead of Input */}
                      {field.value ? (
                        <a
                          href={field.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pt-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400 min-h-[40px] flex items-center px-3 py-2 border border-transparent rounded-md"
                        >
                          {field.value}
                        </a>
                      ) : (
                        <div className="pt-2 text-sm font-medium text-gray-700 dark:text-gray-300 min-h-[40px] flex items-center px-3 py-2 border border-transparent rounded-md">
                          -
                        </div>
                      )}
                    </FormControl>
                    <FormDescription>
                      Auto-filled from validation.
                    </FormDescription>
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

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="inline-block">
                  <Button
                    type="submit"
                    disabled={isPending || !isValidated}
                    className="mt-8"
                    variant={
                      isPending || !isValidated ? "secondary" : "default"
                    }
                  >
                    {isPending ? "Creating..." : "Create Flight"}
                  </Button>
                </div>
              </TooltipTrigger>
              {!isValidated && !isPending && (
                <TooltipContent>
                  <p>Please validate the airline code first</p>
                </TooltipContent>
              )}
            </Tooltip>
          </form>
        </Form>
      </div>
    </TooltipProvider>
  );
}
