"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { formatDateShort } from "@/lib/tours/format";
import { createCase } from "@/lib/actions/tours-cases-actions";
import { listReservationDepartures } from "@/lib/actions/tours-reservation-actions";
import { Field } from "@/components/tours/ui";
import { MAX_TRAVELERS, type ReservationDeparture } from "@/components/tours/reservations/types";
import {
  CASE_SOURCES,
  CASE_SOURCE_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  customerLabel,
  customerName,
  type CaseRep,
  type CaseSource,
  type CaseType,
  type CustomerInfo,
} from "@/lib/tours/cases";
import { RepSelect } from "@/components/tours/cases/case-ui";

const NO_DEPARTURES = { success: true as const, data: [] as ReservationDeparture[] };
const departureLabel = (d: ReservationDeparture) => [d.code, formatDateShort(d.startDate), d.tourName].filter(Boolean).join(" · ");

const TYPE_HINTS: Record<CaseType, string> = {
  lead: "Interested, not booked yet.",
  reservation: "Booked: the travelers count on the departure's seats.",
  potential: "Wants something that is not on sale yet.",
};

/**
 * "+ New" on the Reservations screen: a call, a WhatsApp, a walk-in - a case typed in by staff. With `customer` (the
 * customer page's "New card"): a new deal of that person - their details come from the customer, not the form.
 */
export function NewCaseDialog({
  open,
  onOpenChange,
  reps,
  currentUserId,
  onCreated,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reps: readonly CaseRep[];
  currentUserId: string;
  onCreated: (id: string) => void;
  customer?: CustomerInfo;
}) {
  const run = useActionToast();
  const { data: departures, loading: departuresLoading } = useActionData<ReservationDeparture[]>(
    () => (open ? listReservationDepartures() : Promise.resolve(NO_DEPARTURES)),
    [open],
  );
  const [type, setType] = useState<CaseType>("lead");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [source, setSource] = useState<CaseSource>("phone");
  const [departureId, setDepartureId] = useState("");
  const [travelers, setTravelers] = useState("2");
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a fresh form on every open, owned by whoever opens it when they are a rep
  useEffect(() => {
    if (!open) return;
    setType("lead");
    setFirstName("");
    setLastName("");
    setPhone("");
    setEmail("");
    setIdNumber("");
    setSource("phone");
    setDepartureId("");
    setTravelers("2");
    setAssignedTo(reps.some((p) => p.id === currentUserId) ? currentUserId : null);
    setFollowUpDate("");
    setNotes("");
    setError(null);
  }, [open, reps, currentUserId]);

  const chosen = useMemo(() => departures?.find((d) => d.id === departureId), [departures, departureId]);

  const save = async () => {
    setError(null);
    if (!customer && !firstName.trim()) return setError("Enter the customer's first name.");
    if (!customer && !phone.trim() && !email.trim()) return setError("Enter a phone number or an e-mail address.");
    if (type === "reservation" && !departureId) return setError("A reservation needs a departure.");
    setSaving(true);
    const result = await run(
      () =>
        createCase({
          type,
          firstName,
          lastName,
          phone,
          email,
          idNumber,
          source,
          departureId: departureId || null,
          travelers: type === "reservation" ? Number(travelers) : null,
          assignedTo,
          notes,
          followUpDate: followUpDate || null,
          customerId: customer?.id ?? null,
        }),
      customer ? "Card created" : "Case created",
    );
    setSaving(false);
    if (!result.success) return setError(result.error);
    onOpenChange(false);
    onCreated(result.data.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {customer ? (
              <>
                New card for {customerLabel(customer.customerNo)} <span dir="auto">{customerName(customer)}</span>
              </>
            ) : (
              "New case"
            )}
          </DialogTitle>
          <DialogDescription>
            {customer
              ? "Another deal of this customer - another tour, another date. Their details come from the customer."
              : "A customer who called, wrote on WhatsApp or came to the office. Site forms and bookings arrive by themselves."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type">
            {CASE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn(
                  "rounded-md border px-3 py-2 text-start text-sm transition-colors",
                  type === t ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted",
                )}
              >
                {CASE_TYPE_LABELS[t]}
                <span className="block text-xs font-normal text-muted-foreground">{TYPE_HINTS[t]}</span>
              </button>
            ))}
          </div>

          {customer ? (
            <Field label="Came through" htmlFor="case-source">
              <Select value={source} onValueChange={(v) => setSource(v as CaseSource)}>
                <SelectTrigger id="case-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {CASE_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor="case-first">
              <Input id="case-first" dir="auto" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label="Last name" htmlFor="case-last">
              <Input id="case-last" dir="auto" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="case-phone">
              <Input id="case-phone" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="case-email">
              <Input id="case-email" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="National id (ת״ז)" htmlFor="case-id-number">
              <Input id="case-id-number" dir="ltr" inputMode="numeric" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </Field>
            <Field label="Came through" htmlFor="case-source">
              <Select value={source} onValueChange={(v) => setSource(v as CaseSource)}>
                <SelectTrigger id="case-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {CASE_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label={type === "reservation" ? "Departure" : "Departure (optional)"} htmlFor="case-departure">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="case-departure"
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={departuresLoading}
                  >
                    <span className="truncate" dir="auto">
                      {departuresLoading ? "Loading departures…" : chosen ? departureLabel(chosen) : "Choose a departure"}
                    </span>
                    {departuresLoading ? <Loader2 className="h-4 w-4 animate-spin opacity-60" /> : <ChevronsUpDown className="h-4 w-4 opacity-60" />}
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
                              setDepartureId(d.id === departureId ? "" : d.id);
                              setPickerOpen(false);
                            }}
                          >
                            <Check className={cn("h-4 w-4", d.id === departureId ? "opacity-100" : "opacity-0")} />
                            <span className="truncate" dir="auto">
                              {departureLabel(d)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>
            {type === "reservation" && (
              <Field label="Travelers" htmlFor="case-travelers">
                <Input
                  id="case-travelers"
                  type="number"
                  min={1}
                  max={MAX_TRAVELERS}
                  value={travelers}
                  onChange={(e) => setTravelers(e.target.value)}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rep">
              <RepSelect value={assignedTo} reps={reps} currentUserId={currentUserId} onChange={setAssignedTo} className="w-full" />
            </Field>
            <Field label="Follow-up day" htmlFor="case-follow-up">
              <Input id="case-follow-up" type="date" dir="ltr" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="case-notes">
            <Textarea id="case-notes" dir="auto" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What the customer asked for." />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
