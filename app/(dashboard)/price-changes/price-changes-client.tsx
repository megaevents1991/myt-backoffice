"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ClipboardCheck, ListTodo, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TaskEditor, type TaskEditorState } from "@/components/task-editor";
import {
  approveReviewRow,
  listSyncLog,
  removeEventFromSite,
  resolveReviewRow,
  type SyncLogRow,
} from "@/lib/actions/base-price-log-actions";
import { openTaskGapKeys } from "@/lib/actions/task-actions";
import { ADMIN_ROLES } from "@/types/auth.types";
import { gapKey } from "@/types/creative-gap.types";

const STATUS_STYLE: Record<string, string> = {
  applied: "bg-success-muted text-success",
  needs_review: "bg-warning-muted text-warning",
  skipped: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
  // Closed from the Pricing tab / a price_review task, not by the cron or an
  // admin here (lib/services/gap-resolution.ts, lib/actions/pricing-gap-actions.ts).
  reviewed: "bg-success-muted text-success",
};

const STATUS_LABEL: Record<string, string> = {
  needs_review: "needs review",
  reviewed: "נבדק",
};

// The sync logs every visit since 2026-09-07 (skips included, so "why did
// nothing move" has an answer). The default view hides the skips.
const CHANGE_STATUSES = new Set(["applied", "needs_review", "error"]);

/** One open task per event - the key the task's source_ref resolves to. */
const taskKeyOf = (row: SyncLogRow) => gapKey("price_review", "events", row.event_id);

export function PriceChangesClient() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = !!user && (ADMIN_ROLES as readonly string[]).includes(user.role);
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("changes");
  // Events that already have an open price-review task.
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<TaskEditorState>({ open: false, task: null });
  const [removing, setRemoving] = useState<SyncLogRow | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [log, keys] = await Promise.all([
        listSyncLog("all"),
        openTaskGapKeys("price_review"),
      ]);
      setRows(log);
      setTaken(new Set(keys));
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

  // "עודכן באירוע" - the price was set by hand inside the event; close the
  // row with whatever the event holds now, without touching the event.
  const resolve = useCallback(
    async (row: SyncLogRow) => {
      const result = await resolveReviewRow(row.id);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Resolve failed", description: result.error });
        return;
      }
      const unchanged = row.old_price != null && result.current === row.old_price;
      toast({
        title: unchanged ? "סומן - אבל האירוע לא השתנה" : "סומן כעודכן",
        description: `${row.event_name ?? row.event_id} · ${row.component} · באירוע עכשיו $${result.current}`,
        ...(unchanged ? { variant: "destructive" as const } : {}),
      });
      reload();
    },
    [reload, toast],
  );

  // "הסר מהאתר" - soft-deletes the event and closes its review rows.
  const remove = useCallback(
    async (row: SyncLogRow) => {
      const result = await removeEventFromSite(row.id);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Remove failed", description: result.error });
        return;
      }
      toast({ title: "האירוע הוסר מהאתר", description: row.event_name ?? `#${row.event_id}` });
      reload();
    },
    [reload, toast],
  );

  // Hands the frozen row to someone as a task - same flow as a creative gap,
  // keyed on the event so a second night's freeze does not spawn a duplicate.
  const createTaskFor = useCallback((row: SyncLogRow) => {
    const label = row.event_name ?? `#${row.event_id}`;
    setEditor({
      open: true,
      task: null,
      prefill: {
        title: `בדיקת מחיר: ${label} (${row.component})`,
        description: [
          `$${row.old_price ?? "?"} → $${row.live_price ?? row.new_price ?? "?"}`,
          row.event_date ? `תאריך האירוע: ${row.event_date}` : "",
          row.note ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
        priority: "high",
        source: "price_review",
        source_ref: {
          kind: "price_review",
          table: "events",
          row_id: row.event_id,
          label,
          url: `/events/${row.event_id}#fix-price`,
        },
        origin: `From price review: ${label}`,
      },
    });
  }, []);

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
        accessorKey: "event_date",
        header: "Event date",
        cell: ({ row }) =>
          row.original.event_date ? (
            <span className="tabular whitespace-nowrap text-sm">
              {new Date(row.original.event_date).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
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
            {STATUS_LABEL[row.original.status] ?? row.original.status}
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
        cell: ({ row }) => {
          if (row.original.status !== "needs_review") return null;
          const hasTask = taken.has(taskKeyOf(row.original));
          return (
            <div className="flex justify-end gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                title="המחיר כבר עודכן ידנית בתוך האירוע - סגור את השורה בלי לחכות ל-cron"
                onClick={() => resolve(row.original)}
              >
                <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                עודכן באירוע
              </Button>
              <Button size="sm" variant="outline" onClick={() => approve(row.original)}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                אשר עדכון
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={hasTask}
                title={hasTask ? "כבר יש משימה פתוחה לאירוע הזה" : "פתח משימה למישהו בצוות"}
                onClick={() => createTaskFor(row.original)}
              >
                <ListTodo className="mr-1.5 h-3.5 w-3.5" />
                {hasTask ? "Task exists" : "Create task"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                title="הסר את האירוע מהאתר (מחיקה רכה)"
                onClick={() => setRemoving(row.original)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                הסר מהאתר
              </Button>
            </div>
          );
        },
      },
    ],
    [approve, resolve, createTaskFor, taken],
  );

  return (
    <>
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

    <TaskEditor
      key={`${editor.prefill?.source_ref.row_id ?? "new"}-${editor.open}`}
      state={editor}
      isManager={isManager}
      onClose={() => setEditor({ open: false, task: null })}
      onSaved={() => {
        setEditor({ open: false, task: null });
        reload();
      }}
    />

    <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>להסיר את האירוע מהאתר?</AlertDialogTitle>
          <AlertDialogDescription>
            {removing?.event_name ?? `#${removing?.event_id}`}
            {removing?.event_date ? ` · ${removing.event_date}` : ""} יוסר מהאתר (מחיקה רכה,
            כמו בטבלת האירועים) וכל שורות הבדיקה שלו ייסגרו.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (removing) remove(removing);
              setRemoving(null);
            }}
          >
            הסר מהאתר
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
