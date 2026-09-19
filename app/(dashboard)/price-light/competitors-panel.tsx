"use client";

// Crawl-status strip: one compact card per registered competitor scraper, all five on a single
// row from `lg` up (they used to wrap 4+1, leaving an orphan card). Two kinds of card have no
// "סרוק עכשיו": "table" mode (LiveTickets, read from live_events - no network crawl, refreshes
// overnight from the API) and `crawlFrom: "local"` (ISSTA - the site serves Vercel's address a
// page without its cards, so it is crawled by scripts/crawl-local.ts from an Israeli machine and
// this screen only reads the run that leaves behind).
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { triggerCrawl, type CrawlPanelRow } from "@/lib/actions/price-light-actions";
import { CORRECTION_REPORT_DAYS } from "@/lib/actions/price-light-constants";
import type { CorrectionField } from "@/lib/services/price-light-corrections";
import { COMPETITOR_LABEL } from "@/app/(dashboard)/events/price-light-ui";
import { FIELD_HE } from "./correction-dialog";
import type { CompetitorKey, CrawlStatus } from "@/types/price-light.types";

const STATUS_LABEL: Record<CrawlStatus, string> = {
  running: "פועל",
  ok: "תקין",
  partial: "חלקי",
  blocked: "חסום",
  error: "שגיאה",
  skipped: "דולג",
};

/** A dot carries the status at a glance; the word next to it is the detail. */
const STATUS_DOT: Record<CrawlStatus, string> = {
  running: "bg-muted-foreground",
  ok: "bg-success",
  partial: "bg-warning",
  blocked: "bg-destructive",
  error: "bg-destructive",
  skipped: "bg-muted-foreground",
};

const STATUS_TEXT: Record<CrawlStatus, string> = {
  running: "text-muted-foreground",
  ok: "text-success",
  partial: "text-warning",
  blocked: "text-destructive",
  error: "text-destructive",
  skipped: "text-muted-foreground",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "מעולם לא";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return "בקרוב";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function CompetitorCard({
  row, onDone, picked, onPick,
}: {
  row: CrawlPanelRow; onDone: () => void; picked: boolean; onPick?: (competitor: CompetitorKey | null) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const isTable = row.mode === "table";
  const isLocal = row.crawlFrom === "local";
  const canTrigger = !isTable && !isLocal;
  const label = COMPETITOR_LABEL[row.competitor] ?? row.competitor;
  const status = row.last?.status ?? null;
  const lastAt = row.last?.finished_at ?? row.last?.started_at ?? null;

  const crawl = async () => {
    setBusy(true);
    try {
      const res = await triggerCrawl(row.competitor);
      if (!res.ok) {
        toast({ variant: "destructive", title: `סריקת ${label} נכשלה`, description: res.error });
        return;
      }
      const { summary } = res;
      toast({
        title: `${label}: ${STATUS_LABEL[summary.status] ?? summary.status}`,
        description: `${summary.listings} מודעות${summary.note ? ` · ${summary.note}` : ""}`,
        ...(summary.status === "blocked" || summary.status === "error" ? { variant: "destructive" as const } : {}),
      });
      onDone();
    } catch (e) {
      console.error("triggerCrawl failed", e);
      toast({ variant: "destructive", title: `סריקת ${label} נכשלה`, description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  const fixes = row.corrections;
  const fixesByField = Object.entries(fixes?.byField ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([field, n]) => `${FIELD_HE[field as CorrectionField] ?? field} ${n}`)
    .join(", ");

  // Everything that does not earn a line of its own lives here: the schedule, the open circuit
  // breaker and the reason a table-mode or local-only competitor has no button.
  const tip = [
    isTable ? "מתרענן בלילה מה-API, אין סריקה"
      : isLocal ? `נסרק מהמחשב המקומי כל ${row.intervalHours} שעות (האתר חוסם את Vercel), אין סריקה מכאן`
        : `סריקה כל ${row.intervalHours} שעות`,
    row.nextDueAt && !isTable ? `הבא: ${new Date(row.nextDueAt).toLocaleString("he-IL")}` : null,
    row.circuitOpen ? "בלם פתוח: שלוש ריצות כושלות ברצף, ממתין 24 שעות" : null,
    row.last?.note ?? null,
    row.details
      ? `תכולה (טיסה / מלון / כרטיס): נקראו ${row.details.opened} מתוך ${row.details.matched} מודעות מותאמות - עד 10 דפים ביום` +
        (row.details.lastAt ? `, מעבר אחרון ${new Date(row.details.lastAt).toLocaleString("he-IL")}` : "")
      : null,
    // The parser report: many fixes of one field on one site is a crawler bug, not an AI lesson.
    fixes ? `תיקוני צוות ב-${CORRECTION_REPORT_DAYS} הימים האחרונים: ${fixes.total} (${fixesByField})` : null,
  ].filter(Boolean).join("\n");

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-2",
              row.circuitOpen && "border-destructive/40",
              picked && "border-ring ring-2 ring-ring",
            )}
          >
            {/* The card is the competitor filter too (staff note 17.09): click = the table shows
                only this competitor, click again = everyone. */}
            <button
              type="button"
              onClick={() => onPick?.(picked ? null : row.competitor)}
              aria-pressed={picked}
              className="min-w-0 flex-1 text-start"
            >
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status ? STATUS_DOT[status] : "bg-border")} />
                <span className="truncate text-xs font-semibold">{label}</span>
                {row.circuitOpen && <span className="shrink-0 text-[10px] font-medium text-destructive">בלם</span>}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1 text-[11px] text-muted-foreground">
                <span className={cn("font-medium", status ? STATUS_TEXT[status] : "")}>
                  {status ? STATUS_LABEL[status] : "טרם נסרק"}
                </span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{row.totalListings}</span>
                <span className="truncate">מודעות</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {relativeTime(lastAt)}
                {fixes && <span className="ms-1 text-sky-700 dark:text-sky-300">· ✎ {fixes.total}</span>}
              </div>
              {row.details && row.details.matched > 0 && (
                <div className={cn("text-[11px] tabular-nums", row.details.opened < row.details.matched ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  תכולה {row.details.opened}/{row.details.matched}
                </div>
              )}
            </button>
            {canTrigger && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                disabled={busy}
                onClick={crawl}
                aria-label={`סרוק עכשיו ${label}`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="whitespace-pre-line text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CompetitorsPanel({
  runs, loading = false, onDone, picked = null, onPick,
}: {
  runs: CrawlPanelRow[]; loading?: boolean; onDone: () => void;
  picked?: CompetitorKey | null; onPick?: (competitor: CompetitorKey | null) => void;
}) {
  if (runs.length === 0) {
    // First load: the strip's shape appears at once so the tiles and table below it do not
    // jump down when the five cards land a moment later.
    if (!loading) return null;
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[62px] rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {runs.map((row) => (
        <CompetitorCard key={row.competitor} row={row} onDone={onDone} picked={picked === row.competitor} onPick={onPick} />
      ))}
    </div>
  );
}
