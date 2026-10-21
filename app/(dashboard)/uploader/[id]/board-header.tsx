"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunBoard } from "@/lib/uploader/action-types";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/types/uploader.types";
import { SUBJECT_KIND_HE } from "../copy";
import { FILTER_HE, filterCount, FILTERS, showDate, stampHe, SUBJECT_WARNING_CHIP, type BoardCounts, type Filter } from "./board-words";

// The board's head (spec §5.3, mockup B): who the run is about, when and by whom, the brief, the
// five steps with their counts, the plan as chips, and - while the AI waits on a person - the amber
// bar that says so and jumps to the first question. Plus the filter pills under it.

const BRIEF_SHOWN = 160;

/** Every RUN_STATUSES value in the screen's words (the runs list's words). */
const RUN_STATUS_HE: Record<RunStatus, string> = {
  planned: "מתוכנן",
  building: "בונה",
  waiting: "ממתין לתשובה",
  review: "לאישור",
  done: "הושלם",
  stopped: "נעצר",
  error: "שגיאה",
};

// On the forest band: mint = working / ready, gold = waiting on a person, coral = broken.
const RUN_STATUS_STYLE: Record<RunStatus, string> = {
  planned: "bg-sidebar-accent text-sidebar-accent-foreground",
  building: "bg-brand-mint/15 text-brand-mint",
  waiting: "bg-brand-gold/15 text-brand-gold",
  review: "bg-brand-mint text-brand-forest",
  done: "bg-sidebar-accent text-sidebar-accent-foreground",
  stopped: "bg-sidebar-accent text-sidebar-accent-foreground",
  error: "bg-brand-coral/20 text-brand-coral",
};

type StepState = "done" | "now" | "ask" | "todo";

function Steps({ counts, status }: { counts: BoardCounts; status: RunStatus }) {
  const pending = counts.found + counts.building;
  const decided = counts.approved + counts.ready;
  // `n` is digits only (printed left-to-right); Hebrew beside it goes in `more`, outside that run.
  const steps: { label: string; n?: string; more?: string; state: StepState }[] = [
    { label: "פענוח", state: "done" },
    { label: "חיפוש", n: String(counts.total), state: "done" },
    {
      label: "בנייה",
      n: String(counts.built),
      more: pending > 0 ? `עוד ${pending}` : undefined,
      state: pending === 0 ? "done" : status === "building" ? "now" : "todo",
    },
    { label: "שאלות", n: String(counts.question), state: counts.question > 0 ? "ask" : pending === 0 ? "done" : "todo" },
    {
      label: "אישור",
      n: decided > 0 ? `${counts.approved}/${decided}` : undefined,
      state:
        counts.ready > 0 ? "now" : pending === 0 && counts.question === 0 && counts.approved > 0 ? "done" : "todo",
    },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label="שלבי הריצה">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && <ChevronLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />}
          <li
            aria-current={s.state === "now" || s.state === "ask" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs",
              s.state === "done" && "border-brand-mint bg-brand-mint font-semibold text-brand-forest",
              s.state === "now" && "border-brand-mint text-brand-mint",
              s.state === "ask" && "border-brand-gold font-semibold text-brand-gold",
              s.state === "todo" && "border-sidebar-border text-sidebar-foreground/70",
            )}
          >
            {s.state === "done" && <Check aria-hidden className="h-3 w-3" />}
            {(s.state === "now" || s.state === "ask") && (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
            )}
            {s.label}
            {s.n !== undefined && (
              <span dir="ltr" className="tabular-nums opacity-80">
                ({s.n})
              </span>
            )}
            {s.more && <span className="opacity-80">· {s.more}</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

function Chip({ children, warn = false, dashed = false }: { children: ReactNode; warn?: boolean; dashed?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        warn ? "border-warning/40 bg-warning-muted text-warning" : "bg-secondary",
        dashed && "border-dashed bg-transparent text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

const Money = ({ v }: { v: number | null }) =>
  v === null ? (
    <span className="text-muted-foreground">לא נקבע</span>
  ) : (
    <b dir="ltr" className="font-semibold tabular-nums">
      ${v.toLocaleString("en-US")}
    </b>
  );

function PlanChips({ board, counts }: { board: RunBoard; counts: BoardCounts }) {
  const { plan } = board.run;
  const kind = plan.subject.kind;
  const codes = new Set(board.items.flatMap((i) => (i.warnings ?? []).map((w) => w.code)));
  const noPage = codes.has("no_artist_page") || codes.has("no_team_page");
  const subjectGaps = Object.keys(SUBJECT_WARNING_CHIP).filter((c) => c !== "no_artist_page" && c !== "no_team_page" && codes.has(c));
  const { date_from, date_to, home_only, round, include_cities, exclude_cities } = plan.scope;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip>
        {SUBJECT_KIND_HE[kind] ?? kind}: <bdi className="font-semibold">{plan.subject.name_en}</bdi>
        {kind !== "competition" &&
          (noPage ? (
            <span className="text-warning">· אין עמוד</span>
          ) : board.subjectArt ? (
            <span className="text-success">· עמוד ✓</span>
          ) : null)}
      </Chip>
      {subjectGaps.length > 0 && <Chip warn>{subjectGaps.map((c) => SUBJECT_WARNING_CHIP[c]).join(" · ")}</Chip>}
      <Chip>
        <b className="tabular-nums">{counts.total}</b> הופעות
        {counts.built > 0 && (
          <>
            {" · "}חבילה <span className="tabular-nums">{counts.packages}</span>
            {" · "}כרטיס בלבד <span className="tabular-nums">{counts.ticketOnly}</span>
          </>
        )}
        {counts.skipped + counts.rejected > 0 && (
          <>
            {" · "}לא נוצרו <span className="tabular-nums">{counts.skipped + counts.rejected}</span>
          </>
        )}
      </Chip>
      <Chip>
        כרטיס בלבד <Money v={plan.markups.ticket_only} /> · אדישנל <Money v={plan.markups.additional} />
      </Chip>
      <Chip>בלי לוקיישן: {plan.rules.without_location === "ticket_only" ? "כרטיס בלבד" : "דילוג"}</Chip>
      {(date_from || date_to) && (
        <Chip>
          {date_from && (
            <>
              מ-
              <span dir="ltr" className="tabular-nums">
                {showDate(date_from)}
              </span>
            </>
          )}
          {date_from && date_to && " "}
          {date_to && (
            <>
              עד{" "}
              <span dir="ltr" className="tabular-nums">
                {showDate(date_to)}
              </span>
            </>
          )}
        </Chip>
      )}
      {kind === "team" && <Chip>{home_only ? "רק משחקי בית" : "כל המשחקים"}</Chip>}
      {round && (
        <Chip>
          סבב: <bdi>{round}</bdi>
        </Chip>
      )}
      {include_cities.length > 0 && (
        <Chip>
          רק: <bdi>{include_cities.join(", ")}</bdi>
        </Chip>
      )}
      {exclude_cities.length > 0 && (
        <Chip>
          בלי: <bdi>{exclude_cities.join(", ")}</bdi>
        </Chip>
      )}
      <Chip>
        <bdi>TixStock · LiveTickets</bdi>
      </Chip>
      {board.run.is_test && <Chip dashed>ריצת בדיקה</Chip>}
    </div>
  );
}

function Brief({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const brief = text.trim();
  if (brief === "") return null;
  const long = brief.length > BRIEF_SHOWN;
  return (
    <p dir="auto" className="max-w-[80ch] text-[13px] leading-relaxed text-sidebar-foreground">
      <span className={cn(open && "whitespace-pre-line")}>
        {open || !long ? brief : `${brief.slice(0, BRIEF_SHOWN).trimEnd()}…`}
      </span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ms-1.5 rounded-sm text-xs font-medium text-brand-mint underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          {open ? "פחות" : "הבריף המלא"}
        </button>
      )}
    </p>
  );
}

export function BoardHeader({
  board,
  counts,
  onJumpToQuestion,
}: {
  board: RunBoard;
  counts: BoardCounts;
  onJumpToQuestion: (itemId: string) => void;
}) {
  const { run, people } = board;
  const nameOf = (id: string | null | undefined) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  const asker = nameOf(run.asker_id) ?? nameOf(run.created_by);
  const nameHe = run.plan.subject.name_he?.trim() || null;
  const nameEn = run.plan.subject.name_en.trim();
  const status: RunStatus | null = run.status in RUN_STATUS_HE ? run.status : null;
  const firstQuestion = board.items.find((i) => i.status === "question") ?? null;
  const editedUnknown = board.editedUnknown === true;

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border bg-card shadow-card">
        <div className="space-y-3 bg-sidebar px-5 py-4 text-sidebar-foreground sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/uploader"
              className="inline-flex items-center gap-1 rounded-sm text-xs text-sidebar-foreground/80 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
              כל הריצות
            </Link>
            <span
              title={run.error ?? undefined}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
                status ? RUN_STATUS_STYLE[status] : "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              {status === "building" && (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" />
              )}
              {status ? RUN_STATUS_HE[status] : <bdi>{run.status}</bdi>}
            </span>
          </div>

          <div>
            <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-sidebar-accent-foreground">
              {nameHe ?? <bdi>{nameEn}</bdi>}
            </h1>
            {nameHe && nameEn && (
              <p className="mt-0.5 text-sm text-sidebar-foreground/80">
                <bdi>{nameEn}</bdi>
              </p>
            )}
            <p className="mt-1.5 text-xs text-sidebar-foreground/80" title={`ריצה ${run.id}`}>
              ריצה מיום{" "}
              <span dir="ltr" className="tabular-nums">
                {stampHe(run.created_at)}
              </span>
              {asker && <> · נשלח ע״י {asker}</>}
            </p>
          </div>

          <Brief text={run.brief ?? ""} />

          {run.status === "error" && run.error && (
            <p dir="auto" className="flex items-start gap-1.5 text-xs text-brand-coral">
              <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              {run.error}
            </p>
          )}

          <Steps counts={counts} status={run.status} />
        </div>

        <div className="space-y-2 px-5 py-3 sm:px-6">
          <PlanChips board={board} counts={counts} />
          {editedUnknown && (
            <p className="text-[11px] text-muted-foreground">לא הצלחנו לבדוק אילו אירועים נערכו בעורך - תגית &quot;נערך&quot; לא מוצגת כרגע.</p>
          )}
        </div>
      </section>

      {counts.question > 0 && firstQuestion && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning-muted px-4 py-3 text-sm"
        >
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-bold tabular-nums text-warning-foreground">
            {counts.question}
          </span>
          <span>
            <b className="font-semibold text-warning">{counts.question === 1 ? "שאלה אחת ממתינה" : `${counts.question} שאלות ממתינות`}</b>
            {asker ? <> - נשלח מייל ל{asker}</> : <> - נשלח מייל</>}
          </span>
          {firstQuestion.question?.text && (
            <span dir="auto" className="min-w-0 basis-full truncate text-[13px] text-foreground/75 sm:basis-0 sm:flex-1">
              ה-AI מחכה לך: {firstQuestion.question.text}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onJumpToQuestion(firstQuestion.id)}
            className="h-8 border-warning/50 bg-card text-[13px] hover:bg-card/80 sm:ms-auto"
          >
            לשאלה
          </Button>
        </div>
      )}
    </div>
  );
}

/** The filter pills (`?f=`, with their counts) and the keyboard hint. */
export function FilterBar({ filter, counts, onFilter }: { filter: Filter; counts: BoardCounts; onFilter: (f: Filter) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div role="group" aria-label="סינון הופעות" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = filterCount(f, counts);
          const on = filter === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter(f)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors duration-150 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : cn("bg-card hover:bg-accent hover:text-accent-foreground", n === 0 && "text-muted-foreground"),
                !on && f === "questions" && n > 0 && "border-warning/60 text-warning",
              )}
            >
              {FILTER_HE[f]}
              <span dir="ltr" className={cn("tabular-nums", on ? "opacity-80" : "opacity-60")}>
                {n}
              </span>
            </button>
          );
        })}
      </div>
      <p className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:flex">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> מעבר בין כרטיסים · <Kbd>A</Kbd> אשר · <Kbd>R</Kbd> דחה
      </p>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-card px-1 font-sans text-[10px] font-medium text-foreground shadow-card">
      {children}
    </kbd>
  );
}
