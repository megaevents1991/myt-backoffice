"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { listMyOpenTasks, setTaskStatus } from "@/lib/actions/task-actions";
import type { Task, TaskPriority } from "@/types/task.types";

const PRIORITY_DOT: Record<TaskPriority, string> = {
  urgent: "bg-destructive",
  high: "bg-warning",
  medium: "bg-info",
  low: "bg-muted-foreground",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** The dashboard's "what should I do today" list - my open tasks by priority. */
export function MyTasksWidget() {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const reload = useCallback(() => {
    listMyOpenTasks(6).then(setTasks);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const complete = async (task: Task) => {
    // Optimistic: the row leaves the list immediately, comes back on failure.
    setTasks((current) => current?.filter((t) => t.id !== task.id) ?? null);
    const result = await setTaskStatus(task.id, "done");
    if (!result.ok) reload();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">My tasks</CardTitle>
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          All tasks
          <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {tasks === null ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : tasks.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Nothing open - you are clear.
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2"
            >
              <Checkbox
                aria-label={`Mark "${task.title}" done`}
                onCheckedChange={() => complete(task)}
              />
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  PRIORITY_DOT[task.priority],
                )}
                title={PRIORITY_LABEL[task.priority]}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {task.title}
              </span>
              {task.due_date && (
                <span className="shrink-0 text-xs tabular text-muted-foreground">
                  {task.due_date.slice(5)}
                </span>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
