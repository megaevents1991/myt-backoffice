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
  /** Staff-set trip size; null until somebody types it. */
  total_travelers: number | null;
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

/**
 * Party-size totals: `sum` of the traveller-count answers over the responses
 * that filled it, and how many responses (`answered`) did. Read as
 * "27 travellers across 12 forms" - never sum / responseCount, since a form
 * left blank is not a party of zero.
 */
export type TravelerStat = {
  reported: number;
  forms: number;
  total: number | null;
};

/** Several trips rolled up - see `sumTravelers` for why the ratio is split. */
export type TravelerTotals = TravelerStat & {
  /** How many of the rolled-up trips have a staff-set size. */
  sizedTrips: number;
  /** Travellers reported on sized trips - the numerator of `total`. */
  sizedReported: number;
  /** Travellers reported on trips nobody sized yet - outside the ratio. */
  unsizedReported: number;
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
  /** null when the form has no traveller-count question at all. */
  travelers: TravelerStat | null;
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
    travelers: TravelerTotals | null;
    overallAvg: number | null;
    perField: FieldStat[];
  };
  /** The question the traveller totals were read from, for the popup/list. */
  travelerFieldId: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Answered numeric values for one field across a set of responses. */
function fieldValues(
  fieldId: number,
  responses: Pick<ReportResponse, "answers">[],
): number[] {
  const key = String(fieldId);
  return responses
    .map((r) => r.answers[key])
    .filter((v): v is number => typeof v === "number");
}

/**
 * The party-size question: the number field flagged `traveler_count`, else the
 * first client-facing number question (how the report guessed before the flag
 * existed - keeps older forms counting without a re-save).
 */
export function travelerField(fields: FormField[]): FormField | null {
  const numbers = fields.filter(
    (field) => field.type === "number" && !field.staff_only,
  );
  return (
    numbers.find((field) => field.config?.traveler_count === true) ??
    numbers[0] ??
    null
  );
}

function travelerStats(
  field: FormField | null,
  responses: ReportResponse[],
  total: number | null,
): TravelerStat | null {
  // A trip with a staff-set size still has travellers to account for even
  // when the form never asked "how many of you", so the row survives either
  // source on its own.
  if (!field && total === null) return null;
  const values = field
    ? fieldValues(field.id, responses).filter((v) => Number.isFinite(v) && v >= 0)
    : [];
  return {
    reported: values.reduce((sum, v) => sum + v, 0),
    forms: values.length,
    total,
  };
}

/** Only a rating field's id is read - the screen passes its slim field list. */
type RatingRef = Pick<FormField, "id">;

export function fieldStats(
  ratingFields: RatingRef[],
  responses: Pick<ReportResponse, "answers">[],
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
  /** Every field of the form - the traveller question is looked up here. */
  fields?: FormField[];
  invites: ReportInvite[];
  responses: ReportResponse[];
  /** Admin label resolver, injected so this stays import-light. */
  labelFor: (field: FormField) => string;
}): TripReport {
  const { ratingFields, staffFields, invites, responses, labelFor } = input;
  const travelers = travelerField(input.fields ?? []);

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
      travelers: travelerStats(travelers, own, invite.total_travelers ?? null),
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
      // The "no trip" bucket has no invite, so nobody can have set its size.
      travelers: travelerStats(travelers, bucket, null),
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
      travelers: sumTravelers(trips),
      overallAvg,
      perField,
    },
    travelerFieldId: travelers?.id ?? null,
  };
}

/**
 * Roll trip rows up into one figure.
 *
 * The coverage ratio is measured ONLY over trips somebody sized: `sizedReported`
 * of `total`. Mixing in travellers reported on unsized trips would put people
 * in the numerator who have no seat in the denominator ("81 / 17"). Those are
 * kept apart as `unsizedReported`. `total` is null when no trip was sized - a
 * grand total of zero would read as "nobody travelled".
 *
 * Exported so the report screen can recompute it over the FILTERED rows.
 */
export function sumTravelers(
  rows: Pick<TripRow, "travelers">[],
): TravelerTotals | null {
  const stats = rows
    .map((row) => row.travelers)
    .filter((stat): stat is TravelerStat => stat !== null);
  if (stats.length === 0) return null;
  const sized = stats.filter((stat) => stat.total !== null);
  const reported = stats.reduce((sum, stat) => sum + stat.reported, 0);
  const sizedReported = sized.reduce((sum, stat) => sum + stat.reported, 0);
  return {
    reported,
    forms: stats.reduce((sum, stat) => sum + stat.forms, 0),
    total:
      sized.length > 0
        ? sized.reduce((sum, stat) => sum + (stat.total ?? 0), 0)
        : null,
    sizedTrips: sized.length,
    sizedReported,
    unsizedReported: reported - sizedReported,
  };
}

/* ------------------------------------------------------------------------ */
/* Filters, summaries and escort analytics - shared by the report screen and */
/* the PDF export, so the two can never disagree about what a filter means.  */
/* ------------------------------------------------------------------------ */

/** What the report can be narrowed by. Every field is optional. */
export type TripFilters = {
  /** Trip code letters, prefix match ("BB" finds BBC-124). */
  prefix?: string;
  /** Trip code number, prefix match. */
  num?: string;
  /** Escort name, part match (spaces and case ignored). */
  escort?: string;
  /** Departure on or after, yyyy-mm-dd. */
  fromDate?: string;
  /** Departure on or before, yyyy-mm-dd. */
  toDate?: string;
  /** Departure year, "all" or unset = any. */
  year?: string;
  /** One trip only: its invite id, or "none" for the no-trip bucket. */
  trip?: number | "none" | null;
};

const FILTER_KEYS = ["prefix", "num", "escort", "fromDate", "toDate", "year"] as const;

/** Filters -> query string for the PDF link ("" when nothing is set). */
export function tripFiltersToQuery(filters: TripFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value && !(key === "year" && value === "all")) params.set(key, value);
  }
  if (filters.trip !== undefined && filters.trip !== null) {
    params.set("trip", String(filters.trip));
  }
  return params.toString();
}

/** The PDF page's searchParams -> filters. Unknown or malformed values are dropped. */
export function tripFiltersFromQuery(
  query: Record<string, string | string[] | undefined>,
): TripFilters {
  const one = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const day = (key: string) => {
    const value = one(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  };
  const tripRaw = one("trip");
  const tripId = tripRaw ? Number(tripRaw) : NaN;
  const year = one("year");
  return {
    prefix: one("prefix"),
    num: one("num"),
    escort: one("escort"),
    fromDate: day("fromDate"),
    toDate: day("toDate"),
    year: year && /^\d{4}$/.test(year) ? year : undefined,
    trip:
      tripRaw === "none"
        ? "none"
        : Number.isInteger(tripId) && tripId > 0
          ? tripId
          : null,
  };
}

/** An escort's name as typed on different trip links: trimmed, spaces collapsed, lower case. */
export function escortKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function filterTrips(trips: TripRow[], filters: TripFilters): TripRow[] {
  const prefix = (filters.prefix ?? "").trim().toUpperCase();
  const num = (filters.num ?? "").trim();
  const escort = escortKey(filters.escort);
  const from = filters.fromDate ?? "";
  const to = filters.toDate ?? "";
  const year = filters.year && filters.year !== "all" ? filters.year : "";
  const only = filters.trip ?? null;
  return trips.filter((trip) => {
    if (only !== null && (only === "none" ? trip.inviteId !== null : trip.inviteId !== only)) {
      return false;
    }
    if (prefix && !(trip.prefix ?? "").toUpperCase().startsWith(prefix)) return false;
    if (num && !(trip.num ?? "").startsWith(num)) return false;
    if (escort && !escortKey(trip.escort).includes(escort)) return false;
    // A trip without a departure only survives when no date/year filter is
    // set - such a filter means "trips of that period".
    if (from || to || year) {
      if (!trip.departure) return false;
      if (from && trip.departure < from) return false;
      if (to && trip.departure > to) return false;
      if (year && trip.departure.slice(0, 4) !== year) return false;
    }
    return true;
  });
}

/**
 * The responses a set of trip rows stands for. The "no trip" bucket row
 * stands for every response that did not come through a trip link.
 */
export function responsesOfTrips<R extends Pick<ReportResponse, "invite_id">>(
  responses: R[],
  trips: Pick<TripRow, "inviteId">[],
  allTrips: Pick<TripRow, "inviteId">[],
): R[] {
  const tripIds = new Set(
    allTrips.map((trip) => trip.inviteId).filter((id): id is number => id !== null),
  );
  const chosen = new Set(trips.map((trip) => trip.inviteId));
  const withBucket = chosen.has(null);
  return responses.filter((response) =>
    response.invite_id !== null && tripIds.has(response.invite_id)
      ? chosen.has(response.invite_id)
      : withBucket,
  );
}

export type ReportSummary = {
  /** Trip links among the rows (the "no trip" bucket is not a trip). */
  tripCount: number;
  responseCount: number;
  travelers: TravelerTotals | null;
  /** Flat mean over every rating answer of the scoped responses. */
  overallAvg: number | null;
  perField: FieldStat[];
};

/** The summary cards: `responses` must already be scoped to `trips`. */
export function summarizeTrips(
  trips: TripRow[],
  responses: Pick<ReportResponse, "answers">[],
  ratingFields: RatingRef[],
): ReportSummary {
  const { perField, overallAvg } = fieldStats(ratingFields, responses);
  return {
    tripCount: trips.filter((trip) => trip.inviteId !== null).length,
    // The scoped list, not the rows' server counts - a response deleted a
    // moment ago is already gone from it.
    responseCount: responses.length,
    travelers: sumTravelers(trips),
    overallAvg,
    perField,
  };
}

/** A trip's place in time: its departure, else the day its link was made. */
function tripDay(trip: Pick<TripRow, "departure" | "linkCreatedAt">): string {
  return trip.departure ?? trip.linkCreatedAt?.slice(0, 10) ?? "";
}

/** Oldest first; two trips on one day keep the order their links were made. */
function chronological(a: TripRow, b: TripRow): number {
  const day = tripDay(a).localeCompare(tripDay(b));
  if (day !== 0) return day;
  return (a.linkCreatedAt ?? "").localeCompare(b.linkCreatedAt ?? "");
}

export type EscortTrip = {
  inviteId: number;
  code: string;
  departure: string | null;
  responseCount: number;
  travelers: TravelerStat | null;
  overallAvg: number | null;
};

export type EscortRow = {
  /** `escortKey` of the name - one escort typed two ways is one row. */
  key: string;
  /** The name as typed on their latest trip. */
  name: string;
  /** Oldest first. */
  trips: EscortTrip[];
  responseCount: number;
  travelers: TravelerTotals | null;
  /** Flat mean over every rating answer on their trips. */
  overallAvg: number | null;
  perField: FieldStat[];
  firstDeparture: string | null;
  lastDeparture: string | null;
  /**
   * Their latest rated trip's average minus the flat average of their earlier
   * trips - up = the last trip scored better than before. null until they
   * have a rated trip AND a rated earlier one.
   */
  trend: number | null;
};

function escortTrip(trip: TripRow): EscortTrip {
  return {
    inviteId: trip.inviteId as number,
    code: trip.code ?? "",
    departure: trip.departure,
    responseCount: trip.responseCount,
    travelers: trip.travelers,
    overallAvg: trip.overallAvg,
  };
}

/** Trip links grouped by their escort's name, each group oldest first. */
function tripsByEscort(trips: TripRow[]): Map<string, TripRow[]> {
  const groups = new Map<string, TripRow[]>();
  for (const trip of trips) {
    if (trip.inviteId === null) continue;
    const key = escortKey(trip.escort);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(trip);
    groups.set(key, list);
  }
  for (const list of groups.values()) list.sort(chronological);
  return groups;
}

/**
 * One row per escort over the given (filtered) trips: how many trips, when,
 * how many families answered and how they scored - busiest escort first.
 */
export function buildEscortRows(
  trips: TripRow[],
  responses: ReportResponse[],
  ratingFields: RatingRef[],
): EscortRow[] {
  const rows: EscortRow[] = [];
  for (const [key, own] of tripsByEscort(trips)) {
    const ids = new Set(own.map((trip) => trip.inviteId));
    const theirs = responses.filter((r) => r.invite_id !== null && ids.has(r.invite_id));
    const { perField, overallAvg } = fieldStats(ratingFields, theirs);
    const rated = own.filter((trip) => trip.overallAvg !== null);
    const last = rated[rated.length - 1];
    let trend: number | null = null;
    if (last && rated.length > 1) {
      const earlierIds = new Set(rated.slice(0, -1).map((trip) => trip.inviteId));
      const earlier = fieldStats(
        ratingFields,
        theirs.filter((r) => earlierIds.has(r.invite_id)),
      ).overallAvg;
      trend = diff(last.overallAvg, earlier);
    }
    const departures = own
      .map((trip) => trip.departure)
      .filter((day): day is string => day !== null)
      .sort();
    rows.push({
      key,
      name: (own[own.length - 1].escort ?? "").trim(),
      trips: own.map(escortTrip),
      responseCount: own.reduce((sum, trip) => sum + trip.responseCount, 0),
      travelers: sumTravelers(own),
      overallAvg,
      perField,
      firstDeparture: departures[0] ?? null,
      lastDeparture: departures[departures.length - 1] ?? null,
      trend,
    });
  }
  return rows.sort(
    (a, b) => b.trips.length - a.trips.length || a.name.localeCompare(b.name, "he"),
  );
}

export type FieldCompare = {
  fieldId: number;
  current: number | null;
  currentCount: number;
  /** The same escort's earlier trips. */
  past: number | null;
  pastCount: number;
  /** current - past; null when either side has no answer. */
  delta: number | null;
  /** Every other response of this form, any escort - the house average. */
  others: number | null;
};

export type TripComparison = {
  escort: string;
  /** The escort's trips before this one, oldest first. */
  pastTrips: EscortTrip[];
  pastResponses: number;
  current: number | null;
  past: number | null;
  delta: number | null;
  others: number | null;
  perField: FieldCompare[];
};

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : round2(a - b);
}

/**
 * This trip against its escort's earlier trips (and against every other
 * response of the form). `allTrips` should be the UNFILTERED list - a 2026
 * filter still compares a 2026 trip with the escort's 2025 ones. null when
 * the trip has no escort or the escort has no earlier trip.
 */
export function compareWithEscortPast(
  trip: TripRow,
  allTrips: TripRow[],
  responses: ReportResponse[],
  ratingFields: RatingRef[],
): TripComparison | null {
  if (trip.inviteId === null) return null;
  const key = escortKey(trip.escort);
  if (!key) return null;
  const own = tripsByEscort(allTrips).get(key) ?? [];
  const at = own.findIndex((t) => t.inviteId === trip.inviteId);
  if (at <= 0) return null;
  const past = own.slice(0, at);
  const pastIds = new Set(past.map((t) => t.inviteId));

  const current = fieldStats(
    ratingFields,
    responses.filter((r) => r.invite_id === trip.inviteId),
  );
  const pastResponses = responses.filter(
    (r) => r.invite_id !== null && pastIds.has(r.invite_id),
  );
  const before = fieldStats(ratingFields, pastResponses);
  const others = fieldStats(
    ratingFields,
    responses.filter((r) => r.invite_id !== trip.inviteId),
  );

  return {
    escort: (trip.escort ?? "").trim(),
    pastTrips: past.map(escortTrip),
    pastResponses: pastResponses.length,
    current: current.overallAvg,
    past: before.overallAvg,
    delta: diff(current.overallAvg, before.overallAvg),
    others: others.overallAvg,
    perField: ratingFields.map((field, i) => ({
      fieldId: field.id,
      current: current.perField[i].avg,
      currentCount: current.perField[i].count,
      past: before.perField[i].avg,
      pastCount: before.perField[i].count,
      delta: diff(current.perField[i].avg, before.perField[i].avg),
      others: others.perField[i].avg,
    })),
  };
}
