"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { formatDateShort } from "@/lib/tours/deadlines";
import {
  createToursReservation,
  listReservationDepartures,
} from "@/lib/actions/tours-reservation-actions";
import type {
  ReservationDeparture,
  ReservationPrefill,
  ToursReservationRow,
} from "@/components/tours/reservations/types";

interface ReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Locks the dialog to one departure (the departure card). */
  departure?: { id: string; code: string; startDate: string | null; tourName: string | null };
  /** A lead the reservation is made from. */
  prefill?: ReservationPrefill;
  onCreated?: (row: ToursReservationRow) => void;
}

const travelersLabel = (count: number) => `${count} ${count === 1 ? "traveler" : "travelers"}`;

const departureLabel = (d: { code: string; startDate: string | null; tourName: string | null }) =>
  [d.code, formatDateShort(d.startDate), d.tourName].filter(Boolean).join(" · ");

/**
 * Add a reservation: a booking or a cancellation of travelers on a departure,
 * with the customer and the Docket number. The same dialog serves the
 * Reservations screen, the departure card and a lead.
 */
export function ReservationDialog({ open, onOpenChange, departure, prefill, onCreated }: ReservationDialogProps) {
  const { toast } = useToast();
  const [departures, setDepartures] = useState<ReservationDeparture[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [departureId, setDepartureId] = useState<string>(departure?.id ?? "");
  const [kind, setKind] = useState<"booking" | "cancellation">("booking");
  const [travelers, setTravelers] = useState("1");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [docketNo, setDocketNo] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form on every open, filled from the lead when there is one.
  useEffect(() => {
    if (!open) return;
    setDepartureId(departure?.id ?? "");
    setKind("booking");
    setTravelers("1");
    setCustomerName(prefill?.customerName ?? "");
    setCustomerPhone(prefill?.customerPhone ?? "");
    setCustomerEmail(prefill?.customerEmail ?? "");
    setDocketNo("");
    setNote(prefill?.note ?? "");
    setError(null);
  }, [open, departure?.id, prefill]);

  // The picker's departures, loaded once per open when the departure is not fixed.
  useEffect(() => {
    if (!open || departure) return;
    let cancelled = false;
    listReservationDepartures().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        setDepartures([]);
        return;
      }
      setDepartures(result.data);
      // A lead sent from a departure's page picks that departure.
      const fromLead = prefill?.siteId ? result.data.find((d) => d.siteId === prefill.siteId) : undefined;
      if (fromLead) setDepartureId(fromLead.id);
    });
    return () => {
      cancelled = true;
    };
  }, [open, departure, prefill?.siteId]);

  const chosen = useMemo(
    () => (departure ? departure : departures?.find((d) => d.id === departureId)),
    [departure, departures, departureId],
  );

  const save = async () => {
    setError(null);
    const count = Number(travelers);
    if (!departureId) return setError("Choose a departure.");
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      return setError("Travelers must be a whole number from 1 to 99.");
    }
    setSaving(true);
    const result = await createToursReservation({
      departureId,
      pax: kind === "booking" ? count : -count,
      customerName,
      customerPhone,
      customerEmail,
      docketNo,
      note,
      leadId: prefill?.leadId ?? null,
    });
    setSaving(false);
    if (!result.success) return setError(result.error);
    toast({
      title: kind === "booking" ? "Reservation added" : "Cancellation added",
      description: `${travelersLabel(Math.abs(result.data.pax))} · ${departureLabel(chosen ?? { code: result.data.departureCode, startDate: result.data.departureDate, tourName: result.data.tourName })}`,
    });
    onCreated?.(result.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{prefill?.leadId ? "Create Reservation from Lead" : "Add Reservation"}</DialogTitle>
          <DialogDescription>
            Travelers sold on a departure, or given back. They count on the departure&apos;s seats right away.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Departure</Label>
            {departure ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" dir="auto">
                {departureLabel(departure)}
              </div>
            ) : (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={departures === null}
                  >
                    <span className="truncate" dir="auto">
                      {departures === null ? "Loading departures…" : chosen ? departureLabel(chosen) : "Choose a departure"}
                    </span>
                    {departures === null ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-60" />
                    ) : (
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search by code, date or tour…" />
                    <CommandList>
                      <CommandEmpty>No departure matches.</CommandEmpty>
                      <CommandGroup>
                        {(departures ?? []).map((d) => (
                          <CommandItem
                            key={d.id}
                            value={`${d.code} ${formatDateShort(d.startDate)} ${d.tourName ?? ""}`}
                            onSelect={() => {
                              setDepartureId(d.id);
                              setPickerOpen(false);
                            }}
                          >
                            <Check className={cn("h-4 w-4", d.id === departureId ? "opacity-100" : "opacity-0")} />
                            <span className="truncate" dir="auto">
                              {departureLabel(d)}
                            </span>
                            {!d.isPublished && (
                              <span className="ms-auto shrink-0 text-xs text-muted-foreground">Draft</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={kind}
                onValueChange={(value) => value && setKind(value as "booking" | "cancellation")}
                className="justify-start"
              >
                <ToggleGroupItem value="booking">Booking</ToggleGroupItem>
                <ToggleGroupItem value="cancellation">Cancellation</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reservation-travelers">Travelers</Label>
              <Input
                id="reservation-travelers"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                value={travelers}
                onChange={(e) => setTravelers(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="reservation-name">Customer</Label>
              <Input
                id="reservation-name"
                dir="auto"
                autoComplete="off"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reservation-phone">Phone</Label>
              <Input
                id="reservation-phone"
                type="tel"
                autoComplete="off"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reservation-email">Email</Label>
              <Input
                id="reservation-email"
                type="email"
                autoComplete="off"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reservation-docket">Docket</Label>
              <Input
                id="reservation-docket"
                placeholder="Accounting number"
                value={docketNo}
                onChange={(e) => setDocketNo(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="reservation-note">Note</Label>
            <Textarea
              id="reservation-note"
              dir="auto"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {kind === "booking" ? "Save Reservation" : "Save Cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
