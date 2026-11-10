/**
 * The order of a table's columns as its viewer dragged them (Alon 10.11, "תן אופציה לשנות את סדר העמודות בגרירה").
 * Pure: `components/data-table.tsx` keeps the list in the browser (localStorage - a preference, not a narrowing of the
 * list, so it outlives the tab) and hands it to the table as `columnOrder`. Selftest: scripts/table-filters-selftest.ts.
 *
 * The tool columns never move: the row-drag grip and the tick box stay first, a row-actions column (`actions`) stays
 * last - it is pinned to the trailing edge only while it is the last one.
 */

/** At most this many ids are read back from storage - a table has far fewer columns. */
export const COLUMN_ORDER_MAX = 100;

export type FixedColumns = { start: readonly string[]; end: readonly string[] };

/**
 * The full order for the table: the fixed start columns that exist, then the stored order of the movable columns that
 * still exist (each once), then movable columns the stored order does not know (a column added since) in their
 * definition order, then the fixed end columns that exist.
 */
export function arrangeColumns(stored: readonly string[], ids: readonly string[], fixed: FixedColumns): string[] {
  const isFixed = (id: string) => fixed.start.includes(id) || fixed.end.includes(id);
  const movable = ids.filter((id) => id && !isFixed(id));
  const kept: string[] = [];
  for (const id of stored) if (movable.includes(id) && !kept.includes(id)) kept.push(id);
  const added = movable.filter((id) => !kept.includes(id));
  return [...fixed.start.filter((id) => ids.includes(id)), ...kept, ...added, ...fixed.end.filter((id) => ids.includes(id))];
}

/** One column dragged onto another's place. A fixed column, or an id the order does not hold, changes nothing. */
export function moveColumn(order: readonly string[], activeId: string, overId: string, fixed: FixedColumns): string[] {
  const isFixed = (id: string) => fixed.start.includes(id) || fixed.end.includes(id);
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from < 0 || to < 0 || from === to || isFixed(activeId) || isFixed(overId)) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/** What storage holds, read back: a list of ids, else nothing (a stored value of another shape is ignored). */
export function parseStoredOrder(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 80).slice(0, COLUMN_ORDER_MAX);
  } catch {
    return [];
  }
}

/** The order is the definition's own: nothing to keep (and "Reset column order" has nothing to reset). */
export function isDefaultOrder(order: readonly string[], ids: readonly string[], fixed: FixedColumns): boolean {
  const natural = arrangeColumns([], ids, fixed);
  return order.length === natural.length && order.every((id, i) => id === natural[i]);
}
