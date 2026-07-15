"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { buildTree } from "@/lib/taxonomy-tree";
import type { EventCategory, EventCategoryNode } from "@/types/taxonomy.types";

export function TaxonomyManager({ initial }: { initial: EventCategory[] }) {
  const { toast } = useToast();
  const [cats, setCats] = useState<EventCategory[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EventCategory | null>(null);
  const [form, setForm] = useState<{ name: string; name_english: string; parent_id: string }>({
    name: "",
    name_english: "",
    parent_id: "",
  });

  const tree = buildTree(cats);
  const refresh = async () => setCats(await listCategories());

  const openNew = (parentId: number | null) => {
    setEditing(null);
    setForm({ name: "", name_english: "", parent_id: parentId != null ? String(parentId) : "" });
    setOpen(true);
  };
  const openEdit = (c: EventCategory) => {
    setEditing(c);
    setForm({
      name: c.name,
      name_english: c.name_english ?? "",
      parent_id: c.parent_id != null ? String(c.parent_id) : "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    const parent_id = form.parent_id ? Number(form.parent_id) : null;
    try {
      if (editing) {
        await updateCategory(editing.id, {
          name: form.name,
          name_english: form.name_english || null,
          parent_id,
        });
      } else {
        await createCategory({
          name: form.name,
          name_english: form.name_english || undefined,
          parent_id,
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

  const Row = ({ node, depth }: { node: EventCategoryNode; depth: number }) => (
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
        </span>
        <Button size="sm" variant="ghost" onClick={() => openNew(node.id)}>
          + Sub
        </Button>
        <Button size="sm" variant="ghost" onClick={() => openEdit(node)}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => remove(node)}>
          Delete
        </Button>
      </div>
      {node.children.map((c) => (
        <Row key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );

  return (
    <div className="space-y-3">
      <Button onClick={() => openNew(null)}>+ Root category</Button>
      <div className="rounded-md border">
        {tree.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No categories yet.</div>
        )}
        {tree.map((n) => (
          <Row key={n.id} node={n} depth={0} />
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
                  .filter((c) => !editing || c.id !== editing.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
