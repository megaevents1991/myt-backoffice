"use client";

import { useState } from "react";
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
import { createCategory, createTag } from "@/lib/actions/event-taxonomy-actions";

export type TaxonomyOption = { id: number; label: string };

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = options.filter((o) => value.includes(o.id));
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const q = query.trim();
  const exists = options.some((o) => o.label.toLowerCase() === q.toLowerCase());

  const handleCreate = async () => {
    if (!q || creating) return;
    setCreating(true);
    try {
      const created =
        kind === "category" ? await createCategory({ name: q }) : await createTag({ name: q });
      const opt: TaxonomyOption = { id: created.id, label: created.name };
      onOptionCreated?.(opt);
      onChange([...value, created.id]);
      setQuery("");
    } finally {
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
                {options.map((o) => (
                  <CommandItem key={o.id} value={o.label} onSelect={() => toggle(o.id)}>
                    <Check
                      className={`mr-2 h-4 w-4 ${value.includes(o.id) ? "opacity-100" : "opacity-0"}`}
                    />
                    {o.label}
                  </CommandItem>
                ))}
                {q && !exists && (
                  <CommandItem value={`__create_${q}`} onSelect={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" /> Create “{q}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
