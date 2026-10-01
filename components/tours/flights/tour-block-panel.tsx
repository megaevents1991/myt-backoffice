"use client";

/**
 * Operations panel of one group flight block of a tours company: lifecycle,
 * seats, deadlines, contract, costs, allocations to departures and the timeline.
 * It replaces the row of the operations workbook.
 *
 * Self-contained: it loads and saves everything through its own server actions
 * (lib/actions/tours-flight-actions.ts), so any page can mount it with just the
 * flight id:
 *
 *   import { TourBlockPanel } from "@/components/tours/flights/tour-block-panel";
 *   <TourBlockPanel flightId={flight.id} />
 *
 * The actions answer "not found" for a flight of another company, so mounting it
 * with a foreign id shows an error and nothing else.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionToast, type ActionAnswer } from "@/hooks/use-action-toast";
import { getTourBlock, type TourBlockData } from "@/lib/actions/tours-flight-actions";
import { Notice } from "@/components/tours/ui";
import { BlockLifecycleSection } from "@/components/tours/flights/block-lifecycle-section";
import { BlockDeadlinesSection, BlockSeatsSection } from "@/components/tours/flights/block-seats-deadlines";
import { BlockContractSection, BlockCostsSection } from "@/components/tours/flights/block-contract-costs";
import { BlockAllocationsSection, BlockTimelineSection } from "@/components/tours/flights/block-allocations-timeline";

export interface TourBlockPanelProps {
  /** public.flights.id of a block of the active company. */
  flightId: number;
}

/**
 * What every section of the panel gets: the block, and `run` - the shared action
 * toast (hooks/use-action-toast.ts), which also reloads the block after a success.
 */
export interface BlockSectionProps {
  data: TourBlockData;
  run: ReturnType<typeof useActionToast>;
}

export function TourBlockPanel({ flightId }: TourBlockPanelProps) {
  const [data, setData] = useState<TourBlockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await getTourBlock(flightId);
      if (res.success) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("TourBlockPanel: load failed", e);
      setError("Couldn't load the flight block. Check that the active company owns it and try again.");
    } finally {
      setLoading(false);
    }
  }, [flightId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    void load();
  }, [load]);

  const toastRun = useActionToast();
  const run = useCallback(
    async <A extends ActionAnswer>(action: () => Promise<A>, okMessage?: string): Promise<A> => {
      const res = await toastRun(action, okMessage);
      if (res.success) await load();
      return res;
    },
    [toastRun, load],
  );

  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-36 w-full" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <Notice tone="error">{error ?? "Flight block not found"}</Notice>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <BlockLifecycleSection data={data} run={run} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <BlockSeatsSection data={data} run={run} />
          <BlockCostsSection data={data} run={run} />
        </div>
        <div className="space-y-4">
          <BlockDeadlinesSection data={data} run={run} />
          <BlockContractSection data={data} run={run} />
        </div>
      </div>
      <BlockAllocationsSection data={data} run={run} />
      <BlockTimelineSection data={data} run={run} />
    </div>
  );
}
