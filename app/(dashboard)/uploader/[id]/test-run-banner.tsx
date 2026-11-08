"use client";

import { useState } from "react";
import { FlaskConical, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { makeRunReal } from "@/lib/actions/uploader-actions";
import { makeRealPlan } from "@/lib/uploader/test-run";
import type { UploaderItem } from "@/types/uploader.types";
import { actionErrorText } from "../copy";
import {
  BTN_CANCEL,
  BTN_MAKE_REAL,
  BTN_MAKE_REAL_CONFIRM,
  MAKE_REAL_AFTER,
  MAKE_REAL_DONE,
  MAKE_REAL_LIVE,
  MAKE_REAL_TITLE,
  MAKE_REAL_WAITING,
  NETWORK_TEXT,
  TEST_RUN_TEXT,
  TEST_RUN_TITLE,
} from "./board-words";

// A test run's board (08.11, Dor: U2 was a test run - Alon approved 20 shows and none reached the site, while the board
// showed only a small "ריצת בדיקה" chip). The banner says what a test run means for approve; "הפוך לריצה אמיתית" asks once
// in the page (the counts from `makeRealPlan`, the same rule the server writes by) and calls `makeRunReal`.

export function TestRunBanner({ runId, items, onDone }: { runId: string; items: UploaderItem[]; onDone: () => void | Promise<void> }) {
  const { toast } = useToast();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const plan = makeRealPlan(items);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setProblem(null);
    try {
      const r = await makeRunReal(runId);
      if (!r.ok) {
        setProblem(actionErrorText(r.kind));
        if (r.kind === "events_not_switched" || r.kind === "not_test") await onDone();
        return;
      }
      toast({ title: MAKE_REAL_DONE(r.live) });
      setAsking(false);
      await onDone();
    } catch {
      setProblem(NETWORK_TEXT);
    } finally {
      setSaving(false);
    }
  }

  const waiting = MAKE_REAL_WAITING(plan.waiting);
  return (
    <section
      aria-labelledby="test-run-title"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-warning bg-warning-muted/60 px-4 py-3"
    >
      <FlaskConical aria-hidden className="h-5 w-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="test-run-title" className="text-sm font-semibold">
          {TEST_RUN_TITLE}
        </h2>
        <p className="text-[13px] leading-snug text-muted-foreground">{TEST_RUN_TEXT}</p>
      </div>
      <Button type="button" size="sm" onClick={() => setAsking(true)} className="shrink-0">
        <Rocket aria-hidden />
        {BTN_MAKE_REAL}
      </Button>

      <Dialog
        open={asking}
        onOpenChange={(next) => {
          if (!next && !saving) {
            setAsking(false);
            setProblem(null);
          }
        }}
      >
        <DialogContent dir="rtl" className="max-w-md [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle className="pe-6">{MAKE_REAL_TITLE}</DialogTitle>
            <DialogDescription className="space-y-1.5">
              <span className="block font-medium text-foreground">{MAKE_REAL_LIVE(plan.liveIds.length)}</span>
              {waiting && <span className="block">{waiting}</span>}
              <span className="block">{MAKE_REAL_AFTER}</span>
            </DialogDescription>
          </DialogHeader>
          {problem && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {problem}
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setAsking(false)}>
              {BTN_CANCEL}
            </Button>
            <Button type="button" disabled={saving} onClick={() => void confirm()}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {BTN_MAKE_REAL_CONFIRM}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
