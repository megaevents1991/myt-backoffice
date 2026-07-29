"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";
import {
  listCategories,
  createCategory,
  updateCategory,
  softDeleteCategory,
  bulkSoftDeleteCategories,
} from "@/lib/actions/event-taxonomy-actions";
import { buildTree, descendantIds } from "@/lib/taxonomy-tree";
import { uploadToBucket } from "@/lib/upload-helper";
import { supabase } from "@/lib/supabase-client";
import type { EventCategory, EventCategoryNode } from "@/types/taxonomy.types";

// Category hero/card images live with the event card images (public bucket).
const IMAGE_BUCKET = "card_images";
const IMAGE_FOLDER = "event-categories";

// Hoisted (not defined during render) so React reconciles rows instead of
// remounting the whole tree on every state change.
function CategoryRow({
  node,
  depth,
  counts,
  selected,
  impliedSelected,
  onToggleSelect,
  onAddSub,
  onEdit,
  onDelete,
  onMove,
}: {
  node: EventCategoryNode;
  depth: number;
  counts: Record<number, number>;
  selected: Set<number>;
  /** ids covered because an ANCESTOR is selected (subtree deletes together) */
  impliedSelected: Set<number>;
  onToggleSelect: (id: number, on: boolean) => void;
  onAddSub: (id: number) => void;
  onEdit: (c: EventCategory) => void;
  onDelete: (c: EventCategory) => void;
  onMove: (c: EventCategory, dir: -1 | 1) => void;
}) {
  const implied = !selected.has(node.id) && impliedSelected.has(node.id);
  return (
    <>
      <div
        className="flex items-center gap-2 py-1 px-2 border-b"
        style={{ paddingInlineStart: depth * 20 + 8 }}
      >
        <Checkbox
          checked={selected.has(node.id) || implied}
          disabled={implied}
          onCheckedChange={(v) => onToggleSelect(node.id, v === true)}
          aria-label={`Select ${node.name}`}
          title={implied ? "Included via its selected parent" : undefined}
        />
        <span className="flex-1">
          {node.name}
          {node.name_english ? (
            <span className="text-muted-foreground"> · {node.name_english}</span>
          ) : null}
          <span className="text-xs text-muted-foreground"> ({counts[node.id] ?? 0} events)</span>
          {!node.is_active && (
            <span className="text-xs font-semibold text-amber-600"> · hidden</span>
          )}
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
          selected={selected}
          impliedSelected={impliedSelected}
          onToggleSelect={onToggleSelect}
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
  is_active: false,
};

export function TaxonomyManager({
  initial,
  counts,
}: {
  initial: EventCategory[];
  counts: Record<number, number>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [cats, setCats] = useState<EventCategory[]>(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Synchronous re-entry guard — `saving` STATE updates async, so a
  // double-tap fires save() twice before the re-render (duplicate categories).
  const savingRef = useRef(false);
  const [uploading, setUploading] = useState(false);

  // Direct-to-storage upload (signed URL — bypasses the 4.5MB function limit),
  // then drop the public URL into the form like a manually pasted one.
  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      // Unique, storage-safe name — Hebrew filenames and same-named re-uploads
      // must not collide or produce awkward object keys.
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const path = await uploadToBucket(
        IMAGE_BUCKET,
        IMAGE_FOLDER,
        new File([file], safeName, { type: file.type })
      );
      const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: data.publicUrl }));
      toast({ title: "Image uploaded" });
    } catch (e) {
      console.error("Category image upload failed:", e);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Try again or paste a URL.",
      });
    } finally {
      setUploading(false);
    }
  };
  const [editing, setEditing] = useState<EventCategory | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const tree = buildTree(cats);
  const refresh = async () => setCats(await listCategories());

  // Bulk selection. Selecting a node implies its whole subtree (the server
  // expands to descendants anyway — the UI just makes that visible).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const impliedSelected = new Set<number>(
    [...selected].flatMap((id) => descendantIds(tree, id))
  );
  const effectiveIds = new Set<number>([...selected, ...impliedSelected]);
  const toggleSelect = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const bulkRemove = async () => {
    if (!selected.size || bulkDeleting) return;
    const total = effectiveIds.size;
    const links = [...effectiveIds].reduce((sum, id) => sum + (counts[id] ?? 0), 0);
    if (
      !(await confirm({
        title: `Delete ${total} categor${total === 1 ? "y" : "ies"}?`,
        description: `Sub-categories of the selected parents are deleted too.${
          links ? ` ${links} event link(s) will be removed.` : ""
        }`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setBulkDeleting(true);
    try {
      const deleted = await bulkSoftDeleteCategories([...selected]);
      setSelected(new Set());
      await refresh();
      toast({ title: `Deleted ${deleted} categor${deleted === 1 ? "y" : "ies"}` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setBulkDeleting(false);
    }
  };

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
      is_active: c.is_active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    const parent_id = form.parent_id ? Number(form.parent_id) : null;
    savingRef.current = true;
    setSaving(true);
    try {
      if (editing) {
        await updateCategory(editing.id, {
          name: form.name,
          name_english: form.name_english || null,
          parent_id,
          image_url: form.image_url || null,
          description: form.description || null,
          is_active: form.is_active,
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
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async (c: EventCategory) => {
    if (
      !(await confirm({
        title: `Delete "${c.name}"?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
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
      <div className="flex items-center gap-3">
        <Button onClick={() => openNew(null)}>+ Root category</Button>
        {selected.size > 0 && (
          <Button variant="destructive" onClick={bulkRemove} disabled={bulkDeleting}>
            {bulkDeleting ? "Deleting..." : `Delete selected (${effectiveIds.size})`}
          </Button>
        )}
      </div>
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
            selected={selected}
            impliedSelected={impliedSelected}
            onToggleSelect={toggleSelect}
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
              <Label>Image (category page hero/card)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                  placeholder="https://... or upload →"
                />
                <input
                  id="category-image-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadImage(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => document.getElementById("category-image-file")?.click()}
                >
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </div>
              {form.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.image_url}
                  alt="Category preview"
                  className="mt-2 h-20 rounded-md border object-cover"
                />
              )}
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
            {editing ? (
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                />
                <Label>
                  Live on site
                  <span className="block text-xs font-normal text-muted-foreground">
                    Off = the /c/ page 404s and stays out of the sitemap
                  </span>
                </Label>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                New categories are created <b>hidden</b> — finish them, then flip “Live on
                site” in Edit (and enable the matching Templates card) when ready.
              </p>
            )}
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
