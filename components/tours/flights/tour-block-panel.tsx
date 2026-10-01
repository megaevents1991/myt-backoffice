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
import { useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast, type ActionAnswer, type OkMessage } from "@/hooks/use-action-toast";
import { getTourBlock, type TourBlockData } from "@/lib/actions/tours-flight-actions";
import { LoadError, Notice } from "@/components/tours/ui";
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

const LOAD_FAILED = "Couldn't load the flight block. Check that the active company owns it and try again.";

export function TourBlockPanel({ flightId }: TourBlockPanelProps) {
  const { data: loaded, error, loading, reload } = useActionData(
    () =>
      getTourBlock(flightId).catch((e) => {
        console.error("TourBlockPanel: load failed", e);
        return { success: false as const, error: LOAD_FAILED };
      }),
    [flightId],
  );
  // The hook keeps the last data while it loads another block; never show one block under another's id.
  const data = loaded?.block.id === flightId ? loaded : null;

  const toastRun = useActionToast();
  const run = useCallback(
    async <A extends ActionAnswer>(action: () => Promise<A>, okMessage?: OkMessage<A>): Promise<A> => {
      const res = await toastRun(action, okMessage);
      if (res.success) await reload({ quiet: true });
      return res;
    },
    [toastRun, reload],
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

  if (!data) return <LoadError message={error ?? "Flight block not found"} onRetry={() => void reload()} />;

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
