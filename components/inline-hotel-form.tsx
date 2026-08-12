"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTransition } from "react";
import { toast } from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { createOfflineHotel } from "@/lib/actions/offline-hotel-actions";
import type { OfflineHotel } from "@/types/offline-hotel.types";

const inlineHotelSchema = z.object({
  hotel_name: z.string().min(1, "Hotel name is required."),
  city: z.string().min(1, "City is required."),
  check_in: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD."),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD."),
  price: z.coerce.number().positive("Price must be positive."),
  room_type: z.string().min(1, "Room type is required."),
  num_rooms: z.coerce.number().int().positive("Must be at least 1."),
  meal_plan: z.string().optional(),
  notes: z.string().optional(),
});

type InlineHotelFormData = z.infer<typeof inlineHotelSchema>;

// Shape passed to createOfflineHotel (flight_ids always empty from inline form)
export type StagedHotelData = Omit<OfflineHotel, "id" | "consumed_rooms" | "is_deleted" | "created_at">;

interface InlineHotelFormProps {
  /** Present when adding to an existing saved event - hotel is created immediately. */
  eventId?: number;
  /** Present when adding during new event creation - hotel data is staged, not yet saved. */
  onStage?: (data: StagedHotelData) => void;
  /** Called after the hotel is created in the DB (existing event mode only). */
  onCreated?: (hotel: OfflineHotel) => void;
  onCancel: () => void;
  defaultCity?: string;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
}

export function InlineHotelForm({
  eventId,
  onStage,
  onCreated,
  onCancel,
  defaultCity,
  defaultCheckIn,
  defaultCheckOut,
}: InlineHotelFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<InlineHotelFormData>({
    resolver: zodResolver(inlineHotelSchema),
    defaultValues: {
      hotel_name: "",
      city: defaultCity ?? "",
      check_in: defaultCheckIn?.slice(0, 10) ?? "",
      check_out: defaultCheckOut?.slice(0, 10) ?? "",
      price: 100,
      room_type: "Double",
      num_rooms: 1,
      meal_plan: "",
      notes: "",
    },
  });

  async function onSubmit(values: InlineHotelFormData) {
    const hotelData: StagedHotelData = {
      ...values,
      hid: null,
      meal_plan: values.meal_plan || null,
      notes: values.notes || null,
      last_cancellation_date: null,
      event_ids: [],
      flight_ids: [],
    };

    // Stage mode: new event not yet saved
    if (onStage) {
      onStage(hotelData);
      toast.success("Hotel staged - will be saved with the event.");
      return;
    }

    // Immediate mode: existing event
    if (!eventId || !onCreated) return;
    startTransition(async () => {
      try {
        const hotel = await createOfflineHotel({ ...hotelData, event_ids: [eventId] });
        toast.success("Hotel added and linked to event!");
        onCreated(hotel);
      } catch (error) {
        toast.error((error as Error)?.message || "Failed to create hotel.");
      }
    });
  }

  return (
    <div className="rounded-md border p-4 mt-2">
      <Form {...form}>
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            New Offline Hotel
            {onStage && (
              <span className="ml-2 text-xs font-normal normal-case text-amber-600">
                Will be created when you save the event
              </span>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <FormField control={form.control} name="hotel_name" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Hotel Name</FormLabel>
                <FormControl><Input placeholder="e.g., Grand Hyatt Madrid" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl><Input placeholder="e.g., Madrid" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="room_type" render={({ field }) => (
              <FormItem>
                <FormLabel>Room Type</FormLabel>
                <FormControl><Input placeholder="e.g., Double" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="check_in" render={({ field }) => (
              <FormItem>
                <FormLabel>Check-in</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="check_out" render={({ field }) => (
              <FormItem>
                <FormLabel>Check-out</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="price" render={({ field }) => (
              <FormItem>
                <FormLabel>Price (USD)</FormLabel>
                <FormControl><Input type="number" step="1" placeholder="250" {...field} /></FormControl>
                <FormDescription>Per room, total stay.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="num_rooms" render={({ field }) => (
              <FormItem>
                <FormLabel>Rooms</FormLabel>
                <FormControl><Input type="number" placeholder="10" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="meal_plan" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Meal Plan (optional)</FormLabel>
                <FormControl><Input placeholder="e.g., Breakfast included" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl><Textarea placeholder="Any additional notes..." rows={2} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          <div className="flex gap-2 pt-2 items-center">
            <Button type="button" onClick={form.handleSubmit(onSubmit)} disabled={isPending}>
              {isPending ? "Saving..." : onStage ? "Stage Hotel" : "Save Hotel"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}
