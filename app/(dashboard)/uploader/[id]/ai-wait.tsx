"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { AI_WAIT } from "./board-words";

// The wait of a dialog that asked the AI (spec 11: "ה-AI מציע…" with the 20 s bar): the bar fills over
// the agent's own timeout, so a person sees how long the longest wait can be. Past it the bar stays
// full until the answer arrives (the action answers with empty boxes on a timeout - never hangs).

/** The agent's timeout for the two dialog calls (`tour-uploader.agent.ts` timeoutMs). */
const AI_WAIT_MS = 20_000;
const TICK_MS = 200;

export function AiWait({ label = AI_WAIT }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= AI_WAIT_MS) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const pct = Math.min(100, Math.round((elapsed / AI_WAIT_MS) * 100));

  return (
    <div className="space-y-2.5 py-8" role="status" aria-live="polite">
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {label}
      </p>
      {/* A block narrower than its RTL parent sits at the right: the bar fills from the start side. */}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mx-auto h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
