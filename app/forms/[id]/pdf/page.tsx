import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { getForm } from "@/lib/actions/form-actions";
import { getFormTripReport } from "@/lib/actions/form-report-actions";
import { getFormResponses } from "@/lib/actions/form-response-actions";
import { fieldLabel, pickLang } from "@/lib/forms/i18n";
import { formatAnswer } from "@/lib/forms/validation";
import { fmtAvg, fmtDate, fmtTravelers } from "@/lib/forms/format";
import {
  compareWithEscortPast,
  filterTrips,
  responsesOfTrips,
  summarizeTrips,
  tripFiltersFromQuery,
} from "@/lib/forms/report";
import type { TripFilters, TripRow } from "@/lib/forms/report";
import type { AnswerValue, FormField, FormLang, FormResponseRow } from "@/types/form.types";
import { PrintBar } from "./print-bar";

/*
 * The trips report as a printable document: page 1 is the summary of what the
 * report's filters showed, then one page per response (one family). The
 * browser's own "Save as PDF" makes the file - it renders Hebrew and RTL
 * exactly like the screen, which no server-side PDF library here does.
 *
 * Lives OUTSIDE the (dashboard) route group so no sidebar or top bar prints.
 * Still /forms/*, so middleware lets a forms_operator in, and every loader
 * below runs requireFormsAccess + requireFormVisible like the report itself.
 */

export const dynamic = "force-dynamic";

const TEXT = {
  he: {
    title: "סיכום משובים",
    generated: "הופק",
    trips: "טיולים",
    responses: "משובים",
    travelers: "נוסעים",
    average: "ממוצע כללי",
    perQuestion: "ממוצע לפי שאלה",
    question: "שאלה",
    avg: "ממוצע",
    answered: "ענו",
    tripList: "הטיולים",
    code: "קוד",
    escort: "מלווה",
    departure: "יציאה",
    empty: "אין משובים בטווח הזה.",
    of: (i: number, n: number) => `משוב ${i} מתוך ${n}`,
    noName: "ללא שם",
    submitted: "נשלח",
    noTrip: "ללא טיול",
    all: "כל הטיולים",
    year: "שנת",
    from: "יציאה מ-",
    to: "עד",
    compare: (name: string, n: number) =>
      n === 1 ? `מול הטיול הקודם של ${name}` : `מול ${n} הטיולים הקודמים של ${name}`,
    thisTrip: "הטיול הזה",
    earlier: "קודמים",
    change: "שינוי",
    everyone: "כל הטיולים",
    overall: "כללי",
    print: "הדפסה / שמירה כ-PDF",
    hint: "בחלון ההדפסה בוחרים יעד \"שמירה כ-PDF\" (Save as PDF). עמוד ראשון - סיכום, ואחריו עמוד לכל משפחה.",
    fileName: "משובים",
  },
  en: {
    title: "Feedback summary",
    generated: "Generated",
    trips: "Trips",
    responses: "Responses",
    travelers: "Travellers",
    average: "Overall average",
    perQuestion: "Average per question",
    question: "Question",
    avg: "Average",
    answered: "Answered",
    tripList: "Trips",
    code: "Code",
    escort: "Escort",
    departure: "Departure",
    empty: "No responses in this range.",
    of: (i: number, n: number) => `Response ${i} of ${n}`,
    noName: "No name",
    submitted: "Submitted",
    noTrip: "No trip",
    all: "All trips",
    year: "Year",
    from: "Departure from",
    to: "to",
    compare: (name: string, n: number) =>
      n === 1 ? `vs ${name}'s previous trip` : `vs ${name}'s ${n} earlier trips`,
    thisTrip: "This trip",
    earlier: "Earlier",
    change: "Change",
    everyone: "All trips",
    overall: "Overall",
    print: "Print / Save as PDF",
    hint: 'In the print window pick "Save as PDF" as the destination. Page 1 is the summary, then a page per family.',
    fileName: "Feedback",
  },
} as const;

type Text = (typeof TEXT)[FormLang];

const answered = (value: AnswerValue | undefined) =>
  value !== undefined && value !== null && value !== "";

/** "BBC-124 · Dana · 01.03.2025" / "Year 2025 · escort: Dana" / "All trips". */
function scopeLine(filters: TripFilters, trips: TripRow[], t: Text): string {
  if (filters.trip === "none") return t.noTrip;
  if (filters.trip !== undefined && filters.trip !== null) {
    const trip = trips[0];
    return trip
      ? [trip.code, trip.escort, trip.departure && fmtDate(trip.departure)]
          .filter(Boolean)
          .join(" · ")
      : t.all;
  }
  const parts: string[] = [];
  const code = [filters.prefix, filters.num].filter(Boolean).join("-");
  if (code) parts.push(`${t.code} ${code}`);
  if (filters.escort) parts.push(`${t.escort}: ${filters.escort}`);
  if (filters.year) parts.push(`${t.year} ${filters.year}`);
  if (filters.fromDate || filters.toDate) {
    parts.push(
      [
        filters.fromDate && `${t.from}${fmtDate(filters.fromDate)}`,
        filters.toDate && `${t.to} ${fmtDate(filters.toDate)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : t.all;
}

function Stars({ value, max }: { value: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className="h-3.5 w-3.5"
          fill={i < Math.round(value) ? "currentColor" : "none"}
          strokeWidth={1.5}
        />
      ))}
      <span className="ms-1.5 font-semibold tabular-nums text-zinc-900">
        {value}/{max}
      </span>
    </span>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-zinc-400">-</span>;
  const same = Math.abs(value) < 0.05;
  return (
    <span
      dir="ltr"
      className={
        same
          ? "text-zinc-500"
          : value > 0
            ? "font-semibold text-emerald-700"
            : "font-semibold text-red-700"
      }
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
    </span>
  );
}

/** One A4 sheet on screen; a page of its own in print. */
function Sheet({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return (
    <section
      className={
        "mx-auto mb-6 w-full max-w-[210mm] bg-white p-[12mm] shadow-sm ring-1 ring-zinc-200 " +
        "print:mb-0 print:max-w-none print:p-0 print:shadow-none print:ring-0 " +
        (first ? "" : "break-before-page")
      }
    >
      {children}
    </section>
  );
}

const barColor = (ratio: number) =>
  ratio >= 0.9 ? "#10b981" : ratio >= 0.7 ? "#f59e0b" : "#ef4444";

const ratingMax = (field: FormField) =>
  typeof field.config.max === "number" ? field.config.max : 5;

export default async function FormPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const formId = Number(id);
  if (!Number.isFinite(formId)) notFound();

  const loaded = await getForm(formId);
  if (!loaded) notFound();

  const [{ report, ratingFields: ratingInfo }, responses, query] = await Promise.all([
    getFormTripReport(formId),
    getFormResponses(formId),
    searchParams,
  ]);

  const { form } = loaded;
  const lang: FormLang = form.languages === "en" ? "en" : "he";
  const dir = lang === "he" ? "rtl" : "ltr";
  const t = TEXT[lang];

  const filters = tripFiltersFromQuery(query);
  const trips = filterTrips(report.trips, filters);
  const scoped = responsesOfTrips(responses, trips, report.trips);
  const summary = summarizeTrips(trips, scoped, ratingInfo);

  const byId = new Map(loaded.fields.map((field) => [field.id, field]));
  const ratingFields = ratingInfo
    .map((info) => byId.get(info.id))
    .filter((field): field is FormField => field !== undefined);
  const clientFields = loaded.fields.filter((field) => !field.staff_only);
  const nameField = clientFields.find((field) => field.type === "short_text");

  // A single trip's PDF also says how it did against the escort's earlier trips.
  const singleTrip = typeof filters.trip === "number" && trips.length === 1 ? trips[0] : null;
  const comparison = singleTrip
    ? compareWithEscortPast(singleTrip, report.trips, responses, ratingInfo)
    : null;

  // Families in trip order (as the report lists them), oldest answer first.
  const families: { response: FormResponseRow; trip: TripRow }[] = trips.flatMap((trip) =>
    responsesOfTrips(scoped, [trip], report.trips)
      .slice()
      .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
      .map((response) => ({ response, trip })),
  );

  const title = pickLang(form.title_en, form.title_he, lang);
  const scope = scopeLine(filters, trips, t);
  const today = new Date().toISOString().slice(0, 10);
  const fileName = `${t.fileName} - ${title} - ${scope}`.replace(/[\\/:*?"<>|]+/g, "-");
  const accent = form.accent_color || "#5BFF95";

  return (
    <div
      dir={dir}
      lang={lang}
      className="min-h-screen bg-zinc-100 text-zinc-900 [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:bg-white"
    >
      <style>{"@page { size: A4; margin: 14mm 12mm; }"}</style>
      <PrintBar fileName={fileName} label={t.print} hint={t.hint} dir={dir} />

      <main className="py-6 print:py-0">
        {/* Page 1 - the summary */}
        <Sheet first>
          <div className="mb-5 h-1.5 w-16 rounded-full" style={{ backgroundColor: accent }} />
          <header className="mb-6 flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-500">{t.title}</p>
              <h1 className="mt-1 text-2xl font-bold leading-tight">{title}</h1>
              <p className="mt-1 text-sm text-zinc-600">{scope}</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {t.generated} {fmtDate(today)}
              </p>
            </div>
            {form.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logo_url} alt="" className="h-14 w-auto max-w-[140px] object-contain" />
            )}
          </header>

          <div className="mb-6 grid grid-cols-4 gap-3">
            <Tile label={t.trips} value={String(summary.tripCount)} />
            <Tile label={t.responses} value={String(summary.responseCount)} />
            <Tile label={t.travelers} value={fmtTravelers(summary.travelers)} />
            <Tile label={t.average} value={fmtAvg(summary.overallAvg)} />
          </div>

          {ratingFields.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-bold">{t.perQuestion}</h2>
              <table className="mb-6 w-full text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr className="border-b border-zinc-200">
                    <th className="py-1.5 text-start font-medium">{t.question}</th>
                    <th className="w-40 py-1.5 text-start font-medium">{t.avg}</th>
                    <th className="w-14 py-1.5 text-center font-medium">{t.answered}</th>
                  </tr>
                </thead>
                <tbody>
                  {ratingFields.map((field) => {
                    const stat = summary.perField.find((s) => s.fieldId === field.id);
                    const avg = stat?.avg ?? null;
                    const ratio = avg === null ? 0 : Math.min(1, avg / ratingMax(field));
                    return (
                      <tr key={field.id} className="break-inside-avoid border-b border-zinc-100">
                        <td className="py-1.5 pe-4">{fieldLabel(field, lang)}</td>
                        <td className="py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-9 font-semibold tabular-nums">{fmtAvg(avg)}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                              <span
                                className="block h-full rounded-full"
                                style={{ width: `${ratio * 100}%`, backgroundColor: barColor(ratio) }}
                              />
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 text-center tabular-nums text-zinc-500">
                          {stat?.count ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {comparison && (
            <>
              <h2 className="mb-1 text-sm font-bold">
                {t.compare(comparison.escort, comparison.pastTrips.length)}
              </h2>
              <p className="mb-2 text-xs text-zinc-500">
                {comparison.pastTrips
                  .map((trip) => `${trip.code} (${fmtDate(trip.departure)})`)
                  .join(" · ")}
              </p>
              <table className="mb-6 w-full text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr className="border-b border-zinc-200">
                    <th className="py-1.5 text-start font-medium">{t.question}</th>
                    <th className="w-20 py-1.5 text-center font-medium">{t.thisTrip}</th>
                    <th className="w-20 py-1.5 text-center font-medium">{t.earlier}</th>
                    <th className="w-16 py-1.5 text-center font-medium">{t.change}</th>
                    <th className="w-20 py-1.5 text-center font-medium">{t.everyone}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr className="border-b border-zinc-100 font-semibold">
                    <td className="py-1.5">{t.overall}</td>
                    <td className="py-1.5 text-center">{fmtAvg(comparison.current)}</td>
                    <td className="py-1.5 text-center">{fmtAvg(comparison.past)}</td>
                    <td className="py-1.5 text-center">
                      <Delta value={comparison.delta} />
                    </td>
                    <td className="py-1.5 text-center text-zinc-500">{fmtAvg(comparison.others)}</td>
                  </tr>
                  {ratingFields.map((field) => {
                    const row = comparison.perField.find((f) => f.fieldId === field.id);
                    return (
                      <tr key={field.id} className="break-inside-avoid border-b border-zinc-100">
                        <td className="py-1.5 pe-4">{fieldLabel(field, lang)}</td>
                        <td className="py-1.5 text-center">{fmtAvg(row?.current ?? null)}</td>
                        <td className="py-1.5 text-center">{fmtAvg(row?.past ?? null)}</td>
                        <td className="py-1.5 text-center">
                          <Delta value={row?.delta ?? null} />
                        </td>
                        <td className="py-1.5 text-center text-zinc-500">
                          {fmtAvg(row?.others ?? null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {trips.length > 1 && (
            <>
              <h2 className="mb-2 text-sm font-bold">{t.tripList}</h2>
              <table className="w-full text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr className="border-b border-zinc-200">
                    <th className="py-1.5 text-start font-medium">{t.code}</th>
                    <th className="py-1.5 text-start font-medium">{t.escort}</th>
                    <th className="py-1.5 text-start font-medium">{t.departure}</th>
                    <th className="py-1.5 text-center font-medium">{t.responses}</th>
                    <th className="py-1.5 text-center font-medium">{t.travelers}</th>
                    <th className="py-1.5 text-center font-medium">{t.avg}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {trips.map((trip) => (
                    <tr
                      key={trip.inviteId ?? "none"}
                      className="break-inside-avoid border-b border-zinc-100"
                    >
                      <td className="py-1.5 font-mono font-semibold">
                        <bdi>{trip.code ?? t.noTrip}</bdi>
                      </td>
                      <td className="py-1.5">{trip.escort ?? "-"}</td>
                      <td className="py-1.5">{fmtDate(trip.departure)}</td>
                      <td className="py-1.5 text-center">{trip.responseCount}</td>
                      <td className="py-1.5 text-center">{fmtTravelers(trip.travelers)}</td>
                      <td className="py-1.5 text-center font-semibold">{fmtAvg(trip.overallAvg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {families.length === 0 && <p className="text-sm text-zinc-500">{t.empty}</p>}
        </Sheet>

        {/* Then one page per family */}
        {families.map(({ response, trip }, index) => {
          const nameAnswer = nameField ? response.answers[String(nameField.id)] : undefined;
          const name =
            response.recipient_name ?? (answered(nameAnswer) ? String(nameAnswer) : null);
          const ratings = ratingFields
            .map((field) => response.answers[String(field.id)])
            .filter((value): value is number => typeof value === "number");
          const avg =
            ratings.length > 0 ? ratings.reduce((sum, v) => sum + v, 0) / ratings.length : null;
          const party =
            report.travelerFieldId !== null
              ? response.answers[String(report.travelerFieldId)]
              : undefined;

          return (
            <Sheet key={response.id}>
              <header className="mb-4 border-b border-zinc-200 pb-3">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-bold">{name ?? t.noName}</h2>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {t.of(index + 1, families.length)}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
                  <bdi className="font-mono font-semibold text-zinc-800">
                    {trip.code ?? t.noTrip}
                  </bdi>
                  {trip.staffInfo.map((item) => (
                    <span key={item.label}>
                      {item.label}: <span className="text-zinc-800">{item.value}</span>
                    </span>
                  ))}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-zinc-500">
                  <span>
                    {t.submitted} {fmtDate(response.submitted_at)}
                  </span>
                  {answered(party) && (
                    <span>
                      {t.travelers}: {String(party)}
                    </span>
                  )}
                  {avg !== null && (
                    <span>
                      {t.avg}: <span className="font-semibold text-zinc-800">{avg.toFixed(2)}</span>
                    </span>
                  )}
                </p>
              </header>

              <div className="space-y-1">
                {clientFields.map((field) => {
                  if (field.type === "section") {
                    return (
                      <h3
                        key={field.id}
                        className="break-after-avoid pt-3 text-sm font-bold text-zinc-700"
                      >
                        {fieldLabel(field, lang)}
                      </h3>
                    );
                  }
                  const value = response.answers[String(field.id)];
                  // A conditional question the family never saw is not "unanswered".
                  if (!answered(value) && field.config.show_if) return null;
                  const label = fieldLabel(field, lang);
                  if (!answered(value)) {
                    return (
                      <div
                        key={field.id}
                        className="flex justify-between gap-4 py-1 text-sm text-zinc-400"
                      >
                        <span>{label}</span>
                        <span>—</span>
                      </div>
                    );
                  }
                  if (
                    field.type === "long_text" ||
                    (typeof value === "string" && value.length > 60)
                  ) {
                    return (
                      <div
                        key={field.id}
                        className="break-inside-avoid rounded-md bg-zinc-50 px-3 py-2 text-sm"
                      >
                        <p className="text-xs font-medium text-zinc-500">{label}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
                          {formatAnswer(field, value, lang)}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={field.id}
                      className="flex break-inside-avoid items-center justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm"
                    >
                      <span className="min-w-0">{label}</span>
                      <span className="shrink-0 font-semibold">
                        {field.type === "rating" && typeof value === "number" ? (
                          <Stars value={value} max={ratingMax(field)} />
                        ) : (
                          formatAnswer(field, value, lang)
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Sheet>
          );
        })}
      </main>
    </div>
  );
}
