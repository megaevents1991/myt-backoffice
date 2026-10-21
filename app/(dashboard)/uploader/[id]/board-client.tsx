"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { useUrlState } from "@/hooks/use-view-state";
import { answerQuestion, approveAll, approveItem, rebuildTwoCity, rejectItem, resumeRun, retryItem, stopRun } from "@/lib/actions/uploader-actions";
import type { RunBoard } from "@/lib/uploader/action-types";
import { canResume } from "@/lib/uploader/run-rules";
import type { UploaderItem } from "@/types/uploader.types";
import { actionErrorText } from "../copy";
import { BoardBar, RebuildConfirm } from "./board-bar";
import { BoardHeader, FilterBar } from "./board-header";
import {
  countItems,
  farVenueTarget,
  FILTERS,
  inFilter,
  isApprovable,
  isRejectable,
  loadErrorText,
  NETWORK_TEXT,
  showLabel,
  type BusyKind,
  type Filter,
} from "./board-words";
import { QuestionCard } from "./question-card";
import { RejectDialog } from "./reject-dialog";
import { ShowCard } from "./show-card";
import { rtl, useRunBoard } from "./use-run-board";

// The review board of one run (spec §5.3, §11, §13; mockup B): the header, the filter pills, a card
// per show, and the sticky bar - and the handlers behind every card's buttons. Reading the run and
// driving the build loop is `useRunBoard`. Every action refetches the run before its card stops
// showing busy, so a card never flashes its old state after a click.

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
  const { board, loadError, loopActive, now, refresh, wake } = useRunBoard(runId, initial, initialError);
  const [filter, setFilter] = useUrlState<Filter>("f", "all", FILTERS);
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [rejecting, setRejecting] = useState<UploaderItem | null>(null);
  const [rebuilding, setRebuilding] = useState<UploaderItem | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const [runAction, setRunAction] = useState<"stop" | "resume" | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef<Record<string, BusyKind>>({});

  /** Every toast of the board; its description laid out right-to-left (a toast title is a plain string). */
  const say = useCallback(
    (title: string, description?: ReactNode, bad = false) =>
      toast({ variant: bad ? "destructive" : "default", title, description: description === undefined ? undefined : rtl(description) }),
    [toast],
  );

  const mark = useCallback((id: string, kind: BusyKind | null) => {
    const next = { ...busyRef.current };
    if (kind) next[id] = kind;
    else delete next[id];
    busyRef.current = next;
    setBusy(next);
  }, []);

  /** Run one card action: busy while it runs, the fresh board read BEFORE the card leaves busy. */
  const act = useCallback(
    async <T,>(item: UploaderItem, kind: BusyKind, run: () => Promise<T>, failTitle: string): Promise<T | null> => {
      if (busyRef.current[item.id]) return null;
      mark(item.id, kind);
      try {
        return await run();
      } catch {
        say(failTitle, NETWORK_TEXT, true);
        return null;
      } finally {
        await refresh();
        mark(item.id, null);
      }
    },
    [mark, refresh, say],
  );

  const approve = useCallback(
    async (item: UploaderItem) => {
      if (!isApprovable(item)) return;
      const r = await act(item, "approve", () => approveItem(item.id), `${showLabel(item)} לא אושר`);
      if (r === null) return;
      if (r.ok) {
        say(
          `${showLabel(item)} עלה לאתר`,
          r.edited ? "השינויים שנעשו בעורך נרשמו כלקח לסוכן. הקריאייטיב לפיד ייווצר בשעה הקרובה." : "הקריאייטיב לפיד ייווצר בשעה הקרובה.",
        );
      }
      else say(`${showLabel(item)} לא אושר`, actionErrorText(r.kind), true);
    },
    [act, say],
  );

  const answer = useCallback(
    async (item: UploaderItem, a: { key: string | null; text: string | null }): Promise<boolean> => {
      const r = await act(item, "answer", () => answerQuestion(item.id, a), "התשובה לא נשמרה");
      if (r === null) return false;
      // `task_not_closed` = the answer IS saved, only the task did not close. Anything else (split_failed
      // included - it is returned before a write) means nothing changed: the card keeps the pick.
      if (r.ok || r.kind === "task_not_closed") {
        say("התשובה נשמרה", r.ok ? (a.key === "skip" ? "ההופעה דולגה. המשימה נסגרה." : "ההופעה חוזרת לבנייה. המשימה נסגרה.") : actionErrorText(r.kind));
        wake();
        return true;
      }
      say("התשובה לא נשמרה", actionErrorText(r.kind), true);
      return false;
    },
    [act, say, wake],
  );

  const reject = useCallback(
    async (item: UploaderItem, reason: string, final: boolean): Promise<boolean> => {
      const r = await act(item, "reject", () => rejectItem(item.id, reason, final), "הדחייה לא נשמרה");
      if (r === null) return false;
      if (!r.ok) {
        say("הדחייה לא נשמרה", actionErrorText(r.kind), true);
        return false;
      }
      const parts = [item.event_id !== null ? "האירוע המוסתר נמחק." : null, final ? "לא יוצע שוב." : "יוצע שוב בריצה הבאה."];
      say(`${showLabel(item)} נדחה`, parts.filter(Boolean).join(" "));
      return true;
    },
    [act, say],
  );

  const retry = useCallback(
    async (item: UploaderItem) => {
      const r = await act(item, "retry", () => retryItem(item.id), "לא נשלח לבנייה מחדש");
      if (r === null) return;
      if (r.ok) {
        say(`${showLabel(item)} חוזר לבנייה`);
        wake();
      } else say("לא נשלח לבנייה מחדש", actionErrorText(r.kind), true);
    },
    [act, say, wake],
  );

  const rebuild = useCallback(
    async (item: UploaderItem) => {
      const target = farVenueTarget(item);
      if (!target) return;
      const r = await act(item, "rebuild", () => rebuildTwoCity(item.id, target.id), "הבנייה מחדש לא התחילה");
      if (r === null) return;
      if (r.ok) {
        say(`${showLabel(item)} ייבנה מחדש כחבילה דו-עירונית`, "הבחירה נרשמה - הפעם הבאה באולם הזה תיבנה כך מעצמה.");
        wake();
      } else say("הבנייה מחדש לא התחילה", actionErrorText(r.kind), true);
    },
    [act, say, wake],
  );

  async function doApproveAll() {
    if (approvingAll || !board) return;
    setApprovingAll(true);
    const byId = new Map(board.items.map((i) => [i.id, i]));
    try {
      const r = await approveAll(runId);
      if (r.kind) {
        say("האישור נכשל", actionErrorText(r.kind), true);
        setLastResult(`האישור נכשל: ${actionErrorText(r.kind)}`);
        return;
      }
      const failed = r.failed;
      setLastResult(`אושרו ${r.approved}${failed.length > 0 ? `, ${failed.length} לא אושרו` : ""}`);
      say(
        `אושרו ${r.approved}`,
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
                    {item ? showLabel(item) : "הופעה"}: {actionErrorText(f.kind)}
                  </li>
                );
              })}
            </ul>
            {failed.length > 6 && <p>ועוד {failed.length - 6}</p>}
          </div>
        ),
        r.approved === 0 && failed.length > 0,
      );
    } catch {
      say("האישור נכשל", NETWORK_TEXT, true);
    } finally {
      await refresh();
      setApprovingAll(false);
    }
  }

  async function runCommand(kind: "stop" | "resume", call: () => Promise<{ ok: true } | { ok: false; kind: string }>, ok: () => void, failTitle: string) {
    if (runAction) return;
    setRunAction(kind);
    try {
      const r = await call();
      if (r.ok) ok();
      else say(failTitle, actionErrorText(r.kind), true);
    } catch {
      say(failTitle, NETWORK_TEXT, true);
    } finally {
      await refresh();
      setRunAction(null);
    }
  }

  const status = board?.run.status ?? null;
  const stop = () =>
    void runCommand("stop", () => stopRun(runId), () => say("הריצה נעצרה", "ההופעה שכבר בבנייה תסתיים. \"המשך\" ממשיך מאותה נקודה."), "הריצה לא נעצרה");
  const resume = () => {
    // Already `building` on the server, only this board's loop is parked (an empty queue, a lost connection).
    if (status === "building") return wake();
    void runCommand(
      "resume",
      () => resumeRun(runId),
      () => {
        say("הבנייה ממשיכה");
        wake();
      },
      "הריצה לא ממשיכה",
    );
  };

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
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || rejecting || rebuilding) return;
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
        const next = at === -1 ? cards[0] : e.key === "ArrowDown" ? cards[Math.min(cards.length - 1, at + 1)] : cards[Math.max(0, at - 1)];
        const id = next.dataset.boardCard;
        if (id) focusCard(id);
        return;
      }
      if (!current) return;
      const item = itemsById.get(current.dataset.boardCard ?? "");
      if (!item || busyRef.current[item.id]) return;
      // `code`, not `key`: on a Hebrew layout the A key types "ש".
      if (e.code === "KeyA" && isApprovable(item)) {
        e.preventDefault();
        void approve(item);
      } else if (e.code === "KeyR" && isRejectable(item)) {
        e.preventDefault();
        setRejecting(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rejecting, rebuilding, itemsById, approve, focusCard]);

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

  const resumable = (status !== null && status !== "building" && canResume(status, counts.found)) || (status === "building" && !loopActive);

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
            <FilterBar filter={filter} counts={counts} onFilter={setFilter} />

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
                      subjectNameEn={board.run.plan.subject.name_en}
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

        <BoardBar
          counts={counts}
          status={status}
          loopActive={loopActive}
          resumable={resumable}
          runAction={runAction}
          approvingAll={approvingAll}
          lastResult={lastResult}
          onStop={stop}
          onResume={resume}
          onApproveAll={() => void doApproveAll()}
        />
      </div>

      <RejectDialog item={rejecting} onClose={() => setRejecting(null)} onConfirm={reject} />
      <RebuildConfirm
        item={rebuilding}
        onCancel={() => setRebuilding(null)}
        onConfirm={(item) => {
          setRebuilding(null);
          void rebuild(item);
        }}
      />
    </TooltipProvider>
  );
}
