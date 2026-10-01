"use client";

/**
 * /tours/calendar - holidays, fasts, carnivals and school breaks by year
 * (functional spec 5.7). They are the background of the departures board and of
 * the season duplication.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/components/confirm-provider";
import {
  deleteCalendarPeriod,
  listCalendarPeriods,
  saveCalendarPeriod,
  type CalendarPeriodRow,
} from "@/lib/actions/tours-calendar-actions";
import { formatDateShort } from "@/lib/tours/deadlines";
import { CALENDAR_KINDS, CALENDAR_KIND_LABELS, type CalendarKind } from "@/types/tours.types";
import {
  Field,
  Ltr,
  Notice,
  RtlDialogContent,
  RtlDialogFooter,
  RtlDialogHeader,
} from "@/components/tours/flights/block-ui";

const LOAD_FAILED = "טעינת הלוח נכשלה. המסך זמין כשהחברה הפעילה מוכרת טיולים.";

const kindLabel = (kind: string) =>
  (CALENDAR_KINDS as readonly string[]).includes(kind) ? CALENDAR_KIND_LABELS[kind as CalendarKind] : kind;

export function CalendarClient() {
  const confirm = useConfirm();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [periods, setPeriods] = useState<CalendarPeriodRow[] | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarPeriodRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async (forYear: number) => {
    try {
      const res = await listCalendarPeriods(forYear);
      if (res.success) {
        setPeriods(res.data.periods);
        setYears(res.data.years);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("calendar: load failed", e);
      setError(LOAD_FAILED);
    }
  }, []);

  useEffect(() => {
    setPeriods(null);
    void load(year);
  }, [load, year]);

  // The year filter offers every year that has rows, this year and the next two.
  const thisYear = new Date().getFullYear();
  const yearOptions = [...new Set([...years, thisYear, thisYear + 1, thisYear + 2, year])].sort((a, b) => a - b);

  const remove = async (period: CalendarPeriodRow) => {
    const ok = await confirm({
      title: "למחוק את התקופה?",
      description: `"${period.name}" (${period.year}) תימחק מהלוח. אי אפשר לשחזר.`,
      confirmLabel: "מחיקה",
      cancelLabel: "חזרה",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(period.id);
    try {
      const res = await deleteCalendarPeriod(period.id);
      if (res.success) {
        toast.success("התקופה נמחקה");
        await load(year);
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      console.error("calendar: delete failed", e);
      toast.error("המחיקה נכשלה. נסו שוב.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div dir="rtl">
      <PageHeader
        title="לוח חגים וחופשות"
        description="חגים, צומות, קרנבלים וחופשות בתי ספר לפי שנה. הלוח מסומן ברקע של לוח היציאות ומשמש בשכפול עונה."
        actions={
          <>
            <Select dir="rtl" value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28" aria-label="שנה">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setEditing("new")}>תקופה חדשה</Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 space-y-2">
          <Notice tone="danger">{error}</Notice>
          <Button size="sm" variant="outline" onClick={() => void load(year)}>
            ניסיון נוסף
          </Button>
        </div>
      )}

      {periods === null && !error ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : periods !== null && periods.length === 0 ? (
        <Notice>אין תקופות לשנת {year}. הוסיפו את החגים והחופשות של השנה.</Notice>
      ) : periods !== null ? (
        <div className="rounded-lg border bg-card">
          <Table look="list">
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>סוג</TableHead>
                <TableHead>מועד</TableHead>
                <TableHead>תחילה</TableHead>
                <TableHead>סוף</TableHead>
                <TableHead>הערה</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.is_global && (
                      <Badge variant="outline" className="ms-2">
                        גלובלי
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{kindLabel(p.kind)}</TableCell>
                  <TableCell>{p.holiday_date ? <Ltr>{formatDateShort(p.holiday_date)}</Ltr> : "-"}</TableCell>
                  <TableCell>{p.start_date ? <Ltr>{formatDateShort(p.start_date)}</Ltr> : "-"}</TableCell>
                  <TableCell>{p.end_date ? <Ltr>{formatDateShort(p.end_date)}</Ltr> : "-"}</TableCell>
                  <TableCell className="max-w-xs text-muted-foreground" dir="auto">
                    {p.note ?? ""}
                  </TableCell>
                  <TableCell>
                    {p.can_edit ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          עריכה
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={deleting === p.id}
                          onClick={() => remove(p)}
                        >
                          מחיקה
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">לקריאה בלבד</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {editing && (
        <PeriodDialog
          period={editing === "new" ? null : editing}
          defaultYear={year}
          onClose={() => setEditing(null)}
          onSaved={async (savedYear) => {
            setEditing(null);
            if (savedYear !== year) setYear(savedYear);
            else await load(year);
          }}
        />
      )}
    </div>
  );
}

function PeriodDialog({
  period,
  defaultYear,
  onClose,
  onSaved,
}: {
  period: CalendarPeriodRow | null;
  defaultYear: number;
  onClose: () => void;
  onSaved: (year: number) => Promise<void>;
}) {
  const [name, setName] = useState(period?.name ?? "");
  const [kind, setKind] = useState(period?.kind ?? "holiday");
  const [year, setYear] = useState(String(period?.year ?? defaultYear));
  const [holidayDate, setHolidayDate] = useState(period?.holiday_date ?? "");
  const [startDate, setStartDate] = useState(period?.start_date ?? "");
  const [endDate, setEndDate] = useState(period?.end_date ?? "");
  const [note, setNote] = useState(period?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearValue = Number(year);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveCalendarPeriod({
        ...(period ? { id: period.id } : {}),
        year: yearValue,
        name,
        kind,
        holiday_date: holidayDate || null,
        start_date: startDate || null,
        end_date: endDate || null,
        note: note || null,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      toast.success(period ? "התקופה עודכנה" : "התקופה נוספה");
      await onSaved(yearValue);
    } catch (e) {
      console.error("calendar: save failed", e);
      setError("השמירה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RtlDialogContent className="sm:max-w-lg">
        <RtlDialogHeader>
          <DialogTitle>{period ? `עריכת תקופה: ${period.name}` : "תקופה חדשה"}</DialogTitle>
          <DialogDescription>
            לחג של יום אחד מספיק המועד. לתקופה (חופשה, חול המועד) הזינו תחילה וסוף.
          </DialogDescription>
        </RtlDialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label="שם" htmlFor="period-name">
              <Input id="period-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="שנה" htmlFor="period-year">
              <Input id="period-year" dir="ltr" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            </Field>
          </div>
          <Field label="סוג">
            <Select dir="rtl" value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALENDAR_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {CALENDAR_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="מועד" htmlFor="period-date">
              <Input id="period-date" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
            </Field>
            <Field label="תחילה" htmlFor="period-start">
              <Input id="period-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="סוף" htmlFor="period-end">
              <Input id="period-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field label="הערה (לא חובה)" htmlFor="period-note">
            <Input id="period-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <RtlDialogFooter>
          <Button onClick={submit} disabled={saving || !name.trim() || !Number.isInteger(yearValue)}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            חזרה
          </Button>
        </RtlDialogFooter>
      </RtlDialogContent>
    </Dialog>
  );
}
