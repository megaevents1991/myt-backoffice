"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useTransition } from "react";
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

import { createOfflineFlight } from "@/lib/actions/offline-flight-actions";
import type { OfflineFlight } from "@/types/offline-flight.types";

const isoDurationPattern = /^P(T(\d+H)?(\d+M)?(\d+S)?)?$/;
const iataCodePattern = /^[A-Z]{3}$/;
const airlineCodePattern = /^[A-Z0-9]{2,3}$/;
const flightNumberPattern = /^[A-Z0-9]{2,7}$/;
const dateTimeLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const dateTimeWithSecondsSchema = z
  .string()
  .regex(dateTimeLocalPattern, { message: "Expected format YYYY-MM-DDTHH:mm." })
  .transform((val) => `${val}:00`)
  .pipe(
    z.string().datetime({ local: true, precision: 0, message: "Must be a valid date/time." })
  );

export const inlineFlightSchema = z.object({
  airline_code: z
    .string()
    .regex(airlineCodePattern, "Invalid airline code (2-3 uppercase letters/digits).")
    .min(2)
    .max(3),
  price: z.coerce.number().positive({ message: "Price must be positive." }),
  initial_quantity: z.coerce
    .number()
    .int()
    .positive({ message: "Quantity must be a positive integer." }),
  duration: z
    .string()
    .regex(isoDurationPattern, "Invalid total duration (ISO 8601, e.g. PT8H30M).")
    .min(1, "Total duration is required."),
  // See the note in the flight form schemas — connecting flights are valid.
  stops: z.coerce.number().int().min(0).max(3),

  outbound_departure_airport: z
    .string()
    .regex(iataCodePattern, "Invalid IATA (3 uppercase letters).")
    .length(3),
  outbound_arrival_airport: z
    .string()
    .regex(iataCodePattern, "Invalid IATA (3 uppercase letters).")
    .length(3),
  outbound_departure_time: dateTimeWithSecondsSchema,
  outbound_arrival_time: dateTimeWithSecondsSchema,
  outbound_flight_number: z
    .string()
    .regex(flightNumberPattern, "Invalid flight number.")
    .min(3)
    .max(7),
  outbound_duration: z.string().regex(isoDurationPattern, "Invalid outbound duration.").min(1),
  outbound_check_bags_included: z.boolean().default(false),
  outbound_cabin_bags_included: z.boolean().default(true),

  inbound_departure_airport: z
    .string()
    .regex(iataCodePattern, "Invalid IATA (3 uppercase letters).")
    .length(3),
  inbound_arrival_airport: z
    .string()
    .regex(iataCodePattern, "Invalid IATA (3 uppercase letters).")
    .length(3),
  inbound_departure_time: dateTimeWithSecondsSchema,
  inbound_arrival_time: dateTimeWithSecondsSchema,
  inbound_flight_number: z
    .string()
    .regex(flightNumberPattern, "Invalid flight number.")
    .min(3)
    .max(7),
  inbound_duration: z.string().regex(isoDurationPattern, "Invalid inbound duration.").min(1),
  inbound_check_bags_included: z.boolean().default(false),
  inbound_cabin_bags_included: z.boolean().default(true),

  metadata_iata: z.string().regex(airlineCodePattern, "Invalid metadata IATA.").min(2).max(3),
  metadata_name: z.string().min(1, "Airline name is required."),
  metadata_logo: z.string().url({ message: "Invalid logo URL." }),
});

export type InlineFlightFormData = z.infer<typeof inlineFlightSchema>;

// The shape createOfflineFlight expects (event_ids added by caller)
export type StagedFlightData = Omit<OfflineFlight, "id" | "consumed_quantity" | "is_deleted">;

interface InlineFlightFormProps {
  /** Present when adding to an existing saved event — flight is created immediately. */
  eventId?: number;
  /** Present when adding during new event creation — flight data is staged, not yet saved. */
  onStage?: (data: StagedFlightData) => void;
  /** Called after the flight is created in the DB (existing event mode only). */
  onCreated?: (flight: OfflineFlight) => void;
  onCancel: () => void;
  defaultDestinationIata?: string;
  defaultDepartureDate?: string;
  defaultReturnDate?: string;
}

export function InlineFlightForm({
  eventId,
  onStage,
  onCreated,
  onCancel,
  defaultDestinationIata,
  defaultDepartureDate,
  defaultReturnDate,
}: InlineFlightFormProps) {
  const [isPending, startTransition] = useTransition();
  const [isValidating, setIsValidating] = useState(false);
  const [isValidated, setIsValidated] = useState(false);
  const [metadataName, setMetadataName] = useState("");

  const dest = defaultDestinationIata || "TLV";
  const departPrefix = defaultDepartureDate?.slice(0, 10) ??
    new Date().toISOString().slice(0, 10);
  const returnPrefix = defaultReturnDate?.slice(0, 10) ??
    new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const form = useForm<InlineFlightFormData>({
    resolver: zodResolver(inlineFlightSchema),
    defaultValues: {
      airline_code: "LY",
      price: 100,
      initial_quantity: 10,
      duration: "PT8H0M",
      stops: 0,
      outbound_departure_airport: "TLV",
      outbound_arrival_airport: dest,
      outbound_departure_time: `${departPrefix}T10:00`,
      outbound_arrival_time: `${departPrefix}T14:00`,
      outbound_flight_number: "LY123",
      outbound_duration: "PT4H0M",
      outbound_check_bags_included: false,
      outbound_cabin_bags_included: true,
      inbound_departure_airport: dest,
      inbound_arrival_airport: "TLV",
      inbound_departure_time: `${returnPrefix}T15:00`,
      inbound_arrival_time: `${returnPrefix}T19:00`,
      inbound_flight_number: "LY124",
      inbound_duration: "PT4H0M",
      inbound_check_bags_included: false,
      inbound_cabin_bags_included: true,
      metadata_iata: "LY",
      metadata_name: "",
      metadata_logo: "https://example.com/logo.png",
    },
  });

  const airlineCode = form.watch("airline_code");
  const outboundDepartureTime = form.watch("outbound_departure_time");
  const inboundDepartureTime = form.watch("inbound_departure_time");
  const outboundArrivalTime = form.watch("outbound_arrival_time");
  const inboundArrivalTime = form.watch("inbound_arrival_time");

  // Clear downstream times when an earlier time changes to be later
  React.useEffect(() => {
    if (!outboundDepartureTime) return;
    if (outboundArrivalTime && outboundArrivalTime < outboundDepartureTime) {
      form.setValue("outbound_arrival_time", "");
    }
    if (inboundDepartureTime && inboundDepartureTime < outboundDepartureTime) {
      form.setValue("inbound_departure_time", "");
      form.setValue("inbound_arrival_time", "");
    }
  }, [outboundDepartureTime]);

  React.useEffect(() => {
    if (!inboundDepartureTime) return;
    if (inboundArrivalTime && inboundArrivalTime < inboundDepartureTime) {
      form.setValue("inbound_arrival_time", "");
    }
  }, [inboundDepartureTime]);

  const validateAirlineCode = async () => {
    if (!airlineCode) { toast.error("Enter an airline code first"); return; }
    setIsValidating(true);
    try {
      const res = await fetch("/api/validate-airline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airlineCode }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Found: ${data.airlineName}`);
        setMetadataName(data.airlineName);
        setIsValidated(true);
        form.setValue("metadata_iata", airlineCode);
        form.setValue("metadata_name", data.airlineName);
        form.setValue("metadata_logo", data.airlineLogo);
      } else {
        toast.error(data.error || "Validation failed");
        setIsValidated(false);
      }
    } catch {
      toast.error("Failed to validate airline code");
      setIsValidated(false);
    } finally {
      setIsValidating(false);
    }
  };

  async function onSubmit(values: InlineFlightFormData) {
    // Stage mode: new event hasn't been saved yet
    if (onStage) {
      onStage({ ...values, event_ids: [] });
      toast.success("Flight staged — will be saved with the event.");
      return;
    }

    // Immediate mode: existing event
    if (!eventId || !onCreated) return;
    startTransition(async () => {
      try {
        const flight = await createOfflineFlight({ ...values, event_ids: [eventId] });
        toast.success("Flight added and linked to event!");
        onCreated(flight);
      } catch (error) {
        toast.error((error as Error)?.message || "Failed to create flight.");
      }
    });
  }

  return (
    <div className="rounded-md border p-4 mt-2">
      <Form {...form}>
        <div className="space-y-6">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            New Offline Flight
            {onStage && (
              <span className="ml-2 text-xs font-normal normal-case text-amber-600">
                Will be created when you save the event
              </span>
            )}
          </p>

          {/* General */}
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="airline_code"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Airline Code (IATA)</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="e.g., LY"
                        {...field}
                        onChange={(e) => { field.onChange(e); setIsValidated(false); }}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={validateAirlineCode}
                      disabled={isValidating || isValidated}
                    >
                      {isValidating ? "..." : isValidated ? "Validated ✓" : "Validate"}
                    </Button>
                  </div>
                  {isValidated && (
                    <p className="text-xs text-muted-foreground">{metadataName} — metadata auto-filled</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="price" render={({ field }) => (
              <FormItem>
                <FormLabel>Price (USD)</FormLabel>
                <FormControl><Input type="number" step="1" placeholder="450" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="initial_quantity" render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity</FormLabel>
                <FormControl><Input type="number" placeholder="20" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="duration" render={({ field }) => (
              <FormItem>
                <FormLabel>Total Duration</FormLabel>
                <FormControl><Input placeholder="PT8H30M" {...field} /></FormControl>
                <FormDescription>ISO 8601 round trip</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          {/* Outbound */}
          <p className="text-sm font-medium border-b pb-1">Outbound Flight</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="outbound_departure_airport" render={({ field }) => (
              <FormItem><FormLabel>From (IATA)</FormLabel><FormControl><Input placeholder="TLV" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="outbound_arrival_airport" render={({ field }) => (
              <FormItem><FormLabel>To (IATA)</FormLabel><FormControl><Input placeholder={dest} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="outbound_departure_time" render={({ field }) => (
              <FormItem><FormLabel>Departure Time</FormLabel><FormControl><Input type="datetime-local" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="outbound_arrival_time" render={({ field }) => (
              <FormItem><FormLabel>Arrival Time</FormLabel><FormControl><Input type="datetime-local" min={outboundDepartureTime || undefined} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="outbound_flight_number" render={({ field }) => (
              <FormItem><FormLabel>Flight Number</FormLabel><FormControl><Input placeholder="LY123" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="outbound_duration" render={({ field }) => (
              <FormItem><FormLabel>Duration</FormLabel><FormControl><Input placeholder="PT4H0M" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="outbound_cabin_bags_included" render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 rounded-md border p-3">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="cursor-pointer">Cabin Bags</FormLabel>
              </FormItem>
            )} />
            <FormField control={form.control} name="outbound_check_bags_included" render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 rounded-md border p-3">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="cursor-pointer">Check Bags</FormLabel>
              </FormItem>
            )} />
          </div>

          {/* Inbound */}
          <p className="text-sm font-medium border-b pb-1">Inbound Flight</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="inbound_departure_airport" render={({ field }) => (
              <FormItem><FormLabel>From (IATA)</FormLabel><FormControl><Input placeholder={dest} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="inbound_arrival_airport" render={({ field }) => (
              <FormItem><FormLabel>To (IATA)</FormLabel><FormControl><Input placeholder="TLV" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="inbound_departure_time" render={({ field }) => (
              <FormItem><FormLabel>Departure Time</FormLabel><FormControl><Input type="datetime-local" min={outboundDepartureTime || undefined} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="inbound_arrival_time" render={({ field }) => (
              <FormItem><FormLabel>Arrival Time</FormLabel><FormControl><Input type="datetime-local" min={inboundDepartureTime || undefined} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="inbound_flight_number" render={({ field }) => (
              <FormItem><FormLabel>Flight Number</FormLabel><FormControl><Input placeholder="LY124" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="inbound_duration" render={({ field }) => (
              <FormItem><FormLabel>Duration</FormLabel><FormControl><Input placeholder="PT4H0M" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="inbound_cabin_bags_included" render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 rounded-md border p-3">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="cursor-pointer">Cabin Bags</FormLabel>
              </FormItem>
            )} />
            <FormField control={form.control} name="inbound_check_bags_included" render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 rounded-md border p-3">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="cursor-pointer">Check Bags</FormLabel>
              </FormItem>
            )} />
          </div>

          {/* Metadata hidden fields — auto-filled by validate */}
          <FormField control={form.control} name="metadata_iata" render={({ field }) => <input type="hidden" {...field} />} />
          <FormField control={form.control} name="metadata_name" render={({ field }) => <input type="hidden" {...field} />} />
          <FormField control={form.control} name="metadata_logo" render={({ field }) => <input type="hidden" {...field} />} />

          <div className="flex gap-2 pt-2 items-center">
            <Button type="button" onClick={form.handleSubmit(onSubmit)} disabled={isPending || !isValidated}>
              {isPending ? "Saving..." : onStage ? "Stage Flight" : "Save Flight"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            {!isValidated && (
              <span className="text-xs text-muted-foreground">
                Validate the airline code first
              </span>
            )}
          </div>
        </div>
      </Form>
    </div>
  );
}
