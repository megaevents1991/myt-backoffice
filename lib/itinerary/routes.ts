/**
 * "Build Your Euro Trip" - the staff-built trips ("טריפים"), backoffice side.
 *
 * PURE: no I/O (scripts/itinerary-routes-selftest.ts). A trip is a row of `itinerary_routes` (migration
 * 20261022161231): a Hebrew title and 2-3 events, shown first on the public hub while every event is still on
 * sale and the events still fit each other. This file holds the two rules the actions and the screen share:
 *
 * - `validateItineraryRoute` - the form, mirroring the table's CHECKs (title 2..80 characters once trimmed,
 *   2..3 events) plus what a CHECK can't say (distinct positive ids, a whole sort order). The screen runs it
 *   before calling the action and the action runs it again; what it returns is what is written, so the TRIMMED
 *   title goes to the table, never the raw input: the CHECK trims spaces only (`btrim`), the validator also
 *   cuts tabs and newlines.
 * - `routeSiteStatus` - the one-line answer to "will the site show this trip?". The site re-checks distance
 *   and gaps itself (myt-main `lib/itinerary/staffRoutes.ts`), so a green status means "not ruled out here".
 */

import { MAX_TRIP_EVENTS } from "./settings";

/** The fewest events one trip can have (the migration's CHECK is 2..3; the top is `MAX_TRIP_EVENTS`). */
export const MIN_TRIP_EVENTS = 2;
export const ROUTE_TITLE_MIN = 2;
export const ROUTE_TITLE_MAX = 80;
/** `sort_order` is a Postgres `integer`. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

export type ItineraryRouteInput = {
  /** Present when editing a saved trip. */
  id?: number;
  title: string;
  /** `events.id` of the trip, 2-3 of them, in staff order. */
  eventIds: number[];
  sortOrder: number;
  isActive: boolean;
};

export type ItineraryRouteRow = ItineraryRouteInput & { id: number; updatedAt: string };

export type ItineraryRouteField = "title" | "eventIds" | "sortOrder";
export type ItineraryRouteErrors = Partial<Record<ItineraryRouteField, string>>;

export const ROUTE_TITLE_ERROR = "כותרת של 2-80 תווים";
export const ROUTE_EVENTS_ERROR = "בחרו 2 או 3 אירועים שונים";
export const ROUTE_SORT_ERROR = "מספר שלם";
/** A form that isn't even the right shape (a stale tab, a hand-made call). Filed under `title`, the first field. */
export const ROUTE_FORM_ERROR = "הטופס לא תקין - רעננו את הדף ונסו שוב";

const LABELS: Record<ItineraryRouteField, string> = { title: "כותרת", eventIds: "אירועים", sortOrder: "סדר" };

/** A positive whole number from a number or a plain digit string (what a form field hands over). */
function positiveInt(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function wholeInt4(v: unknown): number | null {
  const n = typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= INT4_MIN && n <= INT4_MAX ? n : null;
}

export function validateItineraryRoute(
  form: unknown,
): { ok: true; route: ItineraryRouteInput } | { ok: false; errors: ItineraryRouteErrors } {
  if (!form || typeof form !== "object" || Array.isArray(form)) {
    return { ok: false, errors: { title: ROUTE_FORM_ERROR } };
  }
  const p = form as Record<string, unknown>;
  const errors: ItineraryRouteErrors = {};

  // JS trim (tabs, newlines, no-break space too) - and the CHECK counts characters (Postgres char_length), so
  // so does this: an emoji is one, not two UTF-16 units.
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const titleLength = [...title].length;
  if (titleLength < ROUTE_TITLE_MIN || titleLength > ROUTE_TITLE_MAX) errors.title = ROUTE_TITLE_ERROR;

  let eventIds: number[] = [];
  if (Array.isArray(p.eventIds)) {
    const ids = p.eventIds.map(positiveInt);
    const clean = ids.filter((n): n is number => n !== null);
    if (
      clean.length === ids.length &&
      clean.length >= MIN_TRIP_EVENTS &&
      clean.length <= MAX_TRIP_EVENTS &&
      new Set(clean).size === clean.length
    ) {
      eventIds = clean;
    }
  }
  if (eventIds.length === 0) errors.eventIds = ROUTE_EVENTS_ERROR;

  const sortOrder = wholeInt4(p.sortOrder);
  if (sortOrder === null) errors.sortOrder = ROUTE_SORT_ERROR;

  // `id` is optional (new trip). A present but broken one is a broken form: guessing would edit the wrong row.
  let id: number | undefined;
  let badForm = false;
  if (p.id !== undefined && p.id !== null) {
    const parsed = positiveInt(p.id);
    if (parsed === null) badForm = true;
    else id = parsed;
  }
  if (typeof p.isActive !== "boolean") badForm = true;
  if (badForm && !errors.title) errors.title = ROUTE_FORM_ERROR;

  if (Object.keys(errors).length > 0 || sortOrder === null) return { ok: false, errors };
  return {
    ok: true,
    route: {
      ...(id !== undefined ? { id } : {}),
      title,
      eventIds,
      sortOrder,
      isActive: p.isActive as boolean,
    },
  };
}

/** The field errors as one line for a caller that has no fields to hang them on (the action's `error`). */
export function routeErrorsText(errors: ItineraryRouteErrors): string {
  const parts = (Object.keys(LABELS) as ItineraryRouteField[]).flatMap((f) =>
    errors[f] ? [`${LABELS[f]} - ${errors[f]}`] : [],
  );
  return `הטריפ לא נשמר. ${parts.join("; ")}`;
}

// ---------------------------------------------------------------------------------------------------------
// The site status
// ---------------------------------------------------------------------------------------------------------

/** An event as the trips screen needs it: enough to name it, place it and say whether the site would sell it. */
export type TripEventLite = {
  id: number;
  name: string;
  /** "YYYY-MM-DD" (a timestamp is compared by its day). */
  date: string | null;
  /** `events.is_deleted`: a "MM-DD-YYYY" date string, null = live. */
  is_deleted: string | null;
  is_hidden: boolean | null;
  /** `events.deactivated_reason`: why the sync took it off sale; null = on the site. */
  deactivated_reason: string | null;
  /** The event's tags; "Sold" = sold out. */
  tags: string[] | null;
  /** City label for the picker / list ("<event city> · טיסה ל<flight city>" on a two-city event). */
  place: string;
};

export const ROUTE_STATUS_SHOWN = "מוצג באתר אם כל האירועים עדיין מתאימים זה לזה";
const ROUTE_STATUS_PREFIX = "לא יוצג באתר: ";

/** Why the site would not sell this event, or null. The order is the status line's: deleted, hidden, deactivated, Sold, past. */
function blockedReason(e: TripEventLite, todayIso: string): string | null {
  if (e.is_deleted) return "האירוע נמחק";
  if (e.is_hidden === true) return "האירוע מוסתר";
  if (e.deactivated_reason && e.deactivated_reason.trim() !== "") return "האירוע הוסר מהמכירה";
  if (e.tags?.some((t) => t === "Sold")) return "אזל";
  if (e.date && e.date.slice(0, 10) < todayIso.slice(0, 10)) return "האירוע כבר עבר";
  return null;
}

/**
 * Walks the trip's events in the trip's own (staff) order and stops at the first that the site would not sell
 * (missing / deleted / hidden / deactivated / Sold / past): that event and why. Nothing wrong = the "shown" text,
 * which promises no more than this file can check.
 */
export function routeSiteStatus(
  eventIds: number[],
  events: TripEventLite[],
  todayIso: string,
): { shown: boolean; text: string } {
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const id of eventIds) {
    const e = byId.get(id);
    if (!e) return { shown: false, text: `${ROUTE_STATUS_PREFIX}#${id} - האירוע לא נמצא` };
    const reason = blockedReason(e, todayIso);
    if (reason) return { shown: false, text: `${ROUTE_STATUS_PREFIX}${e.name.trim() || `#${id}`} - ${reason}` };
  }
  return { shown: true, text: ROUTE_STATUS_SHOWN };
}

// ---------------------------------------------------------------------------------------------------------
// What the actions answer (types only - a "use server" file may export nothing else)
// ---------------------------------------------------------------------------------------------------------

export type ItineraryRouteListItem = ItineraryRouteRow & {
  /** The trip's events that exist, soonest first (a deleted-for-good id is simply absent; the status says so). */
  events: TripEventLite[];
  site: { shown: boolean; text: string };
};

export type ItineraryRoutesRead =
  | { status: "ok"; routes: ItineraryRouteListItem[] }
  /** The migration is not pushed yet. */
  | { status: "table_missing" }
  | { status: "error"; message: string };

/** `warning` = done, but the site could not be told (it catches up when its cache expires). */
export type ItineraryRouteWriteResult =
  | { ok: true; warning?: string }
  | { error: string; fieldErrors?: Record<string, string> };
