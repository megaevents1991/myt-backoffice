"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { REJECT_REASON_MIN } from "@/lib/uploader/constants";
import { REJECT_REASON_MAX } from "@/lib/uploader/run-rules";
import { cn } from "@/lib/utils";
import type { UploaderItem } from "@/types/uploader.types";
import { showDate } from "./board-words";

// "דחה" on any card (spec §11): a reason - what the agent learns from, so it is required - and
// whether this show may be offered again. The hidden event is soft deleted by the action. Mounted
// once; every opening starts on an empty reason, and the show stays on screen through the closing
// animation.

export function RejectDialog({
  item,
  onClose,
  onConfirm,
}: {
  /** The show being rejected; null = closed. */
  item: UploaderItem | null;
  onClose: () => void;
  /** Resolves true when the rejection was saved (the dialog then closes). */
  onConfirm: (item: UploaderItem, reason: string, final: boolean) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [final, setFinal] = useState(true);
  const [saving, setSaving] = useState(false);
  // The show on screen - kept after `item` turns null so the dialog closes with its text, not blank.
  const [shown, setShown] = useState<UploaderItem | null>(item);
  const [wasOpen, setWasOpen] = useState(item !== null);
  const open = item !== null;
  if (open !== wasOpen) {
    // Adjusting state on a prop change during render (React's pattern - no effect, no extra paint).
    setWasOpen(open);
    if (item) {
      setShown(item);
      setReason("");
      setFinal(true);
    }
  }

  const length = reason.trim().length;
  const valid = length >= REJECT_REASON_MIN && length <= REJECT_REASON_MAX;

  async function submit() {
    if (!item || !valid || saving) return;
    setSaving(true);
    try {
      if (await onConfirm(item, reason.trim(), final)) onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-md [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle>לדחות את ההופעה?</DialogTitle>
          {shown && (
            <DialogDescription>
              <bdi>{shown.show.city || shown.show.name_english}</bdi>
              {shown.show.venue && (
                <>
                  {" · "}
                  <bdi>{shown.show.venue}</bdi>
                </>
              )}
              {" · "}
              <span dir="ltr" className="tabular-nums">
                {showDate(shown.show.date)}
              </span>
              . {shown.event_id !== null ? "האירוע המוסתר יימחק, והסיבה נשמרת כלקח לסוכן." : "הסיבה נשמרת כלקח לסוכן."}
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          id="uploader-reject"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="reject-reason" className="text-xs font-medium text-muted-foreground">
                למה?
              </Label>
              <span
                dir="ltr"
                aria-live="polite"
                className={cn("text-[11px] tabular-nums", length > 0 && length < REJECT_REASON_MIN ? "text-warning" : "text-muted-foreground")}
              >
                {length < REJECT_REASON_MIN ? `${length}/${REJECT_REASON_MIN}` : `${length}/${REJECT_REASON_MAX}`}
              </span>
            </div>
            <Textarea
              id="reject-reason"
              dir="auto"
              rows={3}
              autoFocus
              maxLength={REJECT_REASON_MAX}
              value={reason}
              disabled={saving}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="למשל: לא מוכרים כרטיס בלבד בשווייץ"
              className="resize-none text-sm"
            />
            <p className="text-[11px] text-muted-foreground">לפחות {REJECT_REASON_MIN} תווים - הסוכן קורא את הסיבה בריצה הבאה.</p>
          </div>

          <label htmlFor="reject-final" className="flex cursor-pointer items-start justify-between gap-4 rounded-md border px-3 py-2.5">
            <span>
              <span className="block text-sm font-medium">אל תציע את ההופעה הזו שוב</span>
              <span className="block text-xs text-muted-foreground">
                {final ? "ריצה הבאה של הנושא תדלג עליה" : "ריצה הבאה תבנה אותה מחדש"}
              </span>
            </span>
            <Switch id="reject-final" checked={final} onCheckedChange={setFinal} disabled={saving} className="mt-0.5" />
          </label>
        </form>

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" form="uploader-reject" variant="destructive" disabled={!valid || saving}>
            {saving && <Loader2 aria-hidden className="animate-spin" />}
            דחה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
