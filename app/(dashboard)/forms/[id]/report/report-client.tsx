"use client";

import { useMemo, useState } from "react";
import { ChevronDown, StickyNote, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminLabel } from "@/lib/forms/i18n";
import type { TripReport, TripRow } from "@/lib/forms/report";
import type { AnswerValue, FormField, FormResponseRow } from "@/types/form.types";

type RatingFieldInfo = { id: number; label: string; reviewScore: boolean };

type Props = {
  report: TripReport;
  ratingFields: RatingFieldInfo[];
  /** Every client-facing question, in form order - powers the response popup. */
  fields: FormField[];
  responses: FormResponseRow[];
};

/** First answered value of a given field type - e.g. the traveler's name. */
function answerOfType(
  fields: FormField[],
  answers: FormResponseRow["answers"],
  type: FormField["type"],
): AnswerValue | undefined {
  for (const field of fields) {
    if (field.type !== type) continue;
    const value = answers[String(field.id)];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** True when any free-text answer (long_text) came back non-empty. */
function hasNote(fields: FormField[], answers: FormResponseRow["answers"]): boolean {
  return fields.some(
    (field) =>
      field.type === "long_text" &&
      typeof answers[String(field.id)] === "string" &&
      (answers[String(field.id)] as string).trim() !== "",
  );
}

function formatAnswer(field: FormField, value: AnswerValue): string {
  if (typeof value === "boolean") return value ? "כן" : "לא";
  if (field.type === "date" && typeof value === "string") {
    const [y, m, d] = value.split("-");
    if (y && m && d) return `${d}.${m}.${y}`;
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

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

export function ReportClient({ report, ratingFields, fields, responses }: Props) {
  const [prefix, setPrefix] = useState("");
  const [num, setNum] = useState("");
  const [escort, setEscort] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [year, setYear] = useState("all");
  const [openTrip, setOpenTrip] = useState<number | null | undefined>(undefined);
  const [viewing, setViewing] = useState<FormResponseRow | null>(null);

  // Departure years present in the data, newest first - the annual filter.
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const trip of report.trips) {
      if (trip.departure) years.add(trip.departure.slice(0, 4));
    }
    return [...years].sort().reverse();
  }, [report.trips]);

  const trips = useMemo(() => {
    const p = prefix.trim().toUpperCase();
    const n = num.trim();
    const e = escort.trim();
    return report.trips.filter((trip) => {
      if (p && !(trip.prefix ?? "").startsWith(p)) return false;
      if (n && !(trip.num ?? "").startsWith(n)) return false;
      if (e && !(trip.escort ?? "").includes(e)) return false;
      // A trip without a departure only survives when no date/year filter is
      // set - such a filter means "trips of that period".
      if ((fromDate || year !== "all") && !trip.departure) return false;
      if (fromDate && trip.departure && trip.departure < fromDate) return false;
      if (year !== "all" && trip.departure && trip.departure.slice(0, 4) !== year)
        return false;
      return true;
    });
  }, [report.trips, prefix, num, escort, fromDate, year]);

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
          <Label className="text-xs text-muted-foreground">Year</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {yearOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                fields={fields}
                open={openTrip === trip.inviteId}
                onToggle={() =>
                  setOpenTrip(openTrip === trip.inviteId ? undefined : trip.inviteId)
                }
                responses={responsesOf(trip.inviteId)}
                onView={setViewing}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ResponseDialog
        response={viewing}
        fields={fields}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

/** The full submission, question by question, in form order. */
function ResponseDialog({
  response,
  fields,
  onClose,
}: {
  response: FormResponseRow | null;
  fields: FormField[];
  onClose: () => void;
}) {
  const name = response ? answerOfType(fields, response.answers, "short_text") : null;
  return (
    <Dialog open={response !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle dir="rtl" className="text-right">
            {name ? String(name) : "תשובה"}
            <span className="ms-2 text-sm font-normal text-muted-foreground">
              {response && new Date(response.submitted_at).toLocaleString()}
            </span>
          </DialogTitle>
        </DialogHeader>
        {response && (
          <div dir="rtl" className="space-y-1.5">
            {fields.map((field) => {
              const value = response.answers[String(field.id)];
              const answered =
                value !== undefined && value !== null && value !== "";
              return (
                <div
                  key={field.id}
                  className={cn(
                    "flex items-start justify-between gap-4 rounded-md border px-3 py-2 text-sm",
                    !answered && "opacity-45",
                  )}
                >
                  <span className="min-w-0 flex-1 text-right font-medium">
                    {adminLabel(field.label_en, field.label_he)}
                  </span>
                  <span className="shrink-0 text-left">
                    {!answered ? (
                      <span className="text-muted-foreground">—</span>
                    ) : field.type === "rating" ? (
                      <span className="inline-flex items-center gap-1 font-bold tabular-nums">
                        <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" />
                        {String(value)}
                      </span>
                    ) : (
                      <span className="max-w-[220px] whitespace-pre-wrap break-words font-semibold">
                        {formatAnswer(field, value)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TripRows({
  trip,
  ratingFields,
  fields,
  open,
  onToggle,
  responses,
  onView,
}: {
  trip: TripRow;
  ratingFields: RatingFieldInfo[];
  fields: FormField[];
  open: boolean;
  onToggle: () => void;
  responses: FormResponseRow[];
  onView: (response: FormResponseRow) => void;
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
                      const name = answerOfType(fields, response.answers, "short_text");
                      const passengers = answerOfType(fields, response.answers, "number");
                      return (
                        <button
                          key={response.id}
                          type="button"
                          onClick={() => onView(response)}
                          title="Full answers"
                          className="flex w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span dir="rtl" className="max-w-[160px] truncate font-semibold">
                              {name ? String(name) : "ללא שם"}
                            </span>
                            {passengers !== undefined && (
                              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                                <Users className="h-3 w-3" />
                                {String(passengers)}
                              </span>
                            )}
                            {hasNote(fields, response.answers) && (
                              <Badge
                                variant="outline"
                                className="shrink-0 gap-1 px-1.5 text-[10px] text-amber-600"
                              >
                                <StickyNote className="h-3 w-3" />
                                NOTE
                              </Badge>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="hidden text-xs text-muted-foreground sm:inline">
                              {new Date(response.submitted_at).toLocaleString()}
                            </span>
                            <AvgBadge avg={avg} />
                          </span>
                        </button>
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
