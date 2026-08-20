"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TripReport, TripRow } from "@/lib/forms/report";
import type { FormResponseRow } from "@/types/form.types";

type RatingFieldInfo = { id: number; label: string; reviewScore: boolean };

type Props = {
  report: TripReport;
  ratingFields: RatingFieldInfo[];
  responses: FormResponseRow[];
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
};

const fmtAvg = (avg: number | null) => (avg === null ? "-" : avg.toFixed(2));

function AvgBadge({ avg }: { avg: number | null }) {
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

export function ReportClient({ report, ratingFields, responses }: Props) {
  const [prefix, setPrefix] = useState("");
  const [num, setNum] = useState("");
  const [escort, setEscort] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [openTrip, setOpenTrip] = useState<number | null | undefined>(undefined);

  const trips = useMemo(() => {
    const p = prefix.trim().toUpperCase();
    const n = num.trim();
    const e = escort.trim();
    return report.trips.filter((trip) => {
      if (p && !(trip.prefix ?? "").startsWith(p)) return false;
      if (n && !(trip.num ?? "").startsWith(n)) return false;
      if (e && !(trip.escort ?? "").includes(e)) return false;
      // Departure range: a trip without a departure only survives when no
      // date filter is set - a date filter means "trips of that period".
      if ((fromDate || toDate) && !trip.departure) return false;
      if (fromDate && trip.departure && trip.departure < fromDate) return false;
      if (toDate && trip.departure && trip.departure > toDate) return false;
      return true;
    });
  }, [report.trips, prefix, num, escort, fromDate, toDate]);

  // The summary reflects what is FILTERED, so a year filter = an annual report.
  const filtered = useMemo(() => {
    const rows = trips.filter((t) => t.inviteId !== null);
    const count = trips.reduce((sum, t) => sum + t.responseCount, 0);
    const weighted = trips
      .filter((t) => t.overallAvg !== null && t.responseCount > 0)
      .reduce(
        (acc, t) => {
          // Weight by answer volume via perField counts for a true flat mean.
          const answers = t.perField.reduce((s, f) => s + f.count, 0);
          return {
            sum: acc.sum + (t.overallAvg as number) * answers,
            n: acc.n + answers,
          };
        },
        { sum: 0, n: 0 },
      );
    return {
      tripCount: rows.length,
      responseCount: count,
      overallAvg: weighted.n > 0 ? weighted.sum / weighted.n : null,
    };
  }, [trips]);

  const responsesOf = (tripInviteId: number | null) =>
    responses.filter((r) =>
      tripInviteId === null
        ? r.invite_id === null ||
          !report.trips.some((t) => t.inviteId === r.invite_id)
        : r.invite_id === tripInviteId,
    );

  return (
    <div className="space-y-6">
      {/* Summary - follows the active filters */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Trips", value: String(filtered.tripCount) },
          { label: "Responses", value: String(filtered.responseCount) },
          {
            label: "Overall average",
            value: filtered.overallAvg === null ? "-" : filtered.overallAvg.toFixed(2),
          },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Code letters</Label>
          <Input dir="ltr" placeholder="BBC" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Code number</Label>
          <Input dir="ltr" inputMode="numeric" placeholder="124" value={num} onChange={(e) => setNum(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Escort</Label>
          <Input dir="rtl" className="text-right" value={escort} onChange={(e) => setEscort(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Departure from</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Departure to</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {/* Trips */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Trip</TableHead>
              <TableHead>Escort</TableHead>
              <TableHead>Departure</TableHead>
              <TableHead className="text-center">Responses</TableHead>
              <TableHead>Average</TableHead>
              <TableHead>Last response</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trips.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No trips match the filters.
                </TableCell>
              </TableRow>
            )}

            {trips.map((trip) => (
              <TripRows
                key={trip.inviteId ?? "bucket"}
                trip={trip}
                ratingFields={ratingFields}
                open={openTrip === trip.inviteId}
                onToggle={() =>
                  setOpenTrip(openTrip === trip.inviteId ? undefined : trip.inviteId)
                }
                responses={responsesOf(trip.inviteId)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TripRows({
  trip,
  ratingFields,
  open,
  onToggle,
  responses,
}: {
  trip: TripRow;
  ratingFields: RatingFieldInfo[];
  open: boolean;
  onToggle: () => void;
  responses: FormResponseRow[];
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
        aria-expanded={open}
      >
        <TableCell>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </TableCell>
        <TableCell>
          {trip.code ? (
            <span className="font-mono font-semibold">{trip.code}</span>
          ) : (
            <Badge variant="outline">
              <Users className="mr-1 h-3 w-3" />
              No trip
            </Badge>
          )}
        </TableCell>
        <TableCell dir="rtl" className="text-right">
          {trip.escort ?? "-"}
        </TableCell>
        <TableCell className="whitespace-nowrap">{fmtDate(trip.departure)}</TableCell>
        <TableCell className="text-center font-semibold tabular-nums">
          {trip.responseCount}
        </TableCell>
        <TableCell>
          <AvgBadge avg={trip.overallAvg} />
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {trip.lastSubmittedAt
            ? new Date(trip.lastSubmittedAt).toLocaleDateString()
            : "-"}
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7} className="p-4">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              {/* Per-question averages */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Average per question
                </p>
                <div className="space-y-1.5">
                  {ratingFields.map((field) => {
                    const stat = trip.perField.find((s) => s.fieldId === field.id);
                    return (
                      <div
                        key={field.id}
                        className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-1.5 text-sm"
                      >
                        <span dir="rtl" className="min-w-0 flex-1 truncate text-right">
                          {field.label}
                          {field.reviewScore && (
                            <span title="Counts toward the Google score"> ⭐</span>
                          )}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">
                          {fmtAvg(stat?.avg ?? null)}
                          <span className="ms-1 text-xs font-normal text-muted-foreground">
                            ({stat?.count ?? 0})
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Individual responses */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Responses ({responses.length})
                </p>
                {responses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No responses yet.</p>
                ) : (
                  <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {responses.map((response) => {
                      const ratings = ratingFields
                        .map((field) => response.answers[String(field.id)])
                        .filter((v): v is number => typeof v === "number");
                      const avg =
                        ratings.length > 0
                          ? ratings.reduce((s, v) => s + v, 0) / ratings.length
                          : null;
                      return (
                        <div
                          key={response.id}
                          className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-1.5 text-sm"
                        >
                          <span className="text-muted-foreground">
                            {new Date(response.submitted_at).toLocaleString()}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {ratings.length} ratings
                            </span>
                            <AvgBadge avg={avg} />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
