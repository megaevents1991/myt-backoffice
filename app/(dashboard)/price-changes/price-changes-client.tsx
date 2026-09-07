"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  approveReviewRow,
  listSyncLog,
  type SyncLogRow,
} from "@/lib/actions/base-price-log-actions";

const STATUS_STYLE: Record<string, string> = {
  applied: "bg-success-muted text-success",
  needs_review: "bg-warning-muted text-warning",
  skipped: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
};

// The sync logs every visit since 2026-09-07 (skips included, so "why did
// nothing move" has an answer). The default view hides the skips.
const CHANGE_STATUSES = new Set(["applied", "needs_review", "error"]);

export function PriceChangesClient() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("changes");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listSyncLog("all"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(
    () =>
      view === "needs_review"
        ? rows.filter((row) => row.status === "needs_review")
        : view === "changes"
          ? rows.filter((row) => CHANGE_STATUSES.has(row.status))
          : rows,
    [rows, view],
  );

  const reviewCount = useMemo(
    () => rows.filter((row) => row.status === "needs_review").length,
    [rows],
  );

  const approve = useCallback(
    async (row: SyncLogRow) => {
      const result = await approveReviewRow(row.id);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Approve failed", description: result.error });
        return;
      }
      toast({ title: "עודכן", description: `${row.event_name ?? row.event_id} · ${row.component} → $${row.live_price}` });
      reload();
    },
    [reload, toast],
  );

  const columns = useMemo<ColumnDef<SyncLogRow>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "When",
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap text-sm">
            {new Date(row.original.created_at).toLocaleString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ),
      },
      {
        accessorKey: "event_name",
        header: "Event",
        cell: ({ row }) => (
          <Link
            href={`/events/${row.original.event_id}#fix-price`}
            className="font-medium hover:underline"
          >
            {row.original.event_name ?? `#${row.original.event_id}`}
          </Link>
        ),
      },
      {
        accessorKey: "component",
        header: "Component",
        cell: ({ row }) => (
          <span className="capitalize">{row.original.component}</span>
        ),
      },
      {
        id: "change",
        header: "Change",
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap">
            ${row.original.old_price ?? "?"} →{" "}
            <span className="font-semibold">
              ${row.original.new_price ?? row.original.live_price ?? "?"}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
              STATUS_STYLE[row.original.status] ?? "bg-muted text-muted-foreground",
            )}
          >
            {row.original.status === "needs_review" ? "needs review" : row.original.status}
          </span>
        ),
      },
      {
        accessorKey: "note",
        header: "Why",
        cell: ({ row }) => (
          <span className="block max-w-[28rem] truncate text-xs text-muted-foreground" title={row.original.note ?? ""}>
            {row.original.note ?? ""}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.status === "needs_review" ? (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => approve(row.original)}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                אשר עדכון
              </Button>
            </div>
          ) : null,
      },
    ],
    [approve],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchColumn="event_name"
      searchPlaceholder="Search events..."
      views={[
        {
          id: "changes",
          label: "Changes",
          count: rows.filter((row) => CHANGE_STATUSES.has(row.status)).length,
        },
        { id: "needs_review", label: "Needs review", count: reviewCount },
        { id: "all", label: "All visits", count: rows.length },
      ]}
      activeView={view}
      onViewChange={setView}
      emptyState={{
        title: loading ? "Loading…" : "ה־cron עוד לא רץ",
        description: loading
          ? undefined
          : "אחרי הריצה הלילית הראשונה כל עדכון מחיר יופיע כאן.",
      }}
    />
  );
}
