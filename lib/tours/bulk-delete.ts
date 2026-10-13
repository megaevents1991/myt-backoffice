/**
 * "Delete selected" on the tours sheets (Departures, a tour's Dates & Prices,
 * Offline Flights): which ticked rows a bulk delete leaves alone, and why.
 *
 * One rule for the confirm's count (the sheet) and for the write (the server
 * action), so the two can never disagree. A row kept here is not locked: a
 * date with seats sold is deleted from its own card, one at a time, and a
 * flight is deleted once no sub-tour flies on it.
 *
 * Pure - no DB, no request context (scripts/tour-setup-selftest.ts).
 */

/** A date with seats sold is not deleted in bulk; null = it may go. */
export function departureKeptReason(sold: number): string | null {
  if (!(sold > 0)) return null;
  return `${sold} seat${sold === 1 ? "" : "s"} sold on it - delete it from its own card`;
}

/** A flight a live sub-tour flies on is not deleted in bulk; null = it may go. */
export function flightKeptReason(tourCodes: readonly string[]): string | null {
  if (tourCodes.length === 0) return null;
  const one = tourCodes.length === 1;
  return `${one ? "Sub-tour" : "Sub-tours"} ${tourCodes.join(", ")} ${one ? "flies" : "fly"} on it - delete the sub-tour first`;
}
