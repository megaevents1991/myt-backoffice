"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CopyPlus, Loader2, Trash2 } from "lucide-react";

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
import { setItineraryDates } from "@/lib/actions/tours-season-actions";
import { Field, Section } from "@/components/tours/ui";
import { DatesChecklist } from "@/components/tours/content/dates-checklist";
import { ItineraryDaysEditor } from "@/components/tours/content/itinerary-days-editor";
import type { ItineraryVariant, PackageEditorData } from "@/components/tours/content/shared";
import type { BoardRow } from "@/components/tours/departures/types";

interface ItineraryEditorProps {
  packageId: string;
  variants: ItineraryVariant[];
  /** Keys of the variants that differ from what is saved. */
  dirtyKeys: string[];
  siteUrl: string | null;
  onChange: (variants: ItineraryVariant[]) => void;
  /** A variant was created or deleted on the server: the page's fresh state. */
  onVariantsChanged: (data: PackageEditorData, change: { created?: string; deleted?: string }) => void;
  /** The tour's dates - what a variant is assigned to; null while they load. */
  rows: BoardRow[] | null;
  /** Dates were moved onto or off a variant. */
  onDatesChanged: () => void;
}

/**
 * The daily itinerary of a trip page, in every direction it is sold
 * (functional spec 4.8). The `main` variant always exists; a new variant opens
 * as a copy of an existing one and is then edited day by day. A variant is
 * given to specific dates ("Dates on this variant", Alon 04.10.2026) or to a
 * whole season (Seasons tab); a date given none runs its season's variant,
 * else the main itinerary.
 */
export function ItineraryEditor({
  packageId,
  variants,
  dirtyKeys,
  siteUrl,
  onChange,
  onVariantsChanged,
  rows,
  onDatesChanged,
}: ItineraryEditorProps) {
  const confirm = useConfirm();
  const run = useActionToast();
  const [activeKey, setActiveKey] = useState(variants[0]?.key ?? "main");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const active = variants.find((v) => v.key === activeKey) ?? variants[0];
  const anyDirty = dirtyKeys.length > 0;
  const copyable = variants.filter((v) => v.id !== null);

  const patchActive = (change: Partial<ItineraryVariant>) =>
    onChange(variants.map((v) => (v.key === active.key ? { ...v, ...change } : v)));
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
      onVariantsChanged(result.data, { deleted: key });
    });
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <Section
        title="Itinerary variants"
        description="Every page has a main itinerary. When some dates run another route - the opposite direction, a season with a different plan - open another variant as a copy, edit its days and tick the dates that run it. A date that is given no variant shows its season's variant, else the main itinerary."
      >
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <button
              key={variant.key}
              type="button"
              onClick={() => {
                setActiveKey(variant.key);
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

      {active.key !== "main" && active.id && (
        <VariantDates
          key={active.id}
          packageId={packageId}
          itineraryId={active.id}
          label={active.label || active.key}
          rows={rows}
          labelOf={(id) => {
            const v = variants.find((x) => x.id === id);
            return v ? v.label || v.key : null;
          }}
          onChanged={onDatesChanged}
        />
      )}

      <ItineraryDaysEditor
        key={active.key}
        days={active.days}
        onChange={(days) => patchActive({ days })}
        siteUrl={siteUrl}
      />

      {dialogOpen && (
        <NewVariantDialog
          packageId={packageId}
          sources={copyable}
          takenKeys={variants.map((v) => v.key)}
          onClose={() => setDialogOpen(false)}
          onCreated={(data, key) => {
            setDialogOpen(false);
            setActiveKey(key);
            onVariantsChanged(data, { created: key });
          }}
        />
      )}
    </div>
  );
}

/** Which dates of the tour run this variant: tick, save. An unticked date goes back to the default. */
function VariantDates({
  packageId,
  itineraryId,
  label,
  rows,
  labelOf,
  onChanged,
}: {
  packageId: string;
  itineraryId: string;
  label: string;
  rows: BoardRow[] | null;
  /** The name of another variant a date runs now. */
  labelOf: (itineraryId: string) => string | null;
  onChanged: () => void;
}) {
  const run = useActionToast();
  const live = useMemo(() => (rows ?? []).filter((r) => !r.is_deleted), [rows]);
  const savedKey = useMemo(
    () =>
      live
        .filter((r) => r.itinerary_id === itineraryId)
        .map((r) => r.id)
        .sort()
        .join(","),
    [live, itineraryId],
  );
  const [picked, setPicked] = useState<Set<string>>(new Set(savedKey ? savedKey.split(",") : []));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPicked(new Set(savedKey ? savedKey.split(",") : []));
  }, [savedKey]);
  const dirty = [...picked].sort().join(",") !== savedKey;

  const save = async () => {
    setBusy(true);
    const res = await run(
      () => setItineraryDates(packageId, itineraryId, [...picked]),
      (a) => `${a.data.assigned} date(s) now run "${label}", ${a.data.released} went back to the default`,
    );
    setBusy(false);
    if (res.success) onChanged();
  };

  return (
    <Section
      title="Dates on this variant"
      description="Tick the dates that run this variant. A date left unticked shows its season's variant, else the main itinerary."
    >
      {rows === null ? (
        <p className="text-sm text-muted-foreground">Loading the dates…</p>
      ) : (
        <>
          <DatesChecklist
            rows={live}
            value={picked}
            onChange={setPicked}
            disabled={busy}
            noteOf={(row) => {
              if (!row.itinerary_id || row.itinerary_id === itineraryId) return row.season ? <span dir="auto">{row.season}</span> : null;
              return <span dir="auto">now: {labelOf(row.itinerary_id) ?? "another variant"}</span>;
            }}
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={!dirty || busy} onClick={() => void save()}>
              {busy && <Loader2 className="animate-spin" />}
              Save the dates of this variant
            </Button>
            {dirty && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPicked(new Set(savedKey ? savedKey.split(",") : []))}>
                Discard
              </Button>
            )}
          </div>
        </>
      )}
    </Section>
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
          <Field label="Copy from" htmlFor="variant-source" className="sm:col-span-2">
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
              <SelectTrigger id="variant-source">
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
