"use client";

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { buildNextItem, getRun } from "@/lib/actions/uploader-actions";
import type { RunBoard } from "@/lib/uploader/action-types";
import { BOARD_IDLE_POLL_MS } from "@/lib/uploader/constants";
import { actionErrorText } from "../copy";
import { loadErrorText } from "./board-words";

// The review board's view of its run, kept fresh (spec §5.3 "build progress"):
//
// - refresh: `getRun`; a sequence number drops any answer older than the newest request. The staff
//   list (`people`) is read once per board: once a read brought it, every later one asks
//   `{ people: false }` and the board keeps the list it has.
// - The build loop: while the run is `building`, `buildNextItem` -> refresh -> again, one call at a
//   time (the `loopRunning` guard), until the step says `done` or the status leaves `building`
//   ("עצור"). A `done` while the status still reads building (another open board is building the
//   last items) PARKS the loop - it does not spin on an empty queue - until the status moves or
//   `wake()` is called (a person put work back on the queue). A wake that lands while the loop's
//   last call is in flight is not lost: the loop parks only if no wake happened since that call
//   started (`wakeEpoch`).
// - Polling: while this board's loop runs it refreshes after every step and the poll stands down;
//   otherwise (waiting on people, or a build another board is driving) every BOARD_IDLE_POLL_MS,
//   only while the tab is visible, plus one read on coming back to the tab.

/** A toast description, laid out right-to-left (the toaster itself is LTR; a toast title must stay a plain string). */
export function rtl(text: ReactNode): ReactNode {
  return createElement("div", { dir: "rtl" }, text);
}

export type RunBoardState = {
  board: RunBoard | null;
  loadError: string | null;
  /** The loop is running in this tab. */
  loopActive: boolean;
  /** When the board was last read (for "is this build stale"). */
  now: number;
  refresh: () => Promise<void>;
  wake: () => void;
};

export function useRunBoard(runId: string, initial: RunBoard | null, initialError: string | null): RunBoardState {
  const { toast } = useToast();
  const [board, setBoard] = useState<RunBoard | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  // Starts true on a building run so the first paint shows the building state - the loop effect settles it.
  const [loopActive, setLoopActive] = useState(initial?.run.status === "building");
  const [loopGen, setLoopGen] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const alive = useRef(true);
  const seq = useRef(0);
  const inFlight = useRef(0);
  const statusRef = useRef(initial?.run.status ?? null);
  const loopRunning = useRef(false);
  /** The loop met an empty queue while the status still read `building` - wait for a change or a wake. */
  const exhausted = useRef(false);
  const wakeEpoch = useRef(0);
  /** The staff list the board already has (null = none read yet - the next read asks for it). */
  const peopleRef = useRef<RunBoard["people"] | null>(initial && !initial.peopleOmitted ? initial.people : null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const id = ++seq.current;
    inFlight.current += 1;
    try {
      const known = peopleRef.current;
      const next = await getRun(runId, { people: known === null });
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
      if (!next.peopleOmitted) peopleRef.current = next.people;
      setBoard(next.peopleOmitted ? { ...next, people: peopleRef.current ?? [] } : next);
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
    toast({ variant: "destructive", title: "הלוח לא התעדכן", description: rtl(loadErrorText(loadError)) });
  }, [loadError, toast]);

  const wake = useCallback(() => {
    wakeEpoch.current += 1;
    exhausted.current = false;
    setLoopGen((g) => g + 1);
  }, []);

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
      let epoch = wakeEpoch.current;
      try {
        while (alive.current) {
          epoch = wakeEpoch.current;
          const step = await buildNextItem(runId);
          await refresh();
          if (step.kind && step.kind !== "stopped" && !warned) {
            warned = true;
            toast({ variant: "destructive", title: "הבנייה נתקלה בבעיה", description: rtl(actionErrorText(step.kind)) });
          }
          if (step.done) {
            // Park - unless someone woke the loop while this call was in flight.
            if (wakeEpoch.current === epoch) exhausted.current = true;
            break;
          }
          if (statusRef.current !== "building") break;
        }
      } catch {
        if (wakeEpoch.current === epoch) exhausted.current = true;
        if (alive.current) {
          toast({
            variant: "destructive",
            title: "הבנייה נעצרה",
            description: rtl("אין חיבור לשרת - לחצו \"המשך\" כדי לנסות שוב"),
          });
        }
      } finally {
        loopRunning.current = false;
        if (alive.current) {
          setLoopActive(false);
          setLoopGen((g) => g + 1);
        }
      }
    })();
  }, [status, loopGen, runId, refresh, toast]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || loopRunning.current || inFlight.current > 0) return;
      void refresh();
    };
    const timer = window.setInterval(tick, BOARD_IDLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { board, loadError, loopActive, now, refresh, wake };
}
