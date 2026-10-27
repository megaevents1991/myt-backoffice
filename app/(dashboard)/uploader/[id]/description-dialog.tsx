"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { getDescriptionTemplate, saveDescriptionTemplate } from "@/lib/actions/uploader-actions";
import type { DescriptionTemplateView } from "@/lib/uploader/action-types";
import { DESCRIPTION_TEMPLATE_MAX, fillDescription } from "@/lib/uploader/description";
import { actionErrorText } from "../copy";
import {
  BTN_CANCEL,
  BTN_DESCRIPTION_APPLY,
  BTN_DESCRIPTION_SAVE,
  DESCRIPTION_APPLIED,
  DESCRIPTION_CLEARED,
  DESCRIPTION_HAND_LINE,
  DESCRIPTION_INTRO,
  DESCRIPTION_NO_SAMPLE,
  DESCRIPTION_NOT_READY,
  DESCRIPTION_OPEN_FAILED,
  DESCRIPTION_PLACEHOLDER,
  DESCRIPTION_PREVIEW,
  DESCRIPTION_READING,
  DESCRIPTION_SAVE_FAILED,
  DESCRIPTION_SAVED,
  DESCRIPTION_STILL_ENGLISH,
  DESCRIPTION_TITLE,
  DESCRIPTION_TOKENS_LINE,
  NETWORK_TEXT,
} from "./board-words";
import { rtl } from "./use-run-board";

type View = Extract<DescriptionTemplateView, { ok: true }>;

/**
 * The standing description template of the run's family (Alon 25.10): write it once with `{token}`
 * places, see it filled for one of the run's own shows as you type, save it for every later build, or
 * save and rewrite this run's events now. The rules are pure in lib/uploader/description.ts.
 */
export function DescriptionDialog({
  runId,
  open,
  onClose,
  onDone,
}: {
  runId: string;
  open: boolean;
  onClose: () => void;
  /** After a save (its toast already shown): the board closes the dialog and reads the run again. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState<"save" | "apply" | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    let live = true;
    setView(null);
    getDescriptionTemplate(runId)
      .then((r) => {
        if (!live) return;
        if (!r.ok) {
          toast({ variant: "destructive", title: DESCRIPTION_OPEN_FAILED, description: rtl(actionErrorText(r.kind)) });
          closeRef.current();
          return;
        }
        setView(r);
        setText(r.template ?? "");
      })
      .catch(() => {
        if (!live) return;
        toast({ variant: "destructive", title: DESCRIPTION_OPEN_FAILED, description: rtl(NETWORK_TEXT) });
        closeRef.current();
      });
    return () => {
      live = false;
    };
  }, [open, runId, toast]);

  const preview = useMemo(() => (view?.sample && text.trim() !== "" ? fillDescription(text, view.sample) : null), [view, text]);

  /** A token goes in at the cursor (or replaces the selection), and the cursor lands right after it. */
  function insert(token: string) {
    const el = area.current;
    const piece = `{${token}}`;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${piece}${text.slice(end)}`.slice(0, DESCRIPTION_TEMPLATE_MAX);
    setText(next);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + piece.length, start + piece.length);
    });
  }

  async function save(apply: boolean) {
    if (!view || saving) return;
    setSaving(apply ? "apply" : "save");
    try {
      const r = await saveDescriptionTemplate(runId, text, apply);
      if (!r.ok) {
        toast({ variant: "destructive", title: DESCRIPTION_SAVE_FAILED, description: rtl(r.problem ?? actionErrorText(r.kind)) });
        return;
      }
      const cleared = text.trim() === "";
      toast({ title: cleared ? DESCRIPTION_CLEARED : r.applied ? DESCRIPTION_APPLIED(r.applied) : DESCRIPTION_SAVED });
      await onDone();
    } catch {
      toast({ variant: "destructive", title: DESCRIPTION_SAVE_FAILED, description: rtl(NETWORK_TEXT) });
    } finally {
      setSaving(null);
    }
  }

  const blank = text.trim() === "";
  const unchanged = view !== null && text.trim() === (view.template ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-xl [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{DESCRIPTION_TITLE(view?.family ?? "football")}</DialogTitle>
          <DialogDescription>{DESCRIPTION_INTRO}</DialogDescription>
        </DialogHeader>

        {!view ? (
          <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {DESCRIPTION_READING}
          </p>
        ) : !view.ready ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">{DESCRIPTION_NOT_READY}</p>
        ) : (
          <div className="space-y-3">
            <Textarea
              ref={area}
              dir="rtl"
              rows={4}
              value={text}
              maxLength={DESCRIPTION_TEMPLATE_MAX}
              placeholder={DESCRIPTION_PLACEHOLDER}
              onChange={(e) => setText(e.target.value)}
              disabled={saving !== null}
            />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{DESCRIPTION_TOKENS_LINE}</p>
              <div className="flex flex-wrap gap-1.5">
                {view.tokens.map((t) => (
                  <Button key={t.token} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" title={t.hint} disabled={saving !== null} onClick={() => insert(t.token)}>
                    {`{${t.token}}`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                <bdi>{DESCRIPTION_PREVIEW(view.sampleName)}</bdi>
              </p>
              {!view.sample ? (
                <p className="text-sm text-muted-foreground">{DESCRIPTION_NO_SAMPLE}</p>
              ) : preview ? (
                <>
                  <p dir="auto" className="whitespace-pre-wrap text-sm">
                    {preview.text}
                  </p>
                  {preview.english.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">{DESCRIPTION_STILL_ENGLISH(preview.english)}</p>}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{DESCRIPTION_HAND_LINE}</p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving !== null} onClick={onClose}>
            {BTN_CANCEL}
          </Button>
          <Button type="button" variant="outline" disabled={!view?.ready || saving !== null || unchanged} onClick={() => void save(false)}>
            {saving === "save" && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {BTN_DESCRIPTION_SAVE}
          </Button>
          {view && view.targets > 0 && (
            <Button type="button" disabled={!view.ready || saving !== null || blank} onClick={() => void save(true)}>
              {saving === "apply" && <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
              {BTN_DESCRIPTION_APPLY(view.targets)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
