"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { learnFromEvent, learnPreview } from "@/lib/actions/uploader-actions";
import type { LearnPreview } from "@/lib/uploader/action-types";
import { actionErrorText } from "../copy";
import {
  BTN_CANCEL,
  BTN_LEARN_CONFIRM,
  CLASSIFY_DONE,
  LEARN_DESCRIPTION,
  LEARN_DESCRIPTIONS,
  LEARN_DROPPED,
  LEARN_FAILED,
  LEARN_OPEN_FAILED,
  LEARN_READING,
  LEARN_SECTIONS,
  LEARN_SIBLINGS,
  LEARN_TITLE,
  LEARN_ZONES,
  NETWORK_TEXT,
  PARTIAL_LEARN_LINE,
} from "./board-words";
import { rtl } from "./use-run-board";

// "למד מהאירוע הזה" (spec 5.5): a person arranged one event of the hall in the editor (zones, Hebrew
// descriptions, a dropped section, sections excluded on its map); this small confirm lists what will be learned from it
// (`learnPreview`) - "7 זונים (3 חדשים) · 1 קטגוריה נפסלה (Away Fans Section) · 5 תיאורים · 4 גושים מוחרגים" - and "החל"
// (`learnFromEvent`) updates the venue template from it and rewrites the hall's other shows of the run.
// No AI call, nothing asked; the source event itself is not rewritten. Mounted once by the board.

type Loaded = Extract<LearnPreview, { ok: true }>;
type Phase = { kind: "loading" } | { kind: "ready"; data: Loaded };

export function LearnConfirm({
  itemId,
  open,
  onClose,
  onDone,
}: {
  /** The item whose event was arranged by hand; null while closed. */
  itemId: string | null;
  open: boolean;
  onClose: () => void;
  /** After a saved "החל" (its toast already shown): the board closes the confirm and reads the run again. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const target = open ? itemId : null;
  // A (re)opening starts on the wait in the same render - never a frame of the previous event's summary.
  // Closing keeps the summary, so the confirm closes with what it showed.
  const [requested, setRequested] = useState<string | null>(null);
  if (target !== requested) {
    setRequested(target);
    if (target !== null) setPhase({ kind: "loading" });
  }

  useEffect(() => {
    if (target === null) return;
    const id = ++seq.current;
    const fail = (description: ReactNode) => {
      toast({ variant: "destructive", title: LEARN_OPEN_FAILED, description: rtl(description) });
      closeRef.current();
    };
    learnPreview(target)
      .then((r) => {
        if (id !== seq.current) return;
        if (!r.ok) return fail(actionErrorText(r.kind));
        setPhase({ kind: "ready", data: r });
      })
      .catch(() => {
        if (id === seq.current) fail(NETWORK_TEXT);
      });
    return () => {
      seq.current += 1;
    };
  }, [target, toast]);

  const data = phase.kind === "ready" ? phase.data : null;

  async function apply() {
    if (!data || target === null || saving) return;
    setSaving(true);
    try {
      const r = await learnFromEvent(target);
      if (!r.ok) {
        toast({
          variant: "destructive",
          title: LEARN_FAILED,
          description: rtl(
            <>
              <p>{actionErrorText(r.kind)}</p>
              {r.message && (
                <p dir="ltr" className="mt-1 text-xs opacity-80">
                  {r.message}
                </p>
              )}
            </>,
          ),
        });
        return;
      }
      toast({ title: CLASSIFY_DONE(r, false), description: r.reached < r.total ? rtl(PARTIAL_LEARN_LINE(r.total - r.reached)) : undefined });
      await onDone();
    } catch {
      toast({ variant: "destructive", title: LEARN_FAILED, description: rtl(NETWORK_TEXT) });
    } finally {
      setSaving(false);
    }
  }

  const learned = data?.learned ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-md [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{LEARN_TITLE}</DialogTitle>
          <DialogDescription>{LEARN_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        {phase.kind === "loading" || !learned || !data ? (
          <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {LEARN_READING}
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed">
            <GraduationCap aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              {LEARN_ZONES(learned.zones, learned.newZones)}
              {" · "}
              {LEARN_DROPPED(learned.dropped.length)}
              {learned.dropped.length > 0 && (
                <>
                  {" ("}
                  <bdi dir="ltr">{learned.dropped.join(", ")}</bdi>
                  {")"}
                </>
              )}
              {" · "}
              {LEARN_DESCRIPTIONS(learned.descriptions)}
              {" · "}
              {LEARN_SECTIONS(learned.sections)}
              {" · "}
              <span className="font-medium">{LEARN_SIBLINGS(data.siblings)}</span>
            </span>
          </p>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {BTN_CANCEL}
          </Button>
          <Button type="button" disabled={!data || saving} onClick={() => void apply()}>
            {saving && <Loader2 aria-hidden className="animate-spin" />}
            {BTN_LEARN_CONFIRM}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
