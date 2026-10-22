"use server";

import { requireStaff } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";
import { diffChanges, logAudit } from "@/lib/audit";
import { supabase } from "@/lib/supabase-server";
import { isMissingRelation } from "@/lib/services/marketing-db";
import { revalidateItinerary } from "@/lib/revalidate-itinerary";
import { placeLabel } from "@/lib/lodging";
import {
  isEventId,
  routeErrorsText,
  routeSiteStatus,
  validateItineraryRoute,
  type ItineraryRouteListItem,
  type ItineraryRouteWriteResult,
  type ItineraryRoutesRead,
  type TripEventLite,
} from "@/lib/itinerary/routes";

/**
 * "Build Your Euro Trip" - the staff trips' reads and writes (Events > טריפים). A trip is a row of
 * `itinerary_routes` (migration 20261022161231): a Hebrew title and 2-3 events that myt-main shows first on
 * the /euro-trip hub while every event is still on sale and the events still fit each other. Any staff member
 * reads AND writes (requireStaff): an editor may edit events, so trips too. The rules live in
 * lib/itinerary/routes.ts (pure, scripts/itinerary-routes-selftest.ts).
 *
 * No function throws: the table does not exist until that migration is pushed, and the screen has to open and
 * explain, not crash. Every write audits (itinerary.route.create | update | delete - a deleted trip's row is
 * kept in the audit changes) and then tells the site to refresh; a refresh that fails comes back as a warning
 * next to a successful save, never as an error.
 */

// The ONE untyped boundary: types/database.types.ts has no `itinerary_routes` until `npm run db:types` is
// rerun after the migration is applied, and `events.is_hidden` / `deactivated_reason` predate the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const idb = supabase as any;

const TABLE = "itinerary_routes";
const ROUTE_COLUMNS = "id, title, event_ids, sort_order, is_active, updated_at";
const EVENT_COLUMNS =
  "id, name, date, is_deleted, is_hidden, deactivated_reason, tags, is_test, package_mode, location, event_location";

const NO_ACCESS = "אין הרשאה - התחברו מחדש ונסו שוב";
const TABLE_MISSING = "הטבלה עוד לא קיימת - המיגרציה תעלה עם הדחיפה הבאה";
const ROUTE_GONE = "הטריפ לא נמצא - ייתכן שנמחק. רעננו את הדף";

type RouteDbRow = {
  id: number;
  title: string;
  event_ids: (number | string)[] | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
};

type EventDbRow = {
  id: number;
  name: string | null;
  date: string | null;
  is_deleted: string | null;
  is_hidden: boolean | null;
  deactivated_reason: string | null;
  tags: unknown;
  is_test: boolean | null;
  package_mode: string | null;
  location: unknown;
  event_location: unknown;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** The session, or null (the caller answers NO_ACCESS in its own result shape). */
async function staffOrNull(): Promise<SessionPayload | null> {
  try {
    return await requireStaff();
  } catch {
    return null;
  }
}

/** `events.tags` is one string today ("Sold"); a comma list or an array are read the same way. */
function tagsOf(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  if (typeof raw === "string") {
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
    return tags.length > 0 ? tags : null;
  }
  return null;
}

/** `events.location` is the flight city as JSON; its `country_code` is what the site checks for the US. */
function countryOf(location: unknown): string | null {
  if (!location || typeof location !== "object") return null;
  const code = (location as { country_code?: unknown }).country_code;
  return typeof code === "string" && code.trim() !== "" ? code.trim() : null;
}

function liteOf(row: EventDbRow): TripEventLite {
  // `placeLabel` wants the flight city (`location`) and, on a two-city event, the event city.
  const lodging = row.location
    ? ({ location: row.location, event_location: row.event_location ?? null } as Parameters<typeof placeLabel>[0])
    : null;
  return {
    id: Number(row.id),
    name: (row.name ?? "").trim() || `Event ${row.id}`,
    date: row.date ?? null,
    is_deleted: row.is_deleted ?? null,
    is_hidden: row.is_hidden ?? null,
    deactivated_reason: row.deactivated_reason ?? null,
    tags: tagsOf(row.tags),
    is_test: row.is_test ?? null,
    package_mode: row.package_mode ?? null,
    country_code: countryOf(row.location),
    place: placeLabel(lodging),
  };
}

/**
 * The events with these ids (deleted ones included - the caller decides what that means). THROWS on a read error.
 * An id past `events.id`'s range (`isEventId`) is never sent: it is simply absent from the answer, like an id
 * that matches nothing - sent, it would fail the whole read with "out of range".
 */
async function readEvents(ids: number[]): Promise<Map<number, TripEventLite>> {
  const out = new Map<number, TripEventLite>();
  const unique = [...new Set(ids.filter(isEventId))];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await idb.from("events").select(EVENT_COLUMNS).in("id", unique.slice(i, i + 200));
    if (error) throw new Error(`events read: ${error.message ?? JSON.stringify(error)}`);
    for (const row of (data ?? []) as EventDbRow[]) out.set(Number(row.id), liteOf(row));
  }
  return out;
}

/** bigint[] reaches us as numbers; a string element (a very large id) is read the same way. */
const idsOf = (raw: RouteDbRow["event_ids"]): number[] => (raw ?? []).map(Number).filter((n) => Number.isSafeInteger(n));

/** The columns a trip's audit trail follows (the same names as the table). */
const auditShape = (r: { title: string; eventIds: number[]; sortOrder: number; isActive: boolean }) => ({
  title: r.title,
  event_ids: r.eventIds,
  sort_order: r.sortOrder,
  is_active: r.isActive,
});

const shapeOfRow = (row: RouteDbRow) =>
  auditShape({ title: row.title, eventIds: idsOf(row.event_ids), sortOrder: row.sort_order, isActive: row.is_active });

type RowRead = { kind: "row"; row: RouteDbRow } | { kind: "none" } | { kind: "missing" } | { kind: "error"; message: string };

async function readRoute(id: number): Promise<RowRead> {
  const { data, error } = await idb.from(TABLE).select(ROUTE_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingRelation(error)) return { kind: "missing" };
    console.error("itinerary_routes read one:", JSON.stringify(error));
    return { kind: "error", message: error.message ?? "שגיאה בקריאת הטריפ" };
  }
  return data ? { kind: "row", row: data as RouteDbRow } : { kind: "none" };
}

/** Tells the site; a failure is a warning next to a successful write. */
async function refreshSite(): Promise<ItineraryRouteWriteResult> {
  const refreshed = await revalidateItinerary();
  if (!refreshed.ok) return { ok: true, warning: `נשמר, אבל לא הצלחנו לרענן את האתר (${refreshed.reason})` };
  return { ok: true };
}

const failText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Whole numbers only (an id from a client call is not trusted). */
const isId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

function actorOf(session: SessionPayload) {
  return { id: session.sub, email: session.email, role: session.role };
}

/**
 * Every trip, staff order (sort_order, id), each with its events (soonest first) and the site status line.
 * A table that is not there yet reads as `table_missing`; anything else that fails as `error`.
 */
export async function listItineraryRoutes(): Promise<ItineraryRoutesRead> {
  if (!(await staffOrNull())) return { status: "error", message: NO_ACCESS };
  try {
    const { data, error } = await idb
      .from(TABLE)
      .select(ROUTE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      if (isMissingRelation(error)) return { status: "table_missing" };
      console.error("itinerary_routes list:", JSON.stringify(error));
      return { status: "error", message: error.message ?? "שגיאה בקריאת הטריפים" };
    }
    const rows = (data ?? []) as RouteDbRow[];
    const events = await readEvents(rows.flatMap((r) => idsOf(r.event_ids)));
    const today = todayIso();
    const routes: ItineraryRouteListItem[] = rows.map((row) => {
      const eventIds = idsOf(row.event_ids);
      const found = eventIds.flatMap((id) => {
        const e = events.get(id);
        return e ? [e] : [];
      });
      return {
        id: Number(row.id),
        title: row.title,
        eventIds,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        updatedAt: row.updated_at,
        events: [...found].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.id - b.id),
        site: routeSiteStatus(eventIds, found, today),
      };
    });
    return { status: "ok", routes };
  } catch (e) {
    console.error("listItineraryRoutes failed:", e);
    return { status: "error", message: failText(e) };
  }
}

/**
 * Creates (no `id`) or edits (`id`) a trip. Validates the form, checks every event exists and is not deleted,
 * writes the TRIMMED title the validator returned (never the raw input), audits, tells the site. An edit that
 * changes nothing writes, audits and pings nothing.
 */
export async function saveItineraryRoute(form: unknown): Promise<ItineraryRouteWriteResult> {
  const session = await staffOrNull();
  if (!session) return { error: NO_ACCESS };

  try {
    const checked = validateItineraryRoute(form);
    if (!checked.ok) return { error: routeErrorsText(checked.errors), fieldErrors: checked.errors };
    const route = checked.route;

    // Every event must exist and not be deleted (no foreign key on an array column).
    const events = await readEvents(route.eventIds);
    const unusable = route.eventIds.filter((id) => !events.get(id) || events.get(id)?.is_deleted);
    if (unusable.length > 0) {
      const eventIds = `האירוע ${unusable.join(", ")} לא קיים או נמחק - בחרו אירוע אחר`;
      return { error: `הטריפ לא נשמר. ${eventIds}`, fieldErrors: { eventIds } };
    }

    const after = auditShape(route);
    const now = new Date().toISOString();
    const columns = {
      title: route.title,
      event_ids: route.eventIds,
      sort_order: route.sortOrder,
      is_active: route.isActive,
      updated_by: session.sub,
      updated_at: now,
    };

    if (route.id === undefined) {
      const { data, error } = await idb.from(TABLE).insert(columns).select("id");
      if (error) {
        if (isMissingRelation(error)) return { error: TABLE_MISSING };
        console.error("itinerary_routes insert:", JSON.stringify(error));
        return { error: `השמירה נכשלה: ${error.message ?? "שגיאה"}` };
      }
      await logAudit({
        action: "itinerary.route.create",
        entityType: TABLE,
        entityId: (data as { id: number }[] | null)?.[0]?.id ?? null,
        changes: diffChanges(null, after),
        actor: actorOf(session),
      });
      return await refreshSite();
    }

    const before = await readRoute(route.id);
    if (before.kind === "missing") return { error: TABLE_MISSING };
    if (before.kind === "error") return { error: `קריאת הטריפ הקיים נכשלה: ${before.message}` };
    if (before.kind === "none") return { error: ROUTE_GONE };

    const changes = diffChanges(shapeOfRow(before.row), after);
    if (Object.keys(changes).length === 0) return { ok: true };

    const { data, error } = await idb.from(TABLE).update(columns).eq("id", route.id).select("id");
    if (error) {
      if (isMissingRelation(error)) return { error: TABLE_MISSING };
      console.error("itinerary_routes update:", JSON.stringify(error));
      return { error: `השמירה נכשלה: ${error.message ?? "שגיאה"}` };
    }
    // Deleted by someone else between the read and the write: nothing was saved.
    if (!Array.isArray(data) || data.length === 0) return { error: ROUTE_GONE };
    await logAudit({
      action: "itinerary.route.update",
      entityType: TABLE,
      entityId: route.id,
      changes,
      actor: actorOf(session),
    });
    return await refreshSite();
  } catch (e) {
    console.error("saveItineraryRoute failed:", e);
    return { error: `השמירה נכשלה: ${failText(e)}` };
  }
}

/** Deletes a trip for real (a trip is not an event); the audit row keeps what it held. Already gone = done. */
export async function deleteItineraryRoute(id: number): Promise<ItineraryRouteWriteResult> {
  const session = await staffOrNull();
  if (!session) return { error: NO_ACCESS };
  if (!isId(id)) return { error: "מזהה טריפ לא תקין" };

  try {
    const before = await readRoute(id);
    if (before.kind === "missing") return { error: TABLE_MISSING };
    if (before.kind === "error") return { error: `קריאת הטריפ נכשלה: ${before.message}` };
    if (before.kind === "none") return { ok: true };

    const { data, error } = await idb.from(TABLE).delete().eq("id", id).select("id");
    if (error) {
      if (isMissingRelation(error)) return { error: TABLE_MISSING };
      console.error("itinerary_routes delete:", JSON.stringify(error));
      return { error: `המחיקה נכשלה: ${error.message ?? "שגיאה"}` };
    }
    if (!Array.isArray(data) || data.length === 0) return { ok: true };

    await logAudit({
      action: "itinerary.route.delete",
      entityType: TABLE,
      entityId: id,
      changes: Object.fromEntries(Object.entries(shapeOfRow(before.row)).map(([k, v]) => [k, { from: v, to: null }])),
      actor: actorOf(session),
    });
    return await refreshSite();
  } catch (e) {
    console.error("deleteItineraryRoute failed:", e);
    return { error: `המחיקה נכשלה: ${failText(e)}` };
  }
}

/** The list's switch: shows or hides a trip on the site without opening the form. Audited as an update. */
export async function setItineraryRouteActive(id: number, on: boolean): Promise<ItineraryRouteWriteResult> {
  const session = await staffOrNull();
  if (!session) return { error: NO_ACCESS };
  if (!isId(id) || typeof on !== "boolean") return { error: "מזהה טריפ לא תקין" };

  try {
    const before = await readRoute(id);
    if (before.kind === "missing") return { error: TABLE_MISSING };
    if (before.kind === "error") return { error: `קריאת הטריפ נכשלה: ${before.message}` };
    if (before.kind === "none") return { error: ROUTE_GONE };
    if (before.row.is_active === on) return { ok: true };

    const { data, error } = await idb
      .from(TABLE)
      .update({ is_active: on, updated_by: session.sub, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) {
      if (isMissingRelation(error)) return { error: TABLE_MISSING };
      console.error("itinerary_routes set active:", JSON.stringify(error));
      return { error: `השמירה נכשלה: ${error.message ?? "שגיאה"}` };
    }
    if (!Array.isArray(data) || data.length === 0) return { error: ROUTE_GONE };

    await logAudit({
      action: "itinerary.route.update",
      entityType: TABLE,
      entityId: id,
      changes: { is_active: { from: before.row.is_active, to: on } },
      actor: actorOf(session),
    });
    return await refreshSite();
  } catch (e) {
    console.error("setItineraryRouteActive failed:", e);
    return { error: `השמירה נכשלה: ${failText(e)}` };
  }
}

/**
 * The trip dialog's event picker: upcoming, not-deleted events whose name (Hebrew or English) holds `query`, or
 * whose id it is, soonest first, 30 at most. Two characters at least - or a plain number, which is an id. Never
 * throws: a failure reads as no results.
 */
export async function searchTripEvents(query: string): Promise<TripEventLite[]> {
  if (!(await staffOrNull())) return [];
  try {
    // PostgREST's or() splits on commas and parentheses (and reads quotes and `*` itself): those become spaces.
    // `%` and `_` are LIKE wildcards - escaped, so "50%" looks for a percent sign, not for everything.
    const q = String(query ?? "")
      .replace(/[,()*"\\]/g, " ")
      .trim()
      .slice(0, 80);
    // Only a number an event can have (an integer id): past it `id.eq.` would fail the whole search, not match nothing.
    const asId = /^\d+$/.test(q) && isEventId(Number(q)) ? Number(q) : null;
    if (q.length < 2 && asId === null) return [];

    const like = q.replace(/[%_]/g, "\\$&");
    const filters = [
      ...(q.length >= 2 ? [`name.ilike.%${like}%`, `name_english.ilike.%${like}%`] : []),
      ...(asId !== null ? [`id.eq.${asId}`] : []),
    ];
    const { data, error } = await idb
      .from("events")
      .select(EVENT_COLUMNS)
      .is("is_deleted", null)
      .gte("date", todayIso())
      .or(filters.join(","))
      .order("date", { ascending: true })
      .limit(30);
    if (error) {
      console.error("searchTripEvents:", JSON.stringify(error));
      return [];
    }
    return ((data ?? []) as EventDbRow[]).map(liteOf);
  } catch (e) {
    console.error("searchTripEvents failed:", e);
    return [];
  }
}
