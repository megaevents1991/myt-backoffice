// Run: npx tsx scripts/itinerary-requests-selftest.ts
// The Euro Trip customers' "offer my trip to others" requests (lib/itinerary/requests.ts): one group per set
// of events whatever their order, the waiting ones first (most requests first), the names each once, "already
// a trip", and the ids a client call may act on.
import assert from "node:assert/strict";
import {
  groupDraftTitle,
  groupRouteRequests,
  isRequestStatus,
  requestIdsOf,
  requestSetKeyOf,
  type RouteRequest,
} from "../lib/itinerary/requests";

const req = (over: Partial<RouteRequest> & Pick<RouteRequest, "id" | "eventIds">): RouteRequest => ({
  createdAt: `2026-10-2${over.id % 10}T10:00:00Z`,
  title: null,
  reservationId: null,
  pax: 2,
  contactName: "Dana Levi",
  contactEmail: "dana@example.com",
  contactPhone: "0501234567",
  status: "new",
  routeId: null,
  handledAt: null,
  ...over,
});

// --- the set key -------------------------------------------------------------------------------------------
{
  assert.equal(requestSetKeyOf([22, 11]), "11,22", "ascending, whatever the order");
  assert.equal(requestSetKeyOf([11, 22, 11]), "11,22", "each id once");
  assert.equal(requestSetKeyOf([]), "", "no events = no key");
}

// --- grouping -----------------------------------------------------------------------------------------------
{
  const groups = groupRouteRequests(
    [
      req({ id: 1, eventIds: [11, 22], title: "פריז ולונדון" }),
      req({ id: 3, eventIds: [22, 11], title: "  פריז   ולונדון " }),
      req({ id: 2, eventIds: [11, 22], title: "סופ״ש" }),
      req({ id: 5, eventIds: [33, 44] }),
      req({ id: 4, eventIds: [55, 66], status: "rejected" }),
      req({ id: 6, eventIds: [77, 88], status: "published", routeId: 9 }),
    ],
    [{ id: 9, eventIds: [88, 77] }],
  );

  assert.deepEqual(
    groups.map((g) => g.key),
    ["11,22", "33,44", "77,88", "55,66"],
    "waiting first, most requests first; then the handled, newest first",
  );
  const [paris] = groups;
  assert.deepEqual(paris.requests.map((r) => r.id), [3, 2, 1], "newest first");
  assert.deepEqual(paris.eventIds, [22, 11], "the newest request's trip order");
  assert.deepEqual(paris.newIds, [3, 2, 1]);
  assert.equal(paris.status, "new");
  assert.deepEqual(paris.titles, ["פריז   ולונדון", "סופ״ש"], "each name once (spaces aside), newest first, trimmed");
  assert.equal(groupDraftTitle(paris), "פריז   ולונדון");
  assert.equal(paris.existingRouteId, null);

  const untitled = groups[1];
  assert.deepEqual(untitled.titles, []);
  assert.equal(groupDraftTitle(untitled), "", "no name given: staff write one");

  const published = groups[2];
  assert.equal(published.status, "published");
  assert.equal(published.publishedRouteId, 9);
  assert.equal(published.existingRouteId, 9, "a staff trip with the same events, in any order");
  assert.deepEqual(published.newIds, []);

  assert.equal(groups[3].status, "rejected");
}

// --- a group with one waiting request among handled ones is waiting ------------------------------------------
{
  const [g] = groupRouteRequests(
    [req({ id: 1, eventIds: [1, 2], status: "rejected" }), req({ id: 2, eventIds: [1, 2] })],
    [],
  );
  assert.equal(g.status, "new");
  assert.deepEqual(g.newIds, [2], "only the waiting one is acted on");
}

// --- statuses and ids from a client call ----------------------------------------------------------------------
{
  assert.equal(isRequestStatus("new"), true);
  assert.equal(isRequestStatus("deleted"), false);
  assert.deepEqual(requestIdsOf([3, 1, 3]), [3, 1]);
  assert.equal(requestIdsOf([]), null);
  assert.equal(requestIdsOf([1, 0]), null);
  assert.equal(requestIdsOf([1.5]), null);
  assert.equal(requestIdsOf(["1"]), null);
  assert.equal(requestIdsOf("1"), null);
  assert.equal(requestIdsOf(Array.from({ length: 201 }, (_, i) => i + 1)), null);
}

console.log("itinerary-requests selftest: OK");
