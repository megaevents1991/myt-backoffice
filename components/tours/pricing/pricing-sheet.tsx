"use client";

/**
 * The departures sheet: every sub-tour of the organized tours in one
 * spreadsheet, the tour's name as a header row and its sub-tours under it
 * (mega-family docs/plans/TOUR-SETUP-FLOW-PLAN.md, steps 4-6). Tours >
 * Departures shows all the tours; a tour page's Dates & Prices tab shows the
 * same sheet for that tour.
 *
 * Departures and Pricing are one table (Alon, 04.10.2026): the Departures /
 * Prices / Details switch only changes which columns are in sight. Edits stay
 * in the sheet, marked, until Save (Dor, 03.10.2026) - the grid, the keyboard,
 * paste and "Set for selected" are ../sheet/sheet-grid.tsx. Model and parsing:
 * ./sheet-model.ts. Server: tours-pricing-sheet-actions.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useActionData } from "@/hooks/use-action-data";
import { LoadError, Ltr, selectClass, Toggle } from "@/components/tours/ui";
import { SaleStatusBadge } from "@/components/tours/departures/ui-bits";
import { SheetGrid, type SheetGroup, type SheetSaveAnswer } from "@/components/tours/sheet/sheet-grid";
import type { SheetColumn as CoreColumn, SheetRowChange, SheetValue } from "@/components/tours/sheet/sheet-core";
import { getPricingSheet, savePricingSheet } from "@/lib/actions/tours-pricing-sheet-actions";
import { fmtDate, fmtDateRange, fmtPrice, nightsBetween } from "@/lib/tours/format";
import { departureHref, linkClass } from "@/lib/tours/links";
import { SALE_STATUSES, SALE_STATUS_LABELS } from "@/types/tours.types";
import {
  cellValue,
  columnsFor,
  rowOptions,
  SHEET_COLUMNS,
  SHEET_VIEW_LABELS,
  SHEET_VIEWS,
  type SheetRow,
  type SheetTour,
  type SheetView,
} from "./sheet-model";

const HINTS: Record<SheetView, string> = {
  departures:
    "Every date with what the site shows on it: season, status, up to 3 labels, the bar / bat mitzvah mark, its discount (\"10%\" of the order or \"80\" per traveler) and the last day of it, its gift, a named discount. A date with no flight yet can go on the site - the site says the flight details will follow; \"Link flight\" in its Flight cell lists the blocks that fly on its days.",
  prices:
    "Prices are per person and final - the flight column is its cost, for the margin.",
  details: "The details of each date. Flight times, baggage and stops are the flight's own (Offline Flights).",
};

export function PricingSheet({
  packageId,
  focusTour,
  onSaved,
  refreshKey = 0,
  defaultView = "prices",
  onOpenCard,
  filters: hostFilters,
}: {
  /** One tour's sheet (its page); all organized tours when absent. */
  packageId?: string;
  /** Opened for one tour (?tour=): the filter starts there, and can be cleared. */
  focusTour?: string | null;
  /** After a save that changed something (the tour page refreshes its Ready for the Site list). */
  onSaved?: () => void;
  /** Bumped by the host when dates were added or a card saved: the rows reload, unsaved edits stay. */
  refreshKey?: number;
  /** The column set the sheet opens on. */
  defaultView?: SheetView;
  /** A code opens the date's card in place (the host mounts it); without it the code is a link to the card. */
  onOpenCard?: (row: SheetRow, tab?: "flights") => void;
  /** Initial filters from the address (the departures screen's links). */
  filters?: { season?: string; status?: string; q?: string };
}) {
  const [includePast, setIncludePast] = useState(false);
  const sheet = useActionData(() => getPricingSheet({ packageId, includePast }), [packageId, includePast]);
  const data = sheet.data;

  const [view, setView] = useState<SheetView>(defaultView);
  const [search, setSearch] = useState(hostFilters?.q ?? "");
  const [season, setSeason] = useState(hostFilters?.season ?? "");
  const [status, setStatus] = useState(hostFilters?.status ?? "");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyDrafts, setOnlyDrafts] = useState(false);
  const [noSeason, setNoSeason] = useState(false);
  const [noFlight, setNoFlight] = useState(false);
  const [tourFilter, setTourFilter] = useState<string | null>(focusTour ?? null);
  const [dirty, setDirty] = useState(false);

  const rowsById = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  const tourById = useMemo(() => new Map((data?.tours ?? []).map((t) => [t.id, t])), [data]);
  const columns = useMemo(() => columnsFor(view), [view]);
  const seasons = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.season).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, "he")),
    [data],
  );

  // --- what is shown: tour groups in order, each with its filtered rows
  const groups = useMemo((): SheetGroup<SheetRow>[] => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const keep = (r: SheetRow) =>
      (!tourFilter || r.packageId === tourFilter) &&
      (!season || r.season === season) &&
      (!status || r.saleStatus === status) &&
      (!onlyMissing || r.prices[1] == null) &&
      (!onlyDrafts || !r.isPublished) &&
      (!noSeason || !r.seasonId) &&
      (!noFlight || !r.flight?.live) &&
      (!q || r.code.toLowerCase().includes(q) || (tourById.get(r.packageId)?.name ?? "").toLowerCase().includes(q));
    return data.tours
      .map((tour) => ({ tour, rows: data.rows.filter((r) => r.packageId === tour.id && keep(r)) }))
      .filter((g) => g.rows.length > 0)
      .map(({ tour, rows }) => ({
        key: tour.id,
        rows,
        selectLabel: `Select the dates of ${tour.name}`,
        header: <TourHeader tour={tour} rows={rows} linkToTour={!packageId} />,
      }));
  }, [data, search, season, status, onlyMissing, onlyDrafts, noSeason, noFlight, tourFilter, tourById, packageId]);

  const firstKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== firstKey.current) void sheet.reload({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the host asks
  }, [refreshKey]);

  const save = useCallback(
    async (changes: SheetRowChange[]): Promise<SheetSaveAnswer> => {
      const res = await savePricingSheet(changes);
      if (!res.success) return { ok: false, error: res.error };
      const { saved, skipped, notes, rows } = res.data;
      const fresh = new Map(rows.map((r) => [r.id, r]));
      sheet.setData((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => fresh.get(r.id) ?? r) } : prev));
      if (saved.length || rows.length) onSaved?.();
      return { ok: true, saved, skipped, notes };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setData is stable for the life of the sheet
    [onSaved],
  );

  const today = data?.today ?? "";
  const readonlyText = useCallback((row: SheetRow, key: string): string => {
    switch (key) {
      case "dates":
        return `${fmtDateRange(row.startDate, row.endDate)} · ${nightsBetween(row.startDate, row.endDate) ?? "?"}n`;
      case "route":
        return row.route;
      case "seats":
        return row.seats.allocated ? `${row.seats.sold}/${row.seats.allocated}` : "-";
      case "flightCost":
        return row.flightCost
          ? `${fmtPrice(row.flightCost.amount, row.flightCost.currency)}${row.flightCost.more ? ` +${row.flightCost.more}` : ""}`
          : "";
      case "flight":
        return row.flight ? `${row.flight.airlines} ${row.flight.status}`.trim() : "No flight yet";
      case "morePromotions":
        return row.morePromotions.join(" · ");
      default:
        return "";
    }
  }, []);

  const renderCell = useCallback((row: SheetRow, col: CoreColumn, value: SheetValue) => {
    switch (col.key) {
      case "saleStatus":
        return (
          <span title={row.siteStatus !== value ? `The site shows "${SALE_STATUS_LABELS[row.siteStatus as keyof typeof SALE_STATUS_LABELS] ?? row.siteStatus}" from the seats left` : undefined}>
            <SaleStatusBadge status={String(value)} />
          </span>
        );
      case "seasonId":
        return value ? undefined : (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            No season
          </span>
        );
      case "itineraryId":
        return value ? undefined : <span className="text-xs text-muted-foreground">Main / the season&apos;s</span>;
      case "flight":
        return row.flight ? (
          <span className={cn("text-xs", !row.flight.live && "text-amber-700 dark:text-amber-400")} title={row.flight.live ? undefined : "The block is not confirmed yet - the site does not show it"}>
            <Ltr className="font-mono font-semibold">{row.flight.airlines}</Ltr> {row.flight.status}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs">
            <span className="font-medium text-amber-700 dark:text-amber-400" title="The date can be sold; the site says the flight details will follow">
              No flight yet
            </span>
            {/* the card's Flights tab lists the blocks that fly on these days - one click links one */}
            {onOpenCard ? (
              <button type="button" className={linkClass} title="Choose the flight block of this date" onClick={() => onOpenCard(row, "flights")}>
                Link flight
              </button>
            ) : (
              <Link href={departureHref(row.code, "flights")} target="_blank" className={linkClass} title="Choose the flight block of this date">
                Link flight
              </Link>
            )}
          </span>
        );
      case "morePromotions":
        return row.morePromotions.length ? (
          <span className="text-xs" title={row.morePromotions.join("\n")}>
            {row.morePromotions.join(" · ")}
          </span>
        ) : undefined;
      case "discountUntil":
      case "giftUntil":
      case "specialUntil":
        // a day that passed: the promotion still runs (the site decides) - say so
        return typeof value === "string" && today && value < today ? (
          <span className="text-destructive" title="This day has passed. The promotion still applies until it is cleared">
            {fmtDate(value)}
          </span>
        ) : undefined;
      default:
        return undefined;
    }
  }, [onOpenCard, today]);

  const optionsOf = useCallback((row: SheetRow, col: CoreColumn) => rowOptions(tourById.get(row.packageId), col.key), [tourById]);

  // --- render
  if (sheet.error && !data) return <LoadError message={sheet.error} onRetry={() => void sheet.reload()} />;
  if (!data) return <Skeleton className="h-96 w-full" />;

  const check = (label: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-1.5 text-sm">
      <Checkbox checked={checked} onCheckedChange={(v) => set(v === true)} />
      {label}
    </label>
  );

  return (
    <SheetGrid<SheetRow>
      columns={columns}
      allColumns={SHEET_COLUMNS}
      groups={groups}
      rowsById={rowsById}
      cellValue={cellValue}
      readonlyText={readonlyText}
      renderCell={renderCell}
      optionsOf={optionsOf}
      rowName={(row) => row.code}
      rowHead={(row) =>
        onOpenCard ? (
          <button type="button" className={linkClass} title="Open the date's card" onClick={() => onOpenCard(row)}>
            {row.code}
          </button>
        ) : (
          <Link href={departureHref(row.code)} target="_blank" className={linkClass} title="Open the date's card">
            {row.code}
          </Link>
        )
      }
      headLabel="Code"
      noun="sub-tour"
      ariaLabel="Departures sheet"
      bulkDefaultKey={view === "prices" ? "price1" : view === "departures" ? "seasonId" : "capacity"}
      onDirtyChange={setDirty}
      save={save}
      hint={
        <>
          Click a cell and type, or paste a block from Excel / Google Sheets. Enter or double-click edits, Delete clears, arrows
          and Tab move (an arrow also closes a cell you typed into). Shift + arrows or a drag picks a range: Delete clears it,
          Ctrl+D fills it down, and the small square at its corner drags the values onto the rows below. Tick rows and &ldquo;Set
          for selected&rdquo; to set several columns at once. {HINTS[view]} Nothing is saved until you press Save.
        </>
      }
      empty={
        packageId && data.rows.length === 0 ? (
          <>
            No dates yet. Dates come from a flight series: Offline Flights &gt;{" "}
            <Link href="/offline-flights/series/new" className={linkClass}>
              New Series
            </Link>
            , tick &ldquo;Organized tour&rdquo; and give this tour&apos;s code. A date with no flight yet: &ldquo;Add
            Date&rdquo; above - it can be priced and sold, and the flight linked later.
          </>
        ) : (
          "No sub-tours match. Clear the filters, or show past dates."
        )
      }
      filters={
        <>
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Columns">
            {SHEET_VIEWS.map((v) => (
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
                {SHEET_VIEW_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={packageId ? "Code" : "Tour or code"}
              className="h-9 w-44 ps-8"
            />
          </div>
          {!packageId && data.tours.length > 1 && (
            <select
              className={cn(selectClass, "max-w-52")}
              value={tourFilter ?? ""}
              onChange={(e) => setTourFilter(e.target.value || null)}
              aria-label="Tour"
            >
              <option value="">All tours</option>
              {data.tours.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {seasons.length > 0 && (
            <select className={selectClass} value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
              <option value="">All seasons</option>
              {season && !seasons.includes(season) && <option value={season}>{season}</option>}
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Sale status">
            <option value="">All statuses</option>
            {SALE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SALE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {check("No season", noSeason, setNoSeason)}
          {check("No flight", noFlight, setNoFlight)}
          {check("No double price", onlyMissing, setOnlyMissing)}
          {check("Not on the site", onlyDrafts, setOnlyDrafts)}
          <label className="flex items-center gap-1.5 text-sm" title={dirty ? "Save or discard your changes first" : undefined}>
            <Toggle checked={includePast} onChange={setIncludePast} disabled={dirty} label="Show past dates" size="sm" />
            Past dates
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
  );
}

/** The header row of a tour: its name, codes, how many dates are shown and what they still miss. */
function TourHeader({ tour, rows, linkToTour }: { tour: SheetTour; rows: SheetRow[]; linkToTour: boolean }) {
  const unassigned = rows.filter((r) => !r.seasonId).length;
  return (
    <>
      <span className="font-semibold" dir="auto">
        {tour.name}
      </span>
      <Ltr className="font-mono text-xs font-semibold text-muted-foreground">{tour.codes.join(" · ")}</Ltr>
      <span className="text-xs text-muted-foreground">{rows.length} date(s)</span>
      {unassigned > 0 && (
        <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {unassigned} with no season
        </span>
      )}
      {!tour.isActive && (
        <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Draft tour</span>
      )}
      {linkToTour && (
        <Link
          href={`/tours/packages/${tour.id}?tab=dates`}
          target="_blank"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Tour page
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </>
  );
}
