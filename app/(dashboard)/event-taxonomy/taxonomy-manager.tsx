"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  listCategories,
  createCategory,
  updateCategory,
  softDeleteCategory,
} from "@/lib/actions/event-taxonomy-actions";
import { buildTree, descendantIds } from "@/lib/taxonomy-tree";
import type { EventCategory, EventCategoryNode } from "@/types/taxonomy.types";

// Hoisted (not defined during render) so React reconciles rows instead of
// remounting the whole tree on every state change.
function CategoryRow({
  node,
  depth,
  counts,
  onAddSub,
  onEdit,
  onDelete,
  onMove,
}: {
  node: EventCategoryNode;
  depth: number;
  counts: Record<number, number>;
  onAddSub: (id: number) => void;
  onEdit: (c: EventCategory) => void;
  onDelete: (c: EventCategory) => void;
  onMove: (c: EventCategory, dir: -1 | 1) => void;
}) {
  return (
    <>
      <div
        className="flex items-center gap-2 py-1 px-2 border-b"
        style={{ paddingInlineStart: depth * 20 + 8 }}
      >
        <span className="flex-1">
          {node.name}
          {node.name_english ? (
            <span className="text-muted-foreground"> · {node.name_english}</span>
          ) : null}
          <span className="text-xs text-muted-foreground"> ({counts[node.id] ?? 0} events)</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => onMove(node, -1)} aria-label="Move up">
          <ArrowUp className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onMove(node, 1)} aria-label="Move down">
          <ArrowDown className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAddSub(node.id)}>
          + Sub
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(node)}>
          Delete
        </Button>
      </div>
      {node.children.map((c) => (
        <CategoryRow
          key={c.id}
          node={c}
          depth={depth + 1}
          counts={counts}
          onAddSub={onAddSub}
          onEdit={onEdit}
          onDelete={onDelete}
          onMove={onMove}
        />
      ))}
    </>
  );
}

const EMPTY_FORM = {
  name: "",
  name_english: "",
  parent_id: "" as string,
  image_url: "",
  description: "",
};

export function TaxonomyManager({
  initial,
  counts,
}: {
  initial: EventCategory[];
  counts: Record<number, number>;
}) {
  const { toast } = useToast();
  const [cats, setCats] = useState<EventCategory[]>(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<EventCategory | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const tree = buildTree(cats);
  const refresh = async () => setCats(await listCategories());

  // Parent dropdown must exclude self AND descendants (a node can't move
  // under its own subtree — the server guards it too, but don't offer it).
  const excludedParentIds = editing
    ? new Set([editing.id, ...descendantIds(tree, editing.id)])
    : new Set<number>();

  const openNew = (parentId: number | null) => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, parent_id: parentId != null ? String(parentId) : "" });
    setOpen(true);
  };
  const openEdit = (c: EventCategory) => {
    setEditing(c);
    setForm({
      name: c.name,
      name_english: c.name_english ?? "",
      parent_id: c.parent_id != null ? String(c.parent_id) : "",
      image_url: c.image_url ?? "",
      description: c.description ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    const parent_id = form.parent_id ? Number(form.parent_id) : null;
    setSaving(true);
    try {
      if (editing) {
        await updateCategory(editing.id, {
          name: form.name,
          name_english: form.name_english || null,
          parent_id,
          image_url: form.image_url || null,
          description: form.description || null,
        });
      } else {
        await createCategory({
          name: form.name,
          name_english: form.name_english || undefined,
          parent_id,
          image_url: form.image_url || undefined,
          description: form.description || undefined,
        });
      }
      setOpen(false);
      await refresh();
      toast({ title: "Saved" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: EventCategory) => {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      await softDeleteCategory(c.id);
      await refresh();
      toast({ title: "Deleted" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    }
  };

  // Reorder within siblings: normalize sibling display_order to their current
  // visual index, then swap the moved node with its neighbor.
  const move = async (c: EventCategory, dir: -1 | 1) => {
    const siblings = tree.length
      ? (c.parent_id == null
          ? tree
          : (function find(ns: EventCategoryNode[]): EventCategoryNode[] {
              for (const n of ns) {
                if (n.id === c.parent_id) return n.children;
                const hit = find(n.children);
                if (hit.length) return hit;
              }
              return [];
            })(tree))
      : [];
    const idx = siblings.findIndex((s) => s.id === c.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= siblings.length) return;
    const order = siblings.map((s, i) => ({ id: s.id, display_order: i }));
    [order[idx].display_order, order[target].display_order] = [
      order[target].display_order,
      order[idx].display_order,
    ];
    try {
      await Promise.all(order.map((o) => updateCategory(o.id, { display_order: o.display_order })));
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Reorder failed",
        description: e instanceof Error ? e.message : "Failed",
      });
    }
  };

  return (
    <div className="space-y-3">
      <Button onClick={() => openNew(null)}>+ Root category</Button>
      <div className="rounded-md border">
        {tree.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No categories yet.</div>
        )}
        {tree.map((n) => (
          <CategoryRow
            key={n.id}
            node={n}
            depth={0}
            counts={counts}
            onAddSub={openNew}
            onEdit={openEdit}
            onDelete={remove}
            onMove={move}
          />
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name (Hebrew)</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Name (English)</Label>
              <Input
                value={form.name_english}
                onChange={(e) => setForm((f) => ({ ...f, name_english: e.target.value }))}
              />
            </div>
            <div>
              <Label>Parent</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.parent_id}
                onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
              >
                <option value="">— Root —</option>
                {cats
                  .filter((c) => !excludedParentIds.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label>Image URL (category page hero/card)</Label>
              <Input
                value={form.image_url}
                onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
