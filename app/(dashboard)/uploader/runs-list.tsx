"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { RunStatus, SubjectKind, UploaderRun } from "@/types/uploader.types";
import { SUBJECT_KIND_HE } from "./copy";

// The runs already made (spec §5.1), newest first: who the tour is about, where it stands, and
// how many of its shows are on the site / ready / waiting on a question / skipped. A row opens the
// run's board (/uploader/[id]).

/** Every RUN_STATUSES value, in the screen's words - a status added to the type fails to compile here. */
const STATUS_HE: Record<RunStatus, string> = {
  planned: "מתוכנן",
  building: "בונה",
  waiting: "ממתין לתשובה",
  review: "לאישור",
  done: "הושלם",
  stopped: "נעצר",
  error: "שגיאה",
};

// The house's status colours (factory / price-changes): info = working, warning = waiting on a
// person, success = something to approve, destructive = broken, muted = nothing to do.
const STATUS_STYLE: Record<RunStatus, string> = {
  planned: "bg-muted text-muted-foreground",
  building: "bg-info-muted text-info",
  waiting: "bg-warning-muted text-warning",
  review: "bg-success-muted text-success",
  done: "bg-secondary text-muted-foreground",
  stopped: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
};

const isRunStatus = (s: string): s is RunStatus => s in STATUS_HE;
const isSubjectKind = (k: unknown): k is SubjectKind => typeof k === "string" && k in SUBJECT_KIND_HE;

/** The counts the list prints, in the order of the columns (keys of `uploader_runs.counts`). */
const COUNT_COLUMNS: { key: string; label: string; className?: string; tone?: string }[] = [
  { key: "total", label: "הופעות" },
  { key: "approved", label: "עלו לאתר" },
  { key: "ready", label: "מוכנות", className: "hidden sm:table-cell" },
  { key: "question", label: "שאלות", tone: "text-warning font-semibold" },
  { key: "skipped", label: "דולגו", className: "hidden md:table-cell" },
];

function countOf(run: UploaderRun, key: string): number {
  const n = run.counts?.[key];
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** "לפני 5 דק׳" up to a week, then the date. */
function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(t).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric" });
}

const fullTime = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" })
    : "";
};

export function RunsList({ runs }: { runs: UploaderRun[] }) {
  const router = useRouter();
  const now = Date.now();

  return (
    <section aria-labelledby="uploader-runs-title" className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 id="uploader-runs-title" className="font-display text-base font-semibold">
          ריצות קודמות
        </h2>
        {runs.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{runs.length}</span>}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {runs.length === 0 ? (
          <div className="space-y-1.5 px-4 py-10 text-center">
            <p className="text-sm font-medium">עוד אין ריצות - כתבו בריף למעלה כדי להתחיל.</p>
            <p className="mx-auto max-w-[60ch] text-sm text-muted-foreground">
              בריף טוב אומר את מי מעלים (אמן, קבוצה או תחרות), באילו תאריכים, כמה מארק אפ להוסיף, ומה עושים
              בהופעה בלי לוקיישן - כרטיס בלבד או לדלג.
            </p>
          </div>
        ) : (
          <Table look="list">
            <TableHeader>
              <TableRow>
                <TableHead>נושא</TableHead>
                <TableHead>סטטוס</TableHead>
                {COUNT_COLUMNS.map((c) => (
                  <TableHead key={c.key} className={cn("text-center", c.className)}>
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="hidden sm:table-cell">מתי</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const href = `/uploader/${run.id}`;
                const subject = run.plan?.subject;
                const nameHe = subject?.name_he?.trim() || null;
                const nameEn = subject?.name_en?.trim() || null;
                const kind = subject?.kind;
                const brief = typeof run.brief === "string" ? run.brief.trim() : "";
                const status = isRunStatus(run.status) ? run.status : null;
                const open = (e: MouseEvent<HTMLTableRowElement>) => {
                  if ((e.target as HTMLElement).closest("a")) return; // the name's own link already navigates
                  router.push(href);
                };
                return (
                  <TableRow key={run.id} onClick={open} className="cursor-pointer">
                    <TableCell className="max-w-[22rem]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={href}
                          className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        >
                          {nameHe ?? (nameEn ? <bdi>{nameEn}</bdi> : "ללא שם")}
                        </Link>
                        {isSubjectKind(kind) && (
                          <span className="rounded-full border px-1.5 py-px text-[11px] text-muted-foreground">
                            {SUBJECT_KIND_HE[kind]}
                          </span>
                        )}
                        {run.is_test && (
                          <span className="rounded-full border border-dashed px-1.5 py-px text-[11px] text-muted-foreground">
                            ריצת בדיקה
                          </span>
                        )}
                      </div>
                      {brief !== "" && (
                        <div dir="auto" className="mt-0.5 truncate text-xs text-muted-foreground" title={brief}>
                          {brief}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        title={run.error ?? undefined}
                        className={cn(
                          "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                          status ? STATUS_STYLE[status] : "bg-muted text-muted-foreground",
                        )}
                      >
                        {status === "building" && (
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-info animate-pulse motion-reduce:animate-none" />
                        )}
                        {status === "done" && <Check aria-hidden className="h-3 w-3" />}
                        {status ? STATUS_HE[status] : <bdi>{run.status}</bdi>}
                      </span>
                    </TableCell>
                    {COUNT_COLUMNS.map((c) => {
                      const n = countOf(run, c.key);
                      return (
                        <TableCell
                          key={c.key}
                          className={cn("text-center tabular-nums", c.className, n === 0 ? "text-muted-foreground/60" : c.tone)}
                        >
                          {n}
                        </TableCell>
                      );
                    })}
                    <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                      <span title={fullTime(run.created_at)} suppressHydrationWarning>
                        {ago(run.created_at, now)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
