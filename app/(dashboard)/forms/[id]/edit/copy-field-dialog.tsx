"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchInput } from "@/components/search-input";
import { useToast } from "@/hooks/use-toast";
import { copyFieldToForms } from "@/lib/actions/form-actions";
import { matchesSearch } from "@/lib/search";

/** Another form a question can be copied into. */
export type CopyTarget = { id: number; title: string; series: string | null };

/**
 * "Add this question to other series too": tick forms, the SAVED question is appended at
 * the end of each. Each form stays its own - nothing links the copies afterwards.
 */
export function CopyFieldDialog({
  open,
  onOpenChange,
  fieldId,
  fieldLabel,
  targets,
  formDirty,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldId: number;
  fieldLabel: string;
  targets: CopyTarget[];
  /** The builder has unsaved edits - the copy takes the SAVED question. */
  formDirty: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  // Series forms first (by code), then the rest by title.
  const ordered = useMemo(
    () =>
      [...targets].sort(
        (a, b) =>
          Number(Boolean(b.series)) - Number(Boolean(a.series)) ||
          (a.series ?? "").localeCompare(b.series ?? "") ||
          a.title.localeCompare(b.title, "he"),
      ),
    [targets],
  );
  const shown = ordered.filter((t) => matchesSearch(query, t.series, t.title, t.id));
  const seriesTargets = ordered.filter((t) => t.series);

  function toggle(id: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleCopy() {
    startTransition(async () => {
      try {
        const { copied } = await copyFieldToForms(fieldId, [...picked]);
        toast({
          title: `Copied to ${copied.length} form${copied.length === 1 ? "" : "s"}`,
          description: "Added at the end of each - open a form to place it.",
        });
        setPicked(new Set());
        onOpenChange(false);
      } catch (error) {
        toast({
          title: "Could not copy the question",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy to other forms</DialogTitle>
          <DialogDescription>
            “{fieldLabel || "Untitled question"}” is added at the end of every form you tick.
            Each copy is then edited and placed on its own form.
          </DialogDescription>
        </DialogHeader>

        {formDirty && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            This form has unsaved changes - the copy takes the question as last saved.
          </p>
        )}

        <div className="flex items-center gap-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search forms…"
            wrapperClassName="flex-1 sm:w-auto"
          />
          {seriesTargets.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPicked(new Set(seriesTargets.map((t) => t.id)))}
            >
              All series ({seriesTargets.length})
            </Button>
          )}
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border p-2">
          {shown.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No other forms.</p>
          )}
          {shown.map((target) => (
            <label
              key={target.id}
              className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={picked.has(target.id)}
                onCheckedChange={(on) => toggle(target.id, on === true)}
              />
              {target.series && (
                <span className="w-14 shrink-0 font-mono text-xs font-semibold">{target.series}</span>
              )}
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {target.title}
              </span>
              <span className="text-xs text-muted-foreground">#{target.id}</span>
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCopy} disabled={pending || picked.size === 0}>
            {pending ? "Copying…" : `Copy to ${picked.size} form${picked.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
