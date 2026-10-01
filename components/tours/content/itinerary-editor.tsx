"use client";

import { useState, useTransition } from "react";
import { ChevronDown, CopyPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";

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
import { cn } from "@/lib/utils";
import { createTourItineraryVariant, deleteTourItineraryVariant } from "@/lib/actions/tours-content-actions";
import { Field, ImageUrlField, RowControls, Section } from "@/components/tours/content/fields";
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
        title: `להסיר את יום ${day.n}?`,
        description: "היום יוסר מהמסלול. השינוי נשמר רק בלחיצה על שמירה.",
        confirmLabel: "הסרה",
        cancelLabel: "ביטול",
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
      title: `למחוק את הגרסה "${active.label || active.key}"?`,
      description: "כל ימי המסלול של הגרסה הזו יימחקו. את המחיקה אי אפשר לבטל.",
      confirmLabel: "מחיקת הגרסה",
      cancelLabel: "ביטול",
      destructive: true,
    });
    if (!ok) return;
    const { id, key } = active;
    startTransition(async () => {
      const result = await deleteTourItineraryVariant(packageId, id);
      if (!result.success) {
        toast.error(result.error, { duration: 7000 });
        return;
      }
      toast.success("הגרסה נמחקה");
      setActiveKey("main");
      setOpenDay(null);
      onVariantsChanged(result.data, { deleted: key });
    });
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <Section
        title="גרסאות המסלול"
        description="לכל עמוד יש מסלול ראשי. כשהטיול נמכר גם בכיוון ההפוך, פותחים גרסה נוספת כהעתק ועורכים בה את הימים. כל יציאה מציגה באתר את הגרסה שעיר הנחיתה והחזרה שלה תואמות למסלול היציאה."
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
              <span className="text-xs text-muted-foreground">{variant.days.length} ימים</span>
              {dirtyKeys.includes(variant.key) && (
                <span className="h-2 w-2 rounded-full bg-amber-500" title="יש שינויים שלא נשמרו" />
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
                ? "שמרו את השינויים במסלול לפני פתיחת גרסה חדשה - הגרסה מועתקת ממה ששמור"
                : copyable.length === 0
                  ? "שמרו קודם את המסלול הראשי"
                  : undefined
            }
            onClick={() => setDialogOpen(true)}
          >
            <CopyPlus />
            גרסה חדשה
          </Button>
        </div>
      </Section>

      <Section>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="שם הגרסה" className="md:col-span-2">
            <Input value={active.label} onChange={(event) => patchActive({ label: event.target.value })} />
          </Field>
          <Field label="עיר נחיתה" hint="קוד עיר, למשל LON">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={active.arrivalCity}
              onChange={(event) => patchActive({ arrivalCity: event.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="עיר חזרה" hint="קוד עיר, למשל PAR">
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
              ? "לעמוד עוד אין מסלול שמור. הוא ייווצר בשמירה."
              : active.departures > 0
                ? `יציאות שמצביעות על הגרסה הזו: ${active.departures}.`
                : active.key === "main"
                  ? "המסלול הראשי משמש כל יציאה שלא נבחרה לה גרסה אחרת."
                  : "אף יציאה לא מצביעה כרגע על הגרסה הזו."}
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
              מחיקת הגרסה
            </Button>
          )}
        </div>
      </Section>

      <div className="space-y-2">
        {active.days.length === 0 && (
          <p className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            אין עדיין ימים במסלול הזה. הוסיפו את היום הראשון.
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
                    יום {day.n}
                  </Badge>
                  <span className="min-w-0 truncate font-medium">{day.title || "ללא כותרת"}</span>
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
                  removeLabel="הסרת היום"
                />
              </div>
              {open && (
                <div className="space-y-4 border-t p-4">
                  <div className="grid gap-4 md:grid-cols-6">
                    <Field label="מספר היום">
                      <Input
                        type="number"
                        min={1}
                        dir="ltr"
                        value={Number.isFinite(day.n) ? day.n : ""}
                        onChange={(event) => patchDay(index, { n: Math.max(1, Math.trunc(Number(event.target.value)) || 1) })}
                      />
                    </Field>
                    <Field label="כותרת (המסלול של היום)" className="md:col-span-2">
                      <Input value={day.title} onChange={(event) => patchDay(index, { title: event.target.value })} />
                    </Field>
                    <Field label="כותרת משנה" className="md:col-span-3">
                      <Input
                        value={day.subtitle}
                        onChange={(event) => patchDay(index, { subtitle: event.target.value })}
                      />
                    </Field>
                  </div>
                  <ImageUrlField
                    label="תמונה"
                    value={day.image ?? ""}
                    onChange={(image) => patchDay(index, { image })}
                    siteUrl={siteUrl}
                  />
                  <HtmlField
                    label="תיאור היום"
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
          הוספת יום
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

  const cleanKey = key.trim().toLowerCase();
  const problem = !sourceId
    ? "בחרו מאיזו גרסה להעתיק"
    : !/^[a-z0-9][a-z0-9-]{0,39}$/.test(cleanKey)
      ? "מזהה באנגלית: אותיות קטנות, ספרות ומקף"
      : takenKeys.includes(cleanKey)
        ? "כבר קיימת גרסה עם המזהה הזה"
        : !label.trim()
          ? "תנו שם לגרסה"
          : null;

  const create = () => {
    if (problem) return;
    startTransition(async () => {
      const result = await createTourItineraryVariant(packageId, {
        sourceId,
        key: cleanKey,
        label: label.trim(),
        arrivalCity,
        returnCity,
      });
      if (!result.success) {
        toast.error(result.error, { duration: 7000 });
        return;
      }
      toast.success("הגרסה נוצרה. עכשיו אפשר לערוך את הימים שלה.");
      onCreated(result.data, cleanKey);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader className="pt-4 text-start sm:text-start">
          <DialogTitle>גרסת מסלול חדשה</DialogTitle>
          <DialogDescription>
            הגרסה נפתחת כהעתק של מסלול קיים. אחרי היצירה עורכים בה את הימים לפי הכיוון החדש.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="להעתיק מ" className="sm:col-span-2">
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
              <SelectTrigger dir="rtl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {sources.map((v) => (
                  <SelectItem key={v.key} value={v.id ?? v.key}>
                    {v.label || v.key} ({v.days.length} ימים)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="שם הגרסה">
            <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="מסלול הפוך" />
          </Field>
          <Field label="מזהה" hint="באנגלית, למשל reverse">
            <Input
              dir="ltr"
              className="font-mono"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="reverse"
            />
          </Field>
          <Field label="עיר נחיתה" hint="קוד עיר, למשל PAR">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={arrivalCity}
              onChange={(event) => setArrivalCity(event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="עיר חזרה" hint="קוד עיר, למשל LON">
            <Input
              dir="ltr"
              maxLength={3}
              className="font-mono uppercase"
              value={returnCity}
              onChange={(event) => setReturnCity(event.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" onClick={create} disabled={!!problem || isPending} title={problem ?? undefined}>
            {isPending && <Loader2 className="animate-spin" />}
            יצירת הגרסה
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
