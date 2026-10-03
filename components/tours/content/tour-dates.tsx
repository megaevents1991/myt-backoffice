"use client";

/**
 * The Dates & Prices tab of a tour page: every date of the tour with its price,
 * seats and flights. A row opens the departure card the departures board uses
 * (prices, promotions, flights, sales); new dates come from the board's own
 * dialogs. Nothing here edits on its own - it is the board, cut to one tour.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarPlus, CalendarRange, ExternalLink, Plane } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Chip, Ltr, Notice, Section } from "@/components/tours/ui";
import { fmtDateRange, fmtPrice, nightsBetween, todayIso } from "@/lib/tours/format";
import { DepartureCard } from "@/components/tours/departures/departure-card";
import { PricingSheet } from "@/components/tours/pricing/pricing-sheet";
import { NewDepartureDialog } from "@/components/tours/departures/board-dialogs";
import { SeasonDialog } from "@/components/tours/series/season-dialog";
import { doublePricePerPerson } from "@/components/tours/departures/departure-utils";
import { SaleStatusBadge } from "@/components/tours/departures/ui-bits";
import type { CardTab } from "@/components/tours/departures/board-row";
import type { CardTarget } from "@/components/tours/departures/departure-sheet";
import type { BoardRow, BoardSeries, TourDatesData } from "@/components/tours/departures/types";

export function TourDates({
  tour,
  data,
  onChanged,
}: {
  tour: { id: string; name: string; slug: string; kind: string };
  data: TourDatesData;
  /** A date changed or was added - the page reloads the dates (and its Ready for the Site list). */
  onChanged: () => void;
}) {
  const today = useMemo(() => todayIso(), []);
  const [target, setTarget] = useState<CardTarget | null>(null);
  const [tab, setTab] = useState<CardTab>("general");
  const [dialog, setDialog] = useState<"date" | "season" | null>(null);
  const [showPast, setShowPast] = useState(false);
  // An organized tour edits its dates in the Pricing sheet (many at once); the cards stay one click away.
  const sheetFits = tour.kind === "organized";
  const [mode, setMode] = useState<"sheet" | "cards">(sheetFits ? "sheet" : "cards");
  const [sheetKey, setSheetKey] = useState(0);
  const datesAdded = () => {
    onChanged();
    setSheetKey((k) => k + 1);
  };
  const series: BoardSeries | null = data.series.find((s) => s.is_active) ?? data.series[0] ?? null;

  const rows = useMemo(
    () => data.rows.filter((r) => showPast || r.end_date >= today),
    [data.rows, showPast, today],
  );
  const past = data.rows.length - data.rows.filter((r) => r.end_date >= today).length;
  const typicalNights = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of data.series) if (s.default_nights != null) out.set(s.id, s.default_nights);
    return out;
  }, [data.series]);

  const open = (row: BoardRow, cardTab: CardTab = "general") => {
    setTab(cardTab);
    setTarget({ id: row.id });
  };

  const columns = useMemo<ColumnDef<BoardRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <Ltr className="font-mono text-xs font-semibold">{row.original.code}</Ltr>,
      },
      {
        id: "dates",
        header: "Dates",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            <Ltr>{fmtDateRange(row.original.start_date, row.original.end_date)}</Ltr>
            <span className="ms-1.5 text-xs text-muted-foreground">
              {nightsBetween(row.original.start_date, row.original.end_date)} nights
            </span>
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
            <SaleStatusBadge status={row.original.sale_status} />
            {row.original.is_published ? <Chip tone="success">On site</Chip> : <Chip>Draft</Chip>}
          </span>
        ),
      },
      {
        id: "price",
        header: "Double room",
        cell: ({ row }) => {
          const { price } = doublePricePerPerson(row.original);
          return price == null ? (
            <button
              type="button"
              className="text-xs font-medium text-destructive hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                open(row.original, "prices");
              }}
            >
              Add price
            </button>
          ) : (
            <Ltr className="font-medium">{fmtPrice(price, row.original.currency)}</Ltr>
          );
        },
      },
      {
        id: "leader",
        header: "Group leader",
        cell: ({ row }) =>
          data.leaderNames[row.original.id] ?? <span className="text-xs text-muted-foreground">-</span>,
      },
      {
        id: "seats",
        header: "Seats / Sold",
        cell: ({ row }) => (
          <Ltr className="text-xs">
            {row.original.stats.allocated} / {row.original.stats.sold}
          </Ltr>
        ),
      },
      {
        id: "flights",
        header: "Flights",
        cell: ({ row }) =>
          row.original.flights.length === 0 ? (
            <button
              type="button"
              className="text-xs font-medium text-warning hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                open(row.original, "flights");
              }}
            >
              Link a flight
            </button>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.original.flights.map((f) => (
                <Chip key={f.allocationId} tone={f.isLive ? "outline" : "warning"} title={f.blockStatus ?? undefined}>
                  <Plane className="me-1 h-3 w-3" />
                  {f.airline} · {f.seats}
                </Chip>
              ))}
            </span>
          ),
      },
    ],
    // `open` only sets state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.leaderNames],
  );

  return (
    <Section
      title="Dates & Prices"
      description={
        mode === "sheet"
          ? "Edit the dates like a spreadsheet and click Save. A code opens the date's card (promotions, flights, sales)."
          : "Click a date to edit its prices, flights, promotions and sales, and to put it on the site."
      }
      actions={
        <>
          {sheetFits && (
            <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="View">
              {(["sheet", "cards"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={
                    mode === m
                      ? "rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                      : "rounded px-3 py-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  }
                >
                  {m === "sheet" ? "Sheet" : "Cards"}
                </button>
              ))}
            </div>
          )}
          <Button type="button" size="sm" variant="outline" disabled={!series} onClick={() => setDialog("date")}>
            <CalendarPlus />
            Add Date
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!series} onClick={() => setDialog("season")}>
            <CalendarRange />
            Add Season
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/tours/departures?page=${tour.id}`}>
              <ExternalLink />
              Departures Board
            </Link>
          </Button>
        </>
      }
    >
      {!series && (
        <Notice tone="warning">
          This tour has no series yet, so dates cannot be added. Create one on the{" "}
          <Link href="/tours/series" className="underline">
            Series
          </Link>{" "}
          screen and choose this tour as its page.
        </Notice>
      )}
      {series && (
        <p className="text-xs text-muted-foreground">
          Series <Ltr className="font-mono text-foreground">{series.code}</Ltr> · route{" "}
          <Ltr className="font-mono text-foreground">
            {series.arrival_airport ?? "?"} / {series.return_airport ?? "?"}
          </Ltr>{" "}
          · <Ltr>{series.default_currency}</Ltr> · flight blocks are created in{" "}
          <Link href="/offline-flights" className="underline">
            Offline Flights
          </Link>
          .
        </p>
      )}
      {mode === "sheet" ? (
        <PricingSheet packageId={tour.id} onSaved={onChanged} refreshKey={sheetKey} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => open(row)}
          defaultPageSize={50}
          dense
          stateKey={`tour-dates-${tour.id}`}
          rightActions={
            past > 0 ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowPast((v) => !v)}>
                {showPast ? "Hide past dates" : `Show past dates (${past})`}
              </Button>
            ) : undefined
          }
          emptyState={{
            title: "No dates yet",
            description: series ? "Add a date or a whole season of dates." : "Create the tour's series first.",
          }}
        />
      )}

      <DepartureCard
        target={target}
        tab={tab}
        onTabChange={setTab}
        periods={data.periods}
        onClose={() => setTarget(null)}
        onChanged={onChanged}
      />
      {series && (
        <NewDepartureDialog
          open={dialog === "date"}
          onOpenChange={(isOpen) => setDialog(isOpen ? "date" : null)}
          series={data.series}
          packages={[{ id: tour.id, name: tour.name, kind: tour.kind, slug: tour.slug }]}
          periods={data.periods}
          typicalNights={typicalNights}
          defaultSeriesId={series.id}
          onCreated={datesAdded}
        />
      )}
      <SeasonDialog
        series={dialog === "season" ? series : null}
        periods={data.periods}
        onClose={() => setDialog(null)}
        onCreated={datesAdded}
      />
    </Section>
  );
}
