"use client";

/**
 * Card tab "כללי": dates, route, season, labels, age rules, meeting time,
 * inclusions, flight mode, docket, notes, itinerary variant. One draft, one
 * save - only the fields that changed are sent.
 */
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CheckField, Field, Ltr, Notice, Section, selectClass } from "@/components/tours/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  inputNumber,
  inputValue,
  isDateOnly,
  isoToJerusalemLocal,
  jerusalemLocalToIso,
  nightsBetween,
} from "@/lib/tours/format";
import { ROUTE_TYPE_LABELS, routeType } from "@/lib/tours/routes";
import { FLIGHT_MODES, FLIGHT_MODE_LABELS } from "@/types/tours.types";
import { updateDeparture } from "@/lib/actions/tours-departure-actions";
import { departureCode, effectiveRoute, normalizeAirport } from "./departure-utils";
import type { DepartureCardData, DepartureGeneralInput } from "./types";

interface Draft {
  start_date: string;
  end_date: string;
  arrival_airport: string;
  return_airport: string;
  season_id: string;
  card_badge: string;
  date_labels: string;
  itinerary_id: string;
  leader_id: string;
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

function toDraft(d: DepartureCardData["departure"]): Draft {
  return {
    start_date: d.start_date,
    end_date: d.end_date,
    arrival_airport: inputValue(d.arrival_airport),
    return_airport: inputValue(d.return_airport),
    season_id: inputValue(d.season_id),
    card_badge: inputValue(d.card_badge),
    date_labels: d.date_labels.join(", "),
    itinerary_id: inputValue(d.itinerary_id),
    leader_id: inputValue(d.leader_id),
    child_max_age: inputValue(d.child_max_age),
    senior_min_age: inputValue(d.senior_min_age),
    senior_discount: inputValue(d.senior_discount),
    meeting_at: isoToJerusalemLocal(d.meeting_at),
    baggage_included: d.baggage_included,
    meal_included: d.meal_included,
    transfers_included: d.transfers_included,
    connection_out: inputValue(d.connection_out),
    connection_back: inputValue(d.connection_back),
    flight_mode: d.flight_mode,
    flight_price: inputValue(d.flight_price),
    docket_no: inputValue(d.docket_no),
    capacity: inputValue(d.capacity),
    notes: inputValue(d.notes),
  };
}

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
  if (draft.season_id !== base.season_id) out.season_id = draft.season_id || null;
  if (draft.card_badge !== base.card_badge) out.card_badge = textOrNull(draft.card_badge);
  if (draft.date_labels !== base.date_labels) out.date_labels = labelsOf(draft.date_labels);
  if (draft.itinerary_id !== base.itinerary_id) out.itinerary_id = draft.itinerary_id || null;
  if (draft.leader_id !== base.leader_id) out.leader_id = draft.leader_id || null;
  if (draft.child_max_age !== base.child_max_age) out.child_max_age = inputNumber(draft.child_max_age);
  if (draft.senior_min_age !== base.senior_min_age) out.senior_min_age = inputNumber(draft.senior_min_age);
  if (draft.senior_discount !== base.senior_discount) out.senior_discount = inputNumber(draft.senior_discount);
  if (draft.meeting_at !== base.meeting_at) out.meeting_at = jerusalemLocalToIso(draft.meeting_at);
  if (draft.baggage_included !== base.baggage_included) out.baggage_included = draft.baggage_included;
  if (draft.meal_included !== base.meal_included) out.meal_included = draft.meal_included;
  if (draft.transfers_included !== base.transfers_included) out.transfers_included = draft.transfers_included;
  if (draft.connection_out !== base.connection_out) out.connection_out = textOrNull(draft.connection_out);
  if (draft.connection_back !== base.connection_back) out.connection_back = textOrNull(draft.connection_back);
  if (draft.flight_mode !== base.flight_mode) out.flight_mode = draft.flight_mode;
  if (draft.flight_price !== base.flight_price) out.flight_price = inputNumber(draft.flight_price) ?? 0;
  if (draft.docket_no !== base.docket_no) out.docket_no = textOrNull(draft.docket_no);
  if (draft.capacity !== base.capacity) out.capacity = inputNumber(draft.capacity);
  if (draft.notes !== base.notes) out.notes = textOrNull(draft.notes);
  return out;
}

export function CardGeneralTab({ data, onSaved }: { data: DepartureCardData; onSaved: () => Promise<void> }) {
  const d = data.departure;
  const series = data.series;
  const base = useMemo(() => toDraft(d), [d]);
  const [draft, setDraft] = useState<Draft>(base);
  const [saving, setSaving] = useState(false);
  const run = useActionToast();
  const readOnly = Boolean(d.is_deleted);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const patch = changes(base, draft);
  const dirty = Object.keys(patch).length > 0;

  const arrival = normalizeAirport(draft.arrival_airport);
  const ret = normalizeAirport(draft.return_airport);
  const route = effectiveRoute({ arrival_airport: arrival ?? null, return_airport: ret ?? null }, series);
  const type = routeType(route.arrival_airport, route.return_airport);
  const datesOk = isDateOnly(draft.start_date) && isDateOnly(draft.end_date) && draft.end_date >= draft.start_date;
  const problems: string[] = [];
  if (!datesOk) problems.push("The return date is before the departure date, or a date is missing");
  if (arrival === undefined || ret === undefined) problems.push("An airport code is three English letters");

  const codeByDate = series && isDateOnly(draft.start_date) ? departureCode(series.code, draft.start_date) : null;

  const save = async () => {
    setSaving(true);
    const result = await run(() => updateDeparture(d.id, patch), "Details saved");
    setSaving(false);
    if (result.success) await onSaved();
  };

  return (
    <fieldset disabled={readOnly || saving} className="min-w-0 space-y-4 pt-4">
      {readOnly && <Notice tone="info">This departure is deleted. Restore it to edit.</Notice>}

      <Section title="Dates and Route">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Departure date">
            <Input dir="ltr" type="date" className="h-9" value={draft.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </Field>
          <Field label="Return date" hint={datesOk ? `${nightsBetween(draft.start_date, draft.end_date)} nights` : undefined}>
            <Input dir="ltr" type="date" className="h-9" value={draft.end_date} min={draft.start_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>
          <Field label="Lands in" hint={series?.arrival_airport ? `Empty = from the series (${series.arrival_airport})` : "Airport code, e.g. LHR"}>
            <Input
              dir="ltr"
              className="h-9 font-mono uppercase"
              maxLength={3}
              value={draft.arrival_airport}
              placeholder={series?.arrival_airport ?? ""}
              onChange={(e) => set("arrival_airport", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Returns from" hint={series?.return_airport ? `Empty = from the series (${series.return_airport})` : "Airport code, e.g. CDG"}>
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
        <p className="text-xs text-muted-foreground">
          {type ? `Route type: ${ROUTE_TYPE_LABELS[type]}.` : "The route is incomplete: it needs an arrival city and a return city, on the departure or the series."}
          {codeByDate && codeByDate !== d.code && (
            <>
              {" "}
              The code <Ltr className="font-mono">{d.code}</Ltr> stays the same when the date changes (by the new date it would be{" "}
              <Ltr className="font-mono">{codeByDate}</Ltr>).
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Itinerary version" hint="A variant for this date alone. Default = its season's variant, else the main itinerary">
            <select className={`${selectClass} w-full`} value={draft.itinerary_id} onChange={(e) => set("itinerary_id", e.target.value)}>
              <option value="">Default - the season&apos;s, else the main itinerary</option>
              {data.itineraries.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label || it.key}
                  {it.arrival_city || it.return_city ? ` (${it.arrival_city ?? "?"} → ${it.return_city ?? "?"})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Season"
            hint={
              data.seasons.length === 0
                ? "The tour has no seasons yet - add them on its page (Seasons tab)"
                : draft.season_id
                  ? "The season's itinerary, description and images apply to this date"
                  : "Not assigned - assign a season before the date goes on the site"
            }
          >
            <select className={`${selectClass} w-full`} value={draft.season_id} onChange={(e) => set("season_id", e.target.value)}>
              <option value="">No season</option>
              {data.seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Labels">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date labels" hint="Up to three grey labels next to the date, comma-separated">
            <Input dir="auto" className="h-9" value={draft.date_labels} list="tours-date-label-suggestions" onChange={(e) => set("date_labels", e.target.value)} />
          </Field>
          <Field label="Card badge" hint='The red badge on the date card, e.g. "חדש באתר" or "מבצע"'>
            <Input dir="auto" className="h-9" value={draft.card_badge} onChange={(e) => set("card_badge", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Age Rules">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Child up to age" hint="Empty = from the series">
            <Input
              dir="ltr"
              inputMode="numeric"
              className="h-9"
              value={draft.child_max_age}
              placeholder={inputValue(series?.child_max_age ?? 16)}
              onChange={(e) => set("child_max_age", e.target.value)}
            />
          </Field>
          <Field label="Senior from age" hint="Empty = from the series">
            <Input
              dir="ltr"
              inputMode="numeric"
              className="h-9"
              value={draft.senior_min_age}
              placeholder={inputValue(series?.senior_min_age)}
              onChange={(e) => set("senior_min_age", e.target.value)}
            />
          </Field>
          <Field label="Senior discount" hint="Empty = from the series">
            <Input
              dir="ltr"
              inputMode="decimal"
              className="h-9"
              value={draft.senior_discount}
              placeholder={inputValue(series?.senior_discount)}
              onChange={(e) => set("senior_discount", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Flight and Meeting">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Flight">
            <select className={`${selectClass} w-full`} value={draft.flight_mode} onChange={(e) => set("flight_mode", e.target.value)}>
              {FLIGHT_MODES.map((m) => (
                <option key={m} value={m}>
                  {FLIGHT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Flight price (${d.currency})`} hint={draft.flight_mode === "priced" ? "Per traveler" : "Only for a flight at extra cost"}>
            <Input
              dir="ltr"
              inputMode="decimal"
              className="h-9"
              value={draft.flight_price}
              disabled={draft.flight_mode !== "priced"}
              onChange={(e) => set("flight_price", e.target.value)}
            />
          </Field>
          <Field label="Meeting time" hint="Israel time">
            <Input dir="ltr" type="datetime-local" className="h-9" value={draft.meeting_at} onChange={(e) => set("meeting_at", e.target.value)} />
          </Field>
        </div>
        {/* Baggage, meal and connection are the flight's own details (Offline Flights) - the site reads them from the flight. */}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <CheckField label="Transfers included" checked={draft.transfers_included} onCheckedChange={(v) => set("transfers_included", v)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Flight times, baggage and stops come from the flight block itself (Flights tab). A date with no flight yet can be
          published - the site says the flight details will follow.
        </p>
      </Section>

      <Section title="Internal">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Group leader" hint="Who escorts this date. Operations only - the site does not show it." className="col-span-2">
            <select className={`${selectClass} w-full`} value={draft.leader_id} onChange={(e) => set("leader_id", e.target.value)}>
              <option value="">No group leader yet</option>
              {data.leaders
                .filter((l) => l.isActive || l.id === draft.leader_id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.isActive ? "" : " (inactive)"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Docket number" hint="The accounting number. Stored as a field only">
            <Input dir="ltr" className="h-9" value={draft.docket_no} onChange={(e) => set("docket_no", e.target.value)} />
          </Field>
          <Field label="Capacity" hint={series?.default_capacity ? `Series default: ${series.default_capacity}` : undefined}>
            <Input dir="ltr" inputMode="numeric" className="h-9" value={draft.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea dir="auto" rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
      </Section>

      {problems.length > 0 && <Notice tone="error">{problems.join(" · ")}</Notice>}
      {!readOnly && (
        <div className="sticky bottom-0 z-10 -mx-6 flex items-center justify-between gap-3 border-t bg-background px-6 py-3">
          <span className="flex gap-2">
            <Button size="sm" disabled={!dirty || saving || problems.length > 0} onClick={save}>
              {saving && <Loader2 className="animate-spin" />}
              Save Changes
            </Button>
            <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setDraft(base)}>
              Discard Changes
            </Button>
          </span>
          <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "No changes"}</span>
        </div>
      )}
    </fieldset>
  );
}
