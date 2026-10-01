"use client";

/**
 * The frame both departure cards share - the staff card (departure-card.tsx)
 * and the read-only viewer's (departure-view-card.tsx): the side sheet, the
 * load of the card's data with its skeleton and its failure, and the header
 * with the code, dates, nights, route, tour page, series, season and the
 * holidays the trip touches. Each card fills the rest of the header and the
 * tabs.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Chip, LoadError, Ltr } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionData } from "@/hooks/use-action-data";
import type { ActionAnswer } from "@/hooks/use-action-toast";
import { afterUrlWrite } from "@/hooks/use-view-state";
import { fmtDate, fmtDateRange, nightsBetween } from "@/lib/tours/format";
import { ROUTE_TYPE_LABELS, departureRouteLabel, routeType } from "@/lib/tours/routes";
import { periodLabel, periodsOverlapping, type RouteEnds } from "./departure-utils";
import type { BoardPeriod } from "./types";

/** The departure a card shows: by id from a board row, by code from `?code=`. */
export interface CardTarget {
  id?: string;
  code?: string;
}

const LOAD_FAILED = "Couldn't load the departure";

/**
 * The side sheet of a departure card. It loads `load(target)` when it opens
 * and again for every other departure, and shows `children(data, reload)` once
 * the data is in.
 */
export function DepartureSheet<T>({
  target,
  onClose,
  load,
  testId,
  children,
}: {
  target: CardTarget | null;
  onClose: () => void;
  /**
   * The card's data. `current` is what the card shows now - null on the first
   * load, the loaded data on a reload after a change.
   */
  load: (target: CardTarget, current: T | null) => Promise<ActionAnswer<T>>;
  testId?: string;
  /** The card itself. `reload` loads again and keeps the card on screen meanwhile. */
  children: (data: T, reload: () => Promise<void>) => ReactNode;
}) {
  // While the sheet slides out, it keeps showing the departure it had.
  const [shown, setShown] = useState<CardTarget | null>(target);
  if (target && target !== shown) setShown(target);

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" data-testid={testId}>
        {shown && (
          // A new key for every departure: its card starts empty and loads, never shows the previous one.
          <SheetData key={`${shown.id ?? ""}|${shown.code ?? ""}`} target={shown} load={load} onClose={onClose}>
            {children}
          </SheetData>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetData<T>({
  target,
  load,
  onClose,
  children,
}: {
  target: CardTarget;
  load: (target: CardTarget, current: T | null) => Promise<ActionAnswer<T>>;
  onClose: () => void;
  children: (data: T, reload: () => Promise<void>) => ReactNode;
}) {
  const current = useRef<T | null>(null);
  const { data, error, loading, reload } = useActionData<T>(async () => {
    // Opening the card writes `?code=` first; let the router settle before queueing the action.
    await afterUrlWrite();
    return load(target, current.current);
  }, []);
  current.current = data;
  const reloadQuietly = useCallback(() => reload({ quiet: true }), [reload]);

  // A failed reload keeps the card on screen (`data` stays); only a card with nothing to show fails here.
  if (!data) {
    return loading ? (
      <div className="space-y-4 p-6">
        <SheetTitle className="sr-only">Loading departure</SheetTitle>
        <SheetDescription className="sr-only">The departure card is loading</SheetDescription>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    ) : (
      <div className="p-6">
        <SheetTitle className="sr-only">{LOAD_FAILED}</SheetTitle>
        <SheetDescription className="sr-only">Error loading the departure card</SheetDescription>
        <LoadError message={LOAD_FAILED} onRetry={() => void reload()}>
          <p className="text-sm text-muted-foreground">{error ?? "Departure not found"}</p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </LoadError>
      </div>
    );
  }
  return <>{children(data, reloadQuietly)}</>;
}

/**
 * The top of a departure card: code, dates, nights, route and its type, the
 * deleted mark, then tour page · series · season, then the holidays. The card
 * adds its own rows below (`children`).
 */
export function DepartureSheetHeader({
  departure,
  route,
  tourPage,
  series,
  periods,
  children,
}: {
  departure: { code: string; start_date: string; end_date: string; season_year: number; is_deleted?: string | null };
  route: RouteEnds;
  /** The tour page's name, or what to say when there is none. */
  tourPage: string;
  series: { code: string; label: string | null } | null;
  periods: BoardPeriod[];
  children?: ReactNode;
}) {
  const type = routeType(route.arrival_airport, route.return_airport);
  const routeLabel = departureRouteLabel(route.arrival_airport, route.return_airport);
  const holidays = useMemo(
    () => periodsOverlapping(periods, departure.start_date, departure.end_date),
    [periods, departure.start_date, departure.end_date],
  );
  return (
    <SheetHeader className="space-y-2 border-b pb-4 pe-12 ps-6 pt-5 text-start sm:text-start">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SheetTitle className="font-display text-xl">
          <Ltr className="font-mono">{departure.code}</Ltr>
        </SheetTitle>
        <Ltr className="text-sm tabular-nums text-muted-foreground">{fmtDateRange(departure.start_date, departure.end_date)}</Ltr>
        <span className="text-sm text-muted-foreground">{nightsBetween(departure.start_date, departure.end_date)} nights</span>
        {routeLabel && <Ltr className="font-mono text-sm">{routeLabel}</Ltr>}
        {type && type !== "round_trip" && <Chip tone="info">{ROUTE_TYPE_LABELS[type]}</Chip>}
        {departure.is_deleted && <Chip tone="error">Deleted {fmtDate(departure.is_deleted)}</Chip>}
      </div>
      <SheetDescription>
        {tourPage}
        {series && (
          <>
            {" · Series "}
            <Ltr className="font-mono">{series.code}</Ltr>
            {series.label ? ` (${series.label})` : ""}
          </>
        )}
        {" · Season "}
        {departure.season_year}
      </SheetDescription>
      {holidays.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {holidays.map((h) => (
            <Chip key={h.id} tone="warning">
              {periodLabel(h)}
            </Chip>
          ))}
        </div>
      )}
      {children}
    </SheetHeader>
  );
}
