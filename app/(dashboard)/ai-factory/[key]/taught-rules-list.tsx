"use client";

// Active + retired taught rules, newest first. Deactivating one stops it riding on future calls,
// but the row (and its audit trail) stays - "what did we used to teach it" is never lost.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { deactivateAgentInstruction } from "@/lib/actions/ai-factory-actions";
import type { TaughtRule } from "@/types/ai-factory.types";

export function TaughtRulesList({ rules }: { rules: TaughtRule[] }) {
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const deactivate = (id: string) => {
    startTransition(async () => {
      const res = await deactivateAgentInstruction(id);
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "ביטול הכלל נכשל",
          description: res.kind === "not_migrated" ? "המיגרציה עוד לא רצה." : res.kind,
        });
        return;
      }
      router.refresh();
    });
  };

  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">עדיין לא לימדתם אותו שום כלל.</p>;
  }

  return (
    <ul className="space-y-2">
      {rules.map((r) => (
        <li
          key={r.id}
          className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
            r.active ? "" : "opacity-50"
          }`}
        >
          <div className="min-w-0">
            <p className={r.active ? "" : "line-through"}>{r.text}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {r.createdBy ?? "לא ידוע"} · {new Date(r.createdAt).toLocaleString("he-IL")}
              {!r.active && r.deactivatedAt ? ` · בוטל ${new Date(r.deactivatedAt).toLocaleDateString("he-IL")}` : ""}
            </p>
          </div>
          {r.active && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              disabled={pending}
              onClick={() => deactivate(r.id)}
              aria-label="בטל כלל"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
