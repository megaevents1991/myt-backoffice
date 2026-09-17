"use client";

// "למד אותו": one textarea, one button. The rule it adds rides WITH the house rules on every
// future call (lib/agents/memory.ts) - real instructions, capped at 500 chars so the counter
// here is not a suggestion.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { addAgentInstruction } from "@/lib/actions/ai-factory-actions";
import type { AgentKey } from "@/lib/agents";

const TEXT_MAX = 500;

export function TeachForm({ agentKey }: { agentKey: AgentKey }) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      toast({ variant: "destructive", title: "כלל קצר מדי", description: "לפחות 3 תווים." });
      return;
    }
    startTransition(async () => {
      const res = await addAgentInstruction(agentKey, trimmed);
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "הוספת הכלל נכשלה",
          description: res.kind === "not_migrated" ? "המיגרציה עוד לא רצה." : res.kind,
        });
        return;
      }
      setText("");
      toast({ title: "הכלל נוסף" });
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, TEXT_MAX))}
        placeholder="למשל: איסטה תמיד מוכרים 3 לילות, לא 4 - אל תסתמכו על שם המסלול."
        rows={3}
        disabled={pending}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground tabular-nums">{text.length}/{TEXT_MAX}</span>
        <Button size="sm" onClick={submit} disabled={pending || text.trim().length < 3}>
          <GraduationCap className="me-1.5 h-3.5 w-3.5" />
          למד אותו
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        כללי צוות נכנסים ל-prompt כהוראות. רק אדמין יכול להוסיף.
      </p>
    </div>
  );
}
