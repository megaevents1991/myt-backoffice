/**
 * "Build Your Euro Trip" (multi-event itinerary) - the staff settings, backoffice side.
 *
 * PURE: no I/O (scripts/itinerary-settings-selftest.ts). The `itinerary_settings` table is key / value
 * jsonb (migration 20261021193309); myt-main reads it server-side with `parseItinerarySettings`
 * (myt-main `lib/itinerary/settings.ts`). THE KEYS, DEFAULTS AND RANGES BELOW ARE A MIRROR OF THAT FILE'S
 * `SPECS` - change one, change the other. The reader silently ignores any row that is not the right JSON
 * type or is out of range, so a value written here must be a jsonb NUMBER / BOOLEAN (never a string) inside
 * its range, or the site would quietly use the default instead of what staff typed.
 *
 * What this file adds on top of the reader: validation of a whole form (per-field Hebrew errors) and the
 * cross-field rules the reader cannot know - the "best" distance can't pass the maximum, the "ok" gap can't
 * pass the maximum gap, the biggest gap can't pass the whole trip, the 3rd event can't be cheaper than the 2nd.
 *
 * NOT here (2026-10-28): whether the feature is open on the site. That is the "euro_trip" row of the /homepage
 * board (types/homepage.types.ts `EURO_TRIP_SECTION_KEY`) - the old `enabled` key is no longer written, and
 * myt-main no longer reads it.
 */

export type ItinerarySettings = {
  /** A multi-event itinerary may be paid for (off = the customer only saves the trip for 24 hours). */
  paymentsEnabled: boolean;
  /** Discount % on the service fee of the 2nd event of a trip. */
  tier2Pct: number;
  /** Discount % on the service fee of the 3rd event of a trip. */
  tier3Pct: number;
  /** Most events in one trip. */
  maxEvents: number;
  /** Farthest two events of one trip may be, in km. */
  maxKm: number;
  /** Up to this many km two events are a "best" pairing. */
  bestKm: number;
  /** Up to this many days between two events is a comfortable ("ok") gap. */
  okGapDays: number;
  /** More than this many days between two events is blocked. */
  maxGapDays: number;
  /** Longest whole trip, first event to last, in days. */
  maxSpanDays: number;
  /** How many routes the page builds on its own (0 = only the trips staff made and switched on). */
  maxAutoRoutes: number;
};

/**
 * The most events ONE trip can have. The single number behind the top of the `max_events` range below,
 * the migration's `itinerary_of` CHECK (2..3) and the reservations list chip / detail panel
 * (lib/itinerary/reservation-group.ts) - raise it in all of those together, never in one.
 */
export const MAX_TRIP_EVENTS = 3;

export const DEFAULT_ITINERARY_SETTINGS: ItinerarySettings = {
  paymentsEnabled: false,
  tier2Pct: 30,
  tier3Pct: 50,
  maxEvents: 3,
  maxKm: 1000,
  bestKm: 600,
  okGapDays: 5,
  maxGapDays: 10,
  maxSpanDays: 21,
  // 0 by default (Dor 28.10): the site shows only the trips staff switched on, never routes it made up itself.
  maxAutoRoutes: 0,
};

export type ItineraryBoolField = "paymentsEnabled";
export type ItineraryNumField = Exclude<keyof ItinerarySettings, ItineraryBoolField>;
export type ItineraryField = keyof ItinerarySettings;

type BoolSpec = { key: string; field: ItineraryBoolField; kind: "bool"; label: string };
type NumSpec = {
  key: string;
  field: ItineraryNumField;
  kind: "num";
  label: string;
  /** Inclusive. */
  min: number;
  max: number;
  int: boolean;
};
export type ItinerarySpec = BoolSpec | NumSpec;

const num = (
  key: string,
  field: ItineraryNumField,
  label: string,
  min: number,
  max: number,
  int: boolean,
): NumSpec => ({ key, field, kind: "num", label, min, max, int });

/**
 * DB key (snake_case) -> field, Hebrew label, and what it may hold. Order = the order rows are written and
 * audited. The ranges are the reader's (myt-main `SPECS`), inclusive.
 */
export const ITINERARY_SPECS: readonly ItinerarySpec[] = [
  { key: "payments_enabled", field: "paymentsEnabled", kind: "bool", label: "תשלום פעיל" },
  num("tier_2_pct", "tier2Pct", "אירוע שני: % הנחה על דמי השירות", 0, 90, false),
  num("tier_3_pct", "tier3Pct", "אירוע שלישי: % הנחה על דמי השירות", 0, 90, false),
  num("max_events", "maxEvents", "מספר אירועים מקסימלי בטריפ", 2, MAX_TRIP_EVENTS, true),
  num("max_km", "maxKm", "מרחק מקסימלי בין ערים (ק״מ)", 50, 5000, false),
  num("best_km", "bestKm", "מרחק 'מומלץ' בין ערים (ק״מ)", 50, 5000, false),
  num("ok_gap_days", "okGapDays", "ימים 'נוחים' בין אירועים", 1, 30, true),
  num("max_gap_days", "maxGapDays", "ימים מקסימליים בין אירועים", 1, 30, true),
  num("max_span_days", "maxSpanDays", "אורך טריפ מקסימלי (ימים)", 1, 30, true),
  num("max_auto_routes", "maxAutoRoutes", "כמה טריפים מוכנים להציג", 0, 48, true),
];

export const ITINERARY_SPEC_BY_FIELD: Readonly<Record<ItineraryField, ItinerarySpec>> = Object.fromEntries(
  ITINERARY_SPECS.map((s) => [s.field, s]),
) as Record<ItineraryField, ItinerarySpec>;

/** The reader's rule for ONE value of a number setting - true when myt-main would accept it. */
function numberFits(spec: NumSpec, v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= spec.min && v <= spec.max && (!spec.int || Number.isInteger(v));
}

/**
 * The reader's `parseItinerarySettings`, mirrored: the rows of the table (null / unreadable = none) merged
 * over the defaults, a row of an unknown key, the wrong type, or out of range skipped. This is what the SITE
 * would show, so the screen opens on it.
 */
export function parseItinerarySettingRows(
  rows: { key: string; value: unknown }[] | null | undefined,
): ItinerarySettings {
  const out: ItinerarySettings = { ...DEFAULT_ITINERARY_SETTINGS };
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const spec = ITINERARY_SPECS.find((s) => s.key === row?.key);
    if (!spec) continue;
    const v = row.value;
    if (spec.kind === "bool") {
      if (typeof v === "boolean") out[spec.field] = v;
      continue;
    }
    if (numberFits(spec, v)) out[spec.field] = v;
  }
  return out;
}

/** One message per field that is wrong (Hebrew, shown under the field). */
export type ItineraryFieldErrors = Partial<Record<ItineraryField, string>>;

/**
 * Checks a whole form. `input` is untrusted (a server action argument): every field must be present and of
 * the right type - a number must be a finite JSON number (a string "30" or NaN is refused, because the reader
 * would ignore it), inside its range, whole where the reader wants a whole number. Only when the fields on
 * both sides of a cross-field rule are individually valid is the rule checked, so one typo does not stack a
 * second, confusing message on its neighbour.
 */
export function validateItinerarySettings(
  input: unknown,
): { ok: true; settings: ItinerarySettings } | { ok: false; errors: ItineraryFieldErrors } {
  const errors: ItineraryFieldErrors = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { paymentsEnabled: "הטופס לא תקין - רעננו את הדף ונסו שוב" } };
  }
  const p = input as Record<string, unknown>;
  const out = { ...DEFAULT_ITINERARY_SETTINGS };
  const valid = new Set<ItineraryField>();

  for (const spec of ITINERARY_SPECS) {
    const v = p[spec.field];
    if (spec.kind === "bool") {
      if (typeof v !== "boolean") {
        errors[spec.field] = "ערך לא תקין";
        continue;
      }
      out[spec.field] = v;
      valid.add(spec.field);
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors[spec.field] = `יש להזין ${spec.int ? "מספר שלם" : "מספר"} בין ${spec.min} ל-${spec.max}`;
      continue;
    }
    if (v < spec.min || v > spec.max) {
      errors[spec.field] = `חייב להיות בין ${spec.min} ל-${spec.max}`;
      continue;
    }
    if (spec.int && !Number.isInteger(v)) {
      errors[spec.field] = "חייב להיות מספר שלם";
      continue;
    }
    out[spec.field] = v;
    valid.add(spec.field);
  }

  const both = (a: ItineraryField, b: ItineraryField) => valid.has(a) && valid.has(b);
  if (both("bestKm", "maxKm") && out.bestKm > out.maxKm) {
    errors.bestKm = `המרחק ה'מומלץ' (${out.bestKm} ק״מ) לא יכול לעלות על המרחק המקסימלי (${out.maxKm} ק״מ)`;
  }
  if (both("okGapDays", "maxGapDays") && out.okGapDays > out.maxGapDays) {
    errors.okGapDays = `הימים ה'נוחים' (${out.okGapDays}) לא יכולים לעלות על הימים המקסימליים בין אירועים (${out.maxGapDays})`;
  }
  if (both("maxGapDays", "maxSpanDays") && out.maxGapDays > out.maxSpanDays) {
    errors.maxGapDays = `הימים המקסימליים בין אירועים (${out.maxGapDays}) לא יכולים לעלות על אורך הטריפ המקסימלי (${out.maxSpanDays} ימים)`;
  }
  if (both("tier3Pct", "tier2Pct") && out.tier3Pct < out.tier2Pct) {
    errors.tier3Pct = `ההנחה על האירוע השלישי (${out.tier3Pct}%) לא יכולה להיות קטנה מההנחה על האירוע השני (${out.tier2Pct}%)`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: out };
}

/**
 * The messages the screen already shows, re-checked against the form as it is now - called on every edit, so a
 * message that the edit just made untrue goes away (raising the maximum distance clears the "best" distance's
 * "can't pass the maximum"), and one that still holds stays. Only fields that ALREADY show a message are looked
 * at: an edit never produces a fresh error on a field the person has not been told about (Save does that).
 */
export function refreshItineraryErrors(shown: ItineraryFieldErrors, input: unknown): ItineraryFieldErrors {
  const fresh = validateItinerarySettings(input);
  const now: ItineraryFieldErrors = fresh.ok ? {} : fresh.errors;
  const out: ItineraryFieldErrors = {};
  for (const spec of ITINERARY_SPECS) {
    if (shown[spec.field] && now[spec.field]) out[spec.field] = now[spec.field];
  }
  return out;
}

/** The table rows of a validated form: every key, as jsonb numbers / booleans, in `ITINERARY_SPECS` order. */
export function itineraryRows(settings: ItinerarySettings): { key: string; value: number | boolean }[] {
  return ITINERARY_SPECS.map((s) => ({ key: s.key, value: settings[s.field] }));
}

/** The field errors as one line for a caller that has no fields to hang them on (the action's `error`). */
export function itineraryErrorsText(errors: ItineraryFieldErrors): string {
  const parts = ITINERARY_SPECS.flatMap((s) => (errors[s.field] ? [`${s.label} - ${errors[s.field]}`] : []));
  return `ההגדרות לא נשמרו. ${parts.join("; ")}`;
}

/** What a staff member below admin is told when they try to save (the action) and sees on the page (the form is read-only). */
export const ITINERARY_ADMIN_ONLY_TEXT = "רק מנהלים יכולים לשנות את הגדרות היורו טריפ";

/** What `readItinerarySettings` hands the screen. Defaults are always merged in; `status` says why they may be all there is. */
export type ItinerarySettingsRead =
  /**
   * `saved` = the table holds at least one row; false = nothing saved yet, so these are the defaults.
   * `canEdit` = the viewer may save (admin / superadmin); an editor reads the same screen, read-only.
   */
  | { status: "ok"; settings: ItinerarySettings; saved: boolean; canEdit: boolean }
  /** The migration has not been pushed: the table does not exist. The defaults are shown; a save is refused. */
  | { status: "table_missing"; settings: ItinerarySettings; canEdit: boolean }
  /** Anything else that went wrong (the screen must not present the defaults as what is saved). */
  | { status: "error"; settings: ItinerarySettings; message: string };

/**
 * What `saveItinerarySettings` answers; it never throws. `warning` = saved, but the site could not be told.
 * `unchanged` = the form matched what the site already uses: nothing to audit and nobody to tell.
 */
export type SaveItinerarySettingsResult =
  | { ok: true; warning?: string; unchanged?: true }
  | { error: string; fieldErrors?: ItineraryFieldErrors };
