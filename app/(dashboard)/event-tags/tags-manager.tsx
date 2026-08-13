"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-provider";
import {
  listTags,
  createTag,
  updateTag,
  softDeleteTag,
  bulkSoftDeleteTags,
} from "@/lib/actions/event-taxonomy-actions";
import { TAG_TYPES, type EventTag, type TagType } from "@/types/taxonomy.types";

const TYPE_LABELS: Record<TagType, string> = {
  vertical: "ורטיקל",
  league: "ליגה",
  team: "קבוצה",
  artist: "אמן",
  genre: "ז'אנר",
  city: "עיר",
  other: "אחר",
};

export function TagsManager({
  initial,
  counts,
}: {
  initial: EventTag[];
  counts: Record<number, number>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tags, setTags] = useState<EventTag[]>(initial);
  const [name, setName] = useState("");
  const [nameEnglish, setNameEnglish] = useState("");
  const [type, setType] = useState<TagType>("other");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EventTag | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    name_english: string;
    is_active: boolean;
    type: TagType;
  }>({ name: "", name_english: "", is_active: true, type: "other" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TagType | "all">("all");
  // Synchronous re-entry guards - the state flags update async, so a
  // double-tap / Enter+click fires the handler twice before the re-render.
  const addingRef = useRef(false);
  const savingEditRef = useRef(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Single source of truth for "what's on screen" - the row list, the
  // select-all checkbox and its handler all read this, never raw `tags`,
  // so a type filter can never let select-all reach tags the admin can't see.
  const visibleTags = tags.filter(
    (t) => typeFilter === "all" || t.type === typeFilter,
  );

  // Switching filters clears the selection rather than trying to reconcile
  // it against the new visible set - simpler than merging, and it's exactly
  // what an admin expects: what's checked is what's on screen right now.
  const selectTypeFilter = (v: TagType | "all") => {
    setTypeFilter(v);
    setSelected(new Set());
  };

  const refresh = async () => setTags(await listTags());

  const toggleSelected = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const bulkRemove = async () => {
    if (!selected.size || bulkDeleting) return;
    const links = [...selected].reduce((sum, id) => sum + (counts[id] ?? 0), 0);
    if (
      !(await confirm({
        title: `Delete ${selected.size} tag(s)?`,
        description: links
          ? `They are assigned to ${links} event link(s) - those links will be removed.`
          : undefined,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setBulkDeleting(true);
    try {
      await bulkSoftDeleteTags([...selected]);
      setSelected(new Set());
      await refresh();
      toast({ title: `Deleted ${selected.size} tag(s)` });
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

  const add = async () => {
    if (!name.trim() || addingRef.current) return;
    // Feed labels are slug-keyed - force a real latin English name up front.
    if (!/[a-z]/i.test(nameEnglish)) {
      toast({
        variant: "destructive",
        title: "English name required",
        description: "It becomes the feed slug (e.g. premier-league).",
      });
      return;
    }
    addingRef.current = true;
    setAdding(true);
    try {
      await createTag({ name, name_english: nameEnglish.trim(), type });
      setName("");
      setNameEnglish("");
      setType("other");
      await refresh();
      toast({ title: "Added" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const openEdit = (t: EventTag) => {
    setEditing(t);
    setEditForm({
      name: t.name,
      name_english: t.name_english ?? "",
      is_active: t.is_active,
      type: t.type,
    });
  };

  const saveEdit = async () => {
    if (!editing || savingEditRef.current) return;
    if (!editForm.name.trim()) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    savingEditRef.current = true;
    setSavingEdit(true);
    try {
      await updateTag(editing.id, {
        name: editForm.name,
        name_english: editForm.name_english || null,
        is_active: editForm.is_active,
        type: editForm.type,
      });
      setEditing(null);
      await refresh();
      toast({ title: "Saved" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const remove = async (t: EventTag) => {
    const n = counts[t.id] ?? 0;
    if (
      !(await confirm({
        title: `Delete "${t.name}"?`,
        description: n
          ? `It is assigned to ${n} event(s) - those links will be removed.`
          : undefined,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await softDeleteTag(t.id);
      await refresh();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    }
  };

  return (
    <div className="space-y-3 max-w-xl">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New tag name (Hebrew)"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Input
          value={nameEnglish}
          onChange={(e) => setNameEnglish(e.target.value)}
          placeholder="English name (→ feed slug)"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Select value={type} onValueChange={(v) => setType(v as TagType)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAG_TYPES.map((tt) => (
              <SelectItem key={tt} value={tt}>
                {TYPE_LABELS[tt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={add} disabled={adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => selectTypeFilter("all")}
          className={`rounded-full border px-2 py-0.5 text-xs ${
            typeFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          הכל
        </button>
        {TAG_TYPES.map((tt) => (
          <button
            key={tt}
            type="button"
            onClick={() => selectTypeFilter(tt)}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              typeFilter === tt ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {TYPE_LABELS[tt]}
          </button>
        ))}
      </div>
      {visibleTags.length > 0 && (
        <div className="flex items-center gap-3">
          <Checkbox
            checked={selected.size > 0 && selected.size === visibleTags.length}
            onCheckedChange={(v) =>
              setSelected(v ? new Set(visibleTags.map((t) => t.id)) : new Set())
            }
            aria-label="Select all tags"
          />
          <span className="text-sm text-muted-foreground">Select all</span>
          {selected.size > 0 && (
            <Button size="sm" variant="destructive" onClick={bulkRemove} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting..." : `Delete selected (${selected.size})`}
            </Button>
          )}
        </div>
      )}
      <div className="rounded-md border">
        {visibleTags.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            {tags.length === 0 ? "No tags yet." : "No tags match this filter."}
          </div>
        )}
        {visibleTags.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1 px-2 border-b">
            <Checkbox
              checked={selected.has(t.id)}
              onCheckedChange={(v) => toggleSelected(t.id, v === true)}
              aria-label={`Select ${t.name}`}
            />
            <span className="flex-1">
              {t.name}
              {" "}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{TYPE_LABELS[t.type]}</span>
              {t.name_english ? (
                <span className="text-muted-foreground"> · {t.name_english}</span>
              ) : null}
              <span className="text-xs text-muted-foreground"> ({counts[t.id] ?? 0} events)</span>
              {!t.is_active && (
                <span className="text-xs text-destructive"> · inactive</span>
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove(t)}>
              Delete
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Name (English - used for the URL slug)</Label>
              <Input
                value={editForm.name_english}
                onChange={(e) => setEditForm((f) => ({ ...f, name_english: e.target.value }))}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm((f) => ({ ...f, type: v as TagType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAG_TYPES.map((tt) => (
                    <SelectItem key={tt} value={tt}>
                      {TYPE_LABELS[tt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={editForm.is_active}
                onCheckedChange={(v) => setEditForm((f) => ({ ...f, is_active: v }))}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
