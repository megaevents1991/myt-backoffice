"use server";

import { supabase } from "@/lib/supabase-server";
import { requireFormVisible, requireFormsAccess } from "@/lib/auth/guards";
import { fieldAdminLabel } from "@/lib/forms/i18n";
import { buildTripReport } from "@/lib/forms/report";
import type { TripReport } from "@/lib/forms/report";
import type { AnswerMap, FormField } from "@/types/form.types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const table = (name: string) => (supabase as any).from(name);
/* eslint-enable @typescript-eslint/no-explicit-any */

export type FormTripReport = {
  report: TripReport;
  /** Rating questions in form order, for the per-question columns. */
  ratingFields: { id: number; label: string; reviewScore: boolean }[];
};

/**
 * The whole-brand trips dashboard for one form: one row per trip link plus a
 * "no trip" bucket, each with response counts and averages. Aggregation is
 * pure (lib/forms/report.ts); this action only loads the rows.
 */
export async function getFormTripReport(
  formId: number,
): Promise<FormTripReport> {
  const actor = await requireFormsAccess();
  await requireFormVisible(actor, formId);

  const [fieldsRes, invitesRes, responsesRes] = await Promise.all([
    table("form_fields")
      .select("id,form_id,type,position,label_en,label_he,required,staff_only,options,config")
      .eq("form_id", formId)
      .order("position", { ascending: true }),
    table("form_invites")
      .select("id,trip_code_prefix,trip_code_num,prefill,created_at")
      .eq("form_id", formId),
    table("form_responses")
      .select("invite_id,answers,submitted_at")
      .eq("form_id", formId)
      .order("submitted_at", { ascending: false }),
  ]);

  for (const [name, res] of [
    ["fields", fieldsRes],
    ["invites", invitesRes],
    ["responses", responsesRes],
  ] as const) {
    if (res.error) {
      console.error(`getFormTripReport ${name} failed:`, JSON.stringify(res.error));
      throw res.error;
    }
  }

  const fields = (fieldsRes.data ?? []) as FormField[];
  const ratingFields = fields.filter(
    (field) => field.type === "rating" && !field.staff_only,
  );
  const staffFields = fields.filter((field) => field.staff_only);

  const report = buildTripReport({
    ratingFields,
    staffFields,
    invites: ((invitesRes.data ?? []) as {
      id: number;
      trip_code_prefix: string | null;
      trip_code_num: string | null;
      prefill: AnswerMap | null;
      created_at: string;
    }[]).map((invite) => ({ ...invite, prefill: invite.prefill ?? {} })),
    responses: (responsesRes.data ?? []) as {
      invite_id: number | null;
      answers: AnswerMap;
      submitted_at: string;
    }[],
    labelFor: fieldAdminLabel,
  });

  return {
    report,
    ratingFields: ratingFields.map((field) => ({
      id: field.id,
      label: fieldAdminLabel(field),
      reviewScore: field.config.review_score === true,
    })),
  };
}
