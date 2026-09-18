"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Check, ExternalLink, ListTodo, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listPricingGaps,
  markPricingGapHandled,
  openPricingGapTask,
} from "@/lib/actions/pricing-gap-actions";
import { eventSiteUrl } from "@/lib/site";
import type { PricingGapRow, PricingGapSource } from "@/types/pricing-gap.types";

const SOURCE_LABEL: Record<PricingGapSource, string> = {
  price_light: "רמזור",
  price_changes: "שינוי מחיר",
};

const SOURCE_STYLE: Record<PricingGapSource, string> = {
  price_light: "bg-destructive/15 text-destructive",
  price_changes: "bg-warning-muted text-warning",
};

const SCOPE_LABEL: Record<string, string> = {
  package: "חבילה",
  ticket: "כרטיס",
  price_review: "שינוי מחיר",
};

/** Pricing tab on /tasks (Task 15, 2026-09-16): every open pricing gap - red price
 *  lights + frozen base-price changes - in one list. Visible to all staff, unlike
 *  the admin-only /price-light screen (Dor, 16.09). */
export function PricingGapsTab({
  onOpenTask,
  onTasksChanged,
}: {
  onOpenTask: (taskId: string) => void;
  /** Reload the parent's task list, so a task created here can be opened right away. */
  onTasksChanged?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<PricingGapRow[] | null>(null);
  // A whole-call failure (auth/unexpected - requireStaff() itself, say): nothing loaded at all.
  const [fatalError, setFatalError] = useState<string | null>(null);
  // Per-source failures (controller ruling #2): one generator can throw while the other's rows
  // still show - each gets its own banner instead of one hiding both.
  const [sourceErrors, setSourceErrors] = useState<{ source: PricingGapSource; error: string }[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [sourceFilter, setSourceFilter] = useState<PricingGapSource | "all">("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  // Gap range, both ends (Alon, 18.09: "עד הפרש מסויים ולא מהפרש מסויים, או סרגל
  // טווח כמו במלון"). null = untouched = every row, unknown gaps included.
  const [gapRange, setGapRange] = useState<[number, number] | null>(null);
  // On by default (brief): the point of this tab is what still needs a human,
  // and a row someone already picked up is not that.
  const [hideWithTask, setHideWithTask] = useState(true);

  const load = useCallback(async () => {
    try {
      const result = await listPricingGaps();
      if (!result.ok) {
        setRows([]);
        setFatalError(result.error);
        setSourceErrors([]);
        return;
      }
      setRows(result.rows);
      setFatalError(null);
      setSourceErrors(result.errors);
    } catch (error) {
      // A thrown action (network, masked server error) must not leave the skeleton up forever.
      console.error("pricing-gaps: load failed", error);
      setRows([]);
      setFatalError(error instanceof Error ? error.message : "הטעינה נכשלה");
      setSourceErrors([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scopeOptions = useMemo(() => {
    const scopes = new Set<string>();
    for (const row of rows ?? []) scopes.add(row.scope);
    return [...scopes];
  }, [rows]);

  // The slider's ceiling: the biggest gap on the list, rounded up to a whole $10.
  const gapCeiling = useMemo(() => {
    const max = Math.max(0, ...(rows ?? []).map((row) => row.gapUsd ?? 0));
    return Math.max(10, Math.ceil(max / 10) * 10);
  }, [rows]);
  const gapFiltered = gapRange !== null && (gapRange[0] > 0 || gapRange[1] < gapCeiling);

  const visible = useMemo(() => {
    return (rows ?? []).filter((row) => {
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      if (scopeFilter !== "all" && row.scope !== scopeFilter) return false;
      if (hideWithTask && row.openTaskId) return false;
      if (gapFiltered && gapRange) {
        // A narrowed range is a statement about a number - a row with no number is out.
        if (row.gapUsd == null) return false;
        if (row.gapUsd < gapRange[0] || row.gapUsd > gapRange[1]) return false;
      }
      return true;
    });
  }, [rows, sourceFilter, scopeFilter, hideWithTask, gapRange, gapFiltered]);

  const createTask = useCallback(
    async (row: PricingGapRow) => {
      setBusyKey(row.key);
      try {
        const result = await openPricingGapTask(row.key);
        if (!result.ok) {
          toast({ variant: "destructive", title: "פתיחת המשימה נכשלה", description: result.error });
          return;
        }
        toast({ title: result.existed ? "כבר יש משימה פתוחה" : "נוצרה משימה" });
        await Promise.all([load(), onTasksChanged?.()]);
      } catch (error) {
        console.error("pricing-gaps: open task failed", error);
        toast({ variant: "destructive", title: "פתיחת המשימה נכשלה" });
      } finally {
        setBusyKey(null);
      }
    },
    [toast, load, onTasksChanged],
  );

  const markHandled = useCallback(
    async (row: PricingGapRow) => {
      setBusyKey(row.key);
      try {
        const result = await markPricingGapHandled(row.key);
        if (!result.ok) {
          toast({ variant: "destructive", title: "הפעולה נכשלה", description: result.error });
          return;
        }
        toast({ title: "נרשם", description: "אם הפער יישאר בבדיקה הלילית הוא יחזור" });
        await load();
      } catch (error) {
        console.error("pricing-gaps: mark handled failed", error);
        toast({ variant: "destructive", title: "הפעולה נכשלה" });
      } finally {
        setBusyKey(null);
      }
    },
    [toast, load],
  );

  const columns = useMemo<ColumnDef<PricingGapRow>[]>(
    () => [
      {
        accessorKey: "eventName",
        header: "אירוע",
        cell: ({ row }) => (
          <Link href={row.original.fixUrl} className="font-medium hover:underline">
            {row.original.eventName}
          </Link>
        ),
      },
      {
        accessorKey: "source",
        header: "מקור",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
              SOURCE_STYLE[row.original.source],
            )}
          >
            {SOURCE_LABEL[row.original.source]}
          </span>
        ),
      },
      {
        accessorKey: "scope",
        header: "סקופ",
        cell: ({ row }) => (
          <span className="text-sm">{SCOPE_LABEL[row.original.scope] ?? row.original.scope}</span>
        ),
      },
      {
        accessorKey: "gapUsd",
        header: "פער ב-$",
        cell: ({ row }) =>
          row.original.gapUsd != null ? (
            <span className="tabular font-semibold">${row.original.gapUsd}</span>
          ) : (
            <span className="text-muted-foreground">?</span>
          ),
      },
      {
        accessorKey: "since",
        header: "מאז",
        cell: ({ row }) => (
          <span className="tabular text-sm text-muted-foreground">{row.original.since ?? "—"}</span>
        ),
      },
      {
        id: "task",
        header: "משימה",
        cell: ({ row }) =>
          row.original.openTaskId ? (
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0"
              onClick={() => onOpenTask(row.original.openTaskId as string)}
            >
              יש משימה פתוחה
            </Button>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const busy = busyKey === row.original.key;
          return (
            <div className="flex justify-end gap-1.5">
              {!row.original.openTaskId && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => createTask(row.original)}>
                  <ListTodo className="mr-1.5 h-3.5 w-3.5" />
                  משימה
                </Button>
              )}
              <Button size="sm" variant="ghost" asChild>
                <Link href={row.original.fixUrl}>
                  <Wrench className="mr-1.5 h-3.5 w-3.5" />
                  לתקן
                </Link>
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={eventSiteUrl(row.original.eventId)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  באתר
                </a>
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => markHandled(row.original)}>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                טופל
              </Button>
            </div>
          );
        },
      },
    ],
    [busyKey, createTask, markHandled, onOpenTask],
  );

  if (rows === null) {
    return <Skeleton className="h-64 w-full" />;
  }

  const hasError = Boolean(fatalError) || sourceErrors.length > 0;

  return (
    <div className="space-y-3">
      {fatalError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>טעינת פערי התמחור נכשלה</AlertTitle>
          <AlertDescription>{fatalError}</AlertDescription>
        </Alert>
      )}
      {sourceErrors.map((e) => (
        <Alert variant="destructive" key={e.source}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>טעינת {SOURCE_LABEL[e.source]} נכשלה</AlertTitle>
          <AlertDescription>{e.error}</AlertDescription>
        </Alert>
      ))}
      <DataTable
        columns={columns}
        data={visible}
        getRowId={(row) => row.key}
        searchColumn="eventName"
        searchPlaceholder="חיפוש אירוע..."
        emptyState={{
          title: hasError ? "אין מה להציג" : "אין פערי תמחור פתוחים",
          description: hasError
            ? "נסו לרענן את הדף - ראו את השגיאה למעלה."
            : "כל האורות ירוקים ואין שינויי מחיר תקועים.",
        }}
        filters={
          <div className="flex flex-wrap items-center gap-3">
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as PricingGapSource | "all")}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue placeholder="מקור" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המקורות</SelectItem>
                <SelectItem value="price_light">רמזור</SelectItem>
                <SelectItem value="price_changes">שינוי מחיר</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue placeholder="סקופ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסקופים</SelectItem>
                {scopeOptions.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {SCOPE_LABEL[scope] ?? scope}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2" dir="ltr">
              <span className="tabular w-10 text-right text-xs text-muted-foreground">
                ${gapRange?.[0] ?? 0}
              </span>
              <Slider
                value={gapRange ?? [0, gapCeiling]}
                onValueChange={([from, to]) => setGapRange([from ?? 0, to ?? gapCeiling])}
                min={0}
                max={gapCeiling}
                step={10}
                minStepsBetweenThumbs={1}
                className="w-[180px]"
                aria-label="טווח פער בדולרים"
              />
              <span className="tabular w-12 text-xs text-muted-foreground">
                ${Math.min(gapRange?.[1] ?? gapCeiling, gapCeiling)}
              </span>
              {gapFiltered && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setGapRange(null)}
                >
                  נקה
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={hideWithTask} onCheckedChange={setHideWithTask} />
              רק בלי משימה
            </label>
          </div>
        }
      />
    </div>
  );
}
