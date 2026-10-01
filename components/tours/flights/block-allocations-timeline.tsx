"use client";

/**
 * Allocations and timeline of a flight block.
 *
 * Allocations: the departures this block serves. A block may be split between
 * departures, and a departure may take only one direction of it. Both ends are
 * checked by city on the server before anything is written.
 * Timeline: flight_block_events, newest first - the lifecycle steps, seat changes,
 * deposits and the notes the operator adds.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/confirm-provider";
import {
  addTourBlockEvent,
  allocateTourBlock,
  listAllocatableDepartures,
  removeTourBlockAllocation,
  type AllocatableDeparture,
  type TourBlockAllocation,
} from "@/lib/actions/tours-flight-actions";
import { formatDateShort, formatMoney, parseNumber } from "@/lib/tours/format";
import {
  ALLOCATION_LEGS,
  ALLOCATION_LEGS_LABELS,
  stageOf,
  type AllocationLegs,
} from "@/components/tours/flights/block-rules";
import { BLOCK_EVENT_LABELS, type BlockEventKind } from "@/types/tours.types";
import { Field, Ltr, Notice, Section } from "@/components/tours/ui";
import type { BlockSectionProps } from "@/components/tours/flights/tour-block-panel";

const departureHref = (code: string) => `/tours/departures?code=${encodeURIComponent(code)}`;

// ------------------------------------------------------------------ allocations

export function BlockAllocationsSection({ data, run }: BlockSectionProps) {
  const { block, allocations } = data;
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const stage = stageOf(block.block_status);
  const closed = stage === "cancelled" || stage === "declined";
  const free = block.initial_quantity - data.allocatedSeats;

  const remove = async (allocation: TourBlockAllocation) => {
    const ok = await confirm({
      title: "Remove this allocation?",
      description: `${allocation.seats} seats go back to the pool, and departure ${allocation.code} is left without this flight block.`,
      confirmLabel: "Remove Allocation",
      cancelLabel: "Back",
      destructive: true,
    });
    if (!ok) return;
    setRemoving(allocation.id);
    await run(() => removeTourBlockAllocation(block.id, allocation.id), "Allocation removed");
    setRemoving(null);
  };

  return (
    <Section
      title="Allocation"
      description="The departures this flight block serves. A flight block with no allocation stays in the pool."
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={closed}>
          Allocate to Departure
        </Button>
      }
    >
      {allocations.length === 0 ? (
        <Notice tone="muted">
          {closed ? "The flight block is not allocated to any departure." : `The flight block is in the pool: ${free} seats left to allocate.`}
        </Notice>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Departure</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Check</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link href={departureHref(a.code)} className="font-medium text-primary underline-offset-4 hover:underline">
                    <Ltr>{a.code}</Ltr>
                  </Link>
                  {!a.is_published && <span className="ms-2 text-xs text-muted-foreground">Not published</span>}
                </TableCell>
                <TableCell>
                  <Ltr>
                    {formatDateShort(a.start_date)} - {formatDateShort(a.end_date)}
                  </Ltr>
                </TableCell>
                <TableCell>
                  <Ltr>{a.route || "-"}</Ltr>
                </TableCell>
                <TableCell className="tabular-nums">{a.seats}</TableCell>
                <TableCell>{ALLOCATION_LEGS_LABELS[a.legs]}</TableCell>
                <TableCell className="text-xs">
                  {!a.fits ? (
                    <span className="font-medium text-destructive">{a.fitReason}</span>
                  ) : a.dayGap !== 0 ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      {Math.abs(a.dayGap) === 1 ? "1 day" : `${Math.abs(a.dayGap)} days`} off the flight
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Matches</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={removing === a.id}
                    onClick={() => remove(a)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {open && <AllocateDialog data={data} run={run} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function AllocateDialog({ data, run, onClose }: BlockSectionProps & { onClose: () => void }) {
  const { block } = data;
  const free = Math.max(0, block.initial_quantity - data.allocatedSeats);
  const [candidates, setCandidates] = useState<AllocatableDeparture[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [departureId, setDepartureId] = useState("");
  const [legs, setLegs] = useState<AllocationLegs>("both");
  const [seats, setSeats] = useState(String(free || ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAllocatableDepartures(block.id)
      .then((res) => {
        if (cancelled) return;
        if (res.success) setCandidates(res.data);
        else setLoadError(res.error);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the departures"));
    return () => {
      cancelled = true;
    };
  }, [block.id]);

  const chosen = candidates?.find((c) => c.id === departureId) ?? null;
  const fit = chosen ? chosen.fit[legs] : null;
  const parsed = parseNumber(seats);
  const seatsValue = typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  const existing = data.allocations.find((a) => a.departure_id === departureId && a.legs === legs) ?? null;

  const submit = async () => {
    if (!chosen || seatsValue === null) return;
    setSaving(true);
    const res = await run(
      () => allocateTourBlock(block.id, { departureId: chosen.id, seats: seatsValue, legs }),
      existing ? `Allocation to ${chosen.code} updated` : `Flight block allocated to ${chosen.code}`,
    );
    setSaving(false);
    if (res.success) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Allocate to Departure</DialogTitle>
          <DialogDescription>
            Shows departures that start within two days of the flight date. The route is checked at both ends by city.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <Notice tone="error">{loadError}</Notice>
        ) : candidates === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading departures...
          </div>
        ) : candidates.length === 0 ? (
          <Notice tone="muted">The company has no departure within two days of the flight dates.</Notice>
        ) : (
          <div className="grid gap-4">
            <Field label="Departure">
              <Select value={departureId} onValueChange={setDepartureId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a departure" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span dir="ltr">
                        {c.code} · {formatDateShort(c.start_date)} - {formatDateShort(c.end_date)}
                        {c.route ? ` · ${c.route}` : ""}
                      </span>
                      {c.fit.both.ok ? "" : " · no match"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Direction">
                <Select value={legs} onValueChange={(v) => setLegs(v as AllocationLegs)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLOCATION_LEGS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {ALLOCATION_LEGS_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Seats" htmlFor="allocate-seats" hint={`Left in the flight block: ${free}`}>
                <Input
                  id="allocate-seats"
                  dir="ltr"
                  inputMode="numeric"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                />
              </Field>
            </div>
            {chosen && (
              <div className="grid gap-2 text-sm">
                <div className="text-muted-foreground">
                  Departure {chosen.code} has {chosen.allocated_seats} live seats allocated today, {chosen.sold} sold.
                </div>
                {fit && !fit.ok && <Notice tone="error">{fit.reason}</Notice>}
                {existing && (
                  <Notice tone="warning">
                    This allocation already exists with {existing.seats} seats. Saving updates the count.
                  </Notice>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Back
          </Button>
          <Button onClick={submit} disabled={saving || !chosen || seatsValue === null || (fit !== null && !fit.ok)}>
            {saving ? "Saving..." : existing ? "Update Allocation" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ timeline

/** What an operator may add by hand; the other kinds are written by the actions of the panel. */
const MANUAL_KINDS: BlockEventKind[] = ["note", "quoted", "names_sent", "schedule_change"];

const eventLabel = (kind: string): string =>
  kind in BLOCK_EVENT_LABELS ? BLOCK_EVENT_LABELS[kind as BlockEventKind] : kind;

export function BlockTimelineSection({ data, run }: BlockSectionProps) {
  const { block, events } = data;
  const [kind, setKind] = useState<BlockEventKind>("note");
  const [date, setDate] = useState(data.today);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const withAmount = kind === "quoted";
  const parsedAmount = withAmount ? parseNumber(amount) : null;
  const canSave = !!date && parsedAmount !== undefined && (kind !== "note" || note.trim() !== "");

  const add = async () => {
    if (!canSave) return;
    setSaving(true);
    const res = await run(
      () =>
        addTourBlockEvent(block.id, {
          kind,
          note,
          date,
          amount: parsedAmount ?? null,
          currency: parsedAmount === null || parsedAmount === undefined ? null : (block.cost_currency ?? "USD"),
        }),
      "Added to the timeline",
    );
    setSaving(false);
    if (res.success) {
      setNote("");
      setAmount("");
      setKind("note");
    }
  };

  return (
    <Section title="Timeline" description="Everything that happened to the flight block, newest first.">
      <div className="grid gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-[10rem_10rem_1fr_auto] md:items-end">
        <Field label="Type">
          <Select value={kind} onValueChange={(v) => setKind(v as BlockEventKind)}>
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {BLOCK_EVENT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date" htmlFor="event-date">
          <Input
            id="event-date"
            type="date"
            className="bg-background"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label={kind === "note" ? "Note" : "Note (Optional)"} htmlFor="event-note">
            <Textarea
              id="event-note"
              dir="auto"
              rows={1}
              className="min-h-10 bg-background"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {withAmount && (
            <Field label={`Quoted Price${block.cost_currency ? ` (${block.cost_currency})` : ""}`} htmlFor="event-amount">
              <Input
                id="event-amount"
                dir="ltr"
                inputMode="decimal"
                className="w-32 bg-background"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          )}
        </div>
        <Button onClick={add} disabled={saving || !canSave}>
          {saving ? "Saving..." : "Add"}
        </Button>
      </div>

      {events.length === 0 ? (
        <Notice tone="muted">Nothing recorded for this flight block yet.</Notice>
      ) : (
        <ol className="divide-y">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <Ltr className="w-16 shrink-0 text-muted-foreground">{formatDateShort(e.happened_on)}</Ltr>
              <span className="font-medium">{eventLabel(e.kind)}</span>
              {e.seats_after !== null && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums">{e.seats_after} seats</span>
              )}
              {e.amount !== null && <Ltr className="font-medium">{formatMoney(e.amount, e.currency)}</Ltr>}
              {e.note && (
                <span className="min-w-0 break-words" dir="auto">
                  {e.note}
                </span>
              )}
              <span className="ms-auto text-xs text-muted-foreground">
                {e.created_by_name ?? (e.created_by ? "User" : "Import")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
