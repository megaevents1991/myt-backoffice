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
import { handedOffCodes, runLevelRows } from "@/lib/uploader/run-panel";
import { applyRuleTo, canResume, runRuleOf } from "@/lib/uploader/run-rules";
import type { UploaderItem } from "@/types/uploader.types";
import { actionErrorText } from "../copy";
import { BoardBar, RebuildConfirm } from "./board-bar";
import { BoardHeader, FilterBar } from "./board-header";
import {
  ANSWERED_MANY,
  ANSWERED_MANY_REQUEUED,
  ANSWERED_MANY_SKIPPED,
  ANSWERED_MANY_TASKS,
  countItems,
  DEFAULT_FILTER,
  farVenueTarget,
  FILTER_HE,
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
import { ClassifyDialog, type PanelVenue } from "./classify-dialog";
import { CreateLocationDialog } from "./create-location-dialog";
import { DescriptionDialog } from "./description-dialog";
import { LearnConfirm } from "./learn-confirm";
import { NamesDialog } from "./names-dialog";
import { QuestionCard } from "./question-card";
import { RejectDialog } from "./reject-dialog";
import { RunPanel } from "./run-panel";
import { ShowCard } from "./show-card";
import { rtl, useRunBoard } from "./use-run-board";

/** The toast's line for a show put back in the queue of a STOPPED run. */
const STOPPED_REQUEUE_TEXT = "חוזר לתור - לחצו המשך.";

/** The one run-level dialog open at a time (spec 5.2 / 5.3 / 5.5; round 2's create-location form); null = none. */
type RunDialog =
  | { kind: "classify"; venue: PanelVenue }
  | { kind: "names" }
  | { kind: "learn"; itemId: string }
  | { kind: "description" }
  | { kind: "location"; itemId: string }
  | null;

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
  const [filter, setFilter] = useUrlState<Filter>("f", DEFAULT_FILTER, FILTERS);
  const [busy, setBusy] = useState<Record<string, BusyKind>>({});
  const [rejecting, setRejecting] = useState<UploaderItem | null>(null);
  const [rebuilding, setRebuilding] = useState<UploaderItem | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const [runAction, setRunAction] = useState<"stop" | "resume" | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RunDialog>(null);
  /** question item id -> the option its card has picked (what "החל גם על השאלות הדומות" counts from). */
  const [picks, setPicks] = useState<Record<string, string | null>>({});
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
          r.note === "moved"
            ? "האירוע כבר אושר בלחיצה אחרת - הוא באתר."
            : r.edited
              ? "השינויים שנעשו בעורך נרשמו כלקח לסוכן. הקריאייטיב לפיד ייווצר בשעה הקרובה."
              : "הקריאייטיב לפיד ייווצר בשעה הקרובה.",
        );
      }
      else say(`${showLabel(item)} לא אושר`, actionErrorText(r.kind), true);
    },
    [act, say],
  );

  /** A stopped run builds nothing until "המשך": a requeued show waits in the queue - the toast says so. */
  const runStopped = board?.run.status === "stopped";
  const backToBuild = runStopped ? STOPPED_REQUEUE_TEXT : "ההופעה חוזרת לבנייה.";

  const answer = useCallback(
    async (item: UploaderItem, a: { key: string | null; text: string | null }, opts: { applyToSimilar: boolean }): Promise<boolean> => {
      const r = await act(item, "answer", () => answerQuestion(item.id, a, { applyToSimilar: opts.applyToSimilar }), "התשובה לא נשמרה");
      if (r === null) return false;
      // `task_not_closed` = the answer IS saved, only the task did not close. Anything else (split_failed
      // included - it is returned before a write) means nothing changed: the card keeps the pick.
      if (r.ok || r.kind === "task_not_closed") {
        const more = r.applied ?? 0;
        setPicks((all) => {
          const next = { ...all };
          delete next[item.id];
          return next;
        });
        if (r.ok && more > 0) {
          // A rule for the run (spec 5.4): this question and `more` others answered the same way.
          const what = a.key === "skip" ? ANSWERED_MANY_SKIPPED : runStopped ? STOPPED_REQUEUE_TEXT : ANSWERED_MANY_REQUEUED;
          say(ANSWERED_MANY(more + 1), `${what} ${ANSWERED_MANY_TASKS}`);
        } else {
          say("התשובה נשמרה", r.ok ? (a.key === "skip" ? "ההופעה דולגה. המשימה נסגרה." : `${backToBuild} המשימה נסגרה.`) : actionErrorText(r.kind));
        }
        wake();
        return true;
      }
      say("התשובה לא נשמרה", actionErrorText(r.kind), true);
      return false;
    },
    [act, say, wake, backToBuild, runStopped],
  );

  /** A run-level dialog saved (it showed its own toast): close it and read the run again. */
  const dialogDone = useCallback(async () => {
    setDialog(null);
    await refresh();
  }, [refresh]);
  const closeDialog = useCallback(() => setDialog(null), []);

  // `?learn=<item>` = the editor's toast after a save ("להחיל על N ההופעות?", second-edit round): the board opens that card's
  // learn dialog once it has the run, and the address forgets it - a refresh does not open it again.
  const boardLoaded = board !== null;
  useEffect(() => {
    if (!boardLoaded) return;
    const url = new URL(window.location.href);
    const wanted = url.searchParams.get("learn");
    if (!wanted) return;
    url.searchParams.delete("learn");
    window.history.replaceState(window.history.state, "", url);
    setDialog({ kind: "learn", itemId: wanted });
  }, [boardLoaded]);
  /** A location created and the question answered with it (its toast already shown): the show builds now - wake the loop. */
  const locationDone = useCallback(async () => {
    setDialog(null);
    await refresh();
    wake();
  }, [refresh, wake]);

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
        say(
          `${showLabel(item)} ייבנה מחדש כחבילה דו-עירונית`,
          runStopped ? `${STOPPED_REQUEUE_TEXT} הבחירה נרשמה.` : "הבחירה נרשמה - הפעם הבאה באולם הזה תיבנה כך מעצמה.",
        );
        wake();
      } else say("הבנייה מחדש לא התחילה", actionErrorText(r.kind), true);
    },
    [act, say, wake, runStopped],
  );

  async function doApproveAll() {
    if (approvingAll || !board) return;
    setApprovingAll(true);
    const byId = new Map(board.items.map((i) => [i.id, i]));
    try {
      const r = await approveAll(runId);
      // `recheck_skipped` is no failure: every approval stands, only the availability re-check waits for the next sync.
      if (r.kind && r.kind !== "recheck_skipped") {
        say("האישור נכשל", actionErrorText(r.kind), true);
        setLastResult(`האישור נכשל: ${actionErrorText(r.kind)}`);
        return;
      }
      // One toast (the store shows one at a time): the skipped re-check rides in the approvals' toast.
      const recheckNote = r.kind === "recheck_skipped" ? actionErrorText(r.kind) : null;
      const failed = r.failed;
      setLastResult(`אושרו ${r.approved}${failed.length > 0 ? `, ${failed.length} לא אושרו` : ""}`);
      say(
        `אושרו ${r.approved}`,
        failed.length === 0 ? (
          (recheckNote ?? "האירועים עלו לאתר. הקריאייטיב לפיד ייווצר בשעה הקרובה.")
        ) : (
          <div className="space-y-1">
            {recheckNote && <p>{recheckNote}</p>}
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

  // ---- round "אלון 1": the run panel, the learn button, a rule for the run --------------------------------

  const fixedByHand = useMemo(() => board?.fixedByHand ?? {}, [board]);
  const subject = useMemo(
    () => (board ? { kind: board.run.plan.subject.kind, name_en: board.run.plan.subject.name_en, row_id: board.subjectRowId ?? null } : null),
    [board],
  );
  /** The panel's rows (pure, lib/uploader/run-panel.ts); empty = no panel, and the cards keep every warning. A page / fix row a task already covers is left out (Alon round 3). */
  const panelRows = useMemo(
    () => (board && subject ? runLevelRows(items, fixedByHand, subject, board.missingNames ?? [], board.pageTasks ?? []) : []),
    [board, subject, items, fixedByHand],
  );
  const panelShown = panelRows.length > 0;
  /** The warning codes whose page task already exists - the cards drop them too (neither printed nor folded). */
  const handedOff = useMemo(() => (board && subject ? handedOffCodes(items, subject, board.pageTasks ?? []) : new Set<string>()), [board, subject, items]);

  /**
   * The ready / approved shows of the run with an event - what "למדו והחילו" may carry an edit to (the hall's shows
   * for the venue kind, any show for a ticket description - Alon round 3; before it only the hall counted, and a
   * LiveTickets-only show had no learn at all).
   */
  const built = useMemo(() => new Set(items.filter((i) => i.event_id !== null && (i.status === "ready" || i.status === "approved")).map((i) => i.id)), [items]);
  const learnTargets = (item: UploaderItem): number => built.size - (built.has(item.id) ? 1 : 0);

  /** question item id -> how many OTHER open questions its picked answer's rule would answer (spec 5.4). */
  const similar = useMemo(() => {
    const out = new Map<string, number>();
    const open = items.filter((i) => i.status === "question" && i.question !== null);
    for (const item of open) {
      const key = picks[item.id] ?? null;
      const q = item.question;
      if (key === null || q === null) continue;
      const rule = runRuleOf(q, item, { key, text: null });
      if (rule === null) continue;
      out.set(item.id, open.filter((other) => other.id !== item.id && applyRuleTo(rule, other) !== null).length);
    }
    return out;
  }, [items, picks]);
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
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || rejecting || rebuilding || dialog) return;
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
  }, [rejecting, rebuilding, dialog, itemsById, approve, focusCard]);

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
        <BoardHeader board={board} counts={counts} onJumpToQuestion={jumpToQuestion} onDescription={() => setDialog({ kind: "description" })} />

        {panelShown && (
          <RunPanel
            runId={runId}
            rows={panelRows}
            items={items}
            onClassify={(venue) => setDialog({ kind: "classify", venue })}
            onLearn={(itemId) => setDialog({ kind: "learn", itemId })}
            onNames={() => setDialog({ kind: "names" })}
            // the remembered assignee only while still on the staff list (else the dialog would show an empty pick)
            assignee={board.pageTaskAssignee && people.has(board.pageTaskAssignee) ? board.pageTaskAssignee : null}
            onTaskSaved={() => void refresh()}
          />
        )}

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
                {/* From any other pill back to the default view; from an empty default (everything rejected / skipped) to all. */}
                <button
                  type="button"
                  onClick={() => setFilter(filter === DEFAULT_FILTER ? "all" : DEFAULT_FILTER)}
                  className="rounded-sm font-medium text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {filter === DEFAULT_FILTER ? "הצג הכל" : `הצג ${FILTER_HE[DEFAULT_FILTER]}`}
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
                      similar={similar.get(item.id) ?? 0}
                      onFocusCard={setFocusedId}
                      onPick={(key) => setPicks((all) => (all[item.id] === key ? all : { ...all, [item.id]: key }))}
                      onAnswer={answer}
                      onReject={setRejecting}
                      onCreateLocation={(i) => setDialog({ kind: "location", itemId: i.id })}
                    />
                  ) : (
                    <ShowCard
                      key={item.id}
                      item={item}
                      art={board.subjectArt}
                      subjectNameEn={board.run.plan.subject.name_en}
                      edited={board.edited[item.id] === true}
                      fixedByHand={(board.editKinds?.[item.id] ?? []).length > 0}
                      learnTargets={learnTargets(item)}
                      handedOff={handedOff}
                      panelShown={panelShown}
                      people={people}
                      busy={busy[item.id] ?? null}
                      focused={item.id === tabStop}
                      now={now}
                      onFocusCard={setFocusedId}
                      onApprove={(i) => void approve(i)}
                      onReject={setRejecting}
                      onRetry={(i) => void retry(i)}
                      onRebuild={setRebuilding}
                      onLearn={(i) => setDialog({ kind: "learn", itemId: i.id })}
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

      <RejectDialog item={rejecting} isTest={board.run.is_test} onClose={() => setRejecting(null)} onConfirm={reject} />
      <ClassifyDialog
        runId={runId}
        venue={dialog?.kind === "classify" ? dialog.venue : null}
        open={dialog?.kind === "classify"}
        onClose={closeDialog}
        onDone={dialogDone}
      />
      <NamesDialog
        runId={runId}
        open={dialog?.kind === "names"}
        personKind={board.run.plan.subject.kind === "artist" ? "artist" : "team"}
        onClose={closeDialog}
        onDone={dialogDone}
      />
      <CreateLocationDialog
        item={dialog?.kind === "location" ? (board.items.find((i) => i.id === dialog.itemId) ?? null) : null}
        onClose={closeDialog}
        onDone={locationDone}
      />
      <LearnConfirm itemId={dialog?.kind === "learn" ? dialog.itemId : null} open={dialog?.kind === "learn"} onClose={closeDialog} onDone={dialogDone} />
      <DescriptionDialog runId={board.run.id} open={dialog?.kind === "description"} onClose={closeDialog} onDone={dialogDone} />
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
