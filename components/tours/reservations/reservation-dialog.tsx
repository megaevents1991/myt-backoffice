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
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { formatDateShort } from "@/lib/tours/format";
import {
  createToursReservation,
  listReservationDepartures,
} from "@/lib/actions/tours-reservation-actions";
import { Field } from "@/components/tours/ui";
import {
  MAX_TRAVELERS,
  TRAVELERS_RULE,
  type ReservationDeparture,
  type ReservationPrefill,
  type ToursReservationRow,
} from "@/components/tours/reservations/types";

interface ReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Locks the dialog to one departure (the departure card). */
  departure?: { id: string; code: string; startDate: string | null; tourName: string | null; docketNo?: string | null };
  /** A lead the reservation is made from. */
  prefill?: ReservationPrefill;
  onCreated?: (row: ToursReservationRow) => void;
}

/** The picker's answer while it has nothing to load: the dialog is closed, or locked to one departure. */
const NO_DEPARTURES = { success: true as const, data: [] as ReservationDeparture[] };

const travelersLabel = (count: number) => `${count} ${count === 1 ? "traveler" : "travelers"}`;

const departureLabel = (d: { code: string; startDate: string | null; tourName: string | null }) =>
  [d.code, formatDateShort(d.startDate), d.tourName].filter(Boolean).join(" · ");

/**
 * Add a reservation: a booking or a cancellation of travelers on a departure,
 * with the customer and the Docket number. The same dialog serves the
 * Reservations screen, the departure card and a lead.
 */
export function ReservationDialog({ open, onOpenChange, departure, prefill, onCreated }: ReservationDialogProps) {
  const run = useActionToast();
  const locked = Boolean(departure);
  // The picker's departures, loaded on every open when the departure is not fixed.
  const {
    data: departures,
    error: departuresError,
    loading: departuresLoading,
  } = useActionData<ReservationDeparture[]>(
    () => (open && !locked ? listReservationDepartures() : Promise.resolve(NO_DEPARTURES)),
    [open, locked],
  );
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
    setDocketNo(departure?.docketNo ?? "");
    setNote(prefill?.note ?? "");
    setError(null);
  }, [open, departure?.id, prefill]);

  // A lead sent from a departure's page picks that departure once the list is in.
  useEffect(() => {
    if (!open || locked || !prefill?.siteId) return;
    const fromLead = departures?.find((d) => d.siteId === prefill.siteId);
    if (fromLead) setDepartureId(fromLead.id);
  }, [open, locked, departures, prefill?.siteId]);

  const chosen = useMemo(
    () => (departure ? departure : departures?.find((d) => d.id === departureId)),
    [departure, departures, departureId],
  );

  const save = async () => {
    setError(null);
    const count = Number(travelers);
    if (!departureId) return setError("Choose a departure.");
    if (!Number.isInteger(count) || count < 1 || count > MAX_TRAVELERS) return setError(TRAVELERS_RULE);
    setSaving(true);
    const result = await run(
      () =>
        createToursReservation({
          departureId,
          pax: kind === "booking" ? count : -count,
          customerName,
          customerPhone,
          customerEmail,
          docketNo,
          note,
          leadId: prefill?.leadId ?? null,
        }),
      ({ data: row }) =>
        `${kind === "booking" ? "Reservation added" : "Cancellation added"}: ${travelersLabel(Math.abs(row.pax))} · ${departureLabel(chosen ?? { code: row.departureCode, startDate: row.departureDate, tourName: row.tourName })}`,
    );
    setSaving(false);
    if (!result.success) return;
    onCreated?.(result.data);
    onOpenChange(false);
  };

  const shownError = error ?? departuresError;

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
          <Field label="Departure" htmlFor="reservation-departure">
            {departure ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" dir="auto">
                {departureLabel(departure)}
              </div>
            ) : (
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="reservation-departure"
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={departuresLoading}
                  >
                    <span className="truncate" dir="auto">
                      {departuresLoading ? "Loading departures…" : chosen ? departureLabel(chosen) : "Choose a departure"}
                    </span>
                    {departuresLoading ? (
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
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="Type" htmlFor="reservation-type">
              <ToggleGroup
                id="reservation-type"
                aria-label="Type"
                type="single"
                variant="outline"
                value={kind}
                onValueChange={(value) => value && setKind(value as "booking" | "cancellation")}
                className="justify-start"
              >
                <ToggleGroupItem value="booking">Booking</ToggleGroupItem>
                <ToggleGroupItem value="cancellation">Cancellation</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field label="Travelers" htmlFor="reservation-travelers">
              <Input
                id="reservation-travelers"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TRAVELERS}
                step={1}
                value={travelers}
                onChange={(e) => setTravelers(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="reservation-name">
              <Input
                id="reservation-name"
                dir="auto"
                autoComplete="off"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </Field>
            <Field label="Phone" htmlFor="reservation-phone">
              <Input
                id="reservation-phone"
                type="tel"
                autoComplete="off"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </Field>
            <Field label="Email" htmlFor="reservation-email">
              <Input
                id="reservation-email"
                type="email"
                autoComplete="off"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
            </Field>
            <Field label="Docket" htmlFor="reservation-docket">
              <Input
                id="reservation-docket"
                placeholder="Accounting number"
                value={docketNo}
                onChange={(e) => setDocketNo(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Note" htmlFor="reservation-note">
            <Textarea
              id="reservation-note"
              dir="auto"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {shownError && (
            <p role="alert" className="text-sm text-destructive">
              {shownError}
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
