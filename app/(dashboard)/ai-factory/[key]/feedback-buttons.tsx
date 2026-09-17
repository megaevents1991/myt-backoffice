"use client";

// Approve/reject on ONE AI verdict - the sharpest lesson an agent can get, because it names
// exactly which answer was right or wrong (lib/agents/price-light.agent.ts's `agent.feedback`
// learning source). Already-fed-back rows show a plain badge instead of buttons - one verdict,
// one piece of feedback.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { recordAgentFeedback } from "@/lib/actions/ai-factory-actions";
import type { AgentKey } from "@/lib/agents";
import type { AgentLogRow } from "@/types/ai-factory.types";

export function FeedbackButtons({ agentKey, row }: { agentKey: AgentKey; row: AgentLogRow }) {
  const [noteOpen, setNoteOpen] = useState<"ok" | "bad" | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  if (row.feedback) {
    return (
      <span className={`text-xs font-medium ${row.feedback.verdictOk ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
        {row.feedback.verdictOk ? "אושר" : "נדחה"}
      </span>
    );
  }

  const send = (verdictOk: boolean) => {
    startTransition(async () => {
      const res = await recordAgentFeedback(agentKey, row.id, verdictOk, note || undefined);
      if (!res.ok) {
        toast({ variant: "destructive", title: "שמירת המשוב נכשלה", description: res.kind });
        return;
      }
      setNoteOpen(null);
      router.refresh();
    });
  };

  if (noteOpen) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 300))}
          placeholder="הערה (רשות)"
          className="h-7 w-36 text-xs"
          disabled={pending}
        />
        <Button size="sm" className="h-7" disabled={pending} onClick={() => send(noteOpen === "ok")}>
          שלח
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-emerald-700 dark:text-emerald-300"
        aria-label="אשר - הסוכן צדק"
        disabled={pending}
        onClick={() => setNoteOpen("ok")}
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-red-700 dark:text-red-300"
        aria-label="דחה - הסוכן טעה"
        disabled={pending}
        onClick={() => setNoteOpen("bad")}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
