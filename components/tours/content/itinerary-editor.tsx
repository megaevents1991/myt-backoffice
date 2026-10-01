"use client";

import { useState, useTransition } from "react";
import { ChevronDown, CopyPlus, Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-provider";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";
import { createTourItineraryVariant, deleteTourItineraryVariant } from "@/lib/actions/tours-content-actions";
import { Field, Section } from "@/components/tours/ui";
import { ImageUrlField, RowControls } from "@/components/tours/content/fields";
import { HtmlField } from "@/components/tours/content/html-field";
import type { ItineraryDay, ItineraryVariant, PackageEditorData } from "@/components/tours/content/shared";

const isSequential = (days: ItineraryDay[]) => days.every((day, index) => day.n === index + 1);
/** Days numbered 1..N stay numbered 1..N after a move or a removal; hand-set numbers are kept. */
const renumber = (before: ItineraryDay[], after: ItineraryDay[]) =>
  isSequential(before) ? after.map((day, index) => ({ ...day, n: index + 1 })) : after;

interface ItineraryEditorProps {
  packageId: string;
  variants: ItineraryVariant[];
  /** Keys of the variants that differ from what is saved. */
  dirtyKeys: string[];
  siteUrl: string | null;
  onChange: (variants: ItineraryVariant[]) => void;
  /** A variant was created or deleted on the server: the page's fresh state. */
  onVariantsChanged: (data: PackageEditorData, change: { created?: string; deleted?: string }) => void;
}

/**
 * The daily itinerary of a trip page, in every direction it is sold
 * (functional spec 4.8). The `main` variant always exists; a new variant opens
 * as a copy of an existing one and is then edited day by day. A departure
 * points at the variant whose landing and return city match its route.
 */
export function ItineraryEditor({
  packageId,
  variants,
  dirtyKeys,
  siteUrl,
  onChange,
  onVariantsChanged,
}: ItineraryEditorProps) {
  const confirm = useConfirm();
  const run = useActionToast();
  const [activeKey, setActiveKey] = useState(variants[0]?.key ?? "main");
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const active = variants.find((v) => v.key === activeKey) ?? variants[0];
  const anyDirty = dirtyKeys.length > 0;
  const copyable = variants.filter((v) => v.id !== null);

  const patchActive = (change: Partial<ItineraryVariant>) =>
    onChange(variants.map((v) => (v.key === active.key ? { ...v, ...change } : v)));
  const patchDay = (index: number, change: Partial<ItineraryDay>) =>
    patchActive({ days: active.days.map((day, i) => (i === index ? { ...day, ...change } : day)) });

  const moveDay = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= active.days.length) return;
    const next = [...active.days];
    // the content moves, the day numbers stay where they were
    const [a, b] = [next[index], next[target]];
    next[index] = { ...b, n: a.n };
    next[target] = { ...a, n: b.n };
    patchActive({ days: next });
    setOpenDay((open) => (open === index ? target : open === target ? index : open));
  };

  const removeDay = async (index: number) => {
    const day = active.days[index];
    const hasText = day.title || day.subtitle || day.html;
    if (
      hasText &&
      !(await confirm({
        title: `Remove Day ${day.n}?`,
        description: "The day will be removed from the itinerary. The change is kept only when you save.",
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
        destructive: true,
      }))
    )
      return;
    patchActive({ days: renumber(active.days, active.days.filter((_, i) => i !== index)) });
    setOpenDay(null);
  };

  const addDay = () => {
    const n = active.days.reduce((max, day) => Math.max(max, day.n), 0) + 1;
    patchActive({ days: [...active.days, { n, title: "", subtitle: "", html: "" }] });
    setOpenDay(active.days.length);
  };

  const removeVariant = async () => {
    if (!active.id) return;
    const ok = await confirm({
      title: `Delete the variant "${active.label || active.key}"?`,
      description: "All itinerary days of this variant will be deleted. This cannot be undone.",
      confirmLabel: "Delete Variant",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    const { id, key } = active;
    startTransition(async () => {
      const result = await run(() => deleteTourItineraryVariant(packageId, id), "Variant deleted");
      if (!result.success) return;
      setActiveKey("main");
      setOpenDay(null);
      onVariantsChanged(result.data, { deleted: key });
    });
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <Section
        title="Itinerary variants"
        description="Every page has a main itinerary. When the tour is also sold in the opposite direction, open another variant as a copy and edit its days. On the site, each departure shows the variant whose arrival and return cities match the departure's route."
      >
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <button
              key={variant.key}
              type="button"
              onClick={() => {
                setActiveKey(variant.key);
                setOpenDay(null);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                variant.key === active.key ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/60",
              )}
            >
              {variant.label || variant.key}
              <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
                {variant.key}
              </span>
              <span className="text-xs text-muted-foreground">{variant.days.length} days</span>
              {dirtyKeys.includes(variant.key) && (
                <span className="h-2 w-2 rounded-full bg-amber-500" title="Unsaved changes" />
              )}
            </button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyDirty || copyable.length === 0}
            title={
              anyDirty
                ? "Save the itinerary changes before opening a new variant - the variant is copied from what is saved"
                : copyable.length === 0
                  ? "Save the main itinerary first"
                  : undefined
            }
            onClick={() => setDialogOpen(true)}
          >
            <CopyPlus />
            New Variant
          </Button>
        </div>
      </Section>

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Variant name" className="md:col-span-2">
            <Input dir="auto" value={active.label} onChange={(event) => patchActive({ label: event.target.value })} />
          </Field>
          <Field label="Arrival city" hint="City code, e.g. LON">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={active.arrivalCity}
              onChange={(event) => patchActive({ arrivalCity: event.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Return city" hint="City code, e.g. PAR">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={active.returnCity}
              onChange={(event) => patchActive({ returnCity: event.target.value.toUpperCase() })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {active.id === null
              ? "This page has no saved itinerary yet. It is created when you save."
              : active.departures > 0
                ? `Departures using this variant: ${active.departures}.`
                : active.key === "main"
                  ? "The main itinerary is used by every departure that has no other variant."
                  : "No departure uses this variant right now."}
          </span>
          {active.key !== "main" && active.id && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={isPending}
              onClick={() => void removeVariant()}
            >
              {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete Variant
            </Button>
          )}
        </div>
      </Section>

      <div className="space-y-2">
        {active.days.length === 0 && (
          <p className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            This itinerary has no days yet. Add the first day.
          </p>
        )}
        {active.days.map((day, index) => {
          const open = openDay === index;
          return (
            <div key={index} className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 p-2 ps-3">
                <button
                  type="button"
                  onClick={() => setOpenDay(open ? null : index)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-3 text-start"
                >
                  <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
                  <Badge variant="secondary" className="shrink-0">
                    Day {day.n}
                  </Badge>
                  <span className="min-w-0 truncate font-medium">{day.title || "Untitled"}</span>
                  {day.subtitle && (
                    <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:inline">
                      {day.subtitle}
                    </span>
                  )}
                </button>
                <RowControls
                  index={index}
                  count={active.days.length}
                  onMove={(delta) => moveDay(index, delta)}
                  onRemove={() => void removeDay(index)}
                  removeLabel="Remove Day"
                />
              </div>
              {open && (
                <div className="space-y-4 border-t p-4">
                  <div className="grid gap-4 md:grid-cols-6">
                    <Field label="Day number">
                      <Input
                        type="number"
                        min={1}
                        dir="ltr"
                        value={Number.isFinite(day.n) ? day.n : ""}
                        onChange={(event) => patchDay(index, { n: Math.max(1, Math.trunc(Number(event.target.value)) || 1) })}
                      />
                    </Field>
                    <Field label="Title (the day's route)" className="md:col-span-2">
                      <Input dir="auto" value={day.title} onChange={(event) => patchDay(index, { title: event.target.value })} />
                    </Field>
                    <Field label="Subtitle" className="md:col-span-3">
                      <Input
                        dir="auto"
                        value={day.subtitle}
                        onChange={(event) => patchDay(index, { subtitle: event.target.value })}
                      />
                    </Field>
                  </div>
                  <ImageUrlField
                    label="Image"
                    value={day.image ?? ""}
                    onChange={(image) => patchDay(index, { image })}
                    siteUrl={siteUrl}
                  />
                  <HtmlField
                    label="Day description"
                    value={day.html}
                    onChange={(html) => patchDay(index, { html })}
                    siteUrl={siteUrl}
                    rows={10}
                  />
                </div>
              )}
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={addDay}>
          <Plus />
          Add Day
        </Button>
      </div>

      {dialogOpen && (
        <NewVariantDialog
          packageId={packageId}
          sources={copyable}
          takenKeys={variants.map((v) => v.key)}
          onClose={() => setDialogOpen(false)}
          onCreated={(data, key) => {
            setDialogOpen(false);
            setActiveKey(key);
            setOpenDay(null);
            onVariantsChanged(data, { created: key });
          }}
        />
      )}
    </div>
  );
}

function NewVariantDialog({
  packageId,
  sources,
  takenKeys,
  onClose,
  onCreated,
}: {
  packageId: string;
  sources: ItineraryVariant[];
  takenKeys: string[];
  onClose: () => void;
  onCreated: (data: PackageEditorData, key: string) => void;
}) {
  const first = sources.find((v) => v.key === "main") ?? sources[0];
  const [sourceId, setSourceId] = useState(first?.id ?? "");
  const [key, setKey] = useState(takenKeys.includes("reverse") ? "" : "reverse");
  const [label, setLabel] = useState(takenKeys.includes("reverse") ? "" : "מסלול הפוך");
  // the reversed route lands where the source returns from
  const [arrivalCity, setArrivalCity] = useState(first?.returnCity ?? "");
  const [returnCity, setReturnCity] = useState(first?.arrivalCity ?? "");
  const [isPending, startTransition] = useTransition();
  const run = useActionToast();

  const cleanKey = key.trim().toLowerCase();
  const problem = !sourceId
    ? "Choose a variant to copy from"
    : !/^[a-z0-9][a-z0-9-]{0,39}$/.test(cleanKey)
      ? "ID in English: lowercase letters, digits and hyphens"
      : takenKeys.includes(cleanKey)
        ? "A variant with this ID already exists"
        : !label.trim()
          ? "Give the variant a name"
          : null;

  const create = () => {
    if (problem) return;
    startTransition(async () => {
      const result = await run(
        () =>
          createTourItineraryVariant(packageId, {
            sourceId,
            key: cleanKey,
            label: label.trim(),
            arrivalCity,
            returnCity,
          }),
        "Variant created. You can now edit its days.",
      );
      if (!result.success) return;
      onCreated(result.data, cleanKey);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pt-4 text-start sm:text-start">
          <DialogTitle>New Itinerary Variant</DialogTitle>
          <DialogDescription>
            The variant opens as a copy of an existing itinerary. After creating it, edit its days for the new direction.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Copy from" className="sm:col-span-2">
            <Select
              value={sourceId}
              onValueChange={(id) => {
                setSourceId(id);
                const source = sources.find((v) => v.id === id);
                if (source) {
                  setArrivalCity(source.returnCity);
                  setReturnCity(source.arrivalCity);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((v) => (
                  <SelectItem key={v.key} value={v.id ?? v.key}>
                    {v.label || v.key} ({v.days.length} days)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Variant name">
            <Input dir="auto" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="מסלול הפוך" />
          </Field>
          <Field label="ID" hint="In English, e.g. reverse">
            <Input
              dir="ltr"
              className="font-mono"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="reverse"
            />
          </Field>
          <Field label="Arrival city" hint="City code, e.g. PAR">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={arrivalCity}
              onChange={(event) => setArrivalCity(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Return city" hint="City code, e.g. LON">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={returnCity}
              onChange={(event) => setReturnCity(event.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={create} disabled={!!problem || isPending} title={problem ?? undefined}>
            {isPending && <Loader2 className="animate-spin" />}
            Create Variant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
