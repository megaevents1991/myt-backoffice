"use client";

/**
 * Offline Flights of a tours company as a spreadsheet (Alon, 04.10.2026): every
 * flight block, series by series, edited like the departures sheet - click a
 * cell and type, paste a block, tick rows and "Set for selected", one Save.
 *
 * Details / Operations switch the columns over the same rows: Details is the
 * flight itself and its costs; Operations is the work on the block - status,
 * seats, when it was requested and every deadline (when to release, when to
 * cancel, when to send names and ticket). Both start with the tour code: the
 * sub-tours the flight serves (BBC712).
 *
 * Grid: ../sheet/sheet-grid.tsx. Model: ./flights-sheet-model.ts. Server:
 * lib/actions/tours-flights-sheet-actions.ts - every write goes through the
 * rules of the flight's own page.
 */
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useActionData } from "@/hooks/use-action-data";
import { LoadError, Ltr, selectClass, Toggle } from "@/components/tours/ui";
import { BlockStatusBadge } from "@/components/tours/flights/block-ui";
import { CreateSubToursDialog } from "@/components/tours/flights/create-sub-tours-dialog";
import { stageOf } from "@/components/tours/flights/block-rules";
import { SheetGrid, type SheetGroup, type SheetSaveAnswer } from "@/components/tours/sheet/sheet-grid";
import { fmtLocalTime, type SheetColumn as CoreColumn, type SheetRowChange, type SheetValue } from "@/components/tours/sheet/sheet-core";
import { getFlightsSheet, saveFlightsSheet } from "@/lib/actions/tours-flights-sheet-actions";
import { daysBetween } from "@/lib/tours/deadlines";
import { fmtDate } from "@/lib/tours/format";
import { blockHref, departureHref, linkClass } from "@/lib/tours/links";
import { BLOCK_STATUSES, BLOCK_STATUS_LABELS } from "@/types/tours.types";
import {
  FLIGHT_COLUMNS,
  FLIGHT_VIEW_LABELS,
  FLIGHT_VIEWS,
  flightCellValue,
  flightColumnsFor,
  statusOptions,
  type FlightSheetRow,
  type FlightView,
} from "./flights-sheet-model";

const DEADLINE_KEYS = new Set(["optionExpiry", "firstCancel", "lastCancel", "namesDeadline", "ticketingDeadline", "paymentDeadline"]);
/** A block that is over: its deadlines are no longer a warning. */
const CLOSED = new Set(["ticketed", "cancelled", "declined"]);
const NO_SERIES = "";
/** The "All series" choice of the filter - not a name a series can have. */
const ALL_SERIES = "*";

const HINTS: Record<FlightView, string> = {
  details: "The flight itself: both legs, baggage, stops, costs. Moving a flight's date moves its sub-tour with it while nothing was sold on it.",
  operations:
    "The work on each block: the next step of its status, the seats (lowering the count releases seats and is written to the block's timeline) and every deadline - red once it has passed, amber within a week. Declining or cancelling a block is done on its page, where the reason is asked for.",
};

export function FlightsSheet() {
  const [includePast, setIncludePast] = useState(false);
  const sheet = useActionData(() => getFlightsSheet({ includePast }), [includePast]);
  const data = sheet.data;

  const [view, setView] = useState<FlightView>("details");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [series, setSeries] = useState<string | null>(null);
  const [noTour, setNoTour] = useState(false);
  const [dirty, setDirty] = useState(false);
  // "Create sub-tours" on a series: its flights that no date takes seats from
  const [subTours, setSubTours] = useState<{ series: string; flightIds: number[] } | null>(null);

  const rowsById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  const columns = useMemo(() => flightColumnsFor(view), [view]);
  const today = data?.today ?? "";
  const seriesNames = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.series ?? NO_SERIES))].sort((a, b) => a.localeCompare(b)),
    [data],
  );

  const groups = useMemo((): SheetGroup<FlightSheetRow>[] => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const keep = (r: FlightSheetRow) =>
      (series === null || (r.series ?? NO_SERIES) === series) &&
      (!status || stageOf(r.status) === status) &&
      (!noTour || r.tours.length === 0) &&
      (!q ||
        String(r.flightId).includes(q) ||
        (r.series ?? "").toLowerCase().includes(q) ||
        (r.pnr ?? "").toLowerCase().includes(q) ||
        r.outNumber.toLowerCase().includes(q) ||
        r.inNumber.toLowerCase().includes(q) ||
        r.tours.some((t) => t.code.toLowerCase().includes(q)));
    // series in the order of their first flight; the rows inside come sorted by date
    const bySeries = new Map<string, FlightSheetRow[]>();
    for (const r of data.rows) {
      if (!keep(r)) continue;
      const key = r.series ?? NO_SERIES;
      bySeries.set(key, [...(bySeries.get(key) ?? []), r]);
    }
    return [...bySeries.entries()].map(([name, rows]) => {
      // a cancelled or declined block carries no trip - the server would skip it too
      const bare = rows.filter((r) => r.tours.length === 0 && !["cancelled", "declined"].includes(stageOf(r.status)));
      return {
        key: name || "(none)",
        rows,
        selectLabel: `Select the flights of ${name || "no series"}`,
        header: (
          <>
            {name ? <Ltr className="font-mono text-sm font-bold">{name}</Ltr> : <span className="font-semibold">No series</span>}
            <span className="text-xs text-muted-foreground">{rows.length} flight(s)</span>
            <span className="text-xs text-muted-foreground">
              <Ltr>
                {fmtDate(rows[0].outDepart)} - {fmtDate(rows[rows.length - 1].inDepart)}
              </Ltr>
            </span>
            {rows.some((r) => r.tours.length === 0) && (
              <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {rows.filter((r) => r.tours.length === 0).length} with no sub-tour
              </span>
            )}
            {bare.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                disabled={dirty}
                title={
                  dirty
                    ? "Save or discard your changes first"
                    : "Open a date of a tour for each of these flights - the flight's dates, route and seats"
                }
                onClick={() => setSubTours({ series: name, flightIds: bare.map((r) => r.flightId) })}
              >
                <Plus />
                Create sub-tours
              </Button>
            )}
          </>
        ),
      };
    });
  }, [data, search, status, series, noTour, dirty]);

  const save = useCallback(
    async (changes: SheetRowChange[]): Promise<SheetSaveAnswer> => {
      const res = await saveFlightsSheet(changes);
      if (!res.success) return { ok: false, error: res.error };
      const fresh = new Map(res.data.rows.map((r) => [r.id, r]));
      sheet.setData((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => fresh.get(r.id) ?? r) } : prev));
      return { ok: true, saved: res.data.saved, skipped: res.data.skipped };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setData is stable for the life of the sheet
    [],
  );

  const readonlyText = useCallback((row: FlightSheetRow, key: string): string => {
    switch (key) {
      case "tourCode":
        return row.tours.map((t) => t.code).join(", ");
      case "flies":
        return `${fmtLocalTime(row.outDepart)} → ${fmtDate(row.inDepart)}`;
      case "seatsShown":
        return String(row.seats);
      case "originalSeats":
        return row.originalSeats == null ? "" : String(row.originalSeats);
      case "allocated":
        return String(row.allocated);
      case "left":
        return String(row.seats - row.allocated);
      case "cancelled":
        return row.cancelled ?? "";
      default:
        return "";
    }
  }, []);

  const renderCell = useCallback(
    (row: FlightSheetRow, col: CoreColumn, value: SheetValue) => {
      if (col.key === "tourCode") {
        return row.tours.length ? (
          <span className="flex gap-1.5 font-mono text-xs font-semibold">
            {row.tours.map((t) => (
              <Link
                key={t.code}
                href={departureHref(t.code, "flights")}
                target="_blank"
                className={linkClass}
                title={`Open the sub-tour ${t.code}${t.seats ? ` (${t.seats} seats of this block)` : ""}`}
              >
                {t.code}
              </Link>
            ))}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-amber-700 dark:text-amber-400" title="No sub-tour takes seats from this flight yet">
              No sub-tour
            </span>
            {/* this flight alone: a date of the tour with this code - a date that exists on its day takes the flight (Alon, 08.10.2026) */}
            {!["cancelled", "declined"].includes(stageOf(row.status)) && (
              <button
                type="button"
                className={linkClass}
                disabled={dirty}
                title={dirty ? "Save or discard your changes first" : "Open a date of a tour for this flight, or link it to the date that already exists on its day - type the tour code"}
                onClick={() => setSubTours({ series: row.series ?? "", flightIds: [row.flightId] })}
              >
                Link / create
              </button>
            )}
          </span>
        );
      }
      if (col.key === "status") return <BlockStatusBadge status={typeof value === "string" ? value : null} />;
      if (col.key === "left") {
        const left = row.seats - row.allocated;
        return <span className={cn("tabular-nums", left < 0 && "font-semibold text-destructive")}>{left}</span>;
      }
      if (col.key === "cancelled" && row.cancelled) {
        return (
          <span className="text-xs text-destructive" dir="auto" title={row.cancelled}>
            {row.cancelled}
          </span>
        );
      }
      if (DEADLINE_KEYS.has(col.key) && typeof value === "string" && today && !CLOSED.has(stageOf(row.status))) {
        const left = daysBetween(today, value);
        if (left <= 7) {
          return (
            <span
              className={cn("font-semibold tabular-nums", left <= 0 ? "text-destructive" : "text-amber-700 dark:text-amber-400")}
              title={left < 0 ? `${-left} day(s) overdue` : left === 0 ? "Today" : `In ${left} day(s)`}
            >
              {fmtDate(value)}
            </span>
          );
        }
      }
      return undefined;
    },
    [today, dirty],
  );

  const optionsOf = useCallback((row: FlightSheetRow, col: CoreColumn) => (col.key === "status" ? statusOptions(row.status) : undefined), []);
  const isManager = data?.isManager === true;
  const lockedCell = useCallback(
    (row: FlightSheetRow, col: CoreColumn) =>
      (col.key === "reviewed" && !isManager) || (col.key === "status" && statusOptions(row.status).length < 2 && stageOf(row.status) !== "draft"),
    [isManager],
  );

  if (sheet.error && !data) return <LoadError message={sheet.error} onRetry={() => void sheet.reload()} />;
  if (!data) return <Skeleton className="h-96 w-full" />;

  return (
    <>
    {subTours && (
      <CreateSubToursDialog
        seriesName={subTours.series}
        flightIds={subTours.flightIds}
        onClose={() => setSubTours(null)}
        onDone={() => void sheet.reload({ quiet: true })}
      />
    )}
    <SheetGrid<FlightSheetRow>
      columns={columns}
      allColumns={FLIGHT_COLUMNS}
      groups={groups}
      rowsById={rowsById}
      cellValue={flightCellValue}
      readonlyText={readonlyText}
      renderCell={renderCell}
      optionsOf={optionsOf}
      lockedCell={lockedCell}
      rowName={(row) => `flight ${row.flightId}`}
      rowHead={(row) => (
        <Link href={blockHref(row.flightId)} target="_blank" className={linkClass} title="Open the flight's page: timeline, allocations, contract, cancel">
          #{row.flightId}
        </Link>
      )}
      headLabel="Flight"
      headWidth={76}
      noun="flight"
      ariaLabel="Offline flights sheet"
      bulkDefaultKey={view === "operations" ? "handledBy" : "seasonLabel"}
      onDirtyChange={setDirty}
      save={save}
      hint={
        <>
          Click a cell and type, or paste a block from Excel / Google Sheets. Enter or double-click edits, Delete clears, arrows
          and Tab move; tick rows and &ldquo;Set for selected&rdquo; to change many at once. {HINTS[view]} Nothing is saved until
          you press Save.
        </>
      }
      empty={
        data.rows.length === 0 ? (
          <>
            No flights yet. Open a whole series with{" "}
            <Link href="/offline-flights/series/new" className={linkClass}>
              New Series
            </Link>{" "}
            (tick &ldquo;Organized tour&rdquo; and give the tour code - every flight opens its sub-tour), or one flight with Add
            New Flight.
          </>
        ) : (
          "No flights match. Clear the filters, or show past flights."
        )
      }
      filters={
        <>
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Columns">
            {FLIGHT_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {FLIGHT_VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tour code, series, PNR, flight"
              className="h-9 w-56 ps-8"
            />
          </div>
          {seriesNames.length > 1 && (
            <select
              className={selectClass}
              value={series === null ? ALL_SERIES : series}
              onChange={(e) => setSeries(e.target.value === ALL_SERIES ? null : e.target.value)}
              aria-label="Series"
            >
              <option value={ALL_SERIES}>All series</option>
              {seriesNames.map((name) => (
                <option key={name || "(none)"} value={name}>
                  {name || "No series"}
                </option>
              ))}
            </select>
          )}
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            {BLOCK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BLOCK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={noTour} onCheckedChange={(v) => setNoTour(v === true)} />
            No sub-tour
          </label>
          <label className="flex items-center gap-1.5 text-sm" title={dirty ? "Save or discard your changes first" : undefined}>
            <Toggle checked={includePast} onChange={setIncludePast} disabled={dirty} label="Show past flights" size="sm" />
            Past flights
          </label>
        </>
      }
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={dirty || sheet.loading}
          title={dirty ? "Save or discard your changes first" : "Load the sheet again"}
          onClick={() => void sheet.reload()}
        >
          <RotateCcw />
          Reload
        </Button>
      }
    />
    </>
  );
}
