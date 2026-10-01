"use client";

/**
 * /tours/approvals ("Approvals") - the manager's morning queue of a tours
 * company: what only a manager approves, and what the import left for a person
 * to settle. Every row is handled in place or is one click from where it is
 * fixed, and leaves the list once handled.
 *
 * The page guards the route on the server; this component loads the queue
 * through its own server action (which checks the role again), runs every
 * action through one `run` (the shared action toast) and reloads after each, so
 * the counts are always what the database holds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  getApprovalsQueue,
  getApprovalsReviewPage,
  type ApprovalsData,
} from "@/lib/actions/tours-approvals-actions";
import { formatDateShort } from "@/lib/tours/format";
import { Notice } from "@/components/tours/ui";
import { BlockApprovals } from "./block-approvals";
import { DeparturesWithoutBlock } from "./departures-without-block";
import { DeparturesWithoutPrice } from "./departures-without-price";
import { ExceptionsSummary } from "./exceptions-summary";
import { UnmatchedHotels } from "./unmatched-hotels";
import type { QueueRun } from "./queue-ui";

const LOAD_FAILED = "Couldn't load the data. Refresh the page, and if it happens again, contact support.";

export function ApprovalsScreen({ companyName }: { companyName: string }) {
  const [data, setData] = useState<ApprovalsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  /** Bumped after every change, so the data-problems summary counts again. */
  const [changes, setChanges] = useState(0);
  const busyRef = useRef<string | null>(null);
  const reviewPage = useRef(1);
  /** Only the newest load may write its answer. */
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await getApprovalsQueue({ reviewPage: reviewPage.current });
      if (seq !== loadSeq.current) return;
      if (res.success) {
        setData(res.data);
        reviewPage.current = res.data.review.page;
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("approvals: load failed", e);
      if (seq === loadSeq.current) setError(LOAD_FAILED);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One action at a time: the ref refuses a second press before React has re-rendered the buttons as disabled.
  const begin = useCallback((key: string): boolean => {
    if (busyRef.current !== null) return false;
    busyRef.current = key;
    setBusy(key);
    return true;
  }, []);
  const end = useCallback(() => {
    busyRef.current = null;
    setBusy(null);
  }, []);

  const toastRun = useActionToast();
  const run: QueueRun = useCallback(
    async (key, action, okMessage) => {
      if (!begin(key)) return false;
      try {
        const res = await toastRun(action, okMessage);
        if (!res.success) return false;
        await load();
        setChanges((n) => n + 1);
        return true;
      } finally {
        end();
      }
    },
    [begin, end, load, toastRun],
  );

  const refresh = useCallback(async () => {
    if (!begin("refresh")) return;
    try {
      await load();
      setChanges((n) => n + 1);
    } finally {
      end();
    }
  }, [begin, end, load]);

  /** Another page of the review list: only that list is read again. */
  const showReviewPage = useCallback(async (page: number) => {
    if (!begin("review:page")) return;
    try {
      const res = await toastRun(() => getApprovalsReviewPage(page));
      if (res.success) {
        reviewPage.current = res.data.page;
        setData((prev) => (prev ? { ...prev, review: res.data } : prev));
      }
    } finally {
      end();
    }
  }, [begin, end, toastRun]);

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Decisions only a manager makes, and data the import could not settle on its own. Handle a row in place and it leaves the list."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={busy !== null || loading}>
            <RefreshCw className={cn(loading && data !== null && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4 flex flex-wrap items-center gap-3" role="alert">
          <div className="min-w-0 flex-1">
            <Notice tone="error">{error}</Notice>
          </div>
          {data === null && (
            <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              Try Again
            </Button>
          )}
        </div>
      )}

      {data === null ? (
        error ? null : (
          <QueueSkeleton />
        )
      ) : (
        <div className="space-y-4">
          <Summary data={data} />
          <BlockApprovals data={data} run={run} busy={busy} onReviewPage={(page) => void showReviewPage(page)} />
          <DeparturesWithoutBlock data={data} run={run} busy={busy} />
          <UnmatchedHotels data={data} run={run} busy={busy} />
          <DeparturesWithoutPrice data={data} run={run} busy={busy} />
          <ExceptionsSummary refreshKey={changes} />
        </div>
      )}
    </div>
  );
}

/** The total and a count per section; each count jumps to its section. */
function Summary({ data }: { data: ApprovalsData }) {
  const sections = [
    {
      id: "blocks",
      label: "Flight block approvals",
      count: data.awaitingApproval.total + data.cancelDecisions.total + data.review.total,
    },
    { id: "no-block", label: "Published without a live flight", count: data.departuresWithoutBlock.length },
    { id: "hotels", label: "Hotels not in catalog", count: data.unmatchedHotels.length },
    { id: "no-price", label: "No price", count: data.departuresWithoutPrice.length },
  ];
  const total = sections.reduce((sum, s) => sum + s.count, 0);

  // Scrolls without touching the URL: nothing on this screen lives in the address bar.
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        {total === 0 ? (
          <CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden />
        ) : (
          <span className="font-display text-3xl font-bold tabular-nums leading-none tracking-tight">
            {total.toLocaleString("en-US")}
          </span>
        )}
        <div>
          <div className="text-sm font-medium">{total === 0 ? "Nothing to handle right now" : "Waiting to be handled"}</div>
          <div className="text-xs text-muted-foreground">
            As of <span dir="ltr">{formatDateShort(data.today)}</span>
          </div>
        </div>
      </div>
      <nav aria-label="Sections" className="flex flex-wrap items-center gap-2">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              s.count === 0 && "text-muted-foreground",
            )}
          >
            {s.label}
            <span className={cn("tabular-nums", s.count > 0 ? "font-semibold" : "font-normal")}>
              {s.count.toLocaleString("en-US")}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => jump("exceptions")}
          className="inline-flex items-center rounded-full border border-dashed px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Data problems
        </button>
      </nav>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading data">
      <Skeleton className="h-16 w-full" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border bg-card p-4 shadow-sm">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="mt-2 h-3 w-full max-w-xl" />
          <div className="mt-4 space-y-2.5">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
