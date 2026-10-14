/**
 * Editing one homepage row on the /homepage board (2026-10-14) - pure, so the
 * selftest can prove the one promise the board makes: **the row after a move is
 * exactly the row the site will show** (lib/homepage/merge.ts reads the pins
 * written here back into the same order).
 *
 * The rule: after any move, every PINNED card takes the place it now shows at,
 * and the card that was moved becomes pinned. Automatic cards keep no place -
 * they fill the rest in the rule's order, which a move never reorders. Pins the
 * row does not show (sold out, not on sale, past the row's length) are kept,
 * after the shown ones.
 *
 * Relative imports on purpose - the selftest runs without the `@/` alias.
 */

import { refId, refKind, type RowRef } from "./merge";
import type { HomepageItemKind, HomepageItemRow } from "../../types/homepage.types";

const itemRow = (section: string, ref: RowRef, position: number): HomepageItemRow => ({
  section,
  kind: refKind(ref) as HomepageItemKind,
  ref_id: refId(ref),
  position,
});

/** The order with the card at `from` moved to `to` (indexes clamped). */
export function moveInOrder(order: readonly RowRef[], from: number, to: number): RowRef[] {
  const next = [...order];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  const [x] = next.splice(from, 1);
  next.splice(target, 0, x);
  return next;
}

/** The order with `ref` placed at `at` (taken out first if it is already shown). */
export function insertInOrder(order: readonly RowRef[], ref: RowRef, at: number): RowRef[] {
  const next = order.filter((r) => r !== ref);
  next.splice(Math.min(Math.max(at, 0), next.length), 0, ref);
  return next;
}

/**
 * The pins that make a row read `order`: each ref of `pinned` that `order`
 * shows takes its index; the pinned refs it does not show (`kept`, in their
 * order) follow after the last shown place, so they never move a shown pin.
 */
export function pinsForOrder(
  section: string,
  order: readonly RowRef[],
  pinned: ReadonlySet<RowRef>,
  kept: readonly RowRef[] = [],
): HomepageItemRow[] {
  const out: HomepageItemRow[] = [];
  order.forEach((ref, i) => {
    if (pinned.has(ref)) out.push(itemRow(section, ref, i));
  });
  let next = order.length;
  for (const ref of kept) {
    if (order.includes(ref)) continue;
    out.push(itemRow(section, ref, next++));
  }
  return out;
}
