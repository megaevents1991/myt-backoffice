"use client";

/**
 * "שכפול עונה" (functional spec 4.7): pick a date range and a weekday, get one
 * proposed departure per week following the series pattern (start on that
 * weekday, end after the series' nights, route from the series), shown against
 * the holiday calendar. The operator ticks which to create; codes that already
 * exist are shown and skipped. Prices and promotions can be copied from an
 * existing departure of the series.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { departureRouteLabel } from "@/lib/tours/routes";
import { createSeasonDepartures, getSeasonContext } from "@/lib/actions/tours-series-actions";
import {
  WEEKDAY_LABELS,
  addDays,
  departureCode,
  fmtDate,
  fmtDateRange,
  isIsoDate,
  nightsBetween,
  periodLabel,
  periodsOverlapping,
  seasonYearOf,
  weekdayOf,
} from "@/components/tours/departures/departure-utils";
import type { BoardPeriod } from "@/components/tours/departures/types";
import { Chip, DialogActions, Field, Ltr, Notice, selectClass } from "@/components/tours/departures/ui-bits";
import type { SeasonContext, SeasonCreateResult, SeriesListRow } from "./types";

const MAX_PROPOSALS = 120;

/** The trip length the series usually runs: its own default, else what its departures show, else the weekday gap. */
function defaultNights(series: SeriesListRow, context: SeasonContext | null): number | null {
  if (series.default_nights != null) return series.default_nights;
  const counts = new Map<number, number>();
  for (const d of context?.existing ?? []) {
    const nights = nightsBetween(d.start_date, d.end_date);
    if (nights && nights > 0) counts.set(nights, (counts.get(nights) ?? 0) + 1);
  }
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (usual != null) return usual;
  if (series.arrival_weekday != null && series.return_weekday != null) {
    return (series.return_weekday - series.arrival_weekday + 7) % 7 || 7;
  }
  return null;
}

export function SeasonDialog({
  series,
  periods,
  onClose,
  onCreated,
}: {
  series: SeriesListRow | null;
  periods: BoardPeriod[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [context, setContext] = useState<SeasonContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [weekday, setWeekday] = useState<number>(0);
  const [nights, setNights] = useState("");
  const [season, setSeason] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [copyPrices, setCopyPrices] = useState(true);
  const [copyPromotions, setCopyPromotions] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SeasonCreateResult | null>(null);
  const seriesId = series?.id;

  useEffect(() => {
    if (!series) return;
    setContext(null);
    setLoadError(null);
    setFrom("");
    setTo("");
    setSeason("");
    setSourceId("");
    setUnticked(new Set());
    setResult(null);
    setWeekday(series.arrival_weekday ?? 0);
    setNights(series.default_nights != null ? String(series.default_nights) : "");
    let live = true;
    void getSeasonContext(series.id).then((res) => {
      if (!live) return;
      if (!res.success) {
        setLoadError(res.error);
        return;
      }
      setContext(res.data);
      const usual = defaultNights(series, res.data);
      setNights((current) => (current === "" && usual != null ? String(usual) : current));
    });
    return () => {
      live = false;
    };
    // The dialog is re-seeded only when another series is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId]);

  const nightsNumber = Number(nights);
  const nightsOk = nights.trim() !== "" && Number.isInteger(nightsNumber) && nightsNumber >= 0 && nightsNumber <= 60;
  const rangeOk = isIsoDate(from) && isIsoDate(to) && to >= from;
  const taken = useMemo(() => new Set(context?.takenCodes ?? []), [context]);

  const proposals = useMemo(() => {
    if (!series || !rangeOk || !nightsOk) return [];
    const out: { key: string; code: string; start: string; end: string; exists: boolean; holidays: BoardPeriod[] }[] = [];
    let day = from;
    while (weekdayOf(day) !== weekday) day = addDays(day, 1);
    for (; day <= to && out.length < MAX_PROPOSALS; day = addDays(day, 7)) {
      const end = addDays(day, nightsNumber);
      const code = departureCode(series.code, day);
      out.push({
        key: day,
        code,
        start: day,
        end,
        exists: taken.has(`${code}:${seasonYearOf(day)}`),
        holidays: periodsOverlapping(periods, day, end),
      });
    }
    return out;
  }, [series, rangeOk, nightsOk, from, to, weekday, nightsNumber, taken, periods]);

  const chosen = proposals.filter((p) => !p.exists && !unticked.has(p.key));
  const sources = (context?.existing ?? []).filter((d) => !d.is_deleted);
  const source = sources.find((d) => d.id === sourceId);
  const route = series ? departureRouteLabel(series.arrival_airport, series.return_airport) : "";

  const create = async () => {
    if (!series) return;
    setSaving(true);
    const res = await createSeasonDepartures({
      seriesId: series.id,
      items: chosen.map((p) => ({ start_date: p.start, end_date: p.end })),
      season: season || null,
      copyFromDepartureId: sourceId || null,
      copyPrices: Boolean(sourceId) && copyPrices,
      copyPromotions: Boolean(sourceId) && copyPromotions,
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error, { duration: 7000 });
      return;
    }
    toast.success(`נוצרו ${res.data.created.length} יציאות כטיוטה`);
    setResult(res.data);
    onCreated();
  };

  const createdYear = result?.created[0] ? seasonYearOf(result.created[0].start_date) : null;

  return (
    <Dialog open={Boolean(series)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="flex max-h-[92vh] max-w-3xl flex-col">
        <DialogHeader className="ps-8 text-start sm:text-start">
          <DialogTitle>
            שכפול עונה · <Ltr className="font-mono">{series?.code}</Ltr>
            {series?.label ? ` · ${series.label}` : ""}
          </DialogTitle>
          <DialogDescription>
            המערכת מציעה יציאה אחת לכל שבוע בטווח, לפי דפוס הסדרה. סמנו אילו ליצור. כל יציאה נוצרת כטיוטה לא מפורסמת, והקוד נבנה מקוד הסדרה
            ומהתאריך.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <Notice tone="success">
              נוצרו {result.created.length} יציאות:{" "}
              <Ltr className="font-mono">{result.created.map((c) => c.code).join(", ") || "—"}</Ltr>
            </Notice>
            {result.skipped.length > 0 && (
              <Notice tone="warning">
                דולגו {result.skipped.length}:{" "}
                {result.skipped.map((s) => (
                  <span key={s.code} className="me-2">
                    <Ltr className="font-mono">{s.code}</Ltr> ({s.reason})
                  </span>
                ))}
              </Notice>
            )}
            <DialogActions>
              <Button variant="outline" onClick={onClose}>
                סגירה
              </Button>
              {series && createdYear && (
                <Button asChild>
                  <Link href={`/tours/departures?series=${series.code}&year=${createdYear}`}>פתיחה בלוח היציאות</Link>
                </Button>
              )}
            </DialogActions>
          </div>
        ) : loadError ? (
          <Notice tone="error">{loadError}</Notice>
        ) : !series ? null : (
          <>
            {!series.package_id && <Notice tone="error">לסדרה אין עמוד באתר. שייכו אותה לעמוד (עריכת הסדרה) לפני יצירת יציאות.</Notice>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Field label="מתאריך">
                <Input dir="ltr" type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="עד תאריך">
                <Input dir="ltr" type="date" className="h-9" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Field label="יום יציאה">
                <select className={`${selectClass} w-full`} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={label} value={i}>
                      יום {label}
                      {series.arrival_weekday === i ? " (הסדרה)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="לילות">
                <Input dir="ltr" inputMode="numeric" className={cn("h-9", !nightsOk && nights !== "" && "border-destructive")} value={nights} onChange={(e) => setNights(e.target.value)} />
              </Field>
              <Field label="עונה (לא חובה)">
                <Input className="h-9" value={season} placeholder="קיץ" onChange={(e) => setSeason(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              מסלול מהסדרה: <Ltr className="font-mono text-foreground">{route || "לא הוגדר"}</Ltr> · מטבע{" "}
              <Ltr className="text-foreground">{source && copyPrices ? source.currency : series.default_currency}</Ltr> · קיבולת{" "}
              {series.default_capacity ?? "—"}
              {nights === "" && " · הזינו מספר לילות כדי לקבל הצעות"}
            </p>

            <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="העתקה מיציאה קיימת של הסדרה (לא חובה)">
                <select className={`${selectClass} w-full`} value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={!context}>
                  <option value="">{context ? "בלי העתקה - יציאות ריקות ממחיר" : "טוען…"}</option>
                  {sources.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} · {fmtDateRange(d.start_date, d.end_date)} · {d.priceRows + d.optionRows > 0 ? "יש מחירים" : "בלי מחירים"}
                      {d.activePromotions ? ` · ${d.activePromotions} הטבות` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-col justify-end gap-1.5 pb-1 text-sm">
                <label className={cn("flex items-center gap-2", sourceId ? "cursor-pointer" : "opacity-50")}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    disabled={!sourceId}
                    checked={copyPrices}
                    onChange={(e) => setCopyPrices(e.target.checked)}
                  />
                  מחירים ומטבע
                </label>
                <label className={cn("flex items-center gap-2", sourceId ? "cursor-pointer" : "opacity-50")}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    disabled={!sourceId}
                    checked={copyPromotions}
                    onChange={(e) => setCopyPromotions(e.target.checked)}
                  />
                  הטבות פעילות
                </label>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border" data-testid="season-proposals">
              {proposals.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  {rangeOk && nightsOk ? "אין יום כזה בטווח שנבחר." : "בחרו טווח תאריכים ומספר לילות כדי לקבל הצעות."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="w-9 px-2 py-1.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                          aria-label="סימון כל ההצעות"
                          checked={chosen.length > 0 && chosen.length === proposals.filter((p) => !p.exists).length}
                          onChange={(e) => setUnticked(e.target.checked ? new Set() : new Set(proposals.map((p) => p.key)))}
                        />
                      </th>
                      <th className="px-2 py-1.5 text-start font-semibold">קוד</th>
                      <th className="px-2 py-1.5 text-start font-semibold">תאריכים</th>
                      <th className="px-2 py-1.5 text-start font-semibold">ימים</th>
                      <th className="px-2 py-1.5 text-start font-semibold">חגים וחופשות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p) => (
                      <tr key={p.key} data-proposal={p.code} className={cn("border-t", p.exists && "bg-muted/40 text-muted-foreground")}>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-[hsl(var(--primary))]"
                            aria-label={`יצירת ${p.code}`}
                            disabled={p.exists}
                            checked={!p.exists && !unticked.has(p.key)}
                            onChange={(e) =>
                              setUnticked((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.delete(p.key);
                                else next.add(p.key);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono font-semibold">
                          <Ltr>{p.code}</Ltr>
                          {p.exists && <Chip className="ms-2 font-sans">קיים, ידולג</Chip>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                          <Ltr>{fmtDateRange(p.start, p.end)}</Ltr>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">
                          {WEEKDAY_LABELS[weekdayOf(p.start)]} עד {WEEKDAY_LABELS[weekdayOf(p.end)]}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="flex flex-wrap gap-1">
                            {p.holidays.map((h) => (
                              <Chip key={h.id} className="border-warning/40 bg-warning-muted text-warning" title={periodLabel(h)}>
                                {h.name}
                              </Chip>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {proposals.length >= MAX_PROPOSALS && (
              <p className="text-xs text-warning">מוצגות {MAX_PROPOSALS} ההצעות הראשונות (עד {fmtDate(proposals[proposals.length - 1].start)}). צמצמו את הטווח.</p>
            )}

            <DialogActions className="justify-between">
              <span className="text-sm text-muted-foreground">
                {proposals.length > 0 && `${chosen.length} מסומנות ליצירה · ${proposals.filter((p) => p.exists).length} כבר קיימות`}
              </span>
              <span className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={saving}>
                  ביטול
                </Button>
                <Button onClick={create} disabled={saving || chosen.length === 0 || !series.package_id}>
                  {saving && <Loader2 className="animate-spin" />}
                  יצירת {chosen.length} יציאות
                </Button>
              </span>
            </DialogActions>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
