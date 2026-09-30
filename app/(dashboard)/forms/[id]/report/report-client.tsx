"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  FileDown,
  Loader2,
  Pencil,
  StickyNote,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";
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
import {
  deleteFormResponse,
  restoreFormResponse,
  updateFormResponseAnswers,
} from "@/lib/actions/form-response-actions";
import {
  deleteTripLink,
  restoreTripLink,
  setTripTotalTravelers,
} from "@/lib/actions/form-invite-actions";
import {
  buildEscortRows,
  compareWithEscortPast,
  filterTrips,
  responsesOfTrips,
  summarizeTrips,
  tripFiltersToQuery,
} from "@/lib/forms/report";
import type {
  TravelerStat,
  TripComparison,
  TripFilters,
  TripReport,
  TripRow,
} from "@/lib/forms/report";
import { STAFF_EDITABLE_TYPES } from "@/types/form.types";
import type {
  AnswerMap,
  AnswerValue,
  FormField,
  FormResponseRow,
} from "@/types/form.types";
import { fmtAvg, fmtDate, fmtTravelers } from "@/lib/forms/format";
import { AvgBadge, EscortsPanel, QuestionsPanel, TripComparisonBlock } from "./analytics";
import type { RatingFieldInfo } from "./analytics";

/** The PDF export of the given filters - summary page, then a page per family. */
function pdfHref(formId: number, filters: TripFilters): string {
  const query = tripFiltersToQuery(filters);
  return `/forms/${formId}/pdf${query ? `?${query}` : ""}`;
}

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

export function ReportClient({
  formId,
  report,
  ratingFields,
  fields,
  responses,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [prefix, setPrefix] = useState("");
  const [num, setNum] = useState("");
  const [escort, setEscort] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [year, setYear] = useState("all");
  const [tab, setTab] = useState("trips");
  const [openTrip, setOpenTrip] = useState<number | null | undefined>(undefined);
  const [viewingId, setViewingId] = useState<number | null>(null);
  // Answers corrected in the popup this session - shown at once, while
  // router.refresh() brings the recomputed report (traveller sums) behind it.
  const [edited, setEdited] = useState<Record<number, AnswerMap>>({});
  // Responses deleted this session - gone from the lists at once, same idea.
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set());
  const rows = useMemo(
    () =>
      responses
        .filter((r) => !removed.has(r.id))
        .map((r) => (edited[r.id] ? { ...r, answers: edited[r.id] } : r)),
    [responses, edited, removed],
  );
  const viewing =
    viewingId === null ? null : (rows.find((r) => r.id === viewingId) ?? null);

  // Trip sizes typed in this session, keyed by invite id - the row and the
  // summary move at once instead of waiting for router.refresh().
  const [sizes, setSizes] = useState<Record<number, number | null>>({});
  // Trip links deleted this session (invite ids) - off the table at once.
  const [removedTrips, setRemovedTrips] = useState<ReadonlySet<number>>(() => new Set());
  const hasTravelerField = report.travelerFieldId !== null;
  const allTrips = useMemo(
    () =>
      report.trips
        .filter((trip) => trip.inviteId === null || !removedTrips.has(trip.inviteId))
        .map((trip) =>
          trip.inviteId !== null && trip.inviteId in sizes
            ? {
                ...trip,
                travelers: withTotal(trip.travelers, sizes[trip.inviteId], hasTravelerField),
              }
            : trip,
        ),
    [report.trips, sizes, hasTravelerField, removedTrips],
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

  // Escort names across every trip, for the escort filter's suggestions.
  const escortNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const trip of report.trips) {
      const name = trip.escort?.trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b, "he"));
  }, [report.trips]);

  // One filter rule for the screen and the PDF (lib/forms/report.ts).
  const filters: TripFilters = { prefix, num, escort, fromDate, toDate, year };
  const anyFilter = Boolean(prefix || num || escort || fromDate || toDate || year !== "all");
  const trips = useMemo(
    () => filterTrips(allTrips, { prefix, num, escort, fromDate, toDate, year }),
    [allTrips, prefix, num, escort, fromDate, toDate, year],
  );
  const scoped = useMemo(
    () => responsesOfTrips(rows, trips, allTrips),
    [rows, trips, allTrips],
  );

  // The summary reflects what is FILTERED, so a year filter = an annual report.
  const filtered = useMemo(
    () => summarizeTrips(trips, scoped, ratingFields),
    [trips, scoped, ratingFields],
  );
  const escorts = useMemo(
    () => buildEscortRows(trips, rows, ratingFields),
    [trips, rows, ratingFields],
  );

  function clearFilters() {
    setPrefix("");
    setNum("");
    setEscort("");
    setFromDate("");
    setToDate("");
    setYear("all");
  }

  // A delete takes the response off the screen at once; the toast undoes it.
  function onDeleted(id: number) {
    setRemoved((prev) => new Set(prev).add(id));
    setViewingId(null);
    router.refresh();
    toast({
      title: "המשוב נמחק",
      description: "הוא כבר לא נספר בדוח, בממוצעים וב-PDF.",
      action: (
        <ToastAction altText="ביטול המחיקה" onClick={() => undoDelete(id)}>
          ביטול
        </ToastAction>
      ),
    });
  }

  function undoDelete(id: number) {
    restoreFormResponse(id, formId)
      .then((result) => {
        if (!result.ok) {
          toast({ variant: "destructive", title: "השחזור נכשל", description: result.message });
          return;
        }
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        router.refresh();
      })
      .catch((e) => {
        console.error("restoreFormResponse threw:", e);
        toast({ variant: "destructive", title: "השחזור נכשל" });
      });
  }

  // A trip link nobody needs (a duplicate, a typo) - only an empty trip; the
  // server checks the same. The toast undoes it.
  async function deleteTrip(trip: TripRow) {
    const inviteId = trip.inviteId;
    if (inviteId === null) return;
    const sure = await confirm({
      title: `למחוק את הטיול ${trip.code}?`,
      description:
        "הטיול יוצא מהדוח ומרשימת הקישורים, והקישור שלו מפסיק לקבל תשובות. אפשר להחזיר אותו מיד, מההודעה שתופיע.",
      confirmLabel: "מחיקה",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!sure) return;
    try {
      const result = await deleteTripLink(inviteId, formId);
      if (!result.ok) {
        toast({ variant: "destructive", title: "המחיקה נכשלה", description: result.message });
        return;
      }
      setRemovedTrips((prev) => new Set(prev).add(inviteId));
      if (openTrip === inviteId) setOpenTrip(undefined);
      router.refresh();
      toast({
        title: `הטיול ${trip.code} נמחק`,
        action: (
          <ToastAction altText="ביטול המחיקה" onClick={() => undoTrip(inviteId)}>
            ביטול
          </ToastAction>
        ),
      });
    } catch (e) {
      console.error("deleteTripLink threw:", e);
      toast({ variant: "destructive", title: "המחיקה נכשלה" });
    }
  }

  function undoTrip(inviteId: number) {
    restoreTripLink(inviteId, formId)
      .then((result) => {
        if (!result.ok) {
          toast({ variant: "destructive", title: "השחזור נכשל", description: result.message });
          return;
        }
        setRemovedTrips((prev) => {
          const next = new Set(prev);
          next.delete(inviteId);
          return next;
        });
        router.refresh();
      })
      .catch((e) => {
        console.error("restoreTripLink threw:", e);
        toast({ variant: "destructive", title: "השחזור נכשל" });
      });
  }

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

  const responsesOf = (trip: TripRow) => responsesOfTrips(rows, [trip], allTrips);
  // Only the open trip is compared - the rest never render the block.
  const comparisonOf = (trip: TripRow): TripComparison | null =>
    compareWithEscortPast(trip, allTrips, rows, ratingFields);

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
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
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
          <Input
            dir="rtl"
            className="text-right"
            list="report-escorts"
            value={escort}
            onChange={(e) => setEscort(e.target.value)}
          />
          <datalist id="report-escorts">
            {escortNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Departure from</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Departure to</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
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

      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="trips">Trips ({trips.length})</TabsTrigger>
            <TabsTrigger value="escorts">Escorts ({escorts.length})</TabsTrigger>
            <TabsTrigger value="questions">Questions</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {anyFilter && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <a
                href={pdfHref(formId, filters)}
                target="_blank"
                rel="noopener noreferrer"
                title="Page 1: the summary of what the filters show. Then one page per family."
              >
                <FileDown className="me-1.5 h-4 w-4" />
                Export PDF
              </a>
            </Button>
          </div>
        </div>

        <TabsContent value="escorts" className="mt-0 rounded-lg border">
          <EscortsPanel
            escorts={escorts}
            ratingFields={ratingFields}
            housePerField={filtered.perField}
            onFilterEscort={(name) => {
              setEscort(name);
              setTab("trips");
            }}
          />
        </TabsContent>

        <TabsContent value="questions" className="mt-0 rounded-lg border">
          <QuestionsPanel ratingFields={ratingFields} perField={filtered.perField} />
        </TabsContent>

        {/* Trips */}
        <TabsContent value="trips" className="mt-0 overflow-hidden rounded-lg border bg-card">
          <Table look="list">
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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={showTravelers ? 9 : 8}
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
                  responses={responsesOf(trip)}
                  comparison={openTrip === trip.inviteId ? comparisonOf(trip) : null}
                  pdfUrl={pdfHref(formId, { trip: trip.inviteId ?? "none" })}
                  onView={(r) => setViewingId(r.id)}
                  onDelete={() => deleteTrip(trip)}
                />
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      <ResponseDialog
        response={viewing}
        fields={fields}
        onClose={() => setViewingId(null)}
        onSaved={(id, answers) => setEdited((prev) => ({ ...prev, [id]: answers }))}
        onDeleted={onDeleted}
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
  onDeleted,
}: {
  response: FormResponseRow | null;
  fields: FormField[];
  onClose: () => void;
  onSaved: (responseId: number, answers: AnswerMap) => void;
  /** An irrelevant response (a test, a duplicate) was taken out of the report. */
  onDeleted: (responseId: number) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
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

  async function remove() {
    if (!response) return;
    const sure = await confirm({
      title: "למחוק את המשוב?",
      description:
        "המשוב יוצא מהדוח, מהממוצעים ומה-PDF. אפשר להחזיר אותו מיד, מההודעה שתופיע אחרי המחיקה.",
      confirmLabel: "מחיקה",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!sure) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await deleteFormResponse(response.id, response.form_id);
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        stopEdit();
        onDeleted(response.id);
      } catch (e) {
        console.error("deleteFormResponse threw:", e);
        setMessage("Deleting failed.");
      }
    });
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
            {!editing && (
              <span className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={remove}
                  disabled={pending}
                  title="המשוב לא רלוונטי (בדיקה, כפילות, טופס לא נכון) - מוציאים אותו מהדוח"
                >
                  {pending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="me-1.5 h-3.5 w-3.5" />
                  )}
                  מחיקה
                </Button>
                {canEdit && (
                  <Button type="button" variant="outline" size="sm" onClick={startEdit}>
                    <Pencil className="me-1.5 h-3.5 w-3.5" />
                    עריכה
                  </Button>
                )}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {message && !editing && (
          <p dir="rtl" className="text-right text-xs text-destructive">
            {message}
          </p>
        )}

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
  comparison,
  pdfUrl,
  onView,
  onDelete,
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
  /** This trip vs its escort's earlier trips - null when there are none. */
  comparison: TripComparison | null;
  /** This trip alone as a PDF. */
  pdfUrl: string;
  onView: (response: FormResponseRow) => void;
  /** Remove this (empty) trip link - the "no trip" bucket has none. */
  onDelete: () => void;
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
        <TableCell className="w-10 p-1 text-right">
          {trip.inviteId !== null && (
            // A trip that got answers keeps its row - its responses go first.
            <span
              title={
                responses.length > 0
                  ? "בטיול יש משובים - מוחקים אותם קודם, ואז את הטיול"
                  : "מחיקת הטיול - אם לא צריך אותו"
              }
            >
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                disabled={responses.length > 0}
                aria-label={`Delete trip ${trip.code ?? ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={showTravelers ? 9 : 8} className="space-y-4 p-4">
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm" className="h-7">
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  <FileDown className="me-1.5 h-3.5 w-3.5" />
                  PDF of this trip
                </a>
              </Button>
            </div>
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
            {comparison && (
              <TripComparisonBlock comparison={comparison} ratingFields={ratingFields} />
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
