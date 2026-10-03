"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CreditCard, Loader2, PlusCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/components/page-header";
import { DataTable, DataTableSkeleton, SortableHeader } from "@/components/data-table";
import { SearchInput } from "@/components/search-input";
import { EMPTY, fmtDate, fmtInstant, fmtPrice } from "@/lib/tours/format";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useSessionState } from "@/hooks/use-view-state";
import { listBookings, updateBooking } from "@/lib/actions/tours-bookings-actions";
import { Fact, FactList, LoadError, Notice } from "@/components/tours/ui";
import { ReservationDialog } from "@/components/tours/reservations/reservation-dialog";
import type { ReservationPrefill } from "@/components/tours/reservations/types";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_HINTS,
  BOOKING_STATUS_LABELS,
  STAFF_STATUSES,
  bookingMatches,
  bookingStatusLabel,
  type BookingChange,
  type BookingRow,
  type BookingStatus,
} from "@/components/tours/bookings/shared";

const ALL = "all";

const STATUS_VARIANT: Record<BookingStatus, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  in_progress: "secondary",
  pending_payment: "secondary",
  paid: "default",
  review: "destructive",
  failed: "outline",
  done: "outline",
  cancelled: "outline",
};

const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={STATUS_VARIANT[status as BookingStatus] ?? "outline"}>{bookingStatusLabel(status)}</Badge>
);

const kindLabel = (row: BookingRow) => (row.kind === "card" ? "Card payment" : "Request");
const paxLabel = (row: BookingRow) => `${row.adults + row.children} (${row.adults} adults${row.children ? `, ${row.children} children` : ""})`;

/** The statuses staff can pick for this booking: the hand-set ones, plus "Paid" to confirm a "Check payment". */
function statusChoices(row: BookingRow): BookingStatus[] {
  if (row.status === "paid") return ["paid", "done", "cancelled"];
  const base = [...STAFF_STATUSES];
  if (row.status === "review") base.unshift("paid");
  if (!base.includes(row.status as BookingStatus)) base.unshift(row.status as BookingStatus);
  return base;
}

/**
 * /tours/bookings - what customers booked on the site: requests for a rep and
 * card payments, with the price the server computed, the passengers and the
 * payment. Staff set the status, the receipt number and "confirmation sent".
 */
export function BookingsScreen() {
  const run = useActionToast();
  const { data, error, loading, reload, setData } = useActionData(() => listBookings(), []);
  const [view, setView] = useSessionState<string>("bookings-view", ALL);
  const [q, setQ] = useSessionState<string>("bookings-q", "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reserving, setReserving] = useState<ReservationPrefill | undefined>(undefined);

  const change = async (row: BookingRow, patch: BookingChange) => {
    setBusy(true);
    const result = await run(() => updateBooking(row.id, patch));
    setBusy(false);
    if (result.success) setData((current) => current && { ...current, rows: current.rows.map((r) => (r.id === row.id ? result.data : r)) });
  };

  const columns = useMemo<ColumnDef<BookingRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortableHeader label="Date" column={column} />,
        cell: ({ row }) => <div className="whitespace-nowrap tabular">{fmtInstant(row.original.createdAt)}</div>,
      },
      { accessorKey: "ref", header: "Booking", cell: ({ row }) => <span className="font-mono text-xs">{row.original.ref}</span> },
      { id: "kind", header: "Type", cell: ({ row }) => <div className="whitespace-nowrap">{kindLabel(row.original)}</div> },
      {
        id: "departure",
        header: "Departure",
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            {row.original.departureCode ?? EMPTY}
            <span className="text-muted-foreground"> · {fmtDate(row.original.departureStart)}</span>
          </div>
        ),
      },
      { accessorKey: "customerName", header: "Customer", cell: ({ row }) => <div dir="auto">{row.original.customerName || EMPTY}</div> },
      { accessorKey: "customerPhone", header: "Phone", cell: ({ row }) => <span className="whitespace-nowrap tabular">{row.original.customerPhone || EMPTY}</span> },
      { id: "pax", header: "Passengers", cell: ({ row }) => <span className="tabular">{row.original.adults + row.original.children}</span> },
      {
        accessorKey: "total",
        header: ({ column }) => <SortableHeader label="Total" column={column} />,
        cell: ({ row }) => (
          <div className="whitespace-nowrap tabular">
            {fmtPrice(row.original.total, row.original.currency)}
            {row.original.priceBasis === "estimate" && <span className="text-muted-foreground"> (est.)</span>}
          </div>
        ),
      },
      { id: "ils", header: "Charged", cell: ({ row }) => <span className="whitespace-nowrap tabular">{row.original.totalIls ? fmtPrice(row.original.totalIls, "ILS") : EMPTY}</span> },
      { accessorKey: "status", header: ({ column }) => <SortableHeader label="Status" column={column} />, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  const all = useMemo(() => data?.rows ?? [], [data]);
  const searched = useMemo(() => (q ? all.filter((r) => bookingMatches(r, q)) : all), [all, q]);
  const shown = view === ALL ? searched : searched.filter((r) => r.status === view);
  const open = openId ? all.find((r) => r.id === openId) : undefined;
  const present = BOOKING_STATUSES.filter((s) => all.some((r) => r.status === s));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Online Bookings"
        description="What customers booked on the site: requests for a rep, and card payments with the price the system computed. Open a booking to see the passengers and the payment, set its status, the receipt number and whether the confirmation was sent."
        actions={
          <Button variant="outline" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
      {data ? (
        <DataTable
          columns={columns}
          data={shown}
          defaultPageSize={50}
          pageSizeOptions={[25, 50, 100]}
          dense
          getRowId={(row) => row.id}
          defaultSorting={[{ id: "createdAt", desc: true }]}
          views={[
            { id: ALL, label: "All", count: all.length },
            ...present.map((status) => ({ id: status, label: BOOKING_STATUS_LABELS[status], count: all.filter((r) => r.status === status).length })),
          ]}
          activeView={view}
          onViewChange={setView}
          filters={<SearchInput value={q} onValueChange={setQ} placeholder="Search by booking, name, phone, email or departure..." />}
          onRowClick={(row) => setOpenId(row.id)}
          stateKey="tours-online-bookings"
          emptyState={{
            title: all.length === 0 ? "No online bookings yet" : "No bookings in this view",
            description:
              all.length === 0
                ? "When a customer sends a booking request or pays on the site, it appears here (and as a lead)."
                : "Choose another status or clear the search.",
          }}
        />
      ) : (
        loading && <DataTableSkeleton rows={10} label="Loading online bookings" />
      )}
      {data?.truncated && <p className="text-xs text-muted-foreground">Showing the newest 2,000 bookings.</p>}

      <Sheet open={!!open} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && <BookingDetails key={open.id} row={open} busy={busy} onChange={(patch) => void change(open, patch)} onReserve={() =>
            setReserving({
              leadId: open.leadId ?? undefined,
              customerName: open.customerName,
              customerPhone: open.customerPhone,
              customerEmail: open.customerEmail,
              note: `Online booking ${open.ref}${open.note ? ` - ${open.note}` : ""}`,
              siteId: open.siteId,
            })
          } />}
        </SheetContent>
      </Sheet>

      <ReservationDialog
        open={!!reserving}
        onOpenChange={(next) => !next && setReserving(undefined)}
        prefill={reserving}
        onCreated={() => setReserving(undefined)}
      />
    </div>
  );
}

function BookingDetails({
  row,
  busy,
  onChange,
  onReserve,
}: {
  row: BookingRow;
  busy: boolean;
  onChange: (patch: BookingChange) => void;
  onReserve: () => void;
}) {
  const [receipt, setReceipt] = useState(row.receiptNo ?? "");
  const [note, setNote] = useState(row.staffNote ?? "");
  const money = (value: number | null | undefined) => fmtPrice(value ?? null, row.currency);
  const estimate = row.priceBasis === "estimate";

  return (
    <div className="space-y-5 pt-6">
      <SheetHeader className="pe-6 text-start">
        <SheetTitle dir="auto">
          {row.ref} · {row.customerName || row.customerPhone || "Booking"}
        </SheetTitle>
        <SheetDescription>
          {kindLabel(row)} · {fmtInstant(row.createdAt)} · {row.departureCode ?? EMPTY} {fmtDate(row.departureStart)}
        </SheetDescription>
      </SheetHeader>

      {row.status === "review" && (
        <Notice tone="error">
          CreditGuard reported a successful charge, but its amount or currency does not match this booking. Check transaction{" "}
          {row.cgTxId ?? ""} in CreditGuard. If it is right, set the status to Paid: that adds the passengers to the departure.
        </Notice>
      )}
      {row.status === "pending_payment" && (
        <Notice tone="warning">The customer reached the payment page and has not paid. Call them - this is a hot lead.</Notice>
      )}

      {row.kind === "request" && (
        <Button className="w-full" onClick={onReserve}>
          <PlusCircle className="h-4 w-4" />
          Create Reservation
        </Button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={row.status} disabled={busy} onValueChange={(status) => onChange({ status })}>
            <SelectTrigger aria-label="Booking status">
              <SelectValue>{bookingStatusLabel(row.status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusChoices(row).map((status) => (
                <SelectItem key={status} value={status} title={BOOKING_STATUS_HINTS[status]}>
                  {BOOKING_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="booking-receipt" className="text-xs text-muted-foreground">Receipt No.</Label>
          <Input
            id="booking-receipt"
            value={receipt}
            disabled={busy}
            onChange={(e) => setReceipt(e.target.value)}
            onBlur={() => receipt !== (row.receiptNo ?? "") && onChange({ receiptNo: receipt })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <Label htmlFor="booking-confirmation" className="text-sm">
          Confirmation sent to the customer
          {row.confirmationSentAt && <span className="block text-xs text-muted-foreground">{fmtInstant(row.confirmationSentAt)}</span>}
        </Label>
        <Switch
          id="booking-confirmation"
          checked={!!row.confirmationSentAt}
          disabled={busy}
          onCheckedChange={(checked) => onChange({ confirmationSent: checked })}
        />
      </div>

      <FactList>
        <Fact label="Customer">{row.customerName && <span dir="auto">{row.customerName}</span>}</Fact>
        <Fact label="Phone">{row.customerPhone && <a className="text-primary hover:underline tabular" href={`tel:${row.customerPhone}`}>{row.customerPhone}</a>}</Fact>
        <Fact label="Email">{row.customerEmail && <a className="text-primary hover:underline" href={`mailto:${row.customerEmail}`}>{row.customerEmail}</a>}</Fact>
        <Fact label="Passengers">{paxLabel(row)}</Fact>
        <Fact label="Customer note">{row.note && <p dir="auto" className="whitespace-pre-wrap break-words">{row.note}</p>}</Fact>
      </FactList>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Price {estimate && <span className="font-normal text-muted-foreground">(what the customer saw - the system could not price this date)</span>}</h3>
        <FactList className="rounded-md border bg-muted/30 px-3">
          {row.lines.map((line, i) => (
            <Fact key={`${line.key}-${i}`} label={<span dir="auto">{line.title || line.key}</span>}>
              {line.price != null ? (
                <span className="tabular">
                  {money(line.price)}
                  {line.discount ? <span className="text-muted-foreground"> − {money(line.discount)}</span> : null}
                </span>
              ) : (
                EMPTY
              )}
            </Fact>
          ))}
          {row.seniors > 0 && <Fact label={`Senior discount (${row.seniors})`}>−{money(Number(row.breakdown.senior_discount ?? 0))}</Fact>}
          {Number(row.breakdown.flight_total ?? 0) > 0 && <Fact label="Flight">{money(Number(row.breakdown.flight_total))}</Fact>}
          <Fact label={<strong>Total</strong>}>
            <strong className="tabular">{money(row.total)}</strong>
          </Fact>
        </FactList>
      </div>

      {row.kind === "card" && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4" /> Payment
          </h3>
          <FactList className="rounded-md border bg-muted/30 px-3">
            <Fact label="Charged">{row.totalIls ? fmtPrice(row.totalIls, "ILS") : EMPTY}</Fact>
            <Fact label="Rate">
              {row.rate ? `${row.rate} (${row.rateSource === "company" ? "today's rate from the Rates screen" : "automatic rate + margin"})` : EMPTY}
            </Fact>
            <Fact label="Payments">{row.payments ?? EMPTY}</Fact>
            <Fact label="Card">{row.cardLast4 ? `•••• ${row.cardLast4}` : EMPTY}</Fact>
            <Fact label="CreditGuard transaction">{row.cgTxId && <span className="font-mono text-xs">{row.cgTxId}</span>}</Fact>
            <Fact label="Authorization">{row.cgAuthNumber ?? EMPTY}</Fact>
            <Fact label="Paid at">{row.paidAt ? fmtInstant(row.paidAt) : EMPTY}</Fact>
            <Fact label="Seats">{row.salesEntryId ? "Added to the departure" : "Not added (not paid)"}</Fact>
          </FactList>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Passengers</h3>
        {row.passengers.length === 0 ? (
          <p className="text-sm text-muted-foreground">The customer did not fill in passengers.</p>
        ) : (
          <FactList className="rounded-md border bg-muted/30 px-3">
            {row.passengers.map((p, i) => (
              <Fact key={i} label={`${i + 1}. ${p.type === "child" ? "Child" : "Adult"}`}>
                <span dir="auto">
                  {[p.first, p.last].filter(Boolean).join(" ") || EMPTY}
                  {p.dob ? <span className="text-muted-foreground"> · {fmtDate(p.dob)}</span> : null}
                </span>
              </Fact>
            ))}
          </FactList>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="booking-note" className="text-xs text-muted-foreground">Staff note</Label>
        <Textarea
          id="booking-note"
          rows={3}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (row.staffNote ?? "") && onChange({ staffNote: note })}
        />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
