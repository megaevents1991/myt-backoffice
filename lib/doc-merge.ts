/**
 * A three-way merge of one JSON document (pure, no I/O).
 *
 * Two people edit the same document - a tours company's home page - and the second save
 * is refused because the first one moved the version. Instead of throwing the second
 * person's work away, their copy is merged onto the newest one:
 *
 *   base   = the document as it was when they opened it (the version their save named)
 *   mine   = what they have on screen now
 *   theirs = the document as it is saved now
 *
 * Rules, top down:
 *   - a part only one side changed takes that side's value;
 *   - an object both sides changed is merged key by key;
 *   - a list of objects that carry a unique `id` (else a unique `key`) in all three copies
 *     is merged item by item: either side may add, remove or change an item, and the order
 *     follows the side that moved items (both moved them = mine, reported);
 *   - anything else both changed to different values keeps MINE and is reported as a
 *     collision - the person merging is the one looking at the screen and saving next.
 *   - an item one side removed and the other changed is KEPT (the change is never lost)
 *     and reported, so the person can remove it again.
 *
 * Every other list (pictures, slugs, pills) is one value: two people changing the same
 * list differently is a collision, never a mix of both.
 */

export type MergePath = string[];

export type CollisionKind =
  /** both changed the same value to different things: mine is kept */
  | "both_changed"
  /** I removed an item they changed: theirs is kept */
  | "you_removed"
  /** they removed an item I changed: mine is kept */
  | "they_removed"
  /** both reordered the same list differently: my order is kept */
  | "order";

export interface MergeCollision {
  kind: CollisionKind;
  path: MergePath;
  /** both_changed on a plain value (text, number, switch): what they had, so the person can choose without hunting for it. */
  theirs?: string | number | boolean | null;
}

const isPlain = (v: unknown): v is string | number | boolean | null => v === null || ["string", "number", "boolean"].includes(typeof v);

export interface MergeResult<T> {
  value: T;
  collisions: MergeCollision[];
}

/** How a merge names what it reports: a list item by what it is, an object field by its key. */
export interface MergeLabels {
  /** The segment of a list item's path, e.g. 'Tile "Families"'. `field` = the key of the list in its parent. */
  item?: (item: Record<string, unknown>, field: string) => string;
  /** The segment of an object field's path; return null to leave the field out of the path (a list whose items name themselves). */
  field?: (key: string, parentField: string) => string | null;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural equality: key order does not matter, list order does, a missing key equals `undefined`. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!deepEqual(a[key], b[key])) return false;
    return true;
  }
  return false;
}

/** The field a list's items are matched by: `id`, else `key` - only when every item of all three lists has one, unique in its list. */
function identityOf(lists: unknown[][]): "id" | "key" | null {
  for (const field of ["id", "key"] as const) {
    const ok = lists.every((list) => {
      const seen = new Set<string>();
      for (const item of list) {
        if (!isObj(item)) return false;
        const value = item[field];
        if (typeof value !== "string" || value === "" || seen.has(value)) return false;
        seen.add(value);
      }
      return true;
    });
    if (ok) return field;
  }
  return null;
}

class Merger {
  readonly collisions: MergeCollision[] = [];
  constructor(private readonly labels: MergeLabels) {}

  private report(kind: CollisionKind, path: MergePath, theirs?: unknown) {
    this.collisions.push(isPlain(theirs) ? { kind, path, theirs } : { kind, path });
  }

  private fieldSegment(key: string, parentField: string): string | null {
    return this.labels.field ? this.labels.field(key, parentField) : key;
  }

  private itemSegment(item: Obj, field: string, id: string): string {
    return this.labels.item ? this.labels.item(item, field) : id;
  }

  value(base: unknown, mine: unknown, theirs: unknown, path: MergePath, field: string): unknown {
    if (deepEqual(mine, theirs)) return mine;
    if (deepEqual(mine, base)) return theirs;
    if (deepEqual(theirs, base)) return mine;
    // both changed it, differently
    if (isObj(base) && isObj(mine) && isObj(theirs)) return this.object(base, mine, theirs, path, field);
    if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs)) {
      const id = identityOf([base, mine, theirs]);
      if (id) return this.list(base as Obj[], mine as Obj[], theirs as Obj[], id, path, field);
    }
    this.report("both_changed", path, theirs);
    return mine;
  }

  private object(base: Obj, mine: Obj, theirs: Obj, path: MergePath, parentField: string): Obj {
    const out: Obj = {};
    // mine's key order first, then keys only theirs has
    const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])];
    for (const key of keys) {
      const segment = this.fieldSegment(key, parentField);
      const merged = this.value(base[key], mine[key], theirs[key], segment === null ? path : [...path, segment], key);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }

  private list(base: Obj[], mine: Obj[], theirs: Obj[], idField: "id" | "key", path: MergePath, field: string): Obj[] {
    const idOf = (item: Obj) => item[idField] as string;
    const byId = (list: Obj[]) => new Map(list.map((item) => [idOf(item), item]));
    const B = byId(base);
    const M = byId(mine);
    const T = byId(theirs);

    const kept = new Map<string, Obj>();
    const ids = [...new Set([...mine.map(idOf), ...theirs.map(idOf), ...base.map(idOf)])];
    for (const id of ids) {
      const b = B.get(id);
      const m = M.get(id);
      const t = T.get(id);
      const at = (item: Obj) => [...path, this.itemSegment(item, field, id)];
      if (b && m && t) kept.set(id, this.value(b, m, t, at(m), field) as Obj);
      else if (b && !m && t) {
        // I removed it; keep it only when they changed it
        if (!deepEqual(t, b)) {
          kept.set(id, t);
          this.report("you_removed", at(t));
        }
      } else if (b && m && !t) {
        // they removed it; keep it only when I changed it
        if (!deepEqual(m, b)) {
          kept.set(id, m);
          this.report("they_removed", at(m));
        }
      } else if (!b && m && t) {
        // both added the same id (ids are random - nearly never)
        if (!deepEqual(m, t)) this.report("both_changed", at(m));
        kept.set(id, m);
      } else if (m) kept.set(id, m);
      else if (t) kept.set(id, t);
      // in base only = both removed it
    }

    const moved = (list: Obj[]) => {
      const inList = new Set(list.map(idOf));
      const before = base.map(idOf).filter((id) => inList.has(id));
      const after = list.map(idOf).filter((id) => B.has(id));
      return !deepEqual(before, after);
    };
    const mineMoved = moved(mine);
    const theirsMoved = moved(theirs);
    if (mineMoved && theirsMoved && !deepEqual(mine.map(idOf).filter((id) => T.has(id)), theirs.map(idOf).filter((id) => M.has(id)))) {
      this.report("order", path);
    }
    const [lead, other] = theirsMoved && !mineMoved ? [theirs, mine] : [mine, theirs];

    const order = lead.map(idOf).filter((id) => kept.has(id));
    const placed = new Set(order);
    // what only the other side holds goes right after the item it follows there (none = first)
    let after: string | null = null;
    for (const item of other) {
      const id = idOf(item);
      if (kept.has(id) && !placed.has(id)) {
        const at = after === null ? 0 : order.indexOf(after) + 1;
        order.splice(at, 0, id);
        placed.add(id);
      }
      if (placed.has(id)) after = id;
    }
    return order.map((id) => kept.get(id) as Obj);
  }
}

/**
 * Merges `mine` onto `theirs`, both edited from `base`. The result keeps every change of both sides
 * that does not collide; each collision is listed with where it is.
 */
export function mergeDocs<T>(base: T, mine: T, theirs: T, labels: MergeLabels = {}): MergeResult<T> {
  const merger = new Merger(labels);
  const value = merger.value(base, mine, theirs, [], "") as T;
  return { value, collisions: merger.collisions };
}
