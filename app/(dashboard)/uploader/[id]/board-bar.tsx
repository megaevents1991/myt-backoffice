"use client";

import { useState } from "react";
import { CheckCheck, Loader2, Pause, Play } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunStatus, UploaderItem } from "@/types/uploader.types";
import { showDate, type BoardCounts } from "./board-words";

// The board's sticky bar (spec §5.3 / §13): where the run stands, "עצור" / "המשך" for the build,
// and "אשר הכל (N) ← עולה לאתר" behind one confirm - plus the far-venue rebuild's confirm, the
// board's other "are you sure".

function Num({ children }: { children: number }) {
  return (
    <span dir="ltr" className="font-display font-semibold tabular-nums text-sidebar-accent-foreground">
      {children}
    </span>
  );
}

const Dot = () => (
  <span aria-hidden className="text-sidebar-foreground/40">
    ·
  </span>
);

export function BoardBar({
  counts,
  status,
  loopActive,
  resumable,
  runAction,
  approvingAll,
  lastResult,
  onStop,
  onResume,
  onApproveAll,
}: {
  counts: BoardCounts;
  status: RunStatus | null;
  loopActive: boolean;
  /** "המשך" may put the run back to building (or wake this board's parked loop). */
  resumable: boolean;
  runAction: "stop" | "resume" | null;
  approvingAll: boolean;
  /** The last approve-all outcome, for screen readers (the toast shows it on screen). */
  lastResult: string;
  onStop: () => void;
  onResume: () => void;
  onApproveAll: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const building = status === "building" || loopActive;
  const n = counts.approvable;

  return (
    <>
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-lg bg-sidebar px-4 py-3 text-sidebar-foreground shadow-lg sm:px-5">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px]">
          <span>
            מוכנים <Num>{counts.ready}</Num>
          </span>
          <Dot />
          <span>
            אושרו <Num>{counts.approved}</Num>
          </span>
          <Dot />
          <span className={cn(counts.question > 0 && "text-brand-gold")}>
            שאלות <Num>{counts.question}</Num>
          </span>
          {building && (
            <span className="ms-2 inline-flex items-center gap-1.5 text-xs text-brand-mint">
              {loopActive && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
              בונה · עוד <Num>{counts.found + counts.building}</Num>
            </span>
          )}
        </p>
        <p aria-live="polite" className="sr-only">
          {lastResult}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {status === "building" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={runAction !== null}
              onClick={onStop}
              className="h-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-offset-sidebar"
            >
              {runAction === "stop" ? <Loader2 aria-hidden className="animate-spin" /> : <Pause aria-hidden />}
              עצור
            </Button>
          )}
          {resumable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={runAction !== null}
              onClick={onResume}
              className="h-9 border border-brand-mint/40 text-brand-mint hover:bg-sidebar-accent hover:text-brand-mint focus-visible:ring-offset-sidebar"
            >
              {runAction === "resume" ? <Loader2 aria-hidden className="animate-spin" /> : <Play aria-hidden />}
              המשך
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={n === 0 || approvingAll}
            onClick={() => setConfirm(true)}
            className={cn(
              "h-9 bg-brand-mint font-semibold text-brand-forest hover:bg-brand-mint/90 focus-visible:ring-brand-mint focus-visible:ring-offset-sidebar",
              n > 0 && !approvingAll && "shadow-mint-glow",
            )}
          >
            {approvingAll ? <Loader2 aria-hidden className="animate-spin" /> : <CheckCheck aria-hidden />}
            {approvingAll ? "מאשר…" : `אשר הכל (${n}) ← עולה לאתר`}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-start sm:text-start">
            <AlertDialogTitle>להעלות לאתר?</AlertDialogTitle>
            <AlertDialogDescription>
              {n === 1 ? "אירוע אחד יעלה לאתר עכשיו" : `${n} אירועים יעלו לאתר עכשיו`}
              {counts.ready > n && ` (${counts.ready - n} חסומים יישארו מוסתרים)`}. מי שיגיע לאתר יוכל להזמין אותם מיד.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={onApproveAll}>אשר הכל</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** "בנה כחבילה דרך <city>" asks once before the show is rebuilt two-city. */
export function RebuildConfirm({
  item,
  onCancel,
  onConfirm,
}: {
  item: UploaderItem | null;
  onCancel: () => void;
  onConfirm: (item: UploaderItem) => void;
}) {
  // The show on screen - kept after `item` turns null so the dialog closes with its text.
  const [shown, setShown] = useState<UploaderItem | null>(item);
  if (item && item !== shown) setShown(item);
  const loc = shown?.location ?? null;

  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader className="text-start sm:text-start">
          <AlertDialogTitle>לבנות מחדש כחבילה דו-עירונית?</AlertDialogTitle>
          {shown && loc && (
            <AlertDialogDescription>
              ההופעה ב-<bdi>{shown.show.city}</bdi> (
              <span dir="ltr" className="tabular-nums">
                {showDate(shown.show.date)}
              </span>
              ) תיבנה מחדש כחבילה: טיסה ל<bdi>{loc.name}</bdi> (
              <span dir="ltr" className="tabular-nums">
                {Math.round(loc.km)}
              </span>{" "}
              ק&quot;מ), לינה מפוצלת בין שתי הערים.
              {shown.event_id !== null && " האירוע הנוכחי (כרטיס בלבד) יימחק לפני הבנייה."} הבחירה נרשמת, והפעם הבאה באולם הזה תיבנה כך
              מעצמה.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (item) onConfirm(item);
            }}
          >
            בנה כחבילה
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
