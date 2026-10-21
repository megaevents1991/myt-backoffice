"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCheck, Loader2, Pause, Play, RotateCw } from "lucide-react";
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
import { TooltipProvider } from "@/components/ui/tooltip";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { useUrlState } from "@/hooks/use-view-state";
import {
  answerQuestion,
  approveAll,
  approveItem,
  buildNextItem,
  getRun,
  rebuildTwoCity,
  rejectItem,
  resumeRun,
  retryItem,
  stopRun,
} from "@/lib/actions/uploader-actions";
import type { RunBoard } from "@/lib/uploader/action-types";
import { BOARD_POLL_MS } from "@/lib/uploader/constants";
import { canResume } from "@/lib/uploader/run-rules";
import { cn } from "@/lib/utils";
import type { UploaderItem } from "@/types/uploader.types";
import { BoardHeader, countItems, needsAttention, type BoardCounts } from "./board-header";
import { QuestionCard } from "./question-card";
import { RejectDialog } from "./reject-dialog";
import { farVenueTarget, isApprovable, isRejectable, kindText, ShowCard, showDate, showLabel, type BusyKind } from "./show-card";

// The review board of one run (spec §5.3, §11, §13; mockup B). It holds the run's view, drives the
// build loop (one `buildNextItem` per server-action call, never two at once), polls while a build is
// on, and answers every card's buttons. Every action refetches the run once it returns.
//
// Loop: while the run is `building`, `buildNextItem` -> `getRun` -> again, until the step says
// `done` or the status leaves `building` ("עצור"). A `done` while the status still reads building
// (another open board is building the last items) parks the loop until the status moves, a person
// acts, or "המשך" is pressed - so it never spins on an empty queue.
// Polling: every BOARD_POLL_MS while building, IDLE_POLL_MS otherwise (another admin may act), only
// while the tab is visible; a fresh read on returning to the tab. A sequence number drops any
// answer older than the newest request.

/** How often a run that is not building is re-read (another admin may approve / answer meanwhile). */
const IDLE_POLL_MS = 15_000;

const FILTERS = ["all", "questions", "ready", "attention", "approved", "skipped", "rejected", "errors"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_HE: Record<Filter, string> = {
  all: "הכל",
  questions: "שאלות",
  ready: "מוכנים",
  attention: "דורשים תשומת לב",
  approved: "אושרו",
  skipped: "דולגו",
  rejected: "נדחו",
  errors: "שגיאות",
};

function inFilter(filter: Filter, item: UploaderItem): boolean {
  switch (filter) {
    case "all":
      return true;
    case "questions":
      return item.status === "question";
    case "ready":
      return item.status === "ready";
    case "attention":
      return needsAttention(item);
    case "approved":
      return item.status === "approved";
    case "skipped":
      return item.status === "skipped";
    case "rejected":
      return item.status === "rejected";
    case "errors":
      return item.status === "error";
  }
}

function filterCount(filter: Filter, c: BoardCounts): number {
  switch (filter) {
    case "all":
      return c.total;
    case "questions":
      return c.question;
    case "ready":
      return c.ready;
    case "attention":
      return c.attention;
    case "approved":
      return c.approved;
    case "skipped":
      return c.skipped;
    case "rejected":
      return c.rejected;
    case "errors":
      return c.error;
  }
}

const LOAD_ERROR_HE: Record<string, string> = {
  not_found: "הריצה לא נמצאה - ייתכן שנמחקה",
  network: "אין חיבור לשרת - ננסה שוב בעוד רגע",
  db_error: "קריאת הריצה נכשלה - ננסה שוב בעוד רגע",
};
const loadErrorText = (kind: string): string => LOAD_ERROR_HE[kind] ?? kindText(kind);

const NETWORK = "אין חיבור לשרת - נסו שוב";

export function BoardClient({
  runId,
  initial,
  initialError,
}: {
  runId: string;
  /** The page's own `getRun`; null when that read failed (`initialError` says why). */
  initial: RunBoard | null;
  initialError: string | null;
}) {
  const { toast } = useToast();
  const [board, setBoard] = useState<RunBoard | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [filter, setFilter] = useUrlState<Filter>("f", "all", FILTERS);
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [rejecting, setRejecting] = useState<UploaderItem | null>(null);
  const [rebuilding, setRebuilding] = useState<UploaderItem | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [runAction, setRunAction] = useState<"stop" | "resume" | null>(null);
  // Starts true on a building run so the first paint shows "עצור", not "המשך" - the loop effect settles it.
  const [loopActive, setLoopActive] = useState(initial?.run.status === "building");
  const [loopGen, setLoopGen] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const rootRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const inFlight = useRef(0);
  const statusRef = useRef(initial?.run.status ?? null);
  const busyRef = useRef<Record<string, BusyKind>>({});
  const loopRunning = useRef(false);
  /** The loop met an empty queue while the status still read `building` - wait for a change before trying again. */
  const exhausted = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Re-read the run. Only the newest request may write; an older answer is dropped. */
  const refresh = useCallback(async (): Promise<void> => {
    const id = ++seq.current;
    inFlight.current += 1;
    try {
      const next = await getRun(runId);
      if (!alive.current || id !== seq.current) return;
      if (next === null) {
        setLoadError("not_found");
        return;
      }
      if (next.run === null) {
        setLoadError(next.kind);
        return;
      }
      statusRef.current = next.run.status;
      setBoard(next);
      setLoadError(null);
      setNow(Date.now());
    } catch {
      if (alive.current && id === seq.current) setLoadError("network");
    } finally {
      inFlight.current -= 1;
    }
  }, [runId]);

  // One toast per streak of failed reads - a poll that keeps failing must not stack toasts.
  const errorToasted = useRef(false);
  useEffect(() => {
    if (loadError === null) {
      errorToasted.current = false;
      return;
    }
    if (errorToasted.current) return;
    errorToasted.current = true;
    toast({ variant: "destructive", title: "הלוח לא התעדכן", description: loadErrorText(loadError) });
  }, [loadError, toast]);

  const mark = useCallback((id: string, kind: BusyKind | null) => {
    const next = { ...busyRef.current };
    if (kind) next[id] = kind;
    else delete next[id];
    busyRef.current = next;
    setBusy(next);
  }, []);

  /** A person put work back on the queue: the loop may look again even if it found it empty before. */
  const wake = useCallback(() => {
    exhausted.current = false;
    setLoopGen((g) => g + 1);
  }, []);

  // ---- the build loop -------------------------------------------------------------------------------

  const status = board?.run.status ?? null;

  useEffect(() => {
    // Any move of the run's status is a reason to look at the queue again.
    exhausted.current = false;
  }, [status]);

  useEffect(() => {
    if (status !== "building" || loopRunning.current || exhausted.current) return;
    loopRunning.current = true;
    setLoopActive(true);
    void (async () => {
      let warned = false;
      try {
        while (alive.current) {
          const step = await buildNextItem(runId);
          await refresh();
          if (step.kind && step.kind !== "stopped" && !warned) {
            warned = true;
            toast({ variant: "destructive", title: "הבנייה נתקלה בבעיה", description: kindText(step.kind) });
          }
          if (step.done) {
            exhausted.current = true;
            break;
          }
          if (statusRef.current !== "building") break;
        }
      } catch {
        exhausted.current = true;
        if (alive.current) toast({ variant: "destructive", title: "הבנייה נעצרה", description: "אין חיבור לשרת - לחצו \"המשך\" כדי לנסות שוב" });
      } finally {
        loopRunning.current = false;
        if (alive.current) {
          setLoopActive(false);
          setLoopGen((g) => g + 1);
        }
      }
    })();
  }, [status, loopGen, runId, refresh, toast]);

  // ---- polling --------------------------------------------------------------------------------------------

  const fast = status === "building" || loopActive;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && inFlight.current === 0) void refresh();
    };
    const timer = window.setInterval(tick, fast ? BOARD_POLL_MS : IDLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fast, refresh]);

  // ---- actions --------------------------------------------------------------------------------------------

  const approve = useCallback(
    async (item: UploaderItem) => {
      if (busyRef.current[item.id] || !isApprovable(item)) return;
      mark(item.id, "approve");
      try {
        const r = await approveItem(item.id);
        if (r.ok) {
          toast({
            title: `${showLabel(item)} עלה לאתר`,
            description: r.edited
              ? "השינויים שנעשו בעורך נרשמו כלקח לסוכן. הקריאייטיב לפיד ייווצר בשעה הקרובה."
              : "הקריאייטיב לפיד ייווצר בשעה הקרובה.",
          });
        } else {
          toast({ variant: "destructive", title: `${showLabel(item)} לא אושר`, description: kindText(r.kind) });
        }
      } catch {
        toast({ variant: "destructive", title: `${showLabel(item)} לא אושר`, description: NETWORK });
      } finally {
        mark(item.id, null);
        await refresh();
      }
    },
    [mark, refresh, toast],
  );

  const answer = useCallback(
    async (item: UploaderItem, a: { key: string | null; text: string | null }): Promise<boolean> => {
      if (busyRef.current[item.id]) return false;
      mark(item.id, "answer");
      try {
        const r = await answerQuestion(item.id, a);
        const next = a.key === "skip" ? "ההופעה דולגה." : "ההופעה חוזרת לבנייה.";
        if (r.ok) {
          toast({ title: "התשובה נשמרה", description: `${next} המשימה נסגרה.` });
          wake();
          return true;
        }
        // These two mean the answer IS saved - only what follows it did not complete.
        const saved = r.kind === "split_failed" || r.kind === "task_not_closed";
        toast({
          variant: saved ? "default" : "destructive",
          title: saved ? "התשובה נשמרה" : "התשובה לא נשמרה",
          description: kindText(r.kind),
        });
        if (saved) wake();
        return saved;
      } catch {
        toast({ variant: "destructive", title: "התשובה לא נשמרה", description: NETWORK });
        return false;
      } finally {
        mark(item.id, null);
        await refresh();
      }
    },
    [mark, refresh, toast, wake],
  );

  const reject = useCallback(
    async (item: UploaderItem, reason: string, final: boolean): Promise<boolean> => {
      if (busyRef.current[item.id]) return false;
      mark(item.id, "reject");
      try {
        const r = await rejectItem(item.id, reason, final);
        if (r.ok) {
          toast({
            title: `${showLabel(item)} נדחה`,
            description: [item.event_id !== null ? "האירוע המוסתר נמחק." : null, final ? "לא יוצע שוב." : "יוצע שוב בריצה הבאה."]
              .filter(Boolean)
              .join(" "),
          });
          return true;
        }
        toast({ variant: "destructive", title: "הדחייה לא נשמרה", description: kindText(r.kind) });
        return false;
      } catch {
        toast({ variant: "destructive", title: "הדחייה לא נשמרה", description: NETWORK });
        return false;
      } finally {
        mark(item.id, null);
        await refresh();
      }
    },
    [mark, refresh, toast],
  );

  const retry = useCallback(
    async (item: UploaderItem) => {
      if (busyRef.current[item.id]) return;
      mark(item.id, "retry");
      try {
        const r = await retryItem(item.id);
        if (r.ok) {
          toast({ title: `${showLabel(item)} חוזר לבנייה` });
          wake();
        } else toast({ variant: "destructive", title: "לא נשלח לבנייה מחדש", description: kindText(r.kind) });
      } catch {
        toast({ variant: "destructive", title: "לא נשלח לבנייה מחדש", description: NETWORK });
      } finally {
        mark(item.id, null);
        await refresh();
      }
    },
    [mark, refresh, toast, wake],
  );

  const rebuild = useCallback(
    async (item: UploaderItem) => {
      const target = farVenueTarget(item);
      if (busyRef.current[item.id] || !target) return;
      mark(item.id, "rebuild");
      try {
        const r = await rebuildTwoCity(item.id, target.id);
        if (r.ok) {
          toast({ title: `${showLabel(item)} ייבנה מחדש כחבילה דו-עירונית`, description: "הבחירה נרשמה - הפעם הבאה באולם הזה תיבנה כך מעצמה." });
          wake();
        } else toast({ variant: "destructive", title: "הבנייה מחדש לא התחילה", description: kindText(r.kind) });
      } catch {
        toast({ variant: "destructive", title: "הבנייה מחדש לא התחילה", description: NETWORK });
      } finally {
        mark(item.id, null);
        await refresh();
      }
    },
    [mark, refresh, toast, wake],
  );

  async function doApproveAll() {
    if (approvingAll || !board) return;
    setApprovingAll(true);
    const byId = new Map(board.items.map((i) => [i.id, i]));
    try {
      const r = await approveAll(runId);
      if (r.kind) {
        toast({ variant: "destructive", title: "האישור נכשל", description: kindText(r.kind) });
      } else {
        const failed = r.failed;
        toast({
          variant: r.approved === 0 && failed.length > 0 ? "destructive" : "default",
          title: `אושרו ${r.approved}`,
          description:
            failed.length === 0 ? (
              "האירועים עלו לאתר. הקריאייטיב לפיד ייווצר בשעה הקרובה."
            ) : (
              <div className="space-y-1">
                <p>{failed.length === 1 ? "הופעה אחת לא אושרה:" : `${failed.length} הופעות לא אושרו:`}</p>
                <ul className="space-y-0.5 ps-4">
                  {failed.slice(0, 6).map((f) => {
                    const item = byId.get(f.itemId);
                    return (
                      <li key={f.itemId} className="list-disc">
                        {item ? showLabel(item) : "הופעה"}: {kindText(f.kind)}
                      </li>
                    );
                  })}
                </ul>
                {failed.length > 6 && <p>ועוד {failed.length - 6}</p>}
              </div>
            ),
        });
      }
    } catch {
      toast({ variant: "destructive", title: "האישור נכשל", description: NETWORK });
    } finally {
      setApprovingAll(false);
      await refresh();
    }
  }

  async function stop() {
    if (runAction) return;
    setRunAction("stop");
    try {
      const r = await stopRun(runId);
      if (r.ok) toast({ title: "הריצה נעצרה", description: "ההופעה שכבר בבנייה תסתיים. \"המשך\" ממשיך מאותה נקודה." });
      else toast({ variant: "destructive", title: "הריצה לא נעצרה", description: kindText(r.kind) });
    } catch {
      toast({ variant: "destructive", title: "הריצה לא נעצרה", description: NETWORK });
    } finally {
      setRunAction(null);
      await refresh();
    }
  }

  async function resume() {
    if (runAction) return;
    // Already `building` on the server, only this board's loop rested (an empty queue, a lost connection).
    if (status === "building") {
      wake();
      return;
    }
    setRunAction("resume");
    try {
      const r = await resumeRun(runId);
      if (r.ok) {
        toast({ title: "הבנייה ממשיכה" });
        wake();
      } else toast({ variant: "destructive", title: "הריצה לא ממשיכה", description: kindText(r.kind) });
    } catch {
      toast({ variant: "destructive", title: "הריצה לא ממשיכה", description: NETWORK });
    } finally {
      setRunAction(null);
      await refresh();
    }
  }

  // ---- what is on screen ------------------------------------------------------------------------------------

  const items = useMemo(() => board?.items ?? [], [board]);
  const counts = useMemo(() => countItems(items), [items]);
  const visible = useMemo(() => items.filter((i) => inFilter(filter, i)), [items, filter]);
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const people = useMemo(() => new Map((board?.people ?? []).map((p) => [p.id, p.name])), [board]);
  const askerName = board ? (people.get(board.run.asker_id) ?? people.get(board.run.created_by) ?? null) : null;
  /** The one card Tab lands on (roving focus): the focused one while it is on screen, else the first. */
  const tabStop = focusedId !== null && visible.some((i) => i.id === focusedId) ? focusedId : (visible[0]?.id ?? null);

  const focusCard = useCallback((id: string, scroll: ScrollLogicalPosition = "nearest") => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-board-card="${CSS.escape(id)}"]`);
    if (!el) return;
    setFocusedId(id);
    el.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: scroll, behavior: reduce ? "auto" : "smooth" });
  }, []);

  function jumpToQuestion(id: string) {
    const item = itemsById.get(id);
    if (item && !inFilter(filter, item)) setFilter("questions");
    // After the filter's render, so the card is in the DOM.
    window.requestAnimationFrame(() => focusCard(id, "center"));
  }

  // ↑/↓ between cards, A approves the focused ready card, R opens reject. Never while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (rejecting || rebuilding || confirmAll) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='listbox'], [role='menu']",
        )
      )
        return;
      const root = rootRef.current;
      if (!root) return;
      const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-board-card]"));
      if (cards.length === 0) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const current = active?.closest<HTMLElement>("[data-board-card]") ?? null;
      const onPage = active === null || active === document.body || active === root;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!current && !onPage) return;
        e.preventDefault();
        const at = current ? cards.indexOf(current) : -1;
        const next =
          at === -1 ? cards[0] : e.key === "ArrowDown" ? cards[Math.min(cards.length - 1, at + 1)] : cards[Math.max(0, at - 1)];
        const id = next.dataset.boardCard;
        if (id) focusCard(id);
        return;
      }
      if (!current) return;
      const item = itemsById.get(current.dataset.boardCard ?? "");
      if (!item) return;
      // `code`, not `key`: on a Hebrew layout the A key types "ש".
      if (e.code === "KeyA" && isApprovable(item) && !busyRef.current[item.id]) {
        e.preventDefault();
        void approve(item);
      } else if (e.code === "KeyR" && isRejectable(item) && !busyRef.current[item.id]) {
        e.preventDefault();
        setRejecting(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rejecting, rebuilding, confirmAll, itemsById, approve, focusCard]);

  // ---- render -------------------------------------------------------------------------------------------------

  if (!board) {
    return (
      <div dir="rtl" className="container mx-auto max-w-6xl py-10">
        <div className="space-y-3 rounded-lg border bg-card px-6 py-10 text-center shadow-card">
          <p className="font-display text-lg font-semibold">לא הצלחנו לקרוא את הריצה</p>
          <p className="text-sm text-muted-foreground">{loadErrorText(loadError ?? "")}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button type="button" onClick={() => void refresh()}>
              <RotateCw aria-hidden />
              נסו שוב
            </Button>
            <Button asChild variant="ghost">
              <Link href="/uploader">כל הריצות</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const subjectNameEn = board.run.plan.subject.name_en;
  const resumable = status !== null && status !== "building" && canResume(status, counts.found);
  const loopResting = status === "building" && !loopActive;

  return (
    <TooltipProvider delayDuration={200}>
      <div ref={rootRef} dir="rtl" className="container mx-auto max-w-6xl space-y-5 pb-4 pt-6">
        <BoardHeader board={board} counts={counts} onJumpToQuestion={jumpToQuestion} />

        {counts.total === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            הריצה לא מצאה אף הופעה אצל הספקים.{" "}
            <Link href="/uploader" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
              חזרה לבריף
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div role="group" aria-label="סינון הופעות" className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => {
                  const n = filterCount(f, counts);
                  const on = filter === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors duration-150 ease-out",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        on
                          ? "border-primary bg-primary font-semibold text-primary-foreground"
                          : cn("bg-card hover:bg-accent hover:text-accent-foreground", n === 0 && "text-muted-foreground"),
                        !on && f === "questions" && n > 0 && "border-warning/60 text-warning",
                      )}
                    >
                      {FILTER_HE[f]}
                      <span dir="ltr" className={cn("tabular-nums", on ? "opacity-80" : "opacity-60")}>
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> מעבר בין כרטיסים · <Kbd>A</Kbd> אשר · <Kbd>R</Kbd> דחה
              </p>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                אין הופעות בסינון הזה.{" "}
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="rounded-sm font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  הצג הכל
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3">
                {visible.map((item) =>
                  item.status === "question" ? (
                    <QuestionCard
                      key={item.id}
                      item={item}
                      art={board.subjectArt}
                      askerName={askerName}
                      busy={busy[item.id] ?? null}
                      focused={item.id === tabStop}
                      onFocusCard={setFocusedId}
                      onAnswer={answer}
                      onReject={setRejecting}
                    />
                  ) : (
                    <ShowCard
                      key={item.id}
                      item={item}
                      art={board.subjectArt}
                      subjectNameEn={subjectNameEn}
                      edited={board.edited[item.id] === true}
                      people={people}
                      busy={busy[item.id] ?? null}
                      focused={item.id === tabStop}
                      now={now}
                      onFocusCard={setFocusedId}
                      onApprove={(i) => void approve(i)}
                      onReject={setRejecting}
                      onRetry={(i) => void retry(i)}
                      onRebuild={setRebuilding}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}

        {/* The sticky bar: where the run stands and the one action that publishes everything ready. */}
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-lg bg-sidebar px-4 py-3 text-sidebar-foreground shadow-lg sm:px-5">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px]" aria-live="polite">
            <span>
              מוכנים <Num>{counts.ready}</Num>
            </span>
            <span aria-hidden className="text-sidebar-foreground/40">
              ·
            </span>
            <span>
              אושרו <Num>{counts.approved}</Num>
            </span>
            <span aria-hidden className="text-sidebar-foreground/40">
              ·
            </span>
            <span className={cn(counts.question > 0 && "text-brand-gold")}>
              שאלות <Num>{counts.question}</Num>
            </span>
            {(status === "building" || loopActive) && (
              <span className="ms-2 inline-flex items-center gap-1.5 text-xs text-brand-mint">
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                בונה · עוד <Num>{counts.found + counts.building}</Num>
              </span>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {status === "building" && !loopResting && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={runAction !== null}
                onClick={() => void stop()}
                className="h-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-offset-sidebar"
              >
                {runAction === "stop" ? <Loader2 aria-hidden className="animate-spin" /> : <Pause aria-hidden />}
                עצור
              </Button>
            )}
            {(resumable || loopResting) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={runAction !== null}
                onClick={() => void resume()}
                className="h-9 border border-brand-mint/40 text-brand-mint hover:bg-sidebar-accent hover:text-brand-mint focus-visible:ring-offset-sidebar"
              >
                {runAction === "resume" ? <Loader2 aria-hidden className="animate-spin" /> : <Play aria-hidden />}
                המשך
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={counts.approvable === 0 || approvingAll}
              onClick={() => setConfirmAll(true)}
              className={cn(
                "h-9 bg-brand-mint font-semibold text-brand-forest hover:bg-brand-mint/90 focus-visible:ring-brand-mint focus-visible:ring-offset-sidebar",
                counts.approvable > 0 && !approvingAll && "shadow-mint-glow",
              )}
            >
              {approvingAll ? <Loader2 aria-hidden className="animate-spin" /> : <CheckCheck aria-hidden />}
              {approvingAll ? "מאשר…" : `אשר הכל (${counts.approvable}) ← עולה לאתר`}
            </Button>
          </div>
        </div>
      </div>

      <RejectDialog key={rejecting?.id ?? "closed"} item={rejecting} onClose={() => setRejecting(null)} onConfirm={reject} />

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-start sm:text-start">
            <AlertDialogTitle>להעלות לאתר?</AlertDialogTitle>
            <AlertDialogDescription>
              {counts.approvable === 1 ? "אירוע אחד יעלה לאתר עכשיו" : `${counts.approvable} אירועים יעלו לאתר עכשיו`}
              {counts.ready > counts.approvable && ` (${counts.ready - counts.approvable} חסומים יישארו מוסתרים)`}. מי שיגיע לאתר יוכל
              להזמין אותם מיד.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doApproveAll()}>אשר הכל</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rebuilding !== null}
        onOpenChange={(open) => {
          if (!open) setRebuilding(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-start sm:text-start">
            <AlertDialogTitle>לבנות מחדש כחבילה דו-עירונית?</AlertDialogTitle>
            {rebuilding?.location && (
              <AlertDialogDescription>
                ההופעה ב-<bdi>{rebuilding.show.city}</bdi> (
                <span dir="ltr" className="tabular-nums">
                  {showDate(rebuilding.show.date)}
                </span>
                ) תיבנה מחדש כחבילה: טיסה ל<bdi>{rebuilding.location.name}</bdi> (
                <span dir="ltr" className="tabular-nums">
                  {Math.round(rebuilding.location.km)}
                </span>{" "}
                ק&quot;מ), לינה מפוצלת בין שתי הערים.
                {rebuilding.event_id !== null && " האירוע הנוכחי (כרטיס בלבד) יימחק לפני הבנייה."} הבחירה נרשמת, והפעם הבאה באולם הזה תיבנה
                כך מעצמה.
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0">ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const item = rebuilding;
                setRebuilding(null);
                if (item) void rebuild(item);
              }}
            >
              בנה כחבילה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function Num({ children }: { children: number }) {
  return (
    <span dir="ltr" className="font-display font-semibold tabular-nums text-sidebar-accent-foreground">
      {children}
    </span>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-card px-1 font-sans text-[10px] font-medium text-foreground shadow-card">
      {children}
    </kbd>
  );
}
