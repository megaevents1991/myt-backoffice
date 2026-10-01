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
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getTourBlock, type TourBlockData } from "@/lib/actions/tours-flight-actions";
import { Notice, type RunAction } from "@/components/tours/flights/block-ui";
import { BlockLifecycleSection } from "@/components/tours/flights/block-lifecycle-section";
import { BlockDeadlinesSection, BlockSeatsSection } from "@/components/tours/flights/block-seats-deadlines";
import { BlockContractSection, BlockCostsSection } from "@/components/tours/flights/block-contract-costs";
import { BlockAllocationsSection, BlockTimelineSection } from "@/components/tours/flights/block-allocations-timeline";

export interface TourBlockPanelProps {
  /** public.flights.id of a block of the active company. */
  flightId: number;
  /**
   * Called after every load (the first one and after each change) with the fresh
   * data - for a host page that shows something of the block itself, like its PNR.
   */
  onLoaded?: (data: TourBlockData) => void;
}

export function TourBlockPanel({ flightId, onLoaded }: TourBlockPanelProps) {
  const [data, setData] = useState<TourBlockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const load = useCallback(async () => {
    try {
      const res = await getTourBlock(flightId);
      if (res.success) {
        setData(res.data);
        setError(null);
        onLoadedRef.current?.(res.data);
      } else {
        setError(res.error);
      }
    } catch (e) {
      console.error("TourBlockPanel: load failed", e);
      setError("טעינת הבלוק נכשלה. בדקו שהחברה הפעילה היא החברה של הבלוק ונסו שוב.");
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

  const run: RunAction = useCallback(
    async (action, okMessage) => {
      try {
        const res = await action();
        if (!res.success) {
          toast.error(res.error);
          return false;
        }
        if (okMessage) toast.success(okMessage);
        if (res.warning) toast(res.warning, { duration: 8000 });
        await load();
        return true;
      } catch (e) {
        console.error("TourBlockPanel: action failed", e);
        toast.error("הפעולה נכשלה. נסו שוב.");
        return false;
      }
    },
    [load],
  );

  if (loading && !data) {
    return (
      <div dir="rtl" className="space-y-4" aria-busy="true">
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
      <div dir="rtl" className="space-y-3">
        <Notice tone="danger">{error ?? "הבלוק לא נמצא"}</Notice>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          ניסיון נוסף
        </Button>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      {error && <Notice tone="danger">{error}</Notice>}
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
