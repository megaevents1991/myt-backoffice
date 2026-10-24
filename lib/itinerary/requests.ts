/**
 * "Build Your Euro Trip" - customers' "offer my trip to others" requests (table `itinerary_route_requests`,
 * migration 20261024084720), as the Events > בקשות טריפים screen shows them. Pure: no I/O, no clock.
 * Run: npx tsx scripts/itinerary-requests-selftest.ts
 *
 * myt-main writes one row per held self-built trip whose customer ticked the offer (its summary step), with
 * the name they gave it. Staff publish a request as a staff trip (`itinerary_routes`) or reject it. Requests
 * for the SAME events (in any order) are one group on the screen: "3 הציעו" is the signal of what to put up
 * first, and one trip answers them all.
 */
import type { TripEventLite } from "./routes";

export const REQUEST_STATUSES = ["new", "published", "rejected"] as const;
export type RouteRequestStatus = (typeof REQUEST_STATUSES)[number];

export const isRequestStatus = (v: unknown): v is RouteRequestStatus =>
  typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);

/** One request as the screen reads it (the table's columns, camel-cased). */
export type RouteRequest = {
  id: number;
  createdAt: string;
  /** The name the customer gave the trip; null = none. */
  title: string | null;
  /** The trip's events in trip (date) order. */
  eventIds: number[];
  reservationId: number | null;
  pax: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: RouteRequestStatus;
  routeId: number | null;
  handledAt: string | null;
};

/** Requests for one set of events. */
export type RouteRequestGroup = {
  /** The events' ids, sorted and joined ("11,22"): one key per set whatever the order. */
  key: string;
  /** The newest request's events, in its (trip) order. */
  eventIds: number[];
  /** Newest first. */
  requests: RouteRequest[];
  /** The ids still waiting (`new`) - what "הפוך לטריפ" / "דחייה" act on. */
  newIds: number[];
  /** new while any request waits; else published if one was published; else rejected. */
  status: RouteRequestStatus;
  /** The names customers gave, newest first, each once (case and spaces aside). */
  titles: string[];
  /** The newest request's time. */
  latestAt: string;
  /** A staff trip (any state) with these same events, if there is one. */
  existingRouteId: number | null;
  /** The staff trip a request of this group was published as (the newest such). */
  publishedRouteId: number | null;
};

/** A group as the screen draws it: its events (soonest first) and whether the site would show it as a trip. */
export type RouteRequestGroupView = RouteRequestGroup & {
  events: TripEventLite[];
  site: { shown: boolean; text: string };
};

export type RouteRequestsRead =
  | { status: "ok"; groups: RouteRequestGroupView[]; nextSortOrder: number }
  /** The migration is not pushed yet. */
  | { status: "table_missing" }
  | { status: "error"; message: string };

/** One key per set of events, whatever their order: the distinct ids, ascending, joined by commas. */
export const requestSetKeyOf = (ids: number[]): string =>
  [...new Set(ids)].sort((a, b) => a - b).join(",");

const byNewest = (a: RouteRequest, b: RouteRequest) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;

const titleKey = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The requests grouped by their set of events. Order: waiting groups first - most waiting requests first, then
 * the newest - then the handled ones, newest first. `staffRoutes` = every staff trip (id + events), to say
 * "already a trip".
 */
export function groupRouteRequests(
  requests: RouteRequest[],
  staffRoutes: { id: number; eventIds: number[] }[],
): RouteRequestGroup[] {
  const routeBySet = new Map<string, number>();
  for (const r of staffRoutes) {
    const key = requestSetKeyOf(r.eventIds);
    if (!routeBySet.has(key)) routeBySet.set(key, r.id);
  }

  const buckets = new Map<string, RouteRequest[]>();
  for (const r of requests) {
    const key = requestSetKeyOf(r.eventIds);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  const groups: RouteRequestGroup[] = [...buckets.entries()].map(([key, list]) => {
    const sorted = [...list].sort(byNewest);
    const newIds = sorted.filter((r) => r.status === "new").map((r) => r.id);
    const published = sorted.find((r) => r.status === "published");
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const r of sorted) {
      const t = r.title?.trim();
      if (!t || seen.has(titleKey(t))) continue;
      seen.add(titleKey(t));
      titles.push(t);
    }
    return {
      key,
      eventIds: sorted[0].eventIds,
      requests: sorted,
      newIds,
      status: newIds.length > 0 ? "new" : published ? "published" : "rejected",
      titles,
      latestAt: sorted[0].createdAt,
      existingRouteId: routeBySet.get(key) ?? null,
      publishedRouteId: published?.routeId ?? null,
    };
  });

  return groups.sort((a, b) => {
    const aw = a.status === "new" ? 0 : 1;
    const bw = b.status === "new" ? 0 : 1;
    if (aw !== bw) return aw - bw;
    if (aw === 0 && a.newIds.length !== b.newIds.length) return b.newIds.length - a.newIds.length;
    return b.latestAt.localeCompare(a.latestAt) || a.key.localeCompare(b.key);
  });
}

/** What "הפוך לטריפ" starts the title with: the newest name a customer gave, else empty (staff write one). */
export const groupDraftTitle = (g: RouteRequestGroup): string => g.titles[0] ?? "";

/** Ids a client call may act on: whole positive numbers, each once, at most 200. Anything else = null. */
export function requestIdsOf(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  if (!raw.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0)) return null;
  return [...new Set(raw as number[])];
}
