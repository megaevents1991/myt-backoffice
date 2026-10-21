"use server";

/**
 * The hotels report (/forms/hotels): every answer to a HOTEL question of every feedback
 * form, so a weak hotel shows up by name across all the series that sleep there (spec
 * docs/superpowers/specs/2026-10-21-forms-series-hotels-design.md). Read only.
 *
 * The answers come back raw and the screen rolls them up with the pure `buildHotelRows`
 * (lib/forms/series.ts) - the period / series filters then cost no round trip.
 */
import { supabase } from "@/lib/supabase-server";
import { requireFormsAccess } from "@/lib/auth/guards";
import { liveRowsQuery } from "@/lib/forms/soft-delete";
import { adminLabel } from "@/lib/forms/i18n";
import { hotelOf, snapshotsOf, type HotelAnswer } from "@/lib/forms/series";
import { fetchPaged } from "@/lib/supabase-paged";
import { readSeries } from "@/lib/services/form-series";
import type { AnswerMap, FormField } from "@/types/form.types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const table = (name: string) => (supabase as any).from(name);
/* eslint-enable @typescript-eslint/no-explicit-any */

/** One hotel answer, with what the traveller wrote in the open questions of that form. */
export type HotelReportAnswer = HotelAnswer & {
  responseId: number;
  /** The free-text answers of the same response (long text), for "why the low score". */
  note: string | null;
};

export type HotelsReport = {
  answers: HotelReportAnswer[];
  /** The forms that ask about a hotel, for the series filter and the links. */
  forms: { id: number; title: string; series: string | null }[];
  /** True when the read hit its cap - the screen says so. */
  truncated: boolean;
};

const RESPONSES_MAX = 20000;
const NOTE_MAX = 400;

type ResponseRow = {
  id: number;
  form_id: number;
  invite_id: number | null;
  answers: AnswerMap;
  submitted_at: string;
  field_context?: unknown;
};

/** Live responses of the forms, oldest id first (a stable page order). */
function responsesQuery(formIds: number[], withContext: boolean) {
  return table("form_responses")
    .select(
      withContext
        ? "id,form_id,invite_id,answers,submitted_at,field_context"
        : "id,form_id,invite_id,answers,submitted_at",
    )
    .in("form_id", formIds)
    .is("is_deleted", null)
    .order("id", { ascending: true });
}

export async function getHotelsReport(): Promise<HotelsReport> {
  const actor = await requireFormsAccess();

  const { data: formsData, error: formsError } = await liveRowsQuery((withSeries) => {
    let query = table("forms")
      .select(withSeries ? "id,title_en,title_he,series_id" : "id,title_en,title_he")
      .is("is_deleted", null);
    // Operators read only the forms opened to them - same rule as the forms list.
    if (actor.role === "forms_operator") query = query.eq("operator_visible", true);
    return query;
  });
  if (formsError) {
    console.error("getHotelsReport forms failed:", JSON.stringify(formsError));
    throw new Error("Could not read the forms");
  }
  const forms = (formsData ?? []) as {
    id: number;
    title_en: string | null;
    title_he: string | null;
    series_id?: string | null;
  }[];
  if (forms.length === 0) return { answers: [], forms: [], truncated: false };

  const { data: fieldsData, error: fieldsError } = await table("form_fields")
    .select("id,form_id,type,label_en,label_he,staff_only,config")
    .in("form_id", forms.map((f) => f.id))
    .in("type", ["rating", "long_text"])
    .limit(5000);
  if (fieldsError) {
    console.error("getHotelsReport fields failed:", JSON.stringify(fieldsError));
    throw new Error("Could not read the questions");
  }
  const fields = (fieldsData ?? []) as FormField[];
  const hotelFieldsOf = new Map<number, FormField[]>();
  const notesOf = new Map<number, number[]>();
  for (const f of fields) {
    if (f.staff_only) continue;
    if (hotelOf(f)) hotelFieldsOf.set(f.form_id, [...(hotelFieldsOf.get(f.form_id) ?? []), f]);
    if (f.type === "long_text") notesOf.set(f.form_id, [...(notesOf.get(f.form_id) ?? []), f.id]);
  }
  const hotelFormIds = [...hotelFieldsOf.keys()];
  if (hotelFormIds.length === 0) return { answers: [], forms: [], truncated: false };

  const seriesCode = new Map<string, string>();
  try {
    const ids = forms.map((f) => f.series_id).filter((id): id is string => Boolean(id));
    for (const s of await readSeries(ids)) seriesCode.set(s.id, s.code);
  } catch (e) {
    // A trip code's letters still name the series; only link-less answers lose it.
    console.error("getHotelsReport series failed:", e);
  }
  const formSeries = new Map(
    forms.map((f) => [f.id, (f.series_id && seriesCode.get(f.series_id)) || null]),
  );

  const [responsesRes, invitesRes] = await Promise.all([
    (async () => {
      const first = await fetchPaged<ResponseRow>(() => responsesQuery(hotelFormIds, true), RESPONSES_MAX);
      const code = (first.error as { code?: string } | null)?.code;
      // Before migration 20261021083328 there is no snapshot column - read without it.
      if (code === "42703" || code === "PGRST204") {
        return fetchPaged<ResponseRow>(() => responsesQuery(hotelFormIds, false), RESPONSES_MAX);
      }
      return first;
    })(),
    fetchPaged<{ id: number; trip_code_prefix: string | null; trip_code_num: string | null }>(
      () =>
        table("form_invites")
          .select("id,trip_code_prefix,trip_code_num")
          .in("form_id", hotelFormIds)
          .eq("multi_use", true)
          .order("id", { ascending: true }),
      RESPONSES_MAX,
    ),
  ]);
  if (responsesRes.error) {
    console.error("getHotelsReport responses failed:", JSON.stringify(responsesRes.error));
    throw new Error("Could not read the answers");
  }
  if (invitesRes.error) {
    console.error("getHotelsReport invites failed:", JSON.stringify(invitesRes.error));
    throw new Error("Could not read the trip links");
  }
  const trips = new Map(
    invitesRes.rows.map((i) => [
      i.id,
      i.trip_code_prefix && i.trip_code_num
        ? { code: `${i.trip_code_prefix}-${i.trip_code_num}`, series: i.trip_code_prefix }
        : null,
    ]),
  );

  const answers: HotelReportAnswer[] = [];
  for (const response of responsesRes.rows) {
    const formHotels = hotelFieldsOf.get(response.form_id) ?? [];
    const snapshots = snapshotsOf(response.field_context);
    const trip = response.invite_id != null ? trips.get(response.invite_id) ?? null : null;
    const note = noteOf(response.answers, notesOf.get(response.form_id) ?? []);
    for (const field of formHotels) {
      const value = response.answers?.[String(field.id)];
      if (typeof value !== "number") continue;
      // What the question named when this answer came in; older answers read today's hotel.
      const snap = snapshots[String(field.id)];
      const hotel = hotelOf(field);
      answers.push({
        responseId: response.id,
        formId: response.form_id,
        fieldId: field.id,
        value,
        max: typeof field.config.max === "number" ? field.config.max : 5,
        city: snap?.city || hotel?.city_he || hotel?.city_en || "",
        name: snap ? snap.name : hotel?.name ?? "",
        tripCode: trip?.code ?? null,
        inviteId: response.invite_id,
        series: trip?.series ?? formSeries.get(response.form_id) ?? null,
        submittedAt: response.submitted_at,
        note,
      });
    }
  }

  return {
    answers,
    forms: forms
      .filter((f) => hotelFieldsOf.has(f.id))
      .map((f) => ({
        id: f.id,
        title: adminLabel(f.title_en, f.title_he) || `Form #${f.id}`,
        series: formSeries.get(f.id) ?? null,
      })),
    truncated: responsesRes.truncated,
  };
}

function noteOf(answers: AnswerMap, fieldIds: number[]): string | null {
  const text = fieldIds
    .map((id) => answers?.[String(id)])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" · ")
    .trim();
  return text ? text.slice(0, NOTE_MAX) : null;
}
