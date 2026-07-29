"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, RefreshCcw, X } from "lucide-react";
import { SYNC_STEPS, type SyncStepId } from "@/lib/sync-steps";

/**
 * Runs the whole nightly pipeline on demand — providers, prices, creatives,
 * feed publish — one request per step so no single call hits a function
 * duration limit. The creatives step reports how many stale events it didn't
 * reach; we simply call it again until that's zero, so a backlog of any size
 * drains in one click.
 */
type StepState =
  | { status: "idle" }
  | { status: "running"; note?: string }
  | { status: "done"; summary: string }
  | { status: "failed"; error: string };

// A creative render is a couple of seconds; this only guards against a step
// that keeps reporting leftovers without making progress.
const MAX_STEP_PASSES = 40;

export function SyncAllButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<string, StepState>>({});

  const setStep = (id: SyncStepId, state: StepState) =>
    setStates((prev) => ({ ...prev, [id]: state }));

  const runStep = async (id: SyncStepId) => {
    const res = await fetch(`/api/admin-sync/${id}`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      summary?: string;
      remaining?: number;
      error?: string;
    };
    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return { summary: body.summary ?? "הסתיים", remaining: body.remaining ?? 0 };
  };

  const onClick = async () => {
    setRunning(true);
    setStates({});
    let failures = 0;

    for (const step of SYNC_STEPS) {
      setStep(step.id, { status: "running" });
      try {
        let pass = 0;
        let last = await runStep(step.id);
        // Steps that leave work behind (creatives) get called again until done.
        while (last.remaining > 0 && pass < MAX_STEP_PASSES) {
          pass++;
          setStep(step.id, { status: "running", note: `נותרו ${last.remaining}` });
          const next = await runStep(step.id);
          if (next.remaining >= last.remaining) {
            // No progress — stop instead of looping on a stuck backlog.
            last = next;
            break;
          }
          last = next;
        }
        setStep(step.id, {
          status: "done",
          summary: last.remaining > 0 ? `${last.summary} (נותרו ${last.remaining})` : last.summary,
        });
      } catch (e) {
        failures++;
        setStep(step.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }

    setRunning(false);
    router.refresh();
    toast({
      title: failures ? `הסנכרון הסתיים עם ${failures} כשלים` : "כל הסנכרונים הושלמו",
      description: failures ? "ראה את הפירוט מתחת לכפתור." : "הפיד מעודכן ופורסם למטא.",
      variant: failures ? "destructive" : undefined,
    });
  };

  return (
    <div className="space-y-3">
      <Button onClick={onClick} disabled={running} variant="secondary">
        {running ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCcw className="mr-2 h-4 w-4" />
        )}
        {running ? "מסנכרן הכל…" : "סנכרן הכל (כל ה־API)"}
      </Button>

      {Object.keys(states).length > 0 && (
        <ul className="space-y-1 text-sm">
          {SYNC_STEPS.map((step) => {
            const state = states[step.id];
            if (!state) return null;
            return (
              <li key={step.id} className="flex items-start gap-2">
                {state.status === "running" && (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
                {state.status === "done" && (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                )}
                {state.status === "failed" && (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                )}
                <span>
                  <span className="font-medium">{step.label}</span>{" "}
                  <span className="text-muted-foreground">
                    {state.status === "running" && (state.note ?? "רץ…")}
                    {state.status === "done" && state.summary}
                    {state.status === "failed" && state.error}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
