"use client";

import { useState } from "react";
import { CreditCard, FileText, Gift, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActionToast } from "@/hooks/use-action-toast";
import { EMPTY, fmtDate, fmtInstant, fmtPrice } from "@/lib/tours/format";
import { updateBooking } from "@/lib/actions/tours-bookings-actions";
import { Fact, FactList, Notice } from "@/components/tours/ui";
import { sameCustomer, type CaseGift } from "@/lib/tours/cases";
import type { CancellationRule } from "@/lib/tours/cancellation";
import { CancelFeeToday, OrderPayments } from "@/components/tours/cases/order-money";
import {
  BOOKING_STATUS_HINTS,
  BOOKING_STATUS_LABELS,
  STAFF_STATUSES,
  bookingStatusLabel,
  type BookingChange,
  type BookingRow,
  type BookingStatus,
} from "@/components/tours/bookings/shared";

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

/** A closed booking's seats: on the departure, or not yet. */
export function SeatsChip({ state }: { state: "held" | "missing" }) {
  return state === "held" ? (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300">
      Seats held
    </span>
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
      No seats
    </span>
  );
}

const kindLabel = (row: BookingRow) => (row.kind === "card" ? "Card payment" : "Request (a rep calls back)");
const paxLabel = (row: BookingRow) => `${row.adults + row.children} (${row.adults} adults${row.children ? `, ${row.children} children` : ""})`;

/** The booking statuses staff can pick: the hand-set ones, plus "Paid" to confirm a "Check payment". */
function statusChoices(row: BookingRow): BookingStatus[] {
  if (row.status === "paid") return ["paid", "done", "cancelled"];
  const base = [...STAFF_STATUSES];
  if (row.status === "review") base.unshift("paid");
  if (!base.includes(row.status as BookingStatus)) base.unshift(row.status as BookingStatus);
  return base;
}

/**
 * One site booking on the case page: the rooms, the passengers, the price the
 * system computed, the payment, and what staff own on it (status, receipt,
 * "confirmation sent", a note). The case follows a payment by itself.
 */
export function BookingCard({
  booking,
  caseName,
  casePhone,
  seats,
  gifts,
  cancellationText,
  cancellationRules,
  withMoney,
  onChanged,
}: {
  booking: BookingRow;
  /** Whether this booking's travelers hold seats on the departure (seatGap): only for a closed booking. */
  seats?: "held" | "missing" | null;
  /** The case's own customer: a booking from someone else (a matched phone) says so. */
  caseName: string;
  casePhone: string | null;
  /** The departure's gift, shown beside the booking status (customer page, Alon 20.10). */
  gifts?: CaseGift[];
  /** The tour's cancellation terms as text, folded inside the order (customer page, Alon 20.10). */
  cancellationText?: string | null;
  /** The tour's cancellation fee rules - the fee as of today reads from them (Alon 20.10). */
  cancellationRules?: CancellationRule[];
  /** The payments log and balance instead of the receipt box (the customer page, Alon 20.10). */
  withMoney?: boolean;
  onChanged: () => void;
}) {
  const run = useActionToast();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(booking.receiptNo ?? "");
  const [note, setNote] = useState(booking.staffNote ?? "");
  const money = (value: number | null | undefined) => fmtPrice(value ?? null, booking.currency);
  const estimate = booking.priceBasis === "estimate";
  const otherCustomer = !sameCustomer({ name: booking.customerName, phone: booking.customerPhone }, { name: caseName, phone: casePhone });

  const giftOn = (gifts?.length ?? 0) > 0 || booking.giftPassengers.length > 0;
  const toggleGift = (i: number) =>
    void change({ giftPassengers: booking.giftPassengers.includes(i) ? booking.giftPassengers.filter((x) => x !== i) : [...booking.giftPassengers, i] });

  const change = async (patch: BookingChange) => {
    setBusy(true);
    const result = await run(() => updateBooking(booking.id, patch), "Booking updated");
    setBusy(false);
    if (result.success) onChanged();
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{booking.ref}</span>
        <Badge variant={STATUS_VARIANT[booking.status as BookingStatus] ?? "outline"}>{bookingStatusLabel(booking.status)}</Badge>
        {seats && <SeatsChip state={seats} />}
        <span className="text-sm text-muted-foreground">
          {kindLabel(booking)} · {fmtInstant(booking.createdAt)} · {booking.departureCode ?? EMPTY} {fmtDate(booking.departureStart)}
        </span>
        {/* at the end of the order's line (Alon 20.10) */}
        <div className="ms-auto flex items-center gap-3 rounded-md border px-3 py-1.5">
          <Label htmlFor={`confirmation-${booking.id}`} className="text-sm">
            Confirmation sent to the customer
            {booking.confirmationSentAt && <span className="block text-xs text-muted-foreground">{fmtInstant(booking.confirmationSentAt)}</span>}
          </Label>
          <Switch
            id={`confirmation-${booking.id}`}
            checked={!!booking.confirmationSentAt}
            disabled={busy}
            onCheckedChange={(checked) => void change({ confirmationSent: checked })}
          />
        </div>
      </div>

      {otherCustomer && (
        <Notice tone="warning">
          This booking was sent by {booking.customerName || booking.customerPhone}, not by the case&apos;s own customer - check it is the same family before
          you call.
        </Notice>
      )}
      {booking.status === "review" && (
        <Notice tone="error">
          CreditGuard reported a successful charge, but its amount or currency does not match this booking. Check transaction {booking.cgTxId ?? ""} in
          CreditGuard. If it is right, set the status to Paid: that adds the passengers to the departure.
        </Notice>
      )}
      {booking.status === "pending_payment" && <Notice tone="warning">The customer reached the payment page and has not paid. Call them - this is a hot lead.</Notice>}

      <div className={cn("grid gap-3", gifts && !withMoney ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Booking status</Label>
          <Select value={booking.status} disabled={busy} onValueChange={(status) => void change({ status })}>
            <SelectTrigger aria-label="Booking status">
              <SelectValue>{bookingStatusLabel(booking.status)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusChoices(booking).map((status) => (
                <SelectItem key={status} value={status} title={BOOKING_STATUS_HINTS[status]}>
                  {BOOKING_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* the departure's gift beside the status (Alon 20.10) */}
        {gifts && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Gift</span>
            <div className="flex min-h-9 items-center gap-2 rounded-md border border-rose-500/25 bg-rose-500/5 px-3 py-1.5 text-sm">
              <Gift className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />
              {gifts.length === 0 ? (
                <span className="text-muted-foreground">No gift on this departure</span>
              ) : (
                <span dir="auto" className="min-w-0">
                  {gifts.map((g) => g.label).join(" · ")}
                  {gifts[0].validUntil && <span className="text-xs text-muted-foreground"> · until {fmtDate(gifts[0].validUntil)}</span>}
                </span>
              )}
            </div>
          </div>
        )}
        {!withMoney && (
          <div className="space-y-1">
            <Label htmlFor={`receipt-${booking.id}`} className="text-xs text-muted-foreground">
              Receipt No.
            </Label>
            <Input
              id={`receipt-${booking.id}`}
              value={receipt}
              disabled={busy}
              onChange={(e) => setReceipt(e.target.value)}
              onBlur={() => receipt !== (booking.receiptNo ?? "") && void change({ receiptNo: receipt })}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            Rooms and price{" "}
            {estimate && <span className="font-normal text-muted-foreground">(what the customer saw - the system could not price this date)</span>}
          </h4>
          <FactList className="rounded-md border bg-muted/30 px-3">
            {booking.lines.map((line, i) => (
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
            {booking.seniors > 0 && <Fact label={`Senior discount (${booking.seniors})`}>−{money(Number(booking.breakdown.senior_discount ?? 0))}</Fact>}
            {Number(booking.breakdown.flight_total ?? 0) > 0 && <Fact label="Flight">{money(Number(booking.breakdown.flight_total))}</Fact>}
            <Fact label={<strong>Total on the site</strong>}>
              <strong className="tabular">{money(booking.total)}</strong>
            </Fact>
          </FactList>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Passengers · {paxLabel(booking)}</h4>
          {booking.passengers.length === 0 ? (
            <p className="text-sm text-muted-foreground">The customer did not fill in passengers.</p>
          ) : (
            <FactList className="rounded-md border bg-muted/30 px-3">
              {booking.passengers.map((p, i) => (
                <Fact key={i} label={`${i + 1}. ${p.type === "child" ? "Child" : "Adult"}`}>
                  <span className="flex items-center gap-2">
                    <span dir="auto">
                      {[p.first, p.last].filter(Boolean).join(" ") || EMPTY}
                      {p.dob ? <span className="text-muted-foreground"> · {fmtDate(p.dob)}</span> : null}
                    </span>
                    {giftOn && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleGift(i)}
                        aria-pressed={booking.giftPassengers.includes(i)}
                        title={booking.giftPassengers.includes(i) ? "Got the gift - click to take it off" : "Mark that this passenger got the gift"}
                        className={cn(
                          "ms-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold",
                          booking.giftPassengers.includes(i)
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                            : "border-dashed text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <Gift className="h-3 w-3" />
                        Gift
                      </button>
                    )}
                  </span>
                </Fact>
              ))}
            </FactList>
          )}
          {booking.note && (
            <p dir="auto" className="whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">Customer note: </span>
              {booking.note}
            </p>
          )}
        </div>
      </div>

      {withMoney && <OrderPayments key={booking.paymentLog.map((p) => p.id).join(",")} booking={booking} onChanged={onChanged} />}
      {withMoney && booking.receiptNo && !booking.paymentLog.some((p) => p.invoiceNo === booking.receiptNo) && (
        <p className="text-xs text-muted-foreground">
          Receipt No. typed on the booking before the payments log: <span className="font-mono">{booking.receiptNo}</span>
        </p>
      )}
      {booking.kind === "card" && (
        <details className="space-y-2" open={!withMoney}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4" /> {withMoney ? "Card payment details" : "Payment"}
          </summary>
          <FactList className="mt-2 rounded-md border bg-muted/30 px-3">
            <Fact label="Charged">{booking.totalIls ? fmtPrice(booking.totalIls, "ILS") : EMPTY}</Fact>
            <Fact label="Rate">
              {booking.rate ? `${booking.rate} (${booking.rateSource === "company" ? "today's rate from the Rates screen" : "automatic rate + margin"})` : EMPTY}
            </Fact>
            <Fact label="Payments">{booking.payments ?? EMPTY}</Fact>
            <Fact label="Card">{booking.cardLast4 ? `•••• ${booking.cardLast4}` : EMPTY}</Fact>
            <Fact label="CreditGuard transaction">{booking.cgTxId && <span className="font-mono text-xs">{booking.cgTxId}</span>}</Fact>
            <Fact label="Authorization">{booking.cgAuthNumber ?? EMPTY}</Fact>
            <Fact label="Paid at">{booking.paidAt ? fmtInstant(booking.paidAt) : EMPTY}</Fact>
            <Fact label="Seats">{booking.salesEntryId ? "Added to the departure" : "Not added (not paid)"}</Fact>
          </FactList>
        </details>
      )}

      {/* what cancelling costs today by the tour's fee rules, then the terms as the tour page words them (Alon 20.10) */}
      {cancellationRules && booking.status !== "cancelled" && <CancelFeeToday rules={cancellationRules} booking={booking} />}
      {cancellationText && (
        <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Cancellation terms <span className="font-normal text-muted-foreground">(as the tour page shows them)</span>
          </summary>
          <p dir="rtl" className="mt-2 whitespace-pre-line leading-6">
            {cancellationText}
          </p>
        </details>
      )}

      <div className="space-y-1">
        <Label htmlFor={`booking-note-${booking.id}`} className="text-xs text-muted-foreground">
          Staff note on the booking
        </Label>
        <Textarea
          id={`booking-note-${booking.id}`}
          dir="auto"
          rows={2}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (booking.staffNote ?? "") && void change({ staffNote: note })}
        />
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
