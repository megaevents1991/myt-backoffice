"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { WidgetCard } from "@/components/dashboard/widget-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getApprovalsQueue, type ApprovalsData } from "@/lib/actions/tours-approvals-actions";

interface Row {
  label: string;
  count: number;
}

/** The Approvals queue in numbers - what waits for the company's manager. */
function rowsOf(data: ApprovalsData): Row[] {
  return [
    { label: "Flight blocks waiting for approval", count: data.awaitingApproval.total },
    { label: `Cancellation decisions (${data.decisionWindowDays} days)`, count: data.cancelDecisions.total },
    { label: "Live flight blocks not reviewed", count: data.review.total },
    { label: "Published without a live flight", count: data.departuresWithoutBlock.length },
    { label: "Published without a price", count: data.departuresWithoutPrice.length },
    { label: "Hotels not in the catalog", count: data.unmatchedHotels.length },
  ];
}

/** Dashboard card of a tours company's manager: the open items of the Approvals screen. */
export function NeedsAttention() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApprovalsQueue().then((result) => {
      if (result.success) setRows(rowsOf(result.data));
      else setError(result.error);
    });
  }, []);

  const open = rows?.filter((row) => row.count > 0) ?? [];

  return (
    <WidgetCard title="Needs attention" href="/tours/approvals" linkLabel="Approvals">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows === null ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : open.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Nothing waits for a decision.
          </div>
        ) : (
          open.map((row) => (
            <Link
              key={row.label}
              href="/tours/approvals"
              className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2 transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                {row.count.toLocaleString("en-US")}
              </span>
            </Link>
          ))
        )}
    </WidgetCard>
  );
}
