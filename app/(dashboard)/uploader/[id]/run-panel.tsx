"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, GraduationCap, ImageOff, Info, Languages, ListChecks, ListTodo, MapPinned, UserRound } from "lucide-react";
import { TaskEditor, type TaskEditorState } from "@/components/task-editor";
import { Button } from "@/components/ui/button";
import type { PanelRow, PanelTask } from "@/lib/uploader/run-panel";
import { cn } from "@/lib/utils";
import type { UploaderItem } from "@/types/uploader.types";
import {
  BTN_CLASSIFY,
  BTN_LEARN_APPLY,
  BTN_NAMES,
  BTN_OPEN_TASK,
  BTN_OPEN_TEMPLATES,
  LEARN_RECIPE,
  PANEL_COLLAPSE,
  PANEL_COUNT_TITLE,
  PANEL_EXPAND,
  PANEL_OTHER_FIXED,
  PANEL_TITLE,
  PANEL_TOPICS,
  showLabel,
  TASK_FROM_RUN,
  TASK_ORIGIN,
} from "./board-words";
import { ACTION } from "./card-shell";
import type { PanelVenue } from "./classify-dialog";

// "לטיפול ברמת הריצה" (spec 5.1 / 11): what every card of the run would say the same way - the hall is
// new, the clubs have no Hebrew name, the subject has no page, the crest is missing - as ONE row each,
// with the number of shows it touches and one action (a hall with an event arranged by hand: learn, and
// classify beside it - ruling R20). The rows are `runLevelRows` (lib/uploader/run-panel.ts,
// pure - the board computes them; nothing is regrouped here). A row leaves when its warnings do (the
// dialogs remove them and the board reads the run again); the panel leaves with its last row.
// `id="run-panel"` is where a card's folded line ("N הערות ברמת הריצה - בפאנל למעלה") scrolls to.
// The subject's page row and every fix row also carry `row.task` (round "אלון 2", spec 5): "פתח משימה" opens the
// shared TaskEditor (a task for the missing page / picture) prefilled from it, on the marketing board.

const ICON: Record<PanelRow["kind"], typeof MapPinned> = {
  venue: MapPinned,
  names: Languages,
  subject: UserRound,
  fix: ImageOff,
  info: Info,
};

export function RunPanel({
  runId,
  rows,
  items,
  onClassify,
  onLearn,
  onNames,
}: {
  /** The run - a task's description links back to its board. */
  runId: string;
  /** `runLevelRows(board.items, board.fixedByHand, subject, board.missingNames)`; the board renders the panel only when it is not empty. */
  rows: PanelRow[];
  /** The run's items - names the other events a person arranged at the same hall. */
  items: UploaderItem[];
  onClassify: (venue: PanelVenue) => void;
  onLearn: (itemId: string) => void;
  onNames: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [editor, setEditor] = useState<TaskEditorState>({ open: false, task: null });
  const byId = new Map(items.map((i) => [i.id, i]));

  /** The shared task dialog, prefilled: a creative-gap task on the marketing board that links back to this run and to where the fix lives. */
  function openTask(task: PanelTask) {
    setEditor({
      open: true,
      task: null,
      defaults: { board: "marketing" },
      prefill: {
        title: task.title,
        description: `${TASK_FROM_RUN}: ${window.location.origin}/uploader/${runId}`,
        priority: "medium",
        source: "creative_gap",
        source_ref: { kind: "uploader_page", table: task.table, row_id: task.row_id, label: task.label, url: task.url },
        origin: TASK_ORIGIN,
      },
    });
  }

  function taskButton(task: PanelTask) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => openTask(task)} className={ACTION}>
        <ListTodo aria-hidden />
        {BTN_OPEN_TASK}
      </Button>
    );
  }

  function classifyButton(venue: PanelVenue) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => onClassify(venue)} className={ACTION}>
        <ListChecks aria-hidden />
        {BTN_CLASSIFY}
      </Button>
    );
  }

  function action(row: PanelRow) {
    const venue = row.venue;
    switch (row.action) {
      case "classify":
        return venue ? classifyButton(venue) : null;
      case "learn": {
        // A hall a person arranged one event of (ruling R20): learning from it is the main way (filled), the
        // classification dialog stays one click away - a learn can find no template, or leave rows to review.
        const fixed = venue?.fixedItemId ?? null;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {fixed && (
              <Button type="button" size="sm" onClick={() => onLearn(fixed)} className={ACTION}>
                <GraduationCap aria-hidden />
                {BTN_LEARN_APPLY}
              </Button>
            )}
            {venue && row.secondary === "classify" && classifyButton(venue)}
          </span>
        );
      }
      case "names":
        return (
          <Button type="button" variant="outline" size="sm" onClick={onNames} className={ACTION}>
            <Languages aria-hidden />
            {BTN_NAMES}
          </Button>
        );
      case "link":
        return row.fix_url ? (
          <Button asChild variant="outline" size="sm" className={ACTION}>
            <a href={row.fix_url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              {BTN_OPEN_TEMPLATES}
              <span className="sr-only"> (נפתח בלשונית חדשה)</span>
            </a>
          </Button>
        ) : null;
      default:
        return null;
    }
  }

  return (
    <section
      id="run-panel"
      tabIndex={-1}
      aria-labelledby="run-panel-title"
      className="scroll-mt-24 overflow-hidden rounded-lg border border-warning/40 bg-card shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <header className={cn("flex items-center justify-between gap-3 bg-warning-muted/60 px-4 py-2.5", open && "border-b border-warning/30")}>
        <h2 id="run-panel-title" className="font-display text-sm font-semibold">
          {PANEL_TITLE}
          <span className="font-normal text-muted-foreground"> · {PANEL_TOPICS(rows.length)}</span>
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="run-panel-rows"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? PANEL_COLLAPSE : PANEL_EXPAND}
          <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </header>

      {open && (
        <ul id="run-panel-rows" className="divide-y">
          {rows.map((row) => {
            const Icon = ICON[row.kind];
            const act = action(row);
            const others = (row.venue?.otherFixedItemIds ?? []).map((id) => byId.get(id)).filter((i): i is UploaderItem => i !== undefined);
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                <span
                  title={PANEL_COUNT_TITLE}
                  className="inline-flex h-6 min-w-7 shrink-0 items-center justify-center rounded-full bg-secondary px-2 text-xs font-semibold tabular-nums"
                >
                  {row.count}
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex items-start gap-1.5 text-[13px] leading-snug">
                    <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn("min-w-0 break-words", row.kind === "info" && "text-muted-foreground")}>{row.text}</span>
                  </p>
                  {others.length > 0 && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ps-5 text-xs text-muted-foreground">
                      <span>{PANEL_OTHER_FIXED}</span>
                      {others.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onLearn(item.id)}
                          className="rounded-sm font-medium underline underline-offset-2 hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {item.event_id !== null ? (
                            <>
                              <bdi dir="ltr">#{item.event_id}</bdi> {showLabel(item)}
                            </>
                          ) : (
                            showLabel(item)
                          )}
                        </button>
                      ))}
                    </p>
                  )}
                </div>
                {(act || row.task) && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {act}
                    {row.task && taskButton(row.task)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* The way to arrange a hall by hand (round 2, Alon: "not clear which flow") - said once, under the hall rows. */}
      {open && rows.some((r) => r.kind === "venue") && (
        <p className="flex items-start gap-1.5 border-t px-4 py-2 text-xs text-muted-foreground">
          <GraduationCap aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{LEARN_RECIPE}</span>
        </p>
      )}

      {/* Remounted per task (price-changes' pattern): the dialog reads its prefill once, when it mounts. */}
      <TaskEditor
        key={`${editor.prefill?.source_ref.table ?? "none"}-${editor.prefill?.source_ref.row_id ?? "new"}-${editor.prefill?.title ?? ""}-${editor.open}`}
        state={editor}
        isManager
        onClose={() => setEditor({ open: false, task: null })}
        onSaved={() => setEditor({ open: false, task: null })}
      />
    </section>
  );
}
