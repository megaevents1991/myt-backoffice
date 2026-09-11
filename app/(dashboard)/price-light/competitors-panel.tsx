"use client";

// Crawl-status panel: one card per registered competitor scraper. "table" mode
// (LiveTickets, read from live_events - no network crawl) can't be triggered
// on demand, since its data refreshes overnight from the API, not from a scrape.
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { triggerCrawl, type CrawlPanelRow } from "@/lib/actions/price-light-actions";
import type { CrawlStatus } from "@/types/price-light.types";

const STATUS_LABEL: Record<CrawlStatus, string> = {
  running: "פועל",
  ok: "תקין",
  partial: "חלקי",
  blocked: "חסום",
  error: "שגיאה",
  skipped: "דולג",
};

const STATUS_CLASS: Record<CrawlStatus, string> = {
  running: "border-transparent bg-muted text-muted-foreground",
  ok: "border-transparent bg-success-muted text-success",
  partial: "border-transparent bg-warning-muted text-warning",
  blocked: "border-transparent bg-destructive/15 text-destructive",
  error: "border-transparent bg-destructive/15 text-destructive",
  skipped: "border-transparent bg-muted text-muted-foreground",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return "בקרוב";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function CompetitorCard({ row, onDone }: { row: CrawlPanelRow; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const disabledCrawl = row.mode === "table";

  const crawl = async () => {
    setBusy(true);
    try {
      const res = await triggerCrawl(row.competitor);
      if (!res.ok) {
        toast({ variant: "destructive", title: `סריקת ${row.competitor} נכשלה`, description: res.error });
        return;
      }
      const { summary } = res;
      toast({
        title: `${row.competitor}: ${STATUS_LABEL[summary.status] ?? summary.status}`,
        description: `${summary.listings} מודעות${summary.note ? ` · ${summary.note}` : ""}`,
        ...(summary.status === "blocked" || summary.status === "error" ? { variant: "destructive" as const } : {}),
      });
      onDone();
    } catch (e) {
      console.error("triggerCrawl failed", e);
      toast({ variant: "destructive", title: `סריקת ${row.competitor} נכשלה`, description: e instanceof Error ? e.message : "שגיאה" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold capitalize">{row.competitor}</CardTitle>
        <div className="flex items-center gap-1.5">
          {row.circuitOpen && (
            <Badge variant="outline" className="border-transparent bg-destructive/15 text-destructive">
              בלם פתוח
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(row.last ? STATUS_CLASS[row.last.status] : "text-muted-foreground")}
          >
            {row.last ? (STATUS_LABEL[row.last.status] ?? row.last.status) : "טרם נסרק"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 text-xs text-muted-foreground">
        <div>נסרק {relativeTime(row.last?.finished_at ?? row.last?.started_at ?? null)}</div>
        <div>{row.totalListings} מודעות בקטלוג</div>
        <div>הבא: {row.nextDueAt ? new Date(row.nextDueAt).toLocaleString("he-IL") : "—"}</div>
        <div className="pt-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={disabledCrawl ? 0 : undefined} className="inline-block">
                  <Button size="sm" variant="outline" disabled={disabledCrawl || busy} onClick={crawl}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "סרוק עכשיו"}
                  </Button>
                </span>
              </TooltipTrigger>
              {disabledCrawl && <TooltipContent>מתרענן בלילה מה-API</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}

export function CompetitorsPanel({ runs, onDone }: { runs: CrawlPanelRow[]; onDone: () => void }) {
  if (runs.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {runs.map((row) => (
        <CompetitorCard key={row.competitor} row={row} onDone={onDone} />
      ))}
    </div>
  );
}
