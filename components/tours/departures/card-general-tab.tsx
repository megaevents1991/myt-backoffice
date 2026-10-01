"use client";

/**
 * Card tab "כללי": dates, route, season, labels, age rules, meeting time,
 * inclusions, flight mode, docket, notes, itinerary variant. One draft, one
 * save - only the fields that changed are sent.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ROUTE_TYPE_LABELS, routeType } from "@/lib/tours/routes";
import { FLIGHT_MODES, FLIGHT_MODE_LABELS } from "@/types/tours.types";
import { updateDeparture } from "@/lib/actions/tours-departure-actions";
import {
  departureCode,
  effectiveRoute,
  isIsoDate,
  isoToJerusalemLocal,
  jerusalemLocalToIso,
  nightsBetween,
  normalizeAirport,
} from "./departure-utils";
import type { DepartureCardData, DepartureGeneralInput } from "./types";
import { Field, Ltr, Notice, selectClass } from "./ui-bits";

interface Draft {
  start_date: string;
  end_date: string;
  arrival_airport: string;
  return_airport: string;
  season: string;
  card_badge: string;
  date_labels: string;
  itinerary_id: string;
  child_max_age: string;
  senior_min_age: string;
  senior_discount: string;
  meeting_at: string;
  baggage_included: boolean;
  meal_included: boolean;
  transfers_included: boolean;
  connection_out: string;
  connection_back: string;
  flight_mode: string;
  flight_price: string;
  docket_no: string;
  capacity: string;
  notes: string;
}

const str = (v: string | number | null | undefined): string => (v == null ? "" : String(v));

function toDraft(d: DepartureCardData["departure"]): Draft {
  return {
    start_date: d.start_date,
    end_date: d.end_date,
    arrival_airport: str(d.arrival_airport),
    return_airport: str(d.return_airport),
    season: str(d.season),
    card_badge: str(d.card_badge),
    date_labels: d.date_labels.join(", "),
    itinerary_id: str(d.itinerary_id),
    child_max_age: str(d.child_max_age),
    senior_min_age: str(d.senior_min_age),
    senior_discount: str(d.senior_discount),
    meeting_at: isoToJerusalemLocal(d.meeting_at),
    baggage_included: d.baggage_included,
    meal_included: d.meal_included,
    transfers_included: d.transfers_included,
    connection_out: str(d.connection_out),
    connection_back: str(d.connection_back),
    flight_mode: d.flight_mode,
    flight_price: str(d.flight_price),
    docket_no: str(d.docket_no),
    capacity: str(d.capacity),
    notes: str(d.notes),
  };
}

const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const textOrNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const labelsOf = (v: string): string[] => Array.from(new Set(v.split(",").map((l) => l.trim()).filter(Boolean)));

/** The fields of `draft` that differ from `base`, in the shape the action takes. */
function changes(base: Draft, draft: Draft): DepartureGeneralInput {
  const out: DepartureGeneralInput = {};
  if (draft.start_date !== base.start_date || draft.end_date !== base.end_date) {
    out.start_date = draft.start_date;
    out.end_date = draft.end_date;
  }
  if (draft.arrival_airport !== base.arrival_airport) out.arrival_airport = textOrNull(draft.arrival_airport);
  if (draft.return_airport !== base.return_airport) out.return_airport = textOrNull(draft.return_airport);
  if (draft.season !== base.season) out.season = textOrNull(draft.season);
  if (draft.card_badge !== base.card_badge) out.card_badge = textOrNull(draft.card_badge);
  if (draft.date_labels !== base.date_labels) out.date_labels = labelsOf(draft.date_labels);
  if (draft.itinerary_id !== base.itinerary_id) out.itinerary_id = draft.itinerary_id || null;
  if (draft.child_max_age !== base.child_max_age) out.child_max_age = numOrNull(draft.child_max_age);
  if (draft.senior_min_age !== base.senior_min_age) out.senior_min_age = numOrNull(draft.senior_min_age);
  if (draft.senior_discount !== base.senior_discount) out.senior_discount = numOrNull(draft.senior_discount);
  if (draft.meeting_at !== base.meeting_at) out.meeting_at = jerusalemLocalToIso(draft.meeting_at);
  if (draft.baggage_included !== base.baggage_included) out.baggage_included = draft.baggage_included;
  if (draft.meal_included !== base.meal_included) out.meal_included = draft.meal_included;
  if (draft.transfers_included !== base.transfers_included) out.transfers_included = draft.transfers_included;
  if (draft.connection_out !== base.connection_out) out.connection_out = textOrNull(draft.connection_out);
  if (draft.connection_back !== base.connection_back) out.connection_back = textOrNull(draft.connection_back);
  if (draft.flight_mode !== base.flight_mode) out.flight_mode = draft.flight_mode;
  if (draft.flight_price !== base.flight_price) out.flight_price = numOrNull(draft.flight_price) ?? 0;
  if (draft.docket_no !== base.docket_no) out.docket_no = textOrNull(draft.docket_no);
  if (draft.capacity !== base.capacity) out.capacity = numOrNull(draft.capacity);
  if (draft.notes !== base.notes) out.notes = textOrNull(draft.notes);
  return out;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b py-4 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function CardGeneralTab({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const series = data.series;
  const base = useMemo(() => toDraft(d), [d]);
  const [draft, setDraft] = useState<Draft>(base);
  const [saving, setSaving] = useState(false);
  const readOnly = Boolean(d.is_deleted);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const patch = changes(base, draft);
  const dirty = Object.keys(patch).length > 0;

  const arrival = normalizeAirport(draft.arrival_airport);
  const ret = normalizeAirport(draft.return_airport);
  const route = effectiveRoute({ arrival_airport: arrival ?? null, return_airport: ret ?? null }, series);
  const type = routeType(route.arrival_airport, route.return_airport);
  const datesOk = isIsoDate(draft.start_date) && isIsoDate(draft.end_date) && draft.end_date >= draft.start_date;
  const problems: string[] = [];
  if (!datesOk) problems.push("תאריך החזרה מוקדם מתאריך היציאה, או שחסר תאריך");
  if (arrival === undefined || ret === undefined) problems.push("קוד שדה תעופה הוא שלוש אותיות באנגלית");

  const codeByDate = series && isIsoDate(draft.start_date) ? departureCode(series.code, draft.start_date) : null;

  const save = async () => {
    setSaving(true);
    const result = await updateDeparture(d.id, patch);
    setSaving(false);
    if (!result.success) {
      toast.error(result.error, { duration: 7000 });
      return;
    }
    toast.success("הפרטים נשמרו");
    await onSaved();
  };

  return (
    <fieldset disabled={readOnly || saving} className="min-w-0">
      {readOnly && <Notice tone="info" className="mt-2">היציאה מחוקה. שחזרו אותה כדי לערוך.</Notice>}

      <Section title="תאריכים ומסלול">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="תאריך יציאה">
            <Input dir="ltr" type="date" className="h-9" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
          <Field label="תאריך חזרה" hint={datesOk ? `${nightsBetween(draft.start_date, draft.end_date)} לילות` : undefined}>
            <Input dir="ltr" type="date" className="h-9" value={draft.end_date} min={draft.start_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
          <Field label="נוחתים ב" hint={series?.arrival_airport ? `ריק = לפי הסדרה (${series.arrival_airport})` : "קוד שדה, למשל LHR"}>
            <Input
              dir="ltr"
              className="h-9 font-mono uppercase"
              maxLength={3}
              value={draft.arrival_airport}
              placeholder={series?.arrival_airport ?? ""}
              onChange={(e) => set("arrival_airport", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="חוזרים מ" hint={series?.return_airport ? `ריק = לפי הסדרה (${series.return_airport})` : "קוד שדה, למשל CDG"}>
            <Input
              dir="ltr"
              className="h-9 font-mono uppercase"
              maxLength={3}
              value={draft.return_airport}
              placeholder={series?.return_airport ?? ""}
              onChange={(e) => set("return_airport", e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {type ? `סוג המסלול: ${ROUTE_TYPE_LABELS[type]}.` : "המסלול עוד לא מלא: צריך עיר נחיתה ועיר חזרה, ביציאה או בסדרה."}
          {codeByDate && codeByDate !== d.code && (
            <>
              {" "}
              הקוד <Ltr className="font-mono">{d.code}</Ltr> נשאר כמו שהוא גם כשהתאריך משתנה (לפי התאריך החדש הוא היה{" "}
              <Ltr className="font-mono">{codeByDate}</Ltr>).
            </>
          )}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="גרסת המסלול היומי" hint="לסדרה שהכיוון שלה מתהפך בין תאריכים">
            <select className={`${selectClass} w-full`} value={draft.itinerary_id} onChange={(e) => set("itinerary_id", e.target.value)}>
              <option value="">ברירת מחדל - המסלול הראשי של העמוד</option>
              {data.itineraries.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label || it.key}
                  {it.arrival_city || it.return_city ? ` (${it.arrival_city ?? "?"} → ${it.return_city ?? "?"})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="עונה">
            <Input className="h-9" value={draft.season} list="tours-season-suggestions" onChange={(e) => set("season", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="תגיות">
        <div className="grid grid-cols-2 gap-3">
          <Field label="תגיות תאריך" hint="עד שלוש תגיות אפורות ליד התאריך, מופרדות בפסיק">
            <Input className="h-9" value={draft.date_labels} list="tours-date-label-suggestions" onChange={(e) => set("date_labels", e.target.value)} />
          </Field>
          <Field label="תגית כרטיס" hint='התגית האדומה על הכרטיס, למשל "חדש באתר" או "מבצע"'>
            <Input className="h-9" value={draft.card_badge} onChange={(e) => set("card_badge", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="כללי גיל">
        <div className="grid grid-cols-3 gap-3">
          <Field label="ילד עד גיל" hint="ריק = לפי הסדרה">
            <Input
              dir="ltr"
              inputMode="numeric"
              className="h-9"
              value={draft.child_max_age}
              placeholder={str(series?.child_max_age ?? 16)}
              onChange={(e) => set("child_max_age", e.target.value)}
            />
          </Field>
          <Field label="ותיק מגיל" hint="ריק = לפי הסדרה">
            <Input
              dir="ltr"
              inputMode="numeric"
              className="h-9"
              value={draft.senior_min_age}
              placeholder={str(series?.senior_min_age)}
              onChange={(e) => set("senior_min_age", e.target.value)}
            />
          </Field>
          <Field label="הנחת ותיק" hint="ריק = לפי הסדרה">
            <Input
              dir="ltr"
              inputMode="decimal"
              className="h-9"
              value={draft.senior_discount}
              placeholder={str(series?.senior_discount)}
              onChange={(e) => set("senior_discount", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="טיסה ומפגש">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="טיסה">
            <select className={`${selectClass} w-full`} value={draft.flight_mode} onChange={(e) => set("flight_mode", e.target.value)}>
              {FLIGHT_MODES.map((m) => (
                <option key={m} value={m}>
                  {FLIGHT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`מחיר טיסה (${d.currency})`} hint={draft.flight_mode === "priced" ? "לנוסע" : "רלוונטי רק לטיסה בתוספת מחיר"}>
            <Input
              dir="ltr"
              inputMode="decimal"
              className="h-9"
              value={draft.flight_price}
              disabled={draft.flight_mode !== "priced"}
              onChange={(e) => set("flight_price", e.target.value)}
            />
          </Field>
          <Field label="מועד מפגש" hint="שעון ישראל">
            <Input dir="ltr" type="datetime-local" className="h-9" value={draft.meeting_at} onChange={(e) => set("meeting_at", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Check label="כבודה כלולה" checked={draft.baggage_included} onChange={(v) => set("baggage_included", v)} />
          <Check label="ארוחה בטיסה כלולה" checked={draft.meal_included} onChange={(v) => set("meal_included", v)} />
          <Check label="העברות כלולות" checked={draft.transfers_included} onChange={(v) => set("transfers_included", v)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="קונקשן בהלוך" hint="טקסט שמוצג ללקוח">
            <Input className="h-9" value={draft.connection_out} onChange={(e) => set("connection_out", e.target.value)} />
          </Field>
          <Field label="קונקשן בחזור">
            <Input className="h-9" value={draft.connection_back} onChange={(e) => set("connection_back", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="פנימי">
        <div className="grid grid-cols-2 gap-3">
          <Field label="מספר Docket" hint="מספר הנהלת החשבונות. נשמר כשדה בלבד">
            <Input dir="ltr" className="h-9" value={draft.docket_no} onChange={(e) => set("docket_no", e.target.value)} />
          </Field>
          <Field label="קיבולת" hint={series?.default_capacity ? `ברירת המחדל של הסדרה: ${series.default_capacity}` : undefined}>
            <Input dir="ltr" inputMode="numeric" className="h-9" value={draft.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
          <Field label="הערות" className="col-span-2">
            <Textarea rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
      </Section>

      {problems.length > 0 && <Notice tone="error">{problems.join(" · ")}</Notice>}
      {!readOnly && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-2 flex items-center justify-between gap-3 border-t bg-background px-6 py-3">
          <span className="flex gap-2">
            <Button size="sm" disabled={!dirty || saving || problems.length > 0} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              שמירה
            </Button>
            <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setDraft(base)}>
              ביטול השינויים
            </Button>
          </span>
          <span className="text-xs text-muted-foreground">{dirty ? "יש שינויים שלא נשמרו" : "אין שינויים"}</span>
        </div>
      )}
    </fieldset>
  );
}
