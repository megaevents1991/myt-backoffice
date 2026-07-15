"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { listTags, createTag, softDeleteTag } from "@/lib/actions/event-taxonomy-actions";
import type { EventTag } from "@/types/taxonomy.types";

export function TagsManager({ initial }: { initial: EventTag[] }) {
  const { toast } = useToast();
  const [tags, setTags] = useState<EventTag[]>(initial);
  const [name, setName] = useState("");

  const refresh = async () => setTags(await listTags());

  const add = async () => {
    if (!name.trim()) return;
    try {
      await createTag({ name });
      setName("");
      await refresh();
      toast({ title: "Added" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
      });
    }
  };

  const remove = async (t: EventTag) => {
    if (!confirm(`Delete "${t.name}"?`)) return;
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
    <div className="space-y-3 max-w-md">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New tag name"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button onClick={add}>Add</Button>
      </div>
      <div className="rounded-md border">
        {tags.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No tags yet.</div>
        )}
        {tags.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-1 px-2 border-b">
            <span className="flex-1">{t.name}</span>
            <Button size="sm" variant="ghost" onClick={() => remove(t)}>
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
