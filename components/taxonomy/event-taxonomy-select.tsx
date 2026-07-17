"use client";

import { useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { createCategory, createTag } from "@/lib/actions/event-taxonomy-actions";

export type TaxonomyOption = { id: number; label: string };

// Category labels are full paths ("כדורגל › ליגה אנגלית") — compare the leaf
// segment too, so typing an existing leaf name doesn't offer a duplicate create.
const leafOf = (label: string) => label.split(" › ").pop()?.trim().toLowerCase() ?? "";

export function EventTaxonomySelect({
  kind,
  options,
  value,
  onChange,
  onOptionCreated,
}: {
  kind: "category" | "tag";
  options: TaxonomyOption[];
  value: number[];
  onChange: (ids: number[]) => void;
  onOptionCreated?: (opt: TaxonomyOption) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  // Synchronous re-entry guard — the `creating` STATE updates async, so a
  // double-tap fires handleCreate twice before the re-render (duplicate rows).
  const creatingRef = useRef(false);
  // Parent for an inline-created category (Shopify-style). "" = root.
  const [createParentId, setCreateParentId] = useState("");
  // English name for an inline-created tag — required (it becomes the feed slug).
  const [createEnglish, setCreateEnglish] = useState("");

  const sorted = [...options].sort((a, b) => a.label.localeCompare(b.label));
  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const q = query.trim();
  const exists = options.some(
    (o) => o.label.toLowerCase() === q.toLowerCase() || leafOf(o.label) === q.toLowerCase()
  );

  const handleCreate = async () => {
    if (!q || creatingRef.current) return;
    if (kind === "tag" && !/[a-z]/i.test(createEnglish)) {
      toast({
        variant: "destructive",
        title: "English name required",
        description: "Fill the English name below — it becomes the feed slug.",
      });
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    try {
      const parentId = createParentId ? Number(createParentId) : null;
      const created =
        kind === "category"
          ? await createCategory({ name: q, parent_id: parentId })
          : await createTag({ name: q, name_english: createEnglish.trim() });
      const parentLabel = parentId
        ? options.find((o) => o.id === parentId)?.label
        : null;
      const opt: TaxonomyOption = {
        id: created.id,
        label: parentLabel ? `${parentLabel} › ${created.name}` : created.name,
      };
      // Idempotent server create can return an existing row — don't double-add.
      if (!options.some((o) => o.id === created.id)) onOptionCreated?.(opt);
      if (!value.includes(created.id)) onChange([...value, created.id]);
      setQuery("");
      setCreateParentId("");
      setCreateEnglish("");
      toast({ title: `${kind === "category" ? "Category" : "Tag"} "${created.name}" added` });
    } catch (e) {
      console.error(`Inline ${kind} create failed:`, e);
      toast({
        variant: "destructive",
        title: `Failed to create ${kind}`,
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {selected.length === 0 && (
          <span className="text-sm text-muted-foreground">None</span>
        )}
        {selected.map((o) => (
          <Badge key={o.id} variant="secondary" className="gap-1">
            {o.label}
            <button type="button" onClick={() => toggle(o.id)} aria-label={`Remove ${o.label}`}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {kind === "category" ? "Select categories" : "Select tags"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
          <Command shouldFilter>
            <CommandInput
              placeholder={`Search ${kind}s...`}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>
                {q ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={handleCreate}
                    disabled={creating}
                  >
                    <Plus className="h-4 w-4" /> Create “{q}”
                  </button>
                ) : (
                  "No results."
                )}
              </CommandEmpty>
              <CommandGroup>
                {sorted.map((o) => (
                  <CommandItem key={o.id} value={o.label} onSelect={() => toggle(o.id)}>
                    <Check
                      className={`mr-2 h-4 w-4 ${value.includes(o.id) ? "opacity-100" : "opacity-0"}`}
                    />
                    {o.label}
                  </CommandItem>
                ))}
                {q && !exists && (
                  <CommandItem value={`__create_${q}`} onSelect={handleCreate} disabled={creating}>
                    <Plus className="mr-2 h-4 w-4" /> Create “{q}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
            {kind === "tag" && q && !exists && (
              <div className="border-t p-2 space-y-1">
                <p className="text-xs text-muted-foreground">
                  English name for “{q}” (required — feed slug)
                </p>
                <input
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  placeholder="e.g. premier-league"
                  value={createEnglish}
                  onChange={(e) => setCreateEnglish(e.target.value)}
                />
              </div>
            )}
            {kind === "category" && q && !exists && (
              <div className="border-t p-2 space-y-1">
                <p className="text-xs text-muted-foreground">Parent for “{q}”</p>
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={createParentId}
                  onChange={(e) => setCreateParentId(e.target.value)}
                >
                  <option value="">— Root —</option>
                  {sorted.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
