"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ExternalLink, Loader2, Square, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  approveDrafts,
  buildNextDraft,
  discardDrafts,
  listDrafts,
  updateDraftPayload,
} from "@/lib/actions/factory-actions";
import type { DraftStatus, EventDraft } from "@/types/factory.types";

const STATUS_STYLE: Record<DraftStatus, string> = {
  building: "bg-info-muted text-info",
  ready: "bg-success-muted text-success",
  needs_input: "bg-warning-muted text-warning",
  approved: "bg-info-muted text-info",
  created: "bg-success-muted text-success",
  error: "bg-destructive/15 text-destructive",
};

const STATUS_LABEL: Record<DraftStatus, string> = {
  building: "נבנה…",
  ready: "מוכן",
  needs_input: "חסר קלט",
  approved: "אושר",
  created: "נוצר",
  error: "שגיאה",
};

/** Inline grid input: saves on blur/Enter, amber while the field is missing. */
function InlineField({
  value,
  missing,
  numeric,
  width,
  onSave,
}: {
  value: string;
  missing?: boolean;
  numeric?: boolean;
  width: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      value={draft}
      type={numeric ? "number" : "text"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className={cn(
        "h-8",
        width,
        missing && "border-warning bg-warning-muted/60",
      )}
    />
  );
}

export function FactoryClient() {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<EventDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("all");
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [buildTotal, setBuildTotal] = useState(0);
  const buildingRef = useRef(false);
  const stopRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      setDrafts(await listDrafts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const pendingBuilds = useMemo(
    () => drafts.filter((draft) => draft.status === "building").length,
    [drafts],
  );

  // Build loop: one draft per call so nothing times out; stoppable; sequential
  // so Amadeus/hotel load stays sane.
  const runBuildLoop = useCallback(async () => {
    if (buildingRef.current) return;
    buildingRef.current = true;
    stopRef.current = false;
    try {
      for (;;) {
        if (stopRef.current) break;
        const step = await buildNextDraft();
        await reload();
        if (step.done) break;
      }
    } finally {
      buildingRef.current = false;
      setBuildTotal(0);
    }
  }, [reload]);

  useEffect(() => {
    if (pendingBuilds > 0 && !buildingRef.current) {
      setBuildTotal((current) => Math.max(current, pendingBuilds));
      void runBuildLoop();
    }
  }, [pendingBuilds, runBuildLoop]);

  const filtered = useMemo(() => {
    switch (view) {
      case "needs_input":
        return drafts.filter((draft) => draft.status === "needs_input");
      case "ready":
        return drafts.filter((draft) => draft.status === "ready");
      default:
        return drafts;
    }
  }, [drafts, view]);

  const counts = useMemo(
    () => ({
      all: drafts.length,
      needs_input: drafts.filter((d) => d.status === "needs_input").length,
      ready: drafts.filter((d) => d.status === "ready").length,
    }),
    [drafts],
  );

  const selectedIds = useMemo(
    () => Object.keys(selection).filter((id) => selection[id]),
    [selection],
  );

  const patchDraft = useCallback(
    async (
      draft: EventDraft,
      patch: Parameters<typeof updateDraftPayload>[1],
    ) => {
      const result = await updateDraftPayload(draft.id, patch);
      if (!result.ok) {
        toast({ variant: "destructive", title: "Save failed", description: result.error });
        return;
      }
      reload();
    },
    [reload, toast],
  );

  const approveSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const result = await approveDrafts(selectedIds);
    setSelection({});
    if (result.failed.length > 0) {
      toast({
        variant: "destructive",
        title: `${result.created} נוצרו, ${result.failed.length} נכשלו`,
        description: result.failed[0]?.error,
      });
    } else {
      toast({ title: `${result.created} אירועים נוצרו` });
    }
    reload();
  }, [selectedIds, reload, toast]);

  const discardSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const result = await discardDrafts(selectedIds);
    setSelection({});
    if (!result.ok) {
      toast({ variant: "destructive", title: "Delete failed" });
    }
    reload();
  }, [selectedIds, reload, toast]);

  const columns = useMemo<ColumnDef<EventDraft>[]>(
    () => [
      {
        accessorKey: "payload.name",
        id: "name",
        header: "Event",
        cell: ({ row }) => (
          <InlineField
            value={row.original.payload.name}
            width="min-w-[220px]"
            onSave={(name) => patchDraft(row.original, { name })}
          />
        ),
      },
      {
        accessorKey: "payload.date",
        id: "date",
        header: "Date",
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap text-sm">
            {row.original.payload.date}
          </span>
        ),
      },
      {
        id: "iata",
        header: "IATA",
        cell: ({ row }) => (
          <InlineField
            value={row.original.payload.location?.city_iata ?? ""}
            missing={row.original.missing.includes("city_iata")}
            width="w-20"
            onSave={(city_iata) =>
              patchDraft(row.original, {
                location: {
                  ...row.original.payload.location,
                  city_iata: city_iata.toUpperCase(),
                },
              })
            }
          />
        ),
      },
      {
        id: "flight",
        header: "Flight $",
        cell: ({ row }) => (
          <InlineField
            value={String(row.original.payload.base_flight_price ?? 0)}
            missing={row.original.missing.includes("base_flight_price")}
            numeric
            width="w-24"
            onSave={(value) =>
              patchDraft(row.original, { base_flight_price: Number(value) || 0 })
            }
          />
        ),
      },
      {
        id: "hotel",
        header: "Hotel $",
        cell: ({ row }) => (
          <InlineField
            value={String(row.original.payload.base_hotel_price ?? 0)}
            missing={row.original.missing.includes("base_hotel_price")}
            numeric
            width="w-24"
            onSave={(value) =>
              patchDraft(row.original, { base_hotel_price: Number(value) || 0 })
            }
          />
        ),
      },
      {
        id: "tickets",
        header: "Tickets",
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular text-sm",
              row.original.missing.includes("tickets") &&
                "font-semibold text-warning",
            )}
          >
            {row.original.payload.tickets_and_rates.length}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                STATUS_STYLE[row.original.status],
              )}
            >
              {STATUS_LABEL[row.original.status]}
            </span>
            {row.original.status === "created" && row.original.created_event_id && (
              <Link
                href={`/events/${row.original.created_event_id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                לאירוע
              </Link>
            )}
            {row.original.status === "error" && row.original.error && (
              <span className="max-w-[180px] truncate text-xs text-destructive" title={row.original.error}>
                {row.original.error}
              </span>
            )}
          </div>
        ),
      },
    ],
    [patchDraft],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(pendingBuilds > 0 || buildTotal > 0) && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              נבנו {Math.max(buildTotal - pendingBuilds, 0)} מתוך {buildTotal || pendingBuilds}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                stopRef.current = true;
              }}
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              עצור
            </Button>
          </div>
          <Progress
            value={
              buildTotal > 0
                ? ((buildTotal - pendingBuilds) / buildTotal) * 100
                : 0
            }
          />
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        enableRowSelection
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        getRowId={(draft) => draft.id}
        views={[
          { id: "all", label: "All", count: counts.all },
          { id: "needs_input", label: "Needs input", count: counts.needs_input },
          { id: "ready", label: "Ready", count: counts.ready },
        ]}
        activeView={view}
        onViewChange={setView}
        bulkActions={
          <>
            <Button size="sm" onClick={approveSelected}>
              <Check className="mr-1.5 h-4 w-4" />
              אשר נבחרים
            </Button>
            <Button size="sm" variant="outline" onClick={discardSelected}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              מחק
            </Button>
          </>
        }
        emptyState={{
          title: "אין טיוטות",
          description:
            "בחר אירועים בטבלת ספק (TixStock / Live / P1 / Sports) ולחץ Send to factory.",
        }}
      />
    </div>
  );
}
