// The nightly base-price sync's visiting order. Pure - no DB, no fetch - so it runs under plain
// `node` from scripts/base-price-rotation-selftest.ts.
//
// Why this is its own rule (2026-09-17): the run fits ~24 events a night, and the old order put
// EVERY event of the next 45 days ahead of every farther one. With 110 near events that queue
// never emptied - the near ones were simply re-visited every ~5 nights - so the 328 farther
// events were never visited at all, ten nights running. Their bases stayed whatever they were
// typed as months ago, before the pricing rule existed.
//
// Now the two queues are interleaved: each is still least-recently-visited first, and the run
// alternates between them, so a night of N visits spends about half on the near window and
// half on the long tail. Near events are still refreshed more often (110 of them share half
// the night; 328 share the other half), which is what "near matters more" should mean -
// more often, not exclusively.

/** Out of every `NEAR_SLOTS + FAR_SLOTS` visits, how many go to each queue. */
export const NEAR_SLOTS = 1;
export const FAR_SLOTS = 1;

/** Pure: least-recently-visited first inside each queue, the queues interleaved NEAR_SLOTS:FAR_SLOTS. */
export function orderForRotation<T extends { id: number; date: string }>(
  events: T[],
  lastVisit: Map<number, string>,
  nearWindowEnd: string,
): T[] {
  const key = (event: T) => lastVisit.get(event.id) ?? "";
  const byVisit = (a: T, b: T) => key(a).localeCompare(key(b)) || a.date.localeCompare(b.date);
  const near = events.filter((event) => event.date <= nearWindowEnd).sort(byVisit);
  const far = events.filter((event) => event.date > nearWindowEnd).sort(byVisit);

  const out: T[] = [];
  let n = 0;
  let f = 0;
  while (n < near.length || f < far.length) {
    for (let i = 0; i < NEAR_SLOTS && n < near.length; i += 1) out.push(near[n++]);
    for (let i = 0; i < FAR_SLOTS && f < far.length; i += 1) out.push(far[f++]);
  }
  return out;
}
