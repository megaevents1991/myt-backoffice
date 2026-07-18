import type { EventCategory, EventCategoryNode } from "@/types/taxonomy.types";

// Flat list → nested tree, sorted by display_order then name at each level.
export function buildTree(cats: EventCategory[]): EventCategoryNode[] {
  const byId = new Map<number, EventCategoryNode>();
  cats.forEach((c) => byId.set(c.id, { ...c, children: [] }));
  const roots: EventCategoryNode[] = [];
  byId.forEach((node) => {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sort = (ns: EventCategoryNode[]) => {
    ns.sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// "כדורגל › ליגה אנגלית" path label per category, for the multi-select.
export function flattenWithPath(cats: EventCategory[]): { id: number; path: string }[] {
  const byId = new Map<number, EventCategory>(cats.map((c) => [c.id, c]));
  const pathOf = (c: EventCategory): string => {
    const parts: string[] = [c.name];
    let cur = c.parent_id;
    const seen = new Set<number>();
    while (cur != null && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur)!;
      parts.unshift(p.name);
      cur = p.parent_id;
    }
    return parts.join(" › ");
  };
  return cats.map((c) => ({ id: c.id, path: pathOf(c) }));
}

// All descendant ids of `id` (not including `id` itself), from a built tree.
export function descendantIds(nodes: EventCategoryNode[], id: number): number[] {
  const find = (ns: EventCategoryNode[]): EventCategoryNode | null => {
    for (const n of ns) {
      if (n.id === id) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const collect = (n: EventCategoryNode): number[] =>
    n.children.flatMap((c) => [c.id, ...collect(c)]);
  const node = find(nodes);
  return node ? collect(node) : [];
}
