"use client";

import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Filter, Minus, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtAvg, fmtDate, fmtTravelers } from "@/lib/forms/format";
import type { EscortRow, FieldStat, TripComparison } from "@/lib/forms/report";

/** A rating question as the report screen knows it. */
export type RatingFieldInfo = {
  id: number;
  label: string;
  reviewScore: boolean;
  /** Star count - the bar's full width. */
  max: number;
};

export function AvgBadge({ avg }: { avg: number | null }) {
  if (avg === null) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        avg >= 4.5
          ? "bg-emerald-500/15 text-emerald-600"
          : avg >= 3.5
            ? "bg-amber-500/15 text-amber-600"
            : "bg-red-500/15 text-red-600",
      )}
    >
      <Star className="h-3 w-3" fill="currentColor" />
      {avg.toFixed(2)}
    </span>
  );
}

/** Under a twentieth of a star reads as "same" - rounding, not a change. */
const SAME = 0.05;

/** "+0.33" green / "-1.33" red / "0.00" grey. */
export function DeltaBadge({ delta, title }: { delta: number | null; title?: string }) {
  if (delta === null) return <span className="text-muted-foreground">-</span>;
  const same = Math.abs(delta) < SAME;
  const Icon = same ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
        same ? "text-muted-foreground" : delta > 0 ? "text-emerald-600" : "text-red-600",
      )}
    >
      <Icon className="h-3 w-3" />
      {delta > 0 ? "+" : ""}
      {delta.toFixed(2)}
    </span>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function Bar({ value, max }: { value: number | null; max: number }) {
  const ratio = value === null || max <= 0 ? 0 : Math.min(1, value / max);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full",
          ratio >= 0.9 ? "bg-emerald-500" : ratio >= 0.7 ? "bg-amber-500" : "bg-red-500",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

/**
 * Every rating question over what the filters show, weakest first - where
 * the trips lose points, whoever led them.
 */
export function QuestionsPanel({
  ratingFields,
  perField,
}: {
  ratingFields: RatingFieldInfo[];
  perField: FieldStat[];
}) {
  const rows = ratingFields
    .map((field) => ({ field, stat: perField.find((s) => s.fieldId === field.id) }))
    .sort(
      (a, b) =>
        (a.stat?.avg ?? Number.POSITIVE_INFINITY) - (b.stat?.avg ?? Number.POSITIVE_INFINITY),
    );
  if (rows.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">This form has no star questions.</p>;
  }
  return (
    <div className="space-y-2 p-4">
      <p className="text-xs text-muted-foreground">
        Average per question over the trips the filters show - weakest first.
      </p>
      {rows.map(({ field, stat }) => (
        <div
          key={field.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md border bg-background px-3 py-2 text-sm"
        >
          <span dir="rtl" className="min-w-0 truncate text-right">
            {field.label}
            {field.reviewScore && <span title="Counts toward the Google score"> ⭐</span>}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {fmtAvg(stat?.avg ?? null)}
            <span className="ms-1 text-xs font-normal text-muted-foreground">
              ({stat?.count ?? 0})
            </span>
          </span>
          <div className="col-span-2">
            <Bar value={stat?.avg ?? null} max={field.max} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One row per escort: how many trips they led and when, how many families
 * answered, their average and whether their last trip scored above or below
 * their earlier ones. A row opens into the trip-by-trip timeline and the
 * escort's per-question average against everyone's.
 */
export function EscortsPanel({
  escorts,
  ratingFields,
  housePerField,
  onFilterEscort,
}: {
  escorts: EscortRow[];
  ratingFields: RatingFieldInfo[];
  /** Everyone's per-question averages over the same filtered trips. */
  housePerField: FieldStat[];
  onFilterEscort: (name: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (escorts.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No escorts on the trips the filters show. The escort is the first text staff field of
        a trip link.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Escort</TableHead>
          <TableHead className="text-center">Trips</TableHead>
          <TableHead>Departures</TableHead>
          <TableHead className="text-center">Responses</TableHead>
          <TableHead className="text-center">Travellers</TableHead>
          <TableHead>Average</TableHead>
          <TableHead title="Their latest rated trip against the average of their earlier trips">
            Last trip vs before
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {escorts.map((escort) => {
          const isOpen = open === escort.key;
          return (
            <Fragment key={escort.key}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setOpen(isOpen ? null : escort.key)}
                aria-expanded={isOpen}
              >
                <TableCell>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </TableCell>
                <TableCell dir="rtl" className="text-right font-semibold">
                  {escort.name}
                </TableCell>
                <TableCell className="text-center font-semibold tabular-nums">
                  {escort.trips.length}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {escort.firstDeparture === escort.lastDeparture
                    ? fmtDate(escort.firstDeparture)
                    : `${fmtDate(escort.firstDeparture)} → ${fmtDate(escort.lastDeparture)}`}
                </TableCell>
                <TableCell className="text-center tabular-nums">{escort.responseCount}</TableCell>
                <TableCell className="text-center tabular-nums">
                  {fmtTravelers(escort.travelers)}
                </TableCell>
                <TableCell>
                  <AvgBadge avg={escort.overallAvg} />
                </TableCell>
                <TableCell>
                  <DeltaBadge delta={escort.trend} />
                </TableCell>
              </TableRow>

              {isOpen && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={8} className="p-4">
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Trips, oldest first
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7"
                            onClick={() => onFilterEscort(escort.name)}
                          >
                            <Filter className="me-1.5 h-3.5 w-3.5" />
                            Show their trips
                          </Button>
                        </div>
                        <div className="space-y-1.5">
                          {escort.trips.map((trip, i) => {
                            // Each trip against the escort's previous RATED trip.
                            const before = escort.trips
                              .slice(0, i)
                              .reverse()
                              .find((t) => t.overallAvg !== null);
                            const delta =
                              trip.overallAvg !== null && before && before.overallAvg !== null
                                ? round2(trip.overallAvg - before.overallAvg)
                                : null;
                            return (
                              <div
                                key={trip.inviteId}
                                className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-1.5 text-sm"
                              >
                                <span className="flex min-w-0 items-center gap-3">
                                  <span className="font-mono font-semibold">{trip.code}</span>
                                  <span className="text-muted-foreground">
                                    {fmtDate(trip.departure)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {trip.responseCount} responses
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-3">
                                  <DeltaBadge
                                    delta={delta}
                                    title={before ? `vs ${before.code}` : undefined}
                                  />
                                  <AvgBadge avg={trip.overallAvg} />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Per question - <span dir="rtl">{escort.name}</span> vs everyone
                        </p>
                        <div className="space-y-1.5">
                          {ratingFields.map((field) => {
                            const mine = escort.perField.find((s) => s.fieldId === field.id);
                            const house = housePerField.find((s) => s.fieldId === field.id);
                            const delta =
                              mine && mine.avg !== null && house && house.avg !== null
                                ? round2(mine.avg - house.avg)
                                : null;
                            return (
                              <div
                                key={field.id}
                                className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-1.5 text-sm"
                              >
                                <span dir="rtl" className="min-w-0 flex-1 truncate text-right">
                                  {field.label}
                                </span>
                                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                                  <span className="font-semibold">{fmtAvg(mine?.avg ?? null)}</span>
                                  <span className="text-xs text-muted-foreground">
                                    all {fmtAvg(house?.avg ?? null)}
                                  </span>
                                  <DeltaBadge delta={delta} />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** This trip against its escort's earlier trips, and against the whole form. */
export function TripComparisonBlock({
  comparison,
  ratingFields,
}: {
  comparison: TripComparison;
  ratingFields: RatingFieldInfo[];
}) {
  const n = comparison.pastTrips.length;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        vs <span dir="rtl">{comparison.escort}</span>&apos;s {n} earlier trip{n === 1 ? "" : "s"}
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        {comparison.pastTrips
          .map((trip) => `${trip.code} (${fmtDate(trip.departure)})`)
          .join(" · ")}{" "}
        - {comparison.pastResponses} responses
      </p>
      <div className="overflow-hidden rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-right font-medium">Question</th>
              <th className="px-2 py-1.5 text-center font-medium">This trip</th>
              <th className="px-2 py-1.5 text-center font-medium">Earlier</th>
              <th className="px-2 py-1.5 text-center font-medium">Change</th>
              <th
                className="px-2 py-1.5 text-center font-medium"
                title="Every other response of this form, any escort"
              >
                All trips
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-t font-semibold">
              <td className="px-3 py-1.5 text-right">Overall</td>
              <td className="px-2 py-1.5 text-center">{fmtAvg(comparison.current)}</td>
              <td className="px-2 py-1.5 text-center">{fmtAvg(comparison.past)}</td>
              <td className="px-2 py-1.5 text-center">
                <DeltaBadge delta={comparison.delta} />
              </td>
              <td className="px-2 py-1.5 text-center text-muted-foreground">
                {fmtAvg(comparison.others)}
              </td>
            </tr>
            {ratingFields.map((field) => {
              const row = comparison.perField.find((f) => f.fieldId === field.id);
              return (
                <tr key={field.id} className="border-t">
                  <td dir="rtl" className="max-w-[220px] truncate px-3 py-1.5 text-right">
                    {field.label}
                  </td>
                  <td className="px-2 py-1.5 text-center">{fmtAvg(row?.current ?? null)}</td>
                  <td className="px-2 py-1.5 text-center">{fmtAvg(row?.past ?? null)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <DeltaBadge delta={row?.delta ?? null} />
                  </td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground">
                    {fmtAvg(row?.others ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
