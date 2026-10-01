"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { WidgetCard } from "@/components/dashboard/widget-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionData } from "@/hooks/use-action-data";
import { getApprovalsQueue, type ApprovalsData } from "@/lib/actions/tours-approvals-actions";
import { CountBadge, LoadError } from "@/components/tours/ui";

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
  const { data, error, loading, reload } = useActionData(() => getApprovalsQueue(), []);
  const open = data ? rowsOf(data).filter((row) => row.count > 0) : [];

  return (
    <WidgetCard title="Needs attention" href="/tours/approvals" linkLabel="Approvals">
      {error && !loading ? (
        <LoadError message={error} onRetry={() => void reload()} />
      ) : !data ? (
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
            <CountBadge count={row.count} />
          </Link>
        ))
      )}
    </WidgetCard>
  );
}
