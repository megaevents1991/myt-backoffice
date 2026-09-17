"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { listTaskRules } from "@/lib/actions/task-rule-actions";
import { listStaffForMentions } from "@/lib/actions/task-comment-actions";
import type { StaffMentionOption } from "@/types/task-comment.types";
import type { TaskRuleWithNames } from "@/types/task-rule.types";
import { RulesClient } from "./rules/rules-client";

type Loaded = { rules: TaskRuleWithNames[]; error: string | null; staff: StaffMentionOption[] };

/**
 * The "Task rules" tab on /tasks (admins only - the trigger is hidden for everyone else and
 * listTaskRules() keeps its own requireAdmin). Loads when the tab is opened: Radix mounts a
 * tab's content only while it is active, so the Tasks view never pays for this.
 */
export function RulesTab() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listTaskRules(), listStaffForMentions()])
      .then(([result, staff]) => {
        if (cancelled) return;
        setLoaded({
          rules: result.ok ? result.rules : [],
          error: result.ok ? null : result.error,
          staff,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("rules tab: load failed", error);
        setLoaded({ rules: [], error: "טעינת הכללים נכשלה", staff: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        כללים שרצים כל שבוע: רמזור אדום, שינויי מחיר קפואים ופערים ויזואליים הופכים למשימה בלי
        שאף אחד יזכור לפתוח את המסך.
      </p>
      <RulesClient initialRules={loaded.rules} initialError={loaded.error} staff={loaded.staff} />
    </div>
  );
}
