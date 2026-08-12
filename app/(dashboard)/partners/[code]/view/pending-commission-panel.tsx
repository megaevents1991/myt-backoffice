"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  markReservationsBilled,
  type UnbilledCommissionRow,
} from "@/lib/actions/partner-billing-actions";

const usdExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * Unbilled commission with a manual "already reported" mark.
 *
 * When a monthly report goes out by hand instead of through the cron, the
 * reservations stay "pending" everywhere. Staff tick the rows that report
 * covered and stamp them - the partner's portal stops showing them as owed.
 */
export function PendingCommissionPanel({
  trackingCode,
  rows,
}: {
  trackingCode: string;
  rows: UnbilledCommissionRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selectedTotal = useMemo(
    () =>
      rows
        .filter((row) => selected.has(row.id))
        .reduce((sum, row) => sum + row.commissionUsd, 0),
    [rows, selected],
  );

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));

  const markBilled = () => {
    if (selected.size === 0) return;
    startTransition(async () => {
      try {
        const stamped = await markReservationsBilled(trackingCode, [
          ...selected,
        ]);
        toast({
          title: "Marked as reported",
          description: `${stamped} reservation(s) will no longer show as pending.`,
        });
        setSelected(new Set());
        router.refresh();
      } catch (error) {
        console.error("markReservationsBilled failed:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Could not mark reservations as reported.",
        });
      }
    });
  };

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pending commission
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>
          Paid reservations not yet in any monthly report. If a report already
          went out manually, select what it covered and mark it - the partner
          will stop seeing it as owed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Reservation</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => toggle(row.id)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Select reservation ${row.id}`}
                  />
                </TableCell>
                <TableCell className="font-medium">#{row.id}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {new Date(row.created_at).toLocaleDateString("he-IL")}
                </TableCell>
                <TableCell>{row.customer ?? "-"}</TableCell>
                <TableCell className="max-w-[16rem] truncate">
                  {row.event ?? "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usdExact.format(row.commissionUsd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {selected.size} selected · {usdExact.format(selectedTotal)}
          </span>
          <Button
            onClick={markBilled}
            disabled={isPending || selected.size === 0}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Mark as reported
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
