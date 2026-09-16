"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, Pencil, StickyNote, Star, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { updateFormResponseAnswers } from "@/lib/actions/form-response-actions";
import { setTripTotalTravelers } from "@/lib/actions/form-invite-actions";
import { sumTravelers } from "@/lib/forms/report";
import type { TravelerStat, TripReport, TripRow } from "@/lib/forms/report";
import { STAFF_EDITABLE_TYPES } from "@/types/form.types";
import type {
  AnswerMap,
  AnswerValue,
  FormField,
  FormResponseRow,
} from "@/types/form.types";

type RatingFieldInfo = { id: number; label: string; reviewScore: boolean };

type Props = {
  formId: number;
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

/** The answer of one specific field, when it was actually answered. */
function answerOf(
  answers: FormResponseRow["answers"],
  fieldId: number | null,
): AnswerValue | undefined {
  if (fieldId === null) return undefined;
  const value = answers[String(fieldId)];
  return value !== undefined && value !== null && value !== "" ? value : undefined;
}

/**
 * "15 / 17" - travellers the answers account for, of the trip's staff-set
 * size. With no size set, the reported number stands alone.
 */
function fmtTravelers(stat: TravelerStat | null): string {
  if (!stat) return "-";
  if (stat.total !== null) return `${stat.reported} / ${stat.total}`;
  return stat.forms > 0 ? String(stat.reported) : "-";
}

/** A trip row with its size replaced by one typed in this session. */
function withTotal(
  stat: TravelerStat | null,
  total: number | null,
  hasTravelerField: boolean,
): TravelerStat | null {
  if (total === null && !hasTravelerField) return null;
  return { reported: stat?.reported ?? 0, forms: stat?.forms ?? 0, total };
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

export function ReportClient({
  formId,
  report,
  ratingFields,
  fields,
  responses,
}: Props) {
  const [prefix, setPrefix] = useState("");
  const [num, setNum] = useState("");
  const [escort, setEscort] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [year, setYear] = useState("all");
  const [openTrip, setOpenTrip] = useState<number | null | undefined>(undefined);
  const [viewingId, setViewingId] = useState<number | null>(null);
  // Answers corrected in the popup this session - shown at once, while
  // router.refresh() brings the recomputed report (traveller sums) behind it.
  const [edited, setEdited] = useState<Record<number, AnswerMap>>({});
  const rows = useMemo(
    () =>
      responses.map((r) => (edited[r.id] ? { ...r, answers: edited[r.id] } : r)),
    [responses, edited],
  );
  const viewing =
    viewingId === null ? null : (rows.find((r) => r.id === viewingId) ?? null);

  // Trip sizes typed in this session, keyed by invite id - the row and the
  // summary move at once instead of waiting for router.refresh().
  const [sizes, setSizes] = useState<Record<number, number | null>>({});
  const hasTravelerField = report.travelerFieldId !== null;
  const allTrips = useMemo(
    () =>
      report.trips.map((trip) =>
        trip.inviteId !== null && trip.inviteId in sizes
          ? {
              ...trip,
              travelers: withTotal(trip.travelers, sizes[trip.inviteId], hasTravelerField),
            }
          : trip,
      ),
    [report.trips, sizes, hasTravelerField],
  );
  // The column is where a size gets typed, so it shows whenever there is a
  // trip to size - not only once a size or a traveller question exists.
  const showTravelers =
    hasTravelerField || report.trips.some((trip) => trip.inviteId !== null);

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
    return allTrips.filter((trip) => {
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
  }, [allTrips, prefix, num, escort, fromDate, year]);

  // The summary reflects what is FILTERED, so a year filter = an annual report.
  const filtered = useMemo(() => {
    const tripRows = trips.filter((t) => t.inviteId !== null);
    const count = trips.reduce((sum, t) => sum + t.responseCount, 0);
    const travelers = sumTravelers(trips);
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
      tripCount: tripRows.length,
      responseCount: count,
      travelers,
      overallAvg: weighted.n > 0 ? weighted.sum / weighted.n : null,
    };
  }, [trips]);

  // Card: coverage over SIZED trips only (see sumTravelers); travellers on
  // unsized trips are named in the hint instead of padding the ratio.
  const travelersCard = (() => {
    const t = filtered.travelers;
    if (!t) return null;
    if (t.total === null) {
      return {
        value: t.forms > 0 ? String(t.reported) : "-",
        hint: "reported · no trip size set yet",
      };
    }
    const parts = [
      `reported of ${t.sizedTrips} sized trip${t.sizedTrips === 1 ? "" : "s"}`,
    ];
    if (t.unsizedReported > 0) parts.push(`+${t.unsizedReported} on unsized trips`);
    return { value: `${t.sizedReported} / ${t.total}`, hint: parts.join(" · ") };
  })();

  const responsesOf = (tripInviteId: number | null) =>
    rows.filter((r) =>
      tripInviteId === null
        ? r.invite_id === null ||
          !report.trips.some((t) => t.inviteId === r.invite_id)
        : r.invite_id === tripInviteId,
    );

  return (
    <div className="space-y-6">
      {/* Summary - follows the active filters */}
      <div
        className={cn(
          "grid gap-4 sm:grid-cols-3",
          travelersCard !== null && "lg:grid-cols-4",
        )}
      >
        {[
          { label: "Trips", value: String(filtered.tripCount), hint: null },
          { label: "Responses", value: String(filtered.responseCount), hint: null },
          ...(travelersCard !== null
            ? [{ label: "Travellers", ...travelersCard }]
            : []),
          {
            label: "Overall average",
            value: filtered.overallAvg === null ? "-" : filtered.overallAvg.toFixed(2),
            hint: null,
          },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{card.value}</p>
            {card.hint && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{card.hint}</p>
            )}
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
              {showTravelers && (
                <TableHead
                  className="text-center"
                  title="Travellers the answers account for / travellers on the trip. Click a trip's number to set its size."
                >
                  Travellers
                </TableHead>
              )}
              <TableHead>Average</TableHead>
              <TableHead>Last response</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trips.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={showTravelers ? 8 : 7}
                  className="h-24 text-center text-muted-foreground"
                >
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
                travelerFieldId={report.travelerFieldId}
                showTravelers={showTravelers}
                formId={formId}
                onSized={(inviteId, total) =>
                  setSizes((prev) => ({ ...prev, [inviteId]: total }))
                }
                open={openTrip === trip.inviteId}
                onToggle={() =>
                  setOpenTrip(openTrip === trip.inviteId ? undefined : trip.inviteId)
                }
                responses={responsesOf(trip.inviteId)}
                onView={(r) => setViewingId(r.id)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <ResponseDialog
        response={viewing}
        fields={fields}
        onClose={() => setViewingId(null)}
        onSaved={(id, answers) => setEdited((prev) => ({ ...prev, [id]: answers }))}
      />
    </div>
  );
}

/** Free text and long strings read better as a block under the label. */
function stacked(field: FormField, value: AnswerValue): boolean {
  if (field.type === "long_text") return true;
  return typeof value === "string" && value.length > 40;
}

const fieldEditable = (field: FormField) => STAFF_EDITABLE_TYPES.includes(field.type);

const asText = (value: AnswerValue | undefined) =>
  value === undefined || value === null ? "" : String(value);

/**
 * The full submission, question by question, in form order. "עריכה" turns the
 * open answers (text, number, date...) into inputs so staff can fix a typo -
 * ratings and choices stay read-only; the server enforces the same rule.
 */
function ResponseDialog({
  response,
  fields,
  onClose,
  onSaved,
}: {
  response: FormResponseRow | null;
  fields: FormField[];
  onClose: () => void;
  onSaved: (responseId: number, answers: AnswerMap) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const name = response ? answerOfType(fields, response.answers, "short_text") : null;
  const canEdit = fields.some(fieldEditable);

  function startEdit() {
    if (!response) return;
    const next: Record<string, string> = {};
    for (const field of fields) {
      if (fieldEditable(field)) {
        next[String(field.id)] = asText(response.answers[String(field.id)]);
      }
    }
    setDraft(next);
    setErrors({});
    setMessage(null);
    setEditing(true);
  }

  function stopEdit() {
    setEditing(false);
    setDraft({});
    setErrors({});
    setMessage(null);
  }

  function close() {
    stopEdit();
    onClose();
  }

  function save() {
    if (!response) return;
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (value !== asText(response.answers[key])) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      stopEdit();
      return;
    }
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await updateFormResponseAnswers(
          response.id,
          response.form_id,
          patch,
        );
        if (!result.ok) {
          if ("errors" in result) setErrors(result.errors);
          else setMessage(result.message);
          return;
        }
        onSaved(response.id, result.answers);
        stopEdit();
        router.refresh();
      } catch (e) {
        console.error("updateFormResponseAnswers threw:", e);
        setMessage("Saving failed.");
      }
    });
  }

  return (
    <Dialog open={response !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle
            dir="rtl"
            className="flex items-center justify-between gap-3 pe-6 text-right"
          >
            <span className="min-w-0 truncate">
              {name ? String(name) : "תשובה"}
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                {response && new Date(response.submitted_at).toLocaleString()}
              </span>
            </span>
            {canEdit && !editing && (
              <Button type="button" variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="me-1.5 h-3.5 w-3.5" />
                עריכה
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {response && (
          <div dir="rtl" className="space-y-1.5">
            {fields.map((field) => {
              const key = String(field.id);
              const value = response.answers[key];
              const answered = value !== undefined && value !== null && value !== "";
              const label = adminLabel(field.label_en, field.label_he);
              const error = errors[key];

              if (editing && fieldEditable(field)) {
                const inputProps = {
                  value: draft[key] ?? "",
                  disabled: pending,
                  "aria-invalid": Boolean(error),
                  onChange: (
                    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                  ) => setDraft((prev) => ({ ...prev, [key]: e.target.value })),
                };
                const rtl = field.type === "short_text" || field.type === "long_text";
                return (
                  <div
                    key={field.id}
                    className={cn(
                      "space-y-1 rounded-md border px-3 py-2 text-sm",
                      error && "border-destructive",
                    )}
                  >
                    <span className="block text-right text-xs font-medium text-muted-foreground">
                      {label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </span>
                    {field.type === "long_text" ? (
                      <Textarea rows={3} dir="rtl" className="text-right" {...inputProps} />
                    ) : (
                      <Input
                        type={
                          field.type === "number"
                            ? "number"
                            : field.type === "date"
                              ? "date"
                              : field.type === "email"
                                ? "email"
                                : "text"
                        }
                        dir={rtl ? "rtl" : "ltr"}
                        className={rtl ? "text-right" : ""}
                        min={field.type === "number" ? field.config.min : undefined}
                        max={field.type === "number" ? field.config.max : undefined}
                        step={field.type === "number" ? (field.config.step ?? "any") : undefined}
                        {...inputProps}
                      />
                    )}
                    {error && <p className="text-xs text-destructive">{error}</p>}
                  </div>
                );
              }

              // Long answers: label on top, full-width text below - a side-by-side
              // row squeezed them into a narrow column and broke every word.
              if (answered && stacked(field, value)) {
                return (
                  <div key={field.id} className="rounded-md border px-3 py-2 text-sm">
                    <span className="block text-right text-xs font-medium text-muted-foreground">
                      {label}
                    </span>
                    <p className="mt-1 whitespace-pre-wrap break-words text-right font-semibold leading-relaxed">
                      {formatAnswer(field, value)}
                    </p>
                  </div>
                );
              }

              return (
                <div
                  key={field.id}
                  className={cn(
                    "flex items-start justify-between gap-4 rounded-md border px-3 py-2 text-sm",
                    !answered && "opacity-45",
                  )}
                >
                  <span className="min-w-0 flex-1 text-right font-medium">{label}</span>
                  <span className="shrink-0 text-left">
                    {!answered ? (
                      <span className="text-muted-foreground">—</span>
                    ) : field.type === "rating" ? (
                      <span className="inline-flex items-center gap-1 font-bold tabular-nums">
                        <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" />
                        {String(value)}
                      </span>
                    ) : (
                      <span className="whitespace-pre-wrap break-words font-semibold">
                        {formatAnswer(field, value)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}

            {editing && (
              <div className="flex items-center justify-between gap-3 pt-2">
                <span className="text-xs text-destructive">{message}</span>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={stopEdit}
                    disabled={pending}
                  >
                    <X className="me-1 h-3.5 w-3.5" />
                    ביטול
                  </Button>
                  <Button type="button" size="sm" onClick={save} disabled={pending}>
                    {pending && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
                    שמור
                  </Button>
                </span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Travellers cell of a trip row: "reported / size", and a click sets the
 * size in place. The "no trip" bucket has no link to size, so it only reads.
 * Clicks stop here - the row itself toggles open on click.
 */
function TripSizeCell({
  trip,
  formId,
  onSized,
}: {
  trip: TripRow;
  formId: number;
  onSized: (inviteId: number, total: number | null) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inviteId = trip.inviteId;

  if (inviteId === null) return <>{fmtTravelers(trip.travelers)}</>;

  function begin(event: React.MouseEvent) {
    event.stopPropagation();
    setValue(trip.travelers?.total != null ? String(trip.travelers.total) : "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function save() {
    if (inviteId === null) return;
    const raw = value.trim();
    startTransition(async () => {
      try {
        const result = await setTripTotalTravelers(
          inviteId,
          formId,
          raw === "" ? null : raw,
        );
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onSized(inviteId, result.total);
        setEditing(false);
        router.refresh();
      } catch (e) {
        console.error("setTripTotalTravelers threw:", e);
        setError("Saving failed.");
      }
    });
  }

  if (editing) {
    return (
      <div
        className="inline-flex flex-col items-center gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {trip.travelers?.reported ?? 0} /
          </span>
          <Input
            autoFocus
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={value}
            disabled={pending}
            aria-label={`Travellers on trip ${trip.code ?? ""}`}
            aria-invalid={error !== null}
            placeholder="?"
            className="h-7 w-16 px-1.5 text-center"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") cancel();
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={save}
            disabled={pending}
            aria-label="Save trip size"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={cancel}
            disabled={pending}
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={begin}
      title="Set how many travellers were on this trip"
      className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span>{fmtTravelers(trip.travelers)}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

function TripRows({
  trip,
  ratingFields,
  fields,
  travelerFieldId,
  showTravelers,
  formId,
  onSized,
  open,
  onToggle,
  responses,
  onView,
}: {
  trip: TripRow;
  ratingFields: RatingFieldInfo[];
  fields: FormField[];
  travelerFieldId: number | null;
  showTravelers: boolean;
  formId: number;
  onSized: (inviteId: number, total: number | null) => void;
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
        {showTravelers && (
          <TableCell className="text-center tabular-nums">
            <TripSizeCell trip={trip} formId={formId} onSized={onSized} />
          </TableCell>
        )}
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
          <TableCell colSpan={showTravelers ? 8 : 7} className="p-4">
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
                      const passengers = answerOf(response.answers, travelerFieldId);
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
