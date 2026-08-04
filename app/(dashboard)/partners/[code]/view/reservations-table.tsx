"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PAID_STATUS } from "@/lib/partner-commission";
import type { PartnerPerformanceReservation } from "@/lib/actions/partner-performance-actions";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The partner's attributed reservations, with a Paid-only switch. */
export function ReservationsTable({
  reservations,
}: {
  reservations: PartnerPerformanceReservation[];
}) {
  const [paidOnly, setPaidOnly] = useState(false);
  const paidCount = reservations.filter((r) => r.status === PAID_STATUS).length;
  const shown = paidOnly
    ? reservations.filter((r) => r.status === PAID_STATUS)
    : reservations;

  const chip = (active: boolean) =>
    cn(
      "rounded border px-2 py-1 text-xs",
      active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
    );

  if (reservations.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No reservations attributed to this partner yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Show:</span>
        <button type="button" className={chip(!paidOnly)} onClick={() => setPaidOnly(false)}>
          All ({reservations.length})
        </button>
        <button type="button" className={chip(paidOnly)} onClick={() => setPaidOnly(true)}>
          Paid only ({paidCount})
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No paid reservations in this period.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((reservation) => (
              <TableRow key={reservation.id}>
                <TableCell>
                  {new Date(reservation.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>{reservation.customer_name}</TableCell>
                <TableCell className="max-w-[16rem] truncate">
                  {reservation.event_title}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      reservation.status === PAID_STATUS ? "default" : "secondary"
                    }
                  >
                    {reservation.status || "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{reservation.tickets}</TableCell>
                <TableCell className="text-right">
                  {usd.format(reservation.sales_usd)}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {reservation.commission_usd > 0
                    ? usd.format(reservation.commission_usd)
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
