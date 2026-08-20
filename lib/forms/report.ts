/**
 * Trips report aggregation - PURE functions, no I/O.
 *
 * One form = one report: every trip link (invite with a split trip code)
 * becomes a row; responses that arrived without a trip (shared slug link,
 * personal email invites) pool into a single "no trip" bucket. The server
 * action feeds DB rows in; the report page renders the result. Keeping this
 * pure lets a plain node script assert the math (no test framework in repo).
 */

import type { AnswerMap, FormField } from "@/types/form.types";

export type ReportInvite = {
  id: number;
  trip_code_prefix: string | null;
  trip_code_num: string | null;
  prefill: AnswerMap;
  created_at: string;
};

export type ReportResponse = {
  invite_id: number | null;
  answers: AnswerMap;
  submitted_at: string;
};

export type FieldStat = {
  fieldId: number;
  /** Mean of answered values, null when nobody answered. */
  avg: number | null;
  count: number;
};

export type TripRow = {
  /** null = the "no trip" bucket. */
  inviteId: number | null;
  /** "BBC-124", null for the bucket. */
  code: string | null;
  prefix: string | null;
  num: string | null;
  /** First short_text staff answer - the escort. */
  escort: string | null;
  /** First date staff answer (ISO yyyy-mm-dd) - the departure. */
  departure: string | null;
  /** Every staff answer, labeled, for display. */
  staffInfo: { label: string; value: string }[];
  responseCount: number;
  /** Flat mean over every rating answer of the trip (not a mean of means). */
  overallAvg: number | null;
  perField: FieldStat[];
  lastSubmittedAt: string | null;
  linkCreatedAt: string | null;
};

export type TripReport = {
  trips: TripRow[];
  totals: {
    tripCount: number;
    responseCount: number;
    overallAvg: number | null;
    perField: FieldStat[];
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Answered numeric values for one field across a set of responses. */
function fieldValues(fieldId: number, responses: ReportResponse[]): number[] {
  const key = String(fieldId);
  return responses
    .map((r) => r.answers[key])
    .filter((v): v is number => typeof v === "number");
}

function fieldStats(
  ratingFields: FormField[],
  responses: ReportResponse[],
): { perField: FieldStat[]; overallAvg: number | null } {
  const perField = ratingFields.map((field) => {
    const values = fieldValues(field.id, responses);
    return { fieldId: field.id, avg: mean(values), count: values.length };
  });
  const all = ratingFields.flatMap((field) => fieldValues(field.id, responses));
  return { perField, overallAvg: mean(all) };
}

/** Staff answers of a trip invite, labeled for display, in field order. */
function staffDisplay(
  staffFields: FormField[],
  prefill: AnswerMap,
  label: (field: FormField) => string,
): { label: string; value: string }[] {
  return staffFields
    .filter((field) => field.type !== "section")
    .map((field) => ({ field, value: prefill[String(field.id)] }))
    .filter(
      (item) => item.value !== undefined && item.value !== null && item.value !== "",
    )
    .map((item) => ({ label: label(item.field), value: String(item.value) }));
}

function firstStaffValue(
  staffFields: FormField[],
  prefill: AnswerMap,
  type: FormField["type"],
): string | null {
  const field = staffFields.find((f) => f.type === type);
  const value = field ? prefill[String(field.id)] : undefined;
  return typeof value === "string" && value !== "" ? value : null;
}

export function buildTripReport(input: {
  ratingFields: FormField[];
  staffFields: FormField[];
  invites: ReportInvite[];
  responses: ReportResponse[];
  /** Admin label resolver, injected so this stays import-light. */
  labelFor: (field: FormField) => string;
}): TripReport {
  const { ratingFields, staffFields, invites, responses, labelFor } = input;

  const tripInvites = invites.filter(
    (invite) => invite.trip_code_prefix && invite.trip_code_num,
  );
  const tripInviteIds = new Set(tripInvites.map((invite) => invite.id));

  const byInvite = new Map<number, ReportResponse[]>();
  const bucket: ReportResponse[] = [];
  for (const response of responses) {
    if (response.invite_id !== null && tripInviteIds.has(response.invite_id)) {
      const list = byInvite.get(response.invite_id) ?? [];
      list.push(response);
      byInvite.set(response.invite_id, list);
    } else {
      bucket.push(response);
    }
  }

  const trips: TripRow[] = tripInvites.map((invite) => {
    const own = byInvite.get(invite.id) ?? [];
    const { perField, overallAvg } = fieldStats(ratingFields, own);
    return {
      inviteId: invite.id,
      code: `${invite.trip_code_prefix}-${invite.trip_code_num}`,
      prefix: invite.trip_code_prefix,
      num: invite.trip_code_num,
      escort: firstStaffValue(staffFields, invite.prefill, "short_text"),
      departure: firstStaffValue(staffFields, invite.prefill, "date"),
      staffInfo: staffDisplay(staffFields, invite.prefill, labelFor),
      responseCount: own.length,
      overallAvg,
      perField,
      lastSubmittedAt:
        own.length > 0
          ? own.map((r) => r.submitted_at).sort((a, b) => (a < b ? 1 : -1))[0]
          : null,
      linkCreatedAt: invite.created_at,
    };
  });

  if (bucket.length > 0) {
    const { perField, overallAvg } = fieldStats(ratingFields, bucket);
    trips.push({
      inviteId: null,
      code: null,
      prefix: null,
      num: null,
      escort: null,
      departure: null,
      staffInfo: [],
      responseCount: bucket.length,
      overallAvg,
      perField,
      lastSubmittedAt: bucket
        .map((r) => r.submitted_at)
        .sort((a, b) => (a < b ? 1 : -1))[0],
      linkCreatedAt: null,
    });
  }

  // Newest trips first; the "no trip" bucket sinks to the end.
  trips.sort((a, b) => {
    if (a.inviteId === null) return 1;
    if (b.inviteId === null) return -1;
    return (b.linkCreatedAt ?? "") < (a.linkCreatedAt ?? "") ? -1 : 1;
  });

  const { perField, overallAvg } = fieldStats(ratingFields, responses);
  return {
    trips,
    totals: {
      tripCount: tripInvites.length,
      responseCount: responses.length,
      overallAvg,
      perField,
    },
  };
}
