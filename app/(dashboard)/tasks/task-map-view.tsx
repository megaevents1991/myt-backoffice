"use client";

import { useMemo, useState } from "react";
import { MessageSquare, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PRIORITY_LABEL } from "@/components/task-editor";
import { initialsOf, PRIORITY_STYLE, STATUS_LABEL } from "@/lib/tasks/kanban";
import { marketingSections, NO_GROUP_KEY, roadmapSections, type MapSection } from "@/lib/tasks/roadmap";
import { matchesSearch } from "@/lib/search";
import type { MktChannel, TaskPriority, TaskStatus, TaskWithNames } from "@/types/task.types";

/** What a "+" in a section pre-fills in the task dialog. */
export interface MapTaskDefaults {
  board: "dev" | "marketing";
  phase?: number | null;
  channel?: MktChannel | null;
}

const STRIPE: Record<TaskPriority, string> = {
  urgent: "border-s-destructive",
  high: "border-s-warning",
  medium: "border-s-info",
  low: "border-s-muted-foreground/40",
};

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-muted-foreground/50",
  in_progress: "bg-warning",
  paused: "bg-info",
  done: "bg-success",
  cancelled: "bg-muted",
};

/**
 * The in-backoffice RoadMap (Dor, 16.09) - replaces the standalone app. "roadmap" lays the
 * dev board out by phase 1-7, "marketing" lays the marketing board out by channel. Same tasks,
 * same dialog and permissions as the other tabs; this is only another way to look at them.
 */
export function TaskMapView({
  mode,
  tasks,
  loading,
  onOpenTask,
  onAddTask,
}: {
  mode: "roadmap" | "marketing";
  tasks: TaskWithNames[];
  loading: boolean;
  onOpenTask: (task: TaskWithNames) => void;
  onAddTask: (defaults: MapTaskDefaults) => void;
}) {
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState<string>("all");

  const people = useMemo(() => {
    const byId = new Map<string, string>();
    for (const task of tasks) {
      if (task.assignee_id && task.assignee_name) byId.set(task.assignee_id, task.assignee_name);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const visible = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (assignee === "all" ||
            (assignee === "none" ? !task.assignee_id : task.assignee_id === assignee)) &&
          matchesSearch(query, task.title, task.description),
      ),
    [tasks, assignee, query],
  );

  const roadmap = useMemo(() => roadmapSections(visible), [visible]);
  const marketing = useMemo(() => marketingSections(visible), [visible]);
  const sections = mode === "roadmap" ? roadmap.sections : marketing.sections;

  const chips =
    mode === "roadmap"
      ? [
          { label: "סה״כ", value: roadmap.stats.total },
          { label: "בתהליך", value: roadmap.stats.inProgress },
          { label: "הושלם", value: roadmap.stats.done },
          { label: "נותר", value: roadmap.stats.remaining },
        ]
      : [
          { label: "קמפיינים", value: marketing.stats.total },
          { label: "פעילים", value: marketing.stats.inProgress },
          { label: "הושלמו", value: marketing.stats.done },
          { label: "התקדמות ממוצעת", value: `${marketing.stats.avgProgress}%` },
        ];

  const defaultsFor = (section: MapSection<TaskWithNames>): MapTaskDefaults =>
    mode === "roadmap"
      ? { board: "dev", phase: section.key === NO_GROUP_KEY ? null : Number(section.key) }
      : { board: "marketing", channel: section.key === NO_GROUP_KEY ? null : (section.key as MktChannel) };

  return (
    <div dir="rtl" className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{mode === "roadmap" ? "מפת דרכים" : "מרכז שיווק"}</h2>
            <p className="text-sm text-muted-foreground">
              {mode === "roadmap" ? "לוח הפיתוח לפי 7 שלבים" : "לוח השיווק לפי ערוצים"}
            </p>
          </div>
          <Button size="sm" onClick={() => onAddTask({ board: mode === "roadmap" ? "dev" : "marketing" })}>
            <Plus className="me-1.5 h-4 w-4" />
            משימה
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span key={chip.label} className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
              {chip.label}: <strong className="text-foreground">{loading ? "…" : chip.value}</strong>
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש משימה…"
            className="h-8 w-full sm:w-56"
          />
          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            aria-label="משובץ"
          >
            <option value="all">כל הצוות</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            <option value="none">לא משויך</option>
          </select>
        </div>
      </div>

      {sections.map((section, index) => (
        <section key={section.key} className="space-y-2">
          <header className="flex flex-wrap items-center gap-3">
            {mode === "roadmap" && section.key !== NO_GROUP_KEY && (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">
                {section.key}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold leading-tight">{section.title}</h3>
              {section.sub && <p className="text-xs text-muted-foreground">{section.sub}</p>}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {section.done}/{section.total}
              </span>
              <Progress value={section.percent} className="h-1.5 w-24" aria-label={`${section.percent}%`} />
              <span className="w-8 text-end">{section.percent}%</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => onAddTask(defaultsFor(section))}
                aria-label={`משימה חדשה ב${section.title}`}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {section.tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {loading ? "טוען…" : "אין כאן משימות עדיין"}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {section.tasks.map((task) => (
                <MapCard
                  key={task.id}
                  task={task}
                  showProgress={mode === "marketing"}
                  onOpen={() => onOpenTask(task)}
                />
              ))}
            </div>
          )}
          {index < sections.length - 1 && <hr className="mt-3" />}
        </section>
      ))}
    </div>
  );
}

function MapCard({
  task,
  showProgress,
  onOpen,
}: {
  task: TaskWithNames;
  showProgress: boolean;
  onOpen: () => void;
}) {
  const done = task.status === "done";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "rounded-lg border border-s-4 bg-card p-3 text-start shadow-sm transition-colors hover:bg-accent/40",
        STRIPE[task.priority],
        done && "opacity-60",
      )}
    >
      <p className={cn("line-clamp-2 text-sm font-medium", done && "line-through")}>{task.title}</p>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      )}
      {showProgress && <Progress value={done ? 100 : (task.progress ?? 0)} className="mt-2 h-1.5" />}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
              PRIORITY_STYLE[task.priority],
            )}
          >
            {PRIORITY_LABEL[task.priority]}
          </span>
          <span
            className={cn("h-2 w-2 rounded-full", STATUS_DOT[task.status])}
            title={STATUS_LABEL[task.status]}
            aria-label={STATUS_LABEL[task.status]}
          />
          {task.comment_count > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[11px] text-muted-foreground",
                task.unread_count > 0 && "font-semibold text-primary",
              )}
              title={task.unread_count > 0 ? `${task.unread_count} תגובות חדשות שלא קראת` : undefined}
            >
              <MessageSquare className="h-3 w-3" />
              {task.comment_count}
              {task.unread_count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
            </span>
          )}
        </div>
        <span
          title={task.assignee_name ?? "לא משויך"}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground"
        >
          {task.assignee_name ? initialsOf(task.assignee_name) : "?"}
        </span>
      </div>
    </button>
  );
}
