"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Check, ListTodo, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
export function PricingGapsTab({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
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
  const [minGap, setMinGap] = useState("");
  // On by default (brief): the point of this tab is what still needs a human,
  // and a row someone already picked up is not that.
  const [hideWithTask, setHideWithTask] = useState(true);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scopeOptions = useMemo(() => {
    const scopes = new Set<string>();
    for (const row of rows ?? []) scopes.add(row.scope);
    return [...scopes];
  }, [rows]);

  const visible = useMemo(() => {
    return (rows ?? []).filter((row) => {
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      if (scopeFilter !== "all" && row.scope !== scopeFilter) return false;
      if (hideWithTask && row.openTaskId) return false;
      const min = Number(minGap);
      if (minGap.trim() !== "" && Number.isFinite(min) && (row.gapUsd ?? 0) < min) return false;
      return true;
    });
  }, [rows, sourceFilter, scopeFilter, hideWithTask, minGap]);

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
        await load();
      } finally {
        setBusyKey(null);
      }
    },
    [toast, load],
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
            <Input
              type="number"
              inputMode="numeric"
              placeholder="סף פער $"
              value={minGap}
              onChange={(e) => setMinGap(e.target.value)}
              className="h-8 w-[110px]"
            />
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
