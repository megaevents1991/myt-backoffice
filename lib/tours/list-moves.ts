/**
 * Moves inside an ordered list of an editor, pure (scripts/tours-list-moves-selftest.ts). The one-item moves
 * (`moved`, `movedTo`) stay in components/tours/content/fields.tsx with the drag code that uses them.
 */

/**
 * Move several items together to the place of another (Liz 11.11: "לבחור כמה אטרקציות ביחד"): `picked` (indexes, any
 * order) leave the list in their own order and land before the item at `to` - after it when `down` (the dragged one
 * came from above). The items between close up. Returns the new list and where the picked items now are; landing on one
 * of the picked items changes nothing.
 */
export function movedBlock<T>(list: T[], picked: number[], to: number, down: boolean): { list: T[]; at: number[] } {
  const chosen = [...new Set(picked)].filter((i) => i >= 0 && i < list.length).sort((a, b) => a - b);
  if (!chosen.length || to < 0 || to >= list.length || chosen.includes(to)) return { list, at: chosen };
  const items = chosen.map((i) => list[i]);
  const rest = list.filter((_, i) => !chosen.includes(i));
  // by position, not by value: two lines may hold the same words (or both be empty)
  const anchor = to - chosen.filter((i) => i < to).length;
  const place = anchor + (down ? 1 : 0);
  const next = [...rest.slice(0, place), ...items, ...rest.slice(place)];
  return { list: next, at: items.map((_, k) => place + k) };
}
