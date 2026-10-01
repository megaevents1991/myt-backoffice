"use client";

/**
 * Create / edit one series (side sheet): code, internal label, the site page it
 * sells on, the route pattern (airport + weekday at each end), the defaults new
 * departures start from, age rules and the audience / tag / destination terms.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ROUTE_TYPE_LABELS, routeType } from "@/lib/tours/routes";
import { CURRENCIES } from "@/types/tours.types";
import { saveSeries } from "@/lib/actions/tours-series-actions";
import { WEEKDAY_LABELS, normalizeAirport } from "@/components/tours/departures/departure-utils";
import type { BoardPackage } from "@/components/tours/departures/types";
import { Field, Ltr, Notice, Toggle, selectClass } from "@/components/tours/departures/ui-bits";
import { SERIES_TERM_KINDS, SERIES_TERM_KIND_LABELS, type SeriesListRow, type SeriesTerm } from "./types";

interface Draft {
  code: string;
  label: string;
  package_id: string;
  arrival_airport: string;
  arrival_weekday: string;
  return_airport: string;
  return_weekday: string;
  default_nights: string;
  default_capacity: string;
  default_currency: string;
  child_max_age: string;
  senior_min_age: string;
  senior_discount: string;
  is_active: boolean;
  termIds: string[];
}

const s = (v: string | number | null | undefined): string => (v == null ? "" : String(v));

const toDraft = (row: SeriesListRow | null): Draft => ({
  code: row?.code ?? "",
  label: s(row?.label),
  package_id: s(row?.package_id),
  arrival_airport: s(row?.arrival_airport),
  arrival_weekday: s(row?.arrival_weekday),
  return_airport: s(row?.return_airport),
  return_weekday: s(row?.return_weekday),
  default_nights: s(row?.default_nights),
  default_capacity: s(row ? row.default_capacity : 45),
  default_currency: row?.default_currency ?? "USD",
  child_max_age: s(row ? row.child_max_age : 16),
  senior_min_age: s(row ? row.senior_min_age : 65),
  senior_discount: s(row ? row.senior_discount : 25),
  is_active: row?.is_active ?? true,
  termIds: row?.termIds ?? [],
});

const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));

function WeekdaySelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select aria-label={label} className={`${selectClass} w-full`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">לא קבוע</option>
      {WEEKDAY_LABELS.map((day, i) => (
        <option key={day} value={i}>
          יום {day}
        </option>
      ))}
    </select>
  );
}

export function SeriesForm({
  target,
  packages,
  terms,
  onClose,
  onSaved,
}: {
  /** A series to edit, "new" for a blank form, null = closed. */
  target: SeriesListRow | "new" | null;
  packages: BoardPackage[];
  terms: SeriesTerm[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target && target !== "new" ? target : null;
  const [draft, setDraft] = useState<Draft>(() => toDraft(editing));
  const [saving, setSaving] = useState(false);
  const targetKey = target === "new" ? "new" : (target?.id ?? "");

  useEffect(() => {
    if (target) setDraft(toDraft(target === "new" ? null : target));
    // Re-seed only when another series (or the blank form) is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const arrival = normalizeAirport(draft.arrival_airport);
  const ret = normalizeAirport(draft.return_airport);
  const type = routeType(arrival ?? null, ret ?? null);
  const codeOk = /^[A-Z][A-Z0-9]{1,7}$/.test(draft.code.trim().toUpperCase());
  const problems: string[] = [];
  if (!codeOk) problems.push("קוד סדרה: 2 עד 8 תווים באנגלית, מתחיל באות");
  if (arrival === undefined || ret === undefined) problems.push("קוד שדה תעופה הוא שלוש אותיות באנגלית");
  const codeLocked = Boolean(editing && editing.departures > 0);

  const toggleTerm = (id: string) =>
    set("termIds", draft.termIds.includes(id) ? draft.termIds.filter((t) => t !== id) : [...draft.termIds, id]);

  const submit = async () => {
    setSaving(true);
    const result = await saveSeries(editing?.id ?? null, {
      code: draft.code,
      label: draft.label.trim() || null,
      package_id: draft.package_id || null,
      arrival_airport: draft.arrival_airport.trim() || null,
      arrival_weekday: numOrNull(draft.arrival_weekday),
      return_airport: draft.return_airport.trim() || null,
      return_weekday: numOrNull(draft.return_weekday),
      default_nights: numOrNull(draft.default_nights),
      default_capacity: numOrNull(draft.default_capacity),
      default_currency: draft.default_currency,
      child_max_age: numOrNull(draft.child_max_age) ?? 16,
      senior_min_age: numOrNull(draft.senior_min_age),
      senior_discount: numOrNull(draft.senior_discount),
      is_active: draft.is_active,
      termIds: draft.termIds,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error, { duration: 7000 });
      return;
    }
    toast.success(editing ? "הסדרה נשמרה" : "הסדרה נוצרה");
    onSaved();
    onClose();
  };

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 border-b pb-4 pe-6 ps-12 pt-5 text-start sm:text-start">
          <SheetTitle className="font-display text-xl">
            {editing ? (
              <>
                סדרה <Ltr className="font-mono">{editing.code}</Ltr>
              </>
            ) : (
              "סדרה חדשה"
            )}
          </SheetTitle>
          <SheetDescription>
            סדרה היא דפוס שחוזר: מאיפה נוחתים ומאיפה חוזרים, באיזה יום, לכמה לילות. יציאות חדשות מתחילות מהערכים האלה.
          </SheetDescription>
        </SheetHeader>

        <fieldset disabled={saving} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="קוד" hint={codeLocked ? "נעול: יש יציאות שהקוד שלהן נבנה ממנו" : "למשל BBC"}>
              <Input
                dir="ltr"
                className="h-9 font-mono uppercase"
                maxLength={8}
                value={draft.code}
                disabled={codeLocked}
                onChange={(e) => set("code", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="שם פנימי" hint='למשל "מסורת"'>
              <Input className="h-9" value={draft.label} onChange={(e) => set("label", e.target.value)} />
            </Field>
            <Field label="העמוד באתר" className="col-span-2" hint="העמוד שעליו נמכרות היציאות של הסדרה. יציאות קיימות נשארות בעמוד שלהן">
              <select className={`${selectClass} w-full`} value={draft.package_id} onChange={(e) => set("package_id", e.target.value)}>
                <option value="">בלי עמוד</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold">דפוס המסלול</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="נוחתים ב">
                <Input
                  dir="ltr"
                  className="h-9 font-mono uppercase"
                  maxLength={3}
                  placeholder="LHR"
                  value={draft.arrival_airport}
                  onChange={(e) => set("arrival_airport", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="יום נחיתה">
                <WeekdaySelect label="יום נחיתה" value={draft.arrival_weekday} onChange={(v) => set("arrival_weekday", v)} />
              </Field>
              <Field label="חוזרים מ">
                <Input
                  dir="ltr"
                  className="h-9 font-mono uppercase"
                  maxLength={3}
                  placeholder="CDG"
                  value={draft.return_airport}
                  onChange={(e) => set("return_airport", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="יום חזרה">
                <WeekdaySelect label="יום חזרה" value={draft.return_weekday} onChange={(v) => set("return_weekday", v)} />
              </Field>
            </div>
            {type && <p className="mt-2 text-xs text-muted-foreground">סוג המסלול: {ROUTE_TYPE_LABELS[type]}.</p>}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">ברירות מחדל ליציאה חדשה</h3>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              <Field label="לילות">
                <Input dir="ltr" inputMode="numeric" className="h-9" value={draft.default_nights} onChange={(e) => set("default_nights", e.target.value)} />
              </Field>
              <Field label="קיבולת">
                <Input dir="ltr" inputMode="numeric" className="h-9" value={draft.default_capacity} onChange={(e) => set("default_capacity", e.target.value)} />
              </Field>
              <Field label="מטבע">
                <select dir="ltr" className={`${selectClass} w-full`} value={draft.default_currency} onChange={(e) => set("default_currency", e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ילד עד גיל">
                <Input dir="ltr" inputMode="numeric" className="h-9" value={draft.child_max_age} onChange={(e) => set("child_max_age", e.target.value)} />
              </Field>
              <Field label="ותיק מגיל">
                <Input dir="ltr" inputMode="numeric" className="h-9" value={draft.senior_min_age} onChange={(e) => set("senior_min_age", e.target.value)} />
              </Field>
              <Field label="הנחת ותיק">
                <Input dir="ltr" inputMode="decimal" className="h-9" value={draft.senior_discount} onChange={(e) => set("senior_discount", e.target.value)} />
              </Field>
            </div>
          </section>

          {SERIES_TERM_KINDS.map((kind) => {
            const options = terms.filter((t) => t.kind === kind);
            return (
              <section key={kind}>
                <h3 className="mb-2 text-sm font-semibold">{SERIES_TERM_KIND_LABELS[kind]}</h3>
                {options.length === 0 ? (
                  <p className="text-xs text-muted-foreground">אין ערכים מהסוג הזה. מוסיפים אותם במסך קטגוריות ותגיות.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((t) => {
                      const on = draft.termIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleTerm(t.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-input bg-background hover:bg-accent",
                          )}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

          <label className="flex items-center gap-2 text-sm">
            <Toggle checked={draft.is_active} onChange={(v) => set("is_active", v)} label="סדרה פעילה" />
            סדרה פעילה
            <span className="text-xs text-muted-foreground">סדרה לא פעילה לא מוצעת ביצירת יציאה חדשה</span>
          </label>

          {problems.length > 0 && draft.code !== "" && <Notice tone="error">{problems.join(" · ")}</Notice>}
        </fieldset>

        <div className="flex items-center gap-2 border-t px-6 py-3">
          <Button onClick={submit} disabled={saving || problems.length > 0}>
            {saving && <Loader2 className="animate-spin" />}
            {editing ? "שמירה" : "יצירת סדרה"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
